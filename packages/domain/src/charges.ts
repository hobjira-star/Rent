import type { BkkDate } from "./dates.ts";
import { diffDays } from "./dates.ts";
import { applyRate, type Satang } from "./money.ts";
import type { Grade, Policy } from "./policy.ts";

export function lateFeePerDay(rent: Satang, rentalDays: number, policy: Policy): Satang {
  const daily = rent / rentalDays;
  return Math.max(Math.round(daily * policy.lateFee.multipleOfDailyRent), policy.lateFee.minPerDay);
}

/** Days late counted from the due date to the day the late clock stopped (carrier scan or counter). */
export const daysLate = (dueDate: BkkDate, stoppedOn: BkkDate): number => Math.max(0, diffDays(dueDate, stoppedOn));

/** Agreed value less 5% per completed rental, floored by condition grade (PLAN.md 3.3 layer 4). */
export function depreciatedValue(agreedValue: Satang, completedRentals: number, grade: Grade, policy: Policy): Satang {
  const d = policy.depreciation;
  const floor = grade === "A" || grade === "B" ? d.floorGoodGrade : d.floorOtherGrade;
  const factor = Math.max(floor, 1 - d.perRental * completedRentals);
  return applyRate(agreedValue, factor);
}

export interface LiabilityInput {
  agreedValue: Satang;
  completedRentals: number;
  grade: Grade;
  lateFees: Satang;
  damage: Satang;
  /** Value charged for loss or total destruction, before the cap. */
  lossCharge?: Satang;
}

/** Late fees + damage + loss together never exceed the depreciated agreed value. */
export function cappedLiability(input: LiabilityInput, policy: Policy): { total: Satang; cap: Satang; capped: boolean } {
  const cap = depreciatedValue(input.agreedValue, input.completedRentals, input.grade, policy);
  const raw = input.lateFees + input.damage + (input.lossCharge ?? 0);
  return { total: Math.min(raw, cap), cap, capped: raw > cap };
}

/** Rental-fee refund on cancellation. The deposit is always refunded in full. */
export function cancellationRentRefund(rent: Satang, today: BkkDate, pickupDate: BkkDate, policy: Policy): Satang {
  const daysBefore = diffDays(today, pickupDate);
  const tier = policy.cancellation.tiers.find((t) => daysBefore >= t.minDaysBefore);
  return tier ? applyRate(rent, tier.rentRefund) : 0;
}
