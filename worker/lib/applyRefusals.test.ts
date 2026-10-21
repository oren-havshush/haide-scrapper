// Run: npx tsx worker/lib/applyRefusals.test.ts
//
// Report fixes 3, item 17: the daily reader of the public site's apply
// refusals (worker/lib/applyRefusals.ts). Nothing here touches the network,
// the real endpoint or the database: the fetch, the wait and the store are
// stubs.
//   - the parser on a fixture body, an unknown code reported and ignored;
//   - a 502 then a 200 (one retry after 60 s), a 502 twice (unavailable, the
//     store untouched), no token (not configured, nothing fetched);
//   - matching by externalJobId AND host, with one id on two sites;
//   - open, keep, resolve over three consecutive lists, and the empty list
//     resolving everything;
//   - the report section's text; the wiring into the policy sweep and compose.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// The fixture body, in the public site's shape (their note of 2026-10-21).
const BODY = {
  success: true,
  data: [
    { code: "job_id_synthesised", externalJobId: "h-2k9c1", jobUrl: "https://www.callbiz.co.il/jobs/rep", firstSeen: "2026-10-20T04:10:00Z", lastSeen: "2026-10-21T04:12:00Z" },
    { code: "job_field_unfillable", externalJobId: "4410", jobUrl: "https://careers.acme.co.il/job/4410", field: "idNumber", firstSeen: "2026-10-19T04:00:00Z", lastSeen: "2026-10-21T04:00:00Z" },
    { code: "job_id_missing", externalJobId: "777", jobUrl: "https://www.gone.co.il/job/777", firstSeen: "2026-10-18T04:00:00Z", lastSeen: "2026-10-21T04:00:00Z" },
    { code: "job_future_code", externalJobId: "1", jobUrl: "https://x.co.il/1", firstSeen: "", lastSeen: "" },
  ],
  meta: { total: 4, generatedAt: "2026-10-21T04:15:00Z" },
};
const ENV = { PUBLIC_SITE_REFUSALS_TOKEN: "test-token-not-real" };
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

