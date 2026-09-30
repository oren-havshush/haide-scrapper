// Step A backfill: the reviewed list of first dates per site.
//
// The list (first_dates_proposed.tsv) was built read-only on the box and shown
// to the owner before any write: firstActiveAt is the earlier of today's
// activeAt and the earliest backup's, firstScrapedAt the earliest COMPLETED run
// with jobs. The tool applies exactly that list and derives nothing, so the
// parser refuses anything it cannot read unambiguously. Columns are found by
// name; dates are the database's own timestamp(3) text, which Prisma stores as
// UTC.

export type FirstDatesRow = { id: string; firstActiveAt: Date | null; firstScrapedAt: Date | null };

const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

export function parseFirstDatesList(tsv: string): { rows: FirstDatesRow[]; errors: string[] } {
  const TAB = String.fromCharCode(9);
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  const header = (lines[0] ?? "").split(TAB);
  const col = (name: string) => header.indexOf(name);
  const iId = col("id");
  const iActive = col("PROPOSED_firstActiveAt");
  const iScraped = col("PROPOSED_firstScrapedAt");
  if (iId < 0 || iActive < 0 || iScraped < 0) {
    return { rows: [], errors: ["the header must name id, PROPOSED_firstActiveAt and PROPOSED_firstScrapedAt"] };
  }

  const rows: FirstDatesRow[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = line.split(TAB);
    const id = (cells[iId] ?? "").trim();
    if (!id) {
      errors.push(`a row with no id: ${line.slice(0, 60)}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${id}: listed twice`);
      continue;
    }
    seen.add(id);
    const date = (name: string, raw: string | undefined): Date | null | "bad" => {
      const v = (raw ?? "").trim();
      if (!v) return null;
      if (!DATE.test(v)) {
        errors.push(`${id}: ${name} is not a timestamp (${v})`);
        return "bad";
      }
      return new Date(`${v.replace(" ", "T")}Z`);
    };
    const a = date("PROPOSED_firstActiveAt", cells[iActive]);
    const s = date("PROPOSED_firstScrapedAt", cells[iScraped]);
    if (a === "bad" || s === "bad") continue;
    rows.push({ id, firstActiveAt: a, firstScrapedAt: s });
  }
  return { rows, errors };
}
