/**
 * addsite-qa.ts — per-site quality gate for /addsite (batch + standalone).
 *
 * Purpose (see addsite.md B2.6): make a batch onboard provably reach the same
 * quality as a careful solo run. Given a live site, it:
 *   1. Samples N scraped jobs and computes a fill-rate per normalized field.
 *   2. Probes ONE sample detail/apply URL to detect fields the page EXPOSES
 *      but the jobs are missing  -> `availableButUnmapped` (the Tier-B gaps a
 *      hard-remediation pass must close before ACTIVE).
 *   3. Classifies the apply path -> formStatus:
 *        CAPTURED   site has a non-empty formCapture
 *        NEEDS_MANUAL an on-page apply form/modal exists but wasn't captured
 *                     headlessly (run standalone Step 5b to attach it)
 *        EMAIL      mailto / applicationInfo email apply path
 *        URL        plain external apply URL / reachable detailUrl
 *        NONE       no apply path detected
 *   4. Emits a `qa` JSON (stdout as `QA <json>`, and to --out) including a v2
 *      `verdict` (ACTIVE | REQUEUE | REVIEW | SKIP, see §4a.2 taxonomy) and
 *      EXITS non-zero (2) when Tier-A is incomplete, so a caller can hard-stop.
 *
 * Tier-A (hard requirement, gates ACTIVE): title + externalJobId + description
 *   + a usable apply path (formStatus != NONE).
 * Tier-B (capture when the page exposes it): location, requirements,
 *   publishDate, department.
 *
 * Verdict (qa.verdict, docs/addsite2-migration.md §4a.2):
 *   ACTIVE  Tier-A complete + usable apply path, no gray-zone gaps.
 *   REQUEUE no jobs sampled (scrape pending/empty) — a re-scrape can change it.
 *   REVIEW  gray zone: on-page form not captured, Tier-B exposed-but-unmapped,
 *           suspected description-mapping miss, or inconclusive detail probe.
 *   SKIP    structural: Tier-A incomplete with no recoverable signal.
 *
 * Usage:
 *   npx tsx scripts/addsite-qa.ts --site-id <id> [--detail-url <url>]
 *        [--sample 10] [--stealth] [--ua "<userAgent>"] [--out <path>]
 *        [--min-fill 0.6] [--no-probe] [--verdict-exit]
 *
 * Exit codes (default, back-compat): 0 = Tier-A complete (ACTIVE); 2 = incomplete; 1 = error.
 * Exit codes (--verdict-exit): 0=ACTIVE, 2=SKIP, 3=REVIEW, 4=REQUEUE; 1=error.
 *
 * The core logic is also exported as `runQa(siteId, opts)` for use by
 * addsite-audit.ts and other callers that need a programmatic result rather
 * than a CLI exit code.
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const UA_DEFAULT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIER_A_FIELDS = ["title", "externalJobId", "description"] as const;
const TIER_B_FIELDS = ["location", "requirements", "publishDate", "department"] as const;
const ALL_FIELDS = [...TIER_A_FIELDS, ...TIER_B_FIELDS, "detailUrl", "applicationInfo"] as const;

export type FormStatus = "CAPTURED" | "NEEDS_MANUAL" | "EMAIL" | "URL" | "NONE";

// v2 failure taxonomy (docs/addsite2-migration.md §4a.2): the verdict is decided
// by *why* a site falls short, not a flat pass/fail — so a caller knows whether
// a retry can change the result (REQUEUE), a human should arbitrate (REVIEW), or
// a 2nd try just pays to fail twice (SKIP).
export type Verdict = "ACTIVE" | "REQUEUE" | "REVIEW" | "SKIP";

export interface QaRecord {
  siteId: string;
  sampled: number;
  fillRates: Record<string, number>;
  formStatus: FormStatus;
  formFields: number;
  applyResolution: string;
  availableButUnmapped: string[];
  manualFormUrl?: string;
  tierAComplete: boolean;
  tierAMissing: string[];
  // Correctness suspects (B-guardrails): present-but-wrong signals that
  // go to REVIEW even when Tier-A passes the fill-rate threshold.
  correctnessSuspects: string[];
  verdict: Verdict;
  verdictReason: string;
  probedUrl?: string;
  notes: string[];
}

export interface RunQaOptions {
  sample?: number;
  minFill?: number;
  stealth?: boolean;
  noProbe?: boolean;
  ua?: string;
  detailUrl?: string;
  outPath?: string;
  token: string;
}

// ---------------------------------------------------------------------------
// Verdict decision
// ---------------------------------------------------------------------------

/**
 * Map QA observations → §4a.2 verdict. Scope note: QA runs AFTER a scrape, so it
 * cannot see build-time transients (analyzer race, 429, busy worker) — those are
 * the batch driver's call during Pass B. The one transient QA *can* see is
 * "no jobs sampled yet" (scrape pending/empty), which it maps to REQUEUE.
 */
