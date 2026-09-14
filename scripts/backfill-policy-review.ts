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
import { selectDuePolicyReviews } from "../src/lib/policySelection";
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

  // Selection goes through the SAME rule as the nightly policy sweep
  // (src/lib/policySelection.ts). It used to be a WHERE clause here and a
  // separate one there, which meant "due for a policy check" could mean two
  // different things on the same evening.
  //
  // The eligibility differences are options, not a different query. This script
  // deliberately does NOT require a captured company profile and does NOT
  // restrict to ACTIVE/REVIEW — it is also used to check sites before they are
  // onboarded, which is exactly what the sweep must not do.
  const allSites = await prisma.site.findMany({
    select: {
      id: true,
      siteUrl: true,
      status: true,
      scrapingPolicyStatus: true,
      scrapingPolicyCheckedAt: true,
      companyProfileAt: true,
    },
  });

  const selection = selectDuePolicyReviews(allSites, {
    now: new Date(),
    recheckIntervalDays: opts.recheckDays,
    limit: isFinite(opts.limit) ? opts.limit : undefined,
    force: opts.force,
    status: opts.status,
    requireCompanyProfile: false,
  });
  const sites = selection.selected;

  console.log(
    `[backfill-policy] Found ${sites.length} sites to process` +
      (selection.cappedOut > 0 ? ` (${selection.cappedOut} more were due, past --limit)` : "") +
      `; ${selection.excluded.length} excluded.`,
  );

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
