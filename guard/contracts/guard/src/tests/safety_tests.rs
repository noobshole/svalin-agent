//! Who can get money out, how fast, and what the owner's fingerprint can and cannot do.

use super::*;
use p256::ecdsa::signature::hazmat::PrehashSigner;
use p256::ecdsa::{Signature, SigningKey};

const SOL_VAULT: &str = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
const SOL_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_PAY_TO: &str = "AzfdbWXPC3BiPJqaeHsGqzZw8NoxYSZkZMob1VNivGBo";
const SOL_FEE_PAYER: &str = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const SOL_SOURCE: &str = "8EiF91LJfbatqHRY3k2jp8dwrFY3yDQeEovpMDZnpJiP";
const SOL_DESTINATION: &str = "5kjvk6Y5ZQRjV8KWFojvv65ttuCRCarazPtRkQK9SiXa";
const SOL_BLOCKHASH: &str = "cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN";
const SOL_MEMO: &str = "00112233445566778899aabbccddeeff";
const SOL_SIGNATURE: &str = "f8de294e5cca88973891eeddf5515c4dfac97d1f5a0b2e12b989a964d7f46e8a01dd5a08d246239a830885ea2d04313cccb36c4543e8bd9527b7d07e5ef06408";
const RP_ID: &str = "guard.example.com";
const ORIGIN: &str = "https://guard.example.com";
const HOUR: u64 = 3_600_000;

fn device_key() -> PublicKey {
    "ed25519:3tysLvy7KGoE8pznUgXvSHa4vYyGvrDZFcT8jgb8PEQ6".parse().unwrap()
}

fn phone() -> SigningKey {
    SigningKey::from_slice(&[7u8; 32]).unwrap()
}

fn passkey_of(key: &SigningKey) -> Passkey {
    let public = key.verifying_key().to_encoded_point(true);
    Passkey { public_key: hex(public.as_bytes()), rp_id: RP_ID.into(), origin: ORIGIN.into(), device_key: device_key() }
}

/// A vault with a passkey already through its wait.
fn with_passkey() -> Guard {
    let mut guard = new_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::SetPasskey { passkey: passkey_of(&phone()) });
    as_owner(START_MS + DAY_MS);
    guard.execute(change);
    assert!(guard.status().passkey.is_some());
    guard
}

fn as_device(ms: u64) {
    call(vault(), device_key(), 0, ms);
}

/// What a browser answers after the fingerprint, with the parts a test may spoil.
struct Answer {
    authenticator_data: Vec<u8>,
    client_data_json: Vec<u8>,
}

fn answer_for(challenge: &[u8; 32]) -> Answer {
    let mut authenticator_data = env::sha256_array(RP_ID.as_bytes()).to_vec();
    authenticator_data.push(PASSKEY_FLAGS);
    authenticator_data.extend_from_slice(&[0, 0, 0, 0]);
    let client_data_json = format!(r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false}}"#, BASE64_URL.encode(challenge)).into_bytes();
    Answer { authenticator_data, client_data_json }
}

fn signed(key: &SigningKey, answer: &Answer) -> (String, String, String) {
    let mut message = answer.authenticator_data.clone();
    message.extend_from_slice(&env::sha256_array(&answer.client_data_json));
    let signature: Signature = key.sign_prehash(&env::sha256_array(&message)).unwrap();
    (BASE64.encode(&answer.authenticator_data), BASE64.encode(&answer.client_data_json), BASE64.encode(signature.to_bytes()))
}

fn use_it(guard: &mut Guard, action: PasskeyAction, ms: u64) {
    as_device(ms);
    let challenge = guard.challenge_for(&action);
    let (data, client, signature) = signed(&phone(), &answer_for(&challenge));
    guard.use_passkey(action, data, client, signature);
}

fn solana_settings() -> Solana {
    Solana {
        signer: id("v1.signer-prod.testnet"),
        path: "solana-1".into(),
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".into(),
        mint: SOL_USDC.into(),
        decimals: 6,
    }
}

fn answer_callback(ms: u64, result: Option<Vec<u8>>) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(ms * 1_000_000);
    let result = result.map_or(near_sdk::PromiseResult::Failed, near_sdk::PromiseResult::Successful);
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn solana_vault() -> Guard {
    call(vault(), other_key(), 0, START_MS);
    let mut guard =
        Guard::new(owner(), token(), limits(50, 100, 5), Some(guardian()), Some(agent_key()), None, Some(false), None, None, Some(solana_settings()));
    answer_callback(START_MS, Some(format!("\"ed25519:{SOL_VAULT}\"").into_bytes()));
    guard.on_solana_address();
    guard
}

