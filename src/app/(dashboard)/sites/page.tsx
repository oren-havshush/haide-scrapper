"use client";

import { useState } from "react";
import { AddSiteInput } from "@/components/sites/AddSiteInput";
import { SiteSearchFilters } from "@/components/sites/SiteSearchFilters";
import { SiteStatusTabs } from "@/components/sites/SiteStatusTabs";
import { SitesTable } from "@/components/sites/SitesTable";
import { useSites, usePolicyStatusCounts } from "@/hooks/useSites";
import { POLICY_STATUS_LABELS, type PolicyStatusValue } from "@/components/shared/PolicyStatusBadge";

const POLICY_FILTER_OPTIONS: Array<{ value: string | undefined; label: string }> = [
  { value: undefined, label: "All" },
  { value: "NOT_CHECKED", label: POLICY_STATUS_LABELS.NOT_CHECKED },
  { value: "POLICY_NOT_FOUND", label: POLICY_STATUS_LABELS.POLICY_NOT_FOUND },
  { value: "NO_EXPLICIT_RESTRICTION", label: POLICY_STATUS_LABELS.NO_EXPLICIT_RESTRICTION },
  { value: "RESTRICTED", label: POLICY_STATUS_LABELS.RESTRICTED },
  { value: "REQUIRES_WRITTEN_PERMISSION", label: POLICY_STATUS_LABELS.REQUIRES_WRITTEN_PERMISSION },
  { value: "UNCLEAR_NEEDS_REVIEW", label: POLICY_STATUS_LABELS.UNCLEAR_NEEDS_REVIEW },
  { value: "CHECK_FAILED", label: POLICY_STATUS_LABELS.CHECK_FAILED },
];

export default function SitesPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [policyFilter, setPolicyFilter] = useState<string | undefined>(undefined);
  const [companyNameSearch, setCompanyNameSearch] = useState("");
  const [urlSearch, setUrlSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"createdAt" | "confidenceScore">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useSites({
    page,
    status: statusFilter,
    policyStatus: policyFilter,
    companyNameSearch: companyNameSearch || undefined,
    urlSearch: urlSearch || undefined,
    sortBy,
    sortOrder,
  });

  const { data: policyCounts } = usePolicyStatusCounts();

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const handleTabChange = (status: string | undefined) => {
    setStatusFilter(status);
    setPage(1);
  };

  const handlePolicyFilterChange = (value: string | undefined) => {
    setPolicyFilter(value);
    setPage(1);
  };

  const handleCompanyNameSearchChange = (value: string) => {
    setCompanyNameSearch(value);
    setPage(1);
  };

  const handleUrlSearchChange = (value: string) => {
    setUrlSearch(value);
    setPage(1);
  };

  const handleSort = (column: "createdAt" | "confidenceScore") => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setPage(1);
  };

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: "#fafafa" }}>
        Sites
      </h2>
      <AddSiteInput />
      <SiteSearchFilters
        companyNameSearch={companyNameSearch}
        urlSearch={urlSearch}
        onCompanyNameSearchChange={handleCompanyNameSearchChange}
        onUrlSearchChange={handleUrlSearchChange}
      />
      <SiteStatusTabs
        activeTab={statusFilter ?? "ALL"}
        onTabChange={handleTabChange}
      />

      {/* Policy Review filter */}
      <div className="flex flex-wrap gap-2 mb-3 mt-2">
        {POLICY_FILTER_OPTIONS.map((opt) => {
          const count = opt.value
            ? (policyCounts?.data as Record<string, number>)?.[opt.value as PolicyStatusValue] ?? 0
            : undefined;
          const isActive = policyFilter === opt.value;
          return (
            <button
              key={opt.value ?? "all"}
              type="button"
              onClick={() => handlePolicyFilterChange(opt.value)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors"
              style={{
                borderColor: isActive ? "#3b82f6" : "#27272a",
                color: isActive ? "#3b82f6" : "#a1a1aa",
                backgroundColor: isActive ? "rgba(59,130,246,0.1)" : "transparent",
              }}
            >
              {opt.label}
              {count !== undefined && count > 0 && (
                <span className="opacity-70">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      <SitesTable
        sites={data?.data ?? []}
        isLoading={isLoading}
        activeFilter={statusFilter}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
