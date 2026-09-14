// Which sites are due a scraping-policy check.
//
// Two callers: the nightly policy sweep, and scripts/backfill-policy-review.ts.
// They differ in WHO is eligible — the sweep only looks at live sites whose
// company profile has been captured, the backfill can be pointed at anything —
// but they must not differ on WHEN a check is stale, or "due" means two things
// and a site can be overdue to one and fresh to the other on the same evening.
//
// So the staleness test and the ordering are unconditional here, and the
// eligibility filters are explicit options. No defaults that quietly decide
// policy: every caller says what it means.
//
// No Prisma import — this is a pure filter over rows the caller already read,
// so it is testable without a database.

export type PolicyCandidate = {
  id: string;
  siteUrl: string;
  status: string;
  scrapingPolicyStatus: string;
  /** Null means never checked, which is always due. */
  scrapingPolicyCheckedAt: Date | null;
  /**
   * When the one-shot company-profile capture ran. Null means never attempted.
   * `companyProfileStatus = PARTIAL` still counts — a policy check does not
   * need a logo — which is why this is the timestamp and not the status.
   */
  companyProfileAt: Date | null;
};

export type PolicySelectionOptions = {
  now: Date;
  recheckIntervalDays: number;
  /** Cap per night. Omit for no cap (the backfill's default). */
  limit?: number;
  /** Ignore the recheck interval entirely — the backfill's `--force`. */
  force?: boolean;
  /** Restrict to one SiteStatus — the backfill's `--status`. */
  status?: string;
  /** Restrict to a set of statuses. The sweep passes ACTIVE + REVIEW. */
  statuses?: readonly string[];
  /**
   * Require a captured company profile. The sweep does; the backfill does not,
   * because it is also used to check sites before they are onboarded.
   */
  requireCompanyProfile?: boolean;
};

export type PolicyExclusion = { site: PolicyCandidate; reason: string };

export type PolicySelection = {
  selected: PolicyCandidate[];
  excluded: PolicyExclusion[];
  /** Sites that were due but fell outside the cap. */
  cappedOut: number;
};

/** Oldest check first; never-checked sites lead. Deterministic on ties. */
export function compareByPolicyCheckedAt(a: PolicyCandidate, b: PolicyCandidate): number {
  const at = a.scrapingPolicyCheckedAt?.getTime() ?? -Infinity;
  const bt = b.scrapingPolicyCheckedAt?.getTime() ?? -Infinity;
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectDuePolicyReviews(
  sites: readonly PolicyCandidate[],
  opts: PolicySelectionOptions,
): PolicySelection {
  const cutoff = new Date(
    opts.now.getTime() - opts.recheckIntervalDays * 24 * 60 * 60_000,
  );

  const selected: PolicyCandidate[] = [];
  const excluded: PolicyExclusion[] = [];

  for (const site of sites) {
    if (opts.status && site.status !== opts.status) {
      excluded.push({ site, reason: `status ${site.status} != ${opts.status}` });
      continue;
    }
    if (opts.statuses && !opts.statuses.includes(site.status)) {
      excluded.push({ site, reason: `status ${site.status} is not checked by the sweep` });
      continue;
    }
    if (opts.requireCompanyProfile && site.companyProfileAt === null) {
      excluded.push({ site, reason: "company profile never captured" });
      continue;
    }

    // `force` skips the interval, never the eligibility above — otherwise
    // `--force` would also mean "check sites the sweep deliberately excludes".
    if (!opts.force && site.scrapingPolicyCheckedAt !== null) {
      if (site.scrapingPolicyCheckedAt.getTime() > cutoff.getTime()) {
        const days = Math.round(
          (opts.now.getTime() - site.scrapingPolicyCheckedAt.getTime()) / 86_400_000,
        );
        excluded.push({
          site,
          reason: `checked ${days}d ago, inside the ${opts.recheckIntervalDays}d interval`,
        });
        continue;
      }
    }

    selected.push(site);
  }

  selected.sort(compareByPolicyCheckedAt);

  // The cap applies AFTER ordering, so a capped night takes the most overdue
  // sites rather than an arbitrary slice.
  const limit = opts.limit;
  if (limit !== undefined && selected.length > limit) {
    const cappedOut = selected.length - limit;
    return { selected: selected.slice(0, limit), excluded, cappedOut };
  }

  return { selected, excluded, cappedOut: 0 };
}

/**
 * Statuses that mean a site may not be scraped without a conversation first.
 * "Newly RESTRICTED" in the verdict line means a site entered one of these
 * tonight — a transition, not a census, so the previous status is recorded on
 * the item to make it one.
 */
export const RESTRICTING_POLICY_STATUSES = [
  "RESTRICTED",
  "REQUIRES_WRITTEN_PERMISSION",
] as const;

export function isRestricting(status: string | null | undefined): boolean {
  return (RESTRICTING_POLICY_STATUSES as readonly string[]).includes(status ?? "");
}

/** A site that was not restricting before tonight and is now. */
export function becameRestricted(before: string | null, after: string | null): boolean {
  return !isRestricting(before) && isRestricting(after);
}
