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
import { useSites } from "@/hooks/useSites";
import { FIX_FIELDS } from "@/lib/fixFields";
import { cn } from "@/lib/utils";

interface LogFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (body: { siteId: string; field: string; minutes?: number; note?: string; resolved?: boolean }) => void;
  isSaving: boolean;
  error?: string | null;
}

const MAX_NOTE_LENGTH = 2_000;

const fieldClass = cn(
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm",
  "transition-colors outline-none placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
);

/**
 * Log a post-ACTIVE fix (addsite2 phase two, step 1a): site, field, minutes,
 * note. Opens a MANUAL item; "already resolved" logs a fix that is done.
 */
export function LogFixDialog({ open, onOpenChange, onSave, isSaving, error }: LogFixDialogProps) {
  const [search, setSearch] = useState("");
  const [siteId, setSiteId] = useState("");
  const [field, setField] = useState<string>("APPLY");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [resolved, setResolved] = useState(false);

  const { data: sites } = useSites({ pageSize: 100, urlSearch: search.trim() || undefined });
  const siteRows: Array<{ id: string; siteUrl: string; status: string }> = sites?.data ?? [];

  const minutesNum = minutes.trim() === "" ? undefined : Number(minutes);
  const minutesOk = minutesNum === undefined || (Number.isInteger(minutesNum) && minutesNum >= 0 && minutesNum <= 1440);
  const canSave = siteId !== "" && minutesOk && !isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Log fix</DialogTitle>
          <DialogDescription>A fix a site needed after it went ACTIVE.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Site
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by URL"
              disabled={isSaving}
            />
            <select
              className={fieldClass}
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={isSaving}
              size={6}
            >
              {/* Without an empty option the browser shows the first site as
                  selected while siteId is still "", and clicking it fires no change. */}
              <option value="" disabled>
                {siteRows.length === 0 ? "No site matches" : "Choose a site"}
              </option>
              {siteRows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteUrl} ({s.status})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Field
            <select className={fieldClass} value={field} onChange={(e) => setField(e.target.value)} disabled={isSaving}>
              {FIX_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Minutes
            <Input
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 12"
              disabled={isSaving}
            />
            {!minutesOk && <span className="text-xs text-red-400">Whole minutes, 0 to 1440</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              rows={3}
              className={cn(fieldClass, "resize-y")}
              disabled={isSaving}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} disabled={isSaving} />
            Already resolved
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() =>
              onSave({
                siteId,
                field,
                ...(minutesNum !== undefined ? { minutes: minutesNum } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
                ...(resolved ? { resolved: true } : {}),
              })
            }
          >
            {isSaving ? "Saving..." : "Log fix"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
