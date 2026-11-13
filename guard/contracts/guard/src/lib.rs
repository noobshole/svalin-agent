//! Svalin Guard: a vault for an AI agent's money.
//!
//! - The agent holds one key, and it can only ask to pay or buy. It cannot approve, change a rule
//!   or withdraw.
//! - Every request is paid, held for the owner, or refused, with reasons. A payee whose name
//!   imitates a well-known account or one this vault paid before is refused: Svalin's look-alike
//!   rules run inside the contract, so no outside service has to be trusted.
//! - Limits follow trust: a payee the vault has paid before gets the full per-payment limit, a new
//!   one only the smaller new-payee limit.
//! - The owner's key is protected too. Making the vault safer takes effect at once; making it
//!   riskier waits (24 hours by default) and can be cancelled by the owner or the guardian. All
//!   money leaving the vault other than as a payment waits, even to the owner's own account: a
//!   thief who has the owner's key controls that account too. The guardian can only freeze, cancel,
//!   and start a recovery that waits 7 days.
//! - The owner can add a passkey, so a fingerprint or face on their own device can stop money at
//!   any time and approve a payment to someone already paid, within the limits. A passkey prompt
//!   shows only the website's name, so anything riskier needs the wallet, which shows the payment.
//! - Initialising the vault deletes the key that deployed it, so no key can bypass these rules.
//! - A payee the vault has never paid is checked first by Svalin's check program, run by OutLayer
//!   inside a TEE: an account that does not exist is refused, one younger than a day is held.
//! - Three look-alike refusals or forged grades within an hour freeze the vault: an agent that keeps
//!   trying fakes has probably been taken over.
//! - The agent can also ask to buy a token, and the vault buys only one with real money behind it:
//!   its liquidity grade, proven against the Svalin Ratings registry on NEAR, from a recent edition
//!   and at least the owner's minimum. A buy is bought or refused, never held.
//! - A payment can say what it buys from which service. A service's terms are locked on its first
//!   payment, or by the owner beforehand: a higher price or another payee is held, an expired quote
//!   is refused, and the same item bought again within 15 minutes is held.
//! - The vault can also pay on Solana, through NEAR Chain Signatures: its Solana address is derived
//!   from the vault's NEAR account and nobody holds its key. The same rules and limits apply; the
//!   vault writes each Solana payment itself and asks NEAR's signing network to sign it, so the
//!   agent gets a standard x402 payment any Solana seller takes. A held Solana payment the owner
//!   approves is paid when the agent asks for it again within an hour, since a Solana payment
//!   expires in about a minute.

// `new` takes the vault's settings as named JSON arguments, and the code `#[near]` generates for it
// carries them all, so the lint can only be relaxed for the crate.
#![allow(clippy::too_many_arguments)]

mod lookalike;
mod solana;
#[cfg(test)]
mod tests;

use lookalike::Likeness;
use near_sdk::base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL};
use near_sdk::base64::Engine;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, Allowance, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue, PublicKey,
};

const MINUTE_MS: u64 = 60 * 1000;
const HOUR_MS: u64 = 60 * MINUTE_MS;
const DAY_MS: u64 = 24 * HOUR_MS;
/// NEAR the agent's key may spend on gas before the owner tops it up (a new key is needed then). A
/// request that checks a new payee attaches about 200 TGas.
const AGENT_GAS_ALLOWANCE: NearToken = NearToken::from_near(1);
/// The only calls the agent's key can make.
const AGENT_METHODS: &str = "request_payment,request_buy,request_solana_payment,collect_solana_withdrawal";
/// NEAR the owner's device key may spend on gas; `top_up_passkey` renews it.
const PASSKEY_GAS_ALLOWANCE: NearToken = NearToken::from_millinear(250);
/// The only call the owner's device key can make.
const PASSKEY_METHODS: &str = "use_passkey";
/// WebAuthn's "user present" and "user verified" flags: someone touched the device and passed its
/// fingerprint, face or PIN.
const PASSKEY_FLAGS: u8 = 0x01 | 0x04;
/// The longest memo a payment can carry, so an agent cannot fill the vault's storage with one.
const MAX_MEMO_LEN: usize = 256;
/// A Solana payee's name in the vault: `solana:` and its address. A NEAR account name cannot hold a
/// colon, so the two kinds never meet.
const SOLANA_PREFIX: &str = "solana:";
/// NEAR's signing network asks at least 15 TGas for `sign`; its answer comes back by yield and resume.
const SIGN_GAS: Gas = Gas::from_tgas(30);
/// Checking the signature, writing the transaction and recording the payee.
const SIGNED_CALLBACK_GAS: Gas = Gas::from_tgas(20);
/// Its `derived_public_key`, and ours, which stores the address.
const ADDRESS_GAS: Gas = Gas::from_tgas(10);
const ADDRESS_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// The signing network's answer is about 300 bytes.
const MAX_SIGN_RESULT: usize = 1024;
/// The signing network's ed25519 keys, the ones Solana uses.
const ED25519_DOMAIN: u64 = 1;
/// An approved Solana payment is paid when the agent asks for it again within this long.
const CLEARED_MAX_AGE_MS: u64 = HOUR_MS;
const TRANSFER_GAS: Gas = Gas::from_tgas(15);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// The registry's `verify`, then ours, which may buy: registering with the token, the fee transfer,
/// the market call and their callbacks.
const VERIFY_GAS: Gas = Gas::from_tgas(15);
const GRADE_CALLBACK_GAS: Gas = Gas::from_tgas(150);
/// `ft_transfer_call` to the market, including its `ft_on_transfer` and the token's refund step.
const BUY_GAS: Gas = Gas::from_tgas(60);
/// Settling a buy, which may pay Svalin's fee (a transfer and its callback).
const BUY_CALLBACK_GAS: Gas = Gas::from_tgas(40);
/// The bought token's `storage_deposit`, then ours, which buys.
const REGISTER_GAS: Gas = Gas::from_tgas(15);
const REGISTERED_CALLBACK_GAS: Gas = Gas::from_tgas(115);
/// Attached to `storage_deposit`. The token keeps what it needs and refunds the rest, and all of it
/// when the vault is already registered, so buying again costs nothing.
const REGISTER_DEPOSIT: NearToken = NearToken::from_millinear(13);
/// Market pools the owner can approve at most.
const MAX_POOLS: usize = 32;
/// The registry's answer is a few hundred bytes.
const MAX_VERIFY_RESULT: usize = 2048;
/// `storage_deposit` answers with a short balance.
const MAX_REGISTER_RESULT: usize = 256;
/// Svalin's fee on a buy can be 1% at most.
const MAX_FEE_BPS: u16 = 100;
/// Liquidity grades, best first.
const GRADES: [&str; 5] = ["A", "B", "C", "D", "F"];
/// OutLayer's own call, then ours, which may pay (a transfer and its callback).
const CHECK_GAS: Gas = Gas::from_tgas(100);
const CHECK_CALLBACK_GAS: Gas = Gas::from_tgas(50);
/// Paid to OutLayer from the vault's own NEAR for one check; what the run does not use comes back.
const CHECK_DEPOSIT: NearToken = NearToken::from_millinear(20);
/// Checks per UTC day at most, so an agent cannot spend the vault's NEAR on them.
const MAX_CHECKS_PER_DAY: u32 = 20;
/// The check program's answer is a few hundred bytes; anything longer is not one.
const MAX_CHECK_RESULT: usize = 1024;
/// The same payee and amount, or the same item from a service, again this soon is held as a possible
/// second charge. The same window as svalin-mcp's repeat-request caution.
const DUPLICATE_WINDOW_MS: u64 = 15 * MINUTE_MS;
/// Services whose terms are locked at most, and how long a service's name and an item may be.
const MAX_SERVICES: u32 = 100;
const MAX_SERVICE_LEN: usize = 128;
const MAX_ITEM_LEN: usize = 256;
/// Items bought within the duplicate window that are remembered at most.
const MAX_RECENT_ITEMS: usize = 100;
/// A held payment older than this cannot be approved; the agent asks again.
const HELD_MAX_AGE_MS: u64 = 7 * DAY_MS;
/// Look-alike refusals within an hour that freeze the vault.
const STRIKES_TO_FREEZE: usize = 3;
const STRIKE_WINDOW_MS: u64 = HOUR_MS;
const EVENT_STANDARD: &str = "svalin-guard";
const EVENT_VERSION: &str = "1.0.0";
/// Held payments and pending changes kept at most, so the agent cannot fill the vault's storage.
const MAX_QUEUE: u32 = 50;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Limits {
    /// The most one payment to a payee the vault has paid before may be, in the token's units.
    pub per_payment: U128,
    /// The most all automatic payments may add up to in one UTC day.
    pub daily: U128,
    /// The most one payment to a payee the vault has never paid may be.
    pub new_payee: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Delays {
    /// How long a change that makes the vault riskier waits.
    pub loosen_ms: u64,
    /// How long the guardian's recovery waits; the owner can cancel it meanwhile.
    pub recovery_ms: u64,
}

impl Default for Delays {
    fn default() -> Self {
        Self { loosen_ms: DAY_MS, recovery_ms: 7 * DAY_MS }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payee {
    pub since_ms: u64,
    pub payments: u32,
    pub paid: U128,
}

/// Why a payment was refused or held. The same reasons Svalin's API gives, as fixed codes.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Reason {
    Frozen,
    ZeroAmount,
    /// The payee, or the token to buy, is this vault or the token it pays in.
    NotAPayee,
    /// Reads the same as a well-known account (intent5.near for intents.near).
    ImitatesWellKnown,
    /// One letter away from a well-known account.
    ResemblesWellKnown,
    /// Reads the same as a payee this vault paid before, or a long address with the same ends.
    ImitatesPastPayee,
    /// One letter away from a payee this vault paid before.
    ResemblesPastPayee,
    NewPayeeOverLimit,
    OverPaymentLimit,
    OverDailyLimit,
    /// The same payee and amount, or the same item from a service, as a payment in the last 15
    /// minutes: a seller charging twice.
    PossibleDuplicate,
    /// The service asks more than its locked price: a seller raising its price after the listing.
    PriceChanged,
    /// The service names another payee than its locked one: a seller, or someone in between,
    /// swapping the account the money goes to.
    PayeeChanged,
    /// The seller's quote had already expired.
    QuoteExpired,
    /// The check found no such account.
    PayeeMissing,
    /// The check found an account created less than the owner's minimum age ago.
    NewAccount,
    /// The account has no keys to date it by.
    AgeUnknown,
    /// The check could not run or gave no readable answer, so the vault does not guess.
    CheckFailed,
    /// Today's checks are used up.
    TooManyChecks,
    /// The owner has not set what the vault may buy.
    BuyingOff,
    /// The token's liquidity grade is below the owner's minimum.
    GradeTooLow,
    /// The grade comes from an edition older than the owner allows.
    StaleProof,
    /// The registry does not confirm the grade: a forged or wrong proof.
    BadProof,
    /// The edition is unknown to the registry, retracted, or still in its challenge window.
    NoUsableEdition,
    /// The edition was graded by another methodology than the owner requires.
    WrongMethodology,
    /// NEAR's signing network gave no valid signature for a Solana payment, so nothing was paid.
    SigningFailed,
    /// The owner has not approved this market pool for this token.
    PoolNotApproved,
    /// The token would not register the vault, so what it bought could not arrive.
    TokenNotReady,
}

/// Paying on Solana through NEAR Chain Signatures. The vault's Solana address is derived from its
/// NEAR account and `path`; nobody holds its key, and NEAR's signing network signs for it only when
/// this vault asks.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Solana {
    /// NEAR's signing network: `v1.signer-prod.testnet`, or `v1.signer` on mainnet.
    pub signer: AccountId,
    /// The derivation path of the vault's Solana address.
    pub path: String,
    /// Solana's network as x402 names it (CAIP-2), so agents know which quotes the vault can pay.
    pub network: String,
    /// The USDC mint the vault pays in on Solana. Amounts are in its smallest unit, the same as the
    /// vault's NEAR token, so one set of limits covers both chains.
    pub mint: String,
    pub decimals: u8,
}

/// What the agent hands the vault for a Solana payment. None of it is the vault's to decide: the fee
/// payer is the seller's facilitator, from its 402 answer; the blockhash only sets when the payment
/// expires; and the two token accounts are checked to be the vault's own and the payee's.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SolanaTransaction {
    pub fee_payer: String,
    pub recent_blockhash: String,
    pub source: String,
    pub destination: String,
}

