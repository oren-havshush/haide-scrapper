# Story 3.5: Form Record Mode & Config Save

Status: done

## Story

As an admin,
I want to capture form field mappings and save the complete site configuration,
So that the scraper has everything it needs to extract job data from this site.

## Acceptance Criteria

1. **Given** I am in the extension on a target site **When** I click the "Form Record" mode tab in the side panel **Then** the extension switches to Form Record Mode and displays instructions for interacting with form fields on the page
   - The Form Record tab becomes active (visually highlighted)
   - Review and Navigate tabs remain clickable for mode switching
   - Any active field highlights from Review Mode are cleared when entering Form Record Mode
   - Any active picker mode is stopped when switching modes

2. **Given** Form Record Mode is active **When** I interact with form fields on the target site (click inputs, select dropdowns, check boxes) **Then** the extension captures each form field's selector, type (text, select, checkbox, radio, textarea), and label
   - Form fields are detected by listening to focus/click events on `<input>`, `<select>`, `<textarea>`, `<button[type=submit]>` elements
   - The CSS selector is generated using the existing `generateSelector()` from `ElementPicker.ts`
   - The field's label is inferred from: associated `<label>` element, `placeholder` attribute, `aria-label`, or nearest text
   - Captured fields appear in the side panel list in the order they were interacted with (FR21)
   - Duplicate selectors are not added (if the same field is clicked again, it is ignored)

3. **Given** form fields have been captured **When** I look at the side panel in Form Record Mode **Then** each captured form field shows: field type icon, inferred label, selector (monospace, truncated), and a remove button
   - A count of captured fields is shown (e.g., "3 form fields captured")
   - A "Clear All" button is available to reset the captured form fields

4. **Given** I have completed field mapping corrections, navigation recording, and/or form recording **When** I click "Save Config" in the side panel **Then** the complete site configuration is sent to the backend via PUT /api/sites/[id]/config (FR22)
   - The payload includes: field mappings (from Review Mode), page flow (from Navigate Mode), and form fields (from Form Record Mode)
   - The payload also includes the original AI mappings and admin corrections as training data (FR13)
   - I see a toast/banner: "Config saved. Test scrape starting..."
   - A test scrape is automatically triggered (auto-cascade behavior per UX spec)

5. **Given** the config save succeeds **When** the test scrape is triggered **Then** a POST /api/sites/[id]/scrape request is sent automatically
   - The site status transitions from REVIEW to ACTIVE (pending scrape validation)
   - The side panel shows a success state with the updated status

6. **Given** the config save fails (network error, validation error) **When** I click "Save Config" **Then** I see an error banner with the specific failure reason and the config is not lost -- I can retry saving
   - The Save Config button re-enables after failure
   - All local state (field mappings, navigate flow, form fields) is preserved

7. **Given** I have made corrections to the AI's original mappings **When** the config is saved **Then** both the original AI mappings and the admin's corrections are stored as structured training data for future AI improvement (FR13)
   - The original AI field mappings (before corrections) are included in the PUT payload as `originalMappings`
   - The corrected field mappings are sent as `fieldMappings`

8. **Given** the Save Config button exists **When** it is visible across all three modes **Then** it appears at the bottom of the side panel in all modes (Review, Navigate, Form Record) as a primary action button
   - The button is disabled when saving is in progress (shows spinner)
   - The button is always accessible regardless of current mode

## Tasks / Subtasks

