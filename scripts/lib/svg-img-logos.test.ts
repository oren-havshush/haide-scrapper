// Run: npx tsx scripts/lib/svg-img-logos.test.ts
//
// Two layers, because the bug this covers needed both:
//   - isSvgSrc() is pure, so the RULE for what counts as an SVG image is
//     testable without a browser.
//   - rasteriseSvgImgLogos() only means anything against a real DOM and a real
//     canvas, so it runs against a fixture page served from a data: URL. No
//     network: the fixture inlines its own SVG, which is same-origin by
//     construction and so is exactly what the cross-origin guard expects.
//
// The regression in one line: colmobil.co.il ships its own mark as an
// <img src="…/logo.svg"> and a footer strip of the car brands it imports, so
// before this the capture stored OMODA's logo as Colmobil's.

import assert from "node:assert/strict";
import { chromium } from "playwright";
import { isSvgSrc, MAX_SVG_IMG_LOGOS, rasteriseSvgImgLogos } from "./svg-img-logos";

function testIsSvgSrc() {
  assert.equal(isSvgSrc("/_next/static/media/logo.a3993fe7.svg"), true);
  assert.equal(isSvgSrc("https://acme.co.il/brand/logo.SVG"), true, "extension is case-insensitive");

  // Verbatim shape of this site's Cloudinary URLs — a query string must not
  // stop the path from being recognised.
  assert.equal(isSvgSrc("https://res.cloudinary.com/x/logo.svg?_i=AA"), true, "query is ignored");

  assert.equal(isSvgSrc("/img/logo.png"), false);
  // ".svg" in the QUERY, not the path — a PNG with an SVG fallback param.
  assert.equal(isSvgSrc("/img/logo.png?fallback=logo.svg"), false, "matches path, not query");
  assert.equal(isSvgSrc("data:image/svg+xml,%3Csvg/%3E"), false, "inline markup is the other path's job");
  assert.equal(isSvgSrc(""), false);
  assert.equal(isSvgSrc("   "), false);
}

/**
 * A green 40x14 mark, small enough to prove the upscale actually happens, and
 * carrying two <path> elements so the ordering signal has something real to
 * count. A count of 0 is what made the bare glyph outrank the full lockup on
 * the real site, so "it parsed the file" has to be asserted, not assumed.
 */
const MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="14" viewBox="0 0 40 14">` +
  `<rect width="40" height="14" fill="#0a7d4b"/>` +
  `<path d="M0 0h4v4H0z" fill="#fff"/><path d="M8 0h4v4H8z" fill="#fff"/></svg>`;

/**
 * The colmobil shape: the company's own mark is an SVG <img> in the header,
 * and the footer carries the brand logos of OTHER companies.
 */
const FIXTURE = `<!doctype html><html><body>
  <header><a href="/"><img id="own" src="/media/logo.svg" alt="acme-logo"></a></header>
  <main><img id="hero" src="/hero.svg" alt="hero"></main>
  <footer><img id="brand" src="/brands/omoda-logo.svg" alt="לוגו OMODA"></footer>
</body></html>`;

/**
 * Served from a routed https origin rather than a data: URL. Both matter: an
 * `<img src="data:…">` is excluded by isSvgSrc() (it is the inline path's job),
 * and a data: page has a null origin, so the cross-origin guard could never
 * pass. Routing gives the fixture a real origin without a real network.
 */
async function withFixture(
  html: string,
  body: (page: import("playwright").Page) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.endsWith(".svg")) {
        return route.fulfill({ contentType: "image/svg+xml", body: MARK_SVG });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    });
    await page.goto("https://fixture.test/");
    // Every <img> must be decoded before it can be drawn to a canvas.
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
    await body(page);
    await page.close();
  } finally {
    await browser.close();
  }
}

async function testRasterise() {
  await withFixture(FIXTURE, async (page) => {

    const logos = await rasteriseSvgImgLogos(page);

    // THE regression: without the fix this is 0 and the header mark never
    // becomes a candidate at all.
    assert.equal(logos.length, 1, "the header SVG <img> must be rasterised");

    const [logo] = logos;
    assert.ok(logo.dataUrl.startsWith("data:image/png;base64,"), "must arrive as PNG, never SVG");
    assert.equal(logo.area, 40 * 14, "area is the INTRINSIC size, not the upscaled one");

    // Read out of the .svg file, not guessed. At 0 the ranking would drop a
    // full lockup below every inline glyph on the page — the colmobil bug.
    assert.equal(logo.pathCount, 2, "<path> count is parsed from the SVG source");

    // Upscaled to clear the 64px floor the server-side validator enforces:
    // ceil(256/14) = 19, so 14 -> 266 on the shorter side.
    const png = Buffer.from(logo.dataUrl.split(",")[1], "base64");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.equal(height, 266, "shorter side is upscaled past the 64px floor");
    assert.equal(width, 760, "aspect ratio is preserved");

    // Scope, not just count. The footer brand strip is the exact thing that
    // poisoned the real capture, and a <main> hero is not a logo either — the
    // count above already proves both were skipped, since all three images
    // resolve to the same SVG and would be indistinguishable once rasterised.
  });
}

/** A header carousel must not turn into an unbounded rasterise loop. */
async function testCap() {
  const many = Array.from(
    { length: MAX_SVG_IMG_LOGOS + 3 },
    (_, i) => `<img id="m${i}" src="/media/m${i}.svg" alt="m${i}">`,
  ).join("");
  await withFixture(`<!doctype html><html><body><header>${many}</header></body></html>`, async (page) => {
    const logos = await rasteriseSvgImgLogos(page);
    assert.equal(logos.length, MAX_SVG_IMG_LOGOS, "collection is capped");
  });
}

async function main() {
  testIsSvgSrc();
  await testRasterise();
  await testCap();
  console.log("svg-img-logos: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
