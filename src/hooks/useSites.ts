"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

interface UseSitesParams {
  page?: number;
  pageSize?: number;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function useSites(params: UseSitesParams = {}) {
  const { page = 1, pageSize = 50, status, sortBy = "createdAt", sortOrder = "desc" } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("pageSize", String(pageSize));
  if (status) searchParams.set("status", status);
  if (sortBy) searchParams.set("sortBy", sortBy);
  if (sortOrder) searchParams.set("sortOrder", sortOrder);

  return useQuery({
    queryKey: ["sites", { page, pageSize, status, sortBy, sortOrder }],
    queryFn: () => apiFetch(`/api/sites?${searchParams.toString()}`),
  });
}

export function useSiteStatusCounts() {
  return useQuery({
    queryKey: ["sites", "counts"],
    queryFn: () => apiFetch("/api/sites/counts"),
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteUrl: string) =>
      apiFetch("/api/sites", {
        method: "POST",
        body: JSON.stringify({ siteUrl }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useUpdateSiteStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, status }: { siteId: string; status: string }) =>
      apiFetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteId: string) =>
      apiFetch(`/api/sites/${siteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}
