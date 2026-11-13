use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const USDC: u128 = 1_000_000;
const START_MS: u64 = 1_793_000_000_000;

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn vault() -> AccountId {
    id("guard.alice.near")
}
fn owner() -> AccountId {
    id("alice.near")
}
fn guardian() -> AccountId {
    id("bob.near")
}
fn token() -> AccountId {
    id("usdc.near")
}
fn agent_key() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}
fn other_key() -> PublicKey {
    "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap()
}
fn limits(per_payment: u128, daily: u128, new_payee: u128) -> Limits {
    Limits { per_payment: U128(per_payment * USDC), daily: U128(daily * USDC), new_payee: U128(new_payee * USDC) }
}

/// The blockchain context for one call: who calls, with which key, what is attached, and when.
fn call(predecessor: AccountId, key: PublicKey, yocto: u128, ms: u64) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(vault())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .signer_account_pk(key)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(ms * 1_000_000);
    testing_env!(context.build());
}
fn as_agent(ms: u64) {
    call(vault(), agent_key(), 0, ms);
}
fn as_owner(ms: u64) {
    call(owner(), other_key(), 1, ms);
}
fn as_guardian(ms: u64) {
    call(guardian(), other_key(), 1, ms);
}

fn new_vault() -> Guard {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(50, 100, 5), Some(guardian()), Some(agent_key()), None, Some(false), None, None, None)
}

/// Settles a transfer the vault made, as the token contract's answer would.
fn settle(guard: &mut Guard, payee: &str, amount: u128, ok: bool, ms: u64) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(ms * 1_000_000);
    let result = if ok { near_sdk::PromiseResult::Successful(vec![]) } else { near_sdk::PromiseResult::Failed };
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
    guard.on_transfer(id(payee), U128(amount * USDC), true, START_MS / DAY_MS, None, false);
}

/// A payee the vault has paid before.
fn known(guard: &mut Guard, payee: &str) {
    as_agent(START_MS);
    let decision = guard.request_payment(id(payee), U128(USDC), None, None);
    assert_eq!(decision.outcome, Outcome::Paid, "{payee}: {:?}", decision.reasons);
    settle(guard, payee, 1, true, START_MS);
}

fn pay(guard: &mut Guard, payee: &str, amount: u128) -> Decision {
    as_agent(START_MS);
    guard.request_payment(id(payee), U128(amount * USDC), None, None)
}

#[test]
fn pays_a_known_payee_up_to_the_limits_and_holds_the_rest() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    assert_eq!(pay(&mut guard, "shop.near", 40).outcome, Outcome::Paid);

    let over = pay(&mut guard, "shop.near", 51);
    assert_eq!(over.outcome, Outcome::Held);
    assert_eq!(over.reasons, vec![Reason::OverPaymentLimit]);

    // 1 + 40 + 45 spent; 20 more would pass the daily 100.
    assert_eq!(pay(&mut guard, "shop.near", 45).outcome, Outcome::Paid);
    let daily = pay(&mut guard, "shop.near", 20);
    assert_eq!(daily.reasons, vec![Reason::OverDailyLimit]);
    assert_eq!(guard.held_payments().len(), 2);
}

#[test]
fn gives_a_new_payee_only_the_small_limit() {
    let mut guard = new_vault();
    assert_eq!(pay(&mut guard, "newshop.near", 5).outcome, Outcome::Paid);
    let held = pay(&mut guard, "another-shop.near", 6);
    assert_eq!(held.outcome, Outcome::Held);
    assert_eq!(held.reasons, vec![Reason::NewPayeeOverLimit]);
}

#[test]
fn refuses_a_name_made_to_look_like_a_well_known_account() {
    let mut guard = new_vault();
    let decision = pay(&mut guard, "intent5.near", 1);
    assert_eq!(decision.outcome, Outcome::Refused);
    assert_eq!(decision.reasons, vec![Reason::ImitatesWellKnown]);
    assert_eq!(decision.imitates, Some("intents.near".to_string()));
    // The real one, and a name under the same private parent, are fine.
    assert_eq!(pay(&mut guard, "intents.near", 1).outcome, Outcome::Paid);
    assert_eq!(pay(&mut guard, "xtoken.rhealab.near", 1).outcome, Outcome::Paid);
}

#[test]
fn holds_a_name_one_letter_away_from_a_well_known_account() {
    let mut guard = new_vault();
    let decision = pay(&mut guard, "linear-protokol.near", 1);
    assert_eq!(decision.outcome, Outcome::Held);
    assert_eq!(decision.reasons, vec![Reason::ResemblesWellKnown]);
    assert_eq!(decision.imitates, Some("linear-protocol.near".to_string()));
}

#[test]
fn refuses_a_look_alike_of_a_payee_it_paid_before() {
    let mut guard = new_vault();
    known(&mut guard, "shop-pay.near");
    let copy = pay(&mut guard, "shoppay.near", 1);
    assert_eq!((copy.outcome, copy.reasons), (Outcome::Refused, vec![Reason::ImitatesPastPayee]));
    assert_eq!(copy.imitates, Some("shop-pay.near".to_string()));

    let near = pay(&mut guard, "shop-pays.near", 1);
    assert_eq!((near.outcome, near.reasons), (Outcome::Held, vec![Reason::ResemblesPastPayee]));

    // Address poisoning: same first and last four characters, different middle.
    let real = format!("abcd{}ef01", "0".repeat(56));
    let poisoned = format!("abcd{}ef01", "9".repeat(56));
    known(&mut guard, &real);
    let decision = pay(&mut guard, &poisoned, 1);
    assert_eq!(decision.reasons, vec![Reason::ImitatesPastPayee]);
}

#[test]
fn refuses_to_pay_itself_or_the_token_and_nothing_at_all() {
    let mut guard = new_vault();
    assert_eq!(pay(&mut guard, "guard.alice.near", 1).reasons, vec![Reason::NotAPayee]);
    assert_eq!(pay(&mut guard, "usdc.near", 1).reasons, vec![Reason::NotAPayee]);
    assert_eq!(pay(&mut guard, "shop.near", 0).reasons, vec![Reason::ZeroAmount]);
}

#[test]
#[should_panic(expected = "Only the agent's key can request a payment")]
fn only_the_agents_key_can_request() {
    let mut guard = new_vault();
    call(vault(), other_key(), 0, START_MS);
    guard.request_payment(id("shop.near"), U128(USDC), None, None);
}

#[test]
#[should_panic(expected = "Only the agent's key can request a payment")]
fn the_owner_cannot_use_the_agents_door() {
    let mut guard = new_vault();
    call(owner(), agent_key(), 0, START_MS);
    guard.request_payment(id("shop.near"), U128(USDC), None, None);
}

#[test]
#[should_panic(expected = "Only the owner or the guardian can do this")]
fn the_agent_cannot_approve_its_own_held_payment() {
    let mut guard = new_vault();
    pay(&mut guard, "newshop.near", 9);
    call(vault(), agent_key(), 1, START_MS);
    guard.approve(0);
}

