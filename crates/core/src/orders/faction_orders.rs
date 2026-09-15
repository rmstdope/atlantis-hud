//! Which FACTION order this turn applies, and why the others fail (`ah-7g4f`).
//!
//! Rules each piece rests on:
//! - `rules/faction`: "If you have too many mages for the number of points you try to assign to
//!   MAGIC, the FACTION order will fail. Factions may have the same requirements ... based on how
//!   many apprentices or quartermasters are controlled by the faction".
//! - `rules/tablefactionpoints`: Martial points give max tax and trade regions / quartermasters,
//!   Magic points give max mages / apprentices.
//! - `rules/playing_factions`: "The faction has 5 Faction Points" (3 in Trident).
//!
//! Facts and pure functions only; the review wires them in and the faction dropdown makes its own
//! words from them.

use serde::{Deserialize, Serialize};

use crate::movement::rules::FactionPoints;

/// A Martial/Magic split, as a FACTION order asks for it or a report's type line states it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionSplit {
    pub martial: i64,
    pub magic: i64,
}

/// The limits a split gives in the loaded world's table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionLimits {
    pub regions: i64,
    pub quartermasters: i64,
    pub mages: i64,
    pub apprentices: i64,
}

/// What a FACTION order limits by the faction's holdings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum HeldKind {
    Mages,
    Apprentices,
    Quartermasters,
}

/// Which points area a limit belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum FactionArea {
    Martial,
    Magic,
}

/// One limit the faction's holdings break: `held` of `kind`, and `area` `points` allows `allows`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct BrokenLimit {
    pub kind: HeldKind,
    pub held: i64,
    pub area: FactionArea,
    pub points: i64,
    pub allows: i64,
}

/// An order spending more points than the faction has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TooManyPoints {
    pub split: FactionSplit,
    pub total: i64,
    pub available: i64,
}

/// Why one FACTION order fails. Exactly one of the two is filled: `points` when the order spends
/// too many points (then `limits` is empty), otherwise every broken limit in the order mages,
/// apprentices, quartermasters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionFailure {
    pub points: Option<TooManyPoints>,
    pub limits: Vec<BrokenLimit>,
}

/// The applied split and its limits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AppliedFaction {
    pub split: FactionSplit,
    pub limits: FactionLimits,
}

/// What this turn's FACTION orders do, for the faction dropdown. `Default` is "no FACTION order".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionOrders {
    /// The last FACTION order that would succeed, when it changes the report's split.
    pub applied: Option<AppliedFaction>,
    /// The last FACTION order in the document that would fail.
    pub last_failure: Option<FactionFailure>,
}

/// The report's own counts, from `Faction Status:`; `None` where the report prints no such row.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Held {
    pub mages: Option<i64>,
    pub apprentices: Option<i64>,
    pub quartermasters: Option<i64>,
}

/// The report's type line read as a split: `["Martial 1", "Magic 4"]` is 1 / 4, `["Magic 5"]` is
/// 0 / 5. `None` for an empty list, an entry that is not `<word> <number>`, or any word other than
/// Martial or Magic - an older report's `War 1, Trade 1, Magic 1` is a points system this table
/// does not describe.
#[must_use]
pub fn reported_split(faction_types: &[String]) -> Option<FactionSplit> {
    if faction_types.is_empty() {
        return None;
    }
    let mut split = FactionSplit::default();
    for entry in faction_types {
        let mut words = entry.split_whitespace();
        let (Some(word), Some(number), None) = (words.next(), words.next(), words.next()) else {
            return None;
        };
        let points: i64 = number.parse().ok()?;
        if word.eq_ignore_ascii_case("martial") {
            split.martial = points;
        } else if word.eq_ignore_ascii_case("magic") {
            split.magic = points;
        } else {
            return None;
        }
    }
    Some(split)
}

