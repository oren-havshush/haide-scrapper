// Run: npx tsx scripts/cityCsv.test.ts   (part of `pnpm test:locations`, so CI runs it)
//
// The shape of CSV files/city.csv (city-file design item 2, commit C). The file
// is city,region,kind; this keeps it that way:
//   - the header and three cells on every line;
//   - kind is one of the seven; "region" exactly for the 9 region rows (no
//     region of their own), "nationwide" only for פריסה ארצית (no region);
//   - every other row's region is one of the 9 region rows, verbatim;
//   - no name twice, and no place spelled twice: two names equal once quote
//     marks and hyphens are dropped, or one vav, yod or definite he apart (the
//     normaliser's own allowedTypo), fail unless the pair is on the list below
//     with its reason. A new pair fails CI until a person adds it here.
//   - the build (worker/data/il-places.ts) agrees with the file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvLine, parseCityCsvTable, PLACE_KINDS } from "../worker/lib/cityCsvParse";
import { allowedTypo } from "../worker/lib/locationNormalize";
import * as places from "../worker/data/il-places";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

/** Two different places whose names are one letter or one mark apart. */
const DISTINCT: ReadonlyArray<readonly [string, string, string]> = [
  ["אודים", "אודם", "אזור השרון (חוף השרון) and אזור רמת הגולן (גולן): two places"],
  ["אילון", "אלון", "אזור צפון (מטה אשר) and אזור ירושלים (מטה בנימין): two places"],
  ["אילנה", "אילניה", "both אזור צפון; אילניה is in הגליל התחתון, אילנה has no population-authority row: unclear, owner to check"],
  ["אילת", "אילות", "both אזור אילת: the city, and the place in חבל אילות"],
  ["אלעד", "אליעד", "אזור מרכז (פתח תקווה sub-district) and אזור רמת הגולן: two places"],
  ["אשבול", "אשבל", "אזור דרום (מרחבים) and אזור צפון (משגב): two places"],
  ["נוב", "ינוב", "אזור צפון (גולן sub-district) and אזור השרון (לב השרון): two places"],
  ["שומרה", "שומריה", "אזור צפון (מעלה יוסף) and אזור דרום (בני שמעון): two places"],
  ["שפר", "שפיר", "אזור צפון (מרום הגליל) and אזור שפלה (שפיר): two places"],
  ["קידר", "קדר", "אזור דרום and אזור יהודה ושומרון (גוש עציון); the public site lists both"],
  ["תומר", "תמר", "אזור יהודה ושומרון (ערבות הירדן) and אזור דרום: two places"],
  ["ישע", "ישעי", "אזור דרום (אשכול) and אזור ירושלים (מטה יהודה): two places"],
  ["ג'ת", "גת", "אזור השרון (חדרה sub-district) and אזור שפלה; the public site lists both as two places"],
  ["חורשים", "חרשים", "אזור השרון (דרום השרון) and אזור צפון (משגב): two places"],
  ["מצר", "מיצר", "אזור השרון (מנשה) and אזור רמת הגולן (גולן): two places"],
  ["משמרות", "משמרת", "both אזור השרון, in מנשה and in לב השרון: two places"],
  ["אפק", "אפיק", "אזור צפון (מטה אשר) and אזור רמת הגולן (גולן): two places"],
  ["גשר", "גשור", "אזור צפון (עמק המעיינות) and אזור רמת הגולן (גולן): two places"],
  ["עמוקה", "עמקה", "both אזור צפון, in מרום הגליל and in מטה אשר: two places"],
];

/**
 * One place listed twice, in both files, while the public site chooses the
 * spelling. Empty since H (2026-10-13): their v3 export merged the four pairs
 * (אלון שבות, ניצני עוז, רינתיה, חספין stay) and the seed removed the others.
 */
const DUPLICATE_PENDING: ReadonlyArray<readonly [string, string, string]> = [];

const root = join(__dirname, "..");
const raw = readFileSync(join(root, "CSV files", "city.csv"), "utf8");
const lines = raw.replace(new RegExp("^" + String.fromCharCode(0xfeff)), "").split(/\r?\n/).filter((l) => l.trim() !== "");

