import { describe, expect, it } from "vitest";
import { BOOKING_EVENTS, BOOKING_STATES, TRANSITIONS, canReleaseDeposit, transition, type GuardContext } from "../src/index.ts";

const ALL: GuardContext = {
  blockActive: true,
  depositHeld: true,
  contractAccepted: true,
  withinExposureCap: true,
  checkoutInspectionComplete: true,
  identityVerified: true,
  flagsCleared: true,
  ownerApproved: true,
  returnGatePassed: true,
  depositFinal: true,
  noOpenClaims: true,
  journalBalanced: true,
};

describe("booking transition table", () => {
  it("every (state, event) pair is either a rule or INVALID_TRANSITION", () => {
    for (const s of BOOKING_STATES)
      for (const e of BOOKING_EVENTS) {
        const r = transition(s, e, ALL);
        const rule = TRANSITIONS[s]?.[e];
        if (rule) expect(r).toMatchObject({ ok: true, to: rule.to });
        else expect(r).toEqual({ ok: false, error: "INVALID_TRANSITION" });
      }
  });
  it("CLOSED and CANCELLED are terminal", () => {
    for (const e of BOOKING_EVENTS) {
      expect(transition("CLOSED", e, ALL).ok).toBe(false);
      expect(transition("CANCELLED", e, ALL).ok).toBe(false);
    }
  });
  it("payment cannot confirm a booking whose hold was taken over", () => {
    expect(transition("PENDING_PAYMENT", "PAYMENT_CONFIRMED", { ...ALL, blockActive: false })).toMatchObject({
      ok: false,
      missing: ["blockActive"],
    });
  });
  it("hand-over needs inspection, identity, cleared flags and the cap re-check", () => {
    const r = transition("CONFIRMED", "HAND_OVER", { checkoutInspectionComplete: true });
    expect(r).toMatchObject({ ok: false, missing: ["identityVerified", "flagsCleared", "withinExposureCap"] });
  });
  it("D+7 non-return is refused when the carrier already scanned the return", () => {
    expect(transition("HANDED_OVER", "NON_RETURN_CONFIRMED", { carrierReturnScan: true })).toMatchObject({
      ok: false,
      violated: ["carrierReturnScan"],
    });
    expect(transition("HANDED_OVER", "NON_RETURN_CONFIRMED", {}).ok).toBe(true);
  });
  it("a failed return gate leads to NON_RETURN, never to CLOSED", () => {
    expect(transition("RETURNED", "RETURN_GATE_FAILED", { ownerApproved: true })).toMatchObject({ ok: true, to: "NON_RETURN" });
    expect(transition("RETURNED", "CLOSE", { ...ALL, returnGatePassed: false }).ok).toBe(false);
  });
  it("an identity failure refunds in full, unlike an ordinary cancellation", () => {
    const r = transition("CONFIRMED", "ID_CHECK_FAILED");
    expect(r.ok && r.effect).toMatch(/full refund/);
  });
});

describe("deposit release", () => {
  it("needs the return gate to have passed", () => {
    expect(canReleaseDeposit({ returnGatePassed: false })).toBe(false);
    expect(canReleaseDeposit({ returnGatePassed: true })).toBe(true);
  });
});
