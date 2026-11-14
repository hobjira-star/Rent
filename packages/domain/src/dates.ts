/**
 * Business dates are Bangkok calendar dates carried as 'YYYY-MM-DD' strings.
 * Never convert them through a JS Date in local time.
 */
export type BkkDate = string & { readonly __brand: "BkkDate" };

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function bkkDate(s: string): BkkDate {
  const m = RE.exec(s);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${s}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`invalid calendar date: ${s}`);
  }
  return s as BkkDate;
}

const toUtcMs = (d: BkkDate): number => Date.parse(`${d}T00:00:00Z`);
const fromUtcMs = (ms: number): BkkDate => new Date(ms).toISOString().slice(0, 10) as BkkDate;

/** The Bangkok calendar date of an instant. */
export const bangkokDateOf = (instant: Date): BkkDate => fromUtcMs(instant.getTime() + BANGKOK_OFFSET_MS);

export const addDays = (d: BkkDate, n: number): BkkDate => fromUtcMs(toUtcMs(d) + n * 86_400_000);

/** Whole days from a to b (b - a). */
export const diffDays = (a: BkkDate, b: BkkDate): number => Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);

/** 0 = Sunday ... 6 = Saturday */
export const weekday = (d: BkkDate): number => new Date(toUtcMs(d)).getUTCDay();

export interface BusinessCalendar {
  /** Weekdays the shop is closed, 0 = Sunday. */
  closedWeekdays: readonly number[];
  /** Specific closed dates (public holidays, shop holidays). */
  closedDates: readonly string[];
}

export const isBusinessDay = (d: BkkDate, cal: BusinessCalendar): boolean =>
  !cal.closedWeekdays.includes(weekday(d)) && !cal.closedDates.includes(d);

/**
 * The date n business days after d. A start date that is itself closed counts
 * from the next business day.
 */
export function addBusinessDays(d: BkkDate, n: number, cal: BusinessCalendar): BkkDate {
  if (n < 0) throw new RangeError("n must be >= 0");
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur, cal)) left--;
  }
  return cur;
}

/** Half-open date range [start, end). */
export interface DateRange {
  start: BkkDate;
  end: BkkDate;
}

export const overlaps = (a: DateRange, b: DateRange): boolean => a.start < b.end && b.start < a.end;