fn transaction() -> SolanaTransaction {
    SolanaTransaction { fee_payer: SOL_FEE_PAYER.into(), recent_blockhash: SOL_BLOCKHASH.into(), source: SOL_SOURCE.into(), destination: SOL_DESTINATION.into() }
}

/// A withdrawal of 2,000 units to `SOL_PAY_TO` that has been through its wait.
fn waited_withdrawal(guard: &mut Guard) -> u64 {
    as_owner(START_MS);
    let change = guard.propose(Change::WithdrawSolana { to: SOL_PAY_TO.into(), amount: U128(2_000) });
    as_owner(START_MS + DAY_MS);
    guard.execute(change);
    START_MS + DAY_MS
}

fn collect(guard: &mut Guard, ms: u64) -> u64 {
    as_owner(ms);
    let _ = guard.collect_solana_withdrawal(SOL_MEMO.into(), transaction());
    guard.signing.iter().map(|(id, _)| *id).next().expect("a signing")
}

/* ------------------------------ getting money out ------------------------------ */

#[test]
#[should_panic(expected = "This change is still waiting")]
fn a_stolen_owner_key_cannot_take_the_money_at_once_even_to_the_owner() {
    let mut guard = new_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::Withdraw { to: owner(), amount: U128(100 * USDC) });
    as_owner(START_MS + HOUR);
    guard.execute(change);
}

#[test]
fn the_guardian_can_stop_a_withdrawal_to_the_owner_during_its_wait() {
    let mut guard = new_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::Withdraw { to: owner(), amount: U128(100 * USDC) });
    as_guardian(START_MS + HOUR);
    guard.cancel(change);
    assert!(guard.pending_changes().is_empty());
}

#[test]
fn past_the_daily_limit_the_owner_alone_cannot_approve() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    assert_eq!(pay_at(&mut guard, "shop.near", 49, START_MS).outcome, Outcome::Paid);
    assert_eq!(pay_at(&mut guard, "shop.near", 48, START_MS).outcome, Outcome::Paid);
    let held = pay_at(&mut guard, "shop.near", 10, START_MS);
    assert_eq!(held.reasons, vec![Reason::OverDailyLimit]);
    let held = held.held_id.unwrap();
    as_owner(START_MS);
    guard.approve(held);
    assert_eq!(guard.held_payments().len(), 1, "one key is not enough past the day's limit");
    as_guardian(START_MS);
    guard.approve(held);
    assert!(guard.held_payments().is_empty());
}

#[test]
#[should_panic(expected = "The memo can be at most 256 bytes")]
fn a_memo_cannot_fill_the_vaults_storage() {
    let mut guard = new_vault();
    as_agent(START_MS);
    guard.request_payment(id("shop.near"), U128(USDC), Some("x".repeat(257)), None);
}

#[test]
fn solana_money_can_come_home_after_its_wait() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    assert_eq!(guard.status().solana_withdrawal.unwrap().to, SOL_PAY_TO);
    let signing = collect(&mut guard, ready);
    assert!(guard.status().solana_withdrawal.is_none());

    // No answer from the signing network: nothing went out, so it can be collected again.
    answer_callback(ready, None);
    assert_eq!(guard.on_solana_signed(signing).reasons, vec![Reason::SigningFailed]);
    assert!(guard.status().solana_withdrawal.is_some(), "nothing went out, so it stays collectable");

    // The vector's payment is this same withdrawal (2,000 units, same memo and blockhash).
    let signing = collect(&mut guard, ready);
    let bytes: Vec<u8> = (0..SOL_SIGNATURE.len()).step_by(2).map(|i| u8::from_str_radix(&SOL_SIGNATURE[i..i + 2], 16).unwrap()).collect();
    answer_callback(ready, Some(format!("{{\"scheme\":\"Ed25519\",\"signature\":{bytes:?}}}").into_bytes()));
    let answer = guard.on_solana_signed(signing);
    assert_eq!(answer.outcome, Outcome::Paid);
    assert!(answer.payment.is_some());
    assert_eq!(guard.status().spent_today, U128(0), "a withdrawal counts toward no limit");
    assert!(guard.payee(format!("solana:{SOL_PAY_TO}")).is_none(), "and makes nobody a known payee");
    assert!(guard.status().solana_withdrawal.is_none());
}

#[test]
#[should_panic(expected = "This change is still waiting")]
fn solana_money_waits_like_any_other() {
    let mut guard = solana_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::WithdrawSolana { to: SOL_PAY_TO.into(), amount: U128(2_000) });
    as_owner(START_MS + HOUR);
    guard.execute(change);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_collects_solana_money() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    as_guardian(ready);
    let _ = guard.collect_solana_withdrawal(SOL_MEMO.into(), transaction());
}

