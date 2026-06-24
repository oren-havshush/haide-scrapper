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
  policyStatus?: string;
  companyNameSearch?: string;
  urlSearch?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function useSites(params: UseSitesParams = {}) {
  const {
    page = 1,
    pageSize = 50,
    status,
    policyStatus,
    companyNameSearch,
    urlSearch,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("pageSize", String(pageSize));
  if (status) searchParams.set("status", status);
  if (policyStatus) searchParams.set("policyStatus", policyStatus);
  if (companyNameSearch) searchParams.set("companyNameSearch", companyNameSearch);
  if (urlSearch) searchParams.set("urlSearch", urlSearch);
  if (sortBy) searchParams.set("sortBy", sortBy);
  if (sortOrder) searchParams.set("sortOrder", sortOrder);

  return useQuery({
    queryKey: ["sites", { page, pageSize, status, policyStatus, companyNameSearch, urlSearch, sortBy, sortOrder }],
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

export function useUpdateSiteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, adminNote }: { siteId: string; adminNote: string | null }) =>
      apiFetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify({ adminNote }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useUpdateSiteCompanyName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, companyName }: { siteId: string; companyName: string | null }) =>
      apiFetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify({ companyName }),
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

export function usePolicyStatusCounts() {
  return useQuery({
    queryKey: ["sites", "policy-counts"],
    queryFn: () => apiFetch("/api/sites/policy-counts"),
  });
}

export function useTriggerPolicyReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteId: string) =>
      apiFetch(`/api/sites/${siteId}/policy-review`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["sites", "policy-counts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useScanPolicyUrl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url: string) =>
      apiFetch("/api/policy-review/scan", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["sites", "policy-counts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
