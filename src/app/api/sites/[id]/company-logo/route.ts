import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { MAX_LOGO_BYTES } from "@/lib/image-validate";
import { storeLogo } from "@/lib/logo-store";
import { saveCompanyLogo } from "@/services/siteService";

// Accepts raw image bytes with a Content-Type header and writes them to the
// logo volume. There is deliberately NO url parameter and no outbound HTTP
// client here: the caller (scripts/company-profile.ts) downloads and validates
// the image itself, so the server never fetches a URL found in scraped HTML.
// That removes server-side SSRF as a capability rather than trying to filter
// for it — a hostile careers page cannot aim this container at db:5432,
// worker, or 169.254.169.254.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const contentType = request.headers.get("content-type");
    const sourceUrl = request.headers.get("x-logo-source-url");

    if (sourceUrl && sourceUrl.length > 1_000) {
      throw new ValidationError("x-logo-source-url exceeds 1000 characters");
    }

    const body = await request.arrayBuffer();
    const bytes = new Uint8Array(body);

    // Cheap pre-check so an oversized payload fails with a clear message.
    // inspectImage() enforces the same cap again on the real byte count.
    if (bytes.byteLength > MAX_LOGO_BYTES) {
      throw new ValidationError(
        `logo is ${bytes.byteLength} bytes, above the ${MAX_LOGO_BYTES}-byte cap`,
      );
    }

    // File first, DB second — an orphan file is harmless, a companyLogoPath
    // pointing at nothing is a broken image on the public site.
    const stored = await storeLogo(id, bytes, contentType);
    const site = await saveCompanyLogo(id, stored.logoPath, sourceUrl);

    return successResponse({
      logoPath: stored.logoPath,
      width: stored.inspection.width,
      height: stored.inspection.height,
      format: stored.inspection.format,
      byteLength: stored.inspection.byteLength,
      site,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
