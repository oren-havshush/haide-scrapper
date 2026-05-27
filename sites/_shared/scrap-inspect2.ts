import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'en-US' });
  const p = await ctx.newPage();
  await p.goto('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=Israel', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-automation-id="jobResults"]', { timeout: 15000 });
  await p.waitForTimeout(2000);

  // 1. Verify Workday's JSON API for a single job
  const apiResult = await p.evaluate(async () => {
    try {
      // The first job's path was /en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--Cloud-Networking_JR2013873?q=Israel
      // Workday detail API: /wday/cxs/{tenant}/{site}/job/{location}/{slug}_{reqId}
      const u = '/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--Cloud-Networking_JR2013873';
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch (e) {}
      return {
        status: r.status,
        contentType: r.headers.get('content-type'),
        bytes: text.length,
        keys: j ? Object.keys(j).slice(0, 30) : null,
        jobPostingInfoKeys: j?.jobPostingInfo ? Object.keys(j.jobPostingInfo).slice(0, 30) : null,
        descPreview: j?.jobPostingInfo?.jobDescription?.slice(0, 200) || j?.jobPostingInfo?.description?.slice(0, 200) || null,
        locationsCandidates: {
          location: j?.jobPostingInfo?.location,
          locations: j?.jobPostingInfo?.locations,
          location_str: j?.jobPostingInfo?.location_str,
        },
      };
    } catch (e: any) {
      return { error: String(e) };
    }
  });
  console.log('API:', JSON.stringify(apiResult, null, 2));

  // 2. Check dl structure on an item
  const dlInfo = await p.evaluate(() => {
    const item = document.querySelector('[data-automation-id="jobResults"] > ul > li');
    if (!item) return null;
    const dls = item.querySelectorAll('dl');
    return {
      dlCount: dls.length,
      dlStructures: Array.from(dls).map(dl => ({
        dts: Array.from(dl.querySelectorAll('dt')).map(e => e.textContent?.trim()),
        dds: Array.from(dl.querySelectorAll('dd')).map(e => e.textContent?.trim()),
      })),
    };
  });
  console.log('DL:', JSON.stringify(dlInfo, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
