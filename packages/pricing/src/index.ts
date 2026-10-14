import { z } from 'zod';

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** All commercial rules are explicitly supplied by the retailer; none have defaults. */
export const pricingPolicySchema = z
  .object({
    version: z.literal(1),
    currency: currencySchema,
    taxMode: z.enum(['exclusive', 'inclusive']),
    taxRateBps: basisPointsSchema,
    rounding: z.enum(['per_line', 'invoice']),
    discountBps: basisPointsSchema,
    deliveryMinor: moneySchema,
    installationMinor: moneySchema,
    feesTaxable: z.boolean(),
  })
  .strict();
export type PricingPolicy = z.infer<typeof pricingPolicySchema>;

export const pricingItemSchema = z
  .object({
    variantId: z.uuid().transform((value) => value.toLowerCase()),
    sku: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unitPriceMinor: moneySchema,
    currency: currencySchema,
  })
  .strict();
export type PricingItem = z.infer<typeof pricingItemSchema>;
export const MAX_PRICING_LINES = 1_000;
export const pricingInputSchema = z
  .object({
    policy: pricingPolicySchema,
    items: z.array(pricingItemSchema).max(MAX_PRICING_LINES),
  })
  .strict();

export interface PricedLine extends Readonly<PricingItem> {
  /** Listed unit price × quantity, before the merchandise discount. */
  readonly subtotalMinor: number;
  /** Discount in the same inclusive/exclusive basis as the listed price. */
  readonly discountMinor: number;
  readonly netMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
}
export interface PricedFee {
  readonly inputMinor: number;
  readonly taxable: boolean;
  readonly netMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
}
export interface QuotationPricing {
  readonly version: 1;
  readonly policy: Readonly<PricingPolicy>;
  /** Stable ascending variant ID order, independent of request order. */
  readonly lines: readonly PricedLine[];
  readonly fees: Readonly<{ delivery: PricedFee; installation: PricedFee }>;
  readonly totals: Readonly<{
    /** Merchandise only; fees are not discounted. */
    subtotalMinor: number;
    discountMinor: number;
    merchandiseNetMinor: number;
    merchandiseTaxMinor: number;
    merchandiseTotalMinor: number;
    /** Charged fee amounts, including tax where applicable. */
    deliveryMinor: number;
    installationMinor: number;
    /** Entire invoice, including fees. */
    netMinor: number;
    taxMinor: number;
    grandTotalMinor: number;
  }>;
}

