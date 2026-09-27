// Which detail pages a scheduled scrape visits tonight, and what it carries.
//
// A scheduled scrape reads every listing card every night, but most detail
// pages say tonight what they said yesterday. Visiting them anyway is most of
// a night's requests — on ashtrom 51 of ~55 page loads — and it is repeated
// automated load that gets the host throttled (2026-09-24: a stalled walk that
// deleted 21 live listings).
//
// So a job's detail page is visited only when the job is NEW: its identity is
// not stored, or it is stored and its card fingerprint (title, location,
// department, link) has changed. An unchanged known job carries its stored
// detail fields forward. Once a week, the Saturday 02:00 Asia/Jerusalem run,
// every detail page is fetched again; that is the staleness bound. A manual
// scrape always fetches everything.
//
// A carry is a claim that stored text still describes a live job. Every rule
// below is a reason not to make that claim; there is exactly one way to earn it.

import { createHash } from "node:crypto";

export type DetailMode = "full" | "incremental";

/** Card values, raw, as the listing walk read them. */
export type CardValues = {
  title?: string | null;
  location?: string | null;
  department?: string | null;
  /** The detail URL the walk would navigate to. */
  link?: string | null;
};

/**
 * Detail text older than this is fetched whatever else holds. The weekly pass
 * refreshes everything on Saturday; this is what keeps the bound when a
 * Saturday is missed, refused, or cut short by the runtime cap.
 */
export const DETAIL_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

/** A stamp this far in the future is a clock problem, not a fresh fetch. */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

// Keys written into Job.rawData. rawData is what the next night reads back.
export const CARD_FINGERPRINT_KEY = "_cardFingerprint";
export const DETAIL_FETCHED_AT_KEY = "_detailFetchedAt";
export const CONFIG_SAVED_AT_KEY = "_configSavedAt";
export const DETAIL_CARRIED_KEY = "_detailCarried";
/** On a card seed between the listing walk and the detail phase. Never stored. */
export const PENDING_DETAIL_KEY = "_pendingDetail";

const DETAIL_URL_KEY = "_detailUrl";
const NAV_STATUS_KEY = "_detailNavStatus";

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

function squash(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * sha1 of the four RAW card values. Raw, not normalised: a gazetteer or
 * normaliser change is a change in our code, not in the job, and must not make
 * every card on every site look new. Whitespace is collapsed because some
 * listings re-render with different indentation night to night.
 */
export function cardFingerprint(card: CardValues): string {
  // JSON array: the delimiters are part of the hash, so "a"+"" and ""+"a" differ.
  const payload = JSON.stringify([
    squash(card.title),
    squash(card.location),
    squash(card.department),
    squash(card.link),
  ]);
  return createHash("sha1").update(payload, "utf8").digest("hex");
}

/** A seed's fingerprint: its card-scope values, with the detail URL as the link. */
export function seedFingerprint(seed: Record<string, string>): string {
  return cardFingerprint({
    title: seed.title,
    location: seed.location,
    department: seed.department,
    link: seed[DETAIL_URL_KEY],
  });
}

// ---------------------------------------------------------------------------
// The stored rows
// ---------------------------------------------------------------------------

/** A stored row's rawData, string values only. */
export type StoredRaw = Record<string, string>;
export type StoredIndex = Map<string, StoredRaw>;

function idKey(id: string): string {
  return `id:${squash(id)}`;
}
function urlKey(url: string): string {
  return `url:${squash(url)}`;
}

function stringsOnly(raw: unknown): StoredRaw | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: StoredRaw = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Stored rows keyed by their raw card id and by the detail URL they were
 * fetched from. A key two rows share identifies neither, so it is dropped —
 * the same rule readPreviousLocations applies to the location carry-forward.
 */
export function indexStoredRows(rows: Array<{ rawData: unknown }>): StoredIndex {
  const out: StoredIndex = new Map();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const raw = stringsOnly(row.rawData);
    if (!raw) continue;
    const keys: string[] = [];
    if (squash(raw.externalJobId)) keys.push(idKey(raw.externalJobId!));
    if (squash(raw[DETAIL_URL_KEY])) keys.push(urlKey(raw[DETAIL_URL_KEY]!));
    for (const key of keys) {
      if (out.has(key)) ambiguous.add(key);
      out.set(key, raw);
    }
  }
  for (const key of ambiguous) out.delete(key);
  return out;
}

/**
 * The row a card is, if any: by the card's own id when the card carries one,
 * else by the detail URL — which is always known before the visit, and is the
 * only identity on sites whose id lives on the detail page.
 */
function lookup(seed: Record<string, string>, index: StoredIndex): StoredRaw | undefined {
  if (squash(seed.externalJobId)) return index.get(idKey(seed.externalJobId!));
  if (squash(seed[DETAIL_URL_KEY])) return index.get(urlKey(seed[DETAIL_URL_KEY]!));
  return undefined;
}

// ---------------------------------------------------------------------------
// Eligibility and the plan
// ---------------------------------------------------------------------------

