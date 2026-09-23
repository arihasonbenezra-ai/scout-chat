export const runtime = 'edge';
import crypto from 'crypto';

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_ATTEMPT_LIMIT = 10;

function clientIp(req) {
  var xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (xff) return xff.split(',')[0].trim();
  return (req.headers && req.headers['x-real-ip']) || 'unknown';
}

// Rate-limits login attempts by IP regardless of whether the password was
// right - reuses the same anon_rate_limit table/RPC as the public anon
// message cap, just a different key prefix. This is what actually stops a
// memorable password from being brute-forced.
async function attemptsRemaining(ip) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/increment_anon_usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ p_key: 'admin-login:' + ip, p_window_hours: 1 })
    });
    if (!res.ok) return true; // fail open on infra errors, same as the anon cap
    var hits = await res.json();
    return hits <= LOGIN_ATTEMPT_LIMIT;
  } catch (e) {
    return true;
  }
}

// Password is never stored in plaintext - ADMIN_PASSWORD_HASH holds
// "saltHex:hashHex" from scrypt (Node's built-in, no external dependency
// needed - this project has no package.json/npm deps at all).
function verifyPassword(password, stored) {
  var parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  var salt = Buffer.from(parts[0], 'hex');
  var expected = Buffer.from(parts[1], 'hex');
  var computed = crypto.scryptSync(password, salt, expected.length);
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

function signSession() {
  var payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  var sig = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return payload + '.' + sig;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await attemptsRemaining(clientIp(req)))) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a bit.' });
  }

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_SESSION_SECRET) {
    return res.status(500).json({ error: 'Admin login is not configured yet' });
  }

  var body = req.body || {};
  var email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  var password = typeof body.password === 'string' ? body.password : '';
  var expectedEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();

  if (email !== expectedEmail || !password || !verifyPassword(password, process.env.ADMIN_PASSWORD_HASH)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.status(200).json({ token: signSession() });
}
