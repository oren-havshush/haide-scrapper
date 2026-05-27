import { chromium } from 'playwright';

async function tryNav(label: string, opts: any) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const t0 = Date.now();
  try {
    const r = await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 15000 });
    const html = await p.content().catch(() => '');
    const challenged = /just a moment|cf-mitigated|reblaze|access denied|attention required|enable javascript and cookies/i.test(html);
    console.log(`${label}: status=${r?.status()} challenged=${challenged} elapsed=${Date.now() - t0}ms`);
    return { ok: !!r && r.status() < 400 && !challenged, status: r?.status(), challenged };
  } catch (e: any) {
    console.log(`${label}: FAIL ${e.message?.split('\n')[0]} elapsed=${Date.now() - t0}ms`);
    return { ok: false, error: String(e.message || e) };
  } finally {
    await b.close();
  }
}

(async () => {
  const bare = await tryNav('bare-worker-parity', {});
  if (bare.ok) { console.log('GATE: PASS (worker can navigate this site).'); return; }
  const real = await tryNav('real-chrome-UA', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  if (real.ok) {
    console.log('GATE: FAIL (UA-keyed WAF). Site rejects worker default UA but accepts a real Chrome UA.');
    console.log('       Do NOT onboard. The worker needs a UA fix (or per-site UA override) first.');
    process.exit(2);
  }
  console.log('GATE: FAIL (network/region/captcha). Neither the worker default nor a real Chrome UA could reach the site.');
  console.log('       Likely IL-IP requirement, captcha, or true outage. Stop and report.');
  process.exit(3);
})();
