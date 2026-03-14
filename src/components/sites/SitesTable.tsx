"use client";

import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfidenceBar } from "@/components/shared/ConfidenceBar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SiteActions } from "@/components/sites/SiteActions";
import { DeleteSiteDialog } from "@/components/sites/DeleteSiteDialog";
import { useUpdateSiteStatus, useDeleteSite } from "@/hooks/useSites";
import { useTriggerScrape, useClearJobs } from "@/hooks/useScrapeRuns";

interface LatestScrapeRun {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  jobCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface Site {
  id: string;
  siteUrl: string;
  status: "ANALYZING" | "REVIEW" | "ACTIVE" | "FAILED" | "SKIPPED";
  confidenceScore: number | null;
  fieldMappings: Record<string, unknown> | null;
  createdAt: string;
  latestScrapeRun: LatestScrapeRun | null;
}

type SortableColumn = "createdAt" | "confidenceScore";

interface SitesTableProps {
  sites: Site[];
  isLoading: boolean;
  activeFilter?: string;
  sortBy: SortableColumn;
  sortOrder: "asc" | "desc";
  onSort: (column: SortableColumn) => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

const FILTERED_EMPTY_MESSAGES: Record<string, string> = {
  ANALYZING: "No sites are currently being analyzed.",
  REVIEW: "No sites pending review.",
  ACTIVE: "No active sites yet. Submit a URL to get started.",
  FAILED: "No failures. All sites are healthy.",
  SKIPPED: "No skipped sites.",
};

const PAGE_SIZE = 50;

function SortIndicator({ column, sortBy, sortOrder }: {
  column: SortableColumn;
  sortBy: SortableColumn;
  sortOrder: "asc" | "desc";
}) {
  if (sortBy !== column) return null;
  return sortOrder === "asc" ? (
    <ChevronUp className="inline size-4" />
  ) : (
    <ChevronDown className="inline size-4" />
  );
}

function ScrapeStatusIndicator({ scrapeRun }: { scrapeRun: LatestScrapeRun | null }) {
  if (!scrapeRun) return null;

  if (scrapeRun.status === "IN_PROGRESS") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs ml-2"
        style={{ color: "#3b82f6" }}
      >
        <Loader2 className="size-3 animate-spin" />
        Scraping...
      </span>
    );
  }

  if (scrapeRun.status === "COMPLETED") {
    const completedTime = scrapeRun.completedAt
      ? new Date(scrapeRun.completedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
    return (
      <span
        className="inline-flex items-center text-xs ml-2"
        style={{ color: "#22c55e" }}
      >
        {scrapeRun.jobCount} jobs{completedTime ? ` (${completedTime})` : ""}
      </span>
    );
  }

  // FAILED status indicator is handled by the site's own FAILED status badge
  return null;
}

export function SitesTable({
  sites,
  isLoading,
  activeFilter,
  sortBy,
  sortOrder,
  onSort,
  page,
  totalPages,
  total,
  onPageChange,
}: SitesTableProps) {
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [scrapingSiteId, setScrapingSiteId] = useState<string | null>(null);
  const updateStatus = useUpdateSiteStatus();
  const deleteSiteMutation = useDeleteSite();
  const triggerScrape = useTriggerScrape();
  const clearJobs = useClearJobs();

  const handleSkip = (siteId: string) => {
    updateStatus.mutate(
      { siteId, status: "SKIPPED" },
      {
        onSuccess: () => toast.success("Site skipped"),
        onError: (err: Error) => toast.error(err.message),
      }
    );
  };

  const handleReanalyze = (siteId: string, siteUrl: string) => {
    updateStatus.mutate(
      { siteId, status: "ANALYZING" },
      {
        onSuccess: () => toast.success(`Re-analysis triggered for ${siteUrl}`),
        onError: (err: Error) => toast.error(err.message),
      }
    );
  };

  const handleScrape = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    setScrapingSiteId(siteId);
    triggerScrape.mutate({ siteId }, {
      onSuccess: () => {
        toast.success(`Full scrape started for ${site?.siteUrl ?? siteId}`);
        setScrapingSiteId(null);
      },
      onError: (err: Error) => {
        toast.error(err.message);
        setScrapingSiteId(null);
      },
    });
  };

