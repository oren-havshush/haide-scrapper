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
  /** Stop enqueueing after this many minutes of wall clock. Default 5h. */
  get maxRuntimeMinutes(): number {
    return parseInt(process.env.SWEEP_MAX_RUNTIME_MINUTES || "300", 10);
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
};

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

