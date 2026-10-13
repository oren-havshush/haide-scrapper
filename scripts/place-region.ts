/**
 * scripts/place-region.ts — propose a region (and a kind) for a place that is
 * not yet a row of city.csv, with the evidence; a person decides (city-file
 * design item 4, commit E). It reads and prints. It never writes.
 *
 *   npx tsx scripts/place-region.ts "<name>" ["<name>" ...]
 *
 * The evidence, in this order (the design's measurement: the public site's
 * regions follow the regional council 92.2% of the time, the sub-district
 * only 81.2%):
 *   1. the settlement's regional council, in the population authority's list
 *      (CSV files/settlements-population-authority.csv): the region most of
 *      that council's places carry in city.csv, with the share. A council with
 *      no majority shows its counts and asks;
 *   2. else its sub-district, by SUB_DISTRICT_REGION below. The six split
 *      sub-districts never answer alone: they show their counts and ask;
 *   3. else "not a listed settlement: propose from knowledge" — an industrial
 *      zone, a base, a neighbourhood. A person proposes, with the nearest
 *      places and their regions.
 * kind is proposed from the statistics bureau's settlement type
 * (CSV files/settlements-cbs-2023.csv), as the seed read it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCityCsvTable, parseCsvLine } from "../worker/lib/cityCsvParse";
import { allowedTypo } from "../worker/lib/locationNormalize";
import { matchCbs, readCbs } from "./seed-city-regions";

/**
 * The sub-district table (city-file design, item 4): the region most of each
 * sub-district's places carry in the public site's file, or "split" where it
 * divides between two (Safed, Hadera, Petah Tikva, Ramla, Ashkelon, and the
 * Eilat part of Be'er Sheva, which the council rule settles: חבל אילות is
 * אזור אילת). Names as the population authority writes them.
 */
export const SUB_DISTRICT_REGION: Readonly<Record<string, string | "split">> = {
  ירושלים: "אזור ירושלים",
  צפת: "split",
  כנרת: "אזור צפון",
  עפולה: "אזור צפון",
  עכו: "אזור צפון",
  נצרת: "אזור צפון",
  גולן: "אזור רמת הגולן",
  חיפה: "אזור צפון",
  חדרה: "split",
  השרון: "אזור השרון",
  "פתח תקווה": "split",
  רמלה: "split",
  רחובות: "אזור שפלה",
  "תל אביב": "אזור מרכז",
  "רמת גן": "אזור מרכז",
  חולון: "אזור מרכז",
  אשקלון: "split",
  "באר שבע": "split",
  "ג'נין": "אזור יהודה ושומרון",
  שכם: "אזור יהודה ושומרון",
  "טול כרם": "אזור יהודה ושומרון",
  ראמאללה: "אזור יהודה ושומרון",
  "בית לחם": "אזור יהודה ושומרון",
  חברון: "אזור יהודה ושומרון",
  "ירדן )יריחו(": "אזור יהודה ושומרון",
};

export type AuthorityRow = { code: string; name: string; sub_district: string; council: string };
export type Proposal = {
  name: string;
  /** The region proposed, or null when the evidence asks a person. */
  region: string | null;
  kind: string | null;
  /** Each line of evidence, in order. */
  evidence: string[];
};

export function readAuthority(raw: string): AuthorityRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const head = parseCsvLine(lines.shift() ?? "");
  return lines.map((l) => {
    const c = parseCsvLine(l);
    const r: Record<string, string> = {};
    head.forEach((h, i) => (r[h] = (c[i] ?? "").trim()));
    return { code: r.code, name: r.name, sub_district: r.sub_district, council: r.council };
  });
}

const GERSHAYIM = new RegExp(String.fromCharCode(0x5f4), "g");
const GERESH = new RegExp(String.fromCharCode(0x5f3), "g");
const squash = (s: string) =>
  s.replace(GERSHAYIM, '"').replace(GERESH, "'").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();

/** A name's authority row: exact, by punctuation, or one vav or yod apart (unique). */
function findAuthority(name: string, rows: AuthorityRow[]): AuthorityRow[] {
  const exact = rows.filter((r) => r.name === name);
  if (exact.length) return exact;
  const punct = rows.filter((r) => squash(r.name) === squash(name));
  if (punct.length) return punct;
  return rows.filter((r) => allowedTypo(squash(name), squash(r.name)));
}

