-- Svalin analyses Solana wallets and NEAR accounts. Replace the EVM address pattern on wallet
-- profiles with NEAR account IDs (2-64 characters, lowercase, dot-separated parts).
-- NOT VALID applies the rule to new rows only, so the migration never fails on existing data.
alter table public.wallet_profiles
  drop constraint if exists wallet_profiles_wallet_address_check;

alter table public.wallet_profiles
  add constraint wallet_profiles_wallet_address_check
  check (
    wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or (
      char_length(wallet_address) between 2 and 64
      and wallet_address ~ '^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$'
    )
  ) not valid;
