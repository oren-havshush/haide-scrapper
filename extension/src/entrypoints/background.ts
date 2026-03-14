import { apiFetch } from "../lib/api";
import { hasToken } from "../lib/auth";
import type { ApiListResponse, ApiResponse, SiteConfig, ExtensionMessage, SaveConfigPayload, SaveConfigResult } from "../lib/types";

export default defineBackground(() => {
  interface SiteInfo {
    id: string;
    siteUrl: string;
    status: string;
    confidenceScore: number | null;
  }

  // Runtime cache of recognized sites per tab
  const tabSites = new Map<number, SiteInfo>();

  // Navigate mode state per tab (Story 3-4)
  const tabNavigateMode = new Map<number, boolean>();

  // Form Record mode state per tab (Story 3-5)
  const tabFormRecordMode = new Map<number, boolean>();

  // Debounce URL checks
  let checkTimeout: ReturnType<typeof setTimeout> | null = null;

  async function setBadgeTextSafe(tabId: number, text: string): Promise<void> {
    const actionApi = chrome.action;
    if (!actionApi?.setBadgeText) return;
    try {
      await actionApi.setBadgeText({ text, tabId });
    } catch {
      // Ignore badge errors in contexts where badge APIs are unavailable.
    }
  }

  async function setBadgeBackgroundSafe(tabId: number, color: string): Promise<void> {
    const actionApi = chrome.action;
    if (!actionApi?.setBadgeBackgroundColor) return;
    try {
      await actionApi.setBadgeBackgroundColor({ color, tabId });
    } catch {
      // Ignore badge errors in contexts where badge APIs are unavailable.
    }
  }

  function normalizeUrl(rawUrl: string, includeQuery: boolean): string | null {
    try {
      const url = new URL(rawUrl);
      const origin = url.origin.toLowerCase();
      const pathname = (url.pathname || "/").replace(/\/+$/, "") || "/";
      if (!includeQuery) return `${origin}${pathname}`;

      const query = new URLSearchParams(url.search);
      const sorted = new URLSearchParams(
        Array.from(query.entries()).sort(([a], [b]) => a.localeCompare(b))
      ).toString();
      return `${origin}${pathname}${sorted ? `?${sorted}` : ""}`;
    } catch {
      return null;
    }
  }

  function findBestSiteMatch(currentUrl: string, sites: SiteInfo[]): SiteInfo | null {
    const currentFull = normalizeUrl(currentUrl, true);
    const currentPathOnly = normalizeUrl(currentUrl, false);
    if (!currentFull || !currentPathOnly) return null;

    // Prefer exact full URL match first
    for (const site of sites) {
      const siteFull = normalizeUrl(site.siteUrl, true);
      if (siteFull && siteFull === currentFull) return site;
    }

    // Then fallback to origin+path match (ignore query/hash differences)
    for (const site of sites) {
      const sitePathOnly = normalizeUrl(site.siteUrl, false);
      if (sitePathOnly && sitePathOnly === currentPathOnly) return site;
    }

    // Fallback: same host and related path (prefix/child path)
    try {
      const current = new URL(currentUrl);
      const currentHost = current.hostname.toLowerCase();
      const currentPath = (current.pathname || "/").replace(/\/+$/, "") || "/";

      let bestPrefixMatch: { site: SiteInfo; score: number } | null = null;
      const sameHostSites: SiteInfo[] = [];

      for (const site of sites) {
        let siteParsed: URL;
        try {
          siteParsed = new URL(site.siteUrl);
        } catch {
          continue;
        }
        if (siteParsed.hostname.toLowerCase() !== currentHost) continue;
        sameHostSites.push(site);

        const sitePath = (siteParsed.pathname || "/").replace(/\/+$/, "") || "/";
        const isPrefixRelated =
          currentPath.startsWith(sitePath) || sitePath.startsWith(currentPath);
        if (!isPrefixRelated) continue;

        // Prefer the most specific path match
        const score = Math.max(sitePath.length, currentPath.length);
        if (!bestPrefixMatch || score > bestPrefixMatch.score) {
          bestPrefixMatch = { site, score };
        }
      }

      if (bestPrefixMatch) return bestPrefixMatch.site;
      if (sameHostSites.length === 1) return sameHostSites[0];
    } catch {
      // Ignore URL parsing issues and fall through to null
    }

    return null;
  }

  async function resolveSiteForUrl(url: string): Promise<SiteInfo | null> {
    const encoded = encodeURIComponent(url);
    const exactResult = await apiFetch<ApiListResponse<SiteInfo>>(
      `/api/sites?siteUrl=${encoded}`
    );
    const exactSite = exactResult.data[0] ?? null;
    if (exactSite) return exactSite;

    // Fallback: URL normalization matching (handles query/hash/url-shape variance)
    const listResult = await apiFetch<ApiListResponse<SiteInfo>>(
      "/api/sites?page=1&pageSize=100"
    );
    return findBestSiteMatch(url, listResult.data);
  }

  async function checkSiteUrl(tabId: number, url: string) {
    if (!await hasToken()) {
      await setBadgeTextSafe(tabId, "");
      return;
    }

    try {
      const site = await resolveSiteForUrl(url);

      if (site) {
        tabSites.set(tabId, site);

        // Set badge based on status
        const badgeText = site.status === "REVIEW" ? "R" : site.status === "ACTIVE" ? "A" : "";
        const badgeColor = site.status === "REVIEW" ? "#f59e0b" : "#22c55e";
        await setBadgeTextSafe(tabId, badgeText);
        await setBadgeBackgroundSafe(tabId, badgeColor);
      } else {
        tabSites.delete(tabId);
        await setBadgeTextSafe(tabId, "");
      }
    } catch {
      // Keep previous recognition on transient errors instead of blanking the tab state.
      if (!tabSites.has(tabId)) {
        await setBadgeTextSafe(tabId, "");
      }
    }
  }

  // Listen for tab URL changes
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      if (checkTimeout) clearTimeout(checkTimeout);
      checkTimeout = setTimeout(() => checkSiteUrl(tabId, changeInfo.url!), 2000);
    }
  });

  // Clean up when tabs close
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabSites.delete(tabId);
    tabNavigateMode.delete(tabId);
    tabFormRecordMode.delete(tabId);
  });

  // --- Message Types that should be forwarded to content script ---
  const FORWARD_TO_CONTENT: ExtensionMessage["type"][] = [
    "SHOW_HIGHLIGHTS",
    "START_PICKER",
    "STOP_PICKER",
    "UPDATE_HIGHLIGHT",
    "REMOVE_HIGHLIGHT",
    "CLEAR_HIGHLIGHTS",
    "NAVIGATE_START",
    "NAVIGATE_STOP",
    "FORM_RECORD_START",
    "FORM_RECORD_STOP",
    "TEST_EXTRACT",
  ];

  // --- Message Types that should be forwarded from content script to side panel ---
  const FORWARD_TO_PANEL: ExtensionMessage["type"][] = [
    "ELEMENT_PICKED",
    "HIGHLIGHT_CLICKED",
    "HIGHLIGHT_HOVERED",
    "NAVIGATE_LINK_CLICKED",
    "NAVIGATE_URL_CHANGED",
    "FORM_CAPTURED",
    "TEST_EXTRACT_RESULT",
  ];

  /**
   * Forward a message to the content script of the active tab.
   */
  async function forwardToContentScript(message: ExtensionMessage): Promise<void> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, message);
      } catch {
        // Content script may not be loaded yet
      }
    }
  }

  /**
   * Handle SAVE_CONFIG: PUT config to backend. Does NOT auto-trigger scrape.
   * User must approve test extraction results before triggering full scrape.
   */
  async function handleSaveConfig(payload: SaveConfigPayload): Promise<SaveConfigResult> {
    try {
      // Save config via PUT /api/sites/[id]/config
      await apiFetch<ApiResponse<{ status: string }>>(`/api/sites/${payload.siteId}/config`, {
        method: "PUT",
        body: JSON.stringify({
          listingSelector: payload.listingSelector,
          itemSelector: payload.itemSelector,
          revealSelector: payload.revealSelector,
          fieldMappings: payload.fieldMappings,
          pageFlow: payload.pageFlow,
          formCapture: payload.formCapture,
          originalMappings: payload.originalMappings,
        }),
      });

      return { success: true, siteStatus: "REVIEW" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save config";
      return { success: false, error: message };
    }
  }

  /**
   * Handle APPROVE_AND_SCRAPE: Update site to ACTIVE and trigger full scrape.
   */
  async function handleApproveSite(siteId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Transition site to ACTIVE (skip if already ACTIVE)
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      const cachedSite = tabId ? tabSites.get(tabId) : undefined;
      if (!cachedSite || cachedSite.status !== "ACTIVE") {
        await apiFetch<ApiResponse<unknown>>(`/api/sites/${siteId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "ACTIVE" }),
        });
      }

      // Update cached site status
      if (tabId && tabSites.has(tabId)) {
        const site = tabSites.get(tabId)!;
        tabSites.set(tabId, { ...site, status: "ACTIVE" });
        await setBadgeTextSafe(tabId, "A");
        await setBadgeBackgroundSafe(tabId, "#22c55e");
      }

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to approve site";
      return { success: false, error: message };
    }
  }

  // Handle messages from side panel and content script
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    // --- Existing: GET_SITE_INFO from side panel ---
    if (message.type === "GET_SITE_INFO") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        const currentUrl = tabs[0]?.url;
        if (tabId && currentUrl) {
          resolveSiteForUrl(currentUrl).then((site) => {
            if (site) {
              tabSites.set(tabId, site);
              sendResponse({ site });
            } else {
              tabSites.delete(tabId);
              sendResponse({ site: null });
            }
          }).catch(() => {
            sendResponse({ site: null });
          });
          return;
        }

        if (tabId && tabSites.has(tabId)) {
          sendResponse({ site: tabSites.get(tabId) });
        } else {
          sendResponse({ site: null });
        }
      });
      return true; // async response
    }

    // --- New: GET_SITE_CONFIG from side panel ---
    if (message.type === "GET_SITE_CONFIG") {
      const siteId = message.siteId;
      apiFetch<ApiResponse<SiteConfig>>(`/api/sites/${siteId}/config`)
        .then((result) => {
          sendResponse({ config: result.data });
        })
        .catch((error: Error) => {
          sendResponse({ error: error.message });
        });
      return true; // async response
    }

    // --- Navigate Mode: GET_NAVIGATE_STATE from content script ---
    if (message.type === "GET_NAVIGATE_STATE" && sender.tab) {
      const tabId = sender.tab.id;
      const isNavigateMode = tabId ? tabNavigateMode.get(tabId) === true : false;
      sendResponse({ isNavigateMode });
      return;
    }

    // --- Form Record Mode: GET_FORM_RECORD_STATE from content script ---
    if (message.type === "GET_FORM_RECORD_STATE" && sender.tab) {
      const tabId = sender.tab.id;
      const isFormRecordMode = tabId ? tabFormRecordMode.get(tabId) === true : false;
      sendResponse({ isFormRecordMode });
      return;
    }

    // --- Navigate Mode: Track state when NAVIGATE_START/STOP from side panel ---
    if (message.type === "NAVIGATE_START" && !sender.tab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          tabNavigateMode.set(tabId, true);
          tabFormRecordMode.set(tabId, false);
        }
      });
    }
    if (message.type === "NAVIGATE_STOP" && !sender.tab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          tabNavigateMode.set(tabId, false);
        }
      });
    }

    // --- Form Record Mode: Track state when FORM_RECORD_START/STOP from side panel ---
    if (message.type === "FORM_RECORD_START" && !sender.tab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          tabFormRecordMode.set(tabId, true);
          tabNavigateMode.set(tabId, false);
        }
      });
    }
    if (message.type === "FORM_RECORD_STOP" && !sender.tab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          tabFormRecordMode.set(tabId, false);
        }
      });
    }

    // --- Save Config: Handle SAVE_CONFIG from side panel ---
    if (message.type === "SAVE_CONFIG" && !sender.tab) {
      const payload = message.payload as SaveConfigPayload;
      handleSaveConfig(payload)
        .then((result) => {
          // Send result to side panel
          chrome.runtime.sendMessage({
            type: "SAVE_CONFIG_RESULT",
            result,
          } satisfies ExtensionMessage).catch(() => {
            // Side panel may not be open
          });
          sendResponse({ ok: true });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true; // async response
    }

    // --- Approve and Scrape: Handle APPROVE_AND_SCRAPE from side panel ---
    if (message.type === "APPROVE_AND_SCRAPE" && !sender.tab) {
      const siteId = message.siteId;
      handleApproveSite(siteId)
        .then((result) => {
          chrome.runtime.sendMessage({
            type: "APPROVE_AND_SCRAPE_RESULT",
            result,
          } satisfies ExtensionMessage).catch(() => {
            // Side panel may not be open
          });
          sendResponse({ ok: true });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true; // async response
    }

    // --- Forward messages from side panel to content script ---
    if (FORWARD_TO_CONTENT.includes(message.type) && !sender.tab) {
      // Message is from the side panel (no tab = extension page)
      forwardToContentScript(message).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true; // async response
    }

    // --- Forward messages from content script to side panel ---
    if (FORWARD_TO_PANEL.includes(message.type) && sender.tab) {
      // Message is from a content script (has tab)
      // Re-broadcast to all extension pages (side panel listens as extension page)
      chrome.runtime.sendMessage(message).catch(() => {
        // Side panel may not be open
      });
      // No sendResponse needed for forwarding
    }
  });
});
