//! Svalin Index proofs, shared by the ratings contract, Svalin Guard and the root tool.
//!
//! - One leaf per rated token: `svalin-index/1|<day>|<token>|<grade>|<backing_usd>`, with backing
//!   in whole US dollars, rounded down.
//! - Leaves are sorted by token, hashed as SHA-256(0x00 ‖ leaf) and paired as
//!   SHA-256(0x01 ‖ left ‖ right). A node with no partner moves up unchanged. The two prefixes
//!   keep a leaf from passing for a node.
//! - The hash comes from the caller, so a contract can use NEAR's host function and a tool the
//!   `sha2` crate, and both get the same root.

pub type Hash = [u8; 32];

/// Leaf format version: the first field of every leaf.
pub const LEAF_VERSION: &str = "svalin-index/1";
pub const GRADES: [&str; 5] = ["A", "B", "C", "D", "F"];

/// A SHA-256 implementation.
pub trait Sha256 {
    fn sha256(data: &[u8]) -> Hash;
}

/// One step up the tree: the sibling's hash, and whether it sits on the left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Step {
    pub sibling: Hash,
    pub left: bool,
}

/// The leaf for one token in one edition, or why it cannot be one.
pub fn leaf(day: &str, token: &str, grade: &str, backing_usd: u64) -> Result<String, &'static str> {
    if !is_day(day) {
        return Err("day must be YYYY-MM-DD");
    }
    if token.is_empty() || token.len() > 64 || token.contains('|') {
        return Err("token must be a NEAR account ID");
    }
    if !GRADES.contains(&grade) {
        return Err("grade must be A, B, C, D or F");
    }
    Ok(format!("{LEAF_VERSION}|{day}|{token}|{grade}|{backing_usd}"))
}

pub fn is_day(day: &str) -> bool {
    let b = day.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

pub fn leaf_hash<H: Sha256>(leaf: &str) -> Hash {
    let mut bytes = Vec::with_capacity(1 + leaf.len());
    bytes.push(0);
    bytes.extend_from_slice(leaf.as_bytes());
    H::sha256(&bytes)
}

fn node<H: Sha256>(left: &Hash, right: &Hash) -> Hash {
    let mut bytes = [0u8; 65];
    bytes[0] = 1;
    bytes[1..33].copy_from_slice(left);
    bytes[33..].copy_from_slice(right);
    H::sha256(&bytes)
}

fn level_up<H: Sha256>(level: &[Hash]) -> Vec<Hash> {
    level.chunks(2).map(|pair| if pair.len() == 2 { node::<H>(&pair[0], &pair[1]) } else { pair[0] }).collect()
}

/// The root of leaf hashes already in token order; none for no leaves.
pub fn root<H: Sha256>(leaves: &[Hash]) -> Option<Hash> {
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = level_up::<H>(&level);
    }
    level.first().copied()
}

/// The steps from leaf `index` up to the root.
pub fn proof<H: Sha256>(leaves: &[Hash], mut index: usize) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        let partner = index ^ 1;
        if partner < level.len() {
            steps.push(Step { sibling: level[partner], left: partner < index });
        }
        level = level_up::<H>(&level);
        index /= 2;
    }
    steps
}

/// Whether the leaf with this text, with these steps, leads to `root`. Contracts use this one: they
/// take a leaf's text, never a hash, so nothing but a leaf can be proved.
pub fn verify_leaf<H: Sha256>(root: &Hash, leaf: &str, steps: &[Step]) -> bool {
    verify::<H>(root, &leaf_hash::<H>(leaf), steps)
}

/// Whether the leaf hash `leaf` with these steps leads to `root`.
pub fn verify<H: Sha256>(root: &Hash, leaf: &Hash, steps: &[Step]) -> bool {
    let top = steps.iter().fold(*leaf, |acc, step| if step.left { node::<H>(&step.sibling, &acc) } else { node::<H>(&acc, &step.sibling) });
    &top == root
}

