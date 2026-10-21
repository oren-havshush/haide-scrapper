// Run: npx tsx scripts/lib/placeSync.test.ts
//
// Report fixes 3, item 18: the Place table, so the public site learns a new
// city.csv row by itself (they asked on 2026-10-12: every place, its region,
// its kind; no more than twenty new places in a night). scripts/sync-places.ts
// runs on the box from deploy.sh right after prisma migrate deploy; the rules
// are scripts/lib/placeSync.ts:
//   - each CSV row is { name: verbatim city, region: the region row's name,
//     null for a region row and the nationwide row, kind };
//   - upsert by name: inserted, updated (region or kind changed), unchanged;
//   - never a delete: a row in the table but not in the CSV is reported and kept;
//   - more than twenty inserts is a warning, not a refusal.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..", "..");

// --- the wiring (what HEAD lacks) ---------------------------------------------------------------------
{
  const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
  const at = schema.indexOf("model Place {");
  assert(at >= 0, "the schema has model Place");
  const model = at >= 0 ? schema.slice(at, schema.indexOf("}", at)) : "";
  assert(/name\s+String\s+@id/.test(model) && /region\s+String\?/.test(model) && /kind\s+String\b/.test(model), "model Place: name @id, region optional, kind");
  assert(/createdAt\s+DateTime\s+@default\(now\(\)\)/.test(model) && /updatedAt\s+DateTime\s+@updatedAt/.test(model), "with createdAt and updatedAt");
  const deploy = readFileSync(join(ROOT, "deploy.sh"), "utf8");
  const migrate = deploy.indexOf("prisma migrate deploy\n");
  const sync = deploy.indexOf("scripts/sync-places.ts");
  assert(migrate > 0 && sync > migrate && sync < deploy.indexOf('echo "==> Starting services..."'), "deploy.sh syncs the places right after the migration, before the services start");
  const line = deploy.slice(sync, deploy.indexOf("\n", sync));
  assert(!/\|\|\s*true/.test(line), "and a failed sync fails the deploy");
  const routePath = join(ROOT, "src", "app", "api", "places", "route.ts");
  const route = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
  assert(/export async function GET\(/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)\(/.test(route), "GET /api/places, read-only");
}

(async () => {
  const { placeRowsFromCsv, planPlaceSync, MAX_QUIET_INSERTS } = await import("./placeSync");

  // --- the CSV to rows: a town, a zone, a region row, the nationwide row ---------------------------------
  const CSV = [
    "city,region,kind",
    "אזור צפון,,region",
    "אזור תעשיה כנות,אזור דרום,zone",
    "חיפה,אזור צפון,town",
    "פריסה ארצית,,nationwide",
    '"ביל""ו",אזור שפלה,kibbutz',
  ].join("\n");
  const rows = placeRowsFromCsv(CSV);
  const by = new Map(rows.map((r) => [r.name, r]));
  assert(rows.length === 5, `five places (got ${rows.length})`);
  assert(JSON.stringify(by.get("חיפה")) === JSON.stringify({ name: "חיפה", region: "אזור צפון", kind: "town" }), "a town: its region row");
  assert(by.get("אזור תעשיה כנות")?.region === "אזור דרום" && by.get("אזור תעשיה כנות")?.kind === "zone", "a zone: its region row");
  assert(by.get("אזור צפון")?.region === null && by.get("אזור צפון")?.kind === "region", "a region row: region null");
  assert(by.get("פריסה ארצית")?.region === null && by.get("פריסה ארצית")?.kind === "nationwide", "the nationwide row: region null");
  assert(by.has('ביל"ו'), "a quoted name, verbatim");

  // The real file: every row, each kind one of the seven.
  const real = placeRowsFromCsv(readFileSync(join(ROOT, "CSV files", "city.csv"), "utf8"));
  assert(real.length >= 1355 && new Set(real.map((r) => r.name)).size === real.length, `the real city.csv: every row, each name once (got ${real.length})`);
  assert(real.every((r) => ["town", "kibbutz", "moshav", "zone", "base", "region", "nationwide"].includes(r.kind)), "every kind is one of the seven");
  assert(real.every((r) => (r.kind === "region" || r.kind === "nationwide") === (r.region === null)), "region null exactly for the region rows and the nationwide row");

  // --- the plan on a stub table ------------------------------------------------------------------------------
  const table = [
    { name: "חיפה", region: "אזור צפון", kind: "town" },
    { name: "אזור תעשיה כנות", region: "אזור מרכז", kind: "zone" },
    { name: "מקום שנמחק", region: "אזור דרום", kind: "town" },
  ];
  const plan = planPlaceSync(rows, table);
  assert(plan.insert.map((r) => r.name).sort().join("|") === ["אזור צפון", "ביל\"ו", "פריסה ארצית"].sort().join("|"), `three inserted (got ${plan.insert.map((r) => r.name).join(", ")})`);
  assert(plan.update.length === 1 && plan.update[0]?.name === "אזור תעשיה כנות" && plan.update[0]?.region === "אזור דרום", "the changed region updated");
  assert(plan.unchanged === 1, "the same row unchanged");
  assert(JSON.stringify(plan.removed) === JSON.stringify(["מקום שנמחק"]), "a row not in the CSV is reported, never deleted");
  assert(plan.warnings.length === 0, "three inserts: no warning");
  const first = planPlaceSync(real, []);
  assert(first.insert.length === real.length && first.warnings.length === 1 && first.warnings[0]!.includes(String(real.length)), `the first sync inserts every row, with the over-${MAX_QUIET_INSERTS} warning (got ${first.warnings.join("; ")})`);
  const twenty = planPlaceSync(real.slice(0, MAX_QUIET_INSERTS), []);
  assert(twenty.warnings.length === 0, "exactly twenty: no warning");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("placeSync: city.csv rows as places, upserted by name, never deleted, a warning past twenty new");
})().catch((e) => {
  console.error(`FAIL: placeSync test threw — ${(e as Error).message}`);
  process.exit(1);
});
