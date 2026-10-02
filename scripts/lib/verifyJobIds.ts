// The setupScript half of `addsite-batch.ts verify-jobids` (addsite2 phase
// two, step 4). addsite3's rule: native id first; with no native id the script
// emits no id and the worker synthesises h-<haideHash(title|department|url)>.
// So an addsite3 script that hashes in the page, or skips a repeated key with
// seen[...] (silently dropping a real second posting), fails the gate. An
// untagged (addsite2) site gets the same finding as a warning only, so the
// control cohort's gate outcome is unchanged.

const RULES: Array<{ needle: string; why: string }> = [
  { needle: "haideHash(", why: "hashes the id in the page (addsite3: emit no id; the worker synthesises it)" },
  { needle: "seen[", why: "skips a repeated key with seen[...] (a real second posting is silently dropped)" },
];

export function scriptIdRules(script: string | null | undefined, tagged: boolean): { fail: string[]; warn: string[] } {
  const fail: string[] = [];
  const warn: string[] = [];
  const text = script ?? "";
  for (const r of RULES) {
    if (!text.includes(r.needle)) continue;
    const msg = `setupScript contains ${r.needle} — ${r.why}`;
    (tagged ? fail : warn).push(msg);
  }
  return { fail, warn };
}