/// A signed Solana payment, ready for a seller: x402's `payload.transaction`.
#[derive(near_sdk::serde::Serialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct SignedPayment {
    /// The transaction in base64, the fee payer's signature still empty for the facilitator.
    pub transaction: String,
    /// The vault's signature, base58.
    pub signature: String,
    /// The vault's Solana address, which pays.
    pub payer: String,
}

/// What the vault did with a Solana payment request, as a `Decision` reads, and for a paid one the
/// signed payment.
#[derive(near_sdk::serde::Serialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct SolanaDecision {
    pub outcome: Outcome,
    pub reasons: Vec<Reason>,
    pub imitates: Option<String>,
    pub held_id: Option<u64>,
    pub payment: Option<SignedPayment>,
}

impl SolanaDecision {
    fn new(decision: Decision, payment: Option<SignedPayment>) -> Self {
        Self { outcome: decision.outcome, reasons: decision.reasons, imitates: decision.imitates, held_id: decision.held_id, payment }
    }
}

/// A Solana payment waiting for NEAR's signing network.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct Signing {
    payee: String,
    amount: U128,
    day: u64,
    purchase: Option<Purchase>,
    locked: bool,
    message: Vec<u8>,
    /// The vault's Solana address the message pays from, which must have signed it.
    authority: [u8; 32],
    /// The owner taking money out, which counts toward no limit, rather than a payment.
    withdrawal: bool,
}

/// Money the owner is taking out of the vault's Solana address, after its wait.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SolanaWithdrawal {
    /// The Solana address it goes to.
    pub to: String,
    pub amount: U128,
    /// When the wait ended; it can be collected for an hour after.
    pub at_ms: u64,
}

/// The owner's fingerprint or face: a passkey on their own device. It can stop money at any time,
/// and approve a payment to someone the vault has already paid, within the limits. Everything else
/// needs the owner's wallet, which shows what is being signed; a passkey prompt does not.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Passkey {
    /// The passkey's P-256 public key: 33 compressed bytes, in hex.
    pub public_key: String,
    /// The website the passkey belongs to, and that website's exact origin.
    pub rp_id: String,
    pub origin: String,
    /// A NEAR key made on the same device, which never leaves it. It can only call `use_passkey`, so
    /// it pays the fee and does nothing else: the passkey's signature is what the vault obeys.
    pub device_key: PublicKey,
}

/// What a passkey can ask for.
#[near(serializers = [json])]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Clone, Debug)]
pub enum PasskeyAction {
    Approve { id: u64 },
    Reject { id: u64 },
    Freeze,
}

/// The part of WebAuthn's client data the vault reads.
#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ClientData {
    #[serde(rename = "type")]
    kind: String,
    challenge: String,
    origin: String,
    #[serde(default, rename = "crossOrigin")]
    cross_origin: bool,
}

/// Svalin's check program, which OutLayer runs inside a TEE for every payee the vault has not paid.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Checker {
    /// OutLayer's contract: `outlayer.testnet` or `outlayer.near`.
    pub outlayer: AccountId,
    /// Where the program is, and the SHA-256 it must have: OutLayer runs no other bytes.
    pub wasm_url: String,
    pub wasm_hash: String,
    /// A payee created less than this long ago is held for the owner.
    pub min_age_ms: u64,
}

/// What the check program reports about a payee.
#[near(serializers = [json])]
#[derive(Clone, Debug, Default)]
pub struct CheckReport {
    pub exists: bool,
    #[serde(default)]
    pub contract: bool,
    /// Milliseconds since the account's oldest key was added; none when it has no keys.
    #[serde(default)]
    pub age_ms: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

/// What the vault may buy, and where. Without it the vault buys nothing.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Buying {
    /// The Svalin Ratings registry grades are checked against: `svalin-ratings-v1.testnet`.
    pub registry: AccountId,
    /// The methodology an edition must be graded by: `near-token-backing-v1`.
    pub methodology: String,
    /// The lowest liquidity grade the vault buys, "A" to "F".
    pub min_grade: String,
    /// How many days old the edition may be at most.
    pub max_age_days: u32,
    /// The market the vault buys on. It is sent the vault's token with `ft_transfer_call` and a swap
    /// in Ref Finance's message format, so the vault itself names the token it gets.
    pub market: AccountId,
    /// Svalin's fee on each buy in basis points (10 is 0.1%), and the account it goes to.
    pub fee_bps: u16,
    pub fee_account: AccountId,
    /// The only market pools the vault buys in, each for one token. An agent that has been taken
    /// over could otherwise send the vault's money through a pool its attacker made.
    pub pools: Vec<Pool>,
    /// Whether the market sends the bought token to the vault. True for a real market: the vault
    /// registers with the token first, or what it bought would have nowhere to arrive. False only
    /// for the test-network stand-in, which keeps what it is sent.
    pub market_returns_tokens: bool,
}

/// A market pool the owner approved for buying one token, and the worst price accepted there.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pool {
    pub token: AccountId,
    pub pool_id: u64,
    /// The least the vault accepts, in the bought token's smallest units, for each million of the
    /// smallest units of the vault's token (for each 1 USDC). The market refuses anything worse.
    pub min_out_per_million: U128,
}

/// A token's grade in one edition of the Svalin Index, with its Merkle proof, as the registry's
/// `verify` takes it (Svalin's API serves them at `/v1/proof/{token}`).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct GradeProof {
    /// The edition, YYYY-MM-DD.
    pub day: String,
    pub grade: String,
    /// Held backing in whole dollars, as sealed in the edition.
    pub backing_usd: u64,
    pub proof: Vec<ProofStep>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ProofStep {
    pub hash: String,
    pub left: bool,
}

/// A buy waiting for the registry's answer.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct PendingBuy {
    token: AccountId,
    amount: U128,
    pool_id: u64,
    min_out: U128,
    grade: String,
    day: String,
    backing_usd: u64,
}

/// The part of the registry's answer the vault reads.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
struct Verification {
    valid: bool,
    #[serde(default)]
    problem: Option<String>,
    #[serde(default)]
    methodology: Option<String>,
}

/// What a payment buys, as the service's payment request (an x402 `402` answer) put it. With it the
/// vault holds a service to the terms it was first paid on.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Purchase {
    /// The service paid, for example the origin of an x402 URL; its terms are locked under this name.
    pub service: String,
    /// What is bought, for example the URL's path and query.
    pub item: String,
    /// When the seller's quote stops being valid, in milliseconds since the epoch.
    #[serde(default)]
    pub quote_expires_ms: Option<u64>,
}

/// Whom a service is paid, and the most one call to it may cost. The payee is a NEAR account, or
/// `solana:` and a Solana address.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Terms {
    pub payee: String,
    pub price: U128,
}

/// A service's terms as the vault keeps them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LockedTerms {
    pub payee: String,
    pub price: U128,
    pub since_ms: u64,
    /// Set by the owner, or else locked by the service's first payment.
    pub by_owner: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct LastPaid {
    amount: u128,
    at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Held {
    /// A NEAR account, or `solana:` and a Solana address.
    pub payee: String,
    pub amount: U128,
    pub memo: Option<String>,
    pub reasons: Vec<Reason>,
    pub at_ms: u64,
    /// Who has approved it so far, when it needs both the owner and the guardian.
    #[serde(default)]
    pub approved_by: Vec<AccountId>,
    /// What the payment buys, when the agent said.
    #[serde(default)]
    pub purchase: Option<Purchase>,
}

/// A change to the vault. The ones that make it riskier wait before they can be executed.
#[near(serializers = [borsh, json])]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Clone, Debug)]
pub enum Change {
    RaiseLimits { limits: Limits },
    /// Trust a payee before its first payment: a NEAR account, or `solana:` and an address.
    AddPayee { payee: String },
    SetAgent { key: PublicKey },
    SetGuardian { guardian: Option<AccountId> },
    SetDelays { delays: Delays },
    /// Another check program, or none: either could let more through, so it waits.
    SetChecker { checker: Option<Checker> },
    /// Other buying rules, or none: a lower minimum grade or another market could let more through.
    SetBuying { buying: Option<Buying> },
    /// Another payee or a higher price for a service, or no locked terms for it.
    SetTerms { service: String, terms: Option<Terms> },
    /// Paying on Solana, another signing network or mint, or none: each changes where money can go.
    SetSolana { solana: Option<Solana> },
    /// Take money out of the vault's Solana address. Once the wait is over the owner collects it.
    WithdrawSolana { to: String, amount: U128 },
    /// Add the owner's fingerprint, or replace it. Removing one is at once (`remove_passkey`).
    SetPasskey { passkey: Passkey },
    Unfreeze,
    /// Send funds out of the vault, to any account. The owner's own account waits too: a thief who
    /// has the owner's key controls that account as well.
    Withdraw { to: AccountId, amount: U128 },
    /// Send out a token the vault bought. Nothing else can move it.
    WithdrawToken { token: AccountId, to: AccountId, amount: U128 },
    /// The guardian's way back in when the owner's key is lost: a new owner, after the recovery delay.
    Recover { new_owner: AccountId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub change: Change,
    pub proposed_by: AccountId,
    pub ready_at_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Paid,
    Held,
    Refused,
    /// A new payee is being checked; the answer comes in a few seconds as a `payee_checked` event.
    Checking,
}

/// What the vault did, or would do, with a payment request.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Decision {
    pub outcome: Outcome,
    pub reasons: Vec<Reason>,
    /// The payee it imitates or resembles, when that is a reason.
    pub imitates: Option<String>,
    /// The held payment's id, for the owner to approve or reject; while checking, the check's id.
    pub held_id: Option<u64>,
}

#[near(serializers = [json])]
pub struct Status {
    pub owner: AccountId,
    pub guardian: Option<AccountId>,
    pub agent: Option<PublicKey>,
    pub token: AccountId,
    pub limits: Limits,
    pub delays: Delays,
    pub frozen: bool,
    pub spent_today: U128,
    pub known_payees: u32,
    pub checker: Option<Checker>,
    pub checks_today: u32,
    pub checking: u32,
    pub buying: Option<Buying>,
    /// Services with locked terms.
    pub services: u32,
    pub solana: Option<Solana>,
    /// The vault's Solana address, once NEAR's signing network has given it.
    pub solana_address: Option<String>,
    /// Approved Solana payments the agent has not collected yet.
    pub cleared: u32,
    /// The owner's Solana withdrawal that has waited and can be collected.
    pub solana_withdrawal: Option<SolanaWithdrawal>,
    pub passkey: Option<Passkey>,
    /// The version of this code, so a page can tell what a vault can do.
    pub version: String,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Payees,
    Held,
    Pending,
    Checking,
    LastPaid,
    Buys,
    Terms,
    Signing,
    Cleared,
}

/// The `sign` request NEAR's signing network takes.
#[near(serializers = [json])]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: SignPayload,
    pub domain_id: u64,
}

/// What is signed: for ed25519, the whole message (Solana signs the message itself), in hex.
#[near(serializers = [json])]
pub enum SignPayload {
    Eddsa(String),
}

/// The signing network's answer for ed25519: `{ "scheme": "Ed25519", "signature": [64 bytes] }`.
#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct SignAnswer {
    scheme: String,
    signature: Vec<u8>,
}

