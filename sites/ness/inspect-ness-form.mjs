import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();

  async function probe(url, label) {
    console.log(`\n========== ${label}: ${url} ==========`);
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await p.waitForTimeout(1500);

    const info = await p.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const cvInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input:not([type]), textarea'));
      const submitBtns = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]'));
      const allButtonsWithSendText = Array.from(document.querySelectorAll('button')).filter(b => /שליחה|שלח|submit|send/i.test(b.textContent || ''));
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => ({ tag: h.tagName, text: (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) })).filter(h => h.text);
      return {
        formCount: forms.length,
        forms: forms.map(f => ({
          action: f.getAttribute('action'),
          method: f.getAttribute('method'),
          id: f.id,
          className: f.className,
          innerInputs: Array.from(f.querySelectorAll('input, textarea, select')).map(i => ({
            type: i.type, name: i.name, placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label'), id: i.id
          })),
        })),
        fileInputCount: fileInputs.length,
        fileInputs: fileInputs.map(i => ({ name: i.name, accept: i.accept, ariaLabel: i.getAttribute('aria-label'), id: i.id })),
        textInputCount: cvInputs.length,
        textInputsSample: cvInputs.slice(0, 10).map(i => ({ type: i.type, name: i.name, placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label') })),
        submitBtnCount: submitBtns.length,
        sendBtnCount: allButtonsWithSendText.length,
        sendBtnsSample: allButtonsWithSendText.slice(0, 5).map(b => ({ text: (b.textContent||'').replace(/\s+/g,' ').trim().slice(0, 60), classes: b.className })),
        h1h2h3sample: headings.slice(0, 15),
        hasApplicationFormHeading: !!Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span')).find(el => /הגשת מועמדות|הגשת מועמד/.test(el.textContent || '')),
        pageTitle: document.title,
      };
    });
    console.log(JSON.stringify(info, null, 2));
  }

  await probe('https://www.ness-tech.co.il/careers/', 'LISTING');
  await probe('https://www.ness-tech.co.il/careers/job/42678', 'DETAIL (job 42678)');

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
