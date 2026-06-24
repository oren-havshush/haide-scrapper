import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { enqueuePolicyReview, getLatestPolicyReview } from "@/services/policyReviewService";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await enqueuePolicyReview(id);
    return successResponse(result, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const review = await getLatestPolicyReview(id);
    return successResponse(review);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
