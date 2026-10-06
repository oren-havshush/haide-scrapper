import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { fixItemPatchSchema } from "@/lib/validators";
import { updateFixItem } from "@/services/fixQueueService";

/**
 * PATCH { minutes?, resolved?, resolvedBy?, note?, operator? } on one fix item
 * (addsite2 phase two, step 1a). `resolved: true` closes it as resolvedBy
 * MANUAL, or CHECK when named (n); `resolved: false` reopens it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = fixItemPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i: { message: string }) => i.message).join(", "));
    }
    return successResponse(await updateFixItem(id, parsed.data));
  } catch (error) {
    return formatErrorResponse(error);
  }
}
