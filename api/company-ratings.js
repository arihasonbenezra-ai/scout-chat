// Node runtime, not edge: this call reads a posting and makes model
// calls before it can answer, and an edge function that has not started
// its response within 25 seconds is cut off with no body. Node gets a
// minute.
export const config = { maxDuration: 60 };

// Employer ratings for one company: Glassdoor, Indeed and Blind scores
// found by web search. The model is asked for one sentence per site; a
// sentence is kept only when the API attached a citation from that site
// whose quoted page text contains the same number. Anything else is
// dropped before it is stored or shown. Results are cached per company
// for 30 days so a company costs one search a month, not one per view.

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];
const TTL_DAYS = 30;

const SITES = [
  { site: 'Glassdoor', hosts: ['glassdoor.'] },
  { site: 'Indeed', hosts: ['indeed.'] },
  { site: 'Blind', hosts: ['teamblind.com'] }
];

const SYSTEM = [
  'You look up a company\'s employer rating on Glassdoor, Indeed and Blind using web search.',
  'Search for the company\'s rating on each site. Then reply with one line per site that a search result states a rating for, in exactly this form:',
  'Glassdoor: 3.8 out of 5 from 2,145 reviews.',
  'Leave out "from N reviews" when no result states the count. Leave out any site no result covers. If no result states any rating, reply with the single word NONE.',
  'Write nothing else: no preamble, no notes, no review text, no quotes from reviews.'
].join('\n');

function corsOrigin(req) {
  var origin = req.headers && (req.headers.origin || req.headers.Origin);
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
}

async function getAuthedUser(token) {
  if (!token) return null;
  var res = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  var data = await res.json();
  return data && data.id ? data : null;
}

function serviceHeaders() {
  return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY };
}

function normalizeKey(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function readCache(key) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/company_ratings?company_key=eq.' + encodeURIComponent(key) + '&select=company,ratings,checked_at&limit=1', { headers: serviceHeaders() });
    if (!res.ok) return null;
    var rows = await res.json();
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

async function writeCache(key, company, ratings) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/company_ratings?on_conflict=company_key', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, serviceHeaders()),
      body: JSON.stringify([{ company_key: key, company: company, ratings: ratings, checked_at: new Date().toISOString() }])
    });
  } catch (e) {
    // best effort; a missed cache write costs one more search next month
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function siteFor(url) {
  var h = hostOf(url);
  for (var i = 0; i < SITES.length; i++) {
    for (var j = 0; j < SITES[i].hosts.length; j++) if (h.indexOf(SITES[i].hosts[j]) !== -1) return SITES[i].site;
  }
  return null;
}

async function search(company) {
  var body = {
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: 'user', content: 'Company: ' + company }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
  };
  var content = [];
  for (var i = 0; i < 2; i++) {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    var data = await r.json();
    if (!r.ok) return { ok: false, status: r.status, data: data };
    content = content.concat(data.content || []);
    if (data.stop_reason !== 'pause_turn') break;
    body = Object.assign({}, body, { messages: body.messages.concat([{ role: 'assistant', content: data.content }]) });
  }
  return { ok: true, content: content };
}

// The check. A line survives only if the model's own citation for it is
// from the named site and quotes a passage that contains the same rating.
var LINE_RE = /(Glassdoor|Indeed|Blind)\s*:\s*(\d(?:\.\d)?)\s*out of 5(?:\s*from\s*([\d,]+)\s*reviews)?/gi;

function verify(content) {
  var pageAge = {};
  (content || []).forEach(function (b) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      b.content.forEach(function (r) { if (r && r.type === 'web_search_result' && r.url) pageAge[r.url] = r.page_age || null; });
    }
  });
  var found = {};
  (content || []).forEach(function (b) {
    if (b.type !== 'text' || typeof b.text !== 'string') return;
    var cites = Array.isArray(b.citations) ? b.citations.filter(function (c) { return c && c.type === 'web_search_result_location' && c.url; }) : [];
    var m;
    LINE_RE.lastIndex = 0;
    while ((m = LINE_RE.exec(b.text))) {
      var site = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      var rating = m[2];
      var count = m[3] ? m[3].replace(/,/g, '') : null;
      if (found[site]) continue;
      for (var i = 0; i < cites.length; i++) {
        var c = cites[i];
        if (siteFor(c.url) !== site) continue;
        var quoted = String(c.cited_text || '');
        if (quoted.indexOf(rating) === -1) continue;
        var countOk = count && (quoted.indexOf(count) !== -1 || quoted.indexOf(Number(count).toLocaleString('en-US')) !== -1);
        found[site] = { site: site, rating: Number(rating), count: countOk ? Number(count) : null, url: c.url, as_of: pageAge[c.url] || null };
        break;
      }
    }
  });
  return SITES.map(function (s) { return found[s.site]; }).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
    var token = authHeader && authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : null;
    var user = await getAuthedUser(token);
    if (!user) return res.status(401).json({ error: 'Sign in required' });

    var q = {};
    try { q = Object.fromEntries(new URL(req.url, 'https://app.meetezzy.com').searchParams); } catch (e) {}
    var company = String(q.company || (req.query && req.query.company) || '').trim().slice(0, 120);
    var key = normalizeKey(company);
    if (!key) return res.status(400).json({ error: 'company required' });

    var cached = await readCache(key);
    if (cached && cached.checked_at && Date.now() - new Date(cached.checked_at).getTime() < TTL_DAYS * 24 * 60 * 60 * 1000) {
      return res.status(200).json({ company: cached.company, ratings: cached.ratings || [], checked_at: cached.checked_at, cached: true });
    }

    var sr = await search(company);
    if (!sr.ok) {
      // Serve a stale row over nothing when the search itself failed.
      if (cached) return res.status(200).json({ company: cached.company, ratings: cached.ratings || [], checked_at: cached.checked_at, cached: true, stale: true });
      return res.status(sr.status || 502).json({ error: 'Rating lookup failed' });
    }
    var ratings = verify(sr.content);
    var now = new Date().toISOString();
    await writeCache(key, company, ratings);
    return res.status(200).json({ company: company, ratings: ratings, checked_at: now, cached: false });
  } catch (e) {
    return res.status(500).json({ error: 'Rating lookup failed' });
  }
}
