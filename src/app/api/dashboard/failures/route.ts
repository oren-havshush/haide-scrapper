import { NextResponse } from "next/server";
import { formatErrorResponse } from "@/lib/errors";
import { getFailedSitesWithReasons } from "@/services/dashboardService";

export async function GET() {
  try {
    const result = await getFailedSitesWithReasons();
    return NextResponse.json({ data: result.data, meta: result.meta });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
