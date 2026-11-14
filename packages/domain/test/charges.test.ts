import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY as P,
  baht,
  bkkDate,
  cancellationRentRefund,
  cappedLiability,
  daysLate,
  depreciatedValue,
  lateFeePerDay,
} from "../src/index.ts";

describe("late fee", () => {
  it("is twice the daily rent: 900 / 4 days -> 450 per day (PLAN.md example)", () => {
    expect(lateFeePerDay(baht(900), 4, P)).toBe(baht(450));
  });
  it("is at least 300 per day", () => {
    expect(lateFeePerDay(baht(500), 4, P)).toBe(baht(300));
  });
  it("counts days from the due date to the day the clock stopped", () => {
    expect(daysLate(bkkDate("2026-12-14"), bkkDate("2026-12-14"))).toBe(0);
    expect(daysLate(bkkDate("2026-12-14"), bkkDate("2026-12-17"))).toBe(3);
    expect(daysLate(bkkDate("2026-12-14"), bkkDate("2026-12-12"))).toBe(0);
  });
});

describe("depreciation", () => {
  it("drops 5% per rental", () => {
    expect(depreciatedValue(baht(6000), 2, "A", P)).toBe(baht(5400));
  });
  it("never below 60% for grade A/B and 30% for C/D", () => {
    expect(depreciatedValue(baht(6000), 14, "A", P)).toBe(baht(3600));
    expect(depreciatedValue(baht(6000), 14, "C", P)).toBe(baht(1800));
  });
});

describe("liability cap", () => {
  it("late fees, damage and loss together never exceed the depreciated value", () => {
    const r = cappedLiability({ agreedValue: baht(6000), completedRentals: 2, grade: "A", lateFees: baht(3150), damage: baht(3000) }, P);
    expect(r).toEqual({ total: baht(5400), cap: baht(5400), capped: true });
  });
});

describe("cancellation", () => {
  const pickup = bkkDate("2026-12-31");
  it("follows the 14 / 7 day tiers", () => {
    expect(cancellationRentRefund(baht(900), bkkDate("2026-12-17"), pickup, P)).toBe(baht(900));
    expect(cancellationRentRefund(baht(900), bkkDate("2026-12-24"), pickup, P)).toBe(baht(450));
    expect(cancellationRentRefund(baht(900), bkkDate("2026-12-25"), pickup, P)).toBe(0);
  });
});
