// The site-level apply form (formCapture) attached to a run's records. A record
// that already carries its own form — one the setup script built for that job —
// keeps it (owner, 2026-10-14, H2): on barakl and experis the static form was
// written over every job's own, and 171 + 217 jobs would have published a form
// that names no job.

const FORM_KEY = "_formData";

/** True when some record has no form of its own, so the site's form is worth capturing. */
export function needsSiteForm(records: ReadonlyArray<Record<string, string>>): boolean {
  return records.some((r) => !r[FORM_KEY]);
}

/** Gives the site's form to every record without one; returns how many got it. */
export function attachSiteForm(records: Array<Record<string, string>>, formData: string): number {
  let n = 0;
  for (const r of records) {
    if (r[FORM_KEY]) continue;
    r[FORM_KEY] = formData;
    n++;
  }
  return n;
}