export function decideVerdict(args: {
  sampled: number;
  tierAComplete: boolean;
  tierAMissing: string[];
  formStatus: FormStatus;
  availableButUnmapped: string[];
  probeInconclusive: boolean;
  descMappingSuspect: boolean;
  correctnessSuspects: string[];
}): { verdict: Verdict; reason: string } {
  // 1. No data to judge → a re-scrape can still change the result.
  if (args.sampled === 0)
    return { verdict: "REQUEUE", reason: "no jobs sampled — scrape pending/empty; requeue once before judging" };

  // 2. Clean-ish pass — but check for correctness suspects first.
  if (args.tierAComplete) {
    if (args.formStatus === "NEEDS_MANUAL")
      return { verdict: "REVIEW", reason: "apply form exists on page but isn't captured — run Step 5b / arbitrate" };
    if (args.availableButUnmapped.length)
      return { verdict: "REVIEW", reason: `Tier-B exposed but unmapped: ${args.availableButUnmapped.join(", ")}` };
    // B-guardrail: presence-passing but data smells wrong
    if (args.correctnessSuspects.length)
      return { verdict: "REVIEW", reason: `correctness suspect (present but may be wrong): ${args.correctnessSuspects.join("; ")}` };
    return { verdict: "ACTIVE", reason: "Tier-A complete + usable apply path" };
  }

  // 3. Tier-A incomplete — recoverable (gray zone → REVIEW) vs structural (SKIP).
  if (args.formStatus === "NEEDS_MANUAL")
    return { verdict: "REVIEW", reason: "apply path missing but a form/modal exists on page — recoverable via Step 5b" };
  if (args.descMappingSuspect)
    return { verdict: "REVIEW", reason: "page has body text but description fill ~0 — likely a mapping miss, not missing data" };
  if (args.probeInconclusive)
    return { verdict: "REVIEW", reason: "no conclusive detail-page evidence (probe blocked / no detailUrl) — human eyes before SKIP" };

  // 4. Structural: incomplete with no recoverable signal → a 2nd try fails twice.
  return {
    verdict: "SKIP",
    reason: `structural: Tier-A incomplete (${args.tierAMissing.join(", ")}) with no recoverable apply/description signal`,
  };
}

// ---------------------------------------------------------------------------
// field value extraction (top-level OR rawData)
// ---------------------------------------------------------------------------

export function fieldValue(job: any, field: string): unknown {
  const raw = job?.rawData || {};
  switch (field) {
    case "description":
      return raw.description ?? job?.description;
    case "requirements":
      return raw.requirements ?? job?.requirements;
    case "location":
      return job?.location ?? raw.location;
    case "department":
      return job?.department ?? raw.department;
    case "publishDate":
      return job?.publishDate ?? raw.publishDate ?? raw.publishedAt;
    case "title":
      return job?.title ?? raw.title;
    case "externalJobId":
      return job?.externalJobId ?? raw.externalJobId;
    case "detailUrl":
      return job?.detailUrl ?? raw.detailUrl ?? job?.url;
    case "applicationInfo":
      return job?.applicationInfo ?? raw.applicationInfo;
    default:
      return job?.[field] ?? raw[field];
  }
}

