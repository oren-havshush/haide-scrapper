// What an unattended run is allowed to do to a site, and how it persists.
//
// A manual scrape has an operator watching it. A scheduled one does not, and it
// runs across the whole fleet in a night, so every failure mode multiplies by
// 145. Two things follow, and both live here so there is one definition of each.
//
// ---------------------------------------------------------------------------
// 1. A scheduled run never changes a site.
// ---------------------------------------------------------------------------
//
// Seven writes in worker/jobs/scrape.ts mutate the Site row or delete its
// listings. Each was written for a watched run where a human sees the result
// and can undo it. Unattended, each is a way for one bad night to publish a
// wrong answer to the public jobs site — which reads this database directly.
//
// So a scheduled run *observes* instead: it records what it would have done and
// reports it, and a human decides. The promotion case is the sharpest one.
// decideActivationStatus returns ACTIVE on its own internal error, so an
// unattended promotion could fire from a failure path and publish a site nobody
// looked at. The nightly records `wouldPromoteTo` and promotes nothing.
//
// ---------------------------------------------------------------------------
// 2. A scheduled run's listings are replaced atomically, or not at all.
// ---------------------------------------------------------------------------
//
// The manual path deletes every listing, then re-inserts in chunks of 20, each
// chunk its own transaction. That is deliberate — the comment says progress
// should survive a timeout — and with someone watching, a partial result is
// useful. Unattended it is a data-loss mechanism: a failure between the delete
// and the last chunk leaves the site short, or empty, with nothing to repair it.
//
// The scheduled path does the delete and every insert in ONE transaction, so a
// rollback leaves the previous listings completely intact. The cost is stated
// rather than hidden: no per-chunk progress, and PARTIAL is not a reachable
// outcome for a scheduled run — it COMPLETES or it FAILS.

/** Prefix on every adminNote the activation gate writes. */
export const ACTIVATION_GATE_NOTE_PREFIX = "[activation-gate] ";

/**
 * Rows per `createMany`. Postgres caps a statement at 65,535 bind parameters
 * and Job has ~19 columns, so 500 rows is ~9,500 — well clear. The largest real
 * site (675 listings) needs two batches. Batching inside ONE transaction is
 * what keeps the replacement atomic.
 */
export const INSERT_BATCH = 500;

/**
 * Refuse to write more rows than this. 7x the largest site ever measured;
 * exceeding it means something is badly wrong — a pagination loop, a selector
 * matching the whole page — so the run aborts having deleted nothing. A cap
 * that refuses is safer than a transaction that dies halfway.
 */
export const MAX_ROWS = 5000;

/**
 * Prisma's interactive-transaction defaults are 5s timeout / 2s maxWait. Those
 * are the single biggest reason a "just wrap it in a transaction" fix passes in
 * dev and fails on the biggest site in production.
 */
export const TX_TIMEOUT_MS = 120_000;
export const TX_MAX_WAIT_MS = 10_000;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The undersize guard's thresholds: a site with at least `minPrevious` listings
 * whose new extraction is below `keepRatio` of them is refused.
 *
 * Overridable by SWEEP_DROP_MIN_PREVIOUS / SWEEP_DROP_KEEP_RATIO (sweepConfig),
 * which fall back to these on any malformed value — a NaN ratio would compare
 * false with every count and switch the guard off without a word.
 */
export type DropThresholds = { minPrevious: number; keepRatio: number };

// minPrevious 10. It was 3 for one night (2026-09-29, after biopharmax's 4 -> 1),
// and that refused ordinary churn on small sites — pac 5 -> 2 and bankhapoalim
// 6 -> 2, both real. What the lower floor was for, a selector that matches
// nothing, is refused by worker/lib/zeroMatch.ts instead.
export const DEFAULT_DROP_THRESHOLDS: DropThresholds = { minPrevious: 10, keepRatio: 0.5 };

/**
 * A new listing count that is a fraction of what the site had.
 *
 * 2026-09-15: maccabi4u's scheduled run extracted 8 listings where the site had
 * 433, and committed them as a success. A scrape returning a fraction of the
 * previous count is far likelier to be a broken page — a search form that no
 * longer submits, pagination that stopped — than 425 vacancies filled
 * overnight. Unattended, that is a site made worse. The manual path does not
 * ask: an operator who knows a drop is real accepts it by scraping by hand.
 */
