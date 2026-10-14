import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  aggregatePricingItems,
  priceQuotation,
  pricingInputSchema,
  pricingPolicySchema,
  quotationPricingSchema,
  type PricingItem,
  type PricingPolicy,
} from '../packages/pricing/src/index';

const variantA = '00000000-0000-4000-8000-00000000000a';
const variantB = '00000000-0000-4000-8000-00000000000b';
function policy(overrides: Partial<PricingPolicy> = {}): PricingPolicy {
  return {
    version: 1,
    currency: 'EUR',
    taxMode: 'exclusive',
    taxRateBps: 2_000,
    rounding: 'per_line',
    discountBps: 0,
    deliveryMinor: 0,
    installationMinor: 0,
    feesTaxable: false,
    ...overrides,
  };
}
function item(overrides: Partial<PricingItem> = {}): PricingItem {
  return {
    variantId: variantA,
    sku: 'BED-OAK-150',
    name: 'Oak bed',
    quantity: 1,
    unitPriceMinor: 10_000,
    currency: 'EUR',
    ...overrides,
  };
}

describe('explicit retailer pricing policies', () => {
  it('requires explicit tax, rounding, discounts and fee taxability without inferred defaults', () => {
    expect(pricingPolicySchema.safeParse({ currency: 'EUR' }).success).toBe(false);
    for (const field of Object.keys(policy())) {
      const incomplete: Record<string, unknown> = { ...policy() };
      delete incomplete[field];
      expect(pricingPolicySchema.safeParse(incomplete).success).toBe(false);
    }
    expect(pricingPolicySchema.safeParse({ ...policy(), jurisdiction: 'MT' }).success).toBe(false);
    for (const invalid of [-1, 10_001, 0.5, Infinity, NaN]) {
      expect(pricingPolicySchema.safeParse(policy({ taxRateBps: invalid })).success).toBe(false);
      expect(pricingPolicySchema.safeParse(policy({ discountBps: invalid })).success).toBe(false);
    }
  });

  it('does not accept mixed currencies, unsafe money, negative fees or browser-invented fields', () => {
    expect(() => priceQuotation({ policy: policy(), items: [item({ currency: 'USD' })] })).toThrow(
      'currency',
    );
    expect(
      pricingInputSchema.safeParse({ policy: policy(), items: [item()], retailerId: 'foreign' }).success,
    ).toBe(false);
    for (const unitPriceMinor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        pricingInputSchema.safeParse({ policy: policy(), items: [item({ unitPriceMinor })] }).success,
      ).toBe(false);
    expect(pricingPolicySchema.safeParse(policy({ deliveryMinor: -1 })).success).toBe(false);
    expect(() => priceQuotation({ policy: policy(), items: [{ ...item(), taxMinor: 0 }] })).toThrow();
    expect(() => priceQuotation({ policy: policy(), items: [item({ quantity: 0 })] })).toThrow();
  });
});

