import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sweepHoldBodySchema } from "@/lib/sweepHold";
import { setSweepHold, SWEEP_HOLD_SELECT } from "@/services/siteService";
import { recordSiteCall } from "@/services/autoFixService";

// A site held out of the nightly and policy sweeps (owner, 2026-10-13): a host
// bot challenge is a hold, never SKIPPED and never a reason to delete jobs.
// The operator's command is `npx tsx scripts/addsite-batch.ts hold set|release`
// (src/lib/sweepHold.ts). GET reads the hold; POST { hold, note } sets it and
// POST { hold: null } releases it. Status, jobs and config are not touched.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await recordSiteCall(request, id, "GET /api/sites/[id]/sweep-hold");
    const site = await prisma.site.findUnique({ where: { id }, select: SWEEP_HOLD_SELECT });
    if (!site) throw new NotFoundError("Site", id);
    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Recorded as a call only: a hold is not a config or status write, so it opens no fix item.
    await recordSiteCall(request, id, "POST /api/sites/[id]/sweep-hold");
    const parsed = sweepHoldBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i: { message: string }) => i.message).join(", "));
    }
    return successResponse(await setSweepHold(id, parsed.data));
  } catch (error) {
    return formatErrorResponse(error);
  }
}
