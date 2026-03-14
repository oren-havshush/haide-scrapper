import { useState } from "react";
import type { FieldMappingEntry, ExtensionMessage, ExtensionMode, TestExtractResult, FieldDiagnostic, RevealDiagnostic } from "../../lib/types";
import { FIELD_TYPES, CONFIDENCE_HIGH_THRESHOLD } from "../../lib/constants";
import { ModeTabs } from "./NavigateFlowPanel";
import SaveConfigButton from "./SaveConfigButton";

// --- Sub-components ---

function StatusDot({ status, confidence }: { status: FieldMappingEntry["status"]; confidence: number }) {
  let colorClass: string;

  if (status === "confirmed") {
    colorClass = "bg-success";
  } else if (status === "editing") {
    colorClass = "bg-blue-500";
  } else if (confidence < CONFIDENCE_HIGH_THRESHOLD) {
    colorClass = "bg-warning";
  } else {
    colorClass = "bg-muted";
  }

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`}
      title={status === "confirmed" ? "Confirmed" : status === "editing" ? "Editing" : "Unconfirmed"}
    />
  );
}

function ConfidenceText({ confidence }: { confidence: number }) {
  const isLow = confidence < CONFIDENCE_HIGH_THRESHOLD;
  return (
    <span className={`text-xs tabular-nums ${isLow ? "text-warning" : "text-muted-foreground"}`}>
      {confidence}%
    </span>
  );
}

interface FieldRowProps {
  field: FieldMappingEntry;
  onConfirm: (fieldName: string) => void;
  onEdit: (fieldName: string) => void;
  onRemove: (fieldName: string) => void;
}

function FieldRow({ field, onConfirm, onEdit, onRemove }: FieldRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
        field.status === "editing"
          ? "bg-blue-500/10 border border-blue-500/30"
          : hovered
          ? "bg-border/30"
          : ""
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <StatusDot status={field.status} confidence={field.confidence} />

      <span className="text-sm text-foreground flex-1 truncate" title={field.fieldName}>
        {field.fieldName}
      </span>

      <ConfidenceText confidence={field.confidence} />

      {/* Action icons on hover */}
      <div className={`flex items-center gap-0.5 ${hovered || field.status === "editing" ? "opacity-100" : "opacity-0"}`}>
        {field.status !== "confirmed" && (
          <button
            onClick={() => onConfirm(field.fieldName)}
            className="p-1 rounded hover:bg-success/20 text-muted-foreground hover:text-success transition-colors"
            title="Confirm mapping"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
        {field.status === "confirmed" && (
          <span className="p-1 text-success" title="Confirmed">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        )}

        <button
          onClick={() => onEdit(field.fieldName)}
          className={`p-1 rounded transition-colors ${
            field.status === "editing"
              ? "bg-blue-500/20 text-blue-400"
              : "hover:bg-blue-500/20 text-muted-foreground hover:text-blue-400"
          }`}
          title="Edit mapping (pick new element)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>

        <button
          onClick={() => onRemove(field.fieldName)}
          className="p-1 rounded hover:bg-error/20 text-muted-foreground hover:text-error transition-colors"
          title="Remove field"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- Overall Confidence Bar ---

function OverallConfidence({ score }: { score: number }) {
  const isLow = score < CONFIDENCE_HIGH_THRESHOLD;
  const barColor = isLow ? "bg-warning" : "bg-success";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Overall Confidence</span>
        <span className={`text-xs font-medium ${isLow ? "text-warning" : "text-success"}`}>
          {score}%
        </span>
      </div>
      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  );
}

// --- Add Field Dropdown ---

interface AddFieldDropdownProps {
  onSelect: (fieldType: string) => void;
  onCancel: () => void;
}

function AddFieldDropdown({ onSelect, onCancel }: AddFieldDropdownProps) {
  return (
    <div className="mt-2 p-2 bg-background rounded-lg border border-border">
      <div className="text-xs text-muted-foreground mb-2">Select field type:</div>
      <div className="grid grid-cols-2 gap-1">
        {FIELD_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="px-2 py-1.5 text-xs text-foreground bg-card hover:bg-border/50 rounded-md transition-colors capitalize"
          >
            {type}
          </button>
        ))}
      </div>
      <button
        onClick={onCancel}
        className="mt-2 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

// --- Main Panel ---

interface FieldMappingPanelProps {
  siteUrl: string;
  fields: FieldMappingEntry[];
  pickerTarget: string | null;
  isAddingField: boolean;
  showFieldTypeDropdown: boolean;
  activeMode: ExtensionMode;
  onModeChange: (mode: ExtensionMode) => void;
  onConfirmField: (fieldName: string) => void;
  onEditField: (fieldName: string) => void;
  onRemoveField: (fieldName: string) => void;
  onAddField: () => void;
  onSelectFieldType: (fieldType: string) => void;
  onCancelAddField: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onSaveConfig: () => void;
  listingSelector: string | null;
  itemSelector: string | null;
  pickingContainer: "listing" | "item" | null;
  revealSelector: string | null;
  onPickListingContainer: () => void;
  onPickItemWrapper: () => void;
  onPickRevealAction: () => void;
  testResult: TestExtractResult | null;
  isApproving: boolean;
  approveError: string | null;
  approveSuccess: boolean;
  onApproveAndScrape: () => void;
}

export default function FieldMappingPanel({
  siteUrl,
  fields,
  pickerTarget,
  isAddingField,
  showFieldTypeDropdown,
  activeMode,
  onModeChange,
  onConfirmField,
  onEditField,
  onRemoveField,
  onAddField,
  onSelectFieldType,
  onCancelAddField,
  isSaving,
  saveError,
  saveSuccess,
  onSaveConfig,
  listingSelector,
  itemSelector,
  pickingContainer,
  revealSelector,
  onPickListingContainer,
  onPickItemWrapper,
  onPickRevealAction,
  testResult,
  isApproving,
  approveError,
  approveSuccess,
  onApproveAndScrape,
}: FieldMappingPanelProps) {
  const confirmedCount = fields.filter((f) => f.status === "confirmed").length;
  const totalCount = fields.length;

  // Calculate overall confidence as average
  const overallConfidence =
    fields.length > 0
      ? Math.round(fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length)
      : 0;

  // Send message helper (used for cancel/stop)
  function sendStopPicker() {
    chrome.runtime.sendMessage({ type: "STOP_PICKER" } satisfies ExtensionMessage).catch(() => {
      // Background may not be ready
    });
  }

  return (
    <div className="min-h-screen bg-card text-foreground font-sans p-4">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-sm font-bold text-foreground mb-1">scrapnew</h1>
        <div className="h-px bg-border" />
      </div>

      {/* Site URL */}
      <div className="mb-3">
        <div className="text-xs text-muted-foreground mb-1">Site URL</div>
        <div className="text-xs text-foreground font-mono break-all truncate" title={siteUrl}>
          {siteUrl}
        </div>
      </div>

      {/* Overall Confidence */}
      <div className="mb-3">
        <OverallConfidence score={overallConfidence} />
      </div>

      {/* Mode Tabs */}
      <div className="mb-4">
        <ModeTabs activeMode={activeMode} onModeChange={onModeChange} />
      </div>

      {/* Divider */}
      <div className="h-px bg-border mb-3" />

      {/* Container Setup */}
      <div className="mb-3 space-y-1.5">
        <h2 className="text-xs font-semibold text-foreground mb-1.5">Container Setup</h2>

        {pickingContainer && (
          <div className="px-2 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-md flex items-center justify-between mb-1.5">
            <span className="text-xs text-blue-400">
              {pickingContainer === "listing"
                ? "Click the job list container..."
                : pickingContainer === "item"
                ? "Click a single job item..."
                : "Click the expand/accordion button..."}
            </span>
            <button
              onClick={onCancelAddField}
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onPickListingContainer}
            disabled={!!pickerTarget || isAddingField}
            className={`flex-1 px-2 py-1.5 text-xs border rounded-md transition-colors ${
              listingSelector
                ? "border-success/40 bg-success/5 text-success"
                : "border-border text-muted-foreground hover:bg-border/50"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {listingSelector ? "List Container \u2713" : "Set List Container"}
          </button>
          <button
            onClick={onPickItemWrapper}
            disabled={!!pickerTarget || isAddingField}
            className={`flex-1 px-2 py-1.5 text-xs border rounded-md transition-colors ${
              itemSelector
                ? "border-success/40 bg-success/5 text-success"
                : "border-border text-muted-foreground hover:bg-border/50"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {itemSelector ? "Job Item \u2713" : "Set Job Item"}
          </button>
        </div>

        {/* Reveal Action (accordion/expand) button */}
        <button
          onClick={onPickRevealAction}
          disabled={!!pickerTarget || isAddingField}
          className={`w-full px-2 py-1.5 text-xs border rounded-md transition-colors ${
            revealSelector
              ? "border-success/40 bg-success/5 text-success"
              : "border-border text-muted-foreground hover:bg-border/50"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {revealSelector ? "Reveal Action \u2713" : "Set Reveal Action (expand/accordion)"}
        </button>

        {listingSelector && (
          <div className="text-[10px] text-muted-foreground font-mono truncate px-1" title={listingSelector}>
            List: {listingSelector}
          </div>
        )}
        {itemSelector && (
          <div className="text-[10px] text-muted-foreground font-mono truncate px-1" title={itemSelector}>
            Item: {itemSelector}
          </div>
        )}
        {revealSelector && (
          <div className="text-[10px] text-muted-foreground font-mono truncate px-1" title={revealSelector}>
            Reveal: {revealSelector}
          </div>
        )}
      </div>

      <div className="h-px bg-border mb-3" />

      {/* Field List Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-foreground">Field Mappings</h2>
        <span className="text-xs text-muted-foreground">{fields.length} fields</span>
      </div>

      {/* Picker mode indicator */}
      {(pickerTarget || isAddingField) && (
        <div className="mb-2 px-2 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-md flex items-center justify-between">
          <span className="text-xs text-blue-400">
            {isAddingField
              ? "Click an element on the page..."
              : `Picking element for "${pickerTarget}"...`}
          </span>
          <button
            onClick={() => {
              sendStopPicker();
              onCancelAddField();
            }}
            className="text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Field Rows */}
      <div className="space-y-0.5 mb-3">
        {fields.map((field) => (
          <FieldRow
            key={field.fieldName}
            field={field}
            onConfirm={onConfirmField}
            onEdit={onEditField}
            onRemove={onRemoveField}
          />
        ))}
        {fields.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No field mappings detected. Use &quot;Add Field&quot; to map elements manually.
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="mb-3 px-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Verification Progress</span>
          <span className="text-xs font-medium text-foreground">
            {confirmedCount}/{totalCount} fields verified
          </span>
        </div>
        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all bg-success"
            style={{ width: totalCount > 0 ? `${(confirmedCount / totalCount) * 100}%` : "0%" }}
          />
        </div>
      </div>

      {/* Add Field Button */}
      {!showFieldTypeDropdown && (
        <button
          onClick={onAddField}
          disabled={isAddingField || pickerTarget !== null}
          className="w-full px-3 py-2 text-xs font-medium border border-border text-foreground rounded-md hover:bg-border/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add Field
        </button>
      )}

      {/* Field Type Dropdown (after element picked in Add mode) */}
      {showFieldTypeDropdown && (
        <AddFieldDropdown onSelect={onSelectFieldType} onCancel={onCancelAddField} />
      )}

      {/* Save Config Button */}
      <div className="mt-4">
        <SaveConfigButton
          isSaving={isSaving}
          saveError={saveError}
          saveSuccess={saveSuccess}
          onSave={onSaveConfig}
        />
      </div>

      {/* Test Extraction Results */}
      {testResult && (
        <div className="mt-4">
          <div className="h-px bg-border mb-3" />
          <h2 className="text-xs font-semibold text-foreground mb-2">Test Extraction Preview</h2>

          {/* Error message */}
          {testResult.error && (
            <div className="px-3 py-2 mb-2 bg-error/10 border border-error/30 rounded-md">
              <span className="text-xs text-error">{testResult.error}</span>
            </div>
          )}

          {/* Diagnostics: container & item status */}
          {testResult.diagnostics && (
            <div className="mb-2 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase">Selector Diagnostics</div>
              <div className="bg-background rounded-lg border border-border p-2 space-y-1 text-xs font-mono">
                {testResult.diagnostics.strategy === "item-scoped" && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${testResult.diagnostics.listingFound ? "bg-success" : testResult.diagnostics.listingSelector ? "bg-error" : "bg-muted"}`} />
                      <span className="text-muted-foreground">Listing:</span>
                      <span className="text-foreground truncate" title={testResult.diagnostics.listingSelector || "not set"}>
                        {testResult.diagnostics.listingSelector || <span className="text-muted italic">not set</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${testResult.diagnostics.itemsFound > 0 ? "bg-success" : "bg-error"}`} />
                      <span className="text-muted-foreground">Items:</span>
                      <span className="text-foreground truncate" title={testResult.diagnostics.itemSelector || ""}>
                        {testResult.diagnostics.itemSelector}
                      </span>
                      <span className={`ml-auto text-[10px] ${testResult.diagnostics.itemsFound > 0 ? "text-success" : "text-error"}`}>
                        {testResult.diagnostics.itemsFound} found
                      </span>
                    </div>
                  </>
                )}
                {testResult.diagnostics.strategy === "absolute" && (
                  <div className="text-muted-foreground text-[10px]">Using absolute selectors (no item container)</div>
                )}
                {/* Reveal/accordion diagnostic */}
                {testResult.diagnostics.revealDiag?.selector && (
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${testResult.diagnostics.revealDiag.clicked > 0 ? "bg-success" : "bg-error"}`} />
                    <span className="text-muted-foreground">Reveal:</span>
                    <span className="text-foreground truncate" title={testResult.diagnostics.revealDiag.selector}>
                      {testResult.diagnostics.revealDiag.selector}
                    </span>
                    <span className={`ml-auto text-[10px] ${testResult.diagnostics.revealDiag.clicked > 0 ? "text-success" : "text-error"}`}>
                      {testResult.diagnostics.revealDiag.found > 0 ? `${testResult.diagnostics.revealDiag.clicked} clicked` : "NOT FOUND"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Per-field diagnostics */}
          {testResult.diagnostics?.fieldDiagnostics && (
            <div className="mb-2 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase">Field Results</div>
              <div className="bg-background rounded-lg border border-border p-2 space-y-1.5 max-h-72 overflow-y-auto">
                {Object.entries(testResult.diagnostics.fieldDiagnostics).map(([fieldName, diag]) => (
                  <div key={fieldName} className={`rounded-md px-2 py-1.5 ${diag.matched ? "bg-success/5 border border-success/20" : "bg-error/5 border border-error/20"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${diag.matched ? "bg-success" : "bg-error"}`} />
                      <span className="text-xs font-medium text-foreground capitalize">{fieldName}</span>
                      {diag.matched && diag.elementTag && (
                        <span className="text-[10px] text-muted-foreground ml-auto">&lt;{diag.elementTag}&gt;</span>
                      )}
                      {!diag.matched && (
                        <span className="text-[10px] text-error ml-auto">NOT FOUND</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate" title={diag.selector}>
                      {diag.selector}
                    </div>
                    {diag.matched && (
                      <p className="text-xs text-foreground mt-0.5 break-words">
                        {diag.extractedText ? (diag.extractedText.length > 200 ? diag.extractedText.slice(0, 200) + "…" : diag.extractedText) : <span className="text-warning italic">matched but empty</span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approve button (only when extraction succeeded) */}
          {testResult.success && (
            <div className="space-y-2">
              {approveSuccess ? (
                <div className="px-3 py-2 bg-success/10 border border-success/30 rounded-md">
                  <span className="text-xs text-success font-medium">
                    Approved! Go to dashboard to scrape all jobs.
                  </span>
                </div>
              ) : (
                <>
                  {approveError && (
                    <div className="px-3 py-2 bg-error/10 border border-error/30 rounded-md">
                      <span className="text-xs text-error">{approveError}</span>
                    </div>
                  )}
                  <button
                    onClick={onApproveAndScrape}
                    disabled={isApproving}
                    className="w-full px-3 py-2.5 text-xs font-medium bg-success text-background rounded-md hover:bg-success/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isApproving ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Approving...
                      </>
                    ) : (
                      "Approve Site"
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
