// Run: npx tsx worker/lib/scheduledWriteGuard.test.ts
//
// scheduledRun.ts can be perfectly correct and still protect nothing, if a call
// site in scrape.ts writes to the Site row without asking it. That is not a
// hypothetical failure mode in this repo — the two listing wipes removed in the
// previous commit each looked correct in isolation and spread by copy-paste.
//
// So this asserts the wiring, not the rule: every site-mutating write in
// scrape.ts lives in one of three functions, and each of those three consults a
// decision before writing. It is a source-level guard because the behaviour
// needs a live database and a live browser to exercise, and nothing else in
// this repo can reach it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const SRC_PATH = join(__dirname, "..", "jobs", "scrape.ts");
const raw = readFileSync(SRC_PATH, "utf8");

// Strip comments so the prose in this file (which names deleteMany and
// site.update freely) can neither satisfy nor trip a check.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * A top-level function body, from its declaration to the first line that is a
 * lone `}` in column 0. The file is prettier-formatted, so that is exactly the
 * end of the function — and simple enough to be obviously right, which matters
 * more here than generality.
 */
function functionBody(name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^(async )?function ${name}\\(`).test(l));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && l === "}");
  if (end === -1) return "";
  return lines.slice(start, end + 1).join("\n");
}

const GATED = {
  applyActivationGate: functionBody("applyActivationGate"),
  skipSiteForApplyLogin: functionBody("skipSiteForApplyLogin"),
  failScrapeRun: functionBody("failScrapeRun"),
};

// If the extraction silently returned nothing, every assertion below would pass
// while checking air. This repo has shipped two tests that did exactly that.
for (const [name, body] of Object.entries(GATED)) {
  assert(body.length > 200, `${name}: the body was actually extracted (got ${body.length} chars)`);
  assert(
    body.includes("prisma.site.update") || body.includes("prisma.$transaction"),
    `${name}: the extracted body contains the write it is supposed to guard`,
  );
}

// --- each writer consults a decision ------------------------------------

assert(
  GATED.applyActivationGate.includes("planActivationGate") &&
    GATED.applyActivationGate.includes("decision.applySiteWrite"),
  "applyActivationGate asks planActivationGate before touching the site",
);
assert(
  GATED.applyActivationGate.includes("mayOverwriteAdminNote"),
  "applyActivationGate never replaces an operator's adminNote unasked",
);
assert(
  GATED.skipSiteForApplyLogin.includes("planApplyLoginSkip") &&
    GATED.skipSiteForApplyLogin.includes("decision.applySiteWrite"),
  "skipSiteForApplyLogin asks before moving a site to SKIPPED",
);
assert(
  GATED.failScrapeRun.includes("planScrapeFailure") &&
    GATED.failScrapeRun.includes("decision.applySiteWrite") &&
    GATED.failScrapeRun.includes("decision.deleteListings"),
  "failScrapeRun asks before setting FAILED and before deleting listings",
);

{
  // The ScrapeRun row is the ONLY thing the sweep driver reads to decide
  // whether a site failed and why. Gating a site write is the point; gating the
  // record of the failure would make the whole night's report blank — every
  // withheld failure would look like a run that never finished.
  //
  // Asserted positionally: the run update must come before the site gate, not
  // inside it.
  const body = GATED.failScrapeRun;
  const runUpdate = body.indexOf("prisma.scrapeRun.update(");
  const siteGate = body.indexOf("if (decision.applySiteWrite)");
  assert(runUpdate >= 0, "failScrapeRun closes the ScrapeRun");
  assert(siteGate >= 0, "failScrapeRun gates its site write");
  assert(
    runUpdate < siteGate,
    "the ScrapeRun is closed FAILED before — and regardless of — the site gate",
  );
  const closing = body.slice(runUpdate, siteGate);
  assert(
    /status: "FAILED"/.test(closing) &&
      /failureCategory: details\.failureCategory/.test(closing) &&
      /completedAt/.test(closing),
    "and it carries status, failureCategory and completedAt — everything the driver reads",
  );
}

// --- and nothing else writes to a site ----------------------------------

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

{
  // The whole point. If a fourth site write appears anywhere in scrape.ts, it
  // is ungated until someone comes here and says otherwise.
  const inFile = countOf(src, "prisma.site.update(");
  const inGuarded = Object.values(GATED).reduce(
    (n, body) => n + countOf(body, "prisma.site.update("),
    0,
  );
  assert(
    inFile === inGuarded,
    `every prisma.site.update in scrape.ts is inside a gated function ` +
      `(${inFile} in the file, ${inGuarded} inside the three)`,
  );
  assert(inGuarded > 0, "and there is at least one to guard, so this is not vacuous");
}

{
  // Listing deletes. Two are legitimate: the manual chunked path, and the
  // gated one in failScrapeRun. The scheduled path's delete uses `tx.` because
  // it must be inside the atomic transaction — a `prisma.` delete there would
  // commit on its own and defeat the whole rollback guarantee.
  const bareDeletes = countOf(src, "prisma.job.deleteMany(");
  const inFailScrapeRun = countOf(GATED.failScrapeRun, "prisma.job.deleteMany(");
  assert(
    bareDeletes === inFailScrapeRun + 1,
    `only the manual path and failScrapeRun delete listings outside a transaction ` +
      `(found ${bareDeletes})`,
  );
  assert(
    countOf(src, "tx.job.deleteMany(") === 1,
    "the scheduled delete happens exactly once, inside the transaction",
  );
}

{
  // The activation gate returns ACTIVE on its own internal error, so an
  // ungated call site could promote a site to the public jobs site from a
  // failure path. It must be reachable through applyActivationGate only.
  const calls = countOf(src, "decideActivationStatus(") - countOf(src, "function decideActivationStatus(");
  assert(
    calls === 1 && GATED.applyActivationGate.includes("decideActivationStatus("),
    `decideActivationStatus has exactly one call site, inside applyActivationGate (found ${calls})`,
  );
}

// --- the atomic path stays atomic ---------------------------------------

assert(
  /tx\.job\.createMany\(/.test(src),
  "the scheduled path inserts with createMany inside the transaction",
);
assert(
  /timeout: TX_TIMEOUT_MS/.test(src) && /maxWait: TX_MAX_WAIT_MS/.test(src),
  "the transaction carries an explicit budget — Prisma's 5s default fails on the largest site",
);
{
  // PARTIAL is a promise the scheduled path cannot keep: its jobCount is
  // written only inside the transaction, so a run is either fully committed or
  // fully rolled back. Both PARTIAL writers must therefore be behind the same
  // explicit guard — asserted as a pairing, because "it is unreachable anyway"
  // is the kind of reasoning that quietly stops being true.
  const partialWrites = countOf(src, 'status: "PARTIAL"');
  const guards = countOf(src, "savedJobs > 0 && !scheduled");
  assert(partialWrites > 0, "there are PARTIAL writers to check");
  assert(
    partialWrites === guards,
    `every PARTIAL write is behind a !scheduled guard ` +
      `(${partialWrites} writes, ${guards} guards)`,
  );
}

// --- one writer of terminal state ---------------------------------------

assert(
  /requestAbort\(/.test(src) && /outcome === "deferred"/.test(src),
  "the timeout handler asks the abort token before writing a terminal status",
);
assert(
  /beginCommit\(/.test(src),
  "the scheduled transaction opens the commit window, so the handler can defer to it",
);
assert(
  /awaitCommit\(/.test(src),
  "and the catch block defers to the transaction too — the belt to the handler's braces",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("scheduledWriteGuard: every site write in scrape.ts is gated");
