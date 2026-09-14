// What counts as a usable field mapping, and the apply-login flag.
//
// One definition, because two callers have to agree on it and the cost of
// disagreeing is a wiped site.
//
// `handleScrapeJob` refuses a site whose PARSED mappings are empty and calls
// failScrapeRun, which on a manual run deletes every listing. Sweep selection
// must therefore exclude exactly the same sites — and "has fieldMappings" is not
// the same question as "has usable fieldMappings". One live REVIEW site
// (Jobinfo) stores `{}`; a site storing only `_meta` would parse to zero too,
// since `_meta` holds training data rather than a mapping.
//
// Checking `Object.keys(raw).length > 0` on the RAW JSON would pass both and
// hand them to a path that empties them.

/** One parsed mapping: a selector plus the metadata the extractor needs. */
export interface FieldMappingEntry {
  selector: string;
  sample: string;
  sourceMethod: string;
  methodsDetected: number;
  capturedOnUrl?: string;
  extractAttr?: string;
}

/**
 * The filter `parseFieldMappings` applies: skip `_meta`, and keep only objects
 * carrying a string `selector`. Anything else contributes nothing to a scrape.
 */
export function isUsableMappingEntry(key: string, value: unknown): boolean {
  if (key === "_meta") return false;
  if (!value || typeof value !== "object") return false;
  return typeof (value as Record<string, unknown>).selector === "string";
}

/**
 * How many usable mappings a site has. Zero means `handleScrapeJob` would
 * refuse it, so sweep selection must exclude it.
 */
export function countUsableFieldMappings(fieldMappingsRaw: unknown): number {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return 0;
  if (Array.isArray(fieldMappingsRaw)) return 0;
  let n = 0;
  for (const [key, value] of Object.entries(fieldMappingsRaw as Record<string, unknown>)) {
    if (isUsableMappingEntry(key, value)) n++;
  }
  return n;
}

/**
 * Login-gated apply flow, set at onboarding. A scheduled run withholds the
 * SKIPPED transition, but selection excludes these anyway — belt and braces,
 * and it saves a browser launch on a site nothing can be applied to.
 */
export function getApplyRequiresLogin(fieldMappingsRaw: unknown): boolean {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return false;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  return meta?.["applyRequiresLogin"] === true;
}