export function isSuspiciousDrop(
  previousCount: number,
  newCount: number,
  thresholds: DropThresholds = DEFAULT_DROP_THRESHOLDS,
): boolean {
  return previousCount >= thresholds.minPrevious && newCount < previousCount * thresholds.keepRatio;
}

/**
 * The activation gate's description threshold (decideActivationStatus in
 * worker/jobs/scrape.ts reads it from here), and the line the fill guard below
 * will not let a scheduled run cross downwards.
 */
export const FIELD_FILL_THRESHOLD = 0.6;

/** How many rows carry a non-empty value for a field, out of how many. */
export type FillCount = { filled: number; total: number };

/**
 * A field that was filled at or above the threshold on the stored rows and is
 * below it on the rows this run would write.
 *
 * 2026-09-30: personetics' 12 per-job fetches all failed with
 * ERR_HTTP2_PROTOCOL_ERROR, and the scheduled run replaced 12 described rows
 * with 12 bare ones. The count guard cannot see that — 12 -> 12. Crossing the
 * line is what the activation gate would demote the site for, so an unattended
 * run does not publish it; a site that was below the line already is not made
 * worse by staying there. Nothing stored, or nothing new to measure, is no
 * verdict at all.
 */
export function isFieldFillDrop(
  previous: FillCount,
  next: FillCount,
  threshold: number = FIELD_FILL_THRESHOLD,
): boolean {
  if (previous.total <= 0 || next.total <= 0) return false;
  return previous.filled / previous.total >= threshold && next.filled / next.total < threshold;
}

/**
 * Rule A of the guard gap (owner, 2026-10-10): a scheduled write is refused when
 * description fill falls by 25 points or more against the stored rows, crossing
 * 60% or not. isFieldFillDrop judges only the crossing, so civi's 2026-10-08
 * night (3 stored at 100% -> 5 written at 60%) and tnuva's 2026-10-10 (100% ->
 * 67%) both committed. Replayed over the seven nights 2026-10-04..10, this
 * refuses those two and no ordinary night.
 */
export const FILL_FALL_POINTS = 0.25;

/** Description fill fell by at least FILL_FALL_POINTS. Nothing stored, or nothing new, is no verdict. */
export function isFieldFillFall(previous: FillCount, next: FillCount, points: number = FILL_FALL_POINTS): boolean {
  if (previous.total <= 0 || next.total <= 0) return false;
  // A small tolerance so 100% -> 75% counts as the 25 points it is.
  return previous.filled / previous.total - next.filled / next.total >= points - 1e-9;
}

/**
 * Rule B' of the guard gap (owner, 2026-10-10): a scheduled write is refused
 * when the listing_vs_saved_gap exceeds 25% of the cards, the stored count is at
 * least 10, and the run saved fewer than 90% of the stored count. The listing
 * showed the jobs and the run lost them: tnuva 2026-10-10 (110 stored, 100
 * cards, 60 saved) and avivim-hr 2026-10-06 (27 stored, 27 cards, 15 saved)
 * both committed under the 50% count line. The saved-share condition keeps a
 * standing gap with nothing lost (dreamjobs: ~540 cards, ~365 saved and
 * stored) from being refused. The gap is counted as the gap warning counts it,
 * dead detail pages accounted for (valueChecks.ts listingVsSavedGap).
 */
export const LISTING_GAP_RATIO = 0.25;
export const LISTING_GAP_MIN_STORED = 10;
export const LISTING_GAP_SAVED_RATIO = 0.9;

/** The listing's card count for the run, and its dead detail pages. */
export type ListingSeen = { cardsSeen: number | null; deadDetailPages: number };

/** The unaccounted cards, as listing_vs_saved_gap counts them; 0 when there is no gap. */
export function unaccountedCards(listing: ListingSeen, rowCount: number): number {
  if (listing.cardsSeen == null || listing.cardsSeen <= rowCount || rowCount <= 0) return 0;
  return Math.max(0, listing.cardsSeen - rowCount - Math.max(0, listing.deadDetailPages));
}

export function isListingGapDrop(listing: ListingSeen, rowCount: number, previousCount: number): boolean {
  if (listing.cardsSeen == null || listing.cardsSeen <= 0) return false;
  if (previousCount < LISTING_GAP_MIN_STORED) return false;
  const unaccounted = unaccountedCards(listing, rowCount);
  return unaccounted / listing.cardsSeen > LISTING_GAP_RATIO && rowCount < LISTING_GAP_SAVED_RATIO * previousCount;
}

