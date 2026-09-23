// Run: npx tsx src/lib/locationOverrides.test.ts
//
// A manual location override is a human's assertion about one job, and it
// outranks everything the scraper decides. It is keyed by
// `externalJobId ?? detailUrl` — which, on a site with no id mapping, is a
// synthesised `h-<hash>` seeded from the job's own fields.
//
// So an override can stop matching. halilit re-keyed 6 of its 7 jobs across one
// config change; sinaistore's ids were byte-identical across three months. The
// difference is the config, not the site, and nobody finds out either way until
// they look.
//
// An override that no longer matches is not an error — it is a row that has to
// be READABLE, so an operator can re-apply it to the right job or delete it.
// That is what the title is for, and what this decides.

import { matchOverrides, type OverrideRow, type MatchableJob } from "./locationOverrides";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL: ${msg}\n  got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    failures++;
  }
};

const ovr = (over: Partial<OverrideRow>): OverrideRow => ({
  id: "o1",
  jobKey: "k1",
  location: "חיפה",
  locations: ["חיפה"],
  jobTitle: null,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});
const job = (over: Partial<MatchableJob>): MatchableJob => ({
  id: "j1",
  title: "נציג/ת שירות",
  externalJobId: null,
  detailUrl: null,
  ...over,
});

// ---------------------------------------------------------------------------
console.log("# matching, by each of the two identities a job can have");
// ---------------------------------------------------------------------------
{
  // A native id. tikshoov's shape.
  const m = matchOverrides(
    [ovr({ jobKey: "tikshoov-4082", jobTitle: "מנהל/ת צוות" })],
    [job({ id: "j9", externalJobId: "tikshoov-4082", title: "מנהל/ת צוות למוקד חברת חשמל" })],
  );
  eq(m.length, 1, "one row out");
  eq(m[0]?.matched, true, "an override whose key is a live externalJobId matches");
  eq(m[0]?.jobId, "j9", "and carries the job it matched");

  // No id mapping: the key is the detail URL.
  const u = matchOverrides(
    [ovr({ jobKey: "https://x.test/job/7" })],
    [job({ id: "j7", detailUrl: "https://x.test/job/7" })],
  );
  eq(u[0]?.matched, true, "and so does one keyed by detailUrl");
  eq(u[0]?.jobId, "j7", "matched to the right job");
}

// ---------------------------------------------------------------------------
console.log("# the orphan — what the title is for");
// ---------------------------------------------------------------------------
{
  // halilit, after the config change that re-keyed its jobs. The override is
  // still there, still authoritative, and matches nothing.
  const m = matchOverrides(
    [ovr({ jobKey: "h-1p1cu0x", jobTitle: "מנהל/ת סניף", location: "תל אביב-יפו" })],
    [job({ id: "j1", externalJobId: "h-9zzk4b2", title: "מנהל/ת סניף" })],
  );
  eq(m[0]?.matched, false, "a re-keyed job leaves the override unmatched");
  eq(m[0]?.jobId, null, "with no job to point at");
  eq(
    m[0]?.jobTitle,
    "מנהל/ת סניף",
    "but the title it was set against is still there — which is the whole point",
  );

  // Rows written before the column existed have nothing to show, and must say
  // so rather than inventing a title from a job they do not match.
  const old = matchOverrides([ovr({ jobKey: "h-oldkey", jobTitle: null })], []);
  eq(old[0]?.matched, false, "an override from before the column is unmatched");
  eq(old[0]?.jobTitle, null, "and has no title — not a guessed one");
}

// ---------------------------------------------------------------------------
console.log("# a matched override shows the job's CURRENT title");
// ---------------------------------------------------------------------------
{
  // The stored title is what it was set against; the live one is what the job
  // is called now. When they differ, the live one is the useful one — and the
  // difference is itself worth seeing.
  const m = matchOverrides(
    [ovr({ jobKey: "x-1", jobTitle: "נציג שירות" })],
    [job({ id: "j1", externalJobId: "x-1", title: "נציג/ת שירות ומכירה" })],
  );
  eq(m[0]?.matched, true, "matched");
  eq(m[0]?.jobTitle, "נציג/ת שירות ומכירה", "the displayed title is the job's current one");
  eq(m[0]?.titleWhenSet, "נציג שירות", "and the one it was set against is kept beside it");
  eq(m[0]?.titleChanged, true, "flagged, because a retitled job is how a hash key moves");

  const same = matchOverrides(
    [ovr({ jobKey: "x-1", jobTitle: "נציג שירות" })],
    [job({ id: "j1", externalJobId: "x-1", title: "נציג שירות" })],
  );
  eq(same[0]?.titleChanged, false, "and not flagged when it has not changed");

  // Nothing to compare against is not a change.
  const noTitle = matchOverrides(
    [ovr({ jobKey: "x-1", jobTitle: null })],
    [job({ id: "j1", externalJobId: "x-1", title: "נציג שירות" })],
  );
  eq(noTitle[0]?.titleChanged, false, "a row with no stored title is not 'changed'");
  eq(noTitle[0]?.jobTitle, "נציג שירות", "it just shows the live title");
}

// ---------------------------------------------------------------------------
console.log("# ordering, and the ambiguity rule");
// ---------------------------------------------------------------------------
{
  // Orphans first: they are the ones that need a decision. Then by most
  // recently changed, because that is what an operator was last doing.
  const rows = matchOverrides(
    [
      ovr({ id: "a", jobKey: "k-a", updatedAt: new Date("2026-09-01T00:00:00Z") }),
      ovr({ id: "b", jobKey: "k-b", updatedAt: new Date("2026-09-20T00:00:00Z") }),
      ovr({ id: "c", jobKey: "gone", updatedAt: new Date("2026-08-01T00:00:00Z") }),
    ],
    [job({ id: "ja", externalJobId: "k-a" }), job({ id: "jb", externalJobId: "k-b" })],
  );
  eq(
    rows.map((r) => r.id),
    ["c", "b", "a"],
    "unmatched first, then newest edit first",
  );

  // A key that two jobs claim is left UNMATCHED rather than resolved. Showing
  // one of them would attach a human's assertion to a job they may not have
  // meant, and the override's own precedence makes that a published location.
  const dup = matchOverrides(
    [ovr({ jobKey: "same" })],
    [
      job({ id: "j1", externalJobId: "same", title: "A" }),
      job({ id: "j2", detailUrl: "same", title: "B" }),
    ],
  );
  eq(dup[0]?.matched, false, "an ambiguous key matches nothing");
  eq(dup[0]?.ambiguous, true, "and says why");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nlocationOverrides: an override that stops matching is still readable");
