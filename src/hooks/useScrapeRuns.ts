"use client";

import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

export interface ScrapeRunData {
  id: string;
  siteId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  jobCount: number;
  createdAt: string;
  completedAt: string | null;
}

export function useTriggerScrape() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, maxJobs }: { siteId: string; maxJobs?: number }) =>
      apiFetch(`/api/sites/${siteId}/scrape`, {
        method: "POST",
        ...(maxJobs ? { body: JSON.stringify({ maxJobs }) } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useClearJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteId: string) =>
      apiFetch(`/api/sites/${siteId}/jobs`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
