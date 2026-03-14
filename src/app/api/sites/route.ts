import { NextRequest } from "next/server";
import { successResponse, listResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { createSiteSchema, paginationSchema, sortSchema, siteUrlFilterSchema } from "@/lib/validators";
import { createSite, listSites } from "@/services/siteService";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const params = paginationSchema.parse({
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });
    const sortParams = sortSchema.parse({
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    });
    const status = searchParams.get("status") ?? undefined;
    const { siteUrl } = siteUrlFilterSchema.parse({
      siteUrl: searchParams.get("siteUrl") ?? undefined,
    });

    const { sites, total } = await listSites({ ...params, ...sortParams, status, siteUrl });
    return listResponse(sites, {
      total,
      page: params.page,
      pageSize: params.pageSize,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSiteSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
      );
    }

    const site = await createSite(parsed.data.siteUrl);
    return successResponse(site, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
