(function () {
  try {
    if (document.querySelector('#haide-jobs-container')) return;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://niloo-server.herokuapp.com/actions-elbit', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ cmd: 'get-jobs' }));
    if (xhr.status < 200 || xhr.status >= 300) return;
    var jobs = JSON.parse(xhr.responseText);
    if (!Array.isArray(jobs)) return;

    var CITY_MAP = {"0":"בחר","7":"רילוקיישן","8":"מודיעין","72":"ערד","85":"אשדוד","104":"קריית שמונה","106":"פארק הייטק בר לב","109":"איירפורט סיטי","129":"תל חי","131":"משרה היברידית","134":"באר שבע","149":"בני ברק","416":"חיפה","443":"חצרים","467":"חולון","524":"כרמיאל","628":"לוד","812":"נס ציונה","816":"נתניה","878":"אופקים","935":"קיסריה","960":"רעננה","964":"רמת גן","966":"רמת השרון","975":"רמלה","992":"רחובות","1008":"ראש העין","1050":"שדרות","1137":"תל אביב","1203":"יבנה","2191":"נצרת עלית","2966":"יוקנעם","Countrywide":"פריסה ארצית","Jerusalem Area":"ירושלים והסביבה","North":"צפון","South":"דרום","Center":"מרכז","Sharon":"השרון","Shfela":"השפלה","Jerusalem":"ירושלים"};

    var decoder = document.createElement('textarea');
    function decode(s) {
      if (!s) return '';
      decoder.innerHTML = String(s);
      var txt = decoder.value;
      var div = document.createElement('div');
      div.innerHTML = txt;
      return (div.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function makeField(name, value) {
      var s = document.createElement('span');
      s.setAttribute('data-haide-' + name, '1');
      s.textContent = String(value == null ? '' : value);
      return s;
    }
    function resolveLocation(job) {
      var trim = function (v) { return String(v == null ? '' : v).replace(/[\s\u200E\u200F]+/g, ' ').trim(); };
      var locAddr = trim(job.locationAddress);
      if (locAddr) return locAddr;
      var cities = '', area = '';
      var ep = job.extendedProperties;
      if (Array.isArray(ep)) {
        for (var k = 0; k < ep.length; k++) {
          if (ep[k] && ep[k].PropertyName === 'Cities') cities = trim(ep[k].Value);
          else if (ep[k] && ep[k].PropertyName === 'Area') area = trim(ep[k].Value);
        }
      }
      if (cities && CITY_MAP[cities]) return CITY_MAP[cities];
      var a = area || trim(job.area);
      if (a && CITY_MAP[a]) return CITY_MAP[a];
      return a;
    }

    var container = document.createElement('div');
    container.id = 'haide-jobs-container';
    container.style.display = 'none';

    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i] || {};
      if (j.status === 0) continue;
      var card = document.createElement('div');
      card.className = 'haide-job-card';
      card.appendChild(makeField('title', j.jobTitle || ''));
      card.appendChild(makeField('jobcode', j.jobCode || j.jobId || ''));
      card.appendChild(makeField('description', decode(j.description)));
      card.appendChild(makeField('location', resolveLocation(j)));
      card.appendChild(makeField('department', j.employerName || ''));
      card.appendChild(makeField('publishdate', j.openDate || ''));
      container.appendChild(card);
    }
    document.body.appendChild(container);
  } catch (e) {}
})();
