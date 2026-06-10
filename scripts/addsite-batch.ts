/**
 * addsite-batch.ts — multi-URL /addsite batch orchestration utility.
 *
 * Sub-commands:
 *   parse     Read URLs from args / --file / --csv, normalize, dedup, check
 *             existing site statuses via API, create batch dir, write
 *             work-list.json. Prints "BATCH_DIR:<path>" as final stdout line.
 *
 *   skip      Create site if needed → PUT minimal config → PATCH SKIPPED.
 *             Usage: skip --url <URL> --reason "<note>" [--site-id <id>]
 *                         [--batch-dir <dir>] [--company <name>]
 *
 *   log       Append one result row to <batchDir>/batch-results.jsonl.
 *             Usage: log --batch-dir <dir> --url <URL> --outcome <OUTCOME>
 *                        --reason "<reason>" [--site-id <id>] [--jobs N]
 *
 *   summary   Read batch-results.jsonl, print summary table, write summary.md.
 *             Usage: summary --batch-dir <dir>
 *
 * Invocation examples (from the /addsite skill):
 *   npx tsx scripts/addsite-batch.ts parse https://a.com/jobs https://b.com/careers
 *   npx tsx scripts/addsite-batch.ts parse --file urls.txt [--force] [--max-urls 50]
 *   npx tsx scripts/addsite-batch.ts parse --csv sheet.csv --column "Career Page" [--limit 20] [--start 5] [--company-col "Company"] [--force] [--resume .scratch/batch-123/batch-results.jsonl]
 *   npx tsx scripts/addsite-batch.ts skip --url https://x.com --reason "unreachable" [--batch-dir .scratch/batch-123]
 *   npx tsx scripts/addsite-batch.ts log --batch-dir .scratch/batch-123 --url https://x.com --outcome SKIPPED --reason "dry-run 0 items" --site-id cmq... --jobs 0
 *   npx tsx scripts/addsite-batch.ts summary --batch-dir .scratch/batch-123
 */
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://scrapper.haide-jobs.co.il";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");
const DEFAULT_MAX_URLS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Outcome =
  | "ACTIVE"
  | "SKIPPED"
  | "ALREADY_ACTIVE"
  | "SKIP_PRIOR"
  | "DUPLICATE_IN_BATCH"
  | "INVALID_URL"
  | "ERROR";

interface BatchResult {
  url: string;
  siteId?: string;
  companyName?: string;
  outcome: Outcome;
  reason: string;
  jobCount?: number;
  timestamp: string;
}

interface WorkListEntry {
  url: string;
  normalizedUrl: string;
  existingId?: string;
  existingStatus?: string;
  companyName?: string;
  preStatus: "PROCEED" | "ALREADY_ACTIVE" | "SKIP_PRIOR" | "DUPLICATE" | "INVALID";
}

// ---------------------------------------------------------------------------
// Token & API helpers
// ---------------------------------------------------------------------------

function readToken(): string {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `Missing ${TOKEN_PATH} — paste the prod API token into that file.`,
    );
  }
  const t = fs.readFileSync(TOKEN_PATH, "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) {
    throw new Error(
      `.claude/scrap-token is empty or still contains the placeholder.`,
    );
  }
  return t;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function apiGet(endpoint: string, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(`${BASE_URL}${endpoint}`, { headers });
  if (!r.ok) throw new Error(`GET ${endpoint} → ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function apiPost(endpoint: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${endpoint} → ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function apiPut(endpoint: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(`${BASE_URL}${endpoint}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${endpoint} → ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function apiPatch(endpoint: string, body: unknown, headers: Record<string, string>): Promise<void> {
  const r = await fetch(`${BASE_URL}${endpoint}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${endpoint} → ${r.status}: ${await r.text().catch(() => "")}`);
}

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\s+/g, "");
  if (!u) return "";
  // Ensure protocol
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    // Lowercase host
    parsed.hostname = parsed.hostname.toLowerCase();
    // Strip trailing slash on path (keep root path as /)
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return u;
  }
}

