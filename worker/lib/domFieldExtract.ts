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

  // Cloudflare "email protection" obfuscates addresses as
  // `<a class="__cf_email__" data-cfemail="HEX">[email protected]</a>` (the hex
  // also appears in a `/cdn-cgi/l/email-protection#HEX` href). Without decoding,
  // every cf-protected apply email / description leaks the literal
  // "[email protected]" placeholder. Decode in place so downstream text sees the
  // real address. First hex byte is the XOR key; XOR each subsequent byte.
  const cfDecode = function (hex: string): string {
    try {
      const key = parseInt(hex.substr(0, 2), 16);
      let out = "";
      for (let i = 2; i < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
      }
      return out;
    } catch {
      return "";
    }
  };
  clone.querySelectorAll("[data-cfemail], .__cf_email__").forEach((n) => {
    const hex =
      n.getAttribute("data-cfemail") ||
      ((n.getAttribute("href") || "").split("#")[1] ?? "");
    const decoded = /^[0-9a-fA-F]+$/.test(hex) ? cfDecode(hex) : "";
    if (decoded) n.replaceWith(decoded);
  });

  // textContent concatenates adjacent text nodes with NO separator. That's
  // fine for English (words already have spaces) but breaks Hebrew / CJK
  // / Arabic where word boundaries depend on whitespace that browsers
  // *render* via block layout or <br> rather than insert as characters.
  // Insert a space at every visual break so downstream tools see real words.
  clone.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  clone
    .querySelectorAll(
      "p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote",
    )
    .forEach((b) => b.append("\n"));

  return (clone.textContent || "")
    .replace(/[^\S\n]+/g, " ")   // collapse horizontal whitespace, keep newlines
    .replace(/\n{3,}/g, "\n\n")  // max two consecutive newlines
    .replace(/ \n/g, "\n")       // drop space before newline
    .replace(/\n /g, "\n")       // drop space after newline
    .trim();
};

// esbuild/tsx injects `__name(fn, "fnName")` calls after every function
// declaration (keepNames) for stack traces. When we `.toString()` and
// re-eval the source inside `page.evaluate`, those calls run in a fresh
// realm where `__name` is undefined and throw `ReferenceError`. Wrap the
// function in an IIFE that defines a no-op `__name`; the inner function
// closes over it, so callers can keep `eval('(' + src + ')')` unchanged.
export const DOM_FIELD_EXTRACT_SOURCE =
  `(function(){var __name=function(f){return f;};return ${domFieldExtract.toString()};})()`;
