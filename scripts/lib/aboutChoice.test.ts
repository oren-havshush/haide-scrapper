// Run: npx tsx scripts/lib/aboutChoice.test.ts
//
// Report fixes 3, item 15 (the developer's 2026-10-19 to 20 report, item 2,
// and her 2026-10-21 report): the company-profile capture chose the wrong
// about paragraph on most sites — a person's biography, a brand's text, a
// product line, a sister company, one division, an article, a values text.
// The rule now: the first paragraph, about page first, then the homepage, the
// homepage meta description and the JSON-LD description, that names the
// company as its subject (its name in the paragraph's first three words) with
// a business verb; never a paragraph about a person, a brand, a product (or a
// bullet), or a sister company (the cues copied from her report into
// scripts/lib/aboutCues.json). None qualifies: no about text.
//
// Each fixture (scripts/lib/__fixtures__/about/) is the two pages as the
// capture reads them, taken on 2026-10-21 with the capture's page read
// (headless Chromium, GET, no click), and the site's company name and
// hand-set about from the API. Nothing is fetched here.
//   - the paragraph today's rule chose (the rule as it stood: homepage prose,
//     then the about page, then JSON-LD) must lose wherever it is not the
//     hand-set one;
//   - the hand-set paragraph must win, or the capture returns nothing; two
//     sites (amit, gal-hr) get another paragraph in which the company
//     describes itself, named in the report.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractAboutText, parseJsonLdOrganization } from "./company-extract";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

type Page = { url: string; metas: Record<string, string>; jsonLd: string[]; bodyText: string } | null;
type Fixture = { slug: string; site: { companyName: string | null; storedAbout: string | null }; homepage: Page; aboutPage: Page };

const DIR = join(__dirname, "__fixtures__", "about");
const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

/** What each site's capture gives now: the hand-set text, nothing, or another self-description (a departure). */
const EXPECT: Record<string, "stored" | "nothing" | "other"> = {
  amit: "other",
  analyst: "nothing",
  att: "nothing",
  benatav: "nothing",
  delco: "nothing",
  dsit: "nothing",
  fnx: "stored",
  "gal-hr": "other",
  gsbgroup: "nothing",
  handasi: "stored",
  hcsra: "nothing",
  hilan: "nothing",
  holmesplace: "nothing",
  isracard: "nothing",
  laufer: "nothing",
  lubinski: "nothing",
  meptagon: "stored",
  midrag: "nothing",
  pandoor: "stored",
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** The rule as it stood before item 15 (scripts/company-profile.ts captureSite). */
function todaysPick(fx: Fixture): string | null {
  let about = extractAboutText(fx.homepage?.bodyText ?? "");
  const fromAbout = fx.aboutPage ? extractAboutText(fx.aboutPage.bodyText) : null;
  if (fromAbout) about = fromAbout;
  const org = parseJsonLdOrganization(fx.homepage?.jsonLd ?? []);
  if (!about && org?.description) about = org.description.slice(0, 1_200);
  return about;
}

(async () => {
  assert(fixtures.length === 19, `the 19 sites' fixtures (got ${fixtures.length})`);
  const { chooseAboutText } = await import("./company-extract");
  for (const fx of fixtures) {
    const org = parseJsonLdOrganization(fx.homepage?.jsonLd ?? []);
    const got = chooseAboutText({
      aboutText: fx.aboutPage?.bodyText ?? null,
      homeText: fx.homepage?.bodyText ?? null,
      metaDescription: fx.homepage?.metas?.description ?? null,
      jsonLdDescription: org?.description ?? null,
      names: [fx.site.companyName, fx.homepage?.metas?.["og:site_name"] ?? null, org?.name ?? null],
    });
    const text = norm(got?.text);
    const stored = norm(fx.site.storedAbout);
    const old = norm(todaysPick(fx));
    const head = (s: string) => s.slice(0, 60);
    const want = EXPECT[fx.slug];
    if (old && head(old) !== head(stored)) {
      assert(head(text) !== head(old), `${fx.slug}: today's wrong paragraph loses ("${head(old)}…")`);
    }
    if (want === "stored") assert(!!text && head(text) === head(stored), `${fx.slug}: the hand-set paragraph wins (got "${head(text)}")`);
    if (want === "nothing") assert(got === null, `${fx.slug}: no about text (got "${head(text)}" from ${got?.source})`);
    if (want === "other") assert(!!text && head(text) !== head(stored), `${fx.slug}: another self-description (got "${head(text)}")`);
  }

  // The cues on their own: a person, a brand, a product, a bullet, a sister company, each refused.
  // Every cue word comes from aboutCues.json, which was copied from her report.
  const cues = JSON.parse(readFileSync(join(__dirname, "aboutCues.json"), "utf8")) as Record<string, string[]>;
  const verb = cues.businessVerbs[0]!;
  const base = { aboutText: null, homeText: null, metaDescription: null, jsonLdDescription: null, names: ["Acme Industries"] };
  const one = (p: string) => chooseAboutText({ ...base, aboutText: p });
  const filler = "engineering services to customers across the country, with hundreds of employees.";
  assert(one(`Acme ${verb} ${filler}`)?.text.startsWith("Acme") === true, "a paragraph naming the company with a business verb is taken");
  for (const [kind, words] of [["person", cues.person], ["brand", cues.brand], ["product", cues.product], ["sisterCompany", cues.sisterCompany]] as const) {
    for (const w of words!) assert(one(`Acme ${verb} ${w} ${filler}`) === null, `a paragraph with the ${kind} cue "${w}" is not taken`);
  }
  assert(one(`- Acme ${verb} ${filler}`) === null, "a bullet is not");
  assert(one(`Welcome to our site, where we ${verb} ${filler} Acme.`) === null, "the name outside the first three words is not the subject");
  assert(chooseAboutText({ ...base, names: ["Gal HR"], aboutText: `Gal HR Finance ${verb} ${filler}` }) === null, "a Latin name followed by another capitalised word is a division, not the company");
  assert(chooseAboutText({ ...base, metaDescription: `Acme ${verb} ${filler}` })?.source === "meta description", "the meta description is a candidate");
  assert(chooseAboutText({ ...base, jsonLdDescription: "Acme Industries is a leading engineering company serving industry and government in Israel.", names: ["Acme Industries"] })?.source === "JSON-LD description", "the JSON-LD description is one, and English 'is a … company' is a business verb");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("aboutChoice: the company named as subject with a business verb, or no about text; today's wrong paragraphs lose on all 19 fixtures");
})().catch((e) => {
  console.error(`FAIL: aboutChoice test threw — ${(e as Error).message}`);
  process.exit(1);
});