#[ext_contract(ext_signer)]
#[allow(dead_code)]
trait Signer {
    fn sign(&mut self, request: SignRequest);
    fn derived_public_key(&self, path: String, predecessor: Option<AccountId>, domain_id: Option<u64>) -> String;
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[ext_contract(ext_registry)]
#[allow(dead_code)]
trait Registry {
    fn verify(&self, day: String, token: String, grade: String, backing_usd: u64, proof: Vec<ProofStep>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guard {
    owner: AccountId,
    guardian: Option<AccountId>,
    agent: Option<PublicKey>,
    /// The NEP-141 token the vault pays in (USDC).
    token: AccountId,
    limits: Limits,
    delays: Delays,
    frozen: bool,
    /// UTC day (days since the epoch) that `spent_today` counts.
    day: u64,
    spent_today: u128,
    /// Payees the vault has paid or been told to trust, by name: a NEAR account, or `solana:` and an
    /// address.
    payees: IterableMap<String, Payee>,
    held: IterableMap<u64, Held>,
    pending: IterableMap<u64, Pending>,
    next_id: u64,
    checker: Option<Checker>,
    /// Payments waiting for their check.
    checking: IterableMap<u64, Held>,
    checks_today: u32,
    last_paid: LookupMap<String, LastPaid>,
    /// When recent look-alike refusals happened, for the circuit breaker.
    strikes: Vec<u64>,
    buying: Option<Buying>,
    /// Buys waiting for the registry's answer.
    buys: IterableMap<u64, PendingBuy>,
    /// Each service's locked terms, by the name the agent gives it.
    terms: IterableMap<String, LockedTerms>,
    /// Items bought within the duplicate window, by a hash of the service and item, and when.
    recent_items: Vec<([u8; 32], u64)>,
    solana: Option<Solana>,
    /// The vault's Solana address, from NEAR's signing network.
    solana_address: Option<[u8; 32]>,
    /// Solana payments waiting for their signature.
    signing: IterableMap<u64, Signing>,
    /// Held Solana payments the owner approved, paid when the agent asks for them again.
    cleared: IterableMap<u64, Held>,
    solana_withdrawal: Option<SolanaWithdrawal>,
    passkey: Option<Passkey>,
    /// Goes up with every use of a passkey, so a signature works once.
    passkey_nonce: u64,
}

#[near]
impl Guard {
    /// Sets the vault up and, with `lock` (the default), deletes the key that deployed it, so from
    /// here on only the code decides. Only the vault's own account can call it, so nobody else can
    /// set up a vault that was deployed but not yet set up.
    #[init]
    pub fn new(
        owner: AccountId,
        token: AccountId,
        limits: Limits,
        guardian: Option<AccountId>,
        agent: Option<PublicKey>,
        delays: Option<Delays>,
        lock: Option<bool>,
        checker: Option<Checker>,
        buying: Option<Buying>,
        solana: Option<Solana>,
    ) -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "Only the vault's own account can set it up");
        check_limits(&limits);
        let delays = delays.unwrap_or_default();
        check_delays(&delays);
        if let Some(checker) = &checker {
            check_checker(checker);
        }
        if let Some(buying) = &buying {
            check_buying(buying);
        }
        if let Some(solana) = &solana {
            check_solana(solana);
            fetch_solana_address(solana);
        }
        require!(guardian.as_ref() != Some(&owner), "The guardian must be someone other than the owner");
        if let Some(key) = &agent {
            add_agent_key(key.clone());
        }
        if lock.unwrap_or(true) && env::signer_account_id() == env::current_account_id() {
            Promise::new(env::current_account_id()).delete_key(env::signer_account_pk()).detach();
        }
        Self {
            owner,
            guardian,
            agent,
            token,
            limits,
            delays,
            frozen: false,
            day: today(),
            spent_today: 0,
            payees: IterableMap::new(StorageKey::Payees),
            held: IterableMap::new(StorageKey::Held),
            pending: IterableMap::new(StorageKey::Pending),
            next_id: 0,
            checker,
            checking: IterableMap::new(StorageKey::Checking),
            checks_today: 0,
            last_paid: LookupMap::new(StorageKey::LastPaid),
            strikes: Vec::new(),
            buying,
            buys: IterableMap::new(StorageKey::Buys),
            terms: IterableMap::new(StorageKey::Terms),
            recent_items: Vec::new(),
            solana,
            solana_address: None,
            signing: IterableMap::new(StorageKey::Signing),
            cleared: IterableMap::new(StorageKey::Cleared),
            solana_withdrawal: None,
            passkey: None,
            passkey_nonce: 0,
        }
    }

    /* ------------------------------- the agent ------------------------------- */

    /// The agent's main call. Pays, holds for the owner, or refuses, and says why. A payee the vault
    /// has never paid is checked first; that answer comes back as a `payee_checked` event. With a
    /// `purchase`, the service is held to its locked terms.
    pub fn request_payment(&mut self, payee: AccountId, amount: U128, memo: Option<String>, purchase: Option<Purchase>) -> Decision {
        require!(
            env::predecessor_account_id() == env::current_account_id() && self.agent.as_ref() == Some(&env::signer_account_pk()),
            "Only the agent's key can request a payment"
        );
        require!(memo.as_ref().is_none_or(|memo| memo.len() <= MAX_MEMO_LEN), "The memo can be at most 256 bytes");
        if let Some(purchase) = &purchase {
            check_purchase(purchase);
        }
        self.roll_day();
        let payee = payee.to_string();
        let mut decision = self.decide(&payee, amount.0, purchase.as_ref());
        if decision.outcome == Outcome::Paid && self.needs_check(&payee) {
            if self.checks_today >= MAX_CHECKS_PER_DAY {
                decision = Decision { outcome: Outcome::Held, reasons: vec![Reason::TooManyChecks], imitates: None, held_id: None };
            } else {
                return self.start_check(payee, amount, memo, purchase);
            }
        }
        self.apply(payee, amount, memo, purchase, decision)
    }

    /// The agent's call for a Solana x402 payment of `amount` to `pay_to`, as the seller's 402 answer
    /// asks it: the same rules as `request_payment`, with the payee named `solana:` and its address.
    /// When it pays, the vault writes the payment itself, NEAR's signing network signs it, and the
    /// answer is the signed transaction for the seller. Held and refused ones answer at once. The
    /// memo is the seller's `extra.memo`, or 16 random bytes in hex as x402 asks.
    pub fn request_solana_payment(
        &mut self,
        pay_to: String,
        amount: U128,
        memo: String,
        purchase: Option<Purchase>,
        transaction: SolanaTransaction,
    ) -> PromiseOrValue<SolanaDecision> {
        require!(
            env::predecessor_account_id() == env::current_account_id() && self.agent.as_ref() == Some(&env::signer_account_pk()),
            "Only the agent's key can request a payment"
        );
        let settings = self.solana.clone().unwrap_or_else(|| env::panic_str("This vault does not pay on Solana"));
        let vault = self.solana_address.unwrap_or_else(|| env::panic_str("The vault's Solana address is not loaded yet: call load_solana_address"));
        let to = canonical_address(&pay_to, "pay_to");
        require!(!memo.is_empty() && memo.len() <= solana::MAX_MEMO_LEN, "The memo must be 1 to 256 bytes");
        require!(u64::try_from(amount.0).is_ok(), "A Solana payment is at most 2^64 - 1 of the token's units");
        if let Some(purchase) = &purchase {
            check_purchase(purchase);
        }
        self.roll_day();
        let payee = format!("{SOLANA_PREFIX}{pay_to}");
        let cleared = if self.frozen { None } else { self.cleared_for(&payee, amount.0, purchase.as_ref()) };
        let decision = match cleared {
            Some(_) => Decision { outcome: Outcome::Paid, reasons: vec![], imitates: None, held_id: None },
            None => self.decide(&payee, amount.0, purchase.as_ref()),
        };
        if decision.outcome != Outcome::Paid {
            return PromiseOrValue::Value(SolanaDecision::new(self.apply(payee, amount, Some(memo), purchase, decision), None));
        }

        let message = write_solana_payment(&settings, &vault, &to, amount.0 as u64, &memo, &transaction);
        if let Some(id) = cleared {
            self.cleared.remove(&id);
            emit("cleared_payment_collected", json!({ "id": id, "payee": payee, "amount": amount }));
        }
        // `apply` records the decision; the payment itself goes out here, signed instead of sent.
        self.apply(payee.clone(), amount, Some(memo), purchase.clone(), decision);
        let locked = self.count_payment(&payee, amount.0, purchase.as_ref());
        let signing = Signing { payee, amount, day: self.day, purchase, locked, message, authority: vault, withdrawal: false };
        PromiseOrValue::Promise(self.ask_for_signature(settings, signing))
    }

    /// Collects the owner's Solana withdrawal once its wait is over. The answer is the signed
    /// transaction, in x402's layout, so a facilitator can settle it and the vault needs no SOL. It
    /// expires in about a minute, so the agent may collect it too, and settle it in one step: the
    /// address and amount are the ones that waited, and the agent can change neither.
    #[payable]
    pub fn collect_solana_withdrawal(&mut self, memo: String, transaction: SolanaTransaction) -> Promise {
        let by_agent = env::predecessor_account_id() == env::current_account_id() && self.agent.as_ref() == Some(&env::signer_account_pk());
        if !by_agent {
            assert_one_yocto();
            self.require_owner();
        }
        require!(!self.frozen, "The vault is frozen");
        let withdrawal = self.solana_withdrawal.take().unwrap_or_else(|| env::panic_str("No Solana withdrawal is waiting"));
        require!(
            env::block_timestamp_ms().saturating_sub(withdrawal.at_ms) <= CLEARED_MAX_AGE_MS,
            "This withdrawal waited more than an hour; propose it again"
        );
        let settings = self.solana.clone().unwrap_or_else(|| env::panic_str("This vault does not pay on Solana"));
        let vault = self.solana_address.unwrap_or_else(|| env::panic_str("The vault's Solana address is not loaded yet: call load_solana_address"));
        require!(!memo.is_empty() && memo.len() <= solana::MAX_MEMO_LEN, "The memo must be 1 to 256 bytes");
        let to = canonical_address(&withdrawal.to, "to");
        let message = write_solana_payment(&settings, &vault, &to, withdrawal.amount.0 as u64, &memo, &transaction);
        let signing = Signing {
            payee: format!("{SOLANA_PREFIX}{}", withdrawal.to),
            amount: withdrawal.amount,
            day: self.day,
            purchase: None,
            locked: false,
            message,
            authority: vault,
            withdrawal: true,
        };
        self.ask_for_signature(settings, signing)
    }

    /// Asks NEAR's signing network for the vault's Solana address again. Anyone may call it; the
    /// address only depends on the vault's account and path.
    pub fn load_solana_address(&mut self) {
        let settings = self.solana.clone().unwrap_or_else(|| env::panic_str("This vault does not pay on Solana"));
        fetch_solana_address(&settings);
    }

    /// The agent's other call: buy `token` with `amount` of the vault's token on the owner's market,
    /// in pool `pool_id`, for at least `min_out` back. The vault first checks the grade the agent
    /// brings against the owner's rules, then asks the registry to confirm its proof; the answer
    /// comes back as a `grade_checked` event and then `buy_sent` or `buy_refused`. A forged grade
    /// counts toward the freeze, like a look-alike payee.
    pub fn request_buy(&mut self, token: AccountId, amount: U128, pool_id: u64, min_out: U128, grade: GradeProof) -> Decision {
        require!(
            env::predecessor_account_id() == env::current_account_id() && self.agent.as_ref() == Some(&env::signer_account_pk()),
            "Only the agent's key can request a buy"
        );
        require!(grade.proof.len() <= 40, "A proof has at most 40 steps");
        self.roll_day();
        let decision = self.decide_buy(&token, amount.0, pool_id, &grade.grade, &grade.day);
        let pending = PendingBuy { token, amount, pool_id, min_out, grade: grade.grade, day: grade.day, backing_usd: grade.backing_usd };
        if decision.outcome != Outcome::Paid {
            emit_buy("buy_refused", &pending, &decision.reasons, self.agent.as_ref());
            return decision;
        }
        let registry = self.buying.as_ref().expect("decide_buy refuses without buying rules").registry.clone();
        let id = self.take_id();
        ext_registry::ext(registry)
            .with_static_gas(VERIFY_GAS)
            .verify(pending.day.clone(), pending.token.to_string(), pending.grade.clone(), pending.backing_usd, grade.proof)
            .then(Self::ext(env::current_account_id()).with_static_gas(GRADE_CALLBACK_GAS).on_grade(id))
            .detach();
        emit_buy("buy_checking", &pending, &[], self.agent.as_ref());
        self.buys.insert(id, pending);
        Decision { outcome: Outcome::Checking, reasons: vec![], imitates: None, held_id: Some(id) }
    }

