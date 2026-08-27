import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateSiteCompanyHomepageSchema } from "@/lib/validators";
import { saveCompanyHomepage } from "@/services/siteService";

// Operator-supplied company homepage, for a site whose jobs live on a
// careers-board vendor. There the careers URL says nothing about the employer's
// own domain, and the board frequently links nothing belonging to them, so no
// amount of scraping will find it — a human has to say where it is.
//
// A SEPARATE route from PUT /company-profile on purpose. That one is a capture:
// it stamps companyProfileAt and is refused on a second call. This one is a
// HINT recorded BEFORE the capture, so it must be repeatable and must leave
// companyProfileAt alone — see saveCompanyHomepage().
//
// PUT only. No GET (the value is already in the company-profile payload and in
// the sites list), and no DELETE — clearing is PUT with null.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parsed = updateSiteCompanyHomepageSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", "),
      );
    }

    const site = await saveCompanyHomepage(id, parsed.data.companyHomepageUrl);
    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
