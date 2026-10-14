import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { formatMinorMoney } from '@roomsell/catalogue';
import { priceQuotation, quotationPricingSchema, type PricingPolicy } from '@roomsell/pricing';
import {
  quotationIssueSchema,
  quotationSnapshotSchema,
  type IssuedQuotation,
} from '../apps/web/lib/quotation-schemas';
import { renderQuotationPdf } from '../apps/web/lib/quotation-pdf';

function fixture(): IssuedQuotation {
  const organisationId = randomUUID();
  const projectId = randomUUID();
  const sceneId = randomUUID();
  const variantId = randomUUID();
  const policy: PricingPolicy = {
    version: 1,
    currency: 'EUR',
    taxMode: 'exclusive',
    taxRateBps: 1800,
    rounding: 'invoice',
    discountBps: 500,
    deliveryMinor: 1500,
    installationMinor: 700,
    feesTaxable: true,
  };
  const item = {
    variantId,
    productId: randomUUID(),
    objectIds: [randomUUID()],
    sku: 'REAL-TEST-SKU',
    name: 'Measured oak bedside',
    variantName: 'Natural oak',
    category: 'bedside' as const,
    quantity: 1,
    unitPriceMinor: 19995,
    currency: 'EUR',
    dimensions: { width: 0.5, depth: 0.5, height: 1 },
    color: '#112233',
    material: 'Oak',
    availability: 'in_stock' as const,
    stockQuantity: 3,
    leadTimeDays: 7,
    variantUpdatedAt: '2026-10-14T00:00:00Z',
    productUpdatedAt: '2026-10-14T00:00:00Z',
  };
  const calculation = quotationPricingSchema.parse(
    priceQuotation({
      policy,
      items: [
        {
          variantId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          currency: 'EUR',
        },
      ],
    }),
  );
  return {
    id: randomUUID(),
    organisationId,
    projectId,
    sceneId,
    sceneVersion: 3,
    policyRevision: 2,
    number: `RS-${randomUUID().toUpperCase()}`,
    issuedAt: '2026-10-14T12:00:00Z',
    snapshot: {
      version: 1,
      inventoryReserved: false,
      calculation,
      source: {
        version: 1,
        retailer: { id: organisationId, name: 'Real retailer test fixture', currency: 'EUR' },
        project: {
          id: projectId,
          name: 'Measured room',
          currency: 'EUR',
          budgetMinor: 50000,
          customerId: null,
        },
        customer: null,
        sceneId,
        sceneVersion: 3,
        policyRevision: 2,
        policy,
        items: [item],
      },
    },
  };
}

describe('immutable quotation contract and PDF', () => {
  it('validates the stored policy maths and binds source SKU, price and aggregate object count', () => {
    const quote = fixture();
    expect(quotationSnapshotSchema.safeParse(quote.snapshot).success).toBe(true);
    for (const change of [
      (value: IssuedQuotation['snapshot']) => {
        value.source.items[0].sku = 'FORGED';
      },
      (value: IssuedQuotation['snapshot']) => {
        value.source.items[0].unitPriceMinor++;
      },
      (value: IssuedQuotation['snapshot']) => {
        value.source.items[0].objectIds.push('extra');
      },
      (value: IssuedQuotation['snapshot']) => {
        value.source.items[0].stockQuantity = 0;
      },
      (value: IssuedQuotation['snapshot']) => {
        value.source.policy.taxRateBps++;
      },
    ]) {
      const value = structuredClone(quote.snapshot);
      change(value);
      expect(quotationSnapshotSchema.safeParse(value).success).toBe(false);
    }
    const invalid = structuredClone(quote.snapshot);
    invalid.calculation.totals.grandTotalMinor++;
    expect(quotationSnapshotSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires the reviewed source fingerprint and excludes client prices from issuance', () => {
    const request = {
      expectedSceneVersion: 3,
      expectedPolicyRevision: 2,
      idempotencyKey: randomUUID(),
      expectedSourceFingerprint: 'a'.repeat(64),
    };
    expect(quotationIssueSchema.safeParse(request).success).toBe(true);
    expect(quotationIssueSchema.safeParse({ ...request, expectedSourceFingerprint: undefined }).success).toBe(
      false,
    );
    expect(
      quotationIssueSchema.safeParse({ ...request, calculation: fixture().snapshot.calculation }).success,
    ).toBe(false);
  });
  it('writes a real PDF with the immutable exact grand total and a usable Unicode fallback', async () => {
    const quote = fixture();
    quote.snapshot.source.retailer.name = 'Oak 家具 🛏 <script>alert(1)</script>';
    const bytes = await renderQuotationPdf(quote);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const document = await PDFDocument.load(bytes);
    expect(document.getTitle()).toBe(`RoomSell quotation ${quote.number}`);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const grandTotalHex = Buffer.from(
      font.encodeText(formatMinorMoney(quote.snapshot.calculation.totals.grandTotalMinor, 'EUR')).asBytes(),
    ).toString('hex');
    const decoded: string[] = [];
    for (const page of document.getPages()) {
      const contents = page.node.Contents();
      const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      for (const reference of streams) {
        const stream = document.context.lookup(reference);
        if (stream instanceof PDFRawStream) {
          const content =
            stream.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode'
              ? inflateSync(stream.contents)
              : stream.contents;
          decoded.push(Buffer.from(content).toString('latin1').toLowerCase());
        }
      }
    }
    expect(decoded.join('\n')).toContain(grandTotalHex);
  });
});