export class PricingError extends Error {
  constructor(
    readonly code: 'CURRENCY_MISMATCH' | 'DUPLICATE_VARIANT' | 'CONFLICTING_VARIANT' | 'AMOUNT_OVERFLOW',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
const BPS = 10_000n;
function amount(value: bigint): number {
  if (value < 0n || value > MAX_AMOUNT)
    throw new PricingError('AMOUNT_OVERFLOW', 'Quotation amount exceeds the safe integer limit');
  return Number(value);
}
function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}
function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Round an aggregate once, then apportion its whole minor units by largest remainder.
 * Variant UUID is the stable tie-break; fees sort after merchandise. This prevents
 * input order, binary floating point and iteration order from changing money.
 */
function roundedAmounts(
  entries: readonly { key: string; numerator: bigint }[],
  denominator: bigint,
  mode: PricingPolicy['rounding'],
): bigint[] {
  if (mode === 'per_line') return entries.map((entry) => halfUp(entry.numerator, denominator));
  const floors = entries.map((entry) => entry.numerator / denominator);
  const remainderUnits = halfUp(sum(entries.map((entry) => entry.numerator)), denominator) - sum(floors);
  const ranked = entries
    .map((entry, index) => ({
      key: entry.key,
      index,
      remainder: entry.numerator % denominator,
    }))
    .sort((a, b) =>
      a.remainder === b.remainder ? compareKey(a.key, b.key) : a.remainder > b.remainder ? -1 : 1,
    );
  for (let index = 0; index < Number(remainderUnits); index++) floors[ranked[index].index] += 1n;
  return floors;
}

/**
 * Combine repeated authoritative variants, without guessing which conflicting
 * catalogue snapshot is correct. Callers still own SKU, tenant and stock admission.
 */
export function aggregatePricingItems(input: unknown): PricingItem[] {
  const items = z.array(pricingItemSchema).max(MAX_PRICING_LINES).parse(input);
  const variants = new Map<string, PricingItem>();
  for (const item of items) {
    const previous = variants.get(item.variantId);
    if (!previous) {
      variants.set(item.variantId, { ...item });
      continue;
    }
    if (
      previous.sku !== item.sku ||
      previous.name !== item.name ||
      previous.unitPriceMinor !== item.unitPriceMinor ||
      previous.currency !== item.currency
    )
      throw new PricingError(
        'CONFLICTING_VARIANT',
        'Repeated variant references have conflicting catalogue details',
      );
    previous.quantity = amount(BigInt(previous.quantity) + BigInt(item.quantity));
  }
  return [...variants.values()].sort((a, b) => compareKey(a.variantId, b.variantId));
}

/**
 * Pure exact pricing. Discount applies to merchandise before tax; fees have no
 * discount. Inclusive prices reverse tax with r/(10000+r); exclusive prices add
 * tax with r/10000. Non-taxable fees always retain their configured amount.
 * Per-line rounding rounds every discount/tax half up. Invoice rounding rounds
 * each aggregate once and allocates the residual deterministically. No currency
 * conversion, jurisdiction inference, inventory reservation or live lookup occurs.
 */
export function priceQuotation(input: unknown): QuotationPricing {
  const parsed = pricingInputSchema.parse(input);
  const { policy } = parsed;
  const items = [...parsed.items].sort((a, b) => compareKey(a.variantId, b.variantId));
  const identities = new Set<string>();
  for (const item of items) {
    if (item.currency !== policy.currency)
      throw new PricingError('CURRENCY_MISMATCH', 'Item currency does not match the pricing policy');
    if (identities.has(item.variantId))
      throw new PricingError('DUPLICATE_VARIANT', 'Combine repeated variants before pricing');
    identities.add(item.variantId);
  }
  const subtotals = items.map((item) => BigInt(item.unitPriceMinor) * BigInt(item.quantity));
  amount(sum(subtotals));
  const discounts = roundedAmounts(
    items.map((item, index) => ({
      key: item.variantId,
      numerator: subtotals[index] * BigInt(policy.discountBps),
    })),
    BPS,
    policy.rounding,
  );
  const discounted = subtotals.map((value, index) => value - discounts[index]);
  const bases = [
    ...items.map((item, index) => ({ key: item.variantId, value: discounted[index], taxable: true })),
    { key: '~fee:delivery', value: BigInt(policy.deliveryMinor), taxable: policy.feesTaxable },
    { key: '~fee:installation', value: BigInt(policy.installationMinor), taxable: policy.feesTaxable },
  ];
  const taxes = roundedAmounts(
    bases.map((base) => ({
      key: base.key,
      numerator: base.taxable ? base.value * BigInt(policy.taxRateBps) : 0n,
    })),
    policy.taxMode === 'inclusive' ? BPS + BigInt(policy.taxRateBps) : BPS,
    policy.rounding,
  );
  const nets = bases.map((base, index) =>
    policy.taxMode === 'inclusive' ? base.value - taxes[index] : base.value,
  );
  const lines = items.map((item, index): PricedLine =>
    Object.freeze({
      ...item,
      subtotalMinor: amount(subtotals[index]),
      discountMinor: amount(discounts[index]),
      netMinor: amount(nets[index]),
      taxMinor: amount(taxes[index]),
      totalMinor: amount(nets[index] + taxes[index]),
    }),
  );
  const fee = (index: number): PricedFee =>
    Object.freeze({
      inputMinor: amount(bases[index].value),
      taxable: bases[index].taxable,
      netMinor: amount(nets[index]),
      taxMinor: amount(taxes[index]),
      totalMinor: amount(nets[index] + taxes[index]),
    });
  const delivery = fee(items.length);
  const installation = fee(items.length + 1);
  const merchandiseNet = sum(nets.slice(0, items.length));
  const merchandiseTax = sum(taxes.slice(0, items.length));
  const net = sum(nets);
  const tax = sum(taxes);
  return Object.freeze({
    version: 1 as const,
    policy: Object.freeze({ ...policy }),
    lines: Object.freeze(lines),
    fees: Object.freeze({ delivery, installation }),
    totals: Object.freeze({
      subtotalMinor: amount(sum(subtotals)),
      discountMinor: amount(sum(discounts)),
      merchandiseNetMinor: amount(merchandiseNet),
      merchandiseTaxMinor: amount(merchandiseTax),
      merchandiseTotalMinor: amount(merchandiseNet + merchandiseTax),
      deliveryMinor: delivery.totalMinor,
      installationMinor: installation.totalMinor,
      netMinor: amount(net),
      taxMinor: amount(tax),
      grandTotalMinor: amount(net + tax),
    }),
  });
}

const pricedLineSchema = pricingItemSchema.extend({
  subtotalMinor: moneySchema,
  discountMinor: moneySchema,
  netMinor: moneySchema,
  taxMinor: moneySchema,
  totalMinor: moneySchema,
});
const pricedFeeSchema = z
  .object({
    inputMinor: moneySchema,
    taxable: z.boolean(),
    netMinor: moneySchema,
    taxMinor: moneySchema,
    totalMinor: moneySchema,
  })
  .strict();

/** Validate stored pricing mathematically, rather than trusting plausible totals. */
export const quotationPricingSchema = z
  .object({
    version: z.literal(1),
    policy: pricingPolicySchema,
    lines: z.array(pricedLineSchema).max(MAX_PRICING_LINES),
    fees: z.object({ delivery: pricedFeeSchema, installation: pricedFeeSchema }).strict(),
    totals: z
      .object({
        subtotalMinor: moneySchema,
        discountMinor: moneySchema,
        merchandiseNetMinor: moneySchema,
        merchandiseTaxMinor: moneySchema,
        merchandiseTotalMinor: moneySchema,
        deliveryMinor: moneySchema,
        installationMinor: moneySchema,
        netMinor: moneySchema,
        taxMinor: moneySchema,
        grandTotalMinor: moneySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((result, ctx) => {
    try {
      const expected = priceQuotation({
        policy: result.policy,
        items: result.lines.map(({ variantId, sku, name, quantity, unitPriceMinor, currency }) => ({
          variantId,
          sku,
          name,
          quantity,
          unitPriceMinor,
          currency,
        })),
      });
      // The strict schemas above give both objects the same canonical key order.
      if (JSON.stringify(result) !== JSON.stringify(expected))
        ctx.addIssue({ code: 'custom', message: 'Quotation pricing does not match its policy and items' });
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof PricingError ? error.message : 'Invalid quotation pricing inputs',
      });
    }
  });
