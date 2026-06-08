"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

export function useUpdateJobLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, location }: { jobId: string; location: string }) =>
      apiFetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ location }),
      }),
    onSuccess: () => {
      // Invalidate all jobs queries so the table refetches with the updated location.
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
