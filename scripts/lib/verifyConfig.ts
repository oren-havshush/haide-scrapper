// `verify-config --expect-setup-script <file>` (addsite2 phase two, step 5,
// landmine g): verify-config could not see the setupScript, so an over-cap or
// truncated one looked saved. This compares the stored script with the file the
// operator PUT, byte for byte (UTF-8), and says where they part.

export function compareSetupScript(expected: string, stored: string | null | undefined): { ok: boolean; detail: string } {
  if (stored === null || stored === undefined || stored === "") {
    return { ok: false, detail: "no setupScript is stored" };
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(stored, "utf8");
  if (a.equals(b)) return { ok: true, detail: `${a.length} bytes match` };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return {
    ok: false,
    detail: `stored ${b.length} bytes vs file ${a.length} bytes; first difference at byte ${i}`,
  };
}