    /// What `request_payment` (or, for `solana:` and an address, `request_solana_payment`) would do
    /// now, without doing it: for agents and dashboards. A NEAR payee the vault has never paid shows
    /// `checking`, since only the check can tell.
    pub fn check(&self, payee: String, amount: U128, purchase: Option<Purchase>) -> Decision {
        check_payee_name(&payee);
        if let Some(purchase) = &purchase {
            check_purchase(purchase);
        }
        let spent = if today() == self.day { self.spent_today } else { 0 };
        let mut decision = self.decide_with(&payee, amount.0, spent, purchase.as_ref());
        if decision.outcome == Outcome::Paid && self.needs_check(&payee) {
            decision.outcome = Outcome::Checking;
        }
        decision
    }

    /* ---------------------- owner and guardian: at once ---------------------- */

    /// Stops every payment and every pending change, except a recovery. Owner or guardian.
    #[payable]
    pub fn freeze(&mut self) {
        assert_one_yocto();
        self.require_owner_or_guardian();
        let cancelled = self.freeze_now();
        emit("frozen", json!({ "by": env::predecessor_account_id(), "cancelled_changes": cancelled }));
    }

    /// Cancels a pending change. Owner or guardian: each can stop what the other's key proposes.
    #[payable]
    pub fn cancel(&mut self, id: u64) {
        assert_one_yocto();
        self.require_owner_or_guardian();
        require!(self.pending.remove(&id).is_some(), "No such pending change");
        emit("change_cancelled", json!({ "id": id, "by": env::predecessor_account_id() }));
    }

    /// Removes the agent's key at once.
    #[payable]
    pub fn revoke_agent(&mut self) {
        assert_one_yocto();
        self.require_owner();
        if let Some(key) = self.agent.take() {
            Promise::new(env::current_account_id()).delete_key(key).detach();
        }
        emit("agent_revoked", json!({}));
    }

    /// Gives the agent's key a fresh gas allowance, which does not refill as gas is spent. Instant:
    /// it lets the agent spend the vault's NEAR on gas, never its tokens.
    #[payable]
    pub fn top_up_agent(&mut self) {
        assert_one_yocto();
        self.require_owner();
        let key = self.agent.clone().unwrap_or_else(|| env::panic_str("There is no agent key"));
        // Deleting and adding the key in one receipt replaces its allowance.
        agent_key(Promise::new(env::current_account_id()).delete_key(key.clone()), key).detach();
        emit("agent_topped_up", json!({ "allowance": AGENT_GAS_ALLOWANCE }));
    }

    /// Lowers limits at once. Raising them is a change that waits.
    #[payable]
    pub fn lower_limits(&mut self, limits: Limits) {
        assert_one_yocto();
        self.require_owner();
        check_limits(&limits);
        require!(
            limits.per_payment.0 <= self.limits.per_payment.0 && limits.daily.0 <= self.limits.daily.0 && limits.new_payee.0 <= self.limits.new_payee.0,
            "Each limit must be the same or lower; raising one is a change that waits"
        );
        self.limits = limits.clone();
        emit("limits_lowered", json!({ "limits": limits }));
    }

    /// Locks a service's terms at once, when that only makes the vault stricter: a service without
    /// terms yet, or the same payee at the same or a lower price. Another payee or a higher price is
    /// a change that waits (`SetTerms`).
    #[payable]
    pub fn lock_terms(&mut self, service: String, terms: Terms) {
        assert_one_yocto();
        self.require_owner();
        check_terms(&service, &terms);
        match self.terms.get(&service) {
            Some(current) => require!(
                terms.payee == current.payee && terms.price.0 <= current.price.0,
                "Another payee or a higher price is a change that waits"
            ),
            None => require!(self.terms.len() < MAX_SERVICES, "Too many services have locked terms"),
        }
        self.lock(service, terms, true);
    }

    /// Forgets a payee, so the next payment to it counts as a new payee's.
    #[payable]
    pub fn forget_payee(&mut self, payee: String) {
        assert_one_yocto();
        self.require_owner();
        require!(self.payees.remove(&payee).is_some(), "Not a known payee");
        emit("payee_forgotten", json!({ "payee": payee }));
    }

    /// Takes the owner's fingerprint off the vault at once. Owner or guardian: it only removes a way
    /// to approve.
    #[payable]
    pub fn remove_passkey(&mut self) {
        assert_one_yocto();
        self.require_owner_or_guardian();
        require!(self.passkey.is_some(), "This vault has no passkey");
        self.drop_passkey();
        emit("passkey_removed", json!({ "by": env::predecessor_account_id() }));
    }

    /// Gives the owner's device key a fresh gas allowance. It can spend the vault's NEAR on gas only.
    #[payable]
    pub fn top_up_passkey(&mut self) {
        assert_one_yocto();
        self.require_owner();
        let key = self.passkey.as_ref().map(|passkey| passkey.device_key.clone()).unwrap_or_else(|| env::panic_str("This vault has no passkey"));
        passkey_key(Promise::new(env::current_account_id()).delete_key(key.clone()), key).detach();
        emit("passkey_topped_up", json!({ "allowance": PASSKEY_GAS_ALLOWANCE }));
    }

    /// The owner's fingerprint, from their own device. A passkey signs a challenge that names this
    /// vault, a one-time number and the exact action, payee and amount, so a signature works once
    /// and for nothing else.
    ///
    /// It can always reject a payment or freeze the vault. It can approve only a payment to someone
    /// the vault has already paid, whose payee did not change, and within the per-payment and daily
    /// limits: a passkey prompt shows the website's name but not the payment, so anything riskier
    /// needs the owner's wallet, which shows what is being signed.
    pub fn use_passkey(&mut self, action: PasskeyAction, authenticator_data: String, client_data_json: String, signature: String) {
        let passkey = self.passkey.clone().unwrap_or_else(|| env::panic_str("This vault has no passkey"));
        require!(
            env::predecessor_account_id() == env::current_account_id() && env::signer_account_pk() == passkey.device_key,
            "Only the owner's device key can use the passkey"
        );
        require!(authenticator_data.len() <= 1024 && client_data_json.len() <= 4096, "The passkey's answer is too long");
        let decode = |text: &str| BASE64.decode(text).unwrap_or_else(|_| env::panic_str("The passkey's answer must be base64"));
        let signature = <[u8; 64]>::try_from(decode(&signature)).unwrap_or_else(|_| env::panic_str("The signature must be 64 bytes, r then s"));
        let challenge = self.challenge_for(&action);
        require!(
            passkey_signature_is_valid(&passkey, &challenge, &decode(&authenticator_data), &decode(&client_data_json), &signature),
            "The passkey's signature is not valid"
        );
        self.passkey_nonce += 1;
        match action {
            PasskeyAction::Approve { id } => {
                let held = self.held.get(&id).cloned().unwrap_or_else(|| env::panic_str("No such held payment"));
                self.roll_day();
                require!(
                    self.payees.contains_key(&held.payee) && !held.reasons.contains(&Reason::PayeeChanged),
                    "A new or changed payee is approved from the wallet, which shows who gets paid"
                );
                require!(
                    held.amount.0 <= self.limits.per_payment.0 && self.spent_today.saturating_add(held.amount.0) <= self.limits.daily.0,
                    "Above the limits a payment is approved from the wallet"
                );
                self.approve_as(id, self.owner.clone());
            }
            PasskeyAction::Reject { id } => {
                require!(self.held.remove(&id).is_some() || self.cleared.remove(&id).is_some(), "No such held payment");
                emit("payment_rejected", json!({ "id": id, "by": self.owner, "via": "passkey" }));
            }
            PasskeyAction::Freeze => {
                let cancelled = self.freeze_now();
                emit("frozen", json!({ "by": self.owner, "via": "passkey", "cancelled_changes": cancelled }));
            }
        }
    }

    /// Pays a held payment exactly as the agent asked. The owner approves one item, which cannot be
    /// changed behind their back; Svalin's reasons are stored with it. A Solana payment is cleared
    /// instead: the agent's next request for exactly it, within an hour, is paid.
    ///
    /// When there is a guardian, a payment above the per-payment limit, or one that would take the
    /// day past its limit, needs both of them: two people on two devices, so neither a stolen owner
    /// key nor an agent that reached it can approve past the limits alone. A payment held more than
    /// 7 days cannot be approved; the agent asks again, so what is approved is still current.
    #[payable]
    pub fn approve(&mut self, id: u64) {
        assert_one_yocto();
        self.require_owner_or_guardian();
        self.approve_as(id, env::predecessor_account_id());
    }

    /// Drops a held payment, or an approved Solana payment the agent has not collected. Owner or
    /// guardian: refusing money is always the safe direction.
    #[payable]
    pub fn reject(&mut self, id: u64) {
        assert_one_yocto();
        self.require_owner_or_guardian();
        require!(self.held.remove(&id).is_some() || self.cleared.remove(&id).is_some(), "No such held payment");
        emit("payment_rejected", json!({ "id": id, "by": env::predecessor_account_id() }));
    }

    /* ----------------------- changes that make it riskier ----------------------- */

    /// Proposes a change that waits. The owner proposes everything except a recovery, which only the
    /// guardian can start.
    #[payable]
    pub fn propose(&mut self, change: Change) -> u64 {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let delay = match &change {
            Change::Recover { new_owner } => {
                require!(Some(&caller) == self.guardian.as_ref(), "Only the guardian can start a recovery");
                require!(new_owner != &caller, "The guardian cannot make itself the owner");
                self.delays.recovery_ms
            }
            other => {
                self.require_owner();
                match other {
                    Change::RaiseLimits { limits } => check_limits(limits),
                    Change::SetDelays { delays } => check_delays(delays),
                    Change::SetGuardian { guardian } => require!(guardian.as_ref() != Some(&self.owner), "The guardian must be someone else"),
                    Change::Withdraw { amount, .. } | Change::WithdrawToken { amount, .. } => require!(amount.0 > 0, "Nothing to withdraw"),
                    Change::SetChecker { checker: Some(checker) } => check_checker(checker),
                    Change::SetBuying { buying: Some(buying) } => check_buying(buying),
                    Change::SetTerms { service, terms: Some(terms) } => check_terms(service, terms),
                    Change::SetTerms { service, terms: None } => require!(self.terms.contains_key(service), "This service has no locked terms"),
                    Change::AddPayee { payee } => check_payee_name(payee),
                    Change::SetSolana { solana: Some(solana) } => check_solana(solana),
                    Change::WithdrawSolana { to, amount } => {
                        canonical_address(to, "to");
                        require!(amount.0 > 0 && u64::try_from(amount.0).is_ok(), "A Solana withdrawal must be more than zero and fit in 64 bits");
                        require!(self.solana.is_some(), "This vault does not pay on Solana");
                    }
                    Change::SetPasskey { passkey } => {
                        check_passkey(passkey);
                        require!(Some(&passkey.device_key) != self.agent.as_ref(), "The device key cannot be the agent's key");
                    }
                    _ => {}
                }
                self.delays.loosen_ms
            }
        };
        require!(self.pending.len() < MAX_QUEUE, "Too many changes are waiting");
        let id = self.take_id();
        let ready_at_ms = env::block_timestamp_ms() + delay;
        emit("change_proposed", json!({ "id": id, "change": change, "by": caller, "ready_at_ms": ready_at_ms }));
        self.pending.insert(id, Pending { change, proposed_by: caller, ready_at_ms });
        id
    }