/**
 * Whether a site takes part at all.
 *
 * - The card must carry the title. railcareer-adamtotal and anvei-zion show
 *   only the link, so a retitle or relocation would be invisible until
 *   Saturday; they fetch everything every night until they are rebuilt.
 * - There must be a detail-scope field. With none, scrape.ts re-runs EVERY
 *   mapping on the detail page (the legacy fall-through) and overwrites the
 *   card values, so a carried row would not match a fetched one.
 */
export function isCarryEligible(scope: { listingFields: string[]; detailFields: string[] }): boolean {
  return scope.listingFields.includes("title") && scope.detailFields.length > 0;
}

export type FetchReason =
  | "mode_full"
  | "ineligible"
  | "new"
  | "no_fingerprint"
  | "fingerprint_changed"
  | "last_visit_failed"
  | "config_changed"
  | "stale";

export type DetailDecision =
  | { action: "fetch"; seed: Record<string, string>; reason: FetchReason }
  | { action: "carry"; seed: Record<string, string>; stored: StoredRaw };

export function planDetailFetch(args: {
  seeds: Array<Record<string, string>>;
  index: StoredIndex;
  mode: DetailMode;
  eligible: boolean;
  /** `_meta.savedAt` of the config this run uses. */
  configSavedAt: string | null;
  now: Date;
}): { decisions: DetailDecision[]; fetched: number; carried: number } {
  const decide = (seed: Record<string, string>): DetailDecision => {
    const fetch = (reason: FetchReason): DetailDecision => ({ action: "fetch", seed, reason });
    if (args.mode !== "incremental") return fetch("mode_full");
    if (!args.eligible) return fetch("ineligible");

    const row = lookup(seed, args.index);
    if (!row) return fetch("new");

    const storedFp = squash(row[CARD_FINGERPRINT_KEY]);
    if (!storedFp) return fetch("no_fingerprint");
    if (storedFp !== seedFingerprint(seed)) return fetch("fingerprint_changed");
    if (row[NAV_STATUS_KEY] !== "ok") return fetch("last_visit_failed");
    if (!args.configSavedAt || row[CONFIG_SAVED_AT_KEY] !== args.configSavedAt) {
      return fetch("config_changed");
    }
    const fetchedAt = Date.parse(row[DETAIL_FETCHED_AT_KEY] ?? "");
    const age = args.now.getTime() - fetchedAt;
    if (!Number.isFinite(fetchedAt) || age >= DETAIL_MAX_AGE_MS || age < -FUTURE_TOLERANCE_MS) {
      return fetch("stale");
    }
    return { action: "carry", seed, stored: row };
  };

  const decisions = args.seeds.map(decide);
  const carried = decisions.filter((d) => d.action === "carry").length;
  return { decisions, fetched: decisions.length - carried, carried };
}

// ---------------------------------------------------------------------------
// Building the rows
// ---------------------------------------------------------------------------

/**
 * A carried row: the stored row, with tonight's card laid over it. Card-scope
 * fields (and the link and listing page) are tonight's; everything the detail
 * page produced — description, requirements, publishDate, and on detail-only
 * sites location, id, apply info, `_formData` — is the stored value, with the
 * stamps that say when and under which config it was really fetched.
 */
export function buildCarriedRawFields(
  seed: Record<string, string>,
  stored: StoredRaw,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) if (typeof v === "string") out[k] = v;
  for (const [k, v] of Object.entries(seed)) out[k] = v;
  delete out[PENDING_DETAIL_KEY];
  out[DETAIL_CARRIED_KEY] = "1";
  return out;
}

/**
 * A freshly fetched row, stamped so a later night can carry it. The
 * fingerprint is the CARD's — the merged row's title may be a detail-page
 * value — and a failed visit is not stamped at all, so it can never be carried.
 */
export function stampFetched(
  raw: Record<string, string>,
  seed: Record<string, string>,
  configSavedAt: string | null,
  now: Date,
): Record<string, string> {
  const out = { ...raw };
  delete out[PENDING_DETAIL_KEY];
  delete out[DETAIL_CARRIED_KEY];
  if (out[NAV_STATUS_KEY] !== "ok") return out;
  out[CARD_FINGERPRINT_KEY] = seedFingerprint(seed);
  out[DETAIL_FETCHED_AT_KEY] = now.toISOString();
  if (configSavedAt) out[CONFIG_SAVED_AT_KEY] = configSavedAt;
  return out;
}

// ---------------------------------------------------------------------------
// The weekly full pass
// ---------------------------------------------------------------------------

const JERUSALEM_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jerusalem",
  weekday: "short",
});

/**
 * "full" for the sweep that starts on a Saturday in Asia/Jerusalem — the
 * 02:00 run of the night from Friday to Saturday — else "incremental".
 *
 * Never the host clock: the box is Etc/UTC, where 02:00 Jerusalem in summer is
 * still 23:00 on FRIDAY.
 */
export function detailModeFor(startedAt: Date): DetailMode {
  return JERUSALEM_WEEKDAY.format(startedAt) === "Sat" ? "full" : "incremental";
}
