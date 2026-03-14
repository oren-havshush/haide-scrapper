import { NextRequest, NextResponse } from "next/server";
import { emitEvent } from "@/services/eventService";
import type { SSEEvent, SSEEventType } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_EVENT_TYPES: SSEEventType[] = [
  "site:status-changed",
  "analysis:completed",
  "scrape:completed",
  "scrape:failed",
];

/**
 * Internal endpoint for the worker process to emit SSE events.
 * POST /api/events/emit
 * Body: { type: SSEEventType, payload: SSEEventMap[type] }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as SSEEvent;

  if (!body.type || !VALID_EVENT_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid event type" } },
      { status: 400 },
    );
  }

  if (!body.payload) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Missing event payload" } },
      { status: 400 },
    );
  }

  emitEvent(body);

  return NextResponse.json({ ok: true });
}
