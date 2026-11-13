use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

// 4 November 2026, 13:46 UTC: after every day the tests publish.
const START_MS: u64 = 1_793_800_000_000;

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn registry() -> AccountId {
    id("ratings.svalin.near")
}
fn owner() -> AccountId {
    id("svalin.near")
}
fn publisher() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}
fn other_key() -> PublicKey {
    "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap()
}

fn call(predecessor: AccountId, key: PublicKey, yocto: u128, ms: u64) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(registry())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .signer_account_pk(key)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(ms * 1_000_000);
    testing_env!(context.build());
}
fn as_publisher(ms: u64) {
    call(registry(), publisher(), 0, ms);
}
fn as_owner(ms: u64) {
    call(owner(), other_key(), 1, ms);
}
fn as_anyone(ms: u64) {
    call(id("anyone.near"), other_key(), 0, ms);
}

fn new_registry() -> Ratings {
    call(owner(), other_key(), 0, START_MS);
    Ratings::new(owner(), Some(publisher()), Some(false), None)
}

const TOKENS: [(&str, &str, u64); 5] =
    [("a.near", "A", 1_793_891), ("b.near", "B", 250_000), ("c.near", "C", 25_000), ("d.near", "F", 12), ("e.near", "F", 0)];

fn leaf_hashes(day: &str) -> Vec<Hash> {
    TOKENS.iter().map(|(token, grade, usd)| svalin_proof::leaf_hash::<NearSha>(&svalin_proof::leaf(day, token, grade, *usd).unwrap())).collect()
}

fn root_of(day: &str) -> String {
    svalin_proof::to_hex(&svalin_proof::root::<NearSha>(&leaf_hashes(day)).unwrap())
}

fn proof_for(day: &str, index: usize) -> Vec<ProofStep> {
    svalin_proof::proof::<NearSha>(&leaf_hashes(day), index)
        .into_iter()
        .map(|step| ProofStep { hash: svalin_proof::to_hex(&step.sibling), left: step.left })
        .collect()
}

fn publish(ratings: &mut Ratings, day: &str, ms: u64) {
    as_publisher(ms);
    ratings.publish(day.into(), root_of(day), "1".repeat(64), "2".repeat(64), "near-token-backing-v1".into(), TOKENS.len() as u32);
}

fn verify(ratings: &Ratings, day: &str, index: usize, ms: u64) -> Verification {
    as_anyone(ms);
    let (token, grade, usd) = TOKENS[index];
    ratings.verify(day.into(), token.into(), grade.into(), usd, proof_for(day, index))
}

const LATER: u64 = START_MS + CHALLENGE_MS;

#[test]
fn every_token_proves_its_grade_once_the_challenge_window_is_over() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    for index in 0..TOKENS.len() {
        let result = verify(&ratings, "2026-11-02", index, LATER);
        assert!(result.valid, "{index}: {:?}", result.problem);
    }
    assert_eq!(verify(&ratings, "2026-11-02", 0, LATER).leaf.unwrap(), "svalin-index/1|2026-11-02|a.near|A|1793891");
}

#[test]
fn a_new_edition_waits_six_hours() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    assert_eq!(verify(&ratings, "2026-11-02", 0, LATER - 1).problem, Some(Problem::InChallengeWindow));
    as_anyone(LATER - 1);
    assert_eq!(ratings.latest_usable(), None);
    as_anyone(LATER);
    assert_eq!(ratings.latest_usable().unwrap().day, "2026-11-02");
}

#[test]
fn a_better_grade_than_the_edition_says_does_not_prove() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    as_anyone(LATER);
    // d.near was graded F with $12 of backing; claiming A with its real proof fails.
    let claim = ratings.verify("2026-11-02".into(), "d.near".into(), "A".into(), 1_793_891, proof_for("2026-11-02", 3));
    assert_eq!((claim.valid, claim.problem), (false, Some(Problem::BadProof)));
    // Another token's proof does not prove this one.
    let swapped = ratings.verify("2026-11-02".into(), "d.near".into(), "F".into(), 12, proof_for("2026-11-02", 0));
    assert_eq!(swapped.problem, Some(Problem::BadProof));
    // The same proof against another day's edition fails too.
    publish(&mut ratings, "2026-11-03", START_MS);
    as_anyone(LATER);
    let other_day = ratings.verify("2026-11-03".into(), "d.near".into(), "F".into(), 12, proof_for("2026-11-02", 3));
    assert_eq!(other_day.problem, Some(Problem::BadProof));
}

