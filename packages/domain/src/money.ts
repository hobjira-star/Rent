/** Money is always an integer number of satang (1 baht = 100 satang). */
export type Satang = number;

export const baht = (amount: number): Satang => Math.round(amount * 100);

export function assertSatang(value: number, label = "amount"): asserts value is Satang {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of satang, got ${value}`);
  }
}

/** Multiply by a rate and round to the nearest satang (half up). */
export const applyRate = (amount: Satang, rate: number): Satang => Math.round(amount * rate);

export function formatTHB(amount: Satang): string {
  const b = amount / 100;
  return `฿${b.toLocaleString("en-US", { minimumFractionDigits: b % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}
