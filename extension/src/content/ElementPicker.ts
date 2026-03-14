/**
 * ElementPicker -- content script module that activates a click-to-select
 * element picker on the target page for field mapping correction.
 */

// --- Picker State ---

let isActive = false;
let currentHovered: Element | null = null;
let pickerCallback: ((selector: string, element: Element) => void) | null = null;
let styleElement: HTMLStyleElement | null = null;
let activeScopeSelector: string | null = null;

// --- Selector Generation ---

/**
 * Generate a unique, stable CSS selector for the target element.
 *
 * Priority:
 * 1. Element with unique `id` -- `#job-title`
 * 2. Data attributes -- `[data-field="title"]`
 * 3. Unique class combination -- `tag.class1.class2`
 * 4. Tag + class + parent context -- `div.listing > h2.title`
 * 5. Full path with nth-child as last resort
 */
export function generateSelector(element: Element): string {
  // 1. Unique ID
  if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) {
    return `#${CSS.escape(element.id)}`;
  }

  // 2. Data attributes
  const dataAttrs = Array.from(element.attributes).filter(
    (attr) => attr.name.startsWith("data-") && attr.name !== "data-scrapnew-field"
  );
  for (const attr of dataAttrs) {
    const dataSelector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
    if (document.querySelectorAll(dataSelector).length === 1) {
      return dataSelector;
    }
  }

  // 3. Unique class combination with tag
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).filter(
    (cls) => !cls.startsWith("scrapnew-")
  );
  if (classes.length > 0) {
    const classSelector = `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`;
    if (document.querySelectorAll(classSelector).length === 1) {
      return classSelector;
    }
  }

  // 4. Tag + class + parent context (up to 5 levels)
  const path = buildParentPath(element, 5);
  if (path && document.querySelectorAll(path).length === 1) {
    return path;
  }

  // 5. Anchored path: find nearest ancestor with class/ID, build short path from there
  const anchored = buildAnchoredPath(element);
  if (anchored) {
    return anchored;
  }

  // 6. Full nth-child path from root (absolute last resort)
  return buildNthChildPath(element);
}

function buildParentPath(element: Element, maxDepth: number): string | null {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();
    const classes = Array.from(current.classList)
      .filter((cls) => !cls.startsWith("scrapnew-"))
      .slice(0, 2); // limit to 2 classes for readability

    let part = tag;
    if (classes.length > 0) {
      part += `.${classes.map((c) => CSS.escape(c)).join(".")}`;
    }

    parts.unshift(part);
    current = current.parentElement;
    depth++;

    // Check if partial path is unique
    const selector = parts.join(" > ");
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  return parts.length > 0 ? parts.join(" > ") : null;
}

/**
 * Walk up the DOM to find the nearest ancestor with a meaningful class or
 * unique ID, then build a short structural path from that anchor down to
 * the target element.  Produces selectors like
 *   `div.job-card > div > span`
 * instead of long nth-child chains from body.
 */
function buildAnchoredPath(element: Element): string | null {
  let ancestor: Element | null = element.parentElement;

  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const ancClasses = Array.from(ancestor.classList).filter(
      (cls) => !cls.startsWith("scrapnew-"),
    );
    const hasUniqueId =
      !!ancestor.id &&
      document.querySelectorAll(`#${CSS.escape(ancestor.id)}`).length === 1;

    if (hasUniqueId || ancClasses.length > 0) {
      // Build anchor selector
      let anchorSel: string;
      if (hasUniqueId) {
        anchorSel = `#${CSS.escape(ancestor.id)}`;
      } else {
        const aTag = ancestor.tagName.toLowerCase();
        anchorSel = `${aTag}.${ancClasses.slice(0, 3).map((c) => CSS.escape(c)).join(".")}`;
      }

      // Build short structural path from anchor down to target
      const pathParts: string[] = [];
      let node: Element | null = element;
      while (node && node !== ancestor) {
        const nodeTag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) break;

        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === node!.tagName,
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(node) + 1;
          // Include class info on nth-child parts when available for readability
          const nodeClasses = Array.from(node.classList).filter(
            (cls) => !cls.startsWith("scrapnew-"),
          );
          if (nodeClasses.length > 0) {
            pathParts.unshift(
              `${nodeTag}.${nodeClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}:nth-child(${index})`,
            );
          } else {
            pathParts.unshift(`${nodeTag}:nth-child(${index})`);
          }
        } else {
          const nodeClasses = Array.from(node.classList).filter(
            (cls) => !cls.startsWith("scrapnew-"),
          );
          if (nodeClasses.length > 0) {
            pathParts.unshift(
              `${nodeTag}.${nodeClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`,
            );
          } else {
            pathParts.unshift(nodeTag);
          }
        }
        node = parent;
      }

      if (pathParts.length > 0) {
        // Try with child combinator first (most specific)
        const directSel = `${anchorSel} > ${pathParts.join(" > ")}`;
        if (document.querySelectorAll(directSel).length === 1) {
          return directSel;
        }

        // Try with descendant combinator (more resilient to DOM changes)
        const descSel = `${anchorSel} ${pathParts.join(" > ")}`;
        if (document.querySelectorAll(descSel).length === 1) {
          return descSel;
        }
      }
    }

    ancestor = ancestor.parentElement;
  }

  return null;
}

function buildNthChildPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;

    if (parent) {
      const currentTag = current.tagName;
      const siblings = Array.from(parent.children).filter(
        (child: Element) => child.tagName === currentTag
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-child(${index})`);
      } else {
        parts.unshift(tag);
      }
    } else {
      parts.unshift(tag);
    }

    current = parent;
  }

  return parts.join(" > ");
}

/**
 * Generate a CSS selector for `element` that is relative to `scope`.
 * The returned selector will match the element when queried from within scope.
 */
export function generateRelativeSelector(element: Element, scope: Element): string {
  if (!scope.contains(element)) return generateSelector(element);

  // Try class-based relative selector first
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).filter(
    (cls) => !cls.startsWith("scrapnew-")
  );
  if (classes.length > 0) {
    const classSelector = `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`;
    const matches = scope.querySelectorAll(classSelector);
    if (matches.length === 1) return classSelector;
  }

  // Try tag + parent context within scope (up to 5 levels, stopping at scope)
  const relPath = buildRelativeParentPath(element, scope, 5);
  if (relPath) {
    const matches = scope.querySelectorAll(relPath);
    if (matches.length === 1) return relPath;
  }

  // Try anchored path within scope (find nearest classed parent inside scope)
  const anchoredRel = buildRelativeAnchoredPath(element, scope);
  if (anchoredRel) return anchoredRel;

  // Fall back to structural nth-of-type path from scope to element
  return buildRelativeNthChildPath(element, scope);
}

function buildRelativeParentPath(element: Element, scope: Element, maxDepth: number): string | null {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && current !== scope && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();
    const classes = Array.from(current.classList)
      .filter((cls) => !cls.startsWith("scrapnew-"))
      .slice(0, 2);

    let part = tag;
    if (classes.length > 0) {
      part += `.${classes.map((c) => CSS.escape(c)).join(".")}`;
    }
    parts.unshift(part);
    current = current.parentElement;
    depth++;

    const selector = parts.join(" > ");
    if (scope.querySelectorAll(selector).length === 1) return selector;
  }

  return parts.length > 0 ? parts.join(" > ") : null;
}

function buildRelativeNthChildPath(element: Element, scope: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== scope) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;

    const nodeClasses = Array.from(current.classList).filter(
      (cls) => !cls.startsWith("scrapnew-"),
    );
    const sameTagSiblings = Array.from(parent.children).filter(
      (child) => child.tagName === current!.tagName
    );
    if (sameTagSiblings.length > 1) {
      const index = sameTagSiblings.indexOf(current) + 1;
      if (nodeClasses.length > 0) {
        parts.unshift(
          `${tag}.${nodeClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}:nth-of-type(${index})`,
        );
      } else {
        parts.unshift(`${tag}:nth-of-type(${index})`);
      }
    } else {
      if (nodeClasses.length > 0) {
        parts.unshift(`${tag}.${nodeClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`);
      } else {
        parts.unshift(tag);
      }
    }
    current = parent;
  }

  return parts.join(" > ");
}

/**
 * Within a scope, find the nearest classed ancestor and build a short
 * path from that ancestor to the target element.
 */
function buildRelativeAnchoredPath(element: Element, scope: Element): string | null {
  let ancestor: Element | null = element.parentElement;

  while (ancestor && ancestor !== scope) {
    const ancClasses = Array.from(ancestor.classList).filter(
      (cls) => !cls.startsWith("scrapnew-"),
    );

    if (ancClasses.length > 0) {
      const aTag = ancestor.tagName.toLowerCase();
      const anchorSel = `${aTag}.${ancClasses.slice(0, 3).map((c) => CSS.escape(c)).join(".")}`;

      // Build short path from this ancestor to the target
      const pathParts: string[] = [];
      let node: Element | null = element;
      while (node && node !== ancestor) {
        const nodeTag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) break;

        const nodeClasses = Array.from(node.classList).filter(
          (cls) => !cls.startsWith("scrapnew-"),
        );
        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === node!.tagName,
        );

        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(node) + 1;
          if (nodeClasses.length > 0) {
            pathParts.unshift(
              `${nodeTag}.${nodeClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}:nth-of-type(${index})`,
            );
          } else {
            pathParts.unshift(`${nodeTag}:nth-of-type(${index})`);
          }
        } else {
          if (nodeClasses.length > 0) {
            pathParts.unshift(
              `${nodeTag}.${nodeClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`,
            );
          } else {
            pathParts.unshift(nodeTag);
          }
        }
        node = parent;
      }

      if (pathParts.length > 0) {
        const sel = `${anchorSel} > ${pathParts.join(" > ")}`;
        if (scope.querySelectorAll(sel).length === 1) return sel;

        const descSel = `${anchorSel} ${pathParts.join(" > ")}`;
        if (scope.querySelectorAll(descSel).length === 1) return descSel;
      }
    }

    ancestor = ancestor.parentElement;
  }

  return null;
}

// --- Generalized Item Selector (for repeating items) ---

/**
 * Generate a CSS selector that matches ALL siblings with the same tag + classes
 * as the clicked element. Used for "Set Job Item" and "Set List Container"
 * where we need to match every repeating item, not just the one clicked.
 *
 * Strategy:
 * 1. tag.class1.class2 (no positional pseudo-classes)
 * 2. If that's too broad, scope it within the parent
 * 3. If still only 1 match, strip to just the tag within parent context
 */
export function generateItemSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).filter(
    (cls) => !cls.startsWith("scrapnew-"),
  );

  // Try tag + all classes (no nth-child / nth-of-type)
  if (classes.length > 0) {
    const sel = `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`;
    const count = document.querySelectorAll(sel).length;
    if (count > 1) return sel;

    // Try with fewer classes (drop one at a time from the end)
    for (let i = classes.length - 1; i >= 1; i--) {
      const partialSel = `${tag}.${classes.slice(0, i).map((c) => CSS.escape(c)).join(".")}`;
      const partialCount = document.querySelectorAll(partialSel).length;
      if (partialCount > 1) return partialSel;
    }
  }

  // Try scoping within the parent element
  const parent = element.parentElement;
  if (parent) {
    const parentTag = parent.tagName.toLowerCase();
    const parentClasses = Array.from(parent.classList).filter(
      (cls) => !cls.startsWith("scrapnew-"),
    );

    let parentSel = parentTag;
    if (parent.id && document.querySelectorAll(`#${CSS.escape(parent.id)}`).length === 1) {
      parentSel = `#${CSS.escape(parent.id)}`;
    } else if (parentClasses.length > 0) {
      parentSel = `${parentTag}.${parentClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
    }

    if (classes.length > 0) {
      const scopedSel = `${parentSel} > ${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`;
      const scopedCount = document.querySelectorAll(scopedSel).length;
      if (scopedCount > 1) return scopedSel;
    }

    // Just tag within parent
    const tagOnly = `${parentSel} > ${tag}`;
    const tagCount = document.querySelectorAll(tagOnly).length;
    if (tagCount > 1) return tagOnly;
  }

  // Try patterned ID: IDs ending in numbers (e.g. "jobs_order_open_btn_117391")
  // Strip the numeric suffix and use [id^="prefix"] to match all similar elements.
  if (element.id) {
    const match = element.id.match(/^(.+?[_-])\d+$/);
    if (match) {
      const prefix = match[1];
      const idPrefixSel = `${tag}[id^="${CSS.escape(prefix)}"]`;
      const idPrefixCount = document.querySelectorAll(idPrefixSel).length;
      if (idPrefixCount > 1) return idPrefixSel;
    }
  }

  // Fallback: return tag + classes without positional indices (even if it matches 1)
  if (classes.length > 0) {
    return `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`;
  }
  return tag;
}

// --- Picker Event Handlers ---

function onMouseMove(e: MouseEvent): void {
  const target = e.target as Element;
  if (!target || target === currentHovered) return;

  // Skip our own overlay elements
  if (
    target.classList.contains("scrapnew-highlight") ||
    target.classList.contains("scrapnew-highlight-label") ||
    target.classList.contains("scrapnew-picker-hover")
  ) {
    return;
  }

  // Remove previous hover
  if (currentHovered) {
    currentHovered.classList.remove("scrapnew-picker-hover");
  }

  // Add hover to new target
  currentHovered = target;
  target.classList.add("scrapnew-picker-hover");
}

function onClick(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const target = e.target as Element;
  if (!target) return;

  // Skip our own overlay elements
  if (
    target.classList.contains("scrapnew-highlight") ||
    target.classList.contains("scrapnew-highlight-label")
  ) {
    return;
  }

  // Remove hover class before generating selector
  target.classList.remove("scrapnew-picker-hover");

  let selector: string;
  if (activeScopeSelector) {
    const scopeEl = target.closest(activeScopeSelector);
    if (scopeEl && scopeEl.contains(target)) {
      selector = generateRelativeSelector(target, scopeEl);
    } else {
      selector = generateSelector(target);
    }
  } else {
    selector = generateSelector(target);
  }

  if (pickerCallback) {
    pickerCallback(selector, target);
  }

  // Auto-stop picker after selection
  stopPicker();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    stopPicker();
  }
}

// --- Picker Styles ---

const PICKER_STYLES = `
  .scrapnew-picker-hover {
    outline: 2px dashed #3b82f6 !important;
    outline-offset: 2px;
    cursor: crosshair !important;
  }
  .scrapnew-picker-active,
  .scrapnew-picker-active * {
    cursor: crosshair !important;
  }
`;

function injectPickerStyles(): void {
  if (styleElement) return;
  styleElement = document.createElement("style");
  styleElement.setAttribute("data-scrapnew", "picker-styles");
  styleElement.textContent = PICKER_STYLES;
  document.head.appendChild(styleElement);
}

function removePickerStyles(): void {
  if (styleElement) {
    styleElement.remove();
    styleElement = null;
  }
}

// --- Public API ---

/**
 * Activate picker mode. The callback is invoked with the CSS selector
 * and element reference when the user clicks an element.
 */
export function startPicker(callback: (selector: string, element: Element) => void, scopeSelector?: string): void {
  if (isActive) {
    stopPicker();
  }

  isActive = true;
  pickerCallback = callback;
  activeScopeSelector = scopeSelector ?? null;

  injectPickerStyles();
  document.body.classList.add("scrapnew-picker-active");

  // Use capture phase so we intercept clicks before the page handles them
  document.addEventListener("mousemove", onMouseMove, { capture: true });
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("keydown", onKeyDown, { capture: true });
}

/**
 * Deactivate picker mode, restore normal cursor, remove hover highlighting.
 */
export function stopPicker(): void {
  if (!isActive) return;

  isActive = false;
  pickerCallback = null;
  activeScopeSelector = null;

  // Remove hover from current element
  if (currentHovered) {
    currentHovered.classList.remove("scrapnew-picker-hover");
    currentHovered = null;
  }

  document.body.classList.remove("scrapnew-picker-active");
  removePickerStyles();

  document.removeEventListener("mousemove", onMouseMove, { capture: true });
  document.removeEventListener("click", onClick, { capture: true });
  document.removeEventListener("keydown", onKeyDown, { capture: true });
}

/**
 * Check if picker mode is currently active.
 */
export function isPickerActive(): boolean {
  return isActive;
}
