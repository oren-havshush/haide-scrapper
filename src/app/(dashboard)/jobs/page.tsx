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

function AgeCounterBar({ ageCounts }: { ageCounts: AgeCounts }) {
  const hasAny = AGE_COUNTER_ITEMS.some((item) => (ageCounts[item.key] ?? 0) > 0);
  if (!hasAny) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-[#27272a] bg-[#09090b] px-4 py-2 text-sm">
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
    </div>
  );
}

export default function JobsPage() {
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [siteUrlSearch, setSiteUrlSearch] = useState("");
  const [companyNameSearch, setCompanyNameSearch] = useState("");
  const [ageBucket, setAgeBucket] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useJobs({
    page,
    siteId,
    siteUrlSearch: siteUrlSearch || undefined,
    companyNameSearch: companyNameSearch || undefined,
    ageBucket: ageBucket || undefined,
  });

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
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
      <AgeCounterBar ageCounts={ageCounts} />
      {applicationFieldsSiteId && (
        <ApplicationFields siteId={applicationFieldsSiteId} />
      )}
      <JobsTable
        jobs={data?.data ?? []}
        isLoading={isLoading}
        hasFilter={hasFilter}
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
