// A hand-set company field survives a recapture (owner, 2026-10-09).
//
// Site.companyOperatorFields lists the profile columns the operator set by
// hand in the dashboard's edit dialog. The dashboard routes keep it
// (src/services/siteService.ts recordOperatorFields): a non-null write adds the
// column's name, a clear removes it. scripts/company-profile.ts omits every
// listed key from the payload it saves, so the stored value stays; a repeatable
// --replace-field <name> lets a deliberate recapture of one field through, as
// --replace-logo does for the logo (scripts/lib/logo-keep.ts).
//
// The HQ city is not listed: it has its own provenance column,
// companyHqCitySource. Pure and client-safe: no imports.

export const OPERATOR_FIELD_COLUMNS = ["companyAbout", "companyHqAddress", "companyHomepageUrl"] as const;
export type OperatorFieldColumn = (typeof OPERATOR_FIELD_COLUMNS)[number];

const isOperatorColumn = (name: string): name is OperatorFieldColumn =>
  (OPERATOR_FIELD_COLUMNS as readonly string[]).includes(name);

/**
 * The list after a dashboard write. A key written with a non-blank string adds
 * its name; a key written as null or blank (which the service stores as null)
 * removes it; an absent key, and any key that is not an operator column,
 * changes nothing. Kept in column order, one entry per name.
 */
export function nextOperatorFields(current: readonly string[], written: Record<string, unknown>): string[] {
  const listed = new Set(current.filter(isOperatorColumn));
  for (const name of OPERATOR_FIELD_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(written, name)) continue;
    const value = written[name];
    if (typeof value === "string" && value.trim() !== "") listed.add(name);
    else if (value === null || (typeof value === "string" && value.trim() === "")) listed.delete(name);
  }
  return OPERATOR_FIELD_COLUMNS.filter((name) => listed.has(name));
}

/**
 * The capture's payload with every listed field's key removed (not set to null:
 * the write is presence-based, and a null would clear the hand-set value),
 * except the fields named in `replace`. Returns the payload and the names kept.
 */
export function keepOperatorFields<T extends Record<string, unknown>>(
  payload: T,
  listed: readonly string[],
  replace: readonly string[],
): { payload: Partial<T>; kept: string[] } {
  const kept = OPERATOR_FIELD_COLUMNS.filter((name) => listed.includes(name) && !replace.includes(name));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!(kept as readonly string[]).includes(key)) out[key] = value;
  }
  return { payload: out as Partial<T>, kept: [...kept] };
}

/** Every `--replace-field <name>` on the command line; an unknown name is refused. */
export function parseReplaceFields(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--replace-field") continue;
    const name = argv[i + 1] ?? "";
    if (!isOperatorColumn(name)) {
      throw new Error(`--replace-field takes one of ${OPERATOR_FIELD_COLUMNS.join(", ")} (got "${name}")`);
    }
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
