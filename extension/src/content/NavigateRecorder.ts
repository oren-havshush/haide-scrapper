/**
 * NavigateRecorder -- content script module that intercepts link clicks
 * and monitors URL changes during Navigate Mode for page flow recording.
 *
 * Key design decisions:
 * - Does NOT prevent default on link clicks (browser must actually navigate)
 * - Captures click info BEFORE navigation occurs
 * - Monitors URL changes for SPA-style navigation
 * - Uses `scrapnew-` CSS class prefix for style isolation
 */

import { generateSelector } from "./ElementPicker";
import type { ExtensionMessage } from "../lib/types";

// --- State ---

let isRecording = false;
let lastKnownUrl: string = "";
let urlCheckInterval: ReturnType<typeof setInterval> | null = null;
let mutationObserver: MutationObserver | null = null;

// --- URL Pattern Derivation ---

/**
 * Convert a concrete URL into a wildcard pattern by replacing
 * numeric, UUID, and hex-hash path segments with `*`.
 *
 * Rules:
 * 1. Replace purely numeric path segments with *
 * 2. Replace UUID-like segments (8-4-4-4-12 hex) with *
 * 3. Replace hash-like segments (hex strings > 6 chars) with *
 * 4. Keep query parameters as-is
 * 5. Keep protocol and domain unchanged
 */
export function deriveUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");

    const patternSegments = segments.map((segment) => {
      if (!segment) return segment;

      // 1. Purely numeric
      if (/^\d+$/.test(segment)) return "*";

      // 2. UUID-like (8-4-4-4-12 hex pattern)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        return "*";
      }

      // 3. Hex hash (> 6 hex chars, no other chars)
      if (/^[0-9a-f]{7,}$/i.test(segment)) return "*";

      return segment;
    });

    parsed.pathname = patternSegments.join("/");
    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}

// --- Link Click Handler ---

function onLinkClick(e: MouseEvent): void {
  // Walk up from click target to find the nearest <a> element
  let target = e.target as Element | null;
  let anchor: HTMLAnchorElement | null = null;

  while (target && target !== document.documentElement) {
    if (target.tagName === "A" && (target as HTMLAnchorElement).href) {
      anchor = target as HTMLAnchorElement;
      break;
    }
    target = target.parentElement;
  }

  if (!anchor || !anchor.href) return;

  // Skip javascript: and # links
  if (anchor.href.startsWith("javascript:") || anchor.href === window.location.href + "#") {
    return;
  }

  const url = anchor.href;
  const selector = generateSelector(anchor);

  // Send message to background/panel BEFORE navigation occurs
  // Do NOT prevent default -- the browser must actually navigate
  chrome.runtime.sendMessage({
    type: "NAVIGATE_LINK_CLICKED",
    url,
    selector,
  } satisfies ExtensionMessage).catch(() => {
    // Background may not be ready
  });
}

// --- URL Change Monitoring ---

function checkUrlChange(): void {
  const currentUrl = window.location.href;
  if (currentUrl !== lastKnownUrl) {
    lastKnownUrl = currentUrl;
    chrome.runtime.sendMessage({
      type: "NAVIGATE_URL_CHANGED",
      url: currentUrl,
    } satisfies ExtensionMessage).catch(() => {
      // Background may not be ready
    });
  }
}

function onPopState(): void {
  checkUrlChange();
}

// --- Public API ---

/**
 * Start navigate recording: add link click listeners and URL change monitoring.
 * Does NOT prevent default on link clicks -- browser navigates normally.
 */
export function startNavigateRecording(): void {
  if (isRecording) return;

  isRecording = true;
  lastKnownUrl = window.location.href;

  // Listen for clicks on links (capture phase to intercept before navigation)
  document.addEventListener("click", onLinkClick, { capture: true });

  // Monitor URL changes for SPA navigation
  window.addEventListener("popstate", onPopState);

  // Periodic URL check (handles pushState/replaceState that don't trigger popstate)
  urlCheckInterval = setInterval(checkUrlChange, 500);

  // MutationObserver on <title> to detect SPA navigation that changes the title
  mutationObserver = new MutationObserver(() => {
    checkUrlChange();
  });

  const titleElement = document.querySelector("title");
  if (titleElement) {
    mutationObserver.observe(titleElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // Send initial URL to panel
  chrome.runtime.sendMessage({
    type: "NAVIGATE_URL_CHANGED",
    url: window.location.href,
  } satisfies ExtensionMessage).catch(() => {
    // Background may not be ready
  });
}

/**
 * Stop navigate recording: remove all listeners and observers.
 */
export function stopNavigateRecording(): void {
  if (!isRecording) return;

  isRecording = false;

  document.removeEventListener("click", onLinkClick, { capture: true });
  window.removeEventListener("popstate", onPopState);

  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
  }

  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

/**
 * Check if navigate recording is currently active.
 */
export function isNavigateRecording(): boolean {
  return isRecording;
}
