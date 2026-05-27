import { chromium } from 'playwright';

(async () => {
  const url = 'https://jobs.keshet-mediagroup.com/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('NAV:', f.url()); });
  p.on('popup', (pp) => console.log('POPUP:', pp.url()));

  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2000);

  // 1. Inspect the `jobline` global and `setDescription` behavior
  const jobline = await p.evaluate(`(() => {
    const g = (window).jobline;
    if (!g) return { exists: false };
    const keys = Object.keys(g).filter(function(k){ return typeof g[k] === 'function' || typeof g[k] === 'object'; });
    const openJobSrc = (typeof g.openJob === 'function') ? g.openJob.toString().slice(0, 600) : null;
    const setDescSrc = (typeof g.setDescription === 'function') ? g.setDescription.toString().slice(0, 600) : null;
    // Look for an in-memory jobs array
    const jobsArrCandidate = ['jobs','jobList','data','allJobs'].find(function(k){ return Array.isArray(g[k]); });
    const sampleJob = jobsArrCandidate ? g[jobsArrCandidate][0] : null;
    return {
      exists: true,
      keys: keys,
      openJobSrc: openJobSrc,
      setDescSrc: setDescSrc,
      jobsArrName: jobsArrCandidate || null,
      jobsCount: jobsArrCandidate ? g[jobsArrCandidate].length : null,
      sampleJobKeys: sampleJob ? Object.keys(sampleJob) : null,
      sampleJob: sampleJob,
    };
  })()`);
  console.log('=== jobline global ===');
  console.log(JSON.stringify(jobline, null, 2));

  // 2. Click the first job and see what happens
  console.log('\n=== clicking first job ===');
  const before = p.url();
  await p.locator('.job-container').first().click({ timeout: 5000 }).catch((e) => console.log('click err:', String(e).slice(0, 200)));
  await p.waitForTimeout(3000);
  console.log('url before:', before);
  console.log('url after :', p.url());

  // 3. Check if a modal/details panel appeared, or if we navigated
  const post = await p.evaluate(`(() => ({
    visibleBigElements: Array.from(document.querySelectorAll('div, article, section'))
      .filter(function(e){
        var r = e.getBoundingClientRect();
        var st = getComputedStyle(e);
        return r.width > 400 && r.height > 200 && st.display !== 'none' && st.visibility !== 'hidden';
      })
      .slice(0, 5)
      .map(function(e){ return {
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 80),
        id: e.id || null,
        textLen: (e.innerText || '').length,
        textPreview: (e.innerText || '').replace(/\\s+/g,' ').slice(0, 200),
      };}),
    title: document.title,
  }))()`);
  console.log(JSON.stringify(post, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
