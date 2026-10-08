// Job.contentHash (owner, 2026-10-08). The public site refreshes a job's title
// and description only when told; it compares this value with the one it
// stored last time.
//
// SHA-256 of the UTF-8 bytes of: the title trimmed, a newline, the description
// trimmed ("" when NULL). Hex, lowercase, 64 characters. A pure function of the
// row's own values: nothing is carried from a previous row, and a NULL
// description hashes like an empty one.

import { createHash } from "node:crypto";

export function jobContentHash(title: string, description: string | null): string {
  const text = `${title.trim()}\n${(description ?? "").trim()}`;
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}
