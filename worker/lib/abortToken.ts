// Who is allowed to write a scrape run's terminal status when the 15-minute
// deadline fires.
//
// A scheduled run persists inside one transaction (see scheduledRun.ts). The
// timeout handler writes a terminal status of its own, independently of the
// scrape. If it fires *while that transaction is committing*, the run goes
// FAILED, the sweep records a failure — and then the commit lands and sets
// COMPLETED over a complete fresh set of rows. No listing is lost and no site
// status moves, but the night's log then contradicts the database, which is
// exactly the thing the nightly exists to produce.
//
// Skipping only the timeout handler's *write* does not fix it. The handler
// still rejects, that rejection reaches handleScrapeJob's catch, the catch
// reads the run, sees IN_PROGRESS with jobCount 0 — because the transaction has
// not committed yet — and calls failScrapeRun. That is a second writer of
// terminal state, outside the transaction. So both the handler and the catch
// consult this token.
//
// Three phases, and the move to `committing` is one-way:
//
//   running     Nothing is committing. An abort takes effect immediately and
//               the persistence path must refuse to open a transaction.
//   committing  The transaction — or the result it produced — is the SOLE
//               authority on the run's outcome. Entered immediately before the
//               transaction opens and never left: a settled transaction is
//               still the authority, and awaiting an already-resolved promise
//               costs nothing, so there is no third transition to get wrong.
//   aborted     The deadline passed before any transaction opened. Listings
//               are untouched and the run ends FAILED with `timeout`.
//
// Nothing here touches the database or the clock, so the rule is testable
// without either.

export type AbortPhase = "running" | "committing" | "aborted";

export type AbortToken<T = unknown> = {
  phase: AbortPhase;
  /** Why the abort was requested. Null until one is. */
  reason: string | null;
  /**
   * The in-flight (or settled) persistence promise, held so the timeout handler
   * and the catch block can await the transaction's own outcome instead of
   * inventing one. Null unless `phase` is `committing`.
   */
  inFlight: Promise<T> | null;
};

export type AbortRequest =
  /** The token moved to `aborted`; the caller owns the terminal status. */
  | { outcome: "accepted" }
  /**
   * A transaction is the authority. The caller must NOT write terminal state
   * and must NOT reject — it awaits `inFlight` and reports what that produced.
   */
  | { outcome: "deferred" }
  /** Someone already aborted. The caller writes nothing. */
  | { outcome: "already-aborted" };

export function createAbortToken<T = unknown>(): AbortToken<T> {
  return { phase: "running", reason: null, inFlight: null };
}

/** True once the deadline has passed with no transaction open. */
export function isAborted(token: AbortToken<unknown> | null | undefined): boolean {
  return token?.phase === "aborted";
}

/**
 * Ask to stop the run. Call this from the timeout handler *before* it writes
 * anything, and act on the outcome.
 */
export function requestAbort(token: AbortToken<unknown>, reason: string): AbortRequest {
  if (token.phase === "committing") return { outcome: "deferred" };
  if (token.phase === "aborted") return { outcome: "already-aborted" };
  token.phase = "aborted";
  token.reason = reason;
  return { outcome: "accepted" };
}

/**
 * Open the commit window and start the persistence transaction.
 *
 * Returns `null` when the token is already aborted — the deadline passed, so
 * the transaction must not *start*; the previous listings stay exactly as they
 * are. Otherwise the phase flips to `committing` before `start` is invoked (no
 * await in between, so no abort can land in the gap) and the resulting promise
 * is held on the token.
 */
export function beginCommit<T>(
  token: AbortToken<T>,
  start: () => Promise<T>,
): Promise<T> | null {
  if (token.phase === "aborted") return null;
  token.phase = "committing";
  const promise = start();
  token.inFlight = promise;
  return promise;
}

/**
 * The transaction's own outcome, for a caller that must not write one of its
 * own. Null when no transaction was ever opened.
 */
export function awaitCommit<T>(token: AbortToken<T>): Promise<T> | null {
  return token.phase === "committing" ? token.inFlight : null;
}