  const handleTestScrape = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    setScrapingSiteId(siteId);
    triggerScrape.mutate({ siteId, maxJobs: 1 }, {
      onSuccess: () => {
        toast.success(`Test scrape started (1 job) for ${site?.siteUrl ?? siteId}`);
        setScrapingSiteId(null);
      },
      onError: (err: Error) => {
        toast.error(err.message);
        setScrapingSiteId(null);
      },
    });
  };

  const handleClearJobs = (siteId: string) => {
    clearJobs.mutate(siteId, {
      onSuccess: () => toast.success("All jobs cleared"),
      onError: (err: Error) => toast.error(err.message),
    });
  };

  const handleReview = (siteUrl: string) => {
    window.open(siteUrl, "_blank", "noopener,noreferrer");
  };

  const handleDeleteConfirm = () => {
    if (!deleteTargetId) return;
    deleteSiteMutation.mutate(deleteTargetId, {
      onSuccess: () => {
        toast.success("Site deleted");
        setDeleteTargetId(null);
      },
      onError: (err: Error) => toast.error(err.message),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (sites.length === 0) {
    const message = activeFilter
      ? FILTERED_EMPTY_MESSAGES[activeFilter] ?? "No sites found."
      : "No sites yet. Paste a URL above to add your first site.";

    return (
      <div className="text-center py-12">
        <p className="text-sm" style={{ color: "#71717a" }}>
          {message}
        </p>
      </div>
    );
  }

  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-auto">URL</TableHead>
            <TableHead className="w-[120px]">Status</TableHead>
            <TableHead
              className="w-[150px] cursor-pointer select-none"
              onClick={() => onSort("confidenceScore")}
            >
              Confidence <SortIndicator column="confidenceScore" sortBy={sortBy} sortOrder={sortOrder} />
            </TableHead>
            <TableHead
              className="w-[140px] cursor-pointer select-none"
              onClick={() => onSort("createdAt")}
            >
              Date Added <SortIndicator column="createdAt" sortBy={sortBy} sortOrder={sortOrder} />
            </TableHead>
            <TableHead className="w-[200px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map((site) => {
            const isScraping =
              scrapingSiteId === site.id ||
              site.latestScrapeRun?.status === "IN_PROGRESS";
            const hasFieldMappings =
              site.fieldMappings != null &&
              typeof site.fieldMappings === "object";

            return (
              <TableRow key={site.id} className="h-10 hover:bg-[#18181b]">
                <TableCell className="font-mono text-[13px]">
                  {site.siteUrl}
                </TableCell>
                <TableCell>
                  <div className="flex items-center">
                    <StatusBadge status={site.status} />
                    <ScrapeStatusIndicator scrapeRun={site.latestScrapeRun} />
                  </div>
                </TableCell>
                <TableCell>
                  {site.confidenceScore != null ? (
                    <ConfidenceBar confidence={site.confidenceScore} compact />
                  ) : (
                    <span style={{ color: "#71717a" }}>&mdash;</span>
                  )}
                </TableCell>
                <TableCell className="text-sm" style={{ color: "#a1a1aa" }}>
                  {new Date(site.createdAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell>
                  <SiteActions
                    siteId={site.id}
                    siteUrl={site.siteUrl}
                    status={site.status}
                    onSkip={handleSkip}
                    onReanalyze={handleReanalyze}
                    onDelete={(id) => setDeleteTargetId(id)}
                    onScrape={handleScrape}
                    onTestScrape={handleTestScrape}
                    onClearJobs={handleClearJobs}
                    onReview={handleReview}
                    isSkipping={updateStatus.isPending}
                    isReanalyzing={updateStatus.isPending}
                    isScraping={isScraping}
                    hasFieldMappings={hasFieldMappings}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-xs" style={{ color: "#a1a1aa" }}>
            Showing {startItem}-{endItem} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <DeleteSiteDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        onConfirm={handleDeleteConfirm}
        isDeleting={deleteSiteMutation.isPending}
      />
    </div>
  );
}
