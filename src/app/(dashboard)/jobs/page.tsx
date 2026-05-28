"use client";

import { useMemo, useState } from "react";
import { SiteFilter } from "@/components/jobs/SiteFilter";
import { JobsSearchFilters } from "@/components/jobs/JobsSearchFilters";
import { JobsTable } from "@/components/jobs/JobsTable";
import { ApplicationFields } from "@/components/jobs/ApplicationFields";
import { useJobs } from "@/hooks/useJobs";

interface JobSiteRef {
  site: { id: string };
}

export default function JobsPage() {
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [siteUrlSearch, setSiteUrlSearch] = useState("");
  const [companyNameSearch, setCompanyNameSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useJobs({
    page,
    siteId,
    siteUrlSearch: siteUrlSearch || undefined,
    companyNameSearch: companyNameSearch || undefined,
  });

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

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
  const hasFilter = Boolean(siteId || siteUrlSearch || companyNameSearch);

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
