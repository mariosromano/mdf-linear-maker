export const PRICE_PER_SQFT = 35;

export interface Pricing {
  areaSqft: number;
  totalPrice: number;
}

export function calculatePricing(wallW: number, wallH: number): Pricing {
  const areaSqft = wallW * wallH;
  return { areaSqft, totalPrice: areaSqft * PRICE_PER_SQFT };
}

export function fmtPrice(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