#[test]
fn the_owner_approves_exactly_the_held_payment() {
    let mut guard = new_vault();
    let held = pay(&mut guard, "newshop.near", 9);
    as_owner(START_MS);
    guard.approve(held.held_id.unwrap());
    assert!(guard.held_payments().is_empty());
    assert_eq!(guard.status().spent_today, U128(9 * USDC));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn owner_actions_need_the_owners_full_access_key() {
    let mut guard = new_vault();
    pay(&mut guard, "newshop.near", 9);
    call(owner(), other_key(), 0, START_MS);
    guard.approve(0);
}

#[test]
fn making_it_safer_is_instant_and_riskier_waits() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.lower_limits(limits(20, 50, 2));
    assert_eq!(guard.status().limits, limits(20, 50, 2));

    let id = guard.propose(Change::RaiseLimits { limits: limits(500, 1000, 50) });
    as_owner(START_MS + DAY_MS - 1);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| guard.execute(id)));
    assert!(early.is_err(), "a raise must wait a day");
    as_owner(START_MS + DAY_MS);
    guard.execute(id);
    assert_eq!(guard.status().limits, limits(500, 1000, 50));
}

#[test]
#[should_panic(expected = "raising one is a change that waits")]
fn lowering_cannot_be_used_to_raise() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.lower_limits(limits(60, 100, 5));
}

#[test]
fn the_guardian_can_cancel_a_change_the_owners_key_proposed() {
    let mut guard = new_vault();
    as_owner(START_MS);
    let id = guard.propose(Change::Withdraw { to: id("thief.near"), amount: U128(100 * USDC) });
    as_guardian(START_MS + 1000);
    guard.cancel(id);
    assert!(guard.pending_changes().is_empty());
}

#[test]
fn freezing_stops_payments_and_pending_changes_but_not_a_recovery() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    as_owner(START_MS);
    guard.propose(Change::RaiseLimits { limits: limits(500, 1000, 50) });
    as_guardian(START_MS);
    let recovery = guard.propose(Change::Recover { new_owner: id("alice-new.near") });
    guard.freeze();

    assert_eq!(pay(&mut guard, "shop.near", 1).reasons, vec![Reason::Frozen]);
    let left: Vec<u64> = guard.pending_changes().into_iter().map(|(id, _)| id).collect();
    assert_eq!(left, vec![recovery]);
}

#[test]
#[should_panic(expected = "only unfreezing or a recovery can go ahead")]
fn a_frozen_vault_runs_no_other_change() {
    let mut guard = new_vault();
    as_guardian(START_MS);
    guard.freeze();
    as_owner(START_MS);
    let id = guard.propose(Change::AddPayee { payee: "shop.near".into() });
    as_owner(START_MS + DAY_MS);
    guard.execute(id);
}

#[test]
fn unfreezing_waits_like_any_riskier_change() {
    let mut guard = new_vault();
    as_guardian(START_MS);
    guard.freeze();
    as_owner(START_MS);
    let id = guard.propose(Change::Unfreeze);
    as_owner(START_MS + DAY_MS);
    guard.execute(id);
    assert!(!guard.status().frozen);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn the_guardian_cannot_move_money() {
    let mut guard = new_vault();
    as_guardian(START_MS);
    guard.propose(Change::Withdraw { to: guardian(), amount: U128(USDC) });
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn the_guardian_cannot_propose_anything_but_a_recovery() {
    let mut guard = new_vault();
    as_guardian(START_MS);
    guard.propose(Change::RaiseLimits { limits: limits(500, 1000, 50) });
}

#[test]
fn a_recovery_waits_seven_days_and_the_owner_can_stop_it() {
    let mut guard = new_vault();
    as_guardian(START_MS);
    let first = guard.propose(Change::Recover { new_owner: id("alice-new.near") });
    as_owner(START_MS + DAY_MS);
    guard.cancel(first);

    as_guardian(START_MS + DAY_MS);
    let second = guard.propose(Change::Recover { new_owner: id("alice-new.near") });
    as_guardian(START_MS + 7 * DAY_MS);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| guard.execute(second)));
    assert!(early.is_err(), "a recovery waits seven days from when it was proposed");
    as_guardian(START_MS + 8 * DAY_MS);
    guard.execute(second);
    let status = guard.status();
    assert_eq!(status.owner, id("alice-new.near"));
    assert_eq!(status.agent, None);
}

#[test]
fn a_failed_payment_gives_back_its_share_of_the_daily_limit() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    pay(&mut guard, "shop.near", 40);
    settle(&mut guard, "shop.near", 40, false, START_MS);
    assert_eq!(guard.status().spent_today, U128(USDC));
    assert_eq!(guard.payee("shop.near".into()).unwrap().payments, 1);
}

#[test]
fn a_new_day_starts_with_a_fresh_daily_limit() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    pay(&mut guard, "shop.near", 50);
    pay(&mut guard, "shop.near", 49);
    assert_eq!(pay(&mut guard, "shop.near", 10).reasons, vec![Reason::OverDailyLimit]);
    as_agent(START_MS + DAY_MS);
    assert_eq!(guard.request_payment(id("shop.near"), U128(10 * USDC), None, None).outcome, Outcome::Paid);
}

#[test]
fn check_previews_a_decision_without_changing_anything() {
    let mut guard = new_vault();
    call(id("anyone.near"), other_key(), 0, START_MS);
    let preview = guard.check("intent5.near".into(), U128(USDC), None);
    assert_eq!(preview.reasons, vec![Reason::ImitatesWellKnown]);
    assert_eq!(pay(&mut guard, "shop.near", 1).outcome, Outcome::Paid);
}

#[test]
fn locking_deletes_the_key_that_deployed_the_vault() {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(50, 100, 5), Some(guardian()), Some(agent_key()), None, None, None, None, None);
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|receipt| receipt.actions)
        .map(|action| format!("{action:?}"))
        .collect();
    assert!(actions.iter().any(|action| action.contains("AddKeyWithFunctionCall") && action.contains("\"request_payment\", \"request_buy\"")), "{actions:?}");
    assert!(actions.iter().any(|action| action.contains("DeleteKey")), "{actions:?}");
}

#[test]
#[should_panic(expected = "Limits must satisfy")]
fn limits_must_be_ordered() {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(5, 100, 50), None, None, None, Some(false), None, None, None);
}

#[test]
fn look_alike_rules_match_svalins_api() {
    let vectors: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!("../tests/vectors.json")).unwrap();
    let cases = vectors["cases"].as_array().unwrap();
    assert!(cases.len() >= 20);
    for case in cases {
        let (a, b) = (case["a"].as_str().unwrap(), case["b"].as_str().unwrap());
        assert_eq!(lookalike::skeleton(a), case["skeleton_a"].as_str().unwrap(), "skeleton of {a}");
        assert_eq!(lookalike::names_look_alike(a, b), case["names_look_alike"].as_bool().unwrap(), "{a} / {b}");
        assert_eq!(lookalike::names_nearly_alike(a, b), case["names_nearly_alike"].as_bool().unwrap(), "{a} ~ {b}");
        assert_eq!(lookalike::addresses_look_alike(a, b), case["addresses_look_alike"].as_bool().unwrap(), "{a} ends {b}");
    }
}

/* ------------------- second charges, the circuit breaker, checks ------------------- */

fn pay_at(guard: &mut Guard, payee: &str, amount: u128, ms: u64) -> Decision {
    as_agent(ms);
    guard.request_payment(id(payee), U128(amount * USDC), None, None)
}

fn checker() -> Checker {
    Checker { outlayer: id("outlayer.near"), wasm_url: "https://svalin.fastfs.io/checker.wasm".into(), wasm_hash: "a".repeat(64), min_age_ms: DAY_MS }
}

fn checked_vault() -> Guard {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(50, 100, 5), Some(guardian()), Some(agent_key()), None, Some(false), Some(checker()), None, None)
}

/// Delivers the check program's answer as OutLayer's callback would; `None` is a failed run.
fn answer(guard: &mut Guard, check_id: u64, report: Option<&str>, ms: u64) -> Decision {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(ms * 1_000_000);
    let result = match report {
        Some(json) => near_sdk::PromiseResult::Successful(json.as_bytes().to_vec()),
        None => near_sdk::PromiseResult::Failed,
    };
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    guard.on_check(check_id)
}

