//! Svalin Ratings: the sealed Svalin Index editions on NEAR.
//!
//! - Each daily edition's Merkle root is published once, in date order, by a key that can call
//!   nothing but `publish`. Nothing is ever edited. Anyone can rebuild an edition from its archived
//!   inputs and get the same root, so nobody has to trust Svalin.
//! - Any contract or agent checks a token's grade and held backing with a short proof: `verify` is
//!   a free view call.
//! - An edition is usable only after a challenge window (6 hours unless set otherwise at setup). A
//!   wrong root, from a stolen publishing key or a bug, can be retracted in that time, before
//!   anyone relies on it. Retracting is instant and final.
//! - Initialising deletes the key that deployed the contract, so only the code decides.

#[cfg(test)]
mod tests;

use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, Vector};
use near_sdk::{assert_one_yocto, env, near, require, AccountId, Allowance, BorshStorageKey, NearToken, PanicOnDefault, Promise, PublicKey};
use svalin_proof::{Hash, Step};

const HOUR_MS: u64 = 60 * 60 * 1000;
/// How long a new edition waits before `verify` accepts proofs against it.
pub const CHALLENGE_MS: u64 = 6 * HOUR_MS;
/// The shortest and longest challenge windows a registry can be set up with.
const MIN_CHALLENGE_MS: u64 = 10 * 60 * 1000;
const MAX_CHALLENGE_MS: u64 = 7 * 24 * HOUR_MS;
/// NEAR the publishing key may spend on gas; the owner tops it up with `set_publisher`.
const PUBLISHER_GAS_ALLOWANCE: NearToken = NearToken::from_near(1);
const PUBLISH_METHOD: &str = "publish";
/// Steps in a proof at most: enough for 2^40 tokens.
const MAX_PROOF_STEPS: usize = 40;
const EVENT_STANDARD: &str = "svalin-ratings";
const EVENT_VERSION: &str = "1.0.0";

/// NEAR's own SHA-256, for the shared proof code.
struct NearSha;
impl svalin_proof::Sha256 for NearSha {
    fn sha256(data: &[u8]) -> Hash {
        env::sha256_array(data)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Edition {
    /// The UTC day the edition was sealed, YYYY-MM-DD.
    pub day: String,
    /// Merkle root of the edition's leaves (see `svalin-proof`), 64 hex characters.
    pub root: String,
    /// The edition's own fingerprint and the SHA-256 of its index file, as sealed in svalin-index.
    pub fingerprint: String,
    pub index_sha256: String,
    pub methodology: String,
    pub tokens: u32,
    pub published_at_ms: u64,
    pub retracted: bool,
}

/// One proof step as JSON: the sibling's hash and whether it sits on the left.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ProofStep {
    pub hash: String,
    pub left: bool,
}

#[near(serializers = [json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Problem {
    NoSuchEdition,
    Retracted,
    InChallengeWindow,
    BadLeaf,
    BadProof,
}

/// The answer to `verify`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Verification {
    pub valid: bool,
    pub problem: Option<Problem>,
    /// The leaf that was checked, so a caller can see exactly what was proved.
    pub leaf: Option<String>,
    /// The edition's methodology, so a caller can insist on one (for example the 24-hour hold of
    /// `near-token-backing-v1`).
    pub methodology: Option<String>,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Editions,
    Days,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ratings {
    owner: AccountId,
    publisher: Option<PublicKey>,
    editions: IterableMap<String, Edition>,
    /// Days in publishing order, oldest first.
    days: Vector<String>,
    /// How long a new edition waits before `verify` accepts proofs against it. Fixed at setup.
    challenge_ms: u64,
}

#[near]
impl Ratings {
    /// Sets the registry up and, with `lock` (the default), deletes the key that deployed it. Deploy
    /// and initialise in one transaction from the registry's own account for that. The challenge
    /// window is 6 hours unless set, and can never change afterwards.
    #[init]
    pub fn new(owner: AccountId, publisher: Option<PublicKey>, lock: Option<bool>, challenge_ms: Option<u64>) -> Self {
        let challenge_ms = challenge_ms.unwrap_or(CHALLENGE_MS);
        require!(
            (MIN_CHALLENGE_MS..=MAX_CHALLENGE_MS).contains(&challenge_ms),
            "challenge_ms must be between 10 minutes and 7 days"
        );
        if let Some(key) = &publisher {
            publisher_key(Promise::new(env::current_account_id()), key.clone()).detach();
        }
        if lock.unwrap_or(true) && env::signer_account_id() == env::current_account_id() {
            Promise::new(env::current_account_id()).delete_key(env::signer_account_pk()).detach();
        }
        Self { owner, publisher, editions: IterableMap::new(StorageKey::Editions), days: Vector::new(StorageKey::Days), challenge_ms }
    }

    /* ----------------------------- the publisher ----------------------------- */

    /// Adds the next sealed edition. Only the publishing key, and only a day after the last one.
    pub fn publish(&mut self, day: String, root: String, fingerprint: String, index_sha256: String, methodology: String, tokens: u32) {
        require!(
            env::predecessor_account_id() == env::current_account_id() && self.publisher.as_ref() == Some(&env::signer_account_pk()),
            "Only the publishing key can publish"
        );
        require!(svalin_proof::is_day(&day), "day must be YYYY-MM-DD");
        // A day in the future would block every real edition until then, retracted or not.
        require!(day <= utc_day(env::block_timestamp_ms()), "An edition cannot be dated after today (UTC)");
        if let Some(last) = self.days.len().checked_sub(1).and_then(|i| self.days.get(i)) {
            require!(&day > last, "Editions are published in date order and never replaced");
        }
        for (name, hex) in [("root", &root), ("fingerprint", &fingerprint), ("index_sha256", &index_sha256)] {
            require!(svalin_proof::from_hex(hex).is_some(), format!("{name} must be 64 lowercase hex characters"));
        }
        require!(!methodology.is_empty() && methodology.len() <= 64, "methodology must be 1 to 64 characters");
        require!(tokens > 0, "An edition rates at least one token");
        let edition = Edition { day: day.clone(), root, fingerprint, index_sha256, methodology, tokens, published_at_ms: env::block_timestamp_ms(), retracted: false };
        emit("edition_published", json!({ "edition": edition, "usable_from_ms": edition.published_at_ms + self.challenge_ms }));
        self.editions.insert(day.clone(), edition);
        self.days.push(day);
    }

