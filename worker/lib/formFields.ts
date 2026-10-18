// Apply-form capture rules (addsite2 phase two, step 2a, with the site
// developer's requirements, owner 2026-10-01). Pure: the worker's in-page code
// (worker/lib/formExtract.ts) only gathers one raw description per element, and
// every rule lives here, where it can be tested without a browser. The shared
// capture template (sites/_shared/form-capture-template.js) applies the same
// rules inline, and worker/lib/formExtract.test.ts runs both on one page.
//
//   - every hidden input is kept, with its value; the honeypot filter never
//     drops a hidden input (a per-job id is often a hidden input);
//   - a radio group is ONE field with options (value + label, like a select);
//   - a file input keeps accept and multiple;
//   - the form keeps its enctype when it has one;
//   - every blob carries capturedAt, captureSource and extractorVersion.

import { completeFormBlob } from "./formShape";

/**
 * 5 = this shape, with a top-level honeypots array: the names of the trap
 * fields left out of fields, so a consumer that reads the live form knows them
 * (CallBiz's Contact Form 7 "email", 2026-10-18). Also the hidden-ancestor,
 * wrapper-word and leave-empty label rules, and a text field the page filled
 * kept with its value, marked prefilled. 4 = the shape before, with required
 * read from the attribute, aria-required or data-validate, and the label
 * fallback for shared ids and reused labels (8ada1a1). 3 = the same shape before those rules, with actionAttribute,
 * pageUrl, submitMechanism and shapeHash (worker/lib/formShape.ts). 2 = step
 * 2a without them. 1 = the shape before step 2a (no values, no stamps).
 */
export const FORM_EXTRACTOR_VERSION = 5;

/**
 * The honeypot name rule, identical to the capture template's. "malkodet"
 * is Hebrew for a trap (מלכודת; Comblack's malkodetdvash, H4).
 */
export const HONEYPOT_NAME = /\b(hp[_-]|honeypot|maspik|nickname|malkodet)/i;

/**
 * A label or placeholder telling a person to leave the field alone is a trap's
 * (CallBiz: "Please leave this field empty."). The Hebrew forms are matched as
 * substrings: \b does not fire after a Hebrew letter.
 */
const LEAVE_EMPTY_LATIN = /leave (this|the) field (empty|blank)|do not fill|don't fill/i;
const LEAVE_EMPTY_HEBREW = ["השאר שדה זה ריק", "השאירו שדה זה ריק", "יש להשאיר ריק", "אין למלא", "לא למלא", "נא לא למלא"];

export function asksToLeaveEmpty(text: string | null | undefined): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t !== "" && (LEAVE_EMPTY_LATIN.test(t) || LEAVE_EMPTY_HEBREW.some((h) => t.includes(h)));
}

const SKIPPED_TYPES = new Set(["submit", "button", "image", "reset"]);

/**
 * The fields a person types into. Only these are judged by how they are
 * styled or emptied (H4): a radio, a checkbox or a file input is often hidden
 * on purpose behind a styled control, and is a real field.
 */
const TEXT_LIKE = new Set(["text", "email", "tel", "url", "number", "search", "password", "textarea"]);

/** What the in-page code reports for one input, select or textarea. */
export type RawFieldDescriptor = {
  tag: string;
  type: string;
  name: string;
  label: string;
  required: boolean;
  /** The element's current value; reported for hidden inputs, radios and text-like fields. */
  value?: string;
  accept?: string | null;
  multiple?: boolean;
  options?: Array<{ value: string; label: string }>;
  /**
   * name + id + class, and the classes and ids of its ancestors up to the form
   * (CallBiz's span.cf7apps-honeypot-wrap), for the honeypot name rule.
   */
  hpHint?: string;
  /** The element's placeholder attribute, for the leave-empty rule. */
  placeholder?: string;
  /** The text of a <label> beside the element in its own parent, for the leave-empty rule. */
  nearLabel?: string;
  /** Styled off-screen the way honeypots are. */
  offscreen?: boolean;
  /**
   * Hidden by its own style (H4): display none, visibility hidden while its
   * parent is visible, opacity 0, a width or height of 1px or less, placed far
   * off-screen, or aria-hidden with tabindex -1 (Prologic's message and
   * emailHidden). Or by an ancestor below the form (R8, CallBiz's 1 px clipped
   * wrapper): display none, visibility hidden, a box of 1px or less with
   * overflow hidden, or clipped (clip rect(0,0,0,0), clip-path inset(50%|100%)).
   */
  styleHidden?: boolean;
  /** The markup gave it a value and a script emptied it before the capture (H4). */
  emptiedOnLoad?: boolean;
  /** A radio's group label: its fieldset legend, when it has one. */
  groupLabel?: string;
};

