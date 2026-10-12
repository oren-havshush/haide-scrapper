// The per-field value template (owner, 2026-10-13, LRN-FORM-12). Pure, so the
// rule is tested without a browser (formTemplate.test.ts).
//
// Many sites use one application form for every job; the page's own script
// fills a hidden field (job id, job number, title) per job. A stored site-wide
// form held one constant, so a submit named no job, or the wrong one. A stored
// field value may now contain {{job.<token>}}, alone or inside literal text
// ("{{job.externalJobId}} - {{job.title}}"), from a closed list:
//   externalJobId  the stored id, after the fallback
//   idNumber       the last run of digits in it (l-b-12230 -> 12230)
//   title          the job's title
//   url            the job's detail URL
//   urlNumber      the last run of digits in the detail URL
//   urlParam:NAME  one query parameter of the detail URL (NAME: [A-Za-z0-9_-]{1,40})
// worker/jobs/scrape.ts buildJobRows fills it per job on a form whose
// captureSource is "static", after extraction, normalisation and the id
// fallback. A token that resolves to nothing leaves the field EMPTY (reported as
// form_template_unfilled); a job never receives another job's value. The blob
// keeps its shape: the public site sees concrete values and no template text.
// src/lib/validators.ts refuses any {{...}} outside the list.

export const TEMPLATE_TOKENS = ["externalJobId", "idNumber", "title", "url", "urlNumber", "urlParam"] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

export type TemplateJob = { externalJobId: string | null; title: string | null; url: string | null };

/** A well-formed token, exactly: {{job.NAME}} or {{job.urlParam:NAME}}. */
const TOKEN = /^\{\{job\.(externalJobId|idNumber|title|url|urlNumber)\}\}$|^\{\{job\.urlParam:([A-Za-z0-9_-]{1,40})\}\}$/;
const WELL_FORMED = /\{\{job\.(externalJobId|idNumber|title|url|urlNumber|urlParam:[A-Za-z0-9_-]{1,40})\}\}/g;

/** Every "{{" in a value, up to its "}}" (or to the next "{{", or the end, when unclosed). */
function templatesIn(value: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let at = value.indexOf("{{", from); at !== -1; at = value.indexOf("{{", from)) {
    const close = value.indexOf("}}", at + 2);
    const next = value.indexOf("{{", at + 2);
    const closed = close !== -1 && (next === -1 || close < next);
    const end = closed ? close + 2 : next === -1 ? value.length : next;
    out.push(value.slice(at, end));
    from = end;
  }
  return out;
}

/** The templates in `value` that are not closed tokens (for validators.ts); [] when all are fine. */
export function templateTokenErrors(value: string): string[] {
  return templatesIn(value).filter((t) => !TOKEN.test(t));
}

/** True when `value` holds at least one well-formed token. */
export function hasTemplate(value: string): boolean {
  WELL_FORMED.lastIndex = 0;
  return WELL_FORMED.test(value);
}

const lastDigits = (s: string | null): string | null => {
  const m = (s ?? "").match(/\d+/g);
  return m ? m[m.length - 1]! : null;
};

/** One token's value for this job, or null when the job has none. */
export function resolveTemplateToken(token: string, param: string | null, job: TemplateJob): string | null {
  const nonEmpty = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  switch (token) {
    case "externalJobId":
      return nonEmpty(job.externalJobId);
    case "idNumber":
      return lastDigits(nonEmpty(job.externalJobId));
    case "title":
      return nonEmpty(job.title);
    case "url":
      return nonEmpty(job.url);
    case "urlNumber":
      return lastDigits(nonEmpty(job.url));
    case "urlParam": {
      if (!param || !job.url) return null;
      try {
        return nonEmpty(new URL(job.url).searchParams.get(param));
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

/**
 * Fill one stored form blob for one job. Only a "static" blob is filled; any
 * other blob, and one with no template, is returned exactly as it came. A field
 * with any token that does not resolve is left EMPTY, never half-filled, and is
 * named in `unfilled` as "<field> (<token>)".
 */
export function fillFormTemplate(blobJson: string, job: TemplateJob): { blob: string; unfilled: string[] } {
  let blob: { captureSource?: unknown; fields?: unknown };
  try {
    blob = JSON.parse(blobJson);
  } catch {
    return { blob: blobJson, unfilled: [] };
  }
  if (!blob || typeof blob !== "object" || blob.captureSource !== "static" || !Array.isArray(blob.fields)) {
    return { blob: blobJson, unfilled: [] };
  }
  const fields = blob.fields as Array<Record<string, unknown>>;
  if (!fields.some((f) => typeof f.value === "string" && hasTemplate(f.value))) return { blob: blobJson, unfilled: [] };

  const unfilled: string[] = [];
  const filled = fields.map((f) => {
    if (typeof f.value !== "string" || !hasTemplate(f.value)) return f;
    let missing: string | null = null;
    WELL_FORMED.lastIndex = 0;
    const value = f.value.replace(WELL_FORMED, (_all, spec: string) => {
      const [token, param] = spec.startsWith("urlParam:") ? ["urlParam", spec.slice("urlParam:".length)] : [spec, null];
      const v = resolveTemplateToken(token, param, job);
      if (v === null && missing === null) missing = token;
      return v ?? "";
    });
    if (missing !== null) {
      unfilled.push(`${String(f.name ?? "")} (${missing})`);
      return { ...f, value: "" };
    }
    return { ...f, value };
  });
  return { blob: JSON.stringify({ ...blob, fields: filled }), unfilled };
}

export const FORM_TEMPLATE_UNFILLED_WARNING = "form_template_unfilled";

/**
 * One row's raw fields with its own _formData filled (buildJobRows). Each
 * unfilled "<field> (<token>)" is counted in `tally`. The input is not mutated;
 * a row with no form, or a form with no template, comes back as it was.
 */
export function fillRowFormTemplate(
  raw: Record<string, string>,
  job: TemplateJob,
  tally: Map<string, number>,
): Record<string, string> {
  const fd = raw["_formData"];
  if (typeof fd !== "string" || !fd) return raw;
  const { blob, unfilled } = fillFormTemplate(fd, job);
  for (const u of unfilled) tally.set(u, (tally.get(u) ?? 0) + 1);
  return blob === fd ? raw : { ...raw, _formData: blob };
}

/** The run warnings: one per unfilled field and token, with how many jobs. */
export function formTemplateWarnings(tally: Map<string, number>): string[] {
  return [...tally.entries()].map(([what, n]) => `${FORM_TEMPLATE_UNFILLED_WARNING}: ${what} on ${n} job(s)`);
}
