// Nightly value checks (addsite2 phase two, step 2). Pure: each returns a
// finding {code, field, count, ...} that scrape.ts writes as a
// "code: text" warning, and that step 2's fix queue will consume.
//
// apply_replay_token (step 2a, owner 2026-10-01): an apply form whose captured
// fields include a PER-SESSION value — a nonce, an anti-forgery token, a
// captcha response — cannot be submitted server-side by replaying what was
// captured. Static values (Elementor's form_id) and per-job values
// (queried_id, post_id) are replayable and are not flagged. The rule is on the
// field name, so it also works on forms captured before values were.

export type ReplayTokenFinding = { code: "apply_replay_token"; field: "APPLY"; count: number; names: string[] };

/** Names of per-session fields: nonces, anti-forgery tokens, captcha responses. */
const PER_SESSION: readonly RegExp[] = [
  /nonce/i,
  /^ufprt$/i,
  /^__RequestVerificationToken$/i,
  /^_?csrf/i,
  /^_token$/i,
  /^g-recaptcha-response$/i,
  /^_wpcf7_recaptcha_response$/i,
  /^cf-turnstile-response$/i,
];

export function perSessionFieldNames(fields: Array<{ name: string }>): string[] {
  return fields.map((f) => f.name).filter((n) => !!n && PER_SESSION.some((re) => re.test(n)));
}

/** One finding across a run's jobs: how many carry a per-session field, and which. */
export function applyReplayTokenFinding(blobs: Array<string | undefined | null>): ReplayTokenFinding | null {
  let count = 0;
  const names = new Set<string>();
  for (const raw of blobs) {
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const fields = (parsed as { fields?: unknown })?.fields;
    if (!Array.isArray(fields)) continue;
    const hit = perSessionFieldNames(fields.filter((x): x is { name: string } => typeof x?.name === "string"));
    if (hit.length === 0) continue;
    count++;
    for (const n of hit) names.add(n);
  }
  return count === 0 ? null : { code: "apply_replay_token", field: "APPLY", count, names: [...names].sort() };
}

export function applyReplayTokenWarning(f: ReplayTokenFinding): string {
  return (
    `${f.code}: ${f.count} job(s) carry per-session apply fields (${f.names.join(", ")}) — ` +
    "cannot be replayed by a server-side submit"
  );
}
