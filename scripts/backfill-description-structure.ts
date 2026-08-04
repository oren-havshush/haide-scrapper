/**
 * Backfill line structure into job descriptions that were stored as one
 * run-on line ("blob"). Repairs existing rows in place — no re-scrape.
 *
 * Usage:
 *   npx tsx scripts/backfill-description-structure.ts [options]
 *
 * Options:
 *   --apply        Actually write. Without it the script is a DRY RUN.
 *   --limit N      Stop after N jobs updated (default: all)
 *   --site ID      Restrict to one siteId
 *   --batch N      Rows fetched per page (default: 500)
 *   --samples N    Print N before/after examples (default: 3)
 *
 * Safe to re-run: `structureDescription` is a no-op on text that already has
 * line breaks, so a second pass updates nothing. Rows it cannot confidently
 * structure are left exactly as they are.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { isBlob, structureDescription } from "../worker/lib/descriptionStructure";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const val = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
const str = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag("--apply");
const LIMIT = val("--limit", Infinity);
const BATCH = val("--batch", 500);
const SAMPLES = val("--samples", 3);
const SITE = str("--site");

async function main() {
  console.log(
    `${APPLY ? "APPLY — writing to the database" : "DRY RUN — no writes"}` +
      `${SITE ? ` | site=${SITE}` : ""}${LIMIT !== Infinity ? ` | limit=${LIMIT}` : ""}`,
  );

  let cursor: string | undefined;
  let scanned = 0;
  let descFixed = 0;
  let reqFixed = 0;
  let updated = 0;
  let shown = 0;
  const perSite = new Map<string, number>();

  for (;;) {
    const page = await prisma.job.findMany({
      where: SITE ? { siteId: SITE } : undefined,
      select: { id: true, siteId: true, description: true, requirements: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;

    for (const job of page) {
      if (updated >= LIMIT) break;

      const data: { description?: string; requirements?: string } = {};

      const d = job.description ?? "";
      if (isBlob(d)) {
        const fixed = structureDescription(d);
        if (fixed !== d) {
          data.description = fixed;
          descFixed++;
          if (shown < SAMPLES) {
            shown++;
            console.log(
              `\n--- sample ${shown} (job ${job.id})\nBEFORE: ${d.slice(0, 180)}\nAFTER:\n${fixed
                .split("\n")
                .slice(0, 8)
                .map((l) => "  | " + l.slice(0, 90))
                .join("\n")}`,
            );
          }
        }
      }

      const r = job.requirements ?? "";
      if (isBlob(r)) {
        const fixed = structureDescription(r);
        if (fixed !== r) {
          data.requirements = fixed;
          reqFixed++;
        }
      }

      if (Object.keys(data).length === 0) continue;
      updated++;
      perSite.set(job.siteId, (perSite.get(job.siteId) ?? 0) + 1);
      if (APPLY) await prisma.job.update({ where: { id: job.id }, data });
    }

    if (updated >= LIMIT) break;
    if (scanned % 2000 === 0)
      console.log(`  ...scanned ${scanned}, would update ${updated}`);
  }

  console.log(
    `\nScanned ${scanned} jobs\n` +
      `  descriptions restructured : ${descFixed}\n` +
      `  requirements restructured : ${reqFixed}\n` +
      `  rows ${APPLY ? "updated" : "that would be updated"} : ${updated}\n` +
      `  sites touched             : ${perSite.size}`,
  );
  if (!APPLY) console.log("\nDRY RUN — nothing was written. Re-run with --apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
