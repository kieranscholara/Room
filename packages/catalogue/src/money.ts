function safeMinor(minor: number) {
  if (!Number.isSafeInteger(minor)) throw new Error('Minor amount must be a safe integer');
}
export function currencyFractionDigits(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must use three uppercase letters');
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** Decimal text remains exact at every safe integer value, including negative amounts. */
export function minorMoneyInput(minor: number, currency: string) {
  safeMinor(minor);
  const digits = currencyFractionDigits(currency);
  const value = BigInt(minor);
  const magnitude = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(digits);
  return `${value < 0n ? '-' : ''}${magnitude / divisor}${digits ? `.${String(magnitude % divisor).padStart(digits, '0')}` : ''}`;
}

/**
 * Intl formats the exact BigInt whole units. Only its fraction part is replaced, so
 * locale grouping, currency placement, bidi literals and minus signs are retained.
 * This uses ES2020 BigInt support already required by the application's ES2022 target.
 */
export function formatMinorMoney(minor: number, currency: string, locale: string | string[] = 'en-GB') {
  safeMinor(minor);
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10n ** BigInt(digits);
  const value = BigInt(minor);
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / divisor;
  const signedWhole = value < 0n ? (whole === 0n ? -0 : -whole) : whole;
  const fraction = String(magnitude % divisor).padStart(digits, '0');
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const localDigits = Array.from({ length: 10 }, (_, index) =>
    digitFormatter
      .formatToParts(index)
      .filter((part) => part.type === 'integer')
      .map((part) => part.value)
      .join(''),
  );
  return formatter
    .formatToParts(signedWhole)
    .map((part) =>
      part.type === 'fraction'
        ? [...fraction].map((digit) => localDigits[Number(digit)]).join('')
        : part.value,
    )
    .join('');
}

/** Known totals are checked even when another selected item has an unknown price. */
export function nullableCatalogueTotalMinor(
  items: Array<{ priceMinor: number | null; quantity: number; currency: string }>,
  currency: string,
): number | null {
  let total = 0n;
  let unknown = false;
  for (const item of items) {
    if (item.currency !== currency) throw new Error('Catalogue currency does not match the project');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 0)
      throw new Error('Prices and quantities must be nonnegative safe integers');
    if (item.priceMinor === null) {
      unknown = true;
      continue;
    }
    if (!Number.isSafeInteger(item.priceMinor) || item.priceMinor < 0)
      throw new Error('Prices and quantities must be nonnegative safe integers');
    total += BigInt(item.priceMinor) * BigInt(item.quantity);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Catalogue total exceeds the safe integer limit');
  return unknown ? null : Number(total);
}
