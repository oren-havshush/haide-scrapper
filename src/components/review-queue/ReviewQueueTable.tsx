"use client";

import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfidenceBar } from "@/components/shared/ConfidenceBar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";
import Link from "next/link";

interface ReviewSite {
  id: string;
  siteUrl: string;
  confidenceScore: number | null;
  reviewAt: string | null;
  createdAt: string;
}

type SortableColumn = "confidenceScore" | "reviewAt";

interface ReviewQueueTableProps {
  sites: ReviewSite[];
  isLoading: boolean;
  sortBy: SortableColumn;
  sortOrder: "asc" | "desc";
  onSort: (column: SortableColumn) => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

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

export function ReviewQueueTable({
  sites,
  isLoading,
  sortBy,
  sortOrder,
  onSort,
  page,
  totalPages,
  total,
  onPageChange,
}: ReviewQueueTableProps) {
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
    return (
      <div className="text-center py-12">
        <p className="text-sm" style={{ color: "#71717a", fontSize: 14 }}>
          No sites pending review. Add more sites or wait for AI analysis to complete.
        </p>
        <Link
          href="/sites"
          className="text-sm mt-2 inline-block"
          style={{ color: "#3b82f6", fontSize: 14 }}
        >
          Go to Sites
        </Link>
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
            <TableHead
              className="w-[150px] cursor-pointer select-none"
              onClick={() => onSort("confidenceScore")}
            >
              Confidence <SortIndicator column="confidenceScore" sortBy={sortBy} sortOrder={sortOrder} />
            </TableHead>
            <TableHead
              className="w-[140px] cursor-pointer select-none"
              onClick={() => onSort("reviewAt")}
            >
              Date Analyzed <SortIndicator column="reviewAt" sortBy={sortBy} sortOrder={sortOrder} />
            </TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map((site) => (
            <TableRow key={site.id} className="h-10 hover:bg-[#18181b]">
              <TableCell className="font-mono text-[13px]">
                {site.siteUrl}
              </TableCell>
              <TableCell>
                {site.confidenceScore != null ? (
                  <ConfidenceBar confidence={site.confidenceScore} compact />
                ) : (
                  <span style={{ color: "#71717a" }}>&mdash;</span>
                )}
              </TableCell>
              <TableCell className="text-sm" style={{ color: "#a1a1aa" }}>
                {new Date(site.reviewAt ?? site.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(site.siteUrl, "_blank")}
                >
                  Review
                </Button>
              </TableCell>
            </TableRow>
          ))}
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
    </div>
  );
}
