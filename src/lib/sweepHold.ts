/**
 * sweepHold.ts — a site held out of the sweeps (owner, 2026-10-13).
 *
 * A site blocked by a host bot challenge (SiteGround's interactive captcha on
 * the box's IP, Cloudflare on headless browsers) is never SKIPPED and its jobs
 * are never deleted for that reason: it stays ACTIVE and visible on the public
 * site, the nightly and policy sweeps leave it out, and the owner is told.
 * A --site run and a dashboard scrape still work on a held site.
 *
 * Two values (worker/lib/holdRule.ts):
 * - HOST_CHALLENGE: set by the owner, or by the nightly after three SiteGround
 *   nights in a row. Released only by the owner.
 * - CHALLENGE_RETRY_SATURDAY: Cloudflare's weekday pause, set by the nightly;
 *   the Saturday-night run retries the site and lifts it if the run writes rows.
 *
 * Pure: the columns a set or a release writes, the body the route accepts,
 * and how a hold is named. The route is POST /api/sites/[id]/sweep-hold; the
 * operator's command is `npx tsx scripts/addsite-batch.ts hold set|release`.
 */

import { z } from "zod";

/** What the owner may set through the route. The pause is the nightly's own. */
export const SWEEP_HOLDS = ["HOST_CHALLENGE"] as const;
export type SweepHoldReason = (typeof SWEEP_HOLDS)[number];

/** Every value Site.sweepHold can hold. */
export const SWEEP_HOLD_STATES = ["HOST_CHALLENGE", "CHALLENGE_RETRY_SATURDAY"] as const;
export type SweepHoldState = (typeof SWEEP_HOLD_STATES)[number];
export const CLOUDFLARE_PAUSE: SweepHoldState = "CHALLENGE_RETRY_SATURDAY";

/** The route's body: a hold with its note, or { hold: null } to release. */
export const sweepHoldBodySchema = z
  .object({
    hold: z.enum(SWEEP_HOLDS).nullable(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((b) => b.hold === null || b.note !== undefined, { message: "a hold needs a note saying what was seen, and since when" })
  .refine((b) => b.hold !== null || b.note === undefined, { message: "a release takes no note" });

export type SweepHoldBody = z.infer<typeof sweepHoldBodySchema>;

export type SweepHoldColumns = {
  sweepHold: SweepHoldReason | null;
  sweepHoldAt: Date | null;
  sweepHoldNote: string | null;
  sweepHoldBy: string | null;
  sweepHoldProbeAt: Date | null;
  sweepHoldProbeResult: string | null;
};

/**
 * The hold columns, written together. A set stamps the time and the note, says
 * the owner set it, and starts with no probe result (an owner's hold replaces
 * a pause, whose history is not its). A release clears all six.
 */
export function sweepHoldData(body: SweepHoldBody, now: Date): SweepHoldColumns {
  if (body.hold === null) {
    return { sweepHold: null, sweepHoldAt: null, sweepHoldNote: null, sweepHoldBy: null, sweepHoldProbeAt: null, sweepHoldProbeResult: null };
  }
  return { sweepHold: body.hold, sweepHoldAt: now, sweepHoldNote: body.note ?? null, sweepHoldBy: "owner", sweepHoldProbeAt: null, sweepHoldProbeResult: null };
}

/** The selection's own line for a held site, as the report names it. */
export function holdReason(hold: string, note: string | null | undefined): string {
  return `on hold (${hold})${note ? `: ${note}` : ""}`;
}

export type HoldVendorName = "SiteGround" | "Cloudflare" | "host";

/**
 * The host whose challenge the hold is for, read from the hold and its note in
 * the words the report uses (worker/lib/zeroMatch.ts challengeVendor). A pause
 * is Cloudflare's by definition; a note naming neither is "host". Never guessed.
 */
export function holdVendor(hold: string | null | undefined, note: string | null | undefined): HoldVendorName {
  if (hold === CLOUDFLARE_PAUSE) return "Cloudflare";
  const n = note ?? "";
  if (/SiteGround|sg-captcha/i.test(n)) return "SiteGround";
  if (/Cloudflare|cf-mitigated/i.test(n)) return "Cloudflare";
  return "host";
}

/** Who set the hold. NULL is a hold set by hand before the column existed: the owner's. */
export function holdSetBy(by: string | null | undefined): "owner" | "auto" {
  return by === "auto" ? "auto" : "owner";
}

/**
 * Whether a scrape run is guarded (`scheduled: true`, worker/lib/scheduledRun.ts).
 * A run on a held or paused site always is, whoever asked (design G4): a
 * partly blocked page would otherwise write the few rows it saw and delete the
 * rest, and the guard also keeps the activation gate from changing the status
 * of a site whose status the hold leaves alone. Such a run releases nothing.
 * Read from the site, never from the request, so no caller can choose it.
 */
export function scrapeRunGuarded(requested: boolean | undefined, sweepHold: string | null | undefined): boolean {
  return requested === true || (sweepHold !== null && sweepHold !== undefined);
}
