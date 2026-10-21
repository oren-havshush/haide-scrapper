/**
 * The config mirror's write rules (developer report, 2026-10-12). Pure, so
 * scripts/export-site-configs.ts is tested without the API.
 *
 * Two ways the export clobbered other sessions' work:
 *   - `--site <id>` regenerated INDEX.md from that one site, deleting every
 *     other row (LRN-API-4). A per-site export now writes only that site's
 *     .json and .setup.js and leaves INDEX.md alone.
 *   - a full export rewrote every mirror file, including ones another session
 *     had just exported from a newer config and not yet committed. A full
 *     export now refuses to overwrite a file whose config is newer (its
 *     fieldMappings._meta.savedAt is later) than the one it would write, and
 *     leaves a file alone when only `_exportedAt` would change.
 */

export type MirrorDoc = {
  _exportedAt?: string;
  fieldMappings?: { _meta?: { savedAt?: unknown }; [k: string]: unknown };
  [k: string]: unknown;
};

export type MirrorWrite = "write" | "skip_identical" | "refuse_newer";

function savedAtMs(doc: MirrorDoc | null): number | null {
  const v = doc?.fieldMappings?._meta?.savedAt;
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function withoutStamp(doc: MirrorDoc): string {
  const rest: Record<string, unknown> = { ...doc };
  delete rest._exportedAt;
  return JSON.stringify(rest);
}

/**
 * What to do with one site's mirror pair. `existingJson` is the file on disk
 * (null when absent or unreadable); the setup scripts are compared verbatim.
 */
export function planMirrorWrite(
  existingJson: string | null,
  existingScript: string | null,
  next: MirrorDoc,
  nextScript: string | null,
): MirrorWrite {
  if (existingJson === null) return "write";
  let existing: MirrorDoc;
  try {
    existing = JSON.parse(existingJson) as MirrorDoc;
  } catch {
    return "write";
  }
  const have = savedAtMs(existing);
  const want = savedAtMs(next);
  if (have !== null && want !== null && have > want) return "refuse_newer";
  if (withoutStamp(existing) === withoutStamp(next) && (existingScript ?? null) === (nextScript ?? null)) return "skip_identical";
  return "write";
}

/** INDEX.md is regenerated only by an export that saw every site it lists. */
export function writesIndex(opts: { oneSite: string | undefined }): boolean {
  return !opts.oneSite;
}

/**
 * One INDEX.md table cell: a "|" in the text is written "\|", so a company
 * name such as "Gal HR | גל אייץ׳ אר" stays one cell (report fixes 3, item 11).
 */
export function mdCell(text: string): string {
  return text.replace(/\|/g, String.raw`\|`);
}
