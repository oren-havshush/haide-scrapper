// Run: npx tsx worker/lib/ajaxWalk.test.ts
//
// The ajax listing mode (big-lane design, item 4), with a fake fetch: a walk
// to the empty page counts every page; a page failing twice stops the walk as
// "failed", which the pagination guard refuses; a page failing once is retried
// and the walk passes; at most 4 calls are in flight; each call waits the
// site's delay; the template needs {n} and the site's host; the schema takes
// the mode, and scrape.ts walks it before extracting.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AJAX_MAX_CONCURRENCY, ajaxPageUrl, ajaxTemplateError, ajaxWalk, type AjaxDeps, type AjaxPaginationConfig } from "./ajaxWalk";
import { isPaginationTruncated, isTruncatedWalk, newPaginationWalk } from "./paginationGuard";
import { updateSiteConfigSchema } from "../../src/lib/validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
async function check(name: string, body: () => Promise<void> | void) {
  try {
    await body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const TEMPLATE = "https://www.example.co.il/wp-admin/admin-ajax.php?action=list&pg={n}";
const cfg = (over: Partial<AjaxPaginationConfig> = {}): AjaxPaginationConfig => ({
  type: "ajax",
  urlTemplate: TEMPLATE,
  start: 1,
  maxPages: 300,
  concurrency: 4,
  containerSelector: "#list",
  settleMs: 500,
  ...over,
});

/** A fake endpoint: pages 1..last hold 10 blocks each, then empty; `fail` maps page -> failures left. */
function fakeSite(last: number, fail: Map<number, number> = new Map(), delayMs = 0) {
  const calls: number[] = [];
  const paced: number[] = [];
  const appended: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let clock = 0;
  const deps: AjaxDeps = {
    async fetchPage(url) {
      const n = Number(new URL(url).searchParams.get("pg"));
      calls.push(n);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const left = fail.get(n) ?? 0;
      if (left > 0) {
        fail.set(n, left - 1);
        return { ok: false, blocks: 0, html: "" };
      }
      return n <= last ? { ok: true, blocks: 10, html: `<div class="job">p${n}</div>` } : { ok: true, blocks: 0, html: "" };
    },
    async appendPage(html) {
      appended.push(html);
    },
    async pace() {
      clock += delayMs;
      paced.push(clock);
    },
    aborted: () => false,
  };
  return { deps, calls, paced, appended, max: () => maxInFlight };
}

async function main() {
  await check("pages 1..253 then empty", async () => {
    const site = fakeSite(253);
    const walk = newPaginationWalk();
    await ajaxWalk(cfg(), site.deps, walk);
    assert(walk.pageCounts.length === 253, `253 pages counted (got ${walk.pageCounts.length})`);
    assert(walk.stoppedBy === "end", `stopped at the empty page (got ${walk.stoppedBy})`);
    assert(site.appended.length === 253 && site.appended[252] === `<div class="job">p253</div>`, "every page appended, in order");
    assert(!isTruncatedWalk(walk), "a complete walk is not truncated");
  });

  await check("a page failing twice", async () => {
    const site = fakeSite(253, new Map([[120, 2]]));
    const walk = newPaginationWalk();
    await ajaxWalk(cfg(), site.deps, walk);
    assert(walk.stoppedBy === "failed", `the walk stops as failed (got ${walk.stoppedBy})`);
    assert(walk.pageCounts.length === 119, `with 119 pages (got ${walk.pageCounts.length})`);
    assert(isTruncatedWalk(walk), "which is a truncated walk");
    assert(isPaginationTruncated([walk], 0), "and refuses a scheduled persist");
  });

  await check("a page failing once", async () => {
    const site = fakeSite(253, new Map([[120, 1]]));
    const walk = newPaginationWalk();
    await ajaxWalk(cfg(), site.deps, walk);
    assert(walk.stoppedBy === "end" && walk.pageCounts.length === 253, `retried, and the walk passes (got ${walk.stoppedBy}, ${walk.pageCounts.length})`);
    assert(site.calls.filter((n) => n === 120).length === 2, "page 120 was called twice");
  });

  await check("concurrency", async () => {
    const site = fakeSite(40);
    await ajaxWalk(cfg({ concurrency: 9 }), site.deps, newPaginationWalk());
    assert(site.max() <= AJAX_MAX_CONCURRENCY && AJAX_MAX_CONCURRENCY === 4, `never more than 4 in flight (got ${site.max()})`);
    const one = fakeSite(10);
    await ajaxWalk(cfg({ concurrency: 1 }), one.deps, newPaginationWalk());
    assert(one.max() === 1, `concurrency 1 is one at a time (got ${one.max()})`);
  });

  await check("spacing", async () => {
    const site = fakeSite(8, new Map(), 1500);
    await ajaxWalk(cfg(), site.deps, newPaginationWalk());
    assert(site.paced.length === site.calls.length, `every call waited first (${site.paced.length} waits, ${site.calls.length} calls)`);
    const gaps = site.paced.slice(1).map((t, i) => t - site.paced[i]!);
    assert(gaps.every((g) => g === 1500), "each the site's delay apart");
  });

  await check("a container that is gone", async () => {
    const site = fakeSite(253);
    const walk = newPaginationWalk();
    await ajaxWalk(cfg(), { ...site.deps, appendPage: async () => { throw new Error("ajax container #list not found"); } }, walk);
    assert(walk.stoppedBy === "failed" && isTruncatedWalk(walk), `stops as failed, refused (got ${walk.stoppedBy})`);
  });

  await check("maxPages and abort", async () => {
    const site = fakeSite(253);
    const walk = newPaginationWalk();
    await ajaxWalk(cfg({ maxPages: 10 }), site.deps, walk);
    assert(walk.stoppedBy === "maxPages" && walk.pageCounts.length === 10, "the config's bound");
    const stopped = newPaginationWalk();
    await ajaxWalk(cfg(), { ...fakeSite(253).deps, aborted: () => true }, stopped);
    assert(stopped.stoppedBy === "aborted", "the deadline stops it");
  });

  await check("the template", () => {
    assert(ajaxPageUrl(TEMPLATE, 7).endsWith("pg=7"), "{n} is the page number");
    assert(ajaxTemplateError(TEMPLATE, "https://www.example.co.il/jobs") === null, "on the site's host: accepted");
    assert(/must contain \{n\}/.test(ajaxTemplateError("https://www.example.co.il/x?pg=1", "https://www.example.co.il/") ?? ""), "without {n}: refused");
    assert(/not the site's host/.test(ajaxTemplateError("https://api.other.com/x?pg={n}", "https://www.example.co.il/") ?? ""), "off-host: refused");
    assert(/http\(s\)/.test(ajaxTemplateError("ftp://www.example.co.il/x?pg={n}", "https://www.example.co.il/") ?? ""), "not http(s): refused");
  });

  await check("the schema", () => {
    const base = { fieldMappings: {}, pageFlow: [], formCapture: null };
    const ok = (p: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      updateSiteConfigSchema.safeParse({ ...base, ...extra, pagination: p }).success;
    const ajax = { type: "ajax", urlTemplate: TEMPLATE, containerSelector: "#list" };
    assert(ok(ajax), "the ajax mode is accepted");
    assert(ok({ ...ajax, concurrency: 4, start: 1, settleMs: 800 }), "with its options");
    assert(!ok({ ...ajax, concurrency: 5 }), "concurrency above 4 is refused");
    assert(!ok({ ...ajax, urlTemplate: "https://www.example.co.il/x?pg=1" }), "a template without {n} is refused");
    assert(!ok({ type: "ajax", urlTemplate: TEMPLATE }), "a container is required");
    assert(!ok({ ...ajax, maxPages: 253 }), "253 pages need limits.maxPages");
    assert(ok({ ...ajax, maxPages: 253 }, { lane: "big", limits: { maxPages: 300 } }), "and are accepted with it");
  });

  const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*$/gm, "");
  const read = (...p: string[]) => strip(readFileSync(join(__dirname, "..", "..", ...p), "utf8"));
  await check("the wiring", () => {
    const scrape = read("worker", "jobs", "scrape.ts");
    const pag = scrape.slice(scrape.indexOf("function getPaginationConfig"), scrape.indexOf("function buildPaginatedUrl"));
    assert(/p\["type"\] === "ajax"/.test(pag), "getPaginationConfig reads the ajax mode");
    assert(/async function runAjaxWalk\(/.test(scrape), "scrape.ts has the page side of the walk");
    const runner = scrape.slice(scrape.indexOf("async function runAjaxWalk("));
    assert(/credentials: "include"/.test(runner), "it calls from the page's own context, with its cookies");
    assert(/beforeClickLoad\(page, "pagination"\)/.test(runner), "paced by the site's request delay");
    assert(/data-ajax-src/.test(runner) && /data-ajax-srcset/.test(runner), "appended pages load no images (src and srcset set aside)");
    assert(/walks\?\.push\(walk\)/.test(runner), "and its walk is judged by the pagination guard");
    assert((scrape.match(/await runAjaxWalk\(/g) ?? []).length >= 2, "both listing paths walk it (single-page and page-flow)");
    const service = read("src", "services", "siteService.ts");
    assert(/ajaxTemplateError\(/.test(service), "saveSiteConfig checks the template's host");
    const guard = read("worker", "lib", "paginationGuard.ts");
    assert(/"failed"/.test(guard), "the guard knows a failed walk");
  });

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("ajaxWalk: all passed");
}

main();
