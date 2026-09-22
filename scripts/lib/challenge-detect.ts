/**
 * Anti-bot challenge / block-page detection shared by the reachability gates
 * (`reach`, `detail-reach`, `triage` in scripts/addsite-batch.ts).
 *
 * Why this is its own module: the gates used to each carry their own partial
 * copy of the rules, and every copy had a different hole.
 *
 *   - `CHALLENGE_RE` (reach + triage) listed the literal string "reblaze", but
 *     a Reblaze `ac_v2` stub never contains it — it ships `window.rbzns`,
 *     `winsocks()` and a `*.ac_v2.lib.js` script tag. career.rafael.co.il
 *     served a 581-byte stub under HTTP 247 and `reach` printed
 *     "PASS bare (status=247)". See LRN-WAF-6.
 *   - Incapsula markers lived in `INCAPSULA_RE`, which only `detail-reach`
 *     ever used. `reach` and `triage` had no Incapsula rule at all, so
 *     tikshoov.co.il's 914-byte Imperva block page classified as YELLOW with a
 *     topCluster reading taken off the block page. See LRN-WAF-5.
 *   - Nothing anywhere checked response SIZE or the HTTP status, so an
 *     unrecognised WAF's stub passed on markers alone.
 *
 * THE TRAP THAT SHAPES THE DESIGN BELOW: a WAF's script markers appear on
 * *working* pages too, because the WAF fronts the whole site. www.ono.ac.il
 * (ACTIVE, healthy) serves 314 KB with 501 anchors and still contains
 * `_Incapsula_Resource`. A bare vendor marker therefore CANNOT mean "blocked" —
 * treating it that way would RED a live site. Markers are split in two:
 *
 *   1. BLOCK TEXT  — phrases that only ever appear on a block/challenge page
 *                    ("Request unsuccessful", "Incapsula incident", "Just a
 *                    moment"). Conclusive on their own, at any size.
 *   2. BOOTSTRAP   — vendor plumbing (`rbzns`, `_Incapsula_Resource`) that also
 *                    ships on healthy pages. Only counts when the document has
 *                    no real content, i.e. it really is a bootstrap shell.
 *
 * Then a non-standard HTTP status, and finally a size backstop for WAFs we
 * have not seen yet.
 */

/** Text that only ever appears on a block/challenge interstitial. Conclusive. */
export const BLOCK_TEXT_RE =
  /Request unsuccessful|Incapsula incident|Powered by Imperva|just a moment|cf-mitigated|attention required|checking your browser|enable javascript and cookies|access denied/i;

/**
 * Reblaze `ac_v2` bootstrap. Present on the challenge stub; treated as a block
 * only when the page has no real content. LRN-WAF-6 (career.rafael.co.il).
 */
export const REBLAZE_BOOTSTRAP_RE = /\brbzns\b|\bwinsocks\s*\(|\.ac_v2\.lib\.js/i;

/**
 * Imperva/Incapsula bootstrap. ALSO ships on healthy pages (ono.ac.il), so it
 * is deliberately NOT conclusive on its own. LRN-WAF-2, LRN-WAF-5.
 */
export const INCAPSULA_BOOTSTRAP_RE = /_Incapsula_Resource|incap_ses_|visid_incap_/i;

/**
 * A real jobs page is tens of KB. Every block page we have measured is far
 * under this: Reblaze 581 B, Imperva 914 B. The floor only fires when the
 * document ALSO has no anchors, so a small-but-real page cannot trip it —
 * a listing without a single link is not a listing.
 */
export const MIN_REAL_HTML_BYTES = 2000;

const HAS_ANCHOR_RE = /<a[\s>]/i;

/**
 * HTTP status codes a normal page can legitimately arrive on. Anything else
 * below 400 is a WAF inventing a code: Reblaze answers its challenge with
 * **247**, which sails through a naive `status < 400` check.
 */
const STANDARD_OK_STATUSES = new Set([
  200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304, 305, 307, 308,
]);

export interface ChallengeVerdict {
  /** True when the document is an interstitial/block page, not real content. */
  challenged: boolean;
  /** Short machine-readable tag naming which rule fired, or null. */
  reason: string | null;
}

/**
 * Is this a bootstrap shell rather than a document with real content?
 *
 * Anchors are the signal, NOT size: a challenge page can be padded well past
 * any byte threshold and still be a shell, while every real listing page has
 * links. An earlier draft also accepted "big enough" as evidence of content,
 * which let a padded Reblaze shell through.
 */
function looksLikeShell(html: string): boolean {
  return !HAS_ANCHOR_RE.test(html);
}

/**
 * Classify a fetched document. `status` is optional so callers that only kept
 * the HTML can still get the marker + size rules.
 */
export function classifyResponse(html: string, status?: number): ChallengeVerdict {
  // 1. Conclusive block-page text — size does not matter.
  if (BLOCK_TEXT_RE.test(html)) return { challenged: true, reason: "block-text" };

  // 2. Vendor bootstrap WITHOUT real content = a challenge shell. With real
  //    content it is just a WAF-fronted healthy page, which must pass.
  if (looksLikeShell(html)) {
    if (REBLAZE_BOOTSTRAP_RE.test(html)) return { challenged: true, reason: "reblaze-bootstrap" };
    if (INCAPSULA_BOOTSTRAP_RE.test(html)) return { challenged: true, reason: "incapsula-bootstrap" };
  }

  // 3. A status no ordinary server returns (Reblaze uses 247).
  if (typeof status === "number" && status < 400 && !STANDARD_OK_STATUSES.has(status)) {
    return { challenged: true, reason: `nonstandard-status-${status}` };
  }

  // 4. Size backstop for WAFs we have no marker for yet.
  if (html.length < MIN_REAL_HTML_BYTES && !HAS_ANCHOR_RE.test(html)) {
    return { challenged: true, reason: `stub-${html.length}b` };
  }

  return { challenged: false, reason: null };
}
