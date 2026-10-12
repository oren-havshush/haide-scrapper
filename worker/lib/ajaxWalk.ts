// The ajax listing mode, `pagination.type: "ajax"` (big-lane design, item 4).
//
// A site whose listing loads its pages through an XHR endpoint (Maof: 253
// pages from admin-ajax.php) is walked by calling that endpoint directly from
// the listing page's own context, `urlTemplate` with {n} = start, start+1, ...,
// in batches of `concurrency` (at most 4), each call spaced by the site's
// requestDelayMs. Each answer's HTML is appended to `containerSelector`, so
// the ordinary item selector extracts every page at once.
//
//   - A page with no item blocks is the end.
//   - A failed call is retried once; failing again stops the walk as
//     "failed", which the pagination guard refuses (rows kept): a walk that
//     lost page 120 of 253 must never publish the first 119.
//   - Every page is counted in the run's walk, like the url and click modes.
//
// Not a setupScript: the guard cannot see inside a script, and ~250 calls do
// not fit its 90 s limit. Pure: the page is reached through `deps`, so the walk
// is tested with a fake fetch (ajaxWalk.test.ts).

import type { PaginationWalk } from "./paginationGuard";

export const AJAX_MAX_CONCURRENCY = 4;
export const AJAX_PAGE_TOKEN = "{n}";

export type AjaxPaginationConfig = {
  type: "ajax";
  urlTemplate: string;
  start: number;
  maxPages: number;
  concurrency: number;
  containerSelector: string;
  settleMs: number;
};

/** One call's answer: `blocks` is how many item blocks its HTML holds. Never throws. */
export type AjaxPage = { ok: boolean; blocks: number; html: string };

export type AjaxDeps = {
  fetchPage: (url: string) => Promise<AjaxPage>;
  appendPage: (html: string) => Promise<void>;
  /** Waits the site's requestDelayMs before each call. */
  pace: () => Promise<void>;
  aborted: () => boolean;
};

export function ajaxPageUrl(template: string, n: number): string {
  return template.split(AJAX_PAGE_TOKEN).join(String(n));
}

/**
 * Why a urlTemplate is refused, or null. It must hold {n}, be an http(s) URL,
 * and be on the site's own host: policy review is per origin, so a call to
 * another host has had none.
 */
export function ajaxTemplateError(template: string, siteUrl: string): string | null {
  if (!template.includes(AJAX_PAGE_TOKEN)) return `pagination.urlTemplate must contain ${AJAX_PAGE_TOKEN}`;
  let url: URL;
  try {
    url = new URL(ajaxPageUrl(template, 1));
  } catch {
    return `pagination.urlTemplate is not a URL: ${template}`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `pagination.urlTemplate must be http(s): ${template}`;
  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return `the site has an unparsable siteUrl: ${siteUrl}`;
  }
  if (url.host !== host) {
    return `pagination.urlTemplate: ${url.host} is not the site's host (${host}); a call to another host has had no policy check of its own`;
  }
  return null;
}

async function safeFetch(deps: AjaxDeps, url: string): Promise<AjaxPage> {
  try {
    return await deps.fetchPage(url);
  } catch {
    return { ok: false, blocks: 0, html: "" };
  }
}

/** Walk the endpoint into the page, recording every page on `walk`. */
export async function ajaxWalk(cfg: AjaxPaginationConfig, deps: AjaxDeps, walk: PaginationWalk): Promise<void> {
  const concurrency = Math.min(Math.max(1, cfg.concurrency), AJAX_MAX_CONCURRENCY);
  for (let base = 0; base < cfg.maxPages; base += concurrency) {
    if (deps.aborted()) {
      walk.stoppedBy = "aborted";
      return;
    }
    const indices: number[] = [];
    for (let i = base; i < Math.min(base + concurrency, cfg.maxPages); i++) indices.push(i);
    // Each call is released after the site's delay, and at most `concurrency`
    // are in flight: the batch is awaited whole before the next one starts.
    const inflight: Array<Promise<AjaxPage>> = [];
    for (const i of indices) {
      await deps.pace();
      inflight.push(safeFetch(deps, ajaxPageUrl(cfg.urlTemplate, cfg.start + i)));
    }
    const answers = await Promise.all(inflight);
    for (let k = 0; k < indices.length; k++) {
      let page = answers[k]!;
      if (!page.ok) {
        // Once more, on its own.
        await deps.pace();
        page = await safeFetch(deps, ajaxPageUrl(cfg.urlTemplate, cfg.start + indices[k]!));
      }
      if (!page.ok) {
        walk.stoppedBy = "failed";
        return;
      }
      if (page.blocks === 0) {
        walk.stoppedBy = "end";
        return;
      }
      try {
        await deps.appendPage(page.html);
      } catch {
        // The container is gone: the pages cannot reach the extractor.
        walk.stoppedBy = "failed";
        return;
      }
      walk.pageCounts.push(page.blocks);
    }
  }
  walk.stoppedBy = "maxPages";
}
