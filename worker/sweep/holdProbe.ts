// The Saturday probe of held sites (worker/lib/holdProbe.ts).
//
// Called by the Saturday-night timer run before its selection, and alone by
// `nightly.ts --probe-holds` on the owner's word. For each HOST_CHALLENGE site
// whose host is not Cloudflare: ONE GET of its URL, redirect not followed,
// 15 s, no retry, no wait, no click, no browser. It writes the two probe
// columns and nothing else; the hold stays whatever the answer.

import { prisma } from "../../src/lib/prisma";
import {
  judgeProbe,
  PROBE_BODY_BYTES,
  PROBE_TIMEOUT_MS,
  PROBE_USER_AGENT,
  probeEligible,
  probeResultText,
  probeRunResult,
  type ProbeVerdict,
} from "../lib/holdProbe";

export type ProbeOutcome = { siteId: string; siteUrl: string; verdict: ProbeVerdict; text: string };

/** The first PROBE_BODY_BYTES of the body, as text; empty if it cannot be read. */
async function bodyHead(res: Response): Promise<string> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < PROBE_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    return Buffer.concat(chunks).subarray(0, PROBE_BODY_BYTES).toString("utf8");
  } catch {
    return "";
  }
}

/** One GET. Never retried: a failed request is an inconclusive probe. */
async function probeOnce(url: string): Promise<ProbeVerdict> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": PROBE_USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return judgeProbe(res.status, headers, await bodyHead(res), url);
  } catch (err) {
    const name = (err as Error).name;
    return { result: "inconclusive", detail: name === "TimeoutError" ? `no answer within ${PROBE_TIMEOUT_MS / 1000} s` : `request failed (${name})` };
  }
}

export async function probeHeldSites(log: (line: string) => void, now: Date = new Date()): Promise<ProbeOutcome[]> {
  const held = await prisma.site.findMany({
    where: { sweepHold: "HOST_CHALLENGE" },
    select: { id: true, siteUrl: true, sweepHold: true, sweepHoldNote: true },
  });
  const out: ProbeOutcome[] = [];
  for (const site of held) {
    if (!probeEligible(site.sweepHold, site.sweepHoldNote)) {
      log(`[probe] ${site.siteUrl}: not probed (a GET cannot pass Cloudflare)`);
      continue;
    }
    const verdict = await probeOnce(site.siteUrl);
    const text = probeResultText(verdict);
    // Only the probe's two columns, and only while the site is still held.
    await prisma.site.updateMany({
      where: { id: site.id, sweepHold: "HOST_CHALLENGE" },
      data: { sweepHoldProbeAt: now, sweepHoldProbeResult: text },
    });
    log(`[probe] ${site.siteUrl}: ${text}`);
    out.push({ siteId: site.id, siteUrl: site.siteUrl, verdict, text });
  }
  return out;
}

/**
 * After the Saturday-night run: the probe line of each probe-passed site
 * becomes what its run did ("passed; the run passed", "passed; the run was
 * blocked"). The probe's result column only, and only while still held: the
 * run releases nothing.
 */
export async function recordProbeRuns(
  runs: ReadonlyArray<{ siteId: string; siteUrl: string; outcome: string; failureCategory: string | null }>,
  probePassed: ReadonlySet<string>,
  log: (line: string) => void,
): Promise<void> {
  for (const r of runs) {
    if (!probePassed.has(r.siteId)) continue;
    const text = probeRunResult(r);
    await prisma.site.updateMany({ where: { id: r.siteId, sweepHold: "HOST_CHALLENGE" }, data: { sweepHoldProbeResult: text } });
    log(`[probe] ${r.siteUrl}: ${text}`);
  }
}
