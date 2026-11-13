//! Paying on Solana through NEAR Chain Signatures.

use super::*;
use crate::solana;

// A payment written by the demo agent's `paymentMessage` (examples/demo-agent/solana.mjs), whose
// layout x402.org's facilitator accepted on Solana devnet, signed by a test key (seed of 32 sevens).
const SOL_VAULT: &str = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
const SOL_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_PAY_TO: &str = "AzfdbWXPC3BiPJqaeHsGqzZw8NoxYSZkZMob1VNivGBo";
const SOL_FEE_PAYER: &str = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const SOL_SOURCE: &str = "8EiF91LJfbatqHRY3k2jp8dwrFY3yDQeEovpMDZnpJiP";
const SOL_DESTINATION: &str = "5kjvk6Y5ZQRjV8KWFojvv65ttuCRCarazPtRkQK9SiXa";
const SOL_BLOCKHASH: &str = "cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN";
const SOL_MEMO: &str = "00112233445566778899aabbccddeeff";
/// The same first and last four characters as `SOL_PAY_TO`: address poisoning.
const SOL_POISONED: &str = "AzfdbWXPC3BiPJqaeHsG1zZw8NoxYSZkZMob1VNivGBo";
const SOL_POISONED_DESTINATION: &str = "FwJCD9QQbKuvWUUUN9TEzLPCEDkDsr3vTxZaQys4FHTA";
const SOL_MESSAGE: &str = "8002010408a8263e36df542551d2b66f47c9dd55318a88115ddd0d42106f24eeb6d9950a7eea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c6b84fe54059990a6ea2308dc658855ad958a651e14572623f7fad393dbb013ec46a3427fb8c9a8d733e4cd71fb70e41f81c2f22097ae80b3d6c5b5a7a439a6993b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea706ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a90306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000054a535a992921064d24e87160da387c7c35b5ddbc92bb81e41fa8404105448d09090909090909090909090909090909090909090909090909090909090909090406000502204e00000600090301000000000000000504020403010a0cd00700000000000006070020303031313232333334343535363637373838393961616262636364646565666600";
const SOL_SIGNATURE: &str = "f8de294e5cca88973891eeddf5515c4dfac97d1f5a0b2e12b989a964d7f46e8a01dd5a08d246239a830885ea2d04313cccb36c4543e8bd9527b7d07e5ef06408";
/// 0.002 USDC, the Svalin API's price per call.
const SOL_PRICE: u128 = 2_000;

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
}

