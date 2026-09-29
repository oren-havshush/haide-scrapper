// Run: npx tsx worker/lib/sweepMail.test.ts
//
// The sweep report by email, through the haide-jobs WordPress mailer
// (haide-mailer/v1/send). One POST = one mail with one CSV attached. Every
// failure is recorded and logged loudly, never retried, never thrown into the
// sweep: a report that cannot be mailed must not cost the night its report.
//
// Checked with an injected fetch that records exactly what was sent.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMailBody,
  buildSweepCsv,
  csvFileName,
  mailSource,
  mailSubject,
  readMailConfig,
  sendSweepMail,
  type FetchLike,
} from "./sweepMail";
import type { ReportItem } from "./sweepReport";

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
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

const BOM = String.fromCharCode(0xfeff);
const TOKEN = "t0k3n-that-must-never-be-logged-0123456789abcdef";
const URL = "https://dev.haide-jobs.co.il/wp-json/haide-mailer/v1/send";
const ENV = { HAIDE_MAILER_URL: URL, HAIDE_MAILER_TOKEN: TOKEN, SWEEP_EMAIL_TO: "info@haide-jobs.co.il, shay@haide-jobs.co.il" };
const REPORT = [
  "Nightly sweep 2026-09-29: 145 sites, 3 need attention",
  "",
  "Needs attention (3)",
  "  https://a.test/<jobs>&x=1",
  "      דרוש/ה מנהל/ת — returned 0 listings",
].join("\n");

function item(over: Partial<ReportItem> = {}): ReportItem {
  return {
    siteId: "s1",
    siteUrl: "https://a.test/jobs",
    phase: "scrape",
    outcome: "success",
    failureCategory: null,
    jobsBefore: 10,
    jobsAfter: 12,
    newestJobAt: null,
    siteStatus: "ACTIVE",
    wouldDemoteTo: null,
    wouldPromoteTo: null,
    scrapedCount: 12,
    detailsFetched: 2,
    detailsCarried: 10,
    ...over,
  };
}

type Sent = { url: string; headers: Record<string, string>; form: FormData };
function fakeFetch(status: number, payload: unknown, sent: Sent[]): FetchLike {
  return async (url, init) => {
    sent.push({ url, headers: init.headers, form: init.body });
    return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(payload) };
  };
}
const OK = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    sent: true,
    sent_to: ["info@haide-jobs.co.il"],
    recipients: ["info@haide-jobs.co.il"],
    cc: [],
    bcc: [],
    attachment: "nightly-2026-09-29.csv",
    size: 1841,
    client: "scraper",
    source: "scraper",
    ...over,
  },
});
const ERR = (code: string, message: string) => ({ success: false, error: { code, message } });

function capture() {
  const lines: Array<[string, string]> = [];
  return {
    lines,
    deps: {
      log: (l: string) => lines.push(["log", l]),
      warn: (l: string) => lines.push(["warn", l]),
      error: (l: string) => lines.push(["error", l]),
    },
    text: () => lines.map(([k, l]) => `${k}: ${l}`).join("\n"),
  };
}
const args = { kind: "SCRAPE" as const, date: "2026-09-29", logText: REPORT, items: [item()] };