/// The function calls the last call made: receiver, method and attached yoctoNEAR.
fn calls_made() -> Vec<(String, String, u128)> {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            let to = receipt.receiver_id.to_string();
            receipt.actions.into_iter().filter_map(move |action| match action {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, attached_deposit, .. } => {
                    Some((to.clone(), String::from_utf8(method_name).unwrap(), attached_deposit.as_yoctonear()))
                }
                _ => None,
            })
        })
        .collect()
}

const OLD: &str = r#"{"exists":true,"contract":false,"age_ms":172800000}"#;

#[test]
fn holds_the_same_payee_and_amount_again_within_fifteen_minutes() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    let again = pay_at(&mut guard, "shop.near", 1, START_MS + MINUTE_MS);
    assert_eq!((again.outcome, again.reasons), (Outcome::Held, vec![Reason::PossibleDuplicate]));
    // Another amount is another purchase; the same amount later is too.
    assert_eq!(pay_at(&mut guard, "shop.near", 2, START_MS + MINUTE_MS).outcome, Outcome::Paid);
    assert_eq!(pay_at(&mut guard, "shop.near", 2, START_MS + 17 * MINUTE_MS).outcome, Outcome::Paid);
}

#[test]
fn a_payment_that_never_arrived_can_be_retried() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    pay(&mut guard, "shop.near", 3);
    settle(&mut guard, "shop.near", 3, false, START_MS);
    assert_eq!(pay(&mut guard, "shop.near", 3).outcome, Outcome::Paid);
}

#[test]
fn three_look_alikes_within_an_hour_freeze_the_vault() {
    let mut guard = new_vault();
    known(&mut guard, "shop-pay.near");
    pay(&mut guard, "intent5.near", 1);
    pay(&mut guard, "shoppay.near", 1);
    assert!(!guard.status().frozen);
    let third = pay(&mut guard, "in-tents.near", 1);
    assert_eq!(third.reasons, vec![Reason::ImitatesWellKnown]);
    assert!(guard.status().frozen);
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"auto_frozen\"")));
    assert_eq!(pay(&mut guard, "shop-pay.near", 1).reasons, vec![Reason::Frozen]);
}

#[test]
fn look_alikes_more_than_an_hour_apart_do_not_freeze() {
    let mut guard = new_vault();
    pay_at(&mut guard, "intent5.near", 1, START_MS);
    pay_at(&mut guard, "in-tents.near", 1, START_MS + MINUTE_MS);
    pay_at(&mut guard, "intent5.near", 1, START_MS + HOUR_MS + 2 * MINUTE_MS);
    assert!(!guard.status().frozen);
}

#[test]
fn other_refusals_are_not_strikes() {
    let mut guard = new_vault();
    for _ in 0..3 {
        pay(&mut guard, "shop.near", 0);
        pay(&mut guard, "usdc.near", 1);
    }
    assert!(!guard.status().frozen);
}

#[test]
fn unfreezing_starts_the_count_again() {
    let mut guard = new_vault();
    for name in ["intent5.near", "in-tents.near", "intent5.near"] {
        pay(&mut guard, name, 1);
    }
    assert!(guard.status().frozen);
    as_owner(START_MS);
    let change = guard.propose(Change::Unfreeze);
    call(id("anyone.near"), other_key(), 0, START_MS + DAY_MS);
    guard.execute(change);
    pay_at(&mut guard, "intent5.near", 1, START_MS + DAY_MS);
    assert!(!guard.status().frozen);
}

#[test]
fn a_new_payee_is_checked_in_a_tee_before_it_is_paid() {
    let mut guard = checked_vault();
    let decision = pay(&mut guard, "newshop.near", 2);
    assert_eq!(decision.outcome, Outcome::Checking);
    assert_eq!(
        calls_made(),
        vec![
            ("outlayer.near".to_string(), "request_execution".to_string(), CHECK_DEPOSIT.as_yoctonear()),
            ("guard.alice.near".to_string(), "on_check".to_string(), 0),
        ]
    );
    assert_eq!((guard.status().checks_today, guard.status().checking), (1, 1));
    assert_eq!(guard.status().spent_today, U128(0));

    let paid = answer(&mut guard, decision.held_id.unwrap(), Some(OLD), START_MS);
    assert_eq!(paid.outcome, Outcome::Paid);
    assert!(calls_made().iter().any(|(to, method, _)| to == "usdc.near" && method == "ft_transfer"));
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"payee_checked\"")));
    assert_eq!((guard.status().spent_today, guard.status().checking), (U128(2 * USDC), 0));
}

#[test]
fn the_check_holds_a_young_account_and_refuses_a_missing_one() {
    let mut guard = checked_vault();
    let young = pay(&mut guard, "fresh.near", 1).held_id.unwrap();
    let held = answer(&mut guard, young, Some(r#"{"exists":true,"contract":false,"age_ms":600000}"#), START_MS);
    assert_eq!((held.outcome, held.reasons), (Outcome::Held, vec![Reason::NewAccount]));
    assert_eq!(guard.held_payments().len(), 1);

    let missing = pay(&mut guard, "nobody.near", 1).held_id.unwrap();
    let refused = answer(&mut guard, missing, Some(r#"{"exists":false}"#), START_MS);
    assert_eq!((refused.outcome, refused.reasons), (Outcome::Refused, vec![Reason::PayeeMissing]));

    let keyless = pay(&mut guard, "keyless.near", 1).held_id.unwrap();
    let unknown = answer(&mut guard, keyless, Some(r#"{"exists":true,"contract":true,"age_ms":null}"#), START_MS);
    assert_eq!(unknown.reasons, vec![Reason::AgeUnknown]);
}

#[test]
fn an_unreadable_or_failed_check_holds_the_payment() {
    let mut guard = checked_vault();
    for report in [None, Some("null"), Some("not json"), Some(r#"{"error":"rpc unreachable","exists":false}"#)] {
        let check = pay(&mut guard, "newshop.near", 1).held_id.unwrap();
        let decision = answer(&mut guard, check, report, START_MS);
        assert_eq!((decision.outcome, decision.reasons), (Outcome::Held, vec![Reason::CheckFailed]), "{report:?}");
    }
}

#[test]
fn rules_run_again_when_the_check_comes_back() {
    let mut guard = checked_vault();
    let check = pay(&mut guard, "newshop.near", 1).held_id.unwrap();
    as_guardian(START_MS);
    guard.freeze();
    assert_eq!(answer(&mut guard, check, Some(OLD), START_MS).reasons, vec![Reason::Frozen]);
}

#[test]
fn a_known_payee_skips_the_check() {
    let mut guard = checked_vault();
    let check = pay(&mut guard, "shop.near", 1).held_id.unwrap();
    answer(&mut guard, check, Some(OLD), START_MS);
    settle(&mut guard, "shop.near", 1, true, START_MS);
    assert_eq!(pay(&mut guard, "shop.near", 3).outcome, Outcome::Paid);
    assert_eq!(guard.status().checks_today, 1);
}

#[test]
fn checks_are_capped_each_day() {
    let mut guard = checked_vault();
    for n in 0..MAX_CHECKS_PER_DAY {
        assert_eq!(pay(&mut guard, &format!("shop{n}.near"), 1).outcome, Outcome::Checking);
    }
    let over = pay(&mut guard, "one-more-shop.near", 1);
    assert_eq!((over.outcome, over.reasons), (Outcome::Held, vec![Reason::TooManyChecks]));
    assert_eq!(pay_at(&mut guard, "one-more-shop.near", 1, START_MS + DAY_MS).outcome, Outcome::Checking);
}

#[test]
fn check_previews_a_new_payee_as_checking() {
    let guard = checked_vault();
    call(id("anyone.near"), other_key(), 0, START_MS);
    assert_eq!(guard.check("newshop.near".into(), U128(USDC), None).outcome, Outcome::Checking);
    assert_eq!(guard.check("intent5.near".into(), U128(USDC), None).outcome, Outcome::Refused);
}

#[test]
fn changing_the_check_program_waits() {
    let mut guard = checked_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::SetChecker { checker: None });
    call(id("anyone.near"), other_key(), 0, START_MS + HOUR_MS);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| guard.execute(change))).is_err());
    call(id("anyone.near"), other_key(), 0, START_MS + DAY_MS);
    guard.execute(change);
    assert_eq!(guard.status().checker, None);
}

#[test]
#[should_panic(expected = "wasm_hash must be")]
fn the_check_program_is_pinned_by_its_hash() {
    call(vault(), other_key(), 0, START_MS);
    let bad = Checker { wasm_hash: "not-a-hash".into(), ..checker() };
    Guard::new(owner(), token(), limits(50, 100, 5), None, None, None, Some(false), Some(bad), None, None);
}

#[test]
fn every_payment_event_names_the_agent_key() {
    let mut guard = new_vault();
    pay(&mut guard, "shop.near", 1);
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|log| log.contains("\"payment_sent\"") && log.contains("6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp")), "{logs:?}");
}

/* ------------------- two-person approval, stale holds, the agent's gas ------------------- */

#[test]
fn a_large_payment_needs_the_owner_and_the_guardian() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    // Over the 50 USDC per-payment limit.
    let held = pay(&mut guard, "shop.near", 60).held_id.unwrap();
    as_owner(START_MS);
    guard.approve(held);
    assert_eq!(guard.held_payments().len(), 1, "the owner alone does not pay it");
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"approval_recorded\"")));
    as_guardian(START_MS);
    guard.approve(held);
    assert!(guard.held_payments().is_empty());
    assert!(calls_made().iter().any(|(to, method, _)| to == "usdc.near" && method == "ft_transfer"));
    assert_eq!(guard.status().spent_today, U128(61 * USDC));
}