    /// Carries out a change once its wait is over. Anyone may call it; nothing new is decided here.
    pub fn execute(&mut self, id: u64) {
        let pending = self.pending.get(&id).cloned().unwrap_or_else(|| env::panic_str("No such pending change"));
        require!(env::block_timestamp_ms() >= pending.ready_at_ms, "This change is still waiting");
        if self.frozen {
            require!(
                matches!(pending.change, Change::Unfreeze | Change::Recover { .. }),
                "The vault is frozen: only unfreezing or a recovery can go ahead"
            );
        }
        self.pending.remove(&id);
        match pending.change.clone() {
            Change::RaiseLimits { limits } => self.limits = limits,
            Change::AddPayee { payee } => {
                self.payees.insert(payee, Payee { since_ms: env::block_timestamp_ms(), payments: 0, paid: U128(0) });
            }
            Change::SetAgent { key } => {
                if let Some(old) = self.agent.replace(key.clone()) {
                    Promise::new(env::current_account_id()).delete_key(old).detach();
                }
                add_agent_key(key);
            }
            Change::SetGuardian { guardian } => self.guardian = guardian,
            Change::SetDelays { delays } => self.delays = delays,
            Change::SetChecker { checker } => self.checker = checker,
            Change::SetBuying { buying } => self.buying = buying,
            Change::SetTerms { service, terms: Some(terms) } => {
                require!(self.terms.contains_key(&service) || self.terms.len() < MAX_SERVICES, "Too many services have locked terms");
                self.lock(service, terms, true);
            }
            Change::SetTerms { service, terms: None } => {
                self.terms.remove(&service);
            }
            Change::SetSolana { solana } => {
                // Another path or signing network is another address: it is fetched again.
                self.solana_address = None;
                if let Some(solana) = &solana {
                    fetch_solana_address(solana);
                }
                self.solana = solana;
            }
            Change::WithdrawSolana { to, amount } => {
                let now = env::block_timestamp_ms();
                require!(
                    self.solana_withdrawal.as_ref().is_none_or(|waiting| now.saturating_sub(waiting.at_ms) > CLEARED_MAX_AGE_MS),
                    "A Solana withdrawal is already waiting to be collected"
                );
                self.solana_withdrawal = Some(SolanaWithdrawal { to, amount, at_ms: now });
            }
            Change::SetPasskey { passkey } => {
                let current = Promise::new(env::current_account_id());
                let promise = match self.passkey.take() {
                    Some(old) => current.delete_key(old.device_key),
                    None => current,
                };
                passkey_key(promise, passkey.device_key.clone()).detach();
                self.passkey = Some(passkey);
            }
            Change::Unfreeze => {
                self.frozen = false;
                self.strikes.clear();
            }
            Change::Withdraw { to, amount } => self.transfer(to, amount.0, Some("withdrawal".into()), false, None, false),
            Change::WithdrawToken { token, to, amount } => self.transfer_token(token, to, amount.0, Some("withdrawal".into()), false, None, false),
            Change::Recover { new_owner } => {
                self.owner = new_owner;
                // A new owner starts with no agent and no passkey; they add their own, and that
                // waits too. Whatever the old key had set in motion stops here.
                if let Some(old) = self.agent.take() {
                    Promise::new(env::current_account_id()).delete_key(old).detach();
                }
                self.drop_passkey();
                self.solana_withdrawal = None;
            }
        }
        emit("change_executed", json!({ "id": id, "change": pending.change }));
    }

    /* --------------------------------- views --------------------------------- */

    pub fn status(&self) -> Status {
        Status {
            owner: self.owner.clone(),
            guardian: self.guardian.clone(),
            agent: self.agent.clone(),
            token: self.token.clone(),
            limits: self.limits.clone(),
            delays: self.delays.clone(),
            frozen: self.frozen,
            spent_today: U128(if today() == self.day { self.spent_today } else { 0 }),
            known_payees: self.payees.len(),
            checker: self.checker.clone(),
            checks_today: if today() == self.day { self.checks_today } else { 0 },
            checking: self.checking.len(),
            buying: self.buying.clone(),
            services: self.terms.len(),
            solana: self.solana.clone(),
            solana_address: self.solana_address.as_ref().map(solana::encode),
            cleared: self.cleared.len(),
            solana_withdrawal: self.solana_withdrawal.clone(),
            passkey: self.passkey.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    /// What a passkey must sign now for `action`, in hex: the challenge for WebAuthn's `get`.
    pub fn passkey_challenge(&self, action: PasskeyAction) -> String {
        hex(&self.challenge_for(&action))
    }

    /// Approved Solana payments waiting for the agent to collect them, with when they were approved.
    pub fn cleared_payments(&self) -> Vec<(u64, Held)> {
        self.cleared.iter().map(|(id, held)| (*id, held.clone())).collect()
    }

    /// A service's locked terms.
    pub fn terms(&self, service: String) -> Option<LockedTerms> {
        self.terms.get(&service).cloned()
    }

    /// Every service with locked terms, `limit` at a time.
    pub fn services(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(String, LockedTerms)> {
        self.terms
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_SERVICES) as usize)
            .map(|(service, terms)| (service.clone(), terms.clone()))
            .collect()
    }

    pub fn held_payments(&self) -> Vec<(u64, Held)> {
        self.held.iter().map(|(id, held)| (*id, held.clone())).collect()
    }

    pub fn pending_changes(&self) -> Vec<(u64, Pending)> {
        self.pending.iter().map(|(id, pending)| (*id, pending.clone())).collect()
    }

    pub fn payee(&self, payee: String) -> Option<Payee> {
        self.payees.get(&payee).cloned()
    }

    /* ------------------------------- callbacks ------------------------------- */

    /// Settles a transfer: a payee becomes known once paid; a failed payment gives its amount back
    /// to today's limit, and takes back the terms it locked and the item it bought.
    #[private]
    pub fn on_transfer(&mut self, payee: AccountId, amount: U128, counted: bool, day: u64, purchase: Option<Purchase>, locked: bool) -> bool {
        // ft_transfer returns nothing, so any result longer than a few bytes is not a success either.
        let ok = env::promise_result_checked(0, 16).is_ok();
        if ok {
            if counted {
                self.paid(payee.as_str(), amount.0);
            }
        } else if counted {
            self.undo_payment(payee.as_str(), amount.0, day, purchase.as_ref(), locked);
        } else {
            emit("payment_failed", json!({ "payee": payee, "amount": amount }));
        }
        ok
    }

    /// Settles a Solana payment once NEAR's signing network has answered. The signature must be the
    /// vault's Solana address signing exactly the message the vault wrote; then the payee counts as
    /// paid and the agent gets the transaction for the seller. Any other answer undoes the payment,
    /// as a failed transfer does.
    #[private]
    pub fn on_solana_signed(&mut self, id: u64) -> SolanaDecision {
        let signing = self.signing.remove(&id).unwrap_or_else(|| env::panic_str("No such signing"));
        let vault = signing.authority;
        let signature = env::promise_result_checked(0, MAX_SIGN_RESULT)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<SignAnswer>(&bytes).ok())
            .filter(|answer| answer.scheme == "Ed25519")
            .and_then(|answer| <[u8; 64]>::try_from(answer.signature).ok())
            .filter(|signature| env::ed25519_verify(signature, &signing.message, &vault));
        let Some(signature) = signature else {
            if signing.withdrawal {
                // Nothing went out, so the owner can collect it again without another wait.
                let to = signing.payee.trim_start_matches(SOLANA_PREFIX).to_string();
                self.solana_withdrawal = Some(SolanaWithdrawal { to, amount: signing.amount, at_ms: env::block_timestamp_ms() });
                emit("solana_withdrawal_failed", json!({ "payee": signing.payee, "amount": signing.amount }));
            } else {
                self.undo_payment(&signing.payee, signing.amount.0, signing.day, signing.purchase.as_ref(), signing.locked);
            }
            return SolanaDecision::new(Decision { outcome: Outcome::Refused, reasons: vec![Reason::SigningFailed], imitates: None, held_id: None }, None);
        };
        if !signing.withdrawal {
            self.paid(&signing.payee, signing.amount.0);
        }
        let payment = SignedPayment {
            transaction: BASE64.encode(solana::partly_signed(&signing.message, &signature)),
            signature: near_sdk::bs58::encode(signature).into_string(),
            payer: solana::encode(&vault),
        };
        emit("solana_signed", json!({ "id": id, "payee": signing.payee, "amount": signing.amount, "signature": payment.signature, "payer": payment.payer, "withdrawal": signing.withdrawal }));
        SolanaDecision::new(Decision { outcome: Outcome::Paid, reasons: vec![], imitates: None, held_id: None }, Some(payment))
    }

    /// Stores the vault's Solana address, as NEAR's signing network derives it for this account. An
    /// address once stored is kept: its money is there, so only a change of the Solana settings
    /// (which waits) clears it.
    #[private]
    pub fn on_solana_address(&mut self) -> Option<String> {
        let address = env::promise_result_checked(0, 128)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<String>(&bytes).ok())
            .and_then(|key| key.strip_prefix("ed25519:").and_then(solana::decode));
        match (address, self.solana_address) {
            (Some(new), Some(stored)) if new != stored => {
                emit("solana_address_mismatch", json!({ "stored": solana::encode(&stored), "answered": solana::encode(&new) }));
            }
            (Some(address), _) => {
                self.solana_address = Some(address);
                emit("solana_address", json!({ "address": solana::encode(&address) }));
            }
            (None, _) => emit("solana_address_failed", json!({})),
        }
        self.solana_address.as_ref().map(solana::encode)
    }

    /// Settles a check: runs every rule again (the vault may have been frozen, or the day's limit
    /// used, in the meantime), then refuses a payee that does not exist and holds one too new to
    /// trust. An answer it cannot read holds the payment: it fails closed.
    #[private]
    pub fn on_check(&mut self, id: u64) -> Decision {
        let waiting = self.checking.remove(&id).unwrap_or_else(|| env::panic_str("No such check"));
        self.roll_day();
        let report = env::promise_result_checked(0, MAX_CHECK_RESULT)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<CheckReport>(&bytes).ok())
            .filter(|report| report.error.is_none());
        let min_age_ms = self.checker.as_ref().map_or(DAY_MS, |checker| checker.min_age_ms);
        emit(
            "payee_checked",
            json!({ "id": id, "payee": waiting.payee, "report": report, "wasm_hash": self.checker.as_ref().map(|checker| checker.wasm_hash.clone()) }),
        );

        let mut decision = self.decide(&waiting.payee, waiting.amount.0, waiting.purchase.as_ref());
        if decision.outcome == Outcome::Paid {
            let hold = |reason: Reason| Decision { outcome: Outcome::Held, reasons: vec![reason], imitates: None, held_id: None };
            decision = match report {
                None => hold(Reason::CheckFailed),
                Some(report) if !report.exists => {
                    Decision { outcome: Outcome::Refused, reasons: vec![Reason::PayeeMissing], imitates: None, held_id: None }
                }
                Some(CheckReport { age_ms: None, .. }) => hold(Reason::AgeUnknown),
                Some(CheckReport { age_ms: Some(age), .. }) if age < min_age_ms => hold(Reason::NewAccount),
                Some(_) => decision,
            };
        }
        self.apply(waiting.payee, waiting.amount, waiting.memo, waiting.purchase, decision)
    }

    /// Settles a buy once the registry has answered: refuses a grade it does not confirm, from an
    /// edition it cannot use or graded by another methodology, then runs every rule again and buys.
    /// No readable answer refuses the buy: the vault never guesses a grade.
    #[private]
    pub fn on_grade(&mut self, id: u64) -> Decision {
        let pending = self.buys.remove(&id).unwrap_or_else(|| env::panic_str("No such buy"));
        self.roll_day();
        let answer = env::promise_result_checked(0, MAX_VERIFY_RESULT)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<Verification>(&bytes).ok());
        emit(
            "grade_checked",
            json!({
                "id": id, "token": pending.token, "grade": pending.grade, "day": pending.day, "backing_usd": pending.backing_usd,
                "valid": answer.as_ref().map(|answer| answer.valid), "problem": answer.as_ref().and_then(|answer| answer.problem.clone()),
                "methodology": answer.as_ref().and_then(|answer| answer.methodology.clone()),
            }),
        );
        let refuse = |reason: Reason| Decision { outcome: Outcome::Refused, reasons: vec![reason], imitates: None, held_id: None };
        let required = self.buying.as_ref().map(|buying| buying.methodology.clone());
        let decision = match answer {
            None => refuse(Reason::CheckFailed),
            Some(answer) if !answer.valid => match answer.problem.as_deref() {
                Some("BAD_PROOF") | Some("BAD_LEAF") => refuse(Reason::BadProof),
                _ => refuse(Reason::NoUsableEdition),
            },
            Some(answer) if required.is_some() && answer.methodology != required => refuse(Reason::WrongMethodology),
            // The vault may have been frozen, the rules changed or the day's limit used meanwhile.
            Some(_) => self.decide_buy(&pending.token, pending.amount.0, pending.pool_id, &pending.grade, &pending.day),
        };
        if decision.outcome == Outcome::Paid {
            if self.buying.as_ref().is_some_and(|buying| buying.market_returns_tokens) {
                let token = pending.token.clone();
                self.buys.insert(id, pending);
                ext_ft::ext(token)
                    .with_attached_deposit(REGISTER_DEPOSIT)
                    .with_static_gas(REGISTER_GAS)
                    .storage_deposit(Some(env::current_account_id()), Some(true))
                    .then(Self::ext(env::current_account_id()).with_static_gas(REGISTERED_CALLBACK_GAS).on_registered(id))
                    .detach();
                return Decision { outcome: Outcome::Checking, reasons: vec![], imitates: None, held_id: Some(id) };
            }
            self.buy(&pending);
        } else {
            emit_buy("buy_refused", &pending, &decision.reasons, self.agent.as_ref());
            if decision.reasons.contains(&Reason::BadProof) {
                self.strike();
            }
        }
        decision
    }

    /// Goes on with a buy once the token has answered. A token that would not register the vault is
    /// not bought: the market would take the money and have nowhere to send what it bought.
    #[private]
    pub fn on_registered(&mut self, id: u64) -> Decision {
        let pending = self.buys.remove(&id).unwrap_or_else(|| env::panic_str("No such buy"));
        self.roll_day();
        let decision = if env::promise_result_checked(0, MAX_REGISTER_RESULT).is_err() {
            Decision { outcome: Outcome::Refused, reasons: vec![Reason::TokenNotReady], imitates: None, held_id: None }
        } else {
            // The vault may have been frozen, the rules changed or the day's limit used meanwhile.
            self.decide_buy(&pending.token, pending.amount.0, pending.pool_id, &pending.grade, &pending.day)
        };
        if decision.outcome == Outcome::Paid {
            self.buy(&pending);
        } else {
            emit_buy("buy_refused", &pending, &decision.reasons, self.agent.as_ref());
        }
        decision
    }

    /// Settles a buy's market call. The token reports how much the market used; the rest came back
    /// to the vault. Svalin's fee is paid only on what was used, and what is not spent goes back to
    /// today's limit.
    #[private]
    pub fn on_buy(&mut self, token: AccountId, sent: U128, fee: U128, fee_account: AccountId, day: u64) -> U128 {
        let used = env::promise_result_checked(0, 64)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<U128>(&bytes).ok())
            .map_or(0, |used| used.0.min(sent.0));
        let fee_paid = (fee.0 * used).checked_div(sent.0).unwrap_or(0);
        if fee_paid > 0 {
            self.transfer(fee_account.clone(), fee_paid, Some("Svalin fee".into()), false, None, false);
        }
        let returned = (sent.0 - used) + (fee.0 - fee_paid);
        if returned > 0 && day == self.day {
            self.spent_today = self.spent_today.saturating_sub(returned);
        }
        if used == 0 {
            // A retry of a buy that never happened is not a second buy.
            self.last_paid.remove(token.as_str());
        }
        emit(
            "buy_settled",
            json!({ "token": token, "sent": sent, "used": U128(used), "fee": U128(fee_paid), "fee_account": fee_account, "returned": U128(returned) }),
        );
        U128(used)
    }
}

