"use client";

import { useState } from "react";
import { AddSiteInput } from "@/components/sites/AddSiteInput";
import { SiteSearchFilters } from "@/components/sites/SiteSearchFilters";
import { SiteStatusTabs } from "@/components/sites/SiteStatusTabs";
import { SitesTable } from "@/components/sites/SitesTable";
import { useSites } from "@/hooks/useSites";

export default function SitesPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [companyNameSearch, setCompanyNameSearch] = useState("");
  const [urlSearch, setUrlSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"createdAt" | "confidenceScore">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useSites({
    page,
    status: statusFilter,
    companyNameSearch: companyNameSearch || undefined,
    urlSearch: urlSearch || undefined,
    sortBy,
    sortOrder,
  });

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const handleTabChange = (status: string | undefined) => {
    setStatusFilter(status);
    setPage(1); // Reset to first page on filter change
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
    setPage(1); // Reset to first page on sort change
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