fn address(text: &str) -> solana::Address {
    solana::decode(text).unwrap()
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

/// Delivers a callback's answer: `Some(bytes)` as a success, `None` as a failure.
fn callback(ms: u64, result: Option<Vec<u8>>) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(ms * 1_000_000);
    let result = match result {
        Some(bytes) => near_sdk::PromiseResult::Successful(bytes),
        None => near_sdk::PromiseResult::Failed,
    };
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

/// A vault that pays on Solana, with its address loaded as the signing network would give it.
fn solana_vault() -> Guard {
    call(vault(), other_key(), 0, START_MS);
    let mut guard =
        Guard::new(owner(), token(), limits(50, 100, 5), Some(guardian()), Some(agent_key()), None, Some(false), None, None, Some(solana_settings()));
    callback(START_MS, Some(format!("\"ed25519:{SOL_VAULT}\"").into_bytes()));
    assert_eq!(guard.on_solana_address(), Some(SOL_VAULT.to_string()));
    guard
}

fn sol_transaction(destination: &str) -> SolanaTransaction {
    SolanaTransaction { fee_payer: SOL_FEE_PAYER.into(), recent_blockhash: SOL_BLOCKHASH.into(), source: SOL_SOURCE.into(), destination: destination.into() }
}

fn sol_purchase() -> Purchase {
    Purchase { service: "https://svalin-api.noobshole.workers.dev".into(), item: "/v1/risk/alice.near".into(), quote_expires_ms: None }
}

/// The agent asks to pay `amount` to `pay_to`; a payment that goes out answers with its signing id.
fn sol_pay(guard: &mut Guard, pay_to: &str, destination: &str, amount: u128, ms: u64) -> Result<u64, Decision> {
    as_agent(ms);
    let before: Vec<u64> = guard.signing.iter().map(|(id, _)| *id).collect();
    match guard.request_solana_payment(pay_to.into(), U128(amount), SOL_MEMO.into(), Some(sol_purchase()), sol_transaction(destination)) {
        PromiseOrValue::Value(answer) => Err(Decision { outcome: answer.outcome, reasons: answer.reasons, imitates: answer.imitates, held_id: answer.held_id }),
        PromiseOrValue::Promise(_) => Ok(guard.signing.iter().map(|(id, _)| *id).find(|id| !before.contains(id)).expect("a signing")),
    }
}

fn signature_answer(signature: &[u8]) -> Vec<u8> {
    format!("{{\"scheme\":\"Ed25519\",\"signature\":{signature:?}}}").into_bytes()
}

/// Pays `SOL_PAY_TO` once, signed, so it is a known payee.
fn paid_once(guard: &mut Guard) {
    let signing = sol_pay(guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS).expect("paid");
    callback(START_MS, Some(signature_answer(&unhex(SOL_SIGNATURE))));
    assert_eq!(guard.on_solana_signed(signing).outcome, Outcome::Paid);
}

#[test]
fn writes_the_payment_x402s_solana_client_writes() {
    let message = solana::message(&solana::Payment {
        fee_payer: &address(SOL_FEE_PAYER),
        authority: &address(SOL_VAULT),
        source: &address(SOL_SOURCE),
        destination: &address(SOL_DESTINATION),
        mint: &address(SOL_USDC),
        amount: 2000,
        decimals: 6,
        memo: SOL_MEMO,
        blockhash: &address(SOL_BLOCKHASH),
    });
    assert_eq!(hex(&message), SOL_MESSAGE);
}

#[test]
fn knows_a_wallets_token_account_and_no_other() {
    let (usdc, vault, pay_to) = (address(SOL_USDC), address(SOL_VAULT), address(SOL_PAY_TO));
    assert!(solana::is_token_account(&address(SOL_SOURCE), &vault, &usdc));
    assert!(solana::is_token_account(&address(SOL_DESTINATION), &pay_to, &usdc));
    assert!(!solana::is_token_account(&address(SOL_DESTINATION), &vault, &usdc));
    assert!(!solana::is_token_account(&pay_to, &pay_to, &usdc));
}

#[test]
fn pays_a_solana_seller_with_a_payment_the_signing_network_signed() {
    let mut guard = solana_vault();
    let signing = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS).expect("paid");
    assert_eq!(guard.status().spent_today, U128(SOL_PRICE));
    assert_eq!(hex(&guard.signing.get(&signing).unwrap().message), SOL_MESSAGE);

    callback(START_MS, Some(signature_answer(&unhex(SOL_SIGNATURE))));
    let answer = guard.on_solana_signed(signing);
    assert_eq!(answer.outcome, Outcome::Paid);
    let payment = answer.payment.expect("a signed payment");
    assert_eq!(payment.payer, SOL_VAULT);
    let wire = BASE64.decode(payment.transaction).unwrap();
    assert_eq!(wire[0], 2);
    assert_eq!(&wire[1..65], &[0u8; 64][..], "the fee payer's signature is left for the facilitator");
    assert_eq!(hex(&wire[65..129]), SOL_SIGNATURE);
    assert_eq!(hex(&wire[129..]), SOL_MESSAGE);
    assert_eq!(guard.payee(format!("solana:{SOL_PAY_TO}")).unwrap().payments, 1);
    assert_eq!(guard.terms(sol_purchase().service).unwrap().payee, format!("solana:{SOL_PAY_TO}"));
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"solana_signed\"")));
}

#[test]
fn a_signature_that_is_not_the_vaults_pays_nothing() {
    let mut guard = solana_vault();
    let signing = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS).expect("paid");
    let mut forged = unhex(SOL_SIGNATURE);
    forged[0] ^= 1;
    callback(START_MS, Some(signature_answer(&forged)));
    let answer = guard.on_solana_signed(signing);
    assert_eq!((answer.outcome, answer.reasons), (Outcome::Refused, vec![Reason::SigningFailed]));
    assert!(answer.payment.is_none());
    assert_eq!(guard.status().spent_today, U128(0));
    assert!(guard.payee(format!("solana:{SOL_PAY_TO}")).is_none());
    assert!(guard.terms(sol_purchase().service).is_none(), "the terms it locked are taken back");

    // No answer at all is no payment either, and the retry is not a second charge.
    let signing = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS).expect("paid again");
    callback(START_MS, None);
    assert_eq!(guard.on_solana_signed(signing).reasons, vec![Reason::SigningFailed]);
    assert_eq!(guard.status().spent_today, U128(0));
}

