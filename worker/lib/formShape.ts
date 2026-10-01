// The second half of the apply-form change (owner, 2026-10-01). The names are
// fixed by the public-site developer; do not rename them. Every _formData the
// worker writes carries:
//
//   actionAttribute  the form's action attribute resolved to an absolute URL;
//                    "" when the form has none — never the page URL substituted
//   pageUrl          the page the form was read from, always present
//   actionUrl        unchanged: today's meaning (the page URL when no action)
//   submitMechanism  native_form | ajax | unknown, from markup only
//   submitEndpoint   where an ajax form posts, when that is known
//   submitAction     the admin-ajax.php "action" parameter, when there is one
//   shapeHash        sha1 over the form's shape, values excluded
//
// and captureSource gains "script": a blob a site's setup script injected as
// applicationInfo, stamped by the normalizer when it takes the explicit field.
//
// Pure, so every rule is tested without a browser (formShape.test.ts); the
// rules on real fleet markup run in a browser in formExtract.test.ts.

import { createHash } from "node:crypto";

export type SubmitMechanism = "native_form" | "ajax" | "unknown";
export type ShapeField = { name: string; fieldType: string; tagName: string; value?: string };
export type FormMarkup = {
  actionAttribute: string;
  pageUrl: string;
  /** The form element's class attribute; absent for saved and script blobs. */
  formClass?: string;
  fields: ShapeField[];
};
export type Submission = { submitMechanism: SubmitMechanism; submitEndpoint?: string; submitAction?: string };

/** The action attribute as an absolute URL; "" when absent or blank. */
export function resolveActionAttribute(raw: string | null | undefined, pageUrl: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  try {
    return new URL(v, pageUrl).toString();
  } catch {
    // No base the attribute resolves against: keep it as written.
    return v;
  }
}

/**
 * pageUrl's origin + path, or null when pageUrl is not an absolute URL.
 * Assumes WordPress sits at the root of the domain (a site under /blog/ would get a wrong endpoint).
 */
function onOrigin(pageUrl: string, path: string): string | null {
  try {
    return new URL(path, new URL(pageUrl).origin).toString();
  } catch {
    return null;
  }
}

function hasClass(formClass: string | undefined, cls: string): boolean {
  return (formClass ?? "").split(/\s+/).includes(cls);
}

function ajaxTo(pageUrl: string, path: string, action?: string): Submission {
  const endpoint = onOrigin(pageUrl, path);
  return {
    submitMechanism: "ajax",
    ...(endpoint ? { submitEndpoint: endpoint } : {}),
    ...(action ? { submitAction: action } : {}),
  };
}

const ADMIN_AJAX = "/wp-admin/admin-ajax.php";
const ELEMENTOR_HIDDEN = new Set(["post_id", "form_id", "queried_id"]);

/**
 * How the form submits, read from its markup only. The frameworks are checked
 * before Elementor, whose markers (a hidden post_id) are the most generic.
 * An endpoint is given only when the markup establishes it.
 */
export function detectSubmitMechanism(m: FormMarkup): Submission {
  const names = m.fields.map((f) => f.name);
  const valueOf = (name: string) => m.fields.find((f) => f.name === name)?.value ?? "";

  // Contact Form 7: hidden _wpcf7 (the form id) and _wpcf7_unit_tag
  // ("wpcf7-f<id>-..."); its script posts to the REST feedback endpoint.
  if (names.some((n) => n.startsWith("_wpcf7")) || hasClass(m.formClass, "wpcf7-form")) {
    const id =
      /^\d+$/.exec(valueOf("_wpcf7").trim())?.[0] ??
      /^wpcf7-f(\d+)-/.exec(valueOf("_wpcf7_unit_tag"))?.[1] ??
      /#wpcf7-f(\d+)-/.exec(m.actionAttribute)?.[1];
    return id ? ajaxTo(m.pageUrl, `/wp-json/contact-form-7/v1/contact-forms/${id}/feedback`) : { submitMechanism: "ajax" };
  }

  // WPForms: fields wpforms[...]; AJAX submission only when the form carries
  // wpforms-ajax-form, otherwise a native post. Without the class (a saved or
  // script blob) the two cannot be told apart.
  if (names.some((n) => n.startsWith("wpforms[")) || hasClass(m.formClass, "wpforms-form")) {
    if (hasClass(m.formClass, "wpforms-ajax-form")) return ajaxTo(m.pageUrl, ADMIN_AJAX, "wpforms_submit");
    if (m.formClass !== undefined && m.actionAttribute) return { submitMechanism: "native_form" };
    return { submitMechanism: "unknown" };
  }

  // Gravity Forms: hidden gform_submit / is_submit_<id>. Postback and its
  // default AJAX mode (gform_submission_method "iframe": the same form posted
  // into a hidden iframe) are both a real post to the action. Its newer "ajax"
  // method posts elsewhere; the endpoint is not established from markup.
  if (names.includes("gform_submit") || names.some((n) => /^is_submit_\d+$/.test(n))) {
    if (valueOf("gform_submission_method") === "ajax") return { submitMechanism: "ajax" };
    return m.actionAttribute ? { submitMechanism: "native_form" } : { submitMechanism: "unknown" };
  }

  // Ninja Forms: fields nf-field-<n>; always submitted through admin-ajax.php.
  if (names.some((n) => /^nf-field-\d+$/.test(n)) || hasClass(m.formClass, "ninja-forms-form")) {
    return ajaxTo(m.pageUrl, ADMIN_AJAX, "nf_ajax_submit");
  }

  // Elementor Pro forms: hidden post_id, form_id or queried_id, or class elementor-form.
  if (m.fields.some((f) => f.fieldType === "hidden" && ELEMENTOR_HIDDEN.has(f.name)) || hasClass(m.formClass, "elementor-form")) {
    return ajaxTo(m.pageUrl, ADMIN_AJAX, "elementor_pro_forms_send_form");
  }

  return m.actionAttribute ? { submitMechanism: "native_form" } : { submitMechanism: "unknown" };
}