export type FormField = {
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
  tagName: string;
  value?: string;
  /** A text-like field the page gave a value; `value` is that value. */
  prefilled?: boolean;
  accept?: string;
  multiple?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export function normalizeFormFields(descriptors: RawFieldDescriptor[]): FormField[] {
  return normalizeFormFieldsWithTraps(descriptors).fields;
}

/**
 * The fields to fill, and the names of the traps left out of them. A blob
 * carries both (honeypots): traps stay out of fields, but a consumer that
 * reads the live form must know which of its fields are traps.
 */
export function normalizeFormFieldsWithTraps(descriptors: RawFieldDescriptor[]): { fields: FormField[]; honeypots: string[] } {
  const out: FormField[] = [];
  const honeypots: string[] = [];
  const radioGroups = new Map<string, FormField>();
  for (const d of descriptors) {
    const type = (d.type || "").toLowerCase();
    if (SKIPPED_TYPES.has(type)) continue;
    // A text-like field the page gave a value carries the job (Super-Pharm's
    // style-hidden title, towersemi's per-job fields): it is kept with that
    // value and marked prefilled (developer's report 2026-10-18, item 2).
    const prefilled = TEXT_LIKE.has(type) && (d.value ?? "").trim() !== "" && d.emptiedOnLoad !== true;
    // A trap is captured by the page and never filled: it is left out of the
    // fields to fill, as a honeypot always was. A hidden input never is. The
    // style rule (H4) judges only a text-like field with no value; one a
    // script emptied on load is a trap either way.
    // A label or placeholder asking that the field be left empty is a trap's
    // whatever its style (R8).
    const isHoneypot =
      d.offscreen === true ||
      HONEYPOT_NAME.test(d.hpHint ?? d.name) ||
      (TEXT_LIKE.has(type) && (asksToLeaveEmpty(d.label) || asksToLeaveEmpty(d.placeholder) || asksToLeaveEmpty(d.nearLabel))) ||
      (TEXT_LIKE.has(type) && (d.emptiedOnLoad === true || (d.styleHidden === true && !prefilled)));
    if (isHoneypot && type !== "hidden") {
      if (d.name && !honeypots.includes(d.name)) honeypots.push(d.name);
      continue;
    }

    if (type === "radio") {
      const group = radioGroups.get(d.name);
      const option = { value: d.value ?? "", label: d.label };
      if (group) {
        group.options!.push(option);
        group.required = group.required || d.required;
        continue;
      }
      const field: FormField = {
        name: d.name,
        label: d.groupLabel || d.name,
        fieldType: "radio",
        required: d.required,
        tagName: d.tag,
        options: [option],
      };
      if (d.name) radioGroups.set(d.name, field);
      out.push(field);
      continue;
    }

    const field: FormField = { name: d.name, label: d.label, fieldType: type, required: d.required, tagName: d.tag };
    if (type === "hidden") field.value = d.value ?? "";
    if (prefilled) {
      field.value = d.value!;
      field.prefilled = true;
    }
    if (type === "file") {
      if (d.accept) field.accept = d.accept;
      if (d.multiple) field.multiple = true;
    }
    if (d.options) field.options = d.options;
    out.push(field);
  }
  return { fields: out, honeypots };
}

/**
 * A form captured live, stamped now, and completed with its actionAttribute
 * (already resolved; "" when the form has none), pageUrl, mechanism and hash.
 */
export function liveFormBlob(
  form: {
    actionUrl: string;
    method: string;
    enctype?: string | null;
    actionAttribute?: string;
    pageUrl?: string;
    formClass?: string;
    formTag?: string;
  },
  fields: FormField[],
  now: Date,
  /** The trap fields left out of `fields`, by name (normalizeFormFieldsWithTraps). */
  honeypots: string[] = [],
): string {
  const blob = JSON.stringify({
    actionUrl: form.actionUrl,
    method: form.method,
    ...(form.enctype ? { enctype: form.enctype } : {}),
    fields,
    honeypots,
    capturedAt: now.toISOString(),
    captureSource: "live",
    extractorVersion: FORM_EXTRACTOR_VERSION,
  });
  return completeFormBlob(blob, {
    pageUrl: form.pageUrl ?? "",
    actionAttribute: form.actionAttribute ?? "",
    formClass: form.formClass,
    formTag: form.formTag,
  });
}

/**
 * The blob built from a site's saved formCapture, used when the live form is
 * not on the page. Stamped static, with the config's savedAt as capturedAt.
 * Null when nothing was saved, as before.
 *
 * A saved field value may be a per-job template, {{job.<token>}}: it is copied
 * here as text and filled per job in buildJobRows (worker/lib/formTemplate.ts,
 * LRN-FORM-12), so no stored row carries template text. The blob's shape is
 * unchanged by it, so FORM_EXTRACTOR_VERSION is too.
 */
export function staticFormBlob(formCapture: unknown, savedAt: string | null): string | null {
  if (!formCapture || typeof formCapture !== "object") return null;
  const fc = formCapture as Record<string, unknown>;
  const fields = Array.isArray(fc.fields) ? fc.fields : [];
  if (fields.length === 0) return null;
  const enctype = typeof fc.enctype === "string" && fc.enctype ? fc.enctype : null;
  // The capture's trap names, passed through when it carries them (R8).
  const honeypots = Array.isArray(fc.honeypots) ? fc.honeypots.filter((n): n is string => typeof n === "string" && n !== "") : null;
  return JSON.stringify({
    actionUrl: (fc.actionUrl as string) || "",
    method: (fc.method as string) || "GET",
    ...(enctype ? { enctype } : {}),
    fields,
    ...(honeypots ? { honeypots } : {}),
    capturedAt: savedAt,
    captureSource: "static",
    extractorVersion: FORM_EXTRACTOR_VERSION,
  });
}

/**
 * The completion context for the static blob on `pageUrl`. A saved form's action
 * attribute is not known (the recorder stores the page URL when a form has
 * none), so it is "" — unless the capture carries a verifiedAction, stored by
 * hand after reading the page by GET: an absolute http(s) URL on the page's
 * own host, passed with the container's formTag. Any other verifiedAction is
 * ignored. Without one, the context is exactly { pageUrl, actionAttribute: "" }.
 */
export function staticCompletion(
  formCapture: unknown,
  pageUrl: string,
): { pageUrl: string; actionAttribute: string; formTag?: string } {
  const fc = formCapture && typeof formCapture === "object" ? (formCapture as Record<string, unknown>) : {};
  const action = typeof fc.verifiedAction === "string" ? fc.verifiedAction.trim() : "";
  if (!action || !onHost(action, pageUrl)) return { pageUrl, actionAttribute: "" };
  const formTag = typeof fc.formTag === "string" && /^[a-z][a-z0-9-]*$/.test(fc.formTag) ? fc.formTag : undefined;
  return formTag ? { pageUrl, actionAttribute: action, formTag } : { pageUrl, actionAttribute: action };
}

/** True when `url` is an absolute http(s) URL on `pageUrl`'s host. */
function onHost(url: string, pageUrl: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname === new URL(pageUrl).hostname;
  } catch {
    return false;
  }
}

/**
 * A _formData from anywhere else — an older setupScript's capture template, a
 * row carried from before this change — gains the three keys as version 1 and
 * "live" (it was read from the page at scrape time). A stamped blob, and
 * anything that is not a JSON object, is returned exactly as it came.
 */
export function stampFormData(raw: string, fallbackAt: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
  const o = parsed as Record<string, unknown>;
  if (o.extractorVersion !== undefined) return raw;
  return JSON.stringify({ ...o, capturedAt: fallbackAt, captureSource: "live", extractorVersion: 1 });
}
