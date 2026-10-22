// Run: npx tsx scripts/lib/logoBackgroundPass.test.ts
//
// The pass over stored logos (report fixes 3, item 19): per site, would
// change / unchanged / unreadable; without apply not one byte in the logo
// directory changes; with apply the composite and the .orig copy are written
// through storeLogo, and a webp logo's path moves to .png. A second pass finds
// nothing to do. Synthetic images, built with sharp.

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const W = 200;
const H = 100;
let seed = 7;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256;

/** A mark on the middle quarter; transparent pixels hide noise so every file clears 512 bytes. */
function raw(mark: number[], field: "clear" | "white"): Buffer {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inMark = x >= 50 && x < 150 && y >= 25 && y < 75;
      out.set(inMark ? mark : field === "white" ? [255, 255 - (x % 30), 255, 255] : [next(), next(), next(), 0], (y * W + x) * 4);
    }
  }
  return out;
}
const img = (b: Buffer) => sharp(b, { raw: { width: W, height: H, channels: 4 } });

function snapshot(dir: string): string {
  return readdirSync(dir)
    .sort()
    .map((f) => `${f}:${readFileSync(join(dir, f)).toString("base64")}`)
    .join("|");
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), "logo-pass-"));
  process.env.COMPANY_LOGO_DIR = dir;
  const { passOneLogo } = await import("./logoBackgroundPass");

  const A = "cmlogopass000000000000000a"; // white on transparent png
  const B = "cmlogopass000000000000000b"; // dark on transparent png
  const C = "cmlogopass000000000000000c"; // jpg
  const D = "cmlogopass000000000000000d"; // white on transparent webp
  const E = "cmlogopass000000000000000e"; // a path that is not this site's
  const F = "cmlogopass000000000000000f"; // no file
  writeFileSync(join(dir, `${A}.png`), await img(raw([255, 255, 255, 255], "clear")).png({ compressionLevel: 0 }).toBuffer());
  writeFileSync(join(dir, `${B}.png`), await img(raw([30, 30, 30, 255], "clear")).png({ compressionLevel: 0 }).toBuffer());
  writeFileSync(join(dir, `${C}.jpg`), await img(raw([255, 255, 255, 255], "white")).jpeg({ quality: 100 }).toBuffer());
  writeFileSync(join(dir, `${D}.webp`), await img(raw([255, 255, 255, 255], "clear")).webp({ lossless: true, exact: true }).toBuffer());
  const sites = [
    { id: A, companyLogoPath: `/logos/${A}.png` },
    { id: B, companyLogoPath: `/logos/${B}.png` },
    { id: C, companyLogoPath: `/logos/${C}.jpg` },
    { id: D, companyLogoPath: `/logos/${D}.webp` },
    { id: E, companyLogoPath: `/logos/${A}.png` },
    { id: F, companyLogoPath: `/logos/${F}.png` },
  ];

  // The dry run: verdicts, and not one byte written.
  const before = snapshot(dir);
  const dry = new Map<string, Awaited<ReturnType<typeof passOneLogo>>>();
  for (const s of sites) dry.set(s.id, await passOneLogo(s, false));
  assert(snapshot(dir) === before, "the dry run writes nothing in the logo directory");
  assert(dry.get(A)?.verdict === "would change", `A, white on transparent: would change (${dry.get(A)?.verdict} ${dry.get(A)?.detail})`);
  assert(dry.get(A)?.note === "logo: light on transparent, stored on #1F2937", `A: the note line (${dry.get(A)?.note})`);
  assert(dry.get(B)?.verdict === "unchanged", `B, dark on transparent: unchanged (${dry.get(B)?.verdict})`);
  assert(dry.get(C)?.verdict === "unchanged", `C, jpg: unchanged (${dry.get(C)?.verdict})`);
  assert(dry.get(D)?.verdict === "would change", `D, white on transparent webp: would change (${dry.get(D)?.verdict} ${dry.get(D)?.detail})`);
  assert(dry.get(E)?.verdict === "unreadable", `E, another site's path: unreadable (${dry.get(E)?.verdict})`);
  assert(dry.get(F)?.verdict === "unreadable", `F, no file: unreadable (${dry.get(F)?.verdict})`);
  assert(!dry.get(A)?.newLogoPath && !dry.get(D)?.newLogoPath, "the dry run proposes no path write");

  // The apply run.
  const origA = readFileSync(join(dir, `${A}.png`));
  const origD = readFileSync(join(dir, `${D}.webp`));
  const a = await passOneLogo(sites[0]!, true);
  const d = await passOneLogo(sites[3]!, true);
  const b = await passOneLogo(sites[1]!, true);
  assert(a.verdict === "changed" && !a.newLogoPath, `A: changed, the path stays .png (${a.verdict}, ${a.newLogoPath})`);
  assert(Buffer.compare(readFileSync(join(dir, `${A}.orig.png`)), origA) === 0, "A: the original kept as .orig.png");
  const { data, info } = await sharp(readFileSync(join(dir, `${A}.png`))).raw().toBuffer({ resolveWithObject: true });
  assert(Array.from(data.subarray(0, 3)).join(",") === "31,41,55" && info.channels === 3, "A: the stored file is on #1F2937");
  assert(d.verdict === "changed" && d.newLogoPath === `/logos/${D}.png`, `D: changed, the path moves to .png (${d.newLogoPath})`);
  assert(Buffer.compare(readFileSync(join(dir, `${D}.orig.webp`)), origD) === 0, "D: the original kept as .orig.webp");
  assert(b.verdict === "unchanged", "B: unchanged on apply too");

  // A second pass, with the paths as the first one left them: nothing to do.
  const again = await passOneLogo(sites[0]!, false);
  assert(again.verdict === "unchanged" && /already on #1F2937/.test(again.detail), `A again: unchanged, already on the background (${again.detail})`);
  const againD = await passOneLogo({ id: D, companyLogoPath: `/logos/${D}.png` }, false);
  assert(againD.verdict === "unchanged", `D again, from its .orig: unchanged (${againD.detail})`);

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("logoBackgroundPass: dry run writes nothing; apply composites with the original kept; a second pass is a no-op");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
