// Run: npx tsx worker/lib/description-structure.test.ts
//
// Fixtures are real production descriptions pulled from /api/jobs, trimmed only
// in length. Each one represents a distinct upstream cause of the blob defect.

import { isBlob, structureDescription } from "./descriptionStructure";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const lines = (s: string) => s.split("\n").filter((l) => l.trim().length > 0);

// --- isBlob ------------------------------------------------------------

assert(!isBlob(""), "empty is not a blob");
assert(!isBlob("short text"), "short text is not a blob");
assert(isBlob("א".repeat(250)), "long unbroken text is a blob");
assert(!isBlob("א".repeat(250) + "\n" + "ב".repeat(50)), "text with a newline is not a blob");

// --- non-blob input is returned untouched -------------------------------

const alreadyStructured = "כותרת:\n" + "פריט ראשון בשורה\n".repeat(6);
assert(
  structureDescription(alreadyStructured) === alreadyStructured,
  "structured text passes through unchanged",
);
assert(structureDescription(null) === "", "null → empty string");
assert(structureDescription(undefined) === "", "undefined → empty string");

// --- bullet glyphs (maccabi4u) ------------------------------------------

const maccabi =
  "מכבי מגייסת עובד/ת סוציאלי/ת במרכזים רפואיים עכו ונהריה אחראיות על מתן מענה מקצועי, " +
  "רגשי וחברתי לחברי מכבי ולבני משפחותיהם המתמודדים עם קשיים אישיים ופסיכו־סוציאליים " +
  "הנובעים ממצבי חולי, נכות ומשבר רפואי על המשרה • ליווי ותמיכה פסיכו־סוציאלי • " +
  "מתן מידע וייעוץ • עבודה בצוות רב מקצועי דרישות : תואר בעבודה סוציאלית • " +
  "רישום בפנקס העובדים הסוציאליים • ניסיון קודם יתרון";
const maccabiOut = structureDescription(maccabi);
assert(!isBlob(maccabiOut), "maccabi blob is resolved");
assert(lines(maccabiOut).length >= 6, "maccabi splits into bullet items");
assert(
  lines(maccabiOut).some((l) => l.startsWith("דרישות")),
  "maccabi heading starts its own line",
);

// --- checkmark glyphs (strauss-group) -----------------------------------

const strauss =
  "צוות השירות הטלפוני של שטראוס מים מתרחב ולך יש הזדמנות להשתלב! ✔ הסעות מאזור המרכז " +
  "✔ אופציה לעבודה מהבית לאחר 3 חודשים! ✔ אופציות קידום מהירות ✔ נופשי חברה, ערבי גיבוש " +
  "✔ אווירה מעולה ומענק כניסה כספי גבוה! נשמע מעניין?";
const straussOut = structureDescription(strauss);
assert(!isBlob(straussOut), "checkmark-marked blob is resolved");
assert(lines(straussOut).length >= 5, "checkmarks split into items");

// --- spaced-bang separator (l-b.co.il) ----------------------------------

const linBichler =
  "נציגי/ות שירות לחברה מובילה בתנאים מעולים ובשכר מתגמל במיוחד באזורים רבים בארץ ! " +
  "מתאימה לחיילים/ות משוחררים/ות, סטודנטים/ות, אקדמאים/ות, אמהות, דוברי שפות ועוד ! " +
  "משמרות נוחות וגמישות לסטודנטים/ות ואמהות ! שכר גבוה + תנאים סוציאלים טובים, " +
  "תשלום על שעות נוספות, נסיעות וכו' ! דרישות : ניסיון קודם בתחום";
const lbOut = structureDescription(linBichler);
assert(!isBlob(lbOut), "bang-separated blob is resolved");
assert(lines(lbOut).length >= 4, "bang separator splits into items");

// A single `!` is emphasis, not a separator — must not split.
const singleBang =
  "אנחנו מחפשים אנשים מצוינים לצוות שלנו! " + "המשרה כוללת עבודה מאתגרת ומעניינת ".repeat(6);
assert(
  structureDescription(singleBang) === singleBang,
  "a lone ! is emphasis and must not split",
);

// --- headings welded with no whitespace (freesbe / LEASE4U) -------------

const lease4u =
  "התפקיד משלב עבודת שטח עם שירות לקוחות וכולל ליווי רכבים ומתן שירות אישי ואיכותי לכלל לקוחות החברה. " +
  "תיאור המשרה:מתן שירות איכותי ללקוחות בקצב ובשקיפות מוחלטת לקיחת הרכבים לטיפולים וטסטים " +
  "דרישות התפקיד:רישיון רכב על גיר ידני - חובה נכונות למשרה מלאה כולל ימי שישי ושעות נוספות";
const leaseOut = structureDescription(lease4u);
assert(!isBlob(leaseOut), "glued-heading blob is resolved");
assert(
  lines(leaseOut).some((l) => l.startsWith("תיאור המשרה")),
  "glued heading is pulled onto its own line",
);

// --- hyphen item markers (clalbit) --------------------------------------

const clal =
  "למטה חטיבת חסכון ארוך טווח דרוש.ה אנליסט או אנליסטית מה תעשו?" +
  "-תבצעו מעקב ובקרה תקציבית לתקציבי החטיבה (כ\"א, מיכון, ייעוץ וכו')" +
  "-תערכו מידע ניהולי ואנליזות במגוון נושאים בתחום חסכון ארוך טווח" +
  "-תכינו דוחות דיווח ומצגות להנהלה ולדירקטוריון לצורך תמיכה בקבלת החלטות";
const clalOut = structureDescription(clal);
assert(!isBlob(clalOut), "hyphen-marked blob is resolved");
assert(lines(clalOut).length >= 4, "hyphen markers split into items");

// A time range must never be treated as a hyphen item marker.
const timeRange =
  "המשרה היא משרה מלאה בימים א'-ה' בין השעות 08:30-17:30 במשרדי החברה במרכז הארץ. " +
  "העבודה כוללת מגוון משימות מעניינות ומאתגרות בסביבה תומכת ונעימה מאוד לעובדים.";
assert(
  !structureDescription(timeRange).includes("\n17:30"),
  "digit ranges are not split as hyphen items",
);

// --- guardrails: never shred prose --------------------------------------

// Real prose with no structural markers must come back untouched, blob or not.
const prose =
  "רוצה לעבוד בתפקיד מעניין עם תנאים טובים בחברה יציבה? יש לך סבלנות ורצון לעזור לאנשים? " +
  "אנחנו מחפשים אנשים עם יכולת התנסחות טובה בעל פה, אנשים שיודעים להקשיב ולהבין את צורכי " +
  "הלקוחות. מישהו או מישהי עם גישה שירותית ויכולת לעבוד בצוות.";
assert(structureDescription(prose) === prose, "marker-free prose is left alone");

// A marker so frequent it is punctuation must be rejected by the density guard.
const overMarked = "• א ".repeat(60);
const overOut = structureDescription(overMarked);
assert(overOut === overMarked, "over-dense markers are rejected, input unchanged");

console.log("PASS: all description-structure assertions");
