import type { Page } from "playwright";

/**
 * Login / account-creation wall detection for apply flows.
 *
 * The product auto-submits applications on the candidate's behalf. A site
 * whose "Apply" path forces the candidate to sign in or create an account
 * before the application form is even reachable (the classic Workday / Greenhouse
 * "Create Account/Sign In" gate) is useless for auto-apply — submitting is
 * impossible without credentials. Rather than burning scrape budget on such
 * sites, we flag them at onboarding (capture-form) and SKIP them at the worker.
 *
 * This module centralises the strong-signal heuristic so the onboarding capture
 * script and the worker share one definition of "login-gated".
 */

/** Human-readable note written to Site.adminNote / ScrapeRun.error on skip. */
export const APPLY_LOGIN_SKIP_NOTE =
  "Auto-skipped: applying requires sign-in / account creation (login-gated apply flow), which is incompatible with auto-submit.";

/** Stable failureCategory tag for skipped-due-to-login scrape runs. */
export const APPLY_LOGIN_FAILURE_CATEGORY = "apply_requires_login";

/** URL path segments that indicate a login / registration / SSO page. */
const LOGIN_URL_RE =
  /\/(login|log-in|signin|sign-in|sign_in|register|signup|sign-up|sign_up|create-account|createaccount|auth|authentication|sso|oauth2?)(\/|\?|#|$)/i;

/** Third-party identity hosts an apply flow may bounce to. */
const OAUTH_HOST_RE =
  /(accounts\.google\.|login\.microsoftonline\.|github\.com\/login|linkedin\.com\/(oauth|uas\/login)|\.okta\.com|\.auth0\.com|\.onelogin\.com|login\.salesforce\.)/i;

/** Login / account-creation call-to-action copy (EN + HE). */
const LOGIN_CTA_RE =
  /\b(sign in|log ?in|create an? account|register now|sign up)\b|התחבר|הרשמ|צור חשבון/i;

export interface ApplyGateVerdict {
  requiresLogin: boolean;
  /** Short machine reason, e.g. "login-url", "password-field". null when clear. */
  signal: string | null;
}

/** Cheap URL-only check — no DOM access required. */
export function urlLooksLikeLogin(url: string): boolean {
  return LOGIN_URL_RE.test(url) || OAUTH_HOST_RE.test(url);
}

/**
 * Inspect the page currently sitting on the apply destination and decide
 * whether reaching the application form requires login / account creation.
 *
 * Strong signals (any one ⇒ requiresLogin):
 *  1. The current URL is a login / registration / SSO page.
 *  2. The page contains a password input (sign-in or create-account form).
 *  3. Workday-style sign-in / create-account automation ids are present.
 *  4. A login / registration CTA is present AND there is no genuine
 *     application form on the page.
 *
 * The CTA branch (4) is intentionally gated on the ABSENCE of a real apply
 * form. A genuine application form is recognised by a file-upload input paired
 * with an email or text/textarea field (CV upload + contact details). This
 * prevents false-positives on sites that merely surface a "Sign in" link in
 * the header while still exposing a public application form (e.g. civi,
 * tmuralife), which we verified empirically clear with this detector.
 *
 * Must only be called when the page is already positioned ON the apply
 * destination (after following the "Apply" CTA), not on arbitrary listing or
 * detail pages.
 */
export async function detectApplyLoginWall(page: Page): Promise<ApplyGateVerdict> {
  if (urlLooksLikeLogin(page.url())) {
    return { requiresLogin: true, signal: "login-url" };
  }

  const dom = await page.evaluate(() => {
    const passwordInputs = document.querySelectorAll('input[type="password"]').length;

    const signInAutomation = !!document.querySelector(
      [
        '[data-automation-id="signInContent"]',
        '[data-automation-id="signInLink"]',
        '[data-automation-id="signInSubmitButton"]',
        '[data-automation-id="createAccountLink"]',
        '[data-automation-id="createAccountSubmitButton"]',
        '[data-automation-id="createAccountCheckbox"]',
      ].join(","),
    );

    let hasApplyForm = false;
    for (const f of Array.from(document.querySelectorAll("form"))) {
      const file = f.querySelectorAll('input[type="file"]').length;
      const email = f.querySelectorAll('input[type="email"]').length;
      const textish = f.querySelectorAll(
        'input[type="text"],input:not([type]),textarea',
      ).length;
      if (file > 0 && (email > 0 || textish > 0)) {
        hasApplyForm = true;
        break;
      }
    }

    const bodyText = (document.body?.textContent || "")
      .replace(/\s+/g, " ")
      .slice(0, 6000);

    return { passwordInputs, signInAutomation, hasApplyForm, bodyText };
  });

  if (dom.passwordInputs > 0) {
    return { requiresLogin: true, signal: `password-field(${dom.passwordInputs})` };
  }
  if (dom.signInAutomation) {
    return { requiresLogin: true, signal: "signin-automation-id" };
  }
  if (!dom.hasApplyForm && LOGIN_CTA_RE.test(dom.bodyText)) {
    return { requiresLogin: true, signal: "login-cta-no-apply-form" };
  }
  return { requiresLogin: false, signal: null };
}
