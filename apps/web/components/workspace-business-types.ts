import { decimalPriceToMinor, formatMinorMoney, minorMoneyInput } from '@roomsell/catalogue';
export type {
  CatalogueCategory as Category,
  CatalogueAvailability as Availability,
  ProductVariantView as ProductVariant,
  CatalogueAsset as ProductAsset,
  CatalogueProductView as CatalogueProduct,
} from '@roomsell/catalogue';
export interface CustomerRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string;
}
export interface ProjectRecord {
  id: string;
  organisationId: string;
  customerId: string | null;
  name: string;
  budgetMinor: number;
  currency: string;
  style: string;
  roomType: string;
  status: string;
  createdAt: string;
}
export function formatMoney(minor: number, currency: string) {
  return formatMinorMoney(minor, currency);
}
export function parseMoney(value: string, currency: string): number {
  return decimalPriceToMinor(value, currency);
}
export function moneyInput(minor: number, currency: string) {
  return minorMoneyInput(minor, currency);
}
