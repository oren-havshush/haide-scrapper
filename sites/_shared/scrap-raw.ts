import { request } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=';
  const r = await request.newContext({ extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9' } });
  const resp = await r.get(url);
  const text = await resp.text();
  fs.writeFileSync(path.resolve('.scratch', 'scrap-raw.html'), text);
  const count = (text.match(/jobBox-wrapper/g) || []).length;
  console.log(JSON.stringify({ status: resp.status(), htmlBytes: text.length, jobBoxMatches: count }));
})();
