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
/** The same in Hebrew (H5b, owner 2026-10-14), matched raw and percent-encoded, as WordPress writes a Hebrew slug. */
export const HEBREW_JOB_POST_TYPE_WORDS = ["משרות", "משרה", "דרושים", "קריירה"] as const;

/** Every form of every word, longest first, as one alternation. Nothing in them needs escaping. */
const WORD_ALT = [
  ...JOB_POST_TYPE_WORDS,
  ...HEBREW_JOB_POST_TYPE_WORDS,
  ...HEBREW_JOB_POST_TYPE_WORDS.map((w) => encodeURIComponent(w)),
]
  .sort((a, b) => b.length - a.length)
  .join("|");

/** A link to one post of such a type: /<word>/<slug>, not the archive page itself. */
const JOB_POST_HREF = new RegExp(`\\bhref=["'][^"']*/(${WORD_ALT})/[^"'/?#]+`, "i");
/**
 * WordPress's body classes for such a type: single-<word>, type-<word>,
 * post-type-archive-<word>, <word>-template. A class ends at a space or a
 * quote; \b is not used, since it does not fire after a Hebrew letter.
 */
const JOB_POST_CLASS = new RegExp(
  `(?:^|[\\s"'])(?:single|type|post-type-archive)-(${WORD_ALT})(?=[\\s"']|$)|(?:^|[\\s"'])(${WORD_ALT})-template`,
  "i",
);