/** One row's identity and description, stored or about to be written. */
export type DescribedRow = { externalJobId: string | null; description: string | null };

/** Stored jobs that had a description and would be written without one. */
export type DescribedLoss = { lost: string[]; storedDescribed: number };

/** Refused when at least this share of the stored described jobs is lost. */
export const DESCRIBED_LOSS_RATIO = 0.2;

const described = (d: string | null | undefined) => typeof d === "string" && d.trim().length > 0;

/**
 * The per-job side of the fill guard (owner, 2026-10-07). isFieldFillDrop
 * judges totals and only across 60%, so a site already below it (allegronet
 * 3/6 -> 0/6), a fall that stays above it, or a loss offset by new described
 * jobs all committed. Matched by externalJobId: a stored job with a description
 * whose new row has none is lost. A stored job no longer listed is not counted
 * — the count guards judge that — and a row without an id cannot be matched.
 */
export function describedJobsLost(stored: DescribedRow[], next: DescribedRow[]): DescribedLoss {
  const nextById = new Map<string, DescribedRow>();
  for (const r of next) if (r.externalJobId && !nextById.has(r.externalJobId)) nextById.set(r.externalJobId, r);
  const lost: string[] = [];
  let storedDescribed = 0;
  for (const r of stored) {
    if (!r.externalJobId || !described(r.description)) continue;
    storedDescribed++;
    const n = nextById.get(r.externalJobId);
    if (n && !described(n.description)) lost.push(r.externalJobId);
  }
  return { lost, storedDescribed };
}

/** At least one described job lost, and at least DESCRIBED_LOSS_RATIO of them. */
export function isDescribedJobsLoss(loss: DescribedLoss): boolean {
  return loss.lost.length >= 1 && loss.lost.length / loss.storedDescribed >= DESCRIBED_LOSS_RATIO;
}

export type PersistPlan =
  /** Nothing to write. Reported as `empty_results`; listings are left alone. */
  | { mode: "empty" }
  /** Implausibly many rows. Nothing is deleted and nothing written. */
  | { mode: "oversize"; rowCount: number; limit: number }
  /**
   * A fraction of the site's current listings (`ratio`), or a listing walk that
   * stopped short of pages the site offered (`pagination_truncated`, see
   * worker/lib/paginationGuard.ts). Nothing is deleted and nothing written.
   */
  | {
      mode: "suspicious_drop";
      reason: "ratio" | "pagination_truncated";
      rowCount: number;
      previousCount: number;
      thresholds: DropThresholds;
    }
  /** The listing showed the jobs and the run lost them (isListingGapDrop). */
  | {
      mode: "suspicious_drop";
      reason: "listing_gap";
      rowCount: number;
      previousCount: number;
      thresholds: DropThresholds;
      cardsSeen: number;
      unaccounted: number;
    }
  /**
   * The count held but a field's fill fell through FIELD_FILL_THRESHOLD
   * (isFieldFillDrop). Nothing is deleted and nothing written.
   */
  | {
      mode: "field_fill_drop";
      field: "description";
      /**
       * Which rule refused it, the first that holds: the fill crossed 60%
       * (isFieldFillDrop), fell 25 points or more (isFieldFillFall), or stored
       * described jobs would be written bare (isDescribedJobsLoss).
       */
      rule: "crossed_threshold" | "fell_points" | "described_lost";
      /** Fill as a fraction, 0..1. */
      previousFill: number;
      newFill: number;
      previous: FillCount;
      next: FillCount;
      rowCount: number;
      previousCount: number;
      /** Stored described jobs that would be written bare (describedJobsLost). */
      lost?: string[];
    }
  /** Delete + insert in one transaction, in this many `createMany` batches. */
  | { mode: "commit"; rowCount: number; batches: number };

