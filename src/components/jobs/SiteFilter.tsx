"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSites } from "@/hooks/useSites";

interface SiteFilterProps {
  selectedSiteId: string | undefined;
  onSiteChange: (siteId: string | undefined) => void;
}

export function SiteFilter({ selectedSiteId, onSiteChange }: SiteFilterProps) {
  // Fetch ACTIVE sites (most likely to have jobs)
  const { data, isLoading } = useSites({ pageSize: 100 });
  const sites = data?.data ?? [];

  if (isLoading) {
    return <Skeleton className="h-9 w-[280px] mb-4" />;
  }

  return (
    <div className="mb-4">
      <Select
        value={selectedSiteId ?? "all"}
        onValueChange={(value) =>
          onSiteChange(!value || value === "all" ? undefined : value)
        }
      >
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="All Sites" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sites</SelectItem>
          {sites.map((site: { id: string; siteUrl: string }) => (
            <SelectItem key={site.id} value={site.id}>
              <span className="font-mono text-[13px]">{site.siteUrl}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
