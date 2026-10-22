// Run: npx tsx src/lib/logoBackground.test.ts
//
// Light logos on a transparent background (report fixes 3, item 19). The
// public site renders every logo on white; a light mark on transparency is
// stored composited on one dark neutral, the original kept as
// <siteId>.orig.<ext>. Decided on the pixels: at least 25% transparent
// (alpha < 32), and the opaque pixels (alpha >= 224) light, mean luminance
// >= 0.75 with no more than 10% darker than 0.35. Everything else, and every
// jpg, is stored byte for byte as before.
//
// Every image here is synthetic, built with sharp. compressionLevel 0 keeps
// each above MIN_LOGO_BYTES.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

/** A W x H RGBA image: `field` everywhere, `mark` on the middle 100x50 (25% of the pixels). */
function rgba(field: [number, number, number, number], mark: [number, number, number, number]): Buffer {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inMark = x >= 50 && x < 150 && y >= 25 && y < 75;
      const p = inMark ? mark : field;
      out.set(p, (y * W + x) * 4);
    }
  }
  return out;
}

async function png(raw: Buffer, channels: 3 | 4 = 4): Promise<Uint8Array> {
  let img = sharp(raw, { raw: { width: W, height: H, channels: 4 } });
  if (channels === 3) img = img.removeAlpha();
  return new Uint8Array(await img.png({ compressionLevel: 0 }).toBuffer());
}

async function pixel(bytes: Buffer | Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(at, at + 3));
}

