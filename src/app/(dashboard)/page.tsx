"use client";

import { useDashboardOverview, useFailedSites } from "@/hooks/useDashboard";
import { StatusPanels } from "@/components/dashboard/StatusPanels";
import { NeedsAttentionTable } from "@/components/dashboard/NeedsAttentionTable";

export default function HomePage() {
  const overview = useDashboardOverview();
  const failures = useFailedSites();

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: "#fafafa" }}>
        Overview
      </h2>

      <StatusPanels
        data={overview.data?.data}
        isLoading={overview.isLoading}
      />

      <h3 className="text-lg font-semibold mt-8 mb-4" style={{ color: "#fafafa" }}>
        Needs Attention
      </h3>

      <NeedsAttentionTable
        data={failures.data?.data}
        meta={failures.data?.meta}
        isLoading={failures.isLoading}
      />
    </div>
  );
}
