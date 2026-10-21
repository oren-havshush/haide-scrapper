/**
 * The daily reader of the public site's apply refusals (report fixes 3, item 17).
 *
 * The public site submits applications from the live page and refuses a job
 * when it cannot: job_id_synthesised (an h- id, which it will not post),
 * job_field_unfillable (a required field it cannot fill), job_id_missing.
 * It publishes the full open list at
 *   GET <PUBLIC_SITE_REFUSALS_URL>  (Authorization: Bearer <token>)
 *   -> { success, data: [ { code, externalJobId, jobUrl, field?, firstSeen, lastSeen } ], meta: { total, generatedAt } }
 * one row per job; a row appears after a real attempt met the refusal and
 * leaves when a later attempt gets past it or the job is unpublished. A 502
 * means "try later", never an empty list.
 *
 * Once a night, inside the policy sweep (worker/sweep/policy.ts), as one step
 * that can never fail the sweep:
 *   - token unset: "not configured", nothing done;
 *   - one GET, 30 s timeout; anything but a 2xx with success true and a
 *     parseable body is "unavailable": one retry after 60 s, then nothing in
 *     the fix queue changes this run;
 *   - each row is matched to a site by externalJobId AND host (the jobUrl's
 *     host against the site's siteUrl host or its jobs' detailUrl hosts,
 *     www. ignored): externalJobId is unique per site, not per fleet. No
 *     match or several: unmatched, listed in the report, no item;
 *   - job_id_synthesised and job_field_unfillable open one APPLY item per job
 *     and code on the job's site, kept (its lastSeen updated) while the row is
 *     listed; job_id_missing opens none (counted and listed only);
 *   - after a successful read, every open reader item whose row is gone is
 *     resolved, "left the public site's list". An empty list resolves them all.
 * The reader's items are CHECK items with the code prefix "public_site:", the
 * same way the big lane marks its own: no value check opens or closes them
 * (worker/lib/valueChecks.ts takes part only with its own codes), and the
 * reader touches no other item. Nothing here touches a site's status, config
 * or jobs.
 *
 * Both settings are read here and nowhere else.
 */

export const DEFAULT_REFUSALS_URL = "https://haide-frontend.vercel.app/api/crawler/apply-refusals";
export const REFUSAL_CODES = ["job_id_synthesised", "job_field_unfillable", "job_id_missing"] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
/** The codes that open an item; job_id_missing is reported only. */
const ITEM_CODES: ReadonlySet<string> = new Set(["job_id_synthesised", "job_field_unfillable"]);
/** The reader's mark on its fix items' code. */
export const READER_CODE_PREFIX = "public_site:";
export const LEFT_THE_LIST = "left the public site's list";
/** Where the two settings are read from: process.env, or a test's own record. */
type EnvVars = Readonly<Record<string, string | undefined>>;
const READ_TIMEOUT_MS = 30_000;
const RETRY_AFTER_MS = 60_000;

export function refusalsConfig(env: EnvVars = process.env): { url: string; token: string | null } {
  const token = (env.PUBLIC_SITE_REFUSALS_TOKEN ?? "").trim();
  return { url: (env.PUBLIC_SITE_REFUSALS_URL ?? "").trim() || DEFAULT_REFUSALS_URL, token: token || null };
}

export interface RefusalRow {
  code: RefusalCode;
  externalJobId: string;
  jobUrl: string;
  field?: string;
  firstSeen: string;
  lastSeen: string;
}

/** A body the endpoint answered, or why it is not one. */
export function parseRefusalsBody(body: unknown): { ok: true; rows: RefusalRow[]; unknown: Array<{ code: string; externalJobId: string }> } | { ok: false; why: string } {
  if (!body || typeof body !== "object") return { ok: false, why: "not a JSON object" };
  const b = body as { success?: unknown; data?: unknown };
  if (b.success !== true) return { ok: false, why: "success is not true" };
  if (!Array.isArray(b.data)) return { ok: false, why: "data is not a list" };
  const rows: RefusalRow[] = [];
  const unknown: Array<{ code: string; externalJobId: string }> = [];
  for (const raw of b.data) {
    if (!raw || typeof raw !== "object") return { ok: false, why: "a row is not an object" };
    const r = raw as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code : "";
    const externalJobId = typeof r.externalJobId === "string" ? r.externalJobId : "";
    if (!(REFUSAL_CODES as readonly string[]).includes(code)) {
      unknown.push({ code, externalJobId });
      continue;
    }
    // A row without an id or a URL cannot be matched; it is kept, and reported as unmatched.
    rows.push({
      code: code as RefusalCode,
      externalJobId,
      jobUrl: typeof r.jobUrl === "string" ? r.jobUrl : "",
      ...(typeof r.field === "string" && r.field ? { field: r.field } : {}),
      firstSeen: typeof r.firstSeen === "string" ? r.firstSeen : "",
      lastSeen: typeof r.lastSeen === "string" ? r.lastSeen : "",
    });
  }
  return { ok: true, rows, unknown };
}

