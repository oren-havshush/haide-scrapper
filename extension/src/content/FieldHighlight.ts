/**
 * FieldHighlight -- content script module for injecting overlay highlights
 * onto target page elements to visualize field mappings.
 *
 * Uses unique CSS class prefix `scrapnew-` to avoid style conflicts.
 */

import type { HighlightConfig } from "../lib/types";
import { CONFIDENCE_HIGH_THRESHOLD } from "../lib/constants";

// --- Style Injection ---

const HIGHLIGHT_STYLES = `
  .scrapnew-highlight {
    position: absolute;
    pointer-events: none;
    z-index: 999999;
    transition: all 0.15s ease;
    box-sizing: border-box;
  }
  .scrapnew-highlight--high {
    border: 2px solid #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }
  .scrapnew-highlight--low {
    border: 2px dashed #f59e0b;
    background: rgba(245, 158, 11, 0.1);
  }
  .scrapnew-highlight--editing {
    border: 3px solid #3b82f6;
    background: rgba(59, 130, 246, 0.15);
  }
  .scrapnew-highlight--confirmed {
    border: 2px solid #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }
  .scrapnew-highlight:hover,
  .scrapnew-highlight--hovered {
    border-width: 3px;
  }
  .scrapnew-highlight-label {
    position: absolute;
    top: -24px;
    right: 0;
    background: #18181b;
    color: #fafafa;
    font-family: Inter, sans-serif;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 1000000;
    pointer-events: none;
    transition: all 0.15s ease;
  }
  .scrapnew-highlight--hovered .scrapnew-highlight-label {
    font-size: 12px;
    padding: 3px 8px;
    font-weight: 600;
  }
`;

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  const style = document.createElement("style");
  style.setAttribute("data-scrapnew", "highlight-styles");
  style.textContent = HIGHLIGHT_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

// --- Highlight Registry ---

interface HighlightEntry {
  overlay: HTMLDivElement;
  element: Element;
  config: HighlightConfig;
  resizeObserver: ResizeObserver;
}

const highlights = new Map<string, HighlightEntry>();
let scrollListener: (() => void) | null = null;
let resizeListener: (() => void) | null = null;

// --- Helpers ---

function getStatusClass(config: HighlightConfig): string {
  if (config.status === "confirmed") return "scrapnew-highlight--confirmed";
  if (config.status === "editing") return "scrapnew-highlight--editing";
  if (config.confidence >= CONFIDENCE_HIGH_THRESHOLD) return "scrapnew-highlight--high";
  return "scrapnew-highlight--low";
}

function getLabelText(config: HighlightConfig): string {
  if (config.status === "confirmed") return `${config.fieldName} ${config.confidence}% \u2713`;
  return `${config.fieldName} ${config.confidence}%`;
}

function positionOverlay(overlay: HTMLDivElement, element: Element): void {
  const rect = element.getBoundingClientRect();
  overlay.style.top = `${rect.top + window.scrollY}px`;
  overlay.style.left = `${rect.left + window.scrollX}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function repositionAllHighlights(): void {
  for (const entry of highlights.values()) {
    positionOverlay(entry.overlay, entry.element);
  }
}

function ensureGlobalListeners(): void {
  if (!scrollListener) {
    scrollListener = () => repositionAllHighlights();
    window.addEventListener("scroll", scrollListener, { passive: true });
  }
  if (!resizeListener) {
    resizeListener = () => repositionAllHighlights();
    window.addEventListener("resize", resizeListener, { passive: true });
  }
}

function cleanupGlobalListeners(): void {
  if (highlights.size === 0) {
    if (scrollListener) {
      window.removeEventListener("scroll", scrollListener);
      scrollListener = null;
    }
    if (resizeListener) {
      window.removeEventListener("resize", resizeListener);
      resizeListener = null;
    }
  }
}

// Callbacks for click and hover events (set by content.ts)
let onHighlightClick: ((fieldName: string) => void) | null = null;
let onHighlightHover: ((fieldName: string) => void) | null = null;

export function setHighlightClickHandler(handler: (fieldName: string) => void): void {
  onHighlightClick = handler;
}

export function setHighlightHoverHandler(handler: (fieldName: string) => void): void {
  onHighlightHover = handler;
}

// --- Public API ---

/**
 * Create a highlight overlay around a target element.
 */
export function createHighlight(element: Element, config: HighlightConfig): void {
  injectStyles();
  ensureGlobalListeners();

  // Remove existing highlight for this field if present
  if (highlights.has(config.fieldName)) {
    removeHighlight(config.fieldName);
  }

  const overlay = document.createElement("div");
  overlay.className = `scrapnew-highlight ${getStatusClass(config)}`;
  overlay.setAttribute("data-scrapnew-field", config.fieldName);

  // Label tag
  const label = document.createElement("div");
  label.className = "scrapnew-highlight-label";
  label.textContent = getLabelText(config);
  overlay.appendChild(label);

  // Position the overlay
  positionOverlay(overlay, element);

  // Hover interaction: thicken border and label
  overlay.style.pointerEvents = "auto";

  overlay.addEventListener("mouseenter", () => {
    overlay.classList.add("scrapnew-highlight--hovered");
    if (onHighlightHover) {
      onHighlightHover(config.fieldName);
    }
  });

  overlay.addEventListener("mouseleave", () => {
    overlay.classList.remove("scrapnew-highlight--hovered");
  });

  // Click interaction: trigger edit mode
  overlay.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onHighlightClick) {
      onHighlightClick(config.fieldName);
    }
  });

  // ResizeObserver to reposition when element size changes
  const resizeObserver = new ResizeObserver(() => {
    positionOverlay(overlay, element);
  });
  resizeObserver.observe(element);

  document.body.appendChild(overlay);

  highlights.set(config.fieldName, {
    overlay,
    element,
    config,
    resizeObserver,
  });
}

/**
 * Update an existing highlight's appearance (color, border style, label).
 */
export function updateHighlight(fieldName: string, config: HighlightConfig): void {
  const entry = highlights.get(fieldName);
  if (!entry) return;

  // Update class
  entry.overlay.className = `scrapnew-highlight ${getStatusClass(config)}`;

  // Update label
  const label = entry.overlay.querySelector(".scrapnew-highlight-label");
  if (label) {
    label.textContent = getLabelText(config);
  }

  // If the selector changed, re-resolve the element
  if (config.selector !== entry.config.selector) {
    const newElement = document.querySelector(config.selector);
    if (newElement) {
      entry.resizeObserver.disconnect();
      entry.element = newElement;
      entry.resizeObserver.observe(newElement);
      positionOverlay(entry.overlay, newElement);
    }
  }

  entry.config = config;
}

/**
 * Remove a specific highlight overlay from the page.
 */
export function removeHighlight(fieldName: string): void {
  const entry = highlights.get(fieldName);
  if (!entry) return;

  entry.resizeObserver.disconnect();
  entry.overlay.remove();
  highlights.delete(fieldName);
  cleanupGlobalListeners();
}

/**
 * Remove all highlight overlays from the page.
 */
export function clearAllHighlights(): void {
  for (const [fieldName] of highlights) {
    removeHighlight(fieldName);
  }
  // Ensure cleanup since we may have removed all
  cleanupGlobalListeners();
}
