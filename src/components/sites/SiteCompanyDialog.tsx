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
import { Input } from "@/components/ui/input";

interface SiteCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string;
  initialName: string | null;
  onSave: (name: string | null) => void;
  isSaving: boolean;
}

const MAX_NAME_LENGTH = 120;

export function SiteCompanyDialog({
  open,
  onOpenChange,
  siteUrl,
  initialName,
  onSave,
  isSaving,
}: SiteCompanyDialogProps) {
  // Same "adjust state during render" reset pattern used in SiteNoteDialog —
  // see the React docs https://react.dev/reference/react/useState#storing-information-from-previous-renders
  // and the comment in SiteNoteDialog.tsx for the rationale.
  const [value, setValue] = useState(initialName ?? "");
  const [lastKey, setLastKey] = useState<string | null>(null);
  const currentKey = open ? `${siteUrl}\u0000${initialName ?? ""}` : null;
  if (currentKey !== lastKey) {
    setLastKey(currentKey);
    if (open) setValue(initialName ?? "");
  }

  const trimmed = value.trim();
  const normalized = trimmed.length > 0 ? trimmed : null;
  const isUnchanged = normalized === (initialName ?? null);

  const handleSave = () => {
    if (isSaving || isUnchanged) return;
    onSave(normalized);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Company name</DialogTitle>
          <DialogDescription className="break-all">{siteUrl}</DialogDescription>
        </DialogHeader>
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_NAME_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="e.g. Bezeq"
          maxLength={MAX_NAME_LENGTH}
          autoFocus
          disabled={isSaving}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{normalized ? `${value.length} / ${MAX_NAME_LENGTH}` : "Empty saves clear the name"}</span>
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
            onClick={handleSave}
            disabled={isSaving || isUnchanged}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
