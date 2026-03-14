"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

interface UseJobsParams {
  page?: number;
  pageSize?: number;
  siteId?: string;
}

export function useJobs(params: UseJobsParams = {}) {
  const { page = 1, pageSize = 50, siteId } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("pageSize", String(pageSize));
  if (siteId) searchParams.set("siteId", siteId);

  return useQuery({
    queryKey: ["jobs", { page, pageSize, siteId }],
    queryFn: () => apiFetch(`/api/jobs?${searchParams.toString()}`),
  });
}
