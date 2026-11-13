//! Svalin's look-alike rules, the same ones its API runs (`apps/api/src/risk/check.ts` in
//! svalin-agent), so the contract and the API give the same answer for the same names. The shared
//! cases in `tests/vectors.json` are generated from the TypeScript and checked here.

/// Well-known NEAR accounts a scammer would imitate: the named tokens in Svalin's registry plus
/// protocol, bridge and DAO contracts (`NEAR_WELL_KNOWN_ACCOUNTS` in svalin-agent's chain-config).
pub const WELL_KNOWN: &[&str] = &[
    "wrap.near",
    "usdt.tether-token.near",
    "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
    "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near",
    "meta-pool.near",
    "linear-protocol.near",
    "lst.rhealab.near",
    "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near",
    "nbtc.bridge.near",
    "aurora",
    "eth.bridge.near",
    "blackdragon.tkn.near",
    "token.0xshitzu.near",
    "intents.near",
    "v2.ref-finance.near",
    "token.v2.ref-finance.near",
    "dclv2.ref-labs.near",
    "contract.main.burrow.near",
    "token.burrow.near",
    "token.rhealab.near",
    "factory.bridge.near",
    "omft.near",
    "poolv1.near",
    "lockup.near",
    "social.near",
    "game.hot.tg",
    "token.sweat",
    "sputnik-dao.near",
    "astro.sputnik-dao.near",
    "v1.signer",
];

/// Top-level accounts that let anyone register a name under them.
const PUBLIC_REGISTRARS: &[&str] = &["near", "testnet", "tg"];

/// Below this length, names one letter apart are usually just different names (bob1, bob2).
const SIMILAR_NAME_MIN: usize = 8;

/// A NEAR account name as a reader sees it: look-alike characters folded, separators dropped.
pub fn skeleton(name: &str) -> String {
    let folded = name
        .to_lowercase()
        .replace("rn", "m")
        .replace("vv", "w")
        .replace('0', "o")
        .replace('1', "l")
        .replace('5', "s");
    folded.chars().filter(|c| !matches!(c, '-' | '_' | '.')).collect()
}

/// 64-hex implicit accounts and 0x-addresses are not read as words.
fn is_implicit(name: &str) -> bool {
    let hex = |s: &str| s.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
    (name.len() == 64 && hex(name)) || (name.len() == 42 && name.starts_with("0x") && hex(&name[2..]))
}

/// Two different NEAR names that read the same, such as binance-hot.near and binancehot.near.
pub fn names_look_alike(left: &str, right: &str) -> bool {
    left != right && !is_implicit(left) && !is_implicit(right) && skeleton(left) == skeleton(right)
}

/// Two NEAR names one letter apart once look-alikes are folded, both long enough to be telling.
pub fn names_nearly_alike(left: &str, right: &str) -> bool {
    if left == right || is_implicit(left) || is_implicit(right) {
        return false;
    }
    // Length is judged without the top-level suffix: bob1.near is a 4-letter name.
    let own = |name: &str| {
        let parts: Vec<&str> = name.split('.').collect();
        let length: usize = parts[..parts.len() - 1].iter().map(|part| part.len()).sum();
        if length == 0 { name.len() } else { length }
    };
    if own(left).min(own(right)) < SIMILAR_NAME_MIN {
        return false;
    }
    edit_distance_is_one(&skeleton(left), &skeleton(right))
}

/// Two long addresses that share their first and last four characters but differ: what address
/// poisoning relies on, since people check only the ends.
pub fn addresses_look_alike(left: &str, right: &str) -> bool {
    if left == right || left.len() < 32 || right.len() < 32 {
        return false;
    }
    left[..4] == right[..4] && left[left.len() - 4..] == right[right.len() - 4..]
}

fn edit_distance_is_one(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len().abs_diff(b.len()) > 1 || a == b {
        return false;
    }
    let (mut i, mut j, mut edits) = (0, 0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if edits > 1 {
            return false;
        }
        if a.len() > b.len() {
            i += 1;
        } else if b.len() > a.len() {
            j += 1;
        } else {
            i += 1;
            j += 1;
        }
    }
    edits + (a.len() - i) + (b.len() - j) == 1
}

/// Only an account can create names under itself, so token.rhealab.near and xtoken.rhealab.near
/// share one owner: a look-alike under the same private parent is not an impostor.
fn same_owner(left: &str, right: &str) -> bool {
    let parent = |name: &str| name.split_once('.').map(|(_, rest)| rest.to_string());
    match (parent(left), parent(right)) {
        (Some(a), Some(b)) => a == b && !PUBLIC_REGISTRARS.contains(&a.as_str()),
        _ => false,
    }
}

/// How closely a payee imitates another name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Likeness {
    /// Reads the same (intent5.near for intents.near), or a long address with the same ends.
    Same,
    /// One letter apart once look-alikes are folded.
    Near,
}

/// How `payee` imitates `other`, if it does; never one of the same owner.
pub fn likeness(payee: &str, other: &str) -> Option<Likeness> {
    if payee == other || same_owner(payee, other) {
        return None;
    }
    if names_look_alike(payee, other) || addresses_look_alike(payee, other) {
        Some(Likeness::Same)
    } else if names_nearly_alike(payee, other) {
        Some(Likeness::Near)
    } else {
        None
    }
}

/// The well-known account `payee` imitates, and how closely.
pub fn imitated_well_known(payee: &str) -> Option<(&'static str, Likeness)> {
    if WELL_KNOWN.contains(&payee) {
        return None;
    }
    WELL_KNOWN
        .iter()
        .find_map(|known| likeness(payee, known).map(|how| (*known, how)))
        // A name that reads the same outranks one a letter away.
        .map(|first| {
            WELL_KNOWN
                .iter()
                .find_map(|known| (likeness(payee, known) == Some(Likeness::Same)).then_some((*known, Likeness::Same)))
                .unwrap_or(first)
        })
}
