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
import { CompanyLogo } from "@/components/shared/CompanyLogo";
import { CompanyProfileBadge } from "@/components/shared/CompanyProfileBadge";

/**
 * Read-only view of everything scripts/company-profile.ts captured for a site.
 *
 * READ-ONLY on purpose. The capture is write-once (companyProfileAt gates it,
 * 409 without ?force=1), and the PUT endpoint deliberately refuses
 * companyLogoPath so no client can point the public site at an arbitrary path.
 * An edit form here would have to work around both, so correcting a value stays
 * a re-capture with --force rather than a dashboard field.
 *
 * The point of this panel is REVIEW: 187 sites are captured once and never
 * refreshed, so a wrong value is permanent unless someone spots it.
 */

export interface CompanyProfileFields {
  siteUrl: string;
  companyName: string | null;
  companyHomepageUrl: string | null;
  companyAbout: string | null;
  companyLogoPath: string | null;
  companyLogoSourceUrl: string | null;
  companyHqAddress: string | null;
  companyHqCity: string | null;
  companyProfileStatus: string | null;
  companyProfileAt: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5 items-start">
      <span className="text-xs pt-0.5" style={{ color: "#71717a" }}>
        {label}
      </span>
      <div className="text-sm min-w-0" style={{ color: "#e4e4e7" }}>
        {children}
      </div>
    </div>
  );
}

function Empty() {
  return <span style={{ color: "#52525b" }}>&mdash;</span>;
}

export function SiteCompanyProfileDialog({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: CompanyProfileFields | null;
}) {
  if (!site) return null;

  const captured = site.companyProfileAt != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CompanyLogo path={site.companyLogoPath} size={28} alt="" />
            <span className="truncate">{site.companyName ?? "Company profile"}</span>
            <CompanyProfileBadge status={site.companyProfileStatus as never} />
          </DialogTitle>
          <DialogDescription className="break-all">{site.siteUrl}</DialogDescription>
        </DialogHeader>

        {!captured ? (
          <p className="text-sm py-2" style={{ color: "#a1a1aa" }}>
            Not captured yet. Company data is collected once per site by{" "}
            <code className="text-xs">scripts/company-profile.ts</code>, separately from the
            weekly scrape.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: "#27272a" }}>
            <Field label="Homepage">
              {site.companyHomepageUrl ? (
                <a
                  href={site.companyHomepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline break-all"
                  style={{ color: "#60a5fa" }}
                >
                  {site.companyHomepageUrl}
                </a>
              ) : (
                <Empty />
              )}
            </Field>

            <Field label="City">
              {site.companyHqCity ? (
                <span title="Verbatim from CSV files/city.csv">{site.companyHqCity}</span>
              ) : (
                <Empty />
              )}
            </Field>

            <Field label="Address">{site.companyHqAddress ?? <Empty />}</Field>

            <Field label="Logo">
              {site.companyLogoPath ? (
                <div className="flex items-center gap-3">
                  {/* Larger, so a light-on-dark mark can actually be judged. */}
                  <CompanyLogo path={site.companyLogoPath} size={64} alt="Company logo" />
                  <div className="min-w-0 text-xs" style={{ color: "#71717a" }}>
                    <div className="font-mono break-all">{site.companyLogoPath}</div>
                    {site.companyLogoSourceUrl ? (
                      <div className="break-all mt-0.5">from {site.companyLogoSourceUrl}</div>
                    ) : (
                      <div className="mt-0.5">
                        rasterised from an inline &lt;svg&gt; — no source URL, so
                        rehydrate-logos.ts cannot repair it
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <Empty />
              )}
            </Field>

            <Field label="About">
              {site.companyAbout ? (
                <p
                  className="whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto pr-1"
                  style={{ color: "#d4d4d8" }}
                >
                  {site.companyAbout}
                </p>
              ) : (
                <Empty />
              )}
            </Field>

            <Field label="Captured">
              <span style={{ color: "#a1a1aa" }}>
                {new Date(site.companyProfileAt as string).toLocaleString()}
              </span>
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