(async () => {
  const m = await import("./applyRefusals");

  // --- config ---------------------------------------------------------------------------------
  assert(m.refusalsConfig({}).token === null && m.refusalsConfig({}).url === m.DEFAULT_REFUSALS_URL, "no token: unset; the URL defaults");
  assert(m.refusalsConfig({ PUBLIC_SITE_REFUSALS_URL: "https://x.test/r", PUBLIC_SITE_REFUSALS_TOKEN: " t " }).token === "t", "the token is trimmed");

  // --- the parser ---------------------------------------------------------------------------------
  {
    const p = m.parseRefusalsBody(BODY);
    assert(p.ok && p.rows.length === 3 && p.unknown.length === 1 && p.unknown[0]?.code === "job_future_code", "three rows, the unknown code reported and ignored");
    assert(p.ok && p.rows[1]?.field === "idNumber" && p.rows[0]?.field === undefined, "field only where the row has one");
    assert(!m.parseRefusalsBody({ success: false, data: [] }).ok && !m.parseRefusalsBody({ success: true }).ok && !m.parseRefusalsBody("x").ok, "success false, no data, not an object: not a list");
  }

  // --- the read: retry, unavailable, not configured -------------------------------------------------
  {
    const waits: number[] = [];
    const answers = [respond(502, { error: "bad gateway" }), respond(200, BODY)];
    let calls = 0;
    const r = await m.readRefusals({ env: ENV, fetch: (async () => answers[calls++]!) as typeof fetch, sleep: async (ms) => void waits.push(ms) });
    assert(r.status === "ok" && calls === 2 && JSON.stringify(waits) === "[60000]", `a 502 then a 200: one retry after 60 s (got ${r.status}, ${calls} calls, waits ${JSON.stringify(waits)})`);
    calls = 0;
    const twice = await m.readRefusals({ env: ENV, fetch: (async () => { calls++; return respond(502, {}); }) as typeof fetch, sleep: async () => {} });
    assert(twice.status === "unavailable" && calls === 2 && /502/.test(twice.status === "unavailable" ? twice.detail : ""), "a 502 twice: unavailable, with the status");
    const thrown = await m.readRefusals({ env: ENV, fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch, sleep: async () => {} });
    assert(thrown.status === "unavailable", "a network error: unavailable");
    let fetched = false;
    const off = await m.readRefusals({ env: {}, fetch: (async () => { fetched = true; return respond(200, BODY); }) as typeof fetch });
    assert(off.status === "not_configured" && !fetched, "no token: not configured, nothing fetched");
  }

  // --- matching by id AND host ------------------------------------------------------------------------
  {
    const row = { code: "job_field_unfillable" as const, externalJobId: "4410", jobUrl: "https://careers.acme.co.il/job/4410", firstSeen: "", lastSeen: "" };
    const acme = { siteId: "site-acme", externalJobId: "4410", siteHosts: new Set(["acme.co.il", "careers.acme.co.il"]) };
    const other = { siteId: "site-other", externalJobId: "4410", siteHosts: new Set(["other.co.il"]) };
    assert(m.matchRefusal(row, [acme, other]) === "site-acme", "the same id on two sites: the host decides");
    assert(m.matchRefusal({ ...row, jobUrl: "https://www.careers.acme.co.il/job/4410" }, [acme]) === "site-acme", "www. ignored");
    const twin = { ...other, siteHosts: new Set(["careers.acme.co.il"]) };
    assert(m.matchRefusal(row, [acme, twin]) === null, "two sites on one host with that id: unmatched");
    assert(m.matchRefusal(row, [other]) === null && m.matchRefusal(row, []) === null, "no site on that host, or the job gone: unmatched");
  }

  // --- open, keep, resolve over three lists, then the empty list ---------------------------------------
  {
    type Item = { id: string; siteId: string; code: string; jobIds: unknown; detail: string; resolved?: string };
    const items: Item[] = [];
    let n = 0;
    const store = {
      async candidates(ids: string[]) {
        const all = [
          { siteId: "site-callbiz", externalJobId: "h-2k9c1", siteHosts: new Set(["callbiz.co.il"]) },
          { siteId: "site-acme", externalJobId: "4410", siteHosts: new Set(["careers.acme.co.il"]) },
          { siteId: "site-acme", externalJobId: "4411", siteHosts: new Set(["careers.acme.co.il"]) },
        ];
        return all.filter((c) => ids.includes(c.externalJobId));
      },
      async openReaderItems() {
        return items.filter((i) => !i.resolved);
      },
      async openItem(i: { siteId: string; code: string; externalJobId: string; detail: string }) {
        items.push({ id: `it${++n}`, siteId: i.siteId, code: i.code, jobIds: [i.externalJobId], detail: i.detail });
      },
      async keepItem(i: { id: string; detail: string }) {
        items.find((x) => x.id === i.id)!.detail = i.detail;
      },
      async resolveItems(ids: string[]) {
        for (const id of ids) items.find((x) => x.id === id)!.resolved = m.LEFT_THE_LIST;
      },
    };
    const run = (body: unknown) => m.runApplyRefusals(store, { env: ENV, fetch: (async () => respond(200, body)) as typeof fetch, sleep: async () => {} });

    const first = await run(BODY);
    assert(first.opened === 2 && items.length === 2, `night 1: two items opened (got ${first.opened})`);
    assert(items.every((i) => i.code.startsWith(m.READER_CODE_PREFIX)), "each with the reader's mark");
    assert(/field idNumber/.test(items.find((i) => i.siteId === "site-acme")!.detail), "the field named in the item");
    assert(first.missing.length === 1 && first.unmatched.length === 0, "job_id_missing counted and listed, no item");

    const night2 = { ...BODY, data: [{ ...BODY.data[1]!, lastSeen: "2026-10-22T04:00:00Z" }, { code: "job_field_unfillable", externalJobId: "4411", jobUrl: "https://careers.acme.co.il/job/4411", field: "city", firstSeen: "2026-10-22T04:00:00Z", lastSeen: "2026-10-22T04:00:00Z" }] };
    const second = await run(night2);
    assert(second.kept === 1 && second.opened === 1 && second.resolved === 1, `night 2: one kept, one opened, one resolved (got kept ${second.kept}, opened ${second.opened}, resolved ${second.resolved})`);
    assert(/last seen 2026-10-22/.test(items.find((i) => (i.jobIds as string[])[0] === "4410")!.detail), "the kept item's lastSeen updated");
    assert(items.filter((i) => (i.jobIds as string[])[0] === "4410").length === 1, "never duplicated");
    assert(items.find((i) => (i.jobIds as string[])[0] === "h-2k9c1")!.resolved === m.LEFT_THE_LIST, "the gone row's item resolved, left the list");

    const third = await run(night2);
    assert(third.kept === 2 && third.opened === 0 && third.resolved === 0, "night 3, the same list: both kept, nothing new");

    const unavailable = await m.runApplyRefusals(store, { env: ENV, fetch: (async () => respond(502, {})) as typeof fetch, sleep: async () => {} });
    assert(unavailable.read.status === "unavailable" && items.filter((i) => !i.resolved).length === 2, "an unavailable night changes nothing");

    const empty = await run({ success: true, data: [], meta: { total: 0 } });
    assert(empty.resolved === 2 && items.every((i) => i.resolved), "an empty list resolves every open item");

    // --- the report section -------------------------------------------------------------------------
    const text = m.renderRefusalsSection(first).join("\n");
    assert(
      text ===
        [
          "Apply refusals",
          "  endpoint ok: rows 3",
          "  items opened 2, resolved 0, kept 0",
          "  job_id_missing 1",
          "    777  gone.co.il",
          "  unmatched 0",
          "  unknown codes job_future_code (1)",
        ].join("\n"),
      `the section (got:\n${text})`,
    );
    assert(m.renderRefusalsSection(unavailable).join("\n") === "Apply refusals\n  endpoint unavailable (HTTP 502), after one retry: the fix queue is unchanged", "the unavailable section");
    assert(/not configured/.test(m.renderRefusalsSection({ read: { status: "not_configured" }, rows: 0, opened: 0, resolved: 0, kept: 0, missing: [], unmatched: [] }).join("\n")), "the not-configured section");
  }

  // --- the wiring ------------------------------------------------------------------------------------------
  {
    const root = join(__dirname, "..", "..");
    const policy = readFileSync(join(root, "worker", "sweep", "policy.ts"), "utf8");
    assert(/runApplyRefusals\(prismaRefusalsStore/.test(policy) && /catch \(err\)[\s\S]{0,200}Apply refusals/.test(policy), "the policy sweep runs the reader in its own try/catch");
    assert(policy.indexOf("runApplyRefusals(") > policy.indexOf("for (const site of selected)") && policy.indexOf("runApplyRefusals(") < policy.indexOf("closeSweep({"), "after the policy checks, before the report closes");
    const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
    const env = compose.slice(compose.indexOf("x-worker-env"), compose.indexOf("services:"));
    assert(/PUBLIC_SITE_REFUSALS_URL: \$\{PUBLIC_SITE_REFUSALS_URL:-https:\/\/haide-frontend\.vercel\.app\/api\/crawler\/apply-refusals\}/.test(env), "compose sets the URL, with the default");
    assert(/PUBLIC_SITE_REFUSALS_TOKEN: \$\{PUBLIC_SITE_REFUSALS_TOKEN:-\}/.test(env), "and passes the token from the env file, no value of its own");
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("applyRefusals: read once with one retry, matched by id and host, items opened, kept and resolved; the section; the wiring");
})().catch((e) => {
  console.error(`FAIL: applyRefusals test threw — ${(e as Error).message}`);
  process.exit(1);
});
