/**
 * src/lib/logo-background.ts
 *
 * Light logos on a transparent background (report fixes 3, item 19). The
 * public site renders every logo on white (#FFFFFF), inside a white circle or
 * card. A dark or colour mark on transparency is fine there; a white or very
 * light one disappears. Such a logo is composited onto one solid dark neutral
 * for the fleet: a brand colour cannot be read honestly from a page.
 *
 * Decided on the pixels only, never on a file name or a guess. Called by
 * storeLogo (src/lib/logo-store.ts) after inspectImage accepted the bytes, so
 * the capture, the dashboard's hand upload and scripts/rehydrate-logos.ts all
 * pass through it, and by scripts/logo-background-pass.ts through storeLogo.
 *
 * Supersedes the 2026-08-26 decision to only flag such logos: the original
 * bytes are kept beside the composite (<siteId>.orig.<ext>), so the change is
 * reversible and can be redone with another colour without a re-fetch.
 */

import type { LogoFormat } from "@/lib/image-validate";

/** The one background for the fleet. The owner may pick another hex. */
export const LOGO_BACKGROUND = "#1F2937";

/** A pixel with alpha below this counts as transparent. */
const TRANSPARENT_ALPHA_MAX = 32;
/** A pixel with alpha at or above this counts as opaque. */
const OPAQUE_ALPHA_MIN = 224;
/** At least this share of all pixels must be transparent. */
const MIN_TRANSPARENT_SHARE = 0.25;
/** The opaque pixels' mean relative luminance must reach this. */
const MIN_OPAQUE_MEAN_LUMINANCE = 0.75;
/** A pixel darker than this is dark... */
const DARK_LUMINANCE = 0.35;
/** ...and no more than this share of the opaque pixels may be dark. */
const MAX_OPAQUE_DARK_SHARE = 0.1;

export interface LogoPixelVerdict {
  /** Light on transparent: the logo gets the background. */
  light: boolean;
  transparentShare: number;
  /** null when no pixel is opaque. */
  opaqueMeanLuminance: number | null;
  opaqueDarkShare: number | null;
}

export type LogoBackgroundResult =
  | { kind: "unchanged"; verdict: LogoPixelVerdict | null }
  | { kind: "composited"; bytes: Uint8Array; verdict: LogoPixelVerdict; background: string }
  | { kind: "unreadable"; error: string };

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of one sRGB pixel. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The rule, over raw RGBA pixels (4 bytes per pixel). */
export function judgeLogoPixels(rgba: Uint8Array): LogoPixelVerdict {
  const pixels = Math.floor(rgba.length / 4);
  let transparent = 0;
  let opaque = 0;
  let dark = 0;
  let luminanceSum = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const alpha = rgba[i + 3]!;
    if (alpha < TRANSPARENT_ALPHA_MAX) {
      transparent++;
    } else if (alpha >= OPAQUE_ALPHA_MIN) {
      const lum = relativeLuminance(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      opaque++;
      luminanceSum += lum;
      if (lum < DARK_LUMINANCE) dark++;
    }
  }
  const transparentShare = pixels > 0 ? transparent / pixels : 0;
  const opaqueMeanLuminance = opaque > 0 ? luminanceSum / opaque : null;
  const opaqueDarkShare = opaque > 0 ? dark / opaque : null;
  const light =
    transparentShare >= MIN_TRANSPARENT_SHARE &&
    opaqueMeanLuminance !== null &&
    opaqueMeanLuminance >= MIN_OPAQUE_MEAN_LUMINANCE &&
    opaqueDarkShare !== null &&
    opaqueDarkShare <= MAX_OPAQUE_DARK_SHARE;
  return { light, transparentShare, opaqueMeanLuminance, opaqueDarkShare };
}

type Sharp = (typeof import("sharp"))["default"];
let sharpModule: Promise<Sharp> | null = null;

/** Loaded on first use, so a missing native build degrades to "unreadable", never a failed upload. */
function loadSharp(): Promise<Sharp> {
  sharpModule ??= import("sharp").then((m) => m.default);
  return sharpModule;
}

/**
 * Decide and, when the logo is light on transparent, composite it onto
 * `background` at the same dimensions as a png. A jpg carries no transparency
 * and is never decoded.
 */
export async function withLogoBackground(
  bytes: Uint8Array,
  format: LogoFormat,
  background: string = LOGO_BACKGROUND,
): Promise<LogoBackgroundResult> {
  if (format !== "png" && format !== "webp") return { kind: "unchanged", verdict: null };
  try {
    const sharp = await loadSharp();
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const verdict = judgeLogoPixels(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (!verdict.light) return { kind: "unchanged", verdict };
    const composite = await sharp(bytes).flatten({ background }).png().toBuffer();
    return { kind: "composited", bytes: new Uint8Array(composite), verdict, background };
  } catch (error) {
    return { kind: "unreadable", error: (error as Error).message };
  }
}

/** The capture's note line for a composited logo. */
export function logoBackgroundNote(background: string): string {
  return `logo: light on transparent, stored on ${background}`;
}
