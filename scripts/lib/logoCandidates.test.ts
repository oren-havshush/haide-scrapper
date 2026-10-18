// Run: npx tsx scripts/lib/logoCandidates.test.ts
//
// The company-profile logo candidates (developer's report 2026-10-18, item 3):
// a brand from a carousel, a customer's logo, the group's logo or a portrait
// was published as the employer's. A candidate inside a slider, carousel,
// clients, partners, brands, customers or logos container is dropped; an image
// narrower than 1:2 is dropped; among the rest the header or nav logo that
// links home wins.

import { collectLogoCandidates, emptyHarvest, type HarvestedImage, type PageHarvest } from "./company-extract";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const PAGE = "https://www.acme.co.il/";
const img = (over: Partial<HarvestedImage>): HarvestedImage => ({ src: "", alt: "", width: 180, height: 60, inHeader: false, context: "", ...over });

// A header logo that links home, and a swiper strip of client logos below it.
{
  const harvest: PageHarvest = {
    ...emptyHarvest(PAGE),
    images: [
      img({ src: "/clients/teva-logo.png", alt: "teva logo", ancestry: "img[teva logo] < div.swiper-slide < div.swiper-wrapper < div.swiper < section.home-clients", link: null }),
      img({ src: "/clients/elbit-logo.png", alt: "elbit logo", ancestry: "img[elbit logo] < div.slick-slide < div.slick-track < section.customers", link: null }),
      img({ src: "/img/acme-logo.png", alt: "Acme logo", inHeader: true, context: "site-logo", ancestry: "img[acme logo] < a.navbar-brand < div.container < nav.navbar < header.site-header", link: "/" }),
      img({ src: "/brands/subsidiary-logo.png", alt: "logo", ancestry: "img[logo] < li < ul < div.our-brands < footer", link: null }),
      img({ src: "/partners/vendor-logo.png", alt: "logo", ancestry: "img[logo] < div.logos-strip < section", link: null }),
    ],
  };
  const urls = collectLogoCandidates(harvest, null).map((c) => c.url);
  assert(urls[0] === "https://www.acme.co.il/img/acme-logo.png", `the header logo that links home wins (got ${JSON.stringify(urls)})`);
  assert(!urls.some((u) => /teva|elbit/.test(u)), "the swiper and slick client logos are dropped before scoring");
  assert(!urls.some((u) => /subsidiary|vendor/.test(u)), "a brands or logos strip is dropped");
}

// The header home logo wins over the JSON-LD claim and over a footer logo.
{
  const harvest: PageHarvest = {
    ...emptyHarvest(PAGE),
    images: [
      img({ src: "/img/footer-logo.png", alt: "logo", context: "footer-logo", ancestry: "img[logo] < div.footer-logo < footer", link: null }),
      img({ src: "/img/acme-logo.png", alt: "Acme logo", inHeader: true, context: "site-logo", ancestry: "img[acme logo] < a.logo < header", link: "https://www.acme.co.il/" }),
    ],
  };
  // The JSON-LD logo on the site's own domain scores 10 + 3; the header home logo must still win.
  const urls = collectLogoCandidates(harvest, { logo: "https://cdn.acme.co.il/group/group-logo.png" }).map((c) => c.url);
  assert(urls[0] === "https://www.acme.co.il/img/acme-logo.png", `the header home logo outranks the JSON-LD and footer logos (got ${JSON.stringify(urls)})`);
  assert(urls.includes("https://cdn.acme.co.il/group/group-logo.png"), "the JSON-LD logo stays a candidate");
}

// A portrait narrower than 1:2 is not a logo; 1:2 itself is kept.
{
  const harvest: PageHarvest = {
    ...emptyHarvest(PAGE),
    images: [
      img({ src: "/team/ceo-logo-photo.jpg", alt: "logo", width: 80, height: 200, context: "about" }),
      img({ src: "/img/tall-logo.png", alt: "logo", width: 100, height: 200, context: "logo" }),
    ],
  };
  const urls = collectLogoCandidates(harvest, null).map((c) => c.url);
  assert(!urls.includes("https://www.acme.co.il/team/ceo-logo-photo.jpg"), "a 80x200 portrait is dropped");
  assert(urls.includes("https://www.acme.co.il/img/tall-logo.png"), "a 100x200 image (exactly 1:2) is kept");
}

// "navbar-brand" is a header's own logo, not a brands strip.
{
  const harvest: PageHarvest = {
    ...emptyHarvest(PAGE),
    images: [img({ src: "/img/acme-logo.png", alt: "logo", inHeader: true, ancestry: "img[logo] < a.navbar-brand < nav", link: "/" })],
  };
  assert(collectLogoCandidates(harvest, null).length === 1, "a.navbar-brand is not refused as a brands strip");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("logoCandidates: strips and portraits dropped; the header logo that links home wins");
