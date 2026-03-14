# Story 3.3: Review Mode — Field Mapping Overlay & Correction

Status: done

## Story

As an admin,
I want to see AI-detected field mappings overlaid on the live target site and correct any errors,
So that I can quickly verify and fix the AI's analysis in under 3 minutes per site.

## Acceptance Criteria

1. **Given** I open a target site that has REVIEW status and the extension is active **When** the extension loads in Review Mode **Then** the side panel (320px) displays the FieldMappingPanel with: site URL, overall confidence score, mode tabs (Review active / Navigate disabled / Form Record disabled), a list of detected fields with per-field confidence, and action buttons
   - The side panel loads the site's field mappings and page flow from GET /api/sites/[id]/config
   - The Review tab is active and enabled; Navigate and Form Record tabs are visible but disabled (stories 3-4, 3-5)
   - A progress indicator shows "X/Y fields verified"

2. **Given** the extension is in Review Mode **When** field mappings are loaded from the API **Then** colored overlay highlights (FieldHighlight) appear on the detected page elements via the content script
   - High confidence fields (>= 70%): green solid border (`#22c55e` at 30% opacity background, solid border)
   - Low confidence fields (< 70%): amber dashed border (`#f59e0b` at 30% opacity background, dashed border)
   - Each highlight has a label tag (top-right) showing the field name and confidence percentage
   - Highlights are injected into the target page DOM by the content script

3. **Given** field highlights are visible on the page **When** I hover over a highlighted element **Then** the border thickens and the label becomes more prominent with the field name and confidence percentage clearly visible

4. **Given** a field mapping is correct **When** I click the checkmark/confirm action for that field in the side panel **Then** the highlight turns solid green with a checkmark label and the field is marked as confirmed
   - The progress indicator updates (e.g., "3/7 fields verified")
   - Confirmed fields show a green status dot in the side panel FieldRow

5. **Given** a field mapping is incorrect **When** I click the field in the side panel or click the highlight on the page **Then** the highlight enters edit mode (blue thick border, `#3b82f6` at 40% opacity) and the cursor changes to a crosshair/picker on the page (FR18)
   - The FieldRow in the side panel shows the field is in edit/picker mode
   - Only one field can be in edit mode at a time

6. **Given** I click a new element during edit/picker mode **When** the element is selected **Then** the field mapping updates to point to the newly selected element with its CSS selector
   - The highlight moves to the correct element
   - The side panel FieldRow updates with the new selector
   - The field is automatically marked as confirmed after remapping
   - Picker mode exits and the cursor returns to normal

7. **Given** the AI missed a field that exists on the page **When** I click "Add Field" in the side panel **Then** the extension enters picker mode — I click an element on the page and then select the field type from a dropdown (title, company, location, salary, description, etc.) (FR19)
   - A dropdown of standard field types appears after element selection
   - The new field appears in the side panel list with a new highlight on the page
   - The new field is automatically marked as confirmed

8. **Given** a field mapping exists but is a false positive **When** I click "Remove" on that field in the side panel **Then** the field is removed from the mapping list and the highlight is removed from the page

9. **Given** I am reviewing fields **When** I look at the side panel **Then** each FieldRow shows: a status dot (green = confirmed, amber = unconfirmed low confidence, grey = unconfirmed high confidence), field name, confidence percentage, and action icons (confirm checkmark, edit pencil, remove X) on hover

10. **Given** the content script needs to communicate with the side panel **When** the extension is active **Then** the content script and side panel communicate via chrome.runtime messaging through the background service worker
    - Content script sends: element clicked, hover events, picker mode state
    - Side panel sends: highlight commands, picker mode activation, field updates
    - Background service worker routes messages between content script and side panel

## Tasks / Subtasks

