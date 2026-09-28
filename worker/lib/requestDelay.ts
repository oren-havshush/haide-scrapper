// Per-site request delay: `_meta.browserOverrides.requestDelayMs`.
//
// Some sites throttle the server's IP after a burst of automated page loads.
// ashtrom, 2026-09-26/28: from the box, a pagination transition took 17.8s,
// the next never came inside 40s, and on a later run 11 of 15 detail pages
// timed out — while the same walk from a quiet start got through. No settle
// window fixes that; spacing the loads out might.
//
// When set, the worker waits requestDelayMs before EVERY page load it makes
// for that site: each navigation (listing, URL pagination, detail, apply page)
// through the wrapped page.goto, each pagination and load-more click through
// beforeClickLoad, and the setup script's own fetches are spaced by the same
// gap while the script runs. Manual and scheduled runs alike — the site
// throttles both — and the read-only rehearsal too.

export const REQUEST_DELAY_MAX_MS = 15_000;

export type LoadKind = "navigation" | "pagination" | "load-more" | "setup-fetch";

export interface Pacer {
  readonly delayMs: number;
  /** When each load was released, for the run's log and the tests. */
  readonly loads: Array<{ kind: LoadKind; at: number }>;
  wait(kind: LoadKind): Promise<void>;
}

/**
 * The configured delay, or null for "no pacing". The validator refuses
 * anything outside 0..15000 on the way in; a value that is somehow outside it
 * in storage is ignored rather than clamped into a delay nobody chose.
 */
export function readRequestDelayMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value <= 0 || value > REQUEST_DELAY_MAX_MS) return null;
  return value;
}

export function createPacer(
  delayMs: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Pacer {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const loads: Array<{ kind: LoadKind; at: number }> = [];
  return {
    delayMs,
    loads,
    async wait(kind) {
      if (delayMs > 0) await sleep(delayMs);
      const at = now();
      const prev = loads[loads.length - 1];
      loads.push({ kind, at });
      console.info(
        `[pace] ${kind} after ${delayMs}ms` + (prev ? ` (+${at - prev.at}ms since the previous load)` : ""),
      );
    },
  };
}

const PACERS = new WeakMap<object, Pacer>();

/**
 * Wrap a page's `goto` so every navigation waits first, and remember the pacer
 * so clicks and the setup script can find it. Returns the same object.
 */
export function pacePage<T extends object>(page: T, pacer: Pacer): T {
  const target = page as unknown as { goto?: (...args: unknown[]) => Promise<unknown> };
  const original = target.goto;
  if (typeof original === "function") {
    target.goto = async (...args: unknown[]) => {
      await pacer.wait("navigation");
      return original.apply(page, args);
    };
  }
  PACERS.set(page, pacer);
  return page;
}

export function pacerFor(page: object): Pacer | undefined {
  return PACERS.get(page);
}

/** Call immediately before a click that loads a page (pagination, load more). */
export async function beforeClickLoad(page: object, kind: LoadKind): Promise<void> {
  await pacerFor(page)?.wait(kind);
}

/**
 * Space `win.fetch` and async XMLHttpRequest sends at least `delayMs` apart;
 * returns the function that restores them. Runs INSIDE the page (setupScriptRun
 * ships it by source), so it must stay self-contained: no imports, no closures
 * over this module. The first request goes at once — the page load before it
 * already waited — and each later one waits for its slot.
 */
export function paceFetchIn(win: unknown, delayMs: number): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = win as any;
  // A chain, not precomputed slots: each release waits for the previous one to
  // have ACTUALLY gone, then for the gap. Precomputed slots bunch up when the
  // first timer fires late (measured: 47ms apart for a 60ms delay).
  let chain: Promise<void> = Promise.resolve();
  let lastAt = -Infinity;
  const release = (): Promise<void> => {
    const turn = chain.then(async () => {
      const wait = lastAt + delayMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
    });
    chain = turn;
    return turn;
  };
  const originalFetch = w.fetch;
  if (typeof originalFetch === "function") {
    w.fetch = (...args: unknown[]) => release().then(() => originalFetch.apply(w, args));
  }
  const proto = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
  const originalOpen = proto ? proto.open : null;
  const originalSend = proto ? proto.send : null;
  if (proto && originalOpen && originalSend) {
    proto.open = function (this: { __haideAsync?: boolean }, ...args: unknown[]) {
      this.__haideAsync = args.length < 3 || args[2] !== false;
      return originalOpen.apply(this, args);
    };
    proto.send = function (this: { __haideAsync?: boolean }, ...args: unknown[]) {
      // A synchronous XHR cannot be delayed without blocking the page; it goes as is.
      if (!this.__haideAsync) return originalSend.apply(this, args);
      void release().then(() => originalSend.apply(this, args));
    };
  }
  return () => {
    if (typeof originalFetch === "function") w.fetch = originalFetch;
    if (proto && originalOpen && originalSend) {
      proto.open = originalOpen;
      proto.send = originalSend;
    }
  };
}
