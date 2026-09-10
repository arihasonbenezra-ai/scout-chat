export const runtime = 'edge';

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];

// Premium is intentionally left out of AVAILABLE_PLANS: its whole value prop
// (proactive opportunity-finding, company monitoring) doesn't exist in the
// product yet, so it isn't for sale yet either. Prices are still defined
// here so flipping it on later is a one-line change, not a rebuild.
const PLAN_PRICES = {
  pro: {
    monthly: { amount: 1999, label: 'Ezzy Pro (Monthly)' },
    yearly: { amount: 14900, label: 'Ezzy Pro (Yearly)' }
  },
  premium: {
    monthly: { amount: 3999, label: 'Ezzy Premium (Monthly)' },
    yearly: { amount: 29900, label: 'Ezzy Premium (Yearly)' }
  }
};
const AVAILABLE_PLANS = ['pro'];

function corsOrigin(req) {
  var origin = req.headers && (req.headers.origin || req.headers.Origin);
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
}

async function getAuthedUser(token) {
  if (!token) return null;
  var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
  });
  if (!res.ok) return null;
  var data = await res.json();
  return data && data.id ? data : null;
}

// Stripe's API is form-encoded, not JSON - this flattens a nested object
// into the bracket notation Stripe expects (a[b][c]=d), the standard way
// to call Stripe with plain fetch instead of their SDK.
function toFormPairs(obj, prefix) {
  var pairs = [];
  Object.keys(obj).forEach(function (key) {
    var value = obj[key];
    if (value === undefined || value === null) return;
    var fullKey = prefix ? prefix + '[' + key + ']' : key;
    if (Array.isArray(value)) {
      value.forEach(function (item, i) {
        var arrKey = fullKey + '[' + i + ']';
        if (item && typeof item === 'object') pairs = pairs.concat(toFormPairs(item, arrKey));
        else pairs.push(encodeURIComponent(arrKey) + '=' + encodeURIComponent(item));
      });
    } else if (typeof value === 'object') {
      pairs = pairs.concat(toFormPairs(value, fullKey));
    } else {
      pairs.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(value));
    }
  });
  return pairs;
}

function stripeFormBody(obj) {
  return toFormPairs(obj).join('&');
}

export default async function handler(req, res) {
  var origin = corsOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
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
    var plan = body.plan;
    var interval = body.interval === 'yearly' ? 'yearly' : 'monthly';

    if (AVAILABLE_PLANS.indexOf(plan) === -1 || !PLAN_PRICES[plan]) {
      return res.status(400).json({ error: 'Plan not available yet' });
    }
    var priceInfo = PLAN_PRICES[plan][interval];

    var stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: stripeFormBody({
        mode: 'subscription',
        customer_email: user.email,
        client_reference_id: user.id,
        success_url: origin + '/?checkout=success',
        cancel_url: origin + '/?checkout=cancel',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: priceInfo.amount,
            recurring: { interval: interval === 'yearly' ? 'year' : 'month' },
            product_data: { name: priceInfo.label }
          }
        }],
        subscription_data: {
          metadata: { supabase_user_id: user.id, plan: plan, billing_interval: interval }
        }
      })
    });

    var session = await stripeRes.json();
    if (!stripeRes.ok) {
      var keyRaw = process.env.STRIPE_SECRET_KEY || '';
      return res.status(502).json({
        error: 'Stripe error',
        detail: session,
        keySeenByThisFunction: {
          present: !!keyRaw,
          length: keyRaw.length,
          startsWith: keyRaw.slice(0, 12),
          endsWith: keyRaw.slice(-6)
        }
      });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'Checkout error', detail: err.message });
  }
}
