"use client";

import { useState } from "react";
import { ReviewQueueTable } from "@/components/review-queue/ReviewQueueTable";
import { useSites } from "@/hooks/useSites";

type SortableColumn = "confidenceScore" | "reviewAt";

export default function ReviewPage() {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortableColumn>("confidenceScore");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useSites({
    page,
    status: "REVIEW",
    sortBy,
    sortOrder,
  });

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (column: SortableColumn) => {
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
        Review Queue
      </h2>
      <ReviewQueueTable
        sites={data?.data ?? []}
        isLoading={isLoading}
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
