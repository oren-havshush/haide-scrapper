/**
 * The dashboard's company edit form (o), owner 2026-10-06. A form over the
 * existing routes, nothing more: this module decides WHICH requests the form
 * sends, and the routes decide everything else (the city.csv gate, magic bytes,
 * the logo floor, the fix-queue items).
 *
 * Client-safe on purpose: it imports the bundled city list and the region test
 * from the worker modules directly, never src/lib/locations.ts (which pulls in
 * next/server through errors.ts).
 */
import { IL_CANONICAL } from "../../worker/data/il-places";
import { isCanonicalLocation, isRegionLocation } from "../../worker/lib/locationNormalize";

/**
 * The cities the form offers: every city.csv entry that is a place, not a
 * region (a headquarters is at an address). Each passes resolveHqCity()
 * unchanged; the server still gates whatever is sent.
 */
export function hqCityOptions(): string[] {
  const out = new Set<string>();
  for (const c of IL_CANONICAL) {
    if (isCanonicalLocation(c) && !isRegionLocation(c)) out.add(c);
  }
  return [...out].sort((a, b) => a.localeCompare(b, "he"));
}

/**
 * True only for an exact option. The form sends nothing else: the route's gate
 * canonicalises loosely (normalizeLocations maps "תקווה" to תקומה, a different
 * town), so a typed near-miss must be stopped here, before any request.
 */
export function isOfferedHqCity(value: string): boolean {
  return offered().has(value);
}

let offeredSet: Set<string> | null = null;
function offered(): Set<string> {
  if (!offeredSet) offeredSet = new Set(hqCityOptions());
  return offeredSet;
}

export interface CompanyEditBefore {
  companyHomepageUrl: string | null;
  companyAbout: string | null;
  companyHqAddress: string | null;
  companyHqCity: string | null;
}

/** One form field: the text in its box, and whether its clear control is on. */
export interface DraftField {
  value: string;
  clear: boolean;
}

export interface CompanyEditDraft {
  homepage: DraftField;
  about: DraftField;
  address: DraftField;
  city: DraftField;
}

/**
 * The requests to send. `homepage` goes to PUT /company-homepage, `city` to
 * PUT /company-hq-city, `profile` to PUT /company-profile?force=1. An absent
 * key means "no request" (or, inside `profile`, "key not sent").
 */
export interface CompanyEditPlan {
  homepage?: string | null;
  city?: string | null;
  profile: { companyAbout?: string | null; companyHqAddress?: string | null };
}

/**
 * What changed. A value goes only when it differs from the stored one after
 * trimming. A null goes only from the clear control, and only when there is
 * something to clear: an emptied textbox is never read as "clear it", because
 * on the presence-based routes a null CLEARS the column.
 */
function change(before: string | null, field: DraftField): string | null | undefined {
  if (field.clear) return before === null ? undefined : null;
  const value = field.value.trim();
  if (!value || value === (before ?? "").trim()) return undefined;
  return value;
}

export function companyEditPlan(before: CompanyEditBefore, draft: CompanyEditDraft): CompanyEditPlan {
  const homepage = change(before.companyHomepageUrl, draft.homepage);
  const city = change(before.companyHqCity, draft.city);
  const about = change(before.companyAbout, draft.about);
  const address = change(before.companyHqAddress, draft.address);
  return {
    ...(homepage !== undefined ? { homepage } : {}),
    ...(city !== undefined ? { city } : {}),
    profile: {
      ...(about !== undefined ? { companyAbout: about } : {}),
      ...(address !== undefined ? { companyHqAddress: address } : {}),
    },
  };
}
