/**
 * scripts/logo-background-pass.ts — the pass over stored logos (report fixes
 * 3, item 19): every light logo on a transparent background is stored
 * composited on the fleet's dark neutral, the original kept as
 * <siteId>.orig.<ext>, by the same rule and function as an upload
 * (src/lib/logo-background.ts through storeLogo).
 *
 *   tsx scripts/logo-background-pass.ts           per site: would change / unchanged / unreadable; writes nothing
 *   tsx scripts/logo-background-pass.ts --apply   writes the composites and the .orig copies, prints the note lines
 *
 * The logos live on the server's disk, so this runs on the box after the
 * deploy, in a one-off worker container with scripts/ mounted read-only and
 * the logo volume mounted (read-only for the dry run), as the web
 * container's user so the files keep their owner:
 *
 *   docker run --rm --network "$NETWORK" --user 1001:1001 \
 *     -e DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/scrapnew" \
 *     -e COMPANY_LOGO_DIR=/data/logos \
 *     -v "${COMPOSE_PROJECT}_company_logos:/data/logos:ro" \
 *     -v "$REMOTE_DIR/scripts:/app/scripts:ro" \
 *     "${COMPOSE_PROJECT}-worker" node_modules/.bin/tsx scripts/logo-background-pass.ts
 *
 * The --apply run drops the ":ro" on the logo volume, and runs on the owner's word, from the dry run's list.
 *
 * The one Site write: companyLogoPath, and only where the stored extension
 * changed (a webp composited is stored as png). companyLogoSourceUrl and every
 * other column stay as they are. The note lines go to this run's log; nothing
 * is written to adminNote.
 */
import { prisma } from "../src/lib/prisma";
import { passOneLogo } from "./lib/logoBackgroundPass";

async function main() {
  const apply = process.argv.includes("--apply");
  const sites = await prisma.site.findMany({
    where: { companyLogoPath: { not: null } },
    select: { id: true, companyLogoPath: true },
    orderBy: { id: "asc" },
  });

  const counts: Record<string, number> = {};
  for (const site of sites) {
    const line = await passOneLogo({ id: site.id, companyLogoPath: site.companyLogoPath! }, apply);
    if (apply && line.newLogoPath) {
      await prisma.site.update({ where: { id: site.id }, data: { companyLogoPath: line.newLogoPath } });
    }
    counts[line.verdict] = (counts[line.verdict] ?? 0) + 1;
    console.log(`[logo-background] ${site.id} ${line.verdict}: ${line.detail}${line.newLogoPath ? `; companyLogoPath -> ${line.newLogoPath}` : ""}`);
    if (line.note) console.log(`[logo-background] ${site.id}   NOTE ${line.note}`);
  }
  const summary = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`[logo-background] ${apply ? "APPLIED" : "DRY RUN, nothing written"}: ${sites.length} stored logo(s); ${summary || "none"}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[logo-background] failed:", err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
