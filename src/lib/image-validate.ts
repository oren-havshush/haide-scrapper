/**
 * src/lib/image-validate.ts
 *
 * Pure, dependency-free image validation shared by the two places that must
 * agree about what a company logo is:
 *
 *   - scripts/lib/fetch-image.ts  (client side, before upload)
 *   - src/lib/logo-store.ts       (server side, re-validated independently)
 *
 * Deliberately has NO imports. It is loaded both by the Next.js app (via
 * "@/lib/image-validate") and by CLI scripts run under tsx (via a relative
 * path), so it must stay free of runtime and framework dependencies.
 *
 * Two rules here are load-bearing and should not be relaxed without reading
 * the reasoning:
 *
 *  1. The declared Content-Type is NEVER trusted. The stored file extension is
 *     derived from the magic bytes, so a server claiming "image/png" while
 *     serving HTML cannot get an .html file written into the logo store.
 *
 *  2. SVG is rejected outright. An SVG is an XML document the browser
 *     executes (<script>, <foreignObject>, external entities). Self-hosting
 *     one on the public jobs site's own origin is stored XSS. Making SVG safe
 *     means rasterising it; there is no `sharp` in this project (it sits in
 *     pnpm-workspace.yaml's ignoredBuiltDependencies) and adding a native
 *     dependency for a logo is a bad trade. Raster only.
 */

/** Hard ceiling on logo bytes. Enforced by streaming, never via Content-Length. */
export const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Floors that make "no favicon fallback" structural rather than aspirational.
 * A 16x16 favicon rendered as a company logo is worse than no logo: it
 * pixelates, it is frequently a generic CMS default shared by dozens of
 * employers, and — the real problem — it passes every automated check that
 * exists, so nobody discovers the fleet is full of them.
 */
export const MIN_LOGO_DIMENSION = 64;
export const MIN_LOGO_BYTES = 512;

export type LogoFormat = "png" | "jpg" | "webp";

/** Content-Type values accepted on the wire, mapped to the format they claim. */
const CONTENT_TYPE_TO_FORMAT: Record<string, LogoFormat> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

/** Canonical Content-Type to serve each stored format back as. */
export const FORMAT_TO_CONTENT_TYPE: Record<LogoFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export interface ImageInspection {
  format: LogoFormat;
  width: number;
  height: number;
  byteLength: number;
}

export class ImageRejected extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = "ImageRejected";
  }
}

/**
 * Normalise a Content-Type header ("image/png; charset=binary" -> "png").
 * Returns null for anything not on the allowlist, including SVG, GIF, ICO,
 * a missing header, and wildcards.
 */
export function formatFromContentType(header: string | null | undefined): LogoFormat | null {
  if (!header) return null;
  const bare = header.split(";")[0]!.trim().toLowerCase();
  return CONTENT_TYPE_TO_FORMAT[bare] ?? null;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i]!);
  return s;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (b[i] !== PNG_SIGNATURE[i]) return null;
  }
  // The first chunk must be IHDR; width/height are the first 8 bytes of its data.
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function readJpeg(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;

  // Walk the marker segments looking for a Start-Of-Frame, which carries the
  // dimensions. SOF0..SOF15 are 0xC0-0xCF except 0xC4 (DHT), 0xC8 (JPG
  // extension) and 0xCC (DAC), which are not frame headers.
  let at = 2;
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) {
      at++; // resync past padding/entropy bytes
      continue;
    }
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const segLength = (b[at + 2]! << 8) | b[at + 3]!;
    if (segLength < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (at + 9 > b.length) return null;
      return { height: (b[at + 5]! << 8) | b[at + 6]!, width: (b[at + 7]! << 8) | b[at + 8]! };
    }
    if (marker === 0xda) return null; // start of scan — dimensions would precede it
    at += 2 + segLength;
  }
  return null;
}

function readWebp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;

  const chunk = ascii(b, 12, 4);

  if (chunk === "VP8X") {
    // Extended format: 3-byte little-endian canvas width-1 / height-1 at 24/27.
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    return { width: w, height: h };
  }

  if (chunk === "VP8 ") {
    // Lossy: 3-byte sync code 9D 01 2A at 23, then 14-bit LE width/height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const w = ((b[26]! | (b[27]! << 8)) & 0x3fff);
    const h = ((b[28]! | (b[29]! << 8)) & 0x3fff);
    return { width: w, height: h };
  }

  if (chunk === "VP8L") {
    // Lossless: 0x2F signature at 20, then 14 bits width-1, 14 bits height-1.
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >>> 14) & 0x3fff) + 1;
    return { width: w, height: h };
  }

  return null;
}

/** Identify the real format from the leading bytes. Never consults any header. */
export function formatFromMagicBytes(bytes: Uint8Array): LogoFormat | null {
  if (readPng(bytes)) return "png";
  if (readJpeg(bytes)) return "jpg";
  if (readWebp(bytes)) return "webp";
  return null;
}

/**
 * Full validation: size floor and ceiling, magic-byte format detection,
 * agreement with the declared Content-Type when one is supplied, and the
 * dimension floor.
 *
 * Throws ImageRejected with a machine-readable `reason` on any failure, so
 * callers can log why a logo was skipped without string-matching messages.
 */
export function inspectImage(
  bytes: Uint8Array,
  declaredContentType?: string | null,
): ImageInspection {
  if (bytes.length < MIN_LOGO_BYTES) {
    throw new ImageRejected(
      "too_small_bytes",
      `image is ${bytes.length} bytes, below the ${MIN_LOGO_BYTES}-byte floor`,
    );
  }
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new ImageRejected(
      "too_large",
      `image is ${bytes.length} bytes, above the ${MAX_LOGO_BYTES}-byte cap`,
    );
  }

  const format = formatFromMagicBytes(bytes);
  if (!format) {
    throw new ImageRejected(
      "unsupported_format",
      "bytes are not a PNG, JPEG or WebP (SVG, GIF and ICO are rejected by design)",
    );
  }

  if (declaredContentType != null) {
    const claimed = formatFromContentType(declaredContentType);
    if (!claimed) {
      throw new ImageRejected(
        "bad_content_type",
        `Content-Type "${declaredContentType}" is not an accepted image type`,
      );
    }
    if (claimed !== format) {
      throw new ImageRejected(
        "content_type_mismatch",
        `Content-Type claims ${claimed} but the bytes are ${format}`,
      );
    }
  }

  const size =
    format === "png" ? readPng(bytes) : format === "jpg" ? readJpeg(bytes) : readWebp(bytes);
  if (!size || size.width <= 0 || size.height <= 0) {
    throw new ImageRejected("undecodable", `could not read dimensions from the ${format} header`);
  }

  if (size.width < MIN_LOGO_DIMENSION || size.height < MIN_LOGO_DIMENSION) {
    throw new ImageRejected(
      "too_small_dimensions",
      `image is ${size.width}x${size.height}, below the ${MIN_LOGO_DIMENSION}px floor ` +
        `(this is the rule that keeps favicons out of the logo store)`,
    );
  }

  return { format, width: size.width, height: size.height, byteLength: bytes.length };
}
