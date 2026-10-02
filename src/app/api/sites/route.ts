import { NextRequest } from "next/server";
import { successResponse, listResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { createSiteSchema, siteListQuerySchema } from "@/lib/validators";
import { createSite, listSites } from "@/services/siteService";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    // The whole query, strictly (step 5, landmine e): an unknown parameter such
    // as ?id= or ?search= is a 400, and pageSize above 100 is a 400 naming it
    // (formatErrorResponse maps the ZodError), not a 500 read as an empty list.
    const q = siteListQuerySchema.parse(Object.fromEntries(searchParams));

    const { sites, total } = await listSites({
      page: q.page,
      pageSize: q.pageSize,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      status: q.status,
      policyStatus: q.policyStatus,
      siteUrl: q.siteUrl,
      companyNameSearch: q.companyNameSearch || undefined,
      urlSearch: q.urlSearch || undefined,
    });
    return listResponse(sites, {
      total,
      page: q.page,
      pageSize: q.pageSize,
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

    const site = await createSite(parsed.data.siteUrl, {
      onboardingSkill: parsed.data.onboardingSkill,
      companyName: parsed.data.companyName,
    });
    return successResponse(site, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
