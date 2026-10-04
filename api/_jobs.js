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
function isRemote(loc, flag) { return !!flag || /\bremote\b|work from home|distributed/i.test(String(loc || '')); }
function iso(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
function clip(s, n) { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) : s; }

// One company's open roles, in a common shape. No descriptions here: they
// are fetched only when someone asks for a fit check on a specific role.
export async function fetchListings(ats, slug) {
  var out = [];
  if (ats === 'greenhouse') {
    var g = await getJson('https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(slug) + '/jobs', 25000);
    (g.jobs || []).forEach(function (j) {
      var loc = j.location && j.location.name;
      out.push({ external_id: String(j.id), title: j.title, location: loc, remote: isRemote(loc), department: null, url: j.absolute_url, posted_at: iso(j.first_published || j.updated_at) });
    });
  } else if (ats === 'lever') {
    var l = await getJson('https://api.lever.co/v0/postings/' + encodeURIComponent(slug) + '?mode=json', 25000);
    (Array.isArray(l) ? l : []).forEach(function (j) {
      var c = j.categories || {};
      out.push({ external_id: String(j.id), title: j.text, location: c.location, remote: isRemote(c.location, j.workplaceType === 'remote'), department: c.department || c.team || null, url: j.hostedUrl, posted_at: iso(j.createdAt) });
    });
  } else if (ats === 'ashby') {
    var a = await getJson('https://api.ashbyhq.com/posting-api/job-board/' + encodeURIComponent(slug), 25000);
    (a.jobs || []).forEach(function (j) {
      if (j.isListed === false) return;
      out.push({ external_id: String(j.id), title: j.title, location: j.location, remote: isRemote(j.location, j.isRemote), department: j.department || j.team || null, url: j.jobUrl || j.applyUrl, posted_at: iso(j.publishedAt) });
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
    var w = await getJson('https://apply.workable.com/api/v1/widget/accounts/' + encodeURIComponent(slug), 20000);
    (w.jobs || []).forEach(function (j) {
      var loc = [j.city, j.state, j.country].filter(Boolean).join(', ');
      out.push({ external_id: String(j.shortcode), title: j.title, location: loc, remote: isRemote(loc, j.telecommuting), department: j.department || null, url: j.url || j.application_url, posted_at: iso(j.published_on || j.created_at) });
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
    return { external_id: clip(j.external_id, 120), title: clip(j.title, 240), location: j.location ? clip(j.location, 200) : null, remote: !!j.remote, department: j.department ? clip(j.department, 120) : null, url: clip(j.url, 600), posted_at: j.posted_at };
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
