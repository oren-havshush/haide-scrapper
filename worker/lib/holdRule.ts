/**
 * holdRule.ts — when the nightly holds or pauses a site on its own (owner,
 * 2026-10-13; design: sweep-hold G1, with the owner's amendment).
 *
 * Pure. One timer night of one site is classified, and the night's decision
 * follows from it and the site's recent timer nights:
 *
 * - SiteGround flaps by IP reputation, so it is held (HOST_CHALLENGE) only
 *   after three counting nights in a row within the last seven timer nights.
 *   Release is the owner's word.
 * - Cloudflare does not flap and is never held automatically. One counting
 *   night pauses the site (CHALLENGE_RETRY_SATURDAY): the weekday nightlies and
 *   the policy sweep skip it, the Saturday-night run retries it, and a retry
 *   that writes rows lifts the pause. That lift is the one automatic clear.
 *
 * Only timer SCRAPE items are fed here; a hand or requested run never counts.
 * Notes are ASCII: a Hebrew interstitial title is never copied into one.
 */

import { challengeVendor } from "./zeroMatch";

/** One timer SCRAPE item, as the sweep item row stores it. */
export type NightItem = { outcome: string; failureCategory: string | null; warnings?: readonly unknown[] | null };

export type HoldVendor = "SiteGround" | "Cloudflare";

export type NightVerdict =
  | { verdict: "counts"; vendor: HoldVendor; detail: string }
  | { verdict: "resets" }
  | { verdict: "neutral" };

/** A site's night: its Jerusalem date at sweep start, and the verdict. */
export type NightRecord = { night: string; verdict: NightVerdict };

/** Site.sweepHold's values. */
export type HoldState = "HOST_CHALLENGE" | "CHALLENGE_RETRY_SATURDAY" | null;

export const HOLD_NIGHTS = 3;
export const HOLD_WINDOW_NIGHTS = 7;

/**
 * - counts: the run was blocked (wrote nothing) and recorded a qualifying
 *   challenge: SiteGround's wait ending blocked (the interactive captcha, or a
 *   chain that did not settle), or a blocked_challenge naming Cloudflare.
 * - resets: the run wrote rows, whatever it saw on the way (a settled wait,
 *   challenge_passed).
 * - neutral: anything else, including a block with no qualifying detail.
 */
export function classifyNight(item: NightItem): NightVerdict {
  if (item.outcome === "success") return { verdict: "resets" };
  if (item.failureCategory !== "blocked") return { verdict: "neutral" };
  const warnings = (item.warnings ?? []).map(String);
  const wait = warnings.filter((w) => w.startsWith("challenge_wait:") && /SiteGround/.test(w) && / blocked$/.test(w)).pop();
  if (wait) {
    return { verdict: "counts", vendor: "SiteGround", detail: /interactive captcha/.test(wait) ? "interactive captcha" : "did not settle" };
  }
  const seen = warnings.find((w) => w.startsWith("blocked_challenge:"));
  if (seen && challengeVendor(seen.slice(seen.indexOf(":") + 1).trim()) === "a Cloudflare challenge") {
    return { verdict: "counts", vendor: "Cloudflare", detail: /cf-mitigated/.test(seen) ? "cf-mitigated: challenge" : "interstitial title" };
  }
  return { verdict: "neutral" };
}

const countsFor = (r: NightRecord, vendor: HoldVendor) => r.verdict.verdict === "counts" && r.verdict.vendor === vendor;

/**
 * True when the site's last three SiteGround counting nights are consecutive
 * among its counting and resetting nights (no reset between them), and all
 * fall within the last seven timer nights. Neutral nights neither count nor
 * break the run; Cloudflare nights are not part of it (they pause instead).
 *
 * @param timerNights every timer night of the fleet so far, tonight included
 */
export function shouldHold(history: readonly NightRecord[], timerNights: readonly string[]): boolean {
  const window = new Set([...new Set(timerNights)].sort().slice(-HOLD_WINDOW_NIGHTS));
  const decisive = [...history]
    .filter((r) => countsFor(r, "SiteGround") || r.verdict.verdict === "resets")
    .sort((a, b) => a.night.localeCompare(b.night));
  const last = decisive.slice(-HOLD_NIGHTS);
  return last.length === HOLD_NIGHTS && last.every((r) => countsFor(r, "SiteGround") && window.has(r.night));
}

/** Printable ASCII only, whatever was passed in. */
export function asciiOnly(s: string): string {
  return [...s].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126).join("");
}

/** The note an automatic SiteGround hold carries. */
export function autoHoldNote(detail: string, nights: readonly string[]): string {
  const sorted = [...nights].sort();
  return asciiOnly(`auto: SiteGround challenge (${detail}) on ${sorted.length} nights, ${sorted[0]}..${sorted[sorted.length - 1]}`);
}

/** The note a Cloudflare pause carries. */
export function pauseNote(night: string): string {
  return asciiOnly(`auto: Cloudflare challenge on ${night}; retry Saturday night`);
}

const JERUSALEM_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" });

/** The Saturday-night run: the sweep starts on a Saturday in Asia/Jerusalem. Never the host clock. */
export function isSaturdayRun(startedAt: Date): boolean {
  return JERUSALEM_WEEKDAY.format(startedAt) === "Sat";
}

