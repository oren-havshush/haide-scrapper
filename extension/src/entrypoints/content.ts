import {
  createHighlight,
  updateHighlight,
  removeHighlight,
  clearAllHighlights,
  setHighlightClickHandler,
  setHighlightHoverHandler,
} from "../content/FieldHighlight";
import { startPicker, stopPicker, generateItemSelector } from "../content/ElementPicker";
import { startNavigateRecording, stopNavigateRecording } from "../content/NavigateRecorder";
import { startFormRecording, stopFormRecording } from "../content/FormRecorder";
import type { FieldMappingEntry, HighlightConfig, ExtensionMessage } from "../lib/types";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    // --- Check with background if Navigate Mode is active (content script re-initialization) ---

    chrome.runtime.sendMessage({ type: "GET_NAVIGATE_STATE" }, (response) => {
      if (response?.isNavigateMode) {
        startNavigateRecording();
      }
    });

    // --- Check with background if Form Record Mode is active (content script re-initialization) ---

    chrome.runtime.sendMessage({ type: "GET_FORM_RECORD_STATE" }, (response) => {
      if (response?.isFormRecordMode) {
        startFormRecording();
      }
    });

    // --- Set up highlight interaction handlers ---

    setHighlightClickHandler((fieldName: string) => {
      chrome.runtime.sendMessage({
        type: "HIGHLIGHT_CLICKED",
        fieldName,
      } satisfies ExtensionMessage);
    });

    setHighlightHoverHandler((fieldName: string) => {
      chrome.runtime.sendMessage({
        type: "HIGHLIGHT_HOVERED",
        fieldName,
      } satisfies ExtensionMessage);
    });

    // --- Helper to build HighlightConfig from FieldMappingEntry ---

    function toHighlightConfig(field: FieldMappingEntry): HighlightConfig {
      return {
        fieldName: field.fieldName,
        selector: field.selector,
        confidence: field.confidence,
        status: field.status,
      };
    }

    // --- Show all highlights for a list of field mapping entries ---

    function showHighlights(fields: FieldMappingEntry[]): void {
      clearAllHighlights();
      for (const field of fields) {
        const element = document.querySelector(field.selector);
        if (element) {
          createHighlight(element, toHighlightConfig(field));
        }
      }
    }

    // --- Listen for messages from background/side panel ---

    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse) => {
        switch (message.type) {
          case "SHOW_HIGHLIGHTS":
            showHighlights(message.fields);
            sendResponse({ ok: true });
            break;

          case "START_PICKER":
            startPicker((selector: string, element: Element) => {
              const finalSelector = message.useItemSelector
                ? generateItemSelector(element, {
                    expectMultiple: message.expectMultiple ?? true,
                  })
                : selector;
              chrome.runtime.sendMessage({
                type: "ELEMENT_PICKED",
                selector: finalSelector,
                tagName: element.tagName.toLowerCase(),
                textContent: (element.textContent || "").slice(0, 200).trim(),
              } satisfies ExtensionMessage);
            }, message.scopeSelector);
            sendResponse({ ok: true });
            break;

          case "STOP_PICKER":
            stopPicker();
            sendResponse({ ok: true });
            break;

          case "UPDATE_HIGHLIGHT": {
            const config = message.config;
            // If the element might have moved, try re-resolve
            const el = document.querySelector(config.selector);
            if (el) {
              // Check if we need to create or update
              updateHighlight(message.fieldName, config);
              // If update didn't work (highlight didn't exist), create it
              createHighlight(el, config);
            }
            sendResponse({ ok: true });
            break;
          }

          case "REMOVE_HIGHLIGHT":
            removeHighlight(message.fieldName);
            sendResponse({ ok: true });
            break;

          case "CLEAR_HIGHLIGHTS":
            clearAllHighlights();
            sendResponse({ ok: true });
            break;

          // --- Navigate Mode messages (Story 3-4) ---

          case "NAVIGATE_START":
            clearAllHighlights();
            stopPicker();
            startNavigateRecording();
            sendResponse({ ok: true });
            break;

          case "NAVIGATE_STOP":
            stopNavigateRecording();
            sendResponse({ ok: true });
            break;

          // --- Form Record Mode messages (Story 3-5) ---

          case "FORM_RECORD_START":
            clearAllHighlights();
            stopPicker();
            stopNavigateRecording();
            startFormRecording();
            sendResponse({ ok: true });
            break;

          case "FORM_RECORD_STOP":
            stopFormRecording();
            sendResponse({ ok: true });
            break;

          // --- Test Extract: extract one job item using current selectors ---

          case "TEST_EXTRACT": {
            // Use async IIFE since the listener is synchronous but we need delays for reveal clicks
            (async () => {

            /** Robust click: dispatch full mouse event sequence so JS frameworks see it */
            function robustClick(el: HTMLElement): void {
              el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
              // Also call native click as fallback
              el.click();
            }

            /**
             * Click all matching reveal elements inside a root and wait for content.
             * Returns diagnostics about what happened.
             */
            async function clickRevealElements(
              root: Element,
              revealSel: string,
            ): Promise<{ found: number; clicked: number }> {
              const revealEls = root.querySelectorAll(revealSel);
              let clicked = 0;
              for (const el of revealEls) {
                if (el instanceof HTMLElement) {
                  robustClick(el);
                  clicked++;
                }
              }
              if (clicked > 0) {
                // Wait for accordion animation / dynamic content to load
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
              return { found: revealEls.length, clicked };
            }

            try {
              const {
                fieldMappings,
                listingSelector,
                itemSelector,
                revealSelector,
                currentUrl,
                pageFlowUrls,
              } = message;
              const extracted: Record<string, string> = {};
              const fieldDiagnostics: Record<string, { selector: string; matched: boolean; elementTag?: string; extractedText: string; skipped?: boolean; capturedOnUrl?: string }> = {};
              let revealDiag: { selector: string | null; found: number; clicked: number } = { selector: revealSelector, found: 0, clicked: 0 };

              /**
               * URL-pattern matcher used to recognize the active tab as
               * "the same page" a field was captured on. Patterns may use
               * `*` as a wildcard (e.g. `https://x.com/job/detail/id/*`).
               * Returns true when:
               *   - capturedOnUrl is missing/empty (legacy → assume same page), or
               *   - capturedOnUrl matches currentUrl exactly, or
               *   - capturedOnUrl and currentUrl both match the same pageFlow URL pattern.
               */
              function urlMatchesPattern(url: string, pattern: string): boolean {
                if (!url || !pattern) return false;
                if (url === pattern) return true;
                const escaped = pattern
                  .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
                  .replace(/\*/g, ".*");
                try {
                  return new RegExp("^" + escaped + "$").test(url);
                } catch {
                  return false;
                }
              }
              function fieldBelongsToCurrentPage(capturedOnUrl?: string): boolean {
                if (!capturedOnUrl) return true; // legacy (pre-tagging) — test on whatever page we're on
                if (capturedOnUrl === currentUrl) return true;
                // Both URLs match same pageFlow pattern → same step
                for (const p of pageFlowUrls ?? []) {
                  if (urlMatchesPattern(currentUrl, p) && urlMatchesPattern(capturedOnUrl, p)) {
                    return true;
                  }
                }
                return false;
              }

              // Split fields: those that belong to the current page (test
              // them inline) vs those captured on a different page (mark
              // skipped — they will be exercised by the full scrape).
              const activeFields: Record<string, string> = {};
              for (const [fieldName, mapping] of Object.entries(fieldMappings)) {
                if (fieldBelongsToCurrentPage(mapping.capturedOnUrl)) {
                  activeFields[fieldName] = mapping.selector;
                } else {
                  fieldDiagnostics[fieldName] = {
                    selector: mapping.selector,
                    matched: false,
                    extractedText: "",
                    skipped: true,
                    capturedOnUrl: mapping.capturedOnUrl,
                  };
                  extracted[fieldName] = "";
                }
              }

              if (itemSelector) {
                // --- Item-scoped strategy ---
                const containerSel = listingSelector ?? "body";
                const listingEl = listingSelector ? document.querySelector(listingSelector) : document.body;
                const listingFound = !!listingEl;

                let items = document.querySelectorAll(`${containerSel} ${itemSelector}`);
                if (items.length === 0) {
                  items = document.querySelectorAll(itemSelector);
                }
                const itemsFound = items.length;

                if (itemsFound > 0) {
                  const firstItem = items[0];

                  // Click reveal action (accordion/expand) if set.
                  // Try inside the item first, then siblings, then the page.
                  if (revealSelector) {
                    let rd = await clickRevealElements(firstItem, revealSelector);
                    // Many accordion patterns place the trigger OUTSIDE the item
                    // (e.g. as a sibling or in a parent wrapper). Search wider.
                    if (rd.found === 0) {
                      // Try next siblings of the item
                      let sib = firstItem.nextElementSibling;
                      let sibChecked = 0;
                      while (sib && sibChecked < 3 && rd.found === 0) {
                        rd = await clickRevealElements(sib, revealSelector);
                        sib = sib.nextElementSibling;
                        sibChecked++;
                      }
                    }
                    if (rd.found === 0) {
                      // Last resort: search entire page for the reveal selector
                      rd = await clickRevealElements(document.body, revealSelector);
                    }
                    revealDiag = { selector: revealSelector, ...rd };
                  }

                  /**
                   * Try to find a field element using scoped search:
                   * 1. Inside the item element
                   * 2. In the next sibling elements (accordion content often lives here)
                   * We intentionally do NOT search listing-wide or document-wide
                   * to avoid matching page-level elements (e.g. page title).
                   */
                  function findField(selector: string): Element | null {
                    // 1. Inside the item
                    try {
                      const el = firstItem.querySelector(selector);
                      if (el) return el;
                    } catch { /* invalid selector */ }

                    // 2. Next siblings of the item (accordion content pattern)
                    let sib = firstItem.nextElementSibling;
                    let sibChecked = 0;
                    while (sib && sibChecked < 3) {
                      try {
                        const el = sib.querySelector(selector);
                        if (el) return el;
                      } catch { /* invalid selector */ }
                      sib = sib.nextElementSibling;
                      sibChecked++;
                    }

                    return null;
                  }

                  for (const [fieldName, selector] of Object.entries(activeFields)) {
                    try {
                      const el = findField(selector);
                      const matched = !!el;
                      const text = el ? (el.textContent || "").trim() : "";
                      extracted[fieldName] = text;
                      fieldDiagnostics[fieldName] = {
                        selector,
                        matched,
                        elementTag: el ? el.tagName.toLowerCase() : undefined,
                        extractedText: text.slice(0, 300),
                      };
                      if (el) {
                        const anchor = el.tagName === "A" ? el : el.closest("a");
                        if (anchor) {
                          const href = anchor.getAttribute("href");
                          if (href) extracted[`${fieldName}_href`] = href;
                        }
                      }
                    } catch (e) {
                      extracted[fieldName] = "";
                      fieldDiagnostics[fieldName] = {
                        selector,
                        matched: false,
                        extractedText: "",
                      };
                    }
                  }

                  const hasAnyData = Object.values(extracted).some((v) => v.length > 0);
                  // Tested-or-skipped fields are all considered "handled".
                  // Only fail if every field for the current page returned empty.
                  const activeFieldNames = Object.keys(activeFields);
                  const anyActiveMatched = activeFieldNames.length === 0
                    ? true
                    : activeFieldNames.some((n) => (extracted[n] ?? "").length > 0);

                  chrome.runtime.sendMessage({
                    type: "TEST_EXTRACT_RESULT",
                    result: {
                      success: hasAnyData || (anyActiveMatched && activeFieldNames.length > 0),
                      fields: extracted,
                      error: anyActiveMatched ? undefined : "All field selectors for this page matched empty content",
                      diagnostics: {
                        listingSelector,
                        listingFound,
                        itemSelector,
                        itemsFound,
                        revealDiag,
                        fieldDiagnostics,
                        strategy: "item-scoped",
                      },
                    },
                  } satisfies ExtensionMessage);
                } else {
                  // itemSelector matched 0 elements on this page. This is the
                  // common case when the user is on a NON-listing page in a
                  // multi-page flow (e.g. the detail page) — itemSelector was
                  // captured for the listing. If any fields actually belong
                  // to *this* page, fall back to absolute extraction for them
                  // so the test can still succeed and unlock the Approve
                  // button. Otherwise we'd block the entire approval flow on
                  // a selector that's irrelevant to the current page.
                  const activeFieldNames = Object.keys(activeFields);

                  if (activeFieldNames.length > 0) {
                    if (revealSelector) {
                      revealDiag = {
                        selector: revealSelector,
                        ...(await clickRevealElements(document.body, revealSelector)),
                      };
                    }

                    for (const [fieldName, selector] of Object.entries(activeFields)) {
                      try {
                        const el = document.querySelector(selector);
                        const matched = !!el;
                        const text = el ? (el.textContent || "").trim() : "";
                        extracted[fieldName] = text;
                        fieldDiagnostics[fieldName] = {
                          selector,
                          matched,
                          elementTag: el ? el.tagName.toLowerCase() : undefined,
                          extractedText: text.slice(0, 300),
                        };
                        if (el) {
                          const anchor = el.tagName === "A" ? el : el.closest("a");
                          if (anchor) {
                            const href = anchor.getAttribute("href");
                            if (href) extracted[`${fieldName}_href`] = href;
                          }
                        }
                      } catch {
                        extracted[fieldName] = "";
                        fieldDiagnostics[fieldName] = {
                          selector,
                          matched: false,
                          extractedText: "",
                        };
                      }
                    }

                    const hasAnyData = Object.values(extracted).some((v) => v.length > 0);
                    const anyActiveMatched = activeFieldNames.some(
                      (n) => (extracted[n] ?? "").length > 0,
                    );

                    chrome.runtime.sendMessage({
                      type: "TEST_EXTRACT_RESULT",
                      result: {
                        success: hasAnyData || anyActiveMatched,
                        fields: extracted,
                        error: anyActiveMatched
                          ? undefined
                          : `Item selector "${itemSelector}" matched 0 elements on this page and no field selectors matched either.`,
                        diagnostics: {
                          listingSelector,
                          listingFound,
                          itemSelector,
                          itemsFound: 0,
                          revealDiag,
                          fieldDiagnostics,
                          strategy: "absolute",
                        },
                      },
                    } satisfies ExtensionMessage);
                  } else {
                    // Truly nothing to test on this page (no active fields,
                    // listing items not found). Keep the original failure.
                    for (const [fieldName, selector] of Object.entries(activeFields)) {
                      fieldDiagnostics[fieldName] = {
                        selector,
                        matched: false,
                        extractedText: "",
                      };
                    }

                    chrome.runtime.sendMessage({
                      type: "TEST_EXTRACT_RESULT",
                      result: {
                        success: false,
                        fields: {},
                        error: `No job items found. Item selector "${itemSelector}" matched 0 elements${listingSelector ? ` inside listing container "${listingSelector}"${listingFound ? " (container found)" : " (container NOT found)"}` : ""}.`,
                        diagnostics: {
                          listingSelector,
                          listingFound,
                          itemSelector,
                          itemsFound: 0,
                          revealDiag,
                          fieldDiagnostics,
                          strategy: "item-scoped",
                        },
                      },
                    } satisfies ExtensionMessage);
                  }
                }
              } else {
                // --- Absolute selector strategy ---

                // Click all reveal elements on the page before extracting
                if (revealSelector) {
                  revealDiag = { selector: revealSelector, ...(await clickRevealElements(document.body, revealSelector)) };
                }

                for (const [fieldName, selector] of Object.entries(activeFields)) {
                  try {
                    const el = document.querySelector(selector);
                    const matched = !!el;
                    const text = el ? (el.textContent || "").trim() : "";
                    extracted[fieldName] = text;
                    fieldDiagnostics[fieldName] = {
                      selector,
                      matched,
                      elementTag: el ? el.tagName.toLowerCase() : undefined,
                      extractedText: text.slice(0, 300),
                    };
                    if (el) {
                      const anchor = el.tagName === "A" ? el : el.closest("a");
                      if (anchor) {
                        const href = anchor.getAttribute("href");
                        if (href) extracted[`${fieldName}_href`] = href;
                      }
                    }
                  } catch {
                    extracted[fieldName] = "";
                    fieldDiagnostics[fieldName] = {
                      selector,
                      matched: false,
                      extractedText: "",
                    };
                  }
                }

                const hasAnyData = Object.values(extracted).some((v) => v.length > 0);
                const activeFieldNames = Object.keys(activeFields);
                const anyActiveMatched = activeFieldNames.length === 0
                  ? true
                  : activeFieldNames.some((n) => (extracted[n] ?? "").length > 0);

                chrome.runtime.sendMessage({
                  type: "TEST_EXTRACT_RESULT",
                  result: {
                    success: hasAnyData || (anyActiveMatched && activeFieldNames.length > 0),
                    fields: extracted,
                    error: anyActiveMatched ? undefined : "No field selectors for this page matched any elements",
                    diagnostics: {
                      listingSelector: null,
                      listingFound: false,
                      itemSelector: null,
                      itemsFound: 0,
                      revealDiag,
                      fieldDiagnostics,
                      strategy: "absolute",
                    },
                  },
                } satisfies ExtensionMessage);
              }
            } catch (err) {
              chrome.runtime.sendMessage({
                type: "TEST_EXTRACT_RESULT",
                result: { success: false, fields: {}, error: err instanceof Error ? err.message : "Extraction failed" },
              } satisfies ExtensionMessage);
            }
            })(); // end async IIFE
            sendResponse({ ok: true });
            break;
          }

          default:
            // Ignore messages not meant for the content script
            break;
        }
      }
    );
  },
});
