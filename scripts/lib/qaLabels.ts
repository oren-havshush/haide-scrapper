// QA's label cues for a page's publish date and department (scripts/addsite-qa.ts),
// matched as labels, never inside another word (H6, owner 2026-10-14). The
// page's text was searched for "פורסם" and "תחום" anywhere, so
// "המכרז יפורסם לפחות עד ליום" read as a publish date and "בתחום" in a job
// title as a department (Jerusalem Transportation, TECH, Colmex, TOP BIT).
//
// A label counts at the start of a line, or anywhere when a colon follows it;
// either way no letter may touch it on either side. \b is not used: it does
// not fire after a Hebrew letter (CLAUDE.md), so the letter test is explicit.

export const PUBLISH_DATE_LABELS = ["תאריך פרסום", "פורסם", "תאריך", "publish", "published", "posted on", "date posted"] as const;
export const DEPARTMENT_LABELS = ["מחלקה", "תחום", "אגף", "department", "team", "division"] as const;

const LETTER = /[A-Za-zא-ת]/;
/** Bullets and dashes a line may open with before its label. */
const LINE_LEAD = /^[\s•·*\-–—]+/;

/** True when one of `labels` stands as a label in `text` (the page's innerText, its lines kept). */
export function hasLabel(text: string, labels: readonly string[]): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(LINE_LEAD, "").toLowerCase();
    if (!line) continue;
    for (const label of labels) {
      const l = label.toLowerCase();
      let at = line.indexOf(l);
      while (at >= 0) {
        const before = at > 0 ? line[at - 1] : "";
        const after = line[at + l.length] ?? "";
        const whole = !LETTER.test(before) && !LETTER.test(after);
        if (whole && (at === 0 || /^\s*[:：]/.test(line.slice(at + l.length)))) return true;
        at = line.indexOf(l, at + 1);
      }
    }
  }
  return false;
}