export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export function looksLikeEmail(v: unknown): boolean {
  return typeof v === "string" && /mailto:|[\w.+-]+@[\w.-]+\.\w+/.test(v);
}
export function looksLikeUrl(v: unknown): boolean {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

/**
 * A captured apply FORM can live two equivalent ways (see addsite.md B1.6):
 *   - site-level `formCapture` (handled separately), OR
 *   - per-job `applicationInfo` holding a structured form object pulled from the
 *     detail page: { actionUrl, method, fields: [...] } (yes/career.yes.co.il).
 * `applicationInfo` may arrive as an object or a JSON string. Returns the field
 * count when it's a real form (>=2 fields), else 0.
 */
export function applicationFormFields(v: unknown): number {
  let obj: any = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s.startsWith("{")) return 0;
    try {
      obj = JSON.parse(s);
    } catch {
      return 0;
    }
  }
  if (obj && typeof obj === "object" && Array.isArray(obj.fields) && obj.fields.length >= 2) {
    return obj.fields.length;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// B-guardrail: correctness heuristics (presence-but-wrong signals)
// ---------------------------------------------------------------------------

/**
 * Derive the URL path slug from a detail URL (last non-empty path segment).
 * e.g. "https://site.co.il/jobs/my-job-title-123/" → "my-job-title-123"
 */
function detailUrlSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

/**
 * Slugify a string the way most CMS/WP platforms do: lowercase, replace
 * spaces/special chars with hyphens, collapse runs.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\u0080-\uFFFF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Compute correctness suspects for a sampled job set + optional probe result.
 * Returns an array of human-readable strings describing each suspect.
 *
 * Checks (all heuristic — any single signal is REVIEW, not SKIP):
 *
 * 1. Wrong-source externalJobId: IDs look like URL path slugs or title slugs
 *    rather than native numeric job-reference numbers (the proportsia miss).
 *    Signal: >50% of non-empty IDs contain hyphens AND match the detailUrl slug
 *    or a slugified form of the title. Suppressed when IDs are already numeric
 *    (that's fine) or prefixed h- (hash synthesis, fine).
 *
 * 2. Truncated description: description is present but very short (<120 chars
 *    average) while the detail probe body is long (>400 chars, already checked
 *    at probe time). Catches the "only the title/subtitle was mapped" miss.
 *
 * 3. Location not on detail page: location is present in the job record but
 *    the detail probe body text does not contain it. Catches cases where the
 *    analyzer mapped a generic site name or a field from the wrong element.
 *    Only flagged when probe succeeded and location is a non-trivial string (>3 chars).
 */
export function computeCorrectnessSuspects(
  jobs: any[],
  probe: { fieldsOnPage: Record<string, boolean>; detailBodyText?: string } | null,
): string[] {
  const suspects: string[] = [];
  const n = jobs.length;
  if (n === 0) return suspects;

  // --- 1. Wrong-source externalJobId ---
  const ids = jobs.map((j) => String(fieldValue(j, "externalJobId") ?? "").trim());
  const titles = jobs.map((j) => String(fieldValue(j, "title") ?? "").trim());
  const detailUrls = jobs.map((j) => String(fieldValue(j, "detailUrl") ?? "").trim());
  const nonEmptyIds = ids.filter(Boolean);
  if (nonEmptyIds.length > 0) {
    // IDs that are already numeric or hash-prefixed are always fine.
    const numericOrHash = nonEmptyIds.filter((id) => /^\d+$/.test(id) || /^h-[0-9a-f]{6,}$/i.test(id));
    if (numericOrHash.length < nonEmptyIds.length * 0.8) {
      // Check whether hyphenated IDs match their own URL slug or title slug.
      let slugMatches = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!id || !id.includes("-")) continue;
        const urlSlug = detailUrls[i] ? detailUrlSlug(detailUrls[i]) : "";
        const titleSlug = titles[i] ? slugify(titles[i]).slice(0, 60) : "";
        if (
          (urlSlug && (id === urlSlug || urlSlug.includes(id) || id.includes(urlSlug.slice(0, 15)))) ||
          (titleSlug && (id === titleSlug || titleSlug.startsWith(id.slice(0, 20))))
        ) {
          slugMatches++;
        }
      }
      if (slugMatches > nonEmptyIds.length * 0.5) {
        suspects.push(
          `externalJobId looks like URL/title slug (${slugMatches}/${nonEmptyIds.length} match) — ` +
            `check if a native numeric req-number exists on the listing/detail page`,
        );
      }
    }
  }

  // --- 2. Truncated description ---
  const descValues = jobs
    .map((j) => String(fieldValue(j, "description") ?? "").trim())
    .filter(Boolean);
  if (descValues.length > 0) {
    const avgLen = descValues.reduce((s, d) => s + d.length, 0) / descValues.length;
    // Detail probe already checked body length > 400 for fieldsOnPage.description.
    // If probe confirmed body text is long but our mapped descriptions are short:
    const probeHasBody = probe?.fieldsOnPage?.description === true;
    if (probeHasBody && avgLen < 120) {
      suspects.push(
        `description present but avg ${Math.round(avgLen)} chars while detail page body is >400 chars — ` +
          `likely only title/subtitle mapped, missing full job body`,
      );
    }
  }

  // --- 3. Location not found on detail page ---
  if (probe && probe.detailBodyText) {
    const bodyLower = probe.detailBodyText.toLowerCase();
    const locValues = jobs
      .map((j) => String(fieldValue(j, "location") ?? "").trim())
      .filter((l) => l.length > 3);
    if (locValues.length > 0) {
      // Check if majority of locations appear in the probed detail page body.
      const mismatches = locValues.filter((loc) => !bodyLower.includes(loc.toLowerCase()));
      if (mismatches.length > locValues.length * 0.7) {
        suspects.push(
          `location "${locValues[0]}" (and ${mismatches.length - 1} others) not found in detail page body — ` +
            `may be mapped from the wrong element or hardcoded incorrectly`,
        );
      }
    }
  }

  return suspects;
}

