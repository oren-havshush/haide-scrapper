"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useTriggerScrape } from "@/hooks/useScrapeRuns";
import type { FailedSiteData } from "@/hooks/useDashboard";

const FAILURE_LABELS: Record<string, string> = {
  timeout: "Timeout",
  structure_changed: "Structure Changed",
  empty_results: "Empty Results",
};

function getFailureLabel(category: string | null): string {
  if (!category) return "Unknown Error";
  return FAILURE_LABELS[category] ?? "Unknown Error";
}

function getActionConfig(category: string | null): {
  label: string;
  type: "retry" | "fix" | "investigate";
} {
  switch (category) {
    case "timeout":
      return { label: "Retry", type: "retry" };
    case "structure_changed":
      return { label: "Fix", type: "fix" };
    case "empty_results":
      return { label: "Investigate", type: "investigate" };
    default:
      return { label: "Retry", type: "retry" };
  }
}

interface NeedsAttentionTableProps {
  data: FailedSiteData[] | undefined;
  meta: { total: number; showing: number } | undefined;
  isLoading: boolean;
}

const MAX_VISIBLE_ROWS = 5;

export function NeedsAttentionTable({ data, meta, isLoading }: NeedsAttentionTableProps) {
  const triggerScrape = useTriggerScrape();

  function handleRetry(siteId: string, siteUrl: string) {
    triggerScrape.mutate({ siteId }, {
      onSuccess: () => {
        toast.success(`Re-scrape triggered for ${siteUrl}`);
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  }

  function handleOpenInNewTab(url: string) {
    window.open(url, "_blank");
  }

  if (isLoading) {
    return (
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardContent className="pt-4">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card style={{ backgroundColor: "#18181b" }}>
        <CardContent className="py-8">
          <p className="text-center text-sm" style={{ color: "#71717a" }}>
            No failures. All sites are healthy.
          </p>
        </CardContent>
      </Card>
    );
  }

  const visibleRows = data.slice(0, MAX_VISIBLE_ROWS);
  const hasMore = (meta?.total ?? 0) > MAX_VISIBLE_ROWS;

  return (
    <Card style={{ backgroundColor: "#18181b" }}>
      <CardContent className="pt-2 pb-3">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-700">
              <TableHead className="text-xs" style={{ color: "#a1a1aa" }}>Status</TableHead>
              <TableHead className="text-xs" style={{ color: "#a1a1aa" }}>Site URL</TableHead>
              <TableHead className="text-xs" style={{ color: "#a1a1aa" }}>Failure Reason</TableHead>
              <TableHead className="text-xs text-right" style={{ color: "#a1a1aa" }}>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((site) => {
              const action = getActionConfig(site.latestScrapeRun?.failureCategory ?? null);
              return (
                <TableRow key={site.id} className="border-zinc-700" style={{ height: "32px" }}>
                  <TableCell className="text-xs py-1">
                    <StatusBadge status="FAILED" />
                  </TableCell>
                  <TableCell
                    className="text-xs py-1 max-w-[300px] truncate font-mono"
                    style={{ color: "#fafafa", fontSize: "13px" }}
                    title={site.siteUrl}
                  >
                    {site.siteUrl}
                  </TableCell>
                  <TableCell className="text-xs py-1" style={{ color: "#a1a1aa" }}>
                    {getFailureLabel(site.latestScrapeRun?.failureCategory ?? null)}
                  </TableCell>
                  <TableCell className="text-xs py-1 text-right">
                    {action.type === "retry" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-xs"
                        onClick={() => handleRetry(site.id, site.siteUrl)}
                        disabled={triggerScrape.isPending}
                      >
                        Retry
                      </Button>
                    ) : action.type === "fix" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-xs"
                        style={{ color: "#3b82f6" }}
                        onClick={() => handleOpenInNewTab(site.siteUrl)}
                      >
                        Fix
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-xs"
                        style={{ color: "#f59e0b" }}
                        onClick={() => handleOpenInNewTab(site.siteUrl)}
                      >
                        Investigate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {hasMore && (
          <div className="mt-2 text-right">
            <Link
              href="/sites?status=FAILED"
              className="text-xs hover:underline"
              style={{ color: "#3b82f6" }}
            >
              View all {meta?.total} failed sites
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