const same = (a: Buffer | Uint8Array, b: Buffer | Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), "logo-bg-"));
  process.env.COMPANY_LOGO_DIR = dir;
  const { storeLogo } = await import("./logo-store");
  const { judgeLogoPixels, LOGO_BACKGROUND, logoBackgroundNote } = await import("./logo-background");

  const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
  const WHITE: [number, number, number, number] = [255, 255, 255, 255];
  const DARK: [number, number, number, number] = [32, 32, 32, 255];

  assert(LOGO_BACKGROUND === "#1F2937", "the fleet background is #1F2937");

  // 1. A white mark on transparency: composited, the original kept.
  const site1 = "cmlogobg00000000000000001";
  const white = await png(rgba(CLEAR, WHITE));
  const s1 = await storeLogo(site1, white, "image/png");
  assert(s1.logoPath === `/logos/${site1}.png`, `white on transparent: stored as png (${s1.logoPath})`);
  assert(s1.background === "#1F2937", `white on transparent: background reported (${s1.background})`);
  const stored1 = readFileSync(join(dir, `${site1}.png`));
  assert(!same(stored1, white), "white on transparent: the stored bytes are not the original");
  const corner = await pixel(stored1, 0, 0);
  assert(corner.join(",") === "31,41,55", `white on transparent: the corner is #1F2937 (${corner})`);
  const centre = await pixel(stored1, 100, 50);
  assert(centre.join(",") === "255,255,255", `white on transparent: the mark stays white (${centre})`);
  const meta1 = await sharp(stored1).metadata();
  assert(meta1.width === W && meta1.height === H, "white on transparent: same dimensions");
  assert(meta1.hasAlpha === false, "white on transparent: the composite is opaque");
  assert(existsSync(join(dir, `${site1}.orig.png`)), "white on transparent: the .orig copy exists");
  assert(existsSync(join(dir, `${site1}.orig.png`)) && same(readFileSync(join(dir, `${site1}.orig.png`)), white), "white on transparent: .orig is the original, byte for byte");
  assert(s1.inspection.format === "png" && s1.inspection.byteLength === stored1.length, "white on transparent: the inspection describes the stored file");

  // 2. A dark mark on transparency: unchanged.
  const site2 = "cmlogobg00000000000000002";
  const dark = await png(rgba(CLEAR, DARK));
  const s2 = await storeLogo(site2, dark, "image/png");
  assert(s2.background === null, "dark on transparent: no background");
  assert(same(readFileSync(join(dir, `${site2}.png`)), dark), "dark on transparent: stored byte for byte");
  assert(!existsSync(join(dir, `${site2}.orig.png`)), "dark on transparent: no .orig");

  // 3. A white mark on an opaque white field, no alpha channel: the rule needs transparency.
  const site3 = "cmlogobg00000000000000003";
  const opaque = await png(rgba(WHITE, WHITE), 3);
  const s3 = await storeLogo(site3, opaque, "image/png");
  assert(s3.background === null, "white on opaque white: no background");
  assert(same(readFileSync(join(dir, `${site3}.png`)), opaque), "white on opaque white: stored byte for byte");
  assert(!existsSync(join(dir, `${site3}.orig.png`)), "white on opaque white: no .orig");

  // 4. A jpg passes through untouched (it cannot carry transparency).
  const site4 = "cmlogobg00000000000000004";
  // A flat jpg is under MIN_LOGO_BYTES, so the field is a light gradient.
  const textured = rgba(WHITE, WHITE);
  for (let i = 0; i < W * H; i++) textured.set([255 - (i % W) % 40, 255 - Math.floor(i / W) % 40, 255], i * 4);
  const jpg = new Uint8Array(await sharp(textured, { raw: { width: W, height: H, channels: 4 } }).jpeg({ quality: 100 }).toBuffer());
  const s4 = await storeLogo(site4, jpg, "image/jpeg");
  assert(s4.logoPath === `/logos/${site4}.jpg` && s4.background === null, "jpg: stored as jpg, no background");
  assert(same(readFileSync(join(dir, `${site4}.jpg`)), jpg), "jpg: stored byte for byte");

  // 5. A white mark on transparency as webp: the composite is png, the original keeps .webp.
  const site5 = "cmlogobg00000000000000005";
  // A flat lossless webp is a few dozen bytes, under MIN_LOGO_BYTES, and the
  // encoder drops the colour of fully clear pixels, so the transparent field is
  // noise at alpha 1-31: still transparent to the rule, kept by the encoder.
  const noisy = rgba(CLEAR, WHITE);
  let seed = 1;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256;
  for (let i = 0; i < W * H; i++) if (noisy[i * 4 + 3] === 0) noisy.set([next(), next(), next(), 1 + (next() % 31)], i * 4);
  const webp = new Uint8Array(await sharp(noisy, { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true }).toBuffer());
  assert(webp.byteLength >= 512, `webp: the fixture clears the byte floor (${webp.byteLength})`);
  const s5 = await storeLogo(site5, webp, "image/webp");
  assert(s5.logoPath === `/logos/${site5}.png` && s5.background === "#1F2937", `webp: composited and stored as png (${s5.logoPath})`);
  assert(existsSync(join(dir, `${site5}.orig.webp`)) && same(readFileSync(join(dir, `${site5}.orig.webp`)), webp), "webp: the original kept as .orig.webp");

  // 6. A later logo stored unchanged removes the earlier original.
  await storeLogo(site1, dark, "image/png");
  assert(!existsSync(join(dir, `${site1}.orig.png`)), "a dark logo replacing a composite removes the stale .orig");
  assert(same(readFileSync(join(dir, `${site1}.png`)), dark), "and is stored byte for byte");

  // 7. Bytes the magic-byte gate accepts but the decoder cannot read: stored unchanged, never rejected.
  const site7 = "cmlogobg00000000000000007";
  // The header and the start of the pixel data, cut short: the gate reads only the header.
  const broken = white.slice(0, 1_000);
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => warned.push(a.join(" "));
  let s7: Awaited<ReturnType<typeof storeLogo>> | null = null;
  try {
    s7 = await storeLogo(site7, broken, "image/png");
  } catch (e) {
    console.warn = warn;
    assert(false, `undecodable: never rejected (threw ${(e as Error).message})`);
  }
  console.warn = warn;
  if (s7) {
    assert(s7.background === null, "undecodable: no background");
    assert(same(readFileSync(join(dir, `${site7}.png`)), broken), "undecodable: stored byte for byte");
    assert(warned.some((w) => w.includes(site7) && w.includes("stored unchanged")), `undecodable: a console warning names the site (${warned.join(" | ")})`);
  }

  // 8. The thresholds, on raw pixels.
  const px = (n: number, p: number[]) => Array.from({ length: n }, () => p).flat();
  const judge = (pixels: number[]) => judgeLogoPixels(new Uint8Array(pixels));
  assert(judge([...px(25, [0, 0, 0, 0]), ...px(75, [255, 255, 255, 255])]).light, "25% transparent, all white: light");
  assert(!judge([...px(24, [0, 0, 0, 0]), ...px(76, [255, 255, 255, 255])]).light, "24% transparent: not light");
  assert(judge([...px(25, [0, 0, 0, 31]), ...px(75, [255, 255, 255, 255])]).light, "alpha 31 counts as transparent");
  assert(!judge([...px(25, [0, 0, 0, 32]), ...px(75, [255, 255, 255, 255])]).light, "alpha 32 does not");
  // 90 white + 10 black opaque: mean luminance 0.9, 10% dark: light.
  assert(judge([...px(50, [0, 0, 0, 0]), ...px(90, [255, 255, 255, 255]), ...px(10, [0, 0, 0, 255])]).light, "10% of the opaque pixels dark, mean 0.9: light");
  assert(!judge([...px(50, [0, 0, 0, 0]), ...px(89, [255, 255, 255, 255]), ...px(11, [0, 0, 0, 255])]).light, "11% dark: not light");
  // A light grey #DDDDDD has luminance 0.723: under 0.75.
  assert(!judge([...px(50, [0, 0, 0, 0]), ...px(50, [0xdd, 0xdd, 0xdd, 255])]).light, "mean luminance 0.72 (#DDDDDD): not light");
  assert(judge([...px(50, [0, 0, 0, 0]), ...px(50, [0xe6, 0xe6, 0xe6, 255])]).light, "mean luminance 0.79 (#E6E6E6): light");
  // Semi-transparent pixels (32..223) count in the total only.
  assert(!judge([...px(30, [0, 0, 0, 0]), ...px(70, [255, 255, 255, 128])]).light, "no opaque pixel at all: not light");

  // 9. The callers: the route returns the background; the capture writes the note line.
  assert(logoBackgroundNote("#1F2937") === "logo: light on transparent, stored on #1F2937", "the note line");
  const route = readFileSync(join(__dirname, "..", "app", "api", "sites", "[id]", "company-logo", "route.ts"), "utf8");
  assert(/background: stored\.background/.test(route), "the route returns the background");
  const capture = readFileSync(join(__dirname, "..", "..", "scripts", "company-profile.ts"), "utf8");
  assert(/logoBackgroundNote\(logo\.background\)/.test(capture), "the capture pushes the note line");

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("logoBackground: light on transparent composited on #1F2937 with the original kept; everything else byte for byte");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
