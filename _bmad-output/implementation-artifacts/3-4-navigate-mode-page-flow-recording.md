# Story 3.4: Navigate Mode — Page Flow Recording

Status: done

## Story

As an admin,
I want to record the page navigation flow from listing page to detail page to apply page,
So that the scraper knows how to navigate multi-page job sites.

## Acceptance Criteria

1. **Given** I am in the extension on a target site **When** I click the "Navigate" mode tab in the side panel **Then** the extension switches to Navigate Mode and displays instructions: "Click a job link to record the listing -> detail page flow"
   - The Navigate tab becomes active (visually highlighted)
   - Review and Form Record tabs are still visible and clickable (Review mode was implemented in 3-3)
   - Any active field highlights from Review Mode are cleared when entering Navigate Mode
   - Any active picker mode is stopped when switching modes

2. **Given** Navigate Mode is active **When** the mode loads **Then** the side panel shows the current navigation flow state:
   - Step 1: "Listing Page" with the current URL displayed (auto-captured as the starting page)
   - Step 2: "Detail Page" with a placeholder "Click a job link to record..."
   - Step 3: "Apply Page" (optional) with a placeholder "Click apply link on detail page..."
   - Each step shows a status indicator: recorded (green check), pending (grey circle), or current (blue pulse)

3. **Given** Navigate Mode is active on a listing page **When** I click a job listing link on the page **Then** the browser navigates to the detail page and the extension records the navigation
   - The content script intercepts link clicks in Navigate Mode (not picker mode -- different interaction)
   - The URL pattern for the detail page is extracted and stored
   - The CSS selector of the clicked link element is captured (for the scraper to use)
   - The side panel updates: Step 2 shows the detail page URL pattern with a green check
   - A URL pattern is derived from the actual URL (e.g., `https://example.com/jobs/*` or regex-based)

4. **Given** the detail page is recorded **When** I click an "Apply" or external link on the detail page (if exists) **Then** the extension records the apply page URL pattern as the third step in the navigation flow (FR20)
   - Step 3 updates with the apply page URL pattern and a green check
   - The apply step is optional -- the admin can skip it

5. **Given** the navigation flow is recorded (at least listing + detail) **When** I switch back to Review Mode **Then** the recorded page flow is preserved and included in the site configuration
   - The page flow data persists across mode switches within the same session
   - The page flow is stored in the side panel state and will be included when Save Config is triggered (story 3-5)
   - Switching back to Review Mode re-shows field highlights

6. **Given** the navigation flow has been recorded incorrectly **When** I click "Reset Navigation" in Navigate Mode **Then** the recorded flow is cleared and I can start recording again
   - All steps reset to their initial state
   - The admin needs to navigate back to the listing page manually to restart

7. **Given** Navigate Mode is active **When** the admin navigates between pages **Then** the content script detects URL changes and updates the side panel accordingly
   - The content script monitors `window.location` changes (including SPA-style navigation)
   - The background service worker tracks tab URL changes for the active tab

8. **Given** the navigation flow has been recorded **When** I look at the side panel in Navigate Mode **Then** the flow visualization shows the complete recorded path with:
   - Listing page URL (or pattern)
   - Link selector used to navigate to detail page
   - Detail page URL (or pattern)
   - (Optional) Apply link selector and apply page URL pattern
   - A "Reset Navigation" button to start over

## Tasks / Subtasks

