import { chromium } from "playwright";

const DETAIL = "https://www.one1.co.il/careers/?job_id=2394";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.goto(DETAIL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(3000);

  const probe = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".accordion_item"));
    const target = items.find((it) =>
      (it.querySelector(".send-resume")?.getAttribute("data-job_id") ?? "") === "2394",
    );
    const active = document.querySelector(".accordion_item.item_active");
    return {
      itemCount: items.length,
      targetFound: !!target,
      targetTitle: target?.querySelector(".job_title")?.textContent?.trim().slice(0, 80),
      targetDescLen: (target?.querySelector(".accordion_content .content")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim().length,
      targetDescPreview: (target?.querySelector(".accordion_content .content")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120),
      activeTitle: active?.querySelector(".job_title")?.textContent?.trim().slice(0, 80),
      firstDescLen: (document.querySelector(".accordion_content .content")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim().length,
      firstDescPreview: (document.querySelector(".accordion_content .content")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120),
    };
  });
  console.log(JSON.stringify(probe, null, 2));
  await b.close();
})();