check("the header, and three cells on every line", () => {
  assert(lines[0] === "city,region,kind", `the header is exactly city,region,kind (got ${JSON.stringify(lines[0])})`);
  const bad = lines.slice(1).filter((l) => parseCsvLine(l).length !== 3);
  assert(bad.length === 0, `every line has exactly 3 cells (${bad.length} do not, e.g. ${JSON.stringify(bad.slice(0, 3))})`);
});

const rows = (() => {
  try {
    return parseCityCsvTable(raw).rows;
  } catch {
    return [];
  }
})();
const regionRows = rows.filter((r) => r.kind === "region").map((r) => r.city);

check("kind and region", () => {
  assert(rows.length > 0, "the file parses");
  const badKind = rows.filter((r) => !(PLACE_KINDS as readonly string[]).includes(r.kind));
  assert(badKind.length === 0, `kind is one of ${PLACE_KINDS.join(", ")} (${badKind.length} are not, e.g. ${JSON.stringify(badKind.slice(0, 3))})`);
  assert(regionRows.length === 9, `nine region rows (got ${regionRows.length})`);
  assert(regionRows.every((c) => /^אזור /.test(c)), "each region row is named אזור ...");
  assert(rows.filter((r) => r.kind === "region").every((r) => r.region === ""), "a region row has no region");
  const nationwide = rows.filter((r) => r.kind === "nationwide");
  assert(nationwide.length === 1 && nationwide[0].city === "פריסה ארצית" && nationwide[0].region === "", "nationwide is פריסה ארצית alone, with no region");
  const others = rows.filter((r) => r.kind !== "region" && r.kind !== "nationwide");
  const noRegion = others.filter((r) => !regionRows.includes(r.region));
  assert(noRegion.length === 0, `every other row's region is one of the 9, verbatim (${noRegion.length} are not, e.g. ${JSON.stringify(noRegion.slice(0, 3))})`);
});

check("no name twice, no place spelled twice", () => {
  const names = rows.map((r) => r.city);
  assert(new Set(names).size === names.length, "no name twice");
  const marks = new RegExp("[\"'" + String.fromCharCode(0x5f3, 0x5f4, 0x201d, 0x201c, 0x2019) + "]", "g");
  const key = (s: string) => s.replace(marks, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const listed = new Map<string, string>();
  for (const [a, b, why] of [...DISTINCT, ...DUPLICATE_PENDING]) {
    listed.set(`${a}\t${b}`, why);
    listed.set(`${b}\t${a}`, why);
  }
  const found: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = key(names[i]);
      const b = key(names[j]);
      if (a !== b && !allowedTypo(a, b)) continue;
      found.push(`${names[i]}\t${names[j]}`);
      assert(listed.has(`${names[i]}\t${names[j]}`), `${names[i]} / ${names[j]} look like one place spelled twice; fix the file, or add the pair here with its reason`);
    }
  }
  for (const [a, b] of [...DISTINCT, ...DUPLICATE_PENDING]) {
    assert(found.includes(`${a}\t${b}`) || found.includes(`${b}\t${a}`), `the listed pair ${a} / ${b} is in the file (remove it from the list when a row goes)`);
  }
  assert(DISTINCT.length === 19 && DUPLICATE_PENDING.length === 0, "19 distinct pairs and none pending on the list");
});

check("the build agrees with the file", () => {
  const p = places as Record<string, unknown>;
  const kind = (p.IL_PLACE_KIND ?? {}) as Record<string, string>;
  const region = (p.IL_PLACE_REGION ?? {}) as Record<string, string>;
  assert(rows.every((r) => kind[r.city] === r.kind), "IL_PLACE_KIND is the kind column (rebuild: npx tsx scripts/build-il-places.ts)");
  assert(rows.every((r) => (r.region ? region[r.city] === r.region : !(r.city in region))), "IL_PLACE_REGION is the region column (rebuild)");
  assert(places.IL_CANONICAL.length === rows.length, `IL_CANONICAL has one entry per row (${places.IL_CANONICAL.length} vs ${rows.length})`);
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("cityCsv: all assertions passed");
