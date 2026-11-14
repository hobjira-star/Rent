import { z } from "zod";

/**
 * The versioned policy document (ARCHITECTURE.md section 4, PLAN.md 3.2-3.4).
 * Every number here is a default the owner can change from the rules page.
 * Money values are satang.
 */
const rate = z.number().min(0).max(1);
const satang = z.number().int().min(0);

export const Tier = z.enum(["T0", "T1", "T2", "RESTRICTED"]);
export type Tier = z.infer<typeof Tier>;
export const Band = z.enum(["A", "B", "C"]);
export type Band = z.infer<typeof Band>;
export const Fulfilment = z.enum(["PICKUP", "SHOP_DELIVERY", "MESSENGER", "PARCEL"]);
export type Fulfilment = z.infer<typeof Fulfilment>;
export const Grade = z.enum(["A", "B", "C", "D", "X"]);
export type Grade = z.infer<typeof Grade>;

const bandRates = z.object({ A: rate, B: rate, C: rate });
const bandMethods = z.object({ A: z.array(Fulfilment), B: z.array(Fulfilment), C: z.array(Fulfilment) });

export const PolicySchema = z.object({
  version: z.number().int().min(1),
  bands: z.object({
    /** Upper bound (inclusive) of band A and band B agreed value. Above B is C. */
    maxA: satang,
    maxB: satang,
  }),
  deposit: z.object({
    /** T0 books at the T1 rate and must pass an identity check before hand-over. */
    rates: z.object({ T1: bandRates, T2: bandRates }),
    minMultipleOfRent: z.number().min(0),
    restrictedRate: rate,
    under20Rate: rate,
    ageOfMajority: z.number().int(),
  }),
  exposure: z.object({
    /** Max open uncovered value (agreed value minus deposit) per linked cluster. */
    capT1: satang,
    capT2: satang,
    /** Shop-wide cap for accounts younger than newAccountDays. */
    shopNewAccounts: satang,
    newAccountDays: z.number().int(),
    maxOpenBandC: z.number().int().min(1),
  }),
  fulfilment: z.object({
    /** Allowed hand-over methods per band. Parcel stays off until a carrier confirms cover. */
    allowed: bandMethods,
    /** Delivery methods that need an e-KYC check (counter checks do not count). */
    needsEkyc: z.array(Fulfilment),
  }),
  lateFee: z.object({
    multipleOfDailyRent: z.number().min(0),
    minPerDay: satang,
  }),
  depreciation: z.object({
    perRental: rate,
    floorGoodGrade: rate,
    floorOtherGrade: rate,
  }),
  rental: z.object({ standardDays: z.number().int().min(1) }),
  timers: z.object({
    selfServeHoldMinutes: z.number().int().min(1),
    staffHoldHours: z.number().int().min(1),
    inspectionBusinessDays: z.number().int().min(1),
    refundHours: z.number().int().min(1),
    readyDaysBeforeEvent: z.number().int().min(0),
  }),
  cancellation: z.object({
    /** Ordered from most days ahead; refund share of the rental fee. Deposit is always refunded. */
    tiers: z.array(z.object({ minDaysBefore: z.number().int().min(0), rentRefund: rate })),
    newCustomerRefundDelayDays: z.number().int().min(0),
  }),
  calendar: z.object({
    closedWeekdays: z.array(z.number().int().min(0).max(6)),
    closedDates: z.array(z.string()),
  }),
});
export type Policy = z.infer<typeof PolicySchema>;

const THB = (n: number) => n * 100;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({
  version: 1,
  bands: { maxA: THB(3_000), maxB: THB(10_000) },
  deposit: {
    rates: { T1: { A: 0.3, B: 0.3, C: 0.5 }, T2: { A: 0.2, B: 0.2, C: 0.3 } },
    minMultipleOfRent: 1,
    restrictedRate: 1,
    under20Rate: 1,
    ageOfMajority: 20,
  },
  exposure: {
    capT1: THB(8_000),
    capT2: THB(15_000),
    shopNewAccounts: THB(30_000),
    newAccountDays: 60,
    maxOpenBandC: 1,
  },
  fulfilment: {
    allowed: {
      A: ["PICKUP", "SHOP_DELIVERY", "MESSENGER"],
      B: ["PICKUP", "SHOP_DELIVERY", "MESSENGER"],
      C: ["PICKUP", "SHOP_DELIVERY"],
    },
    needsEkyc: ["MESSENGER", "PARCEL"],
  },
  lateFee: { multipleOfDailyRent: 2, minPerDay: THB(300) },
  depreciation: { perRental: 0.05, floorGoodGrade: 0.6, floorOtherGrade: 0.3 },
  rental: { standardDays: 4 },
  timers: {
    selfServeHoldMinutes: 15,
    staffHoldHours: 24,
    inspectionBusinessDays: 2,
    refundHours: 24,
    readyDaysBeforeEvent: 2,
  },
  cancellation: {
    tiers: [
      { minDaysBefore: 14, rentRefund: 1 },
      { minDaysBefore: 7, rentRefund: 0.5 },
      { minDaysBefore: 0, rentRefund: 0 },
    ],
    newCustomerRefundDelayDays: 7,
  },
  calendar: { closedWeekdays: [], closedDates: [] },
});
