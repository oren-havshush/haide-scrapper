import type { SSEEvent } from "../../src/lib/types";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Emit an SSE event by POSTing to the Next.js internal endpoint.
 * This bridges the worker process and the Next.js SSE event bus.
 * Fire-and-forget: errors are logged but do not throw.
 */
export async function emitWorkerEvent(event: SSEEvent): Promise<void> {
  try {
    const token = process.env.API_TOKEN || process.env.NEXT_PUBLIC_API_TOKEN;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${BASE_URL}/api/events/emit`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      console.warn("[worker] Failed to emit SSE event:", res.status, await res.text());
    }
  } catch (error) {
    console.warn("[worker] Failed to emit SSE event:", error instanceof Error ? error.message : String(error));
  }
}