/// One order judged on its own. `None` when the table has no row for one of its two points values
/// (Trident's `FACTION MAGIC 3` asks for Martial 0, which Trident's table does not state): the
/// accept-on-doubt policy, so the order is neither applied nor warned.
#[must_use]
pub fn judge(
    split: FactionSplit,
    held: &Held,
    points: &FactionPoints,
) -> Option<Result<FactionLimits, FactionFailure>> {
    let total = split.martial.saturating_add(split.magic);
    if total > points.available {
        return Some(Err(FactionFailure {
            points: Some(TooManyPoints {
                split,
                total,
                available: points.available,
            }),
            limits: Vec::new(),
        }));
    }
    let row = |value: i64| points.table.iter().find(|row| row.points == value);
    let (martial, magic) = (row(split.martial)?, row(split.magic)?);
    let limits = FactionLimits {
        regions: martial.regions,
        quartermasters: martial.quartermasters,
        mages: magic.mages,
        apprentices: magic.apprentices,
    };
    let checks = [
        (
            HeldKind::Mages,
            held.mages,
            limits.mages,
            FactionArea::Magic,
            split.magic,
        ),
        (
            HeldKind::Apprentices,
            held.apprentices,
            limits.apprentices,
            FactionArea::Magic,
            split.magic,
        ),
        (
            HeldKind::Quartermasters,
            held.quartermasters,
            limits.quartermasters,
            FactionArea::Martial,
            split.martial,
        ),
    ];
    let broken: Vec<BrokenLimit> = checks
        .into_iter()
        .filter_map(|(kind, held, allows, area, points)| {
            let held = held?;
            (held > allows).then_some(BrokenLimit {
                kind,
                held,
                area,
                points,
                allows,
            })
        })
        .collect();
    if broken.is_empty() {
        Some(Ok(limits))
    } else {
        Some(Err(FactionFailure {
            points: None,
            limits: broken,
        }))
    }
}

/// Every FACTION order in document order, settled. The second value is aligned with `orders`:
/// `Some(failure)` for each order that would fail.
#[must_use]
pub fn settle(
    orders: &[FactionSplit],
    faction_types: &[String],
    held: &Held,
    points: Option<&FactionPoints>,
) -> (FactionOrders, Vec<Option<FactionFailure>>) {
    let nothing = || (FactionOrders::default(), vec![None; orders.len()]);
    let Some(points) = points else {
        return nothing();
    };
    let reported = reported_split(faction_types);
    if !faction_types.is_empty() && reported.is_none() {
        return nothing();
    }
    let mut failures = Vec::with_capacity(orders.len());
    // The last succeeding order: `None` inside means "the report's own split".
    let mut succeeded: Option<Option<AppliedFaction>> = None;
    let mut last_failure = None;
    for &order in orders {
        if Some(order) == reported {
            succeeded = Some(None);
            failures.push(None);
            continue;
        }
        match judge(order, held, points) {
            Some(Ok(limits)) => {
                succeeded = Some(Some(AppliedFaction {
                    split: order,
                    limits,
                }));
                failures.push(None);
            }
            Some(Err(failure)) => {
                last_failure = Some(failure.clone());
                failures.push(Some(failure));
            }
            None => failures.push(None),
        }
    }
    (
        FactionOrders {
            applied: succeeded.flatten(),
            last_failure,
        },
        failures,
    )
}

fn noun(kind: HeldKind, held: i64) -> &'static str {
    match (kind, held == 1) {
        (HeldKind::Mages, true) => "mage",
        (HeldKind::Mages, false) => "mages",
        (HeldKind::Apprentices, true) => "apprentice",
        (HeldKind::Apprentices, false) => "apprentices",
        (HeldKind::Quartermasters, true) => "quartermaster",
        (HeldKind::Quartermasters, false) => "quartermasters",
    }
}

fn area_word(area: FactionArea) -> &'static str {
    match area {
        FactionArea::Martial => "MARTIAL",
        FactionArea::Magic => "MAGIC",
    }
}

