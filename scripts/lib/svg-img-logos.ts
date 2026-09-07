/**
 * scripts/lib/svg-img-logos.ts
 *
 * Rasterise header logos that ship as `<img src="…/logo.svg">`.
 *
 * The harvest in scripts/company-profile.ts already rasterises INLINE `<svg>`
 * in the header, for reasons set out there: src/lib/image-validate.ts refuses
 * SVG outright (a crafted "SVG" is a script delivery vehicle), and these marks
 * are usually below the 64px floor anyway. An `<img>` POINTING at an .svg file
 * hits exactly the same two walls, but was reachable by neither path — it is
 * not inline markup, and collectLogoCandidates() drops every .svg URL.
 *
 * The cost of that gap is not a missing logo, it is a WRONG one. On a site
 * whose own mark is an .svg `<img>`, the only candidates left are whatever else
 * carries "logo"/"לוגו" in a filename or alt — and on an importer's site that
 * is a footer strip of OTHER companies' brands. colmobil.co.il ships its own
 * mark as /_next/static/media/logo.a3993fe7.svg and a row of car marques it
 * distributes, so the capture chose OMODA: a real logo, the wrong company's.
 * Compare the natali case behind isWidgetHost() — same failure, other cause.
 *
 * This runs as its OWN page.evaluate after the main harvest rather than inside
 * it, which keeps the rule (isSvgSrc) in a pure function a unit test can reach.
 * Playwright serialises the harvest closure, so code inside it can call nothing
 * imported.
 */

import type { Page } from "playwright";
import type { InlineLogo } from "./company-extract";

/**
 * Where a logo is allowed to be. Deliberately the SAME scope as the inline-svg
 * rasteriser: an image in the header, the nav, or the home link is about as
 * strong a logo signal as a page offers, and it is what keeps a footer brand
 * strip — the whole reason this module exists — out of the results.
 */
export const SVG_IMG_LOGO_SELECTOR = "header img, nav img, a[href='/'] img";

/** Cap the work: a header with more images than this is a carousel, not a mark. */
export const MAX_SVG_IMG_LOGOS = 4;

/**
 * True when a URL points at an SVG file.
 *
 * Matched on the PATH only. A query string is routine on a CDN-served asset
 * (`?_i=AA` on this site's own Cloudinary URLs) and `.svg?v=2` is still an SVG,
 * while a `.png?fallback=x.svg` is not one. Data URLs are excluded: an
 * `<img src="data:image/svg+xml,…">` is already inline markup that needs no
 * fetch, and passing one through here would double-count it.
 */
export function isSvgSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:")) return false;
  try {
    // A relative src is legal in markup; base it on a throwaway origin so the
    // parser can still isolate the path.
    const path = new URL(trimmed, "https://placeholder.invalid/").pathname;
    return /\.svg$/i.test(path);
  } catch {
    return false;
  }
}

/**
 * Draw every header/home-link SVG `<img>` on the page into a canvas and return
 * PNG data URLs, shaped exactly like the inline-svg rasteriser's output so the
 * caller can append them to `harvest.inlineLogos` and change nothing else.
 *
 * Returns [] on any failure. A logo is a nice-to-have; a throw here would cost
 * the address and about copy too.
 */
export async function rasteriseSvgImgLogos(page: Page): Promise<InlineLogo[]> {
  try {
    const logos = await page.evaluate(
      async (args: { selector: string; max: number }) => {
        const out: { dataUrl: string; pathCount: number; area: number }[] = [];

        const found = Array.from(
          document.querySelectorAll(args.selector),
        ) as HTMLImageElement[];

        // Everything below is deliberately written WITHOUT helper functions.
        // tsx compiles this file with keepNames, which wraps every named
        // function in a `__name(...)` call — a helper that does not exist in
        // the page. Playwright serialises this closure, so such a call throws
        // on the first line and the catch below would report it as "no logos
        // found", which is exactly how it fails silently. Keep it inline.
        for (const img of found) {
          if (out.length >= args.max) break;
          try {
            const src = (img.getAttribute("src") || "").trim();
            // Mirror isSvgSrc(): path only, and never an inline data: URL.
            if (!src || src.startsWith("data:")) continue;
            const resolved = new URL(src, location.href);
            if (!/\.svg$/i.test(resolved.pathname)) continue;

            // Cross-origin pixels taint the canvas and make toDataURL() throw.
            // Skip early rather than relying on the catch, so one CDN-hosted
            // mark cannot eat the budget that a same-origin one needed.
            if (resolved.origin !== location.origin) continue;

            // Intrinsic size — the rendered box is the wrong source, since CSS
            // routinely shrinks the mark.
            const width = img.naturalWidth;
            const height = img.naturalHeight;
            if (!width || !height) continue;

            // Clear the 64px floor with room to spare on the SHORTER side,
            // the same way the inline-svg path does. Vector, so lossless.
            const scale = Math.max(1, Math.ceil(256 / Math.min(width, height)));
            const targetW = Math.round(width * scale);
            const targetH = Math.round(height * scale);
            if (targetW > 4_000 || targetH > 4_000) continue;

            // The element is already decoded and on screen, so it can be drawn
            // straight to the canvas — no second fetch, which also means the
            // site's WAF cannot 403 it the way it does a bare asset request.
            const canvas = document.createElement("canvas");
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.drawImage(img, 0, 0, targetW, targetH);

            // The SVG's internals are not in this document, so <path> count —
            // which is how collectLogoCandidates() tells a full lockup from a
            // bare glyph — has to be read from the file itself. Same-origin,
            // and already in the browser cache from rendering the <img>.
            //
            // Leaving this at 0 is NOT a neutral default: the ranking is
            // `pathCount desc, then area desc`, so a 0 would put a real lockup
            // below every inline glyph on the page. That is precisely what it
            // did on colmobil.co.il — the header ships an inline circular "O"
            // glyph AND the full "כלמוביל Colmobil" lockup as this <img>, and
            // the glyph won a comparison it should have lost.
            let pathCount = 0;
            try {
              const markup = await (await fetch(resolved.href)).text();
              pathCount = (markup.match(/<path\b/gi) || []).length;
            } catch {
              // Ordering signal only — a logo with an unknown count still
              // beats no logo at all.
            }

            out.push({
              dataUrl: canvas.toDataURL("image/png"),
              pathCount,
              area: Math.round(width * height),
            });
          } catch {
            // One unrasterisable image must not cost the others.
          }
        }

        return out;
      },
      { selector: SVG_IMG_LOGO_SELECTOR, max: MAX_SVG_IMG_LOGOS },
    );

    return logos as InlineLogo[];
  } catch {
    return [];
  }
}
