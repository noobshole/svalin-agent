//! Svalin's payee check, run by OutLayer inside a TEE for Svalin Guard.
//!
//! Reads `{"payee": "...", "network": "testnet" | "mainnet"}` from stdin and prints what public NEAR
//! RPC says about the payee: whether it exists, whether it is a contract, and how long ago its oldest
//! key was added. A NEAR contract cannot read another account's keys, which is why this runs
//! off-chain. The vault pins this program by its SHA-256, and OutLayer runs no other bytes.
//!
//! Age: NEAR sets a new access key's nonce to the block height times 1,000,000, so the oldest key's
//! nonce dates the account. A key added later only makes the account look younger, which errs safe.

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};

/// NEAR sets a new key's nonce to the block height times this.
const NONCE_PER_HEIGHT: u64 = 1_000_000;
/// The code hash of an account with no contract.
const NO_CODE: &str = "11111111111111111111111111111111";
/// Heights can be skipped; the creation block is the first one found from the key's height on.
const SKIPPED_HEIGHTS_TRIED: u64 = 5;

#[derive(Deserialize)]
struct Input {
    payee: String,
    network: String,
}

struct Network {
    rpc: &'static str,
    /// Answers for old blocks the regular RPC has dropped.
    archive: &'static str,
    /// Keys added before nonces carried heights (2021) have nonce 0; they date from genesis or later.
    genesis_height: u64,
}

/// Sends one JSON-RPC request to `url` and returns the response.
type Rpc<'a> = &'a dyn Fn(&str, &Value) -> Result<Value, String>;

fn main() {
    let mut input = String::new();
    let report = std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("cannot read input: {e}"))
        .and_then(|_| check(&input, &rpc::call));
    let answer = report.unwrap_or_else(|error| json!({ "error": error }));
    let mut out = std::io::stdout();
    let _ = out.write_all(answer.to_string().as_bytes());
    let _ = out.flush();
}

fn network(name: &str) -> Result<Network, String> {
    match name {
        "testnet" => Ok(Network {
            rpc: "https://rpc.testnet.fastnear.com",
            archive: "https://archival-rpc.testnet.fastnear.com",
            genesis_height: 42_376_888,
        }),
        "mainnet" => Ok(Network {
            rpc: "https://rpc.mainnet.fastnear.com",
            archive: "https://archival-rpc.mainnet.fastnear.com",
            genesis_height: 9_820_210,
        }),
        other => Err(format!("unknown network {other}")),
    }
}

/// The report the vault reads: `exists`, `contract`, `age_ms` (none for an account with no keys).
fn check(input: &str, rpc: Rpc) -> Result<Value, String> {
    let input: Input = serde_json::from_str(input).map_err(|e| format!("bad input: {e}"))?;
    let payee = input.payee;
    if !(2..=64).contains(&payee.len()) || !payee.bytes().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_')) {
        return Err("payee is not a NEAR account ID".into());
    }
    let net = network(&input.network)?;

    let Some(account) = found(rpc(net.rpc, &view("view_account", &payee))?)? else {
        return Ok(json!({ "payee": payee, "exists": false }));
    };
    let contract = account["code_hash"].as_str().is_some_and(|hash| hash != NO_CODE);
    let keys = found(rpc(net.rpc, &view("view_access_key_list", &payee))?)?.ok_or("the account disappeared")?;
    let created = oldest_key_height(&keys).map(|height| height.max(net.genesis_height));
    let age_ms = match created {
        None => None,
        Some(height) => {
            let now = block_time(rpc, net.rpc, json!({ "finality": "final" }))?;
            let then = creation_time(rpc, net.archive, height)?;
            Some(now.saturating_sub(then) / 1_000_000)
        }
    };
    Ok(json!({ "payee": payee, "exists": true, "contract": contract, "created_height": created, "age_ms": age_ms }))
}

fn view(request_type: &str, account: &str) -> Value {
    json!({
        "jsonrpc": "2.0", "id": "svalin", "method": "query",
        "params": { "request_type": request_type, "finality": "final", "account_id": account },
    })
}

/// The result, `None` for an account that does not exist, or the RPC's error.
fn found(response: Value) -> Result<Option<Value>, String> {
    if let Some(result) = response.get("result") {
        return Ok(Some(result.clone()));
    }
    match response["error"]["cause"]["name"].as_str() {
        Some("UNKNOWN_ACCOUNT") => Ok(None),
        _ => Err(format!("rpc error: {}", response["error"])),
    }
}

