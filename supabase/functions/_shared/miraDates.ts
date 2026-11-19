// Budapest calendar for Mira. Hotel days run on Europe/Budapest time, and the
// model must never work out "Monday" or "last week" by itself: it once answered
// "13th of Monday" and could not decide which Monday was meant. Every turn now
// gets these dates written out, computed here in code.

const TIME_ZONE = "Europe/Budapest";
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first order, as weeks are counted in Hungary. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Calendar date (YYYY-MM-DD) in Budapest for an instant. */
export function budapestDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Wall-clock time (HH:MM) in Budapest for an instant. */
export function budapestClock(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
}

function parse(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Not a calendar date: ${ymd}`);
  return new Date(`${ymd}T12:00:00Z`);
}

/** Pure calendar arithmetic; never shifted by daylight-saving changes. */
export function addDays(ymd: string, days: number): string {
  const date = parse(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(ymd: string): number {
  return parse(ymd).getUTCDay();
}

export function weekdayName(ymd: string): string {
  return WEEKDAY_NAMES[weekdayIndex(ymd)];
}

/** The most recent given weekday strictly before `today` (a past "Monday"). */
export function previousWeekday(today: string, weekday: number): string {
  const back = (weekdayIndex(today) - weekday + 7) % 7 || 7;
  return addDays(today, -back);
}

/** The next given weekday strictly after `today` (a future "Monday"). */
export function nextWeekday(today: string, weekday: number): string {
  const ahead = (weekday - weekdayIndex(today) + 7) % 7 || 7;
  return addDays(today, ahead);
}

/** The UTC instant at which a Budapest calendar day begins (CET or CEST). */
export function budapestMidnightUtc(ymd: string): Date {
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetHours * 3_600_000);
    if (budapestDate(candidate) === ymd && budapestClock(candidate) === "00:00") return candidate;
  }
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - 3_600_000);
}

/** Monday of the week that contains `ymd`. */
export function weekStart(ymd: string): string {
  return addDays(ymd, -((weekdayIndex(ymd) + 6) % 7));
}

function monthBounds(ymd: string): { from: string; to: string } {
  const [year, month] = ymd.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

export type DateContext = {
  timeZone: string;
  today: string;
  weekday: string;
  time: string;
  yesterday: string;
  tomorrow: string;
  /** Monday-first; `past` is the latest earlier occurrence, `next` the coming one. */
  weekdays: { weekday: string; past: string; next: string }[];
  thisWeek: { from: string; to: string };
  lastWeek: { from: string; to: string };
  nextWeek: { from: string; to: string };
  thisWeekend: { from: string; to: string };
  lastWeekend: { from: string; to: string };
  thisMonth: { from: string; to: string };
  lastMonth: { from: string; to: string };
};

export function buildDateContext(now: Date = new Date()): DateContext {
  const today = budapestDate(now);
  const monday = weekStart(today);
  const thisMonth = monthBounds(today);
  const lastMonth = monthBounds(addDays(thisMonth.from, -1));
  // On Saturday or Sunday "this weekend" is the one in progress.
  const day = weekdayIndex(today);
  const saturday = day === 6 ? today : day === 0 ? addDays(today, -1) : nextWeekday(today, 6);
  return {
    timeZone: TIME_ZONE,
    today,
    weekday: weekdayName(today),
    time: budapestClock(now),
    yesterday: addDays(today, -1),
    tomorrow: addDays(today, 1),
    weekdays: WEEK_ORDER.map((index) => ({
      weekday: WEEKDAY_NAMES[index],
      past: previousWeekday(today, index),
      next: nextWeekday(today, index),
    })),
    thisWeek: { from: monday, to: addDays(monday, 6) },
    lastWeek: { from: addDays(monday, -7), to: addDays(monday, -1) },
    nextWeek: { from: addDays(monday, 7), to: addDays(monday, 13) },
    thisWeekend: { from: saturday, to: addDays(saturday, 1) },
    lastWeekend: { from: addDays(saturday, -7), to: addDays(saturday, -6) },
    thisMonth,
    lastMonth,
  };
}

const short = (ymd: string) => `${SHORT[weekdayIndex(ymd)]} ${ymd}`;
const range = (r: { from: string; to: string }) => `${short(r.from)} – ${short(r.to)}`;

/** The block every Mira turn receives. Written for the model, in English. */
export function dateContextPrompt(ctx: DateContext): string {
  const lookup = ctx.weekdays
    .map((w) => `${w.weekday.slice(0, 3)}: past ${w.past}, next ${w.next}`)
    .join("; ");
  return [
    "DATES (Europe/Budapest, computed by HotelCare; use them and never work dates out yourself)",
    `- Today is ${ctx.weekday} ${ctx.today}, ${ctx.time}. Yesterday: ${short(ctx.yesterday)}. Tomorrow: ${short(ctx.tomorrow)}.`,
    `- Weekday lookup: ${lookup}.`,
    "- A weekday name about something that already happened (\"who cleaned 038 on Monday\") means the PAST date in the lookup — the most recent one before today. About plans, prices or arrivals it means the NEXT date. If the person means today they say today.",
    `- This week ${range(ctx.thisWeek)}; last week ${range(ctx.lastWeek)}; next week ${range(ctx.nextWeek)}.`,
    `- This weekend ${range(ctx.thisWeekend)}; last weekend ${range(ctx.lastWeekend)}.`,
    `- This month ${ctx.thisMonth.from} – ${ctx.thisMonth.to}; last month ${ctx.lastMonth.from} – ${ctx.lastMonth.to}.`,
    "- Always write the resolved date in the answer (\"On Monday 16 November …\"), so the person can see which day you used.",
  ].join("\n");
}
