import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { getDashboardOverview } from "@/services/dashboardService";

export async function GET() {
  try {
    const overview = await getDashboardOverview();
    return successResponse(overview);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
