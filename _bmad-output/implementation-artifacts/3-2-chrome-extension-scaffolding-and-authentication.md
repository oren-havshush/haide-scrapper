# Story 3.2: Chrome Extension Scaffolding & Authentication

Status: done

## Story

As an admin,
I want the Chrome extension installed and authenticated to my backend,
So that I can use it to review and correct field mappings on target sites.

## Acceptance Criteria

1. **Given** the extension project is not yet created **When** the scaffolding is completed **Then** a WXT-based Chrome extension project exists at `extension/` within the scrapnew monorepo, with React, Tailwind CSS (matching dashboard dark mode config), TypeScript, and Manifest V3
   - The project structure includes entrypoints: `background.ts`, `content.ts`, `sidepanel/`, `options/`
   - Content scripts and shared `lib/` directory are set up
   - Extension builds successfully with `pnpm build` in the extension directory
   - Uses pnpm as the package manager (matching the main project)

2. **Given** the extension is installed in Chrome **When** I open the extension options page **Then** I see a token configuration input where I can paste my API Bearer token
   - The token is stored in `chrome.storage.local` (FR23)
   - The input has a "Save" button and shows a success/error message
   - Dark mode styling matches the dashboard aesthetic (dark background `#0a0a0b`, Inter font)
   - A "Test Connection" button validates the token against the backend API

3. **Given** a valid token is configured **When** the extension makes API calls to the backend **Then** all requests include the `Authorization: Bearer <token>` header
   - The API client in `src/lib/api.ts` automatically attaches the token from storage to every request
   - The backend accepts the requests (CORS must be configured for the extension origin `chrome-extension://*`)

4. **Given** no token is configured or the token is invalid **When** the extension attempts an API call **Then** the extension shows a clear error message directing the admin to configure the token in settings
   - The error message includes a link/button to open the options page
   - API calls fail gracefully with a descriptive message, not a raw network error

5. **Given** the extension is installed and a valid token is configured **When** I navigate to a site that exists in the scrapnew system with REVIEW status **Then** the extension auto-activates and shows an indicator that the site is recognized
   - The background service worker checks the current tab URL against the backend via GET /api/sites?siteUrl={url}
   - If the site exists with REVIEW status, the extension icon badge shows a colored indicator
   - The side panel can be opened and displays the site's basic info (URL, status, confidence score)

6. **Given** the extension project structure **When** I inspect the codebase **Then** the API client is in `src/lib/api.ts`, auth handling in `src/lib/auth.ts`, and shared types/constants are in `src/lib/`
   - Types and constants are copied from the main project's `src/lib/types.ts` and `src/lib/constants.ts`
   - The extension is a self-contained project within the monorepo

7. **Given** the CORS configuration is needed **When** the extension makes cross-origin requests to the Next.js API **Then** the backend responds with appropriate CORS headers allowing the extension origin
   - Next.js API routes must include CORS headers for `chrome-extension://*` origins
   - Both preflight (OPTIONS) and actual requests must be handled

## Tasks / Subtasks