#[test]
fn malformed_claims_are_refused_not_guessed() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    as_anyone(LATER);
    assert_eq!(ratings.verify("2026-11-01".into(), "a.near".into(), "A".into(), 1, vec![]).problem, Some(Problem::NoSuchEdition));
    assert_eq!(ratings.verify("2026-11-02".into(), "a.near".into(), "E".into(), 1, vec![]).problem, Some(Problem::BadLeaf));
    let bad_hex = vec![ProofStep { hash: "zz".into(), left: true }];
    assert_eq!(ratings.verify("2026-11-02".into(), "a.near".into(), "A".into(), 1_793_891, bad_hex).problem, Some(Problem::BadProof));
    let too_long = vec![ProofStep { hash: "0".repeat(64), left: true }; MAX_PROOF_STEPS + 1];
    assert_eq!(ratings.verify("2026-11-02".into(), "a.near".into(), "A".into(), 1_793_891, too_long).problem, Some(Problem::BadProof));
}

#[test]
fn a_retracted_edition_proves_nothing_and_stays_retracted() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    publish(&mut ratings, "2026-11-03", START_MS + 1);
    as_owner(START_MS + 2);
    ratings.retract("2026-11-03".into(), "root does not match the rebuilt edition".into());
    assert!(near_sdk::test_utils::get_logs().iter().any(|log| log.contains("\"edition_retracted\"")));
    assert_eq!(verify(&ratings, "2026-11-03", 0, LATER + 2).problem, Some(Problem::Retracted));
    as_anyone(LATER + 2);
    assert_eq!(ratings.latest_usable().unwrap().day, "2026-11-02");
    // Nothing can replace it: a later day only.
    as_publisher(LATER + 2);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ratings.publish("2026-11-03".into(), root_of("2026-11-03"), "1".repeat(64), "2".repeat(64), "m".into(), 5)
    }))
    .is_err());
}

#[test]
#[should_panic(expected = "Already retracted")]
fn retracting_twice_is_refused() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    as_owner(START_MS);
    ratings.retract("2026-11-02".into(), "test".into());
    as_owner(START_MS);
    ratings.retract("2026-11-02".into(), "test".into());
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_retracts() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    call(id("anyone.near"), other_key(), 1, START_MS);
    ratings.retract("2026-11-02".into(), "test".into());
}

#[test]
#[should_panic(expected = "Editions are published in date order and never replaced")]
fn editions_cannot_be_replaced() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    publish(&mut ratings, "2026-11-02", START_MS);
}

#[test]
#[should_panic(expected = "Editions are published in date order and never replaced")]
fn editions_cannot_be_backdated() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    publish(&mut ratings, "2026-11-01", START_MS);
}

#[test]
#[should_panic(expected = "Only the publishing key can publish")]
fn the_owner_cannot_publish() {
    let mut ratings = new_registry();
    call(owner(), publisher(), 0, START_MS);
    ratings.publish("2026-11-02".into(), root_of("2026-11-02"), "1".repeat(64), "2".repeat(64), "m".into(), 5);
}

#[test]
#[should_panic(expected = "Only the publishing key can publish")]
fn another_key_of_the_registry_cannot_publish() {
    let mut ratings = new_registry();
    call(registry(), other_key(), 0, START_MS);
    ratings.publish("2026-11-02".into(), root_of("2026-11-02"), "1".repeat(64), "2".repeat(64), "m".into(), 5);
}

#[test]
#[should_panic(expected = "root must be 64 lowercase hex characters")]
fn a_root_must_be_a_hash() {
    let mut ratings = new_registry();
    as_publisher(START_MS);
    ratings.publish("2026-11-02".into(), "ABC".into(), "1".repeat(64), "2".repeat(64), "m".into(), 5);
}

