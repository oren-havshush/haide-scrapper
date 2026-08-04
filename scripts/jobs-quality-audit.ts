/**
 * jobs-quality-audit.ts — READ-ONLY, exhaustive per-job data-quality audit
 * across the whole fleet (all site statuses), reported at the site level.
 *
 * Checks (per job):
 *   1. no captured apply form       — rawData._formData absent/invalid
 *                                      (STRICT: an email/URL fallback in
 *                                      applicationInfo does NOT count as OK —
 *                                      see LRN-APPLY-10, the minrav case this
 *                                      audit was written for)
 *   2. no location                  — empty/null, OR the worker's literal
 *                                      "Unknown" fallback (reported separately)
 *   3. no description / no requirements — reported as two independent columns,
 *                                      since a site merging everything into
 *                                      `description` is a valid pattern
 *                                      (addsite2.md §6.1 requirements table)
 *   4. no externalJobId             — empty/null (dedup-key gap)
 *   5. unstructured "blob" text     — description present, length > 200,
 *                                      and contains not a single newline
 *                                      (calibrated against real fleet data:
 *                                      65% hit rate in a 1200-job sample,
 *                                      concentrated per-site not per-job —
 *                                      23/28 affected sites had it on EVERY
 *                                      sampled job, 15/43 sites had zero)
 *
 * Field-extraction precedence (rawData vs top-level) is copied verbatim from
 * scripts/addsite-fleet-audit.ts to keep the two audits' numbers comparable.
 *
 * Scope: ALL sites regardless of status (ACTIVE/REVIEW/FAILED/SKIPPED/
 * ANALYZING) — ties in stale jobs left on non-ACTIVE sites, not just the live
 * board. /api/jobs?siteId=X defaults to each site's latest ScrapeRun, so
 * historical runs are never double-counted.
 *
 * Exhaustive, not sampled: 6306 jobs / 186 sites fleet-wide (2026-08-03) is
 * cheap to pull in full over paginated GETs — no browser, no per-site probe.
 *
 * Usage: npx tsx scripts/jobs-quality-audit.ts [--out <path>] [--concurrency 6]
 *
 * Read-only: only GET requests. Safe to run anytime.
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const PAGE_SIZE = 100; // LRN-API-1: >100 silently returns []
const BLOB_MIN_LEN = 200;

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

// --- field extraction (copied verbatim from addsite-fleet-audit.ts for cross-audit consistency) ---
function fieldValue(job: any, field: string): unknown {
  const raw = job?.rawData || {};
  switch (field) {
    case "description":
      return raw.description ?? job?.description;
    case "requirements":
      return raw.requirements ?? job?.requirements;
    case "location":
      return job?.location ?? raw.location;
    case "externalJobId":
      return job?.externalJobId ?? raw.externalJobId;
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
function hasCapturedForm(job: any): boolean {
  const fd = job?.rawData?._formData;
  let obj: any = fd;
  if (typeof fd === "string") {
    const s = fd.trim();
    if (!s.startsWith("{")) return false;
    try {
      obj = JSON.parse(s);
    } catch {
      return false;
    }
  }
  return !!(obj && typeof obj === "object" && Array.isArray(obj.fields) && obj.fields.length >= 1);
}
function isBlobText(v: unknown): boolean {
  return typeof v === "string" && v.length > BLOB_MIN_LEN && !v.includes("\n");
}

// --- fetch helpers ---
async function fetchAllPages(url: (page: number) => string, headers: Record<string, string>): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const r = await fetch(url(page), { headers });
    if (!r.ok) throw new Error(`GET ${url(page)} → ${r.status}`);
    const j: any = await r.json();
    const batch: any[] = j.data || [];
    if (j.meta && typeof j.meta.total === "number") total = j.meta.total;
    if (!batch.length) break;
    all.push(...batch);
    page++;
    if (page > 500) break; // hard safety
  }
  return all;
}

async function pLimit<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  async function worker() {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

interface SiteReport {
  id: string;
  siteUrl: string;
  companyName: string | null;
  status: string;
  jobCount: number;
  noForm: number;
  hasFallback: number; // of the noForm jobs, how many have email/url as a fallback anyway
  noLocation: number;
  unknownLocation: number;
  noDescription: number;
  noRequirements: number;
  noExternalId: number;
  duplicateIds: number;
  blobDescriptions: number; // out of jobs that HAVE a description
  descriptionCount: number; // denominator for blob %
  error?: string;
}

async function main() {
  const outArg = arg("out");
  const concurrency = parseInt(arg("concurrency", "6")!, 10);
  const HEADERS = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };

  console.error("[audit] fetching all sites (any status)...");
  const sites = await fetchAllPages((p) => `${BASE}/api/sites?pageSize=${PAGE_SIZE}&page=${p}`, HEADERS);
  console.error(`[audit] ${sites.length} sites total`);

  const reports: SiteReport[] = [];
  let done = 0;

  await pLimit(sites, concurrency, async (site: any) => {
    done++;
    process.stderr.write(`\r[audit] ${done}/${sites.length} sites processed        `);
    const rep: SiteReport = {
      id: site.id,
      siteUrl: site.siteUrl || "",
      companyName: site.companyName || null,
      status: site.status || "?",
      jobCount: 0,
      noForm: 0,
      hasFallback: 0,
      noLocation: 0,
      unknownLocation: 0,
      noDescription: 0,
      noRequirements: 0,
      noExternalId: 0,
      duplicateIds: 0,
      blobDescriptions: 0,
      descriptionCount: 0,
    };
    try {
      const jobs = await fetchAllPages(
        (p) => `${BASE}/api/jobs?siteId=${encodeURIComponent(site.id)}&pageSize=${PAGE_SIZE}&page=${p}`,
        HEADERS,
      );
      rep.jobCount = jobs.length;

      const ids = new Set<string>();
      const dupIds = new Set<string>();

      for (const j of jobs) {
        const hasForm = hasCapturedForm(j);
        if (!hasForm) {
          rep.noForm++;
          const appInfo = fieldValue(j, "applicationInfo");
          if (looksLikeEmail(appInfo) || looksLikeUrl(appInfo) || looksLikeUrl(fieldValue(j, "detailUrl"))) {
            rep.hasFallback++;
          }
        }

        const loc = fieldValue(j, "location");
        if (!isPresent(loc)) rep.noLocation++;
        else if (loc === "Unknown") rep.unknownLocation++;

        const desc = fieldValue(j, "description");
        if (!isPresent(desc)) {
          rep.noDescription++;
        } else {
          rep.descriptionCount++;
          if (isBlobText(desc)) rep.blobDescriptions++;
        }

        if (!isPresent(fieldValue(j, "requirements"))) rep.noRequirements++;

        const eid = fieldValue(j, "externalJobId");
        if (!isPresent(eid)) {
          rep.noExternalId++;
        } else {
          const key = String(eid);
          if (ids.has(key)) dupIds.add(key);
          ids.add(key);
        }
      }
      rep.duplicateIds = dupIds.size;
    } catch (e: any) {
      rep.error = e?.message || String(e);
    }
    reports.push(rep);
  });
  process.stderr.write("\n");

  reports.sort((a, b) => {
    const statusRank = (s: string) => (s === "ACTIVE" ? 0 : s === "REVIEW" ? 1 : s === "FAILED" ? 2 : s === "SKIPPED" ? 3 : 4);
    const sr = statusRank(a.status) - statusRank(b.status);
    if (sr !== 0) return sr;
    const issues = (r: SiteReport) => r.noForm + r.noLocation + r.noDescription + r.noRequirements + r.noExternalId + r.blobDescriptions;
    return issues(b) - issues(a);
  });

  // --- fleet aggregate ---
  const withJobs = reports.filter((r) => r.jobCount > 0);
  const totalJobs = reports.reduce((s, r) => s + r.jobCount, 0);
  const sum = (f: (r: SiteReport) => number) => reports.reduce((s, r) => s + f(r), 0);
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

  const totalNoForm = sum((r) => r.noForm);
  const totalNoFormNoFallback = sum((r) => r.noForm - r.hasFallback);
  const totalNoLocation = sum((r) => r.noLocation);
  const totalUnknownLocation = sum((r) => r.unknownLocation);
  const totalNoDescription = sum((r) => r.noDescription);
  const totalNoRequirements = sum((r) => r.noRequirements);
  const totalNoExternalId = sum((r) => r.noExternalId);
  const totalDescCount = sum((r) => r.descriptionCount);
  const totalBlob = sum((r) => r.blobDescriptions);
  const totalDupSites = reports.filter((r) => r.duplicateIds > 0).length;

  const byStatus: Record<string, number> = {};
  for (const r of reports) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  // --- per-site repair worklist ---
  // Threshold-gated so the list is a backlog of real, site-level problems, not
  // noise from 1-2 stray jobs. "No requirements" alone is usually by-design
  // (see the caveat above) so it only appears jointly with a high blob rate —
  // i.e. the site has nothing usable split out anywhere, not just no separate field.
  const ISSUE_THRESH = 0.1; // 10% of a site's jobs
  const REQ_JOINT_THRESH = 0.5; // 50% for the joint no-requirements+blob case
  function issuesFor(r: SiteReport): string[] {
    if (r.error) return [`ERROR: ${r.error.slice(0, 80)}`];
    if (r.jobCount === 0) return r.status === "ACTIVE" ? ["ACTIVE site currently has 0 jobs"] : [];
    const of = (n: number, d: number) => (d ? n / d : 0);
    const out: string[] = [];
    if (of(r.noForm, r.jobCount) >= ISSUE_THRESH) out.push(`No apply form (${pct(r.noForm, r.jobCount)})`);
    if (of(r.noLocation, r.jobCount) >= ISSUE_THRESH) out.push(`No location (${pct(r.noLocation, r.jobCount)})`);
    if (of(r.noDescription, r.jobCount) >= ISSUE_THRESH) out.push(`No description (${pct(r.noDescription, r.jobCount)})`);
    if (of(r.noExternalId, r.jobCount) >= ISSUE_THRESH) out.push(`No externalJobId (${pct(r.noExternalId, r.jobCount)})`);
    const blobPct = of(r.blobDescriptions, r.descriptionCount);
    if (blobPct >= ISSUE_THRESH) out.push(`Unstructured "blob" text (${pct(r.blobDescriptions, r.descriptionCount)})`);
    const reqPct = of(r.noRequirements, r.jobCount);
    if (reqPct >= REQ_JOINT_THRESH && blobPct >= REQ_JOINT_THRESH) {
      out.push(`No requirements AND unstructured (${pct(r.noRequirements, r.jobCount)} / ${pct(r.blobDescriptions, r.descriptionCount)})`);
    }
    if (r.duplicateIds > 0) out.push(`${r.duplicateIds} duplicate externalJobId value(s)`);
    return out;
  }
  const worklist = reports
    .map((r) => ({ r, issues: issuesFor(r) }))
    .filter((x) => x.issues.length > 0)
    .sort((a, b) => {
      const statusRank = (s: string) => (s === "ACTIVE" ? 0 : s === "REVIEW" ? 1 : s === "FAILED" ? 2 : s === "SKIPPED" ? 3 : 4);
      const sr = statusRank(a.r.status) - statusRank(b.r.status);
      if (sr !== 0) return sr;
      return b.r.jobCount - a.r.jobCount; // biggest sites (most impact) first within each status
    });

  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Jobs data-quality audit — ${date}`);
  lines.push("");
  lines.push(
    `Read-only, exhaustive audit across **all ${reports.length} sites** (any status) / **${totalJobs} jobs**, ` +
      `pulled in full (no sampling) via \`/api/jobs?siteId=...\` (defaults to each site's latest scrape run).`,
  );
  lines.push("");
  lines.push(
    `Site status breakdown: ${Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(", ")}.`,
  );
  lines.push("");
  lines.push("## Fleet summary");
  lines.push("");
  lines.push("| Issue | Jobs affected | % of total jobs |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| **No captured apply form** (strict — email/URL fallback does NOT count) | ${totalNoForm} | ${pct(totalNoForm, totalJobs)} |`,
  );
  lines.push(
    `| — of those, no fallback either (truly zero apply path) | ${totalNoFormNoFallback} | ${pct(totalNoFormNoFallback, totalJobs)} |`,
  );
  lines.push(`| No location (empty/null) | ${totalNoLocation} | ${pct(totalNoLocation, totalJobs)} |`);
  lines.push(
    `| — of those, literal \`"Unknown"\` placeholder (worker default, counted above too) | ${totalUnknownLocation} | ${pct(totalUnknownLocation, totalJobs)} |`,
  );
  lines.push(`| No description | ${totalNoDescription} | ${pct(totalNoDescription, totalJobs)} |`);
  lines.push(`| No requirements (separate field) | ${totalNoRequirements} | ${pct(totalNoRequirements, totalJobs)} |`);
  lines.push(`| No externalJobId | ${totalNoExternalId} | ${pct(totalNoExternalId, totalJobs)} |`);
  lines.push(
    `| Unstructured "blob" description (>200 chars, zero line breaks) | ${totalBlob} | ${pct(totalBlob, totalDescCount)} of jobs *with* a description |`,
  );
  lines.push("");
  lines.push(
    `**Reading "No requirements":** empty is often correct, not broken — many sites merge everything into ` +
      `\`description\` and never populate a separate field (addsite2.md §6.1: "usually merge into description"). ` +
      `A high number here is not automatically a defect list; it becomes one combined with a low description ` +
      `fill rate or a high blob rate on the same site (description exists but is unstructured, so nothing usable ` +
      `is separated out anywhere). Cross-reference against the per-site table below rather than acting on this ` +
      `figure alone.`,
  );
  lines.push("");
  lines.push(
    `Bonus signal (not one of the 5 requested checks, found free while computing #4): ` +
      `**${totalDupSites} site(s)** have at least one duplicate \`externalJobId\` within their own job set — a dedup-key collision risk.`,
  );
  lines.push("");
  lines.push(
    `Reference / known-good baseline: **minrav.co.il** (\`cmsbxxv9b000601p0hbhkk5r9\`) — fixed 2026-08-03, ` +
      `0% on form/location/externalId/blob across its 11 jobs (its 100% "no requirements" is by design: ` +
      `everything is merged into \`description\`, a valid pattern — see \`sites/minrav/notes.md\`). ` +
      `Used to calibrate the blob-text threshold.`,
  );
  lines.push("");
  lines.push("## Repair worklist");
  lines.push("");
  lines.push(
    `${worklist.length} of ${reports.length} sites have at least one issue crossing a site-level threshold ` +
      `(a real, systemic problem — not 1-2 stray jobs). Only these sites are listed; a clean site has no row here. ` +
      `Company name and site URL are exactly as stored in the DB (\`companyName\`, \`siteUrl\`) — a blank company ` +
      `name means it was never set (see \`companyName\` PATCH landmine, \`addsite2.md\` §0.2/§4).`,
  );
  lines.push("");
  lines.push(
    `Thresholds: no-form / no-location / no-description / no-externalId / blob-text each flag at ` +
      `**≥${(ISSUE_THRESH * 100).toFixed(0)}%** of the site's jobs. "No requirements" only flags jointly with a ` +
      `≥${(REQ_JOINT_THRESH * 100).toFixed(0)}% blob rate (see the caveat above) — otherwise it's most likely ` +
      `intentional merging into \`description\`, not a defect.`,
  );
  lines.push("");
  lines.push("Sorted by status (ACTIVE first), then by job count (biggest impact first) within each status.");
  lines.push("");
  lines.push("| Company | Site URL | Status | Jobs | Issues |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const { r, issues } of worklist) {
    const company = r.companyName || "*(none)*";
    lines.push(`| ${company} | ${r.siteUrl} | ${r.status} | ${r.jobCount} | ${issues.join("; ")} |`);
  }
  lines.push("");
  lines.push("## Per-site detail (all sites, full metrics)");
  lines.push("");
  lines.push(
    "Sorted by status (ACTIVE first), then by total issue count within each status. " +
      "`—` means the site has 0 jobs (nothing to check).",
  );
  lines.push("");
  lines.push(
    "| Site | Status | Jobs | No form | No loc | No desc | No reqs | No ID | Blob desc | Dup IDs |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of reports) {
    const name = r.companyName || r.siteUrl.replace(/^https?:\/\//, "").slice(0, 40) || r.id;
    if (r.error) {
      lines.push(`| ${name} | ${r.status} | ERROR | ${r.error.slice(0, 60)} | | | | | | |`);
      continue;
    }
    if (r.jobCount === 0) {
      lines.push(`| ${name} | ${r.status} | 0 | — | — | — | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${name} | ${r.status} | ${r.jobCount} | ` +
        `${r.noForm} (${pct(r.noForm, r.jobCount)}) | ` +
        `${r.noLocation} (${pct(r.noLocation, r.jobCount)}) | ` +
        `${r.noDescription} (${pct(r.noDescription, r.jobCount)}) | ` +
        `${r.noRequirements} (${pct(r.noRequirements, r.jobCount)}) | ` +
        `${r.noExternalId} (${pct(r.noExternalId, r.jobCount)}) | ` +
        `${r.blobDescriptions} (${pct(r.blobDescriptions, r.descriptionCount)}) | ` +
        `${r.duplicateIds || ""} |`,
    );
  }
  lines.push("");

  const md = lines.join("\n") + "\n";
  const outPath = outArg || `.scratch/jobs-quality-audit-${date}.md`;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, md, "utf8");

  // --- CSV exports (same data as the two markdown tables, spreadsheet-friendly) ---
  function csvCell(v: unknown): string {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function csvRow(cells: unknown[]): string {
    return cells.map(csvCell).join(",");
  }

  const worklistCsvLines = [csvRow(["Company", "Site URL", "Status", "Jobs", "Issues"])];
  for (const { r, issues } of worklist) {
    worklistCsvLines.push(csvRow([r.companyName || "", r.siteUrl, r.status, r.jobCount, issues.join("; ")]));
  }
  const worklistCsvPath = outPath.replace(/\.md$/, "") + "-worklist.csv";
  fs.writeFileSync(worklistCsvPath, worklistCsvLines.join("\n") + "\n", "utf8");

  const fullCsvHeader = [
    "Company",
    "Site URL",
    "Status",
    "Jobs",
    "NoForm",
    "NoForm_pct",
    "NoLocation",
    "NoLocation_pct",
    "NoDescription",
    "NoDescription_pct",
    "NoRequirements",
    "NoRequirements_pct",
    "NoExternalId",
    "NoExternalId_pct",
    "BlobDescriptions",
    "BlobDescriptions_pct_of_described",
    "DuplicateExternalIds",
  ];
  const rawPct = (n: number, d: number) => (d ? +((n / d) * 100).toFixed(1) : "");
  const fullCsvLines = [csvRow(fullCsvHeader)];
  for (const r of reports) {
    fullCsvLines.push(
      csvRow([
        r.companyName || "",
        r.siteUrl,
        r.status,
        r.jobCount,
        r.error ? `ERROR: ${r.error}` : r.noForm,
        r.error ? "" : rawPct(r.noForm, r.jobCount),
        r.error ? "" : r.noLocation,
        r.error ? "" : rawPct(r.noLocation, r.jobCount),
        r.error ? "" : r.noDescription,
        r.error ? "" : rawPct(r.noDescription, r.jobCount),
        r.error ? "" : r.noRequirements,
        r.error ? "" : rawPct(r.noRequirements, r.jobCount),
        r.error ? "" : r.noExternalId,
        r.error ? "" : rawPct(r.noExternalId, r.jobCount),
        r.error ? "" : r.blobDescriptions,
        r.error ? "" : rawPct(r.blobDescriptions, r.descriptionCount),
        r.error ? "" : r.duplicateIds,
      ]),
    );
  }
  const fullCsvPath = outPath.replace(/\.md$/, "") + "-full.csv";
  fs.writeFileSync(fullCsvPath, fullCsvLines.join("\n") + "\n", "utf8");

  console.log(`\nWrote ${path.resolve(outPath)}`);
  console.log(`Wrote ${path.resolve(worklistCsvPath)} (${worklist.length} rows — repair worklist only)`);
  console.log(`Wrote ${path.resolve(fullCsvPath)} (${reports.length} rows — all sites, raw numeric columns)`);
  console.log(
    `Fleet: ${reports.length} sites / ${totalJobs} jobs — ` +
      `noForm=${pct(totalNoForm, totalJobs)} noLoc=${pct(totalNoLocation, totalJobs)} ` +
      `noDesc=${pct(totalNoDescription, totalJobs)} noReqs=${pct(totalNoRequirements, totalJobs)} ` +
      `noId=${pct(totalNoExternalId, totalJobs)} blob=${pct(totalBlob, totalDescCount)}`,
  );
}

main().catch((e) => {
  console.error(`[audit] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
