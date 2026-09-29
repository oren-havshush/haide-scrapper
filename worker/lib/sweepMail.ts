// The sweep report by email, through the haide-jobs WordPress mailer
// (haide-mailer/v1/send; C:\Users\shayo\.claude\plans\AGENT-BRIEF.md).
//
// One POST = one mail with exactly ONE file part. The mailer's contract:
//   - multipart/form-data: subject, recipients (comma list), body (HTML), source, file
//   - a second part named `file` is silently collapsed by PHP to the last one —
//     the one way to lose data against this API, so exactly one is ever sent
//   - every response is { success, data } or { success: false, error: { code, message } },
//     with accurate HTTP status codes
//   - 401 / 403 / 400 are deterministic: never retried
//
// A report that cannot be mailed must not cost the night its report. Nothing
// here throws: every outcome — sent, skipped, refused, unreachable — comes back
// as an emailStatus string, which the caller records on the sweep row, and the
// failures are logged loudly. The token is never logged in any form.

import { gateSuffix, type ReportItem } from "./sweepReport";

export type MailKind = "SCRAPE" | "POLICY";

export type MailConfig = { url: string | null; token: string | null; recipients: string[] };

export type MailOutcome = {
  /** "sent", "sent (warning: …)", "skipped: …" or "failed: …". Recorded on ScrapeSweep.emailStatus. */
  emailStatus: string;
  httpStatus: number | null;
  /** The mailer's `data` on a 2xx — nothing in it is sensitive. */
  data: unknown;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export const DEFAULT_RECIPIENT = "info@haide-jobs.co.il";

/** The token names the project, and every sweep of ours is sent with the scraper's. */
const EXPECTED_CLIENT = "scraper";

function blankToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

export function readMailConfig(env: Record<string, string | undefined> = process.env): MailConfig {
  const to = blankToNull(env.SWEEP_EMAIL_TO) ?? DEFAULT_RECIPIENT;
  return {
    url: blankToNull(env.HAIDE_MAILER_URL),
    token: blankToNull(env.HAIDE_MAILER_TOKEN),
    recipients: to
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

/** Recorded in the mailer's log, so a missing mail can be traced to the job that sent it. */
export function mailSource(kind: MailKind): string {
  return kind === "POLICY" ? "policy-sweep" : "scraper";
}

export function csvFileName(kind: MailKind, date: string): string {
  return `${kind === "POLICY" ? "policy" : "nightly"}-${date}.csv`;
}

// ---------------------------------------------------------------------------
// The CSV
// ---------------------------------------------------------------------------

/** Byte-order mark: without it Excel reads UTF-8 as the local codepage and the Hebrew is garbage. */
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

const CSV_HEADER = [
  "site URL",
  "outcome",
  "category",
  "jobs before",
  "jobs after",
  "diff",
  "scraped count",
  "withheld action",
  "fetched",
  "carried",
];

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** What the scheduled gate withheld from this site, in words; empty when nothing. */
function withheldAction(i: ReportItem): string {
  const parts: string[] = [];
  if (i.wouldPromoteTo) parts.push(`would promote to ${i.wouldPromoteTo}${gateSuffix(i)}`);
  if (i.wouldDemoteTo) parts.push(`would demote to ${i.wouldDemoteTo}${gateSuffix(i)}`);
  if (i.outcome === "withheld_skip") parts.push("would skip (login-gated apply)");
  return parts.join("; ");
}

/** Jobs after minus jobs before, signed; empty when either side is missing. */
function jobsDiff(i: ReportItem): number | null {
  const before = i.jobsBefore as number | null | undefined;
  const after = i.jobsAfter as number | null | undefined;
  if (typeof before !== "number" || typeof after !== "number") return null;
  return after - before;
}

/** One row per site, UTF-8 with a BOM, CRLF line endings — what Excel expects. */
export function buildSweepCsv(items: ReportItem[]): string {
  const rows = [CSV_HEADER.map(csvCell).join(",")];
  for (const i of items) {
    rows.push(
      [
        i.siteUrl,
        i.outcome,
        i.failureCategory,
        i.jobsBefore,
        i.jobsAfter,
        jobsDiff(i),
        i.scrapedCount,
        withheldAction(i),
        i.detailsFetched,
        i.detailsCarried,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return BOM + rows.join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// Subject and body
// ---------------------------------------------------------------------------

export function mailSubject(logText: string): string {
  return (logText.split(/\r?\n/)[0] ?? "").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The whole report, preformatted. `dir="rtl"` on the wrapper so a Hebrew mail
 * client lays the message out as it expects; `dir="ltr"` on the <pre> so the
 * report's own columns and indentation read the way they were rendered.
 */
export function buildMailBody(logText: string): string {
  return `<div dir="rtl"><pre dir="ltr">${escapeHtml(logText)}</pre></div>`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type Deps = {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  warn?: (line: string) => void;
  error?: (line: string) => void;
};

export async function sendSweepMail(
  args: { kind: MailKind; date: string; logText: string; items: ReportItem[] },
  deps: Deps = {},
): Promise<MailOutcome> {
  const log = deps.log ?? ((l: string) => console.info(l));
  const warn = deps.warn ?? ((l: string) => console.warn(l));
  const error = deps.error ?? ((l: string) => console.error(l));
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const cfg = readMailConfig(deps.env ?? process.env);

  if (!cfg.url || !cfg.token) {
    const missing = [!cfg.url && "HAIDE_MAILER_URL", !cfg.token && "HAIDE_MAILER_TOKEN"].filter(Boolean).join(" and ");
    log(`[mail] ${missing} not set — report not emailed`);
    return { emailStatus: `skipped: ${missing} not set`, httpStatus: null, data: null };
  }

  const fileName = csvFileName(args.kind, args.date);
  const form = new FormData();
  form.append("subject", mailSubject(args.logText));
  form.append("recipients", cfg.recipients.join(","));
  form.append("source", mailSource(args.kind));
  form.append("body", buildMailBody(args.logText));
  // Exactly one part named `file`. A second would be collapsed by PHP, silently.
  form.append("file", new Blob([buildSweepCsv(args.items)], { type: "text/csv" }), fileName);

  let status: number;
  let text: string;
  try {
    const res = await doFetch(cfg.url, {
      method: "POST",
      headers: { "X-Haide-Mailer-Token": cfg.token },
      body: form,
    });
    status = res.status;
    text = await res.text().catch(() => "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`[mail] !! report NOT emailed — the mailer could not be reached: ${msg}`);
    return { emailStatus: `failed: unreachable — ${msg}`.slice(0, 500), httpStatus: null, data: null };
  }

  let parsed: { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (status < 200 || status >= 300) {
    const code = parsed?.error?.code ?? "UNKNOWN";
    const message = parsed?.error?.message ?? text.replace(/\s+/g, " ").trim().slice(0, 200);
    error(`[mail] !! report NOT emailed — HTTP ${status} ${code}: ${message} (not retried)`);
    return { emailStatus: `failed: HTTP ${status} ${code}: ${message}`.slice(0, 500), httpStatus: status, data: parsed };
  }

  const data = parsed?.data ?? null;
  const problems: string[] = [];
  const client = data && typeof data === "object" ? (data as Record<string, unknown>).client : undefined;
  const attachment = data && typeof data === "object" ? (data as Record<string, unknown>).attachment : undefined;
  if (client !== EXPECTED_CLIENT) problems.push(`client is ${JSON.stringify(client ?? null)}, expected "${EXPECTED_CLIENT}"`);
  if (attachment === null || attachment === undefined) problems.push("attachment is null — the CSV did not arrive");
  for (const p of problems) warn(`[mail] sent, but ${p}`);
  const to = data && typeof data === "object" ? (data as Record<string, unknown>).sent_to : undefined;
  log(`[mail] report emailed (HTTP ${status}) to ${Array.isArray(to) ? to.join(", ") : cfg.recipients.join(", ")} with ${fileName}`);
  return {
    emailStatus: problems.length > 0 ? `sent (warning: ${problems.join("; ")})` : "sent",
    httpStatus: status,
    data,
  };
}
