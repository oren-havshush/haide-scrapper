import type { NavigateFlowStep, ExtensionMode } from "../../lib/types";
import SaveConfigButton from "./SaveConfigButton";

// --- Sub-components ---

/** Status indicator icon for each flow step */
function StepStatusIcon({ status }: { status: NavigateFlowStep["status"] }) {
  if (status === "recorded") {
    return (
      <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }

  if (status === "current") {
    return (
      <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
      </div>
    );
  }

  // pending
  return (
    <div className="w-6 h-6 rounded-full bg-border flex items-center justify-center flex-shrink-0">
      <div className="w-2.5 h-2.5 rounded-full bg-muted" />
    </div>
  );
}

/** Step label for each flow step type */
function getStepLabel(type: NavigateFlowStep["type"]): string {
  switch (type) {
    case "listing":
      return "Listing Page";
    case "detail":
      return "Detail Page";
    case "apply":
      return "Apply Page";
  }
}

/** Placeholder text for each step */
function getStepPlaceholder(type: NavigateFlowStep["type"]): string {
  switch (type) {
    case "listing":
      return "Auto-captured when Navigate Mode starts";
    case "detail":
      return "Click a job link to record...";
    case "apply":
      return "Click apply link on detail page...";
  }
}

/** Instructions text based on active step */
function getInstructionsText(steps: NavigateFlowStep[]): string {
  const detailStep = steps.find((s) => s.type === "detail");
  const applyStep = steps.find((s) => s.type === "apply");

  if (!detailStep || detailStep.status !== "recorded") {
    return "Click a job link to record the listing \u2192 detail page flow";
  }

  if (!applyStep || applyStep.status !== "recorded") {
    return "Click an apply link on the detail page, or switch to Review mode";
  }

  return "Navigation flow recorded! Switch to Review mode or reset to re-record.";
}

/** A single flow step row */
function FlowStepRow({ step }: { step: NavigateFlowStep }) {
  const isOptional = step.type === "apply";

  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center">
        <StepStatusIcon status={step.status} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-foreground">
            {getStepLabel(step.type)}
          </span>
          {isOptional && (
            <span className="text-xs text-muted bg-border/50 px-1.5 py-0.5 rounded">
              optional
            </span>
          )}
        </div>

        {step.status === "recorded" && step.url ? (
          <div className="space-y-1">
            <div
              className="text-xs font-mono text-muted-foreground truncate"
              title={step.url}
            >
              {step.url}
            </div>
            {step.urlPattern && step.urlPattern !== step.url && (
              <div
                className="text-xs font-mono text-blue-400/80 truncate"
                title={step.urlPattern}
              >
                Pattern: {step.urlPattern}
              </div>
            )}
            {step.linkSelector && (
              <div
                className="text-xs font-mono text-muted truncate"
                title={step.linkSelector}
              >
                Selector: {step.linkSelector}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted">
            {getStepPlaceholder(step.type)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Vertical connector line between steps */
function StepConnector() {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center w-6">
        <div className="w-px h-4 bg-border" />
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-border">
          <path d="M4 0L4 6M2 4L4 6L6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="w-px h-4 bg-border" />
      </div>
      <div className="flex-1" />
    </div>
  );
}

// --- Mode Tabs (shared with Review) ---

interface ModeTabsProps {
  activeMode: ExtensionMode;
  onModeChange: (mode: ExtensionMode) => void;
}

export function ModeTabs({ activeMode, onModeChange }: ModeTabsProps) {
  return (
    <div className="flex gap-1 bg-background rounded-lg p-1">
      <button
        onClick={() => onModeChange("review")}
        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
          activeMode === "review"
            ? "text-foreground bg-card"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Review
      </button>
      <button
        onClick={() => onModeChange("navigate")}
        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
          activeMode === "navigate"
            ? "text-foreground bg-card"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Navigate
      </button>
      <button
        onClick={() => onModeChange("formRecord")}
        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
          activeMode === "formRecord"
            ? "text-foreground bg-card"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Form Record
      </button>
    </div>
  );
}

// --- Main Panel ---

interface NavigateFlowPanelProps {
  siteUrl: string;
  steps: NavigateFlowStep[];
  activeMode: ExtensionMode;
  onModeChange: (mode: ExtensionMode) => void;
  onReset: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onSaveConfig: () => void;
}

export default function NavigateFlowPanel({
  siteUrl,
  steps,
  activeMode,
  onModeChange,
  onReset,
  isSaving,
  saveError,
  saveSuccess,
  onSaveConfig,
}: NavigateFlowPanelProps) {
  const hasRecordedSteps = steps.some(
    (s) => s.type !== "listing" && s.status === "recorded"
  );

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

      {/* Mode Tabs */}
      <div className="mb-4">
        <ModeTabs activeMode={activeMode} onModeChange={onModeChange} />
      </div>

      {/* Divider */}
      <div className="h-px bg-border mb-3" />

      {/* Instructions Banner */}
      <div className="mb-4 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-md">
        <span className="text-xs text-blue-400">
          {getInstructionsText(steps)}
        </span>
      </div>

      {/* Navigation Flow Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-foreground">Navigation Flow</h2>
      </div>

      {/* Flow Steps */}
      <div className="space-y-0">
        {steps.map((step, index) => (
          <div key={step.type}>
            <FlowStepRow step={step} />
            {index < steps.length - 1 && <StepConnector />}
          </div>
        ))}
      </div>

      {/* Reset Navigation Button */}
      <div className="mt-6">
        <button
          onClick={onReset}
          disabled={!hasRecordedSteps}
          className="w-full px-3 py-2 text-xs font-medium border border-border text-foreground rounded-md hover:bg-border/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset Navigation
        </button>
      </div>

      {/* Save Config Button */}
      <div className="mt-4">
        <SaveConfigButton
          isSaving={isSaving}
          saveError={saveError}
          saveSuccess={saveSuccess}
          onSave={onSaveConfig}
        />
      </div>
    </div>
  );
}
