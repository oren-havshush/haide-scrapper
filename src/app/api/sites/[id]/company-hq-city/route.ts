import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateSiteCompanyHqCitySchema } from "@/lib/validators";
import { saveCompanyHqCity } from "@/services/siteService";

// Operator-authored HQ city, for a company that publishes no address anywhere
// the capture can read it. That is common and legitimate: clalitsmile lists
// branch clinics and never a head office, imj.org.il answers headless Chromium
// with a bot challenge and an empty DOM. The capture is right to store nothing;
// the city can only come from a human, or from the /company-profile skill's
// search under a human's rules.
//
// A SEPARATE route from PUT /company-profile on purpose. That one is a capture:
// it stamps companyProfileAt and is refused on a second call. This one records
// an authored value, so it must be repeatable and must leave companyProfileAt
// alone — see saveCompanyHqCity(), which also explains why the provenance is
// stored rather than inferred, and why the city.csv gate has to run server-side
// on this path specifically.
//
// PUT only. No GET (the value is in the company-profile payload and the sites
// list already), and no DELETE — clearing is PUT with null.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parsed = updateSiteCompanyHqCitySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", "),
      );
    }

    const site = await saveCompanyHqCity(
      id,
      parsed.data.companyHqCity,
      parsed.data.evidence,
    );
    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
