// Run: npx tsx src/lib/errors.test.ts
//
// A duplicate row is a conflict between two writers, not a server fault. It
// became reachable when the nightly sweep started competing with an operator
// pressing Scrape on the same site, and reported as a 500 it reads as a bug in
// the dashboard rather than as "someone got there first, retry".
//
// The check is duck-typed, so what needs testing is that it is narrow enough:
// a `code` of "P2002" on its own is not evidence of anything.

import { isUniqueConstraintError } from "./errors";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// The shape Prisma actually throws.
{
  const e = Object.assign(new Error("Unique constraint failed on the fields: (`siteId`)"), {
    code: "P2002",
    clientVersion: "6.1.0",
    meta: { target: ["siteId"] },
  });
  assert(isUniqueConstraintError(e), "a real Prisma P2002 is recognised");
}

// A plain object carrying the same code is not. Without the clientVersion
// check, any error shaped `{ code }` — an HTTP client's, a parser's — would be
// reported to the caller as a 409 it can retry, forever.
assert(
  !isUniqueConstraintError({ code: "P2002" }),
  "a bare code is not enough — clientVersion is what makes it a Prisma error",
);
assert(
  !isUniqueConstraintError({ code: "P2002", clientVersion: 6 }),
  "and clientVersion has to be the string Prisma sets, not any truthy value",
);

// Other Prisma errors keep their existing handling. P2025 (record not found) is
// a 404-shaped problem and must not be flattened into a conflict.
assert(
  !isUniqueConstraintError(
    Object.assign(new Error("not found"), { code: "P2025", clientVersion: "6.1.0" }),
  ),
  "a different Prisma code is not a conflict",
);

for (const notAnError of [null, undefined, "P2002", 42, [], new Error("plain")]) {
  assert(
    !isUniqueConstraintError(notAnError),
    `${String(notAnError)} is not a unique-constraint violation`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("errors: a duplicate row reads as a conflict, and nothing else does");