function dedupKey(u: string): string {
  try {
    const p = new URL(normalizeUrl(u));
    return `${p.hostname}${p.pathname}${p.search}`.toLowerCase();
  } catch {
    return u.toLowerCase().trim();
  }
}

function isValidUrl(u: string): boolean {
  try {
    const p = new URL(normalizeUrl(u));
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CSV parsing (matches enrich-csv.ts pattern)
// ---------------------------------------------------------------------------

function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; cur += c; }
    else if ((c === "\n" || c === "\r") && !inQ) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      out.push(cur); cur = "";
    } else cur += c;
  }
  if (cur.length) out.push(cur);
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = splitCsvLines(clean);
  while (lines.length && lines[0].trim() === "") lines.shift();
  if (!lines.length) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, j) => { row[h] = fields[j] ?? ""; });
    rows.push(row);
  }
  return { header, rows };
}

// ---------------------------------------------------------------------------
// Arg parsing helper
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
      if (!m) { positional.push(a); continue; }
      const [, k, v] = m;
      if (v !== undefined) { flags[k] = v; }
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[k] = argv[++i];
      } else { flags[k] = true; }
    } else { positional.push(a); }
  }
  return { positional, flags };
}

function flagStr(flags: Record<string, string | true>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(flags: Record<string, string | true>, key: string): boolean {
  return key in flags;
}

function flagInt(flags: Record<string, string | true>, key: string, def: number): number {
  const v = flagStr(flags, key);
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

// ---------------------------------------------------------------------------
// Batch log helpers
// ---------------------------------------------------------------------------

function appendBatchResult(batchDir: string, result: BatchResult): void {
  const logPath = path.join(batchDir, "batch-results.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(result) + "\n", "utf8");
}

function readBatchResults(batchDir: string): BatchResult[] {
  const logPath = path.join(batchDir, "batch-results.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BatchResult);
}

function alreadyLoggedUrls(batchDir: string): Set<string> {
  const results = readBatchResults(batchDir);
  const keys = new Set<string>();
  for (const r of results) keys.add(dedupKey(r.url));
  return keys;
}

// ---------------------------------------------------------------------------
// skipSite — create + SKIPPED API flow (core of the `skip` command)
// ---------------------------------------------------------------------------

async function skipSite(opts: {
  url: string;
  reason: string;
  siteId?: string;
  /** Known current status — avoids an extra GET. When omitted, assumed ANALYZING. */
  currentStatus?: string;
  companyName?: string;
  token: string;
}): Promise<{ siteId: string; action: "created" | "existing" }> {
  const headers = authHeaders(opts.token);
  let siteId = opts.siteId;
  let action: "created" | "existing" = "existing";
  let currentStatus = opts.currentStatus ?? "ANALYZING";

  if (!siteId) {
    const existing = (await apiGet(
      `/api/sites?siteUrl=${encodeURIComponent(opts.url)}`,
      headers,
    )) as { data?: Array<{ id: string; status: string }> };
    if (existing?.data?.length) {
      siteId = existing.data[0].id;
      currentStatus = existing.data[0].status;
    } else {
      const created = (await apiPost(
        "/api/sites",
        { siteUrl: opts.url },
        headers,
      )) as { data?: { id: string } };
      siteId = created.data?.id ?? "";
      action = "created";
      currentStatus = "ANALYZING"; // always true for brand-new sites
    }
  } else if (opts.currentStatus === undefined) {
    // siteId was supplied but we don't know its status — look it up so the
    // status transition below picks the right path (a site mid-onboarding may
    // already be REVIEW/ACTIVE, where blindly PATCHing REVIEW is rejected).
    const byId = (await apiGet(
      `/api/sites?id=${encodeURIComponent(siteId)}`,
      headers,
    )) as { data?: Array<{ id: string; status: string }> };
    const match = byId?.data?.find((s) => s.id === siteId) ?? byId?.data?.[0];
    if (match?.status) currentStatus = match.status;
  }
  if (!siteId) throw new Error(`Could not obtain siteId for ${opts.url}`);

  // PUT minimal config (so fieldMappings is not null, which would block PATCH)
  await apiPut(
    `/api/sites/${siteId}/config`,
    {
      itemSelector: "body",
      fieldMappings: {},
      pageFlow: [],
      formCapture: null,
    },
    headers,
  );

  // Transition to SKIPPED. The API forbids ANALYZING → SKIPPED directly
  // (route through REVIEW), and SKIPPED → SKIPPED is also rejected (no-op case).
  if (currentStatus !== "SKIPPED") {
    if (currentStatus === "ANALYZING") {
      await apiPatch(`/api/sites/${siteId}`, { status: "REVIEW" }, headers);
    }
    await apiPatch(`/api/sites/${siteId}`, { status: "SKIPPED" }, headers);
  }
  // Always update the adminNote so the reason reflects the current batch run.
  await apiPatch(`/api/sites/${siteId}`, { adminNote: opts.reason }, headers);

  if (opts.companyName) {
    await apiPatch(`/api/sites/${siteId}`, { companyName: opts.companyName }, headers);
  }

  return { siteId, action };
}

// ---------------------------------------------------------------------------
// Command: parse
// ---------------------------------------------------------------------------

async function cmdParse(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);

  const force = flagBool(flags, "force");
  const maxUrls = flagInt(flags, "max-urls", DEFAULT_MAX_URLS);
  const limit = flagInt(flags, "limit", Infinity);
  const start = flagInt(flags, "start", 0);
  const resumePath = flagStr(flags, "resume");

  // Collect raw URLs from all input sources
  const rawUrls: Array<{ url: string; companyName?: string }> = [];

  // Direct positional args
  for (const u of positional) {
    if (u.startsWith("http") || u.includes(".")) rawUrls.push({ url: u });
  }

  // --file <path>
  const filePath = flagStr(flags, "file");
  if (filePath) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const u = line.trim();
      if (u && !u.startsWith("#")) rawUrls.push({ url: u });
    }
  }

  // --csv <path> --column <col>
  const csvPath = flagStr(flags, "csv");
  if (csvPath) {
    const col = flagStr(flags, "column") ?? "url";
    const companyCols = [
      flagStr(flags, "company-col"),
      "Company Name",
      "company",
      "Company",
    ].filter(Boolean) as string[];
    const { header, rows } = parseCsv(fs.readFileSync(csvPath, "utf8"));
    const urlCol =
      header.find((h) => h.toLowerCase() === col.toLowerCase()) ??
      header.find((h) => h.toLowerCase().includes("url")) ??
      header.find((h) => h.toLowerCase().includes("career"));
    if (!urlCol) {
      throw new Error(
        `CSV column "${col}" not found. Available columns: ${header.join(", ")}`,
      );
    }
    const companyCol = companyCols.find((c) => header.includes(c));
    const slice = rows.slice(start, start + limit);
    for (const row of slice) {
      const u = row[urlCol]?.trim();
      if (u) rawUrls.push({ url: u, companyName: companyCol ? row[companyCol] : undefined });
    }
  }

  if (!rawUrls.length) {
    throw new Error(
      "No URLs found. Pass URLs as arguments, --file <path>, or --csv <path> --column <col>.",
    );
  }

  // Apply --start / --limit for non-CSV inputs
  const sliced = csvPath ? rawUrls : rawUrls.slice(start, start + (limit === Infinity ? rawUrls.length : limit));

  // Safety cap
  if (sliced.length > maxUrls) {
    console.error(
      `[batch] ${sliced.length} URLs exceeds --max-urls ${maxUrls}. Trimming. Pass --max-urls N to increase.`,
    );
    sliced.length = maxUrls;
  }

  // Normalize + dedup within batch
  const seen = new Map<string, string>(); // normalizedKey → original url
  const workList: WorkListEntry[] = [];

  for (const { url: raw, companyName } of sliced) {
    if (!raw) continue;
    const normalized = normalizeUrl(raw);
    const key = dedupKey(normalized);

    if (!isValidUrl(normalized)) {
      workList.push({ url: raw, normalizedUrl: normalized, companyName, preStatus: "INVALID" });
      continue;
    }

    if (seen.has(key)) {
      workList.push({ url: raw, normalizedUrl: normalized, companyName, preStatus: "DUPLICATE" });
      continue;
    }
    seen.set(key, raw);
    workList.push({ url: raw, normalizedUrl: normalized, companyName, preStatus: "PROCEED" });
  }

  // Check existing site statuses for PROCEED entries
  const token = readToken();
  const headers = authHeaders(token);

  console.error(`[batch] Checking existing site statuses for ${workList.filter((w) => w.preStatus === "PROCEED").length} URLs...`);

  // Load resume log to skip already-processed URLs
  let resumedKeys = new Set<string>();
  if (resumePath && fs.existsSync(resumePath)) {
    const resumeDir = path.dirname(resumePath);
    resumedKeys = alreadyLoggedUrls(resumeDir);
    console.error(`[batch] Resume: found ${resumedKeys.size} already-processed URLs in ${resumePath}`);
  }

  for (const entry of workList) {
    if (entry.preStatus !== "PROCEED") continue;

    // Skip if already processed in resume log
    if (resumedKeys.has(dedupKey(entry.normalizedUrl))) {
      entry.preStatus = "SKIP_PRIOR";
      entry.existingStatus = "RESUME";
      continue;
    }

    try {
      const existing = (await apiGet(
        `/api/sites?siteUrl=${encodeURIComponent(entry.normalizedUrl)}`,
        headers,
      )) as { data?: Array<{ id: string; status: string }> };
      if (existing?.data?.length) {
        const site = existing.data[0];
        entry.existingId = site.id;
        entry.existingStatus = site.status;
        if (site.status === "ACTIVE") {
          entry.preStatus = "ALREADY_ACTIVE";
        } else if (site.status === "SKIPPED" && !force) {
          entry.preStatus = "SKIP_PRIOR";
        }
      }
    } catch (e) {
      console.error(`[batch] Warning: could not check status for ${entry.normalizedUrl}: ${(e as Error).message}`);
    }
  }

  // Create batch dir
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const batchDir = path.join(process.cwd(), ".scratch", `batch-${ts}`);
  fs.mkdirSync(batchDir, { recursive: true });

  // Write work-list.json
  fs.writeFileSync(
    path.join(batchDir, "work-list.json"),
    JSON.stringify(workList, null, 2),
    "utf8",
  );

  // Print summary of what's in the work list
  const proceed = workList.filter((w) => w.preStatus === "PROCEED").length;
  const alreadyActive = workList.filter((w) => w.preStatus === "ALREADY_ACTIVE").length;
  const skipPrior = workList.filter((w) => w.preStatus === "SKIP_PRIOR").length;
  const dupes = workList.filter((w) => w.preStatus === "DUPLICATE").length;
  const invalid = workList.filter((w) => w.preStatus === "INVALID").length;

  console.log(`[batch] Work list: ${workList.length} total`);
  console.log(`  → PROCEED:       ${proceed}`);
  if (alreadyActive) console.log(`  → ALREADY_ACTIVE: ${alreadyActive} (will skip)`);
  if (skipPrior) console.log(`  → SKIP_PRIOR:     ${skipPrior} (already SKIPPED; use --force to retry)`);
  if (dupes) console.log(`  → DUPLICATE:      ${dupes} (within this batch)`);
  if (invalid) console.log(`  → INVALID_URL:    ${invalid}`);
  console.log(`[batch] work-list.json written.`);

  // Log non-PROCEED entries immediately so summary is complete
  for (const entry of workList) {
    if (entry.preStatus === "PROCEED") continue;
    const outcome: Outcome =
      entry.preStatus === "ALREADY_ACTIVE"
        ? "ALREADY_ACTIVE"
        : entry.preStatus === "DUPLICATE"
        ? "DUPLICATE_IN_BATCH"
        : entry.preStatus === "INVALID"
        ? "INVALID_URL"
        : "SKIP_PRIOR";
    const reason =
      entry.preStatus === "ALREADY_ACTIVE"
        ? `existing site ${entry.existingId ?? ""} is ACTIVE; skipped (use --force to re-onboard)`
        : entry.preStatus === "DUPLICATE"
        ? `duplicate URL within this batch`
        : entry.preStatus === "INVALID"
        ? `invalid URL format`
        : `existing site ${entry.existingId ?? ""} is already SKIPPED; use --force to retry`;
    appendBatchResult(batchDir, {
      url: entry.url,
      siteId: entry.existingId,
      companyName: entry.companyName,
      outcome,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  // Final output: batch dir path for agent to capture
  console.log(`BATCH_DIR:${batchDir}`);
}

// ---------------------------------------------------------------------------
// Command: skip
// ---------------------------------------------------------------------------

async function cmdSkip(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const url = flagStr(flags, "url");
  const reason = flagStr(flags, "reason") ?? "Auto-skipped during batch onboarding";
  const siteId = flagStr(flags, "site-id");
  const batchDir = flagStr(flags, "batch-dir");
  const company = flagStr(flags, "company");

  if (!url) throw new Error("--url is required");

  const token = readToken();
  const normalizedUrl = normalizeUrl(url);

  const { siteId: resolvedId, action } = await skipSite({
    url: normalizedUrl,
    reason,
    siteId,
    companyName: company,
    token,
  });

  const result: BatchResult = {
    url,
    siteId: resolvedId,
    companyName: company,
    outcome: "SKIPPED",
    reason,
    timestamp: new Date().toISOString(),
  };

  if (batchDir) appendBatchResult(batchDir, result);

  console.log(
    JSON.stringify({ siteId: resolvedId, url, status: "SKIPPED", adminNote: reason, action }),
  );
}

// ---------------------------------------------------------------------------
// Command: log
// ---------------------------------------------------------------------------

async function cmdLog(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const batchDir = flagStr(flags, "batch-dir");
  const url = flagStr(flags, "url");
  const outcome = flagStr(flags, "outcome") as Outcome | undefined;
  const reason = flagStr(flags, "reason") ?? "";
  const siteId = flagStr(flags, "site-id");
  const company = flagStr(flags, "company");
  const jobsStr = flagStr(flags, "jobs");

  if (!batchDir) throw new Error("--batch-dir is required");
  if (!url) throw new Error("--url is required");
  if (!outcome) throw new Error("--outcome is required");

  const validOutcomes: Outcome[] = ["ACTIVE", "SKIPPED", "ALREADY_ACTIVE", "SKIP_PRIOR", "DUPLICATE_IN_BATCH", "INVALID_URL", "ERROR"];
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`--outcome must be one of: ${validOutcomes.join(", ")}`);
  }

  fs.mkdirSync(batchDir, { recursive: true });

  // For successful onboards, write the company name onto the live site so the
  // dashboard shows it. POST /api/sites only accepts { siteUrl }, so the name
  // has to be applied as a follow-up PATCH (mirrors the SKIPPED path). Best
  // effort: a failure here must never break the batch log.
  if (outcome === "ACTIVE" && company && siteId) {
    try {
      const headers = authHeaders(readToken());
      await apiPatch(`/api/sites/${siteId}`, { companyName: company }, headers);
      console.log(`[batch] Set companyName="${company}" on ${siteId}`);
    } catch (e) {
      console.warn(
        `[batch] WARN: failed to set companyName on ${siteId}: ${(e as Error).message}`,
      );
    }
  }

  const result: BatchResult = {
    url,
    siteId,
    companyName: company,
    outcome,
    reason,
    jobCount: jobsStr !== undefined ? parseInt(jobsStr, 10) : undefined,
    timestamp: new Date().toISOString(),
  };

  appendBatchResult(batchDir, result);
  console.log(`[batch] Logged: ${url} → ${outcome} (${reason})`);
}

// ---------------------------------------------------------------------------
// Command: summary
// ---------------------------------------------------------------------------

async function cmdSummary(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const batchDir = flagStr(flags, "batch-dir");
  if (!batchDir) throw new Error("--batch-dir is required");

  const results = readBatchResults(batchDir);
  if (!results.length) {
    console.log("[batch] No results found in batch log.");
    return;
  }

  // Tally by outcome
  const tally: Record<string, number> = {};
  let scrapeCount = 0;
  for (const r of results) {
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    if (r.outcome === "ACTIVE") scrapeCount++;
  }

  const total = results.length;

  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(70));
  lines.push(`Batch complete — ${total} URL${total !== 1 ? "s" : ""} processed`);
  lines.push("=".repeat(70));
  for (const [outcome, count] of Object.entries(tally).sort()) {
    lines.push(`  ${outcome.padEnd(22)} ${count}`);
  }
  lines.push(`  ${"API scrapes triggered:".padEnd(22)} ${scrapeCount}`);
  lines.push("=".repeat(70));
  lines.push("");

  // Table header
  const urlW = 55;
  const outW = 16;
  const idW = 16;
  const reasonW = 42;
  const header =
    `| ${"#".padStart(3)} | ${"URL".padEnd(urlW)} | ${"Outcome".padEnd(outW)} | ${"Site ID".padEnd(idW)} | ${"Reason / Jobs".padEnd(reasonW)} |`;
  const sep =
    `|${"-".repeat(5)}|${"-".repeat(urlW + 2)}|${"-".repeat(outW + 2)}|${"-".repeat(idW + 2)}|${"-".repeat(reasonW + 2)}|`;

  lines.push(header);
  lines.push(sep);

  results.forEach((r, i) => {
    const urlShort = r.url.length > urlW ? r.url.slice(0, urlW - 3) + "..." : r.url.padEnd(urlW);
    const out = r.outcome.padEnd(outW);
    const sid = (r.siteId ?? "").slice(0, idW).padEnd(idW);
    const reasonPart =
      r.outcome === "ACTIVE" && r.jobCount !== undefined
        ? `${r.jobCount} jobs scraped`
        : (r.reason ?? "").slice(0, reasonW);
    const reason = reasonPart.padEnd(reasonW);
    lines.push(`| ${String(i + 1).padStart(3)} | ${urlShort} | ${out} | ${sid} | ${reason} |`);
  });

  lines.push("");

  const output = lines.join("\n");
  console.log(output);

  // Write summary.md
  const mdPath = path.join(batchDir, "summary.md");
  fs.writeFileSync(mdPath, `# Batch onboarding summary\n\n\`\`\`\n${output}\n\`\`\`\n`, "utf8");
  console.error(`[batch] Summary written to ${mdPath}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const [, , subcommand, ...rest] = process.argv;

const commands: Record<string, (argv: string[]) => Promise<void>> = {
  parse: cmdParse,
  skip: cmdSkip,
  log: cmdLog,
  summary: cmdSummary,
};

const cmd = commands[subcommand];
if (!cmd) {
  console.error(
    `Usage: npx tsx scripts/addsite-batch.ts <parse|skip|log|summary> [options]\n` +
    `\n` +
    `  parse   --file <path> | --csv <path> --column <col> | <URL...>\n` +
    `          [--force] [--max-urls N] [--limit N] [--start N] [--resume <jsonl>]\n` +
    `\n` +
    `  skip    --url <URL> --reason "<note>" [--site-id <id>] [--batch-dir <dir>]\n` +
    `\n` +
    `  log     --batch-dir <dir> --url <URL> --outcome <OUTCOME> --reason "<reason>"\n` +
    `          [--site-id <id>] [--jobs N]\n` +
    `\n` +
    `  summary --batch-dir <dir>\n`,
  );
  process.exit(1);
}

cmd(rest).catch((e) => {
  console.error(`[batch] ERROR: ${(e as Error).message}`);
  process.exit(1);
});
