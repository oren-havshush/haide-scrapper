import type { FormCapture, ExtensionMode } from "../../lib/types";
import { ModeTabs } from "./NavigateFlowPanel";
import SaveConfigButton from "./SaveConfigButton";

function MethodBadge({ method }: { method: string }) {
  const color = method === "POST" ? "text-amber-400 bg-amber-500/10 border-amber-500/30" : "text-blue-400 bg-blue-500/10 border-blue-500/30";
  return (
    <span className={`text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded border ${color}`}>
      {method}
    </span>
  );
}

function FormFieldRow({ field }: { field: FormCapture["fields"][number] }) {
  return (
    <tr className="border-b border-[#1a1a1a] last:border-0">
      <td className="py-1.5 pr-2 text-xs font-mono text-foreground">{field.name || <span className="text-muted">—</span>}</td>
      <td className="py-1.5 pr-2 text-xs text-muted-foreground truncate max-w-[120px]" title={field.label}>{field.label}</td>
      <td className="py-1.5 pr-2 text-[10px] text-muted uppercase">{field.fieldType}</td>
      <td className="py-1.5 text-center">
        {field.required && (
          <span className="text-[10px] text-amber-400">req</span>
        )}
      </td>
    </tr>
  );
}

interface FormRecordPanelProps {
  siteUrl: string;
  capturedForm: FormCapture | null;
  activeMode: ExtensionMode;
  onModeChange: (mode: ExtensionMode) => void;
  onClear: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onSaveConfig: () => void;
}

export default function FormRecordPanel({
  siteUrl,
  capturedForm,
  activeMode,
  onModeChange,
  onClear,
  isSaving,
  saveError,
  saveSuccess,
  onSaveConfig,
}: FormRecordPanelProps) {
  return (
    <div className="min-h-screen bg-card text-foreground font-sans p-4 flex flex-col">
      <div className="mb-4">
        <h1 className="text-sm font-bold text-foreground mb-1">scrapnew</h1>
        <div className="h-px bg-border" />
      </div>

      <div className="mb-3">
        <div className="text-xs text-muted-foreground mb-1">Site URL</div>
        <div className="text-xs text-foreground font-mono break-all truncate" title={siteUrl}>
          {siteUrl}
        </div>
      </div>

      <div className="mb-4">
        <ModeTabs activeMode={activeMode} onModeChange={onModeChange} />
      </div>

      <div className="h-px bg-border mb-3" />

      <div className="mb-4 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-md">
        <span className="text-xs text-blue-400">
          {capturedForm
            ? "Form captured! Review the fields below or clear to re-capture."
            : "Click any field in the application form to capture the entire form automatically."}
        </span>
      </div>

      {capturedForm ? (
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground">Application Form</h2>
            <button
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-error transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <MethodBadge method={capturedForm.method} />
              <span
                className="text-xs font-mono text-muted-foreground truncate"
                title={capturedForm.actionUrl}
              >
                {capturedForm.actionUrl}
              </span>
            </div>
            <div className="text-[10px] text-muted font-mono truncate" title={capturedForm.formSelector}>
              {capturedForm.formSelector}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              {capturedForm.fields.length} field{capturedForm.fields.length !== 1 ? "s" : ""}
            </div>
            <div className="rounded-md border border-[#27272a] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#18181b] text-[10px] text-muted uppercase">
                    <th className="py-1 px-2 text-left font-medium">Name</th>
                    <th className="py-1 px-2 text-left font-medium">Label</th>
                    <th className="py-1 px-2 text-left font-medium">Type</th>
                    <th className="py-1 px-2 text-center font-medium w-8">Req</th>
                  </tr>
                </thead>
                <tbody>
                  {capturedForm.fields.map((f, i) => (
                    <FormFieldRow key={`${f.name}-${i}`} field={f} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-xs text-muted-foreground text-center py-8">
            No form captured yet.<br />Click on any input in the application form.
          </div>
        </div>
      )}

      <div className="mt-auto pt-4">
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
