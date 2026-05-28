"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SiteNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string;
  initialNote: string | null;
  onSave: (note: string | null) => void;
  isSaving: boolean;
}

const MAX_NOTE_LENGTH = 2_000;

export function SiteNoteDialog({
  open,
  onOpenChange,
  siteUrl,
  initialNote,
  onSave,
  isSaving,
}: SiteNoteDialogProps) {
  // Reset the textarea when the dialog reopens for a different site by tracking
  // the prop combination we last initialized from. This is the React-recommended
  // "adjust state during render" pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders);
  // it replaces a `useEffect(() => setValue(...))` that the lint rule
  // `react-hooks/set-state-in-effect` (rightly) flags as an anti-pattern.
  const [value, setValue] = useState(initialNote ?? "");
  const [lastKey, setLastKey] = useState<string | null>(null);
  const currentKey = open ? `${siteUrl}\u0000${initialNote ?? ""}` : null;
  if (currentKey !== lastKey) {
    setLastKey(currentKey);
    if (open) setValue(initialNote ?? "");
  }

  const trimmed = value.trim();
  const normalized = trimmed.length > 0 ? trimmed : null;
  const isUnchanged = normalized === (initialNote ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Admin note</DialogTitle>
          <DialogDescription className="break-all">{siteUrl}</DialogDescription>
        </DialogHeader>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_NOTE_LENGTH))}
          placeholder="Why is this site failed / skipped? What needs to be fixed?"
          rows={6}
          autoFocus
          className={cn(
            "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm",
            "transition-colors outline-none placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            "dark:bg-input/30 resize-y",
          )}
          disabled={isSaving}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{normalized ? `${value.length} / ${MAX_NOTE_LENGTH}` : "Empty saves clear the note"}</span>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(normalized)}
            disabled={isSaving || isUnchanged}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
