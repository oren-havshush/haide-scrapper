// Run: npx tsx scripts/lib/logoVariants.test.ts
//
// Report fixes 3, item 14, the logo half (the developer's 2026-10-19 to 20
// and 2026-10-21 reports). The fixtures are the harvests' values as read from
// each page on 2026-10-21 (GET, no click): placement, size, link, colour.
//   - tema.co.il, gsil.co.il: the header image that links home names no
//     "logo" anywhere, so it was never a candidate (tema: none at all; gsil:
//     a smaller "Website logo" copy instead) -> a header image linking home
//     is a candidate by its placement;
//   - the larger copy of the same logo wins over the smaller;
//   - isracard.co.il: its logo is an inline SVG in one dark navy colour,
//     rgb(16,24,32), linking home and labelled "לוגו ישראכרט", refused as a
//     black silhouette -> a mark that links home and names itself a logo is
//     never a silhouette;
//   - afi-hotels.co.il: the header holds the colour logo and a white copy of
//     it; the white one won -> when the winner is light on white, a copy of
//     the same shape that reads on white is taken instead (chooseLogoVariant).

import {
  chooseLogoVariant,
  collectLogoCandidates,
  emptyHarvest,
  inlineLogoRejection,
  type HarvestedImage,
  type InlineLogo,
  type PageHarvest,
} from "./company-extract";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const img = (over: Partial<HarvestedImage>): HarvestedImage => ({ src: "", alt: "", width: 180, height: 60, inHeader: false, context: "", ...over });

// --- tema: the header image linking home, no "logo" word -----------------------------------------
{
  const TEMA = "https://www.tema.co.il/";
  const header = "https://static.wixstatic.com/media/95ec7a_6ee572c0f33042308c56335469ecfacc~mv2.png/v1/crop/x_103,y_118,w_706,h_315/fill/w_200,h_89/95ec7a.png";
  const harvest: PageHarvest = {
    ...emptyHarvest(TEMA),
    images: [
      img({ src: header, width: 200, height: 89, inHeader: true, context: "j7pobl", ancestry: "img[] < wow-image < div < a < div.wixui-image < header", link: "https://www.tema.co.il" }),
      img({ src: "https://static.wixstatic.com/media/11062b_55e4~mv2.png/v1/fill/w_37,h_37/ig.png", alt: "Instagram", width: 37, height: 37, inHeader: true, ancestry: "img[instagram] < a < li < ul.social-bar < header", link: "https://www.instagram.com/tema_jobs/" }),
    ],
  };
  const urls = collectLogoCandidates(harvest, null).map((c) => c.url);
  assert(urls[0] === header, `tema: the header image linking home is the candidate (got ${JSON.stringify(urls)})`);
  assert(!urls.some((u) => /ig\.png/.test(u)), "an icon linking elsewhere is not");
}

// --- gsil: the larger header copy over the smaller hinted one ---------------------------------------
{
  const GSIL = "https://gsil.co.il/";
  const harvest: PageHarvest = {
    ...emptyHarvest(GSIL),
    images: [
      img({ src: "https://gsil.co.il/496057_151.png", alt: "Website logo", width: 250, height: 62, inHeader: false, ancestry: "img[website logo] < div.sb_img_container < div.col-md-3 < footer", link: null }),
      img({ src: "https://gsil.co.il/496057_155.png", width: 1000, height: 248, inHeader: true, ancestry: "img[] < a.sb_inline_links < div.sb_img_container_inline < div.col-md-3 < header", link: "https://gsil.co.il/" }),
    ],
  };
  const urls = collectLogoCandidates(harvest, null).map((c) => c.url);
  assert(urls[0] === "https://gsil.co.il/496057_155.png", `gsil: the header copy linking home wins (got ${JSON.stringify(urls)})`);
  // Two copies of one shape, neither in the header: the larger first.
  const two: PageHarvest = {
    ...emptyHarvest(GSIL),
    images: [
      img({ src: "https://gsil.co.il/small-logo.png", alt: "logo", width: 250, height: 62, ancestry: "img[logo] < div < footer", link: null }),
      img({ src: "https://gsil.co.il/large-logo.png", alt: "logo", width: 1000, height: 248, ancestry: "img[logo] < div < footer", link: null }),
    ],
  };
  const t = collectLogoCandidates(two, null).map((c) => c.url);
  assert(t[0] === "https://gsil.co.il/large-logo.png", `the larger copy of the same logo over the smaller (got ${JSON.stringify(t)})`);
  const diff: PageHarvest = {
    ...emptyHarvest(GSIL),
    images: [
      img({ src: "https://gsil.co.il/a-logo.png", alt: "logo", width: 200, height: 200, ancestry: "img[logo] < div < footer", link: null }),
      img({ src: "https://gsil.co.il/b-logo.png", alt: "logo", width: 1000, height: 248, ancestry: "img[logo] < div < footer", link: null }),
    ],
  };
  assert(collectLogoCandidates(diff, null)[0]?.url === "https://gsil.co.il/a-logo.png", "two different shapes keep their order");
}

