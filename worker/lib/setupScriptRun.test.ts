// Run: npx tsx worker/lib/setupScriptRun.test.ts
//
// A setupScript that breaks on a site which still returns rows is INVISIBLE.
//
// That is not hypothetical. LRN-SETUP-19: a careers.jnj.com script stopped
// matching because a doubled backslash had collapsed into a raw backspace, and
// the run reported success — every other field at 1.00, requirements at 0/22,
// verify-config green. The page said so at the time, in console, and nobody
// read it: the worker dumped console messages only when the extraction returned
// ZERO items, and this extraction returned 22.
//
// So the rule under test is unconditional. Whatever the setup-script phase
// writes to the page console at warning or error level, and whatever it throws,
// is logged — on a good run as much as a bad one, because the good-looking run
// is the one that hides this.
//
// Driven against a real Chromium page: a setupScript runs inside page.evaluate
// with its own AsyncFunction wrapper, and a mocked Page would test the mock.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { runSetupScript } from "./setupScriptRun";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

/** Run a script against a blank page and collect everything the worker logged. */
async function run(page: Page, script: string): Promise<string[]> {
  const lines: string[] = [];
  const realWarn = console.warn;
  const realInfo = console.info;
  console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.info = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await runSetupScript(page, script);
  } finally {
    console.warn = realWarn;
    console.info = realInfo;
  }
  return lines;
}

(async () => {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body><div id=a>x</div></body></html>");

    // --- the jnj case: the script runs, the page complains, the run is fine ---
    {
      const lines = await run(
        page,
        `console.warn("haide-probe: requirements block not found"); document.title = "ok";`,
      );
      const joined = lines.join("\n");
      assert(
        joined.includes("haide-probe: requirements block not found"),
        "a console.warn from the setup script is logged even though the run succeeded",
      );
      assert(
        /setupScript executed/.test(joined),
        "and the run is still reported as executed — the warning does not fail it",
      );
    }

    // --- console.error too -------------------------------------------------
    {
      const lines = await run(page, `console.error("haide-probe: selector missing");`);
      assert(
        lines.join("\n").includes("haide-probe: selector missing"),
        "a console.error from the setup script is logged",
      );
    }

    // --- an uncaught throw inside the script -------------------------------
    {
      const lines = await run(page, `throw new Error("haide-probe: boom");`);
      assert(
        lines.join("\n").includes("haide-probe: boom"),
        "a throw from the setup script is reported, not swallowed",
      );
    }

    // --- a quiet script logs no console section ----------------------------
    {
      const lines = await run(page, `document.title = "quiet";`);
      const joined = lines.join("\n");
      assert(
        /setupScript executed/.test(joined),
        "a quiet script still reports that it executed",
      );
      assert(
        !/setupScript console/.test(joined),
        "and adds no console section — 145 sites a night must not each gain a blank one",
      );
    }

    // --- console.log is NOT noise ------------------------------------------
    {
      const lines = await run(page, `console.log("haide-probe: chatty debug line");`);
      assert(
        !lines.join("\n").includes("haide-probe: chatty debug line"),
        "an ordinary console.log is not logged — only warnings, errors and throws",
      );
    }

    // --- the capture is bounded --------------------------------------------
    {
      const lines = await run(
        page,
        `for (var i = 0; i < 200; i++) console.warn("haide-probe: flood " + i);`,
      );
      const joined = lines.join("\n");
      assert(joined.includes("haide-probe: flood 0"), "a flood is still reported");
      assert(
        !joined.includes("haide-probe: flood 199"),
        "but bounded — a looping script must not fill the night's journal",
      );
    }

    // --- and the listeners do not leak into the next run -------------------
    {
      await run(page, `console.warn("haide-probe: first");`);
      const lines = await run(page, `document.title = "second";`);
      assert(
        !lines.join("\n").includes("haide-probe: first"),
        "each run reports only its own output; the listeners are detached after",
      );
    }
    // --- and scrape.ts uses THIS one ------------------------------------
    {
      const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert(
        /import \{ runSetupScript \} from "\.\.\/lib\/setupScriptRun"/.test(src),
        "scrape.ts imports runSetupScript from this module",
      );
      assert(
        !/function runSetupScript\(/.test(src),
        "and keeps no second copy of it — the copy is what would silently lose the logging",
      );
      const calls = src.split("runSetupScript(").length - 2; // minus the import line
      assert(calls >= 3, `it is called on every phase that runs a script (found ${calls})`);
    }
  } finally {
    await browser?.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nsetupScriptRun: what the setup-script phase says is logged, always");
})().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
