import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

// Every Place row, as the public site will read it (report fixes 3, item 18):
// name, region, kind, createdAt, updatedAt. Read-only, behind the API token
// like every /api route (src/proxy.ts); nothing of ours reads the table, this
// is so we can see what they see. Filled by scripts/sync-places.ts.
export async function GET() {
  try {
    const places = await prisma.place.findMany({ orderBy: { name: "asc" } });
    return successResponse(places);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
