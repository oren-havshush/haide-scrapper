/**
 * addsite-audit.ts — periodic sweep of ALL ACTIVE sites to surface sites that
 * would now fail the QA gate (report-only by default, --fix PATCHes to REVIEW).
 *
 * Usage:
 *   npx tsx scripts/addsite-audit.ts [--fix] [--sample 10] [--no-probe]
 *        [--min-fill 0.6] [--concurrency 3] [--out <dir>]
 *
 * Options:
 *   --fix          PATCH each failing site to REVIEW + add adminNote explaining
 *                  which check failed. Default: report-only.
 *   --sample N     jobs to sample per site (default 10)
 *   --no-probe     skip headless detail-page probe (faster, less accurate)
 *   --min-fill F   fill-rate threshold for Tier-A fields (default 0.6)
 *   --concurrency  max parallel runQa calls (default 3; keep low to avoid rate-limits)
 *   --out <dir>    write per-site QA JSON files to this directory
 *
 * Exit codes:
 *   0  all sites pass (or no ACTIVE sites found)
 *   1  internal error
 *   2  one or more sites are failing the gate
 *
 * LANDMINE: the /api/sites endpoint has a hard pageSize cap of 100.
 *           This script paginates properly to handle any number of sites.
 */
import * as fs from "fs";
import * as path from "path";
import { runQa, type QaRecord } from "./addsite-qa.js";

const BASE = "https://scrapper.haide-jobs.co.il";

// ---------------------------------------------------------------------------
// helpers
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

