"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

interface UseJobsParams {
  page?: number;
  pageSize?: number;
  siteId?: string;
  siteUrlSearch?: string;
  companyNameSearch?: string;
  ageBucket?: string;
}

export function useJobs(params: UseJobsParams = {}) {
  const {
    page = 1,
    pageSize = 50,
    siteId,
    siteUrlSearch,
    companyNameSearch,
    ageBucket,
  } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("pageSize", String(pageSize));
  if (siteId) searchParams.set("siteId", siteId);
  if (siteUrlSearch) searchParams.set("siteUrlSearch", siteUrlSearch);
  if (companyNameSearch) searchParams.set("companyNameSearch", companyNameSearch);
  if (ageBucket) searchParams.set("ageBucket", ageBucket);

  return useQuery({
    queryKey: [
      "jobs",
      { page, pageSize, siteId, siteUrlSearch, companyNameSearch, ageBucket },
    ],
    queryFn: () => apiFetch(`/api/jobs?${searchParams.toString()}`),
  });
}
