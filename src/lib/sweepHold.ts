/**
 * sweepHold.ts — a site held out of the sweeps (owner, 2026-10-13).
 *
 * A site blocked by a host bot challenge (SiteGround's interactive captcha on
 * the box's IP, Cloudflare on headless browsers) is never SKIPPED and its jobs
 * are never deleted for that reason: it stays ACTIVE and visible on the public
 * site, the nightly and policy sweeps leave it out, and the owner is told.
 * A --site run and a dashboard scrape still work on a held site.
 *
 * Pure: the three columns a set or a release writes, and the body the route
 * accepts. The route is POST /api/sites/[id]/sweep-hold; the operator's
 * command is `npx tsx scripts/addsite-batch.ts hold set|release`.
 */

import { z } from "zod";

export const SWEEP_HOLDS = ["HOST_CHALLENGE"] as const;
export type SweepHoldReason = (typeof SWEEP_HOLDS)[number];

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

/** The three columns, written together: set stamps the time and the note; release clears all three. */
export function sweepHoldData(body: SweepHoldBody, now: Date): { sweepHold: SweepHoldReason | null; sweepHoldAt: Date | null; sweepHoldNote: string | null } {
  if (body.hold === null) return { sweepHold: null, sweepHoldAt: null, sweepHoldNote: null };
  return { sweepHold: body.hold, sweepHoldAt: now, sweepHoldNote: body.note ?? null };
}

/** The selection's own line for a held site, as the report names it. */
export function holdReason(hold: string, note: string | null | undefined): string {
  return `on hold (${hold})${note ? `: ${note}` : ""}`;
}
