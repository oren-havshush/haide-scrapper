// Backfill Site.firstActiveAt and Site.firstScrapedAt (step A) from the list the
// owner reviewed. Runs on the box, in the worker image (scripts/ is not in it):
//
//   docker compose run --rm -T sweep node_modules/.bin/tsx worker/tools/backfillFirstDates.ts \
//     < /tmp/first_dates_proposed.tsv            # DRY: prints what would be set
//   ... worker/tools/backfillFirstDates.ts --apply < /tmp/first_dates_proposed.tsv
//
// Applies exactly the list (worker/lib/firstDatesBackfill.ts) and derives
// nothing. Writes only where the column is still NULL, so a date the running
// code has already set is never overwritten, and a second run changes nothing.

import { prisma } from "../../src/lib/prisma";
import { parseFirstDatesList } from "../lib/firstDatesBackfill";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

(async () => {
  const apply = process.argv.includes("--apply");
  const { rows, errors } = parseFirstDatesList(await readStdin());
  if (errors.length > 0) {
    console.error(`refused: ${errors.length} unreadable row(s), nothing written`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.info(apply ? "=== APPLYING first-dates backfill ===" : "=== DRY RUN (nothing written; add --apply) ===");

  const current = new Map(
    (
      await prisma.site.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        select: { id: true, siteUrl: true, firstActiveAt: true, firstScrapedAt: true },
      })
    ).map((s) => [s.id, s]),
  );

  let active = 0;
  let scraped = 0;
  let missing = 0;
  for (const r of rows) {
    const s = current.get(r.id);
    if (!s) {
      missing++;
      console.info(`  ${r.id}: no such site - skipped`);
      continue;
    }
    const setActive = r.firstActiveAt && !s.firstActiveAt ? r.firstActiveAt : null;
    const setScraped = r.firstScrapedAt && !s.firstScrapedAt ? r.firstScrapedAt : null;
    if (!setActive && !setScraped) continue;
    console.info(
      `  ${s.siteUrl}` +
        (setActive ? `  firstActiveAt=${setActive.toISOString()}` : "") +
        (setScraped ? `  firstScrapedAt=${setScraped.toISOString()}` : ""),
    );
    if (apply && setActive) {
      active += (
        await prisma.site.updateMany({ where: { id: r.id, firstActiveAt: null }, data: { firstActiveAt: setActive } })
      ).count;
    } else if (setActive) active++;
    if (apply && setScraped) {
      scraped += (
        await prisma.site.updateMany({ where: { id: r.id, firstScrapedAt: null }, data: { firstScrapedAt: setScraped } })
      ).count;
    } else if (setScraped) scraped++;
  }
  console.info(
    `${apply ? "set" : "would set"}: firstActiveAt on ${active} site(s), firstScrapedAt on ${scraped}; ` +
      `${rows.length} listed, ${missing} not found`,
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(`backfillFirstDates: ${(e as Error).message}`);
  await prisma.$disconnect();
  process.exit(1);
});
