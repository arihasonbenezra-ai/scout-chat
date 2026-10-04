// Refreshes job_listings from the open job-board feeds in job_sources.
// Called by the Vercel cron in vercel.json (daily), or by hand with the
// secret. One call works through the stalest sources until its time
// budget is spent, then hands the rest to a fresh call of itself, so a
// full pass over ~185 companies finishes without one long-running request.
import { fetchListings, familyFor, levelFor } from './_jobs.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const STALE_HOURS = 20;      // a source synced more recently than this is skipped
const TIME_BUDGET_MS = 38000;
const PARALLEL = 5;
const MAX_CHAIN = 30;

function svc(extra) {
  return Object.assign({
    'Content-Type': 'application/json',
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
  }, extra || {});
}
async function rest(path, opts) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.status === 204 ? null : res.json().catch(function () { return null; });
}

async function syncSource(src) {
  const started = new Date().toISOString();
  try {
    const listings = await fetchListings(src.ats, src.slug);
    const rows = listings.map(function (j) {
      return {
        company: src.company, ats: src.ats, slug: src.slug, external_id: j.external_id,
        title: j.title, location: j.location, remote: j.remote, department: j.department, url: j.url,
        posted_at: j.posted_at, family: familyFor(j.title), level: levelFor(j.title),
        active: true, last_seen_at: started
      };
    });
    for (var i = 0; i < rows.length; i += 500) {
      await rest('job_listings?on_conflict=ats,slug,external_id', {
        method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows.slice(i, i + 500))
      });
    }
    // Anything this feed no longer lists is closed.
    await rest('job_listings?ats=eq.' + encodeURIComponent(src.ats) + '&slug=eq.' + encodeURIComponent(src.slug) + '&active=eq.true&last_seen_at=lt.' + encodeURIComponent(started), {
      method: 'PATCH', headers: svc({ Prefer: 'return=minimal' }), body: JSON.stringify({ active: false })
    });
    await rest('job_sources?id=eq.' + src.id, { method: 'PATCH', headers: svc({ Prefer: 'return=minimal' }), body: JSON.stringify({ last_synced_at: started, last_count: rows.length, last_error: null }) });
    return { company: src.company, roles: rows.length };
  } catch (e) {
    // Record the failure and move on; a broken feed must not stall the queue.
    try {
      await rest('job_sources?id=eq.' + src.id, { method: 'PATCH', headers: svc({ Prefer: 'return=minimal' }), body: JSON.stringify({ last_synced_at: started, last_error: String(e && e.message || e).slice(0, 300) }) });
    } catch (e2) { /* nothing more to do */ }
    return { company: src.company, error: String(e && e.message || e).slice(0, 160) };
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  const key = (req.query && req.query.key) || '';
  if (!secret || (auth !== 'Bearer ' + secret && key !== secret)) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Service key missing' });

  const t0 = Date.now();
  const depth = Math.max(0, parseInt((req.query && req.query.depth) || '0', 10) || 0);
  const force = (req.query && req.query.force) === '1';
  const cutoff = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();

  try {
    // force=1 on the first call marks everything stale, then the normal queue runs.
    if (force && depth === 0) {
      await rest('job_sources?active=eq.true', { method: 'PATCH', headers: svc({ Prefer: 'return=minimal' }), body: JSON.stringify({ last_synced_at: null }) });
    }
    const done = [];
    while (Date.now() - t0 < TIME_BUDGET_MS) {
      const batch = await rest('job_sources?active=eq.true&select=id,company,ats,slug&order=last_synced_at.asc.nullsfirst&limit=' + PARALLEL
        + '&or=(last_synced_at.is.null,last_synced_at.lt.' + encodeURIComponent(cutoff) + ')', { headers: svc() });
      if (!batch || !batch.length) break;
      const results = await Promise.all(batch.map(syncSource));
      results.forEach(function (r) { done.push(r); });
    }
    const left = await rest('job_sources?active=eq.true&select=id&limit=1&or=(last_synced_at.is.null,last_synced_at.lt.' + encodeURIComponent(cutoff) + ')', { headers: svc() });
    const more = !!(left && left.length);
    if (more && depth < MAX_CHAIN) {
      // Hand the rest to a fresh invocation. We only wait long enough for
      // the request to leave; the next call runs on its own clock.
      const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'app.meetezzy.com';
      try {
        await fetch('https://' + host + '/api/jobs-sync?depth=' + (depth + 1), { headers: { Authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(2500) });
      } catch (e) { /* expected: we do not wait for it to finish */ }
    }
    return res.status(200).json({
      depth: depth, synced: done.filter(function (d) { return !d.error; }).length,
      roles: done.reduce(function (n, d) { return n + (d.roles || 0); }, 0),
      errors: done.filter(function (d) { return d.error; }), more: more, ms: Date.now() - t0
    });
  } catch (err) {
    return res.status(500).json({ error: 'Sync error', detail: String(err && err.message || err).slice(0, 300) });
  }
}
