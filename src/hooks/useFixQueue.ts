"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

/** One fix item as GET /api/dashboard/fix-queue returns it. */
export interface FixItemRow {
  id: string;
  siteId: string;
  siteUrl: string;
  siteStatus: string;
  field: string;
  source: "MANUAL" | "CHECK";
  code: string;
  detail: string | null;
  openedAt: string;
  resolvedAt: string | null;
  resolvedBy: "MANUAL" | "CHECK" | null;
  minutes: number | null;
  operator: string | null;
  note: string | null;
}

/** A listed site's 14-day score (src/lib/fixScore.ts scoreSite). */
export interface FixSiteScore {
  siteId: string;
  siteUrl: string;
  windowStart: string | null;
  windowEnd: string | null;
  complete: boolean;
  items: number;
  fields: number;
  minutes: number;
  finalStatus: string;
}

export function useFixQueue(params: { open?: boolean } = {}) {
  const sp = new URLSearchParams();
  if (params.open !== undefined) sp.set("open", String(params.open));
  return useQuery<{ data: FixItemRow[]; meta: { total: number; scores: FixSiteScore[] } }>({
    queryKey: ["fix-queue", params],
    queryFn: () => apiFetch(`/api/dashboard/fix-queue?${sp.toString()}`),
  });
}

export function useCreateFixItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { siteId: string; field: string; minutes?: number; note?: string; resolved?: boolean }) =>
      apiFetch("/api/dashboard/fix-queue", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fix-queue"] });
    },
  });
}

export function useUpdateFixItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; minutes?: number | null; resolved?: boolean; note?: string | null }) =>
      apiFetch(`/api/dashboard/fix-queue/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fix-queue"] });
    },
  });
}
