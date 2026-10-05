// The cohort score (addsite2 phase two, step 1a). Pure: the fix queue's rows
// and the sites' dates in, a per-site score and two cohort summaries out.
//
// Per site: the fix items opened in the FIX_WINDOW_DAYS after the site went
// ACTIVE — how many, how many distinct fields, how many minutes — and its
// final status, where SKIPPED or REVIEW counts toward rank 3.
//
// The primary score counts operator-logged (MANUAL) items and, since step 1c,
// the items API writes open themselves (CHECK, coded auto:<route>); their
// estimated minutes count once per site per day. Nightly checks' CHECK items
// are reported apart, and a code is scored for a site only if it was live when
// that site's window opened (step 7): a check that ships mid-window would
// otherwise count for part of one window and all of another. The report says
// on how many sites of each cohort each code was comparable.
//
// Cohorts, from the plan (~/.claude/plans/addsite2-phase2.md, step 1a):
//   control = onboardingSkill NULL and created in [freezeAt, switchAt)
//   test    = onboardingSkill "addsite3"
//   untagged sites created at or after switchAt are "addsite2 after switch":
//   listed, never scored.
// freezeAt is step 1b's ship time; until it exists there is no control.

export const FIX_WINDOW_DAYS = 14;
/** The day an estimate belongs to is the operators' day. */
export const FIX_TIME_ZONE = "Asia/Jerusalem";
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
  /**
   * Step A: the first move to ACTIVE, written once and never again. activeAt
   * is rewritten by every fix that sets the site ACTIVE, so a window on it
   * restarted at each fix. Absent or null falls back to activeAt.
   */
  firstActiveAt?: Date | null;
  onboardingSkill: string | null;
};

export type ScoreItem = {
  siteId: string;
  field: string;
  source: FixSourceName;
  code: string;
  openedAt: Date;
  minutes: number | null;
  /** Step 1c: minutes are the day's estimate, carried by every auto item that day. */
  minutesEstimated?: boolean;
};

/** An item opened by an API write (step 1c), coded auto:<route>. */
const isAutoItem = (i: ScoreItem) => i.source === "CHECK" && i.code.startsWith("auto:");

/** The Jerusalem calendar date of an instant, for once-per-day estimates. */
function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Minutes for a set of items: typed minutes add up; estimated minutes are one
 * day's span carried by every item that day, so each day counts once — the
 * largest estimate that day, if two differ.
 */
function scoreMinutes(items: ScoreItem[], timeZone: string): number {
  let typed = 0;
  const perDay = new Map<string, number>();
  for (const i of items) {
    if (i.minutesEstimated) {
      const day = localDate(i.openedAt, timeZone);
      perDay.set(day, Math.max(perDay.get(day) ?? 0, i.minutes ?? 0));
    } else {
      typed += i.minutes ?? 0;
    }
  }
  return typed + [...perDay.values()].reduce((a, b) => a + b, 0);
}

export type CohortBounds = { freezeAt: Date | null; switchAt: Date | null };
/**
 * When addsite2 was frozen (step 1b): the later of 2026-10-01 00:00
 * Asia/Jerusalem and the last commit that touched addsite2.md or
 * addsite2-recipes/ (a1c5672, 2026-09-30 10:05 +03:00). Sites onboarded from
 * here with the unchanged skill are the control cohort. The SKILLS freeze note in
 * scripts/sync-addsite2.mjs records the same value (scripts/sync-skills-freeze.test.ts).
 */
export const ADDSITE2_FREEZE_AT = "2026-09-30T21:00:00.000Z";

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
  /** CHECK items in the window, on codes live when the window opened. */
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
  /** Per check code: the scored sites whose window opened with it live, by cohort. */
  checkCodeSites: Record<string, { control: number; test: number }>;
};

/** Where a site's window starts: its first move to ACTIVE, else its latest. */
function windowAnchor(site: ScoreSite): Date | null {
  return site.firstActiveAt ?? site.activeAt;
}

export function cohortOf(site: ScoreSite, bounds: CohortBounds): Cohort {
  if (site.onboardingSkill === "addsite3") return "test";
  if (site.onboardingSkill != null) return "none";
  if (bounds.switchAt && site.createdAt.getTime() >= bounds.switchAt.getTime()) {
    return bounds.freezeAt ? "addsite2_after_switch" : "none";
  }
  if (!bounds.freezeAt || site.createdAt.getTime() < bounds.freezeAt.getTime()) return "none";
  return "control";
}

