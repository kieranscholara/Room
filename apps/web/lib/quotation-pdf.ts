import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatMinorMoney } from '@roomsell/catalogue';
import type { IssuedQuotation } from './quotation-schemas';

/** Render only a verified immutable snapshot; no catalogue lookup or repricing. */
export async function renderQuotationPdf(quote: IssuedQuotation): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`RoomSell quotation ${quote.number}`);
  document.setAuthor(quote.snapshot.source.retailer.name);
  document.setSubject('Issued retailer quotation; inventory is not reserved');
  const issuedAt = new Date(quote.issuedAt);
  document.setCreationDate(issuedAt);
  const { source, calculation } = quote.snapshot;
  let page = document.addPage([595.28, 841.89]);
  let y = 790;
  let unsupported = false;

  // Standard PDF fonts have a finite character set. Keep the document usable
  // without guessing a replacement name, and explicitly flag changed glyphs.
  function printable(value: string) {
    return [...value.replace(/[\r\n\t]/g, ' ')]
      .map((character) => {
        try {
          font.encodeText(character);
          return character;
        } catch {
          unsupported = true;
          return '?';
        }
      })
      .join('');
  }
  function draw(value: string, size = 10, strong = false) {
    const selected = strong ? bold : font;
    const text = printable(value);
    const words = text.split(' ');
    let line = '';
    const lines: string[] = [];
    for (const word of words) {
      if (selected.widthOfTextAtSize(`${line}${line ? ' ' : ''}${word}`, size) <= 495) {
        line += `${line ? ' ' : ''}${word}`;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (selected.widthOfTextAtSize(line + character, size) > 495) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    for (const content of lines) {
      if (y < 65) {
        page = document.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(content, { x: 50, y, size, font: selected, color: rgb(0.1, 0.13, 0.2) });
      y -= size + 6;
    }
  }
  const money = (minor: number) => formatMinorMoney(minor, source.policy.currency, 'en-GB');
  const percent = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`;
  draw(source.retailer.name, 20, true);
  draw('Retailer quotation', 15, true);
  draw(quote.number);
  draw(
    `Issued: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Malta' }).format(issuedAt)} (Europe/Malta)`,
  );
  draw(`Project: ${source.project.name}`);
  if (source.customer) {
    draw(`Customer: ${source.customer.name}`);
    if (source.customer.email) draw(`Email: ${source.customer.email}`);
    if (source.customer.phone) draw(`Phone: ${source.customer.phone}`);
  }
  draw(`Scene revision ${source.sceneVersion}; pricing policy revision ${source.policyRevision}`);
  y -= 12;
  draw('Furniture', 13, true);
  for (const line of calculation.lines) {
    const item = source.items.find((candidate) => candidate.variantId === line.variantId)!;
    draw(`${line.quantity} x ${line.name} — ${item.variantName}`, 11, true);
    draw(
      `SKU: ${line.sku}; unit listed price: ${money(line.unitPriceMinor)}; listed subtotal: ${money(line.subtotalMinor)}`,
    );
    draw(
      `Discount: ${money(line.discountMinor)}; net: ${money(line.netMinor)}; tax: ${money(line.taxMinor)}; line total: ${money(line.totalMinor)}`,
    );
    draw(
      `Dimensions in metres (width x depth x height): ${item.dimensions.width} x ${item.dimensions.depth} x ${item.dimensions.height}`,
    );
    draw(
      `Variant: ${item.variantId}; availability at issue: ${item.availability}; lead time: ${item.leadTimeDays} days`,
      8,
    );
    y -= 8;
  }
  draw('Totals', 13, true);
  draw(`Listed merchandise subtotal: ${money(calculation.totals.subtotalMinor)}`);
  draw(`Merchandise discount: ${money(calculation.totals.discountMinor)}`);
  draw(`Delivery (charged): ${money(calculation.totals.deliveryMinor)}`);
  draw(`Installation (charged): ${money(calculation.totals.installationMinor)}`);
  draw(`Net total: ${money(calculation.totals.netMinor)}`);
  draw(`Tax total: ${money(calculation.totals.taxMinor)}`);
  draw(`Grand total: ${money(calculation.totals.grandTotalMinor)}`, 15, true);
  y -= 10;
  draw(
    `Retailer policy: listed prices are tax ${source.policy.taxMode}; tax ${percent(source.policy.taxRateBps)}; merchandise discount ${percent(source.policy.discountBps)}; ${source.policy.rounding} rounding.`,
  );
  draw(
    `Delivery and installation are ${source.policy.feesTaxable ? 'taxable' : 'not taxable'}. Currency: ${source.policy.currency}.`,
  );
  draw(
    'Prices and product details are the immutable snapshot issued above. Availability was checked at issuance. This quotation does not reserve stock or create an order.',
  );
  draw(
    'No expiry, delivery commitment or jurisdiction-specific legal terms have been inferred. The retailer remains responsible for its configured tax and commercial policy.',
    9,
  );
  if (unsupported)
    draw(
      'Some characters are shown as ? because the embedded PDF font cannot display them. The complete original text is retained in the application quotation.',
      9,
    );
  const pages = document.getPages();
  pages.forEach((printed, index) =>
    printed.drawText(`RoomSell | ${index + 1} / ${pages.length}`, {
      x: 50,
      y: 35,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    }),
  );
  return document.save();
}