export type RefusalsRead =
  | { status: "not_configured" }
  | { status: "unavailable"; detail: string }
  | { status: "ok"; rows: RefusalRow[]; unknown: Array<{ code: string; externalJobId: string }> };

/** One GET, retried once after 60 s; the fetch and the wait are injectable for tests. */
export async function readRefusals(deps: {
  env?: EnvVars;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
} = {}): Promise<RefusalsRead> {
  const { url, token } = refusalsConfig(deps.env);
  if (!token) return { status: "not_configured" };
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const once = async (): Promise<RefusalsRead> => {
    try {
      const res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      if (res.status < 200 || res.status > 299) return { status: "unavailable", detail: `HTTP ${res.status}` };
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { status: "unavailable", detail: `HTTP ${res.status}, a body that is not JSON` };
      }
      const parsed = parseRefusalsBody(body);
      if (!parsed.ok) return { status: "unavailable", detail: `HTTP ${res.status}, ${parsed.why}` };
      return { status: "ok", rows: parsed.rows, unknown: parsed.unknown };
    } catch (err) {
      return { status: "unavailable", detail: `network: ${(err as Error).message}`.slice(0, 200) };
    }
  };
  const first = await once();
  if (first.status === "ok") return first;
  deps.log?.(`[refusals] unavailable (${first.status === "unavailable" ? first.detail : ""}); retrying in 60 s`);
  await sleep(RETRY_AFTER_MS);
  return once();
}

/** The host of a URL, lower case, "www." dropped; "" when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A job the row's externalJobId names, with its site's hosts. */
export interface CandidateJob {
  siteId: string;
  externalJobId: string;
  /** The site's siteUrl host and every one of its jobs' detailUrl hosts, as hostOf gives them. */
  siteHosts: ReadonlySet<string>;
}

/** The one site a row belongs to, or null (no match, or several). */
export function matchRefusal(row: RefusalRow, candidates: CandidateJob[]): string | null {
  const host = hostOf(row.jobUrl);
  if (!host) return null;
  const sites = new Set(candidates.filter((c) => c.externalJobId === row.externalJobId && c.siteHosts.has(host)).map((c) => c.siteId));
  return sites.size === 1 ? [...sites][0]! : null;
}

export interface ReaderItem {
  id: string;
  siteId: string;
  code: string;
  /** [externalJobId]: the job the item is about. */
  jobIds: unknown;
}

export interface RefusalPlan {
  open: Array<{ siteId: string; code: string; externalJobId: string; detail: string }>;
  keep: Array<{ id: string; detail: string }>;
  resolve: string[];
  missing: RefusalRow[];
  unmatched: RefusalRow[];
}

/** The detail line an item carries: the field, when the row names one, and the dates. */
export function itemDetail(row: RefusalRow): string {
  return [
    `${row.code} on ${row.externalJobId}`,
    row.field ? `field ${row.field}` : null,
    `first seen ${row.firstSeen || "-"}, last seen ${row.lastSeen || "-"}`,
    row.jobUrl,
  ]
    .filter(Boolean)
    .join("; ");
}

const itemKey = (siteId: string, code: string, externalJobId: string) => `${siteId}\n${code}\n${externalJobId}`;
const itemJobId = (i: ReaderItem) => (Array.isArray(i.jobIds) && typeof i.jobIds[0] === "string" ? (i.jobIds[0] as string) : "");

