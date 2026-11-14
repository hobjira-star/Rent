/**
 * Booking state machine (ARCHITECTURE.md section 7). Only event-driven states are stored;
 * "due" and "overdue" are computed from due_at. The table is data so every
 * (state, event) pair can be tested.
 */
export const BOOKING_STATES = [
  "PENDING_PAYMENT",
  "EXPIRED",
  "CONFIRMED",
  "HANDED_OVER",
  "RETURNED",
  "NON_RETURN",
  "CANCELLED",
  "CLOSED",
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export const BOOKING_EVENTS = [
  "PAYMENT_CONFIRMED",
  "HOLD_EXPIRED",
  "LATE_PAYMENT_REACQUIRED",
  "LATE_PAYMENT_UNAVAILABLE",
  "CANCEL",
  "ID_CHECK_FAILED",
  "NO_SHOW",
  "HAND_OVER",
  "RETURN_SCANNED",
  "NON_RETURN_CONFIRMED",
  "EMPTY_RETURN",
  "RETURN_GATE_FAILED",
  "RECOVERED",
  "CLOSE",
  "WRITE_OFF",
] as const;
export type BookingEvent = (typeof BOOKING_EVENTS)[number];

/** Facts the caller has already established in the same transaction. */
export interface GuardContext {
  blockActive?: boolean;
  depositHeld?: boolean;
  contractAccepted?: boolean;
  withinExposureCap?: boolean;
  checkoutInspectionComplete?: boolean;
  identityVerified?: boolean;
  flagsCleared?: boolean;
  ownerApproved?: boolean;
  returnGatePassed?: boolean;
  depositFinal?: boolean;
  noOpenClaims?: boolean;
  journalBalanced?: boolean;
  carrierReturnScan?: boolean;
}

type Guard = keyof GuardContext;
interface Rule {
  to: BookingState;
  requires?: Guard[];
  /** Guards that must be false. */
  forbids?: Guard[];
  /** Side effect the caller must perform (refund rule, timers), for documentation and audit. */
  effect?: string;
}

export const TRANSITIONS: Partial<Record<BookingState, Partial<Record<BookingEvent, Rule>>>> = {
  PENDING_PAYMENT: {
    PAYMENT_CONFIRMED: { to: "CONFIRMED", requires: ["blockActive", "depositHeld", "contractAccepted", "withinExposureCap"] },
    HOLD_EXPIRED: { to: "EXPIRED" },
    CANCEL: { to: "CANCELLED" },
  },
  EXPIRED: {
    LATE_PAYMENT_REACQUIRED: { to: "CONFIRMED", requires: ["blockActive", "depositHeld", "contractAccepted", "withinExposureCap"] },
    LATE_PAYMENT_UNAVAILABLE: { to: "EXPIRED", effect: "queue full refund and alert staff" },
  },
  CONFIRMED: {
    HAND_OVER: {
      to: "HANDED_OVER",
      requires: ["checkoutInspectionComplete", "identityVerified", "flagsCleared", "withinExposureCap"],
    },
    ID_CHECK_FAILED: { to: "CANCELLED", effect: "full refund of rent and deposit" },
    CANCEL: { to: "CANCELLED", effect: "refund rent per cancellation tiers; deposit in full" },
    NO_SHOW: { to: "CANCELLED", effect: "treated as cancellation under 7 days; deposit in full" },
  },
  HANDED_OVER: {
    RETURN_SCANNED: { to: "RETURNED" },
    NON_RETURN_CONFIRMED: { to: "NON_RETURN", forbids: ["carrierReturnScan"], effect: "forfeit deposit, invoice depreciated value, start D+30/D+60 timers" },
    EMPTY_RETURN: { to: "NON_RETURN", requires: ["ownerApproved"], effect: "timers run from the original due date" },
  },
  RETURNED: {
    RETURN_GATE_FAILED: { to: "NON_RETURN", requires: ["ownerApproved"], effect: "deposit not released; unit back to OUT; timers from original due date" },
    CLOSE: { to: "CLOSED", requires: ["returnGatePassed", "depositFinal", "noOpenClaims", "journalBalanced"] },
  },
  NON_RETURN: {
    RECOVERED: { to: "RETURNED", requires: ["returnGatePassed"], effect: "convert invoice to capped late fees" },
    WRITE_OFF: { to: "CLOSED", requires: ["ownerApproved"] },
  },
};

export type TransitionResult =
  | { ok: true; to: BookingState; effect?: string }
  | { ok: false; error: "INVALID_TRANSITION" }
  | { ok: false; error: "GUARD_FAILED"; missing: Guard[]; violated: Guard[] };

export function transition(from: BookingState, event: BookingEvent, ctx: GuardContext = {}): TransitionResult {
  const rule = TRANSITIONS[from]?.[event];
  if (!rule) return { ok: false, error: "INVALID_TRANSITION" };
  const missing = (rule.requires ?? []).filter((g) => ctx[g] !== true);
  const violated = (rule.forbids ?? []).filter((g) => ctx[g] === true);
  if (missing.length || violated.length) return { ok: false, error: "GUARD_FAILED", missing, violated };
  return rule.effect ? { ok: true, to: rule.to, effect: rule.effect } : { ok: true, to: rule.to };
}

/** Deposit may leave only after the return gate has passed (ARCHITECTURE.md section 7). */
export function canReleaseDeposit(ctx: { returnGatePassed: boolean; gateOverdueAndOwnerNotified?: boolean }): boolean {
  return ctx.returnGatePassed || ctx.gateOverdueAndOwnerNotified === true;
}

/** Bookings that count toward the exposure cap. */
export const OPEN_FOR_EXPOSURE: readonly BookingState[] = ["PENDING_PAYMENT", "CONFIRMED", "HANDED_OVER", "RETURNED", "NON_RETURN"];
