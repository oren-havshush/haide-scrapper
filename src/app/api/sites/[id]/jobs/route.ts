import { NextRequest, NextResponse } from "next/server";
import { formatErrorResponse } from "@/lib/errors";
import { clearSiteJobs } from "@/services/siteService";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await clearSiteJobs(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
