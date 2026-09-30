// The cohort score (addsite2 phase two, step 1a). Pure: the fix queue's rows
// and the sites' dates in, a per-site score and two cohort summaries out.
//
// Per site: the fix items opened in the FIX_WINDOW_DAYS after the site went
// ACTIVE — how many, how many distinct fields, how many minutes — and its
// final status, where SKIPPED or REVIEW counts toward rank 3.
//
// The primary score counts operator-logged (MANUAL) items only. CHECK items are
// reported apart, and only for check codes that were live before the earliest
// scored window opened: a check that ships mid-control would otherwise count
// for the later cohort and not the earlier one.
//
// Cohorts, from the plan (~/.claude/plans/addsite2-phase2.md, step 1a):
//   control = onboardingSkill NULL and created in [freezeAt, switchAt)
//   test    = onboardingSkill "addsite3"
//   untagged sites created at or after switchAt are "addsite2 after switch":
//   listed, never scored.
// freezeAt is step 1b's ship time; until it exists there is no control.

export const FIX_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

/** Final statuses that count toward rank 3. */
const RANK3_STATUSES: ReadonlySet<string> = new Set(["SKIPPED", "REVIEW"]);

export type FixSourceName = "MANUAL" | "CHECK";

export type ScoreSite = {
  id: string;
  siteUrl: string;
  status: string;
  createdAt: Date;
  activeAt: Date | null;
  onboardingSkill: string | null;
};

export type ScoreItem = {
  siteId: string;
  field: string;
  source: FixSourceName;
  code: string;
  openedAt: Date;
  minutes: number | null;
};

export type CohortBounds = { freezeAt: Date | null; switchAt: Date | null };

export type Cohort = "control" | "test" | "addsite2_after_switch" | "none";

export type SiteScore = {
  siteId: string;
  siteUrl: string;
  cohort: Cohort;
  /** [windowStart, windowEnd); null when the site never went ACTIVE. */
  windowStart: Date | null;
  windowEnd: Date | null;
  /** The window has closed, so the score will not change. */
  complete: boolean;
  /** MANUAL items in the window. */
  items: number;
  /** Distinct fields among them. */
  fields: number;
  /** Their logged minutes; an item with none adds 0. */
  minutes: number;
  finalStatus: string;
  rank3: boolean;
  /** CHECK items in the window, comparable codes only. */
  checkItems: number;
  checkCodes: string[];
};

export type CohortSummary = {
  sites: number;
  /** Sites whose window has closed — the ones the medians are taken over. */
  complete: number;
  medianMinutes: number;
  meanItems: number;
};

export type ScoreReport = {
  /** Control and test sites. */
  sites: SiteScore[];
  /** Untagged sites created after the switch: listed, not scored. */
  excluded: SiteScore[];
  control: CohortSummary;
  test: CohortSummary;
  /** Check codes live before the earliest scored window opened. */
  comparableCheckCodes: string[];
};

export function cohortOf(site: ScoreSite, bounds: CohortBounds): Cohort {
  if (site.onboardingSkill === "addsite3") return "test";
  if (site.onboardingSkill != null) return "none";
  if (bounds.switchAt && site.createdAt.getTime() >= bounds.switchAt.getTime()) {
    return bounds.freezeAt ? "addsite2_after_switch" : "none";
  }
  if (!bounds.freezeAt || site.createdAt.getTime() < bounds.freezeAt.getTime()) return "none";
  return "control";
}

export function scoreSite(
  site: ScoreSite,
  items: ScoreItem[],
  opts: { now: Date; bounds: CohortBounds; days?: number; comparableCheckCodes?: ReadonlySet<string> },
): SiteScore {
  const days = opts.days ?? FIX_WINDOW_DAYS;
  const start = site.activeAt?.getTime() ?? null;
  const end = start === null ? null : start + days * DAY_MS;
  const inWindow = (i: ScoreItem) =>
    start !== null && end !== null && i.siteId === site.id && i.openedAt.getTime() >= start && i.openedAt.getTime() < end;

  const manual = items.filter((i) => i.source === "MANUAL" && inWindow(i));
  const comparable = opts.comparableCheckCodes ?? new Set<string>();
  const checks = items.filter((i) => i.source === "CHECK" && inWindow(i) && comparable.has(i.code));

  return {
    siteId: site.id,
    siteUrl: site.siteUrl,
    cohort: cohortOf(site, opts.bounds),
    windowStart: start === null ? null : new Date(start),
    windowEnd: end === null ? null : new Date(end),
    complete: end !== null && opts.now.getTime() >= end,
    items: manual.length,
    fields: new Set(manual.map((i) => i.field)).size,
    minutes: manual.reduce((sum, i) => sum + (i.minutes ?? 0), 0),
    finalStatus: site.status,
    rank3: RANK3_STATUSES.has(site.status),
    checkItems: checks.length,
    checkCodes: [...new Set(checks.map((i) => i.code))].sort(),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarise(scores: SiteScore[]): CohortSummary {
  const done = scores.filter((s) => s.complete);
  return {
    sites: scores.length,
    complete: done.length,
    medianMinutes: median(done.map((s) => s.minutes)),
    meanItems: done.length === 0 ? 0 : done.reduce((n, s) => n + s.items, 0) / done.length,
  };
}

export function scoreCohorts(
  sites: ScoreSite[],
  items: ScoreItem[],
  opts: { now: Date; bounds: CohortBounds; days?: number; checkCodeLiveFrom?: Record<string, Date> },
): ScoreReport {
  const scored = sites.filter((s) => {
    const c = cohortOf(s, opts.bounds);
    return c === "control" || c === "test";
  });
  const after = sites.filter((s) => cohortOf(s, opts.bounds) === "addsite2_after_switch");

  // A code compares only if it was live before the earliest scored window
  // opened — then it was live for every window of both cohorts.
  const starts = scored.map((s) => s.activeAt?.getTime()).filter((t): t is number => typeof t === "number");
  const earliest = starts.length ? Math.min(...starts) : null;
  const comparableCheckCodes = Object.entries(opts.checkCodeLiveFrom ?? {})
    .filter(([, liveFrom]) => earliest !== null && liveFrom.getTime() <= earliest)
    .map(([code]) => code)
    .sort();
  const comparable = new Set(comparableCheckCodes);

  const score = (s: ScoreSite) =>
    scoreSite(s, items, { now: opts.now, bounds: opts.bounds, days: opts.days, comparableCheckCodes: comparable });
  const scores = scored.map(score);

  return {
    sites: scores,
    excluded: after.map(score),
    control: summarise(scores.filter((s) => s.cohort === "control")),
    test: summarise(scores.filter((s) => s.cohort === "test")),
    comparableCheckCodes,
  };
}
