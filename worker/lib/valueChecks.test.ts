// Run: npx tsx worker/lib/valueChecks.test.ts
//
// apply_replay_token (step 2a/2b, owner 2026-10-01): an apply form whose
// captured fields include a PER-SESSION value — a nonce, an anti-forgery token,
// a captcha response — cannot be submitted server-side by replaying what was
// captured. The operator is told which fields. Static values (Elementor's
// form_id) and per-job values (queried_id, post_id) are replayable and are not
// flagged. The rule is on the field NAME, so it works on forms captured before
// values were.

import { applyReplayTokenFinding, applyReplayTokenWarning, perSessionFieldNames } from "./valueChecks";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const f = (...names: string[]) => names.map((name) => ({ name }));

// medulla (Elementor): only the nonce is per-session.
eq(
  perSessionFieldNames(f("post_id", "form_id", "queried_id", "form_fields[Job]", "_wpnonce", "form_fields[name]")),
  ["_wpnonce"],
  "medulla: _wpnonce is flagged; post_id, form_id, queried_id and form_fields[Job] are not",
);
// isrotel (Umbraco) and the other anti-forgery and captcha names.
eq(perSessionFieldNames(f("ufprt", "area", "job")), ["ufprt"], "isrotel: ufprt");
eq(
  perSessionFieldNames(f("__RequestVerificationToken", "csrf_token", "_csrf", "_token", "security_nonce")),
  ["__RequestVerificationToken", "csrf_token", "_csrf", "_token", "security_nonce"],
  "anti-forgery tokens and any *nonce* name",
);
eq(
  perSessionFieldNames(f("g-recaptcha-response", "_wpcf7_recaptcha_response", "cf-turnstile-response")),
  ["g-recaptcha-response", "_wpcf7_recaptcha_response", "cf-turnstile-response"],
  "captcha responses",
);
eq(
  perSessionFieldNames(f("_wpcf7_container_post", "job_id", "token_type", "tokens", "phone")),
  [],
  "per-job and ordinary names are not flagged (a CF7 container post, a job id, a 'token_type')",
);

// Across a run's jobs: one finding, the names union, the jobs counted.
{
  const blob = (...names: string[]) => JSON.stringify({ actionUrl: "a", method: "POST", fields: f(...names) });
  const finding = applyReplayTokenFinding([
    blob("post_id", "_wpnonce"),
    blob("post_id", "_wpnonce"),
    blob("form_id"),
    undefined,
    "not json",
  ]);
  eq(finding, { code: "apply_replay_token", field: "APPLY", count: 2, names: ["_wpnonce"] }, "two jobs carry a per-session field");
  eq(applyReplayTokenFinding([blob("form_id"), null]), null, "no per-session field: no finding");
  eq(
    finding ? applyReplayTokenWarning(finding) : "",
    "apply_replay_token: 2 job(s) carry per-session apply fields (_wpnonce) — cannot be replayed by a server-side submit",
    "the warning names the fields and says why",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("valueChecks: per-session apply fields flagged by name; static and per-job values are not");
