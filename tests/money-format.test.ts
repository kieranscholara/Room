import { describe, expect, it } from 'vitest';
import { decimalPriceToMinor, formatMinorMoney, minorMoneyInput } from '@roomsell/catalogue';
import { formatMoney, moneyInput } from '../apps/web/components/workspace-business-types';

describe('exact supported minor-unit formatting', () => {
  it('retains existing normal EUR output and fixes the maximum boundary cent', () => {
    expect(formatMoney(125000, 'EUR')).toBe('€1,250.00');
    expect(formatMoney(0, 'EUR')).toBe('€0.00');
    expect(formatMoney(Number.MAX_SAFE_INTEGER, 'EUR')).toBe('€90,071,992,547,409.91');
    expect(formatMoney(Number.MAX_SAFE_INTEGER - 1, 'EUR')).toBe('€90,071,992,547,409.90');
    expect(moneyInput(Number.MAX_SAFE_INTEGER, 'EUR')).toBe('90071992547409.91');
  });
  it('formats zero and three-decimal currencies without changing stored units', () => {
    expect(formatMinorMoney(Number.MAX_SAFE_INTEGER, 'JPY')).toBe('JP¥9,007,199,254,740,991');
    expect(formatMinorMoney(Number.MAX_SAFE_INTEGER, 'KWD')).toBe('KWD 9,007,199,254,740.991');
    expect(minorMoneyInput(12345, 'KWD')).toBe('12.345');
    expect(minorMoneyInput(12345, 'JPY')).toBe('12345');
  });
  it('preserves negative fractions and currency/locale sign positioning', () => {
    expect(formatMinorMoney(-1, 'EUR')).toBe('-€0.01');
    expect(formatMinorMoney(-Number.MAX_SAFE_INTEGER, 'EUR')).toBe('-€90,071,992,547,409.91');
    expect(minorMoneyInput(-1, 'EUR')).toBe('-0.01');
    expect(formatMinorMoney(Number.MAX_SAFE_INTEGER, 'EUR', 'de-DE')).toBe('90.071.992.547.409,91 €');
    expect(formatMinorMoney(-29, 'EUR', 'ar-EG')).toBe(
      new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EUR' }).format(-0.29),
    );
    expect(formatMinorMoney(123456789, 'INR', 'en-IN')).toBe('₹12,34,567.89');
  });
  it('round-trips exact positive values across supported precision boundaries', () => {
    for (const currency of ['EUR', 'JPY', 'KWD'])
      for (const minor of [0, 1, 29, 12345, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER])
        expect(decimalPriceToMinor(minorMoneyInput(minor, currency), currency)).toBe(minor);
  });
  it('rejects unsafe or fractional stored amounts before display', () => {
    for (const minor of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatMinorMoney(minor, 'EUR')).toThrow('safe');
      expect(() => minorMoneyInput(minor, 'EUR')).toThrow('safe');
    }
  });
});
