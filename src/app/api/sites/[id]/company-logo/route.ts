import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { MAX_LOGO_BYTES } from "@/lib/image-validate";
import { storeLogo } from "@/lib/logo-store";
import { saveCompanyLogo } from "@/services/siteService";
import { applyAutoFix, companySnapshotOf, siteStatusOf } from "@/services/autoFixService";

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
    const statusBefore = await siteStatusOf(id);
    const companyBefore = await companySnapshotOf(id);

    const contentType = request.headers.get("content-type");
    const sourceUrl = request.headers.get("x-logo-source-url");
    // A hand upload by an operator: judged against a 32 px floor instead of 64
    // (owner, 2026-10-06). scripts/company-profile.ts never sends this header,
    // so the automatic capture keeps the 64 px floor.
    const operator = request.headers.get("x-logo-provenance") === "operator";

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
    const stored = await storeLogo(id, bytes, contentType, { operator });
    const site = await saveCompanyLogo(id, stored.logoPath, sourceUrl);
    await applyAutoFix({
      request,
      siteId: id,
      statusBefore,
      route: "POST /api/sites/[id]/company-logo",
      write: { kind: "company", before: companyBefore, after: await companySnapshotOf(id) },
    });

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