#[test]
fn the_agent_can_collect_a_withdrawal_that_has_waited_but_not_change_it() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    as_agent(ready);
    let _ = guard.collect_solana_withdrawal(SOL_MEMO.into(), transaction());
    let (_, signing) = guard.signing.iter().next().expect("a signing");
    assert_eq!((signing.payee.as_str(), signing.amount, signing.withdrawal), (format!("solana:{SOL_PAY_TO}").as_str(), U128(2_000), true));
}

#[test]
#[should_panic(expected = "No Solana withdrawal is waiting")]
fn the_agent_cannot_collect_what_has_not_waited() {
    let mut guard = solana_vault();
    as_owner(START_MS);
    guard.propose(Change::WithdrawSolana { to: SOL_PAY_TO.into(), amount: U128(2_000) });
    as_agent(START_MS + HOUR);
    let _ = guard.collect_solana_withdrawal(SOL_MEMO.into(), transaction());
}

#[test]
#[should_panic(expected = "destination must be pay_to's token account")]
fn the_agent_cannot_send_a_withdrawal_anywhere_else() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    as_agent(ready);
    let elsewhere = SolanaTransaction { destination: "FwJCD9QQbKuvWUUUN9TEzLPCEDkDsr3vTxZaQys4FHTA".into(), ..transaction() };
    let _ = guard.collect_solana_withdrawal(SOL_MEMO.into(), elsewhere);
}

#[test]
#[should_panic(expected = "The vault is frozen")]
fn a_frozen_vault_lets_no_solana_money_out() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    as_guardian(ready);
    guard.freeze();
    let _ = collect(&mut guard, ready);
}

#[test]
#[should_panic(expected = "This withdrawal waited more than an hour")]
fn a_withdrawal_not_collected_within_the_hour_lapses() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    let _ = collect(&mut guard, ready + 2 * HOUR);
}

#[test]
fn a_recovery_stops_what_the_old_key_set_in_motion() {
    let mut guard = solana_vault();
    let ready = waited_withdrawal(&mut guard);
    as_owner(ready);
    let passkey = guard.propose(Change::SetPasskey { passkey: passkey_of(&phone()) });
    as_owner(ready + DAY_MS);
    guard.execute(passkey);
    as_guardian(ready + DAY_MS);
    let recovery = guard.propose(Change::Recover { new_owner: id("alice-new.near") });
    as_guardian(ready + DAY_MS + 8 * DAY_MS);
    guard.execute(recovery);
    let status = guard.status();
    assert!(status.passkey.is_none() && status.solana_withdrawal.is_none());
}

/* -------------------------------- the fingerprint -------------------------------- */

#[test]
#[should_panic(expected = "This change is still waiting")]
fn adding_a_fingerprint_waits() {
    let mut guard = new_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::SetPasskey { passkey: passkey_of(&phone()) });
    as_owner(START_MS + HOUR);
    guard.execute(change);
}

#[test]
fn the_guardian_can_take_a_fingerprint_off_at_once() {
    let mut guard = with_passkey();
    as_guardian(START_MS + DAY_MS);
    guard.remove_passkey();
    assert!(guard.status().passkey.is_none());
}

#[test]
#[should_panic(expected = "The device key cannot be the agent's key")]
fn the_agent_cannot_be_the_owners_device() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.propose(Change::SetPasskey { passkey: Passkey { device_key: agent_key(), ..passkey_of(&phone()) } });
}

#[test]
fn a_fingerprint_freezes_the_vault() {
    let mut guard = with_passkey();
    use_it(&mut guard, PasskeyAction::Freeze, START_MS + DAY_MS);
    assert!(guard.status().frozen);
}

#[test]
fn a_fingerprint_rejects_a_held_payment() {
    let mut guard = with_passkey();
    let held = pay_at(&mut guard, "newshop.near", 9, START_MS + DAY_MS).held_id.unwrap();
    use_it(&mut guard, PasskeyAction::Reject { id: held }, START_MS + DAY_MS);
    assert!(guard.held_payments().is_empty());
}

/// A payment to a payee the vault paid before, held only for repeating itself.
fn held_for_a_known_payee(guard: &mut Guard) -> u64 {
    known(guard, "shop.near");
    let held = pay_at(guard, "shop.near", 1, START_MS + MINUTE_MS);
    assert_eq!(held.reasons, vec![Reason::PossibleDuplicate]);
    held.held_id.unwrap()
}

#[test]
fn a_fingerprint_approves_a_payment_to_someone_already_paid() {
    let mut guard = with_passkey();
    let held = held_for_a_known_payee(&mut guard);
    use_it(&mut guard, PasskeyAction::Approve { id: held }, START_MS + MINUTE_MS);
    assert!(guard.held_payments().is_empty());
    assert_eq!(guard.status().spent_today, U128(2 * USDC));
}

