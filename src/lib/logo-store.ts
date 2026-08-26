/**
 * src/lib/logo-store.ts
 *
 * Writes company logos to the shared Docker volume that Caddy serves at
 * /logos/*. See docker-compose.yml (`company_logos`), the Dockerfile's
 * mkdir+chown before the USER switch, and the Caddyfile's handle_path block.
 *
 * The CLI that uploads here is NOT trusted: everything it already checked is
 * re-checked independently, and the filename is generated server-side rather
 * than taken from any client string.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "@/lib/errors";
import { FORMAT_TO_CONTENT_TYPE, inspectImage, ImageRejected } from "@/lib/image-validate";
import type { ImageInspection } from "@/lib/image-validate";

/** Matches COMPANY_LOGO_DIR in the Dockerfile and docker-compose.yml. */
export const LOGO_DIR = process.env.COMPANY_LOGO_DIR ?? "/data/logos";

/** Public URL prefix. Caddy strips this and serves from the volume root. */
const LOGO_URL_PREFIX = "/logos";

/**
 * cuid charset only. This is what makes path traversal impossible by
 * construction: no ".", "/", "\", "%2e" or NUL can survive the test, so the
 * generated filename cannot escape LOGO_DIR no matter what the caller sends.
 */
const CUID_PATTERN = /^[a-z0-9]{20,32}$/;

export interface StoredLogo {
  /** Path stored in Site.companyLogoPath, e.g. "/logos/clx123….png". */
  logoPath: string;
  inspection: ImageInspection;
}

export function assertValidSiteId(siteId: string): void {
  if (!CUID_PATTERN.test(siteId)) {
    throw new ValidationError("site id is not a valid cuid");
  }
}

/**
 * Validate and store one logo. Returns the public path to record on the Site
 * row. Throws ValidationError (400) for anything the bytes fail.
 *
 * Ordering note: the file is written BEFORE the DB column is updated by the
 * caller. A DB failure then leaves an orphan file, which is harmless; the
 * reverse order would leave companyLogoPath pointing at a file that does not
 * exist, which is a broken image on the public site.
 */
export async function storeLogo(
  siteId: string,
  bytes: Uint8Array,
  declaredContentType: string | null,
): Promise<StoredLogo> {
  assertValidSiteId(siteId);

  let inspection: ImageInspection;
  try {
    inspection = inspectImage(bytes, declaredContentType);
  } catch (error) {
    if (error instanceof ImageRejected) {
      throw new ValidationError(`logo rejected (${error.reason}): ${error.message}`);
    }
    throw error;
  }

  // Generated, never derived from a client string. The extension comes from
  // the magic bytes, not from the URL or the Content-Type header.
  const filename = `${siteId}.${inspection.format}`;
  const fullPath = path.join(LOGO_DIR, filename);

  // Second, independent check. Redundant given the cuid test above, and kept
  // deliberately: it survives a future edit that loosens the id pattern.
  if (!path.resolve(fullPath).startsWith(path.resolve(LOGO_DIR) + path.sep)) {
    throw new ValidationError("resolved logo path escapes the logo directory");
  }

  await mkdir(LOGO_DIR, { recursive: true });

  // Atomic publish: Caddy must never serve a half-written file.
  const tmpPath = `${fullPath}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, fullPath);

  return { logoPath: `${LOGO_URL_PREFIX}/${filename}`, inspection };
}

export function contentTypeForStoredLogo(logoPath: string): string | null {
  const ext = path.extname(logoPath).slice(1).toLowerCase();
  if (ext === "png" || ext === "jpg" || ext === "webp") {
    return FORMAT_TO_CONTENT_TYPE[ext];
  }
  return null;
}