#[test]
fn refuses_a_poisoned_look_alike_of_a_solana_payee_it_paid_before() {
    let mut guard = solana_vault();
    paid_once(&mut guard);
    let refused = sol_pay(&mut guard, SOL_POISONED, SOL_POISONED_DESTINATION, SOL_PRICE, START_MS + HOUR_MS).expect_err("refused");
    assert_eq!((refused.outcome, refused.reasons), (Outcome::Refused, vec![Reason::ImitatesPastPayee]));
    assert_eq!(refused.imitates, Some(format!("solana:{SOL_PAY_TO}")));
    assert_eq!(guard.strikes.len(), 1);
}

#[test]
fn a_new_solana_payee_gets_the_small_limit() {
    let mut guard = solana_vault();
    let held = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS).expect_err("held");
    assert_eq!((held.outcome, held.reasons), (Outcome::Held, vec![Reason::NewPayeeOverLimit]));
    assert_eq!(guard.held_payments()[0].1.payee, format!("solana:{SOL_PAY_TO}"));
}

#[test]
fn a_solana_payee_is_never_sent_to_the_near_account_check() {
    call(vault(), other_key(), 0, START_MS);
    let mut guard = Guard::new(
        owner(),
        token(),
        limits(50, 100, 5),
        None,
        Some(agent_key()),
        None,
        Some(false),
        Some(checker()),
        None,
        Some(solana_settings()),
    );
    callback(START_MS, Some(format!("\"ed25519:{SOL_VAULT}\"").into_bytes()));
    guard.on_solana_address();
    assert!(sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS).is_ok());
    assert_eq!(guard.status().checks_today, 0);
}

#[test]
fn an_approved_solana_payment_is_paid_when_the_agent_asks_again_within_the_hour() {
    let mut guard = solana_vault();
    let held_id = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS).expect_err("held").held_id.unwrap();
    as_owner(START_MS + MINUTE_MS);
    guard.approve(held_id);
    assert!(guard.held_payments().is_empty());
    assert_eq!(guard.cleared_payments().len(), 1);
    assert_eq!(guard.status().spent_today, U128(0), "nothing is spent until it is paid");

    let signing = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS + 30 * MINUTE_MS).expect("paid as approved");
    assert!(guard.cleared_payments().is_empty());
    assert_eq!(guard.status().spent_today, U128(6 * USDC));
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"cleared_payment_collected\"")));
    assert!(guard.signing.get(&signing).is_some());

    // Only once: the same request again is decided like any other.
    let again = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS + 31 * MINUTE_MS).expect_err("held again");
    assert_eq!(again.outcome, Outcome::Held);
}

#[test]
fn an_approval_not_collected_within_the_hour_lapses() {
    let mut guard = solana_vault();
    let held_id = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS).expect_err("held").held_id.unwrap();
    as_owner(START_MS);
    guard.approve(held_id);
    let late = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS + 2 * HOUR_MS).expect_err("held");
    assert_eq!(late.outcome, Outcome::Held);
    // The owner can still drop the lapsed approval.
    as_owner(START_MS + 2 * HOUR_MS);
    guard.reject(held_id);
    assert!(guard.cleared_payments().is_empty());
}

#[test]
fn a_frozen_vault_pays_nothing_on_solana_not_even_an_approved_payment() {
    let mut guard = solana_vault();
    let held_id = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS).expect_err("held").held_id.unwrap();
    as_owner(START_MS);
    guard.approve(held_id);
    as_guardian(START_MS);
    guard.freeze();
    let refused = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS + MINUTE_MS).expect_err("refused");
    assert_eq!((refused.outcome, refused.reasons), (Outcome::Refused, vec![Reason::Frozen]));
}

#[test]
fn a_solana_seller_is_held_to_its_terms() {
    let mut guard = solana_vault();
    paid_once(&mut guard);
    as_agent(START_MS + HOUR_MS);
    let dearer = Purchase { item: "/v1/risk/bob.near".into(), ..sol_purchase() };
    let answer = guard.request_solana_payment(SOL_PAY_TO.into(), U128(10 * SOL_PRICE), SOL_MEMO.into(), Some(dearer), sol_transaction(SOL_DESTINATION));
    let PromiseOrValue::Value(answer) = answer else { panic!("not paid") };
    assert_eq!((answer.outcome, answer.reasons), (Outcome::Held, vec![Reason::PriceChanged]));
}

#[test]
#[should_panic(expected = "destination must be pay_to's token account for the mint")]
fn the_money_goes_only_to_the_payees_own_token_account() {
    let mut guard = solana_vault();
    // The poisoned address's token account, for a payment to the real payee.
    let _ = sol_pay(&mut guard, SOL_PAY_TO, SOL_POISONED_DESTINATION, SOL_PRICE, START_MS);
}