export type NightDecision =
  | { action: "hold"; note: string }
  | { action: "pause"; note: string }
  | { action: "lift_pause" }
  | { action: "pause_stays"; blockedAgain: boolean; why: string }
  | { action: "none" };

/**
 * What tonight's timer item does to the site's hold.
 *
 * @param history the site's timer nights within reach, tonight included
 */
export function decideNight(args: {
  state: HoldState;
  tonight: NightRecord;
  history: readonly NightRecord[];
  timerNights: readonly string[];
  saturday: boolean;
}): NightDecision {
  const { state, tonight } = args;
  if (state === "HOST_CHALLENGE") return { action: "none" };
  if (state === "CHALLENGE_RETRY_SATURDAY") {
    if (!args.saturday) return { action: "none" };
    if (tonight.verdict.verdict === "resets") return { action: "lift_pause" };
    if (countsFor(tonight, "Cloudflare")) return { action: "pause_stays", blockedAgain: true, why: "Cloudflare blocked on Saturday too" };
    return { action: "pause_stays", blockedAgain: false, why: "the retry did not write rows" };
  }
  if (countsFor(tonight, "Cloudflare")) return { action: "pause", note: pauseNote(tonight.night) };
  if (countsFor(tonight, "SiteGround") && shouldHold(args.history, args.timerNights)) {
    const nights = [...args.history]
      .filter((r) => countsFor(r, "SiteGround"))
      .map((r) => r.night)
      .sort()
      .slice(-HOLD_NIGHTS);
    return { action: "hold", note: autoHoldNote((tonight.verdict as { detail: string }).detail, nights) };
  }
  return { action: "none" };
}

// ---------------------------------------------------------------------------
// The night's plan, and what each decision writes
// ---------------------------------------------------------------------------

/** A site's earlier timer item, with its night. */
export type TimerNight = { night: string; item: NightItem };

export type AutoHoldInput = {
  siteId: string;
  siteUrl: string;
  /** Site.sweepHold as read after the night's runs. */
  state: HoldState;
  /** Tonight's timer item. */
  tonight: NightItem;
  /** The site's timer items from earlier nights, oldest first. */
  history: readonly TimerNight[];
};

export type AutoHoldEvent = { siteId: string; siteUrl: string; decision: Exclude<NightDecision, { action: "none" }> };

/**
 * Tonight's decisions, for the sites the timer ran. A night with two items
 * (a re-run) is judged by its last one; tonight's item replaces any earlier
 * item of tonight's date.
 */
export function planAutoHolds(sites: readonly AutoHoldInput[], args: { night: string; timerNights: readonly string[]; saturday: boolean }): AutoHoldEvent[] {
  const events: AutoHoldEvent[] = [];
  for (const s of sites) {
    const byNight = new Map<string, NightItem>();
    for (const h of s.history) if (h.night !== args.night) byNight.set(h.night, h.item);
    const tonight: NightRecord = { night: args.night, verdict: classifyNight(s.tonight) };
    const history: NightRecord[] = [...[...byNight.entries()].map(([night, item]) => ({ night, verdict: classifyNight(item) })), tonight];
    const decision = decideNight({ state: s.state, tonight, history, timerNights: args.timerNights, saturday: args.saturday });
    if (decision.action !== "none") events.push({ siteId: s.siteId, siteUrl: s.siteUrl, decision });
  }
  return events;
}

/** The hold columns a decision writes. Nothing else is ever in `data`. */
export type AutoHoldColumns = {
  sweepHold: "HOST_CHALLENGE" | "CHALLENGE_RETRY_SATURDAY" | null;
  sweepHoldAt: Date | null;
  sweepHoldNote: string | null;
  sweepHoldBy: string | null;
  sweepHoldProbeAt: Date | null;
  sweepHoldProbeResult: string | null;
};

/**
 * The write for a decision: `onlyIf` is the hold the site must still have for
 * the write to land (a hold or pause only on a site with none, so an owner's
 * hold set meanwhile is never overwritten; a lift only on a site still
 * paused). A pause that stays writes nothing.
 *
 * The lift is the one automatic clear (owner, 2026-10-13). A HOST_CHALLENGE
 * hold is released only by the owner, through the route.
 */
export function autoHoldWrite(decision: AutoHoldEvent["decision"], now: Date): { onlyIf: HoldState; data: AutoHoldColumns } | null {
  switch (decision.action) {
    case "hold":
    case "pause":
      return {
        onlyIf: null,
        data: {
          sweepHold: decision.action === "hold" ? "HOST_CHALLENGE" : "CHALLENGE_RETRY_SATURDAY",
          sweepHoldAt: now,
          sweepHoldNote: asciiOnly(decision.note),
          sweepHoldBy: "auto",
          sweepHoldProbeAt: null,
          sweepHoldProbeResult: null,
        },
      };
    case "lift_pause":
      return {
        onlyIf: "CHALLENGE_RETRY_SATURDAY",
        data: { sweepHold: null, sweepHoldAt: null, sweepHoldNote: null, sweepHoldBy: null, sweepHoldProbeAt: null, sweepHoldProbeResult: null },
      };
    default:
      return null;
  }
}
