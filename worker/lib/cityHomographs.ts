// Location words the value checks treat with suspicion (addsite2 phase two,
// step 2b). Moved from worker/jobs/scrape.ts so the checks in
// worker/lib/valueChecks.ts can carry job ids; the lists are unchanged.

/**
 * Values that are never — or rarely — a workplace. Each of these is a bug we
 * have actually shipped: gazetteer false positives where a common Hebrew word
 * doubles as a place name ("באזור" = in the area of, "במשמרות" = in shifts,
 * "משרה מלאה" = full-time), and unfilled <select> placeholders scraped verbatim.
 *
 * Since the city gate, only the homographs can still be stored: אזור, משמרות,
 * מלאה and מצליח are themselves city.csv values (a town, a kibbutz, two
 * moshavim). The check flags them with the jobs that carry them and never
 * rewrites one: a job can genuinely be in Azor.
 */
export const NON_PLACE_LOCATIONS: ReadonlySet<string> = new Set([
  "אזור",
  "משמרות",
  "מלאה",
  "מצליח",
  "בחר",
  "בחר אזור",
  "בחר עיר",
  "בחר תחום",
]);

/**
 * Coarse values that are legitimate on their own — plenty of boards only
 * publish a region — but wrong when the ad names an actual city. Used only for
 * the region-over-city check, never flagged by themselves.
 */
export const COARSE_LOCATIONS: ReadonlySet<string> = new Set([
  "צפון",
  "דרום",
  "מרכז",
  "מזרח",
  "מערב",
  "הצפון",
  "הדרום",
  "המרכז",
  "אזור צפון",
  "אזור דרום",
  "אזור מרכז",
  "השרון",
  "השפלה",
]);
