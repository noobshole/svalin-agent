-- Svalin v1: accept Solana wallets and record x402 revenue.

-- 1. Wallet profiles were EVM-only. Allow Solana base58 addresses too.
alter table public.wallet_profiles
  drop constraint if exists wallet_profiles_wallet_address_check;

alter table public.wallet_profiles
  add constraint wallet_profiles_wallet_address_check
  check (
    wallet_address ~ '^0x[a-fA-F0-9]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  );

-- 2. Revenue ledger: one row per settled x402 payment, written by the API
--    (SupabaseLedger) with the service-role key.
create table if not exists public.api_payments (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  network text not null,                 -- CAIP-2, e.g. solana:5eykt4Us… or eip155:8453
  payer text,
  pay_to text not null,
  amount_atomic numeric(38, 0) not null, -- USDC has 6 decimals: 10000 = $0.01
  asset text not null,
  transaction text not null,
  settled_at timestamptz not null default now(),
  constraint api_payments_transaction_unique unique (network, transaction)
);

create index if not exists idx_api_payments_settled_at on public.api_payments (settled_at desc);
create index if not exists idx_api_payments_payer on public.api_payments (payer);

-- Service role bypasses RLS; nobody else may read revenue data.
alter table public.api_payments enable row level security;

-- 3. Daily revenue view for a quick dashboard (USDC → USD at 1:1).
--    security_invoker keeps the view behind api_payments' RLS.
create or replace view public.api_revenue_daily
with (security_invoker = true) as
select
  date_trunc('day', settled_at) as day,
  network,
  route,
  count(*) as calls,
  count(distinct payer) as unique_payers,
  round(sum(amount_atomic) / 1e6, 6) as revenue_usd
from public.api_payments
group by 1, 2, 3
order by 1 desc;
