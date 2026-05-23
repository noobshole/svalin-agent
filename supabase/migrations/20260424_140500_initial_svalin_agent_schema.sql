create table if not exists public.wallet_profiles (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  primary_chain text not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_profiles_wallet_address_check
    check (wallet_address ~ '^0x[a-fA-F0-9]{40}$')
);

create table if not exists public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  wallet_profile_id uuid not null references public.wallet_profiles(id) on delete cascade,
  total_value_usd numeric(18, 2) not null default 0,
  day_change_pct numeric(8, 2),
  risk_score integer,
  raw_payload jsonb not null,
  captured_at timestamptz not null default now(),
  constraint portfolio_snapshots_risk_score_check
    check (risk_score is null or (risk_score >= 0 and risk_score <= 100))
);

create table if not exists public.agent_recommendations (
  id uuid primary key default gen_random_uuid(),
  wallet_profile_id uuid not null references public.wallet_profiles(id) on delete cascade,
  recommendation_type text not null,
  title text not null,
  summary text not null,
  confidence numeric(5, 2),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  constraint agent_recommendations_status_check
    check (status in ('active', 'dismissed', 'accepted')),
  constraint agent_recommendations_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 100))
);

create index if not exists idx_portfolio_snapshots_wallet_profile_id
  on public.portfolio_snapshots(wallet_profile_id, captured_at desc);

create index if not exists idx_agent_recommendations_wallet_profile_id
  on public.agent_recommendations(wallet_profile_id, created_at desc);
