import type { Satang } from "./money.ts";
import type { Band, Policy, Tier } from "./policy.ts";

/** An open booking of the renter's linked cluster (PLAN.md 3.3: from pending payment until closed). */
export interface OpenExposure {
  agreedValue: Satang;
  deposit: Satang;
  band: Band;
}

export interface ExposureInput {
  tier: Tier;
  /** Open bookings of every account linked to this renter (same ID, phone or bank account). */
  clusterOpen: readonly OpenExposure[];
  candidate: OpenExposure;
  /** Uncovered value currently held by all accounts younger than policy.exposure.newAccountDays. */
  shopNewAccountsUncovered?: Satang;
  accountIsNew?: boolean;
}

export type ExposureDecision =
  | { ok: true; deposit: Satang }
  | { ok: true; deposit: Satang; toppedUp: true; reason: string }
  | { ok: false; reason: "BAND_C_LIMIT" | "SHOP_NEW_ACCOUNT_CAP" };

const uncovered = (e: OpenExposure): Satang => Math.max(0, e.agreedValue - e.deposit);

/**
 * Applies the per-cluster and shop-wide caps. Above the cap the candidate's deposit is
 * raised so that total uncovered value stays within it (up to 100% of the agreed value).
 */
export function checkExposure(input: ExposureInput, policy: Policy): ExposureDecision {
  const { candidate, clusterOpen } = input;
  if (candidate.band === "C") {
    const openC = clusterOpen.filter((e) => e.band === "C").length;
    if (openC >= policy.exposure.maxOpenBandC) return { ok: false, reason: "BAND_C_LIMIT" };
  }

  const cap = input.tier === "T2" ? policy.exposure.capT2 : policy.exposure.capT1;
  const existing = clusterOpen.reduce((sum, e) => sum + uncovered(e), 0);
  const room = Math.max(0, cap - existing);

  let deposit = candidate.deposit;
  let reason: string | null = null;
  if (uncovered(candidate) > room) {
    deposit = Math.min(candidate.agreedValue, candidate.agreedValue - room);
    reason = `deposit raised so open uncovered value stays within ${cap} satang`;
  }

  if (input.accountIsNew) {
    const shopRoom = policy.exposure.shopNewAccounts - (input.shopNewAccountsUncovered ?? 0);
    if (candidate.agreedValue - deposit > Math.max(0, shopRoom)) {
      if (shopRoom <= 0) return { ok: false, reason: "SHOP_NEW_ACCOUNT_CAP" };
      deposit = Math.min(candidate.agreedValue, candidate.agreedValue - shopRoom);
      reason = "deposit raised to stay within the shop-wide cap for new accounts";
    }
  }

  return reason ? { ok: true, deposit, toppedUp: true, reason } : { ok: true, deposit };
}