// ---------------------------------------------------------------------------
// detail-page field-presence probe (heuristic)
// ---------------------------------------------------------------------------

export async function probeDetail(
  url: string,
  stealth: boolean,
  ua: string,
): Promise<{
  fieldsOnPage: Record<string, boolean>;
  formCount: number;
  maxFormFields: number;
  modalApplyButton: boolean;
  mailto: boolean;
  externalApply: boolean;
  detailBodyText: string;
} | null> {
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }
  const b = await chromium.launch({
    headless: true,
    args: stealth ? ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--lang=he-IL"] : [],
  });
  try {
    const ctx = await b.newContext({
      locale: "he-IL",
      timezoneId: "Asia/Jerusalem",
      ...(stealth ? { userAgent: ua, viewport: { width: 1280, height: 800 } } : {}),
      extraHTTPHeaders: { "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
    });
    if (stealth) await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
    await p.waitForTimeout(1500);
    await p.addInitScript(() => ((globalThis as any).__name = (f: any) => f));
    await p.evaluate(() => ((globalThis as any).__name = (f: any) => f));
    const out = await p.evaluate(() => {
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
      const has = (re: RegExp) => re.test(bodyText);
      // Label-anchored heuristics (HE + EN). Conservative: require a label cue.
      const fieldsOnPage: Record<string, boolean> = {
        location: has(/מיקום|אזור|סניף|כתובת|עיר|location|city|region|based in/i),
        requirements: has(/דרישות|דרישות התפקיד|כישורים|מה אנחנו מחפשים|requirements|qualifications|what you.?ll need/i),
        publishDate: has(/תאריך פרסום|פורסם|תאריך|publish|posted on|date posted/i),
        department: has(/מחלקה|תחום|אגף|department|team|division/i),
        description: (document.body?.innerText || "").length > 400,
      };
      const APPLY = /apply|הגש|שלח|מועמד|קורות|cv|resume|הגשת מועמדות|להגשה|צרף/i;
      const forms = Array.from(document.querySelectorAll("form")).map((f) => {
        const fields = Array.from(f.querySelectorAll("input,select,textarea")).filter(
          (el) => !["hidden", "submit", "button", "reset", "image"].includes(el.getAttribute("type") || ""),
        );
        return fields.length;
      });
      const formCount = forms.length;
      const maxFormFields = forms.length ? Math.max(...forms) : 0;
      const applyEls = Array.from(document.querySelectorAll("a,button")).filter((el) =>
        APPLY.test((el.textContent || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.className || "")),
      );
      const modalApplyButton = applyEls.some((el) => {
        const href = el.getAttribute("href") || "";
        return el.tagName === "BUTTON" || href === "" || href === "#" || href.startsWith("javascript");
      });
      const externalApply = applyEls.some((el) => {
        const href = el.getAttribute("href") || "";
        return /^https?:\/\//i.test(href);
      });
      const mailto = !!document.querySelector('a[href^="mailto:"]');
      // Return a truncated body text for location-sanity check (max 8k chars).
      const detailBodyText = (document.body?.innerText || "").slice(0, 8000);
      return { fieldsOnPage, formCount, maxFormFields, modalApplyButton, mailto, externalApply, detailBodyText };
    });
    return out;
  } catch {
    return null;
  } finally {
    await b.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// core QA logic — exported for programmatic use by addsite-audit.ts
// ---------------------------------------------------------------------------

/**
 * Run quality-gate logic for a single site and return a QaRecord.
 * Does NOT write to stdout/stderr or call process.exit — callers do that.
 */
export async function runQa(siteId: string, opts: RunQaOptions): Promise<QaRecord> {
  const {
    sample = 10,
    minFill = 0.6,
    stealth = false,
    noProbe = false,
    ua = UA_DEFAULT,
    token,
  } = opts;
  let detailUrl = opts.detailUrl;

  const HEADERS: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const notes: string[] = [];

  // --- site config (formCapture + browserOverrides) ---
  const sr = await fetch(`${BASE}/api/sites?id=${encodeURIComponent(siteId)}`, { headers: HEADERS });
  const sj: any = await sr.json();
  const siteArr = Array.isArray(sj.data) ? sj.data : [sj.data];
  const site = siteArr.find((s: any) => s?.id === siteId) || siteArr[0] || null;
  if (!site) throw new Error(`site ${siteId} not found`);

  // formCapture + browserOverrides live on the /config endpoint (under .data),
  // NOT on the sites list response — read it from there.
  let cfgData: any = {};
  try {
    const cr = await fetch(`${BASE}/api/sites/${encodeURIComponent(siteId)}/config`, { headers: HEADERS });
    const cj: any = await cr.json();
    cfgData = cj.data || cj || {};
  } catch {
    notes.push("could not read /config endpoint — formCapture detection relied on job rawData only");
  }
  const formCapture = cfgData?.fieldMappings?._meta?.formCapture ?? cfgData?.formCapture;
  let hasFormCapture = !!(formCapture && Array.isArray(formCapture.fields) && formCapture.fields.length >= 1);
  const ovUa = cfgData?.fieldMappings?._meta?.browserOverrides?.userAgent || site.browserOverrides?.userAgent;

  // --- sample jobs ---
  const jr = await fetch(`${BASE}/api/jobs?siteId=${encodeURIComponent(siteId)}&pageSize=${sample}`, {
    headers: HEADERS,
  });
  const jj: any = await jr.json();
  const jobs: any[] = jj.data || [];
  const n = jobs.length;

  // The worker copies a captured form onto every job as rawData._formData. If
  // jobs carry it, the form IS live even if we couldn't re-read the config.
  let formDataFields = 0;
  for (const j of jobs) {
    const fd = j?.rawData?._formData;
    const parsed = typeof fd === "string" ? (() => { try { return JSON.parse(fd); } catch { return null; } })() : fd;
    if (parsed && Array.isArray(parsed.fields) && parsed.fields.length > formDataFields) formDataFields = parsed.fields.length;
  }
  if (!hasFormCapture && formDataFields >= 1) hasFormCapture = true;

  const fillRates: Record<string, number> = {};
  for (const f of ALL_FIELDS) {
    const hits = jobs.reduce((acc, j) => acc + (isPresent(fieldValue(j, f)) ? 1 : 0), 0);
    fillRates[f] = n ? +(hits / n).toFixed(2) : 0;
  }
  // per-job apply path presence (form OR email OR url OR detailUrl)
  const applyHits = jobs.reduce((acc, j) => {
    const raw = j.rawData || {};
    const formData = raw._formData;
    const ai = fieldValue(j, "applicationInfo");
    const du = fieldValue(j, "detailUrl");
    const usable = hasFormCapture || isPresent(formData) || isPresent(ai) || isPresent(du);
    return acc + (usable ? 1 : 0);
  }, 0);
  const applyRate = n ? +(applyHits / n).toFixed(2) : 0;

  // pick a detail url to probe if not supplied
  if (!detailUrl) {
    for (const j of jobs) {
      const du = fieldValue(j, "detailUrl");
      if (looksLikeUrl(du)) {
        detailUrl = du as string;
        break;
      }
    }
  }
  // detect email/url/structured-form apply across the sample
  const anyEmail = jobs.some((j) => looksLikeEmail(fieldValue(j, "applicationInfo")));
  const anyUrlApply = jobs.some(
    (j) => looksLikeUrl(fieldValue(j, "applicationInfo")) || looksLikeUrl(fieldValue(j, "detailUrl")),
  );
  // A structured applicationInfo form (detail-page <form>) is a captured form,
  // equivalent to site-level formCapture (see addsite.md B1.6, yes lesson).
  let appFormFields = 0;
  for (const j of jobs) {
    const c = applicationFormFields(fieldValue(j, "applicationInfo"));
    if (c > appFormFields) appFormFields = c;
  }
  if (!hasFormCapture && appFormFields >= 2) hasFormCapture = true;

  // --- probe one detail page for exposed-but-unmapped fields + apply form ---
  const availableButUnmapped: string[] = [];
  let probe: Awaited<ReturnType<typeof probeDetail>> = null;
  let probedUrl: string | undefined;
  let descMappingSuspect = false;
  if (!noProbe && detailUrl) {
    probedUrl = detailUrl;
    probe = await probeDetail(detailUrl, stealth || !!ovUa, ovUa || ua);
    if (!probe) {
      notes.push("detail probe unavailable (playwright missing or page blocked) — relied on job sample only");
    } else {
      for (const f of TIER_B_FIELDS) {
        if (probe.fieldsOnPage[f] && fillRates[f] < 0.2) availableButUnmapped.push(f);
      }
      // description is Tier-A but also worth flagging if page has it and jobs don't
      if (probe.fieldsOnPage.description && fillRates.description < 0.2) {
        descMappingSuspect = true;
        notes.push("detail page has body text but description fill-rate is ~0 — check description mapping");
      }
    }
  } else if (!detailUrl) {
    notes.push("no sample detailUrl available — skipped detail-page audit (single-page site or detailUrl unmapped)");
  }
  // We wanted detail-page evidence but got none (probe blocked, or no detailUrl):
  // can't prove a shortfall is structural, so don't let it harden into SKIP.
  const probeInconclusive = !noProbe && !probe;

  // --- B-guardrail: correctness suspects ---
  const correctnessSuspects = computeCorrectnessSuspects(jobs, probe);
  if (correctnessSuspects.length) {
    notes.push(...correctnessSuspects.map((s) => `correctness suspect: ${s}`));
  }

  // --- classify apply path / formStatus ---
  let formStatus: FormStatus;
  let manualFormUrl: string | undefined;
  const formFields = formCapture?.fields?.length || formDataFields || appFormFields || 0;
  if (hasFormCapture) {
    formStatus = "CAPTURED";
  } else if (probe && (probe.maxFormFields >= 3 || probe.modalApplyButton)) {
    formStatus = "NEEDS_MANUAL";
    manualFormUrl = probedUrl;
  } else if (anyEmail) {
    formStatus = "EMAIL";
  } else if (anyUrlApply || (probe && probe.externalApply)) {
    formStatus = "URL";
  } else {
    formStatus = "NONE";
  }
  const applyResolution = formStatus.toLowerCase();

  // --- Tier-A verdict ---
  const tierAMissing: string[] = [];
  for (const f of TIER_A_FIELDS) {
    if (fillRates[f] < minFill) tierAMissing.push(f);
  }
  const hasUsableApply = formStatus !== "NONE" && applyRate > 0;
  if (!hasUsableApply) tierAMissing.push("applyPath");
  const tierAComplete = tierAMissing.length === 0;

  const { verdict, reason: verdictReason } = decideVerdict({
    sampled: n,
    tierAComplete,
    tierAMissing,
    formStatus,
    availableButUnmapped,
    probeInconclusive,
    descMappingSuspect,
    correctnessSuspects,
  });

  const qa: QaRecord = {
    siteId,
    sampled: n,
    fillRates,
    formStatus,
    formFields,
    applyResolution,
    availableButUnmapped,
    ...(manualFormUrl ? { manualFormUrl } : {}),
    tierAComplete,
    tierAMissing,
    correctnessSuspects,
    verdict,
    verdictReason,
    ...(probedUrl ? { probedUrl } : {}),
    notes,
  };

  if (opts.outPath) {
    fs.mkdirSync(path.dirname(path.resolve(opts.outPath)), { recursive: true });
    fs.writeFileSync(opts.outPath, JSON.stringify(qa, null, 2), "utf8");
  }

  return qa;
}

// ---------------------------------------------------------------------------
// CLI entry point (thin wrapper — preserves existing behaviour exactly)
// ---------------------------------------------------------------------------

function cliArg(name: string): string | undefined {
  const pre = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === pre) return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "true";
    if (a.startsWith(pre + "=")) return a.slice(pre.length + 1);
  }
  return undefined;
}
function cliHasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readToken(): string {
  const t = fs.readFileSync(path.resolve(".claude", "scrap-token"), "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

async function main() {
  const siteId = cliArg("site-id");
  if (!siteId) throw new Error("--site-id is required");

  const qa = await runQa(siteId, {
    sample: parseInt(cliArg("sample") || "10", 10),
    minFill: parseFloat(cliArg("min-fill") || "0.6"),
    stealth: cliHasFlag("stealth"),
    noProbe: cliHasFlag("no-probe"),
    ua: cliArg("ua"),
    detailUrl: cliArg("detail-url"),
    outPath: cliArg("out"),
    token: readToken(),
  });

  console.log(`QA ${JSON.stringify(qa)}`);

  // human-readable tail to stderr (keeps stdout machine-parseable)
  const applyRate = qa.fillRates["applicationInfo"] ?? 0;
  console.error(
    [
      ``,
      `── QA for ${siteId} (sampled ${qa.sampled}) ──`,
      `  verdict:    ${qa.verdict}  (${qa.verdictReason})`,
      `  formStatus: ${qa.formStatus}${qa.manualFormUrl ? `  (run step 5b ${qa.manualFormUrl})` : ""}`,
      `  applyRate:  ${applyRate}`,
      `  Tier-A:     ${qa.tierAComplete ? "COMPLETE" : "INCOMPLETE -> " + qa.tierAMissing.join(", ")}`,
      `  Tier-B gaps (page exposes, jobs missing): ${qa.availableButUnmapped.length ? qa.availableButUnmapped.join(", ") : "none"}`,
      ...(qa.correctnessSuspects.length ? [`  correctness suspects: ${qa.correctnessSuspects.join(" | ")}`] : []),
      `  fillRates:  ${ALL_FIELDS.map((f) => `${f}=${qa.fillRates[f]}`).join("  ")}`,
      ...qa.notes.map((x) => `  note: ${x}`),
      ``,
    ].join("\n"),
  );

  // Exit contract:
  //   default (back-compat): 0 = Tier-A complete (ACTIVE), 2 = anything else.
  //   --verdict-exit (v2 pipeline): 0=ACTIVE, 2=SKIP, 3=REVIEW, 4=REQUEUE.
  if (cliHasFlag("verdict-exit")) {
    const code = qa.verdict === "ACTIVE" ? 0 : qa.verdict === "SKIP" ? 2 : qa.verdict === "REVIEW" ? 3 : 4;
    process.exit(code);
  }
  process.exit(qa.tierAComplete ? 0 : 2);
}

main().catch((e) => {
  console.error(`[qa] ERROR: ${(e as Error).message}`);
  process.exit(1);
});
