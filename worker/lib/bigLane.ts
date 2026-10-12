// The big lane (big-lane design, item 1, 2026-10-13).
//
// A second sweep, haide-sweep-big, for sites with `_meta.lane = "big"`
// (src/lib/siteLane.ts): it runs in the window 22:00-01:45 Asia/Jerusalem,
// before the nightly's 02:00, so one site that needs hours (Maof: 2,524 cards,
// 91-178 minutes for a full read) never spends the nightly's budget. Pure, so
// the clock arithmetic is tested on a UTC host (bigLane.test.ts).
//
//   - The window closes at the next 01:45 Jerusalem: `bigLaneStopAt`.
//   - A site starts only if it is expected to finish by then: `fitsBeforeStop`,
//     with the median of its last 3 successful runs, else its own
//     limits.timeBudgetMinutes, else the fleet's 15.
//   - The hard stop is the run's own deadline: the sweep driver puts `stopAt`
//     in the scheduled payload, and scrape.ts's deadline timer fires at
//     min(the site's budget, stopAt). Cut off there, the run closes as
//     `cut_off` and writes nothing: the atomic replace never committed, so the
//     site keeps its listings. There is no cross-process cancel for a claimed
//     job, so the deadline has to be the worker's own.
//   - The full detail pass is the window that starts on Friday (Friday night
//     into Saturday), the same night the nightly's full pass runs at 02:00.
//
// Never the host clock: the box is Etc/UTC.

import { FLEET_TIME_BUDGET_MINUTES, type SiteLimits } from "./siteLimits";
import type { DetailMode } from "./detailPlan";
import { readScheduledFlag } from "./scheduledRun";

export const BIG_LANE_SWEEP_KIND = "SCRAPE_BIG";
export const BIG_LANE_TIMEZONE = "Asia/Jerusalem";
export const BIG_LANE_START = { hour: 22, minute: 0 } as const;
export const BIG_LANE_STOP = { hour: 1, minute: 45 } as const;
export const BIG_LANE_STOP_LABEL = "01:45";
/** 22:00 to 01:45. */
export const BIG_LANE_WINDOW_MINUTES = 225;
/** The failure category of a run the window's end cut off: a decision, never a fault. */
export const CUT_OFF = "cut_off";
/** How long past the stop the driver waits for a cut-off run to close itself. */
export const BIG_LANE_CLOSE_MARGIN_MS = 3 * 60_000;

export type SweepLane = "nightly" | "big";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BIG_LANE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string };

/** The Jerusalem wall clock at an instant. */
export function jerusalemWallClock(at: Date): WallClock {
  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(at)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday,
  };
}

/**
 * The EARLIEST instant a Jerusalem wall-clock time names. Jerusalem is UTC+2 or
 * UTC+3, so the instant is the wall time less 3 hours or less 2 hours. On the
 * night the clocks go back (02:00 -> 01:00) 01:45 happens twice, and the lane
 * stops at the first; on the night they go forward 01:45 happens once.
 */
function jerusalemToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  for (const offsetHours of [3, 2]) {
    const candidate = new Date(wall - offsetHours * 3_600_000);
    const w = jerusalemWallClock(candidate);
    if (Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) === wall) return candidate;
  }
  throw new Error(`no instant reads ${year}-${month}-${day} ${hour}:${minute} in ${BIG_LANE_TIMEZONE}`);
}

/** The first 01:45 Jerusalem after `startedAt`: when the big lane stops. */
export function bigLaneStopAt(startedAt: Date): Date {
  const w = jerusalemWallClock(startedAt);
  const today = jerusalemToUtc(w.year, w.month, w.day, BIG_LANE_STOP.hour, BIG_LANE_STOP.minute);
  if (today.getTime() > startedAt.getTime()) return today;
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return jerusalemToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), BIG_LANE_STOP.hour, BIG_LANE_STOP.minute);
}

/** True from 22:00 to 01:45 Jerusalem. The big lane refuses to start outside it. */
export function insideBigLaneWindow(at: Date): boolean {
  const w = jerusalemWallClock(at);
  const m = w.hour * 60 + w.minute;
  const start = BIG_LANE_START.hour * 60 + BIG_LANE_START.minute;
  const stop = BIG_LANE_STOP.hour * 60 + BIG_LANE_STOP.minute;
  return m >= start || m < stop;
}

/**
 * The big lane's detail mode: "full" for the window that starts on Friday,
 * else "incremental". The window's day is the Jerusalem date six hours
 * earlier, so a start at 22:00 Friday and one at 00:30 Saturday are the same
 * window.
 */
export function bigLaneDetailMode(startedAt: Date): DetailMode {
  const windowDay = jerusalemWallClock(new Date(startedAt.getTime() - 6 * 3_600_000)).weekday;
  return windowDay === "Fri" ? "full" : "incremental";
}

/**
 * How long a site is expected to take, in minutes: the median of its last
 * three successful runs (newest first), else its own budget, else the fleet's.
 */
export function expectedMinutes(recentDurationsMin: number[], limits: SiteLimits): number {
  const recent = recentDurationsMin.filter((n) => Number.isFinite(n) && n >= 0).slice(0, 3);
  if (recent.length > 0) {
    const sorted = [...recent].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return limits.timeBudgetMinutes ?? FLEET_TIME_BUDGET_MINUTES;
}

/** A site starts only if now + expected is no later than the stop. */
export function fitsBeforeStop(now: Date, expectedMin: number, stopAt: Date): boolean {
  return now.getTime() + expectedMin * 60_000 <= stopAt.getTime();
}

/** The skip line for a site that would not fit. */
export function noFitReason(expectedMin: number): string {
  return `would not finish before ${BIG_LANE_STOP_LABEL} (expected ${Math.round(expectedMin)} min)`;
}

/**
 * The window's end from a SCRAPE job's payload: only a scheduled payload
 * carries it (only the sweep driver writes one), and anything unreadable is
 * no stop at all, so the run keeps its ordinary deadline.
 */
export function readStopAt(payload: unknown): Date | null {
  if (!readScheduledFlag(payload)) return null;
  const raw = (payload as Record<string, unknown>).stopAt;
  if (typeof raw !== "string") return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The run's deadline in ms from its start: its own budget, or the time left
 * to stopAt if that is sooner. `cutOff` says the window's end is the binding
 * one, which is what the run closes as when the timer fires.
 */
export function runDeadline(startMs: number, timeoutMs: number, stopAt: Date | null): { ms: number; cutOff: boolean } {
  if (!stopAt) return { ms: timeoutMs, cutOff: false };
  const left = Math.max(0, stopAt.getTime() - startMs);
  return left < timeoutMs ? { ms: left, cutOff: true } : { ms: timeoutMs, cutOff: false };
}

/** The run's error when the window's end cut it off. */
export function cutOffMessage(ranMinutes: number): string {
  return `cut off at ${BIG_LANE_STOP_LABEL} after ${Math.round(ranMinutes)} min — nothing written, previous listings kept`;
}
