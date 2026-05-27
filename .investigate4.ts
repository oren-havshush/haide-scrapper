import { chromium } from 'playwright';

const DETAIL = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?jobID=5108&jobType=';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  const resp = await p.goto(DETAIL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  console.log('detail status:', resp?.status());

  const probe = await p.evaluate(`(function(){
    function txt(s){
      var el=document.querySelector(s);
      if(!el) return {matched:false};
      return {matched:true, tag:el.tagName, textPreview:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,160)};
    }
    return {
      title_h3: txt('h3.job-title'),
      location_field: txt('.vacancy-location .field-value'),
      description_p: txt('.vacancy-text p'),
      description_container: txt('.vacancy-text'),
      jobID_textarea: txt('textarea#jobID'),
      vacancyClasses: Array.from(document.querySelectorAll('[class*="vacancy"]')).slice(0,20).map(function(e){return e.className;})
    };
  })()`);
  console.log(JSON.stringify(probe, null, 2));
  await b.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
