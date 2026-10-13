"use client";

import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";

interface SiteSearchFiltersProps {
  companyNameSearch: string;
  urlSearch: string;
  onCompanyNameSearchChange: (value: string) => void;
  onUrlSearchChange: (value: string) => void;
  /** Held or paused sites only (?hold=1). */
  onHold?: boolean;
  onOnHoldChange?: (value: boolean) => void;
}

export function SiteSearchFilters({
  companyNameSearch,
  urlSearch,
  onCompanyNameSearchChange,
  onUrlSearchChange,
  onHold = false,
  onOnHoldChange,
}: SiteSearchFiltersProps) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <DebouncedSearchInput
        value={companyNameSearch}
        onChange={onCompanyNameSearchChange}
        placeholder="Filter by company name"
      />
      <DebouncedSearchInput
        value={urlSearch}
        onChange={onUrlSearchChange}
        placeholder="Filter by URL"
      />
      {onOnHoldChange && (
        <button
          type="button"
          onClick={() => onOnHoldChange(!onHold)}
          title="Sites held or paused out of the sweeps (a host's bot challenge)"
          className="justify-self-start inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors"
          style={{
            borderColor: onHold ? "#f59e0b" : "#27272a",
            color: onHold ? "#f59e0b" : "#a1a1aa",
            backgroundColor: onHold ? "rgba(245,158,11,0.1)" : "transparent",
          }}
        >
          On hold
        </button>
      )}
    </div>
  );
}
