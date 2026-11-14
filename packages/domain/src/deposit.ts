import { applyRate, assertSatang, type Satang } from "./money.ts";
import type { Band, Fulfilment, Policy, Tier } from "./policy.ts";

export function bandOf(agreedValue: Satang, policy: Policy): Band {
  assertSatang(agreedValue, "agreedValue");
  if (agreedValue <= policy.bands.maxA) return "A";
  if (agreedValue <= policy.bands.maxB) return "B";
  return "C";
}

const BAND_ORDER: Record<Band, number> = { A: 0, B: 1, C: 2 };

export interface DepositInput {
  agreedValue: Satang;
  rent: Satang;
  tier: Tier;
  /** Highest band this renter has rented and returned cleanly; T2 benefits stop above it. */
  bestCompletedBand?: Band | null;
  /** Age from the date of birth the renter entered (checked against the ID later). */
  age?: number | null;
  /** True when the delivery address has never been used by this renter. */
  newDeliveryAddress?: boolean;
}

export interface DepositQuote {
  band: Band;
  /** Tier whose rate was applied after all downgrades. */
  effectiveTier: "T1" | "T2" | "RESTRICTED" | "UNDER_20";
  rate: number;
  amount: Satang;
  /** Human-readable reasons for any downgrade, for staff and audit. */
  reasons: string[];
}

/**
 * Deposit = agreed value x rate, never below minMultipleOfRent x rent, never above
 * the agreed value (PLAN.md 3.3 layer 2).
 */
export function quoteDeposit(input: DepositInput, policy: Policy): DepositQuote {
  const { agreedValue, rent, tier } = input;
  assertSatang(rent, "rent");
  const band = bandOf(agreedValue, policy);
  const reasons: string[] = [];

  let effectiveTier: DepositQuote["effectiveTier"];
  let rate: number;

  if (tier === "RESTRICTED") {
    effectiveTier = "RESTRICTED";
    rate = policy.deposit.restrictedRate;
    reasons.push("renter is on the internal watchlist");
  } else if (input.age != null && input.age < policy.deposit.ageOfMajority) {
    effectiveTier = "UNDER_20";
    rate = policy.deposit.under20Rate;
    reasons.push(`renter is under ${policy.deposit.ageOfMajority}`);
  } else {
    let t: "T1" | "T2" = tier === "T2" ? "T2" : "T1";
    if (tier === "T0") reasons.push("new renter books at the T1 rate and must pass an identity check at hand-over");
    if (t === "T2") {
      const best = input.bestCompletedBand;
      if (best == null || BAND_ORDER[band] > BAND_ORDER[best]) {
        t = "T1";
        reasons.push(`T2 rate applies only up to band ${best ?? "(none)"} completed before`);
      } else if (input.newDeliveryAddress) {
        t = "T1";
        reasons.push("first delivery to a new address is priced at T1");
      }
    }
    effectiveTier = t;
    rate = policy.deposit.rates[t][band];
  }

  const byRate = applyRate(agreedValue, rate);
  const floor = Math.round(rent * policy.deposit.minMultipleOfRent);
  let amount = Math.max(byRate, floor);
  if (amount > agreedValue) amount = agreedValue;
  if (floor > byRate && amount === floor) reasons.push("raised to the minimum of one rental fee");
  return { band, effectiveTier, rate, amount, reasons };
}

export type FulfilmentCheck =
  | { ok: true }
  | { ok: false; reason: "METHOD_NOT_ALLOWED_FOR_BAND" | "NEEDS_EKYC" | "RESTRICTED_PICKUP_ONLY" };

export function checkFulfilment(
  method: Fulfilment,
  band: Band,
  tier: Tier,
  hasEkyc: boolean,
  policy: Policy,
): FulfilmentCheck {
  if (tier === "RESTRICTED" && method !== "PICKUP") return { ok: false, reason: "RESTRICTED_PICKUP_ONLY" };
  if (!policy.fulfilment.allowed[band].includes(method)) return { ok: false, reason: "METHOD_NOT_ALLOWED_FOR_BAND" };
  if (policy.fulfilment.needsEkyc.includes(method) && !hasEkyc) return { ok: false, reason: "NEEDS_EKYC" };
  return { ok: true };
}