/** The job post type a WordPress page shows, by its word (decoded, lower-case), or null. */
export function wpJobPostType(html: string): string | null {
  const m = JOB_POST_HREF.exec(html) ?? JOB_POST_CLASS.exec(html);
  if (!m) return null;
  const word = m[1] ?? m[2] ?? "";
  try {
    return decodeURIComponent(word).toLowerCase();
  } catch {
    return word.toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// The listing probe (developer's report 2026-10-18, item 5): triage counted
// menus, carousels and grids as the job list, missed an unknown vendor's
// iframe, labelled wordpress-job-cpt from a word list alone, and reported an
// iframe address with "&amp;" left in.
// ---------------------------------------------------------------------------

/** One member of a cluster of same-classed siblings, as the page reports it. */
export type ClusterMember = {
  /** Words in the member's first link or heading text (its own included); 0 when it has none. */
  words: number;
  /** Inside a <nav>, a <footer> or a [role=navigation]. */
  navOrFooter: boolean;
};
export type PageCluster = { sig: string; members: ClusterMember[] };
export type PageFrame = { src: string; height: number };
export type ListingProbe = { clusters: PageCluster[]; frames: PageFrame[] };

/** A member looks like a job: a link or heading of 3 to 12 words, not a menu item. */
export function jobLikeMember(m: ClusterMember): boolean {
  return !m.navOrFooter && m.words >= 3 && m.words <= 12;
}

/**
 * The largest cluster most of whose members look like jobs (more than half),
 * or 0. A menu (one- and two-word items, in a nav), a logo carousel and a grid
 * of cards with no title link are not counted.
 */
export function jobLikeClusterSize(clusters: PageCluster[]): number {
  let best = 0;
  for (const c of clusters) {
    const n = c.members.length;
    if (n < 2 || n > 500) continue;
    const jobLike = c.members.filter(jobLikeMember).length;
    if (jobLike * 2 > n && n > best) best = n;
  }
  return best;
}

/**
 * Collected in the page by page.evaluate(LISTING_PROBE_JS): every element with
 * a class grouped by parent tag, tag and sorted classes (the same signature as
 * before), each member with its link-or-heading word count and whether it sits
 * in a nav or footer; and every iframe with its src and rendered height.
 * A string, so tsx's keepNames cannot inject __name into the page; String.raw,
 * so the regex's backslash reaches the page as written.
 */
export const LISTING_PROBE_JS = String.raw`(() => {
  const groups = {};
  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (!el.parentElement || !el.classList.length) continue;
    const sig = el.parentElement.tagName + ">" + el.tagName + "." + Array.from(el.classList).sort().join(".");
    (groups[sig] = groups[sig] || []).push(el);
  }
  const clusters = [];
  for (const sig of Object.keys(groups)) {
    const els = groups[sig];
    if (els.length < 2 || els.length > 500) continue;
    clusters.push({
      sig,
      members: els.map((el) => {
        const t = el.matches("a,h1,h2,h3,h4,h5,h6") ? el : el.querySelector("a,h1,h2,h3,h4,h5,h6");
        const text = t ? (t.textContent || "").trim() : "";
        return { words: text ? text.split(/\s+/).length : 0, navOrFooter: !!el.closest("nav,footer,[role=navigation]") };
      }),
    });
  }
  const frames = Array.from(document.querySelectorAll("iframe")).map((f) => ({
    src: f.getAttribute("src") || "",
    height: Math.round(f.getBoundingClientRect().height),
  }));
  return { clusters, frames };
})()`;

/** The HTML entities an attribute value carries: &amp; &quot; &#39; &lt; &gt; and numeric ones. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Iframes that are never a jobs board, however tall: video, maps, social, ads, captcha. */
const NOT_A_BOARD_FRAME =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com|google\.com|google\.co\.il|googletagmanager\.com|doubleclick\.net|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|waze\.com|spotify\.com|soundcloud\.com|recaptcha\.net)$/i;
/** Taller than this, a cross-origin iframe is reported as an embedded board. */
export const BOARD_FRAME_MIN_HEIGHT = 300;

export type EmbeddedBoard = { url: string; vendor: string; recipe: string | null };

/**
 * The embedded board among the page's iframes: a known ATS host at any size
 * first (`known` maps a host to its vendor and recipe), else the first
 * cross-origin iframe taller than 300 px that is not video, maps or social, as
 * vendor "unknown-iframe" (TalentFlow on mega-talents). The address is
 * entity-decoded ("&amp;" -> "&": elmomc's next run broke on it).
 */
export function embeddedBoardFrom(
  frames: PageFrame[],
  pageHost: string,
  known: (host: string) => { vendor: string; recipe: string } | null,
): EmbeddedBoard | null {
  const parsed: Array<{ url: string; host: string; height: number }> = [];
  for (const f of frames) {
    let src = decodeHtmlEntities((f.src || "").trim());
    if (src.startsWith("//")) src = "https:" + src;
    try {
      const u = new URL(src);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (u.hostname.toLowerCase() === pageHost.toLowerCase()) continue;
      parsed.push({ url: src, host: u.hostname.toLowerCase(), height: f.height });
    } catch {
      continue;
    }
  }
  for (const p of parsed) {
    const k = known(p.host);
    if (k) return { url: p.url, vendor: k.vendor, recipe: k.recipe };
  }
  for (const p of parsed) {
    if (p.height > BOARD_FRAME_MIN_HEIGHT && !NOT_A_BOARD_FRAME.test(p.host)) return { url: p.url, vendor: "unknown-iframe", recipe: null };
  }
  return null;
}

/**
 * True when a /wp-json/wp/v2/types answer lists a post type whose slug or name
 * carries a job word (JOB_POST_TYPE_WORDS and the Hebrew ones). Word-list
 * evidence on the page alone is not enough (bynet: no such type existed).
 */
export function wpTypesHaveJobType(types: unknown): boolean {
  if (!types || typeof types !== "object") return false;
  const words = new Set<string>([...JOB_POST_TYPE_WORDS, ...HEBREW_JOB_POST_TYPE_WORDS]);
  for (const t of Object.values(types as Record<string, unknown>)) {
    if (!t || typeof t !== "object") continue;
    const rec = t as { slug?: unknown; name?: unknown };
    for (const v of [rec.slug, rec.name]) {
      if (typeof v !== "string") continue;
      let s = v;
      try {
        s = decodeURIComponent(v);
      } catch {
        /* keep it as written */
      }
      if (s.toLowerCase().split(/[^\p{L}]+/u).some((tok) => words.has(tok))) return true;
    }
  }
  return false;
}