- [x] Task 1: Extend extension types and constants for Review Mode (AC: #1, #2, #9)
  - [x] 1.1: Add types to `extension/src/lib/types.ts`: `FieldMappingEntry` (fieldName, selector, confidence, status: 'confirmed' | 'unconfirmed' | 'editing'), `ReviewModeState`, `HighlightConfig`, `ContentMessage` (message types for content script communication), `PanelMessage` (message types for side panel communication)
  - [x] 1.2: Add field type constants to `extension/src/lib/constants.ts`: `FIELD_TYPES` array (title, company, location, salary, description, url, date, custom), `HIGHLIGHT_COLORS` (green, amber, blue for confirmed/unconfirmed/editing), `CONFIDENCE_HIGH_THRESHOLD = 70`

- [x] Task 2: Build FieldHighlight content script module (AC: #2, #3, #5, #6)
  - [x] 2.1: Create `extension/src/content/FieldHighlight.ts` -- module that injects overlay highlights onto target page elements
  - [x] 2.2: Implement `createHighlight(element, config)` -- creates a positioned overlay div around the target element with colored border + background + label tag (field name + confidence %)
  - [x] 2.3: Implement `updateHighlight(fieldName, config)` -- updates an existing highlight's color, border style, and label
  - [x] 2.4: Implement `removeHighlight(fieldName)` -- removes a specific highlight overlay from the page
  - [x] 2.5: Implement `clearAllHighlights()` -- removes all highlight overlays
  - [x] 2.6: Add hover interaction: border thickens and label becomes more prominent on mouseenter, reverts on mouseleave
  - [x] 2.7: Handle scroll/resize -- highlights reposition correctly when the page scrolls or resizes (use ResizeObserver and scroll listeners)
  - [x] 2.8: Use Shadow DOM or unique CSS class prefix (`scrapnew-`) to avoid style conflicts with the target site

- [x] Task 3: Build ElementPicker content script module (AC: #5, #6, #7)
  - [x] 3.1: Create `extension/src/content/ElementPicker.ts` -- module that activates a click-to-select element picker on the target page
  - [x] 3.2: Implement `startPicker(callback)` -- activates picker mode: changes cursor to crosshair, highlights hovered elements with a blue outline, captures click on an element
  - [x] 3.3: On element click during picker mode: prevent default click behavior, compute a CSS selector for the clicked element (using tag + class + nth-child strategy or unique ID), invoke the callback with the selector and element reference
  - [x] 3.4: Implement `stopPicker()` -- deactivates picker mode, restores normal cursor, removes hover highlighting
  - [x] 3.5: Implement `generateSelector(element)` -- produces a unique, stable CSS selector for the target element (prefer ID > unique class > nth-child path). Selector must be reproducible for the scraping engine.

- [x] Task 4: Wire content script with messaging (AC: #2, #5, #6, #7, #10)
  - [x] 4.1: Update `extension/src/entrypoints/content.ts` to import FieldHighlight and ElementPicker modules
  - [x] 4.2: Listen for messages from the background/side panel: `SHOW_HIGHLIGHTS` (render all field highlights), `START_PICKER` (activate element picker for a field), `STOP_PICKER` (deactivate picker), `UPDATE_HIGHLIGHT` (update single highlight), `REMOVE_HIGHLIGHT` (remove single highlight), `CLEAR_HIGHLIGHTS` (remove all)
  - [x] 4.3: Send messages to background when: element clicked in picker mode (`ELEMENT_PICKED` with selector), highlight clicked on page (`HIGHLIGHT_CLICKED` with field name), highlight hovered (`HIGHLIGHT_HOVERED` with field name)
  - [x] 4.4: On initial message `SHOW_HIGHLIGHTS`, iterate over field mappings and call `createHighlight()` for each, resolving selectors to page elements via `document.querySelector()`

- [x] Task 5: Update background service worker for message routing (AC: #10)
  - [x] 5.1: Update `extension/src/entrypoints/background.ts` to handle new message types for routing between content script and side panel
  - [x] 5.2: Add message forwarding: when side panel sends `SHOW_HIGHLIGHTS`, `START_PICKER`, `STOP_PICKER`, `UPDATE_HIGHLIGHT`, `REMOVE_HIGHLIGHT`, `CLEAR_HIGHLIGHTS` -- forward to content script of the active tab via `chrome.tabs.sendMessage()`
  - [x] 5.3: When content script sends `ELEMENT_PICKED`, `HIGHLIGHT_CLICKED`, `HIGHLIGHT_HOVERED` -- forward to side panel via `chrome.runtime.sendMessage()` (side panel listens as extension page)
  - [x] 5.4: Add `GET_SITE_CONFIG` message handler: fetch site config from GET /api/sites/[id]/config via `apiFetch` and return to the side panel

- [x] Task 6: Build FieldMappingPanel side panel component (AC: #1, #4, #7, #8, #9)
  - [x] 6.1: Create `extension/src/entrypoints/sidepanel/FieldMappingPanel.tsx` -- main panel component for Review Mode
  - [x] 6.2: Panel header: site URL (truncated, monospace), overall confidence (ConfidenceBar), mode tabs (Review active, Navigate/Form Record disabled)
  - [x] 6.3: Field list section: render a FieldRow for each field mapping entry
  - [x] 6.4: FieldRow sub-component: status dot (green/amber/grey), field name, confidence percentage, action icons on hover (confirm checkmark, edit pencil, remove X)
  - [x] 6.5: Progress indicator: "X/Y fields verified" below the field list
  - [x] 6.6: "Add Field" button at the bottom that activates picker mode (sends `START_PICKER` to content script) and then shows a field type dropdown after element is picked
  - [x] 6.7: Field type dropdown (for Add Field): select from FIELD_TYPES constant, styled as a simple select/dropdown
  - [x] 6.8: Confirm action: mark field as confirmed, update highlight to green solid, increment verified count
  - [x] 6.9: Edit action: send `START_PICKER` for this field to content script, mark field as 'editing', update highlight to blue
  - [x] 6.10: Remove action: remove field from list, send `REMOVE_HIGHLIGHT` to content script

- [x] Task 7: Rewrite side panel App.tsx to integrate Review Mode (AC: #1, #4, #5, #6, #7, #8, #9, #10)
  - [x] 7.1: Rewrite `extension/src/entrypoints/sidepanel/App.tsx` to manage Review Mode state: field mappings list, picker mode state, verified count
  - [x] 7.2: On load: get site info from background (existing `GET_SITE_INFO`), then fetch site config via `GET_SITE_CONFIG` message to background
  - [x] 7.3: Parse field mappings from API response into `FieldMappingEntry[]` with field name, selector, confidence, and status ('unconfirmed')
  - [x] 7.4: On config loaded: send `SHOW_HIGHLIGHTS` message to content script with all field mapping entries
  - [x] 7.5: Listen for messages from content script (via background): `ELEMENT_PICKED` updates the current editing field's selector, `HIGHLIGHT_CLICKED` triggers edit mode for that field
  - [x] 7.6: Maintain state: current picker target field (if in picker mode), field mappings array, verified count
  - [x] 7.7: Render: if no site recognized, show existing "not in system" message; if site recognized, show FieldMappingPanel
  - [x] 7.8: Keep existing token-not-configured and loading states from story 3-2

- [x] Task 8: Verify extension build and integration (AC: all)
  - [x] 8.1: Run `pnpm build` in the extension directory -- must produce a valid Chrome extension
  - [x] 8.2: Run `pnpm check` in the extension directory -- TypeScript check passes
  - [x] 8.3: Run `pnpm build` in the main project root -- must still pass
  - [x] 8.4: Manual verification checklist (requires running server + loading extension):
    - Navigate to a site with REVIEW status and field mappings -- highlights appear on page elements
    - High confidence fields show green solid borders with labels
    - Low confidence fields show amber dashed borders with labels
    - Hover over a highlight -- border thickens, label becomes prominent
    - Side panel shows FieldMappingPanel with field list and progress indicator
    - Click confirm on a field -- highlight turns solid green, progress updates
    - Click edit on a field -- picker mode activates, click new element -- field remaps
    - Click "Add Field" -- picker mode activates, select element, choose field type -- new field appears
    - Click remove on a field -- field and highlight removed
    - Messages route correctly between content script and side panel

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This is a CHROME EXTENSION story** -- all changes are in the `extension/` directory except if backend API changes are needed
- **Content script = DOM manipulation on target site** -- field highlights are injected into the target page's DOM by the content script
- **Side panel = React UI for field management** -- the FieldMappingPanel lives in the side panel, communicating with the content script via chrome.runtime messaging
- **Background service worker = message router** -- routes messages between content script and side panel since they can't communicate directly
- **No React Query in extension** -- use simple state management with useState/useEffect and direct API calls via the existing `apiFetch` helper
- **Package manager:** pnpm (matching the main project)
- **Style isolation:** Content script overlays MUST NOT interfere with the target site's styles. Use Shadow DOM or unique CSS class prefixes (`scrapnew-highlight-*`)
- **WXT entrypoint conventions:** Content scripts use `defineContentScript()`, background uses `defineBackground()`. WXT auto-detects entrypoints from the `src/entrypoints/` directory.

### Extension Communication Architecture

```
┌──────────────────┐     chrome.runtime      ┌────────────────────┐
│   Side Panel     │ ◄──── messages ─────►    │   Background       │
│   (React UI)     │                          │   Service Worker    │
│                  │                          │   (message router)  │
└──────────────────┘                          └─────────┬──────────┘
                                                        │
                                              chrome.tabs.sendMessage
                                                        │
                                              ┌─────────▼──────────┐
                                              │   Content Script    │
                                              │   (DOM overlays)    │
                                              │   - FieldHighlight  │
                                              │   - ElementPicker   │
                                              └────────────────────┘
```

**Message Types (Content Script --> Background --> Side Panel):**
- `ELEMENT_PICKED` -- user clicked an element in picker mode: `{ selector: string, tagName: string, textContent: string }`
- `HIGHLIGHT_CLICKED` -- user clicked a field highlight: `{ fieldName: string }`
- `HIGHLIGHT_HOVERED` -- user hovered a field highlight: `{ fieldName: string }`

**Message Types (Side Panel --> Background --> Content Script):**
- `SHOW_HIGHLIGHTS` -- render all field highlights: `{ fields: FieldMappingEntry[] }`
- `START_PICKER` -- activate picker mode: `{ fieldName?: string }` (fieldName = null for "Add Field")
- `STOP_PICKER` -- deactivate picker mode
- `UPDATE_HIGHLIGHT` -- update a single highlight: `{ fieldName: string, config: HighlightConfig }`
- `REMOVE_HIGHLIGHT` -- remove a single highlight: `{ fieldName: string }`
- `CLEAR_HIGHLIGHTS` -- remove all highlights

**Message Types (Side Panel --> Background, no forwarding):**
- `GET_SITE_INFO` -- already exists from story 3-2
- `GET_SITE_CONFIG` -- new: fetch site config from API, background calls GET /api/sites/[id]/config

### Field Mapping Data Flow

1. Side panel opens, gets site info from background (`GET_SITE_INFO`)
2. Side panel requests config from background (`GET_SITE_CONFIG` with siteId)
3. Background fetches GET /api/sites/[id]/config, returns `{ fieldMappings, pageFlow }`
4. Side panel parses `fieldMappings` JSON into `FieldMappingEntry[]`
5. Side panel sends `SHOW_HIGHLIGHTS` to content script with all entries
6. Content script iterates entries, resolves selectors via `document.querySelector()`, creates overlay highlights
7. Admin interacts (confirm/edit/add/remove) via side panel or by clicking highlights
8. Side panel maintains the updated field mappings state locally (saved to backend in story 3-5)

### fieldMappings JSON Structure (from AI Analysis)

The `fieldMappings` field on the Site model is a JSON object. The analysis pipeline (stories 2-1 through 2-5) stores it in this shape:

```typescript
// Site.fieldMappings as stored by the AI analysis pipeline
interface AIFieldMappings {
  [fieldName: string]: {
    selector: string;
    confidence: number; // 0-100
    source: string;     // "PATTERN_MATCH" | "CRAWL_CLASSIFY" | "NETWORK_INTERCEPT"
  };
}

// Example:
{
  "title": { "selector": "h2.job-title", "confidence": 92, "source": "PATTERN_MATCH" },
  "company": { "selector": ".company-name", "confidence": 85, "source": "CRAWL_CLASSIFY" },
  "location": { "selector": "span.location", "confidence": 45, "source": "PATTERN_MATCH" },
  "salary": { "selector": ".salary-range", "confidence": 30, "source": "NETWORK_INTERCEPT" }
}
```

The side panel parses this into the internal `FieldMappingEntry[]` format for the UI.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Side panel App.tsx | `extension/src/entrypoints/sidepanel/App.tsx` | Existing site info display, token check, loading state -- EXTEND, not replace entirely |
| Background service worker | `extension/src/entrypoints/background.ts` | Has `GET_SITE_INFO` handler and tab URL monitoring -- ADD new message handlers |
| Content script | `extension/src/entrypoints/content.ts` | Empty placeholder -- REPLACE with full implementation |
| API client | `extension/src/lib/api.ts` | `apiFetch()` with auth -- reuse for `GET_SITE_CONFIG` in background |
| Auth module | `extension/src/lib/auth.ts` | Token management -- reuse as-is |
| Types | `extension/src/lib/types.ts` | Existing types -- EXTEND with new Review Mode types |
| Constants | `extension/src/lib/constants.ts` | Existing constants -- EXTEND with highlight colors, field types |
| Tailwind config | `extension/src/styles.css` | Already has dark mode theme tokens for the side panel |
| Config API endpoint | `src/app/api/sites/[id]/config/route.ts` (main project) | GET returns `{ data: { fieldMappings, pageFlow } }` -- already exists from story 3-1 |

### CSS for Content Script Overlays

Content script styles must be injected into the target page and isolated from the site's CSS. Approach:

```typescript
// FieldHighlight overlay styles (injected as <style> in page head)
const HIGHLIGHT_STYLES = `
  .scrapnew-highlight {
    position: absolute;
    pointer-events: none;
    z-index: 999999;
    transition: all 0.15s ease;
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
  }
  .scrapnew-picker-hover {
    outline: 2px dashed #3b82f6 !important;
    outline-offset: 2px;
    cursor: crosshair !important;
  }
`;
```

### Selector Generation Strategy

The `generateSelector()` function must produce CSS selectors that are:
1. **Unique** -- selects exactly one element on the page
2. **Stable** -- doesn't change between page loads (avoid nth-child when possible)
3. **Readable** -- human-understandable in the side panel
4. **Usable by Playwright** -- the scraping engine uses these selectors

Priority order:
1. Element with unique `id` -- `#job-title`
2. Unique class combination -- `.job-card .title`
3. Data attributes -- `[data-field="title"]`
4. Tag + class + parent context -- `div.listing > h2.title`
5. Full path with nth-child as last resort -- `div.results > div:nth-child(1) > h2`

### UX Requirements (from UX Spec)

**FieldHighlight (Extension -- Page Overlay):**
- Semi-transparent background overlay on the element
- Border: solid for high confidence, dashed for low confidence
- Label tag (top-right): field name + confidence %
- States: `detected-high`, `detected-low`, `editing`, `confirmed`, `hover`
- Click highlight --> enters editing/picker mode
- Hover --> border thickens, label more prominent

**FieldMappingPanel (Extension -- Side Panel):**
- Panel header: site URL + overall confidence + mode tabs
- Detected fields section: list of FieldRow items
- Action bar: "Add Field" button
- Progress indicator: "X/Y fields verified"
- FieldRow: status dot (green/amber/grey), field name, confidence %, action icons on hover

**Panel width:** Content designed for ~320px (Chrome side panel is user-resizable)

**Button hierarchy in panel:**
- "Add Field" -- secondary style (outlined)
- Confirm/Edit/Remove icons -- ghost style, appear on FieldRow hover

### Project Structure (Files to Create/Modify)

```
extension/
  src/
    content/                           # NEW directory
      FieldHighlight.ts                # NEW -- DOM overlay management
      ElementPicker.ts                 # NEW -- click-to-select element picker
    entrypoints/
      content.ts                       # MODIFY -- wire FieldHighlight + ElementPicker + messaging
      background.ts                    # MODIFY -- add message routing for content <-> side panel
      sidepanel/
        App.tsx                        # MODIFY -- integrate Review Mode state management
        FieldMappingPanel.tsx          # NEW -- main field mapping panel component
    lib/
      types.ts                         # MODIFY -- add Review Mode types
      constants.ts                     # MODIFY -- add field types, highlight colors
```

No changes needed to the main Next.js project -- the GET /api/sites/[id]/config endpoint already exists from story 3-1.

### Previous Story Learnings (from Stories 1-1 through 3-2)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **shadcn/ui v4 uses Base UI** -- not Radix.
4. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout.
5. **Always run `pnpm build`** in both extension and main project before marking story as done.
6. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
7. **WXT entrypoints** -- `defineContentScript()`, `defineBackground()` are WXT globals. Do not import them.
8. **Extension build** -- `pnpm build` in extension dir produces `.output/chrome-mv3/`.
9. **Content script matches** -- current content script uses `matches: ["<all_urls>"]` which is correct for overlaying on any target site.
10. **Side panel communication** -- uses `chrome.runtime.sendMessage` from side panel to background, `chrome.tabs.sendMessage` from background to content script.
11. **API response format** -- GET /api/sites/[id]/config returns `{ data: { fieldMappings, pageFlow } }`.
12. **Extension has NO React Query** -- uses simple useState/useEffect with direct `apiFetch` calls.
13. **Tailwind v4 in extension** -- uses `@theme` directive in `styles.css` for dark mode tokens.

### Anti-Patterns to AVOID

- Do NOT use `document.querySelector` in the side panel -- the side panel has its own DOM, separate from the target page. All target page DOM manipulation goes through the content script.
- Do NOT import content script modules directly in the side panel -- use messaging via the background service worker.
- Do NOT use `any` type -- all message types, field entries, and highlight configs must be properly typed.
- Do NOT install new heavy libraries (no React DnD, no complex state management) -- useState/useEffect is sufficient.
- Do NOT use inline styles for content script overlays where CSS classes with a unique prefix work -- prevents style conflicts.
- Do NOT implement Save Config / Navigate Mode / Form Record Mode -- those are stories 3-4 and 3-5.
- Do NOT modify the main Next.js project unless absolutely necessary -- this story is extension-only.
- Do NOT use `window.postMessage` for extension communication -- use `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.
- Do NOT add React Query or TanStack Query to the extension -- keep it simple with direct fetch calls.
- Do NOT create a separate API endpoint -- the GET /api/sites/[id]/config endpoint already exists.
- Do NOT put complex business logic in the content script -- content script should only handle DOM manipulation and event forwarding. Logic lives in the side panel.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes in the extension directory
2. `pnpm check` passes in the extension directory (TypeScript)
3. `pnpm build` passes in the main project root
4. Load extension in Chrome from `.output/chrome-mv3/`
5. Navigate to a REVIEW site with field mappings -- highlights appear on the page
6. High confidence fields show green solid borders with field name + confidence labels
7. Low confidence fields show amber dashed borders with labels
8. Hover over highlight -- border thickens
9. Side panel shows FieldMappingPanel with field list, confidence, progress indicator
10. Click confirm on a field -- highlight turns solid green, progress updates
11. Click edit on a field -- picker mode activates (crosshair cursor)
12. Click a page element in picker mode -- field remaps to new element
13. Click "Add Field" -- picker activates, select element, choose type -- new field added
14. Click remove -- field and highlight removed
15. Messages route correctly between content script, background, and side panel

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3: Review Mode — Field Mapping Overlay & Correction]
- [Source: _bmad-output/planning-artifacts/architecture.md#Chrome Extension Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries -- Project 2: Chrome Extension]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- Custom Components -- FieldHighlight]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- Custom Components -- FieldMappingPanel]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Defining Core Experience -- Experience Mechanics]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation -- Color System -- Chrome Extension Overlay Colors]
- [Source: _bmad-output/planning-artifacts/prd.md#FR17, FR18, FR19]
- [Source: _bmad-output/implementation-artifacts/3-1-review-queue-dashboard-view.md]
- [Source: _bmad-output/implementation-artifacts/3-2-chrome-extension-scaffolding-and-authentication.md]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed TypeScript errors: unused FieldMappingStatus import, implicit any in buildNthChildPath, unused CONFIDENCE_HIGH_THRESHOLD import

### Completion Notes List
- All 8 tasks completed with all subtasks
- Extension builds successfully (pnpm build + pnpm check pass)
- Main project builds successfully (pnpm build passes)
- Used `scrapnew-` CSS class prefix for style isolation (not Shadow DOM)
- Content script handles all DOM manipulation via FieldHighlight and ElementPicker modules
- Background service worker routes messages bidirectionally between content script and side panel
- Side panel manages all Review Mode state (fields, picker target, add field flow)
- Selector generation follows priority: ID > data attributes > unique class > parent path > nth-child

### File List
- `extension/src/lib/types.ts` -- MODIFIED: Added FieldMappingEntry, ReviewModeState, HighlightConfig, ContentMessage, PanelMessage, ExtensionMessage types
- `extension/src/lib/constants.ts` -- MODIFIED: Added FIELD_TYPES, HIGHLIGHT_COLORS, CONFIDENCE_HIGH_THRESHOLD
- `extension/src/content/FieldHighlight.ts` -- NEW: DOM overlay highlight management (create, update, remove, clear, hover, scroll/resize)
- `extension/src/content/ElementPicker.ts` -- NEW: Click-to-select element picker with CSS selector generation
- `extension/src/entrypoints/content.ts` -- MODIFIED: Wired FieldHighlight + ElementPicker + chrome.runtime messaging
- `extension/src/entrypoints/background.ts` -- MODIFIED: Added message routing (FORWARD_TO_CONTENT, FORWARD_TO_PANEL) + GET_SITE_CONFIG handler
- `extension/src/entrypoints/sidepanel/FieldMappingPanel.tsx` -- NEW: Main Review Mode panel component (FieldRow, StatusDot, ModeTabs, AddFieldDropdown, progress indicator)
- `extension/src/entrypoints/sidepanel/App.tsx` -- MODIFIED: Integrated Review Mode state management, config loading, message handling
