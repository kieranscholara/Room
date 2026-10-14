import { describe, expect, it } from 'vitest';
import {
  catalogueTotalMinor,
  CSV_HEADERS,
  decimalPriceToMinor,
  normaliseProductInput,
  parseCatalogueCsv,
  productInputSchema,
} from '@roomsell/catalogue';

const base = {
  sku: 'BED-1',
  name: 'Retail bed',
  category: 'bed',
  currency: 'EUR',
  priceMinor: 125000,
  dimensions: { width: 2, depth: 2.1, height: 0.8 },
  color: '#112233',
  material: 'oak',
  active: true,
  availability: 'in_stock',
  stockQuantity: 3,
  leadTimeDays: 7,
};
const row = [
  'BED-1',
  'BED-OAK',
  'Retail bed',
  'Oak',
  'bed',
  '125000',
  'EUR',
  '2',
  '2.1',
  '0.8',
  '#112233',
  'oak',
  'in_stock',
  '3',
  '7',
  'true',
];
const quote = (text: string) => (/[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
const csv = (...rows: string[][]) =>
  [CSV_HEADERS.join(','), ...rows.map((values) => values.map(quote).join(','))].join('\r\n');

describe('authoritative catalogue schemas and integer prices', () => {
  it('creates an equivalent default variant without invented prices or inventory', () => {
    const product = normaliseProductInput(base);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({
      sku: base.sku,
      name: base.name,
      priceMinor: base.priceMinor,
      dimensions: base.dimensions,
      stockQuantity: base.stockQuantity,
    });
    expect(product.variants[0]).not.toHaveProperty('category');
    expect(product.variants[0]).not.toHaveProperty('currency');
  });
  it('rejects unknown input fields, unsafe minor amounts and duplicate variant SKUs', () => {
    expect(productInputSchema.safeParse({ ...base, organisationId: 'foreign' }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, priceMinor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(
      false,
    );
    const variant = normaliseProductInput(base).variants[0];
    expect(productInputSchema.safeParse({ ...base, variants: [variant, variant] }).success).toBe(false);
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      productInputSchema.safeParse({
        ...base,
        variants: [
          { ...variant, id },
          { ...variant, sku: 'SECOND', id },
        ],
      }).success,
    ).toBe(false);
  });
  it('uses currency precision and exact decimal conversion without rounding overprecision', () => {
    expect(decimalPriceToMinor('0.29', 'EUR')).toBe(29);
    expect(decimalPriceToMinor('1250', 'JPY')).toBe(1250);
    expect(decimalPriceToMinor('12.345', 'KWD')).toBe(12345);
    expect(() => decimalPriceToMinor('1.005', 'EUR')).toThrow('fractional');
    expect(() => decimalPriceToMinor('1e3', 'EUR')).toThrow('decimal');
    expect(() => decimalPriceToMinor('90071992547410', 'EUR')).toThrow('safe');
  });
  it('computes integer totals while rejecting mixed currency and overflow', () => {
    expect(catalogueTotalMinor([{ priceMinor: 29, quantity: 3, currency: 'EUR' }], 'EUR')).toBe(87);
    expect(() => catalogueTotalMinor([{ priceMinor: 2, quantity: 1, currency: 'USD' }], 'EUR')).toThrow(
      'currency',
    );
    expect(() =>
      catalogueTotalMinor([{ priceMinor: Number.MAX_SAFE_INTEGER, quantity: 2, currency: 'EUR' }], 'EUR'),
    ).toThrow('safe');
  });
});

describe('bounded atomic RFC 4180 catalogue imports', () => {
  it('parses quotes, commas, embedded newlines, BOM and a reordered header', () => {
    const values = [...row];
    values[2] = 'Retail "premium", bed\nseries';
    const original = csv(values);
    const result = parseCatalogueCsv(`\ufeff${original}`);
    expect(result.errors).toEqual([]);
    expect(result.products[0].name).toBe(values[2]);
    const reverse = [...CSV_HEADERS].reverse();
    const reordered = `${reverse.join(',')}\n${[...row].reverse().join(',')}`;
    expect(parseCatalogueCsv(reordered).products[0].sku).toBe('BED-1');
  });
  it('groups real variants and retains their different prices, dimensions and stock', () => {
    const second = [...row];
    second[1] = 'BED-BLUE';
    second[3] = 'Blue';
    second[5] = '95000';
    second[7] = '1.8';
    second[13] = '2';
    const result = parseCatalogueCsv(csv(row, second));
    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].variants[1]).toMatchObject({
      sku: 'BED-BLUE',
      priceMinor: 95000,
      dimensions: { width: 1.8 },
      stockQuantity: 2,
    });
  });
  it('returns row errors and no partially valid products', () => {
    const bad = [...row];
    bad[0] = 'BED-2';
    bad[1] = 'BED-2-V';
    bad[5] = '-1';
    const result = parseCatalogueCsv(csv(row, bad));
    expect(result.products).toEqual([]);
    expect(result.rowCount).toBe(2);
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 3, field: 'price_minor' }));
  });
  it('rejects duplicate global variant SKUs and conflicting product fields', () => {
    expect(parseCatalogueCsv(csv(row, row)).errors).toContainEqual(
      expect.objectContaining({ field: 'variant_sku' }),
    );
    const conflict = [...row];
    conflict[1] = 'SECOND';
    conflict[2] = 'Another bed';
    expect(parseCatalogueCsv(csv(row, conflict)).errors).toContainEqual(
      expect.objectContaining({ field: 'product_name' }),
    );
  });
  it('rejects malformed quoting and unexpected or duplicate headers', () => {
    expect(parseCatalogueCsv(`${CSV_HEADERS.join(',')}\n"unterminated`).errors[0].message).toContain(
      'Unterminated',
    );
    expect(parseCatalogueCsv(csv(row).replace('Retail bed', 'Retail"bed')).errors[0].message).toContain(
      'Unexpected quote',
    );
    expect(parseCatalogueCsv(csv(row).replace('price_minor', 'price')).errors[0].message).toContain(
      'headers',
    );
    expect(parseCatalogueCsv(csv(row).replace('variant_sku', 'product_sku')).errors[0].message).toContain(
      'headers',
    );
  });
  it('rejects guessed booleans, scientific numeric notation, blanks and invalid dimensions', () => {
    for (const [column, value] of [
      [15, 'yes'],
      [5, '1e3'],
      [7, ''],
      [9, '0'],
      [13, '1.2'],
    ] as const) {
      const bad = [...row];
      bad[column] = value;
      expect(parseCatalogueCsv(csv(bad)).products).toEqual([]);
      expect(parseCatalogueCsv(csv(bad)).errors.length).toBeGreaterThan(0);
    }
  });
  it('enforces valid UTF-8, 1MiB, 500 rows and 100 variants per product', () => {
    expect(parseCatalogueCsv(Uint8Array.from([0xff])).errors[0].message).toContain('UTF-8');
    expect(parseCatalogueCsv('x'.repeat(1024 * 1024 + 1)).errors[0].message).toContain('1 MiB');
    const rows = Array.from({ length: 501 }, (_, index) => {
      const values = [...row];
      values[0] = `P-${index}`;
      values[1] = `V-${index}`;
      return values;
    });
    expect(parseCatalogueCsv(csv(...rows)).errors[0].message).toContain('500');
    const variants = rows.slice(0, 101).map((values) => {
      values[0] = 'ONE';
      return values;
    });
    expect(
      parseCatalogueCsv(csv(...variants)).errors.some((issue) => issue.message.includes('100 variants')),
    ).toBe(true);
  });
});
