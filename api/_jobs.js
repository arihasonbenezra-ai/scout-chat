// Shared job-feed code for Active search. Not an endpoint (the leading
// underscore keeps Vercel from routing it); imported by jobs-sync.js and
// opportunity.js.
//
// Only the open job-board feeds are read here: Greenhouse, Lever, Ashby,
// SmartRecruiters, Workable, Rippling. Each publishes a company's open
// roles for other software to read. See supabase/seed/README.md for the
// sources that are deliberately NOT read.

const UA = { 'User-Agent': 'EzzyJobs/1.0 (+https://meetezzy.com)', Accept: 'application/json' };

async function getJson(url, ms) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms || 15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]);
  return res.json();
}

export function htmlToText(html) {
  var s = String(html || '');
  // Greenhouse double-encodes: the HTML itself arrives entity-escaped.
  if (/&lt;[a-z\/]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;|&ndash;/g, '-')
    .replace(/&#(\d+);/g, function (m, n) { try { return String.fromCodePoint(Number(n)); } catch (e) { return ' '; } });
}

// Same families the rubrics and screening rules use.
export function familyFor(title) {
  var r = String(title || '').toLowerCase();
  if (!r) return 'General';
  if (/recruit|talent|\bhr\b|human resources|people ops|people partner|people operations|sourcer/.test(r)) return 'People & Talent';
  if (/engineer|developer|\bswe\b|\bsde\b|\bdata\b|\bml\b|machine learning|devops|infra|\bsre\b|architect|scientist|analyst|research/.test(r)) return 'Engineering';
  if (/marketing|sales|account exec|account manager|customer success|growth|brand|\bseo\b|content|revenue|\bbdr\b|\bsdr\b|partnerships/.test(r)) return 'Go-to-market';
  if (/product|designer|design|\bux\b|\bui\b|program manager|project manager|operations|\bops\b|\btpm\b/.test(r)) return 'Product / Design / Ops';
  return 'General';
}
// Level as the title states it. Null when the title does not say.
export function levelFor(title) {
  var r = ' ' + String(title || '').toLowerCase() + ' ';
  if (/\b(chief|c[efot]o)\b/.test(r)) return 'exec';
  if (/\b(vp|vice president|svp|evp)\b/.test(r)) return 'vp';
  if (/\b(director|head of)\b/.test(r)) return 'director';
  if (/\bprincipal\b/.test(r)) return 'principal';
  if (/\bstaff\b/.test(r)) return 'staff';
  if (/\b(senior|sr\.?)\b/.test(r)) return 'senior';
  if (/\bmanager\b/.test(r) && !/\b(product|program|project|account|community|success|marketing)\s+manager\b/.test(r)) return 'manager';
  if (/\b(intern|internship|new grad|graduate|entry|junior|jr\.?|associate|apprentice)\b/.test(r)) return 'entry';
  return null;
}
// --- Posted pay ------------------------------------------------------------
// The salary range a company prints in its own posting. Only what the text
// states is kept, with the sentence it came from; nothing is estimated.
// Returns { min, max, currency, interval, source, text } or null.
var PAY_AMOUNT = '(?:(USD|CAD|GBP|EUR|AUD|US\\$|C\\$|A\\$|\\$|£|€)\\s?)(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s?([kK])?(?!\\s?(?:[mMbB]\\b|million|billion))';
// The second figure of a range often drops the symbol: "$150-200K", "$23-29/hr".
var PAY_RANGE = new RegExp(PAY_AMOUNT + '(?:\\s?(?:-|–|—|to|and)\\s?' + PAY_AMOUNT.replace('(?:(', '(?:(').replace(')\\s?)', ')\\s?)?') + ')?', 'g');
var PAY_CONTEXT = /salary|\bpay\b|pay range|compensation|\bcomp\b|wage|base rate|hourly|per hour|\/\s?hr\b|per year|annual|\bOTE\b|on-target/i;
var PAY_NOT = /revenue|funding|raised|valuation|customers|in sales|ARR|GMV|budget|portfolio|assets|reimburse|stipend|bonus of|sign-on|signing|referral|allowance|401|match/i;
function payCurrency(sym, window) {
  if (!sym) return 'USD';
  var s = sym.toUpperCase();
  if (s === '£') return 'GBP';
  if (s === '€') return 'EUR';
  if (s === 'C$') return 'CAD';
  if (s === 'A$') return 'AUD';
  if (s === '$' || s === 'US$') {
    if (/\bCAD\b|canadian/i.test(window)) return 'CAD';
    if (/\bAUD\b|australian/i.test(window)) return 'AUD';
    return 'USD';
  }
  return s;
}
function payAmount(num, k) { var v = parseFloat(String(num).replace(/,/g, '')); if (isNaN(v)) return null; return k ? v * 1000 : v; }
function payOk(v, interval) { return interval === 'hour' ? v >= 10 && v <= 500 : v >= 20000 && v <= 1500000; }
export function payFromText(text) {
  var s = String(text || '');
  if (!s || !/[$£€]|\b(USD|CAD|GBP|EUR|AUD)\b/.test(s)) return null;
  var found = [], m;
  PAY_RANGE.lastIndex = 0;
  while ((m = PAY_RANGE.exec(s)) !== null && found.length < 12) {
    var before = s.slice(Math.max(0, m.index - 160), m.index), after = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
    var window = before + m[0] + after;
    // The sentence the figure sits in decides whether it is pay at all; a
    // bonus or a 401(k) match in the sentence before must not veto it.
    var sentStart = Math.max(0, before.search(/[^.\n]*$/)), sentEnd = after.search(/[.\n]/);
    var sentence = (before.slice(sentStart) + m[0] + (sentEnd === -1 ? after : after.slice(0, sentEnd + 1))).replace(/\s+/g, ' ').trim();
    if (!PAY_CONTEXT.test(window) || PAY_NOT.test(sentence)) continue;
    var interval = /hour|\/\s?hr\b|hourly|per hr/i.test(window) ? 'hour' : 'year';
    var lo = payAmount(m[2], m[3]), hi = m[5] ? payAmount(m[5], m[6]) : null;
    // "$150-200K": the K after the second number applies to both.
    if (hi !== null && !m[3] && m[6] && lo < 1000) lo = lo * 1000;
    if (lo === null || !payOk(lo, interval)) continue;
    // A second figure that cannot be pay ("$5,000 and 2 weeks") is not a range.
    if (hi !== null && (!payOk(hi, interval) || hi < lo || hi / lo > 4)) hi = null;
    if (hi === null) {
      // A lone figure counts only when the sentence is plainly about pay.
      if (!/salary|pay range|compensation|base pay|\bpays?\b|rate/i.test(before.slice(-50) + after.slice(0, 30))) continue;
      hi = lo;
    }
    var cur = payCurrency(m[1] || m[4], window);
    found.push({ min: lo, max: hi, currency: cur, interval: interval, text: sentence });
  }
  if (!found.length) return null;
  // Several ranges (levels, cities) become the envelope, in the first
  // range's currency and interval; a posting that mixes them keeps the first.
  var first = found[0], lo2 = first.min, hi2 = first.max;
  found.forEach(function (f) { if (f.currency === first.currency && f.interval === first.interval) { lo2 = Math.min(lo2, f.min); hi2 = Math.max(hi2, f.max); } });
  if (hi2 / lo2 > 4) { lo2 = first.min; hi2 = first.max; }
  return { min: lo2, max: hi2, currency: first.currency, interval: first.interval, source: 'posting_text', text: clip(first.text, 240) };
}
// Ashby publishes pay as data when the board is read with includeCompensation.
export function payFromAshby(comp) {
  if (!comp) return null;
  var parts = Array.isArray(comp.summaryComponents) && comp.summaryComponents.length ? comp.summaryComponents : [];
  if (!parts.length) (comp.compensationTiers || []).forEach(function (t) { (t.components || []).forEach(function (c) { parts.push(c); }); });
  var lo = null, hi = null, cur = null, interval = null;
  parts.forEach(function (c) {
    if (!c || c.compensationType !== 'Salary') return;
    var iv = /HOUR/i.test(c.interval || '') ? 'hour' : (/YEAR/i.test(c.interval || '') ? 'year' : null);
    if (!iv || (interval && iv !== interval)) return;
    var a = typeof c.minValue === 'number' ? c.minValue : null, b = typeof c.maxValue === 'number' ? c.maxValue : null;
    if (a === null && b === null) return;
    if (a === null) a = b; if (b === null) b = a;
    if (!payOk(a, iv) || !payOk(b, iv)) return;
    interval = iv; cur = cur || c.currencyCode || 'USD';
    lo = lo === null ? a : Math.min(lo, a); hi = hi === null ? b : Math.max(hi, b);
  });
  if (lo === null) return null;
  return { min: lo, max: hi, currency: cur, interval: interval, source: 'structured', text: clip(comp.compensationTierSummary || comp.scrapeableCompensationSalarySummary || '', 240) || null };
}
// The columns a pay object maps to on job_listings.
export function payColumns(pay) {
  return pay
    ? { comp_min: pay.min, comp_max: pay.max, comp_currency: pay.currency, comp_interval: pay.interval, comp_source: pay.source, comp_text: pay.text }
    : { comp_min: null, comp_max: null, comp_currency: null, comp_interval: null, comp_source: null, comp_text: null };
}
// Feeds whose listing call carries the posting text (or pay itself), so the
// nightly sync can read pay for every role. The others are read one role at
// a time, when someone asks for a fit check.
export var PAY_AT_SYNC = { greenhouse: true, lever: true, ashby: true, workable: true };

function isRemote(loc, flag) { return !!flag || /\bremote\b|work from home|distributed/i.test(String(loc || '')); }
function iso(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
function clip(s, n) { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) : s; }

// One company's open roles, in a common shape. Descriptions are not kept:
// the full posting is fetched only when someone asks for a fit check. The
// feeds that carry the text (or pay itself) in this one call do give up the
// posted pay range here, so Roles for you can show it for every role.
export async function fetchListings(ats, slug) {
  var out = [];
  if (ats === 'greenhouse') {
    var g = await getJson('https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(slug) + '/jobs?content=true', 25000);
    (g.jobs || []).forEach(function (j) {
      var loc = j.location && j.location.name;
      out.push({ external_id: String(j.id), title: j.title, location: loc, remote: isRemote(loc), department: null, url: j.absolute_url, posted_at: iso(j.first_published || j.updated_at), pay: payFromText(htmlToText(j.content)) });
    });
  } else if (ats === 'lever') {
    var l = await getJson('https://api.lever.co/v0/postings/' + encodeURIComponent(slug) + '?mode=json', 25000);
    (Array.isArray(l) ? l : []).forEach(function (j) {
      var c = j.categories || {};
      var text = [j.descriptionPlain || htmlToText(j.description)].concat((j.lists || []).map(function (x) { return (x.text || '') + '\n' + htmlToText(x.content); }), [j.additionalPlain || htmlToText(j.additional)]).join('\n');
      out.push({ external_id: String(j.id), title: j.text, location: c.location, remote: isRemote(c.location, j.workplaceType === 'remote'), department: c.department || c.team || null, url: j.hostedUrl, posted_at: iso(j.createdAt), pay: payFromText(text) });
    });
  } else if (ats === 'ashby') {
    var a = await getJson('https://api.ashbyhq.com/posting-api/job-board/' + encodeURIComponent(slug) + '?includeCompensation=true', 25000);
    (a.jobs || []).forEach(function (j) {
      if (j.isListed === false) return;
      out.push({ external_id: String(j.id), title: j.title, location: j.location, remote: isRemote(j.location, j.isRemote), department: j.department || j.team || null, url: j.jobUrl || j.applyUrl, posted_at: iso(j.publishedAt), pay: payFromAshby(j.compensation) || payFromText(j.descriptionPlain || htmlToText(j.descriptionHtml)) });
    });
  } else if (ats === 'smartrecruiters') {
    for (var off = 0; off < 3000; off += 100) {
      var s = await getJson('https://api.smartrecruiters.com/v1/companies/' + encodeURIComponent(slug) + '/postings?limit=100&offset=' + off, 20000);
      var page = s.content || [];
      page.forEach(function (j) {
        var L = j.location || {};
        var loc = [L.city, L.region, (L.country || '').toUpperCase()].filter(Boolean).join(', ');
        out.push({ external_id: String(j.id), title: j.name, location: loc, remote: isRemote(loc, L.remote), department: j.department && j.department.label || null, url: 'https://jobs.smartrecruiters.com/' + slug + '/' + j.id, posted_at: iso(j.releasedDate) });
      });
      if (page.length < 100 || out.length >= (s.totalFound || 0)) break;
    }
  } else if (ats === 'workable') {
    var w = await getJson('https://apply.workable.com/api/v1/widget/accounts/' + encodeURIComponent(slug) + '?details=true', 20000);
    (w.jobs || []).forEach(function (j) {
      var loc = [j.city, j.state, j.country].filter(Boolean).join(', ');
      out.push({ external_id: String(j.shortcode), title: j.title, location: loc, remote: isRemote(loc, j.telecommuting), department: j.department || null, url: j.url || j.application_url, posted_at: iso(j.published_on || j.created_at), pay: payFromText(htmlToText(j.description)) });
    });
  } else if (ats === 'rippling') {
    var r = await getJson('https://api.rippling.com/platform/api/ats/v1/board/' + encodeURIComponent(slug) + '/jobs', 20000);
    (Array.isArray(r) ? r : []).forEach(function (j) {
      var loc = j.workLocation && j.workLocation.label;
      out.push({ external_id: String(j.uuid), title: j.name, location: loc, remote: isRemote(loc), department: j.department && j.department.label || null, url: j.url, posted_at: null });
    });
  } else {
    throw new Error('Unknown job system: ' + ats);
  }
  // A posting needs a title and somewhere to apply; drop anything without.
  var seen = {};
  return out.filter(function (j) {
    if (!j.title || !j.url || !j.external_id || seen[j.external_id]) return false;
    seen[j.external_id] = true;
    return true;
  }).map(function (j) {
    return { external_id: clip(j.external_id, 120), title: clip(j.title, 240), location: j.location ? clip(j.location, 200) : null, remote: !!j.remote, department: j.department ? clip(j.department, 120) : null, url: clip(j.url, 600), posted_at: j.posted_at, pay: j.pay || null };
  });
}

// The full posting text for one role, fetched from the company's own feed
// at the moment someone asks to be checked against it.
export async function fetchDescription(ats, slug, externalId) {
  if (ats === 'greenhouse') {
    var g = await getJson('https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(slug) + '/jobs/' + encodeURIComponent(externalId));
    return htmlToText(g.content);
  }
  if (ats === 'lever') {
    var l = await getJson('https://api.lever.co/v0/postings/' + encodeURIComponent(slug) + '/' + encodeURIComponent(externalId));
    var parts = [l.descriptionPlain || htmlToText(l.description)];
    (l.lists || []).forEach(function (x) { parts.push((x.text || '') + '\n' + htmlToText(x.content)); });
    if (l.additionalPlain || l.additional) parts.push(l.additionalPlain || htmlToText(l.additional));
    return parts.filter(Boolean).join('\n\n').trim();
  }
  if (ats === 'ashby') {
    var a = await getJson('https://api.ashbyhq.com/posting-api/job-board/' + encodeURIComponent(slug), 25000);
    var j = (a.jobs || []).find(function (x) { return String(x.id) === String(externalId); });
    if (!j) throw new Error('That role is no longer listed');
    return (j.descriptionPlain || htmlToText(j.descriptionHtml) || '').trim();
  }
  if (ats === 'smartrecruiters') {
    var s = await getJson('https://api.smartrecruiters.com/v1/companies/' + encodeURIComponent(slug) + '/postings/' + encodeURIComponent(externalId));
    var sec = (s.jobAd && s.jobAd.sections) || {};
    return ['jobDescription', 'qualifications', 'additionalInformation'].map(function (k) { return sec[k] && sec[k].text ? (sec[k].title || '') + '\n' + htmlToText(sec[k].text) : ''; }).filter(Boolean).join('\n\n').trim();
  }
  if (ats === 'workable') {
    var w = await getJson('https://apply.workable.com/api/v1/widget/accounts/' + encodeURIComponent(slug) + '?details=true', 25000);
    var wj = (w.jobs || []).find(function (x) { return String(x.shortcode) === String(externalId); });
    if (!wj) throw new Error('That role is no longer listed');
    return htmlToText(wj.description || '');
  }
  if (ats === 'rippling') {
    var r = await getJson('https://api.rippling.com/platform/api/ats/v1/board/' + encodeURIComponent(slug) + '/jobs/' + encodeURIComponent(externalId));
    var d = r.description;
    if (d && typeof d === 'object') d = Object.keys(d).map(function (k) { return d[k]; }).join('\n');
    return htmlToText(d || '');
  }
  throw new Error('Unknown job system: ' + ats);
}
