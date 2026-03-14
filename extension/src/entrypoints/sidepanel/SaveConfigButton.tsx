// --- Save Config Button ---

interface SaveConfigButtonProps {
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onSave: () => void;
}

export default function SaveConfigButton({
  isSaving,
  saveError,
  saveSuccess,
  onSave,
}: SaveConfigButtonProps) {
  return (
    <div className="space-y-2">
      {/* Success banner */}
      {saveSuccess && (
        <div className="px-3 py-2 bg-success/10 border border-success/30 rounded-md">
          <span className="text-xs text-success font-medium">
            Config saved. Running test extraction...
          </span>
        </div>
      )}

      {/* Error banner */}
      {saveError && (
        <div className="px-3 py-2 bg-error/10 border border-error/30 rounded-md">
          <span className="text-xs text-error">
            {saveError}
          </span>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={onSave}
        disabled={isSaving}
        className="w-full px-3 py-2.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isSaving ? (
          <>
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </>
        ) : (
          "Save & Test Extract"
        )}
      </button>
    </div>
  );
}
