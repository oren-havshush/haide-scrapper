import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatErrorResponse } from "@/lib/errors";
import { contentTypeForStoredLogo, LOGO_DIR } from "@/lib/logo-store";

/**
 * Dev-mode fallback for serving company logos.
 *
 * In production Caddy's `handle_path /logos/*` block matches first and serves
 * these straight off the volume, so this handler never runs. Under `pnpm dev`
 * there is no Caddy, and without this route every logo URL would 404 locally.
 *
 * Lives outside /api/ on purpose: logos are public (the separate public jobs
 * site reads them anonymously), and src/proxy.ts only matches /api/:path*.
 */

// Only a bare filename of the shape the logo store generates. Anything with a
// separator, a dot-segment, or an unexpected extension is refused before any
// filesystem call — "../../etc/passwd" cannot reach readFile.
const LOGO_FILENAME = /^[a-z0-9]{20,32}\.(png|jpg|webp)$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  try {
    const { file } = await params;

    if (!LOGO_FILENAME.test(file)) {
      return new NextResponse(null, { status: 404 });
    }

    const fullPath = path.join(LOGO_DIR, file);
    if (!path.resolve(fullPath).startsWith(path.resolve(LOGO_DIR) + path.sep)) {
      return new NextResponse(null, { status: 404 });
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(fullPath);
    } catch {
      return new NextResponse(null, { status: 404 });
    }

    const contentType = contentTypeForStoredLogo(file);
    if (!contentType) {
      return new NextResponse(null, { status: 404 });
    }

    // Same hardening Caddy applies in production, so dev and prod behave alike.
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
