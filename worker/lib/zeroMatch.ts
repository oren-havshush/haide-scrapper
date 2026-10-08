// A configured item selector that matches nothing.
//
// When the explicit itemSelector matches zero elements, the single-page
// extractor falls back to auto-detecting "repeating item containers" from the
// field selectors (extractWithAutoItemDetection) — built in 5c1c324
// (2026-05-11) for extension-recorded configs whose field selectors are
// absolute nth-child paths with no item container. On a config that HAS an
// item selector, a zero match means the page changed or emptied, and the
// fallback builds cards out of whatever the field selectors happen to hit.
// 2026-09-29, night one: biopharmax's listing showed JetEngine's "no listings"
// block, the fallback took the language switcher's <h2> as a title, and "EN"
// was published as a job.
//
// On a scheduled run that is now a listing refusal: category
// structure_changed, nothing stored, the previous rows kept, no fallback.
// Since 2026-09-30 the manual path refuses too (the owner's decision): the same
// message and category, but its run closes FAILED so the operator sees it did
// not work — and nothing is written or deleted either way.

//
// A selector that matched but looks wrongly scoped — one node, or fewer rows
// than nodes — is the other way auto-detect's rows get published: the
// extractor runs auto-detect and substitutes its rows when it has more. On a
// scheduled run that guess is not published either (onLikelyWrongScope): the
// configured selector's rows are kept and the run warns with both counts. The
// manual path still substitutes.

export const ZERO_MATCH_WARNING = "item_selector_zero_match";
export const WRONG_SCOPE_WARNING = "item_scope_suspect";

// The blocked label (owner, 2026-10-04). A zero match on a page whose title is
// Cloudflare's challenge ("Just a moment...") is not a site change: the browser
// was shown the challenge instead of the listing (fritz, 2026-10-02, back to 9
// jobs the next night). Same refusal — nothing written, rows kept — under its
// own category. The title is only read; nothing tries to pass the challenge.
export const BLOCKED = "blocked";
export const BLOCKED_WARNING = "blocked_challenge";

/** Cloudflare's interstitial title. */
export function isChallengeTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && /^\s*just a moment/i.test(title);
}

/**
 * A host's bot challenge served instead of the page (owner, 2026-10-08).
 * SiteGround answered eso-group, gazit and sinaistore with HTTP 202, the
 * response header `sg-captcha: challenge`, and a meta refresh to
 * /.well-known/sgcaptcha/. The page then reloads itself, so the run ends as a
 * zero match, a null document.body, or a destroyed execution context —
 * none of which is a site change. Read from the main frame's navigation
 * responses; nothing tries to pass the challenge.
 */
export function detectChallengeResponse(url: string, headers: Record<string, string | undefined>): string | null {
  const sg = Object.entries(headers).find(([k]) => k.toLowerCase() === "sg-captcha")?.[1];
  if (typeof sg === "string" && /challenge/i.test(sg)) return "SiteGround challenge (sg-captcha: challenge)";
  try {
    if (new URL(url).pathname.startsWith("/.well-known/sgcaptcha/")) return "SiteGround challenge (/.well-known/sgcaptcha/)";
  } catch {
    // not a URL: no verdict
  }
  return null;
}

/** Remember the run's first challenge response on its guard. */
export function noteChallengeResponse(
  guard: ExtractGuard | null,
  url: string,
  headers: Record<string, string | undefined>,
): void {
  if (!guard || guard.challenge) return;
  guard.challenge = detectChallengeResponse(url, headers);
}

/** Per run. `zeroMatch` records the selector that matched nothing, when refused. */
export type ExtractGuard = {
  noAutoDetect: boolean;
  /** A scheduled run closes a refusal COMPLETED; a manual one FAILED. */
  scheduled: boolean;
  zeroMatch: string | null;
  /** The page title at that zero match, when it could be read. */
  zeroMatchTitle: string | null;
  /** A host challenge seen on a main-frame navigation this run (detectChallengeResponse). */
  challenge: string | null;
  /** One warning per selector a scheduled run declined to swap for auto-detect. */
  scopeSuspects: Map<string, string>;
};