/**
 * @param rowCount       rows this run would write
 * @param previousCount  the site's listings right now — what a commit would replace
 * @param walk           `paginationTruncated`: the listing walk stalled on a full
 *   page (isTruncatedWalk). Refused whatever the counts say — the unread pages'
 *   listings would be deleted, and 2026-09-24's 57 -> 30 cleared the ratio. A
 *   site with nothing stored loses nothing, so it still commits.
 * @param fill           description fill of the stored rows and of the rows this
 *   run would write. Refused when it crosses 60% (isFieldFillDrop), falls 25
 *   points or more crossing or not (isFieldFillFall), or stored described jobs
 *   would be written bare (isDescribedJobsLoss). Judged after the count
 *   refusals, so a 433 -> 8 is reported as the drop it is. Omitted, nothing is
 *   judged.
 * @param listing        the listing's card count and dead detail pages. Refused
 *   as a suspicious_drop (listing_gap) when the gap exceeds 25% of the cards,
 *   the stored count is at least 10 and the run saved under 90% of it
 *   (isListingGapDrop). Judged after the ratio, before the fill. Omitted, or
 *   with no card count, nothing is judged.
 */
export function planScheduledPersist(
  rowCount: number,
  previousCount: number,
  thresholds: DropThresholds = DEFAULT_DROP_THRESHOLDS,
  walk: { paginationTruncated: boolean } = { paginationTruncated: false },
  fill?: { description: { previous: FillCount; next: FillCount; lost?: DescribedLoss } },
  listing?: ListingSeen,
): PersistPlan {
  if (rowCount <= 0) return { mode: "empty" };
  if (rowCount > MAX_ROWS) return { mode: "oversize", rowCount, limit: MAX_ROWS };
  if (walk.paginationTruncated && previousCount > 0) {
    return { mode: "suspicious_drop", reason: "pagination_truncated", rowCount, previousCount, thresholds };
  }
  if (isSuspiciousDrop(previousCount, rowCount, thresholds)) {
    return { mode: "suspicious_drop", reason: "ratio", rowCount, previousCount, thresholds };
  }
  if (listing && isListingGapDrop(listing, rowCount, previousCount)) {
    return {
      mode: "suspicious_drop",
      reason: "listing_gap",
      rowCount,
      previousCount,
      thresholds,
      cardsSeen: listing.cardsSeen as number,
      unaccounted: unaccountedCards(listing, rowCount),
    };
  }
  const fillRule = !fill
    ? null
    : isFieldFillDrop(fill.description.previous, fill.description.next)
      ? "crossed_threshold"
      : isFieldFillFall(fill.description.previous, fill.description.next)
        ? "fell_points"
        : fill.description.lost !== undefined && isDescribedJobsLoss(fill.description.lost)
          ? "described_lost"
          : null;
  if (fill && fillRule) {
    const { previous, next, lost } = fill.description;
    return {
      mode: "field_fill_drop",
      field: "description",
      rule: fillRule,
      previousFill: previous.total > 0 ? previous.filled / previous.total : 0,
      newFill: next.total > 0 ? next.filled / next.total : 0,
      previous,
      next,
      rowCount,
      previousCount,
      ...(lost && lost.lost.length > 0 ? { lost: lost.lost } : {}),
    };
  }
  return { mode: "commit", rowCount, batches: Math.ceil(rowCount / INSERT_BATCH) };
}

