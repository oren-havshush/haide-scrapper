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

// We deliberately do NOT ship a hardcoded UA default. Setting `userAgent`
// to a string that doesn't match the bundled Chromium build's actual
// version causes a Client-Hints (`sec-ch-ua-*`) mismatch which several WAFs
// (Imperva/Incapsula on tikshoov.co.il in particular) treat as a strong
// automation signal — 403 with an "Incapsula incident" challenge page.
// Letting Playwright send Chromium's own UA + self-consistent client hints
// passes most Israeli WAFs in practice. Set SCRAPE_USER_AGENT explicitly
// only when you need to impersonate a specific browser for a particular
// site, and make sure it matches the bundled Chromium major version.
const DEFAULT_LOCALE = "he-IL";
const DEFAULT_TIMEZONE = "Asia/Jerusalem";
const DEFAULT_ACCEPT_LANGUAGE = "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7";

/**
 * Parse a proxy URL like `http://user:pass@host:port` into Playwright's
 * `proxy` launch option. Returns undefined when the input is empty.
 */
function parseProxyConfig(): { server: string; username?: string; password?: string; bypass?: string } | undefined {
  const proxyUrl = process.env.SCRAPE_PROXY_URL;
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    const cfg: { server: string; username?: string; password?: string; bypass?: string } = {
      server: `${u.protocol}//${u.host}`,
    };
    if (u.username) cfg.username = decodeURIComponent(u.username);
    if (u.password) cfg.password = decodeURIComponent(u.password);
    if (process.env.SCRAPE_PROXY_BYPASS) cfg.bypass = process.env.SCRAPE_PROXY_BYPASS;
    return cfg;
  } catch (err) {
    console.warn("[worker] Invalid SCRAPE_PROXY_URL — ignoring proxy:", err);
    return undefined;
  }
}

export async function launchBrowser(): Promise<Browser> {
  console.info("[worker] Launching Playwright browser...");
  const executablePath = resolveBundledChromiumExecutable();
  if (executablePath) {
    console.info("[worker] Using local Chromium executable:", executablePath);
  }
  const locale = process.env.SCRAPE_LOCALE || DEFAULT_LOCALE;
  const proxy = parseProxyConfig();
  if (proxy) {
    console.info("[worker] Using upstream proxy:", {
      server: proxy.server,
      hasAuth: Boolean(proxy.username),
      bypass: proxy.bypass,
    });
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    proxy,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      `--lang=${locale}`,
    ],
  });
  return browser;
}

/**
 * Per-site browser-context overrides plumbed in from
 * `Site.fieldMappings._meta.browserOverrides`. Lets onboarders unblock
 * WAF-protected sites (e.g. bezeq.co.il, which TCP-resets bare headless
 * Chromium) without changing the conservative global defaults that other
 * sites (notably Imperva-protected tikshoov) depend on.
 */
export interface BrowserOverrides {
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  // When true, Playwright disables Content-Security-Policy enforcement for
  // this browsing context. Needed for sites whose page-level CSP `connect-src`
  // blocks XHR/fetch to a separate data subdomain that the setupScript needs
  // to hydrate the listing (e.g. bezeq.co.il: page is www., job data is on
  // d-api.). Maps directly to Playwright's `bypassCSP` newContext option.
  bypassCSP?: boolean;
}

export async function createPage(
  browser: Browser,
  overrides?: BrowserOverrides,
): Promise<{ context: BrowserContext; page: Page }> {
  const locale = process.env.SCRAPE_LOCALE || DEFAULT_LOCALE;
  const timezoneId = process.env.SCRAPE_TIMEZONE || DEFAULT_TIMEZONE;
  const acceptLanguage = process.env.SCRAPE_ACCEPT_LANGUAGE || DEFAULT_ACCEPT_LANGUAGE;
  // Per-site userAgent wins over SCRAPE_USER_AGENT env, which wins over
  // Playwright's bundled-Chromium default (leave context.userAgent unset).
  const overrideUA = overrides?.userAgent?.trim();
  const envUA = process.env.SCRAPE_USER_AGENT?.trim();
  const userAgent = overrideUA || envUA;

  // Per-site headers merge on top of the default Accept-Language so an
  // override can replace a specific header (e.g. send a different
  // Accept-Language for a non-IL site) without losing the others.
  const extraHTTPHeaders: Record<string, string> = {
    "Accept-Language": acceptLanguage,
    ...(overrides?.extraHeaders ?? {}),
  };

  const bypassCSP = !!overrides?.bypassCSP;

  if (
    overrideUA ||
    (overrides?.extraHeaders && Object.keys(overrides.extraHeaders).length > 0) ||
    bypassCSP
  ) {
    console.info("[worker] Applying per-site browser overrides:", {
      hasUserAgent: !!overrideUA,
      extraHeaderKeys: Object.keys(overrides?.extraHeaders ?? {}),
      bypassCSP,
    });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(userAgent ? { userAgent } : {}),
    locale,
    timezoneId,
    extraHTTPHeaders,
    bypassCSP,
  });

  // Mask obvious headless-browser fingerprints. Many Israeli sites (Cloudflare
  // / DataDome-fronted) gate content behind these checks and serve an empty
  // shell to automated visitors, which otherwise manifests as "0 items".
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", {
      get: () => ["he-IL", "he", "en-US", "en"],
    });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
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
