/**
 * scripts/lib/logoBackgroundPass.ts — the pass over stored logos (report
 * fixes 3, item 19), without the database, so a test can drive it.
 *
 * Every logo is judged by the same rule through the same function the upload
 * uses (storeLogo, src/lib/logo-store.ts). The source is the kept original
 * (<siteId>.orig.<ext>) when one exists, so a second pass with another colour
 * rebuilds from it, else the stored file. Without `apply` nothing is written.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FORMAT_TO_CONTENT_TYPE, inspectImage, OPERATOR_MIN_LOGO_DIMENSION, type LogoFormat } from "../../src/lib/image-validate";
import { logoBackgroundNote, withLogoBackground } from "../../src/lib/logo-background";
import { LOGO_DIR, storeLogo } from "../../src/lib/logo-store";

export interface PassSite {
  id: string;
  companyLogoPath: string;
}

export type PassVerdict = "would change" | "changed" | "unchanged" | "unreadable";

export interface PassLine {
  siteId: string;
  verdict: PassVerdict;
  detail: string;
  /** The Site row's new companyLogoPath, when the stored extension changed (webp -> png). */
  newLogoPath?: string;
  note?: string;
}

const STORED = /^\/logos\/([a-z0-9]{20,32})\.(png|jpg|webp)$/;

function share(n: number | null): string {
  return n === null ? "-" : `${Math.round(n * 100)}%`;
}

/** Reads and writes LOGO_DIR only: the directory storeLogo writes, never a second one. */
export async function passOneLogo(site: PassSite, apply: boolean): Promise<PassLine> {
  const dir = LOGO_DIR;
  const m = STORED.exec(site.companyLogoPath);
  if (!m || m[1] !== site.id) {
    return { siteId: site.id, verdict: "unreadable", detail: `unexpected path ${site.companyLogoPath}, skipped` };
  }
  const storedPath = path.join(dir, `${site.id}.${m[2]}`);
  if (!existsSync(storedPath)) return { siteId: site.id, verdict: "unreadable", detail: `no file for ${site.companyLogoPath}` };
  const stored = readFileSync(storedPath);

  const orig = (["png", "webp"] as const).map((f) => ({ f, p: path.join(dir, `${site.id}.orig.${f}`) })).find((o) => existsSync(o.p));
  const source = orig ? new Uint8Array(readFileSync(orig.p)) : new Uint8Array(stored);
  const sourceName = orig ? path.basename(orig.p) : path.basename(storedPath);

  let format: LogoFormat;
  try {
    format = inspectImage(source, null, { minDimension: OPERATOR_MIN_LOGO_DIMENSION }).format;
  } catch (error) {
    return { siteId: site.id, verdict: "unreadable", detail: `${sourceName}: ${(error as Error).message}` };
  }

  const judged = await withLogoBackground(source, format);
  if (judged.kind === "unreadable") return { siteId: site.id, verdict: "unreadable", detail: `${sourceName}: ${judged.error}` };
  if (judged.kind === "unchanged") {
    const v = judged.verdict;
    const why = v ? `transparent ${share(v.transparentShare)}, opaque mean luminance ${v.opaqueMeanLuminance?.toFixed(2) ?? "-"}, dark ${share(v.opaqueDarkShare)}` : "jpg";
    return { siteId: site.id, verdict: "unchanged", detail: `${sourceName} (${why})` };
  }
  if (Buffer.compare(Buffer.from(judged.bytes), stored) === 0) {
    return { siteId: site.id, verdict: "unchanged", detail: `${sourceName}: already on ${judged.background}` };
  }

  const v = judged.verdict;
  const detail = `${sourceName}: light on transparent (transparent ${share(v.transparentShare)}, opaque mean luminance ${v.opaqueMeanLuminance?.toFixed(2)}, dark ${share(v.opaqueDarkShare)}) -> on ${judged.background}`;
  const note = logoBackgroundNote(judged.background);
  if (!apply) return { siteId: site.id, verdict: "would change", detail, note };

  const written = await storeLogo(site.id, source, FORMAT_TO_CONTENT_TYPE[format], { operator: true });
  return {
    siteId: site.id,
    verdict: "changed",
    detail: `${detail}; stored ${written.logoPath}`,
    note,
    ...(written.logoPath !== site.companyLogoPath ? { newLogoPath: written.logoPath } : {}),
  };
}
