// The site's lane (big-lane design, item 2, 2026-10-13).
//
// A site with `_meta.lane = "big"` is scraped only in the big-lane window
// (22:00-01:45 Asia/Jerusalem, haide-sweep-big) and never by the nightly. It
// is set through the config schema's top-level `lane` key, because
// saveSiteConfig rebuilds _meta from top-level keys: a key kept only inside
// _meta would be dropped on the next save. Absent means the nightly.

export const SITE_LANES = ["big"] as const;
export type SiteLane = (typeof SITE_LANES)[number];

/** The site's lane from its stored fieldMappings; null for the nightly. */
export function readSiteLane(fieldMappings: unknown): SiteLane | null {
  if (!fieldMappings || typeof fieldMappings !== "object") return null;
  const meta = (fieldMappings as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== "object") return null;
  const lane = (meta as Record<string, unknown>).lane;
  return (SITE_LANES as readonly unknown[]).includes(lane) ? (lane as SiteLane) : null;
}
