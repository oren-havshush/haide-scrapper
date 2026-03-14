"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { DashboardOverviewData } from "@/hooks/useDashboard";

type SiteStatusValue = "ANALYZING" | "REVIEW" | "ACTIVE" | "FAILED" | "SKIPPED";

const STATUS_ORDER: SiteStatusValue[] = ["ACTIVE", "ANALYZING", "REVIEW", "FAILED", "SKIPPED"];

interface StatusPanelsProps {
  data: DashboardOverviewData | undefined;
  isLoading: boolean;
}

function getHealthColor(rate: number): string {
  if (rate >= 90) return "#22c55e";
  if (rate >= 70) return "#f59e0b";
  return "#ef4444";
}

export function StatusPanels({ data, isLoading }: StatusPanelsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Scrape Health Panel */}
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Scrape Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : data?.scrapeHealth.totalSites === 0 ? (
            <p className="text-sm" style={{ color: "#a1a1aa" }}>No data yet</p>
          ) : (
            <>
              <p
                className="text-3xl font-bold"
                style={{ color: getHealthColor(data?.scrapeHealth.successRate ?? 0) }}
              >
                {data?.scrapeHealth.successRate ?? 0}%
              </p>
              <p className="text-sm mt-1" style={{ color: "#a1a1aa" }}>
                {data?.scrapeHealth.successCount ?? 0} succeeded / {data?.scrapeHealth.failureCount ?? 0} failed
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sites by Status Panel */}
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Sites by Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {STATUS_ORDER.map((status) => (
                <div key={status} className="flex items-center justify-between">
                  <StatusBadge status={status} />
                  <span className="text-sm font-medium" style={{ color: "#fafafa" }}>
                    {data?.statusCounts[status] ?? 0}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1.5 border-t border-zinc-700">
                <span className="text-sm" style={{ color: "#a1a1aa" }}>Total</span>
                <span className="text-sm font-semibold" style={{ color: "#fafafa" }}>
                  {data?.statusCounts.total ?? 0}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Queue Depth Panel */}
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Review Queue Depth
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-4 w-36" />
            </div>
          ) : (
            <>
              <p
                className="text-3xl font-bold"
                style={{ color: (data?.reviewQueueDepth ?? 0) > 0 ? "#f59e0b" : "#a1a1aa" }}
              >
                {data?.reviewQueueDepth ?? 0}
              </p>
              <p className="text-sm mt-1" style={{ color: "#a1a1aa" }}>
                sites awaiting review
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Total Jobs Panel */}
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Total Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold" style={{ color: "#fafafa" }}>
                {(data?.totalJobs ?? 0).toLocaleString()}
              </p>
              <p className="text-sm mt-1" style={{ color: "#a1a1aa" }}>
                job records scraped
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
