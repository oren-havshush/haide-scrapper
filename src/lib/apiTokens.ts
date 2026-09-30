// Per-operator API tokens (step B, owner, 2026-09-30).
//
// The proxy accepts API_TOKEN or any entry of API_TOKENS, a comma-separated list
// of "label:secret" (an entry without a colon is its own secret). The label is
// only for the owner reading .env: it is stripped here, never accepted as a
// token and never logged. API_TOKEN stays valid until every caller — the
// dashboard, the worker's event calls, both computers' scripts — has moved.
//
// The dashboard's token (NEXT_PUBLIC_API_TOKEN) is excluded from call recording
// and from the minutes estimate (src/services/autoFixService.ts): the owner
// browsing a site is not an operator fixing it.
//
// Pure JS, no node:crypto, so it runs wherever the proxy runs.

/** Equal strings, in time that depends only on the longer length. */
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Every accepted secret: API_TOKEN, then each API_TOKENS entry without its label. */
export function parseApiTokens(env: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  const legacy = (env.API_TOKEN ?? "").trim();
  if (legacy) out.push(legacy);
  for (const raw of (env.API_TOKENS ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const colon = entry.indexOf(":");
    const secret = (colon >= 0 ? entry.slice(colon + 1) : entry).trim();
    if (secret) out.push(secret);
  }
  return out;
}

/** The bearer token matches an accepted secret. Every entry is compared; no early exit. */
export function isAcceptedToken(token: string, accepted: readonly string[]): boolean {
  if (!token) return false;
  let ok = false;
  for (const secret of accepted) {
    const match = secret.length > 0 && constantTimeEqual(token, secret);
    ok = match || ok;
  }
  return ok;
}

/** The bearer token is the dashboard's own. */
export function isDashboardToken(token: string, dashboardToken: string | undefined): boolean {
  if (!token || !dashboardToken) return false;
  return constantTimeEqual(token, dashboardToken);
}