/** What a successful read does to the reader's open items. Pure. */
export function planRefusals(rows: RefusalRow[], candidates: CandidateJob[], openReaderItems: ReaderItem[]): RefusalPlan {
  const plan: RefusalPlan = { open: [], keep: [], resolve: [], missing: [], unmatched: [] };
  const open = new Map(openReaderItems.map((i) => [itemKey(i.siteId, i.code, itemJobId(i)), i]));
  const listed = new Set<string>();
  for (const row of rows) {
    if (row.code === "job_id_missing") {
      plan.missing.push(row);
      continue;
    }
    const siteId = matchRefusal(row, candidates);
    if (!siteId) {
      plan.unmatched.push(row);
      continue;
    }
    if (!ITEM_CODES.has(row.code)) continue;
    const code = `${READER_CODE_PREFIX}${row.code}`;
    const key = itemKey(siteId, code, row.externalJobId);
    if (listed.has(key)) continue;
    listed.add(key);
    const existing = open.get(key);
    if (existing) plan.keep.push({ id: existing.id, detail: itemDetail(row) });
    else plan.open.push({ siteId, code, externalJobId: row.externalJobId, detail: itemDetail(row) });
  }
  for (const [key, item] of open) if (!listed.has(key)) plan.resolve.push(item.id);
  return plan;
}

export interface RefusalsSummary {
  read: RefusalsRead;
  rows: number;
  opened: number;
  resolved: number;
  kept: number;
  missing: RefusalRow[];
  unmatched: RefusalRow[];
}

/** The sweep report's "Apply refusals" section. */
export function renderRefusalsSection(s: RefusalsSummary): string[] {
  const lines = ["Apply refusals"];
  if (s.read.status === "not_configured") {
    lines.push("  not configured (PUBLIC_SITE_REFUSALS_TOKEN unset): nothing read");
    return lines;
  }
  if (s.read.status === "unavailable") {
    lines.push(`  endpoint unavailable (${s.read.detail}), after one retry: the fix queue is unchanged`);
    return lines;
  }
  lines.push(`  endpoint ok: rows ${s.rows}`);
  lines.push(`  items opened ${s.opened}, resolved ${s.resolved}, kept ${s.kept}`);
  lines.push(`  job_id_missing ${s.missing.length}`);
  for (const r of s.missing.slice(0, 20)) lines.push(`    ${r.externalJobId}  ${hostOf(r.jobUrl) || r.jobUrl}`);
  lines.push(`  unmatched ${s.unmatched.length}`);
  for (const r of s.unmatched.slice(0, 20)) lines.push(`    ${r.code}  ${r.externalJobId}  ${hostOf(r.jobUrl) || r.jobUrl}`);
  const unknown = new Map<string, number>();
  for (const u of s.read.unknown) unknown.set(u.code || "(none)", (unknown.get(u.code || "(none)") ?? 0) + 1);
  lines.push(`  unknown codes ${unknown.size === 0 ? "none" : [...unknown].map(([c, n]) => `${c} (${n})`).join(", ")}`);
  return lines;
}

/** What the run needs from the database; injectable, so the run is tested without one. */
export interface RefusalsStore {
  /** Jobs whose externalJobId is one of these, each with its site's hosts. */
  candidates(externalJobIds: string[]): Promise<CandidateJob[]>;
  /** The reader's open items (code prefix READER_CODE_PREFIX), fleet-wide. */
  openReaderItems(): Promise<ReaderItem[]>;
  openItem(i: { siteId: string; code: string; externalJobId: string; detail: string; now: Date }): Promise<void>;
  keepItem(i: { id: string; detail: string; now: Date }): Promise<void>;
  resolveItems(ids: string[], now: Date): Promise<void>;
}

/** The whole step: read, plan, write. Unavailable or not configured changes nothing. */
export async function runApplyRefusals(store: RefusalsStore, deps: Parameters<typeof readRefusals>[0] & { now?: () => Date } = {}): Promise<RefusalsSummary> {
  const read = await readRefusals(deps);
  const empty: RefusalsSummary = { read, rows: 0, opened: 0, resolved: 0, kept: 0, missing: [], unmatched: [] };
  if (read.status !== "ok") return empty;
  const ids = [...new Set(read.rows.map((r) => r.externalJobId))];
  const plan = planRefusals(read.rows, ids.length ? await store.candidates(ids) : [], await store.openReaderItems());
  const now = (deps.now ?? (() => new Date()))();
  for (const o of plan.open) await store.openItem({ ...o, now });
  for (const k of plan.keep) await store.keepItem({ ...k, now });
  if (plan.resolve.length) await store.resolveItems(plan.resolve, now);
  return { read, rows: read.rows.length, opened: plan.open.length, resolved: plan.resolve.length, kept: plan.keep.length, missing: plan.missing, unmatched: plan.unmatched };
}
