//! What this turn is expected to use from the faction's unclaimed-silver fund.

use serde::{Deserialize, Serialize};

/// The part of the unclaimed fund this turn uses, split by why it is drawn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UnclaimedSilverUse {
    pub claims: UnclaimedSilverUseGroup,
    pub withdrawals: UnclaimedSilverUseGroup,
    pub maintenance: UnclaimedSilverUseGroup,
    pub used: i64,
    pub remaining: i64,
    pub not_counted: Vec<UnclaimedSilverRejection>,
}

/// One source's total and the units that account for it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UnclaimedSilverUseGroup {
    pub amount: i64,
    pub entries: Vec<UnclaimedSilverUseEntry>,
}

/// One unit's contribution to a source of unclaimed-fund use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UnclaimedSilverUseEntry {
    pub unit_name: String,
    pub unit_id: String,
    pub amount: i64,
    pub detail: Option<String>,
}

/// A WITHDRAW order that does not draw on the fund, and why it does not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UnclaimedSilverRejection {
    pub unit_name: String,
    pub unit_id: String,
    pub order: String,
    pub amount: Option<i64>,
    pub reason: UnclaimedSilverRejectionReason,
}

/// Why a WITHDRAW order is excluded from the forecast.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum UnclaimedSilverRejectionReason {
    InsufficientFunds,
    NotBasicItem,
    Nexus,
}
