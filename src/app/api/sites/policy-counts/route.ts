import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { getPolicyStatusCounts } from "@/services/policyReviewService";

export async function GET() {
  try {
    const counts = await getPolicyStatusCounts();
    return successResponse(counts);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
