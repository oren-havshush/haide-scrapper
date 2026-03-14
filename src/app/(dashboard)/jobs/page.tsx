"use client";

import { useState } from "react";
import { SiteFilter } from "@/components/jobs/SiteFilter";
import { JobsTable } from "@/components/jobs/JobsTable";
import { ApplicationFields } from "@/components/jobs/ApplicationFields";
import { useJobs } from "@/hooks/useJobs";

export default function JobsPage() {
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useJobs({ page, siteId });

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const handleSiteChange = (newSiteId: string | undefined) => {
    setSiteId(newSiteId);
    setPage(1); // Reset to first page on filter change
  };

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: "#fafafa" }}>
        Jobs
      </h2>
      <SiteFilter
        selectedSiteId={siteId}
        onSiteChange={handleSiteChange}
      />
      {siteId && <ApplicationFields siteId={siteId} />}
      <JobsTable
        jobs={data?.data ?? []}
        isLoading={isLoading}
        hasFilter={siteId !== undefined}
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
