import { EventEmitter } from "node:events";
import type { SSEEvent } from "@/lib/types";

const EVENT_NAME = "sse-event";

// Module-level singleton EventEmitter shared across the process
const emitter = new EventEmitter();

// Allow many concurrent SSE clients without Node warning
emitter.setMaxListeners(100);

/**
 * Emit an SSE event to all connected SSE clients.
 */
export function emitEvent(event: SSEEvent): void {
  emitter.emit(EVENT_NAME, event);
}

/**
 * Subscribe to SSE events. Returns an unsubscribe function.
 */
export function subscribe(callback: (event: SSEEvent) => void): () => void {
  emitter.on(EVENT_NAME, callback);
  return () => {
    emitter.off(EVENT_NAME, callback);
  };
}
