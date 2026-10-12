// Marker words for the location scanner's refusal rules (worker/lib/locationNormalize.ts,
// owner 2026-10-12, LRN-LOC-18). Data, kept apart from the code that reads it.

/**
 * A word that may follow a scanned place without making it part of a longer
 * name: a direction or "the area around", a neighbour marker (the place after
 * it is refused by its own rule), or "or" between places.
 */
export const SCAN_STOP_AFTER: readonly string[] = [
  "והסביבה",
  "והאזור",
  "מזרח",
  "מערב",
  "צפון",
  "דרום",
  "הארץ",
  "ליד",
  "גבול",
  "סמוך",
  "בסמוך",
  "מול",
  "או",
  // An address goes on after the city with its postal code ("תל אביב מיקוד
  // 6706206"); the company profile's city gate scans addresses through here.
  "מיקוד",
  // A part of the city named after it in a company address: "הרצליה פיתוח",
  // "נס ציונה פארק המדע" (the two stored HQ addresses the rule would lose).
  "פיתוח",
  "פארק",
];

/** A word after which a scanned place is a neighbour, not where the job is ("ליד בית שמש"). */
export const SCAN_NEIGHBOUR_BEFORE: readonly string[] = ["ליד", "גבול", "סמוך", "בסמוך", "מול"];

/**
 * Names refused by the scanner only (an exact value still resolves). אלון is a
 * street ("יגאל אלון") and the first word of "אלון תבור" far more often than
 * the settlement.
 */
export const SCAN_ONLY_DENYLIST: readonly string[] = ["אלון"];
