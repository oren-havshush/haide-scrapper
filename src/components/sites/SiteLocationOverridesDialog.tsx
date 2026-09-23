"use client";

import { useSiteLocationOverrides } from "@/hooks/useSites";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * A site's manual location overrides, each shown with the job title it was set
 * against.
 *
 * Until this there was no way to see them at all. An override is a human's
 * assertion about one job and it outranks everything the scraper decides, but
 * it lives in a table the dashboard never read, keyed by
 * `externalJobId ?? detailUrl` — which on a site with no id mapping is a
 * synthesised `h-<hash>` seeded from the job's own fields. halilit re-keyed 6
 * of its 7 jobs across a single config change.
 *
 * So the rows that matter most here are the ones that match nothing. They are
 * listed first, with the title they were set against, because that title is the
 * only thing that makes an orphaned override actionable: re-apply it to the
 * right job, or delete it. A row reading "key h-1p1cu0x, חיפה" is neither.
 */

type ResolvedOverride = {
  id: string;
  jobKey: string;
  location: string;
  locations: string[];
  jobId: string | null;
  matched: boolean;
  ambiguous: boolean;
  jobTitle: string | null;
  titleWhenSet: string | null;
  titleChanged: boolean;
  updatedAt: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string | null;
  siteUrl: string;
}

export function SiteLocationOverridesDialog({ open, onOpenChange, siteId, siteUrl }: Props) {
  const { data, isLoading, error } = useSiteLocationOverrides(open ? siteId : null);
  const rows = (data?.overrides ?? null) as ResolvedOverride[] | null;
  const unmatched = rows?.filter((r) => !r.matched).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Location overrides</DialogTitle>
          <DialogDescription>
            Manual locations set on {siteUrl}. An override outranks whatever the scraper
            finds, and survives a re-scrape.
            {unmatched > 0 && (
              <>
                {" "}
                <span className="font-medium">
                  {unmatched} no longer match{unmatched === 1 ? "es" : ""} a job
                </span>{" "}
                — the job&apos;s key changed, so the override applies to nothing. Re-apply it
                to the right job, or delete it.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto text-sm">
          {error && <p className="text-destructive">{(error as Error).message}</p>}
          {!error && isLoading && <p className="text-muted-foreground">Loading…</p>}
          {!error && rows !== null && rows.length === 0 && (
            <p className="text-muted-foreground">This site has no location overrides.</p>
          )}
          {rows?.map((r) => (
            <div key={r.id} className="border-b py-2 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className={r.matched ? "" : "text-amber-500"}>
                  {r.jobTitle ?? <span className="italic">no title recorded</span>}
                </span>
                <span className="font-medium whitespace-nowrap">
                  {r.locations.length > 0 ? r.locations.join(", ") : r.location}
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                {r.matched ? (
                  <>
                    applies to a live job
                    {r.titleChanged && (
                      <> — retitled since, it was set against “{r.titleWhenSet}”</>
                    )}
                  </>
                ) : r.ambiguous ? (
                  <>two jobs claim the key “{r.jobKey}” — left unapplied rather than guessed</>
                ) : (
                  <>no job matches the key “{r.jobKey}” — this override applies to nothing</>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
