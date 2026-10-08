// Nightly value checks (addsite2 phase two, step 2b). Pure: runValueChecks is
// called once, at the warnings assembly in worker/jobs/scrape.ts, for manual
// and scheduled runs alike. It returns two things:
//   - the "code: text" warnings scrape.ts writes into ScrapeRun.warnings (the
//     prefix contract sweepReport.ts matches on is kept);
//   - findings for the fix queue, which planValueCheckItems turns into CHECK
//     items opened and closed through planFixItems (worker/lib/fixQueuePlan.ts).
// The checks only warn and queue. None of them blocks a write.
//
// A finding names jobs by their stable key — externalJobId, else the detail
// URL — never by Job.id, which every scrape re-creates.
//
// apply_replay_token (step 2a, owner 2026-10-01): an apply form whose captured
// fields include a PER-SESSION value — a nonce, an anti-forgery token, a
// captcha response — cannot be submitted server-side by replaying what was
// captured. Static values (Elementor's form_id) and per-job values
// (queried_id, post_id) are replayable and are not flagged. The rule is on the
// field name, so it also works on forms captured before values were.

import { COARSE_LOCATIONS, NON_PLACE_LOCATIONS } from "./cityHomographs";
import { planFixItems, type CheckFinding, type FixFieldName, type FixQueuePlan, type OpenFixItem } from "./fixQueuePlan";
import { HONEYPOT_NAME } from "./formFields";
import { extractLocationFromGazetteer } from "./normalizer";
import { FIELD_FILL_THRESHOLD } from "./scheduledRun";

export type ReplayTokenFinding = { code: "apply_replay_token"; field: "APPLY"; count: number; names: string[] };

/** Names of per-session fields: nonces, anti-forgery tokens, captcha responses. */
const PER_SESSION: readonly RegExp[] = [
  /nonce/i,
  /^ufprt$/i,
  /^__RequestVerificationToken$/i,
  /^_?csrf/i,
  /^_token$/i,
  /^g-recaptcha-response$/i,
  /^_wpcf7_recaptcha_response$/i,
  /^cf-turnstile-response$/i,
];

export function perSessionFieldNames(fields: Array<{ name: string }>): string[] {
  return fields.map((f) => f.name).filter((n) => !!n && PER_SESSION.some((re) => re.test(n)));
}

/** One finding across a run's jobs: how many carry a per-session field, and which. */
export function applyReplayTokenFinding(blobs: Array<string | undefined | null>): ReplayTokenFinding | null {
  let count = 0;
  const names = new Set<string>();
  for (const raw of blobs) {
    const fields = parseBlob(raw)?.fields;
    if (!fields) continue;
    const hit = perSessionFieldNames(fields);
    if (hit.length === 0) continue;
    count++;
    for (const n of hit) names.add(n);
  }
  return count === 0 ? null : { code: "apply_replay_token", field: "APPLY", count, names: [...names].sort() };
}