// --- isracard: one dark colour, links home, names itself a logo ---------------------------------------
{
  const ISRA = "https://www.isracard.co.il/";
  const svg = (over: Partial<InlineLogo>): InlineLogo => ({
    dataUrl: "data:image/png;base64,AAAA",
    pathCount: 8,
    area: 207 * 38,
    pathCountKnown: true,
    width: 207,
    height: 38,
    renderedWidth: 141,
    renderedHeight: 30,
    link: "https://www.isracard.co.il",
    controlDepth: -1,
    linkDepth: 2,
    ancestry: "svg.[לוגו ישראכרט מעבר לדף הבית] < div.wixui-vector-image < a.it88m3 < div.il7pq5 < header",
    colour: { sampled: 1, opaque: 1, dominantShare: 0.99, dominant: [17, 17, 34] },
    ...over,
  });
  assert(inlineLogoRejection(svg({}), ISRA) === null, `isracard's navy logo is not a silhouette (got ${inlineLogoRejection(svg({}), ISRA)})`);
  assert(
    inlineLogoRejection(svg({ ancestry: "svg.[] < div < a < header" }), ISRA) === "a single-colour black silhouette",
    "an unnamed black mark is still one",
  );
  assert(
    inlineLogoRejection(svg({ colour: { sampled: 1, opaque: 1, dominantShare: 1, dominant: [0, 0, 0] } }), ISRA) === "a single-colour black silhouette",
    "pure black, the stylesheet's default fill, is still a silhouette even named and linking home (ness-tech)",
  );
  assert(
    inlineLogoRejection(svg({ link: "https://www.isracard.co.il/business" }), ISRA) !== null,
    "named a logo but not linking home: the rule as before",
  );
  const harvest: PageHarvest = { ...emptyHarvest(ISRA), inlineLogos: [svg({})] };
  assert(collectLogoCandidates(harvest, { logo: "https://www.isracard.co.il/path-to-logo.png" })[1]?.source === "inline-svg", "and it is a candidate behind the JSON-LD claim");
}

// --- afi-hotels: the light winner gives way to the dark copy of the same shape ------------------------
{
  // The candidates in order, as fetched: the white copy (191x32, 11% clears 3:1 on white), then the colour one (190x32).
  const afi = [
    { width: 1528, height: 256, onWhite: 0.11 },
    { width: 1520, height: 256, onWhite: 0.97 },
  ];
  assert(chooseLogoVariant(afi) === 1, `afi: the colour copy (got ${chooseLogoVariant(afi)})`);
  assert(chooseLogoVariant([{ width: 948, height: 264, onWhite: 0.01 }]) === 0, "laufer: no other copy on the page, the one there is kept");
  assert(chooseLogoVariant([{ width: 400, height: 190, onWhite: 0.2 }, { width: 400, height: 400, onWhite: 0.95 }]) === 0, "a dark image of another shape is not the same logo");
  assert(chooseLogoVariant([{ width: 400, height: 190, onWhite: 0.9 }, { width: 400, height: 190, onWhite: 0.99 }]) === 0, "a winner that reads on white stays");
  assert(chooseLogoVariant([{ width: 400, height: 190, onWhite: null }, { width: 400, height: 190, onWhite: 0.99 }]) === 0, "unmeasured: kept");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("logoVariants: a header image linking home, the larger copy, a named home mark, the dark copy over the light");
