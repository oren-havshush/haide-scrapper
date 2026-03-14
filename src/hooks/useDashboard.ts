"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

export interface ScrapeHealth {
  successRate: number;
  successCount: number;
  failureCount: number;
  totalSites: number;
}

export interface DashboardOverviewData {
  scrapeHealth: ScrapeHealth;
  statusCounts: {
    ANALYZING: number;
    REVIEW: number;
    ACTIVE: number;
    FAILED: number;
    SKIPPED: number;
    total: number;
  };
  reviewQueueDepth: number;
  totalJobs: number;
}

export interface FailedSiteLatestRun {
  id: string;
  failureCategory: string | null;
  error: string | null;
  createdAt: string;
}

export interface FailedSiteData {
  id: string;
  siteUrl: string;
  status: string;
  failedAt: string | null;
  latestScrapeRun: FailedSiteLatestRun | null;
}

interface DashboardOverviewResponse {
  data: DashboardOverviewData;
}

interface FailedSitesResponse {
  data: FailedSiteData[];
  meta: { total: number; showing: number };
}

export function useDashboardOverview() {
  return useQuery<DashboardOverviewResponse>({
    queryKey: ["dashboard", "overview"],
    queryFn: () => apiFetch("/api/dashboard/overview"),
  });
}

export function useFailedSites() {
  return useQuery<FailedSitesResponse>({
    queryKey: ["dashboard", "failures"],
    queryFn: () => apiFetch("/api/dashboard/failures"),
  });
}
