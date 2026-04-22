import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const SEED_SITES: string[] = [
  "https://railcareer.adamtotal.co.il/?token=45e7ea44-8787-4910-3423-c84e9fttredbccf_ext",
  "https://www.assuta.co.il/jobs/search/",
  "https://www.netanya.ac.il/hot-jobs/",
  "https://www.ikea.com/il/he/this-is-ikea/work-with-us/jobs-pub70183d80/",
  "https://dreamjobs.co.il/brand/FOX",
  "https://www.strauss-group.co.il/career/jobs/?user_page=1&freeText=",
];

async function seedSite(siteUrl: string) {
  const existing = await prisma.site.findUnique({ where: { siteUrl } });
  if (existing) {
    console.log(`  • exists:  ${siteUrl}  (${existing.status})`);
    return { created: false };
  }

  const site = await prisma.site.create({
    data: {
      siteUrl,
      status: "ANALYZING",
      analyzingAt: new Date(),
    },
  });

  await prisma.workerJob.create({
    data: {
      siteId: site.id,
      type: "ANALYSIS",
      status: "PENDING",
    },
  });

  console.log(`  + created: ${siteUrl}`);
  return { created: true };
}

async function main() {
  console.log(`Seeding ${SEED_SITES.length} sites...`);
  let created = 0;
  let skipped = 0;

  for (const url of SEED_SITES) {
    const { created: wasCreated } = await seedSite(url);
    if (wasCreated) created++;
    else skipped++;
  }

  console.log(`\nDone. created=${created} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
