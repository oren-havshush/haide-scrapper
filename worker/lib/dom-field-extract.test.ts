// Run: npx tsx worker/lib/dom-field-extract.test.ts
//
// domFieldExtract runs inside page.evaluate against a real DOM, so this drives
// it exactly the way scrape.ts does: eval DOM_FIELD_EXTRACT_SOURCE in a real
// Chromium page. No DOM shim dependency, and no divergence between what the
// test exercises and what production runs.
//
// Regression under test: pretty-printed list markup
//   <li>\n  <p>text</p>\n</li>
// left the injected "• " separated from its text by a newline, so descriptions
// rendered with the marker orphaned on its own line ("•\ntext"). Found on
// קבוצת טובול job 624; 13 jobs across 4 ACTIVE sites carried it.

import { chromium, type Page } from "playwright";
import { DOM_FIELD_EXTRACT_SOURCE } from "./domFieldExtract";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

async function extract(page: Page, html: string): Promise<string> {
  return page.evaluate(
    (a: { html: string; src: string }) => {
      const host = document.createElement("div");
      host.innerHTML = a.html;
      document.body.appendChild(host);
      const fn = (0, eval)("(" + a.src + ")") as (
        el: Element,
        f: string,
        attr?: string,
      ) => string;
      const out = fn(host, "description");
      host.remove();
      return out;
    },
    { html, src: DOM_FIELD_EXTRACT_SOURCE },
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("about:blank");

  // --- the regression --------------------------------------------------

  const prettyPrinted = `
    <ul>
      <li>
        <p>עבודה דינאמית ומאתגרת בייעוץ ומכירה</p>
      </li>
      <li>
        <p>בתפקיד תתנהלו מול מגוון לקוחות</p>
      </li>
    </ul>`;
  const out = await extract(page, prettyPrinted);
  assert(!/[•●▪]\n/.test(out), `marker must not be orphaned — got ${JSON.stringify(out)}`);
  assert(
    out.includes("• עבודה דינאמית ומאתגרת בייעוץ ומכירה"),
    `marker joins its text — got ${JSON.stringify(out)}`,
  );
  assert(
    out.split("\n").filter((l) => l.trim()).length === 2,
    `two items -> two lines — got ${JSON.stringify(out)}`,
  );

  // --- the shape that always worked keeps working ----------------------

  const flat = "<ul><li>ניסיון במכירות- חובה</li><li>ידע בסיסי במחשב</li></ul>";
  const flatOut = await extract(page, flat);
  assert(
    flatOut.includes("• ניסיון במכירות- חובה"),
    `flat <li> keeps its marker — got ${JSON.stringify(flatOut)}`,
  );
  assert(!/[•●▪]\n/.test(flatOut), "flat <li> has no orphaned marker");

  // --- markers already in source are not doubled -----------------------

  const preMarked = await extract(page, "<ul><li>• כבר מסומן</li></ul>");
  assert((preMarked.match(/•/g) || []).length === 1, "existing marker not doubled");

  // --- deeper nesting also joins ---------------------------------------

  const nested = await extract(
    page,
    "<ul><li>\n  <div><p>טקסט מקונן עמוק</p></div>\n</li></ul>",
  );
  assert(
    nested.includes("• טקסט מקונן עמוק"),
    `nested block joins its marker — got ${JSON.stringify(nested)}`,
  );

  // --- <br> and block newlines still survive ---------------------------

  const brs = await extract(page, "<div>שורה ראשונה<br>שורה שנייה</div>");
  assert(brs.split("\n").length === 2, `<br> still yields a newline — got ${JSON.stringify(brs)}`);

  const blocks = await extract(page, "<div><p>פסקה א</p><p>פסקה ב</p></div>");
  assert(
    blocks.split("\n").filter((l) => l.trim()).length === 2,
    `blocks still yield newlines — got ${JSON.stringify(blocks)}`,
  );

  // --- prose untouched --------------------------------------------------

  const prose = await extract(page, "<div>טקסט רגיל ללא מבנה כלשהו בכלל</div>");
  assert(prose === "טקסט רגיל ללא מבנה כלשהו בכלל", `prose passes through — got ${JSON.stringify(prose)}`);

  // --- attribute mode unaffected ---------------------------------------

  const attr = await page.evaluate(
    (src: string) => {
      const a = document.createElement("a");
      a.setAttribute("href", "https://example.com/job/1");
      const fn = (0, eval)("(" + src + ")") as (el: Element, f: string, at?: string) => string;
      return fn(a, "detailUrl", "href");
    },
    DOM_FIELD_EXTRACT_SOURCE,
  );
  assert(attr === "https://example.com/job/1", "attribute extraction unaffected");

  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("PASS: all dom-field-extract assertions");
})();