/* -------------------------------- internals -------------------------------- */

impl Guard {
    /// Asks NEAR's signing network to sign a Solana message the vault wrote; `on_solana_signed` settles it.
    fn ask_for_signature(&mut self, settings: Solana, signing: Signing) -> Promise {
        require!(self.signing.len() < MAX_QUEUE, "Too many Solana payments are waiting for their signature");
        let id = self.take_id();
        let payload = SignPayload::Eddsa(hex(&signing.message));
        self.signing.insert(id, signing);
        ext_signer::ext(settings.signer)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(SIGN_GAS)
            .sign(SignRequest { path: settings.path, payload_v2: payload, domain_id: ED25519_DOMAIN })
            .then(Self::ext(env::current_account_id()).with_static_gas(SIGNED_CALLBACK_GAS).on_solana_signed(id))
    }

    /// The SHA-256 a passkey signs: this vault, the one-time number and the exact action. An
    /// approval names the payee and amount too, so it cannot be used for any other payment.
    fn challenge_for(&self, action: &PasskeyAction) -> [u8; 32] {
        let what = match action {
            PasskeyAction::Approve { id } => {
                let held = self.held.get(id).unwrap_or_else(|| env::panic_str("No such held payment"));
                format!("approve {id} {} {}", held.payee, held.amount.0)
            }
            PasskeyAction::Reject { id } => format!("reject {id}"),
            PasskeyAction::Freeze => "freeze".to_string(),
        };
        env::sha256_array(format!("svalin-guard passkey v1\n{}\n{}\n{what}", env::current_account_id(), self.passkey_nonce).as_bytes())
    }

    fn drop_passkey(&mut self) {
        if let Some(old) = self.passkey.take() {
            Promise::new(env::current_account_id()).delete_key(old.device_key).detach();
        }
    }

    /// Approves a held payment on behalf of `caller`, the owner or the guardian.
    fn approve_as(&mut self, id: u64, caller: AccountId) {
        require!(!self.frozen, "The vault is frozen");
        let mut held = self.held.get(&id).cloned().unwrap_or_else(|| env::panic_str("No such held payment"));
        require!(
            env::block_timestamp_ms().saturating_sub(held.at_ms) <= HELD_MAX_AGE_MS,
            "This payment was held more than 7 days ago; reject it and let the agent ask again"
        );
        self.roll_day();
        let over_limits = held.amount.0 > self.limits.per_payment.0 || self.spent_today.saturating_add(held.amount.0) > self.limits.daily.0;
        let guardian = self.guardian.clone();
        match guardian {
            Some(guardian) if over_limits => {
                require!(!held.approved_by.contains(&caller), "You have already approved this payment");
                held.approved_by.push(caller.clone());
                if !(held.approved_by.contains(&self.owner) && held.approved_by.contains(&guardian)) {
                    let waiting_for = if caller == guardian { self.owner.clone() } else { guardian };
                    emit("approval_recorded", json!({ "id": id, "by": caller, "waiting_for": waiting_for }));
                    self.held.insert(id, held);
                    return;
                }
            }
            _ => require!(caller == self.owner, "Only the owner approves a payment within the limits"),
        }
        self.held.remove(&id);
        if held.payee.starts_with(SOLANA_PREFIX) {
            // A Solana payment expires a minute after it is signed, so it is signed when the agent
            // asks again, not now. The hour to collect it runs from the approval.
            let now = env::block_timestamp_ms();
            let lapsed: Vec<u64> = self.cleared.iter().filter(|(_, held)| now.saturating_sub(held.at_ms) > CLEARED_MAX_AGE_MS).map(|(id, _)| *id).collect();
            for lapsed_id in lapsed {
                self.cleared.remove(&lapsed_id);
            }
            require!(self.cleared.len() < MAX_QUEUE, "Too many approved payments are waiting for the agent");
            held.at_ms = now;
            emit("payment_cleared", json!({ "id": id, "payee": held.payee, "amount": held.amount, "until_ms": held.at_ms + CLEARED_MAX_AGE_MS }));
            self.cleared.insert(id, held);
            return;
        }
        // Approving pays this payment once; it does not change the service's locked terms.
        let locked = self.count_payment(&held.payee, held.amount.0, held.purchase.as_ref());
        let to: AccountId = held.payee.parse().expect("a NEAR payee is an account");
        self.transfer(to, held.amount.0, held.memo, true, held.purchase, locked);
        emit("payment_approved", json!({ "id": id, "payee": held.payee, "amount": held.amount }));
    }

    fn decide(&self, payee: &str, amount: u128, purchase: Option<&Purchase>) -> Decision {
        self.decide_with(payee, amount, self.spent_today, purchase)
    }

    /// The rules for one payment. `payee` is a NEAR account, or `solana:` and a Solana address; each
    /// is compared only with payees of its own kind.
    fn decide_with(&self, payee: &str, amount: u128, spent_today: u128, purchase: Option<&Purchase>) -> Decision {
        let refuse = |reason: Reason, imitates: Option<String>| Decision { outcome: Outcome::Refused, reasons: vec![reason], imitates, held_id: None };
        if self.frozen {
            return refuse(Reason::Frozen, None);
        }
        if amount == 0 {
            return refuse(Reason::ZeroAmount, None);
        }
        let on_solana = payee.strip_prefix(SOLANA_PREFIX);
        let not_a_payee = match on_solana {
            None => payee == env::current_account_id().as_str() || payee == self.token.as_str(),
            Some(address) => {
                self.solana_address.is_some_and(|own| solana::encode(&own) == address)
                    || self.solana.as_ref().is_some_and(|settings| settings.mint == address)
            }
        };
        if not_a_payee {
            return refuse(Reason::NotAPayee, None);
        }
        if purchase.and_then(|purchase| purchase.quote_expires_ms).is_some_and(|expires| expires <= env::block_timestamp_ms()) {
            return refuse(Reason::QuoteExpired, None);
        }

        let known = self.payees.contains_key(payee);
        let mut reasons = Vec::new();
        let mut imitates = None;
        if !known {
            // The well-known list is NEAR's; a Solana address is checked against past payees only.
            if let Some((name, how)) = on_solana.is_none().then(|| lookalike::imitated_well_known(payee)).flatten() {
                match how {
                    Likeness::Same => return refuse(Reason::ImitatesWellKnown, Some(name.to_string())),
                    Likeness::Near => {
                        reasons.push(Reason::ResemblesWellKnown);
                        imitates = Some(name.to_string());
                    }
                }
            }
            for (past, _) in self.payees.iter() {
                let likeness = match (on_solana, past.strip_prefix(SOLANA_PREFIX)) {
                    (None, None) => lookalike::likeness(payee, past),
                    // Base58 is case-sensitive and is never read as words: only the poisoning test.
                    (Some(address), Some(other)) => lookalike::addresses_look_alike(address, other).then_some(Likeness::Same),
                    _ => None,
                };
                match likeness {
                    Some(Likeness::Same) => return refuse(Reason::ImitatesPastPayee, Some(past.clone())),
                    Some(Likeness::Near) if !reasons.contains(&Reason::ResemblesPastPayee) => {
                        reasons.push(Reason::ResemblesPastPayee);
                        imitates.get_or_insert(past.clone());
                    }
                    _ => {}
                }
            }
            if amount > self.limits.new_payee.0 {
                reasons.push(Reason::NewPayeeOverLimit);
            }
        }
        if amount > self.limits.per_payment.0 {
            reasons.push(Reason::OverPaymentLimit);
        }
        if spent_today.saturating_add(amount) > self.limits.daily.0 {
            reasons.push(Reason::OverDailyLimit);
        }
        match purchase {
            Some(purchase) => {
                if let Some(terms) = self.terms.get(&purchase.service) {
                    if payee != terms.payee {
                        reasons.push(Reason::PayeeChanged);
                    }
                    if amount > terms.price.0 {
                        reasons.push(Reason::PriceChanged);
                    }
                }
                // A service paid per call is paid the same amount again and again; buying the same
                // item twice is the second charge.
                if self.bought_recently(purchase) {
                    reasons.push(Reason::PossibleDuplicate);
                }
            }
            None => {
                if let Some(last) = self.last_paid.get(payee) {
                    if last.amount == amount && env::block_timestamp_ms().saturating_sub(last.at_ms) < DUPLICATE_WINDOW_MS {
                        reasons.push(Reason::PossibleDuplicate);
                    }
                }
            }
        }
        let outcome = if reasons.is_empty() { Outcome::Paid } else { Outcome::Held };
        Decision { outcome, reasons, imitates, held_id: None }
    }

