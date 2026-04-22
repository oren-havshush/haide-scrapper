import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

function resolveBundledChromiumExecutable(): string | undefined {
  const explicitPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  // Prefer full Chromium over headless-shell — dynamic/SPA sites need a
  // real renderer to execute JS and produce the final DOM.
  const fullChromiumFolder =
    process.platform === "darwin"
      ? process.arch === "arm64"
        ? "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
        : "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      : process.platform === "linux"
        ? "chrome-linux64/chrome"
        : "chrome-win64/chrome.exe";

  const headlessShellFolder =
    process.platform === "darwin"
      ? process.arch === "arm64"
        ? "chrome-headless-shell-mac-arm64/chrome-headless-shell"
        : "chrome-headless-shell-mac-x64/chrome-headless-shell"
      : process.platform === "linux"
        ? "chrome-headless-shell-linux64/chrome-headless-shell"
        : "chrome-headless-shell-win64/chrome-headless-shell.exe";

  const baseCandidates = [
    path.join(
      process.cwd(),
      "node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/.local-browsers",
    ),
    path.join(process.cwd(), "node_modules/playwright-core/.local-browsers"),
  ];

  // Try full Chromium first, then fall back to headless shell
  for (const base of baseCandidates) {
    if (!fs.existsSync(base)) continue;
    const entries = fs.readdirSync(base, { withFileTypes: true });

    // Full Chromium
    const chromiumDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("chromium-"))
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const dir of chromiumDirs) {
      const candidate = path.join(base, dir, fullChromiumFolder);
      if (fs.existsSync(candidate)) return candidate;
    }

    // Headless shell fallback
    const headlessDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("chromium_headless_shell-"))
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const dir of headlessDirs) {
      const candidate = path.join(base, dir, headlessShellFolder);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

export async function launchBrowser(): Promise<Browser> {
  console.info("[worker] Launching Playwright browser...");
  const executablePath = resolveBundledChromiumExecutable();
  if (executablePath) {
    console.info("[worker] Using local Chromium executable:", executablePath);
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  return browser;
}

export async function createPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  return { context, page };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
    console.info("[worker] Browser closed.");
  } catch (error) {
    console.warn("[worker] Error closing browser:", error);
  }
}