/** Counts of city.csv regions among the given place names, largest first. */
function regionCounts(names: string[], regionOf: Map<string, string>): Array<[string, number]> {
  const c = new Map<string, number>();
  for (const n of names) {
    const r = regionOf.get(n);
    if (r) c.set(r, (c.get(r) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;
const countsText = (counts: Array<[string, number]>) => counts.map(([r, n]) => `${r} ${n}`).join(", ");

export function proposeRegion(
  name: string,
  data: { cityCsv: string; authority: AuthorityRow[]; cbsCsv: string },
): Proposal {
  const rows = parseCityCsvTable(data.cityCsv).rows;
  const regionOf = new Map(rows.filter((r) => r.region).map((r) => [r.city, r.region]));
  const ours = new Set(rows.map((r) => r.city));
  const evidence: string[] = [];
  const existing = rows.find((r) => r.city === name);
  if (existing) evidence.push(`already a row of city.csv: region ${existing.region || "(none)"}, kind ${existing.kind}`);

  const cbsMatch = matchCbs(name, readCbs(data.cbsCsv), ours);
  const types = [...new Set(cbsMatch.rows.map((r) => r.type))];
  const kindOf = (t: string) => (["310", "320", "191", "192"].includes(t) ? "moshav" : ["330", "193"].includes(t) ? "kibbutz" : "town");
  const kinds = [...new Set(types.map(kindOf))];
  const kind = kinds.length === 1 ? kinds[0] : null;
  if (cbsMatch.rows.length === 0) evidence.push("kind: the bureau's list does not have it; a person gives the kind (town, kibbutz, moshav, zone, base)");
  else evidence.push(`kind: ${kind ?? "ask"} (the bureau lists ${cbsMatch.rows.map((r) => `${r.name}, type ${r.type}`).join("; ")})`);

  const auth = findAuthority(name, data.authority);
  if (auth.length === 0) {
    evidence.push("not a listed settlement: propose from knowledge (the nearest places and their regions in city.csv)");
    return { name, region: null, kind, evidence };
  }
  if (auth.length > 1) {
    evidence.push(`the population authority lists ${auth.length} rows for it: ${auth.map((a) => `${a.name} (${a.sub_district}, ${a.council || "no council"})`).join("; ")}; a person chooses`);
    return { name, region: null, kind, evidence };
  }
  const a = auth[0];
  evidence.push(`population authority: ${a.name}, sub-district ${a.sub_district}, council ${a.council || "(none: a municipality)"}`);

  // 1. The council, by what its other places carry in city.csv.
  if (a.council) {
    const members = data.authority.filter((r) => r.council === a.council && r.name !== a.name).map((r) => r.name);
    const counts = regionCounts(members, regionOf);
    const total = counts.reduce((s, [, n]) => s + n, 0);
    if (total > 0) {
      const [top, n] = counts[0];
      if (n * 2 > total) {
        evidence.push(`council ${a.council}: ${n} of ${total} places ${top} (${pct(n, total)})${counts.length > 1 ? `; ${countsText(counts.slice(1))}` : ""}`);
        return { name, region: top, kind, evidence };
      }
      evidence.push(`council ${a.council} is split: ${countsText(counts)}; a person decides`);
      return { name, region: null, kind, evidence };
    }
    evidence.push(`council ${a.council}: none of its places is a row of city.csv yet`);
  }

  // 2. The sub-district, unless it is one of the split ones.
  const sub = SUB_DISTRICT_REGION[a.sub_district];
  const members = data.authority.filter((r) => r.sub_district === a.sub_district && r.name !== a.name).map((r) => r.name);
  const counts = regionCounts(members, regionOf);
  const total = counts.reduce((s, [, n]) => s + n, 0);
  if (sub === undefined) {
    evidence.push(`sub-district ${a.sub_district} is not in the table: ${countsText(counts) || "no places in city.csv"}; a person decides`);
    return { name, region: null, kind, evidence };
  }
  if (sub === "split") {
    evidence.push(`sub-district ${a.sub_district} is split between regions: ${countsText(counts)}; a person decides`);
    return { name, region: null, kind, evidence };
  }
  const n = counts.find(([r]) => r === sub)?.[1] ?? 0;
  evidence.push(`sub-district ${a.sub_district}: ${sub}${total ? ` (${n} of ${total} places, ${pct(n, total)})` : ""}`);
  return { name, region: sub, kind, evidence };
}

function main(): void {
  const names = process.argv.slice(2).filter((a) => a.trim() !== "");
  if (names.length === 0) throw new Error('usage: place-region.ts "<name>" ["<name>" ...]');
  const data = {
    cityCsv: readFileSync(path.resolve("CSV files", "city.csv"), "utf8"),
    authority: readAuthority(readFileSync(path.resolve("CSV files", "settlements-population-authority.csv"), "utf8")),
    cbsCsv: readFileSync(path.resolve("CSV files", "settlements-cbs-2023.csv"), "utf8"),
  };
  for (const name of names) {
    const p = proposeRegion(name.trim(), data);
    console.log(`${p.name}: region ${p.region ?? "ASK"}, kind ${p.kind ?? "ASK"}`);
    for (const e of p.evidence) console.log(`  - ${e}`);
  }
  console.log("A proposal only: nothing was written. A person confirms the region and kind before the row is added.");
}

if (process.argv[1] && /place-region\.ts$/.test(process.argv[1])) main();
