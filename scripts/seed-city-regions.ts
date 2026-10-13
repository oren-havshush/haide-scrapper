/**
 * scripts/seed-city-regions.ts — the one-time seed of city.csv's region and
 * kind columns (city-file design item 0, the owner's decisions of 2026-10-13).
 *
 *   npx tsx scripts/seed-city-regions.ts --public <misrotil-job-locations.json>          (plan)
 *   npx tsx scripts/seed-city-regions.ts --public <misrotil-job-locations.json> --write  (writes city.csv)
 *
 * What it does, and nothing else:
 * - region: every town of the public site's job-location file takes the
 *   region that file gives it, verbatim. No placement is chosen or corrected
 *   here, even where it looks wrong; corrections are a later data commit on the
 *   owner's word. The 9 region rows take kind "region" and no region.
 * - The rows of ours that are not in their file follow CSV files/city-extras.tsv
 *   (the owner's decisions): removed, or kept with the region and kind given.
 * - kind: from the statistics bureau's settlement type (CSV files/settlements-cbs-2023.csv):
 *   310, 320 and 191, 192 (moshav, cooperative moshav) are "moshav"; 330 and
 *   193 are "kibbutz"; every other listed form is "town". An "אזור תעשיה" row
 *   is "zone". A row the bureau does not list, or lists with types that
 *   disagree, is "town" and is printed.
 *
 * It refuses to write if any of their towns is missing from ours, sits under
 * two regions, or any row of ours has no source for its region.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cityColumn, parseCsvLine, type PlaceKind } from "../worker/lib/cityCsvParse";
import { allowedTypo } from "../worker/lib/locationNormalize";

export type PublicFile = {
  generated?: string;
  regions: Array<{ name: string; towns: Array<{ name: string }> }>;
};
export type SeedRow = { city: string; region: string; kind: PlaceKind };
export type SeedResult = {
  rows: SeedRow[];
  removed: Array<{ city: string; kept: string }>;
  /** Rows given "town" because the bureau does not list them, or lists them with disagreeing types. */
  unlisted: Array<{ city: string; why: string }>;
  /** How each town's kind was matched to the bureau's list. */
  matched: Record<string, number>;
};

type Extra = { name: string; action: "remove" | "keep"; region: string; kind: string; kept: string };
type CbsRow = { code: string; name: string; type: string };

const MOSHAV_TYPES = new Set(["310", "320", "191", "192"]);
const KIBBUTZ_TYPES = new Set(["330", "193"]);
const ZONE_PREFIX = /^אזור תעשי(?:י)?ה /;
const PREFIX = /^(?:קיבוץ|מושב) /;
const GERSHAYIM = new RegExp(String.fromCharCode(0x5f4), "g");
const GERESH = new RegExp(String.fromCharCode(0x5f3), "g");

/** Punctuation only: quote marks, hyphens, brackets and spacing. */
function squash(s: string): string {
  return s
    .replace(GERSHAYIM, '"')
    .replace(GERESH, "'")
    .replace(/\*$/, "")
    .replace(/[()]/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const withoutBracket = (s: string) => squash(s.replace(/\s*\([^)]*\)\s*$/, ""));

function readTsv(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const head = (lines.shift() ?? "").split("\t");
  return lines.map((l) => {
    const cells = l.split("\t");
    const r: Record<string, string> = {};
    head.forEach((h, i) => (r[h] = (cells[i] ?? "").trim()));
    return r;
  });
}

export function readCbs(raw: string): CbsRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const head = parseCsvLine(lines.shift() ?? "");
  return lines.map((l) => {
    const c = parseCsvLine(l);
    const r: Record<string, string> = {};
    head.forEach((h, i) => (r[h] = (c[i] ?? "").trim()));
    return { code: r.code, name: r.name, type: r.type };
  });
}

function kindOfType(type: string): PlaceKind {
  if (MOSHAV_TYPES.has(type)) return "moshav";
  if (KIBBUTZ_TYPES.has(type)) return "kibbutz";
  return "town";
}

