// The two things a person must be able to do without emailing anyone:
// stop paying, and leave. cancel: Stripe stops the subscription at the
// end of the paid month; the webhook drops the plan to free when Stripe
// says so. delete: the subscription is cancelled now, every row the
// account owns goes, then the login itself; the tables from the
// migrations cascade from auth.users, the three older ones are deleted
// by hand first.
export const config = { maxDuration: 30 };

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];

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
function svc(extra) {
  return Object.assign({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }, extra || {});
}
async function rest(method, path, body) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: method, headers: svc({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: body ? JSON.stringify(body) : undefined
  });
  return res.ok;
}
async function restRows(path) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: svc() });
  return res.ok ? res.json() : [];
}
async function stripe(method, path, form) {
  var res = await fetch('https://api.stripe.com/v1/' + path, {
    method: method,
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, data: data };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    var authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
    var token = authHeader && authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : null;
    var user = await getAuthedUser(token);
    if (!user) return res.status(401).json({ error: 'Sign in required' });
    var body = req.body || {};
    var sub = (await restRows('subscriptions?user_id=eq.' + user.id + '&select=plan,status,stripe_subscription_id,current_period_end'))[0] || null;

    if (body.action === 'cancel') {
      if (sub && sub.stripe_subscription_id) {
        var sr = await stripe('POST', 'subscriptions/' + encodeURIComponent(sub.stripe_subscription_id), { cancel_at_period_end: 'true' });
        if (!sr.ok && !(sr.data && sr.data.error && sr.data.error.code === 'resource_missing')) {
          return res.status(502).json({ error: 'Could not reach billing', detail: sr.data && sr.data.error && sr.data.error.message });
        }
        return res.status(200).json({ ok: true, billed: true, ends: sub.current_period_end || null });
      }
      // Nothing billed through Stripe (a granted plan, or a one-time
      // purchase): there is nothing to stop; access ends when it ends.
      return res.status(200).json({ ok: true, billed: false, ends: sub ? sub.current_period_end || null : null });
    }

    if (body.action === 'delete') {
      if (body.confirm !== 'DELETE') return res.status(400).json({ error: 'confirm_required' });
      if (sub && sub.stripe_subscription_id) {
        var dr = await stripe('DELETE', 'subscriptions/' + encodeURIComponent(sub.stripe_subscription_id));
        if (!dr.ok && !(dr.data && dr.data.error && dr.data.error.code === 'resource_missing')) {
          return res.status(502).json({ error: 'Could not stop billing first', detail: dr.data && dr.data.error && dr.data.error.message });
        }
      }
      // The three tables older than the migrations do not cascade.
      var convos = await restRows('conversations?user_id=eq.' + user.id + '&select=id');
      var ids = (convos || []).map(function (c) { return c.id; });
      for (var i = 0; i < ids.length; i += 100) {
        await rest('DELETE', 'messages?conversation_id=in.(' + ids.slice(i, i + 100).join(',') + ')');
      }
      await rest('DELETE', 'conversations?user_id=eq.' + user.id);
      await rest('DELETE', 'profiles?id=eq.' + user.id);
      // Everything else cascades from the login.
      var del = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + user.id, { method: 'DELETE', headers: svc() });
      if (!del.ok) return res.status(502).json({ error: 'Could not delete the login', detail: (await del.text()).slice(0, 200) });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action must be cancel or delete' });
  } catch (err) {
    return res.status(500).json({ error: 'Account error', detail: err && err.message });
  }
}
