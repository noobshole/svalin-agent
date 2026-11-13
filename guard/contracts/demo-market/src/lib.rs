//! A testnet stand-in for a market, for the vault's buy scenes.
//!
//! The tokens the Svalin Index grades trade only on mainnet, so on testnet nothing can be swapped
//! into them. This contract takes the order the vault sends, in Ref Finance's `ft_on_transfer`
//! message format, records it as an `order_filled` event and keeps what it was sent. It returns no
//! tokens. On mainnet the vault's market is Ref Finance itself.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    owner: AccountId,
    orders: u64,
}

#[near]
impl Market {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, orders: 0 }
    }

    /// NEP-141: called by the token the order pays in. Fills the order in full and keeps the tokens.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let order: Value = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("The message must be a swap order"));
        let action = &order["actions"][0];
        let token_in = action["token_in"].as_str().unwrap_or_default();
        require!(token_in == env::predecessor_account_id().as_str(), "token_in must be the token that was sent");
        require!(action["token_out"].is_string(), "The order must name token_out");
        self.orders += 1;
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({
                "standard": "svalin-demo-market", "version": "1.0.0", "event": "order_filled",
                "data": [{
                    "order": self.orders, "from": sender_id, "token_in": token_in, "amount_in": amount,
                    "token_out": action["token_out"], "pool_id": action["pool_id"], "min_amount_out": action["min_amount_out"],
                }],
            })
        ));
        U128(0)
    }

    pub fn orders(&self) -> u64 {
        self.orders
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn from_token(token: &str) {
        let mut context = VMContextBuilder::new();
        context.predecessor_account_id(token.parse().unwrap());
        testing_env!(context.build());
    }

    #[test]
    fn fills_an_order_from_the_token_it_names_and_keeps_the_tokens() {
        from_token("usdc.testnet");
        let mut market = Market::new("owner.testnet".parse().unwrap());
        let msg = r#"{"actions":[{"pool_id":7,"token_in":"usdc.testnet","token_out":"hoot.near","min_amount_out":"1"}]}"#;
        assert_eq!(market.ft_on_transfer("vault.testnet".parse().unwrap(), U128(99_900), msg.into()), U128(0));
        assert_eq!(market.orders(), 1);
        assert!(get_logs()[0].contains(r#""token_out":"hoot.near""#));
    }

    #[test]
    #[should_panic(expected = "token_in must be the token that was sent")]
    fn refuses_an_order_for_another_token() {
        from_token("usdc.testnet");
        let mut market = Market::new("owner.testnet".parse().unwrap());
        let msg = r#"{"actions":[{"pool_id":7,"token_in":"wrap.testnet","token_out":"hoot.near","min_amount_out":"1"}]}"#;
        market.ft_on_transfer("vault.testnet".parse().unwrap(), U128(1), msg.into());
    }
}
