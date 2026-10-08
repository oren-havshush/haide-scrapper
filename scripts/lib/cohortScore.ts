// The cohort comparison behind scripts/cohort-score.ts (addsite2 phase two,
// step 7). Pure: the API's sites and fix items in, fixScore's report plus the
// medians and means and the switch forecast out.
//
// CHECK items are scored per site: checkCodeLiveFrom gives each queue code the
// instant it went live, and fixScore scores a code for a site only if it was
// live when that site's window opened. Every CHECK item in a window is also
// counted per site, for information, whether comparable or not.

import {
  FIX_TIME_ZONE,
  cohortBoundsFrom,
  scoreCohorts,
  scoreSite,
  type FixSourceName,
  type ScoreItem,
  type ScoreReport,
  type ScoreSite,
  type SiteScore,
} from "../../src/lib/fixScore";
import { VALUE_CHECK_QUEUE_CODES } from "../../worker/lib/valueChecks";

/**
 * When step 2b's value checks went live: the worker start of
 * deploy-20261004-163250-57422e3. No queue code could open an item before it.
 */
export const CHECK_CODES_LIVE_FROM = "2026-10-04T13:42:25Z";
/** The switch to addsite3 waits for this many completed control windows. */
export const SWITCH_AFTER_WINDOWS = 10;

export type ApiSite = {
  id: string;
  siteUrl: string;
  status: string;
  createdAt: string;
  activeAt: string | null;
  firstActiveAt?: string | null;
  onboardingSkill: string | null;
};
export type ApiItem = {
  siteId: string;
  field: string;
  source: string;
  code: string;
  openedAt: string;
  minutes: number | null;
  minutesEstimated?: boolean;
};
export type Stats = {
  sites: number;
  medianItems: number;
  meanItems: number;
  medianFields: number;
  meanFields: number;
  medianMinutes: number;
  meanMinutes: number;
  medianCheckItems: number;
  meanCheckItems: number;
};
export type SwitchForecast = {
  needed: number;
  controlSites: number;
  /** Control windows closed by now. */
  completed: number;
  /** Of those, the ones with minutes logged (the plan's switch wording). */
  completedWithMinutes: number;
  /** When the tenth control window closes; null while fewer than ten have one. */
  tenthCompletesAt: Date | null;
  /**
   * The same, counting only sites with minutes logged so far (the plan says
   * "completed their 14-day windows with minutes logged"). Can only move earlier
   * as minutes are logged on sites that have none yet.
   */
  tenthWithMinutesCompletesAt: Date | null;
  /** Control sites with minutes logged so far, window open or closed. */
  withMinutes: number;
  /** Control sites not yet ACTIVE, so with no window. */
  withoutWindow: number;
};
export type CohortReport = {
  now: Date;
  /** ADDSITE3_SWITCH_AT (src/lib/fixScore.ts, pinned equal to SWITCH_AT) unless given; null before the switch. */
  switchAt: Date | null;
  checkCodesLiveFrom: Date;
  score: ScoreReport;
  /** Per site: every nightly-check item in its window, comparable or not. */
  allCheckItems: Map<string, number>;
  stats: { control: { complete: Stats; soFar: Stats }; test: { complete: Stats; soFar: Stats } };
  forecast: SwitchForecast;
};

const date = (s: string | null | undefined) => (s ? new Date(s) : null);

export function toScoreSite(a: ApiSite): ScoreSite {
  return {
    id: a.id,
    siteUrl: a.siteUrl,
    status: a.status,
    createdAt: new Date(a.createdAt),
    activeAt: date(a.activeAt),
    firstActiveAt: date(a.firstActiveAt),
    onboardingSkill: a.onboardingSkill,
  };
}

export function toScoreItem(a: ApiItem): ScoreItem {
  return {
    siteId: a.siteId,
    field: a.field,
    source: a.source as FixSourceName,
    code: a.code,
    openedAt: new Date(a.openedAt),
    minutes: a.minutes,
    minutesEstimated: a.minutesEstimated === true,
  };
}

/**
 * Queue codes added after step 2b, each live from the worker start of the
 * deploy that shipped it, so a site whose window opened earlier is not
 * compared on a code it could not have received. null until that deploy has
 * run: a code with no date is never scored (src/lib/fixScore.ts).
 */
export const CHECK_CODE_LIVE_FROM: Readonly<Record<string, string | null>> = {
  // owner, 2026-10-08 (LRN-APPLY-13); the date is recorded after its deploy.
  apply_endpoint_mismatch: null,
};

