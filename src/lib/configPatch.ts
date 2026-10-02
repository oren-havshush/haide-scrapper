// The merging config PATCH (addsite2 phase two, step 3). Pure: the route reads
// the stored config, this merges, and the route saves through the existing
// saveSiteConfig, so the ACTIVE -> REVIEW demotion and configLocked are
// inherited unchanged.
//
// Why it exists: PUT replaces, and saveSiteConfig rebuilds _meta from the
// body's top-level keys, so a PUT carrying only a new setupScript clears
// formCapture, listingUrls, pagination and locationFallback. PUT stays replace
// (skipSite and the control cohort rely on it); PATCH changes only what it
// names. Presence semantics as in saveCompanyProfile: a key present with a
// value sets it, a key present as null clears it, an absent key is untouched.

import type { z } from "zod";
import { ValidationError } from "./errors";
import { updateSiteConfigSchema } from "./validators";

export type StoredConfig = { fieldMappings: unknown; pageFlow: unknown };
export type SiteConfigBody = z.infer<typeof updateSiteConfigSchema>;

/** Keys the save stamps itself; never carried from the stored _meta. */
const STAMPED_META = new Set(["savedAt"]);
/** Keys that cannot be cleared: the schema requires them. */
const REQUIRED = new Set(["fieldMappings", "pageFlow"]);
/** The top-level keys a body may carry: exactly the PUT schema's. */
const KNOWN_KEYS = new Set(Object.keys(updateSiteConfigSchema.shape));

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The stored config in the PUT body's shape: field mappings without _meta, and
 * each _meta key at the top level (the split scripts/export-site-configs.ts
 * makes). A stored null is left out, because the schema's optional keys take
 * no null; formCapture keeps its null, which the schema allows.
 */
export function flattenStoredConfig(stored: StoredConfig): Record<string, unknown> {
  const fm = isRecord(stored.fieldMappings) ? stored.fieldMappings : {};
  const { _meta, ...fields } = fm;
  const meta = isRecord(_meta) ? _meta : {};
  const out: Record<string, unknown> = { fieldMappings: fields, pageFlow: Array.isArray(stored.pageFlow) ? stored.pageFlow : [] };
  for (const [k, v] of Object.entries(meta)) {
    if (STAMPED_META.has(k) || !KNOWN_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  out.formCapture = isRecord(meta.formCapture) ? meta.formCapture : null;
  return out;
}

/**
 * The stored config with the patch applied, validated with the full schema.
 * Throws ValidationError for an unknown key, a null on a required key, _meta
 * inside fieldMappings, an empty patch, or a merged result the schema refuses.
 */
export function mergeConfigPatch(stored: StoredConfig, patch: Record<string, unknown>): SiteConfigBody {
  if (!isRecord(patch)) throw new ValidationError("A config patch must be a JSON object.");
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new ValidationError("A config patch must name at least one key.");
  const unknown = keys.filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) throw new ValidationError(`Unknown config key(s): ${unknown.join(", ")}`);

  const merged = flattenStoredConfig(stored);
  for (const k of keys) {
    const v = patch[k];
    if (k === "fieldMappings") {
      if (!isRecord(v)) throw new ValidationError("fieldMappings in a patch is an object of fields; it cannot be cleared.");
      if ("_meta" in v) throw new ValidationError("_meta cannot be patched inside fieldMappings; send its keys at the top level.");
      const fields = { ...(merged.fieldMappings as Record<string, unknown>) };
      for (const [field, mapping] of Object.entries(v)) {
        if (mapping === null) delete fields[field];
        else fields[field] = mapping;
      }
      merged.fieldMappings = fields;
      continue;
    }
    if (v === null) {
      if (REQUIRED.has(k)) throw new ValidationError(`${k} cannot be cleared.`);
      if (k === "formCapture") merged.formCapture = null;
      else delete merged[k];
      continue;
    }
    merged[k] = v;
  }

  const parsed = updateSiteConfigSchema.safeParse(merged);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  return parsed.data;
}
