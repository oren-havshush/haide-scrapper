// The worker's per-job live apply-form extractor (step 2a; moved out of
// worker/jobs/scrape.ts so a real-browser test can run it).
//
// The page code only gathers ONE raw description per input, select and
// textarea; every rule — hidden values kept, honeypots dropped but never a
// hidden input, radio groups, file accept/multiple — is applied in Node by
// normalizeFormFields (worker/lib/formFields.ts), where it is tested without a
// browser. The evaluated body declares no named function: tsx's keepNames
// wraps named functions in __name(...) calls, which do not exist in the page.

import type { Page } from "playwright";
import { liveFormBlob, normalizeFormFields, type RawFieldDescriptor } from "./formFields";

type PageForm = {
  actionUrl: string;
  /** The action attribute resolved absolute; "" when the form has none. */
  actionAttribute: string;
  pageUrl: string;
  formClass: string;
  /** The container's tag, lower-case: "form", or "div" for a Magento idus_forms container. */
  formTag: string;
  method: string;
  enctype: string | null;
  descriptors: RawFieldDescriptor[];
};

/**
 * The apply form on the current page, as a stamped _formData blob; null when
 * there is none — or when a configured selector matches nothing, so the caller
 * falls back to the saved static fields rather than grabbing a random form
 * (the WordPress search box once leaked into _formData that way).
 */
export async function extractLiveFormData(
  page: Page,
  cfg: { formSelector: string } | null,
  now: Date,
): Promise<string | null> {
  const found: PageForm | null = await page.evaluate((c) => {
    let form: HTMLFormElement | null = null;
    if (c?.formSelector) {
      form = document.querySelector(c.formSelector) as HTMLFormElement | null;
      if (!form) return null;
    } else {
      form = document.querySelector("form") as HTMLFormElement | null;
    }
    if (!form) return null;

    const pageUrl = window.location.href;
    const actionRaw = (form.getAttribute("action") || "").trim();
    // actionUrl keeps today's meaning (the page when there is no action);
    // actionAttribute never substitutes the page: "" when the form has none.
    let actionAttribute = actionRaw;
    try {
      if (actionRaw) actionAttribute = new URL(actionRaw, pageUrl).toString();
    } catch {
      // A base the browser cannot resolve against: keep the attribute as written.
    }
    const actionUrl = actionAttribute || pageUrl;
    const formClass = form.getAttribute("class") || "";
    const formTag = form.tagName.toLowerCase();
    const method = (form.getAttribute("method") || "GET").toUpperCase();
    // Labels already given to an earlier field, so a second field cannot
    // inherit them (lighting's two textareas share one id and two labels).
    const usedLabels: Element[] = [];
    const enctype = form.getAttribute("enctype");

    const descriptors: Array<{
      tag: string;
      type: string;
      name: string;
      label: string;
      required: boolean;
      value?: string;
      accept?: string | null;
      multiple?: boolean;
      options?: Array<{ value: string; label: string }>;
      hpHint: string;
      offscreen: boolean;
      groupLabel: string;
    }> = [];

    for (const el of Array.from(form.querySelectorAll("input, select, textarea"))) {
      const tag = el.tagName.toLowerCase();
      const type = (tag === "input" ? el.getAttribute("type") || "text" : tag === "select" ? "select" : "textarea").toLowerCase();
      const name = el.getAttribute("name") || "";
      const htmlEl = el as HTMLElement;

      // The label, as the extractor has always inferred it — except that a
      // label[for] lookup is ambiguous when more than one element shares the
      // id, or when the label it finds was already used by an earlier field:
      // then the element's own placeholder or aria-label is read first
      // (lighting's two textareas, id jobs_form.note, owner 2026-10-08).
      let label = "";
      if (htmlEl.id) {
        const idSel = CSS.escape(htmlEl.id);
        const labelEl = document.querySelector(`label[for="${idSel}"]`);
        const sharedId = document.querySelectorAll(`[id="${idSel}"]`).length > 1;
        const reused = !!labelEl && usedLabels.includes(labelEl);
        if (sharedId || reused) {
          label = (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").trim().slice(0, 100);
        }
        if (!label && !reused && labelEl?.textContent) label = labelEl.textContent.trim().slice(0, 100);
        if (labelEl && !usedLabels.includes(labelEl)) usedLabels.push(labelEl);
      }
      if (!label) {
        const parentLabel = htmlEl.closest("label");
        if (parentLabel) {
          const clone = parentLabel.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
          label = clone.textContent?.trim()?.slice(0, 100) || "";
        }
      }
      if (!label && type !== "radio") label = el.getAttribute("placeholder")?.trim()?.slice(0, 100) || "";
      if (!label && type !== "radio") label = el.getAttribute("aria-label")?.trim()?.slice(0, 100) || "";
      if (!label && name && type !== "radio") label = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").trim();
      if (!label && type !== "radio") label = `${type} ${tag}`;

      const style = (el.getAttribute("style") || "").toLowerCase();
      const offscreen =
        style.includes("-99999") || style.includes("display:none !important") || style.includes("display: none !important");
      const hpHint = `${name} ${htmlEl.id || ""} ${typeof htmlEl.className === "string" ? htmlEl.className : ""}`;
      const groupLabel =
        type === "radio"
          ? (htmlEl.closest("fieldset")?.querySelector("legend")?.textContent || "").replace(/\s+/g, " ").trim()
          : "";

      descriptors.push({
        tag,
        type,
        name,
        label,
        // Required the HTML way, the ARIA way, or the Magento way
        // (data-validate="{required:true}"; lighting, owner 2026-10-08).
        required:
          el.hasAttribute("required") ||
          (el.getAttribute("aria-required") || "").trim().toLowerCase() === "true" ||
          /(^|[{,\s'"])required['"]?\s*:\s*true\b/.test(el.getAttribute("data-validate") || ""),
        // The value as the page holds it NOW — a script may have set it.
        ...(type === "hidden" || type === "radio" ? { value: (el as HTMLInputElement).value } : {}),
        ...(type === "file"
          ? { accept: el.getAttribute("accept"), multiple: (el as HTMLInputElement).multiple }
          : {}),
        ...(tag === "select"
          ? {
              options: Array.from((el as HTMLSelectElement).options).map((o) => ({
                value: o.value,
                label: (o.textContent || "").replace(/\s+/g, " ").trim(),
              })),
            }
          : {}),
        hpHint,
        offscreen,
        groupLabel,
      });
    }
    return { actionUrl, actionAttribute, pageUrl, formClass, formTag, method, enctype, descriptors };
  }, cfg);

  if (!found) return null;
  return liveFormBlob(found, normalizeFormFields(found.descriptors), now);
}
