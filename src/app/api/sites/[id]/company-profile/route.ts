import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateSiteCompanyProfileSchema } from "@/lib/validators";
import { getCompanyProfile, saveCompanyProfile } from "@/services/siteService";

// Company profile — a dedicated sub-resource, deliberately NOT a fourth branch
// of PATCH /api/sites/:id. That route honors exactly one of
// status/adminNote/companyName per call and silently drops the rest; widening
// it would lengthen the chain and widen the silent-drop window that already
// caused one production incident (LRN-WRK-7). Here a whole-object PUT has no
// such hazard.
//
// This route never writes status, configLocked, fieldMappings, or pageFlow —
// see the allowlist assertion in saveCompanyProfile(). It exposes PUT and GET
// only; there is deliberately no DELETE, PATCH, or POST.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return successResponse(await getCompanyProfile(id));
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parsed = updateSiteCompanyProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", "),
      );
    }

    // Presence-based: only keys actually sent are forwarded, so an absent key
    // leaves its column untouched while an explicit null clears it.
    const force = request.nextUrl.searchParams.get("force") === "1";
    const site = await saveCompanyProfile(id, parsed.data, { force });

    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
