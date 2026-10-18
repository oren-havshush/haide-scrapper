// Run: npx tsx worker/lib/formShapeNonce.test.ts
//
// A same-host admin-ajax.php form with a hidden "action" and a WordPress nonce
// field is ajax with that action, post_id or not (developer's report
// 2026-10-18, item 2: such a form was labelled unknown and its endpoint lost).
// A hidden action with neither post_id nor nonce stays unknown (medulla's noo
// send-email form, by design).

import { detectSubmitMechanism, type ShapeField } from "./formShape";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const PAGE = "https://www.example.co.il/jobs/driver/";
const AJAX = "https://www.example.co.il/wp-admin/admin-ajax.php";
const f = (name: string, fieldType = "text", value?: string): ShapeField => ({
  name,
  fieldType,
  tagName: "input",
  ...(value !== undefined ? { value } : {}),
});
const ajaxWith = (action: string) => ({ submitMechanism: "ajax", submitEndpoint: AJAX, submitAction: action });

for (const nonce of ["_wpnonce", "nonce", "security", "apply_job_nonce"]) {
  eq(
    detectSubmitMechanism({ actionAttribute: AJAX, pageUrl: PAGE, fields: [f("action", "hidden", "send_cv"), f(nonce, "hidden", "a1b2c3"), f("email", "email")] }),
    ajaxWith("send_cv"),
    `action + ${nonce}, posting to its own admin-ajax.php: ajax with the action`,
  );
}

eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, fields: [f("action", "hidden", "send_cv"), f("_wpnonce", "hidden", "a1b2c3")] }),
  ajaxWith("send_cv"),
  "action + nonce with no action attribute (a saved form): ajax with the action",
);

eq(
  detectSubmitMechanism({ actionAttribute: AJAX, pageUrl: PAGE, fields: [f("action", "hidden", "send_cv"), f("post_id", "hidden", "77"), f("_wpnonce", "hidden", "x")] }),
  ajaxWith("send_cv"),
  "action + post_id + nonce: ajax, as before",
);

eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, formClass: "job-send-email", fields: [f("action", "hidden", "noo_ajax_job_send_email"), f("email")] }),
  { submitMechanism: "unknown" },
  "action alone (medulla's noo send-email form): unknown",
);

eq(
  detectSubmitMechanism({ actionAttribute: "https://forms.vendor.test/wp-admin/admin-ajax.php", pageUrl: PAGE, fields: [f("action", "hidden", "send_cv"), f("_wpnonce", "hidden", "x")] }),
  { submitMechanism: "native_form" },
  "a nonce form posting to another host's admin-ajax.php is not given this host's endpoint",
);

eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, fields: [f("action", "hidden", "send_cv"), f("_wpnonce", "text", "x")] }),
  { submitMechanism: "unknown" },
  "a nonce-named field that is not hidden is not the WordPress nonce",
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("formShapeNonce: action + WordPress nonce on its own admin-ajax is ajax with the action; action alone stays unknown");
