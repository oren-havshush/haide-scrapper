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
 *                        [--qa-file <path-to-addsite-qa.ts-output.json>]
 *
 *   summary   Read batch-results.jsonl, print summary table, write summary.md.
 *             Usage: summary --batch-dir <dir>
 *
 *   verify-config  Re-read the PERSISTED site config and assert the itemSelector,
 *             field selectors, and formCapture field count survived the
 *             auto-analyzer race (Step 7 gate; see docs/addsite-learnings.md
 *             LRN-RACE-2). Exits 2 when clobbered so callers drive the re-PUT loop.
 *             Usage: verify-config --site-id <id> [--expect-item <sel>]
 *                        [--expect-fields a,b,c] [--expect-form-fields N]
 *                        [--expect-file <config.json>]
 *
 *   reach     Step 3 worker-parity reachability gate (bare vs real-UA nav).
 *             Exit 3 = unreachable. Usage: reach --url <URL>
 *
 *   detail-reach  Incapsula/Imperva detail-page probe (LRN-WAF-2). Exit 2 =
 *             needs UA override, 3 = blocked. Usage: detail-reach --listing <URL> --detail <URL>
 *
 *   fingerprint  Detect a known ATS/SPA framework (Workday/Greenhouse/Lever/
 *             Comeet/iCIMS/SmartRecruiters/Ashby) or WordPress/Elementor by host+DOM;
 *             emit lane + recipe pointer. Usage: fingerprint --url <URL>
 *
 *   triage    Pass A classifier (docs/addsite2-migration.md §4a): reach +
 *             fingerprint + listing-structure probe → lane GREEN/YELLOW/GRAY/RED.
 *             Usage: triage --url <URL>
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

/**
 * Per-site quality verdict produced by `scripts/addsite-qa.ts` (see addsite.md
 * B2.6). Persisted on the result row so the summary can prove batch == solo
 * quality and list the follow-ups (manual Step 5b, residual field gaps).
 */
interface QaRecord {
  fillRates?: Record<string, number>;
  formStatus?: "CAPTURED" | "NEEDS_MANUAL" | "EMAIL" | "URL" | "NONE";
  formFields?: number;
  applyResolution?: string;
  availableButUnmapped?: string[];
  manualFormUrl?: string;
  tierAComplete?: boolean;
  tierAMissing?: string[];
  sampled?: number;
}

interface BatchResult {
  url: string;
  siteId?: string;
  companyName?: string;
  outcome: Outcome;
  reason: string;
  jobCount?: number;
  timestamp: string;
  qa?: QaRecord;
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
  const qaFile = flagStr(flags, "qa-file");

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

