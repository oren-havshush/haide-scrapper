"use client";

import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";

interface JobsSearchFiltersProps {
  companyNameSearch: string;
  siteUrlSearch: string;
  externalJobIdSearch: string;
  onCompanyNameSearchChange: (value: string) => void;
  onSiteUrlSearchChange: (value: string) => void;
  onExternalJobIdSearchChange: (value: string) => void;
}

export function JobsSearchFilters({
  companyNameSearch,
  siteUrlSearch,
  externalJobIdSearch,
  onCompanyNameSearchChange,
  onSiteUrlSearchChange,
  onExternalJobIdSearchChange,
}: JobsSearchFiltersProps) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      {/* Exact match on the Job ID column's value (Job.externalJobId). */}
      <DebouncedSearchInput
        value={externalJobIdSearch}
        onChange={onExternalJobIdSearchChange}
        placeholder="Filter by Job ID"
      />
    </div>
  );
}
