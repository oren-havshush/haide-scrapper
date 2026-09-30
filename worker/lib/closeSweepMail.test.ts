// Run: npx tsx worker/lib/closeSweepMail.test.ts
//
// Step 11, part 3: closeSweep emails the report for BOTH sweep kinds and
// records what happened on the sweep row's emailStatus. A mail that fails —
// refused, unreachable, or a sender that throws — must never cost the night
// its report: the row is still closed COMPLETED with its counters and logText,
// and closeSweep still returns.
//
// closeSweep's two side effects are injected, so this watches exactly what it
// writes and sends without a database. The module needs DATABASE_URL to load
// (the prisma singleton); an unreachable one is set, and nothing may query it.

import type { MailOutcome } from "./sweepMail";
import type { ReportItem } from "./sweepReport";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://nobody@127.0.0.1:1/none";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
async function check(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

type Update = { where: { id: string }; data: Record<string, unknown> };
type SendArgs = { kind: "SCRAPE" | "POLICY"; date: string; logText: string; items: ReportItem[] };

const ITEM: ReportItem = {
  siteId: "s1",
  siteUrl: "https://a.test/jobs",
  phase: "scrape",
  outcome: "success",
  failureCategory: null,
  jobsBefore: 10,
  jobsAfter: 10,
  newestJobAt: null,
  siteStatus: "ACTIVE",
  wouldDemoteTo: null,
  wouldPromoteTo: null,
};
const STARTED = new Date("2026-09-28T23:00:40Z"); // 02:00 IDT on the 29th

(async () => {
  const mod = await import("../sweep/sweepCommon");
  const closeSweep = (mod.closeSweep ?? (mod as unknown as { default: typeof mod }).default.closeSweep) as typeof mod.closeSweep;

  const run = async (
    kind: "SCRAPE" | "POLICY",
    send: (a: SendArgs) => Promise<MailOutcome>,
    opts: {
      failUpdateOf?: "emailStatus";
      loadFixQueue?: () => Promise<Array<{ siteUrl: string; field: string; code: string; openedAt: Date }>>;
    } = {},
  ) => {
    const updates: Update[] = [];
    const sends: SendArgs[] = [];
    const logText = await closeSweep(
      {
        kind,
        sweepId: "sw1",
        trigger: "timer",
        startedAt: STARTED,
        selectedCount: 1,
        status: "COMPLETED",
        haltReason: null,
        items: [ITEM],
      },
      {
        update: async (u: Update) => {
          if (opts.failUpdateOf && opts.failUpdateOf in u.data) throw new Error("db write failed");
          updates.push(u);
          return {};
        },
        send: async (a: SendArgs) => {
          sends.push(a);
          return send(a);
        },
        loadFixQueue: opts.loadFixQueue ?? (async () => []),
      } as never,
    );
    const merged = Object.assign({}, ...updates.map((u) => u.data)) as Record<string, unknown>;
    return { logText, updates, sends, merged };
  };
  const sent = async (): Promise<MailOutcome> => ({ emailStatus: "sent", httpStatus: 200, data: {} });

  for (const kind of ["SCRAPE", "POLICY"] as const) {
    await check(`${kind}: the report is emailed and the outcome recorded`, async () => {
      const r = await run(kind, sent);
      assert(r.sends.length === 1, `${kind}: one send (${r.sends.length})`);
      assert(r.sends[0]?.kind === kind, `${kind}: sent as its own kind`);
      assert(r.sends[0]?.logText === r.logText, `${kind}: the mail carries the stored report`);
      assert(r.sends[0]?.date === "2026-09-29", `${kind}: dated in Jerusalem (${r.sends[0]?.date})`);
      assert(r.sends[0]?.items.length === 1, `${kind}: with the sweep's items for the CSV`);
      assert(r.merged.status === "COMPLETED" && r.merged.logText === r.logText, `${kind}: the row is closed with its report`);
      assert(r.merged.emailStatus === "sent", `${kind}: emailStatus recorded on the row (${String(r.merged.emailStatus)})`);
      const first = r.updates.findIndex((u) => "logText" in u.data);
      const mail = r.updates.findIndex((u) => "emailStatus" in u.data);
      assert(first >= 0 && mail > first, `${kind}: the report is written BEFORE the mail is attempted`);
    });
  }

  await check("a refused mail still closes the sweep COMPLETED", async () => {
    const r = await run("SCRAPE", async () => ({
      emailStatus: "failed: HTTP 403 FORBIDDEN: Recipient not on the allowlist: x@y.z",
      httpStatus: 403,
      data: null,
    }));
    assert(r.merged.status === "COMPLETED", `status stays COMPLETED (${String(r.merged.status)})`);
    assert(String(r.merged.emailStatus).includes("403 FORBIDDEN"), `the failure is recorded (${String(r.merged.emailStatus)})`);
    assert(typeof r.logText === "string" && r.logText.length > 0, "and closeSweep still returns the report");
  });

  await check("a sender that throws still closes the sweep COMPLETED", async () => {
    const r = await run("SCRAPE", async () => {
      throw new Error("boom");
    });
    assert(r.merged.status === "COMPLETED", "status stays COMPLETED");
    assert(String(r.merged.emailStatus).startsWith("failed") && String(r.merged.emailStatus).includes("boom"),
      `recorded as failed (${String(r.merged.emailStatus)})`);
  });

  await check("a failed emailStatus write does not fail the close", async () => {
    const r = await run("POLICY", sent, { failUpdateOf: "emailStatus" });
    assert(r.merged.status === "COMPLETED" && typeof r.logText === "string", "the close still returns with its report");
  });

  // addsite2 phase two, step 1a: closeSweep loads the open fix items and the
  // scrape report carries them in its Fix queue block.
  await check("the scrape report carries the open fix items", async () => {
    const open = async () => [
      { siteUrl: "https://etgarim.test", field: "APPLY", code: "manual", openedAt: new Date("2026-09-20T10:00:00Z") },
    ];
    const r = await run("SCRAPE", sent, { loadFixQueue: open });
    assert(r.logText.includes("Fix queue") && r.logText.includes("https://etgarim.test"), "the block is in the stored report");
    assert(r.sends[0]?.logText.includes("Fix queue") === true, "and in the mail");
    const p = await run("POLICY", sent, { loadFixQueue: open });
    assert(!p.logText.includes("Fix queue"), "the policy report does not carry it");
  });

  await check("a fix queue that cannot be read never fails the close", async () => {
    const r = await run("SCRAPE", sent, {
      loadFixQueue: async () => {
        throw new Error("db read failed");
      },
    });
    assert(r.merged.status === "COMPLETED" && r.sends.length === 1, "the sweep still closes and mails");
    assert(!r.logText.includes("Fix queue"), "without the block");
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("closeSweepMail: both sweeps email their report; a failed mail never fails the close");
})();
