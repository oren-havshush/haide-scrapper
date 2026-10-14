// The pure decisions of `reach` and `triage` in scripts/addsite-batch.ts (H5,
// owner 2026-10-14), so they can be tested without a browser.
//
//   - Reachability: a page that is challenged or blocked (scripts/lib/
//     challenge-detect.ts, F5's "Request Rejected" included) is retried once
//     with the browser identity before any "reachable" verdict; a timeout or a
//     network error is retried once as it was before a browser identity is
//     tried, so one slow answer no longer decides needsUaOverride (Data Pool).
//   - The WordPress job post type is recognised by a word list, not the word
//     "job" alone (TOP BIT's "vacancies").

/** One navigation's outcome, as tryNav reports it. */
export type ReachNav = {
  ok: boolean;
  challenged?: boolean;
  challengeReason?: string | null;
  error?: string;
  html: string;
  htmlLen: number;
  status?: number;
};

export type ReachDecision<N extends ReachNav> = {
  reachable: boolean;
  needsUaOverride: boolean;
  /** The page that was read: the bare one, or the browser identity's. */
  html: string;
  /** The last bare attempt, and the browser identity's attempt when one was made. */
  bare: N;
  real: N | null;
  /** True when the first bare attempt failed without a challenge and was retried. */
  bareRetried: boolean;
};

/**
 * Bare first; a bare failure that is not a challenge (a timeout, a network
 * error) is retried once bare; then the browser identity, once. The override
 * is needed only when every bare attempt failed and the browser identity
 * passed.
 */
export async function reachWithRetry<N extends ReachNav>(nav: (kind: "bare" | "real") => Promise<N>): Promise<ReachDecision<N>> {
  let bare = await nav("bare");
  let bareRetried = false;
  if (!bare.ok && !bare.challenged) {
    bare = await nav("bare");
    bareRetried = true;
  }
  if (bare.ok) return { reachable: true, needsUaOverride: false, html: bare.html, bare, real: null, bareRetried };
  const real = await nav("real");
  if (real.ok) return { reachable: true, needsUaOverride: true, html: real.html, bare, real, bareRetried };
  return { reachable: false, needsUaOverride: false, html: bare.html, bare, real, bareRetried };
}

/** The words a WordPress job post type is named by (the slug in its links, its body classes). */
export const JOB_POST_TYPE_WORDS = ["job", "jobs", "vacancy", "vacancies", "position", "positions", "career", "careers"] as const;

/** A link to one post of such a type: /<word>/<slug>, not the archive page itself. */
const JOB_POST_HREF = /\bhref=["'][^"']*\/(jobs?|vacanc(?:y|ies)|positions?|careers?)\/[^"'/?#]+/i;
/** WordPress's body classes for such a type: single-<word>, type-<word>, post-type-archive-<word>, <word>-template. */
const JOB_POST_CLASS = /\b(?:single|type|post-type-archive)-(jobs?|vacanc(?:y|ies)|positions?|careers?)\b|\b(jobs?|vacanc(?:y|ies)|positions?|careers?)-template\b/i;

/** The job post type a WordPress page shows, by its word, or null. */
export function wpJobPostType(html: string): string | null {
  const m = JOB_POST_HREF.exec(html) ?? JOB_POST_CLASS.exec(html);
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").toLowerCase();
}
