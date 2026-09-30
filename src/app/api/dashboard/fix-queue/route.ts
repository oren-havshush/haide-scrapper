import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { fixItemCreateSchema, fixQueueQuerySchema } from "@/lib/validators";
import { createFixItem, listFixItems } from "@/services/fixQueueService";

/**
 * The fix queue (addsite2 phase two, step 1a). Behind the API token like every
 * /api/ route (src/proxy.ts).
 *
 *   GET  ?siteId=&open=true|false&cohort=control|test|addsite2_after_switch
 *        &freezeAt=<iso>&switchAt=<iso>
 *   POST { siteId, field, minutes?, note?, operator?, code?, detail?, resolved? }
 */
export async function GET(request: NextRequest) {
  try {
    const parsed = fixQueueQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i: { message: string }) => i.message).join(", "));
    }
    const q = parsed.data;
    const result = await listFixItems({
      siteId: q.siteId,
      open: q.open,
      cohort: q.cohort,
      bounds: {
        freezeAt: q.freezeAt ? new Date(q.freezeAt) : null,
        switchAt: q.switchAt ? new Date(q.switchAt) : null,
      },
    });
    return NextResponse.json({ data: result.data, meta: result.meta });
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = fixItemCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i: { message: string }) => i.message).join(", "));
    }
    return successResponse(await createFixItem(parsed.data), 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
