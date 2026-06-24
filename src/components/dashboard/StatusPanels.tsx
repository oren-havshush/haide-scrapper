"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PolicyStatusBadge } from "@/components/shared/PolicyStatusBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { DashboardOverviewData } from "@/hooks/useDashboard";
import { useScanPolicyUrl } from "@/hooks/useSites";

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

      {/* Jobs by Status Panel */}
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Jobs by Status
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
                    {(data?.jobCountsByStatus[status] ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1.5 border-t border-zinc-700">
                <span className="text-sm" style={{ color: "#a1a1aa" }}>Total</span>
                <span className="text-sm font-semibold" style={{ color: "#fafafa" }}>
                  {(data?.totalJobs ?? 0).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Policy Review Coverage Panel */}
      <Card style={{ backgroundColor: "#18181b" }} className="col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Policy Review Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                {[
                  { label: "Total sites", value: data?.policyCoverage.total ?? 0, color: "#fafafa" },
                  { label: "Checked", value: data?.policyCoverage.checked ?? 0, color: "#22c55e" },
                  { label: "Not checked yet", value: data?.policyCoverage.unchecked ?? 0, color: "#6b7280" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "#a1a1aa" }}>{label}</span>
                    <span className="text-sm font-medium" style={{ color }}>{value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 border-t border-zinc-700 gap-2">
                  <PolicyStatusBadge status="RESTRICTED" />
                  <span className="text-sm font-medium" style={{ color: "#ef4444" }}>
                    {data?.policyCoverage.restricted ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <PolicyStatusBadge status="REQUIRES_WRITTEN_PERMISSION" />
                  <span className="text-sm font-medium" style={{ color: "#f97316" }}>
                    {data?.policyCoverage.requiresWrittenPermission ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <PolicyStatusBadge status="UNCLEAR_NEEDS_REVIEW" />
                  <span className="text-sm font-medium" style={{ color: "#f59e0b" }}>
                    {data?.policyCoverage.unclearNeedsReview ?? 0}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs mb-2" style={{ color: "#a1a1aa" }}>Check a URL</p>
                <CheckUrlInput />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CheckUrlInput() {
  const [url, setUrl] = useState("");
  const scan = useScanPolicyUrl();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    scan.mutate(trimmed, {
      onSuccess: () => {
        toast.success("Policy review queued");
        setUrl("");
      },
      onError: (err: Error) => toast.error(err.message),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/careers"
        className="flex-1 rounded-md border px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
        style={{ backgroundColor: "#0a0a0b", borderColor: "#27272a", color: "#fafafa" }}
        disabled={scan.isPending}
      />
      <Button type="submit" size="sm" className="h-7 text-xs px-3" disabled={scan.isPending || !url.trim()}>
        {scan.isPending ? "..." : "Check"}
      </Button>
    </form>
  );
}
