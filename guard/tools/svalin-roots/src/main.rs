//! Computes a sealed Svalin Index edition's Merkle root, and proofs for its tokens.
//!
//! ```text
//! svalin-roots publish <edition.json> <near-token-index.json>
//! svalin-roots prove   <edition.json> <near-token-index.json> <token>
//! ```
//!
//! `publish` prints the arguments for the registry's `publish`; `prove` prints what `verify` takes.
//! Both first check the index file against the SHA-256 the sealed edition records for it, so a root
//! is only ever computed from the file that was sealed.

use serde_json::{json, Value};
use sha2::Digest;
use svalin_proof::{Hash, Sha256};

struct Sha2;
impl Sha256 for Sha2 {
    fn sha256(data: &[u8]) -> Hash {
        sha2::Sha256::digest(data).into()
    }
}

/// One rated token as a leaf.
struct Rated {
    token: String,
    grade: String,
    backing_usd: u64,
}

struct Edition {
    day: String,
    fingerprint: String,
    index_sha256: String,
    methodology: String,
    /// Sorted by token.
    tokens: Vec<Rated>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("publish") if args.len() == 4 => load(&args[2], &args[3]).and_then(|edition| publish(&edition)),
        Some("prove") if args.len() == 5 => load(&args[2], &args[3]).and_then(|edition| prove(&edition, &args[4])),
        _ => Err("usage: svalin-roots publish <edition.json> <index.json> | prove <edition.json> <index.json> <token>".into()),
    };
    match result {
        Ok(out) => println!("{}", serde_json::to_string_pretty(&out).expect("JSON values serialise")),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn load(edition_path: &str, index_path: &str) -> Result<Edition, String> {
    let read = |path: &str| std::fs::read(path).map_err(|e| format!("{path}: {e}"));
    let sealed: Value = serde_json::from_slice(&read(edition_path)?).map_err(|e| format!("{edition_path}: {e}"))?;
    let index_bytes = read(index_path)?;
    edition(&sealed, &index_bytes)
}

/// The edition from its sealed record and the bytes of its index file.
fn edition(sealed: &Value, index_bytes: &[u8]) -> Result<Edition, String> {
    let recorded = sealed["files"]["index"]["sha256"].as_str().ok_or("the edition records no index SHA-256")?;
    let actual = svalin_proof::to_hex(&Sha2::sha256(index_bytes));
    if actual != recorded {
        return Err(format!("the index file's SHA-256 is {actual}, but the edition sealed {recorded}"));
    }
    let index: Value = serde_json::from_slice(index_bytes).map_err(|e| format!("index: {e}"))?;
    let day = sealed["generatedAt"].as_str().and_then(|at| at.get(..10)).ok_or("the edition has no generatedAt")?.to_string();
    let methodology = sealed["methodology"].as_str().ok_or("the edition has no methodology")?.to_string();
    let fingerprint = sealed["fingerprint"].as_str().ok_or("the edition has no fingerprint")?.to_string();
    let mut tokens: Vec<Rated> = index["rows"]
        .as_array()
        .ok_or("the index has no rows")?
        .iter()
        .map(|row| {
            let token = row[0].as_str().ok_or("a row without a token")?;
            let grade = row[4].as_str().ok_or_else(|| format!("{token}: no grade"))?;
            let backing = row[3].as_f64().filter(|usd| usd.is_finite() && *usd >= 0.0).ok_or_else(|| format!("{token}: bad backing"))?;
            Ok(Rated { token: token.to_string(), grade: grade.to_string(), backing_usd: backing.floor() as u64 })
        })
        .collect::<Result<_, String>>()?;
    tokens.sort_by(|a, b| a.token.cmp(&b.token));
    if let Some(pair) = tokens.windows(2).find(|pair| pair[0].token == pair[1].token) {
        return Err(format!("{} is rated twice", pair[0].token));
    }
    Ok(Edition { day, fingerprint, index_sha256: actual, methodology, tokens })
}

fn leaves(edition: &Edition) -> Result<Vec<Hash>, String> {
    edition
        .tokens
        .iter()
        .map(|rated| {
            svalin_proof::leaf(&edition.day, &rated.token, &rated.grade, rated.backing_usd)
                .map(|leaf| svalin_proof::leaf_hash::<Sha2>(&leaf))
                .map_err(|e| format!("{}: {e}", rated.token))
        })
        .collect()
}

fn publish(edition: &Edition) -> Result<Value, String> {
    let root = svalin_proof::root::<Sha2>(&leaves(edition)?).ok_or("the edition rates no tokens")?;
    Ok(json!({
        "day": edition.day,
        "root": svalin_proof::to_hex(&root),
        "fingerprint": edition.fingerprint,
        "index_sha256": edition.index_sha256,
        "methodology": edition.methodology,
        "tokens": edition.tokens.len(),
    }))
}

fn prove(edition: &Edition, token: &str) -> Result<Value, String> {
    let index = edition.tokens.iter().position(|rated| rated.token == token).ok_or_else(|| format!("{token} is not in the {} edition", edition.day))?;
    let leaves = leaves(edition)?;
    let rated = &edition.tokens[index];
    let proof: Vec<Value> = svalin_proof::proof::<Sha2>(&leaves, index)
        .iter()
        .map(|step| json!({ "hash": svalin_proof::to_hex(&step.sibling), "left": step.left }))
        .collect();
    Ok(json!({
        "day": edition.day,
        "token": rated.token,
        "grade": rated.grade,
        "backing_usd": rated.backing_usd,
        "proof": proof,
        "root": svalin_proof::to_hex(&svalin_proof::root::<Sha2>(&leaves).expect("at least this token")),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sealed_with(index: &[u8]) -> Value {
        json!({
            "generatedAt": "2026-11-02T06:00:38.140Z",
            "methodology": "near-token-backing-v1",
            "files": { "index": { "sha256": svalin_proof::to_hex(&Sha2::sha256(index)) } },
            "fingerprint": "f".repeat(64),
        })
    }

    const INDEX: &str = r#"{"rows":[
        ["c.near","C",1,25000.9,"C",null,null,null],
        ["a.near","A",1,1793891,"A",832859,14.5,16085],
        ["b.near","B",1,250000,"B",null,null,null]
    ]}"#;

    #[test]
    fn publishes_the_root_of_the_sealed_file_only() {
        let edition = edition(&sealed_with(INDEX.as_bytes()), INDEX.as_bytes()).unwrap();
        assert_eq!(edition.tokens.iter().map(|t| t.token.as_str()).collect::<Vec<_>>(), vec!["a.near", "b.near", "c.near"]);
        assert_eq!(edition.tokens[2].backing_usd, 25_000, "backing is rounded down to whole dollars");
        let args = publish(&edition).unwrap();
        assert_eq!(args["day"], "2026-11-02");
        assert_eq!(args["tokens"], 3);
        let tampered = INDEX.replace("\"C\",null", "\"A\",null");
        assert!(edition_err(&sealed_with(INDEX.as_bytes()), tampered.as_bytes()).contains("but the edition sealed"));
    }

    fn edition_err(sealed: &Value, bytes: &[u8]) -> String {
        match edition(sealed, bytes) {
            Ok(_) => panic!("expected an error"),
            Err(error) => error,
        }
    }

    #[test]
    fn a_proof_verifies_against_the_published_root() {
        let edition = edition(&sealed_with(INDEX.as_bytes()), INDEX.as_bytes()).unwrap();
        let root = publish(&edition).unwrap()["root"].as_str().unwrap().to_string();
        for token in ["a.near", "b.near", "c.near"] {
            let out = prove(&edition, token).unwrap();
            assert_eq!(out["root"], root);
            let steps: Vec<svalin_proof::Step> = out["proof"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| svalin_proof::Step { sibling: svalin_proof::from_hex(step["hash"].as_str().unwrap()).unwrap(), left: step["left"].as_bool().unwrap() })
                .collect();
            let leaf = svalin_proof::leaf("2026-11-02", token, out["grade"].as_str().unwrap(), out["backing_usd"].as_u64().unwrap()).unwrap();
            assert!(svalin_proof::verify_leaf::<Sha2>(&svalin_proof::from_hex(&root).unwrap(), &leaf, &steps), "{token}");
        }
        assert!(prove(&edition, "missing.near").is_err());
    }

    #[test]
    fn a_token_rated_twice_is_an_error() {
        let doubled = r#"{"rows":[["a.near","A",1,1,"F",null,null,null],["a.near","A",1,2,"F",null,null,null]]}"#;
        assert!(edition_err(&sealed_with(doubled.as_bytes()), doubled.as_bytes()).contains("rated twice"));
    }
}
