//! How many new quartermasters, mages and apprentices this month's orders would make (`ah-x7s3`).
use serde::{Deserialize, Serialize};

/// Own units whose first STUDY order this month starts an allowance-limited skill they do not hold.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct NewStudents {
    pub quartermasters: i64,
    pub mages: i64,
    pub apprentices: i64,
}