    /* -------------------------------- the owner -------------------------------- */

    /// Withdraws an edition for good: `verify` refuses every proof against it. Instant, because it
    /// only makes the registry stricter.
    #[payable]
    pub fn retract(&mut self, day: String, reason: String) {
        assert_one_yocto();
        self.require_owner();
        require!(reason.len() <= 280, "Keep the reason to 280 characters");
        let edition = self.editions.get_mut(&day).unwrap_or_else(|| env::panic_str("No such edition"));
        require!(!edition.retracted, "Already retracted");
        edition.retracted = true;
        emit("edition_retracted", json!({ "day": day, "reason": reason }));
    }

    /// Replaces the publishing key (or tops up its gas allowance, given the same key).
    #[payable]
    pub fn set_publisher(&mut self, key: PublicKey) {
        assert_one_yocto();
        self.require_owner();
        let mut promise = Promise::new(env::current_account_id());
        if let Some(old) = self.publisher.replace(key.clone()) {
            promise = promise.delete_key(old);
        }
        publisher_key(promise, key.clone()).detach();
        emit("publisher_set", json!({ "key": key }));
    }

    /// Removes the publishing key at once.
    #[payable]
    pub fn revoke_publisher(&mut self) {
        assert_one_yocto();
        self.require_owner();
        if let Some(key) = self.publisher.take() {
            Promise::new(env::current_account_id()).delete_key(key).detach();
        }
        emit("publisher_revoked", json!({}));
    }

    /* --------------------------------- views --------------------------------- */

    /// Whether `token` had `grade` and `backing_usd` (whole dollars) in the edition of `day`, as
    /// `proof` shows. Valid only for an edition past its challenge window and not retracted.
    pub fn verify(&self, day: String, token: String, grade: String, backing_usd: u64, proof: Vec<ProofStep>) -> Verification {
        let Some(edition) = self.editions.get(&day) else {
            return Verification { valid: false, problem: Some(Problem::NoSuchEdition), leaf: None, methodology: None };
        };
        let methodology = Some(edition.methodology.clone());
        let fail = |problem: Problem, leaf: Option<String>| Verification { valid: false, problem: Some(problem), leaf, methodology: methodology.clone() };
        if edition.retracted {
            return fail(Problem::Retracted, None);
        }
        if env::block_timestamp_ms() < edition.published_at_ms + self.challenge_ms {
            return fail(Problem::InChallengeWindow, None);
        }
        let Ok(leaf) = svalin_proof::leaf(&day, &token, &grade, backing_usd) else { return fail(Problem::BadLeaf, None) };
        let steps: Option<Vec<Step>> = (proof.len() <= MAX_PROOF_STEPS)
            .then(|| proof.iter().map(|step| svalin_proof::from_hex(&step.hash).map(|sibling| Step { sibling, left: step.left })).collect())
            .flatten();
        let root = svalin_proof::from_hex(&edition.root).expect("roots are checked when published");
        match steps {
            Some(steps) if svalin_proof::verify_leaf::<NearSha>(&root, &leaf, &steps) => {
                Verification { valid: true, problem: None, leaf: Some(leaf), methodology: methodology.clone() }
            }
            _ => fail(Problem::BadProof, Some(leaf)),
        }
    }

    pub fn edition(&self, day: String) -> Option<Edition> {
        self.editions.get(&day).cloned()
    }

    /// The newest edition `verify` accepts proofs against.
    pub fn latest_usable(&self) -> Option<Edition> {
        let now = env::block_timestamp_ms();
        (0..self.days.len())
            .rev()
            .filter_map(|i| self.days.get(i).and_then(|day| self.editions.get(day)))
            .find(|edition| !edition.retracted && now >= edition.published_at_ms + self.challenge_ms)
            .cloned()
    }

    /// Editions in publishing order, `limit` at most from position `from`.
    pub fn editions(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Edition> {
        let from = from.unwrap_or(0);
        let end = from.saturating_add(limit.unwrap_or(50).min(100)).min(self.days.len());
        (from..end).filter_map(|i| self.days.get(i).and_then(|day| self.editions.get(day)).cloned()).collect()
    }

    pub fn status(&self) -> near_sdk::serde_json::Value {
        json!({ "owner": self.owner, "publisher": self.publisher, "editions": self.days.len(), "challenge_ms": self.challenge_ms })
    }
}

impl Ratings {
    fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }
}

/// The UTC date of a moment, as YYYY-MM-DD (the civil-from-days algorithm).
pub fn utc_day(ms: u64) -> String {
    let days = (ms / (24 * HOUR_MS)) as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Adds the publishing key to `promise`: a function-call key for `publish` on this contract only.
fn publisher_key(promise: Promise, key: PublicKey) -> Promise {
    promise.add_access_key_allowance(
        key,
        Allowance::limited(PUBLISHER_GAS_ALLOWANCE).expect("non-zero allowance"),
        env::current_account_id(),
        PUBLISH_METHOD.to_string(),
    )
}

/// A NEP-297 event, so indexers and the Svalin website can follow every edition.
fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data] })));
}
