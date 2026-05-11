/**
 * Extract a field value from a DOM element.
 *
 * Modes:
 *  - If `attrName` is a non-empty string, return `el.getAttribute(attrName)`
 *    (trimmed). This is the opt-in path for ids hidden in `data-*` attrs on
 *    apply links/buttons. Empty result is allowed and reported as "".
 *  - Otherwise, return visible text: clone the node, strip non-content tags
 *    (script/style/svg/iframe...), collapse whitespace.
 *
 * `fieldName` is accepted for API compatibility with existing call sites
 * (scrape.ts passes it through page.evaluate) but is intentionally ignored.
 *
 * MUST stay self-contained — `.toString()` only captures this function's
 * body, so every helper lives inside it. No imports, no module-scope refs.
 */

export const domFieldExtract = function (
  el: Element,
  _fieldName: string,
  attrName?: string,
): string {
  if (typeof attrName === "string" && attrName.length > 0) {
    const v = el.getAttribute(attrName);
    return v == null ? "" : v.trim();
  }
  const tag = el.tagName.toLowerCase();
  if (
    [
      "style",
      "script",
      "noscript",
      "link",
      "template",
      "head",
      "meta",
      "title",
      "base",
    ].includes(tag)
  ) {
    return "";
  }
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll("style, script, noscript, link, template, svg, iframe")
    .forEach((n) => n.remove());

  // textContent concatenates adjacent text nodes with NO separator. That's
  // fine for English (words already have spaces) but breaks Hebrew / CJK
  // / Arabic where word boundaries depend on whitespace that browsers
  // *render* via block layout or <br> rather than insert as characters.
  // Insert a space at every visual break so downstream tools see real words.
  clone.querySelectorAll("br").forEach((n) => n.replaceWith(" "));
  clone
    .querySelectorAll(
      "p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote",
    )
    .forEach((b) => b.append(" "));

  return (clone.textContent || "").replace(/\s+/g, " ").trim();
};

// esbuild/tsx injects `__name(fn, "fnName")` calls after every function
// declaration (keepNames) for stack traces. When we `.toString()` and
// re-eval the source inside `page.evaluate`, those calls run in a fresh
// realm where `__name` is undefined and throw `ReferenceError`. Wrap the
// function in an IIFE that defines a no-op `__name`; the inner function
// closes over it, so callers can keep `eval('(' + src + ')')` unchanged.
export const DOM_FIELD_EXTRACT_SOURCE =
  `(function(){var __name=function(f){return f;};return ${domFieldExtract.toString()};})()`;