    /// Carries out a decision and records it: holds, pays, or refuses and counts a strike. A paid
    /// NEAR payment is sent here; a paid Solana one is written and signed by its caller.
    fn apply(&mut self, payee: String, amount: U128, memo: Option<String>, purchase: Option<Purchase>, mut decision: Decision) -> Decision {
        // The terms the decision was made against, for the event.
        let terms = purchase.as_ref().and_then(|purchase| self.terms.get(&purchase.service).cloned());
        match decision.outcome {
            Outcome::Refused | Outcome::Checking => {}
            Outcome::Held => {
                require!(self.held.len() < MAX_QUEUE, "Too many payments are waiting for the owner");
                let id = self.take_id();
                self.held.insert(
                    id,
                    Held {
                        payee: payee.clone(),
                        amount,
                        memo,
                        reasons: decision.reasons.clone(),
                        at_ms: env::block_timestamp_ms(),
                        approved_by: vec![],
                        purchase: purchase.clone(),
                    },
                );
                decision.held_id = Some(id);
            }
            Outcome::Paid if !payee.starts_with(SOLANA_PREFIX) => {
                let locked = self.count_payment(&payee, amount.0, purchase.as_ref());
                let to: AccountId = payee.parse().expect("a NEAR payee is an account");
                self.transfer(to, amount.0, memo, true, purchase.clone(), locked);
            }
            Outcome::Paid => {}
        }
        let event = match decision.outcome {
            Outcome::Paid => "payment_sent",
            Outcome::Held => "payment_held",
            Outcome::Refused => "payment_refused",
            Outcome::Checking => "payment_checking",
        };
        emit(
            event,
            json!({
                "payee": payee, "amount": amount, "reasons": decision.reasons, "imitates": decision.imitates,
                "held_id": decision.held_id, "purchase": purchase, "terms": terms, "agent": self.agent,
            }),
        );
        if decision.outcome == Outcome::Refused
            && decision.reasons.iter().any(|reason| matches!(reason, Reason::ImitatesWellKnown | Reason::ImitatesPastPayee))
        {
            self.strike();
        }
        decision
    }

    /// A NEAR payee the vault has never paid, when a check program is set. The program looks NEAR
    /// accounts up, so a Solana payee has the new-payee limit and the look-alike rules but no check.
    fn needs_check(&self, payee: &str) -> bool {
        self.checker.is_some() && !payee.starts_with(SOLANA_PREFIX) && !self.payees.contains_key(payee)
    }

    /// Asks OutLayer to run the check program on the payee, paying from the vault's own NEAR, and
    /// parks the payment until `on_check`.
    fn start_check(&mut self, payee: String, amount: U128, memo: Option<String>, purchase: Option<Purchase>) -> Decision {
        let checker = self.checker.clone().expect("a check program is set");
        require!(self.checking.len() < MAX_QUEUE, "Too many payments are waiting for a check");
        let id = self.take_id();
        self.checks_today += 1;
        self.checking.insert(
            id,
            Held { payee: payee.clone(), amount, memo, reasons: vec![], at_ms: env::block_timestamp_ms(), approved_by: vec![], purchase: purchase.clone() },
        );
        // OutLayer's account says which network this is, even for a vault on an implicit account.
        let network = if checker.outlayer.as_str().ends_with(".testnet") { "testnet" } else { "mainnet" };
        let args = json!({
            "source": { "WasmUrl": { "url": checker.wasm_url, "hash": checker.wasm_hash, "build_target": "wasm32-wasip2" } },
            "resource_limits": { "max_instructions": 1_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 30 },
            "input_data": json!({ "payee": payee, "network": network }).to_string(),
            "response_format": "Json",
            "payer_account_id": env::current_account_id(),
        });
        Promise::new(checker.outlayer)
            .function_call("request_execution".to_string(), args.to_string().into_bytes(), CHECK_DEPOSIT, CHECK_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CHECK_CALLBACK_GAS).on_check(id))
            .detach();
        self.apply(payee, amount, None, purchase, Decision { outcome: Outcome::Checking, reasons: vec![], imitates: None, held_id: Some(id) })
    }

    /// Locks a service's terms and says so.
    fn lock(&mut self, service: String, terms: Terms, by_owner: bool) {
        let locked = LockedTerms { payee: terms.payee, price: terms.price, since_ms: env::block_timestamp_ms(), by_owner };
        emit("terms_locked", json!({ "service": service, "terms": locked }));
        self.terms.insert(service, locked);
    }

    /// Locks a service's terms on its first payment: the payee and amount paid. Returns whether it
    /// did; a service with terms already, or a full list, is left as it is.
    fn lock_first(&mut self, purchase: &Purchase, payee: &str, amount: u128) -> bool {
        if self.terms.contains_key(&purchase.service) || self.terms.len() >= MAX_SERVICES {
            return false;
        }
        self.lock(purchase.service.clone(), Terms { payee: payee.to_string(), price: U128(amount) }, false);
        true
    }

    /// Counts a payment going out now toward today's limit and the second-charge checks, and locks
    /// its service's terms when it is the service's first. Returns whether it locked them.
    fn count_payment(&mut self, payee: &str, amount: u128, purchase: Option<&Purchase>) -> bool {
        self.spent_today += amount;
        self.last_paid.insert(payee.to_string(), LastPaid { amount, at_ms: env::block_timestamp_ms() });
        let locked = purchase.is_some_and(|purchase| self.lock_first(purchase, payee, amount));
        if let Some(purchase) = purchase {
            self.remember_item(purchase);
        }
        locked
    }

    /// A payee becomes known once paid.
    fn paid(&mut self, payee: &str, amount: u128) {
        let now = env::block_timestamp_ms();
        let entry = self.payees.entry(payee.to_string()).or_insert(Payee { since_ms: now, payments: 0, paid: U128(0) });
        entry.payments += 1;
        entry.paid = U128(entry.paid.0 + amount);
    }

    /// Takes back a counted payment that never went out: its amount goes back to today's limit, a
    /// retry is not a second charge, and the terms it locked and the item it bought are forgotten.
    fn undo_payment(&mut self, payee: &str, amount: u128, day: u64, purchase: Option<&Purchase>, locked: bool) {
        if day == self.day {
            self.spent_today = self.spent_today.saturating_sub(amount);
        }
        self.last_paid.remove(payee);
        if let Some(purchase) = purchase {
            self.forget_item(purchase);
            let mine = self.terms.get(&purchase.service).is_some_and(|terms| !terms.by_owner && terms.payee == payee && terms.price.0 == amount);
            if locked && mine {
                self.terms.remove(&purchase.service);
            }
        }
        emit("payment_failed", json!({ "payee": payee, "amount": U128(amount) }));
    }

    /// The oldest approved Solana payment that is exactly this one and still within its hour: the
    /// same payee and amount, and the same service and item.
    fn cleared_for(&self, payee: &str, amount: u128, purchase: Option<&Purchase>) -> Option<u64> {
        let now = env::block_timestamp_ms();
        let same = |held: &Held| match (&held.purchase, purchase) {
            (Some(theirs), Some(ours)) => theirs.service == ours.service && theirs.item == ours.item,
            (None, None) => true,
            _ => false,
        };
        self.cleared
            .iter()
            .filter(|(_, held)| held.payee == payee && held.amount.0 == amount && same(held) && now.saturating_sub(held.at_ms) <= CLEARED_MAX_AGE_MS)
            .map(|(id, _)| *id)
            .min()
    }

    fn bought_recently(&self, purchase: &Purchase) -> bool {
        let key = item_key(purchase);
        let now = env::block_timestamp_ms();
        self.recent_items.iter().any(|(item, at)| *item == key && now.saturating_sub(*at) < DUPLICATE_WINDOW_MS)
    }

    fn remember_item(&mut self, purchase: &Purchase) {
        let now = env::block_timestamp_ms();
        self.recent_items.retain(|(_, at)| now.saturating_sub(*at) < DUPLICATE_WINDOW_MS);
        if self.recent_items.len() >= MAX_RECENT_ITEMS {
            self.recent_items.remove(0);
        }
        self.recent_items.push((item_key(purchase), now));
    }

    /// A purchase that never arrived can be bought again.
    fn forget_item(&mut self, purchase: &Purchase) {
        let key = item_key(purchase);
        self.recent_items.retain(|(item, _)| *item != key);
    }

    /// Counts a look-alike refusal; enough of them within the window freeze the vault.
    fn strike(&mut self) {
        let now = env::block_timestamp_ms();
        self.strikes.retain(|at| now.saturating_sub(*at) < STRIKE_WINDOW_MS);
        self.strikes.push(now);
        if self.strikes.len() >= STRIKES_TO_FREEZE && !self.frozen {
            let cancelled = self.freeze_now();
            emit("auto_frozen", json!({ "strikes": self.strikes.len(), "within_ms": STRIKE_WINDOW_MS, "cancelled_changes": cancelled }));
        }
    }

    /// Freezes the vault and cancels every pending change except a recovery; returns their ids.
    fn freeze_now(&mut self) -> Vec<u64> {
        self.frozen = true;
        let cancelled: Vec<u64> = self
            .pending
            .iter()
            .filter(|(_, pending)| !matches!(pending.change, Change::Recover { .. }))
            .map(|(id, _)| *id)
            .collect();
        for id in &cancelled {
            self.pending.remove(id);
        }
        cancelled
    }

    /// The owner's buying rules and the vault's limits, for a buy of `amount` at `grade` from the
    /// edition of `day`. A buy is never held: it is bought (`Paid`) or refused.
    fn decide_buy(&self, token: &AccountId, amount: u128, pool_id: u64, grade: &str, day: &str) -> Decision {
        let refuse = |reason: Reason| Decision { outcome: Outcome::Refused, reasons: vec![reason], imitates: None, held_id: None };
        let Some(buying) = &self.buying else { return refuse(Reason::BuyingOff) };
        if self.frozen {
            return refuse(Reason::Frozen);
        }
        if amount == 0 {
            return refuse(Reason::ZeroAmount);
        }
        if token == &env::current_account_id() || token == &self.token {
            return refuse(Reason::NotAPayee);
        }
        let (Some(rank), Some(edition)) = (grade_rank(grade), day_number(day)) else { return refuse(Reason::BadProof) };
        if rank > grade_rank(&buying.min_grade).expect("checked when the rules were set") {
            return refuse(Reason::GradeTooLow);
        }
        if edition > today() {
            return refuse(Reason::BadProof);
        }
        if today() - edition > u64::from(buying.max_age_days) {
            return refuse(Reason::StaleProof);
        }
        if !buying.pools.iter().any(|pool| &pool.token == token && pool.pool_id == pool_id) {
            return refuse(Reason::PoolNotApproved);
        }
        if amount > self.limits.per_payment.0 {
            return refuse(Reason::OverPaymentLimit);
        }
        if self.spent_today.saturating_add(amount) > self.limits.daily.0 {
            return refuse(Reason::OverDailyLimit);
        }
        if let Some(last) = self.last_paid.get(token.as_str()) {
            if last.amount == amount && env::block_timestamp_ms().saturating_sub(last.at_ms) < DUPLICATE_WINDOW_MS {
                return refuse(Reason::PossibleDuplicate);
            }
        }
        Decision { outcome: Outcome::Paid, reasons: vec![], imitates: None, held_id: None }
    }

    /// Buys: Svalin's fee to its account, the rest to the market with a swap the vault writes itself,
    /// so the agent cannot route the money into another token.
    fn buy(&mut self, pending: &PendingBuy) {
        let buying = self.buying.clone().expect("only called with buying rules");
        let amount = pending.amount.0;
        // Kept back now and paid in `on_buy` for what the market actually used.
        let fee = amount * u128::from(buying.fee_bps) / 10_000;
        let pool = buying
            .pools
            .iter()
            .find(|pool| pool.token == pending.token && pool.pool_id == pending.pool_id)
            .expect("decide_buy refuses a pool the owner did not approve");
        // The agent may ask for a better price than the owner's worst one, never a worse one.
        let min_out = U128(pending.min_out.0.max(floor_out(amount - fee, pool.min_out_per_million.0)));
        self.spent_today += amount;
        self.last_paid.insert(pending.token.to_string(), LastPaid { amount, at_ms: env::block_timestamp_ms() });
        let swap = json!({
            "actions": [{
                "pool_id": pending.pool_id, "token_in": self.token, "token_out": pending.token, "min_amount_out": min_out,
            }],
        });
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(BUY_GAS)
            .ft_transfer_call(buying.market.clone(), U128(amount - fee), None, swap.to_string())
            .then(Self::ext(env::current_account_id()).with_static_gas(BUY_CALLBACK_GAS).on_buy(
                pending.token.clone(),
                U128(amount - fee),
                U128(fee),
                buying.fee_account.clone(),
                self.day,
            ))
            .detach();
        emit(
            "buy_sent",
            json!({
                "token": pending.token, "amount": pending.amount, "fee_up_to": U128(fee), "fee_account": buying.fee_account, "market": buying.market,
                "pool_id": pending.pool_id, "min_out": min_out, "grade": pending.grade, "day": pending.day,
                "backing_usd": pending.backing_usd, "agent": self.agent,
            }),
        );
    }

    /// Sends tokens; `counted` payments count toward the limits and make the payee known, and a
    /// `purchase` (with whether it `locked` its service's terms) is taken back if the transfer fails.
    fn transfer(&self, to: AccountId, amount: u128, memo: Option<String>, counted: bool, purchase: Option<Purchase>, locked: bool) {
        self.transfer_token(self.token.clone(), to, amount, memo, counted, purchase, locked);
    }

    /// `transfer`, of any token.
    #[allow(clippy::too_many_arguments)]
    fn transfer_token(&self, token: AccountId, to: AccountId, amount: u128, memo: Option<String>, counted: bool, purchase: Option<Purchase>, locked: bool) {
        ext_ft::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(TRANSFER_GAS)
            .ft_transfer(to.clone(), U128(amount), memo)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_transfer(to, U128(amount), counted, self.day, purchase, locked))
            .detach();
    }

    fn roll_day(&mut self) {
        let now = today();
        if now != self.day {
            self.day = now;
            self.spent_today = 0;
            self.checks_today = 0;
        }
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn require_owner_or_guardian(&self) {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || Some(&caller) == self.guardian.as_ref(), "Only the owner or the guardian can do this");
    }
}

