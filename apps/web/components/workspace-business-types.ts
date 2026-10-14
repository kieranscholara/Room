import type { SceneObject } from '@roomsell/scene-core';
import { decimalPriceToMinor } from '@roomsell/catalogue';
export type Category = SceneObject['category'];
export type Availability = 'in_stock' | 'made_to_order' | 'out_of_stock';
export interface ProductVariant {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  dimensions: SceneObject['dimensions'];
  color: string;
  material: string;
  active: boolean;
  availability: Availability;
  stockQuantity: number;
  leadTimeDays: number;
}
export interface ProductAsset {
  id: string;
  kind: 'image' | 'model';
  mimeType: string;
  sizeBytes: number;
  url?: string | null;
}
export interface CatalogueProduct extends Omit<ProductVariant, 'id'> {
  id: string;
  organisationId: string;
  category: Category;
  currency: string;
  variants: ProductVariant[];
  assets: ProductAsset[];
}
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
  const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}
export function parseMoney(value: string, currency: string): number {
  return decimalPriceToMinor(value, currency);
}
export function moneyInput(minor: number, currency: string) {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10n ** BigInt(digits);
  const value = BigInt(minor);
  return `${value / divisor}${digits ? `.${String(value % divisor).padStart(digits, '0')}` : ''}`;
}
