/**
 * FormRecorder -- content script module that captures an entire <form>
 * when the user clicks any field inside it.
 *
 * One click = full form capture: action URL, method, all fields (including hidden).
 */

import { generateSelector } from "./ElementPicker";
import type { FormCapture, FormFieldInfo, ExtensionMessage } from "../lib/types";

let isRecording = false;
let capturedFormSelector: string | null = null;
let styleElement: HTMLStyleElement | null = null;

const FORM_RECORD_STYLES = `
  .scrapnew-form-captured {
    outline: 2px solid #22c55e !important;
    outline-offset: 2px;
    transition: outline-color 0.3s ease;
  }
`;

function injectStyles(): void {
  if (styleElement) return;
  styleElement = document.createElement("style");
  styleElement.setAttribute("data-scrapnew", "form-record-styles");
  styleElement.textContent = FORM_RECORD_STYLES;
  document.head.appendChild(styleElement);
}

function removeStyles(): void {
  if (styleElement) {
    styleElement.remove();
    styleElement = null;
  }
}

function inferLabel(element: Element): string {
  const el = element as HTMLElement;

  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent) return label.textContent.trim().slice(0, 100);
  }

  const parentLabel = el.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const text = clone.textContent?.trim();
    if (text) return text.slice(0, 100);
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return placeholder.trim().slice(0, 100);

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim().slice(0, 100);

  const name = el.getAttribute("name");
  if (name) {
    return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").trim().slice(0, 100);
  }

  const prev = el.previousElementSibling;
  if (prev?.tagName === "LABEL" && prev.textContent) {
    return prev.textContent.trim().slice(0, 100);
  }

  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type") || "";
  return type ? `${type} ${tag}` : tag;
}

function extractFormFields(form: HTMLFormElement): FormFieldInfo[] {
  const fields: FormFieldInfo[] = [];
  const elements = form.querySelectorAll("input, select, textarea");

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute("name") || "";
    const type = el.getAttribute("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");

    // Skip submit/button/image inputs -- they're not data fields
    if (type === "submit" || type === "button" || type === "image" || type === "reset") continue;

    fields.push({
      name,
      label: inferLabel(el),
      fieldType: type,
      required: el.hasAttribute("required"),
      tagName: tag,
    });
  }

  return fields;
}

function onFormFieldInteraction(e: Event): void {
  const target = e.target as Element;
  if (!target) return;

  const tag = target.tagName.toLowerCase();
  const isFormField =
    tag === "input" || tag === "select" || tag === "textarea" ||
    (tag === "button" && target.closest("form"));

  if (!isFormField) return;

  if (
    target.classList.contains("scrapnew-highlight") ||
    target.classList.contains("scrapnew-highlight-label") ||
    target.classList.contains("scrapnew-picker-hover")
  ) {
    return;
  }

  const form = target.closest("form");
  if (!form) return;

  const formSelector = generateSelector(form);

  // Already captured this form
  if (capturedFormSelector === formSelector) return;
  capturedFormSelector = formSelector;

  // Visual highlight on the form
  form.classList.add("scrapnew-form-captured");

  const actionRaw = form.getAttribute("action") || "";
  const actionUrl = actionRaw ? new URL(actionRaw, window.location.href).toString() : window.location.href;
  const method = (form.getAttribute("method") || "GET").toUpperCase();

  const fields = extractFormFields(form);

  const capture: FormCapture = {
    formSelector,
    actionUrl,
    method,
    fields,
  };

  chrome.runtime.sendMessage({
    type: "FORM_CAPTURED",
    form: capture,
  } satisfies ExtensionMessage).catch(() => {});
}

export function startFormRecording(): void {
  if (isRecording) return;
  isRecording = true;
  capturedFormSelector = null;
  injectStyles();
  document.addEventListener("focusin", onFormFieldInteraction, { capture: true });
  document.addEventListener("click", onFormFieldInteraction, { capture: true });
}

export function stopFormRecording(): void {
  if (!isRecording) return;
  isRecording = false;
  document.removeEventListener("focusin", onFormFieldInteraction, { capture: true });
  document.removeEventListener("click", onFormFieldInteraction, { capture: true });

  // Remove highlight from captured form
  document.querySelectorAll(".scrapnew-form-captured").forEach((el) => {
    el.classList.remove("scrapnew-form-captured");
  });

  removeStyles();
}

export function resetFormRecording(): void {
  capturedFormSelector = null;
  document.querySelectorAll(".scrapnew-form-captured").forEach((el) => {
    el.classList.remove("scrapnew-form-captured");
  });
}

export function isFormRecording(): boolean {
  return isRecording;
}