/** The bureau rows a name of ours stands for, and how they were found. */
export function matchCbs(name: string, cbs: CbsRow[], ours: ReadonlySet<string>): { rows: CbsRow[]; how: string } {
  const by = (f: (s: string) => string) => {
    const m = new Map<string, CbsRow[]>();
    for (const r of cbs) {
      const k = f(r.name);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const exact = by((s) => s);
  const punct = by(squash);
  const bracket = by(withoutBracket);
  const names = PREFIX.test(name) ? [name, name.replace(PREFIX, "")] : [name];
  for (const n of names) {
    const step = n === name ? "" : "prefix+";
    const e = exact.get(n);
    if (e) return { rows: e, how: `${step}exact` };
    const p = punct.get(squash(n));
    if (p) return { rows: p, how: `${step}punct` };
    const b = bracket.get(squash(n));
    if (b) return { rows: b, how: `${step}bracket` };
  }
  // One inserted or deleted vav or yod (the normaliser's own restricted rule),
  // never to a bureau name that is itself a row of ours: אודים is not אודם.
  for (const n of names) {
    const hits = cbs.filter((r) => !ours.has(r.name) && allowedTypo(squash(n), withoutBracket(r.name)));
    if (hits.length > 0) return { rows: hits, how: `${n === name ? "" : "prefix+"}vav/yod` };
  }
  return { rows: [], how: "none" };
}

export function seedCityRows(input: { cityCsv: string; publicFile: PublicFile; extrasTsv: string; cbsCsv: string }): SeedResult {
  const ours = cityColumn(input.cityCsv);
  const oursSet = new Set(ours);
  const refusals: string[] = [];

  // Their file: region names, and each town under exactly one of them.
  const regionNames = input.publicFile.regions.map((r) => r.name);
  const regionOf = new Map<string, string>();
  for (const r of input.publicFile.regions) {
    if (!oursSet.has(r.name)) refusals.push(`their region "${r.name}" is not a row of city.csv`);
    for (const t of r.towns) {
      const prev = regionOf.get(t.name);
      if (prev !== undefined && prev !== r.name) refusals.push(`their town "${t.name}" sits under two regions: ${prev}, ${r.name}`);
      regionOf.set(t.name, r.name);
      if (!oursSet.has(t.name)) refusals.push(`their town "${t.name}" is not a row of city.csv`);
    }
  }

  // The owner's decisions for the rest.
  const extras = new Map<string, Extra>();
  for (const e of readTsv(input.extrasTsv)) {
    const x = e as unknown as Extra;
    extras.set(x.name, x);
    if (!oursSet.has(x.name)) refusals.push(`city-extras.tsv names "${x.name}", which is not a row of city.csv`);
    if (x.action === "remove" && !oursSet.has(x.kept)) refusals.push(`"${x.name}" is removed for "${x.kept}", which is not a row of city.csv`);
    if (x.action === "keep" && x.kind !== "nationwide" && !regionNames.includes(x.region)) refusals.push(`"${x.name}" is kept under "${x.region}", which is not one of their regions`);
    if (x.action !== "remove" && x.action !== "keep") refusals.push(`"${x.name}": unknown action "${x.action}"`);
  }

  const cbs = readCbs(input.cbsCsv);
  const rows: SeedRow[] = [];
  const removed: SeedResult["removed"] = [];
  const unlisted: SeedResult["unlisted"] = [];
  const matched: Record<string, number> = {};
  for (const city of ours) {
    if (regionNames.includes(city)) {
      rows.push({ city, region: "", kind: "region" });
      continue;
    }
    const extra = extras.get(city);
    if (extra) {
      if (regionOf.has(city)) refusals.push(`"${city}" is in their file and in city-extras.tsv`);
      if (extra.action === "remove") removed.push({ city, kept: extra.kept });
      else rows.push({ city, region: extra.kind === "nationwide" ? "" : extra.region, kind: extra.kind as PlaceKind });
      continue;
    }
    const region = regionOf.get(city);
    if (region === undefined) {
      refusals.push(`"${city}" is in neither their file nor city-extras.tsv: no decision for its region`);
      continue;
    }
    if (ZONE_PREFIX.test(city)) {
      rows.push({ city, region, kind: "zone" });
      matched.zone = (matched.zone ?? 0) + 1;
      continue;
    }
    const m = matchCbs(city, cbs, oursSet);
    const kinds = [...new Set(m.rows.map((r) => kindOfType(r.type)))];
    if (m.rows.length === 0) {
      unlisted.push({ city, why: "not in the bureau's list" });
      rows.push({ city, region, kind: "town" });
    } else if (kinds.length > 1) {
      unlisted.push({ city, why: `the bureau lists ${m.rows.map((r) => `${r.name} (${r.type})`).join(", ")}` });
      rows.push({ city, region, kind: "town" });
    } else {
      rows.push({ city, region, kind: kinds[0] });
    }
    matched[m.how] = (matched[m.how] ?? 0) + 1;
  }
  if (refusals.length > 0) throw new Error(`seed refused:\n  ${refusals.join("\n  ")}`);
  return { rows, removed, unlisted, matched };
}

/** city.csv's new text: the header, then city,region,kind, quoted as RFC4180 wants. */
export function formatCityCsv(rows: SeedRow[]): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["city,region,kind", ...rows.map((r) => [r.city, r.region, r.kind].map(q).join(","))].join("\n") + "\n";
}

function main(): void {
  const args = process.argv.slice(2);
  const at = args.indexOf("--public");
  const publicPath = at >= 0 ? args[at + 1] : undefined;
  if (!publicPath) throw new Error("usage: seed-city-regions.ts --public <misrotil-job-locations.json> [--write]");
  const publicRaw = readFileSync(publicPath);
  const cityPath = path.resolve("CSV files", "city.csv");
  const result = seedCityRows({
    cityCsv: readFileSync(cityPath, "utf8"),
    publicFile: JSON.parse(publicRaw.toString("utf8")) as PublicFile,
    extrasTsv: readFileSync(path.resolve("CSV files", "city-extras.tsv"), "utf8"),
    cbsCsv: readFileSync(path.resolve("CSV files", "settlements-cbs-2023.csv"), "utf8"),
  });
  const pub = JSON.parse(publicRaw.toString("utf8")) as PublicFile;
  console.log(`public file: ${path.basename(publicPath)}, generated ${pub.generated ?? "?"}, sha256 ${createHash("sha256").update(publicRaw).digest("hex")}`);
  const byKind: Record<string, number> = {};
  for (const r of result.rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  console.log(`rows ${result.rows.length}, removed ${result.removed.length}; kinds ${JSON.stringify(byKind)}`);
  console.log(`kind matched to the bureau's list: ${JSON.stringify(result.matched)}`);
  for (const r of result.removed) console.log(`removed: ${r.city} (kept: ${r.kept})`);
  console.log(`town by default (${result.unlisted.length}):`);
  for (const u of result.unlisted) console.log(`  ${u.city}: ${u.why}`);
  if (args.includes("--write")) {
    writeFileSync(cityPath, formatCityCsv(result.rows), "utf8");
    console.log(`wrote ${cityPath}`);
  } else {
    console.log("plan only; --write writes city.csv");
  }
}

if (process.argv[1] && /seed-city-regions\.ts$/.test(process.argv[1])) main();
