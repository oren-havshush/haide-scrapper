"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSiteStatusCounts } from "@/hooks/useSites";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_TABS = [
  { value: "ALL", label: "All", countKey: "total", color: "#fafafa" },
  { value: "ANALYZING", label: "Analyzing", countKey: "ANALYZING", color: "#3b82f6" },
  { value: "REVIEW", label: "Review", countKey: "REVIEW", color: "#f59e0b" },
  { value: "ACTIVE", label: "Active", countKey: "ACTIVE", color: "#22c55e" },
  { value: "FAILED", label: "Failed", countKey: "FAILED", color: "#ef4444" },
  { value: "SKIPPED", label: "Skipped", countKey: "SKIPPED", color: "#6b7280" },
] as const;

interface SiteStatusTabsProps {
  activeTab: string;
  onTabChange: (status: string | undefined) => void;
}

export function SiteStatusTabs({ activeTab, onTabChange }: SiteStatusTabsProps) {
  const { data, isLoading } = useSiteStatusCounts();
  const counts = data?.data as Record<string, number> | undefined;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) =>
        onTabChange(value === "ALL" ? undefined : value)
      }
      className="mb-4"
    >
      <TabsList variant="line">
        {STATUS_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
            {isLoading ? (
              <Skeleton className="ml-1.5 h-4 w-6 inline-block" />
            ) : (
              <span
                className="ml-1.5 text-xs tabular-nums"
                style={{ color: tab.color }}
              >
                {counts?.[tab.countKey] ?? 0}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