#[test]
#[should_panic(expected = "A new or changed payee is approved from the wallet")]
fn a_fingerprint_never_approves_a_new_payee() {
    let mut guard = with_passkey();
    let held = pay_at(&mut guard, "newshop.near", 9, START_MS + DAY_MS).held_id.unwrap();
    use_it(&mut guard, PasskeyAction::Approve { id: held }, START_MS + DAY_MS);
}

#[test]
#[should_panic(expected = "A new or changed payee is approved from the wallet")]
fn a_fingerprint_never_approves_a_swapped_payee() {
    let mut guard = with_passkey();
    known(&mut guard, "shop.near");
    known(&mut guard, "other.near");
    let service = "https://data.example".to_string();
    as_owner(START_MS);
    guard.lock_terms(service.clone(), Terms { payee: "shop.near".into(), price: U128(USDC) });
    as_agent(START_MS + HOUR);
    let purchase = Purchase { service, item: "/a".into(), quote_expires_ms: None };
    let held = guard.request_payment(id("other.near"), U128(USDC), None, Some(purchase));
    assert_eq!(held.reasons, vec![Reason::PayeeChanged]);
    use_it(&mut guard, PasskeyAction::Approve { id: held.held_id.unwrap() }, START_MS + HOUR);
}

#[test]
#[should_panic(expected = "Above the limits a payment is approved from the wallet")]
fn a_fingerprint_stays_within_the_limits() {
    let mut guard = with_passkey();
    known(&mut guard, "shop.near");
    let held = pay_at(&mut guard, "shop.near", 60, START_MS + HOUR).held_id.unwrap();
    use_it(&mut guard, PasskeyAction::Approve { id: held }, START_MS + HOUR);
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn a_fingerprint_signature_works_once() {
    let mut guard = with_passkey();
    let held = held_for_a_known_payee(&mut guard);
    let second = pay_at(&mut guard, "shop.near", 2, START_MS + MINUTE_MS);
    assert_eq!(second.outcome, Outcome::Paid, "{:?}", second.reasons);
    let again = pay_at(&mut guard, "shop.near", 2, START_MS + MINUTE_MS).held_id.unwrap();
    as_device(START_MS + MINUTE_MS);
    let (data, client, signature) = signed(&phone(), &answer_for(&guard.challenge_for(&PasskeyAction::Reject { id: held })));
    guard.use_passkey(PasskeyAction::Reject { id: held }, data.clone(), client.clone(), signature.clone());
    // The same signature for another payment, or again: the number it signed has moved on.
    guard.use_passkey(PasskeyAction::Reject { id: again }, data, client, signature);
}

/// One spoiled answer, which the vault must refuse.
fn refused(spoil: impl FnOnce(&mut Answer)) {
    let mut guard = with_passkey();
    as_device(START_MS + DAY_MS);
    let mut answer = answer_for(&guard.challenge_for(&PasskeyAction::Freeze));
    spoil(&mut answer);
    let (data, client, signature) = signed(&phone(), &answer);
    guard.use_passkey(PasskeyAction::Freeze, data, client, signature);
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn another_website_cannot_use_the_fingerprint() {
    refused(|answer| answer.client_data_json = String::from_utf8_lossy(&answer.client_data_json).replace(ORIGIN, "https://evil.example.com").into_bytes());
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn a_page_framed_by_another_site_cannot_use_the_fingerprint() {
    refused(|answer| answer.client_data_json = String::from_utf8_lossy(&answer.client_data_json).replace("false", "true").into_bytes());
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn a_passkey_for_another_website_is_refused() {
    refused(|answer| answer.authenticator_data[..32].copy_from_slice(&env::sha256_array(b"evil.example.com")));
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn a_touch_without_the_fingerprint_or_face_is_refused() {
    refused(|answer| answer.authenticator_data[32] = 0x01);
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn an_answer_to_another_challenge_is_refused() {
    refused(|answer| *answer = answer_for(&[9u8; 32]));
}

#[test]
#[should_panic(expected = "The passkey's signature is not valid")]
fn another_persons_passkey_is_refused() {
    let mut guard = with_passkey();
    as_device(START_MS + DAY_MS);
    let stranger = SigningKey::from_slice(&[8u8; 32]).unwrap();
    let (data, client, signature) = signed(&stranger, &answer_for(&guard.challenge_for(&PasskeyAction::Freeze)));
    guard.use_passkey(PasskeyAction::Freeze, data, client, signature);
}

#[test]
#[should_panic(expected = "Only the owner's device key can use the passkey")]
fn only_the_owners_device_can_send_it() {
    let mut guard = with_passkey();
    as_agent(START_MS + DAY_MS);
    let (data, client, signature) = signed(&phone(), &answer_for(&guard.challenge_for(&PasskeyAction::Freeze)));
    guard.use_passkey(PasskeyAction::Freeze, data, client, signature);
}