#[test]
fn either_may_approve_first_but_nobody_twice() {
    let mut guard = new_vault();
    known(&mut guard, "shop.near");
    let held = pay(&mut guard, "shop.near", 60).held_id.unwrap();
    as_guardian(START_MS);
    guard.approve(held);
    as_guardian(START_MS);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| guard.approve(held))).is_err());
    assert_eq!(guard.held_payments().len(), 1);
    as_owner(START_MS);
    guard.approve(held);
    assert!(guard.held_payments().is_empty());
}

#[test]
#[should_panic(expected = "Only the owner approves a payment within the limits")]
fn the_guardian_cannot_approve_a_small_payment_alone() {
    let mut guard = new_vault();
    let held = pay(&mut guard, "newshop.near", 9).held_id.unwrap();
    as_guardian(START_MS);
    guard.approve(held);
}

#[test]
fn without_a_guardian_the_owner_approves_alone() {
    call(vault(), other_key(), 0, START_MS);
    let mut guard = Guard::new(owner(), token(), limits(50, 100, 5), None, Some(agent_key()), None, Some(false), None, None, None);
    known(&mut guard, "shop.near");
    let held = pay(&mut guard, "shop.near", 60).held_id.unwrap();
    as_owner(START_MS);
    guard.approve(held);
    assert!(guard.held_payments().is_empty());
}

#[test]
#[should_panic(expected = "held more than 7 days ago")]
fn a_payment_held_over_a_week_cannot_be_approved() {
    let mut guard = new_vault();
    let held = pay(&mut guard, "newshop.near", 9).held_id.unwrap();
    as_owner(START_MS + 8 * DAY_MS);
    guard.approve(held);
}

#[test]
fn the_guardian_can_reject_a_held_payment() {
    let mut guard = new_vault();
    let held = pay(&mut guard, "newshop.near", 9).held_id.unwrap();
    as_guardian(START_MS);
    guard.reject(held);
    assert!(guard.held_payments().is_empty());
}

#[test]
fn the_owner_tops_up_the_agents_gas_at_once() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.top_up_agent();
    let actions: Vec<String> =
        near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|receipt| receipt.actions).map(|action| format!("{action:?}")).collect();
    let deleted = actions.iter().position(|action| action.contains("DeleteKey")).expect("the old key is deleted");
    let added = actions.iter().position(|action| action.contains("AddKeyWithFunctionCall") && action.contains("request_payment")).expect("the key is added back");
    assert!(deleted < added, "{actions:?}");
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_tops_up_the_agent() {
    let mut guard = new_vault();
    as_guardian(START_MS);
    guard.top_up_agent();
}

/* ------------------------------- buying ------------------------------- */

/// START_MS falls on 2026-10-26 (UTC).
const TODAY: &str = "2026-10-26";

fn buying() -> Buying {
    Buying {
        registry: id("ratings.near"),
        methodology: "near-token-backing-v1".into(),
        min_grade: "D".into(),
        max_age_days: 2,
        market: id("market.near"),
        fee_bps: 10,
        fee_account: id("svalin.near"),
        pools: vec![
            Pool { token: id("hoot.near"), pool_id: 7, min_out_per_million: U128(2_000) },
            Pool { token: id("a.alphaai.near"), pool_id: 7, min_out_per_million: U128(1) },
        ],
        market_returns_tokens: false,
    }
}

fn buying_vault() -> Guard {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(50, 100, 5), Some(guardian()), Some(agent_key()), None, Some(false), None, Some(buying()), None)
}

fn graded(grade: &str, day: &str) -> GradeProof {
    GradeProof { day: day.into(), grade: grade.into(), backing_usd: 61_089, proof: vec![ProofStep { hash: "0".repeat(64), left: true }] }
}

fn buy(guard: &mut Guard, token: &str, amount: u128, grade: GradeProof) -> Decision {
    as_agent(START_MS);
    guard.request_buy(id(token), U128(amount * USDC), 7, U128(1), grade)
}

/// Delivers the registry's `verify` answer as its callback would; `None` is a failed call.
fn registry_answer(guard: &mut Guard, buy_id: u64, answer: Option<&str>) -> Decision {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(START_MS * 1_000_000);
    let result = match answer {
        Some(json) => near_sdk::PromiseResult::Successful(json.as_bytes().to_vec()),
        None => near_sdk::PromiseResult::Failed,
    };
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    guard.on_grade(buy_id)
}

/// Delivers the token's answer to the market call: how much the market used.
fn market_answer(guard: &mut Guard, sent: u128, fee: u128, used: Option<u128>) -> U128 {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(START_MS * 1_000_000);
    let result = match used {
        Some(used) => near_sdk::PromiseResult::Successful(format!("\"{used}\"").into_bytes()),
        None => near_sdk::PromiseResult::Failed,
    };
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    guard.on_buy(id("hoot.near"), U128(sent), U128(fee), id("svalin.near"), START_MS / DAY_MS)
}

const CONFIRMED: &str = r#"{"valid":true,"problem":null,"leaf":"x","methodology":"near-token-backing-v1"}"#;

#[test]
fn buys_nothing_until_the_owner_sets_buying_rules() {
    let mut guard = new_vault();
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("C", TODAY)).reasons, vec![Reason::BuyingOff]);
    assert!(calls_made().is_empty());
}

