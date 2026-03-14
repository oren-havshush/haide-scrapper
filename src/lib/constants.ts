export const CONFIDENCE_THRESHOLD = 70;

export const SITE_STATUS_LABELS: Record<string, string> = {
  ANALYZING: "Analyzing",
  REVIEW: "Review",
  ACTIVE: "Active",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export const SCRAPE_RUN_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export const ANALYSIS_METHOD_LABELS: Record<string, string> = {
  PATTERN_MATCH: "Pattern Match",
  CRAWL_CLASSIFY: "Crawl & Classify",
  NETWORK_INTERCEPT: "Network Intercept",
};

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
