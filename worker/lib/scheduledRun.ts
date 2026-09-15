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

export type PersistPlan =
  /** Nothing to write. Reported as `empty_results`; listings are left alone. */
  | { mode: "empty" }
  /** Implausibly many rows. Nothing is deleted and nothing written. */
  | { mode: "oversize"; rowCount: number; limit: number }
  /** A fraction of the site's current listings. Nothing is deleted and nothing written. */
  | {
      mode: "suspicious_drop";
      rowCount: number;
      previousCount: number;
      thresholds: DropThresholds;
    }
  /** Delete + insert in one transaction, in this many `createMany` batches. */
  | { mode: "commit"; rowCount: number; batches: number };

/**
 * @param rowCount       rows this run would write
 * @param previousCount  the site's listings right now — what a commit would replace
 */
export function planScheduledPersist(
  rowCount: number,
  previousCount: number,
  thresholds: DropThresholds = DEFAULT_DROP_THRESHOLDS,
): PersistPlan {
  if (rowCount <= 0) return { mode: "empty" };
  if (rowCount > MAX_ROWS) return { mode: "oversize", rowCount, limit: MAX_ROWS };
  if (isSuspiciousDrop(previousCount, rowCount, thresholds)) {
    return { mode: "suspicious_drop", rowCount, previousCount, thresholds };
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
