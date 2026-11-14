import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  bangkokDateOf,
  bkkDate,
  diffDays,
  fitFacts,
  fitSortKey,
  formatTHB,
  hemPosition,
  overlaps,
} from "../src/index.ts";

describe("Bangkok dates", () => {
  it("an instant after 17:00 UTC is already the next day in Bangkok", () => {
    expect(bangkokDateOf(new Date("2026-12-13T16:59:59Z"))).toBe("2026-12-13");
    expect(bangkokDateOf(new Date("2026-12-13T17:00:00Z"))).toBe("2026-12-14");
  });
  it("rejects impossible dates", () => {
    expect(() => bkkDate("2026-02-30")).toThrow();
    expect(() => bkkDate("14/12/2026")).toThrow();
  });
  it("counts across month and year ends", () => {
    expect(diffDays(bkkDate("2026-12-30"), bkkDate("2027-01-02"))).toBe(3);
  });
  it("adds business days skipping closed weekdays and holidays", () => {
    const cal = { closedWeekdays: [0], closedDates: ["2026-12-31"] };
    // Sat 26 Dec + 2 business days: Sun 27 closed -> Mon 28, Tue 29
    expect(addBusinessDays(bkkDate("2026-12-26"), 2, cal)).toBe("2026-12-29");
    expect(addBusinessDays(bkkDate("2026-12-30"), 1, cal)).toBe("2027-01-01");
  });
  it("half-open ranges touch without overlapping", () => {
    const a = { start: bkkDate("2026-12-01"), end: bkkDate("2026-12-09") };
    expect(overlaps(a, { start: bkkDate("2026-12-09"), end: bkkDate("2026-12-12") })).toBe(false);
    expect(overlaps(a, { start: bkkDate("2026-12-08"), end: bkkDate("2026-12-12") })).toBe(true);
  });
});

describe("fit facts", () => {
  it("reports ease per point, with stretch", () => {
    const f = fitFacts({ heightCm: 158, bustCm: 86, waistCm: 69, hipCm: 94 }, { bustCm: 89, waistCm: 70, hipCm: 102, stretchCm: 2 });
    expect(f.points.map((p) => [p.point, p.easeCm, p.easeWithStretchCm])).toEqual([
      ["bust", 3, 5],
      ["waist", 1, 3],
      ["hip", 8, 10],
    ]);
    expect(fitSortKey(f)).toBe(0);
  });
  it("a garment smaller than the body sorts after ones that fit", () => {
    const tight = fitFacts({ heightCm: 160, waistCm: 74 }, { waistCm: 70 });
    expect(fitSortKey(tight)).toBe(-4);
  });
  it("places the hem: a 125 cm shoulder-to-hem dress on 158 cm with 5 cm heels reaches the ankle", () => {
    expect(hemPosition(158, 125, 5)?.position).toBe("ANKLE");
    expect(hemPosition(158, 135, 0)?.position).toBe("FLOOR");
    expect(hemPosition(165, 90, 0)?.position).toBe("KNEE");
    expect(hemPosition(165, 75, 0)?.position).toBe("ABOVE_KNEE");
  });
});

describe("formatTHB", () => {
  it("formats satang", () => {
    expect(formatTHB(180000)).toBe("฿1,800");
    expect(formatTHB(4767)).toBe("฿47.67");
  });
});
