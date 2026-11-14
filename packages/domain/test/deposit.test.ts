import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY as P, baht, bandOf, checkFulfilment, quoteDeposit } from "../src/index.ts";

describe("bandOf", () => {
  it("uses inclusive upper bounds", () => {
    expect(bandOf(baht(3000), P)).toBe("A");
    expect(bandOf(baht(3000.01), P)).toBe("B");
    expect(bandOf(baht(10000), P)).toBe("B");
    expect(bandOf(baht(10001), P)).toBe("C");
  });
});

describe("quoteDeposit — PLAN.md 3.3 worked example (6,000 dress, 900 rent)", () => {
  it("T1 pays 30% = 1,800", () => {
    const q = quoteDeposit({ agreedValue: baht(6000), rent: baht(900), tier: "T1" }, P);
    expect(q).toMatchObject({ band: "B", effectiveTier: "T1", amount: baht(1800) });
  });
  it("T2 who has completed band B pays 20% = 1,200", () => {
    const q = quoteDeposit({ agreedValue: baht(6000), rent: baht(900), tier: "T2", bestCompletedBand: "B" }, P);
    expect(q.amount).toBe(baht(1200));
  });
  it("T2 who has only completed band A pays the T1 rate on band B", () => {
    const q = quoteDeposit({ agreedValue: baht(6000), rent: baht(900), tier: "T2", bestCompletedBand: "A" }, P);
    expect(q).toMatchObject({ effectiveTier: "T1", amount: baht(1800) });
  });
  it("T2 first delivery to a new address is priced at T1", () => {
    const q = quoteDeposit(
      { agreedValue: baht(6000), rent: baht(900), tier: "T2", bestCompletedBand: "C", newDeliveryAddress: true },
      P,
    );
    expect(q.effectiveTier).toBe("T1");
  });
  it("T0 books at the T1 rate", () => {
    expect(quoteDeposit({ agreedValue: baht(6000), rent: baht(900), tier: "T0" }, P).amount).toBe(baht(1800));
  });
});

describe("quoteDeposit — floors, caps and overrides", () => {
  it("never below one rental fee", () => {
    const q = quoteDeposit({ agreedValue: baht(2000), rent: baht(800), tier: "T1" }, P);
    expect(q.amount).toBe(baht(800)); // 30% would be 600
  });
  it("never above the agreed value", () => {
    const q = quoteDeposit({ agreedValue: baht(1000), rent: baht(1500), tier: "T1" }, P);
    expect(q.amount).toBe(baht(1000));
  });
  it("band C brand-name dress at T1 is 50%", () => {
    expect(quoteDeposit({ agreedValue: baht(30000), rent: baht(2500), tier: "T1" }, P).amount).toBe(baht(15000));
  });
  it("under 20 pays 100%", () => {
    const q = quoteDeposit({ agreedValue: baht(6000), rent: baht(900), tier: "T2", bestCompletedBand: "C", age: 19 }, P);
    expect(q).toMatchObject({ effectiveTier: "UNDER_20", amount: baht(6000) });
  });
  it("watchlisted renter pays 100%", () => {
    expect(quoteDeposit({ agreedValue: baht(6000), rent: baht(900), tier: "RESTRICTED" }, P).amount).toBe(baht(6000));
  });
});

describe("checkFulfilment", () => {
  it("band C cannot go by messenger", () => {
    expect(checkFulfilment("MESSENGER", "C", "T1", true, P)).toEqual({ ok: false, reason: "METHOD_NOT_ALLOWED_FOR_BAND" });
  });
  it("parcel is off for every band until a carrier confirms cover", () => {
    for (const b of ["A", "B", "C"] as const) expect(checkFulfilment("PARCEL", b, "T2", true, P).ok).toBe(false);
  });
  it("messenger needs e-KYC; a counter check is not enough", () => {
    expect(checkFulfilment("MESSENGER", "B", "T1", false, P)).toEqual({ ok: false, reason: "NEEDS_EKYC" });
    expect(checkFulfilment("MESSENGER", "B", "T1", true, P)).toEqual({ ok: true });
  });
  it("shop delivery uses the counter-style ID check and needs no e-KYC", () => {
    expect(checkFulfilment("SHOP_DELIVERY", "C", "T1", false, P)).toEqual({ ok: true });
  });
  it("restricted renters are pickup only", () => {
    expect(checkFulfilment("SHOP_DELIVERY", "A", "RESTRICTED", true, P)).toEqual({ ok: false, reason: "RESTRICTED_PICKUP_ONLY" });
  });
});
