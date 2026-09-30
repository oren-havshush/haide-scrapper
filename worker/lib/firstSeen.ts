// Job.firstSeenAt (step A, owner, 2026-09-30).
//
// Every scrape deletes and re-creates a site's rows, so createdAt is when a job
// was LAST seen. firstSeenAt is carried from the previous row with the same
// identity — found by buildJobRows under each identity the job could have been
// stored with — and is now only for a job never seen before. A previous row
// from before the column existed carries null and takes this run's date, which
// is how existing rows get the first night's date without a backfill.

export function firstSeenFor(previous: { firstSeenAt?: Date | null } | null, now: Date): Date {
  const carried = previous?.firstSeenAt ?? null;
  // A job cannot have been first seen after now; a stored future date is wrong.
  if (!carried || carried.getTime() > now.getTime()) return now;
  return carried;
}