/// The height the account's oldest key was added at.
fn oldest_key_height(keys: &Value) -> Option<u64> {
    keys["keys"].as_array()?.iter().filter_map(|key| key["access_key"]["nonce"].as_u64()).min().map(|nonce| nonce / NONCE_PER_HEIGHT)
}

/// A block's timestamp in nanoseconds.
fn block_time(rpc: Rpc, url: &str, params: Value) -> Result<u64, String> {
    let response = rpc(url, &json!({ "jsonrpc": "2.0", "id": "svalin", "method": "block", "params": params }))?;
    let header = &response["result"]["header"];
    header["timestamp_nanosec"]
        .as_str()
        .and_then(|ns| ns.parse().ok())
        .or_else(|| header["timestamp"].as_u64())
        .ok_or_else(|| format!("no block: {}", response["error"]))
}

/// The creation block's time; skipped heights move on to the next block.
fn creation_time(rpc: Rpc, archive: &str, height: u64) -> Result<u64, String> {
    let mut last_error = String::new();
    for offset in 0..SKIPPED_HEIGHTS_TRIED {
        match block_time(rpc, archive, json!({ "block_id": height + offset })) {
            Ok(ns) => return Ok(ns),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

#[cfg(target_os = "wasi")]
mod rpc {
    use serde_json::Value;

    pub fn call(url: &str, request: &Value) -> Result<Value, String> {
        let body = request.to_string();
        let response = wasi_http_client::Client::new()
            .post(url)
            .header("Content-Type", "application/json")
            .body(body.as_bytes())
            .send()
            .map_err(|e| format!("request to {url} failed: {e}"))?;
        let status = response.status();
        let bytes = response.body().map_err(|e| format!("cannot read {url}: {e}"))?;
        if status != 200 {
            return Err(format!("{url} answered {status}"));
        }
        serde_json::from_slice(&bytes).map_err(|e| format!("{url} sent no JSON: {e}"))
    }
}

#[cfg(not(target_os = "wasi"))]
mod rpc {
    use serde_json::Value;

    pub fn call(url: &str, _: &Value) -> Result<Value, String> {
        Err(format!("no HTTP outside the WASI runtime ({url})"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const NOW_NS: u64 = 1_793_700_000_000_000_000;
    const HOUR_NS: u64 = 3_600_000_000_000;

    /// A fake NEAR RPC: `account` is the view_account result (or None for a missing account), keys
    /// carry nonces, and `blocks` maps heights to timestamps. Records every request.
    fn fake(account: Option<Value>, nonces: Vec<u64>, blocks: Vec<(u64, u64)>, seen: &RefCell<Vec<Value>>) -> impl Fn(&str, &Value) -> Result<Value, String> + '_ {
        move |_url: &str, request: &Value| {
            seen.borrow_mut().push(request.clone());
            match (request["method"].as_str(), request["params"]["request_type"].as_str()) {
                (Some("query"), Some("view_account")) => Ok(match &account {
                    Some(result) => json!({ "result": result }),
                    None => json!({ "error": { "cause": { "name": "UNKNOWN_ACCOUNT" } } }),
                }),
                (Some("query"), Some("view_access_key_list")) => {
                    let keys: Vec<Value> = nonces.iter().map(|nonce| json!({ "access_key": { "nonce": nonce } })).collect();
                    Ok(json!({ "result": { "keys": keys } }))
                }
                (Some("block"), _) => {
                    let params = &request["params"];
                    let ns = if params["finality"] == "final" {
                        Some(NOW_NS)
                    } else {
                        blocks.iter().find(|(height, _)| Some(*height) == params["block_id"].as_u64()).map(|(_, ns)| *ns)
                    };
                    Ok(match ns {
                        Some(ns) => json!({ "result": { "header": { "timestamp_nanosec": ns.to_string() } } }),
                        None => json!({ "error": { "cause": { "name": "UNKNOWN_BLOCK" } } }),
                    })
                }
                _ => Err("unexpected request".into()),
            }
        }
    }

    fn plain() -> Option<Value> {
        Some(json!({ "code_hash": NO_CODE, "amount": "1" }))
    }

    fn run(payee: &str, account: Option<Value>, nonces: Vec<u64>, blocks: Vec<(u64, u64)>) -> Result<Value, String> {
        let seen = RefCell::new(vec![]);
        let rpc = fake(account, nonces, blocks, &seen);
        check(&json!({ "payee": payee, "network": "testnet" }).to_string(), &rpc)
    }

    #[test]
    fn dates_an_account_by_its_oldest_key() {
        let created = 275_890_075;
        let report = run("shop.testnet", plain(), vec![created * NONCE_PER_HEIGHT + 7, 276_000_000 * NONCE_PER_HEIGHT], vec![(created, NOW_NS - 30 * HOUR_NS)]).unwrap();
        assert_eq!(report["exists"], true);
        assert_eq!(report["contract"], false);
        assert_eq!(report["created_height"], created);
        assert_eq!(report["age_ms"], 30 * 3_600_000);
    }

    #[test]
    fn reports_a_missing_account() {
        assert_eq!(run("nobody.testnet", None, vec![], vec![]).unwrap(), json!({ "payee": "nobody.testnet", "exists": false }));
    }

    #[test]
    fn spots_a_contract_and_an_account_with_no_keys() {
        let locked = Some(json!({ "code_hash": "5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt" }));
        let report = run("vault.testnet", locked, vec![], vec![]).unwrap();
        assert_eq!((report["contract"].clone(), report["age_ms"].clone()), (json!(true), Value::Null));
    }

    #[test]
    fn steps_over_skipped_heights() {
        let report = run("shop.testnet", plain(), vec![100_000_000 * NONCE_PER_HEIGHT], vec![(100_000_002, NOW_NS - HOUR_NS)]).unwrap();
        assert_eq!(report["age_ms"], 3_600_000);
    }

    #[test]
    fn keys_from_before_2021_date_from_genesis() {
        let report = run("old.testnet", plain(), vec![5], vec![(42_376_888, NOW_NS - 1000 * HOUR_NS)]).unwrap();
        assert_eq!(report["created_height"], 42_376_888);
        assert_eq!(report["age_ms"], 1000 * 3_600_000u64);
    }

    #[test]
    fn refuses_bad_input_instead_of_guessing() {
        assert!(run("Not An Account", plain(), vec![], vec![]).is_err());
        let seen = RefCell::new(vec![]);
        let rpc = fake(plain(), vec![], vec![], &seen);
        assert!(check(r#"{"payee":"shop.testnet","network":"devnet"}"#, &rpc).is_err());
        assert!(check("not json", &rpc).is_err());
        assert!(seen.borrow().is_empty());
    }

    #[test]
    fn an_rpc_error_is_an_error_not_a_verdict() {
        let rpc = |_: &str, _: &Value| Ok(json!({ "error": { "cause": { "name": "TIMEOUT_ERROR" } } }));
        assert!(check(r#"{"payee":"shop.testnet","network":"testnet"}"#, &rpc).is_err());
        let block_missing = run("shop.testnet", plain(), vec![200_000_000 * NONCE_PER_HEIGHT], vec![]);
        assert!(block_missing.is_err());
    }

    /// The same check against real NEAR testnet, with curl in place of WASI HTTP. Run it with
    /// `cargo test -p svalin-checker -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_against_testnet() {
        let curl = |url: &str, request: &Value| -> Result<Value, String> {
            let out = std::process::Command::new("curl")
                .args(["-s", "-m", "20", "-H", "content-type: application/json", "-d", &request.to_string(), url])
                .output()
                .map_err(|e| e.to_string())?;
            serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
        };
        for payee in ["shop.svalin-demo.testnet", "vault2.svalin-demo.testnet", "nobody-zz9.svalin-demo.testnet", "outlayer.testnet"] {
            let report = check(&json!({ "payee": payee, "network": "testnet" }).to_string(), &curl);
            println!("{payee}: {report:?}");
            assert!(report.is_ok());
        }
    }

    #[test]
    fn the_answer_fits_outlayers_900_byte_limit() {
        let payee = format!("{}.testnet", "a".repeat(56));
        let report = run(&payee, plain(), vec![u64::MAX], vec![(u64::MAX / NONCE_PER_HEIGHT, 0)]).unwrap();
        assert!(report.to_string().len() < 900, "{report}");
    }
}
