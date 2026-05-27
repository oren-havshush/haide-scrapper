import { chromium } from "playwright";

const URL = "https://www.one1.co.il/careers";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.addInitScript(
    'if(typeof __name==="undefined"){globalThis.__name=function(fn){return fn}}',
  );
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(2000);

  const info = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".accordion_item"));
    function inspect(item: Element, idx: number) {
      const content = item.querySelector(".accordion_content");
      const inner = item.querySelector(".accordion_content .content");
      return {
        idx,
        classes: item.className,
        title: (item.querySelector(".job_title")?.textContent ?? "").trim().slice(0, 50),
        hasAccordionContent: !!content,
        contentDisplay: content ? getComputedStyle(content as Element).display : null,
        contentHeight: content ? (content as HTMLElement).offsetHeight : null,
        contentHtmlLen: content?.innerHTML.length ?? 0,
        innerTextLen: inner ? (inner.textContent ?? "").trim().length : 0,
        nextSiblingTag: item.nextElementSibling?.tagName ?? null,
        nextSiblingClass: (item.nextElementSibling as HTMLElement | null)?.className ?? null,
        parentClass: item.parentElement?.className ?? null,
      };
    }
    return {
      first3: items.slice(0, 3).map((it, i) => inspect(it, i)),
      collapsedSample: items
        .map((it, i) => inspect(it, i))
        .filter((x) => x.innerTextLen === 0)
        .slice(0, 3),
      expandedSample: items
        .map((it, i) => inspect(it, i))
        .filter((x) => x.innerTextLen > 20)
        .slice(0, 3),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // Click first collapsed item's accordion_title and watch network + DOM
  const collapsedIdx = 1;
  const item = (await p.$$(".accordion_item"))[collapsedIdx];
  const beforeHtml = await item.evaluate((el) => {
    const c = el.querySelector(".accordion_content");
    return {
      classes: el.className,
      contentHtmlLen: c?.innerHTML.length ?? 0,
      innerTextLen: (el.querySelector(".accordion_content .content")?.textContent ?? "")
        .trim().length,
    };
  });
  console.log("BEFORE CLICK collapsed item:", beforeHtml);

  const [resp] = await Promise.all([
    p.waitForResponse((r) => /admin-ajax|career|job|wp-json/i.test(r.url()), { timeout: 8000 }).catch(() => null),
    item.$("a.accordion_title").then((el) => el?.click()),
  ]);
  await p.waitForTimeout(1500);
  if (resp) console.log("XHR:", resp.url(), resp.status());

  const afterHtml = await item.evaluate((el) => {
    const c = el.querySelector(".accordion_content");
    return {
      classes: el.className,
      contentHtmlLen: c?.innerHTML.length ?? 0,
      innerTextLen: (el.querySelector(".accordion_content .content")?.textContent ?? "")
        .trim().length,
      contentHtmlPreview: c?.innerHTML.slice(0, 500) ?? null,
    };
  });
  console.log("AFTER CLICK collapsed item:", afterHtml);

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
