import crypto from 'crypto';

// This file deliberately does NOT declare `runtime = 'edge'` like the others.
// Verifying Stripe's signature requires the exact raw request body (any
// re-serialization, even whitespace differences, breaks the signature), so
// the automatic JSON body parser has to be turned off - that's a Node.js
// Function concept (`config.api.bodyParser`), not applicable to a true Edge
// Function. See EZZY_AI_ARCHITECTURE.md-adjacent note: these files already
// run as Node.js Functions in practice regardless of the edge declaration
// on the others (confirmed via the Vercel build log "compiling to
// CommonJS"), so this is consistent with reality, not a new assumption.
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  var parts = sigHeader.split(',').reduce(function (acc, part) {
    var kv = part.split('=');
    acc[kv[0]] = kv[1];
    return acc;
  }, {});
  var timestamp = parts.t;
  var signature = parts.v1;
  if (!timestamp || !signature) return false;

  var expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody, 'utf8')
    .digest('hex');

  var a = Buffer.from(expected, 'hex');
  var b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function upsertSubscription(fields) {
  await fetch(SUPABASE_URL + '/rest/v1/subscriptions?on_conflict=user_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify([fields])
  });
}

async function addResumeReviewCredit(userId) {
  await fetch(SUPABASE_URL + '/rest/v1/rpc/add_resume_review_credit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    body: JSON.stringify({ p_user_id: userId, p_amount: 1 })
  });
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function planStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'past_due';
  return 'none';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  var sigHeader = req.headers && (req.headers['stripe-signature'] || req.headers['Stripe-Signature']);
  if (!verifyStripeSignature(rawBody, sigHeader, process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  var event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    var obj = event.data && event.data.object;

    if (event.type === 'checkout.session.completed' && obj.mode === 'payment') {
      var payMeta = obj.metadata || {};
      if (payMeta.supabase_user_id && payMeta.plan === 'resume_review') {
        await addResumeReviewCredit(payMeta.supabase_user_id);
      } else if (payMeta.supabase_user_id && payMeta.plan === 'job_search') {
        await upsertSubscription({
          user_id: payMeta.supabase_user_id,
          plan: 'job_search',
          status: 'active',
          stripe_customer_id: obj.customer,
          current_period_end: daysFromNow(90),
          updated_at: new Date().toISOString()
        });
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      var meta = obj.metadata || {};
      if (meta.supabase_user_id) {
        await upsertSubscription({
          user_id: meta.supabase_user_id,
          plan: obj.status === 'canceled' ? 'free' : (meta.plan || 'career'),
          billing_interval: 'monthly',
          status: planStatus(obj.status),
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
          current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString()
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      var meta2 = obj.metadata || {};
      if (meta2.supabase_user_id) {
        await upsertSubscription({
          user_id: meta2.supabase_user_id,
          plan: 'free',
          status: 'canceled',
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
          current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString()
        });
      }
    }
    // Other event types are acknowledged but ignored - nothing else drives plan state today.

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: 'Webhook processing error', detail: err.message });
  }
}
