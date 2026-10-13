/**
 * holdProbe.ts — the Saturday probe of a held site (owner, 2026-10-13; design
 * G5 with the amendment). Pure: what one GET's answer means, which held sites
 * are probed, and the lines the probe leaves on the site.
 *
 * One GET of the site's URL from the box, redirect not followed, 15 s, no
 * retry, before the Saturday-night selection (worker/sweep/holdProbe.ts). A
 * pass selects the site for that same run, guarded; the hold stays until the
 * owner says release.
 *
 * Only a SiteGround (or unnamed host) hold is probed. SiteGround judges the
 * box's IP, so a GET is a fair test of it. A GET cannot pass Cloudflare, so a
 * Cloudflare hold is never probed: the owner orders a guarded run instead.
 */

import { detectChallengeResponse, isChallengeTitle } from "./zeroMatch";
import { asciiOnly } from "./holdRule";
import { holdVendor } from "../../src/lib/sweepHold";

export const PROBE_TIMEOUT_MS = 15_000;
/** How much of the body is read for an interstitial title. */
export const PROBE_BODY_BYTES = 64 * 1024;
export const PROBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type ProbeVerdict =
  | { result: "passed" }
  | { result: "challenged"; detail: string }
  | { result: "inconclusive"; detail: string };

/** The page's <title>, from the first bytes of the body. */
function titleOf(bodyHead: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(bodyHead);
  return m ? m[1].trim() : null;
}

/**
 * - challenged: any challenge mark — SiteGround's sg-captcha header or
 *   /.well-known/sgcaptcha/ path, Cloudflare's cf-mitigated header, a meta
 *   refresh to SiteGround's captcha, or Cloudflare's interstitial title.
 * - passed: 2xx other than 202, and no mark.
 * - inconclusive: a redirect (not followed: that would be a second request),
 *   a 202 without a mark, or a 4xx/5xx without one.
 */
export function judgeProbe(status: number, headers: Record<string, string | undefined>, bodyHead: string, url: string): ProbeVerdict {
  const fromResponse = detectChallengeResponse(url, headers);
  if (fromResponse) return { result: "challenged", detail: asciiOnly(fromResponse) };
  if (/\/\.well-known\/(sg)?captcha\//i.test(bodyHead)) return { result: "challenged", detail: "SiteGround challenge (refresh to /.well-known/captcha/)" };
  const title = titleOf(bodyHead);
  if (isChallengeTitle(title)) return { result: "challenged", detail: "Cloudflare challenge (interstitial title)" };
  if (status >= 300 && status < 400) return { result: "inconclusive", detail: `HTTP ${status} redirect, not followed` };
  if (status >= 200 && status < 300 && status !== 202) return { result: "passed" };
  return { result: "inconclusive", detail: `HTTP ${status}` };
}

/** The line kept in Site.sweepHoldProbeResult (ASCII). */
export function probeResultText(v: ProbeVerdict): string {
  return asciiOnly(v.result === "passed" ? "passed" : v.result === "challenged" ? `still challenged: ${v.detail}` : `inconclusive: ${v.detail}`);
}

/** A held site the Saturday probe GETs: HOST_CHALLENGE, and not Cloudflare's. */
export function probeEligible(hold: string | null | undefined, note: string | null | undefined): boolean {
  return hold === "HOST_CHALLENGE" && holdVendor(hold, note) !== "Cloudflare";
}

/**
 * The probe line after the run it led to, kept in sweepHoldProbeResult so the
 * email says it until the next probe. The run releases nothing.
 */
export function probeRunResult(item: { outcome: string; failureCategory: string | null }): string {
  if (item.outcome === "success") return "passed; the run passed";
  if (item.failureCategory === "blocked") return "passed; the run was blocked";
  return asciiOnly(`passed; the run failed (${item.failureCategory ?? item.outcome})`);
}