/** Each queue code's live-from: the twelve from CHECK_CODES_LIVE_FROM, later ones from their own. */
export function checkCodeLiveFrom(): Record<string, Date> {
  const out: Record<string, Date> = {};
  for (const c of VALUE_CHECK_QUEUE_CODES) {
    if (Object.prototype.hasOwnProperty.call(CHECK_CODE_LIVE_FROM, c)) {
      const own = CHECK_CODE_LIVE_FROM[c];
      if (own) out[c] = new Date(own);
    } else {
      out[c] = new Date(CHECK_CODES_LIVE_FROM);
    }
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function cohortStats(scores: SiteScore[]): Stats {
  const col = (k: "items" | "fields" | "minutes" | "checkItems") => scores.map((s) => s[k]);
  return {
    sites: scores.length,
    medianItems: median(col("items")),
    meanItems: mean(col("items")),
    medianFields: median(col("fields")),
    meanFields: mean(col("fields")),
    medianMinutes: median(col("minutes")),
    meanMinutes: mean(col("minutes")),
    medianCheckItems: median(col("checkItems")),
    meanCheckItems: mean(col("checkItems")),
  };
}

/** How many control windows have closed, and when the tenth will. */
export function switchForecast(scores: SiteScore[], now: Date, needed = SWITCH_AFTER_WINDOWS): SwitchForecast {
  const control = scores.filter((s) => s.cohort === "control");
  const endsOf = (xs: SiteScore[]) =>
    xs
      .map((s) => s.windowEnd)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
  const ends = endsOf(control);
  const minuted = control.filter((s) => s.minutes > 0);
  const done = control.filter((s) => s.windowEnd !== null && s.windowEnd.getTime() <= now.getTime());
  return {
    needed,
    controlSites: control.length,
    completed: done.length,
    completedWithMinutes: done.filter((s) => s.minutes > 0).length,
    tenthCompletesAt: ends[needed - 1] ?? null,
    tenthWithMinutesCompletesAt: endsOf(minuted)[needed - 1] ?? null,
    withMinutes: minuted.length,
    withoutWindow: control.length - ends.length,
  };
}

export function buildCohortReport(input: {
  sites: ApiSite[];
  items: ApiItem[];
  now: Date;
  liveFrom?: Record<string, Date>;
  /** Defaults to ADDSITE3_SWITCH_AT, which the switch commit sets. */
  switchAt?: string | null;
}): CohortReport {
  const sites = input.sites.map(toScoreSite);
  const items = input.items.map(toScoreItem);
  const bounds = input.switchAt === undefined ? cohortBoundsFrom({}) : cohortBoundsFrom({}, { switchAt: input.switchAt });
  const score = scoreCohorts(sites, items, {
    now: input.now,
    bounds,
    checkCodeLiveFrom: input.liveFrom ?? checkCodeLiveFrom(),
  });

  // For information: every nightly-check item in each window, any code.
  const everyCode = Object.fromEntries(
    items.filter((i) => i.source === "CHECK" && !i.code.startsWith("auto:")).map((i) => [i.code, new Date(0)]),
  );
  const byId = new Map(sites.map((s) => [s.id, s]));
  const allCheckItems = new Map<string, number>();
  for (const s of score.sites) {
    const site = byId.get(s.siteId);
    if (!site) continue;
    allCheckItems.set(s.siteId, scoreSite(site, items, { now: input.now, bounds, checkCodeLiveFrom: everyCode }).checkItems);
  }

  const of = (c: "control" | "test") => score.sites.filter((s) => s.cohort === c);
  const both = (xs: SiteScore[]) => ({ complete: cohortStats(xs.filter((s) => s.complete)), soFar: cohortStats(xs) });
  return {
    now: input.now,
    switchAt: bounds.switchAt,
    checkCodesLiveFrom: new Date(CHECK_CODES_LIVE_FROM),
    score,
    allCheckItems,
    stats: { control: both(of("control")), test: both(of("test")) },
    forecast: switchForecast(score.sites, input.now),
  };
}

// ---- printing --------------------------------------------------------------

function jerusalem(d: Date): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FIX_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { day: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
}
const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));

function statLines(label: string, s: Stats): string[] {
  return [
    `  ${label} (${s.sites} site(s)):`,
    `    median minutes ${n(s.medianMinutes)}, mean minutes ${n(s.meanMinutes)}`,
    `    median items ${n(s.medianItems)}, mean items ${n(s.meanItems)}`,
    `    median fields ${n(s.medianFields)}, mean fields ${n(s.meanFields)}`,
    `    median CHECK items ${n(s.medianCheckItems)}, mean CHECK items ${n(s.meanCheckItems)} (comparable codes only)`,
  ];
}

