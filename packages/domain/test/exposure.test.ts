import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY as P, baht, checkExposure } from "../src/index.ts";

const B = (value: number, deposit: number) => ({ agreedValue: baht(value), deposit: baht(deposit), band: "B" as const });
const C = (value: number, deposit: number) => ({ agreedValue: baht(value), deposit: baht(deposit), band: "C" as const });

describe("checkExposure", () => {
  it("a single garment at the top of band B fits under the T1 cap", () => {
    expect(checkExposure({ tier: "T1", clusterOpen: [], candidate: B(10000, 3000) }, P)).toEqual({ ok: true, deposit: baht(3000) });
  });
  it("a single 15,000 band C dress fits under the T1 cap (7,500 uncovered)", () => {
    expect(checkExposure({ tier: "T1", clusterOpen: [], candidate: C(15000, 7500) }, P).ok).toBe(true);
  });
  it("a second dress tops the deposit up so the cluster stays within 8,000", () => {
    const d = checkExposure({ tier: "T1", clusterOpen: [B(6000, 1800)], candidate: B(6000, 1800) }, P);
    // existing uncovered 4,200, room 3,800 -> deposit 6,000 - 3,800 = 2,200
    expect(d).toMatchObject({ ok: true, deposit: baht(2200), toppedUp: true });
  });
  it("when the cap is used up the new garment needs 100%", () => {
    const d = checkExposure({ tier: "T1", clusterOpen: [C(15000, 7500)], candidate: B(6000, 1800) }, P);
    expect(d).toMatchObject({ ok: true, deposit: baht(5500) }); // room 500
    const d2 = checkExposure({ tier: "T1", clusterOpen: [B(10000, 2000)], candidate: B(6000, 1800) }, P);
    expect(d2).toMatchObject({ ok: true, deposit: baht(6000) }); // room 0
  });
  it("only one open band C per cluster, at every tier", () => {
    for (const tier of ["T0", "T1", "T2"] as const) {
      expect(checkExposure({ tier, clusterOpen: [C(12000, 3600)], candidate: C(11000, 3300) }, P)).toEqual({
        ok: false,
        reason: "BAND_C_LIMIT",
      });
    }
  });
  it("T2 gets the larger cap", () => {
    const d = checkExposure({ tier: "T2", clusterOpen: [B(6000, 1200)], candidate: B(6000, 1200) }, P);
    expect(d).toEqual({ ok: true, deposit: baht(1200) }); // 9,600 uncovered < 15,000
  });
  it("shop-wide cap for new accounts tops up, then refuses when exhausted", () => {
    const near = checkExposure(
      { tier: "T1", clusterOpen: [], candidate: B(6000, 1800), accountIsNew: true, shopNewAccountsUncovered: baht(28000) },
      P,
    );
    expect(near).toMatchObject({ ok: true, deposit: baht(4000) });
    const full = checkExposure(
      { tier: "T1", clusterOpen: [], candidate: B(6000, 1800), accountIsNew: true, shopNewAccountsUncovered: baht(30000) },
      P,
    );
    expect(full).toEqual({ ok: false, reason: "SHOP_NEW_ACCOUNT_CAP" });
  });
});