#[test]
fn editions_are_listed_in_order() {
    let mut ratings = new_registry();
    for (n, day) in ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].iter().enumerate() {
        publish(&mut ratings, day, START_MS + n as u64);
    }
    as_anyone(START_MS);
    let days: Vec<String> = ratings.editions(Some(1), Some(2)).into_iter().map(|edition| edition.day).collect();
    assert_eq!(days, vec!["2026-10-31", "2026-11-01"]);
    assert_eq!(ratings.editions(Some(3), None).len(), 1);
    assert_eq!(ratings.editions(Some(9), None).len(), 0);
}

#[test]
fn locking_deletes_the_deploy_key_and_adds_the_publishing_key() {
    call(registry(), other_key(), 0, START_MS);
    Ratings::new(owner(), Some(publisher()), None, None);
    let actions: Vec<String> =
        near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|receipt| receipt.actions).map(|action| format!("{action:?}")).collect();
    assert!(actions.iter().any(|action| action.contains("AddKeyWithFunctionCall") && action.contains("publish")), "{actions:?}");
    assert!(actions.iter().any(|action| action.contains("DeleteKey")), "{actions:?}");
}

#[test]
fn the_owner_replaces_the_publishing_key() {
    let mut ratings = new_registry();
    as_owner(START_MS);
    ratings.set_publisher(other_key());
    let actions: Vec<String> =
        near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|receipt| receipt.actions).map(|action| format!("{action:?}")).collect();
    let deleted = actions.iter().position(|action| action.contains("DeleteKey")).expect("the old key is deleted");
    let added = actions.iter().position(|action| action.contains("AddKeyWithFunctionCall")).expect("the new key is added");
    assert!(deleted < added);
    // The old key cannot publish any more.
    as_publisher(START_MS);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ratings.publish("2026-11-02".into(), root_of("2026-11-02"), "1".repeat(64), "2".repeat(64), "m".into(), 5)
    }))
    .is_err());
}

#[test]
fn a_registry_can_be_set_up_with_a_shorter_window_but_not_none() {
    call(owner(), other_key(), 0, START_MS);
    let mut ratings = Ratings::new(owner(), Some(publisher()), Some(false), Some(HOUR_MS));
    publish(&mut ratings, "2026-11-02", START_MS);
    assert!(verify(&ratings, "2026-11-02", 0, START_MS + HOUR_MS).valid);
    call(owner(), other_key(), 0, START_MS);
    let too_short = std::panic::catch_unwind(|| Ratings::new(owner(), None, Some(false), Some(60_000)));
    assert!(too_short.is_err());
}

#[test]
fn verify_names_the_editions_methodology() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    assert_eq!(verify(&ratings, "2026-11-02", 0, LATER).methodology.as_deref(), Some("near-token-backing-v1"));
    assert_eq!(verify(&ratings, "2026-11-02", 0, LATER - 1).methodology.as_deref(), Some("near-token-backing-v1"));
}

#[test]
#[should_panic(expected = "Keep the reason to 280 characters")]
fn a_retraction_reason_is_short() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-02", START_MS);
    as_owner(START_MS);
    ratings.retract("2026-11-02".into(), "x".repeat(281));
}

#[test]
#[should_panic(expected = "An edition cannot be dated after today (UTC)")]
fn an_edition_cannot_be_dated_in_the_future() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2099-01-01", START_MS);
}

#[test]
fn today_can_be_published() {
    let mut ratings = new_registry();
    publish(&mut ratings, "2026-11-04", START_MS);
    as_anyone(START_MS);
    assert_eq!(ratings.editions(None, None).len(), 1);
}

#[test]
fn utc_days_are_calendar_dates() {
    assert_eq!(utc_day(0), "1970-01-01");
    assert_eq!(utc_day(1_793_750_400_000), "2026-11-04");
    assert_eq!(utc_day(1_793_750_399_999), "2026-11-03");
    assert_eq!(utc_day(1_709_164_800_000), "2024-02-29");
    assert_eq!(utc_day(951_782_400_000), "2000-02-29");
    assert_eq!(utc_day(4_107_542_400_000), "2100-03-01");
}
