export const config = {
  get apiToken(): string {
    const token = process.env.API_TOKEN;
    if (!token) throw new Error("API_TOKEN environment variable is required");
    return token;
  },
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is required");
    return url;
  },
};

// ---------------------------------------------------------------------------
// Nightly sweep configuration
// ---------------------------------------------------------------------------
//
// Every var here needs a matching line in the `worker` service's `environment:`
// block in docker-compose.yml. That block enumerates variables explicitly and
// there is no `env_file`, so a var set in the server's .env does NOT reach the
// worker without being listed — and the sweep's systemd units inherit the same
// block.

export const sweepConfig = {
  /** The kill switch. Set SWEEP_ENABLED=false to stop the timer doing anything. */
  get enabled(): boolean {
    return process.env.SWEEP_ENABLED !== "false";
  },
  /** Timezone for the nightly's date label and verdict line. */
  get timezone(): string {
    return process.env.SWEEP_TZ || "Asia/Jerusalem";
  },
  /** A site is due when its last SUCCESS is older than this. Default 20h. */
  get freshWindowHours(): number {
    return parseInt(process.env.SWEEP_FRESH_WINDOW_HOURS || "20", 10);
  },
  /**
   * Stop enqueueing after this many minutes of wall clock. Default 260 (4h20m).
   *
   * Sized against the deadline that actually matters: the scrape timer fires at
   * 02:00 and the public jobs site reads this database directly at 07:01, so
   * the night's work has to be finished and settled before 07:00. 260 minutes
   * ends enqueueing at 06:20, leaving the last site's 18-minute per-site budget
   * and the report to land inside the hour. The previous 300 ran to 07:00
   * exactly — on a slow night the final site would still have been writing
   * while the public site was reading.
   */
  get maxRuntimeMinutes(): number {
    return parseInt(process.env.SWEEP_MAX_RUNTIME_MINUTES || "260", 10);
  },
  /** How long to wait for one site's run to reach a terminal state. Default 18m. */
  get perSiteTimeoutMinutes(): number {
    return parseInt(process.env.SWEEP_PER_SITE_TIMEOUT_MINUTES || "18", 10);
  },
  /** Cap on policy checks per night. Steady state is ~2; the cap bites on a catch-up. */
  get policyMaxPerNight(): number {
    return parseInt(process.env.SWEEP_POLICY_MAX_PER_NIGHT || "25", 10);
  },
  /** Poll interval while waiting on a run. Default 5s. */
  get pollIntervalMs(): number {
    return parseInt(process.env.SWEEP_POLL_INTERVAL_MS || "5000", 10);
  },
  /**
   * Undersize guard: only a site with at least this many listings can be
   * refused for a drop. Default 10. Read by the WORKER (scrape.ts), not only
   * the sweep driver, so it must be in the worker's compose environment block.
   */
  get dropMinPrevious(): number {
    return strictNumber(process.env.SWEEP_DROP_MIN_PREVIOUS, 10, (n) => Number.isInteger(n) && n >= 1);
  },
  /** Undersize guard: refuse a new count below this share of the previous one. Default 0.5. */
  get dropKeepRatio(): number {
    return strictNumber(process.env.SWEEP_DROP_KEEP_RATIO, 0.5, (n) => n > 0 && n <= 1);
  },
};

/**
 * A number from the environment, or the default when the value is absent or
 * anything but a clean, in-range number. Stricter than parseInt/parseFloat on
 * purpose: "0.5abc" is a typo, not 0.5, and a guard threshold that silently
 * became NaN would compare false with every count and refuse nothing.
 */
function strictNumber(raw: string | undefined, fallback: number, valid: (n: number) => boolean): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && valid(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Policy Review configuration
// ---------------------------------------------------------------------------

export const policyConfig = {
  /** Enable or disable policy review jobs entirely. Default: true. */
  get enabled(): boolean {
    return process.env.ENABLE_POLICY_REVIEW !== "false";
  },
  /** OpenAI model for policy classification. Default: gpt-4o-mini. */
  get model(): string {
    return process.env.POLICY_REVIEW_MODEL || "gpt-4o-mini";
  },
  /** How many days before a policy check is considered stale and should be re-checked. Default: 90. */
  get recheckIntervalDays(): number {
    return parseInt(process.env.POLICY_RECHECK_INTERVAL_DAYS || "90", 10);
  },
  /** Max number of policy pages to fetch per site. Default: 4. */
  get maxPolicyPagesPerSite(): number {
    return parseInt(process.env.MAX_POLICY_PAGES_PER_SITE || "4", 10);
  },
  /** Timeout for the full policy job in seconds. Default: 120. */
  get maxPolicyFetchSeconds(): number {
    return parseInt(process.env.MAX_POLICY_FETCH_SECONDS || "120", 10);
  },
  /** Max LLM token budget per site (characters of cleaned text sent). Default: 12000 chars. */
  get maxLlmCharsPerSite(): number {
    return parseInt(process.env.MAX_POLICY_LLM_CHARS || "12000", 10);
  },
  /** Delay in ms between worker policy jobs to rate-limit. Default: 2000ms. */
  get jobDelayMs(): number {
    return parseInt(process.env.POLICY_JOB_DELAY_MS || "2000", 10);
  },
  /** Whether to fetch robots.txt and use it as a secondary signal. Default: true. */
  get enableRobots(): boolean {
    return process.env.ENABLE_POLICY_ROBOTS !== "false";
  },
  /** Whether a broad robots.txt Disallow can downgrade NO_EXPLICIT_RESTRICTION to UNCLEAR_NEEDS_REVIEW. Default: true. */
  get robotsInfluencesStatus(): boolean {
    return process.env.ROBOTS_INFLUENCES_STATUS !== "false";
  },
  /** Whether unclear/needs-review sites should be flagged for manual review (future Phase 4). Default: true. */
  get requireManualReviewForUnclear(): boolean {
    return process.env.REQUIRE_MANUAL_REVIEW_FOR_UNCLEAR !== "false";
  },
  /** Whether policy-not-found sites should be flagged for manual review (future Phase 4). Default: false. */
  get requireManualReviewForPolicyNotFound(): boolean {
    return process.env.REQUIRE_MANUAL_REVIEW_FOR_POLICY_NOT_FOUND === "true";
  },
  // --- Deferred / Phase 4 flags (stubbed off) ---
  /** [Phase 4] Automatically skip RESTRICTED sites. Default: false. */
  get autoSkipRestrictedSites(): boolean {
    return process.env.AUTO_SKIP_RESTRICTED_SITES === "true";
  },
  /** [Future] Enable external search-engine fallback. Default: false. */
  get enableExternalSearch(): boolean {
    return process.env.ENABLE_POLICY_EXTERNAL_SEARCH === "true";
  },
  /** [Future] Include sitemap.xml in discovery. Default: false. */
  get enableSitemapDiscovery(): boolean {
    return process.env.ENABLE_POLICY_SITEMAP === "true";
  },
};

