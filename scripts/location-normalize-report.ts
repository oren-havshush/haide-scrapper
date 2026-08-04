/**
 * location-normalize-report.ts — MEASURE-ONLY dry run of a fleet-wide location
 * normaliser. Writes nothing, changes no config, touches no schema.
 *
 * Answers, against every live job: if we normalised `location` centrally, what
 * would each value actually become? How many become a canonical `city.csv`
 * entry, how many are genuinely multi-location, and what is left over (i.e. the
 * queue for extending city.csv)?
 *
 * The cascade never blanks a value. If nothing matches, the raw string is kept
 * and reported as unmatched — "Unknown" is reserved for jobs that printed no
 * location at all.
 *
 *   1. exact hit in city.csv
 *   2. punctuation/whitespace normalisation (״ ” " -> ", dashes, double spaces)
 *   3. strip a leaked label ("מיקום: X", "מיקום המשרה: X")
 *   4. split on , | / ; — a job may legitimately list several areas
 *   5. per part: exact -> alias/abbreviation -> typo (edit distance 1) ->
 *      contains-a-known-city
 *
 * Usage:
 *   npx tsx scripts/location-normalize-report.ts [--out <path>] [--cache <glob-dir>]
 *
 * Read-only: GET requests only. Safe to run anytime.
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const PAGE_SIZE = 100;

function arg(name: string, def?: string): string | undefined {
  const pre = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === pre) return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "true";
    if (a.startsWith(pre + "=")) return a.slice(pre.length + 1);
  }
  return def;
}
function token(): string {
  const t = fs.readFileSync(path.resolve(".claude", "scrap-token"), "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

// ---------------------------------------------------------------------------
// canonical list
// ---------------------------------------------------------------------------
function loadCities(): Set<string> {
  const raw = fs.readFileSync(path.resolve("CSV files", "city.csv"), "utf8").replace(/^﻿/, "");
  const rows = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  rows.shift(); // header
  return new Set(rows);
}

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------
/** Unify the punctuation that makes identical names compare unequal. */
function squash(s: string): string {
  return s
    .replace(/[״"”“״]/g, '"')   // gershayim / smart quotes -> "
    .replace(/[׳'’‘]/g, "'")     // geresh -> '
    .replace(/[‐-―–—]/g, "-")
    .replace(/[‎‏ ]/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const LABEL = /^\s*מיקום(\s+המשרה)?\s*:?\s+/;

/** Region + abbreviation + known-variant aliases. Keys are squash()ed. */
const ALIAS: Record<string, string> = {
  // regions -> the canonical "אזור X" spelling in city.csv
  "מרכז": "אזור מרכז", "המרכז": "אזור מרכז", "אזור המרכז": "אזור מרכז",
  "גוש דן": "אזור מרכז", "מרכז גוש דן": "אזור מרכז", "מרכז-גוש דן": "אזור מרכז",
  "אזור תל אביב": "תל אביב-יפו", "אזור גוש דן": "אזור מרכז",
  "צפון": "אזור צפון", "הצפון": "אזור צפון", "אזור הצפון": "אזור צפון",
  "דרום": "אזור דרום", "הדרום": "אזור דרום", "אזור הדרום": "אזור דרום", "הנגב": "אזור דרום",
  "שפלה": "אזור שפלה", "השפלה": "אזור שפלה", "אזור השפלה": "אזור שפלה",
  "שרון": "אזור השרון", "השרון": "אזור השרון",
  "ירושלים והסביבה": "אזור ירושלים", "ירושלים יו\"ש": "אזור ירושלים",
  "ירושלים ויו\"ש": "אזור ירושלים", "אילת והערבה": "אזור אילת", "אילת והסביבה": "אזור אילת",
  "כל הארץ": "פריסה ארצית", "ארצי": "פריסה ארצית", "כלל הארץ": "פריסה ארצית",
  "חיפה והקריות": "חיפה", "חיפה וקריות": "חיפה",
  // abbreviations
  "ת\"א": "תל אביב-יפו", "תל אביב": "תל אביב-יפו", "ת\"א-יפו": "תל אביב-יפו",
  "פ\"ת": "פתח תקווה", "ראשל\"צ": "ראשון לציון", "ב\"ש": "באר שבע",
  "ר\"ג": "רמת גן", "נתב\"ג": "נתב\"ג",
  // spelling variants seen in the fleet
  "פתח תיקווה": "פתח תקווה", "פתח תקוה": "פתח תקווה", "פתח תיקוה": "פתח תקווה",
  "פתח-תקווה": "פתח תקווה", "נצרת עלית": "נצרת עילית", "יקנעם": "יוקנעם",
  // standing overrides (user rule, 2026-08-03)
  "לוד": "רמלה לוד", "רמלה": "רמלה לוד", "חצור": "חצור הגלילית",
};

/** English job boards write the city in Latin script. */
const EN_CITY: Record<string, string> = {
  "tel aviv": "תל אביב-יפו", "tel-aviv": "תל אביב-יפו", "tel aviv-yafo": "תל אביב-יפו",
  "jerusalem": "ירושלים", "haifa": "חיפה", "netanya": "נתניה", "beer sheva": "באר שבע",
  "be'er sheva": "באר שבע", "beersheba": "באר שבע", "rehovot": "רחובות", "holon": "חולון",
  "ramat gan": "רמת גן", "petah tikva": "פתח תקווה", "petach tikva": "פתח תקווה",
  "rishon lezion": "ראשון לציון", "herzliya": "הרצליה", "raanana": "רעננה",
  "ra'anana": "רעננה", "kfar saba": "כפר סבא", "modiin": "מודיעין", "karmiel": "כרמיאל",
  "yokneam": "יוקנעם", "ashdod": "אשדוד", "ashkelon": "אשקלון", "eilat": "אילת",
  "nes ziona": "נס ציונה", "yavne": "יבנה", "lod": "רמלה לוד", "ramla": "רמלה לוד",
  "rosh haayin": "ראש העין", "rosh ha'ayin": "ראש העין", "bnei brak": "בני ברק",
  "givatayim": "גבעתיים", "hod hasharon": "הוד השרון", "kiryat gat": "קרית גת",
  "nazareth": "נצרת", "tiberias": "טבריה", "acre": "עכו", "hadera": "חדרה",
  "israel": "פריסה ארצית", "yiftah": "יפתח",
};

/** Not Israeli locations — a job genuinely posted abroad, not a data defect. */
const ABROAD = /^(new york|singapore|canada|uk|united kingdom|usa|us|apac|emea|europe|germany|france|india|china|japan|australia|poland|romania|brazil|mexico|spain|italy|netherlands|belgium|remote)$/i;

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

interface Resolved { values: string[]; method: string; unmatched: string[] }

/**
 * Find EVERY known place named in a string, not just the first two.
 * "חיפה חדרה והצפון" -> חיפה + חדרה + אזור צפון. Longest-first and
 * non-overlapping, so "תל אביב-יפו" is consumed whole and never re-matched as
 * "תל אביב". Each hit must sit on a word boundary (not inside a longer Hebrew
 * word), which stops "כפר ורדים" being shredded into "כפר" + "רדים".
 */
function scanPlaces(s: string, cities: Set<string>, sorted: string[]): string[] {
  const hay = squash(s);
  const candidates: Array<[string, string]> = []; // [needle, canonical]
  for (const c of sorted) if (c.length >= 3) candidates.push([c, c]);
  for (const [k, v] of Object.entries(ALIAS)) if (k.length >= 3) candidates.push([k, v]);
  candidates.sort((a, b) => b[0].length - a[0].length);

  const taken: Array<[number, number]> = [];
  const hits: Array<{ at: number; value: string }> = [];
  const isHeb = (ch: string) => /[֐-׿]/.test(ch);

  for (const [needle, canonical] of candidates) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;
      const end = at + needle.length;
      const before = at > 0 ? hay[at - 1] : " ";
      const after = end < hay.length ? hay[end] : " ";
      // Must not be embedded inside a longer Hebrew word. Only a leading ו- is
      // allowed ("והצפון"); allowing ה- too would match גפן inside "נוף הגפן".
      // Definite-article forms that matter ("הצפון", "השרון") are alias keys already.
      if (isHeb(before) && before !== "ו") continue;
      if (isHeb(after)) continue;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      taken.push([at, end]);
      hits.push({ at, value: canonical });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.value)) out.push(h.value);
  return out;
}

function resolvePart(part: string, cities: Set<string>, sorted: string[]): { value: string; method: string } | null {
  const p = squash(part);
  if (!p) return null;
  if (cities.has(p)) return { value: p, method: "exact" };
  if (ALIAS[p]) return { value: ALIAS[p], method: "alias" };
  // English / Latin-script city names
  const lower = p.toLowerCase().replace(/,?\s*(israel|il)\.?$/i, "").trim();
  if (EN_CITY[lower]) return { value: EN_CITY[lower], method: "en" };
  if (/^[a-z].*/i.test(p)) {
    for (const [en, he] of Object.entries(EN_CITY))
      if (en.length >= 4 && lower.includes(en)) return { value: he, method: "en-contains" };
  }
  // hyphen/space variant of a real entry
  for (const alt of [p.replace(/-/g, " "), p.replace(/ /g, "-"), p.replace(/קרית/g, "קריית"), p.replace(/קריית/g, "קרית")])
    if (cities.has(alt)) return { value: alt, method: "variant" };
  // typo tolerance, only for reasonably long names
  if (p.length >= 5)
    for (const c of sorted)
      if (c.length >= 5 && levenshtein(p, c) === 1) return { value: c, method: "typo" };
  // contains a known city (recovers "קרית אריה פתח-תקווה", "ת\"א - מטה מכבי")
  let best = "";
  for (const c of sorted) {
    if (c.length < 3) continue;
    if (p.includes(c) && c.length > best.length) best = c;
  }
  if (best) return { value: ALIAS[best] ?? best, method: "contains" };
  for (const k of Object.keys(ALIAS))
    if (k.length >= 3 && p.includes(k)) return { value: ALIAS[k], method: "contains-alias" };
  return null;
}

function normalizeLocation(raw: string, cities: Set<string>, sorted: string[]): Resolved {
  const original = (raw ?? "").trim();
  if (!original || original === "Unknown") return { values: [], method: "empty", unmatched: [] };
  if (cities.has(original)) return { values: [original], method: "exact", unmatched: [] };

  let s = squash(original);
  const hadLabel = LABEL.test(s);
  s = s.replace(LABEL, "").trim();

  if (ABROAD.test(s)) return { values: [s], method: "ABROAD", unmatched: [] };

  const parts = s.split(/\s*[,|/;]\s*/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  const unmatched: string[] = [];
  const methods = new Set<string>();
  for (const part of parts) {
    const r = resolvePart(part, cities, sorted);
    // A clean whole-string hit wins — don't dissect "רמת גן" looking for more.
    if (r && (r.method === "exact" || r.method === "alias" || r.method === "en" || r.method === "variant")) {
      if (!out.includes(r.value)) out.push(r.value);
      methods.add(r.method);
      continue;
    }
    // Otherwise the part may name several places ("חיפה חדרה והצפון").
    const scanned = scanPlaces(part, cities, sorted);
    if (scanned.length) {
      for (const v of scanned) if (!out.includes(v)) out.push(v);
      methods.add(scanned.length > 1 ? "multi-scan" : "scan");
      continue;
    }
    if (r) { if (!out.includes(r.value)) out.push(r.value); methods.add(r.method); }
    else unmatched.push(part);
  }
  if (out.length === 0) return { values: [original], method: "UNMATCHED", unmatched };
  let method = [...methods].join("+");
  if (hadLabel) method = "label-strip+" + method;
  if (parts.length > 1) method = "split+" + method;
  return { values: out, method, unmatched };
}

// ---------------------------------------------------------------------------
async function fetchAllJobs(headers: Record<string, string>): Promise<any[]> {
  const all: any[] = []; let page = 1; let total = Infinity;
  while (all.length < total) {
    const r = await fetch(`${BASE}/api/jobs?pageSize=${PAGE_SIZE}&page=${page}`, { headers });
    if (!r.ok) throw new Error(`GET /api/jobs page ${page} -> ${r.status}`);
    const j: any = await r.json();
    const batch: any[] = j.data || [];
    if (j.meta?.total != null) total = j.meta.total;
    if (!batch.length) break;
    all.push(...batch);
    process.stderr.write(`\r[loc] fetched ${all.length}/${total}   `);
    page++;
    if (page > 500) break;
  }
  process.stderr.write("\n");
  return all;
}

async function main() {
  const cities = loadCities();
  const sorted = [...cities].sort((a, b) => b.length - a.length);
  const HEADERS = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };

  const cacheDir = arg("cache");
  let jobs: any[];
  if (cacheDir) {
    const seen: Record<string, any> = {};
    for (const f of fs.readdirSync(cacheDir).filter((x) => x.endsWith(".json")))
      try { for (const j of JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8")).data || []) seen[j.id] = j; } catch { /* skip */ }
    jobs = Object.values(seen);
    console.error(`[loc] loaded ${jobs.length} jobs from cache`);
  } else {
    jobs = await fetchAllJobs(HEADERS);
  }

  const byValue = new Map<string, number>();
  for (const j of jobs) {
    const l = (j.location ?? "").trim();
    if (l) byValue.set(l, (byValue.get(l) ?? 0) + 1);
  }

  let jobsCanonicalBefore = 0, jobsCanonicalAfter = 0, jobsMulti = 0, jobsUnmatched = 0, jobsUnknown = 0;
  const rows: Array<{ from: string; to: string[]; n: number; method: string }> = [];
  const stillBad = new Map<string, number>();

  for (const [value, n] of byValue) {
    if (value === "Unknown") { jobsUnknown += n; continue; }
    if (cities.has(value)) { jobsCanonicalBefore += n; jobsCanonicalAfter += n; continue; }
    const r = normalizeLocation(value, cities, sorted);
    rows.push({ from: value, to: r.values, n, method: r.method });
    if (r.method === "UNMATCHED") { jobsUnmatched += n; stillBad.set(value, n); }
    else {
      jobsCanonicalAfter += n;
      if (r.values.length > 1) jobsMulti += n;
    }
  }

  const totalWithLoc = [...byValue.entries()].filter(([k]) => k !== "Unknown").reduce((s, [, v]) => s + v, 0);
  const pct = (x: number) => `${((x / totalWithLoc) * 100).toFixed(1)}%`;

  const L: string[] = [];
  L.push(`# Location normalisation — dry run (${new Date().toISOString().slice(0, 10)})`);
  L.push("");
  L.push(`Measure-only. Nothing was written. ${jobs.length} jobs; ${totalWithLoc} carry a location (plus ${jobsUnknown} \`Unknown\`).`);
  L.push("");
  L.push("| | jobs | share |");
  L.push("| --- | --- | --- |");
  L.push(`| canonical **before** | ${jobsCanonicalBefore} | ${pct(jobsCanonicalBefore)} |`);
  L.push(`| canonical **after** | ${jobsCanonicalAfter} | ${pct(jobsCanonicalAfter)} |`);
  L.push(`| → of which resolve to **multiple** locations | ${jobsMulti} | ${pct(jobsMulti)} |`);
  L.push(`| still unmatched (raw value kept, never blanked) | ${jobsUnmatched} | ${pct(jobsUnmatched)} |`);
  L.push("");
  L.push(`**Net effect: ${jobsCanonicalBefore} → ${jobsCanonicalAfter} jobs with a canonical location (+${jobsCanonicalAfter - jobsCanonicalBefore}).**`);
  L.push("");
  L.push("## Proposed mappings");
  L.push("");
  L.push("Every non-canonical value and what it would become. Review the `→` column — these are the judgement calls.");
  L.push("");
  L.push("| jobs | from | → to | how |");
  L.push("| --- | --- | --- | --- |");
  for (const r of rows.filter((x) => x.method !== "UNMATCHED").sort((a, b) => b.n - a.n))
    L.push(`| ${r.n} | \`${r.from}\` | ${r.to.map((t) => `\`${t}\``).join(" + ")} | ${r.method} |`);
  L.push("");
  L.push("## Still unmatched — the city.csv queue");
  L.push("");
  L.push(`${stillBad.size} distinct values (${jobsUnmatched} jobs) matched nothing. The raw value is kept, not blanked.`);
  L.push("");
  L.push("| jobs | value |");
  L.push("| --- | --- |");
  for (const [v, n] of [...stillBad.entries()].sort((a, b) => b[1] - a[1]))
    L.push(`| ${n} | \`${v}\` |`);
  L.push("");

  const out = arg("out") ?? `.scratch/location-normalize-report-${new Date().toISOString().slice(0, 10)}.md`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, L.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${path.resolve(out)}`);
  console.log(`canonical ${jobsCanonicalBefore} -> ${jobsCanonicalAfter} of ${totalWithLoc} (${pct(jobsCanonicalAfter)}), multi-location ${jobsMulti}, unmatched ${jobsUnmatched} (${stillBad.size} distinct)`);
}

main().catch((e) => { console.error(`[loc] FATAL: ${(e as Error).message}`); process.exit(1); });
