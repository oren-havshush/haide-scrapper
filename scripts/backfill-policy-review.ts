/**
 * Backfill policy review jobs across all existing sites.
 *
 * Usage:
 *   npx tsx scripts/backfill-policy-review.ts [options]
 *
 * Options:
 *   --limit N            Max number of sites to enqueue (default: all)
 *   --status STATUS      Only enqueue sites in this SiteStatus (e.g. ACTIVE)
 *   --force              Re-enqueue even if checked within recheckIntervalDays
 *   --recheck-days N     Override the stale threshold (default: POLICY_RECHECK_INTERVAL_DAYS or 90)
 *   --delay-ms N         Override inter-job delay in ms (default: 2000)
 *   --dry-run            Log what would be enqueued without writing to DB
 *
 * The script is idempotent and safe to resume: it skips sites that already
 * have a PENDING/IN_PROGRESS POLICY_REVIEW job and (unless --force) sites
 * checked recently.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: Infinity,
    status: undefined as string | undefined,
    force: false,
    recheckDays: parseInt(process.env.POLICY_RECHECK_INTERVAL_DAYS || "90", 10),
    delayMs: parseInt(process.env.POLICY_JOB_DELAY_MS || "2000", 10),
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    if (arg === "--status" && args[i + 1]) opts.status = args[++i];
    if (arg === "--force") opts.force = true;
    if (arg === "--recheck-days" && args[i + 1]) opts.recheckDays = parseInt(args[++i], 10);
    if (arg === "--delay-ms" && args[i + 1]) opts.delayMs = parseInt(args[++i], 10);
    if (arg === "--dry-run") opts.dryRun = true;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log("[backfill-policy] Starting backfill with options:", opts);

  const staleThreshold = new Date(Date.now() - opts.recheckDays * 24 * 60 * 60 * 1000);

  // Find sites that need a policy review
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;
  if (!opts.force) {
    where.OR = [
      { scrapingPolicyCheckedAt: null },
      { scrapingPolicyCheckedAt: { lt: staleThreshold } },
    ];
  }

  const sites = await prisma.site.findMany({
    where,
    select: {
      id: true,
      siteUrl: true,
      scrapingPolicyStatus: true,
      scrapingPolicyCheckedAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: isFinite(opts.limit) ? opts.limit : undefined,
  });

  console.log(`[backfill-policy] Found ${sites.length} sites to process.`);

  // Check which sites already have an active POLICY_REVIEW job
  const activeJobs = await prisma.workerJob.findMany({
    where: {
      type: "POLICY_REVIEW",
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    select: { siteId: true },
  });
  const activeSiteIds = new Set(activeJobs.map((j) => j.siteId));

  let enqueued = 0;
  let skipped = 0;
  let alreadyQueued = 0;

  for (const site of sites) {
    if (activeSiteIds.has(site.id)) {
      console.log(`[backfill-policy] Skip (job already queued): ${site.siteUrl}`);
      alreadyQueued++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[backfill-policy] [DRY-RUN] Would enqueue: ${site.siteUrl} (current: ${site.scrapingPolicyStatus})`);
      enqueued++;
      continue;
    }

    try {
      await prisma.workerJob.create({
        data: {
          siteId: site.id,
          type: "POLICY_REVIEW",
          status: "PENDING",
          payload: { reviewSource: "backfill" },
        },
      });
      console.log(`[backfill-policy] Enqueued: ${site.siteUrl}`);
      enqueued++;
    } catch (err) {
      console.warn(`[backfill-policy] Failed to enqueue ${site.siteUrl}:`, err);
      skipped++;
      continue;
    }

    // Rate-limit inter-job enqueue
    if (opts.delayMs > 0) {
      await sleep(opts.delayMs);
    }
  }

  console.log(`[backfill-policy] Done. enqueued=${enqueued} skipped=${skipped} alreadyQueued=${alreadyQueued}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main()
  .catch((err) => {
    console.error("[backfill-policy] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