  // Merge the QA verdict (addsite-qa.ts output) when supplied. Best effort:
  // a malformed/missing qa file must never break the batch log.
  let qa: QaRecord | undefined;
  if (qaFile) {
    try {
      const raw = fs.readFileSync(qaFile, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      qa = {
        fillRates: parsed.fillRates as Record<string, number> | undefined,
        formStatus: parsed.formStatus as QaRecord["formStatus"],
        formFields: parsed.formFields as number | undefined,
        applyResolution: parsed.applyResolution as string | undefined,
        availableButUnmapped: parsed.availableButUnmapped as string[] | undefined,
        manualFormUrl: parsed.manualFormUrl as string | undefined,
        tierAComplete: parsed.tierAComplete as boolean | undefined,
        tierAMissing: parsed.tierAMissing as string[] | undefined,
        sampled: parsed.sampled as number | undefined,
      };
    } catch (e) {
      console.warn(`[batch] WARN: could not read --qa-file ${qaFile}: ${(e as Error).message}`);
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
    ...(qa ? { qa } : {}),
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

  // Short label for the apply/form status (from the QA verdict).
  const formLabel = (r: BatchResult): string => {
    const fs = r.qa?.formStatus;
    if (!fs) return "-";
    if (fs === "CAPTURED") return `form(${r.qa?.formFields ?? "?"})`;
    if (fs === "NEEDS_MANUAL") return "MANUAL 5b";
    return fs.toLowerCase(); // email / url / none
  };
  // Residual Tier-B gaps the page exposes but the jobs are missing.
  const gapsLabel = (r: BatchResult): string => {
    const g = r.qa?.availableButUnmapped;
    if (g && g.length) return g.join(",");
    if (r.qa && r.qa.tierAComplete === false) return `Tier-A:${(r.qa.tierAMissing ?? []).join(",")}`;
    return "-";
  };

  // Table header
  const urlW = 48;
  const outW = 15;
  const idW = 16;
  const formW = 11;
  const gapW = 20;
  const reasonW = 30;
  const header =
    `| ${"#".padStart(3)} | ${"URL".padEnd(urlW)} | ${"Outcome".padEnd(outW)} | ${"Site ID".padEnd(idW)} | ${"Form".padEnd(formW)} | ${"Gaps".padEnd(gapW)} | ${"Reason / Jobs".padEnd(reasonW)} |`;
  const sep =
    `|${"-".repeat(5)}|${"-".repeat(urlW + 2)}|${"-".repeat(outW + 2)}|${"-".repeat(idW + 2)}|${"-".repeat(formW + 2)}|${"-".repeat(gapW + 2)}|${"-".repeat(reasonW + 2)}|`;

  lines.push(header);
  lines.push(sep);

  results.forEach((r, i) => {
    const urlShort = r.url.length > urlW ? r.url.slice(0, urlW - 3) + "..." : r.url.padEnd(urlW);
    const out = r.outcome.padEnd(outW);
    const sid = (r.siteId ?? "").slice(0, idW).padEnd(idW);
    const form = formLabel(r).slice(0, formW).padEnd(formW);
    const gaps = gapsLabel(r).slice(0, gapW).padEnd(gapW);
    const reasonPart =
      r.outcome === "ACTIVE" && r.jobCount !== undefined
        ? `${r.jobCount} jobs scraped`
        : (r.reason ?? "").slice(0, reasonW);
    const reason = reasonPart.padEnd(reasonW);
    lines.push(`| ${String(i + 1).padStart(3)} | ${urlShort} | ${out} | ${sid} | ${form} | ${gaps} | ${reason} |`);
  });

  lines.push("");

  // --- Manual apply-form follow-ups (list-only; run standalone Step 5b) ---
  const manual = results.filter((r) => r.qa?.formStatus === "NEEDS_MANUAL");
  if (manual.length) {
    lines.push("Manual apply-form follow-ups (headless capture failed — run standalone Step 5b):");
    manual.forEach((r, i) => {
      const target = r.qa?.manualFormUrl || r.url;
      lines.push(`  ${i + 1}. ${r.siteId ?? "(no id)"}  ${r.url}`);
      lines.push(`     → run step 5b ${target}`);
    });
    lines.push("");
  }

  // --- Quality gaps (page exposes a field the jobs are missing) ---
  const gapped = results.filter(
    (r) => (r.qa?.availableButUnmapped?.length ?? 0) > 0 || r.qa?.tierAComplete === false,
  );
  if (gapped.length) {
    lines.push("Quality gaps (page exposes fields the jobs are missing — re-map to reach solo parity):");
    gapped.forEach((r, i) => {
      const tb = r.qa?.availableButUnmapped?.length ? `Tier-B: ${r.qa.availableButUnmapped.join(", ")}` : "";
      const ta =
        r.qa?.tierAComplete === false ? `Tier-A missing: ${(r.qa.tierAMissing ?? []).join(", ")}` : "";
      lines.push(`  ${i + 1}. ${r.siteId ?? "(no id)"}  ${r.url}`);
      lines.push(`     ${[ta, tb].filter(Boolean).join("  |  ")}`);
    });
    lines.push("");
  }

  if (!manual.length && !gapped.length && results.some((r) => r.qa)) {
    lines.push("No manual form follow-ups and no field gaps detected — batch reached solo-quality parity.");
    lines.push("");
  }

  const output = lines.join("\n");
  console.log(output);

  // Write summary.md
  const mdPath = path.join(batchDir, "summary.md");
  fs.writeFileSync(mdPath, `# Batch onboarding summary\n\n\`\`\`\n${output}\n\`\`\`\n`, "utf8");
  console.error(`[batch] Summary written to ${mdPath}`);
}

// ---------------------------------------------------------------------------
// Command: verify-config  (Step 7 analyzer-clobber gate, as code)
// ---------------------------------------------------------------------------
//
// Re-reads the PERSISTED config (not a PATCH response) and asserts that the
// itemSelector + the field selectors you PUT + the formCapture field count all
// survived the auto-analyzer race (see docs/addsite-learnings.md LRN-RACE-2,
// yazamco.co.il). Prints a JSON verdict and exits 2 when the config was
// clobbered so callers can drive the re-PUT loop without parsing prose.
//
//   npx tsx scripts/addsite-batch.ts verify-config --site-id <id> \
//     --expect-item "div.job" --expect-fields "title,externalJobId,description" \
//     [--expect-form-fields 7]
//
//   # or derive all expectations from the config JSON you PUT in Step 6:
//   npx tsx scripts/addsite-batch.ts verify-config --site-id <id> \
//     --expect-file .scratch/scrap-config.json
//
// Exit codes: 0 = config OK · 2 = clobbered/mismatch · 1 = usage/API error.

interface StoredFieldMapping {
  selector?: string;
  [k: string]: unknown;
}
interface StoredMeta {
  itemSelector?: string;
  formCapture?: { fields?: unknown[] } | null;
  [k: string]: unknown;
}
type StoredFieldMappings = Record<string, StoredFieldMapping | StoredMeta> & {
  _meta?: StoredMeta;
};

async function getStoredFieldMappings(
  siteId: string,
  headers: Record<string, string>,
): Promise<StoredFieldMappings | undefined> {
  const r = (await apiGet(
    `/api/sites?id=${encodeURIComponent(siteId)}`,
    headers,
  )) as { data?: Array<{ id: string; fieldMappings?: StoredFieldMappings }> };
  const site = r?.data?.find((s) => s.id === siteId) ?? r?.data?.[0];
  return site?.fieldMappings;
}

async function cmdVerifyConfig(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const siteId = flagStr(flags, "site-id");
  if (!siteId) throw new Error("--site-id is required");

  // Expectations: either explicit flags, or derived from the PUT config file.
  let expectItem = flagStr(flags, "expect-item");
  let expectFields = (flagStr(flags, "expect-fields") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let expectFormFields = flagInt(flags, "expect-form-fields", 0);

  const expectFile = flagStr(flags, "expect-file");
  if (expectFile) {
    const cfg = JSON.parse(fs.readFileSync(expectFile, "utf8")) as {
      itemSelector?: string;
      fieldMappings?: Record<string, unknown>;
      formCapture?: { fields?: unknown[] } | null;
    };
    if (!expectItem) expectItem = cfg.itemSelector;
    if (!expectFields.length && cfg.fieldMappings) {
      expectFields = Object.keys(cfg.fieldMappings);
    }
    if (!flagStr(flags, "expect-form-fields")) {
      expectFormFields = cfg.formCapture?.fields?.length ?? 0;
    }
  }

  const headers = authHeaders(readToken());
  const fm = await getStoredFieldMappings(siteId, headers);
  if (!fm) throw new Error(`No fieldMappings found for site ${siteId}`);

  const meta = (fm._meta ?? {}) as StoredMeta;
  const storedItem = meta.itemSelector;
  const storedFormFields = meta.formCapture?.fields?.length ?? 0;

  const itemOk = !expectItem || storedItem === expectItem;
  const missingFields = expectFields.filter((k) => {
    const f = fm[k] as StoredFieldMapping | undefined;
    return !f || !f.selector;
  });
  const fieldsOk = missingFields.length === 0;
  const formOk = expectFormFields === 0 || storedFormFields >= expectFormFields;

  const ok = itemOk && fieldsOk && formOk;
  const verdict = {
    siteId,
    ok,
    itemOk,
    fieldsOk,
    formOk,
    expectedItem: expectItem ?? null,
    storedItem: storedItem ?? null,
    missingFields,
    expectedFormFields: expectFormFields,
    storedFormFields,
  };
  console.log(JSON.stringify(verdict, null, 2));

  if (!ok) {
    console.error(
      `[verify-config] CLOBBERED: itemOk=${itemOk} fieldsOk=${fieldsOk} formOk=${formOk}` +
        (missingFields.length ? ` missing=[${missingFields.join(",")}]` : "") +
        ` (stored itemSelector="${storedItem ?? ""}")`,
    );
    process.exit(2);
  }
  console.error(
    `[verify-config] OK: itemSelector="${storedItem ?? ""}" fields=[${expectFields.join(",")}] formFields=${storedFormFields}`,
  );
}

// ---------------------------------------------------------------------------
// Playwright-backed probes (reach / detail-reach / fingerprint / triage)
// ---------------------------------------------------------------------------
//
// These power the v2 "Pass A — Triage" lane (see docs/addsite2-migration.md
// §4a): cheap, scripted classification BEFORE the expensive build pass. They
// import playwright lazily (like addsite-qa.ts) so the pure-fetch commands
// above never require it.

const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HE_HEADERS: Record<string, string> = {
  "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
};
// Challenge/anti-bot interstitial markers (Cloudflare/Reblaze/etc.).
const CHALLENGE_RE =
  /just a moment|cf-mitigated|reblaze|access denied|attention required|enable javascript and cookies/i;
// Imperva/Incapsula HeadlessChrome block markers (see LRN-WAF-2).
const INCAPSULA_RE = /Request unsuccessful|_Incapsula_Resource/i;

async function getChromium(): Promise<any | null> {
  try {
    const pw = (await import("playwright")) as any;
    return pw.chromium;
  } catch {
    return null;
  }
}

interface NavResult {
  ok: boolean;
  status?: number;
  challenged?: boolean;
  error?: string;
  htmlLen: number;
  html: string;
}

async function tryNav(chromium: any, url: string, opts: any): Promise<NavResult> {
  const b = await chromium.launch({ headless: true });
  try {
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
    const r = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const html = await p.content().catch(() => "");
    const challenged = CHALLENGE_RE.test(html);
    return {
      ok: !!r && r.status() < 400 && !challenged,
      status: r?.status(),
      challenged,
      htmlLen: html.length,
      html,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).split("\n")[0], htmlLen: 0, html: "" };
  } finally {
    await b.close().catch(() => {});
  }
}

// --- reach: Step 3 worker-parity reachability gate -------------------------
// Exit 0 = reachable (JSON says whether a UA override is needed); 3 = unreachable.
async function cmdReach(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const url = flagStr(flags, "url");
  if (!url) throw new Error("--url is required");
  const chromium = await getChromium();
  if (!chromium) {
    console.error("[reach] playwright unavailable — run `npx playwright install chromium`");
    process.exit(1);
  }

  const bare = await tryNav(chromium, url, {});
  if (bare.ok) {
    console.log(JSON.stringify({ url, ok: true, needsUaOverride: false, lane: "reachable" }, null, 2));
    console.error(`[reach] PASS bare (status=${bare.status})`);
    return;
  }
  const real = await tryNav(chromium, url, { userAgent: REAL_UA, extraHTTPHeaders: HE_HEADERS });
  if (real.ok) {
    console.log(
      JSON.stringify(
        {
          url,
          ok: true,
          needsUaOverride: true,
          browserOverrides: { userAgent: REAL_UA, extraHeaders: HE_HEADERS },
          lane: "reachable",
        },
        null,
        2,
      ),
    );
    console.error("[reach] UA-keyed WAF detected — carry browserOverrides.userAgent into the config (LRN-WAF-1).");
    return;
  }
  console.log(
    JSON.stringify(
      {
        url,
        ok: false,
        needsUaOverride: false,
        reason: "unreachable (network/region/captcha)",
        bareError: bare.error ?? null,
        realError: real.error ?? null,
      },
      null,
      2,
    ),
  );
  console.error("[reach] FAIL: neither bare nor real-UA could reach the site (likely IL-IP/captcha/outage).");
  process.exit(3);
}

// --- detail-reach: Incapsula detail-page probe (LRN-WAF-2) ------------------
// Exit 0 = detail reachable bare; 2 = needs UA override; 3 = blocked even with UA.
async function cmdDetailReach(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const listing = flagStr(flags, "listing");
  const detail = flagStr(flags, "detail");
  if (!listing || !detail) throw new Error("--listing and --detail are required");
  const chromium = await getChromium();
  if (!chromium) {
    console.error("[detail-reach] playwright unavailable");
    process.exit(1);
  }

  async function probe(useUA: boolean): Promise<{ blocked: boolean; bytes: number }> {
    const b = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--lang=he-IL"],
    });
    try {
      const ctx = await b.newContext({
        viewport: { width: 1280, height: 800 },
        ...(useUA ? { userAgent: REAL_UA } : {}),
        locale: "he-IL",
        timezoneId: "Asia/Jerusalem",
        extraHTTPHeaders: HE_HEADERS,
      });
      await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
      const p = await ctx.newPage();
      await p.goto(listing, { waitUntil: "domcontentloaded", timeout: 30000 }); // set cookies
      await p.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      await p.goto(detail, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(4000);
      const html = await p.content();
      return { blocked: INCAPSULA_RE.test(html), bytes: html.length };
    } catch {
      return { blocked: true, bytes: 0 };
    } finally {
      await b.close().catch(() => {});
    }
  }

  const parity = await probe(false);
  const withUa = await probe(true);
  console.log(
    JSON.stringify(
      {
        listing,
        detail,
        workerParityBlocked: parity.blocked,
        uaOverrideBlocked: withUa.blocked,
        parityBytes: parity.bytes,
        uaBytes: withUa.bytes,
      },
      null,
      2,
    ),
  );
  if (!parity.blocked) {
    console.error("[detail-reach] OK: detail page reachable at worker parity.");
    return;
  }
  if (!withUa.blocked) {
    console.error("[detail-reach] NEEDS UA OVERRIDE: add browserOverrides.userAgent (LRN-WAF-2).");
    process.exit(2);
  }
  console.error("[detail-reach] BLOCKED even with a real UA — detail pages unreachable today.");
  process.exit(3);
}

// --- fingerprint: detect known ATS/SPA framework or WP, emit lane + recipe --
interface Fingerprint {
  url: string;
  host: string;
  vendor: string;
  lane: "GREEN" | "YELLOW";
  recipe: string | null;
  signals: string[];
}

function fingerprintByHost(host: string): { vendor: string; recipe: string } | null {
  const h = host.toLowerCase();
  if (h.endsWith("myworkdayjobs.com") || h.includes(".myworkdayjobs."))
    return { vendor: "workday", recipe: "recipes/spa-frameworks.md#workday" };
  if (h.endsWith("greenhouse.io") || h.includes("boards.greenhouse"))
    return { vendor: "greenhouse", recipe: "recipes/spa-frameworks.md#greenhouse" };
  if (h.endsWith("lever.co")) return { vendor: "lever", recipe: "recipes/spa-frameworks.md#lever" };
  if (h.includes("comeet.com") || h.endsWith("comeet.co"))
    return { vendor: "comeet", recipe: "recipes/spa-frameworks.md#comeet" };
  if (h.includes("icims.com")) return { vendor: "icims", recipe: "recipes/spa-frameworks.md#icims" };
  if (h.includes("smartrecruiters.com"))
    return { vendor: "smartrecruiters", recipe: "recipes/spa-frameworks.md#smartrecruiters" };
  if (h.includes("ashbyhq.com")) return { vendor: "ashby", recipe: "recipes/spa-frameworks.md#ashby" };
  return null;
}

async function cmdFingerprint(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const url = flagStr(flags, "url");
  if (!url) throw new Error("--url is required");
  let host = "";
  try {
    host = new URL(normalizeUrl(url)).hostname;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const signals: string[] = [];
  const byHost = fingerprintByHost(host);
  if (byHost) {
    const fp: Fingerprint = {
      url,
      host,
      vendor: byHost.vendor,
      lane: "GREEN",
      recipe: byHost.recipe,
      signals: [`host matches ${byHost.vendor}`],
    };
    console.log(JSON.stringify(fp, null, 2));
    console.error(`[fingerprint] GREEN: ${byHost.vendor} (host) → ${byHost.recipe}`);
    return;
  }

  // Unknown host → sniff the DOM for embedded-framework / CMS signals.
  let vendor = "unknown";
  let recipe: string | null = null;
  let lane: "GREEN" | "YELLOW" = "YELLOW";
  const chromium = await getChromium();
  if (chromium) {
    const nav = await tryNav(chromium, url, {
      locale: "he-IL",
      extraHTTPHeaders: HE_HEADERS,
    } as any);
    const html = nav.html || "";
    if (/greenhouse\.io\/embed|grnhse_app|boards\.greenhouse/i.test(html)) {
      vendor = "greenhouse";
      recipe = "recipes/spa-frameworks.md#greenhouse";
      lane = "GREEN";
      signals.push("greenhouse embed in DOM");
    } else if (/comeet\.co|positionItem|data-qa="position/i.test(html)) {
      vendor = "comeet";
      recipe = "recipes/spa-frameworks.md#comeet";
      lane = "GREEN";
      signals.push("comeet markup in DOM");
    } else if (/api\.lever\.co|lever-jobs/i.test(html)) {
      vendor = "lever";
      recipe = "recipes/spa-frameworks.md#lever";
      lane = "GREEN";
      signals.push("lever markup in DOM");
    } else if (/elementor-widget|data-elementor-type/i.test(html)) {
      vendor = "wordpress-elementor";
      recipe = "recipes/setupscript-patterns.md#elementor";
      lane = "YELLOW";
      signals.push("Elementor detected");
    } else if (/wp-content|wp-json|name="generator" content="WordPress/i.test(html)) {
      vendor = "wordpress";
      recipe = null;
      lane = "YELLOW";
      signals.push("WordPress detected");
    } else if (!nav.ok) {
      signals.push(`page nav not clean (status=${nav.status ?? "?"} challenged=${nav.challenged ?? false})`);
    } else {
      signals.push("no known framework signal");
    }
  } else {
    signals.push("playwright unavailable — host-only fingerprint");
  }

  const fp: Fingerprint = { url, host, vendor, lane, recipe, signals };
  console.log(JSON.stringify(fp, null, 2));
  console.error(`[fingerprint] ${lane}: ${vendor}${recipe ? ` → ${recipe}` : ""}`);
}

// --- triage: Pass A classifier → lane GREEN/YELLOW/GRAY/RED ----------------
// Composes reach + fingerprint + a quick listing-structure probe.
async function cmdTriage(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const url = flagStr(flags, "url");
  if (!url) throw new Error("--url is required");
  const chromium = await getChromium();
  if (!chromium) {
    console.error("[triage] playwright unavailable");
    process.exit(1);
  }

  // 1. Reachability (bare then real-UA).
  let reachable = false;
  let needsUaOverride = false;
  const bare = await tryNav(chromium, url, {});
  let listingHtml = bare.html;
  if (bare.ok) {
    reachable = true;
  } else {
    const real = await tryNav(chromium, url, { userAgent: REAL_UA, extraHTTPHeaders: HE_HEADERS });
    if (real.ok) {
      reachable = true;
      needsUaOverride = true;
      listingHtml = real.html;
    }
  }

  let host = "";
  try {
    host = new URL(normalizeUrl(url)).hostname;
  } catch {
    /* ignore */
  }

  if (!reachable) {
    const out = { url, host, lane: "RED", reason: "unreachable (network/region/captcha)" };
    console.log(JSON.stringify(out, null, 2));
    console.error("[triage] RED: unreachable");
    return;
  }

  // 2. Known framework? (host first; DOM signal second from the fetched HTML)
  const byHost = fingerprintByHost(host);
  let vendor = byHost?.vendor ?? "unknown";
  let recipe = byHost?.recipe ?? null;
  if (!byHost && listingHtml) {
    if (/grnhse_app|boards\.greenhouse|greenhouse\.io\/embed/i.test(listingHtml)) {
      vendor = "greenhouse";
      recipe = "recipes/spa-frameworks.md#greenhouse";
    } else if (/positionItem|data-qa="position/i.test(listingHtml)) {
      vendor = "comeet";
      recipe = "recipes/spa-frameworks.md#comeet";
    }
  }

  // 3. Quick listing-structure probe: largest cluster of similarly-classed
  //    siblings (same heuristic as Step 3b) — a proxy for "is this a listing?"
  let topCluster = 0;
  try {
    const b = await chromium.launch({ headless: true });
    try {
      const ctx = await b.newContext({
        locale: "he-IL",
        extraHTTPHeaders: HE_HEADERS,
        ...(needsUaOverride ? { userAgent: REAL_UA } : {}),
      });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      topCluster = await p.evaluate(() => {
        const stats: Record<string, number> = {};
        for (const el of Array.from(document.querySelectorAll("*"))) {
          if (!el.parentElement || !el.classList.length) continue;
          const sig =
            el.parentElement.tagName + ">" + el.tagName + "." + Array.from(el.classList).sort().join(".");
          stats[sig] = (stats[sig] ?? 0) + 1;
        }
        const counts = Object.values(stats).filter((c) => c >= 2 && c <= 500);
        return counts.length ? Math.max(...counts) : 0;
      });
    } finally {
      await b.close().catch(() => {});
    }
  } catch {
    /* leave topCluster=0 */
  }

  // 4. Decide the lane.
  let lane: "GREEN" | "YELLOW" | "GRAY";
  let reason: string;
  if (vendor !== "unknown") {
    lane = "GREEN";
    reason = `known framework: ${vendor}`;
  } else if (topCluster >= 3) {
    lane = "YELLOW";
    reason = `novel site with a repeating listing structure (top cluster ~${topCluster})`;
  } else {
    lane = "GRAY";
    reason = `no obvious repeating listing structure (top cluster ${topCluster}) — needs human eyes`;
  }

  const out = {
    url,
    host,
    lane,
    reason,
    reachable,
    needsUaOverride,
    vendor,
    recipe,
    topCluster,
    ...(needsUaOverride ? { browserOverrides: { userAgent: REAL_UA, extraHeaders: HE_HEADERS } } : {}),
  };
  console.log(JSON.stringify(out, null, 2));
  console.error(
    `[triage] ${lane}: ${reason}${needsUaOverride ? " (UA override required)" : ""}` +
      `${recipe ? ` → ${recipe}` : ""}`,
  );
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
  "verify-config": cmdVerifyConfig,
  reach: cmdReach,
  "detail-reach": cmdDetailReach,
  fingerprint: cmdFingerprint,
  triage: cmdTriage,
};

const cmd = commands[subcommand];
if (!cmd) {
  console.error(
    `Usage: npx tsx scripts/addsite-batch.ts <command> [options]\n` +
    `\n` +
    `  parse         --file <path> | --csv <path> --column <col> | <URL...>\n` +
    `                [--force] [--max-urls N] [--limit N] [--start N] [--resume <jsonl>]\n` +
    `\n` +
    `  skip          --url <URL> --reason "<note>" [--site-id <id>] [--batch-dir <dir>]\n` +
    `\n` +
    `  log           --batch-dir <dir> --url <URL> --outcome <OUTCOME> --reason "<reason>"\n` +
    `                [--site-id <id>] [--jobs N] [--qa-file <addsite-qa.json>]\n` +
    `\n` +
    `  summary       --batch-dir <dir>\n` +
    `\n` +
    `  verify-config --site-id <id> [--expect-item <sel>] [--expect-fields a,b,c]\n` +
    `                [--expect-form-fields N] [--expect-file <config.json>]\n` +
    `                (exit 2 = analyzer clobbered the config)\n` +
    `\n` +
    `  reach         --url <URL>   (exit 3 = unreachable; JSON says if UA override needed)\n` +
    `  detail-reach  --listing <URL> --detail <URL>  (exit 2 = needs UA override; 3 = blocked)\n` +
    `  fingerprint   --url <URL>   (detect ATS/SPA/WP framework → lane + recipe + JSON)\n` +
    `  triage        --url <URL>   (Pass A classifier → lane GREEN/YELLOW/GRAY/RED + JSON)\n`,
  );
  process.exit(1);
}

cmd(rest).catch((e) => {
  console.error(`[batch] ERROR: ${(e as Error).message}`);
  process.exit(1);
});