#[test]
fn refuses_a_grade_below_the_minimum_or_an_old_edition_without_asking_the_registry() {
    let mut guard = buying_vault();
    assert_eq!(buy(&mut guard, "junk.near", 1, graded("F", TODAY)).reasons, vec![Reason::GradeTooLow]);
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("C", "2026-10-23")).reasons, vec![Reason::StaleProof]);
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("C", "2026-10-27")).reasons, vec![Reason::BadProof]);
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("A+", TODAY)).reasons, vec![Reason::BadProof]);
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("C", "2026-13-01")).reasons, vec![Reason::BadProof]);
    assert_eq!(buy(&mut guard, "usdc.near", 1, graded("C", TODAY)).reasons, vec![Reason::NotAPayee]);
    assert_eq!(buy(&mut guard, "hoot.near", 51, graded("C", TODAY)).reasons, vec![Reason::OverPaymentLimit]);
    assert!(calls_made().is_empty());
    // An edition from two days ago is still fresh enough.
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("C", "2026-10-24")).outcome, Outcome::Checking);
}

#[test]
fn buys_a_confirmed_grade_on_the_owners_market_and_pays_the_fee_on_what_was_used() {
    let mut guard = buying_vault();
    let checking = buy(&mut guard, "hoot.near", 10, graded("C", TODAY));
    assert_eq!(checking.outcome, Outcome::Checking);
    let asked: Vec<(String, String)> = calls_made().into_iter().map(|(to, method, _)| (to, method)).collect();
    assert_eq!(asked, vec![("ratings.near".to_string(), "verify".to_string()), ("guard.alice.near".to_string(), "on_grade".to_string())]);

    let bought = registry_answer(&mut guard, checking.held_id.unwrap(), Some(CONFIRMED));
    assert_eq!(bought.outcome, Outcome::Paid);
    // 0.1% of 10 USDC is kept back for the fee; the market gets the rest, with a swap into HOOT only.
    let (to, method, args) = &calls_with_args()[0];
    assert_eq!((to.as_str(), method.as_str()), ("usdc.near", "ft_transfer_call"));
    let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(args).unwrap();
    assert_eq!((args["receiver_id"].as_str(), args["amount"].as_str()), (Some("market.near"), Some("9990000")));
    let swap: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(args["msg"].as_str().unwrap()).unwrap();
    assert_eq!(swap["actions"][0]["token_in"], "usdc.near");
    assert_eq!(swap["actions"][0]["token_out"], "hoot.near");
    assert_eq!(guard.status().spent_today, U128(10 * USDC));

    // The market used everything: the fee is paid, nothing comes back.
    assert_eq!(market_answer(&mut guard, 9_990_000, 10_000, Some(9_990_000)), U128(9_990_000));
    let (to, method, args) = &calls_with_args()[0];
    assert_eq!((to.as_str(), method.as_str()), ("usdc.near", "ft_transfer"));
    assert!(args.contains(r#""receiver_id":"svalin.near","amount":"10000""#), "{args}");
    assert_eq!(guard.status().spent_today, U128(10 * USDC));

    // The same buy again within 10 minutes is refused as a possible duplicate.
    assert_eq!(buy(&mut guard, "hoot.near", 10, graded("C", TODAY)).reasons, vec![Reason::PossibleDuplicate]);
}

#[test]
fn pays_no_fee_and_gives_the_limit_back_when_the_market_takes_nothing() {
    let mut guard = buying_vault();
    let checking = buy(&mut guard, "hoot.near", 10, graded("C", TODAY));
    registry_answer(&mut guard, checking.held_id.unwrap(), Some(CONFIRMED));
    assert_eq!(market_answer(&mut guard, 9_990_000, 10_000, Some(0)), U128(0));
    assert!(calls_made().is_empty(), "no fee without a buy");
    assert_eq!(guard.status().spent_today, U128(0));
    // A failed market call counts the same as one that used nothing, and the buy can be retried.
    let again = buy(&mut guard, "hoot.near", 10, graded("C", TODAY));
    registry_answer(&mut guard, again.held_id.unwrap(), Some(CONFIRMED));
    market_answer(&mut guard, 9_990_000, 10_000, None);
    assert_eq!(guard.status().spent_today, U128(0));
}

#[test]
fn refuses_what_the_registry_does_not_confirm_and_never_guesses() {
    let mut guard = buying_vault();
    let mut answer = |reply: Option<&str>| {
        let checking = buy(&mut guard, "hoot.near", 1, graded("C", TODAY));
        registry_answer(&mut guard, checking.held_id.unwrap(), reply).reasons
    };
    assert_eq!(answer(Some(r#"{"valid":false,"problem":"IN_CHALLENGE_WINDOW","methodology":"near-token-backing-v1"}"#)), vec![Reason::NoUsableEdition]);
    assert_eq!(answer(Some(r#"{"valid":false,"problem":"NO_SUCH_EDITION"}"#)), vec![Reason::NoUsableEdition]);
    assert_eq!(answer(Some(r#"{"valid":true,"methodology":"near-token-backing-v0"}"#)), vec![Reason::WrongMethodology]);
    assert_eq!(answer(Some("not json")), vec![Reason::CheckFailed]);
    assert_eq!(answer(None), vec![Reason::CheckFailed]);
    assert_eq!(guard.status().spent_today, U128(0));
    assert!(!guard.status().frozen);
}

#[test]
fn three_forged_grades_in_an_hour_freeze_the_vault() {
    let mut guard = buying_vault();
    let forged = r#"{"valid":false,"problem":"BAD_PROOF","leaf":"x","methodology":"near-token-backing-v1"}"#;
    for _ in 0..3 {
        let checking = buy(&mut guard, "a.alphaai.near", 1, graded("A", TODAY));
        assert_eq!(registry_answer(&mut guard, checking.held_id.unwrap(), Some(forged)).reasons, vec![Reason::BadProof]);
    }
    assert!(guard.status().frozen);
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"auto_frozen\"")));
    assert_eq!(buy(&mut guard, "hoot.near", 1, graded("C", TODAY)).reasons, vec![Reason::Frozen]);
}

#[test]
fn checks_every_rule_again_when_the_registry_answers() {
    let mut guard = buying_vault();
    let checking = buy(&mut guard, "hoot.near", 1, graded("C", TODAY));
    as_guardian(START_MS);
    guard.freeze();
    assert_eq!(registry_answer(&mut guard, checking.held_id.unwrap(), Some(CONFIRMED)).reasons, vec![Reason::Frozen]);
}

#[test]
fn changing_the_buying_rules_waits() {
    let mut guard = buying_vault();
    as_owner(START_MS);
    let lower = Buying { min_grade: "F".into(), ..buying() };
    let change = guard.propose(Change::SetBuying { buying: Some(lower.clone()) });
    as_owner(START_MS + DAY_MS);
    guard.execute(change);
    assert_eq!(guard.status().buying, Some(lower));
}

#[test]
#[should_panic(expected = "This change is still waiting")]
fn lowering_the_minimum_grade_cannot_happen_at_once() {
    let mut guard = buying_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::SetBuying { buying: Some(Buying { min_grade: "F".into(), ..buying() }) });
    guard.execute(change);
}

#[test]
#[should_panic(expected = "fee_bps can be at most 100 (1%)")]
fn a_fee_above_one_percent_is_refused() {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(50, 100, 5), None, None, None, Some(false), None, Some(Buying { fee_bps: 101, ..buying() }), None);
}

fn buy_in(guard: &mut Guard, token: &str, pool_id: u64, min_out: u128) -> Decision {
    as_agent(START_MS);
    guard.request_buy(id(token), U128(USDC), pool_id, U128(min_out), graded("C", TODAY))
}

/// The swap the vault wrote for the market, from the calls of the last step.
fn swap_sent() -> near_sdk::serde_json::Value {
    let (_, method, args) = calls_with_args().into_iter().next().unwrap();
    assert_eq!(method, "ft_transfer_call");
    let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&args).unwrap();
    near_sdk::serde_json::from_str(args["msg"].as_str().unwrap()).unwrap()
}

#[test]
fn buys_only_in_a_pool_the_owner_approved_for_that_token() {
    let mut guard = buying_vault();
    // A pool an attacker made for the right token.
    assert_eq!(buy_in(&mut guard, "hoot.near", 8, 1).reasons, vec![Reason::PoolNotApproved]);
    assert!(calls_made().is_empty());
    // An approved pool, named for a token it was not approved for.
    assert_eq!(buy_in(&mut guard, "other.near", 7, 1).reasons, vec![Reason::PoolNotApproved]);
    assert!(calls_made().is_empty());
    assert_eq!(buy_in(&mut guard, "hoot.near", 7, 1).outcome, Outcome::Checking);
}

#[test]
fn checks_the_pool_again_when_the_registry_answers() {
    let mut guard = buying_vault();
    let checking = buy_in(&mut guard, "hoot.near", 7, 1);
    guard.buying = Some(Buying { pools: vec![], ..buying() });
    assert_eq!(registry_answer(&mut guard, checking.held_id.unwrap(), Some(CONFIRMED)).reasons, vec![Reason::PoolNotApproved]);
    assert_eq!(guard.status().spent_today, U128(0));
}

#[test]
fn an_agent_cannot_accept_less_than_the_owners_worst_price() {
    let mut guard = buying_vault();
    let checking = buy_in(&mut guard, "hoot.near", 7, 1);
    registry_answer(&mut guard, checking.held_id.unwrap(), Some(CONFIRMED));
    // 1 USDC less the 0.1% fee is 999,000 units; at 2,000 per million that is 1,998.
    assert_eq!(swap_sent()["actions"][0]["min_amount_out"], "1998");
}

#[test]
fn an_agent_can_ask_for_a_better_price_than_the_owners_worst() {
    let mut guard = buying_vault();
    let checking = buy_in(&mut guard, "hoot.near", 7, 5_000);
    registry_answer(&mut guard, checking.held_id.unwrap(), Some(CONFIRMED));
    assert_eq!(swap_sent()["actions"][0]["min_amount_out"], "5000");
}

#[test]
fn the_worst_price_rounds_up_and_never_wraps() {
    assert_eq!(floor_out(999_000, 2_000), 1_998);
    assert_eq!(floor_out(1, 1), 1);
    assert_eq!(floor_out(1_500_000, 3), 5);
    assert_eq!(floor_out(u128::MAX, u128::MAX), u128::MAX);
}

#[test]
#[should_panic(expected = "A vault can approve at most 32 pools")]
fn the_pool_list_is_capped() {
    call(vault(), other_key(), 0, START_MS);
    let pools = (0..33).map(|pool_id| Pool { token: id("hoot.near"), pool_id, min_out_per_million: U128(1) }).collect();
    Guard::new(owner(), token(), limits(50, 100, 5), None, None, None, Some(false), None, Some(Buying { pools, ..buying() }), None);
}

#[test]
#[should_panic(expected = "Each pool needs a worst price above zero")]
fn a_pool_needs_a_worst_price() {
    call(vault(), other_key(), 0, START_MS);
    let pools = vec![Pool { token: id("hoot.near"), pool_id: 7, min_out_per_million: U128(0) }];
    Guard::new(owner(), token(), limits(50, 100, 5), None, None, None, Some(false), None, Some(Buying { pools, ..buying() }), None);
}

#[test]
#[should_panic(expected = "This change is still waiting")]
fn approving_another_pool_waits() {
    let mut guard = buying_vault();
    as_owner(START_MS);
    let pools = vec![Pool { token: id("hoot.near"), pool_id: 8, min_out_per_million: U128(1) }];
    let change = guard.propose(Change::SetBuying { buying: Some(Buying { pools, ..buying() }) });
    guard.execute(change);
}

fn real_market_vault() -> Guard {
    call(vault(), other_key(), 0, START_MS);
    Guard::new(
        owner(),
        token(),
        limits(50, 100, 5),
        Some(guardian()),
        Some(agent_key()),
        None,
        Some(false),
        None,
        Some(Buying { market_returns_tokens: true, ..buying() }),
        None,
    )
}

/// Delivers the token's `storage_deposit` answer as its callback would.
fn token_answer(guard: &mut Guard, buy_id: u64, ok: bool) -> Decision {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(START_MS * 1_000_000);
    let result = if ok { near_sdk::PromiseResult::Successful(br#"{"total":"1250000000000000000000","available":"0"}"#.to_vec()) } else { near_sdk::PromiseResult::Failed };
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    guard.on_registered(buy_id)
}

#[test]
fn registers_with_the_token_before_a_real_market_is_paid() {
    let mut guard = real_market_vault();
    let checking = buy(&mut guard, "hoot.near", 10, graded("C", TODAY));
    let buy_id = checking.held_id.unwrap();
    assert_eq!(registry_answer(&mut guard, buy_id, Some(CONFIRMED)).outcome, Outcome::Checking);
    let asked: Vec<(String, String)> = calls_made().into_iter().map(|(to, method, _)| (to, method)).collect();
    assert_eq!(asked, vec![("hoot.near".to_string(), "storage_deposit".to_string()), ("guard.alice.near".to_string(), "on_registered".to_string())]);
    assert_eq!(guard.status().spent_today, U128(0), "nothing is spent until the token has answered");

    assert_eq!(token_answer(&mut guard, buy_id, true).outcome, Outcome::Paid);
    assert_eq!(swap_sent()["actions"][0]["token_out"], "hoot.near");
    assert_eq!(guard.status().spent_today, U128(10 * USDC));
}

#[test]
fn a_token_that_will_not_register_the_vault_is_not_bought() {
    let mut guard = real_market_vault();
    let checking = buy(&mut guard, "hoot.near", 10, graded("C", TODAY));
    let buy_id = checking.held_id.unwrap();
    registry_answer(&mut guard, buy_id, Some(CONFIRMED));
    assert_eq!(token_answer(&mut guard, buy_id, false).reasons, vec![Reason::TokenNotReady]);
    assert!(calls_made().is_empty());
    assert_eq!(guard.status().spent_today, U128(0));
}

#[test]
fn checks_every_rule_again_after_the_token_has_answered() {
    let mut guard = real_market_vault();
    let checking = buy(&mut guard, "hoot.near", 10, graded("C", TODAY));
    let buy_id = checking.held_id.unwrap();
    registry_answer(&mut guard, buy_id, Some(CONFIRMED));
    as_guardian(START_MS);
    guard.freeze();
    assert_eq!(token_answer(&mut guard, buy_id, true).reasons, vec![Reason::Frozen]);
    assert!(calls_made().is_empty());
    assert_eq!(guard.status().spent_today, U128(0));
}

#[test]
fn the_owner_can_take_a_bought_token_out_after_the_wait() {
    let mut guard = buying_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::WithdrawToken { token: id("hoot.near"), to: owner(), amount: U128(5) });
    as_owner(START_MS + DAY_MS);
    guard.execute(change);
    let (to, method, args) = &calls_with_args()[0];
    assert_eq!((to.as_str(), method.as_str()), ("hoot.near", "ft_transfer"));
    assert!(args.contains(&format!(r#""receiver_id":"{}","amount":"5""#, owner())), "{args}");
    assert_eq!(guard.status().spent_today, U128(0), "a withdrawal is not spending");
}

#[test]
#[should_panic(expected = "This change is still waiting")]
fn taking_a_bought_token_out_waits() {
    let mut guard = buying_vault();
    as_owner(START_MS);
    let change = guard.propose(Change::WithdrawToken { token: id("hoot.near"), to: owner(), amount: U128(5) });
    guard.execute(change);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_can_start_taking_a_bought_token_out() {
    let mut guard = buying_vault();
    as_guardian(START_MS);
    guard.propose(Change::WithdrawToken { token: id("hoot.near"), to: guardian(), amount: U128(5) });
}

#[test]
#[should_panic(expected = "Only the vault's own account can set it up")]
fn a_stranger_cannot_set_up_a_vault_that_was_deployed_but_not_set_up() {
    call(id("stranger.near"), other_key(), 0, START_MS);
    Guard::new(owner(), token(), limits(50, 100, 5), None, None, None, Some(false), None, None, None);
}

#[test]
fn reads_edition_days() {
    assert_eq!(day_number("1970-01-01"), Some(0));
    assert_eq!(day_number("2000-03-01"), Some(11_017));
    assert_eq!(day_number("2026-11-04"), Some(20_761));
    assert_eq!(day_number(TODAY), Some(START_MS / DAY_MS));
    for bad in ["2026-02-29", "2026-1-04", "26-11-04xx", "2026-11-31", "abcd-ef-gh", "1969-12-31"] {
        assert_eq!(day_number(bad), None, "{bad}");
    }
}

/// The page that creates a vault sends `new` the test network's settings, read from the same file
/// as here, with the owner's own choices beside them, in this shape.
#[test]
fn sets_up_a_vault_from_what_the_create_page_sends() {
    use near_sdk::serde_json::{from_str, from_value, json, Value};
    let mut sent: Value = from_str(include_str!("../../../dashboard/testnet.json")).unwrap();
    let choices = json!({
        "owner": "alice.near",
        "limits": { "per_payment": "1000000", "daily": "3000000", "new_payee": "250000" },
        "guardian": "bob.near",
        "agent": "ed25519:49tbrHWCkxc2EimXEVjX4KCGRK8bzX4U2MZ6oN3axk2V",
        "delays": { "loosen_ms": 3_600_000, "recovery_ms": 604_800_000 },
        "lock": true,
    });
    sent.as_object_mut().unwrap().extend(choices.as_object().unwrap().clone());
    let field = |name: &str| sent[name].clone();

    call(vault(), other_key(), 0, START_MS);
    let guard = Guard::new(
        from_value(field("owner")).unwrap(),
        from_value(field("token")).unwrap(),
        from_value(field("limits")).unwrap(),
        from_value(field("guardian")).unwrap(),
        from_value(field("agent")).unwrap(),
        from_value(field("delays")).unwrap(),
        from_value(field("lock")).unwrap(),
        from_value(field("checker")).unwrap(),
        from_value(field("buying")).unwrap(),
        from_value(field("solana")).unwrap(),
    );
    let status = guard.status();
    assert_eq!((status.owner, status.guardian), (id("alice.near"), Some(id("bob.near"))));
    assert_eq!(status.limits, Limits { per_payment: U128(1_000_000), daily: U128(3_000_000), new_payee: U128(250_000) });
    assert_eq!(status.delays.loosen_ms, HOUR_MS);
    assert!(status.agent.is_some() && status.checker.is_some() && status.solana.is_some());
    let buying = status.buying.unwrap();
    assert_eq!((buying.pools.len(), buying.market_returns_tokens), (2, false));
    assert_eq!(status.version, "0.2.0");
    // Setting up asked to delete the key that signed it.
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|receipt| receipt.actions).map(|action| format!("{action:?}")).collect();
    assert!(actions.iter().any(|action| action.contains("DeleteKey")), "{actions:?}");
}

#[test]
#[should_panic(expected = "A pool can be listed once")]
fn a_pool_cannot_be_listed_twice() {
    call(vault(), other_key(), 0, START_MS);
    let pools = vec![
        Pool { token: id("hoot.near"), pool_id: 7, min_out_per_million: U128(2_000) },
        Pool { token: id("hoot.near"), pool_id: 7, min_out_per_million: U128(1) },
    ];
    Guard::new(owner(), token(), limits(50, 100, 5), None, None, None, Some(false), None, Some(Buying { pools, ..buying() }), None);
}

/// The function calls the last call made, with their JSON arguments.
fn calls_with_args() -> Vec<(String, String, String)> {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            let to = receipt.receiver_id.to_string();
            receipt.actions.into_iter().filter_map(move |action| match action {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. } => {
                    Some((to.clone(), String::from_utf8(method_name).unwrap(), String::from_utf8(args).unwrap()))
                }
                _ => None,
            })
        })
        .collect()
}

/* ----------------------------- locked service terms ----------------------------- */

const DATA: &str = "https://data.example";
const CENT: u128 = USDC / 100;

fn purchase(item: &str) -> Purchase {
    Purchase { service: DATA.into(), item: item.into(), quote_expires_ms: None }
}

/// The agent pays `cents` to `payee` for `item` from the data service.
fn buy_item(guard: &mut Guard, payee: &str, cents: u128, purchase: Purchase, ms: u64) -> Decision {
    as_agent(ms);
    guard.request_payment(id(payee), U128(cents * CENT), None, Some(purchase))
}

/// Settles a purchase's transfer, as the token contract's answer would.
fn settle_purchase(guard: &mut Guard, payee: &str, cents: u128, purchase: Purchase, locked: bool, ok: bool) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(vault()).predecessor_account_id(vault()).block_timestamp(START_MS * 1_000_000);
    let result = if ok { near_sdk::PromiseResult::Successful(vec![]) } else { near_sdk::PromiseResult::Failed };
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    guard.on_transfer(id(payee), U128(cents * CENT), true, START_MS / DAY_MS, Some(purchase), locked);
}

fn data_terms(price_cents: u128) -> Terms {
    Terms { payee: "data.near".into(), price: U128(price_cents * CENT) }
}

#[test]
fn the_first_payment_locks_a_services_terms() {
    let mut guard = new_vault();
    assert_eq!(buy_item(&mut guard, "data.near", 5, purchase("/prices?day=1"), START_MS).outcome, Outcome::Paid);
    let terms = guard.terms(DATA.into()).expect("locked");
    assert_eq!((terms.payee, terms.price, terms.by_owner), ("data.near".to_string(), U128(5 * CENT), false));
    settle_purchase(&mut guard, "data.near", 5, purchase("/prices?day=1"), true, true);

    // The same price for another item, or less, is paid: a service paid per call is paid again and again.
    assert_eq!(buy_item(&mut guard, "data.near", 5, purchase("/prices?day=2"), START_MS).outcome, Outcome::Paid);
    assert_eq!(buy_item(&mut guard, "data.near", 3, purchase("/prices?day=3"), START_MS).outcome, Outcome::Paid);
    assert_eq!(guard.status().services, 1);
}

#[test]
fn a_higher_price_or_another_payee_is_held() {
    let mut guard = new_vault();
    buy_item(&mut guard, "data.near", 5, purchase("/prices?day=1"), START_MS);
    settle_purchase(&mut guard, "data.near", 5, purchase("/prices?day=1"), true, true);

    let dearer = buy_item(&mut guard, "data.near", 50, purchase("/prices?day=2"), START_MS);
    assert_eq!((dearer.outcome, dearer.reasons.clone()), (Outcome::Held, vec![Reason::PriceChanged]));
    let swapped = buy_item(&mut guard, "pay-desk.near", 5, purchase("/prices?day=3"), START_MS);
    assert_eq!((swapped.outcome, swapped.reasons), (Outcome::Held, vec![Reason::PayeeChanged]));
    let held = guard.held_payments();
    assert_eq!(held[0].1.purchase, Some(purchase("/prices?day=2")));

    // The owner can pay one of them, which does not change the terms.
    as_owner(START_MS);
    guard.approve(dearer.held_id.unwrap());
    assert_eq!(guard.terms(DATA.into()).unwrap().price, U128(5 * CENT));
}

#[test]
fn an_expired_quote_is_refused() {
    let mut guard = new_vault();
    let stale = Purchase { quote_expires_ms: Some(START_MS - 5 * MINUTE_MS), ..purchase("/prices") };
    let decision = buy_item(&mut guard, "data.near", 5, stale, START_MS);
    assert_eq!((decision.outcome, decision.reasons), (Outcome::Refused, vec![Reason::QuoteExpired]));
    assert!(guard.terms(DATA.into()).is_none());
    let fresh = Purchase { quote_expires_ms: Some(START_MS + MINUTE_MS), ..purchase("/prices") };
    assert_eq!(buy_item(&mut guard, "data.near", 5, fresh, START_MS).outcome, Outcome::Paid);
}

#[test]
fn the_same_item_again_within_fifteen_minutes_is_held() {
    let mut guard = new_vault();
    buy_item(&mut guard, "data.near", 5, purchase("/report/7"), START_MS);
    let again = buy_item(&mut guard, "data.near", 5, purchase("/report/7"), START_MS + MINUTE_MS);
    assert_eq!((again.outcome, again.reasons), (Outcome::Held, vec![Reason::PossibleDuplicate]));
    // Another item at the same price is not a second charge, and the same item later is a new purchase.
    assert_eq!(buy_item(&mut guard, "data.near", 5, purchase("/report/8"), START_MS + MINUTE_MS).outcome, Outcome::Paid);
    assert_eq!(buy_item(&mut guard, "data.near", 5, purchase("/report/7"), START_MS + 16 * MINUTE_MS).outcome, Outcome::Paid);
}

#[test]
fn a_failed_first_payment_takes_back_its_lock_and_its_item() {
    let mut guard = new_vault();
    buy_item(&mut guard, "data.near", 5, purchase("/report/7"), START_MS);
    settle_purchase(&mut guard, "data.near", 5, purchase("/report/7"), true, false);
    assert!(guard.terms(DATA.into()).is_none());
    assert_eq!(buy_item(&mut guard, "data.near", 5, purchase("/report/7"), START_MS).outcome, Outcome::Paid);
}

#[test]
fn the_owner_locks_terms_at_once_when_that_only_tightens() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.lock_terms(DATA.into(), data_terms(5));
    guard.lock_terms(DATA.into(), data_terms(3));
    let terms = guard.terms(DATA.into()).unwrap();
    assert_eq!((terms.price, terms.by_owner), (U128(3 * CENT), true));

    // The first payment does not replace the owner's terms.
    let other = buy_item(&mut guard, "data-two.near", 3, purchase("/prices"), START_MS);
    assert_eq!(other.reasons, vec![Reason::PayeeChanged]);
    assert_eq!(buy_item(&mut guard, "data.near", 3, purchase("/prices"), START_MS).outcome, Outcome::Paid);
    assert!(guard.terms(DATA.into()).unwrap().by_owner);
}

#[test]
#[should_panic(expected = "Another payee or a higher price is a change that waits")]
fn raising_a_locked_price_at_once_is_refused() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.lock_terms(DATA.into(), data_terms(5));
    guard.lock_terms(DATA.into(), data_terms(6));
}

#[test]
fn a_higher_price_another_payee_or_no_terms_wait() {
    let mut guard = new_vault();
    as_owner(START_MS);
    guard.lock_terms(DATA.into(), data_terms(5));
    let raise = guard.propose(Change::SetTerms { service: DATA.into(), terms: Some(data_terms(8)) });
    let drop = guard.propose(Change::SetTerms { service: DATA.into(), terms: None });
    call(owner(), other_key(), 0, START_MS + DAY_MS);
    guard.execute(raise);
    assert_eq!(guard.terms(DATA.into()).unwrap().price, U128(8 * CENT));
    guard.execute(drop);
    assert!(guard.terms(DATA.into()).is_none());
}

#[test]
fn an_approved_first_purchase_locks_the_terms() {
    let mut guard = new_vault();
    // Over the 5 USDC new-payee limit: held, then approved by the owner.
    let held = buy_item(&mut guard, "data.near", 600, purchase("/bulk"), START_MS);
    assert_eq!(held.reasons, vec![Reason::NewPayeeOverLimit]);
    as_owner(START_MS);
    guard.approve(held.held_id.unwrap());
    assert_eq!(guard.terms(DATA.into()).unwrap().price, U128(600 * CENT));
}

#[test]
fn a_purchase_from_a_new_payee_is_checked_first_and_then_locks_the_terms() {
    let mut guard = checked_vault();
    let checking = buy_item(&mut guard, "data.near", 5, purchase("/prices"), START_MS);
    assert_eq!(checking.outcome, Outcome::Checking);
    assert!(guard.terms(DATA.into()).is_none());
    let decision = answer(&mut guard, checking.held_id.unwrap(), Some(OLD), START_MS);
    assert_eq!(decision.outcome, Outcome::Paid);
    assert_eq!(guard.terms(DATA.into()).unwrap().payee, id("data.near"));
}

#[test]
fn a_full_list_of_services_locks_no_more() {
    let mut guard = new_vault();
    for n in 0..MAX_SERVICES {
        // Each lock is its own call, as on-chain.
        as_owner(START_MS);
        guard.lock_terms(format!("https://service-{n}.example"), data_terms(5));
    }
    assert_eq!(buy_item(&mut guard, "data.near", 5, purchase("/prices"), START_MS).outcome, Outcome::Paid);
    assert!(guard.terms(DATA.into()).is_none());
    assert_eq!(guard.services(Some(98), Some(5)).len(), 2);
}

#[test]
#[should_panic(expected = "A service's name must be 1 to 128 bytes")]
fn a_purchase_needs_a_service() {
    let mut guard = new_vault();
    buy_item(&mut guard, "data.near", 5, Purchase { service: String::new(), ..purchase("/prices") }, START_MS);
}

#[test]
#[should_panic(expected = "An item can be at most 256 bytes")]
fn an_item_is_short() {
    let mut guard = new_vault();
    buy_item(&mut guard, "data.near", 5, purchase(&"x".repeat(257)), START_MS);
}

#[test]
fn a_purchase_and_its_terms_are_in_the_event() {
    let mut guard = new_vault();
    buy_item(&mut guard, "data.near", 5, purchase("/prices"), START_MS);
    buy_item(&mut guard, "data.near", 9, purchase("/premium"), START_MS);
    let held = near_sdk::test_utils::get_logs().into_iter().find(|log| log.contains("\"payment_held\"")).expect("an event");
    assert!(held.contains("\"PRICE_CHANGED\"") && held.contains("\"item\":\"/premium\"") && held.contains("\"price\":\"50000\""), "{held}");
}


mod solana_tests;
mod safety_tests;