/// The orders-pane message for one failing order.
#[must_use]
pub fn orders_warning(failure: &FactionFailure) -> String {
    if let Some(points) = &failure.points {
        return format!(
            "FACTION will fail - MARTIAL {} and MAGIC {} make {} points and this faction has {}",
            points.split.martial, points.split.magic, points.total, points.available
        );
    }
    let parts: Vec<String> = failure
        .limits
        .iter()
        .enumerate()
        .map(|(index, limit)| {
            format!(
                "{}{} {} and {} {} allows {}",
                if index == 0 { "the faction has " } else { "" },
                limit.held,
                noun(limit.kind, limit.held),
                area_word(limit.area),
                limit.points,
                limit.allows
            )
        })
        .collect();
    format!("FACTION will fail - {}", parts.join(", and "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::rules::FactionPointsRow;

    fn row(
        points: i64,
        regions: i64,
        quartermasters: i64,
        mages: i64,
        apprentices: i64,
    ) -> FactionPointsRow {
        FactionPointsRow {
            points,
            regions,
            quartermasters,
            mages,
            apprentices,
        }
    }

    /// New Origins, rows 0-5 as `rules/tablefactionpoints` states them.
    fn origins() -> FactionPoints {
        FactionPoints {
            available: 5,
            table: vec![
                row(0, 0, 0, 1, 1),
                row(1, 10, 2, 2, 3),
                row(2, 25, 5, 3, 5),
                row(3, 40, 9, 4, 7),
                row(4, 60, 14, 5, 10),
                row(5, 90, 25, 6, 15),
            ],
            evidence: "The faction has 5 Faction Points".to_string(),
        }
    }

    /// Trident states only rows 1 and 2.
    fn trident() -> FactionPoints {
        FactionPoints {
            available: 3,
            table: vec![row(1, 18, 7, 4, 8), row(2, 36, 14, 5, 10)],
            evidence: "The faction has 3 Faction Points".to_string(),
        }
    }

    fn split(martial: i64, magic: i64) -> FactionSplit {
        FactionSplit { martial, magic }
    }

    fn types(entries: &[&str]) -> Vec<String> {
        entries.iter().map(ToString::to_string).collect()
    }

    const NONE_HELD: Held = Held {
        mages: None,
        apprentices: None,
        quartermasters: None,
    };

    #[test]
    fn the_report_type_line_reads_as_a_split() {
        assert_eq!(
            reported_split(&types(&["Martial 1", "Magic 4"])),
            Some(split(1, 4))
        );
        assert_eq!(reported_split(&types(&["Magic 5"])), Some(split(0, 5)));
        assert_eq!(
            reported_split(&types(&["War 1", "Trade 1", "Magic 1"])),
            None
        );
        assert_eq!(reported_split(&[]), None);
    }

    #[test]
    fn a_succeeding_order_gives_the_tables_limits() {
        let held = Held {
            mages: Some(1),
            apprentices: Some(0),
            quartermasters: Some(1),
        };
        assert_eq!(
            judge(split(3, 2), &held, &origins()),
            Some(Ok(FactionLimits {
                regions: 40,
                quartermasters: 9,
                mages: 3,
                apprentices: 5,
            }))
        );
    }

    #[test]
    fn too_many_mages_fail_the_order() {
        let held = Held {
            mages: Some(5),
            ..NONE_HELD
        };
        assert_eq!(
            judge(split(3, 2), &held, &origins()),
            Some(Err(FactionFailure {
                points: None,
                limits: vec![BrokenLimit {
                    kind: HeldKind::Mages,
                    held: 5,
                    area: FactionArea::Magic,
                    points: 2,
                    allows: 3,
                }],
            }))
        );
    }

    #[test]
    fn every_broken_limit_is_named() {
        let held = Held {
            mages: Some(5),
            apprentices: Some(2),
            quartermasters: None,
        };
        let Some(Err(failure)) = judge(split(5, 0), &held, &origins()) else {
            panic!("expected a failure");
        };
        assert_eq!(
            failure.limits,
            vec![
                BrokenLimit {
                    kind: HeldKind::Mages,
                    held: 5,
                    area: FactionArea::Magic,
                    points: 0,
                    allows: 1,
                },
                BrokenLimit {
                    kind: HeldKind::Apprentices,
                    held: 2,
                    area: FactionArea::Magic,
                    points: 0,
                    allows: 1,
                },
            ]
        );
    }

    #[test]
    fn quartermasters_are_limited_by_martial_points() {
        let held = Held {
            quartermasters: Some(1),
            ..NONE_HELD
        };
        let Some(Err(failure)) = judge(split(0, 5), &held, &origins()) else {
            panic!("expected a failure");
        };
        assert_eq!(
            failure.limits,
            vec![BrokenLimit {
                kind: HeldKind::Quartermasters,
                held: 1,
                area: FactionArea::Martial,
                points: 0,
                allows: 0,
            }]
        );
    }

    #[test]
    fn more_points_than_the_faction_has_fail() {
        assert_eq!(
            judge(split(4, 3), &NONE_HELD, &origins()),
            Some(Err(FactionFailure {
                points: Some(TooManyPoints {
                    split: split(4, 3),
                    total: 7,
                    available: 5,
                }),
                limits: vec![],
            }))
        );
    }

    #[test]
    fn a_points_value_the_table_does_not_state_is_not_judged() {
        assert_eq!(judge(split(0, 3), &NONE_HELD, &trident()), None);
    }

    #[test]
    fn the_last_succeeding_order_applies() {
        let (orders, failures) = settle(
            &[split(2, 1), split(3, 2)],
            &types(&["Martial 1", "Magic 1"]),
            &NONE_HELD,
            Some(&origins()),
        );
        assert_eq!(
            orders,
            FactionOrders {
                applied: Some(AppliedFaction {
                    split: split(3, 2),
                    limits: FactionLimits {
                        regions: 40,
                        quartermasters: 9,
                        mages: 3,
                        apprentices: 5,
                    },
                }),
                last_failure: None,
            }
        );
        assert_eq!(failures, vec![None, None]);
    }

    #[test]
    fn a_later_failure_leaves_the_earlier_order_applied() {
        let held = Held {
            mages: Some(1),
            ..NONE_HELD
        };
        let (orders, failures) = settle(
            &[split(3, 2), split(4, 3)],
            &types(&["Martial 1", "Magic 1"]),
            &held,
            Some(&origins()),
        );
        assert_eq!(
            orders.applied.map(|applied| applied.split),
            Some(split(3, 2))
        );
        let points = orders.last_failure.and_then(|failure| failure.points);
        assert_eq!(
            points.map(|points| (points.total, points.available)),
            Some((7, 5))
        );
        assert!(failures[0].is_none());
        assert!(failures[1].is_some());
        assert_eq!(failures.len(), 2);
    }

    #[test]
    fn every_failing_order_is_returned() {
        let (orders, failures) = settle(
            &[split(4, 3), split(5, 5)],
            &types(&["Martial 1", "Magic 1"]),
            &NONE_HELD,
            Some(&origins()),
        );
        assert!(failures.iter().all(Option::is_some));
        assert_eq!(orders.applied, None);
        assert_eq!(
            orders
                .last_failure
                .and_then(|failure| failure.points)
                .map(|points| points.total),
            Some(10)
        );
    }

    #[test]
    fn an_order_for_the_reported_split_changes_nothing() {
        let (orders, failures) = settle(
            &[split(1, 1)],
            &types(&["Martial 1", "Magic 1"]),
            &NONE_HELD,
            Some(&origins()),
        );
        assert_eq!(orders, FactionOrders::default());
        assert_eq!(failures, vec![None]);
    }

    #[test]
    fn the_last_order_returning_to_the_reported_split_wins() {
        let (orders, _) = settle(
            &[split(3, 2), split(1, 1)],
            &types(&["Martial 1", "Magic 1"]),
            &NONE_HELD,
            Some(&origins()),
        );
        assert_eq!(orders.applied, None);
    }

    #[test]
    fn no_table_changes_nothing() {
        let (orders, failures) = settle(
            &[split(4, 3)],
            &types(&["Martial 1", "Magic 1"]),
            &NONE_HELD,
            None,
        );
        assert_eq!(orders, FactionOrders::default());
        assert_eq!(failures, vec![None]);
    }

    #[test]
    fn a_war_and_trade_report_changes_nothing() {
        let (orders, failures) = settle(
            &[split(4, 3), split(3, 2)],
            &types(&["War 1", "Trade 1", "Magic 1"]),
            &NONE_HELD,
            Some(&origins()),
        );
        assert_eq!(orders, FactionOrders::default());
        assert_eq!(failures, vec![None, None]);
    }

    #[test]
    fn the_orders_warning_reads_as_agreed() {
        let limit = |kind, held, area, points, allows| BrokenLimit {
            kind,
            held,
            area,
            points,
            allows,
        };
        let limits = |limits| FactionFailure {
            points: None,
            limits,
        };
        assert_eq!(
            orders_warning(&limits(vec![limit(
                HeldKind::Mages,
                5,
                FactionArea::Magic,
                2,
                3
            )])),
            "FACTION will fail - the faction has 5 mages and MAGIC 2 allows 3"
        );
        assert_eq!(
            orders_warning(&limits(vec![
                limit(HeldKind::Mages, 5, FactionArea::Magic, 0, 1),
                limit(HeldKind::Apprentices, 2, FactionArea::Magic, 0, 1),
            ])),
            "FACTION will fail - the faction has 5 mages and MAGIC 0 allows 1, and 2 apprentices and MAGIC 0 allows 1"
        );
        assert_eq!(
            orders_warning(&limits(vec![limit(
                HeldKind::Quartermasters,
                1,
                FactionArea::Martial,
                0,
                0
            )])),
            "FACTION will fail - the faction has 1 quartermaster and MARTIAL 0 allows 0"
        );
        assert_eq!(
            orders_warning(&FactionFailure {
                points: Some(TooManyPoints {
                    split: split(4, 3),
                    total: 7,
                    available: 5,
                }),
                limits: vec![],
            }),
            "FACTION will fail - MARTIAL 4 and MAGIC 3 make 7 points and this faction has 5"
        );
    }
}
