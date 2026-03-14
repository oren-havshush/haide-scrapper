import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { getStatusCounts } from "@/services/siteService";

export async function GET() {
  try {
    const counts = await getStatusCounts();
    return successResponse(counts);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
