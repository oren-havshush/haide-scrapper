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
    const method = (form.getAttribute("method") || "GET").toUpperCase();
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

      // The label, as the extractor has always inferred it.
      let label = "";
      if (htmlEl.id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(htmlEl.id)}"]`);
        if (labelEl?.textContent) label = labelEl.textContent.trim().slice(0, 100);
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
        required: el.hasAttribute("required"),
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
    return { actionUrl, actionAttribute, pageUrl, formClass, method, enctype, descriptors };
  }, cfg);

  if (!found) return null;
  return liveFormBlob(found, normalizeFormFields(found.descriptors), now);
}
