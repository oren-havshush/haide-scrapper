/**
 * locationMap.ts — a site's own area labels, mapped to city.csv rows before the
 * normaliser sees them (city-file design, commit D; Maof, 2026-10-13).
 *
 * Maof prints a job's areas as separate elements ("קריות", "עמקים וטבריה"),
 * labels of its own that are not places. Two pieces:
 *
 * - `all: true` on a field mapping: the field reads EVERY element its selector
 *   matches, each trimmed, joined with " | ". The extractor otherwise reads the
 *   first match only, and the container's text ("קריות  עמקים וטבריה") cannot
 *   be split, since the labels contain spaces.
 * - `locationMap` in the site config (`_meta.locationMap`): label -> a verbatim
 *   city.csv row, or null for "no place" (כל הארץ, עבודה בחו"ל). Each part of
 *   the extracted location is looked up; a part not in the map is DROPPED and
 *   counted (location_label_unmapped), never handed to the normaliser, whose
 *   scanner would read the city טבריה out of "עמקים וטבריה" — a wrong value
 *   for a job in the Krayot and the valleys.
 *
 * A mapped location is final: when the map leaves nothing, the job takes the
 * site's locationFallback or Unknown, and the normaliser does not go looking
 * for a place in the title or the description (LOCATION_FROM_MAP).
 */

import type { Page } from "playwright";
import { DOM_FIELD_EXTRACT_SOURCE } from "./domFieldExtract";

/** The separator `all: true` joins with; normalizeLocations splits on "|". */
export const ALL_MATCHES_SEPARATOR = " | ";

/** Marks a row whose location came through the site's locationMap (worker/lib/normalizer.ts reads it). */
export const LOCATION_FROM_MAP = "_locationFromMap";

export const LOCATION_LABEL_UNMAPPED = "location_label_unmapped";

export type LocationMap = Readonly<Record<string, string | null>>;

/** Every match's text, trimmed, empty ones left out, joined with " | ". */
export function joinAllMatches(texts: ReadonlyArray<string | null | undefined>): string {
  return texts
    .map((t) => (t ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t !== "")
    .join(ALL_MATCHES_SEPARATOR);
}

/** `all: true`: read every element `selector` matches on the page, through the extractor's own DOM read. */
export async function readAllMatches(page: Page, selector: string, fieldName: string, attrName?: string): Promise<string> {
  const handles = await page.$$(selector);
  const texts: string[] = [];
  for (const h of handles) {
    texts.push(
      await h.evaluate(
        (el, payload: { extractSrc: string; fieldName: string; attrName?: string }) => {
          const fn = (0, eval)("(" + payload.extractSrc + ")");
          return fn(el, payload.fieldName, payload.attrName) as string;
        },
        { extractSrc: DOM_FIELD_EXTRACT_SOURCE, fieldName, attrName: attrName && attrName.length > 0 ? attrName : undefined },
      ),
    );
  }
  return joinAllMatches(texts);
}

/** The site's locationMap from its stored fieldMappings, or null when it has none. */
export function readLocationMap(fieldMappings: unknown): LocationMap | null {
  if (!fieldMappings || typeof fieldMappings !== "object") return null;
  const meta = (fieldMappings as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== "object") return null;
  const map = (meta as Record<string, unknown>).locationMap;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (typeof v === "string" || v === null) out[k.trim()] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * One job's extracted location through the map: each "|"-separated part is
 * looked up by its trimmed text. Mapped values are joined with ", " (the
 * normaliser's list separator), in order, once each; null drops the part;
 * an unknown part is dropped and returned in `unmapped`.
 */
export function applyLocationMap(raw: string | null | undefined, map: LocationMap): { value: string; unmapped: string[] } {
  const values: string[] = [];
  const unmapped: string[] = [];
  for (const part of String(raw ?? "").split("|")) {
    const label = part.replace(/\s+/g, " ").trim();
    if (!label) continue;
    if (!Object.prototype.hasOwnProperty.call(map, label)) {
      unmapped.push(label);
      continue;
    }
    const v = map[label];
    if (v && !values.includes(v)) values.push(v);
  }
  return { value: values.join(", "), unmapped };
}

/** One warning per unmapped label, with the jobs it appeared on: `location_label_unmapped: <label> (N job(s))`. */
export function unmappedLabelWarnings(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.entries()].map(([label, n]) => `${LOCATION_LABEL_UNMAPPED}: ${label} (${n} job(s))`);
}
