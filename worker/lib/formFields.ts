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
 * 4 = this shape, with required read from the attribute, aria-required or
 * data-validate, and the label fallback for shared ids and reused labels
 * (8ada1a1). 3 = the same shape before those rules, with actionAttribute,
 * pageUrl, submitMechanism and shapeHash (worker/lib/formShape.ts). 2 = step
 * 2a without them. 1 = the shape before step 2a (no values, no stamps).
 */
export const FORM_EXTRACTOR_VERSION = 4;

/** The honeypot name rule, identical to the capture template's. */
export const HONEYPOT_NAME = /\b(hp[_-]|honeypot|maspik|nickname)/i;

const SKIPPED_TYPES = new Set(["submit", "button", "image", "reset"]);

/** What the in-page code reports for one input, select or textarea. */
export type RawFieldDescriptor = {
  tag: string;
  type: string;
  name: string;
  label: string;
  required: boolean;
  /** The element's current value; kept only for hidden inputs and radios. */
  value?: string;
  accept?: string | null;
  multiple?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** name + id + class, for the honeypot name rule. */
  hpHint?: string;
  /** Styled off-screen the way honeypots are. */
  offscreen?: boolean;
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
  accept?: string;
  multiple?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export function normalizeFormFields(descriptors: RawFieldDescriptor[]): FormField[] {
  const out: FormField[] = [];
  const radioGroups = new Map<string, FormField>();
  for (const d of descriptors) {
    const type = (d.type || "").toLowerCase();
    if (SKIPPED_TYPES.has(type)) continue;
    const isHoneypot = d.offscreen === true || HONEYPOT_NAME.test(d.hpHint ?? d.name);
    if (isHoneypot && type !== "hidden") continue;

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
    if (type === "file") {
      if (d.accept) field.accept = d.accept;
      if (d.multiple) field.multiple = true;
    }
    if (d.options) field.options = d.options;
    out.push(field);
  }
  return out;
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
): string {
  const blob = JSON.stringify({
    actionUrl: form.actionUrl,
    method: form.method,
    ...(form.enctype ? { enctype: form.enctype } : {}),
    fields,
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
 */
export function staticFormBlob(formCapture: unknown, savedAt: string | null): string | null {
  if (!formCapture || typeof formCapture !== "object") return null;
  const fc = formCapture as Record<string, unknown>;
  const fields = Array.isArray(fc.fields) ? fc.fields : [];
  if (fields.length === 0) return null;
  const enctype = typeof fc.enctype === "string" && fc.enctype ? fc.enctype : null;
  return JSON.stringify({
    actionUrl: (fc.actionUrl as string) || "",
    method: (fc.method as string) || "GET",
    ...(enctype ? { enctype } : {}),
    fields,
    capturedAt: savedAt,
    captureSource: "static",
    extractorVersion: FORM_EXTRACTOR_VERSION,
  });
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
