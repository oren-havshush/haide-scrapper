"use client";

import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";

interface JobsSearchFiltersProps {
  companyNameSearch: string;
  siteUrlSearch: string;
  onCompanyNameSearchChange: (value: string) => void;
  onSiteUrlSearchChange: (value: string) => void;
}

export function JobsSearchFilters({
  companyNameSearch,
  siteUrlSearch,
  onCompanyNameSearchChange,
  onSiteUrlSearchChange,
}: JobsSearchFiltersProps) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <DebouncedSearchInput
        value={companyNameSearch}
        onChange={onCompanyNameSearchChange}
        placeholder="Filter by company name"
      />
      <DebouncedSearchInput
        value={siteUrlSearch}
        onChange={onSiteUrlSearchChange}
        placeholder="Filter by URL"
      />
    </div>
  );
}