/** Paginate /api/sites?status=ACTIVE — respects the 100-per-page hard cap. */
async function fetchAllActiveSites(headers: Record<string, string>): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const PAGE_SIZE = 100;
  while (true) {
    const url = `${BASE}/api/sites?status=ACTIVE&pageSize=${PAGE_SIZE}&page=${page}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
    const j: any = await r.json();
    const batch: any[] = Array.isArray(j.data) ? j.data : j.data ? [j.data] : [];
    all.push(...batch);
    const total = j.total ?? j.pagination?.total ?? null;
    if (batch.length < PAGE_SIZE || (total !== null && all.length >= total)) break;
    page++;
  }
  return all;
}

/** Run up to `concurrency` promises at a time. */
async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const queue = [...tasks];
  async function run() {
    while (queue.length) {
      const task = queue.shift()!;
      try {
        results.push({ status: "fulfilled", value: await task() });
      } catch (e: any) {
        results.push({ status: "rejected", reason: e });
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, run);
  await Promise.all(workers);
  return results;
}

interface AuditRow {
  siteId: string;
  siteName: string;
  siteUrl: string;
  verdict: string;
  verdictReason: string;
  tierAMissing: string[];
  correctnessSuspects: string[];
  availableButUnmapped: string[];
  formStatus: string;
  sampled: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// PATCH helper (only used with --fix)
// ---------------------------------------------------------------------------

/**
 * PATCH site status to REVIEW and set an adminNote.
 * Follows the two-call pattern (LANDMINE §0.2): status and adminNote are
 * separate PATCH payloads because combined updates have historically failed.
 */
async function patchToReview(siteId: string, reason: string, headers: Record<string, string>): Promise<void> {
  // Call 1: status → REVIEW
  const r1 = await fetch(`${BASE}/api/sites/${encodeURIComponent(siteId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "REVIEW" }),
  });
  if (!r1.ok) {
    const text = await r1.text().catch(() => "");
    throw new Error(`PATCH status failed: ${r1.status} ${text}`);
  }
  // Call 2: adminNote
  const note = `[audit] ${new Date().toISOString().slice(0, 10)}: ${reason}`;
  const r2 = await fetch(`${BASE}/api/sites/${encodeURIComponent(siteId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ adminNote: note }),
  });
  if (!r2.ok) {
    const text = await r2.text().catch(() => "");
    throw new Error(`PATCH adminNote failed: ${r2.status} ${text}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const fix = cliHasFlag("fix");
  const sample = parseInt(cliArg("sample") || "10", 10);
  const noProbe = cliHasFlag("no-probe");
  const minFill = parseFloat(cliArg("min-fill") || "0.6");
  const concurrency = parseInt(cliArg("concurrency") || "3", 10);
  const outDir = cliArg("out");

  const tok = readToken();
  const HEADERS: Record<string, string> = {
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
  };

  console.error(`[audit] fetching ACTIVE sites…`);
  const sites = await fetchAllActiveSites(HEADERS);
  console.error(`[audit] found ${sites.length} ACTIVE sites`);

  if (sites.length === 0) {
    console.log("No ACTIVE sites found.");
    process.exit(0);
  }

  const rows: AuditRow[] = [];
  let fixedCount = 0;
  let failCount = 0;

  const tasks = sites.map((site) => async (): Promise<AuditRow> => {
    const siteId = site.id;
    const siteName = site.name || siteId;
    const siteUrl = site.url || "";
    try {
      const qa = await runQa(siteId, {
        sample,
        minFill,
        noProbe,
        token: tok,
        outPath: outDir ? path.join(outDir, `${siteId}.json`) : undefined,
      });
      return {
        siteId,
        siteName,
        siteUrl,
        verdict: qa.verdict,
        verdictReason: qa.verdictReason,
        tierAMissing: qa.tierAMissing,
        correctnessSuspects: qa.correctnessSuspects,
        availableButUnmapped: qa.availableButUnmapped,
        formStatus: qa.formStatus,
        sampled: qa.sampled,
      };
    } catch (e: any) {
      return {
        siteId,
        siteName,
        siteUrl,
        verdict: "ERROR",
        verdictReason: e?.message || String(e),
        tierAMissing: [],
        correctnessSuspects: [],
        availableButUnmapped: [],
        formStatus: "NONE",
        sampled: 0,
        error: e?.message || String(e),
      };
    }
  });

  // Run with concurrency limit
  const settled = await pLimit(tasks, concurrency);
  for (const r of settled) {
    if (r.status === "fulfilled") rows.push(r.value);
    else rows.push({ siteId: "?", siteName: "?", siteUrl: "", verdict: "ERROR", verdictReason: String(r.reason), tierAMissing: [], correctnessSuspects: [], availableButUnmapped: [], formStatus: "NONE", sampled: 0, error: String(r.reason) });
  }

  // Sort: failures first, then errors, then passes
  rows.sort((a, b) => {
    const rank = (v: string) => v === "ACTIVE" ? 3 : v === "REQUEUE" ? 2 : v === "REVIEW" ? 1 : 0;
    return rank(a.verdict) - rank(b.verdict);
  });

  // Apply --fix
  if (fix) {
    for (const row of rows) {
      if (row.verdict !== "ACTIVE" && row.verdict !== "ERROR" && row.verdict !== "REQUEUE") {
        try {
          await patchToReview(row.siteId, row.verdictReason, HEADERS);
          console.error(`[audit] PATCHED ${row.siteId} (${row.siteName}) → REVIEW`);
          fixedCount++;
        } catch (e: any) {
          console.error(`[audit] PATCH failed for ${row.siteId}: ${e.message}`);
        }
      }
    }
  }

  // Count failures (non-ACTIVE, non-REQUEUE)
  for (const row of rows) {
    if (row.verdict !== "ACTIVE" && row.verdict !== "REQUEUE") failCount++;
  }

  // Print summary table
  const COL_ID = 36;
  const COL_NAME = 28;
  const COL_VERDICT = 8;
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

  console.log(`\n${"─".repeat(100)}`);
  console.log(`AUDIT SUMMARY — ${new Date().toISOString().slice(0, 16)}Z — ${sites.length} ACTIVE sites scanned`);
  if (fix) console.log(`(--fix mode: ${fixedCount} site(s) patched to REVIEW)`);
  console.log(`${"─".repeat(100)}`);
  console.log(`${pad("SITE ID", COL_ID)} ${pad("NAME", COL_NAME)} ${pad("VERDICT", COL_VERDICT)} REASON / SUSPECTS`);
  console.log(`${"─".repeat(100)}`);

  for (const row of rows) {
    if (row.verdict === "ACTIVE") continue; // only show problems
    const suspects = [
      ...row.tierAMissing.map((f) => `tierA:${f}`),
      ...row.correctnessSuspects.map(() => "correctness"),
      ...row.availableButUnmapped.map((f) => `unmapped:${f}`),
    ].join(", ") || row.verdictReason.slice(0, 60);
    console.log(`${pad(row.siteId, COL_ID)} ${pad(row.siteName, COL_NAME)} ${pad(row.verdict, COL_VERDICT)} ${suspects}`);
  }

  const passed = rows.filter((r) => r.verdict === "ACTIVE").length;
  const requeue = rows.filter((r) => r.verdict === "REQUEUE").length;
  const failed = rows.filter((r) => r.verdict !== "ACTIVE" && r.verdict !== "REQUEUE").length;

  console.log(`${"─".repeat(100)}`);
  console.log(`PASS: ${passed}  REQUEUE: ${requeue}  FAIL/REVIEW/ERROR: ${failed}`);
  console.log(`${"─".repeat(100)}\n`);

  if (failCount > 0) {
    console.error(`[audit] ${failCount} site(s) failed the gate${fix ? " (patched to REVIEW)" : " — re-run with --fix to patch"}`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`[audit] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