export function applyReplayTokenWarning(f: ReplayTokenFinding): string {
  return (
    `${f.code}: ${f.count} job(s) carry per-session apply fields (${f.names.join(", ")}) — ` +
    "cannot be replayed by a server-side submit"
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A saved job, as read back after the write. */
export type SavedJobForChecks = {
  externalJobId: string | null;
  detailUrl: string | null;
  title: string | null;
  department: string | null;
  location: string | null;
  locations?: string[] | null;
  description: string | null;
  requirements: string | null;
  publishDate: string | null;
  ageBucket: string | null;
};

/** What the site published for a job before this run's delete. */
export type PreviousIdentity = {
  externalJobId: string | null;
  detailUrl: string | null;
  title: string | null;
  department: string | null;
};

/** One written row's apply-form blob (rawData._formData), with the job's key. */
export type FormBlobForChecks = { key: string; formData: string | null | undefined };

/** Per record: the id extraction produced, and the id written (extracted or synthesised). */
export type IdSeed = { extracted: string | null | undefined; id: string | null };

export type ValueCheckInput = {
  saved: SavedJobForChecks[];
  previous: PreviousIdentity[];
  formBlobs: FormBlobForChecks[];
  idSeeds: IdSeed[];
  listingItemsSeen: number | null;
  savedCount: number;
  /** Detail pages this run found dead or unavailable (listing_vs_saved_gap counts them as accounted for). */
  deadDetailPages?: number;
};

/** A finding that opens a fix-queue item. */
export type ValueCheckFinding = CheckFinding & { count: number; jobIds: string[] };

/** A check's result: the warning line, and the queue finding when the check queues. */
type CheckResult = { warning: string; finding?: ValueCheckFinding };

/** Most job keys an item carries; `count` still says how many there were. */
export const MAX_ITEM_JOB_IDS = 100;

/** The codes runValueChecks queues. Only these are ever opened or closed by it. */
export const VALUE_CHECK_QUEUE_CODES: ReadonlySet<string> = new Set([
  "apply_no_identity_field",
  "apply_template_action_url",
  "apply_honeypot_field",
  "external_job_id_churn",
  "synthesised_id_collision",
  "synthesised_external_job_id",
  "undated_rate",
  "location_homograph",
  "unknown_location_rate",
  "region_over_city",
  "listing_vs_saved_gap",
  "description_fill_low",
]);

/** Warn when this share of a site's jobs end up with no usable location. */
export const UNKNOWN_LOCATION_WARN_RATIO = 0.4;
/** Warn when this share of a site's jobs have no usable date. */
export const UNDATED_WARN_RATIO = 0.4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const trimmed = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** The stable key a finding names a job by. */
export function jobKeyOf(j: { externalJobId: string | null; detailUrl: string | null; title?: string | null }): string {
  return trimmed(j.externalJobId) || trimmed(j.detailUrl) || trimmed(j.title);
}

type BlobField = { name: string; label?: string; fieldType?: string };
type ParsedBlob = { actionUrl?: string; actionAttribute?: string; submitEndpoint?: string; fields?: BlobField[] };

function parseBlob(raw: string | null | undefined): ParsedBlob | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const b = parsed as Record<string, unknown>;
  const fields = Array.isArray(b.fields)
    ? (b.fields as unknown[]).filter((x): x is BlobField => typeof (x as BlobField)?.name === "string")
    : undefined;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
  return { actionUrl: str("actionUrl"), actionAttribute: str("actionAttribute"), submitEndpoint: str("submitEndpoint"), fields };
}

function finding(code: string, field: FixFieldName, detail: string, count: number, keys: string[]): ValueCheckFinding {
  const jobIds = [...new Set(keys.filter(Boolean))].slice(0, MAX_ITEM_JOB_IDS);
  return { code, field, detail, count, jobIds };
}

const pct = (n: number, d: number) => Math.round((n / d) * 100);

// ---------------------------------------------------------------------------
// APPLY
// ---------------------------------------------------------------------------

/** A field name that asks for who the applicant is. */
const IDENTITY_NAME = /(mail|phone|mobile|cellular|telephone|(^|[^a-z])tel([^a-z]|$)|(^|[^a-z])(first|last|full|your)?[-_ ]?name([^a-z]|$))/i;
/** The same, in a Hebrew label. */
const IDENTITY_LABEL = /(^|[\s:*(])שם|טלפון|נייד|פלאפון|סלולרי|מייל|אימייל|דוא"ל|דואר אלקטרוני|e-?mail|phone|name/i;

/** A field the applicant fills in with who they are: never hidden, never a honeypot. */
export function isIdentityField(f: BlobField): boolean {
  const type = (f.fieldType ?? "").toLowerCase();
  if (type === "hidden") return false;
  if (HONEYPOT_NAME.test(f.name)) return false;
  if (type === "email" || type === "tel") return true;
  return IDENTITY_NAME.test(f.name) || IDENTITY_LABEL.test(f.label ?? "");
}

export function applyNoIdentityField(blobs: FormBlobForChecks[]): CheckResult | null {
  const keys: string[] = [];
  for (const b of blobs) {
    const fields = parseBlob(b.formData)?.fields;
    // A blob with no fields captured is not this check's question.
    if (!fields || fields.length === 0) continue;
    if (!fields.some(isIdentityField)) keys.push(b.key);
  }
  if (keys.length === 0) return null;
  const detail = `${keys.length} job(s) have an apply form with no email, phone or name field`;
  return { warning: `apply_no_identity_field: ${detail}`, finding: finding("apply_no_identity_field", "APPLY", detail, keys.length, keys) };
}

/** {area}, {job}, or their URL-encoded form: a placeholder never filled in. */
const TEMPLATE_PLACEHOLDER = /\{[^{}]*\}|%7B[^%]*%7D/i;

export function applyTemplateActionUrl(blobs: FormBlobForChecks[]): CheckResult | null {
  const keys: string[] = [];
  const examples = new Set<string>();
  for (const b of blobs) {
    const p = parseBlob(b.formData);
    if (!p) continue;
    const hit = [p.actionUrl, p.actionAttribute, p.submitEndpoint].find((u) => !!u && TEMPLATE_PLACEHOLDER.test(u));
    if (!hit) continue;
    keys.push(b.key);
    examples.add(hit);
  }
  if (keys.length === 0) return null;
  const detail = `${keys.length} job(s) post to a URL with an unfilled placeholder (${[...examples].slice(0, 2).join(", ")})`;
  return { warning: `apply_template_action_url: ${detail}`, finding: finding("apply_template_action_url", "APPLY", detail, keys.length, keys) };
}

export function applyHoneypotField(blobs: FormBlobForChecks[]): CheckResult | null {
  const keys: string[] = [];
  const names = new Set<string>();
  for (const b of blobs) {
    const fields = parseBlob(b.formData)?.fields;
    if (!fields) continue;
    const hit = fields.filter((f) => HONEYPOT_NAME.test(f.name));
    if (hit.length === 0) continue;
    keys.push(b.key);
    for (const f of hit) names.add(f.name);
  }
  if (keys.length === 0) return null;
  const detail = `${keys.length} job(s) captured a honeypot field (${[...names].sort().join(", ")}) — a submit must leave it empty`;
  return { warning: `apply_honeypot_field: ${detail}`, finding: finding("apply_honeypot_field", "APPLY", detail, keys.length, keys) };
}

// ---------------------------------------------------------------------------
// JOB_ID
// ---------------------------------------------------------------------------

/** Keys held by exactly one row, so a join on them is unambiguous. */
function uniqueIndex<T>(rows: T[], keyOf: (r: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  const dup = new Set<string>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (out.has(k)) dup.add(k);
    out.set(k, r);
  }
  for (const k of dup) out.delete(k);
  return out;
}

const SEP = String.fromCharCode(0);
const titleDept = (r: { title: string | null; department: string | null }) =>
  trimmed(r.title) ? trimmed(r.title) + SEP + trimmed(r.department) : "";

/**
 * The same job, published again under a different id (the ern case: an id
 * minted per page load). A job is paired with its previous row by detail URL
 * when the URL is unique on both sides and the title is unchanged, else by
 * title + department when that pair is unique on both sides. A retitled job is
 * not paired: a hashed id moves with its title by design.
 */
export function externalJobIdChurn(saved: SavedJobForChecks[], previous: PreviousIdentity[]): CheckResult | null {
  if (previous.length === 0 || saved.length === 0) return null;
  const prevByUrl = uniqueIndex(previous, (r) => trimmed(r.detailUrl));
  const curByUrl = uniqueIndex(saved, (r) => trimmed(r.detailUrl));
  const prevByTd = uniqueIndex(previous, titleDept);
  const curByTd = uniqueIndex(saved, titleDept);

  const keys: string[] = [];
  let example = "";
  for (const cur of saved) {
    const id = trimmed(cur.externalJobId);
    if (!id) continue;
    let prev: PreviousIdentity | undefined;
    const url = trimmed(cur.detailUrl);
    if (url && curByUrl.get(url) === cur) {
      const p = prevByUrl.get(url);
      if (p && trimmed(p.title) === trimmed(cur.title)) prev = p;
    }
    if (!prev) {
      const td = titleDept(cur);
      if (td && curByTd.get(td) === cur) prev = prevByTd.get(td);
    }
    const before = trimmed(prev?.externalJobId);
    if (!before || before === id) continue;
    keys.push(id);
    if (!example) example = `${before} -> ${id}`;
  }
  if (keys.length === 0) return null;
  const detail = `${keys.length} job(s) came back under a different externalJobId (e.g. ${example}) — the id is not stable between scrapes`;
  return { warning: `external_job_id_churn: ${detail}`, finding: finding("external_job_id_churn", "JOB_ID", detail, keys.length, keys) };
}

/** Two jobs hashed identically, so they collapse into one row (LRN-ID-8). */
export function synthesisedIdCollision(seeds: IdSeed[]): CheckResult | null {
  const seen = new Set<string>();
  const colliding = new Set<string>();
  let collisions = 0;
  for (const s of seeds) {
    if (trimmed(s.extracted) || !s.id) continue;
    if (seen.has(s.id)) {
      collisions++;
      colliding.add(s.id);
    }
    seen.add(s.id);
  }
  if (collisions === 0) return null;
  const warning =
    `synthesised_id_collision: ${collisions} job(s) share a synthesised id ` +
    "and will dedup into one row — the site needs a real externalJobId";
  return { warning, finding: finding("synthesised_id_collision", "JOB_ID", warning.slice(warning.indexOf(":") + 2), collisions, [...colliding]) };
}

/**
 * Jobs keyed on a content hash. Full synthesis is the legitimate no-native-id
 * case (step 4) and stays a warning; PARTIAL synthesis — some jobs native, some
 * hashed on one site — means a native mapping missed jobs (weizmann 2/55,
 * safari 1/9) and opens a JOB_ID item naming the hashed ones (owner, 2026-10-04).
 */
export function synthesisedExternalJobId(seeds: IdSeed[]): CheckResult | null {
  const hashed = seeds.filter((s) => !trimmed(s.extracted) && !!s.id);
  if (hashed.length === 0) return null;
  const warning =
    `synthesised_external_job_id: ${hashed.length}/${seeds.length} job(s) ` +
    "had no externalJobId and were keyed on a content hash — prefer a native id";
  const native = seeds.some((s) => !!trimmed(s.extracted));
  if (!native) return { warning };
  const detail = `${hashed.length}/${seeds.length} job(s) hashed while the rest carry a native id — the id mapping misses some jobs`;
  return { warning, finding: finding("synthesised_external_job_id", "JOB_ID", detail, hashed.length, hashed.map((s) => s.id!)) };
}

// ---------------------------------------------------------------------------
// DATE, DESCRIPTION
// ---------------------------------------------------------------------------

/**
 * Jobs with no age bucket, missing and unparseable dates told apart. The line
 * is written when more than 40% are undated or any date failed to parse; a
 * DATE item opens only for unparseable dates (owner, 2026-10-04) — most boards
 * publish no date at all (147 of 179 sites), and a missing date is nothing an
 * operator can fix, while a date that did not parse is a mapping or parser defect.
 */
export function undatedRate(saved: SavedJobForChecks[]): CheckResult | null {
  if (saved.length === 0) return null;
  const undated = saved.filter((j) => !j.ageBucket);
  const unparseable = undated.filter((j) => trimmed(j.publishDate));
  if (undated.length / saved.length <= UNDATED_WARN_RATIO && unparseable.length === 0) return null;
  const missing = undated.length - unparseable.length;
  const detail =
    `${undated.length}/${saved.length} job(s) have no usable date (${pct(undated.length, saved.length)}%) — ` +
    `${missing} missing, ${unparseable.length} unparseable`;
  return {
    warning: `undated_rate: ${detail}`,
    ...(unparseable.length > 0
      ? { finding: finding("undated_rate", "DATE", detail, unparseable.length, unparseable.map(jobKeyOf)) }
      : {}),
  };
}

/** Fewer than 60% of the saved jobs have a description (the activation gate's threshold). */
export function descriptionFillLow(saved: SavedJobForChecks[]): CheckResult | null {
  if (saved.length === 0) return null;
  const without = saved.filter((j) => !trimmed(j.description));
  const filled = saved.length - without.length;
  if (filled / saved.length >= FIELD_FILL_THRESHOLD) return null;
  const detail =
    `${filled}/${saved.length} job(s) have a description (${pct(filled, saved.length)}%) — ` +
    `below ${Math.round(FIELD_FILL_THRESHOLD * 100)}%`;
  return {
    warning: `description_fill_low: ${detail}`,
    finding: finding("description_fill_low", "DESCRIPTION", detail, without.length, without.map(jobKeyOf)),
  };
}

// ---------------------------------------------------------------------------
// LOCATION, COVERAGE
// ---------------------------------------------------------------------------

/** The site stopped yielding locations at all. Logic unchanged from scrape.ts. */
export function unknownLocationRate(saved: SavedJobForChecks[]): CheckResult | null {
  if (saved.length === 0) return null;
  const unknown = saved.filter((j) => !j.location || j.location.trim() === "" || j.location === "Unknown");
  if (unknown.length / saved.length <= UNKNOWN_LOCATION_WARN_RATIO) return null;
  const detail = `${unknown.length}/${saved.length} job(s) have no location (${pct(unknown.length, saved.length)}%)`;
  return {
    warning: `unknown_location_rate: ${detail}`,
    finding: finding("unknown_location_rate", "LOCATION", detail, unknown.length, unknown.map(jobKeyOf)),
  };
}

/**
 * A stored value that is a common word as well as a place (worker/lib/cityHomographs.ts).
 * Flags only; it never rewrites — the job can genuinely be in Azor.
 */
export function locationHomograph(saved: SavedJobForChecks[]): CheckResult | null {
  const byValue = new Map<string, number>();
  const keys: string[] = [];
  for (const j of saved) {
    const values = new Set([trimmed(j.location), ...(j.locations ?? []).map((v) => trimmed(v))].filter(Boolean));
    let hit = false;
    for (const v of values) {
      if (!NON_PLACE_LOCATIONS.has(v)) continue;
      byValue.set(v, (byValue.get(v) ?? 0) + 1);
      hit = true;
    }
    if (hit) keys.push(jobKeyOf(j));
  }
  if (keys.length === 0) return null;
  const values = [...byValue.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `"${v}"×${n}`)
    .join(", ");
  const detail = `${values} — a word that is also a place name; check each job's ad`;
  return { warning: `location_homograph: ${detail}`, finding: finding("location_homograph", "LOCATION", detail, keys.length, keys) };
}

/**
 * A coarse region stored while the ad names a city (tigbur 232880). Logic
 * unchanged from scrape.ts; a region on its own is never flagged.
 */
export function regionOverCity(saved: SavedJobForChecks[]): CheckResult | null {
  const keys: string[] = [];
  let example = "";
  for (const j of saved) {
    const loc = trimmed(j.location);
    if (!loc || NON_PLACE_LOCATIONS.has(loc) || !COARSE_LOCATIONS.has(loc)) continue;
    const text = [j.title, j.description, j.requirements].filter(Boolean).join("\n");
    // The first place the ad names at one of its own anchors, if any.
    const city = (text ? extractLocationFromGazetteer(text) : [])[0] ?? null;
    if (city && city !== loc && !COARSE_LOCATIONS.has(city)) {
      keys.push(jobKeyOf(j));
      if (!example) example = `${loc} -> ${city}`;
    }
  }
  if (keys.length === 0) return null;
  const detail = `${keys.length} job(s) stored a region while the ad names a city (e.g. ${example})`;
  return { warning: `region_over_city: ${detail}`, finding: finding("region_over_city", "LOCATION", detail, keys.length, keys) };
}

/**
 * TIER 1 — cards shown on the listing vs rows actually written. Never an error
 * on its own (true duplicates, dead detail pages, rejects, the maxJobs cap),
 * but the only in-run signal for a dedup collapse. Logic unchanged.
 */
/**
 * Cards on the listing that did not become saved jobs. A card whose detail
 * page was dead or declared itself unavailable in the same run is accounted
 * for (owner, 2026-10-08: civi's two not-yet-opened promo pages), so the dead
 * detail pages are subtracted before the gap is judged, and named.
 */
export function listingVsSavedGap(
  listingItemsSeen: number | null,
  savedCount: number,
  deadDetailPages = 0,
): CheckResult | null {
  if (listingItemsSeen == null || listingItemsSeen <= savedCount || savedCount <= 0) return null;
  const dead = Math.max(0, deadDetailPages);
  const lost = listingItemsSeen - savedCount - dead;
  if (lost <= 0) return null;
  const detail =
    `${listingItemsSeen} card(s) on the listing but ${savedCount} job(s) saved ` +
    `(${dead > 0 ? `${dead} unavailable, ` : ""}${lost} unaccounted) — ` +
    "check for duplicate ids, cards with no detail URL, or rejected records";
  return { warning: `listing_vs_saved_gap: ${detail}`, finding: finding("listing_vs_saved_gap", "COVERAGE", detail, lost, []) };
}

// ---------------------------------------------------------------------------
// The one entry point, and the queue
// ---------------------------------------------------------------------------

export function runValueChecks(input: ValueCheckInput): { warnings: string[]; findings: ValueCheckFinding[] } {
  const results: Array<CheckResult | null> = [
    unknownLocationRate(input.saved),
    locationHomograph(input.saved),
    regionOverCity(input.saved),
    undatedRate(input.saved),
    descriptionFillLow(input.saved),
    applyNoIdentityField(input.formBlobs),
    applyTemplateActionUrl(input.formBlobs),
    applyHoneypotField(input.formBlobs),
    externalJobIdChurn(input.saved, input.previous),
    listingVsSavedGap(input.listingItemsSeen, input.savedCount, input.deadDetailPages ?? 0),
    synthesisedIdCollision(input.idSeeds),
    synthesisedExternalJobId(input.idSeeds),
  ];
  const warnings: string[] = [];
  const findings: ValueCheckFinding[] = [];
  for (const r of results) {
    if (!r) continue;
    warnings.push(r.warning);
    if (r.finding) findings.push(r.finding);
  }
  // A warning only, no queue item (owner, 2026-10-04).
  const replay = applyReplayTokenFinding(input.formBlobs.map((b) => b.formData));
  if (replay) warnings.push(applyReplayTokenWarning(replay));
  return { warnings, findings };
}

/**
 * The fix-queue plan for one site's run. Only the open CHECK items this module
 * queues take part: an auto: item (step 1c), any other check's item and every
 * MANUAL item are left exactly as they are.
 */
export function planValueCheckItems(findings: ValueCheckFinding[], openItems: OpenFixItem[]): FixQueuePlan {
  const ours = openItems.filter((i) => i.source === "CHECK" && VALUE_CHECK_QUEUE_CODES.has(i.code));
  return planFixItems(findings, ours);
}