export function newExtractGuard(scheduled: boolean): ExtractGuard {
  return { noAutoDetect: true, scheduled, zeroMatch: null, zeroMatchTitle: null, challenge: null, scopeSuspects: new Map() };
}

/**
 * The explicit selector looked wrongly scoped and auto-detect found more rows.
 * "keep" (and remember both counts) on a scheduled run; "substitute" on a
 * manual one, or for a caller with no guard — today's behaviour.
 */
export function onLikelyWrongScope(
  guard: ExtractGuard | null,
  s: { selector: string; matched: number; explicit: number; auto: number },
): "keep" | "substitute" {
  if (!guard || !guard.scheduled) return "substitute";
  if (!guard.scopeSuspects.has(s.selector)) {
    guard.scopeSuspects.set(
      s.selector,
      `${WRONG_SCOPE_WARNING}: ${s.selector} matched ${s.matched} node(s); ` +
        `kept ${s.explicit} configured row(s), auto-detect found ${s.auto} — not substituted`,
    );
  }
  return "keep";
}

/** The run's wrongly-scoped warnings, for ScrapeRun.warnings. */
export function scopeSuspectWarnings(guard: ExtractGuard | null): string[] {
  return guard ? [...guard.scopeSuspects.values()] : [];
}

/**
 * The explicit item selector matched zero elements. "refuse" (and remember the
 * selector) for any run with a guard; "auto-detect" only for a caller with none.
 */
export function onExplicitZeroMatch(
  guard: ExtractGuard | null,
  selector: string,
  pageTitle: string | null = null,
): "refuse" | "auto-detect" {
  if (!guard || !guard.noAutoDetect) return "auto-detect";
  if (guard.zeroMatch === null) {
    guard.zeroMatch = selector;
    guard.zeroMatchTitle = pageTitle;
  }
  return "refuse";
}

/**
 * The listing refusal for a run whose item selector matched nothing and that
 * ended with no rows; null otherwise. Rows from another page or listing URL
 * leave it to the listing and pagination guards, which judge partial sets.
 */
export function zeroMatchRefusal(
  guard: ExtractGuard | null,
  rowCount: number,
): { failureCategory: "structure_changed" | "blocked"; runStatus: "COMPLETED" | "FAILED"; error: string; warnings: string[] } | null {
  if (!guard || !guard.noAutoDetect || !guard.zeroMatch || rowCount > 0) return null;
  if (isChallengeTitle(guard.zeroMatchTitle)) {
    const title = guard.zeroMatchTitle!.trim();
    return {
      failureCategory: BLOCKED,
      runStatus: guard.scheduled ? "COMPLETED" : "FAILED",
      error:
        `item selector matched nothing: ${guard.zeroMatch} — the page was a Cloudflare challenge ("${title}"), ` +
        "not the listing; previous listings kept",
      warnings: [`${ZERO_MATCH_WARNING}: ${guard.zeroMatch}`, `${BLOCKED_WARNING}: ${title}`],
    };
  }
  if (guard.challenge) {
    return {
      failureCategory: BLOCKED,
      runStatus: guard.scheduled ? "COMPLETED" : "FAILED",
      error:
        `item selector matched nothing: ${guard.zeroMatch} — the page was a ${guard.challenge}, ` +
        "not the listing; previous listings kept",
      warnings: [`${ZERO_MATCH_WARNING}: ${guard.zeroMatch}`, `${BLOCKED_WARNING}: ${guard.challenge}`],
    };
  }
  return {
    failureCategory: "structure_changed",
    runStatus: guard.scheduled ? "COMPLETED" : "FAILED",
    error: `item selector matched nothing: ${guard.zeroMatch} — no auto-detect fallback; previous listings kept`,
    warnings: [`${ZERO_MATCH_WARNING}: ${guard.zeroMatch}`],
  };
}
