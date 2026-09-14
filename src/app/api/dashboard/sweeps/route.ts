import { NextRequest, NextResponse } from "next/server";
import { formatErrorResponse } from "@/lib/errors";
import { getSweeps } from "@/services/sweepService";

/** Read-only sweep history. Follows src/app/api/dashboard/failures/route.ts. */
export async function GET(request: NextRequest) {
  try {
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const result = await getSweeps({
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ data: result.data, meta: result.meta });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
