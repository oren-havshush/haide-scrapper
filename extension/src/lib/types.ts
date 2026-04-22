export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface SiteConfig {
  fieldMappings: Record<string, FieldMapping>;
  pageFlow: PageFlowStep[];
}

export interface FieldMapping {
  selector: string;
  type: FieldType;
  required: boolean;
}

export type FieldType = "text" | "link" | "html" | "attribute" | "computed";

export interface PageFlowStep {
  url: string;
  action: string;
  waitFor?: string;
}

// --- Review Mode Types (Story 3-3) ---

/** AI-produced field mapping stored in Site.fieldMappings */
export interface AIFieldMapping {
  selector: string;
  confidence: number; // 0-100
  source: string; // "PATTERN_MATCH" | "CRAWL_CLASSIFY" | "NETWORK_INTERCEPT"
}

/** AI-produced field mappings keyed by field name */
export type AIFieldMappings = Record<string, AIFieldMapping>;

/** Status of a single field mapping in the review UI */
export type FieldMappingStatus = "confirmed" | "unconfirmed" | "editing";

/** A single field mapping entry for the review UI */
export interface FieldMappingEntry {
  fieldName: string;
  selector: string;
  confidence: number;
  status: FieldMappingStatus;
}

/** State of Review Mode in the side panel */
export interface ReviewModeState {
  fields: FieldMappingEntry[];
  pickerTarget: string | null; // fieldName currently in picker mode, or null
  isAddingField: boolean; // true when "Add Field" picker is active
}

/** Configuration for a highlight overlay on the target page */
export interface HighlightConfig {
  fieldName: string;
  selector: string;
  confidence: number;
  status: FieldMappingStatus;
}

// --- Navigate Mode Types (Story 3-4) ---

/** Extension mode: which mode the side panel is currently in */
export type ExtensionMode = "review" | "navigate" | "formRecord";

/** A single step in the navigation flow recording */
export interface NavigateFlowStep {
  type: "listing" | "detail" | "apply";
  url: string | null;
  urlPattern: string | null;
  linkSelector: string | null;
  status: "pending" | "current" | "recorded";
}

/** State of Navigate Mode in the side panel */
export interface NavigateModeState {
  steps: NavigateFlowStep[];
  activeStepIndex: number;
  isRecording: boolean;
}

// --- Form Record Mode Types (Story 3-5) ---

/** A single form field extracted from a <form> element */
export interface FormFieldInfo {
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
  tagName: string;
}

/** Complete form capture -- one click extracts the entire form */
export interface FormCapture {
  formSelector: string;
  actionUrl: string;
  method: string;
  fields: FormFieldInfo[];
}

/** @deprecated Use FormCapture instead */
export interface FormFieldEntry {
  selector: string;
  fieldType: "text" | "select" | "checkbox" | "radio" | "textarea" | "submit";
  label: string;
  tagName: string;
}

/** State of Form Record Mode in the side panel */
export interface FormRecordModeState {
  capturedForm: FormCapture | null;
  isRecording: boolean;
}

/** Payload for saving site configuration */
export interface SaveConfigPayload {
  siteId: string;
  listingSelector?: string;
  itemSelector?: string;
  revealSelector?: string;
  fieldMappings: Record<string, {
    selector: string;
    confidence: number;
    source: string;
  }>;
  pageFlow: Array<{
    url: string;
    action: string;
    waitFor?: string;
  }>;
  formCapture: FormCapture | null;
  originalMappings?: Record<string, {
    selector: string;
    confidence: number;
    source: string;
  }>;
}

/** Result of save config operation */
export interface SaveConfigResult {
  success: boolean;
  error?: string;
  siteStatus?: string;
}

/** Per-field diagnostic from test extraction */
export interface FieldDiagnostic {
  selector: string;
  matched: boolean;
  elementTag?: string;
  extractedText: string;
}

/** Diagnostics for the reveal/accordion click */
export interface RevealDiagnostic {
  selector: string | null;
  found: number;
  clicked: number;
}

/** Result of test extraction (one job preview) */
export interface TestExtractResult {
  success: boolean;
  fields: Record<string, string>;
  error?: string;
  diagnostics?: {
    listingSelector: string | null;
    listingFound: boolean;
    itemSelector: string | null;
    itemsFound: number;
    revealDiag?: RevealDiagnostic;
    fieldDiagnostics: Record<string, FieldDiagnostic>;
    strategy: "item-scoped" | "absolute";
  };
}

/** Result of approving the test scrape and going to full scrape */
export interface ApproveAndScrapeResult {
  success: boolean;
  error?: string;
}

// --- Extension Messaging Types (Story 3-3 + 3-4 + 3-5) ---

/** Messages sent FROM content script TO background/side panel */
export type ContentMessage =
  | { type: "ELEMENT_PICKED"; selector: string; tagName: string; textContent: string }
  | { type: "HIGHLIGHT_CLICKED"; fieldName: string }
  | { type: "HIGHLIGHT_HOVERED"; fieldName: string }
  | { type: "NAVIGATE_LINK_CLICKED"; url: string; selector: string }
  | { type: "NAVIGATE_URL_CHANGED"; url: string }
  | { type: "FORM_CAPTURED"; form: FormCapture }
  | { type: "TEST_EXTRACT_RESULT"; result: TestExtractResult };

/** Messages sent FROM side panel TO background/content script */
export type PanelMessage =
  | { type: "SHOW_HIGHLIGHTS"; fields: FieldMappingEntry[] }
  | { type: "START_PICKER"; fieldName: string | null; scopeSelector?: string; useItemSelector?: boolean; expectMultiple?: boolean }
  | { type: "STOP_PICKER" }
  | { type: "UPDATE_HIGHLIGHT"; fieldName: string; config: HighlightConfig }
  | { type: "REMOVE_HIGHLIGHT"; fieldName: string }
  | { type: "CLEAR_HIGHLIGHTS" }
  | { type: "GET_SITE_INFO" }
  | { type: "GET_SITE_CONFIG"; siteId: string }
  | { type: "NAVIGATE_START" }
  | { type: "NAVIGATE_STOP" }
  | { type: "FORM_RECORD_START" }
  | { type: "FORM_RECORD_STOP" }
  | { type: "SAVE_CONFIG"; payload: SaveConfigPayload }
  | { type: "TEST_EXTRACT"; fieldMappings: Record<string, string>; listingSelector: string | null; itemSelector: string | null; revealSelector: string | null }
  | { type: "APPROVE_AND_SCRAPE"; siteId: string };

/** Messages for state check between content script and background */
export type StateCheckMessage =
  | { type: "GET_NAVIGATE_STATE" }
  | { type: "GET_FORM_RECORD_STATE" };

/** Messages from background to side panel */
export type BackgroundMessage =
  | { type: "SAVE_CONFIG_RESULT"; result: SaveConfigResult }
  | { type: "APPROVE_AND_SCRAPE_RESULT"; result: ApproveAndScrapeResult };

/** Union of all extension messages */
export type ExtensionMessage = ContentMessage | PanelMessage | StateCheckMessage | BackgroundMessage;