/**
 * sha1 hex over the form's shape: the sorted [name, fieldType, tagName]
 * entries (tagName lower-cased — saved forms say INPUT), the actionAttribute
 * and the submitMechanism. Values and labels are excluded, so a new nonce or
 * per-job id keeps the hash and an added, removed or retyped field changes it.
 *
 * Exactly: sha1(JSON.stringify({ fields: entries, actionAttribute, submitMechanism }))
 * with entries sorted by their JSON text.
 */
export function formShapeHash(fields: ShapeField[], actionAttribute: string, submitMechanism: string): string {
  const entries = fields
    .map((f) => [f.name ?? "", f.fieldType ?? "", (f.tagName ?? "").toLowerCase()])
    .sort((a, b) => {
      const x = JSON.stringify(a);
      const y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  return createHash("sha1").update(JSON.stringify({ fields: entries, actionAttribute, submitMechanism })).digest("hex");
}

function parseFormBlob(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  return Array.isArray(o.fields) ? o : null;
}

function completeParsed(
  o: Record<string, unknown>,
  ctx: { pageUrl: string; actionAttribute?: string; formClass?: string },
): Record<string, unknown> {
  const fields = o.fields as ShapeField[];
  const actionAttribute = typeof o.actionAttribute === "string" ? o.actionAttribute : (ctx.actionAttribute ?? "");
  const pageUrl = typeof o.pageUrl === "string" && o.pageUrl ? o.pageUrl : ctx.pageUrl;
  const submission = detectSubmitMechanism({ actionAttribute, pageUrl, formClass: ctx.formClass, fields });
  // Rebuilt in a fixed key order; every key the blob had is kept.
  const { actionUrl, method, enctype, fields: _f, capturedAt, captureSource, extractorVersion, ...rest } = o;
  void _f;
  delete rest.submitEndpoint;
  delete rest.submitAction;
  return {
    actionUrl: actionUrl ?? "",
    actionAttribute,
    pageUrl,
    method,
    ...(enctype !== undefined ? { enctype } : {}),
    ...rest,
    ...submission,
    fields,
    shapeHash: formShapeHash(fields, actionAttribute, submission.submitMechanism),
    capturedAt,
    captureSource,
    extractorVersion,
  };
}

/**
 * A form blob with actionAttribute, pageUrl, submitMechanism (and endpoint and
 * action where known) and shapeHash. Keys the blob already has for
 * actionAttribute and pageUrl win over ctx; the mechanism and hash are always
 * computed here. Anything that is not a form blob is returned as it came.
 */
export function completeFormBlob(raw: string, ctx: { pageUrl: string; actionAttribute?: string; formClass?: string }): string {
  const o = parseFormBlob(raw);
  return o ? JSON.stringify(completeParsed(o, ctx)) : raw;
}

/**
 * A blob a site's setup script injected as applicationInfo: stamped
 * captureSource "script" (whatever it called itself), keeping its own
 * capturedAt, pageUrl and extractorVersion when it has them — an existing
 * setupScript's copy of the template has none, and is version 1 — and
 * completed like every other blob. Text and non-form JSON are untouched.
 */
export function stampScriptFormBlob(raw: string, ctx: { pageUrl: string; at: Date }): string {
  const o = parseFormBlob(raw);
  if (!o) return raw;
  const stamped = {
    ...o,
    capturedAt: typeof o.capturedAt === "string" && o.capturedAt ? o.capturedAt : ctx.at.toISOString(),
    captureSource: "script",
    extractorVersion: typeof o.extractorVersion === "number" ? o.extractorVersion : 1,
  };
  return JSON.stringify(completeParsed(stamped, { pageUrl: ctx.pageUrl }));
}

