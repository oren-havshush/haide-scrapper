"use client";

import { useMemo, useState } from "react";
import { SiteFilter } from "@/components/jobs/SiteFilter";
import { JobsSearchFilters } from "@/components/jobs/JobsSearchFilters";
import { JobsAgeFilter } from "@/components/jobs/JobsAgeFilter";
import { JobsTable } from "@/components/jobs/JobsTable";
import { ApplicationFields } from "@/components/jobs/ApplicationFields";
import { useJobs } from "@/hooks/useJobs";

interface JobSiteRef {
  site: { id: string };
}

interface AgeCounts {
  fresh?: number;
  d90?: number;
  d180?: number;
  d365?: number;
  none?: number;
  [key: string]: number | undefined;
}

const AGE_COUNTER_ITEMS = [
  { key: "d365", label: "365d+", className: "text-red-400 font-bold" },
  { key: "d180", label: "180d+", className: "text-orange-400 font-bold" },
  { key: "d90", label: "90d+", className: "text-amber-400 font-bold" },
  { key: "fresh", label: "Fresh", className: "text-emerald-400" },
  { key: "none", label: "No date", className: "text-[#71717a]" },
] as const;

const PAGE_SIZE_OPTIONS = [50, 100, 150] as const;

const DEFAULT_PAGE_SIZE = 50;

/**
 * Rows-per-page segmented control. All options stay visible — no dropdown —
 * and the choice is component state only, so a refresh returns to 50.
 */
function RowsPerPageControl({
  pageSize,
  onPageSizeChange,
}: {
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-3">
      <span className="text-[#a1a1aa] text-sm">Rows</span>
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5 shadow-inner shadow-black/40 backdrop-blur-md">
        {PAGE_SIZE_OPTIONS.map((size) => {
          const isActive = size === pageSize;
          return (
            <button
              key={size}
              type="button"
              aria-pressed={isActive}
              onClick={() => onPageSizeChange(size)}
              className={
                "rounded-md px-4 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
                (isActive
                  ? "bg-white/15 text-[#fafafa] ring-1 ring-white/15"
                  : "text-[#a1a1aa] hover:bg-white/5 hover:text-[#e4e4e7]")
              }
            >
              {size}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgeCounterBar({ ageCounts }: { ageCounts: AgeCounts }) {
  const hasAny = AGE_COUNTER_ITEMS.some((item) => (ageCounts[item.key] ?? 0) > 0);
  if (!hasAny) return null;
  return (
    <>
      <span className="text-[#71717a] text-xs uppercase tracking-wide mr-1">Age:</span>
      {AGE_COUNTER_ITEMS.map((item) => {
        const count = ageCounts[item.key] ?? 0;
        if (count === 0) return null;
        return (
          <span key={item.key} className={item.className}>
            {count.toLocaleString()} {item.label}
          </span>
        );
      })}
    </>
  );
}

export default function JobsPage() {
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [siteUrlSearch, setSiteUrlSearch] = useState("");
  const [companyNameSearch, setCompanyNameSearch] = useState("");
  const [ageBucket, setAgeBucket] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const { data, isLoading } = useJobs({
    page,
    pageSize,
    siteId,
    siteUrlSearch: siteUrlSearch || undefined,
    companyNameSearch: companyNameSearch || undefined,
    ageBucket: ageBucket || undefined,
  });

  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const ageCounts: AgeCounts = data?.meta?.ageCounts ?? {};

  const handleSiteChange = (newSiteId: string | undefined) => {
    setSiteId(newSiteId);
    setPage(1);
  };

  const handleSiteUrlSearchChange = (value: string) => {
    setSiteUrlSearch(value);
    setPage(1);
  };

  const handleCompanyNameSearchChange = (value: string) => {
    setCompanyNameSearch(value);
    setPage(1);
  };

  const handleAgeBucketChange = (value: string) => {
    setAgeBucket(value);
    setPage(1);
  };

  // A different page size changes what page 1 even means, so go back to it.
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  // When the dropdown is "All Sites" but the text filters narrow the result
  // to a single distinct site, surface the site-level application form panel
  // for that site. Dropdown selection always wins when set.
  const distinctSiteIds = useMemo(
    () =>
      Array.from(
        new Set(
          ((data?.data ?? []) as JobSiteRef[]).map((j) => j.site.id),
        ),
      ),
    [data],
  );
  const singleSiteFromText =
    distinctSiteIds.length === 1 ? distinctSiteIds[0] : undefined;
  const applicationFieldsSiteId = siteId ?? singleSiteFromText;
  const hasFilter = Boolean(siteId || siteUrlSearch || companyNameSearch || ageBucket);

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: "#fafafa" }}>
        Jobs
      </h2>
      <SiteFilter
        selectedSiteId={siteId}
        onSiteChange={handleSiteChange}
      />
      <JobsSearchFilters
        companyNameSearch={companyNameSearch}
        siteUrlSearch={siteUrlSearch}
        onCompanyNameSearchChange={handleCompanyNameSearchChange}
        onSiteUrlSearchChange={handleSiteUrlSearchChange}
      />
      <div className="mb-4">
        <JobsAgeFilter value={ageBucket} onChange={handleAgeBucketChange} />
      </div>
      {/* One bar: age counters on the left (still hidden when every count is
          zero), rows control pinned right and always visible. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-[#27272a] bg-[#09090b] px-4 py-2 text-sm">
        <AgeCounterBar ageCounts={ageCounts} />
        <RowsPerPageControl
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
      {applicationFieldsSiteId && (
        <ApplicationFields siteId={applicationFieldsSiteId} />
      )}
      <JobsTable
        jobs={data?.data ?? []}
        isLoading={isLoading}
        hasFilter={hasFilter}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
