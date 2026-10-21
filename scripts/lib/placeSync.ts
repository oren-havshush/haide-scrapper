/**
 * The Place table's sync rules (report fixes 3, item 18): "CSV files/city.csv"
 * as rows, and what an upsert by name does to the table. Pure; the database
 * side is scripts/sync-places.ts.
 *
 * Upserted by name, region and kind updated when they changed; never a
 * delete: a row the CSV no longer has is reported and kept, because the public
 * site's filter may still point at it. More than MAX_QUIET_INSERTS new places
 * in one run is a warning, not a refusal (the public site asked for no more
 * than twenty a night; the owner decides what to tell them).
 */
import { parseCityCsvTable } from "../../worker/lib/cityCsvParse";

export const MAX_QUIET_INSERTS = 20;

export interface PlaceRow {
  name: string;
  /** The region row's name; null for a region row and the nationwide row. */
  region: string | null;
  kind: string;
}

/** Every city.csv row as a place, each name once (the first row wins). */
export function placeRowsFromCsv(raw: string): PlaceRow[] {
  const out: PlaceRow[] = [];
  const seen = new Set<string>();
  for (const r of parseCityCsvTable(raw).rows) {
    const name = (r["city"] ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const kind = (r["kind"] ?? "").trim();
    const region = (r["region"] ?? "").trim();
    out.push({ name, region: kind === "region" || kind === "nationwide" || !region ? null : region, kind });
  }
  return out;
}

export interface PlaceSyncPlan {
  insert: PlaceRow[];
  update: PlaceRow[];
  unchanged: number;
  /** In the table, not in the CSV: reported, kept. */
  removed: string[];
  warnings: string[];
}

export function planPlaceSync(csv: PlaceRow[], table: PlaceRow[]): PlaceSyncPlan {
  const have = new Map(table.map((r) => [r.name, r]));
  const plan: PlaceSyncPlan = { insert: [], update: [], unchanged: 0, removed: [], warnings: [] };
  for (const row of csv) {
    const cur = have.get(row.name);
    if (!cur) plan.insert.push(row);
    else if ((cur.region ?? null) !== row.region || cur.kind !== row.kind) plan.update.push(row);
    else plan.unchanged++;
  }
  const inCsv = new Set(csv.map((r) => r.name));
  plan.removed = table.filter((r) => !inCsv.has(r.name)).map((r) => r.name);
  if (plan.insert.length > MAX_QUIET_INSERTS) {
    plan.warnings.push(
      `${plan.insert.length} new places in one run, more than the ${MAX_QUIET_INSERTS} the public site asked for in a night: tell them before they read it`,
    );
  }
  return plan;
}
