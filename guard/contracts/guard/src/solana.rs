//! The Solana payment a vault writes and NEAR Chain Signatures signs: an x402 `exact` payment in the
//! layout x402's own Solana client uses, so any x402 seller on Solana takes it.
//!
//! The vault writes every byte itself. The agent brings only what is not the vault's to decide: the
//! seller's fee payer (its facilitator signs as fee payer and pays the Solana fee), a recent
//! blockhash (which only sets when the payment expires), and the two token accounts, which are
//! checked here to be the vault's own and the payee's.

use near_sdk::env;

pub const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const ASSOCIATED_TOKEN_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
pub const COMPUTE_BUDGET_PROGRAM: &str = "ComputeBudget111111111111111111111111111111";
pub const MEMO_PROGRAM: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/// The compute budget x402's own Solana client sets.
pub const COMPUTE_UNIT_LIMIT: u32 = 20_000;
pub const COMPUTE_UNIT_PRICE_MICROLAMPORTS: u64 = 1;
/// x402's limit on a seller's memo.
pub const MAX_MEMO_LEN: usize = 256;

pub type Address = [u8; 32];

/// A Solana address from its base58 text; none if it is not 32 bytes.
pub fn decode(text: &str) -> Option<Address> {
    if text.is_empty() || text.len() > 44 {
        return None;
    }
    near_sdk::bs58::decode(text).into_vec().ok()?.try_into().ok()
}

pub fn encode(address: &Address) -> String {
    near_sdk::bs58::encode(address).into_string()
}

fn program(text: &str) -> Address {
    decode(text).expect("program ids are valid addresses")
}

/// Whether `address` is the token account the associated token program gives `owner` for `mint`.
///
/// Solana's own derivation takes the first bump, from 255 down, whose hash is not a curve point.
/// Checking a curve point needs field arithmetic, so this accepts any bump whose hash matches
/// instead. That is as safe: an address from another bump can never hold a token account, since
/// only the associated token program could create one there and it uses the first bump only, and
/// a hash that is a curve point has no key anyone knows.
pub fn is_token_account(address: &Address, owner: &Address, mint: &Address) -> bool {
    let program_id = program(ASSOCIATED_TOKEN_PROGRAM);
    let mut input = Vec::with_capacity(32 * 4 + 1 + 21);
    input.extend_from_slice(owner);
    input.extend_from_slice(&program(TOKEN_PROGRAM));
    input.extend_from_slice(mint);
    input.push(0);
    input.extend_from_slice(&program_id);
    input.extend_from_slice(b"ProgramDerivedAddress");
    let bump_at = 96;
    (0..=255u8).rev().any(|bump| {
        input[bump_at] = bump;
        env::sha256_array(&input) == *address
    })
}

fn compact_u16(out: &mut Vec<u8>, mut value: usize) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn instruction(out: &mut Vec<u8>, program_index: u8, accounts: &[u8], data: &[u8]) {
    out.push(program_index);
    compact_u16(out, accounts.len());
    out.extend_from_slice(accounts);
    compact_u16(out, data.len());
    out.extend_from_slice(data);
}

/// One payment, as the vault signs it.
pub struct Payment<'a> {
    pub fee_payer: &'a Address,
    pub authority: &'a Address,
    pub source: &'a Address,
    pub destination: &'a Address,
    pub mint: &'a Address,
    pub amount: u64,
    pub decimals: u8,
    pub memo: &'a str,
    pub blockhash: &'a Address,
}

/// The v0 message: the fee payer first, the vault's address as the only other signer (read-only),
/// the two token accounts it writes, then what it only reads; then x402's fixed order of
/// instructions: compute limit, compute price, one `TransferChecked`, a memo.
pub fn message(payment: &Payment) -> Vec<u8> {
    let accounts: [Address; 8] = [
        *payment.fee_payer,
        *payment.authority,
        *payment.source,
        *payment.destination,
        *payment.mint,
        program(TOKEN_PROGRAM),
        program(COMPUTE_BUDGET_PROGRAM),
        program(MEMO_PROGRAM),
    ];
    let mut out = Vec::with_capacity(400);
    // Version 0; two signatures, one of them read-only; four read-only accounts that do not sign.
    out.extend_from_slice(&[0x80, 2, 1, 4]);
    compact_u16(&mut out, accounts.len());
    for account in &accounts {
        out.extend_from_slice(account);
    }
    out.extend_from_slice(payment.blockhash);
    compact_u16(&mut out, 4);
    let mut limit = vec![2];
    limit.extend_from_slice(&COMPUTE_UNIT_LIMIT.to_le_bytes());
    instruction(&mut out, 6, &[], &limit);
    let mut price = vec![3];
    price.extend_from_slice(&COMPUTE_UNIT_PRICE_MICROLAMPORTS.to_le_bytes());
    instruction(&mut out, 6, &[], &price);
    // TransferChecked: source, mint, destination, authority.
    let mut transfer = vec![12];
    transfer.extend_from_slice(&payment.amount.to_le_bytes());
    transfer.push(payment.decimals);
    instruction(&mut out, 5, &[2, 4, 3, 1], &transfer);
    instruction(&mut out, 7, &[], payment.memo.as_bytes());
    // No address lookup tables.
    compact_u16(&mut out, 0);
    out
}

/// The transaction a seller receives: the fee payer's signature still empty, then the vault's.
pub fn partly_signed(message: &[u8], signature: &[u8; 64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + 128 + message.len());
    compact_u16(&mut out, 2);
    out.extend_from_slice(&[0; 64]);
    out.extend_from_slice(signature);
    out.extend_from_slice(message);
    out
}

/// Whether eight accounts are all different, as a Solana message needs them.
pub fn all_different(accounts: &[&Address]) -> bool {
    accounts.iter().enumerate().all(|(i, a)| accounts[i + 1..].iter().all(|b| a != b))
}