function siteLines(r: CohortReport, cohort: "control" | "test"): string[] {
  const rows = r.score.sites
    .filter((s) => s.cohort === cohort)
    .sort((a, b) => (a.windowStart?.getTime() ?? Infinity) - (b.windowStart?.getTime() ?? Infinity) || a.siteUrl.localeCompare(b.siteUrl));
  if (rows.length === 0) return ["  (none yet)"];
  const out = [
    `  ${pad("site", 42)} ${pad("window", 25)} ${pad("items", 5)} ${pad("fields", 6)} ${pad("minutes", 7)} ${pad("status", 9)} ${pad("CHECK", 5)} CHECK(all codes)`,
  ];
  for (const s of rows) {
    const win = s.windowStart && s.windowEnd
      ? `${jerusalem(s.windowStart).day}..${jerusalem(s.windowEnd).day}${s.complete ? " done" : ""}`
      : "not ACTIVE yet";
    out.push(
      `  ${pad(s.siteUrl, 42)} ${pad(win, 25)} ${pad(String(s.items), 5)} ${pad(String(s.fields), 6)} ${pad(n(s.minutes), 7)} ${pad(s.finalStatus + (s.rank3 ? "*" : ""), 9)} ${pad(String(s.checkItems), 5)} ${r.allCheckItems.get(s.siteId) ?? 0}`,
    );
  }
  return out;
}

export function formatCohortReport(r: CohortReport): string[] {
  const today = jerusalem(r.now).day;
  const f = r.forecast;
  const tenth = f.tenthCompletesAt
    ? (() => {
        const j = jerusalem(f.tenthCompletesAt);
        return `the tenth completes on ${j.day} (${j.time} Jerusalem)`;
      })()
    : `the tenth is not known yet: only ${f.controlSites - f.withoutWindow} control site(s) have a window, and a new one closes 14 days after it goes ACTIVE`;
  return [
    `cohort-score ${r.now.toISOString()} (Jerusalem ${today})`,
    `freezeAt ${cohortBoundsFrom({}).freezeAt?.toISOString()}; ${r.switchAt ? `switchAt ${r.switchAt.toISOString()}` : "switchAt not recorded (ADDSITE3_SWITCH_AT null)"}; window 14 days from the first move to ACTIVE`,
    "",
    `switch: ${f.completed} of ${f.controlSites} control sites have completed their 14-day windows as of ${today} (${f.completedWithMinutes} with minutes logged); ${tenth}.`,
    `        counting only sites with minutes logged so far: ${f.withMinutes} control site(s) have minutes; ${
      f.tenthWithMinutesCompletesAt
        ? `the tenth completes on ${jerusalem(f.tenthWithMinutesCompletesAt).day} (${jerusalem(f.tenthWithMinutesCompletesAt).time} Jerusalem)`
        : "the tenth is not known yet"
    }.`,
    ...(f.withoutWindow > 0 ? [`        ${f.withoutWindow} control site(s) have not gone ACTIVE, so have no window.`] : []),
    "",
    "control (addsite2, frozen) — items, fields and minutes are MANUAL plus API-write (auto:) items; * = SKIPPED/REVIEW (rank 3):",
    ...siteLines(r, "control"),
    "",
    "test (addsite3):",
    ...siteLines(r, "test"),
    ...(r.score.excluded.length ? [`addsite2 after switch (listed, not scored): ${r.score.excluded.map((s) => s.siteUrl).join(", ")}`] : []),
    "",
    "score — the deletion rule compares median minutes and mean items over completed windows:",
    ...statLines("control, completed windows", r.stats.control.complete),
    ...statLines("test, completed windows", r.stats.test.complete),
    "provisional — every site so far, windows still open included:",
    ...statLines("control, so far", r.stats.control.soFar),
    ...statLines("test, so far", r.stats.test.soFar),
    "",
    `CHECK items (nightly value checks): a code is scored for a site only if it was live when that site's window opened; the twelve queue codes are live from ${r.checkCodesLiveFrom.toISOString()}:`,
    ...Object.entries(r.score.checkCodeSites).map(
      ([code, c]) => `  ${code}: comparable on ${c.control} control and ${c.test} test site(s)`,
    ),
    `  CHECK items in windows on any code (information only): control ${sum(r, "control")}, test ${sum(r, "test")}`,
  ];
}

function sum(r: CohortReport, cohort: "control" | "test"): number {
  return r.score.sites.filter((s) => s.cohort === cohort).reduce((a, s) => a + (r.allCheckItems.get(s.siteId) ?? 0), 0);
}