#[test]
#[should_panic(expected = "source must be the vault's own token account for the mint")]
fn the_money_comes_only_from_the_vaults_own_token_account() {
    let mut guard = solana_vault();
    as_agent(START_MS);
    let transaction = SolanaTransaction { source: SOL_DESTINATION.into(), ..sol_transaction(SOL_DESTINATION) };
    let _ = guard.request_solana_payment(SOL_PAY_TO.into(), U128(SOL_PRICE), SOL_MEMO.into(), None, transaction);
}

#[test]
#[should_panic(expected = "The fee payer must be the seller's facilitator")]
fn the_vault_never_pays_the_solana_fee() {
    let mut guard = solana_vault();
    as_agent(START_MS);
    let transaction = SolanaTransaction { fee_payer: SOL_VAULT.into(), ..sol_transaction(SOL_DESTINATION) };
    let _ = guard.request_solana_payment(SOL_PAY_TO.into(), U128(SOL_PRICE), SOL_MEMO.into(), None, transaction);
}

#[test]
fn the_vaults_own_solana_address_and_the_mint_are_not_payees() {
    let mut guard = solana_vault();
    for not_a_payee in [SOL_VAULT, SOL_USDC] {
        let refused = sol_pay(&mut guard, not_a_payee, SOL_DESTINATION, SOL_PRICE, START_MS).expect_err("refused");
        assert_eq!(refused.reasons, vec![Reason::NotAPayee]);
    }
}

#[test]
#[should_panic(expected = "Only the agent's key can request a payment")]
fn only_the_agent_asks_for_a_solana_payment() {
    let mut guard = solana_vault();
    as_owner(START_MS);
    let _ = guard.request_solana_payment(SOL_PAY_TO.into(), U128(SOL_PRICE), SOL_MEMO.into(), None, sol_transaction(SOL_DESTINATION));
}

#[test]
#[should_panic(expected = "The vault's Solana address is not loaded yet")]
fn pays_nothing_on_solana_before_its_address_is_known() {
    call(vault(), other_key(), 0, START_MS);
    let mut guard = Guard::new(owner(), token(), limits(50, 100, 5), None, Some(agent_key()), None, Some(false), None, None, Some(solana_settings()));
    let _ = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS);
}

#[test]
fn a_stored_solana_address_is_never_replaced_by_another_answer() {
    let mut guard = solana_vault();
    callback(START_MS, Some(format!("\"ed25519:{SOL_PAY_TO}\"").into_bytes()));
    assert_eq!(guard.on_solana_address(), Some(SOL_VAULT.to_string()));
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"solana_address_mismatch\"")));
    // An unreadable answer changes nothing either.
    callback(START_MS, None);
    assert_eq!(guard.on_solana_address(), Some(SOL_VAULT.to_string()));
}

#[test]
fn approvals_the_agent_never_collected_are_cleared_away() {
    let mut guard = solana_vault();
    let first = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 6 * USDC, START_MS).expect_err("held").held_id.unwrap();
    as_owner(START_MS);
    guard.approve(first);
    let second = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, 7 * USDC, START_MS + 2 * HOUR_MS).expect_err("held").held_id.unwrap();
    as_owner(START_MS + 2 * HOUR_MS);
    guard.approve(second);
    let ids: Vec<u64> = guard.cleared_payments().into_iter().map(|(id, _)| id).collect();
    assert_eq!(ids, vec![second], "the lapsed approval is gone");
}

#[test]
#[should_panic(expected = "This vault does not pay on Solana")]
fn a_vault_without_solana_settings_pays_nothing_there() {
    let mut guard = new_vault();
    let _ = sol_pay(&mut guard, SOL_PAY_TO, SOL_DESTINATION, SOL_PRICE, START_MS);
}

#[test]
#[should_panic(expected = "A Solana payee must be a Solana address")]
fn a_trusted_solana_payee_must_be_an_address() {
    let mut guard = solana_vault();
    as_owner(START_MS);
    guard.propose(Change::AddPayee { payee: "solana:not-an-address".into() });
}

#[test]
fn near_and_solana_payees_are_never_compared() {
    let mut guard = solana_vault();
    known(&mut guard, "shop.near");
    paid_once(&mut guard);
    // A NEAR payee whose name is the poisoned address in lower case is just a new NEAR payee.
    let near = pay(&mut guard, &SOL_POISONED.to_lowercase(), USDC);
    assert!(!near.reasons.contains(&Reason::ImitatesPastPayee), "{:?}", near.reasons);
}
