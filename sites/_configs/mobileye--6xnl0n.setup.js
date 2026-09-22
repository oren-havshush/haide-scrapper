var SEL = 'div.jobItem';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

/* city.csv verbatim. Doubles as the Israel filter: a card whose location tag
   is not one of these is a non-Israel posting and is removed. Herzliya stays
   in the map for a future genuine Mobileye posting there - it is NOT how the
   Mentee cards are excluded; that is the explicit disclaimer check below. */
var CITY = {
  'jerusalem': 'ירושלים',
  'ramat gan': 'רמת גן',
  'petah tikva': 'פתח תקווה',
  'petach tikva': 'פתח תקווה',
  'haifa': 'חיפה',
  'tel-aviv': 'תל אביב-יפו',
  'tel aviv': 'תל אביב-יפו',
  'herzliya': 'הרצליה'
};

var NL = String.fromCharCode(10);
var TAB = String.fromCharCode(9);

var dates = {};
try {
  var rs = await fetch('https://api.eu.lever.co/v0/postings/mobileye?mode=json');
  var arr = await rs.json();
  for (var a = 0; a < arr.length; a++) {
    if (arr[a] && arr[a].id && arr[a].createdAt) {
      dates[arr[a].id] = new Date(arr[a].createdAt).toISOString().slice(0, 10);
    }
  }
} catch (e) {}

var tidy = function (s) {
  var sp = new RegExp('[ ' + TAB + ']+', 'g');
  return (s || '').split(NL).map(function (l) {
    return l.replace(sp, ' ').trim();
  }).filter(function (l, i, r) {
    return l !== '' || (i > 0 && r[i - 1] !== '');
  }).join(NL).trim();
};

var norml = function (s) {
  return (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
};

var items = document.querySelectorAll(SEL);
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  if (it.querySelector('.__ai-location')) continue;

  var aEl = it.querySelector('a.applyBtn');
  var apply = aEl ? (aEl.getAttribute('href') || '') : '';

  /* EMPLOYER-OF-RECORD GATE. The 7 "Humanoids - Mentee" cards carry their own
     p.menteeDisclaimerText: "This position is with Mentee Robotics, which is
     owned by Mobileye but operates as a separate company. Mentee Robotics
     manages its own recruitment process." Mobileye is the owner, not the
     employer, so these are not published under Mobileye - they belong to a
     separate Mentee Robotics site (its own Comeet board). Two independent
     signals, either one excludes, so a class rename or an ATS move cannot
     silently let them back in. */
  if (it.querySelector('p.menteeDisclaimerText') || apply.indexOf('mentee_robotics') >= 0) {
    it.remove();
    continue;
  }

  var city = '';
  var tags = it.querySelectorAll('div.tagItem');
  for (var g = 0; g < tags.length; g++) {
    var key = (tags[g].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (CITY[key]) { city = CITY[key]; break; }
  }
  if (!city) { it.remove(); continue; }

  var href = '';
  var nEl = it.querySelector('a.newTab');
  if (nEl) href = nEl.getAttribute('href') || '';
  var jid = '';
  var m = href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (m) {
    jid = m[1].toLowerCase();
  } else {
    var segs = href.split('?')[0].split('#')[0].split('/');
    for (var q = segs.length - 1; q >= 0; q--) {
      if (segs[q] !== '') { jid = segs[q]; break; }
    }
  }

  var desc = [], req = [];
  var bs = it.querySelector('div.bottomSection');
  if (bs) {
    var kids = bs.children;
    for (var k = 0; k < kids.length; k++) {
      var el = kids[k];
      var cls = ' ' + (el.getAttribute('class') || '') + ' ';
      if (cls.indexOf('btnsWrapper') >= 0 || cls.indexOf('shareBtns') >= 0) continue;
      var txt = tidy(el.innerText);
      if (!txt) continue;

      if (cls.indexOf('listItem') >= 0) {
        var hEl = el.querySelector('p');
        var head = hEl ? (hEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
        var norm = norml(head);
        var isReq = /all you need|^requirements|^who you are|nice to have|^advantages|qualification|^skills/.test(norm);

        /* An unheaded list is still a requirements list when it reads like one
           (LRN-SETUP-18). Narrow on purpose: two independent markers must hit.
           Markers avoid backslash escapes so a later edit cannot silently eat
           one (see CLAUDE.md on regexes rewritten through string replacement). */
        if (!isReq && !norm) {
          var low = ' ' + txt.toLowerCase() + ' ';
          var marks = 0;
          if (/[^a-z]must[^a-z]/.test(low)) marks++;
          if (/an advantage/.test(low)) marks++;
          if (/years? of experience/.test(low)) marks++;
          if (/[bm][.]sc|ph[.]d/.test(low)) marks++;
          if (/licen[sc]e/.test(low)) marks++;
          if (/proficien/.test(low)) marks++;
          if (marks >= 2) isReq = true;
        }

        /* Drop a heading that only restates the field name. "Nice to have" and
           "Advantages" are kept: they mark preferred vs mandatory, and losing
           that would publish an optional item as a hard requirement. */
        var dropHead = /all you need|^requirements|^who you are|qualification|^skills/.test(norm);
        if (isReq && dropHead && head) {
          var lines = txt.split(NL);
          if (lines[0].replace(/\s+/g, ' ').trim() === head) {
            lines.shift();
            txt = lines.join(NL).trim();
          }
        }
        if (!txt) continue;
        (isReq ? req : desc).push(txt);
      } else {
        /* "About us" is company boilerplate repeated verbatim across the whole
           board and says nothing about this job, so it is not part of the
           description. "About the team" is job-specific and stays. */
        var tEl = el.querySelector('p.textTitle');
        if (tEl && norml(tEl.textContent).indexOf('about us') === 0) continue;
        desc.push(txt);
      }
    }
  }

  var add = function (name, val) {
    if (!val) return;
    var sp2 = document.createElement('span');
    sp2.className = '__ai-' + name;
    sp2.textContent = val;
    sp2.style.display = 'none';
    it.appendChild(sp2);
  };
  add('location', city);
  add('description', desc.join(NL + NL));
  add('requirements', req.join(NL + NL));
  if (jid) add('jobid', 'mobileye-' + jid);
  if (apply) add('applyinfo', apply);
  if (jid && dates[jid]) add('publishdate', dates[jid]);
}