- [x]Task 1: Extend extension types and constants for Form Record Mode (AC: #1, #2, #3)
  - [x]1.1: Add types to `extension/src/lib/types.ts`: `FormFieldEntry` (selector, fieldType: 'text' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'submit', label: string, tagName: string), `FormRecordModeState` (capturedFields: FormFieldEntry[], isRecording: boolean)
  - [x]1.2: Add Form Record Mode message types to `ExtensionMessage`: `FORM_RECORD_START` (enter form record mode), `FORM_RECORD_STOP` (exit form record mode), `FORM_FIELD_CAPTURED` (content -> panel: FormFieldEntry data)
  - [x]1.3: Add Save Config message types: `SAVE_CONFIG` (panel -> background: triggers config save), `SAVE_CONFIG_RESULT` (background -> panel: success/error response)

- [x]Task 2: Build FormRecorder content script module (AC: #2)
  - [x]2.1: Create `extension/src/content/FormRecorder.ts` -- module that captures form field interactions on the target page
  - [x]2.2: Implement `startFormRecording()` -- adds focus/click event listeners on form elements (`input`, `select`, `textarea`, `button[type=submit]`) using event delegation on `document`
  - [x]2.3: On form field interaction: determine field type from element tag/type attribute, generate CSS selector using `generateSelector()` from `ElementPicker.ts`, infer label from associated `<label>`, `placeholder`, `aria-label`, or nearest visible text, send `FORM_FIELD_CAPTURED` message with `{ selector, fieldType, label, tagName }`
  - [x]2.4: Track captured selectors to avoid sending duplicates (maintain a Set of already-captured selectors)
  - [x]2.5: Implement `stopFormRecording()` -- removes all form field listeners
  - [x]2.6: Implement `resetFormRecording()` -- clears the captured selectors Set so fields can be re-captured
  - [x]2.7: Visually indicate captured form fields with a brief green flash border (using `scrapnew-form-captured` CSS class, auto-removes after 1s)

- [x]Task 3: Update content script for Form Record Mode messages (AC: #1, #2)
  - [x]3.1: Update `extension/src/entrypoints/content.ts` to import FormRecorder module
  - [x]3.2: Add handler for `FORM_RECORD_START` message: call `clearAllHighlights()`, `stopPicker()`, `stopNavigateRecording()`, then `startFormRecording()`
  - [x]3.3: Add handler for `FORM_RECORD_STOP` message: call `stopFormRecording()`

- [x]Task 4: Update background service worker for Form Record Mode + Save Config (AC: #1, #4, #5, #6, #7)
  - [x]4.1: Add `FORM_RECORD_START` and `FORM_RECORD_STOP` to `FORWARD_TO_CONTENT` message list
  - [x]4.2: Add `FORM_FIELD_CAPTURED` to `FORWARD_TO_PANEL` message list
  - [x]4.3: Track form record mode state in background: store `isFormRecordMode` boolean per tab (similar to navigate mode), so content script can check on re-initialization via `GET_FORM_RECORD_STATE`
  - [x]4.4: Add `GET_FORM_RECORD_STATE` message handler for content script re-initialization
  - [x]4.5: Add `SAVE_CONFIG` message handler: receives site config payload from side panel, calls PUT /api/sites/[id]/config via `apiFetch`, then auto-triggers POST /api/sites/[id]/scrape. Returns `SAVE_CONFIG_RESULT` to side panel with success/error.

- [x]Task 5: Build PUT /api/sites/[id]/config backend endpoint (AC: #4, #5, #7)
  - [x]5.1: Add PUT handler to `src/app/api/sites/[id]/config/route.ts` -- accepts JSON body with `fieldMappings`, `pageFlow`, `formFields`, and `originalMappings`
  - [x]5.2: Add Zod validation schema for the config save payload in `src/lib/validators.ts`: `updateSiteConfigSchema` with `fieldMappings` (Record<string, unknown>), `pageFlow` (array), `formFields` (array), `originalMappings` (Record<string, unknown>, optional)
  - [x]5.3: Implement `saveSiteConfig()` in `src/services/siteService.ts`: updates `Site.fieldMappings`, `Site.pageFlow` fields, and stores `formFields` and `originalMappings` in the site's config JSON
  - [x]5.4: Update the Site record to store the original AI mappings alongside corrections for training data (FR13) -- store `originalMappings` in a new field or within the existing `fieldMappings` JSON under a `_original` key
  - [x]5.5: Transition site status from REVIEW to ACTIVE on successful config save (uses existing status transition logic)

- [x]Task 6: Build POST /api/sites/[id]/scrape backend endpoint stub (AC: #5)
  - [x]6.1: Create `src/app/api/sites/[id]/scrape/route.ts` with POST handler
  - [x]6.2: Validate the site exists and has a config (field mappings are not null/empty)
  - [x]6.3: Check for existing in-progress scrape job (prevent duplicate scrapes)
  - [x]6.4: Create a `ScrapeRun` record with status IN_PROGRESS and a `WorkerJob` with type SCRAPE and status PENDING
  - [x]6.5: Return `{ data: scrapeRun }` response with the created scrape run

- [x]Task 7: Build FormRecordPanel and SaveConfigButton side panel components (AC: #3, #4, #6, #8)
  - [x]7.1: Create `extension/src/entrypoints/sidepanel/FormRecordPanel.tsx` -- React component showing captured form fields
  - [x]7.2: Display list of captured `FormFieldEntry` items with: field type icon (input/select/checkbox/textarea/submit), inferred label, selector in monospace truncated text, remove button on hover
  - [x]7.3: Show capture count ("N form fields captured") and instructions banner ("Interact with form fields to capture them")
  - [x]7.4: Add "Clear All" button to reset captured form fields
  - [x]7.5: Create `extension/src/entrypoints/sidepanel/SaveConfigButton.tsx` -- standalone Save Config button component
  - [x]7.6: SaveConfigButton: disabled during save (spinner + "Saving..." text), shows success banner ("Config saved. Test scrape starting...") or error banner with retry on failure
  - [x]7.7: SaveConfigButton sends `SAVE_CONFIG` message to background with full payload: `{ siteId, fieldMappings, pageFlow, formFields, originalMappings }`

- [x]Task 8: Integrate Form Record Mode and Save Config into App.tsx (AC: #1, #4, #5, #6, #7, #8)
  - [x]8.1: Add form record state to App.tsx: `useState<FormFieldEntry[]>([])` for captured fields
  - [x]8.2: Add original AI mappings state: store the initial `fieldMappings` received from the API before any user corrections
  - [x]8.3: Handle mode change to `formRecord`: send `FORM_RECORD_START` to content, show FormRecordPanel
  - [x]8.4: Handle mode change FROM `formRecord`: send `FORM_RECORD_STOP` to content
  - [x]8.5: Listen for `FORM_FIELD_CAPTURED` messages from content: add to captured form fields list (dedup by selector)
  - [x]8.6: Handle Save Config: gather all data (fields from Review, steps from Navigate, form fields from Form Record, original AI mappings), send `SAVE_CONFIG` to background
  - [x]8.7: Handle `SAVE_CONFIG_RESULT`: show success/error state, update site status display on success
  - [x]8.8: Enable the "Form Record" tab in ModeTabs (remove `disabled` prop)
  - [x]8.9: Render SaveConfigButton in all three mode panels (Review, Navigate, Form Record)

- [x]Task 9: Verify extension build, backend build, and integration (AC: all)
  - [x]9.1: Run `pnpm build` in the extension directory -- must produce a valid Chrome extension
  - [x]9.2: Run `pnpm check` in the extension directory -- TypeScript check passes
  - [x]9.3: Run `pnpm build` in the main project root -- must still pass
  - [x]9.4: Manual verification checklist:
    - Navigate to a REVIEW site -- Review Mode works as before
    - Click Form Record tab -- mode switches, instructions shown
    - Click form fields on the page -- fields captured in side panel with selector, type, label
    - Duplicate form field clicks are ignored
    - "Clear All" resets captured fields
    - Switch between Review / Navigate / Form Record -- all states preserved
    - Save Config button visible in all modes
    - Click Save Config -- PUT /api/sites/[id]/config called with complete payload
    - On success: toast shown, auto scrape triggered via POST /api/sites/[id]/scrape
    - On failure: error shown, retry available, local state preserved
    - Site status updates from REVIEW to ACTIVE after successful config save

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This story spans BOTH the Chrome extension AND the backend** -- changes are needed in `extension/` for Form Record Mode + Save Config UI, and in `src/` for the PUT config endpoint and POST scrape endpoint.
- **Content script = DOM event capture for form fields** -- the FormRecorder module captures form interactions on the target page.
- **Side panel = React UI for form field display and save config** -- FormRecordPanel and SaveConfigButton live in the side panel.
- **Background service worker = message router + API caller** -- handles SAVE_CONFIG by calling the backend PUT and POST endpoints.
- **No React Query in extension** -- use simple state management with useState/useEffect and direct API calls via `apiFetch`.
- **Package manager:** pnpm.
- **Style isolation:** Content script overlays MUST use `scrapnew-` CSS class prefix.
- **Services layer for business logic** -- PUT config and POST scrape endpoints should delegate to `siteService.ts`. API routes are thin wrappers.
- **Zod validation on all API inputs** -- the config save payload must be validated with a Zod schema.
- **API response format:** `{ data }` wrapper for all responses, `{ error: { code, message } }` for errors.

### Form Record Mode Data Flow

```
1. Admin clicks "Form Record" tab in side panel
2. Side panel sends FORM_RECORD_START to background
3. Background forwards FORM_RECORD_START to content script + sets isFormRecordMode=true for tab
4. Content script calls startFormRecording() -- adds event listeners on form elements
5. Admin clicks/focuses on a form field on the target page
6. Content script captures selector, type, label -> sends FORM_FIELD_CAPTURED to background
7. Background forwards FORM_FIELD_CAPTURED to side panel
8. Side panel adds field to FormRecordPanel list (dedup by selector)
```

### Save Config Data Flow

```
1. Admin clicks "Save Config" in any mode
2. Side panel gathers: fieldMappings (Review), navigateSteps -> pageFlow (Navigate), formFields (Form Record), originalMappings (initial AI mappings)
3. Side panel sends SAVE_CONFIG message to background with { siteId, fieldMappings, pageFlow, formFields, originalMappings }
4. Background calls PUT /api/sites/[id]/config with the payload
5. Backend validates, updates Site record (fieldMappings, pageFlow), stores training data
6. Backend transitions site status REVIEW -> ACTIVE
7. Background receives 200 OK
8. Background auto-triggers POST /api/sites/[id]/scrape
9. Backend creates ScrapeRun + WorkerJob (SCRAPE type, PENDING status)
10. Background receives scrape response, sends SAVE_CONFIG_RESULT to side panel
11. Side panel shows success: "Config saved. Test scrape starting..."
```

### Config Save Payload Structure

```typescript
// PUT /api/sites/[id]/config body
interface SaveConfigPayload {
  fieldMappings: Record<string, {
    selector: string;
    confidence: number;
    source: string; // "AI" | "MANUAL" | original source
  }>;
  pageFlow: Array<{
    type: "listing" | "detail" | "apply";
    url: string | null;
    urlPattern: string | null;
    linkSelector: string | null;
  }>;
  formFields: Array<{
    selector: string;
    fieldType: string;
    label: string;
    tagName: string;
  }>;
  originalMappings?: Record<string, {
    selector: string;
    confidence: number;
    source: string;
  }>;
}
```

### FormFieldEntry Structure

```typescript
interface FormFieldEntry {
  selector: string;
  fieldType: "text" | "select" | "checkbox" | "radio" | "textarea" | "submit";
  label: string;
  tagName: string;
}
```

### Label Inference Strategy

For captured form fields, infer a human-readable label:

1. Check for `<label for="elementId">` pointing to the field
2. Check `placeholder` attribute
3. Check `aria-label` attribute
4. Check `name` attribute (fallback -- often technical but useful)
5. Look for nearest preceding text node or sibling label element
6. Use tagName + type as last resort (e.g., "text input", "select")

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Side panel App.tsx | `extension/src/entrypoints/sidepanel/App.tsx` | EXTEND with Form Record state + Save Config logic |
| FieldMappingPanel.tsx | `extension/src/entrypoints/sidepanel/FieldMappingPanel.tsx` | ADD SaveConfigButton at bottom |
| NavigateFlowPanel.tsx | `extension/src/entrypoints/sidepanel/NavigateFlowPanel.tsx` | ADD SaveConfigButton at bottom, ENABLE Form Record tab in ModeTabs |
| Background service worker | `extension/src/entrypoints/background.ts` | ADD Form Record mode state + SAVE_CONFIG handler |
| Content script | `extension/src/entrypoints/content.ts` | ADD Form Record mode handlers |
| ElementPicker.ts | `extension/src/content/ElementPicker.ts` | REUSE `generateSelector()` for form field selector generation |
| FieldHighlight.ts | `extension/src/content/FieldHighlight.ts` | REUSE `clearAllHighlights()` when entering Form Record Mode |
| NavigateRecorder.ts | `extension/src/content/NavigateRecorder.ts` | REUSE `stopNavigateRecording()` when entering Form Record Mode, `deriveUrlPattern()` for saving |
| API client | `extension/src/lib/api.ts` | REUSE `apiFetch` in background for PUT config + POST scrape |
| Types | `extension/src/lib/types.ts` | EXTEND with Form Record types |
| Constants | `extension/src/lib/constants.ts` | EXTEND if needed (form field types) |
| Config API endpoint | `src/app/api/sites/[id]/config/route.ts` | ADD PUT handler |
| Site service | `src/services/siteService.ts` | ADD `saveSiteConfig()` function |
| Validators | `src/lib/validators.ts` | ADD `updateSiteConfigSchema` |
| Errors | `src/lib/errors.ts` | REUSE existing error classes |
| API utils | `src/lib/api-utils.ts` | REUSE `successResponse()` |

### Database Considerations

The `Site.fieldMappings` and `Site.pageFlow` are both `Json?` fields in the Prisma schema. The config save updates both.

For training data (FR13), we store the original AI mappings so the system can compare original vs corrected:
- Option: Store `originalMappings` within the `fieldMappings` JSON under a special key like `_meta.originalMappings`
- This avoids schema migration and keeps all config data in the existing JSON fields

For form fields, store them in the site's config. Since there is no dedicated `formFields` column in the schema, store them within the `fieldMappings` JSON under a `_meta.formFields` key, or add them to the `pageFlow` JSON. The simplest approach is to extend the `fieldMappings` JSON:

```typescript
// Updated fieldMappings JSON structure after config save:
{
  "title": { "selector": "h2.job-title", "confidence": 100, "source": "MANUAL" },
  "company": { "selector": ".company-name", "confidence": 85, "source": "CRAWL_CLASSIFY" },
  // ... other field mappings ...
  "_meta": {
    "originalMappings": { ... },  // AI's original output before corrections
    "formFields": [ ... ],        // Captured form field entries
    "savedAt": "2026-03-11T..."   // Timestamp of config save
  }
}
```

### Content Script Re-initialization for Form Record Mode

Like Navigate Mode, Form Record Mode must survive content script re-initialization (page navigation). The pattern is identical:
1. Content script initializes on new page
2. Sends `GET_FORM_RECORD_STATE` to background
3. If active, calls `startFormRecording()`

### ModeTabs Update

The "Form Record" button in ModeTabs is currently disabled. This story enables it:

```tsx
// In NavigateFlowPanel.tsx ModeTabs component:
// Change from:
<button disabled className="... cursor-not-allowed opacity-50">Form Record</button>
// To:
<button onClick={() => onModeChange("formRecord")} className={`... ${activeMode === "formRecord" ? "..." : "..."}`}>Form Record</button>
```

### pageFlow Conversion for Backend

The navigate steps from the side panel need to be converted to the `PageFlowStep[]` format that the backend expects:

```typescript
// Side panel NavigateFlowStep[] -> Backend PageFlowStep[]
const pageFlow = navigateSteps
  .filter(step => step.status === "recorded")
  .map(step => ({
    url: step.urlPattern || step.url || "",
    action: step.linkSelector || "navigate",
    waitFor: undefined,
  }));
```

### POST /api/sites/[id]/scrape Endpoint

This endpoint is a stub for Epic 4 (the scraping engine). For this story, it:
1. Validates the site exists and has config
2. Checks for duplicate in-progress scrapes
3. Creates `ScrapeRun` record (status: IN_PROGRESS)
4. Creates `WorkerJob` record (type: SCRAPE, status: PENDING)
5. Returns the scrape run data

The actual scrape execution will be implemented in Story 4-2.

### Project Structure (Files to Create/Modify)

```
extension/
  src/
    content/
      FormRecorder.ts                 # NEW -- form field capture module
    entrypoints/
      content.ts                      # MODIFY -- add Form Record mode handlers
      background.ts                   # MODIFY -- add Form Record state + SAVE_CONFIG handler
      sidepanel/
        App.tsx                       # MODIFY -- add Form Record state + Save Config logic
        FieldMappingPanel.tsx         # MODIFY -- add SaveConfigButton at bottom
        NavigateFlowPanel.tsx         # MODIFY -- enable Form Record tab + add SaveConfigButton
        FormRecordPanel.tsx           # NEW -- form field capture panel component
        SaveConfigButton.tsx          # NEW -- reusable save config button component
    lib/
      types.ts                        # MODIFY -- add Form Record types + Save Config messages
      constants.ts                    # MODIFY -- add form field type constants

src/ (main Next.js project)
  app/api/sites/[id]/
    config/route.ts                   # MODIFY -- add PUT handler
    scrape/route.ts                   # NEW -- POST handler for triggering scrape
  services/
    siteService.ts                    # MODIFY -- add saveSiteConfig() function
  lib/
    validators.ts                     # MODIFY -- add updateSiteConfigSchema
```

### Previous Story Learnings (from Stories 1-1 through 3-4)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **shadcn/ui v4 uses Base UI** -- not Radix.
4. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout.
5. **Always run `pnpm build`** in both extension and main project before marking story as done.
6. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
7. **WXT entrypoints** -- `defineContentScript()`, `defineBackground()` are WXT globals. Do not import them.
8. **Extension build** -- `pnpm build` in extension dir produces `.output/chrome-mv3/`.
9. **Content script matches** -- uses `matches: ["<all_urls>"]` which means it re-initializes on every page load.
10. **Side panel communication** -- uses `chrome.runtime.sendMessage` from side panel to background, `chrome.tabs.sendMessage` from background to content script.
11. **API response format** -- GET /api/sites/[id]/config returns `{ data: { fieldMappings, pageFlow } }`.
12. **Extension has NO React Query** -- uses simple useState/useEffect with direct `apiFetch` calls.
13. **Tailwind v4 in extension** -- uses `@theme` directive in `styles.css` for dark mode tokens.
14. **Content script style isolation** -- uses `scrapnew-` CSS class prefix to avoid conflicts with target sites.
15. **`generateSelector()` in ElementPicker.ts** -- already exists for producing unique CSS selectors. Reuse for form field selector capture.
16. **Content script re-initialization pattern** -- content script checks with background on init for active mode state (used by Navigate Mode, extend for Form Record Mode).
17. **Side panel state persists across mode switches** -- review state, navigate state, and form record state are all independent.
18. **`deriveUrlPattern()` in NavigateRecorder.ts** -- converts concrete URLs to wildcard patterns for pageFlow.
19. **Background service worker tracks mode per tab** -- `tabNavigateMode` Map exists; add `tabFormRecordMode` Map.
20. **Services layer for business logic** -- API routes delegate to `src/services/`. Do not put business logic in route handlers.
21. **Status transitions enforced by `siteService.ts`** -- REVIEW -> ACTIVE is a valid transition per `VALID_STATUS_TRANSITIONS`.
22. **Existing `updateSiteConfigSchema`-like schemas** -- `updateSiteSchema` in validators.ts already accepts `fieldMappings` and `pageFlow` but is used for PATCH /api/sites/[id]. The config endpoint needs its own dedicated schema.

### Anti-Patterns to AVOID

- Do NOT use `any` type -- all form field types, config payloads, and messages must be properly typed.
- Do NOT use React Query in the extension -- use simple useState/useEffect.
- Do NOT use inline styles in content script where CSS classes with `scrapnew-` prefix work.
- Do NOT put business logic in API route handlers -- delegate to `siteService.ts`.
- Do NOT break existing Review Mode or Navigate Mode functionality -- mode switching must preserve all states.
- Do NOT use `window.postMessage` for extension communication -- use `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.
- Do NOT install heavy libraries -- no form libraries, no state management libraries beyond useState.
- Do NOT modify the Prisma schema -- all new data fits within the existing `Json?` fields.
- Do NOT skip Zod validation on the PUT config endpoint -- all API inputs must be validated.
- Do NOT make the Save Config button only appear in one mode -- it must be accessible from all three modes.
- Do NOT prevent link navigation in Form Record Mode -- form fields are captured via focus/click, not by preventing defaults.
- Do NOT forget to handle content script re-initialization for Form Record Mode -- if the page navigates while in Form Record Mode, the new content script must resume recording.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes in the extension directory
2. `pnpm check` passes in the extension directory (TypeScript)
3. `pnpm build` passes in the main project root
4. Load extension in Chrome from `.output/chrome-mv3/`
5. Navigate to a REVIEW site -- Review Mode works as before (highlights, confirm, edit, add, remove)
6. Click Form Record tab -- mode switches, highlights cleared, form record instructions shown
7. Click form fields on the target page -- fields captured with selector, type, label in side panel
8. Duplicate form field clicks are ignored
9. "Clear All" resets all captured form fields
10. Switch between Review / Navigate / Form Record -- all states preserved independently
11. Save Config button is visible in all three modes
12. Click Save Config -- PUT /api/sites/[id]/config called with complete payload (field mappings, page flow, form fields, original mappings)
13. On success: success banner shown, POST /api/sites/[id]/scrape auto-triggered, ScrapeRun + WorkerJob created
14. On failure: error banner shown, retry available, all local state preserved
15. Backend: PUT /api/sites/[id]/config validates payload with Zod, updates Site record, transitions status REVIEW -> ACTIVE
16. Backend: POST /api/sites/[id]/scrape validates site has config, creates ScrapeRun + WorkerJob, returns scrape run data
17. Messages route correctly between content script, background, and side panel for all Form Record messages

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5: Form Record Mode & Config Save]
- [Source: _bmad-output/planning-artifacts/architecture.md#Chrome Extension Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries -- Project 2: Chrome Extension]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules -- API Naming]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Defining Core Experience -- Experience Mechanics -- Completion]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows -- Journey 1 -- Auto-cascade]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Form Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md#FR21 FR22 FR13]
- [Source: _bmad-output/implementation-artifacts/3-3-review-mode-field-mapping-overlay-and-correction.md]
- [Source: _bmad-output/implementation-artifacts/3-4-navigate-mode-page-flow-recording.md]
- [Source: prisma/schema.prisma -- Site model fieldMappings and pageFlow fields]
- [Source: src/app/api/sites/[id]/config/route.ts -- existing GET handler]
- [Source: src/services/siteService.ts -- updateSiteStatus, VALID_STATUS_TRANSITIONS]
- [Source: src/lib/validators.ts -- existing schemas]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

N/A

### Completion Notes List

- All tasks completed successfully
- Extension build passes (pnpm build in extension/)
- Extension TypeScript check passes (pnpm check in extension/)
- Next.js build passes (pnpm build in root)
- ESLint passes (pnpm lint in root)
- Fixed Zod `error.errors` -> `error.issues` for Zod v4 compatibility

### File List

**New Files:**
- extension/src/content/FormRecorder.ts -- Form field capture module
- extension/src/entrypoints/sidepanel/FormRecordPanel.tsx -- Form record UI panel
- extension/src/entrypoints/sidepanel/SaveConfigButton.tsx -- Reusable save config button
- src/app/api/sites/[id]/scrape/route.ts -- POST scrape endpoint

**Modified Files:**
- extension/src/lib/types.ts -- Added FormFieldEntry, SaveConfigPayload, SaveConfigResult, Form Record/Save Config message types
- extension/src/lib/constants.ts -- Added FORM_FIELD_TYPES, FORM_FIELD_TYPE_LABELS
- extension/src/entrypoints/content.ts -- Added Form Record mode handlers, GET_FORM_RECORD_STATE check
- extension/src/entrypoints/background.ts -- Added Form Record mode state, SAVE_CONFIG handler, handleSaveConfig function
- extension/src/entrypoints/sidepanel/App.tsx -- Added Form Record state, Save Config state, original AI mappings tracking, mode switching, FORM_FIELD_CAPTURED/SAVE_CONFIG_RESULT handlers
- extension/src/entrypoints/sidepanel/FieldMappingPanel.tsx -- Added SaveConfigButton at bottom
- extension/src/entrypoints/sidepanel/NavigateFlowPanel.tsx -- Enabled Form Record tab, added SaveConfigButton at bottom
- src/app/api/sites/[id]/config/route.ts -- Added PUT handler
- src/services/siteService.ts -- Added saveSiteConfig() and createScrapeRun() functions
- src/lib/validators.ts -- Added updateSiteConfigSchema
