// SiteGround's automatic "ipc" check, and the challenge labels (owner,
// 2026-10-10). Pure: worker/jobs/scrape.ts gathers the main-frame navigations
// and acts on the verdicts.
//
// Measured from the box on 2026-10-10 for gazit and tl-care: the listing
// answers 202 with sg-captcha: challenge, the page refreshes to
// /.well-known/sgcaptcha/?…&y=ipc:<ip>, its own script answers with &sol=…, and
// the listing comes back 200. A browser passes it by itself in two
// navigations; the worker's extraction raced the chain (tl-care 6 of 16, gazit
// empty). The worker waits for it to settle on the listing URL, capped at
// IPC_WAIT_CAP_MS. Only that: an "ipr" verdict (IP reputation, which escalates),
// SiteGround's interactive captcha (/.well-known/captcha/), and the cap running
// out stay blocked, as today. Nothing is clicked or answered; the page's own
// script does what it does in any browser. Every wait is recorded on the run.

import { BLOCKED, BLOCKED_WARNING, type ExtractGuard } from "./zeroMatch";

/** The longest the worker waits for the ipc chain to settle. */
export const IPC_WAIT_CAP_MS = 20_000;

/** One main-frame navigation response. */
export type NavRecord = { url: string; status: number; sgCaptcha: boolean };

export function navRecordOf(url: string, status: number, headers: Record<string, string | undefined>): NavRecord {
  const sg = Object.entries(headers).find(([k]) => k.toLowerCase() === "sg-captcha")?.[1];
  return { url, status, sgCaptcha: typeof sg === "string" && /challenge/i.test(sg) };
}

/** "not_challenged" | still "waiting" | "settled" on the listing | stopped at "ipr" | stopped at an interactive "captcha". */
export type ChainVerdict = "not_challenged" | "waiting" | "settled" | "ipr" | "captcha";

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Origin and path, decoded, without a trailing slash: the listing, whatever encoding a navigation reports. */
function samePage(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      let p = x.pathname;
      try {
        p = decodeURIComponent(p);
      } catch {
        // keep as is
      }
      return (x.origin + p).replace(/\/+$/, "").toLowerCase();
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

export function judgeChallengeChain(navs: readonly NavRecord[], targetUrl: string): ChainVerdict {
  const challenged = navs.some((n) => n.sgCaptcha || (pathOf(n.url) ?? "").startsWith("/.well-known/sgcaptcha/"));
  if (!challenged) return "not_challenged";
  if (navs.some((n) => (pathOf(n.url) ?? "").startsWith("/.well-known/captcha/"))) return "captcha";
  if (navs.some((n) => (pathOf(n.url) ?? "").startsWith("/.well-known/sgcaptcha/") && /[?&]y=ipr:/.test(n.url))) return "ipr";
  const last = navs[navs.length - 1];
  if (last && !last.sgCaptcha && last.status < 400 && samePage(last.url, targetUrl)) return "settled";
  return "waiting";
}

/** The line recorded on the run for one wait. */
export function challengeWaitRecord(verdict: Exclude<ChainVerdict, "not_challenged"> | "timeout", ms: number): string {
  const s = (ms / 1000).toFixed(1);
  switch (verdict) {
    case "settled":
      return `challenge_wait: SiteGround ipc settled on the listing in ${s} s`;
    case "ipr":
      return `challenge_wait: SiteGround ipr (IP reputation), not waited for — blocked`;
    case "captcha":
      return `challenge_wait: SiteGround interactive captcha after ${s} s — blocked`;
    default:
      return `challenge_wait: SiteGround ipc did not settle within ${IPC_WAIT_CAP_MS / 1000} s — blocked`;
  }
}

/**
 * Label 1: an empty result or a drop in a run that saw a challenge response is
 * blocked, not drift (gazit's empty_results and tl-care's 6 of 16, 2026-10-10).
 * Any other category is left as it is.
 */
export function challengeLabel(category: string, challenge: string | null): string {
  if (!challenge) return category;
  return category === "empty_results" || category === "suspicious_drop" || category === "field_fill_drop" ? BLOCKED : category;
}

/**
 * Label 2, and the wait's record: the challenge detail the run holds, as the
 * report reads it (blocked_challenge: <detail>), and every wait. The crash path
 * (eso-group, sinaistore, 2026-10-10) saved neither, so the line could not name
 * the vendor.
 */
export function challengeWarnings(guard: ExtractGuard | null): string[] {
  if (!guard) return [];
  return [...(guard.challenge ? [`${BLOCKED_WARNING}: ${guard.challenge}`] : []), ...guard.challengeWaits];
}
