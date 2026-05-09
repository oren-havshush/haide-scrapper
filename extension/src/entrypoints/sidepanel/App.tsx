import { useState, useEffect, useCallback, useRef } from "react";
import { hasToken } from "../../lib/auth";
import { deriveUrlPattern } from "../../content/NavigateRecorder";
import type {
  FieldMappingEntry,
  AIFieldMappings,
  AIFieldMapping,
  HighlightConfig,
  ExtensionMessage,
  SiteConfig,
  ExtensionMode,
  NavigateFlowStep,
  FormCapture,
  SaveConfigPayload,
  SaveConfigResult,
  TestExtractResult,
  ApproveAndScrapeResult,
} from "../../lib/types";
import FieldMappingPanel from "./FieldMappingPanel";
import NavigateFlowPanel from "./NavigateFlowPanel";
import FormRecordPanel from "./FormRecordPanel";

interface SiteInfo {
  id: string;
  siteUrl: string;
  status: string;
  confidenceScore: number | null;
}

// --- Helper: send message to background ---

function sendMessage(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => {
    // Background may not be ready
  });
}

// --- Helper: parse AI field mappings into FieldMappingEntry[] ---

function parseFieldMappings(raw: Record<string, unknown> | null): FieldMappingEntry[] {
  if (!raw || typeof raw !== "object") return [];

  const mappings = raw as AIFieldMappings;
  return Object.entries(mappings)
    .filter(([key]) => key !== "_meta")
    .map(([fieldName, mapping]) => ({
      fieldName,
      selector: mapping.selector || "",
      confidence: typeof mapping.confidence === "number" ? mapping.confidence : 0,
      status: "unconfirmed" as const,
      capturedOnUrl: typeof mapping.capturedOnUrl === "string" ? mapping.capturedOnUrl : undefined,
    }));
}

// --- Helper: get the active tab URL (for stamping capturedOnUrl) ---

async function getActiveTabUrl(): Promise<string | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.url ?? undefined;
  } catch {
    return undefined;
  }
}

// --- Helper: build HighlightConfig from FieldMappingEntry ---

function toHighlightConfig(field: FieldMappingEntry): HighlightConfig {
  return {
    fieldName: field.fieldName,
    selector: field.selector,
    confidence: field.confidence,
    status: field.status,
  };
}

// --- Helper: create initial navigate flow steps ---

function createInitialNavigateSteps(listingUrl?: string): NavigateFlowStep[] {
  return [
    {
      type: "listing",
      url: listingUrl || null,
      urlPattern: listingUrl ? deriveUrlPattern(listingUrl) : null,
      linkSelector: null,
      status: listingUrl ? "recorded" : "current",
    },
    {
      type: "detail",
      url: null,
      urlPattern: null,
      linkSelector: null,
      status: "pending",
    },
    {
      type: "apply",
      url: null,
      urlPattern: null,
      linkSelector: null,
      status: "pending",
    },
  ];
}

function mapPageFlowToNavigateSteps(
  pageFlow: SiteConfig["pageFlow"] | null | undefined,
  listingUrl?: string
): NavigateFlowStep[] {
  const initial = createInitialNavigateSteps(listingUrl);
  if (!Array.isArray(pageFlow) || pageFlow.length === 0) return initial;

  const mapped = [...initial];
  const listing = pageFlow[0];
  if (listing?.url) {
    mapped[0] = {
      type: "listing",
      url: listing.url,
      urlPattern: deriveUrlPattern(listing.url),
      linkSelector: null,
      status: "recorded",
    };
  }

  const detail = pageFlow[1];
  if (detail?.url) {
    mapped[1] = {
      type: "detail",
      url: detail.url,
      urlPattern: deriveUrlPattern(detail.url),
      linkSelector: detail.action && detail.action !== "navigate" ? detail.action : null,
      status: "recorded",
    };
  }

  const apply = pageFlow[2];
  if (apply?.url) {
    mapped[2] = {
      type: "apply",
      url: apply.url,
      urlPattern: deriveUrlPattern(apply.url),
      linkSelector: apply.action && apply.action !== "navigate" ? apply.action : null,
      status: "recorded",
    };
  }

  return mapped;
}

