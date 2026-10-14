import { z } from 'zod';

export const dimensionsSchema = z
  .object({
    width: z.number().finite().positive().max(20),
    depth: z.number().finite().positive().max(20),
    height: z.number().finite().positive().max(10),
  })
  .strict();
export type Dimensions = z.infer<typeof dimensionsSchema>;
export const categorySchema = z.enum(['bed', 'wardrobe', 'bedside', 'rug', 'desk']);
export const availabilitySchema = z.enum(['in_stock', 'made_to_order', 'out_of_stock']);
export const skuSchema = z.string().trim().min(1).max(100);
const nameSchema = z.string().trim().min(1).max(100);
const inventoryFields = {
  priceMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dimensions: dimensionsSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  material: z.string().trim().max(100),
  active: z.boolean(),
  availability: availabilitySchema,
  stockQuantity: z.number().int().nonnegative().max(2_147_483_647),
  leadTimeDays: z.number().int().nonnegative().max(2_147_483_647),
};
export const variantInputSchema = z
  .object({ id: z.uuid().optional(), sku: skuSchema, name: nameSchema, ...inventoryFields })
  .strict();
export type VariantInput = z.infer<typeof variantInputSchema>;
export const productInputSchema = z
  .object({
    sku: skuSchema,
    name: nameSchema,
    category: categorySchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    ...inventoryFields,
    variants: z.array(variantInputSchema).max(100).default([]),
  })
  .strict()
  .superRefine((product, ctx) => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    product.variants.forEach((variant, index) => {
      if (seen.has(variant.sku))
        ctx.addIssue({
          code: 'custom',
          path: ['variants', index, 'sku'],
          message: 'Duplicate variant SKU',
        });
      seen.add(variant.sku);
      if (variant.id && ids.has(variant.id))
        ctx.addIssue({ code: 'custom', path: ['variants', index, 'id'], message: 'Duplicate variant ID' });
      if (variant.id) ids.add(variant.id);
    });
  });
export type ProductInput = z.infer<typeof productInputSchema>;
/** A manually entered product with no variants receives one equivalent default variant. */
export function normaliseProductInput(input: unknown): ProductInput {
  const product = productInputSchema.parse(input);
  if (product.variants.length) return product;
  const {
    sku,
    name,
    priceMinor,
    dimensions,
    color,
    material,
    active,
    availability,
    stockQuantity,
    leadTimeDays,
  } = product;
  return {
    ...product,
    variants: [
      {
        sku,
        name,
        priceMinor,
        dimensions,
        color,
        material,
        active,
        availability,
        stockQuantity,
        leadTimeDays,
      },
    ],
  };
}
export const variantSchema = variantInputSchema.extend({
  id: z.uuid(),
  productId: z.uuid(),
  organisationId: z.uuid(),
});
export type CatalogueVariant = z.infer<typeof variantSchema>;
export const assetSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    variantId: z.uuid().nullable(),
    kind: z.enum(['image', 'model']),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'model/gltf+json']),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
    dimensions: dimensionsSchema.nullable(),
    validation: z.record(z.string(), z.unknown()),
    url: z.string().optional(),
  })
  .strict();
export type CatalogueAsset = z.infer<typeof assetSchema>;
export const productSchema = productInputSchema.safeExtend({
  id: z.uuid(),
  organisationId: z.uuid(),
  variants: z.array(variantSchema).min(1).max(100),
  assets: z.array(assetSchema),
});
export type CatalogueProduct = z.infer<typeof productSchema>;

export const CSV_HEADERS = [
  'product_sku',
  'variant_sku',
  'product_name',
  'variant_name',
  'category',
  'price_minor',
  'currency',
  'width_m',
  'depth_m',
  'height_m',
  'color',
  'material',
  'availability',
  'stock_quantity',
  'lead_time_days',
  'active',
] as const;
export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 500;
export interface CsvRowError {
  row: number;
  field: string;
  message: string;
}
export interface CatalogueCsvResult {
  products: ProductInput[];
  rowCount: number;
  errors: CsvRowError[];
}

function parseRows(text: string): { rows: string[][]; error?: CsvRowError } {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const pushField = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === '"') {
      if (field.length || closed)
        return {
          rows,
          error: { row: rows.length + 1, field: 'csv', message: 'Unexpected quote in unquoted field' },
        };
      quoted = true;
    } else if (char === ',') pushField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      pushRow();
    } else {
      if (closed)
        return {
          rows,
          error: { row: rows.length + 1, field: 'csv', message: 'Unexpected text after closing quote' },
        };
      field += char;
    }
    if (rows.length > MAX_CSV_ROWS + 1)
      return {
        rows,
        error: { row: rows.length, field: 'csv', message: `Maximum ${MAX_CSV_ROWS} data rows` },
      };
  }
  if (quoted)
    return { rows, error: { row: rows.length + 1, field: 'csv', message: 'Unterminated quoted field' } };
  if (field.length || row.length || closed) pushRow();
  return { rows };
}

