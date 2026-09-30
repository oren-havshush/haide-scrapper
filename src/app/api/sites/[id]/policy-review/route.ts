import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { enqueuePolicyReview, getLatestPolicyReview } from "@/services/policyReviewService";
import { noteSiteWrite, recordSiteCall } from "@/services/autoFixService";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await noteSiteWrite(request, id, "POST /api/sites/[id]/policy-review");
    const result = await enqueuePolicyReview(id);
    return successResponse(result, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await recordSiteCall(request, id, "GET /api/sites/[id]/policy-review");
    const review = await getLatestPolicyReview(id);
    return successResponse(review);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
