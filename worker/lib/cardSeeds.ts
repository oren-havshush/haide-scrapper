/**
 * Detail records keyed by card, not by address (report fixes 3, item 8; the
 * developer's 2026-10-19 to 20 report, item 5).
 *
 * On meptagon.com two job cards, different titles, link to the same vendor
 * vacancy. Every stage of a multi-step flow keyed its records by the detail
 * address: the listing kept the first card per address, the seeds and the
 * records were de-duplicated by it, the visit's record was joined back by it,
 * and the normalised dedup took the address when the job had no id. The two
 * cards became one job.
 *
 * A card is now its detail address AND its own title. The address is still
 * visited once (the page is fetched once); each card gets its own record, the
 * visit's detail fields under the card's own listing fields. A card listed
 * twice (same address, same title) is still one card.
 */

import { LISTING_URL_TAG } from "./listingTargets";

/** Where a record's card identity is kept, in rawFields (and so in rawData). */
export const CARD_KEY = "_cardKey";

/** The card's identity: its detail address and its title, squashed. */
export function cardKeyOf(url: string, fields: Record<string, string>): string {
  const title = (fields["title"] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return title ? `${url}\n${title}` : url;
}

/**
 * The seeds for a flow's cards, in listing order: one per card identity, the
 * first card's fields kept. With no title on the cards (a flow whose title is
 * read on the detail page) the identity is the address alone, as before.
 */
export function seedsFromCards(
  cards: Array<{ url: string; fields: Record<string, string> }>,
  pendingKey: string,
): Array<Record<string, string>> {
  // A card whose fields could not be read (no title) is not a card of its own
  // where another card for the same address has a title: it is that card.
  const titled = new Set(cards.filter((c) => cardKeyOf(c.url, c.fields) !== c.url).map((c) => c.url));
  const seen = new Set<string>();
  const seeds: Array<Record<string, string>> = [];
  for (const { url, fields } of cards) {
    const key = cardKeyOf(url, fields);
    if (key === url && titled.has(url)) continue;
    if (seen.has(key)) continue;
    // A truncated copy of a card already seen for this address (a carousel or
    // hot-jobs strip that cuts the title), or the full card after its cut
    // copy: one card, the longer title's (report fixes 3, item 8b).
    const cut = truncationBase(fields["title"] ?? "");
    const same = cut ? seeds.findIndex((s) => s._detailUrl === url && prefixRelated(truncationBase(s["title"] ?? ""), cut)) : -1;
    seen.add(key);
    if (same >= 0) {
      if (cut.length > truncationBase(seeds[same]!["title"] ?? "").length) {
        seeds[same] = { ...fields, _detailUrl: url, [CARD_KEY]: key, [pendingKey]: "1" };
      }
      continue;
    }
    seeds.push({ ...fields, _detailUrl: url, [CARD_KEY]: key, [pendingKey]: "1" });
  }
  return seeds;
}

/**
 * A title as a truncation compares it: squashed, lower case, a trailing
 * ellipsis (three dots or the one-character one) and trailing punctuation
 * removed.
 */
function truncationBase(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(?:\.{3}|…)+$/, "")
    .replace(/[\s.,;:!?|\-–—]+$/, "")
    .trim();
}

/** One title is a prefix of the other: the same card, one copy cut. */
function prefixRelated(a: string, b: string): boolean {
  return !!a && !!b && (a.startsWith(b) || b.startsWith(a));
}

/**
 * One record per seed, aligned with `seeds` (null where the visit produced
 * none: a dead page). `visited` holds one record per address visited, built on
 * the first seed for that address. A later seed for the same address gets a
 * copy in which every value the detail page did not set is its own card's.
 */
export function recordsForSeeds(
  seeds: Array<Record<string, string>>,
  visited: Array<Record<string, string>>,
): Array<Record<string, string> | null> {
  const byUrl = new Map<string, Record<string, string>>();
  for (const r of visited) if (!byUrl.has(r._detailUrl ?? "")) byUrl.set(r._detailUrl ?? "", r);
  const firstSeed = new Map<string, Record<string, string>>();
  for (const s of seeds) if (!firstSeed.has(s._detailUrl ?? "")) firstSeed.set(s._detailUrl ?? "", s);

  return seeds.map((seed) => {
    const url = seed._detailUrl ?? "";
    const rec = byUrl.get(url);
    if (!rec) return null;
    const first = firstSeed.get(url)!;
    if (first === seed) return rec;
    const out = { ...rec };
    for (const [k, v] of Object.entries(first)) {
      // Seeded from the first card and left as it was by the detail page.
      if (rec[k] === v) out[k] = seed[k] ?? "";
    }
    for (const [k, v] of Object.entries(seed)) if (!(k in first) && !out[k]) out[k] = v;
    // A visit with no card fields (a page that declared itself unavailable)
    // stays without them, for every card that shares it.
    if (!(CARD_KEY in rec)) delete out[CARD_KEY];
    return out;
  });
}

/**
 * The raw-record dedup fingerprint (scrape.ts dedupeAndCapRawFields): the
 * card identity when the record carries one, else the address, the id, or
 * title, location and page, as it always was.
 */
export function rawDedupFingerprint(raw: Record<string, string>, url: string): string {
  const card = raw[CARD_KEY];
  if (card) return card.toLowerCase();
  const title = (raw["title"] ?? "").trim().toLowerCase();
  const location = (raw["location"] ?? "").trim().toLowerCase();
  const externalJobId = (raw["externalJobId"] ?? "").trim().toLowerCase();
  const listingUrl = (raw[LISTING_URL_TAG] ?? "").trim().toLowerCase();
  return url || externalJobId || `${title}|${location}|${listingUrl}`;
}

/**
 * The normalised dedup key (scrape.ts, before persistence): the id, then the
 * card identity, then the address, then title and location.
 */
export function normalizedDedupKey(n: {
  externalJobId: string;
  url: string;
  title: string;
  location: string;
  rawFields: Record<string, string>;
}): string {
  return (
    n.externalJobId ||
    n.rawFields[CARD_KEY] ||
    n.url ||
    `${(n.title || "").toLowerCase()}|${(n.location || "").toLowerCase()}`
  );
}
