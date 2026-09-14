// The nightly scrape sweep.
//
// Run:
//   npx tsx worker/sweep/nightly.ts --dry-run          read-only; prints and exits
//   npx tsx worker/sweep/nightly.ts --site <id> --now   one site, then stop
//   npx tsx worker/sweep/nightly.ts --now               the whole fleet
//
// RESIDENT, not fire-and-forget. It enqueues ONE site, waits for that site's
// ScrapeRun to reach a terminal state, records the result, and moves on. Only
// one site is ever in flight, so manual scraping stays available all night, the
// before/after deltas are measured at the right moment, and cancelling means
// cancelling one job rather than unpicking a queue of 145.
//
// It is the only caller that passes `scheduled: true`, which is what suppresses
// every site-mutating write in scrape.ts (worker/lib/scheduledRun.ts). Nothing
// reachable from the HTTP route can set it.
//
// SCRAPE only, never ANALYSIS: an ANALYSIS job rewrites a site's config, so a
// fleet-wide refresh would flatten every hand-built config in one night.
//
// Not yet here, and deliberately: the breaker (step 6) and the rendered report
// (step 7). The seams are marked.

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { sweepConfig } from "../../src/lib/config";
import { ConflictError } from "../../src/lib/errors";
import { createScrapeRun } from "../../src/services/siteService";
import {
  SWEEP_REAP_OPTIONS,
  reapOrphanedScrapeRuns,
} from "../../src/services/scrapeRunService";
import {
  classifyOutcome,
  isSuccessfulRun,
  selectSitesForSweep,
  SWEEP_SITE_STATUSES,
  type SelectableSite,
} from "../lib/sweepSelection";
import { assessDrain, BUSY_EVIDENCE_WINDOW_MS, HEAD_OF_QUEUE_DEADLINE_MS } from "../lib/drainProbe";
import { readScheduledFlag } from "../lib/scheduledRun";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

type Mode =
  | { kind: "dry-run" }
  | { kind: "single"; siteId: string }
  | { kind: "fleet" };

function parseArgs(argv: string[]): Mode {
  const dryRun = argv.includes("--dry-run");
  const now = argv.includes("--now");
  const siteIdx = argv.indexOf("--site");
  const siteId = siteIdx >= 0 ? argv[siteIdx + 1] : undefined;

  if (dryRun) return { kind: "dry-run" };
  if (siteId) {
    if (!now) throw new Error("--site requires --now (it runs the scheduled path for real)");
    return { kind: "single", siteId };
  }
  if (now) return { kind: "fleet" };
  throw new Error("one of --dry-run, --now, or --site <id> --now is required");
}

const log = (line: string) => console.info(line);

// ---------------------------------------------------------------------------
// Selection, from the database
// ---------------------------------------------------------------------------

