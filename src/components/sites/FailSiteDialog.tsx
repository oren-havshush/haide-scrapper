"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface FailSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isFailing: boolean;
  siteUrl: string;
  /**
   * Listings the site publishes right now — all of them go. `null` when the
   * count is not known (no run owns the site's rows), in which case the dialog
   * warns without a number rather than printing a reassuring 0.
   */
  jobCount: number | null;
}

/**
 * Marking a site FAILED deletes every listing it has.
 *
 * `siteService.updateSiteStatus` wraps `job.deleteMany` and the status change in
 * one transaction, so this is the only destructive status in the table — and
 * nothing said so. "Fail" sits in the row beside "Skip", one click, no
 * confirmation, and a site with 433 listings loses them with the same gesture
 * that parks one with none.
 *
 * The count is in the dialog because it is what makes the warning land: "this
 * deletes 433 listings" is a different sentence from "this deletes listings".
 */
export function FailSiteDialog({
  open,
  onOpenChange,
  onConfirm,
  isFailing,
  siteUrl,
  jobCount,
}: FailSiteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {jobCount === null
              ? "Mark FAILED and delete its listings?"
              : jobCount > 0
                ? `Mark FAILED and delete ${jobCount} listing${jobCount === 1 ? "" : "s"}?`
                : "Mark this site FAILED?"}
          </DialogTitle>
          <DialogDescription>
            {jobCount === 0 ? (
              <>
                Marking <span className="font-medium">{siteUrl}</span> as FAILED also deletes
                its listings. It is publishing none, so nothing is lost.
              </>
            ) : (
              <>
                Marking <span className="font-medium">{siteUrl}</span> as FAILED{" "}
                <span className="font-medium">
                  permanently deletes{" "}
                  {jobCount === null ? "every listing it has" : `all ${jobCount} of its listings`}
                </span>
                . The public jobs site reads this database directly, so they stop being
                published. Nothing restores them — the site has to be scraped again.
                <br />
                <br />
                To keep the listings, use <span className="font-medium">Skip</span> instead,
                or <span className="font-medium">Clear Jobs</span> if deleting them is
                actually what you want.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isFailing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isFailing}>
            {isFailing
              ? "Marking failed..."
              : jobCount !== null && jobCount > 0
                ? `Delete ${jobCount} and mark FAILED`
                : "Mark FAILED"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
