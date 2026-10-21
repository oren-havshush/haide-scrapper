// Run: npx tsx scripts/lib/setupDryRun.test.ts
//
// Report fixes 3, item 16b: the setup-script dry run (scripts/lib/setupDryRun.ts)
// against a loopback server (127.0.0.1, nothing leaves the machine) that logs
// which requests carried a cookie. The script fetches one URL with
// credentials "omit" and one without, and tries a POST.
//   - the cookie count reads allHeaders(): the planted cookie is seen on the
//     navigation, and the fetch that sent cookies is told apart from the one
//     that did not, as the server saw them;
//   - a POST is aborted and logged, and never reaches the server;
//   - a failure filter aborts what it names, and a failure run that aborted
//     nothing fails;
//   - the records are the worker's: extraction, validation, id fallback.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const SCRIPT = `
  await fetch("/api/omit", { credentials: "omit" });
  await fetch("/api/with");
  await fetch("/api/post", { method: "POST", body: "x" }).catch(() => {});
  const a = document.createElement("div");
  a.className = "job";
  a.innerHTML = '<h2><a href="/jobs/3">Warehouse Worker</a></h2>';
  document.querySelector(".jobs").appendChild(a);
`;
const PAGE = `<!doctype html><html><body><div class="jobs">
  <div class="job"><h2><a href="/jobs/1">Data Engineer</a></h2></div>
  <div class="job"><h2><a href="/jobs/2">QA Lead</a></h2></div>
  <div class="job"><h2><a href="/jobs/4"></a></h2></div>
</div></body></html>`;

(async () => {
  const seen: Array<{ method: string; path: string; cookie: boolean }> = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? "", path: req.url ?? "", cookie: !!req.headers.cookie });
    if ((req.url ?? "").startsWith("/api/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fieldMappings = {
    title: { selector: "h2", source: "MANUAL", confidence: 100 },
    title_href: { selector: "h2 a", source: "MANUAL", confidence: 100, extractAttr: "href" },
    _meta: { itemSelector: ".job", setupScript: SCRIPT },
  };

  const { setupScriptDryRun, dryRunVerdict, PLANTED_COOKIE } = await import("./setupDryRun");
  const browser = await chromium.launch();
  try {
    // --- the plain run --------------------------------------------------------------------------
    {
      const page = await (await browser.newContext()).newPage();
      seen.length = 0;
      const r = await setupScriptDryRun(page, { listingUrl: `${base}/careers`, fieldMappings, setupScript: SCRIPT });
      assert(r.cookies.navigations >= 1 && r.cookies.navigationsWithCookie === r.cookies.navigations, `the planted cookie is counted on the navigation (got ${r.cookies.navigationsWithCookie}/${r.cookies.navigations})`);
      assert(r.cookies.fetches === 2 && r.cookies.fetchesWithCookie === 1, `two fetches, one with a cookie (got ${r.cookies.fetchesWithCookie}/${r.cookies.fetches})`);
      assert(r.cookies.fetchUrlsWithCookie.length === 1 && r.cookies.fetchUrlsWithCookie[0]!.endsWith("/api/with"), `the one that sent it is named (got ${JSON.stringify(r.cookies.fetchUrlsWithCookie)})`);
      const server1 = (p: string) => seen.find((s) => s.path === p);
      assert(server1("/api/omit")?.cookie === false && server1("/api/with")?.cookie === true, "and the server saw the same");
      assert(r.aborted.some((a) => a.method === "POST" && a.why === "not GET") && !seen.some((s) => s.method === "POST"), "the POST was aborted and logged, and never reached the server");
      assert(r.script === "ran", `the script ran (got ${r.script})`);
      assert(r.records === 4 && r.valid === 3, `the worker's records: 4 read, 3 with a title (got ${r.records}/${r.valid})`);
      assert(r.ids.every((i) => i.kind === "synthesised" && /^h-/.test(i.id ?? "")), "no id on the page: the worker's h- ids");
      assert(r.verdict.ok, `a clean run passes (${r.verdict.problems.join("; ")})`);
    }
    // --- a failure run ------------------------------------------------------------------------------
    {
      const page = await (await browser.newContext()).newPage();
      const r = await setupScriptDryRun(page, { listingUrl: `${base}/careers`, fieldMappings, setupScript: SCRIPT, failFilter: "/api/with" });
      assert(r.aborted.some((a) => a.why === "failure filter" && a.url.endsWith("/api/with")), "the filter aborts what it names, logged");
      assert(r.verdict.ok, "and the run passes");
      const page2 = await (await browser.newContext()).newPage();
      const none = await setupScriptDryRun(page2, { listingUrl: `${base}/careers`, fieldMappings, setupScript: SCRIPT, failFilter: "C:/Program Files/Git/noc/" });
      assert(!none.verdict.ok && /aborted nothing/.test(none.verdict.problems.join(" ")), `a failure run that aborted nothing fails (got ${JSON.stringify(none.verdict)})`);
    }
    // --- the verdict alone: no cookie on any navigation means the count is broken ----------------------
    {
      const v = dryRunVerdict({ cookies: { planted: PLANTED_COOKIE, navigationsWithCookie: 0, navigations: 2, fetchesWithCookie: 0, fetches: 3, fetchUrlsWithCookie: [] }, aborted: [] });
      assert(!v.ok && /does not work/.test(v.problems[0] ?? ""), "a planted cookie seen nowhere fails the run");
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("setupDryRun: cookies counted with allHeaders and proved by a planted one; non-GETs and filtered requests aborted and logged; the worker's records");
})().catch((e) => {
  console.error(`FAIL: setupDryRun test threw — ${(e as Error).message}`);
  process.exit(1);
});
