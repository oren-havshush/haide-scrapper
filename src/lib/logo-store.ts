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

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "@/lib/errors";
import { withLogoBackground } from "@/lib/logo-background";
import {
  FORMAT_TO_CONTENT_TYPE,
  inspectImage,
  ImageRejected,
  MIN_LOGO_DIMENSION,
  OPERATOR_MIN_LOGO_DIMENSION,
} from "@/lib/image-validate";
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
  /** Describes the stored file: the composite when a background was added. */
  inspection: ImageInspection;
  /** The hex the logo was composited on (src/lib/logo-background.ts), or null. */
  background: string | null;
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
  /** operator: a hand upload, judged against OPERATOR_MIN_LOGO_DIMENSION (32 px) instead of 64. */
  opts: { operator?: boolean } = {},
): Promise<StoredLogo> {
  assertValidSiteId(siteId);

  let inspection: ImageInspection;
  try {
    inspection = inspectImage(bytes, declaredContentType, {
      minDimension: opts.operator ? OPERATOR_MIN_LOGO_DIMENSION : MIN_LOGO_DIMENSION,
    });
  } catch (error) {
    if (error instanceof ImageRejected) {
      throw new ValidationError(`logo rejected (${error.reason}): ${error.message}`);
    }
    throw error;
  }

  // A light logo on transparency disappears on the public site's white card:
  // it is stored composited on one dark neutral, with the original kept as
  // <siteId>.orig.<ext>. Anything else is stored unchanged, as before.
  const original = { bytes, format: inspection.format };
  let stored = bytes;
  let background: string | null = null;
  const judged = await withLogoBackground(bytes, inspection.format);
  if (judged.kind === "unreadable") {
    console.warn(`[logo-store] ${siteId}: the decoder could not read the ${inspection.format}; stored unchanged (${judged.error})`);
  } else if (judged.kind === "composited") {
    try {
      inspection = inspectImage(judged.bytes, "image/png", {
        minDimension: opts.operator ? OPERATOR_MIN_LOGO_DIMENSION : MIN_LOGO_DIMENSION,
      });
      stored = judged.bytes;
      background = judged.background;
    } catch (error) {
      console.warn(`[logo-store] ${siteId}: the composite failed validation; stored unchanged (${(error as Error).message})`);
    }
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

  // The original first, so a stored composite never exists without it. A logo
  // stored unchanged removes any earlier original: a later pass must never
  // rebuild from a logo the site has since replaced.
  for (const format of ["png", "webp"] as const) {
    const origPath = path.join(LOGO_DIR, `${siteId}.orig.${format}`);
    if (background !== null && format === original.format) {
      await writeAtomic(origPath, original.bytes);
    } else {
      await rm(origPath, { force: true });
    }
  }

  await writeAtomic(fullPath, stored);

  return { logoPath: `${LOGO_URL_PREFIX}/${filename}`, inspection, background };
}

/** Atomic publish: Caddy must never serve a half-written file. */
async function writeAtomic(fullPath: string, bytes: Uint8Array): Promise<void> {
  const tmpPath = `${fullPath}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, fullPath);
}

export function contentTypeForStoredLogo(logoPath: string): string | null {
  const ext = path.extname(logoPath).slice(1).toLowerCase();
  if (ext === "png" || ext === "jpg" || ext === "webp") {
    return FORMAT_TO_CONTENT_TYPE[ext];
  }
  return null;
}
