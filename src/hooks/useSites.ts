"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";
import type { CompanyEditPlan } from "@/lib/companyEdit";

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

/**
 * Record an operator-supplied company homepage for an ATS-hosted site.
 *
 * A HINT, not a capture: the endpoint deliberately leaves companyProfileAt
 * alone, so the site stays in the --all queue and company-profile.ts will start
 * from this URL instead of guessing.
 */
export function useUpdateSiteCompanyHomepage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      siteId,
      companyHomepageUrl,
    }: {
      siteId: string;
      companyHomepageUrl: string | null;
    }) =>
      apiFetch(`/api/sites/${siteId}/company-homepage`, {
        method: "PUT",
        body: JSON.stringify({ companyHomepageUrl }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

/**
 * Record an operator-authored HQ city for a company that publishes no address.
 *
 * Not a capture: companyProfileAt is left alone so the value stays correctable.
 * `evidence` says who authored it — the server composes the stored provenance
 * from it, which is what stops a later re-capture overwriting a human's answer
 * with the NULL it found.
 */
export function useUpdateSiteCompanyHqCity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      siteId,
      companyHqCity,
      evidence,
    }: {
      siteId: string;
      companyHqCity: string | null;
      evidence: { kind: "operator" | "operator:none" | "skill"; url?: string };
    }) =>
      apiFetch(`/api/sites/${siteId}/company-hq-city`, {
        method: "PUT",
        body: JSON.stringify({ companyHqCity, evidence }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

/**
 * The company edit form (o): one save, sent as requests to the existing routes,
 * in order — homepage, HQ city, profile, logo. Each request is a separate
 * write, so a failure stops the rest and reports which steps already landed.
 *
 * - homepage → PUT /company-homepage (stores the origin);
 * - city     → PUT /company-hq-city with evidence "operator" (city.csv gate);
 * - profile  → PUT /company-profile?force=1 with only the changed keys;
 * - logo     → POST /company-logo, raw bytes, x-logo-provenance: operator
 *              (32 px floor; magic bytes and the favicon refusal server-side).
 */
export function useEditSiteCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      siteId,
      plan,
      logo,
    }: {
      siteId: string;
      plan: CompanyEditPlan;
      logo: File | null;
    }) => {
      const done: string[] = [];
      try {
        if (plan.homepage !== undefined) {
          await apiFetch(`/api/sites/${siteId}/company-homepage`, {
            method: "PUT",
            body: JSON.stringify({ companyHomepageUrl: plan.homepage }),
          });
          done.push("homepage");
        }
        if (plan.city !== undefined) {
          await apiFetch(`/api/sites/${siteId}/company-hq-city`, {
            method: "PUT",
            body: JSON.stringify({ companyHqCity: plan.city, evidence: { kind: "operator" } }),
          });
          done.push("city");
        }
        if (Object.keys(plan.profile).length > 0) {
          await apiFetch(`/api/sites/${siteId}/company-profile?force=1`, {
            method: "PUT",
            body: JSON.stringify(plan.profile),
          });
          done.push(Object.keys(plan.profile).map((k) => (k === "companyAbout" ? "about" : "address")).join(" and "));
        }
        if (logo) {
          await apiFetch(`/api/sites/${siteId}/company-logo`, {
            method: "POST",
            headers: {
              "Content-Type": logo.type || "application/octet-stream",
              "x-logo-provenance": "operator",
            },
            body: logo,
          });
          done.push("logo");
        }
      } catch (err) {
        const saved = done.length ? ` (already saved: ${done.join(", ")})` : "";
        throw new Error(`${(err as Error).message}${saved}`);
      }
      return done;
    },
    onSettled: () => {
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

/**
 * A site's manual location overrides, paired with the jobs they apply to.
 *
 * Read on demand — `enabled` keeps it from firing for every row in the table;
 * only the site whose dialog is open is fetched. Not cached long: an override
 * set through the jobs page has to show up here without a reload.
 */
export function useSiteLocationOverrides(siteId: string | null) {
  return useQuery({
    queryKey: ["site-location-overrides", siteId],
    queryFn: () => apiFetch(`/api/sites/${siteId}/location-overrides`),
    enabled: !!siteId,
    staleTime: 0,
  });
}