fn add_agent_key(key: PublicKey) {
    agent_key(Promise::new(env::current_account_id()), key).detach();
}

/// Adds the agent's key to `promise`: a function-call key for the agent's requests on this vault
/// only.
fn agent_key(promise: Promise, key: PublicKey) -> Promise {
    promise.add_access_key_allowance(
        key,
        Allowance::limited(AGENT_GAS_ALLOWANCE).expect("non-zero allowance"),
        env::current_account_id(),
        AGENT_METHODS.to_string(),
    )
}

/// Adds the owner's device key to `promise`: a function-call key for `use_passkey` on this vault only.
fn passkey_key(promise: Promise, key: PublicKey) -> Promise {
    promise.add_access_key_allowance(
        key,
        Allowance::limited(PASSKEY_GAS_ALLOWANCE).expect("non-zero allowance"),
        env::current_account_id(),
        PASSKEY_METHODS.to_string(),
    )
}

fn check_passkey(passkey: &Passkey) {
    require!(unhex(&passkey.public_key).is_some_and(|key| key.len() == 33 && matches!(key[0], 2 | 3)), "public_key must be a compressed P-256 key in hex");
    require!(!passkey.rp_id.is_empty() && passkey.rp_id.len() <= 253, "rp_id must be the website's domain");
    let host = passkey.origin.strip_prefix("https://").unwrap_or_default();
    require!(
        passkey.origin.len() <= 256 && (host == passkey.rp_id || host.ends_with(&format!(".{}", passkey.rp_id))),
        "origin must be the https address of rp_id"
    );
}

/// WebAuthn's check of one passkey signature: the challenge is this one, on this website, the
/// person passed the device's fingerprint, face or PIN, and the key signed exactly this.
fn passkey_signature_is_valid(passkey: &Passkey, challenge: &[u8; 32], authenticator_data: &[u8], client_data_json: &[u8], signature: &[u8; 64]) -> bool {
    let Some(public_key) = unhex(&passkey.public_key).and_then(|key| <[u8; 33]>::try_from(key).ok()) else { return false };
    let Ok(client) = near_sdk::serde_json::from_slice::<ClientData>(client_data_json) else { return false };
    if client.kind != "webauthn.get" || client.cross_origin || client.origin != passkey.origin || client.challenge != BASE64_URL.encode(challenge) {
        return false;
    }
    if authenticator_data.len() < 37 || authenticator_data[..32] != env::sha256_array(passkey.rp_id.as_bytes()) || authenticator_data[32] & PASSKEY_FLAGS != PASSKEY_FLAGS {
        return false;
    }
    let mut signed = authenticator_data.to_vec();
    signed.extend_from_slice(&env::sha256_array(client_data_json));
    env::p256_verify(signature, &env::sha256_array(&signed), &public_key)
}

/// Writes a Solana payment of `amount` from the vault to `to`. Every byte is written here, after
/// every input has been checked: the money comes from the vault's own token account and goes to
/// `to`'s, and the agent cannot add or change an instruction.
fn write_solana_payment(settings: &Solana, vault: &solana::Address, to: &solana::Address, amount: u64, memo: &str, transaction: &SolanaTransaction) -> Vec<u8> {
    let mint = solana::decode(&settings.mint).expect("checked when the settings were set");
    let fee_payer = canonical_address(&transaction.fee_payer, "fee_payer");
    let blockhash = canonical_address(&transaction.recent_blockhash, "recent_blockhash");
    let source = canonical_address(&transaction.source, "source");
    let destination = canonical_address(&transaction.destination, "destination");
    require!(solana::is_token_account(&source, vault, &mint), "source must be the vault's own token account for the mint");
    require!(solana::is_token_account(&destination, to, &mint), "destination must be pay_to's token account for the mint");
    // pay_to itself is not in the message, so the fee payer may be the payee, as x402 allows.
    require!(
        solana::all_different(&[&fee_payer, vault, &source, &destination, &mint]),
        "The fee payer must be the seller's facilitator, not the vault, a token account or the mint"
    );
    let programs = [solana::TOKEN_PROGRAM, solana::COMPUTE_BUDGET_PROGRAM, solana::MEMO_PROGRAM, solana::ASSOCIATED_TOKEN_PROGRAM];
    require!(!programs.iter().any(|program| solana::decode(program) == Some(fee_payer)), "The fee payer cannot be a program");
    solana::message(&solana::Payment {
        fee_payer: &fee_payer,
        authority: vault,
        source: &source,
        destination: &destination,
        mint: &mint,
        amount,
        decimals: settings.decimals,
        memo,
        blockhash: &blockhash,
    })
}

/// Asks NEAR's signing network for the vault's Solana address; `on_solana_address` stores it.
fn fetch_solana_address(settings: &Solana) {
    ext_signer::ext(settings.signer.clone())
        .with_static_gas(ADDRESS_GAS)
        .derived_public_key(settings.path.clone(), Some(env::current_account_id()), Some(ED25519_DOMAIN))
        .then(Guard::ext(env::current_account_id()).with_static_gas(ADDRESS_CALLBACK_GAS).on_solana_address())
        .detach();
}

fn check_solana(settings: &Solana) {
    require!(!settings.path.is_empty() && settings.path.len() <= 64, "path must be 1 to 64 characters");
    require!(
        settings.network.starts_with("solana:") && settings.network.len() <= 64,
        "network must be a Solana CAIP-2 id, such as solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 for devnet"
    );
    canonical_address(&settings.mint, "mint");
    require!(settings.decimals <= 18, "decimals can be at most 18");
}

/// A Solana address written the one way base58 writes its 32 bytes, so one address cannot pass for
/// two payees.
fn canonical_address(text: &str, what: &str) -> solana::Address {
    match solana::decode(text) {
        Some(address) if solana::encode(&address) == text => address,
        _ => env::panic_str(&format!("{what} must be a Solana address")),
    }
}

/// A payee's name: a NEAR account, or `solana:` and a Solana address.
fn check_payee_name(name: &str) {
    match name.strip_prefix(SOLANA_PREFIX) {
        Some(address) => {
            canonical_address(address, "A Solana payee");
        }
        None => require!(name.parse::<AccountId>().is_ok(), "A payee must be a NEAR account, or solana: and a Solana address"),
    }
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len()).step_by(2).map(|at| u8::from_str_radix(&text[at..at + 2], 16).ok()).collect()
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes.iter().flat_map(|byte| [DIGITS[usize::from(byte >> 4)] as char, DIGITS[usize::from(byte & 15)] as char]).collect()
}

fn check_limits(limits: &Limits) {
    require!(
        limits.new_payee.0 <= limits.per_payment.0 && limits.per_payment.0 <= limits.daily.0,
        "Limits must satisfy new_payee <= per_payment <= daily"
    );
}

fn check_checker(checker: &Checker) {
    require!(
        checker.wasm_hash.len() == 64 && checker.wasm_hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "wasm_hash must be the program's SHA-256 as 64 lowercase hex characters"
    );
    require!(checker.wasm_url.starts_with("https://"), "wasm_url must be an https:// URL");
    require!(checker.min_age_ms <= 30 * DAY_MS, "min_age_ms can be at most 30 days");
}

fn check_service(service: &str) {
    require!(!service.is_empty() && service.len() <= MAX_SERVICE_LEN, "A service's name must be 1 to 128 bytes");
}

fn check_purchase(purchase: &Purchase) {
    check_service(&purchase.service);
    require!(purchase.item.len() <= MAX_ITEM_LEN, "An item can be at most 256 bytes");
}

fn check_terms(service: &str, terms: &Terms) {
    check_service(service);
    check_payee_name(&terms.payee);
    require!(terms.price.0 > 0, "A service's price must be more than zero");
}

/// What identifies a purchase for the duplicate check: the service and the item, length-prefixed so
/// no two pairs read the same.
fn item_key(purchase: &Purchase) -> [u8; 32] {
    env::sha256_array(format!("{}:{}{}", purchase.service.len(), purchase.service, purchase.item).as_bytes())
}

fn check_delays(delays: &Delays) {
    require!(delays.loosen_ms >= HOUR_MS, "Riskier changes must wait at least an hour");
    require!(delays.recovery_ms >= delays.loosen_ms, "A recovery must wait at least as long as other changes");
}

fn check_buying(buying: &Buying) {
    require!(grade_rank(&buying.min_grade).is_some(), "min_grade must be one of A, B, C, D or F");
    require!(!buying.methodology.is_empty() && buying.methodology.len() <= 64, "methodology must be 1 to 64 characters");
    require!(buying.max_age_days <= 7, "max_age_days can be at most 7");
    require!(buying.fee_bps <= MAX_FEE_BPS, "fee_bps can be at most 100 (1%)");
    require!(buying.pools.len() <= MAX_POOLS, "A vault can approve at most 32 pools");
    require!(buying.pools.iter().all(|pool| pool.min_out_per_million.0 > 0), "Each pool needs a worst price above zero");
    // Listed twice, a pool would have two worst prices, and only the first would count.
    let listed_once = |index: usize, pool: &Pool| !buying.pools[..index].iter().any(|other| other.token == pool.token && other.pool_id == pool.pool_id);
    require!(buying.pools.iter().enumerate().all(|(index, pool)| listed_once(index, pool)), "A pool can be listed once");
}

/// The least a buy of `amount` may return at `per_million` of the bought token for each million of
/// the vault's. Rounded up. It saturates rather than wraps, so a mistake can only be a buy the
/// market refuses.
fn floor_out(amount: u128, per_million: u128) -> u128 {
    let whole = (amount / 1_000_000).saturating_mul(per_million);
    let part = (amount % 1_000_000).saturating_mul(per_million).div_ceil(1_000_000);
    whole.saturating_add(part)
}

/// 0 for A up to 4 for F; none for anything else.
fn grade_rank(grade: &str) -> Option<usize> {
    GRADES.iter().position(|known| *known == grade)
}

/// Days since 1970-01-01 for a YYYY-MM-DD date, the day count `today` uses; none if it is not one.
fn day_number(day: &str) -> Option<u64> {
    let bytes = day.as_bytes();
    let digits = |range: std::ops::Range<usize>| day.get(range).filter(|part| part.bytes().all(|b| b.is_ascii_digit()))?.parse::<i64>().ok();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let (year, month, date) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1970..=9999).contains(&year) || !(1..=12).contains(&month) || date < 1 || date > month_days[(month - 1) as usize] {
        return None;
    }
    // Howard Hinnant's days_from_civil.
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + date - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    u64::try_from(era * 146_097 + day_of_era - 719_468).ok()
}

fn today() -> u64 {
    env::block_timestamp_ms() / DAY_MS
}

/// The events for a buy that is checked or refused, with the agent's key like every payment event.
fn emit_buy(event: &str, pending: &PendingBuy, reasons: &[Reason], agent: Option<&PublicKey>) {
    emit(
        event,
        json!({
            "token": pending.token, "amount": pending.amount, "grade": pending.grade, "day": pending.day,
            "backing_usd": pending.backing_usd, "reasons": reasons, "agent": agent,
        }),
    );
}

/// A NEP-297 event, so wallets, indexers and the Svalin dashboard can follow every decision.
fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data] })
    ));
}
