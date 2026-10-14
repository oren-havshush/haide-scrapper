// Run: npx tsx scripts/lib/triageRules.test.ts
//
// H5 (owner, 2026-10-14), triage:
//   - a 200 page carrying a known block wording (F5's "Request Rejected", L.M.)
//     is blocked, and is retried once with the browser identity before any
//     "reachable" verdict;
//   - one timeout is retried before it decides needsUaOverride (Data Pool);
//   - the WordPress job post type is recognised by a word list (TOP BIT's
//     "vacancies"), not by the word "job" alone.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyResponse } from "./challenge-detect";
import { JOB_POST_TYPE_WORDS, reachWithRetry, wpJobPostType, type ReachNav } from "./triageRules";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// L.M.'s F5 answer to a headless browser: HTTP 200, with a link back.
const F5 =
  "<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.<br><br>" +
  "Your support ID is: 1234567890123456789<br><br><a href='javascript:history.back();'>[Go Back]</a></body></html>";
const LISTING = `<html><body>${"<a href='/job/1'>משרה</a>".repeat(40)}<p>request a callback</p></body></html>`;

{
  const v = classifyResponse(F5, 200);
  assert(v.challenged && v.reason === "block-text", `F5's 200 "Request Rejected" page is a block page (got ${JSON.stringify(v)})`);
  for (const phrase of ["The requested URL was rejected", "Please consult with your administrator", "Your support ID is: 9"]) {
    assert(classifyResponse(`<html><body><a href="/">x</a>${phrase}</body></html>`, 200).challenged, `"${phrase}" alone is the same family`);
  }
  assert(!classifyResponse(LISTING, 200).challenged, "an ordinary listing is not");
}

/**
 * A nav that answers from a script, one entry per call. A call the script did
 * not expect fails like a dead page and is recorded, so the calls assertion
 * names it.
 */
function scripted(steps: Array<[kind: "bare" | "real", out: Partial<ReachNav>]>) {
  const calls: string[] = [];
  const nav = async (kind: "bare" | "real"): Promise<ReachNav> => {
    const step = steps[0]?.[0] === kind ? steps.shift() : undefined;
    calls.push(step ? kind : `${kind}(unexpected)`);
    return { ok: false, html: "", htmlLen: 0, ...(step?.[1] ?? { error: "unexpected call" }) };
  };
  return { nav, calls };
}

(async () => {
  {
    // L.M.: blocked bare, read with the browser identity.
    const s = scripted([["bare", { ok: false, challenged: true, challengeReason: "block-text", html: F5 }], ["real", { ok: true, html: LISTING }]]);
    const r = await reachWithRetry(s.nav);
    assert(r.reachable && r.needsUaOverride, "a blocked bare page is retried with the browser identity, and needs the override");
    assert(s.calls.join(",") === "bare,real", `a block is not retried bare (calls ${s.calls.join(",")})`);
    assert(r.html === LISTING, "the page read is the browser identity's, not the block page");
  }
  {
    // Data Pool: one timeout, then a bare read.
    const s = scripted([["bare", { ok: false, error: "page.goto: Timeout 15000ms exceeded." }], ["bare", { ok: true, html: LISTING }]]);
    const r = await reachWithRetry(s.nav);
    assert(r.reachable && !r.needsUaOverride && r.bareRetried, "one timeout is retried bare and decides no override");
    assert(s.calls.join(",") === "bare,bare", `the browser identity is not tried (calls ${s.calls.join(",")})`);
  }
  {
    const s = scripted([["bare", { ok: false, error: "Timeout" }], ["bare", { ok: false, error: "Timeout" }], ["real", { ok: true, html: LISTING }]]);
    const r = await reachWithRetry(s.nav);
    assert(r.reachable && r.needsUaOverride, "two bare timeouts and a browser-identity read: the override is needed");
  }
  {
    const s = scripted([["bare", { ok: true, html: LISTING }]]);
    const r = await reachWithRetry(s.nav);
    assert(r.reachable && !r.needsUaOverride && s.calls.length === 1 && r.real === null, "a clean bare read decides at once");
  }
  {
    const s = scripted([["bare", { ok: false, challenged: true }], ["real", { ok: false, challenged: true }]]);
    const r = await reachWithRetry(s.nav);
    assert(!r.reachable && !r.needsUaOverride, "blocked both ways: unreachable");
  }

  // The WordPress job post type.
  assert(wpJobPostType('<body class="vacancies-template-default single single-vacancies postid-9">') === "vacancies", "TOP BIT: single-vacancies is a job post type");
  assert(wpJobPostType('<a href="https://topbit.co.il/vacancies/devops-engineer/">DevOps</a>') === "vacancies", "and so is a link to /vacancies/<slug>");
  for (const w of JOB_POST_TYPE_WORDS) {
    assert(wpJobPostType(`<a href="https://x.example/${w}/some-post/">a</a>`) === w, `the word ${w}, by its link`);
    assert(wpJobPostType(`<body class="single-${w} postid-1">`) === w, `the word ${w}, by its body class`);
  }
  assert(wpJobPostType('<a href="https://x.example/careers/">Careers</a>') === null, "the careers page itself is not a post");
  assert(wpJobPostType('<body class="type-jobsearch">') === null && wpJobPostType('<a href="/blog/jobsite-tips">') === null, "a word inside another word is not");
  assert(wpJobPostType("<body class=\"page-template-default\">") === null, "a plain page is not");

  // The wiring in addsite-batch.ts.
  const src = readFileSync(join(__dirname, "..", "addsite-batch.ts"), "utf8");
  const body = (name: string) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf("\nasync function ", src.indexOf(`async function ${name}(`) + 10));
  for (const name of ["cmdReach", "cmdTriage"]) {
    const b = body(name);
    assert(/reachWithRetry\(/.test(b), `${name} decides reachability through reachWithRetry`);
    assert(!/tryNav\(chromium, url, \{\}\)/.test(b), `${name} has no bare navigation of its own left`);
  }
  assert(!/\\\/job\\\/\[/.test(src) && !/single-job\\b/.test(src), "the job-only post-type regexes are gone");
  assert((src.match(/wpJobPostType\(/g) ?? []).length === 2, "the triage and fingerprint checks both use the word list");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("triageRules: F5's block page is blocked, one timeout is retried, a job post type by its word list");
})();