(async () => {
  await check("configuration", () => {
    const c = readMailConfig(ENV);
    assert(c.url === URL && c.token === TOKEN, "URL and token come from the environment");
    assert(
      c.recipients.join("|") === "info@haide-jobs.co.il|shay@haide-jobs.co.il",
      `SWEEP_EMAIL_TO is a comma list, trimmed (${c.recipients.join("|")})`,
    );
    assert(
      readMailConfig({ HAIDE_MAILER_URL: URL, HAIDE_MAILER_TOKEN: TOKEN }).recipients.join("|") === "info@haide-jobs.co.il",
      "the default recipient is info@haide-jobs.co.il",
    );
    assert(readMailConfig({ HAIDE_MAILER_URL: " ", HAIDE_MAILER_TOKEN: TOKEN }).url === null, "a blank URL is unset");
    assert(mailSource("SCRAPE") === "scraper" && mailSource("POLICY") === "policy-sweep", "source per sweep kind");
    assert(csvFileName("SCRAPE", "2026-09-29") === "nightly-2026-09-29.csv", "nightly-<date>.csv");
    assert(csvFileName("POLICY", "2026-09-29") === "policy-2026-09-29.csv", "policy-<date>.csv");
  });

  await check("subject and body", () => {
    assert(mailSubject(REPORT) === "Nightly sweep 2026-09-29: 145 sites, 3 need attention", "the subject is the report's first line");
    const body = buildMailBody(REPORT);
    assert(body.startsWith('<div dir="rtl"><pre dir="ltr">') && body.endsWith("</pre></div>"), "the report sits in the rtl div / ltr pre shell");
    assert(body.includes("https://a.test/&lt;jobs&gt;&amp;x=1"), "HTML in the report is escaped, not interpreted");
    assert(body.includes("דרוש/ה מנהל/ת"), "Hebrew passes through untouched");
    assert(body.includes("\n      "), "line breaks and indentation are kept");
  });

  await check("the CSV", () => {
    const csv = buildSweepCsv([
      item(),
      item({
        siteUrl: "https://b.test/משרות, \"כל\"",
        outcome: "suspicious_drop",
        failureCategory: "suspicious_drop",
        jobsBefore: 57,
        jobsAfter: 57,
        scrapedCount: 30,
        wouldDemoteTo: "REVIEW",
        gateReason: "externalJobId fill 0.40 < 0.9",
        detailsFetched: null,
        detailsCarried: null,
      }),
      item({ siteUrl: "https://c.test", jobsBefore: 8, jobsAfter: 5, scrapedCount: 5, wouldPromoteTo: "ACTIVE", gateReason: "all gates pass" }),
      item({ siteUrl: "https://d.test", jobsBefore: null as unknown as number, jobsAfter: 5 }),
    ]);
    assert(csv.startsWith(BOM), "starts with a UTF-8 BOM, so Excel opens the Hebrew correctly");
    const rows = csv.slice(1).split("\r\n");
    assert(
      rows[0] === "site URL,outcome,category,jobs before,jobs after,diff,scraped count,withheld action,fetched,carried",
      `the header row, diff right after jobs after (${rows[0]})`,
    );
    assert(rows[1] === "https://a.test/jobs,success,,10,12,2,12,,2,10", `a plain row, diff +2 written as 2 (${rows[1]})`);
    assert(
      rows[2] ===
        '"https://b.test/משרות, ""כל""",suspicious_drop,suspicious_drop,57,57,0,30,would demote to REVIEW (gate: externalJobId fill 0.40 < 0.9),,',
      `quoting, Hebrew, diff 0, and the withheld demotion with the gate's reason (${rows[2]})`,
    );
    assert(
      rows[3] === "https://c.test,success,,8,5,-3,5,would promote to ACTIVE (gate: all gates pass),2,10",
      `a signed negative diff, and a withheld promotion with its reason (${rows[3]})`,
    );
    assert(rows[4] === "https://d.test,success,,,5,,12,,2,10", `diff is empty when a side is null (${rows[4]})`);
    assert(rows.length === 6 && rows[5] === "", "CRLF line endings, one row per site, trailing newline");
  });

  await check("sent", async () => {
    const sent: Sent[] = [];
    const cap = capture();
    const r = await sendSweepMail(args, { fetch: fakeFetch(200, OK(), sent), env: ENV, ...cap.deps });
    assert(sent.length === 1, `exactly one request (${sent.length})`);
    const s = sent[0]!;
    assert(s.url === URL, "to the configured URL");
    assert(s.headers["X-Haide-Mailer-Token"] === TOKEN, "the token travels in X-Haide-Mailer-Token");
    const f = s.form;
    assert(f.get("subject") === mailSubject(REPORT), "subject");
    assert(f.get("recipients") === "info@haide-jobs.co.il,shay@haide-jobs.co.il", `recipients (${f.get("recipients")})`);
    assert(f.get("source") === "scraper", "source");
    assert(f.get("body") === buildMailBody(REPORT), "body");
    assert(f.getAll("file").length === 1, "exactly ONE part named file — two would be silently collapsed");
    const file = f.get("file") as File;
    assert(!!file && file.name === "nightly-2026-09-29.csv", `the file part is named nightly-<date>.csv (${file?.name})`);
    // Bytes, not file.text(): text() decodes UTF-8 and drops a leading BOM,
    // which would hide exactly the thing Excel needs.
    const bytes = file ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
    assert(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "the part's first bytes are the UTF-8 BOM");
    assert(bytes.toString("utf8") === buildSweepCsv(args.items), "and carries the CSV");
    assert(r.emailStatus === "sent", `emailStatus sent (${r.emailStatus})`);
    assert(r.httpStatus === 200, "the status is kept");
    assert(!cap.text().includes(TOKEN), "the token appears in no log line");
  });

  await check("policy sweep", async () => {
    const sent: Sent[] = [];
    await sendSweepMail({ ...args, kind: "POLICY" }, { fetch: fakeFetch(200, OK({ source: "policy-sweep", attachment: "policy-2026-09-29.csv" }), sent), env: ENV, ...capture().deps });
    assert(sent[0]?.form.get("source") === "policy-sweep", "source policy-sweep");
    assert((sent[0]?.form.get("file") as File | null)?.name === "policy-2026-09-29.csv", "file policy-<date>.csv");
  });

  await check("skipped when not configured", async () => {
    for (const env of [{ HAIDE_MAILER_TOKEN: TOKEN }, { HAIDE_MAILER_URL: URL }, {}]) {
      const sent: Sent[] = [];
      const cap = capture();
      const r = await sendSweepMail(args, { fetch: fakeFetch(200, OK(), sent), env, ...cap.deps });
      assert(sent.length === 0, "nothing is sent");
      assert(r.emailStatus.startsWith("skipped"), `emailStatus says skipped (${r.emailStatus})`);
      assert(cap.lines.length === 1, `exactly one log line (${cap.lines.length})`);
    }
  });

  for (const [status, code, message] of [
    [401, "UNAUTHORIZED", "Invalid token."],
    [403, "FORBIDDEN", "Recipient not on the allowlist: shay@haide-jobs.co.il"],
    [400, "INVALID_INPUT", "File contents do not look like a .csv file."],
    [500, "SERVER_ERROR", "The mail server rejected the message: 550 relay denied"],
  ] as const) {
    await check(`HTTP ${status}`, async () => {
      const sent: Sent[] = [];
      const cap = capture();
      const r = await sendSweepMail(args, { fetch: fakeFetch(status, ERR(code, message), sent), env: ENV, ...cap.deps });
      assert(sent.length === 1, `${status}: one attempt, never retried (${sent.length})`);
      assert(r.emailStatus.startsWith("failed"), `${status}: emailStatus failed (${r.emailStatus})`);
      assert(r.emailStatus.includes(String(status)) && r.emailStatus.includes(code), `${status}: the status and code are recorded`);
      assert(r.emailStatus.includes(message), `${status}: the server's message is preserved verbatim`);
      const loud = cap.lines.filter(([k]) => k === "error").map(([, l]) => l).join("\n");
      assert(loud.includes(code) && loud.includes(message), `${status}: logged loudly (error) with code and message`);
      assert(!cap.text().includes(TOKEN), `${status}: the token appears in no log line`);
    });
  }

  await check("a network failure", async () => {
    const cap = capture();
    const throwing: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND dev.haide-jobs.co.il");
    };
    const r = await sendSweepMail(args, { fetch: throwing, env: ENV, ...cap.deps });
    assert(r.emailStatus.startsWith("failed") && r.emailStatus.includes("ENOTFOUND"), `recorded, not thrown (${r.emailStatus})`);
    assert(cap.lines.some(([k]) => k === "error"), "logged loudly");
  });

  await check("a non-JSON error body", async () => {
    const cap = capture();
    const html: FetchLike = async () => ({ status: 502, ok: false, text: async () => "<html>Bad Gateway</html>" });
    const r = await sendSweepMail(args, { fetch: html, env: ENV, ...cap.deps });
    assert(r.emailStatus.startsWith("failed") && r.emailStatus.includes("502"), `still recorded (${r.emailStatus})`);
  });

  await check("2xx that is not quite right", async () => {
    const cap = capture();
    const r = await sendSweepMail(args, { fetch: fakeFetch(200, OK({ client: "daily-reports" }), []), env: ENV, ...cap.deps });
    const warns = cap.lines.filter(([k]) => k === "warn").map(([, l]) => l).join("\n");
    assert(warns.includes("client") && warns.includes("daily-reports"), `a wrong client is warned (${warns})`);
    assert(r.emailStatus.startsWith("sent") && r.emailStatus.includes("client"), `and noted on the status (${r.emailStatus})`);

    const cap2 = capture();
    const r2 = await sendSweepMail(args, { fetch: fakeFetch(200, OK({ attachment: null, size: null }), []), env: ENV, ...cap2.deps });
    assert(cap2.lines.some(([k, l]) => k === "warn" && l.includes("attachment")), "a missing attachment is warned");
    assert(r2.emailStatus.includes("attachment"), `and noted (${r2.emailStatus})`);
  });

  await check("the sweep row has somewhere to put it", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
    const block = /model ScrapeSweep \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    assert(block.split("\n").some((l) => l.trim().split(/\s+/).join(" ").startsWith("emailStatus String?")), "ScrapeSweep.emailStatus is a nullable String");
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("sweepMail: one mail per sweep, every failure recorded and never thrown");
})();
