-- One row per user tracking their plan. Only ever written by the Stripe
-- webhook (api/stripe-webhook.js), which runs outside any user session and
-- therefore needs the service-role key to bypass RLS - see that file for
-- why. Everyone can read only their own row, same pattern as the other
-- Career Brain tables.

create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium')),
  billing_interval text check (billing_interval in ('monthly', 'yearly')),
  status text not null default 'none' check (status in ('none', 'active', 'canceled', 'past_due')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy "subscriptions: read own" on subscriptions
  for select using (auth.uid() = user_id);