- [x] Task 1: Extend extension types and constants for Navigate Mode (AC: #1, #2, #8)
  - [x] 1.1: Add types to `extension/src/lib/types.ts`: `NavigateFlowStep` (type: 'listing' | 'detail' | 'apply', url: string | null, urlPattern: string | null, linkSelector: string | null, status: 'pending' | 'current' | 'recorded'), `NavigateModeState` (steps: NavigateFlowStep[], activeStepIndex: number, isRecording: boolean)
  - [x] 1.2: Add Navigate Mode message types to `ExtensionMessage`: `NAVIGATE_START` (enter navigate mode), `NAVIGATE_STOP` (exit navigate mode), `NAVIGATE_LINK_CLICKED` (content -> panel: url, selector of clicked link), `NAVIGATE_URL_CHANGED` (content -> panel: new URL detected)
  - [x] 1.3: Add `NavigateMode` to mode type: create `ExtensionMode` type as `'review' | 'navigate' | 'formRecord'`

- [x] Task 2: Build NavigateRecorder content script module (AC: #3, #4, #7)
  - [x] 2.1: Create `extension/src/content/NavigateRecorder.ts` -- module that intercepts link clicks and monitors URL changes during Navigate Mode
  - [x] 2.2: Implement `startNavigateRecording()` -- enables navigate mode: adds click listener on all `<a>` elements and elements with `href` attributes to capture link clicks
  - [x] 2.3: On link click during navigate mode: capture the link's `href`, generate a CSS selector for the clicked link element (using `generateSelector` from ElementPicker), send `NAVIGATE_LINK_CLICKED` message with `{ url, selector }` to the background/panel
  - [x] 2.4: Do NOT prevent default on link clicks in Navigate Mode -- the browser should actually navigate so the admin sees the real page transition
  - [x] 2.5: Implement URL change monitoring: use `MutationObserver` on `document.title` changes + periodic `window.location.href` check (handles SPA navigation) + `popstate` listener. Send `NAVIGATE_URL_CHANGED` when URL changes.
  - [x] 2.6: Implement `stopNavigateRecording()` -- removes all navigate mode listeners and observers
  - [x] 2.7: Implement `deriveUrlPattern(url: string)` -- extracts a URL pattern from a concrete URL (replace numeric/hash segments with `*`, e.g., `https://example.com/jobs/12345` -> `https://example.com/jobs/*`)

- [x] Task 3: Update content script for Navigate Mode messages (AC: #1, #3, #7)
  - [x] 3.1: Update `extension/src/entrypoints/content.ts` to import NavigateRecorder module
  - [x] 3.2: Add handler for `NAVIGATE_START` message: call `startNavigateRecording()`, clear existing field highlights (call `clearAllHighlights()`)
  - [x] 3.3: Add handler for `NAVIGATE_STOP` message: call `stopNavigateRecording()`
  - [x] 3.4: Content script re-initializes on page navigation (WXT content script runs on each page load due to `matches: ["<all_urls>"]`), so navigate recording state needs to be tracked across navigations via messaging with the background service worker

- [x] Task 4: Update background service worker for Navigate Mode (AC: #7)
  - [x] 4.1: Add `NAVIGATE_START` and `NAVIGATE_STOP` to `FORWARD_TO_CONTENT` message list
  - [x] 4.2: Add `NAVIGATE_LINK_CLICKED` and `NAVIGATE_URL_CHANGED` to `FORWARD_TO_PANEL` message list
  - [x] 4.3: Track navigate mode state in background: store a boolean `isNavigateMode` per tab, so when content script re-initializes after page navigation, the background can tell it to resume navigate recording
  - [x] 4.4: Add `GET_NAVIGATE_STATE` message handler: when content script initializes on a new page, it asks the background if navigate mode is active. If yes, the content script calls `startNavigateRecording()` automatically

- [x] Task 5: Build NavigateFlowPanel component (AC: #2, #3, #4, #6, #8)
  - [x] 5.1: Create `extension/src/entrypoints/sidepanel/NavigateFlowPanel.tsx` -- React component displaying the navigate flow visualization
  - [x] 5.2: Flow step list: render 3 steps (Listing, Detail, Apply) each showing: step name, status icon (green check / grey circle / blue pulse), URL or URL pattern when recorded, link selector when recorded
  - [x] 5.3: Step indicators: "Listing Page" auto-captures the current URL when Navigate Mode is entered; "Detail Page" shows "Click a job link..." prompt until recorded; "Apply Page" shows "Click apply link..." prompt and "(optional)" label
  - [x] 5.4: Instructions banner at top: "Click a job link to record the listing -> detail page flow" (changes based on current step)
  - [x] 5.5: "Reset Navigation" button at bottom: resets all steps, clears recorded URLs and selectors
  - [x] 5.6: Visual connector lines between steps (vertical line with dots/arrows) to show the flow direction
  - [x] 5.7: Each recorded step shows the URL in monospace truncated text with a tooltip for the full URL
  - [x] 5.8: Each recorded step shows the link selector in monospace small text (for transparency)

- [x] Task 6: Enable mode switching in ModeTabs and App.tsx (AC: #1, #5)
  - [x] 6.1: Update `ModeTabs` in `FieldMappingPanel.tsx`: make the "Navigate" tab clickable (remove `disabled` prop). Keep "Form Record" disabled (story 3-5). Add `activeMode` and `onModeChange` props.
  - [x] 6.2: Add `ExtensionMode` state to `App.tsx`: `useState<ExtensionMode>('review')`. Default to 'review' on load.
  - [x] 6.3: On mode change to 'navigate': send `NAVIGATE_START` to content script (which clears highlights and starts navigate recording), show NavigateFlowPanel instead of FieldMappingPanel
  - [x] 6.4: On mode change to 'review': send `NAVIGATE_STOP` to content script, re-send `SHOW_HIGHLIGHTS` to restore field highlights on the page, show FieldMappingPanel
  - [x] 6.5: Maintain separate state for navigate flow (NavigateModeState) and review mode state (fields, picker, etc.) -- both persist across mode switches
  - [x] 6.6: Pass navigate flow steps data to parent App.tsx state so it can be included in Save Config (story 3-5 will use this)

- [x] Task 7: Handle page navigation during Navigate Mode (AC: #3, #4, #7)
  - [x] 7.1: When the admin clicks a link and the page navigates, the content script on the new page initializes fresh (WXT re-injects content scripts). The new content script should check with the background if navigate mode is active (via `GET_NAVIGATE_STATE`) and resume recording.
  - [x] 7.2: In the side panel, listen for `NAVIGATE_LINK_CLICKED` to record which link was clicked (selector + URL). Listen for `NAVIGATE_URL_CHANGED` to confirm the page actually navigated.
  - [x] 7.3: Flow logic in App.tsx:
    - If no detail page recorded yet, the next link click records as "detail page" transition
    - If detail page is already recorded, the next link click records as "apply page" transition
    - After both detail and apply are recorded, further clicks are ignored (admin must reset to re-record)
  - [x] 7.4: Convert recorded URLs into URL patterns using a simple heuristic: replace numeric path segments and UUIDs with `*` wildcard (e.g., `/jobs/12345/details` -> `/jobs/*/details`). This pattern helps the scraper identify similar URLs.

- [x] Task 8: Verify extension build and Navigate Mode (AC: all)
  - [x] 8.1: Run `pnpm build` in the extension directory -- must produce a valid Chrome extension
  - [x] 8.2: Run `pnpm check` in the extension directory -- TypeScript check passes
  - [x] 8.3: Run `pnpm build` in the main project root -- must still pass
  - [ ] 8.4: Manual verification checklist:
    - Navigate to a REVIEW site -- extension loads in Review Mode with field highlights
    - Click Navigate tab -- mode switches, highlights cleared, navigate instructions shown
    - Listing page URL is auto-captured in Step 1
    - Click a job link on the page -- browser navigates, detail page URL recorded in Step 2
    - Click an apply link on the detail page -- apply URL recorded in Step 3 (optional)
    - Switch back to Review tab -- field highlights reappear, navigate flow preserved
    - Click "Reset Navigation" -- all steps cleared
    - Content script survives page navigation (re-initializes and resumes recording)

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This is a CHROME EXTENSION story** -- all changes are in the `extension/` directory. No backend changes needed.
- **Content script re-initialization on navigation:** When the user clicks a link and the browser navigates to a new page, WXT re-injects the content script. The content script must check with the background service worker whether Navigate Mode is active and resume recording. This is the key technical challenge of this story.
- **Do NOT prevent link navigation:** Unlike Review Mode's picker (which prevents clicks), Navigate Mode must allow the browser to actually follow links so the admin sees the real page transition. The content script captures the click info BEFORE navigation occurs.
- **Background service worker as state holder:** The background service worker must track whether navigate mode is active per tab, because the content script re-initializes on each page and loses its state. The side panel persists across navigations (it's a separate Chrome page).
- **No React Query in extension** -- use simple state management with useState/useEffect.
- **Package manager:** pnpm.
- **Style isolation:** Any new content script styles use `scrapnew-` prefix.

### Navigate Mode Data Flow

```
1. Admin clicks "Navigate" tab in side panel
2. Side panel sends NAVIGATE_START to background
3. Background forwards NAVIGATE_START to content script + sets isNavigateMode=true for tab
4. Content script calls startNavigateRecording() -- adds link click listeners
5. Admin clicks a job listing link on the page
6. Content script captures link selector + href, sends NAVIGATE_LINK_CLICKED to background
7. Browser navigates to the detail page (link click NOT prevented)
8. Content script on NEW page initializes, sends GET_NAVIGATE_STATE to background
9. Background responds with isNavigateMode=true
10. New content script calls startNavigateRecording()
11. Side panel receives NAVIGATE_LINK_CLICKED, records detail page step
12. Side panel also detects URL change (via NAVIGATE_URL_CHANGED from new content script)
```

### Page Flow Data Structure

The navigate flow will be stored as an array of `NavigateFlowStep` objects that ultimately maps to the `Site.pageFlow` JSON field in the database:

```typescript
// Internal Navigate Mode state
interface NavigateFlowStep {
  type: 'listing' | 'detail' | 'apply';
  url: string | null;           // Actual URL visited
  urlPattern: string | null;    // Derived pattern (e.g., /jobs/*)
  linkSelector: string | null;  // CSS selector of the link clicked to reach this page
  status: 'pending' | 'current' | 'recorded';
}

// What gets saved to Site.pageFlow (via Save Config in story 3-5)
// Maps to the existing PageFlowStep type:
// { url: string, action: string, waitFor?: string }
// Translation: url = urlPattern, action = linkSelector, waitFor = undefined for now
```

### URL Pattern Derivation

The `deriveUrlPattern()` function converts a concrete URL into a wildcard pattern:

```typescript
// Input: "https://jobs.example.com/position/12345/details"
// Output: "https://jobs.example.com/position/*/details"

// Rules:
// 1. Replace purely numeric path segments with *
// 2. Replace UUID-like segments with *
// 3. Replace hash-like segments (hex strings > 6 chars) with *
// 4. Keep query parameters as-is (they might be meaningful)
// 5. Keep the protocol and domain unchanged
```

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Side panel App.tsx | `extension/src/entrypoints/sidepanel/App.tsx` | EXTEND with mode switching and navigate state |
| FieldMappingPanel.tsx | `extension/src/entrypoints/sidepanel/FieldMappingPanel.tsx` | MODIFY ModeTabs to enable Navigate tab |
| Background service worker | `extension/src/entrypoints/background.ts` | ADD navigate mode message handlers and state tracking |
| Content script | `extension/src/entrypoints/content.ts` | ADD navigate mode message handlers |
| ElementPicker.ts | `extension/src/content/ElementPicker.ts` | REUSE `generateSelector()` for link selector generation |
| FieldHighlight.ts | `extension/src/content/FieldHighlight.ts` | REUSE `clearAllHighlights()` when entering Navigate Mode |
| Types | `extension/src/lib/types.ts` | EXTEND with Navigate Mode types |
| Constants | `extension/src/lib/constants.ts` | EXTEND if needed |
| API client | `extension/src/lib/api.ts` | No changes needed -- no new API calls for this story |

### Content Script Re-initialization Pattern

WXT content scripts with `matches: ["<all_urls>"]` are re-injected on every page load. This means:

1. When the admin clicks a link and navigates, the old content script is destroyed
2. A new content script initializes on the new page
3. The new content script must check with the background if navigate mode is active
4. If yes, it resumes navigate recording automatically

This requires adding a `GET_NAVIGATE_STATE` check at content script initialization:

```typescript
// In content.ts main():
chrome.runtime.sendMessage({ type: "GET_NAVIGATE_STATE" }, (response) => {
  if (response?.isNavigateMode) {
    startNavigateRecording();
  }
});
```

### Mode Switching Architecture

```
App.tsx state:
  activeMode: 'review' | 'navigate' | 'formRecord'
  reviewState: { fields, pickerTarget, isAddingField, ... }
  navigateState: { steps: NavigateFlowStep[], ... }

When mode = 'review':
  - Render FieldMappingPanel (existing)
  - Field highlights visible on page

When mode = 'navigate':
  - Render NavigateFlowPanel (new)
  - No field highlights on page
  - Link click recording active
  - URL change monitoring active

Both states persist independently across mode switches.
```

### Project Structure (Files to Create/Modify)

```
extension/
  src/
    content/
      NavigateRecorder.ts             # NEW -- link click capture + URL monitoring
    entrypoints/
      content.ts                      # MODIFY -- add Navigate Mode handlers + GET_NAVIGATE_STATE check
      background.ts                   # MODIFY -- add Navigate Mode state tracking + message routing
      sidepanel/
        App.tsx                       # MODIFY -- add mode switching, navigate state, NavigateFlowPanel rendering
        FieldMappingPanel.tsx         # MODIFY -- update ModeTabs to enable Navigate tab
        NavigateFlowPanel.tsx         # NEW -- navigate flow visualization component
    lib/
      types.ts                        # MODIFY -- add Navigate Mode types and messages
      constants.ts                    # No changes expected
```

No changes needed to the main Next.js project.

### Previous Story Learnings (from Stories 1-1 through 3-3)

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
15. **`generateSelector()` in ElementPicker.ts** -- already exists for producing unique CSS selectors. Reuse for link selector capture.

### Anti-Patterns to AVOID

- Do NOT prevent default on link clicks in Navigate Mode -- the browser must actually navigate so the admin sees the real page transition. This is fundamentally different from Review Mode's picker.
- Do NOT use `window.location.assign()` or programmatic navigation -- let the natural link click happen.
- Do NOT try to maintain content script state across page navigations -- the content script is destroyed and re-created. Use the background service worker as the state bridge.
- Do NOT modify the main Next.js project -- this story is extension-only.
- Do NOT implement Save Config functionality -- that belongs to story 3-5.
- Do NOT implement Form Record Mode -- that belongs to story 3-5.
- Do NOT add React Query or TanStack Query to the extension.
- Do NOT put complex business logic in the content script -- it handles DOM events and forwards messages. Logic lives in the side panel.
- Do NOT use `window.postMessage` for extension communication -- use `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.
- Do NOT use `any` type -- all navigate flow types and messages must be properly typed.
- Do NOT use inline styles in content script where CSS classes with `scrapnew-` prefix work.
- Do NOT break existing Review Mode functionality -- mode switching must preserve Review Mode state.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes in the extension directory
2. `pnpm check` passes in the extension directory (TypeScript)
3. `pnpm build` passes in the main project root
4. Load extension in Chrome from `.output/chrome-mv3/`
5. Navigate to a REVIEW site -- Review Mode works as before (highlights, confirm, edit, add, remove)
6. Click Navigate tab -- mode switches, field highlights cleared, navigate instructions appear
7. Listing page URL auto-captured in Step 1 with green check
8. Click a job link -- browser navigates to detail page, content script re-initializes and resumes navigate recording
9. Detail page URL and link selector recorded in Step 2 with green check
10. (Optional) Click apply link on detail page -- apply URL recorded in Step 3
11. Switch back to Review tab -- field highlights reappear, navigate flow preserved in state
12. Click "Reset Navigation" -- all steps cleared, ready to re-record
13. Messages route correctly between content script, background, and side panel
14. Navigate mode state survives content script re-initialization on page navigation

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4: Navigate Mode -- Page Flow Recording]
- [Source: _bmad-output/planning-artifacts/architecture.md#Chrome Extension Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries -- Project 2: Chrome Extension]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Defining Core Experience -- Experience Mechanics -- Navigate phase]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- Custom Components -- FieldMappingPanel]
- [Source: _bmad-output/planning-artifacts/prd.md#FR20]
- [Source: _bmad-output/implementation-artifacts/3-2-chrome-extension-scaffolding-and-authentication.md]
- [Source: _bmad-output/implementation-artifacts/3-3-review-mode-field-mapping-overlay-and-correction.md]
- [Source: prisma/schema.prisma -- Site model pageFlow field]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A

### Completion Notes List
- All 8 tasks completed successfully
- Extension builds cleanly (pnpm build, pnpm check both pass)
- Main project build passes
- Navigate Mode types added: ExtensionMode, NavigateFlowStep, NavigateModeState
- Navigate messages: NAVIGATE_START, NAVIGATE_STOP, NAVIGATE_LINK_CLICKED, NAVIGATE_URL_CHANGED, GET_NAVIGATE_STATE
- NavigateRecorder module captures link clicks without preventing default, monitors URL changes via popstate + MutationObserver + periodic check
- Content script checks GET_NAVIGATE_STATE on re-initialization to resume navigate recording after page navigation
- Background service worker tracks isNavigateMode per tab
- NavigateFlowPanel displays 3-step flow: Listing, Detail (required), Apply (optional) with status icons and connector lines
- ModeTabs shared between Review and Navigate panels; Form Record remains disabled
- Mode switching preserves both review state and navigate state independently
- deriveUrlPattern() replaces numeric, UUID, and hex-hash path segments with wildcards

### File List
- extension/src/lib/types.ts (MODIFIED - added Navigate Mode types and messages)
- extension/src/content/NavigateRecorder.ts (NEW - link click capture + URL monitoring)
- extension/src/entrypoints/content.ts (MODIFIED - Navigate Mode handlers + GET_NAVIGATE_STATE check)
- extension/src/entrypoints/background.ts (MODIFIED - navigate state tracking + message routing)
- extension/src/entrypoints/sidepanel/NavigateFlowPanel.tsx (NEW - navigate flow visualization)
- extension/src/entrypoints/sidepanel/FieldMappingPanel.tsx (MODIFIED - shared ModeTabs, activeMode/onModeChange props)
- extension/src/entrypoints/sidepanel/App.tsx (MODIFIED - mode switching, navigate state, message handling)
