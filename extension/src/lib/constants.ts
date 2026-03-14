export const CONFIDENCE_THRESHOLD = 70;

export const SITE_STATUS_LABELS: Record<string, string> = {
  ANALYZING: "Analyzing",
  REVIEW: "Review",
  ACTIVE: "Active",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export const DEFAULT_PAGE_SIZE = 50;

// --- Review Mode Constants (Story 3-3) ---

/** Standard field types available for mapping */
export const FIELD_TYPES = [
  "title",
  "description",
  "requirements",
  "location",
  "department",
  "externalJobId",
  "publishDate",
  "applicationInfo",
  "custom",
] as const;

export type StandardFieldType = (typeof FIELD_TYPES)[number];

/** Confidence threshold for high vs low */
export const CONFIDENCE_HIGH_THRESHOLD = 70;

// --- Form Record Mode Constants (Story 3-5) ---

/** Form field types for captured form interactions */
export const FORM_FIELD_TYPES = [
  "text",
  "select",
  "checkbox",
  "radio",
  "textarea",
  "submit",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Icons/labels for form field types */
export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Text Input",
  select: "Dropdown",
  checkbox: "Checkbox",
  radio: "Radio",
  textarea: "Text Area",
  submit: "Submit Button",
};

/** Highlight overlay colors */
export const HIGHLIGHT_COLORS = {
  confirmed: {
    border: "#22c55e",
    background: "rgba(34, 197, 94, 0.1)",
    borderStyle: "solid" as const,
  },
  high: {
    border: "#22c55e",
    background: "rgba(34, 197, 94, 0.1)",
    borderStyle: "solid" as const,
  },
  low: {
    border: "#f59e0b",
    background: "rgba(245, 158, 11, 0.1)",
    borderStyle: "dashed" as const,
  },
  editing: {
    border: "#3b82f6",
    background: "rgba(59, 130, 246, 0.15)",
    borderStyle: "solid" as const,
  },
} as const;