async function loadSelectableSites(): Promise<SelectableSite[]> {
  const sites = await prisma.site.findMany({
    where: { status: { in: [...SWEEP_SITE_STATUSES] } },
    select: { id: true, siteUrl: true, status: true, fieldMappings: true },
  });

  // Last attempt (any outcome) and last success, per site. Read separately
  // because "success" is a definition, not a status — see sweepSelection.ts.
  const runs = await prisma.scrapeRun.findMany({
    where: { siteId: { in: sites.map((s) => s.id) } },
    select: { siteId: true, status: true, failureCategory: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const lastAttempt = new Map<string, Date>();
  const lastSuccess = new Map<string, Date>();
  for (const r of runs) {
    if (r.status === "IN_PROGRESS") continue; // not an outcome yet
    if (!lastAttempt.has(r.siteId)) lastAttempt.set(r.siteId, r.createdAt);
    if (!lastSuccess.has(r.siteId) && isSuccessfulRun(r)) lastSuccess.set(r.siteId, r.createdAt);
  }

  return sites.map((s) => ({
    id: s.id,
    siteUrl: s.siteUrl,
    status: s.status,
    fieldMappings: s.fieldMappings,
    lastAttemptAt: lastAttempt.get(s.id) ?? null,
    lastSuccessAt: lastSuccess.get(s.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

/**
 * Close any ScrapeSweep left RUNNING by a previous night. Without this the
 * dashboard shows a sweep in progress forever, and "is a sweep running?" stops
 * being answerable.
 */
async function resolveStaleSweeps(dryRun: boolean): Promise<number> {
  const stale = await prisma.scrapeSweep.findMany({
    where: { status: "RUNNING" },
    select: { id: true, startedAt: true },
  });
  if (stale.length === 0) return 0;

  if (dryRun) {
    for (const s of stale) {
      log(`  would close stale RUNNING sweep ${s.id} (started ${s.startedAt.toISOString()})`);
    }
    return stale.length;
  }

  await prisma.scrapeSweep.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: {
      status: "FAILED",
      haltReason: "abandoned",
      finishedAt: new Date(),
    },
  });
  return stale.length;
}

/** Facts the drain probe needs, read fresh each poll. */
async function readQueueState(probeJobId: string | null) {
  const now = Date.now();

  const newestInProgress = await prisma.workerJob.findFirst({
    where: { status: "IN_PROGRESS", startedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });

  let probeAtHeadOfQueue = false;
  let probeClaimed = false;
  if (probeJobId) {
    const probe = await prisma.workerJob.findUnique({
      where: { id: probeJobId },
      select: { status: true, createdAt: true },
    });
    probeClaimed = probe != null && probe.status !== "PENDING";
    if (probe && probe.status === "PENDING") {
      const older = await prisma.workerJob.count({
        where: { status: "PENDING", createdAt: { lt: probe.createdAt } },
      });
      probeAtHeadOfQueue = older === 0;
    }
  }

  return {
    newestInProgressAgeMs: newestInProgress?.startedAt
      ? now - newestInProgress.startedAt.getTime()
      : null,
    probeAtHeadOfQueue,
    probeClaimed,
  };
}

// ---------------------------------------------------------------------------
// Waiting on one site
// ---------------------------------------------------------------------------

type SiteResult = {
  siteId: string;
  siteUrl: string;
  scrapeRunId: string | null;
  outcome: string;
  failureCategory: string | null;
  jobsBefore: number;
  jobsAfter: number;
  newestJobAt: Date | null;
  siteStatus: string;
  wouldDemoteTo: string | null;
  wouldPromoteTo: string | null;
  startedAt: Date;
  finishedAt: Date;
  defect: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a scheduled run to finish.
 *
 * Waits on BOTH the ScrapeRun and its WorkerJob: a job that dies without
 * touching its run would otherwise leave this polling until the per-site
 * timeout. And a run that flips back to IN_PROGRESS after reaching a terminal
 * state is reported as a defect rather than acted on — that is two writers of
 * terminal state, and acting on it would paper over the thing worth knowing.
 */
async function waitForRun(
  scrapeRunId: string,
  opts: { timeoutMs: number; pollMs: number },
): Promise<{
  status: string;
  failureCategory: string | null;
  jobCount: number;
  defect: string | null;
}> {
  const deadline = Date.now() + opts.timeoutMs;
  let sawTerminal: string | null = null;

  while (Date.now() < deadline) {
    const run = await prisma.scrapeRun.findUnique({
      where: { id: scrapeRunId },
      select: { status: true, failureCategory: true, jobCount: true },
    });

    if (!run) {
      return { status: "MISSING", failureCategory: null, jobCount: 0, defect: "the ScrapeRun row disappeared" };
    }

    if (run.status !== "IN_PROGRESS") {
      sawTerminal = run.status;
      // One more look, to catch a terminal status being written twice.
      await sleep(opts.pollMs);
      const again = await prisma.scrapeRun.findUnique({
        where: { id: scrapeRunId },
        select: { status: true, failureCategory: true, jobCount: true },
      });
      const defect =
        again && again.status === "IN_PROGRESS"
          ? `run flipped back to IN_PROGRESS after reaching ${sawTerminal}`
          : null;
      const final = again ?? run;
      return {
        status: final.status,
        failureCategory: final.failureCategory,
        jobCount: final.jobCount,
        defect,
      };
    }

    // The job may have died without closing its run.
    const job = await prisma.workerJob.findFirst({
      where: { scrapeRunId },
      select: { status: true },
    });
    if (job && (job.status === "FAILED" || job.status === "COMPLETED")) {
      // Give the handler a moment to write the run, then accept reality.
      await sleep(opts.pollMs);
      const run2 = await prisma.scrapeRun.findUnique({
        where: { id: scrapeRunId },
        select: { status: true, failureCategory: true, jobCount: true },
      });
      if (run2 && run2.status === "IN_PROGRESS") {
        return {
          status: "ABANDONED",
          failureCategory: "orphaned",
          jobCount: run2.jobCount,
          defect: `WorkerJob reached ${job.status} while its run stayed IN_PROGRESS`,
        };
      }
      if (run2) {
        return { status: run2.status, failureCategory: run2.failureCategory, jobCount: run2.jobCount, defect: null };
      }
    }

    await sleep(opts.pollMs);
  }

  return {
    status: "TIMED_OUT",
    failureCategory: "timeout",
    jobCount: 0,
    defect: `the sweep stopped waiting after ${Math.round(opts.timeoutMs / 60_000)}m`,
  };
}

async function siteSnapshot(siteId: string) {
  const [site, count, newest] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { status: true, siteUrl: true } }),
    prisma.job.count({ where: { siteId } }),
    prisma.job.findFirst({
      where: { siteId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    status: site?.status ?? "<gone>",
    siteUrl: site?.siteUrl ?? "",
    jobCount: count,
    newestJobAt: newest?.createdAt ?? null,
  };
}

async function runOneSite(site: { id: string; siteUrl: string }): Promise<SiteResult> {
  const startedAt = new Date();
  const before = await siteSnapshot(site.id);

  let scrapeRunId: string | null = null;
  let outcome = "ok";
  let failureCategory: string | null = null;
  let defect: string | null = null;

  try {
    const run = await createScrapeRun(site.id, { scheduled: true });
    scrapeRunId = run.id;
  } catch (err) {
    if (err instanceof ConflictError) {
      // An operator is mid-scrape on this site. Record it and move on — never
      // abort the sweep over one busy site.
      const after = await siteSnapshot(site.id);
      return {
        siteId: site.id,
        siteUrl: site.siteUrl,
        scrapeRunId: null,
        outcome: "skipped_conflict",
        failureCategory: null,
        jobsBefore: before.jobCount,
        jobsAfter: after.jobCount,
        newestJobAt: after.newestJobAt,
        siteStatus: after.status,
        wouldDemoteTo: null,
        wouldPromoteTo: null,
        startedAt,
        finishedAt: new Date(),
        defect: null,
      };
    }
    throw err;
  }

  const waited = await waitForRun(scrapeRunId, {
    timeoutMs: sweepConfig.perSiteTimeoutMinutes * 60_000,
    pollMs: sweepConfig.pollIntervalMs,
  });
  defect = waited.defect;
  failureCategory = waited.failureCategory;
  outcome = classifyOutcome({ status: waited.status, failureCategory: waited.failureCategory });

  // What the scheduled gate withheld, as recorded on the WorkerJob result.
  const job = await prisma.workerJob.findFirst({
    where: { scrapeRunId },
    select: { result: true, payload: true },
  });
  const result = (job?.result ?? {}) as Record<string, unknown>;
  const withheld = (result.withheld ?? {}) as Record<string, unknown>;

  if (job && !readScheduledFlag(job.payload)) {
    defect = defect ?? "the sweep's own job did not carry scheduled:true";
  }

  const after = await siteSnapshot(site.id);

  return {
    siteId: site.id,
    siteUrl: site.siteUrl,
    scrapeRunId,
    outcome,
    failureCategory,
    jobsBefore: before.jobCount,
    jobsAfter: after.jobCount,
    newestJobAt: after.newestJobAt,
    siteStatus: after.status,
    wouldDemoteTo: typeof withheld.wouldDemoteTo === "string" ? withheld.wouldDemoteTo : null,
    wouldPromoteTo: typeof withheld.wouldPromoteTo === "string" ? withheld.wouldPromoteTo : null,
    startedAt,
    finishedAt: new Date(),
    defect,
  };
}

// ---------------------------------------------------------------------------
// Dry run — READ ONLY
// ---------------------------------------------------------------------------

/**
 * Writes nothing. No WorkerJob, no ScrapeRun, no ScrapeSweep row, no site
 * change — not even the stale-sweep resolution, which is reported as "would
 * close" instead. It exists so the selection, the ordering and the pre-flight
 * verdicts can be read against production before anything is enqueued.
 */
async function dryRun(): Promise<number> {
  const now = new Date();
  log(`=== nightly sweep --dry-run (READ ONLY) ===`);
  log(`time         ${now.toISOString()}  (${sweepConfig.timezone})`);
  log(`enabled      ${sweepConfig.enabled}`);
  log(`fresh window ${sweepConfig.freshWindowHours}h`);
  log(`per-site cap ${sweepConfig.perSiteTimeoutMinutes}m, runtime cap ${sweepConfig.maxRuntimeMinutes}m`);
  log("");

  log("--- pre-flight (verdicts only; nothing is written) ---");

  const orphanCandidates = await prisma.scrapeRun.count({ where: { status: "IN_PROGRESS" } });
  log(`  IN_PROGRESS scrape runs: ${orphanCandidates}  (the reaper would inspect these)`);

  const staleSweeps = await resolveStaleSweeps(true);
  log(`  stale RUNNING sweeps:    ${staleSweeps}`);

  const queue = await readQueueState(null);
  const active = await prisma.workerJob.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } });
  log(`  active worker jobs:      ${active}`);
  log(
    `  newest IN_PROGRESS:      ${
      queue.newestInProgressAgeMs === null
        ? "none"
        : `${Math.round(queue.newestInProgressAgeMs / 60_000)}m ago`
    }`,
  );
  const wouldBe = assessDrain({
    newestInProgressAgeMs: queue.newestInProgressAgeMs,
    probeAtHeadOfQueue: active === 0,
    probeAtHeadForMs: 0,
    probeClaimed: false,
  });
  log(`  drain probe would start: ${wouldBe.verdict} — ${wouldBe.reason}`);
  log(
    `  (busy window ${BUSY_EVIDENCE_WINDOW_MS / 60_000}m, head-of-queue deadline ${HEAD_OF_QUEUE_DEADLINE_MS / 1000}s)`,
  );
  log("");

  const sites = await loadSelectableSites();
  const { selected, excluded } = selectSitesForSweep(sites, {
    now,
    freshWindowMs: sweepConfig.freshWindowHours * 3_600_000,
  });

  log(`--- selection: ${selected.length} of ${sites.length} ACTIVE/REVIEW sites ---`);
  log("   #  last attempt          last success          status  site");
  selected.forEach((s, i) => {
    const att = s.lastAttemptAt ? s.lastAttemptAt.toISOString().slice(0, 16) : "never           ";
    const suc = s.lastSuccessAt ? s.lastSuccessAt.toISOString().slice(0, 16) : "never           ";
    log(`  ${String(i + 1).padStart(3)}  ${att}      ${suc}      ${s.status.padEnd(6)}  ${s.siteUrl}`);
  });

  log("");
  log(`--- excluded: ${excluded.length} ---`);
  const byReason = new Map<string, number>();
  for (const e of excluded) {
    const key = e.reason.replace(/\d+h ago, inside the \d+h window/, "inside the fresh window");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(n).padStart(3)}  ${reason}`);
  }
  for (const e of excluded) {
    if (!e.reason.includes("window")) log(`       - ${e.site.siteUrl}: ${e.reason}`);
  }

  log("");
  log(`--- ordering: by last ATTEMPT, oldest first (never by last success) ---`);
  log(`--- nothing was written. Exiting. ---`);
  return 0;
}

// ---------------------------------------------------------------------------
// Real runs
// ---------------------------------------------------------------------------

async function realRun(mode: Mode): Promise<number> {
  if (!sweepConfig.enabled) {
    log("[sweep] SWEEP_ENABLED=false — refusing to run.");
    return 0;
  }

  const single = mode.kind === "single" ? mode.siteId : null;
  const now = new Date();

  log(`=== nightly sweep ${single ? `--site ${single}` : "--now"} ===`);

  // --- pre-flight ------------------------------------------------------
  const reaped = await reapOrphanedScrapeRuns(SWEEP_REAP_OPTIONS);
  if (reaped.reaped > 0) {
    log(`[sweep] reaped ${reaped.reaped} orphaned run(s) of ${reaped.scanned} scanned`);
    for (const d of reaped.details) log(`[sweep]   ${d.siteId}: ${d.reason}`);
  }
  const stale = await resolveStaleSweeps(false);
  if (stale > 0) log(`[sweep] closed ${stale} stale RUNNING sweep row(s) as abandoned`);

  const sweep = await prisma.scrapeSweep.create({
    data: {
      kind: "SCRAPE",
      trigger: single ? "manual-single" : "manual",
      status: "RUNNING",
      startedAt: now,
    },
  });
  log(`[sweep] sweep row ${sweep.id}`);

  // --- what to run -----------------------------------------------------
  let queue: SelectableSite[];
  if (single) {
    const all = await loadSelectableSites();
    const found = all.find((s) => s.id === single);
    if (!found) {
      await prisma.scrapeSweep.update({
        where: { id: sweep.id },
        data: { status: "FAILED", haltReason: `site ${single} not found or not ACTIVE/REVIEW`, finishedAt: new Date() },
      });
      log(`[sweep] site ${single} is not an ACTIVE/REVIEW site. Nothing to do.`);
      return 1;
    }
    // --site deliberately bypasses the freshness window — it is for verifying
    // one named site on demand, not for deciding what is due.
    queue = [found];
    log(`[sweep] single-site mode: ${found.siteUrl}`);
  } else {
    const { selected } = selectSitesForSweep(await loadSelectableSites(), {
      now,
      freshWindowMs: sweepConfig.freshWindowHours * 3_600_000,
    });
    queue = selected;
    log(`[sweep] selected ${queue.length} site(s)`);
  }

  await prisma.scrapeSweep.update({
    where: { id: sweep.id },
    data: { selectedCount: queue.length },
  });

  // --- the loop --------------------------------------------------------
  const results: SiteResult[] = [];
  const deadline = now.getTime() + sweepConfig.maxRuntimeMinutes * 60_000;

  for (const site of queue) {
    if (Date.now() > deadline) {
      log(`[sweep] runtime cap reached; ${queue.length - results.length} site(s) not reached`);
      break;
    }

    log(`[sweep] -> ${site.siteUrl}`);
    const result = await runOneSite(site);
    results.push(result);

    log(
      `[sweep] <- ${result.outcome}` +
        (result.failureCategory ? ` (${result.failureCategory})` : "") +
        ` jobs ${result.jobsBefore} -> ${result.jobsAfter}` +
        ` site ${result.siteStatus}` +
        (result.wouldPromoteTo ? ` WOULD PROMOTE -> ${result.wouldPromoteTo}` : "") +
        (result.wouldDemoteTo ? ` WOULD DEMOTE -> ${result.wouldDemoteTo}` : ""),
    );
    if (result.defect) log(`[sweep] !! DEFECT: ${result.defect}`);

    await prisma.scrapeSweepItem.create({
      data: {
        sweepId: sweep.id,
        siteId: result.siteId,
        phase: "scrape",
        scrapeRunId: result.scrapeRunId,
        outcome: result.outcome,
        failureCategory: result.failureCategory,
        jobsBefore: result.jobsBefore,
        jobsAfter: result.jobsAfter,
        newestJobAt: result.newestJobAt,
        siteStatus: result.siteStatus,
        wouldDemoteTo: result.wouldDemoteTo,
        wouldPromoteTo: result.wouldPromoteTo,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      },
    });

    // SEAM: the breaker (step 6) consumes `results` here and may halt.
  }

  // --- close out -------------------------------------------------------
  const ok = results.filter((r) => r.outcome === "success").length;
  const failed = results.filter((r) => r.outcome === "hard_failure").length;
  const soft = results.filter((r) => r.outcome === "soft_failure").length;
  const conflicts = results.filter((r) => r.outcome === "skipped_conflict").length;
  const protectedCount = results.filter(
    (r) => r.wouldDemoteTo || r.wouldPromoteTo,
  ).length;

  await prisma.scrapeSweep.update({
    where: { id: sweep.id },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      ok,
      failed,
      silentDrift: soft,
      skippedConflict: conflicts,
      wouldHaveDemoted: results.filter((r) => r.wouldDemoteTo).length,
      wouldHavePromoted: results.filter((r) => r.wouldPromoteTo).length,
      listingsProtected: protectedCount,
      // SEAM: `logText` is the rendered report (step 7).
    },
  });

  log("");
  log(`=== sweep ${sweep.id} complete ===`);
  log(`  ok ${ok}  hard ${failed}  soft ${soft}  conflicts ${conflicts}  protected ${protectedCount}`);
  return results.some((r) => r.defect) ? 1 : 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  const code = mode.kind === "dry-run" ? await dryRun() : await realRun(mode);
  await prisma.$disconnect();
  process.exit(code);
}

main().catch(async (err) => {
  console.error("[sweep] fatal:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
