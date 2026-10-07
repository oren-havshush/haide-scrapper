"use client";

import { useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  companyEditPlan,
  hqCityOptions,
  isOfferedHqCity,
  type CompanyEditDraft,
  type DraftField,
} from "@/lib/companyEdit";
import type { CompanyProfileFields } from "@/components/sites/SiteCompanyProfileDialog";

/**
 * Correct a site's company details by hand (o), owner 2026-10-06.
 *
 * A form over the existing routes and nothing more (useEditSiteCompany): the
 * routes keep every gate — the city.csv check, magic bytes, the logo floor,
 * the fix-queue items an ACTIVE site's company write opens. companyEditPlan()
 * decides what is sent: only fields the operator changed, and a null only from
 * a field's Clear control, never from an emptied box (on these routes a null
 * CLEARS the column).
 *
 * The city is picked from city.csv. The box offers the list, and Save refuses
 * anything that is not exactly an entry; the route's exact gate refuses it
 * again behind this.
 */

const MAX_ABOUT = 4_000;
const MAX_ADDRESS = 300;
const MAX_HOMEPAGE = 500;
const CITY_LIST_ID = "company-edit-city-options";

const fieldClass = cn(
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm",
  "transition-colors outline-none placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  "dark:bg-input/30",
);

function draftFrom(site: CompanyProfileFields): CompanyEditDraft {
  return {
    homepage: { value: site.companyHomepageUrl ?? "", clear: false },
    about: { value: site.companyAbout ?? "", clear: false },
    address: { value: site.companyHqAddress ?? "", clear: false },
    city: { value: site.companyHqCity ?? "", clear: false },
  };
}

function Row({
  label,
  field,
  hasValue,
  disabled,
  onClear,
  children,
}: {
  label: string;
  field: DraftField;
  hasValue: boolean;
  disabled: boolean;
  onClear: (clear: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "#a1a1aa" }}>
          {label}
        </span>
        {hasValue ? (
          <label className="flex items-center gap-1.5 text-xs" style={{ color: "#a1a1aa" }}>
            <input
              type="checkbox"
              checked={field.clear}
              disabled={disabled}
              onChange={(e) => onClear(e.target.checked)}
            />
            Clear the stored value
          </label>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SiteCompanyEditDialog({
  open,
  onOpenChange,
  site,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: CompanyProfileFields | null;
  isSaving: boolean;
  onSave: (plan: ReturnType<typeof companyEditPlan>, logo: File | null) => void;
}) {
  const cities = useMemo(() => hqCityOptions(), []);
  const [draft, setDraft] = useState<CompanyEditDraft | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-initialise when the dialog opens for a site (the "adjust state during
  // render" pattern SiteNoteDialog uses, not an effect).
  const [lastKey, setLastKey] = useState<string | null>(null);
  const currentKey = open && site ? site.siteUrl : null;
  if (currentKey !== lastKey) {
    setLastKey(currentKey);
    setDraft(open && site ? draftFrom(site) : null);
    setLogo(null);
    setError(null);
  }

  if (!site || !draft) return null;

  const set = (key: keyof CompanyEditDraft, patch: Partial<DraftField>) => {
    setDraft({ ...draft, [key]: { ...draft[key], ...patch } });
    setError(null);
  };

  const plan = companyEditPlan(site, draft);
  const nothingToSave =
    plan.homepage === undefined &&
    plan.city === undefined &&
    Object.keys(plan.profile).length === 0 &&
    logo === null;
  const touchesProfile = Object.keys(plan.profile).length > 0;

  const save = () => {
    if (typeof plan.city === "string" && !isOfferedHqCity(plan.city)) {
      setError(
        `"${plan.city}" is not an entry in CSV files/city.csv. Pick the city from the list.`,
      );
      return;
    }
    onSave(plan, logo);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Edit company details</DialogTitle>
          <DialogDescription className="break-all">
            {site.companyName ? `${site.companyName} · ` : ""}
            {site.siteUrl}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <Row
            label="Homepage"
            field={draft.homepage}
            hasValue={site.companyHomepageUrl != null}
            disabled={isSaving}
            onClear={(clear) => set("homepage", { clear })}
          >
            <Input
              type="url"
              dir="ltr"
              value={draft.homepage.value}
              maxLength={MAX_HOMEPAGE}
              placeholder="https://www.example.co.il"
              disabled={isSaving || draft.homepage.clear}
              onChange={(e) => set("homepage", { value: e.target.value })}
            />
          </Row>

          <Row
            label="HQ city (from city.csv)"
            field={draft.city}
            hasValue={site.companyHqCity != null}
            disabled={isSaving}
            onClear={(clear) => set("city", { clear })}
          >
            <Input
              dir="rtl"
              list={CITY_LIST_ID}
              value={draft.city.value}
              placeholder="הקלידו לחיפוש ובחרו מהרשימה"
              disabled={isSaving || draft.city.clear}
              onChange={(e) => set("city", { value: e.target.value })}
            />
            <datalist id={CITY_LIST_ID}>
              {cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Row>

          <Row
            label="HQ address"
            field={draft.address}
            hasValue={site.companyHqAddress != null}
            disabled={isSaving}
            onClear={(clear) => set("address", { clear })}
          >
            <Input
              dir="rtl"
              value={draft.address.value}
              maxLength={MAX_ADDRESS}
              disabled={isSaving || draft.address.clear}
              onChange={(e) => set("address", { value: e.target.value })}
            />
          </Row>

          <Row
            label="About"
            field={draft.about}
            hasValue={site.companyAbout != null}
            disabled={isSaving}
            onClear={(clear) => set("about", { clear })}
          >
            <textarea
              dir="rtl"
              rows={7}
              value={draft.about.value}
              maxLength={MAX_ABOUT}
              disabled={isSaving || draft.about.clear}
              onChange={(e) => set("about", { value: e.target.value })}
              className={cn(fieldClass, "resize-y leading-relaxed")}
            />
            <div className="text-right text-xs text-muted-foreground">
              {draft.about.value.length} / {MAX_ABOUT}
            </div>
          </Row>

          <div className="space-y-1">
            <span className="text-xs" style={{ color: "#a1a1aa" }}>
              Logo (replaces the stored file)
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={isSaving}
              onChange={(e) => {
                setLogo(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="block w-full text-xs"
              style={{ color: "#a1a1aa" }}
            />
            <p className="text-xs text-muted-foreground">
              PNG, JPEG or WebP. Checked on the server by its bytes, at least 32 px on each side.
            </p>
          </div>

          {touchesProfile && site.companyProfileAt == null ? (
            <p className="text-xs" style={{ color: "#fbbf24" }}>
              This site has no captured profile yet. Saving the about text or the address marks it
              captured, so the automatic capture will skip it.
            </p>
          ) : null}

          {error ? (
            <p className="text-sm" style={{ color: "#f87171" }}>
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving || nothingToSave}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
