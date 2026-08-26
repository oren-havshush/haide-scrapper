/**
 * scripts/lib/fetch-image.ts
 *
 * Downloads a candidate company logo from a URL found in scraped HTML.
 *
 * This runs on the OPERATOR'S machine, not on the server. That is deliberate:
 * the server's upload endpoint takes bytes only and has no outbound HTTP
 * client, so a hostile careers page cannot aim the production container at
 * db:5432, the worker, or 169.254.169.254. The SSRF guards below protect the
 * operator's own network instead, and they are written assuming the URL is
 * fully attacker-controlled.
 *
 * Two guards are easy to get subtly wrong and are called out inline:
 *   - the check is on the RESOLVED IP, not the hostname string
 *   - redirects are followed manually, re-checking every hop
 */

import { lookup } from "node:dns/promises";
import {
  inspectImage,
  ImageRejected,
  MAX_LOGO_BYTES,
  type ImageInspection,
} from "../../src/lib/image-validate";

export { ImageRejected } from "../../src/lib/image-validate";
export type { ImageInspection } from "../../src/lib/image-validate";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export interface FetchedImage {
  bytes: Uint8Array;
  contentType: string;
  /** The final URL after redirects — this is what gets recorded as provenance. */
  finalUrl: string;
  inspection: ImageInspection;
}

/** Reserved / non-routable ranges. A logo must never come from any of these. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // unparseable — refuse rather than guess
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local, incl. cloud IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 special use
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped (::ffff:127.0.0.1) — unwrap and apply the v4 rules, otherwise
  // loopback sails straight through the v6 branch.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]!);

  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return true; // fe80::/10
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

function hostLooksInternal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost") return true;
  if (h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (h.endsWith(".internal")) return true;
  if (h.endsWith(".home.arpa")) return true;
  // Bare IP literals: refuse outright. A real company logo is served from a
  // hostname, and allowing literals means re-implementing every obfuscated
  // encoding (octal 010.0.0.1, decimal 2130706433, hex 0x7f000001).
  if (/^\d+$/.test(h.replace(/\./g, ""))) return true;
  if (/^\[?[0-9a-f:]+\]?$/i.test(h) && h.includes(":")) return true;
  return false;
}

/**
 * Reject any URL that is not plain http(s) to a public host. Resolves DNS and
 * checks EVERY returned address — checking the hostname string alone is not a
 * defense, since a hostile site can simply publish an A record pointing at
 * 127.0.0.1.
 */
async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageRejected("bad_url", `not a parseable URL: ${rawUrl}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImageRejected(
      "bad_scheme",
      `scheme ${url.protocol} is not allowed (data:, file: and blob: are refused)`,
    );
  }

  if (hostLooksInternal(url.hostname)) {
    throw new ImageRejected("internal_host", `host ${url.hostname} is internal or an IP literal`);
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new ImageRejected("dns_failed", `could not resolve ${url.hostname}`);
  }

  if (addresses.length === 0) {
    throw new ImageRejected("dns_failed", `${url.hostname} resolved to no addresses`);
  }

  for (const { address, family } of addresses) {
    const blocked = family === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
    if (blocked) {
      throw new ImageRejected(
        "private_address",
        `${url.hostname} resolves to non-public address ${address}`,
      );
    }
  }

  return url;
}

/**
 * Read the response body with a hard byte ceiling, aborting mid-stream once it
 * is exceeded. Never trusts Content-Length: a hostile server can advertise 100
 * bytes and then stream gigabytes.
 */
async function readCapped(response: Response): Promise<Uint8Array> {
  const body = response.body;
  if (!body) throw new ImageRejected("empty_body", "response had no body");

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_LOGO_BYTES) {
        await reader.cancel();
        throw new ImageRejected(
          "too_large",
          `response exceeded the ${MAX_LOGO_BYTES}-byte cap mid-stream`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Download and validate one image.
 *
 * `referer` should be the page the candidate was found on — some sites reject
 * hotlinked image requests without it.
 *
 * Throws ImageRejected on every failure path, with a machine-readable
 * `reason`, so the caller can record why a logo was skipped and move on rather
 * than failing the whole capture.
 */
export async function fetchImage(rawUrl: string, referer?: string): Promise<FetchedImage> {
  let currentUrl = await assertPublicUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        // Manual, not "follow". With "follow" the runtime chases redirects
        // internally and every guard above is bypassed by a single
        // 302 -> http://127.0.0.1/ — the textbook SSRF bypass.
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "image/png,image/jpeg,image/webp,image/*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          ...(referer ? { referer } : {}),
        },
      });
    } catch (error) {
      if (error instanceof ImageRejected) throw error;
      const reason = controller.signal.aborted ? "timeout" : "network_error";
      throw new ImageRejected(reason, `fetching ${currentUrl.href} failed: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new ImageRejected("bad_redirect", `${response.status} with no Location header`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new ImageRejected("too_many_redirects", `more than ${MAX_REDIRECTS} redirects`);
      }
      // Re-run the full public-URL check on the new target, every hop.
      currentUrl = await assertPublicUrl(new URL(location, currentUrl).href);
      continue;
    }

    if (!response.ok) {
      throw new ImageRejected("http_error", `${currentUrl.href} returned ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const bytes = await readCapped(response);
    const inspection = inspectImage(bytes, contentType);

    return {
      bytes,
      contentType: contentType!.split(";")[0]!.trim().toLowerCase(),
      finalUrl: currentUrl.href,
      inspection,
    };
  }

  throw new ImageRejected("too_many_redirects", `more than ${MAX_REDIRECTS} redirects`);
}
