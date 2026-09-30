"use client";

import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { FixItemRow, FixSiteScore } from "@/hooks/useFixQueue";

interface FixQueueTableProps {
  items: FixItemRow[];
  scores: FixSiteScore[];
  isLoading: boolean;
  onResolve: (id: string) => void;
  resolvingId: string | null;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Jerusalem" }) : "—";
}

/** "3 items · 2 fields · 45 min (window closed 12/10/2026)" for the score column. */
function scoreText(s: FixSiteScore | undefined): string {
  if (!s) return "—";
  if (!s.windowStart) return "never ACTIVE";
  const window = s.complete ? `window closed ${fmtDate(s.windowEnd)}` : `window open to ${fmtDate(s.windowEnd)}`;
  return `${s.items} item${s.items === 1 ? "" : "s"} · ${s.fields} field${s.fields === 1 ? "" : "s"} · ${s.minutes} min (${window})`;
}

/**
 * Open fix items by site, then field (addsite2 phase two, step 1a). The score
 * column is the site's 14-day window after it went ACTIVE: MANUAL items,
 * distinct fields and minutes (src/lib/fixScore.ts).
 */
export function FixQueueTable({ items, scores, isLoading, onResolve, resolvingId }: FixQueueTableProps) {
  const scoreBySite = new Map(scores.map((s) => [s.siteId, s]));
  const sorted = [...items].sort(
    (a, b) => a.siteUrl.localeCompare(b.siteUrl) || a.field.localeCompare(b.field) || a.openedAt.localeCompare(b.openedAt),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No open fix items.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Site</TableHead>
          <TableHead>Field</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Opened</TableHead>
          <TableHead>Minutes</TableHead>
          <TableHead>Note</TableHead>
          <TableHead>Score (14 days after ACTIVE)</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((i, idx) => {
          const firstOfSite = idx === 0 || sorted[idx - 1].siteId !== i.siteId;
          return (
            <TableRow key={i.id}>
              <TableCell className="max-w-xs truncate" title={i.siteUrl}>
                {firstOfSite ? i.siteUrl : ""}
              </TableCell>
              <TableCell>{i.field}</TableCell>
              <TableCell title={i.code}>{i.source === "CHECK" ? `CHECK ${i.code}` : "MANUAL"}</TableCell>
              <TableCell>{fmtDate(i.openedAt)}</TableCell>
              <TableCell title={i.minutesEstimated ? "estimated from the day's API calls" : undefined}>
                {i.minutes == null ? "—" : i.minutesEstimated ? `~${i.minutes}` : i.minutes}
              </TableCell>
              <TableCell className="max-w-xs truncate" title={i.note ?? ""}>
                {i.note ?? i.detail ?? ""}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {firstOfSite ? scoreText(scoreBySite.get(i.siteId)) : ""}
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resolvingId === i.id}
                  onClick={() => onResolve(i.id)}
                >
                  {resolvingId === i.id ? "Resolving..." : "Resolve"}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
