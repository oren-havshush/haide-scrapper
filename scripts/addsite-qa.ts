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
 *   4. Emits a `qa` JSON (stdout as `QA <json>`, and to --out) and EXITS
 *      non-zero (2) when Tier-A is incomplete, so a caller can hard-stop.
 *
 * Tier-A (hard requirement, gates ACTIVE): title + externalJobId + description
 *   + a usable apply path (formStatus != NONE).
 * Tier-B (capture when the page exposes it): location, requirements,
 *   publishDate, department.
 *
 * Usage:
 *   npx tsx scripts/addsite-qa.ts --site-id <id> [--detail-url <url>]
 *        [--sample 10] [--stealth] [--ua "<userAgent>"] [--out <path>]
 *        [--min-fill 0.6] [--no-probe]
 *
 * Exit codes: 0 = Tier-A complete; 2 = Tier-A incomplete; 1 = hard error.
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const UA_DEFAULT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIER_A_FIELDS = ["title", "externalJobId", "description"] as const;
const TIER_B_FIELDS = ["location", "requirements", "publishDate", "department"] as const;
const ALL_FIELDS = [...TIER_A_FIELDS, ...TIER_B_FIELDS, "detailUrl", "applicationInfo"] as const;

type FormStatus = "CAPTURED" | "NEEDS_MANUAL" | "EMAIL" | "URL" | "NONE";

interface QaRecord {
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
  probedUrl?: string;
  notes: string[];
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const pre = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === pre) return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "true";
    if (a.startsWith(pre + "=")) return a.slice(pre.length + 1);
  }
  return undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function token(): string {
  const t = fs.readFileSync(path.resolve(".claude", "scrap-token"), "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

// ---------------------------------------------------------------------------
// field value extraction (top-level OR rawData)
// ---------------------------------------------------------------------------

function fieldValue(job: any, field: string): unknown {
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

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function looksLikeEmail(v: unknown): boolean {
  return typeof v === "string" && /mailto:|[\w.+-]+@[\w.-]+\.\w+/.test(v);
}
function looksLikeUrl(v: unknown): boolean {
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
function applicationFormFields(v: unknown): number {
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
// detail-page field-presence probe (heuristic)
// ---------------------------------------------------------------------------

async function probeDetail(
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
      return { fieldsOnPage, formCount, maxFormFields, modalApplyButton, mailto, externalApply };
    });
    return out;
  } catch {
    return null;
  } finally {
    await b.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const siteId = arg("site-id");
  if (!siteId) throw new Error("--site-id is required");
  const sample = parseInt(arg("sample") || "10", 10);
  const minFill = parseFloat(arg("min-fill") || "0.6");
  const stealth = hasFlag("stealth");
  const noProbe = hasFlag("no-probe");
  const ua = arg("ua") || UA_DEFAULT;
  const outPath = arg("out");
  let detailUrl = arg("detail-url");

  const HEADERS: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
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
  const formCapture = cfgData.formCapture;
  let hasFormCapture = !!(formCapture && Array.isArray(formCapture.fields) && formCapture.fields.length >= 1);
  const ovUa = cfgData.browserOverrides?.userAgent || site.browserOverrides?.userAgent;

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
    if (fd && Array.isArray(fd.fields) && fd.fields.length > formDataFields) formDataFields = fd.fields.length;
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
  let availableButUnmapped: string[] = [];
  let probe: Awaited<ReturnType<typeof probeDetail>> = null;
  let probedUrl: string | undefined;
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
        notes.push("detail page has body text but description fill-rate is ~0 — check description mapping");
      }
    }
  } else if (!detailUrl) {
    notes.push("no sample detailUrl available — skipped detail-page audit (single-page site or detailUrl unmapped)");
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
    ...(probedUrl ? { probedUrl } : {}),
    notes,
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(qa, null, 2), "utf8");
  }
  console.log(`QA ${JSON.stringify(qa)}`);

  // human-readable tail to stderr (keeps stdout machine-parseable)
  console.error(
    [
      ``,
      `── QA for ${siteId} (sampled ${n}) ──`,
      `  formStatus: ${formStatus}${manualFormUrl ? `  (run step 5b ${manualFormUrl})` : ""}`,
      `  applyRate:  ${applyRate}`,
      `  Tier-A:     ${tierAComplete ? "COMPLETE" : "INCOMPLETE -> " + tierAMissing.join(", ")}`,
      `  Tier-B gaps (page exposes, jobs missing): ${availableButUnmapped.length ? availableButUnmapped.join(", ") : "none"}`,
      `  fillRates:  ${ALL_FIELDS.map((f) => `${f}=${fillRates[f]}`).join("  ")}`,
      ...notes.map((x) => `  note: ${x}`),
      ``,
    ].join("\n"),
  );

  process.exit(tierAComplete ? 0 : 2);
}

main().catch((e) => {
  console.error(`[qa] ERROR: ${(e as Error).message}`);
  process.exit(1);
});
