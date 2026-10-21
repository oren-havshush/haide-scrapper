// Run: npx tsx worker/lib/cardSeeds.test.ts
//
// Report fixes 3, item 8 (the developer's 2026-10-19 to 20 report, item 5):
// on meptagon.com two cards with different titles link to one vendor vacancy,
// and the multi-step flow keyed every stage by the detail address, so the two
// became one job. Now two seeds with the same _detailUrl and different titles
// produce two jobs; the address is still visited once; a card listed twice is
// still one card. The chain below is the worker's, stage by stage, with the
// browser visit replaced by the record it would return.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_KEY, normalizedDedupKey, rawDedupFingerprint, recordsForSeeds, seedsFromCards } from "./cardSeeds";
import { normalizeJobRecord } from "./normalizer";
import { applyJobIdFallback } from "./synthesizeJobId";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const PENDING = "_pendingDetail";
const VACANCY = "https://meptagon.niloos.test/vacancy/4471";
const cards = [
  { url: VACANCY, fields: { title: "מהנדס/ת חשמל", location: "אזור מרכז", _listingUrl: "https://meptagon.test/careers" } },
  { url: VACANCY, fields: { title: "מהנדס/ת חשמל בכיר/ה", location: "אזור מרכז", _listingUrl: "https://meptagon.test/careers" } },
  // The first card listed again (a second listing page): one card.
  { url: VACANCY, fields: { title: "מהנדס/ת חשמל", location: "אזור מרכז", _listingUrl: "https://meptagon.test/careers" } },
  { url: "https://meptagon.niloos.test/vacancy/4472", fields: { title: "טכנאי/ת", location: "חיפה", _listingUrl: "https://meptagon.test/careers" } },
];

/** What visitDetailPages returns for one address: the first seed's card under the page's fields. */
function visit(seed: Record<string, string>): Record<string, string> {
  const rec: Record<string, string> = { ...seed, description: `דרישות התפקיד ל-${seed._detailUrl!.slice(-4)}`, _detailNavStatus: "ok" };
  delete rec[PENDING];
  return rec;
}

// --- seeds: one per card identity ---------------------------------------------------------
const seeds = seedsFromCards(cards, PENDING);
assert(seeds.length === 3, `three cards: two sharing the vacancy, one more (got ${seeds.length})`);

// --- the visit: each address once ------------------------------------------------------------
const addresses = [...new Set(seeds.map((s) => s._detailUrl!))];
assert(addresses.length === 2, "two addresses visited, not three");
const visited = addresses.map((u) => visit(seeds.find((s) => s._detailUrl === u)!));

// --- the join, by card ------------------------------------------------------------------------
const records = recordsForSeeds(seeds, visited);
assert(records.length === 3 && records.every((r) => r !== null), "one record per seed");
assert(records[1]?.title === "מהנדס/ת חשמל בכיר/ה", `the second card keeps its own title (got ${records[1]?.title})`);
assert(records[1]?.description === records[0]?.description, "and shares the page's description");
assert(records[0]?.[CARD_KEY] !== records[1]?.[CARD_KEY], "each record carries its own card identity");

// --- the raw dedup, then the normalised one, then the ids ---------------------------------------
const rawSeen = new Set<string>();
const raw = records.filter((r): r is Record<string, string> => {
  if (!r) return false;
  const fp = rawDedupFingerprint(r, (r._detailUrl ?? "").toLowerCase());
  if (rawSeen.has(fp)) return false;
  rawSeen.add(fp);
  return true;
});
const normSeen = new Set<string>();
const kept = raw
  .map((r) => normalizeJobRecord(r, { at: new Date("2026-10-21T00:00:00Z") }))
  .filter((n) => {
    const k = normalizedDedupKey(n);
    if (normSeen.has(k)) return false;
    normSeen.add(k);
    return true;
  });
const ids = applyJobIdFallback(kept.map((n) => ({ externalJobId: n.externalJobId, title: n.title, department: n.department, url: n.url }))).ids;
assert(kept.length === 3, `two cards sharing an address are two jobs: 3 jobs written (got ${kept.length})`);
assert(new Set(ids).size === ids.length, `with distinct ids (got ${JSON.stringify(ids)})`);

// --- a dead page drops every card that shares it -------------------------------------------------
{
  const r = recordsForSeeds(seeds, [visited[1]!]);
  assert(r[0] === null && r[1] === null && r[2] !== null, "no record for the vacancy: neither card is written");
}

// --- cards with no title (the title read on the detail page): the address alone, as before -------
{
  const s = seedsFromCards([{ url: VACANCY, fields: {} }, { url: VACANCY, fields: {} }], PENDING);
  assert(s.length === 1, "untitled cards sharing an address are one seed");
  // A card whose fields failed to read, beside a titled card for the same address: one seed, the titled one.
  const t = seedsFromCards([{ url: VACANCY, fields: {} }, { url: VACANCY, fields: { title: "מהנדס/ת" } }], PENDING);
  assert(t.length === 1 && t[0]?.title === "מהנדס/ת", `an unread card does not become a second job (got ${JSON.stringify(t.map((x) => x.title))})`);
}

// --- the wiring ------------------------------------------------------------------------------------
{
  const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  assert(!/visitedByUrl/.test(src), "no record is joined by address any more");
  assert(/seedsFromCards\(cards, PENDING_DETAIL_KEY\)/.test(src), "the flow's seeds come from every card");
  assert(/recordsForSeeds\(seeds, rawFieldsList\)/.test(src), "visitDetailPages returns one record per seed");
  assert(/rawDedupFingerprint\(raw, url\)/.test(src), "the raw dedup reads the card identity");
  assert(/normalizedDedupKey\(r\.normalized\)/.test(src), "and so does the normalised one");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("cardSeeds: two cards sharing a detail address are two jobs; the address is visited once");