/** Split rows into `size`-sized batches, preserving order. */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError(`chunkRows: size must be positive, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// The seven gated writes
// ---------------------------------------------------------------------------

/**
 * A site-mutating write the scheduled gate withheld. Returned on ScrapeResult
 * so the sweep can report it; nothing here is written to the Site row.
 */
export type WithheldWrite = {
  /** The site would have gone SKIPPED (login-gated apply flow). */
  wouldSkip?: string;
  /** The activation gate would have promoted the site. A human does that. */
  wouldPromoteTo?: "ACTIVE";
  /** The activation gate would have demoted the site. */
  wouldDemoteTo?: "REVIEW";
  /** The gate's own reason, so the report says why. */
  gateReason?: string;
};

export type SiteWriteDecision = {
  /** Apply the status / adminNote change to the Site row. */
  applySiteWrite: boolean;
  /** Delete the site's listings as part of this write. */
  deleteListings: boolean;
  /** Announce the status change over SSE. Only ever true when one happened. */
  emitStatusChange: boolean;
  /** What was withheld, for the run's result. Empty on a manual run. */
  withheld: WithheldWrite;
};

/**
 * `skipSiteForApplyLogin` — today: site → SKIPPED, adminNote overwritten.
 *
 * The flag is set at onboarding, so a scheduled run rediscovering it has
 * learned nothing new; SKIPPED is an operator's decision to record, not a
 * nightly's to take.
 */
export function planApplyLoginSkip(args: {
  scheduled: boolean;
  note: string;
}): SiteWriteDecision {
  if (!args.scheduled) {
    return {
      applySiteWrite: true,
      deleteListings: false,
      emitStatusChange: true,
      withheld: {},
    };
  }
  return {
    applySiteWrite: false,
    deleteListings: false,
    emitStatusChange: false,
    withheld: { wouldSkip: args.note },
  };
}

/**
 * `failScrapeRun` — today: deletes every listing, site → FAILED. Called from
 * three places (no field mappings, an escaped error, the timeout).
 *
 * A failed scrape is evidence about this attempt. It is not evidence that the
 * listings already stored are wrong, and deleting them publishes an empty
 * company page. The ScrapeRun is still closed FAILED either way — the failure
 * is recorded, just not acted on.
 *
 * Correcting a claim from an earlier revision of the plan: `empty_results` and
 * `structure_changed` do NOT already keep listings. That holds only for the two
 * early returns; categorizeError returns those same categories for *thrown*
 * errors, which reach here and delete.
 */
export function planScrapeFailure(args: { scheduled: boolean }): SiteWriteDecision {
  if (!args.scheduled) {
    return {
      applySiteWrite: true,
      deleteListings: true,
      emitStatusChange: true,
      withheld: {},
    };
  }
  return {
    applySiteWrite: false,
    deleteListings: false,
    emitStatusChange: false,
    withheld: {},
  };
}

/**
 * The activation gate — today: promotes to ACTIVE or demotes to REVIEW, and
 * overwrites adminNote on the way down.
 *
 * Scheduled runs record the verdict and move nothing. Selection includes REVIEW
 * sites, so the ACTIVE branch would publish a site to the public jobs site
 * unattended — and decideActivationStatus returns ACTIVE on its own internal
 * error, so that could fire from a failure path.
 *
 * `currentStatus` is passed so a verdict that matches where the site already is
 * reports nothing: "would promote an ACTIVE site to ACTIVE" is noise in a report
 * that is only useful if every line needs a human.
 */
export function planActivationGate(args: {
  scheduled: boolean;
  gateStatus: "ACTIVE" | "REVIEW";
  gateReason: string;
  currentStatus: string;
}): SiteWriteDecision {
  if (!args.scheduled) {
    return {
      applySiteWrite: true,
      deleteListings: false,
      emitStatusChange: true,
      withheld: {},
    };
  }

  const withheld: WithheldWrite = {};
  if (args.gateStatus !== args.currentStatus) {
    if (args.gateStatus === "ACTIVE") withheld.wouldPromoteTo = "ACTIVE";
    else withheld.wouldDemoteTo = "REVIEW";
    withheld.gateReason = args.gateReason;
  }

  return {
    applySiteWrite: false,
    deleteListings: false,
    emitStatusChange: false,
    withheld,
  };
}

/**
 * Whether the activation gate may overwrite `Site.adminNote`.
 *
 * The one manual-path behaviour this work changes, and deliberately: the gate
 * replaced whatever an operator had written there with its own reason, on every
 * run. That is a bug whether or not anyone is watching. A note the gate itself
 * wrote is fair game; an operator's is not.
 */
export function mayOverwriteAdminNote(current: string | null | undefined): boolean {
  if (current == null) return true;
  if (current.trim().length === 0) return true;
  return current.startsWith(ACTIVATION_GATE_NOTE_PREFIX);
}

/** Read the `scheduled` flag out of a SCRAPE job payload. Absent means manual. */
export function readScheduledFlag(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>).scheduled === true;
}

/**
 * The detail mode a SCRAPE job runs in (worker/lib/detailPlan.ts).
 *
 * "incremental" — carry unchanged jobs' detail text forward — only for a
 * payload that is ALSO scheduled, which only worker/sweep/nightly.ts writes.
 * Everything else is "full": the manual path always fetches every detail page,
 * and a malformed or ambiguous payload must fail towards fetching, never
 * towards publishing stored text as if it were tonight's.
 */
export function readDetailMode(payload: unknown): "full" | "incremental" {
  if (!readScheduledFlag(payload)) return "full";
  return (payload as Record<string, unknown>).detailMode === "incremental" ? "incremental" : "full";
}