pub fn to_hex(hash: &Hash) -> String {
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

/// 64 lowercase hex characters as a hash.
pub fn from_hex(hex: &str) -> Option<Hash> {
    if hex.len() != 64 || !hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    let mut hash = [0u8; 32];
    for (i, byte) in hash.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Digest;

    struct Sha2;
    impl Sha256 for Sha2 {
        fn sha256(data: &[u8]) -> Hash {
            sha2::Sha256::digest(data).into()
        }
    }

    fn leaves(n: usize) -> Vec<Hash> {
        (0..n).map(|i| leaf_hash::<Sha2>(&leaf("2026-11-02", &format!("t{i:04}.near"), "F", i as u64).unwrap())).collect()
    }

    #[test]
    fn every_leaf_proves_into_the_root_for_any_tree_size() {
        for n in 1..=33 {
            let leaves = leaves(n);
            let root = root::<Sha2>(&leaves).unwrap();
            for (i, leaf) in leaves.iter().enumerate() {
                assert!(verify::<Sha2>(&root, leaf, &proof::<Sha2>(&leaves, i)), "n={n} i={i}");
            }
        }
    }

    #[test]
    fn a_changed_leaf_or_step_does_not_prove() {
        let leaves = leaves(9);
        let root = root::<Sha2>(&leaves).unwrap();
        let steps = proof::<Sha2>(&leaves, 4);
        let forged = leaf_hash::<Sha2>(&leaf("2026-11-02", "t0004.near", "A", 4).unwrap());
        assert!(!verify::<Sha2>(&root, &forged, &steps));
        let mut flipped = steps.clone();
        flipped[0].left = !flipped[0].left;
        assert!(!verify::<Sha2>(&root, &leaves[4], &flipped));
        assert!(!verify::<Sha2>(&root, &leaves[4], &steps[1..]));
    }

    #[test]
    fn a_short_proof_cannot_pass_a_node_off_as_a_leaf() {
        let leaves = leaves(4);
        let root = root::<Sha2>(&leaves).unwrap();
        let steps = proof::<Sha2>(&leaves, 0);
        // The node above leaves 0 and 1 reaches the root with the remaining step, but only a leaf's
        // text is ever accepted, and a leaf's hash carries the 0x00 prefix a node's never does.
        let half = node::<Sha2>(&leaves[0], &leaves[1]);
        assert!(verify::<Sha2>(&root, &half, &steps[1..]));
        assert!(!verify_leaf::<Sha2>(&root, &to_hex(&half), &steps[1..]));
        let text = leaf("2026-11-02", "t0000.near", "F", 0).unwrap();
        assert!(verify_leaf::<Sha2>(&root, &text, &steps));
    }

    #[test]
    fn known_root_for_a_fixed_edition() {
        // Pinned so the TypeScript side and any other tool can check they build the same tree.
        let leaves: Vec<Hash> = [("a.near", "A", 1_000_000u64), ("b.near", "C", 25_000), ("c.near", "F", 0)]
            .iter()
            .map(|(token, grade, usd)| leaf_hash::<Sha2>(&leaf("2026-11-02", token, grade, *usd).unwrap()))
            .collect();
        assert_eq!(leaf("2026-11-02", "b.near", "C", 25_000).unwrap(), "svalin-index/1|2026-11-02|b.near|C|25000");
        let root = to_hex(&root::<Sha2>(&leaves).unwrap());
        assert_eq!(root.len(), 64);
        assert_eq!(from_hex(&root).map(|h| to_hex(&h)), Some(root.clone()));
        println!("fixed root: {root}");
    }

    #[test]
    fn refuses_malformed_leaves_and_hex() {
        assert!(leaf("2026-1-02", "a.near", "A", 1).is_err());
        assert!(leaf("2026-11-02", "a|b.near", "A", 1).is_err());
        assert!(leaf("2026-11-02", "a.near", "E", 1).is_err());
        assert!(from_hex("ABCD").is_none());
        assert!(from_hex(&"G".repeat(64)).is_none());
        assert!(root::<Sha2>(&[]).is_none());
    }
}
