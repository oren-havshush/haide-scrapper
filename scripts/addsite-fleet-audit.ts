/**
 * addsite-fleet-audit.ts — READ-ONLY quality audit of the live ACTIVE fleet.
 *
 * Purpose (see docs/addsite2-migration.md §7a): introducing addsite2 changes
 * nothing for already-onboarded sites (the worker scrapes from stored config,
 * skill-agnostic), but the new quality bar EXPOSES legacy sites that shipped
 * below it (formCapture:null, no description, etc.). This script measures that
 * gap so we can triage fixes by value — and produces the business case for
 * addsite2's first validation batch.
 *
 * It is a fast, single-process, NO-MUTATION audit:
 *   - pages all sites with pageSize<=100 (LRN-API-1: >100 silently returns []),
 *   - filters status === "ACTIVE",
 *   - per site: GET /config (formCapture) + a small jobs sample, computes a
 *     lightweight QA verdict (fill-rates + formStatus + Tier-A) WITHOUT a
 *     per-site browser probe (so it scales to the whole fleet cheaply),
 *   - writes .scratch/fleet-audit.csv and prints aggregate headline numbers.
 *
 * Usage: npx tsx scripts/addsite-fleet-audit.ts [--sample 8] [--out <csv>] [--min-fill 0.6]
 *
 * Read-only: only GET requests. Safe to run anytime.
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const TIER_A = ["title", "description"] as const; // externalJobId is dedup-only; not a usefulness signal
const TIER_B = ["location", "requirements", "publishDate", "department"] as const;
const ALL_FIELDS = [
  "title",
  "description",
  "location",
  "requirements",
  "publishDate",
  "department",
  "externalJobId",
  "detailUrl",
  "applicationInfo",
] as const;

function arg(name: string, def?: string): string | undefined {
  const pre = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === pre) return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "true";
    if (a.startsWith(pre + "=")) return a.slice(pre.length + 1);
  }
  return def;
}

function token(): string {
  const t = fs.readFileSync(path.resolve(".claude", "scrap-token"), "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

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
  if (obj && typeof obj === "object" && Array.isArray(obj.fields) && obj.fields.length >= 2) return obj.fields.length;
  return 0;
}

interface SiteRow {
  id: string;
  url: string;
  jobCount: number;
  sampled: number;
  formStatus: "CAPTURED" | "EMAIL" | "URL" | "NONE";
  formFields: number;
  fill: Record<string, number>;
  tierAComplete: boolean;
  tierAMissing: string[];
  bucket: "OK" | "TIER_B_GAPS" | "BROKEN";
  hasBrowserOverrides: boolean;
}

async function main() {
  const sample = parseInt(arg("sample", "8")!, 10);
  const minFill = parseFloat(arg("min-fill", "0.6")!);
  const outPath = arg("out", ".scratch/fleet-audit.csv")!;
  const HEADERS = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };

  // --- page all sites (pageSize<=100; walk meta.total) ---
  const PAGE_SIZE = 100;
  let page = 1;
  let total = Infinity;
  const sites: Array<{ id: string; siteUrl?: string; status?: string }> = [];
  while (sites.length < total) {
    const r = await fetch(`${BASE}/api/sites?pageSize=${PAGE_SIZE}&page=${page}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`GET /api/sites page ${page} → ${r.status}`);
    const j: any = await r.json();
    const data: any[] = j.data || [];
    if (j.meta && typeof j.meta.total === "number") total = j.meta.total;
    if (!data.length) break;
    for (const s of data) sites.push({ id: s.id, siteUrl: s.siteUrl, status: s.status });
    process.stderr.write(`\r[fleet-audit] fetched ${sites.length}${isFinite(total) ? "/" + total : ""} sites...`);
    page++;
    if (page > 100) break; // hard safety
  }
  process.stderr.write("\n");

  const active = sites.filter((s) => s.status === "ACTIVE");
  console.error(`[fleet-audit] ${sites.length} sites total · ${active.length} ACTIVE → auditing...`);

  const rows: SiteRow[] = [];
  let done = 0;
  for (const s of active) {
    done++;
    process.stderr.write(`\r[fleet-audit] auditing ${done}/${active.length} (${s.id})        `);
    try {
      // config (formCapture / browserOverrides)
      let cfg: any = {};
      try {
        const cr = await fetch(`${BASE}/api/sites/${encodeURIComponent(s.id)}/config`, { headers: HEADERS });
        const cj: any = await cr.json();
        cfg = cj.data || cj || {};
      } catch {
        /* ignore */
      }
      const formCapture = cfg.formCapture;
      let hasFormCapture = !!(formCapture && Array.isArray(formCapture.fields) && formCapture.fields.length >= 1);
      const hasBrowserOverrides = !!cfg.browserOverrides;

      // jobs sample
      const jr = await fetch(`${BASE}/api/jobs?siteId=${encodeURIComponent(s.id)}&pageSize=${sample}`, {
        headers: HEADERS,
      });
      const jj: any = await jr.json();
      const jobs: any[] = jj.data || [];
      const jobCount = (jj.meta && typeof jj.meta.total === "number") ? jj.meta.total : jobs.length;
      const n = jobs.length;

      let formDataFields = 0;
      let appFormFields = 0;
      for (const j of jobs) {
        const fd = j?.rawData?._formData;
        if (fd && Array.isArray(fd.fields) && fd.fields.length > formDataFields) formDataFields = fd.fields.length;
        const c = applicationFormFields(fieldValue(j, "applicationInfo"));
        if (c > appFormFields) appFormFields = c;
      }
      if (!hasFormCapture && (formDataFields >= 1 || appFormFields >= 2)) hasFormCapture = true;

      const fill: Record<string, number> = {};
      for (const f of ALL_FIELDS) {
        const hits = jobs.reduce((acc, j) => acc + (isPresent(fieldValue(j, f)) ? 1 : 0), 0);
        fill[f] = n ? +(hits / n).toFixed(2) : 0;
      }

      const anyEmail = jobs.some((j) => looksLikeEmail(fieldValue(j, "applicationInfo")));
      const anyUrl = jobs.some(
        (j) => looksLikeUrl(fieldValue(j, "applicationInfo")) || looksLikeUrl(fieldValue(j, "detailUrl")),
      );
      let formStatus: SiteRow["formStatus"];
      if (hasFormCapture) formStatus = "CAPTURED";
      else if (anyEmail) formStatus = "EMAIL";
      else if (anyUrl) formStatus = "URL";
      else formStatus = "NONE";
      const formFields = formCapture?.fields?.length || formDataFields || appFormFields || 0;

      const tierAMissing: string[] = [];
      for (const f of TIER_A) if (fill[f] < minFill) tierAMissing.push(f);
      if (formStatus === "NONE") tierAMissing.push("applyPath");
      const tierAComplete = tierAMissing.length === 0;

      // Tier-B gaps: jobs missing a Tier-B field entirely (heuristic — without a
      // page probe we can't prove the page exposes it, so this is "low fill").
      const tierBLow = TIER_B.filter((f) => fill[f] < 0.2);

      const bucket: SiteRow["bucket"] = !tierAComplete ? "BROKEN" : tierBLow.length ? "TIER_B_GAPS" : "OK";

      rows.push({
        id: s.id,
        url: s.siteUrl || "",
        jobCount,
        sampled: n,
        formStatus,
        formFields,
        fill,
        tierAComplete,
        tierAMissing,
        bucket,
        hasBrowserOverrides,
      });
    } catch (e) {
      rows.push({
        id: s.id,
        url: s.siteUrl || "",
        jobCount: 0,
        sampled: 0,
        formStatus: "NONE",
        formFields: 0,
        fill: {},
        tierAComplete: false,
        tierAMissing: ["AUDIT_ERROR:" + (e as Error).message.slice(0, 40)],
        bucket: "BROKEN",
        hasBrowserOverrides: false,
      });
    }
  }
  process.stderr.write("\n");

  // --- write CSV ---
  const header = [
    "siteId",
    "url",
    "jobCount",
    "sampled",
    "bucket",
    "formStatus",
    "formFields",
    "tierAComplete",
    "tierAMissing",
    "browserOverrides",
    ...ALL_FIELDS.map((f) => `fill_${f}`),
  ];
  const csvLines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.id,
      `"${(r.url || "").replace(/"/g, '""')}"`,
      r.jobCount,
      r.sampled,
      r.bucket,
      r.formStatus,
      r.formFields,
      r.tierAComplete,
      `"${r.tierAMissing.join("; ")}"`,
      r.hasBrowserOverrides,
      ...ALL_FIELDS.map((f) => r.fill[f] ?? 0),
    ];
    csvLines.push(cells.join(","));
  }
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, csvLines.join("\n") + "\n", "utf8");

  // --- aggregate headline numbers ---
  const nA = rows.length;
  const pct = (x: number) => (nA ? Math.round((x / nA) * 100) : 0);
  const ok = rows.filter((r) => r.bucket === "OK").length;
  const tierB = rows.filter((r) => r.bucket === "TIER_B_GAPS").length;
  const broken = rows.filter((r) => r.bucket === "BROKEN").length;
  const noForm = rows.filter((r) => r.formStatus === "NONE").length;
  const captured = rows.filter((r) => r.formStatus === "CAPTURED").length;
  const email = rows.filter((r) => r.formStatus === "EMAIL").length;
  const urlApply = rows.filter((r) => r.formStatus === "URL").length;
  const noDesc = rows.filter((r) => (r.fill.description ?? 0) < minFill).length;
  const tierAIncomplete = rows.filter((r) => !r.tierAComplete).length;

  const out: string[] = [];
  out.push("");
  out.push("=".repeat(64));
  out.push(`FLEET AUDIT — ${nA} ACTIVE sites (read-only)`);
  out.push("=".repeat(64));
  out.push(`  buckets:`);
  out.push(`    OK (Tier-A complete, Tier-B filled)   ${ok}  (${pct(ok)}%)`);
  out.push(`    TIER_B_GAPS (usable, missing B fields) ${tierB}  (${pct(tierB)}%)`);
  out.push(`    BROKEN (Tier-A incomplete)             ${broken}  (${pct(broken)}%)`);
  out.push(`  apply path:`);
  out.push(`    CAPTURED form   ${captured}  (${pct(captured)}%)`);
  out.push(`    EMAIL           ${email}  (${pct(email)}%)`);
  out.push(`    URL             ${urlApply}  (${pct(urlApply)}%)`);
  out.push(`    NONE            ${noForm}  (${pct(noForm)}%)   <- the business case for addsite2`);
  out.push(`  quality flags:`);
  out.push(`    no/low description   ${noDesc}  (${pct(noDesc)}%)`);
  out.push(`    Tier-A incomplete    ${tierAIncomplete}  (${pct(tierAIncomplete)}%)`);
  out.push("=".repeat(64));
  out.push(`  CSV: ${path.resolve(outPath)}`);
  out.push("");
  console.log(out.join("\n"));
}

main().catch((e) => {
  console.error(`\n[fleet-audit] ERROR: ${(e as Error).message}`);
  process.exit(1);
});
