//! A `BUY` or `SELL` written with an `EXCEPT`, which neither order has.
//!
//! `rules/sell` and `rules/buy` give each order `[quantity] [item]` and `ALL [item]` only; the
//! reserve form belongs to `GIVE` (`rules/give`). The game stops reading once the form is complete,
//! so the reserve is ignored and the order sells or buys as if it were not written - which is why
//! this is an error on the ignored words and not a reason to read the order differently.

use super::lexer::{byte_offset, Token};

pub(super) const TRADE_EXCEPT: &str = "trade-except";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct IgnoredExcept {
    /// UTF-16 columns of the ignored words, `EXCEPT` through the order's last argument token.
    pub column_start: usize,
    pub column_end: usize,
    pub message: String,
}

/// `Some` when `order_name` is `"BUY"` or `"SELL"`, the grammar consumed exactly its two
/// arguments, and the first token it did not consume is `EXCEPT` (any case).
pub(super) fn ignored_except(
    order_name: &str,
    line_text: &str,
    arguments: &[Token],
    consumed: usize,
) -> Option<IgnoredExcept> {
    if !matches!(order_name, "BUY" | "SELL") || consumed != 2 {
        return None;
    }
    let except = arguments.get(2).filter(|token| token.is("EXCEPT"))?;
    let column_start = except.column_start;
    let column_end = arguments.last()?.column_end;
    let ignored =
        &line_text[byte_offset(line_text, column_start)..byte_offset(line_text, column_end)];
    let item = &arguments[1].text;
    let all = arguments[0].is("ALL");
    let n = &arguments[0].text;
    let message = match (order_name, all) {
        ("SELL", true) => {
            format!("SELL has no EXCEPT — the game ignores “{ignored}” and sells all your {item}")
        }
        ("SELL", false) => {
            format!("SELL has no EXCEPT — the game ignores “{ignored}” and sells {n} {item}")
        }
        (_, true) => format!(
            "BUY has no EXCEPT — the game ignores “{ignored}” and buys as much {item} as you can afford"
        ),
        (_, false) => {
            format!("BUY has no EXCEPT — the game ignores “{ignored}” and buys {n} {item}")
        }
    };
    Some(IgnoredExcept {
        column_start,
        column_end,
        message,
    })
}
