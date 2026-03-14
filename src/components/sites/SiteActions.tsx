"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, Loader2, ExternalLink } from "lucide-react";

interface SiteActionsProps {
  siteId: string;
  siteUrl: string;
  status: "ANALYZING" | "REVIEW" | "ACTIVE" | "FAILED" | "SKIPPED";
  onSkip: (siteId: string) => void;
  onReanalyze: (siteId: string, siteUrl: string) => void;
  onDelete: (siteId: string) => void;
  onScrape?: (siteId: string) => void;
  onTestScrape?: (siteId: string) => void;
  onClearJobs?: (siteId: string) => void;
  onReview?: (siteUrl: string) => void;
  isSkipping?: boolean;
  isReanalyzing?: boolean;
  isScraping?: boolean;
  hasFieldMappings?: boolean;
}

export function SiteActions({
  siteId,
  siteUrl,
  status,
  onSkip,
  onReanalyze,
  onDelete,
  onScrape,
  onTestScrape,
  onClearJobs,
  onReview,
  isSkipping,
  isReanalyzing,
  isScraping,
  hasFieldMappings,
}: SiteActionsProps) {
  if (status === "ANALYZING") {
    return <span style={{ color: "#71717a" }}>&mdash;</span>;
  }

  const showSkip = status === "ACTIVE" || status === "REVIEW";
  const showReanalyze = status === "FAILED" || status === "SKIPPED";
  const showScrape = status === "ACTIVE" || status === "REVIEW";
  const showReview = status === "REVIEW" || status === "ACTIVE";
  const showScrapeInMenu = status === "FAILED" && hasFieldMappings;

  return (
    <div className="flex items-center gap-1">
      {showReview && onReview && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onReview(siteUrl)}
        >
          <ExternalLink className="size-3 mr-1" />
          Review
        </Button>
      )}
      {showScrape && onTestScrape && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onTestScrape(siteId)}
          disabled={isScraping}
        >
          {isScraping ? (
            <Loader2 className="size-3 mr-1 animate-spin" />
          ) : null}
          Test 1
        </Button>
      )}
      {showScrape && onScrape && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onScrape(siteId)}
          disabled={isScraping}
        >
          {isScraping ? (
            <>
              <Loader2 className="size-3 mr-1 animate-spin" />
              Scraping...
            </>
          ) : (
            "Scrape All"
          )}
        </Button>
      )}
      {showSkip && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onSkip(siteId)}
          disabled={isSkipping}
        >
          {isSkipping ? "..." : "Skip"}
        </Button>
      )}
      {showReanalyze && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onReanalyze(siteId, siteUrl)}
          disabled={isReanalyzing}
        >
          {isReanalyzing ? "..." : "Re-analyze"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" />
          }
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">More actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showScrapeInMenu && onScrape && (
            <DropdownMenuItem
              onClick={() => onScrape(siteId)}
              disabled={isScraping}
            >
              {isScraping ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Scrape All
            </DropdownMenuItem>
          )}
          {onClearJobs && (status === "ACTIVE" || status === "REVIEW" || status === "FAILED") && (
            <DropdownMenuItem onClick={() => onClearJobs(siteId)}>
              Clear Jobs
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(siteId)}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