/** The codes live when a window opened at `start` (ms); none without a window. */
function comparableCodes(start: number | null, liveFrom: Record<string, Date> | undefined): Set<string> {
  if (start === null) return new Set();
  return new Set(
    Object.entries(liveFrom ?? {})
      .filter(([, at]) => at.getTime() <= start)
      .map(([code]) => code),
  );
}

export function scoreSite(
  site: ScoreSite,
  items: ScoreItem[],
  opts: {
    now: Date;
    bounds: CohortBounds;
    days?: number;
    /** When each check code went live; a code with none is never scored. */
    checkCodeLiveFrom?: Record<string, Date>;
    timeZone?: string;
  },
): SiteScore {
  const days = opts.days ?? FIX_WINDOW_DAYS;
  const start = windowAnchor(site)?.getTime() ?? null;
  const end = start === null ? null : start + days * DAY_MS;
  const inWindow = (i: ScoreItem) =>
    start !== null && end !== null && i.siteId === site.id && i.openedAt.getTime() >= start && i.openedAt.getTime() < end;

  // The primary score: operator items and, since step 1c, the items API writes
  // open themselves. Nightly checks' items are reported apart.
  const manual = items.filter((i) => (i.source === "MANUAL" || isAutoItem(i)) && inWindow(i));
  const comparable = comparableCodes(start, opts.checkCodeLiveFrom);
  const checks = items.filter((i) => i.source === "CHECK" && !isAutoItem(i) && inWindow(i) && comparable.has(i.code));

  return {
    siteId: site.id,
    siteUrl: site.siteUrl,
    cohort: cohortOf(site, opts.bounds),
    windowStart: start === null ? null : new Date(start),
    windowEnd: end === null ? null : new Date(end),
    complete: end !== null && opts.now.getTime() >= end,
    items: manual.length,
    fields: new Set(manual.map((i) => i.field)).size,
    minutes: scoreMinutes(manual, opts.timeZone ?? FIX_TIME_ZONE),
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

  const score = (s: ScoreSite) =>
    scoreSite(s, items, { now: opts.now, bounds: opts.bounds, days: opts.days, checkCodeLiveFrom: opts.checkCodeLiveFrom });
  const scores = scored.map(score);

  // Per code, on how many sites of each cohort it was live when the window opened.
  const checkCodeSites: Record<string, { control: number; test: number }> = {};
  for (const code of Object.keys(opts.checkCodeLiveFrom ?? {}).sort()) checkCodeSites[code] = { control: 0, test: 0 };
  for (const s of scored) {
    const cohort = cohortOf(s, opts.bounds) as "control" | "test";
    for (const code of comparableCodes(windowAnchor(s)?.getTime() ?? null, opts.checkCodeLiveFrom)) {
      checkCodeSites[code][cohort] += 1;
    }
  }

  return {
    sites: scores,
    excluded: after.map(score),
    control: summarise(scores.filter((s) => s.cohort === "control")),
    test: summarise(scores.filter((s) => s.cohort === "test")),
    checkCodeSites,
  };
}

/**
 * When operators switched to addsite3 (step 7); null until then. The switch
 * commit sets this and SWITCH_AT in scripts/lib/checkLearnings.mjs to the same
 * value (src/lib/fixScore.test.ts pins them equal).
 */
export const ADDSITE3_SWITCH_AT: string | null = null;

/**
 * The cohort window for a query: freezeAt defaults to ADDSITE2_FREEZE_AT and
 * switchAt to ADDSITE3_SWITCH_AT; the query overrides either.
 */
export function cohortBoundsFrom(
  q: { freezeAt?: string; switchAt?: string },
  defaults: { freezeAt?: string; switchAt?: string | null } = {},
): CohortBounds {
  const switchAt = q.switchAt ?? (defaults.switchAt === undefined ? ADDSITE3_SWITCH_AT : defaults.switchAt);
  return {
    freezeAt: new Date(q.freezeAt ?? defaults.freezeAt ?? ADDSITE2_FREEZE_AT),
    switchAt: switchAt ? new Date(switchAt) : null,
  };
}