/** Bounded RFC 4180 CSV import. Any error returns no products, so imports remain atomic. */
export function parseCatalogueCsv(input: Uint8Array | string): CatalogueCsvResult {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const fail = (message: string): CatalogueCsvResult => ({
    products: [],
    rowCount: 0,
    errors: [{ row: 1, field: 'csv', message }],
  });
  if (bytes.byteLength > MAX_CSV_BYTES) return fail('CSV exceeds the 1 MiB limit');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('CSV must use valid UTF-8');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('\0')) return fail('CSV contains a null byte');
  const parsed = parseRows(text);
  if (parsed.error)
    return { products: [], rowCount: Math.max(0, parsed.rows.length - 1), errors: [parsed.error] };
  const [headers, ...rows] = parsed.rows;
  if (
    !headers ||
    headers.length !== CSV_HEADERS.length ||
    new Set(headers).size !== headers.length ||
    CSV_HEADERS.some((header) => !headers.includes(header))
  )
    return fail(`CSV headers must contain exactly: ${CSV_HEADERS.join(',')}`);
  if (!rows.length) return fail('CSV must contain at least one data row');
  if (rows.length > MAX_CSV_ROWS) return fail(`Maximum ${MAX_CSV_ROWS} data rows`);
  const errors: CsvRowError[] = [];
  const groups = new Map<string, ProductInput>();
  const variants = new Set<string>();
  rows.forEach((cells, index) => {
    const row = index + 2;
    if (cells.length !== headers.length) {
      errors.push({
        row,
        field: 'csv',
        message: `Expected ${headers.length} fields, received ${cells.length}`,
      });
      return;
    }
    const values = Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
    const number = (field: string, integer: boolean) => {
      const value = values[field];
      const valid = integer ? /^(0|[1-9]\d*)$/.test(value) : /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
      if (!valid)
        errors.push({
          row,
          field,
          message: integer ? 'Use a nonnegative integer' : 'Use a positive decimal in metres',
        });
      return valid ? Number(value) : NaN;
    };
    const candidate = {
      sku: values.product_sku,
      name: values.product_name,
      category: values.category,
      currency: values.currency,
      priceMinor: number('price_minor', true),
      dimensions: {
        width: number('width_m', false),
        depth: number('depth_m', false),
        height: number('height_m', false),
      },
      color: values.color,
      material: values.material,
      availability: values.availability,
      stockQuantity: number('stock_quantity', true),
      leadTimeDays: number('lead_time_days', true),
      active: values.active === 'true',
      variants: [],
    };
    if (values.active !== 'true' && values.active !== 'false')
      errors.push({ row, field: 'active', message: 'Use true or false' });
    const productResult = productInputSchema.safeParse(candidate);
    // Strict schemas must receive only their documented fields.
    const variant = variantInputSchema.safeParse({
      sku: values.variant_sku,
      name: values.variant_name,
      priceMinor: candidate.priceMinor,
      dimensions: candidate.dimensions,
      color: candidate.color,
      material: candidate.material,
      availability: candidate.availability,
      stockQuantity: candidate.stockQuantity,
      leadTimeDays: candidate.leadTimeDays,
      active: candidate.active,
    });
    for (const result of [productResult, variant])
      if (!result.success)
        for (const issue of result.error.issues)
          errors.push({ row, field: issue.path.map(String).join('.'), message: issue.message });
    if (!productResult.success || !variant.success) return;
    if (variants.has(variant.data.sku)) {
      errors.push({ row, field: 'variant_sku', message: 'Duplicate variant SKU in this import' });
      return;
    }
    variants.add(variant.data.sku);
    const existing = groups.get(productResult.data.sku);
    if (existing) {
      for (const field of ['name', 'category', 'currency'] as const)
        if (existing[field] !== productResult.data[field])
          errors.push({
            row,
            field: field === 'name' ? 'product_name' : field,
            message: 'Conflicting values for the same product SKU',
          });
      if (existing.variants.length >= 100)
        errors.push({ row, field: 'product_sku', message: 'Maximum 100 variants per product' });
      else existing.variants.push(variant.data);
    } else groups.set(productResult.data.sku, { ...productResult.data, variants: [variant.data] });
  });
  return { products: errors.length ? [] : [...groups.values()], rowCount: rows.length, errors };
}

/** Authoritative integer arithmetic; callers must retrieve current catalogue prices first. */
export function catalogueTotalMinor(
  items: Array<{ priceMinor: number; quantity: number; currency: string }>,
  currency: string,
): number {
  let total = 0n;
  for (const item of items) {
    if (item.currency !== currency) throw new Error('Catalogue currency does not match the project');
    if (
      !Number.isSafeInteger(item.priceMinor) ||
      item.priceMinor < 0 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 0
    )
      throw new Error('Prices and quantities must be nonnegative safe integers');
    total += BigInt(item.priceMinor) * BigInt(item.quantity);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Catalogue total exceeds the safe integer limit');
  return Number(total);
}

/** Parse the retailer's decimal input without binary floating-point rounding. */
export function decimalPriceToMinor(text: string, currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must use three uppercase letters');
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text.trim());
  if (!match || (match[2]?.length ?? 0) > digits)
    throw new Error(`Use a nonnegative decimal with at most ${digits} fractional digits`);
  const total =
    BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] ?? '').padEnd(digits, '0') || '0');
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Price exceeds the safe integer limit');
  return Number(total);
}