export default function App() {
  // --- Core state from story 3-2 ---
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [tokenConfigured, setTokenConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  // --- Mode state (Story 3-4) ---
  const [activeMode, setActiveMode] = useState<ExtensionMode>("review");

  // --- Review Mode state ---
  const [fields, setFields] = useState<FieldMappingEntry[]>([]);
  const [pickerTarget, setPickerTarget] = useState<string | null>(null);
  const [isAddingField, setIsAddingField] = useState(false);
  const [showFieldTypeDropdown, setShowFieldTypeDropdown] = useState(false);
  const [pendingSelector, setPendingSelector] = useState<string | null>(null);
  const [pendingCapturedUrl, setPendingCapturedUrl] = useState<string | undefined>(undefined);

  // The active tab's URL, refreshed on tab/url changes so the field-row
  // page chips reflect the current browsing context.
  const [currentTabUrl, setCurrentTabUrl] = useState<string>("");

  // --- Container/Item/Reveal selector state ---
  const [listingSelector, setListingSelector] = useState<string | null>(null);
  const [itemSelector, setItemSelector] = useState<string | null>(null);
  const [revealSelector, setRevealSelector] = useState<string | null>(null);
  const [pickingContainer, setPickingContainer] = useState<"listing" | "item" | "reveal" | null>(null);

  // --- Navigate Mode state (Story 3-4) ---
  const [navigateSteps, setNavigateSteps] = useState<NavigateFlowStep[]>(
    createInitialNavigateSteps()
  );

  // --- Form Record Mode state (Story 3-5) ---
  const [capturedForm, setCapturedForm] = useState<FormCapture | null>(null);

  // --- Original AI mappings for training data (Story 3-5, FR13) ---
  const originalMappingsRef = useRef<Record<string, AIFieldMapping> | null>(null);

  // --- Save Config state (Story 3-5) ---
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // --- Test Extraction state ---
  const [testResult, setTestResult] = useState<TestExtractResult | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState(false);

  const loadSiteInfo = useCallback(async () => {
    console.log("[scrapnew] loadSiteInfo: start");
    const configured = await hasToken();
    console.log("[scrapnew] hasToken:", configured);
    setTokenConfigured(configured);

    if (!configured) {
      setLoading(false);
      return;
    }

    try {
      const response = (await Promise.race([
        chrome.runtime.sendMessage({ type: "GET_SITE_INFO" }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("GET_SITE_INFO timeout after 8s")), 8000)
        ),
      ])) as { site?: SiteInfo } | undefined;

      console.log("[scrapnew] GET_SITE_INFO response:", response);
      if (response?.site) {
        setSite(response.site as SiteInfo);
      } else {
        setSite(null);
      }
    } catch (err) {
      console.warn("[scrapnew] GET_SITE_INFO failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Load site info on mount ---
  useEffect(() => {
    void loadSiteInfo();
  }, [loadSiteInfo]);

  // --- Refresh site info + currentTabUrl when active tab/url changes ---
  useEffect(() => {
    if (!tokenConfigured) return;

    const refreshUrl = () => {
      void getActiveTabUrl().then((u) => setCurrentTabUrl(u ?? ""));
    };
    refreshUrl(); // initial
    const handleTabActivated = () => {
      void loadSiteInfo();
      refreshUrl();
    };
    const handleTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (!tab.active) return;
      if (typeof changeInfo.url === "string" || changeInfo.status === "complete") {
        void loadSiteInfo();
        refreshUrl();
      }
    };

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, [loadSiteInfo, tokenConfigured]);

  useEffect(() => {
    originalMappingsRef.current = null;
  }, [site?.id]);

  // --- Load site config when site is recognized and has REVIEW status ---

  useEffect(() => {
    if (!site) return;
    const siteId = site.id;
    const siteUrl = site.siteUrl;

    async function loadConfig() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_SITE_CONFIG",
          siteId,
        } satisfies ExtensionMessage);

        if (response?.config) {
          const config = response.config as SiteConfig;
          const rawMappings = config.fieldMappings as unknown as Record<string, unknown>;
          const parsed = parseFieldMappings(rawMappings);
          setFields(parsed);
          setTestResult(null);
          setSaveSuccess(false);
          setApproveSuccess(false);
          setApproveError(null);

          // Restore container/item selectors from _meta if saved previously
          const meta = rawMappings?.["_meta"] as Record<string, unknown> | undefined;
          if (meta) {
            if (typeof meta["listingSelector"] === "string") {
              setListingSelector(meta["listingSelector"]);
            }
            if (typeof meta["itemSelector"] === "string") {
              setItemSelector(meta["itemSelector"]);
            }
            if (typeof meta["revealSelector"] === "string") {
              setRevealSelector(meta["revealSelector"]);
            }
            setCapturedForm(
              meta["formCapture"] && typeof meta["formCapture"] === "object"
                ? (meta["formCapture"] as FormCapture)
                : null
            );
          } else {
            setListingSelector(null);
            setItemSelector(null);
            setRevealSelector(null);
            setCapturedForm(null);
          }

          if (rawMappings) {
            const original: Record<string, AIFieldMapping> = {};
            for (const [key, value] of Object.entries(rawMappings)) {
              if (key === "_meta") continue; // Skip meta key
              const mapping = value as AIFieldMapping;
              if (mapping && typeof mapping === "object" && "selector" in mapping) {
                original[key] = {
                  selector: mapping.selector || "",
                  confidence: typeof mapping.confidence === "number" ? mapping.confidence : 0,
                  source: typeof mapping.source === "string" ? mapping.source : "unknown",
                };
              }
            }
            originalMappingsRef.current = original;
          }

          setNavigateSteps(mapPageFlowToNavigateSteps(config.pageFlow, siteUrl));

          // Send highlights to content script
          sendMessage({
            type: "SHOW_HIGHLIGHTS",
            fields: parsed,
          });
        } else if (response?.error) {
          console.error("Failed to load site config:", response.error);
        }
      } catch {
        // Failed to fetch config
      }
    }

    void loadConfig();
  }, [site?.id]);

  // --- Listen for messages from content script (via background) ---

  const handleContentMessage = useCallback(
    (message: ExtensionMessage) => {
      switch (message.type) {
        case "ELEMENT_PICKED": {
          const { selector } = message;

          if (pickingContainer === "listing") {
            setListingSelector(selector);
            setPickingContainer(null);
          } else if (pickingContainer === "item") {
            setItemSelector(selector);
            setPickingContainer(null);
          } else if (pickingContainer === "reveal") {
            setRevealSelector(selector);
            setPickingContainer(null);
          } else if (isAddingField) {
            setPendingSelector(selector);
            setShowFieldTypeDropdown(true);
            setIsAddingField(false);
            // Stash the URL for stamping when the user picks the field type
            void getActiveTabUrl().then((u) => setPendingCapturedUrl(u));
          } else if (pickerTarget) {
            const targetFieldName = pickerTarget;
            void getActiveTabUrl().then((capturedOnUrl) => {
              setFields((prev) =>
                prev.map((f) => {
                  if (f.fieldName === targetFieldName) {
                    const updated: FieldMappingEntry = {
                      ...f,
                      selector,
                      status: "confirmed",
                      capturedOnUrl,
                    };
                    sendMessage({
                      type: "SHOW_HIGHLIGHTS",
                      fields: prev.map((pf) =>
                        pf.fieldName === targetFieldName ? updated : pf
                      ),
                    });
                    return updated;
                  }
                  return f;
                })
              );
            });
            setPickerTarget(null);
          }
          break;
        }

        case "HIGHLIGHT_CLICKED": {
          const { fieldName } = message;
          // Enter edit mode for the clicked field
          handleEditField(fieldName);
          break;
        }

        case "HIGHLIGHT_HOVERED": {
          // Could scroll to field in panel, but keeping simple for now
          break;
        }

        // --- Navigate Mode messages (Story 3-4) ---

        case "NAVIGATE_LINK_CLICKED": {
          handleNavigateLinkClicked(message.url, message.selector);
          break;
        }

        case "NAVIGATE_URL_CHANGED": {
          // URL change confirmation -- we use NAVIGATE_LINK_CLICKED for recording
          // This just confirms the navigation happened
          break;
        }

        // --- Form Record Mode messages (Story 3-5) ---

        case "FORM_CAPTURED": {
          setCapturedForm(message.form);
          break;
        }

        // --- Save Config result (Story 3-5) ---

        case "SAVE_CONFIG_RESULT": {
          const result = message.result as SaveConfigResult;
          setIsSaving(false);
          if (result.success) {
            setSaveSuccess(true);
            setSaveError(null);
            if (site && result.siteStatus) {
              setSite({ ...site, status: result.siteStatus });
            }
            // Trigger test extraction immediately after save
            triggerTestExtract();
          } else {
            setSaveSuccess(false);
            setSaveError(result.error || "Failed to save config");
          }
          break;
        }

        // --- Test Extraction result ---

        case "TEST_EXTRACT_RESULT": {
          const result = message.result as TestExtractResult;
          setTestResult(result);
          break;
        }

        // --- Approve and Scrape result ---

        case "APPROVE_AND_SCRAPE_RESULT": {
          const result = message.result as ApproveAndScrapeResult;
          setIsApproving(false);
          if (result.success) {
            setApproveSuccess(true);
            setApproveError(null);
            if (site) {
              setSite({ ...site, status: "ACTIVE" });
            }
          } else {
            setApproveError(result.error || "Failed to approve");
          }
          break;
        }

        default:
          break;
      }
    },
    [pickerTarget, isAddingField, pickingContainer, navigateSteps, site]
  );

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      handleContentMessage(message);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [handleContentMessage]);

  // --- Mode switching handler (Story 3-4) ---

  function handleModeChange(newMode: ExtensionMode) {
    if (newMode === activeMode) return;

    const previousMode = activeMode;
    setActiveMode(newMode);

    if (newMode === "navigate") {
      // Stop any active picker from Review Mode
      if (pickerTarget || isAddingField) {
        sendMessage({ type: "STOP_PICKER" });
        setPickerTarget(null);
        setIsAddingField(false);
        setShowFieldTypeDropdown(false);
        setPendingSelector(null);
      }

      // Revert any editing fields
      setFields((prev) =>
        prev.map((f) =>
          f.status === "editing" ? { ...f, status: "unconfirmed" as const } : f
        )
      );

      // Stop form recording if coming from form record mode
      if (previousMode === "formRecord") {
        sendMessage({ type: "FORM_RECORD_STOP" });
      }

      // Initialize listing step with current tab URL
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0]?.url || site?.siteUrl || "";
        setNavigateSteps((prev) => {
          // Only update listing step if not already recorded with a different URL
          const listingStep = prev[0];
          if (listingStep.status !== "recorded" || !listingStep.url) {
            return createInitialNavigateSteps(currentUrl);
          }
          return prev;
        });
      });

      // Send NAVIGATE_START to content script (clears highlights + starts recording)
      sendMessage({ type: "NAVIGATE_START" });
    }

    if (newMode === "formRecord") {
      // Stop any active picker from Review Mode
      if (pickerTarget || isAddingField) {
        sendMessage({ type: "STOP_PICKER" });
        setPickerTarget(null);
        setIsAddingField(false);
        setShowFieldTypeDropdown(false);
        setPendingSelector(null);
      }

      // Revert any editing fields
      setFields((prev) =>
        prev.map((f) =>
          f.status === "editing" ? { ...f, status: "unconfirmed" as const } : f
        )
      );

      // Stop navigate recording if coming from navigate mode
      if (previousMode === "navigate") {
        sendMessage({ type: "NAVIGATE_STOP" });
      }

      // Send FORM_RECORD_START to content script (clears highlights + starts form recording)
      sendMessage({ type: "FORM_RECORD_START" });
    }

    if (newMode === "review") {
      // Send NAVIGATE_STOP to content script
      if (previousMode === "navigate") {
        sendMessage({ type: "NAVIGATE_STOP" });
      }

      // Stop form recording if coming from form record mode
      if (previousMode === "formRecord") {
        sendMessage({ type: "FORM_RECORD_STOP" });
      }

      // Re-show field highlights on page
      sendMessage({
        type: "SHOW_HIGHLIGHTS",
        fields,
      });
    }
  }

  // --- Navigate Mode: handle link click recording (Story 3-4) ---

  function handleNavigateLinkClicked(url: string, selector: string) {
    setNavigateSteps((prev) => {
      const detailStep = prev.find((s) => s.type === "detail");
      const applyStep = prev.find((s) => s.type === "apply");

      // If detail page not yet recorded, record as detail
      if (!detailStep || detailStep.status !== "recorded") {
        return prev.map((step) => {
          if (step.type === "detail") {
            return {
              ...step,
              url,
              urlPattern: deriveUrlPattern(url),
              linkSelector: selector,
              status: "recorded" as const,
            };
          }
          return step;
        });
      }

      // If detail recorded but apply not yet, record as apply
      if (!applyStep || applyStep.status !== "recorded") {
        return prev.map((step) => {
          if (step.type === "apply") {
            return {
              ...step,
              url,
              urlPattern: deriveUrlPattern(url),
              linkSelector: selector,
              status: "recorded" as const,
            };
          }
          return step;
        });
      }

      // Both recorded -- ignore further clicks
      return prev;
    });
  }

  // --- Navigate Mode: reset handler ---

  function handleNavigateReset() {
    // Get current tab URL for listing step
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0]?.url || site?.siteUrl || "";
      setNavigateSteps(createInitialNavigateSteps(currentUrl));
    });
  }

  // --- Review Mode Action handlers ---

  function handleConfirmField(fieldName: string) {
    setFields((prev) => {
      const updated = prev.map((f) =>
        f.fieldName === fieldName ? { ...f, status: "confirmed" as const } : f
      );
      // Update highlights on page
      sendMessage({
        type: "UPDATE_HIGHLIGHT",
        fieldName,
        config: toHighlightConfig(
          updated.find((f) => f.fieldName === fieldName)!
        ),
      });
      return updated;
    });
  }

  function handleEditField(fieldName: string) {
    if (pickerTarget || isAddingField) {
      sendMessage({ type: "STOP_PICKER" });
    }

    setIsAddingField(false);
    setShowFieldTypeDropdown(false);
    setPendingSelector(null);
    setPickerTarget(fieldName);

    setFields((prev) => {
      const updated = prev.map((f) =>
        f.fieldName === fieldName
          ? { ...f, status: "editing" as const }
          : f.status === "editing"
          ? { ...f, status: "unconfirmed" as const }
          : f
      );
      sendMessage({
        type: "SHOW_HIGHLIGHTS",
        fields: updated,
      });
      return updated;
    });

    sendMessage({
      type: "START_PICKER",
      fieldName,
      scopeSelector: itemSelector ?? undefined,
    });
  }

  function handleRemoveField(fieldName: string) {
    setFields((prev) => prev.filter((f) => f.fieldName !== fieldName));
    sendMessage({ type: "REMOVE_HIGHLIGHT", fieldName });

    // If we were editing this field, cancel picker
    if (pickerTarget === fieldName) {
      sendMessage({ type: "STOP_PICKER" });
      setPickerTarget(null);
    }
  }

  /**
   * Stamp the active tab's URL onto a field's `capturedOnUrl` without
   * changing its selector. This is the easy way to bind a field to the
   * page it should be extracted from when re-picking is awkward (e.g.
   * the picker state is lost across page navigations).
   */
  function handleStampCurrentPage(fieldName: string) {
    void getActiveTabUrl().then((url) => {
      if (!url) return;
      setFields((prev) =>
        prev.map((f) =>
          f.fieldName === fieldName ? { ...f, capturedOnUrl: url } : f
        )
      );
    });
  }

  function handleAddField() {
    if (pickerTarget) {
      sendMessage({ type: "STOP_PICKER" });
      setFields((prev) =>
        prev.map((f) =>
          f.status === "editing" ? { ...f, status: "unconfirmed" as const } : f
        )
      );
    }

    setPickerTarget(null);
    setIsAddingField(true);
    setShowFieldTypeDropdown(false);
    setPendingSelector(null);

    sendMessage({
      type: "START_PICKER",
      fieldName: null,
      scopeSelector: itemSelector ?? undefined,
    });
  }

  function handleSelectFieldType(fieldType: string) {
    if (!pendingSelector) return;

    const newField: FieldMappingEntry = {
      fieldName: fieldType,
      selector: pendingSelector,
      confidence: 100, // manually added = 100% confidence
      status: "confirmed",
      capturedOnUrl: pendingCapturedUrl,
    };

    // Ensure unique field name
    let uniqueName = fieldType;
    let counter = 1;
    const existingNames = new Set(fields.map((f) => f.fieldName));
    while (existingNames.has(uniqueName)) {
      counter++;
      uniqueName = `${fieldType}_${counter}`;
    }
    newField.fieldName = uniqueName;

    setFields((prev) => {
      const updated = [...prev, newField];
      // Show all highlights including new one
      sendMessage({
        type: "SHOW_HIGHLIGHTS",
        fields: updated,
      });
      return updated;
    });

    setShowFieldTypeDropdown(false);
    setPendingSelector(null);
    setPendingCapturedUrl(undefined);
    setIsAddingField(false);
  }

  function handleCancelAddField() {
    sendMessage({ type: "STOP_PICKER" });
    setIsAddingField(false);
    setShowFieldTypeDropdown(false);
    setPendingSelector(null);
    setPendingCapturedUrl(undefined);
    setPickerTarget(null);
    setPickingContainer(null);

    setFields((prev) =>
      prev.map((f) =>
        f.status === "editing" ? { ...f, status: "unconfirmed" as const } : f
      )
    );
  }

  // --- Container / Item picker handlers ---

  function handlePickListingContainer() {
    if (pickerTarget || isAddingField) {
      sendMessage({ type: "STOP_PICKER" });
    }
    setPickerTarget(null);
    setIsAddingField(false);
    setPickingContainer("listing");
    sendMessage({
      type: "START_PICKER",
      fieldName: null,
      useItemSelector: true,
      expectMultiple: false,
    });
  }

  function handlePickRevealAction() {
    if (pickerTarget || isAddingField) {
      sendMessage({ type: "STOP_PICKER" });
    }
    setPickerTarget(null);
    setIsAddingField(false);
    setPickingContainer("reveal");
    sendMessage({
      type: "START_PICKER",
      fieldName: null,
      scopeSelector: itemSelector ?? undefined,
      useItemSelector: true,
      expectMultiple: false,
    });
  }

  function handlePickItemWrapper() {
    if (pickerTarget || isAddingField) {
      sendMessage({ type: "STOP_PICKER" });
    }
    setPickerTarget(null);
    setIsAddingField(false);
    setPickingContainer("item");
    sendMessage({
      type: "START_PICKER",
      fieldName: null,
      scopeSelector: listingSelector ?? undefined,
      useItemSelector: true,
    });
  }

  // --- Form Record Mode: clear captured form ---

  function handleClearForm() {
    setCapturedForm(null);
  }

  // --- Test Extraction handler ---

  function triggerTestExtract() {
    // Build selector map from current fields, carrying capturedOnUrl so the
    // content script can skip fields whose page is not the active tab.
    const selectorMap: Record<string, { selector: string; capturedOnUrl?: string }> = {};
    for (const field of fields) {
      selectorMap[field.fieldName] = {
        selector: field.selector,
        capturedOnUrl: field.capturedOnUrl,
      };
    }

    setTestResult(null);

    void getActiveTabUrl().then((currentUrl) => {
      const pageFlowUrls = navigateSteps
        .filter((step) => step.status === "recorded")
        .map((step) => step.urlPattern || step.url || "")
        .filter((u): u is string => Boolean(u));

      sendMessage({
        type: "TEST_EXTRACT",
        fieldMappings: selectorMap,
        listingSelector: listingSelector,
        itemSelector: itemSelector,
        revealSelector: revealSelector,
        currentUrl: currentUrl ?? "",
        pageFlowUrls,
      });
    });
  }

  // --- Approve and trigger full scrape ---

  function handleApproveAndScrape() {
    if (!site || isApproving) return;
    setIsApproving(true);
    setApproveError(null);

    sendMessage({
      type: "APPROVE_AND_SCRAPE",
      siteId: site.id,
    });
  }

  // --- Save Config handler (Story 3-5) ---

  function handleSaveConfig() {
    if (!site || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    // Build field mappings payload from current Review Mode fields
    const fieldMappingsPayload: Record<string, { selector: string; confidence: number; source: string; capturedOnUrl?: string }> = {};
    for (const field of fields) {
      fieldMappingsPayload[field.fieldName] = {
        selector: field.selector,
        confidence: field.confidence,
        source: field.status === "confirmed" ? "MANUAL" : "AI",
        capturedOnUrl: field.capturedOnUrl,
      };
    }

    // Build page flow payload from Navigate Mode steps
    const pageFlowPayload = navigateSteps
      .filter((step) => step.status === "recorded")
      .map((step) => ({
        url: step.urlPattern || step.url || "",
        action: step.linkSelector || "navigate",
        waitFor: undefined,
      }));

    // Build original mappings for training data
    const originalMappingsPayload: Record<string, { selector: string; confidence: number; source: string; capturedOnUrl?: string }> | undefined =
      originalMappingsRef.current
        ? Object.fromEntries(
            Object.entries(originalMappingsRef.current).map(([key, val]) => [
              key,
              { selector: val.selector, confidence: val.confidence, source: val.source, capturedOnUrl: val.capturedOnUrl },
            ])
          )
        : undefined;

    const payload: SaveConfigPayload = {
      siteId: site.id,
      listingSelector: listingSelector ?? undefined,
      itemSelector: itemSelector ?? undefined,
      revealSelector: revealSelector ?? undefined,
      fieldMappings: fieldMappingsPayload,
      pageFlow: pageFlowPayload,
      formCapture: capturedForm,
      originalMappings: originalMappingsPayload,
    };

    sendMessage({ type: "SAVE_CONFIG", payload });
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="min-h-screen bg-card text-foreground font-sans flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!tokenConfigured) {
    return (
      <div className="min-h-screen bg-card text-foreground font-sans p-4">
        <div className="rounded-lg border border-error/30 bg-error/5 p-4">
          <h2 className="text-sm font-medium text-error mb-2">Token Not Configured</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Configure your API token in extension settings to use scrapnew.
          </p>
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            className="px-3 py-1.5 bg-foreground text-background rounded-md text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="min-h-screen bg-card text-foreground font-sans p-4">
        <div className="text-center py-8">
          <div className="text-muted-foreground text-sm">
            This site is not in the scrapnew system
          </div>
          <p className="text-xs text-muted mt-2">
            Navigate to a site that has been submitted for scraping.
          </p>
        </div>
      </div>
    );
  }

  // --- Form Record Mode ---
  if (activeMode === "formRecord") {
    return (
      <FormRecordPanel
        siteUrl={site.siteUrl}
        capturedForm={capturedForm}
        activeMode={activeMode}
        onModeChange={handleModeChange}
        onClear={handleClearForm}
        isSaving={isSaving}
        saveError={saveError}
        saveSuccess={saveSuccess}
        onSaveConfig={handleSaveConfig}
      />
    );
  }

  // --- Navigate Mode ---
  if (activeMode === "navigate") {
    return (
      <NavigateFlowPanel
        siteUrl={site.siteUrl}
        steps={navigateSteps}
        activeMode={activeMode}
        onModeChange={handleModeChange}
        onReset={handleNavigateReset}
        isSaving={isSaving}
        saveError={saveError}
        saveSuccess={saveSuccess}
        onSaveConfig={handleSaveConfig}
      />
    );
  }

  // --- Review Mode (default) ---
  return (
    <FieldMappingPanel
      siteUrl={site.siteUrl}
      fields={fields}
      pickerTarget={pickerTarget}
      isAddingField={isAddingField}
      showFieldTypeDropdown={showFieldTypeDropdown}
      activeMode={activeMode}
      onModeChange={handleModeChange}
      onConfirmField={handleConfirmField}
      onEditField={handleEditField}
      onRemoveField={handleRemoveField}
      onStampCurrentPage={handleStampCurrentPage}
      currentTabUrl={currentTabUrl}
      onAddField={handleAddField}
      onSelectFieldType={handleSelectFieldType}
      onCancelAddField={handleCancelAddField}
      isSaving={isSaving}
      saveError={saveError}
      saveSuccess={saveSuccess}
      onSaveConfig={handleSaveConfig}
      listingSelector={listingSelector}
      itemSelector={itemSelector}
      revealSelector={revealSelector}
      pickingContainer={pickingContainer}
      onPickListingContainer={handlePickListingContainer}
      onPickItemWrapper={handlePickItemWrapper}
      onPickRevealAction={handlePickRevealAction}
      onSetListingSelector={setListingSelector}
      onSetItemSelector={setItemSelector}
      onSetRevealSelector={setRevealSelector}
      testResult={testResult}
      isApproving={isApproving}
      approveError={approveError}
      approveSuccess={approveSuccess}
      onApproveAndScrape={handleApproveAndScrape}
    />
  );
}