describe('exact quotation arithmetic', () => {
  it('applies a merchandise discount before adding exclusive tax and leaves non-taxable fees undiscounted', () => {
    const result = priceQuotation({
      policy: policy({ discountBps: 1_000, deliveryMinor: 500, installationMinor: 250 }),
      items: [item({ quantity: 2 })],
    });
    expect(result.lines[0]).toMatchObject({
      subtotalMinor: 20_000,
      discountMinor: 2_000,
      netMinor: 18_000,
      taxMinor: 3_600,
      totalMinor: 21_600,
    });
    expect(result.fees.delivery).toEqual({
      inputMinor: 500,
      taxable: false,
      netMinor: 500,
      taxMinor: 0,
      totalMinor: 500,
    });
    expect(result.totals).toEqual({
      subtotalMinor: 20_000,
      discountMinor: 2_000,
      merchandiseNetMinor: 18_000,
      merchandiseTaxMinor: 3_600,
      merchandiseTotalMinor: 21_600,
      deliveryMinor: 500,
      installationMinor: 250,
      netMinor: 18_750,
      taxMinor: 3_600,
      grandTotalMinor: 22_350,
    });
  });

  it('extracts inclusive tax after the discount and extracts taxable fee tax without adding it again', () => {
    const result = priceQuotation({
      policy: policy({
        taxMode: 'inclusive',
        discountBps: 1_000,
        deliveryMinor: 1_200,
        installationMinor: 600,
        feesTaxable: true,
      }),
      items: [item({ unitPriceMinor: 12_000 })],
    });
    expect(result.lines[0]).toMatchObject({
      subtotalMinor: 12_000,
      discountMinor: 1_200,
      netMinor: 9_000,
      taxMinor: 1_800,
      totalMinor: 10_800,
    });
    expect(result.fees.delivery).toMatchObject({ netMinor: 1_000, taxMinor: 200, totalMinor: 1_200 });
    expect(result.fees.installation).toMatchObject({ netMinor: 500, taxMinor: 100, totalMinor: 600 });
    expect(result.totals).toMatchObject({ netMinor: 10_500, taxMinor: 2_100, grandTotalMinor: 12_600 });
  });

  it('adds exclusive fee tax only when the retailer makes fees taxable', () => {
    const result = priceQuotation({
      policy: policy({ deliveryMinor: 500, installationMinor: 250, feesTaxable: true }),
      items: [item()],
    });
    expect(result.fees.delivery).toMatchObject({ netMinor: 500, taxMinor: 100, totalMinor: 600 });
    expect(result.fees.installation).toMatchObject({ netMinor: 250, taxMinor: 50, totalMinor: 300 });
    expect(result.totals.grandTotalMinor).toBe(12_900);
  });

  it('retains fee amounts after a full merchandise discount and supports zero tax', () => {
    const result = priceQuotation({
      policy: policy({ discountBps: 10_000, taxRateBps: 0, deliveryMinor: 500 }),
      items: [item({ quantity: 3 })],
    });
    expect(result.lines[0]).toMatchObject({ subtotalMinor: 30_000, discountMinor: 30_000, totalMinor: 0 });
    expect(result.totals).toMatchObject({ netMinor: 500, taxMinor: 0, grandTotalMinor: 500 });
    expect(priceQuotation({ policy: policy({ taxRateBps: 0 }), items: [] }).totals.grandTotalMinor).toBe(0);
  });

  it('rounds half a minor unit upwards without binary floating point', () => {
    const result = priceQuotation({
      policy: policy({ taxRateBps: 5_000, discountBps: 0 }),
      items: [item({ unitPriceMinor: 1 })],
    });
    expect(result.lines[0]).toMatchObject({ netMinor: 1, taxMinor: 1, totalMinor: 2 });
    const inclusive = priceQuotation({
      policy: policy({ taxMode: 'inclusive', taxRateBps: 10_000 }),
      items: [item({ unitPriceMinor: 1 })],
    });
    expect(inclusive.lines[0]).toMatchObject({ netMinor: 0, taxMinor: 1, totalMinor: 1 });
  });

  it('keeps JPY and KWD values in their authoritative minor units without assuming two decimals', () => {
    const yen = priceQuotation({
      policy: policy({ currency: 'JPY', taxRateBps: 1_000 }),
      items: [item({ currency: 'JPY', unitPriceMinor: 1_250, quantity: 3 })],
    });
    expect(yen.totals).toMatchObject({ subtotalMinor: 3_750, taxMinor: 375, grandTotalMinor: 4_125 });
    const dinar = priceQuotation({
      policy: policy({ currency: 'KWD', taxRateBps: 500 }),
      items: [item({ currency: 'KWD', unitPriceMinor: 12_345, quantity: 3 })],
    });
    expect(dinar.totals).toMatchObject({ subtotalMinor: 37_035, taxMinor: 1_852, grandTotalMinor: 38_887 });
  });

  it('accepts the safe-integer boundary exactly and rejects subtotal, tax and fee overflows', () => {
    const boundary = priceQuotation({
      policy: policy({ taxRateBps: 0 }),
      items: [item({ unitPriceMinor: Number.MAX_SAFE_INTEGER })],
    });
    expect(boundary.totals.grandTotalMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(() =>
      priceQuotation({
        policy: policy({ taxRateBps: 0 }),
        items: [item({ unitPriceMinor: Number.MAX_SAFE_INTEGER, quantity: 2 })],
      }),
    ).toThrow('safe integer');
    expect(() =>
      priceQuotation({ policy: policy(), items: [item({ unitPriceMinor: Number.MAX_SAFE_INTEGER })] }),
    ).toThrow('safe integer');
    expect(() =>
      priceQuotation({
        policy: policy({ taxRateBps: 0, deliveryMinor: 1 }),
        items: [item({ unitPriceMinor: Number.MAX_SAFE_INTEGER })],
      }),
    ).toThrow('safe integer');
    expect(() =>
      priceQuotation({
        policy: policy({ taxRateBps: 0 }),
        items: [item({ unitPriceMinor: Number.MAX_SAFE_INTEGER }), item({ variantId: variantB })],
      }),
    ).toThrow('safe integer');
  });
});

describe('invoice allocations and deterministic quotation snapshots', () => {
  it('distinguishes per-line rounding from invoice rounding for discounts', () => {
    const items = [item({ unitPriceMinor: 1 }), item({ variantId: variantB, unitPriceMinor: 1 })];
    const perLine = priceQuotation({ policy: policy({ discountBps: 5_000, taxRateBps: 0 }), items });
    const invoice = priceQuotation({
      policy: policy({ discountBps: 5_000, taxRateBps: 0, rounding: 'invoice' }),
      items,
    });
    expect(perLine.totals).toMatchObject({ discountMinor: 2, grandTotalMinor: 0 });
    expect(invoice.totals).toMatchObject({ discountMinor: 1, grandTotalMinor: 1 });
    expect(invoice.lines.map((line) => line.discountMinor)).toEqual([1, 0]);
  });

  it('distinguishes per-line rounding from invoice rounding for tax with stable residual allocation', () => {
    const items = [item({ unitPriceMinor: 1 }), item({ variantId: variantB, unitPriceMinor: 1 })];
    const perLine = priceQuotation({ policy: policy({ taxRateBps: 5_000 }), items });
    const invoicePolicy = policy({ taxRateBps: 5_000, rounding: 'invoice' });
    const invoice = priceQuotation({ policy: invoicePolicy, items });
    expect(perLine.totals).toMatchObject({ taxMinor: 2, grandTotalMinor: 4 });
    expect(invoice.totals).toMatchObject({ taxMinor: 1, grandTotalMinor: 3 });
    expect(invoice.lines.map((line) => line.taxMinor)).toEqual([1, 0]);
    expect(priceQuotation({ policy: invoicePolicy, items: [...items].reverse() })).toEqual(invoice);
  });

  it('ranks fractional remainders before UUID ties and includes taxable fees in invoice tax rounding', () => {
    const result = priceQuotation({
      policy: policy({ taxRateBps: 1_000, rounding: 'invoice', deliveryMinor: 5, feesTaxable: true }),
      items: [item({ unitPriceMinor: 4 }), item({ variantId: variantB, unitPriceMinor: 9 })],
    });
    // 0.4 + 0.9 + 0.5 = 1.8 -> two tax units, assigned to 0.9 then 0.5.
    expect(result.lines.map((line) => line.taxMinor)).toEqual([0, 1]);
    expect(result.fees.delivery.taxMinor).toBe(1);
    expect(result.totals).toMatchObject({ netMinor: 18, taxMinor: 2, grandTotalMinor: 20 });
  });

  it('allocates inclusive invoice tax while preserving every line and aggregate total', () => {
    const result = priceQuotation({
      policy: policy({ taxMode: 'inclusive', taxRateBps: 10_000, rounding: 'invoice' }),
      items: [item({ unitPriceMinor: 1 }), item({ variantId: variantB, unitPriceMinor: 1 })],
    });
    expect(
      result.lines.map((line) => ({ net: line.netMinor, tax: line.taxMinor, total: line.totalMinor })),
    ).toEqual([
      { net: 0, tax: 1, total: 1 },
      { net: 1, tax: 0, total: 1 },
    ]);
    expect(result.totals).toMatchObject({ netMinor: 1, taxMinor: 1, grandTotalMinor: 2 });
  });

  it('rejects duplicate variant identities and aggregates only matching authoritative details', () => {
    expect(() => priceQuotation({ policy: policy(), items: [item(), item()] })).toThrow('repeated');
    expect(aggregatePricingItems([item({ quantity: 2 }), item({ quantity: 3 })])).toEqual([
      item({ quantity: 5 }),
    ]);
    expect(aggregatePricingItems([item(), item({ variantId: variantA.toUpperCase() })])).toEqual([
      item({ quantity: 2 }),
    ]);
    for (const conflict of [
      item({ sku: 'ANOTHER-SKU' }),
      item({ unitPriceMinor: 1 }),
      item({ name: 'Different product' }),
      item({ currency: 'USD' }),
    ])
      expect(() => aggregatePricingItems([item(), conflict])).toThrow('conflicting');
    expect(() => aggregatePricingItems([item({ quantity: Number.MAX_SAFE_INTEGER }), item()])).toThrow(
      'safe integer',
    );
  });

  it('freezes the result independently of mutable caller data', () => {
    const inputPolicy = policy();
    const inputItem = item();
    const result = priceQuotation({ policy: inputPolicy, items: [inputItem] });
    inputPolicy.taxRateBps = 0;
    inputItem.unitPriceMinor = 0;
    expect(result.policy.taxRateBps).toBe(2_000);
    expect(result.lines[0].unitPriceMinor).toBe(10_000);
    for (const value of [
      result,
      result.policy,
      result.lines,
      result.lines[0],
      result.fees,
      result.fees.delivery,
      result.totals,
    ])
      expect(Object.isFrozen(value)).toBe(true);
  });

  it('validates durable snapshots by recomputing all maths, rejecting plausible corruption', () => {
    const valid = priceQuotation({ policy: policy(), items: [item()] });
    expect(quotationPricingSchema.safeParse(JSON.parse(JSON.stringify(valid))).success).toBe(true);
    const corruption = JSON.parse(JSON.stringify(valid));
    corruption.lines[0].taxMinor = 1_999;
    corruption.lines[0].totalMinor = 11_999;
    corruption.totals.taxMinor = 1_999;
    corruption.totals.merchandiseTaxMinor = 1_999;
    corruption.totals.merchandiseTotalMinor = 11_999;
    corruption.totals.grandTotalMinor = 11_999;
    expect(quotationPricingSchema.safeParse(corruption).success).toBe(false);
    expect(quotationPricingSchema.safeParse({ ...valid, unsignedTotal: 12_000 }).success).toBe(false);
  });

  it('conserves money, never discounts beyond listed price and is request-order independent across policies', () => {
    fc.assert(
      fc.property(
        fc.record({
          unitA: fc.integer({ min: 0, max: 100_000 }),
          unitB: fc.integer({ min: 0, max: 100_000 }),
          quantityA: fc.integer({ min: 1, max: 20 }),
          quantityB: fc.integer({ min: 1, max: 20 }),
          discount: fc.integer({ min: 0, max: 10_000 }),
          tax: fc.integer({ min: 0, max: 10_000 }),
          delivery: fc.integer({ min: 0, max: 10_000 }),
          installation: fc.integer({ min: 0, max: 10_000 }),
          inclusive: fc.boolean(),
          invoice: fc.boolean(),
          taxableFees: fc.boolean(),
        }),
        (sample) => {
          const inputPolicy = policy({
            taxMode: sample.inclusive ? 'inclusive' : 'exclusive',
            rounding: sample.invoice ? 'invoice' : 'per_line',
            discountBps: sample.discount,
            taxRateBps: sample.tax,
            deliveryMinor: sample.delivery,
            installationMinor: sample.installation,
            feesTaxable: sample.taxableFees,
          });
          const items = [
            item({ unitPriceMinor: sample.unitA, quantity: sample.quantityA }),
            item({ variantId: variantB, unitPriceMinor: sample.unitB, quantity: sample.quantityB }),
          ];
          const result = priceQuotation({ policy: inputPolicy, items });
          expect(priceQuotation({ policy: inputPolicy, items: [...items].reverse() })).toEqual(result);
          for (const line of result.lines) {
            expect(line.discountMinor).toBeGreaterThanOrEqual(0);
            expect(line.discountMinor).toBeLessThanOrEqual(line.subtotalMinor);
            expect(line.netMinor + line.taxMinor).toBe(line.totalMinor);
            expect(line.totalMinor).toBe(
              sample.inclusive
                ? line.subtotalMinor - line.discountMinor
                : line.subtotalMinor - line.discountMinor + line.taxMinor,
            );
          }
          expect(result.totals.netMinor + result.totals.taxMinor).toBe(result.totals.grandTotalMinor);
          expect(
            result.lines.reduce((total, line) => total + line.totalMinor, 0) +
              result.fees.delivery.totalMinor +
              result.fees.installation.totalMinor,
          ).toBe(result.totals.grandTotalMinor);
          expect(quotationPricingSchema.safeParse(result).success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
