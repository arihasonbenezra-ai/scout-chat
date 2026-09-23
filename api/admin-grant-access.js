export const runtime = 'edge';
import crypto from 'crypto';

// Admin-only tool, not part of the product surface - lets you grant
// someone temporary access (a promo trial, a customer-service goodwill
// gesture) without touching Supabase directly. Auth is the signed session
// token from api/admin-login.js (real email+password login), not a static
// shared secret.
//
// Additive, not overwriting: if the person already has active time left,
// the granted days are added on top of their existing expiry rather than
// replacing it, so "give them an extra month" can never accidentally
// shorten what they already have.

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const VALID_PLANS = ['job_search', 'career'];

// Verifies the HMAC-signed session token issued by api/admin-login.js -
// same secret, so a token only validates here if it was actually issued by
// a successful login there.
function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  var parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    var expectedSig = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(parts[0]).digest('hex');
    var a = Buffer.from(parts[1], 'hex');
    var b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (e) {
    return false;
  }
}

async function findUserByEmail(email) {
  var res = await fetch(SUPABASE_URL + '/auth/v1/admin/users?email=' + encodeURIComponent(email), {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!res.ok) throw new Error('User lookup failed: ' + res.status);
  var data = await res.json();
  var users = data.users || data;
  return Array.isArray(users) && users[0] ? users[0] : null;
}

async function fetchSubscription(userId) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + userId + '&select=*', {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!res.ok) throw new Error('Subscription lookup failed: ' + res.status);
  var rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var sessionToken = req.headers && (req.headers['x-admin-session'] || req.headers['X-Admin-Session']);
  if (!process.env.ADMIN_SESSION_SECRET || !verifySession(sessionToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var body = req.body || {};
    var email = typeof body.email === 'string' ? body.email.trim() : '';
    var plan = VALID_PLANS.indexOf(body.plan) !== -1 ? body.plan : null;
    var days = Number(body.days);

    if (!email) return res.status(400).json({ error: 'email required' });
    if (!plan) return res.status(400).json({ error: 'plan must be job_search or career' });
    if (!days || days <= 0 || days > 365) return res.status(400).json({ error: 'days must be between 1 and 365' });

    var user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'No account found for that email' });

    var existingSub = await fetchSubscription(user.id);
    var now = Date.now();
    var existingEnd = existingSub && existingSub.current_period_end ? new Date(existingSub.current_period_end).getTime() : 0;
    var base = Math.max(now, existingEnd);
    var newPeriodEnd = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

    var upsertRes = await fetch(SUPABASE_URL + '/rest/v1/subscriptions?on_conflict=user_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify([{
        user_id: user.id,
        plan: plan,
        status: 'active',
        current_period_end: newPeriodEnd,
        updated_at: new Date().toISOString()
      }])
    });
    if (!upsertRes.ok) {
      var errText = await upsertRes.text();
      throw new Error('Grant failed: ' + upsertRes.status + ' ' + errText);
    }

    return res.status(200).json({
      email: email,
      plan: plan,
      grantedDays: days,
      newExpiry: newPeriodEnd,
      hadExistingAccess: existingEnd > now
    });
  } catch (err) {
    return res.status(500).json({ error: 'Grant error', detail: err.message });
  }
}
