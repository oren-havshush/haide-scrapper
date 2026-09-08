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

/**
 * Supply the HQ city for a company that publishes no address.
 *
 * Why a human has to do this: the capture derives the city only from a real
 * address, and plenty of companies never publish one. clalitsmile lists its
 * branch clinics and no head office; imj.org.il answers headless Chromium with
 * a bot challenge and an empty DOM. The capture is right to store nothing —
 * scanning loose page text for city names was tried and removed because Hebrew
 * city names hide inside ordinary words.
 *
 * TWO OUTCOMES, deliberately distinct. "Save" records a city. "No published HQ
 * city" records that a human looked and there is none — without which a site
 * that legitimately has no city is indistinguishable from one nobody has
 * checked, and the warning on this row never goes away.
 *
 * Saving here does NOT capture anything: companyProfileAt is untouched, so the
 * value stays correctable and the site keeps its place in the queue.
 */

const MAX_CITY_LENGTH = 150;

export function SiteHqCityDialog({
  open,
  onOpenChange,
  siteUrl,
  companyName,
  initialCity,
  initialSource,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string;
  companyName: string | null;
  initialCity: string | null;
  initialSource: string | null;
  onSave: (city: string | null, kind: "operator" | "operator:none") => void;
  isSaving: boolean;
}) {
  // Same "adjust state during render" reset pattern as SiteHomepageDialog.
  const [value, setValue] = useState(initialCity ?? "");
  const [lastKey, setLastKey] = useState<string | null>(null);
  const currentKey = open ? `${siteUrl} ${initialCity ?? ""}` : null;
  if (currentKey !== lastKey) {
    setLastKey(currentKey);
    if (open) setValue(initialCity ?? "");
  }

  const trimmed = value.trim();
  const normalized = trimmed.length > 0 ? trimmed : null;
  const isUnchanged = normalized === (initialCity ?? null);
  const alreadyMarkedNone = initialSource === "operator:none";

  const handleSave = () => {
    if (isSaving || isUnchanged) return;
    onSave(normalized, "operator");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>HQ city{companyName ? ` — ${companyName}` : ""}</DialogTitle>
          <DialogDescription className="break-all">
            The capture found no address to take a city from on {siteUrl}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_CITY_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="תל אביב"
          maxLength={MAX_CITY_LENGTH}
          autoFocus
          disabled={isSaving}
        />

        <p className="text-xs" style={{ color: "#71717a" }}>
          {/* The server canonicalises and gates, so "תל אביב" is stored as the
              city.csv spelling "תל אביב-יפו" — which is what keeps hand-typed
              and scraped values in one bucket in the city filter. */}
          Must be a city in <code>CSV files/city.csv</code>; common spellings are accepted and
          stored in their canonical form. A region such as{" "}
          <span dir="rtl">אזור מרכז</span> is refused — a company is at an address.
        </p>

        <DialogFooter className="sm:justify-between">
          {/* Left, and visually quieter: this is the honest answer for a real
              minority of companies, not the primary action. */}
          <Button
            variant="outline"
            onClick={() => onSave(null, "operator:none")}
            disabled={isSaving || alreadyMarkedNone}
            title="Record that this company publishes no HQ city, so it stops being flagged"
          >
            {alreadyMarkedNone ? "Marked as none" : "No published HQ city"}
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isUnchanged}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
