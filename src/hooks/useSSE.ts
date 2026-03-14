"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SSEEvent } from "@/lib/types";

interface UseSSEOptions {
  /** Called when a scrape:failed or site:status-changed(FAILED) event arrives */
  onFailureDetected?: () => void;
}

/**
 * Hook that establishes an SSE connection to /api/events and
 * invalidates TanStack Query caches + shows toast notifications
 * based on incoming server-sent events.
 *
 * Should be called once in a top-level layout component (e.g. AppLayout).
 */
export function useSSE(options?: UseSSEOptions) {
  const queryClient = useQueryClient();
  const onFailureDetected = options?.onFailureDetected;

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = (messageEvent: MessageEvent<string>) => {
      let event: SSEEvent;
      try {
        event = JSON.parse(messageEvent.data) as SSEEvent;
      } catch {
        return; // Ignore malformed messages
      }

      switch (event.type) {
        case "site:status-changed":
          queryClient.invalidateQueries({ queryKey: ["sites"] });
          queryClient.invalidateQueries({ queryKey: ["sites", "counts"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "failures"] });
          // Notify about new failures
          if (event.payload.status === "FAILED" && onFailureDetected) {
            onFailureDetected();
          }
          break;

        case "analysis:completed":
          queryClient.invalidateQueries({ queryKey: ["sites"] });
          queryClient.invalidateQueries({ queryKey: ["sites", "counts"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] });
          break;

        case "scrape:completed":
          toast.success(
            `Scrape complete -- ${event.payload.jobCount} jobs scraped`,
          );
          queryClient.invalidateQueries({ queryKey: ["sites"] });
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "failures"] });
          break;

        case "scrape:failed":
          toast.error(
            `Scrape failed: ${event.payload.error}`,
            { duration: Infinity },
          );
          queryClient.invalidateQueries({ queryKey: ["sites"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "failures"] });
          // Notify about new failures
          if (onFailureDetected) {
            onFailureDetected();
          }
          break;
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects natively; just log the error
      console.warn("[useSSE] EventSource connection error; will auto-reconnect");
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient, onFailureDetected]);
}
