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

export interface PaginationParams {
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export type SSEEventType =
  | "site:status-changed"
  | "analysis:completed"
  | "scrape:completed"
  | "scrape:failed";

export interface SSEEventMap {
  "site:status-changed": { siteId: string; status: string };
  "analysis:completed": { siteId: string; confidence: number };
  "scrape:completed": { siteId: string; jobCount: number };
  "scrape:failed": { siteId: string; error: string; category: string | null };
}

export type SSEEvent = {
  [K in SSEEventType]: { type: K; payload: SSEEventMap[K] };
}[SSEEventType];
