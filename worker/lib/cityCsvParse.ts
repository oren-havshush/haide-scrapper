/**
 * cityCsvParse.ts — the one parser for "CSV files/city.csv" (city-file design,
 * commit A, 2026-10-13).
 *
 * city.csv is about to gain columns (city,region,kind). Its four readers each
 * parsed it their own way: scripts/lib/city-csv.ts took EVERY cell of every
 * line, build-il-places.ts and location-normalize-report.ts split on newlines
 * and took the whole line, and src/lib/locations.test.ts had its own copy of
 * the cell loop. With a second column, the first would have admitted every
 * region and kind as a city. Each now reads the file through here: the header
 * row names the columns, and the city is the column headed `city`, verbatim.
 *
 * Pure: no file access, so the worker, the scripts and the tests share it.
 * RFC4180: a value with a gershayim is quoted and its quote doubled —
 * `"ביל""ו"` is the single value ביל"ו.
 */

/** A byte-order mark at the start of the file (built, so no invisible character sits in the source). */
const BOM = new RegExp("^" + String.fromCharCode(0xfeff));

/** Parse one RFC4180 line into cells, honouring quotes and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export type CityCsv = {
  /** The header row's names, trimmed. */
  header: string[];
  /** One record per data row, keyed by header name; values trimmed. */
  rows: Array<Record<string, string>>;
};

/** The whole file: the header, then one record per non-empty line. Throws when there is no `city` column. */
export function parseCityCsvTable(raw: string): CityCsv {
  const lines = raw.replace(BOM, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const first = lines.shift();
  const header = first === undefined ? [] : parseCsvLine(first).map((h) => h.trim());
  if (!header.includes("city")) throw new Error(`city.csv: the header row has no "city" column (got ${JSON.stringify(header)})`);
  const rows = lines.map((line) => {
    const cells = parseCsvLine(line);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });
  return { header, rows };
}

/** The city column, verbatim and trimmed, in file order; empty values left out. */
export function cityColumn(raw: string): string[] {
  return parseCityCsvTable(raw)
    .rows.map((r) => r.city)
    .filter((v) => v !== "");
}
