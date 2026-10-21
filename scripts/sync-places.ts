/**
 * scripts/sync-places.ts — fill the Place table from "CSV files/city.csv"
 * (report fixes 3, item 18). Run on the box by deploy.sh, right after
 * `prisma migrate deploy`, in a one-off worker container with scripts/ and
 * "CSV files/" mounted; a failure fails the deploy.
 *
 *   tsx scripts/sync-places.ts            upsert, and report inserted / updated / unchanged
 *   tsx scripts/sync-places.ts --dry-run  report what it would do, write nothing
 *
 * Never deletes (scripts/lib/placeSync.ts): a row gone from the CSV is listed
 * as "in the table, not in the CSV" and left for the owner. More than twenty
 * new places is a warning, not a refusal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { planPlaceSync, placeRowsFromCsv } from "./lib/placeSync";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const csv = placeRowsFromCsv(readFileSync(path.join("CSV files", "city.csv"), "utf8"));
  const table = await prisma.place.findMany({ select: { name: true, region: true, kind: true } });
  const plan = planPlaceSync(csv, table);

  if (!dryRun) {
    // One transaction: the table moves from one CSV to the next, never halfway.
    await prisma.$transaction([
      ...(plan.insert.length ? [prisma.place.createMany({ data: plan.insert })] : []),
      ...plan.update.map((r) => prisma.place.update({ where: { name: r.name }, data: { region: r.region, kind: r.kind } })),
    ]);
  }

  console.log(
    `[sync-places] ${dryRun ? "DRY RUN, would have: " : ""}inserted ${plan.insert.length}, updated ${plan.update.length}, unchanged ${plan.unchanged} (${csv.length} rows in city.csv)`,
  );
  for (const r of plan.update) console.log(`[sync-places]   updated ${r.name}: region ${r.region ?? "-"}, kind ${r.kind}`);
  if (plan.insert.length > 0 && plan.insert.length <= 20) {
    for (const r of plan.insert) console.log(`[sync-places]   new ${r.name} (${r.kind}${r.region ? `, ${r.region}` : ""})`);
  }
  for (const name of plan.removed) console.log(`[sync-places]   in the table, not in the CSV (kept): ${name}`);
  for (const w of plan.warnings) console.log(`[sync-places] WARNING: ${w}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[sync-places] failed:", err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