- [ ] Task 1: Initialize WXT Chrome Extension project (AC: #1)
  - [ ] 1.1: Create `extension/` directory in the scrapnew project root
  - [ ] 1.2: Initialize WXT project with React + TypeScript template using `pnpm dlx wxt@latest init extension --template react`
  - [ ] 1.3: Configure `wxt.config.ts` with manifest V3, extension name "scrapnew", permissions: `["storage", "activeTab", "sidePanel"]`, host_permissions for the backend API URL
  - [ ] 1.4: Install and configure Tailwind CSS v4 matching dashboard config (dark mode, same color tokens)
  - [ ] 1.5: Add `extension/` to the pnpm workspace in `pnpm-workspace.yaml`
  - [ ] 1.6: Create `extension/.env` with `VITE_API_URL=http://localhost:3000` for local development
  - [ ] 1.7: Verify `pnpm install` and `pnpm build` work in the extension directory

- [ ] Task 2: Set up extension entrypoints structure (AC: #1, #6)
  - [ ] 2.1: Create `extension/src/entrypoints/background.ts` -- service worker with tab URL monitoring and extension icon badge management
  - [ ] 2.2: Create `extension/src/entrypoints/content.ts` -- content script placeholder (empty for now, will be used for field highlights in story 3-3)
  - [ ] 2.3: Create `extension/src/entrypoints/sidepanel/` directory with `index.html`, `main.tsx`, and `App.tsx` -- side panel React root
  - [ ] 2.4: Create `extension/src/entrypoints/options/` directory with `index.html`, `main.tsx`, and `App.tsx` -- options page React root
  - [ ] 2.5: Verify all entrypoints are registered and the extension builds

- [ ] Task 3: Create shared lib modules (AC: #6)
  - [ ] 3.1: Create `extension/src/lib/types.ts` -- copy relevant types from main project: `ApiResponse`, `ApiListResponse`, `ApiErrorResponse`, `SiteConfig`, `FieldMapping`, `FieldType`, `PageFlowStep`
  - [ ] 3.2: Create `extension/src/lib/constants.ts` -- copy relevant constants: `CONFIDENCE_THRESHOLD`, `SITE_STATUS_LABELS`, `DEFAULT_PAGE_SIZE`
  - [ ] 3.3: Create `extension/src/lib/auth.ts` -- functions to get/set/clear token from `chrome.storage.local`, check if token exists
  - [ ] 3.4: Create `extension/src/lib/api.ts` -- API client with: `apiUrl` from env, `apiFetch()` that auto-attaches Bearer token, typed GET/POST/PUT/DELETE helpers, error handling that detects missing/invalid token

- [ ] Task 4: Build Options page -- Token Configuration UI (AC: #2, #4)
  - [ ] 4.1: Build the options page layout with dark mode styling: background `#0a0a0b`, text `#fafafa`, Inter font
  - [ ] 4.2: Add token input field (password type with show/hide toggle), "Save Token" button, and "Test Connection" button
  - [ ] 4.3: On Save: store token in `chrome.storage.local` via `auth.ts`, show success message
  - [ ] 4.4: On Test Connection: call GET /api/sites (with limit=1) using the saved token -- show green "Connected" or red error message
  - [ ] 4.5: On page load: check if token exists and show current status (configured/not configured)
  - [ ] 4.6: Style with Tailwind classes matching dashboard aesthetic

- [ ] Task 5: Build Background Service Worker -- Site Recognition (AC: #5)
  - [ ] 5.1: Implement `chrome.tabs.onUpdated` listener to detect URL changes in the active tab
  - [ ] 5.2: When URL changes, check against backend via GET /api/sites?siteUrl={currentUrl} (debounced, max 1 request per 2 seconds)
  - [ ] 5.3: If site found with REVIEW status: set extension icon badge text ("R") with amber color, enable side panel for the tab
  - [ ] 5.4: If site found with other status: set badge text with appropriate indicator (e.g., "A" for active)
  - [ ] 5.5: If site not found or token not configured: clear badge, keep side panel available but show appropriate message when opened
  - [ ] 5.6: Store recognized site data in a runtime Map keyed by tab ID for quick lookup by the side panel

- [ ] Task 6: Build Side Panel -- Basic Site Info Display (AC: #5)
  - [ ] 6.1: Side panel App.tsx queries background for current tab's recognized site data via `chrome.runtime.sendMessage`
  - [ ] 6.2: If site is recognized: display site URL, status (StatusBadge), confidence score (ConfidenceBar), and mode tabs placeholder (Review/Navigate/Form Record -- disabled for now)
  - [ ] 6.3: If site is not recognized: show message "This site is not in the scrapnew system" with muted text
  - [ ] 6.4: If token not configured: show error message with "Open Settings" button that navigates to the options page
  - [ ] 6.5: Dark mode styling matching dashboard: background `#18181b`, text `#fafafa`
  - [ ] 6.6: Panel width is determined by Chrome's side panel API (user-resizable), but content designed for ~320px

- [ ] Task 7: Add CORS support to Next.js API for extension origin (AC: #3, #7)
  - [ ] 7.1: Create a CORS utility in `src/lib/cors.ts` that adds `Access-Control-Allow-Origin` header for `chrome-extension://*` origins
  - [ ] 7.2: Add CORS headers to API responses: `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type`
  - [ ] 7.3: Add OPTIONS handler to API routes that need extension access (sites, sites/[id]/config) -- or create a global CORS middleware approach
  - [ ] 7.4: The CORS utility should check the `Origin` header and only allow `chrome-extension://` prefixed origins (not wildcard for all origins)
  - [ ] 7.5: Test that extension can successfully call GET /api/sites and GET /api/sites/[id]/config with CORS

- [ ] Task 8: Add site URL lookup support to Sites API (AC: #5)
  - [ ] 8.1: Extend GET /api/sites to accept a `siteUrl` query parameter for exact URL matching
  - [ ] 8.2: Update `listSites()` in `siteService.ts` to support `siteUrl` filter (exact match on `site.siteUrl`)
  - [ ] 8.3: Update the Zod validation schema in the sites route to accept `siteUrl` as an optional string parameter
  - [ ] 8.4: When `siteUrl` is provided, return matching site(s) in the standard `{ data, meta }` format

- [ ] Task 9: Verify extension build and integration (AC: all)
  - [ ] 9.1: Run `pnpm build` in the extension directory -- must produce a valid Chrome extension in `.output/chrome-mv3/`
  - [ ] 9.2: Run `pnpm build` in the main project root -- must still pass without errors
  - [ ] 9.3: Manual verification checklist (requires running server + loading extension):
    - Load extension as unpacked from `.output/chrome-mv3/`
    - Open options page -- token input visible, dark mode styled
    - Enter a valid API token, click Save -- success message appears
    - Click "Test Connection" -- "Connected" confirmation shown
    - Navigate to a URL of a site in the system with REVIEW status -- badge appears on extension icon
    - Open side panel -- site info displayed (URL, status, confidence)
    - Navigate to a URL NOT in the system -- badge clears, side panel shows "not recognized" message
    - Remove/clear token -- API calls show "configure token" error

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This is a SEPARATE Chrome extension project** inside `extension/` -- NOT part of the Next.js app build
- **Framework:** WXT (Vite-based, TypeScript-first, Manifest V3) -- per architecture doc
- **UI framework:** React + Tailwind CSS (same as dashboard for visual consistency)
- **Package manager:** pnpm (matching the main project)
- **Auth:** Token stored in `chrome.storage.local`, attached as `Authorization: Bearer <token>` to all API requests
- **API communication:** Direct REST API calls to the same Next.js backend endpoints the dashboard uses
- **No shared package imports:** Types/constants are COPIED from the main project, not imported (separate build)
- **Manifest V3:** Service worker (not background page), content scripts, side panel API

### WXT Framework Notes

WXT is the selected Chrome extension framework per the architecture doc. Key WXT conventions:
- Entrypoints go in `src/entrypoints/` -- WXT auto-detects them by name/directory
- `background.ts` becomes the service worker
- `content.ts` or `content/index.ts` becomes the content script
- Directories like `sidepanel/` and `options/` with `index.html` become extension pages
- WXT handles manifest generation from `wxt.config.ts` + entrypoint metadata
- Dev mode: `pnpm dev` starts WXT dev server with hot reload + auto-reload extension in Chrome

### Extension Project Structure

```
extension/
├── package.json
├── wxt.config.ts                  # WXT framework config
├── tailwind.config.ts             # Tailwind config (dark mode)
├── tsconfig.json
├── .env                           # VITE_API_URL
├── src/
│   ├── entrypoints/
│   │   ├── background.ts          # Service worker (MV3)
│   │   ├── content.ts             # Content script placeholder
│   │   ├── sidepanel/
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   └── App.tsx
│   │   └── options/
│   │       ├── index.html
│   │       ├── main.tsx
│   │       └── App.tsx
│   ├── lib/
│   │   ├── api.ts                 # REST API client
│   │   ├── auth.ts                # Token management (chrome.storage.local)
│   │   ├── types.ts               # Shared types (copied from main project)
│   │   └── constants.ts           # Shared constants (copied from main project)
│   └── assets/
│       └── icon/                  # Extension icons (16, 32, 48, 128px)
└── .output/                       # Build output (gitignored)
    └── chrome-mv3/                # Loadable Chrome extension
```

### CORS Configuration Notes

The Chrome extension runs at `chrome-extension://<extension-id>` origin. The Next.js API must:
- Accept the `Origin: chrome-extension://...` header
- Return `Access-Control-Allow-Origin` matching the request origin
- Handle OPTIONS preflight requests for non-simple requests (those with `Authorization` header)
- This affects ALL API routes the extension calls: `/api/sites`, `/api/sites/[id]`, `/api/sites/[id]/config`

**Implementation approach:** Create a `corsHeaders()` utility function in `src/lib/cors.ts` that checks the incoming `Origin` header. If it starts with `chrome-extension://`, include CORS headers in the response. Apply this to the `proxy.ts` middleware so all `/api/*` routes get CORS headers automatically.

Alternative: Use `next.config.ts` headers configuration for CORS (simpler but less flexible). The proxy.ts approach is preferred because it can validate the origin format.

### Backend API Endpoints Used by Extension

| Endpoint | Method | Usage in Extension |
|----------|--------|-------------------|
| `/api/sites` | GET | Site URL lookup (`?siteUrl=...`), list sites |
| `/api/sites/[id]` | GET | Get site details |
| `/api/sites/[id]/config` | GET | Load field mappings for review mode |
| `/api/sites/[id]/config` | PUT | Save corrected config (story 3-5) |
| `/api/sites/[id]/scrape` | POST | Trigger test scrape after config save (story 3-5) |

Only the first three are needed for this story. PUT config and POST scrape are for story 3-5.

### Side Panel vs Popup

The architecture doc specifies a **side panel** (320px, right-docked), not a popup. WXT supports the Chrome Side Panel API via the `sidepanel/` entrypoint directory. The side panel:
- Persists while the user navigates the target site (unlike popups which close on click-away)
- Can be opened programmatically or by the user
- Is essential for the review-and-correct workflow in stories 3-3 through 3-5

### Existing Code in Main Project to Be Aware Of

| What | Location | Relevance |
|------|----------|-----------|
| Auth middleware | `src/proxy.ts` | Validates Bearer token -- extension must send same format |
| API response format | `src/lib/api-utils.ts` | `{ data }` / `{ data, meta }` / `{ error }` -- extension must parse these |
| Site config endpoint | `src/app/api/sites/[id]/config/route.ts` | Already exists (story 3-1) -- extension will consume this |
| Sites list endpoint | `src/app/api/sites/route.ts` | Already supports status filter -- needs `siteUrl` filter addition |
| Site types | `src/lib/types.ts` | Copy `ApiResponse`, `SiteConfig`, `FieldMapping`, etc. to extension |
| Constants | `src/lib/constants.ts` | Copy `CONFIDENCE_THRESHOLD`, `SITE_STATUS_LABELS` to extension |

### Previous Story Learnings (from Stories 1-1 through 3-1)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **Prisma 7.4 requires driver adapter** -- PrismaClient instantiated with `{ adapter }` in `src/lib/prisma.ts`.
4. **shadcn/ui v4 uses Base UI** -- not Radix. Component props may differ from older docs.
5. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
6. **Always run `pnpm build`** before marking story as done.
7. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
8. **Zod 4.x uses `z.url()`** not `z.string().url()`. `z.enum([...])` works directly.
9. **API route params** -- Next.js 16 uses `{ params }: { params: Promise<{ id: string }> }` -- must `await params`.
10. **`apiFetch` helper** in `src/hooks/useSites.ts` handles auth token + error formatting.
11. **Sort with nulls** -- Prisma `{ sort: sortOrder, nulls: "last" }` pattern works for nullable fields.

### Implementation Patterns (Code Samples)

#### Extension auth.ts

```typescript
const TOKEN_KEY = "scrapnew_api_token";

export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function hasToken(): Promise<boolean> {
  const token = await getToken();
  return token !== null && token.length > 0;
}
```

#### Extension api.ts

```typescript
import { getToken } from "./auth";
import type { ApiResponse, ApiListResponse, ApiErrorResponse } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export class AuthError extends Error {
  constructor(message: string = "Not authenticated. Configure your API token in extension settings.") {
    super(message);
    this.name = "AuthError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new AuthError();
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthError("Invalid API token. Check your token in extension settings.");
    }
    const errorData = await response.json() as ApiErrorResponse;
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

#### Background service worker -- site recognition

```typescript
import { apiFetch } from "../lib/api";
import { hasToken } from "../lib/auth";
import type { ApiListResponse } from "../lib/types";

interface SiteInfo {
  id: string;
  siteUrl: string;
  status: string;
  confidenceScore: number | null;
}

// Runtime cache of recognized sites per tab
const tabSites = new Map<number, SiteInfo>();

// Debounce URL checks
let checkTimeout: ReturnType<typeof setTimeout> | null = null;

async function checkSiteUrl(tabId: number, url: string) {
  if (!await hasToken()) {
    chrome.action.setBadgeText({ text: "", tabId });
    return;
  }

  try {
    const encoded = encodeURIComponent(url);
    const result = await apiFetch<ApiListResponse<SiteInfo>>(
      `/api/sites?siteUrl=${encoded}`
    );

    if (result.data.length > 0) {
      const site = result.data[0];
      tabSites.set(tabId, site);

      // Set badge based on status
      const badgeText = site.status === "REVIEW" ? "R" : site.status === "ACTIVE" ? "A" : "";
      const badgeColor = site.status === "REVIEW" ? "#f59e0b" : "#22c55e";
      chrome.action.setBadgeText({ text: badgeText, tabId });
      chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
    } else {
      tabSites.delete(tabId);
      chrome.action.setBadgeText({ text: "", tabId });
    }
  } catch {
    tabSites.delete(tabId);
    chrome.action.setBadgeText({ text: "", tabId });
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
});

// Handle messages from side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_SITE_INFO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId && tabSites.has(tabId)) {
        sendResponse({ site: tabSites.get(tabId) });
      } else {
        sendResponse({ site: null });
      }
    });
    return true; // async response
  }
});
```

#### CORS utility for Next.js

```typescript
// src/lib/cors.ts

export function getCorsHeaders(origin: string | null): Record<string, string> {
  // Allow Chrome extension origins
  if (origin && origin.startsWith("chrome-extension://")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {};
}

export function isExtensionOrigin(origin: string | null): boolean {
  return origin !== null && origin.startsWith("chrome-extension://");
}
```

### Project Structure (Files to Create/Modify)

```
# NEW -- Extension project
extension/
  package.json
  wxt.config.ts
  tailwind.config.ts (or CSS-based Tailwind v4 config)
  tsconfig.json
  .env
  src/
    entrypoints/
      background.ts
      content.ts
      sidepanel/
        index.html
        main.tsx
        App.tsx
      options/
        index.html
        main.tsx
        App.tsx
    lib/
      api.ts
      auth.ts
      types.ts
      constants.ts

# MODIFIED -- Main project
pnpm-workspace.yaml             # Add extension/ to workspace
src/lib/cors.ts                  # NEW -- CORS utility for extension origin
src/proxy.ts                     # MODIFY -- Add CORS headers for extension
src/app/api/sites/route.ts       # MODIFY -- Add siteUrl query param support
src/services/siteService.ts      # MODIFY -- Add siteUrl filter to listSites
src/lib/validators.ts            # MODIFY -- Add siteUrl to sites query schema
next.config.ts                   # POSSIBLY MODIFY -- CORS headers config
```

### HTTP Status Codes for This Story

| Scenario | Code |
|----------|------|
| Sites list with siteUrl filter | 200 |
| OPTIONS preflight request | 200 (with CORS headers) |
| Unauthorized (no/bad token) | 401 |
| Site not found | 200 (empty data array) |
| Server error | 500 |

### Anti-Patterns to AVOID

- Do NOT build the extension inside the Next.js project -- it is a SEPARATE build with its own package.json
- Do NOT use `@prisma/client` or any server-side imports in the extension -- it is a browser-only project
- Do NOT hardcode the extension ID in CORS -- use origin-prefix matching (`chrome-extension://`)
- Do NOT use popup instead of side panel -- the architecture specifies side panel for persistent panel during page interaction
- Do NOT create a login page -- token is configured once in extension options, not via a login flow
- Do NOT use `manifest.json` directly -- WXT generates the manifest from `wxt.config.ts`
- Do NOT import from the main project's `src/lib/` -- COPY the types/constants to the extension's `src/lib/`
- Do NOT use npm or yarn -- this project uses pnpm exclusively
- Do NOT add React Query to the extension yet -- simple fetch with the API client is sufficient for this story; React Query can be added later if needed
- Do NOT implement field highlights, element picker, or mode functionality -- those belong to stories 3-3, 3-4, 3-5
- Do NOT build the full FieldMappingPanel -- only basic site info display in the side panel for this story

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: Chrome Extension Scaffolding & Authentication]
- [Source: _bmad-output/planning-artifacts/architecture.md#Chrome Extension Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries -- Project 2: Chrome Extension]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Design System Foundation -- Color System]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Defining Core Experience -- Experience Mechanics]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- FieldMappingPanel]
- [Source: _bmad-output/planning-artifacts/prd.md#FR17, FR23]
- [Source: _bmad-output/planning-artifacts/prd.md#Chrome Extension Requirements]
- [Source: _bmad-output/implementation-artifacts/3-1-review-queue-dashboard-view.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
