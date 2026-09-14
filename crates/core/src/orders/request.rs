//! One request per order check crossing the shell boundary.
//!
//! Both shells hand the request over as it arrived and call the builder here, so the options a check
//! runs under are assembled once rather than once per shell. Adding an input is a field on the
//! request, a line in its builder, and the caller that fills it in.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::cache::ReportCache;

use super::semantics::CheckOptions;

/// Everything one validation reads, exactly as a shell hands it over.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct ValidateOrdersRequest {
    /// The orders document as the editor holds it.
    pub raw_orders: String,
    /// The served ruleset; `null` leaves item names unchecked and checks everything else.
    pub ruleset_json: Option<String>,
    /// The turn the orders were written for; `null` is the syntax check alone.
    pub raw_report: Option<String>,
    /// Advisory codes not to emit; `null` is the core's own default (`hex-unguarded` off).
    pub disabled_codes: Option<Vec<String>>,
    /// The map's own shape, or `null` for a game that never recorded one.
    pub map_json: Option<String>,
    /// Every inner passage the faction has proved the far side of, as JSON; `null` for none.
    pub known_passages_json: Option<String>,
    /// The remembered map, so a shipment is measured from where each unit ends the month.
    pub remembered_json: Option<String>,
}

/// Everything one orders preview reads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct PreviewOrdersRequest {
    pub ruleset_json: String,
    pub raw_report: String,
    pub remembered_json: String,
    /// The whole document, not one unit's block.
    pub orders_document: String,
    /// The map's shape, or `""` for a game that never recorded one.
    pub map_json: String,
    /// Every inner passage the faction has proved the far side of, as JSON. `""` for none.
    pub passages_json: String,
    /// Advisory codes that are off; `null` is the core's own default.
    pub disabled_codes: Option<Vec<String>>,
}

/// Validates one order draft. Never fails: bad configuration is answered conservatively.
///
/// Without a report the answer is the syntax check alone; with one it covers the checks that read
/// what each unit holds and where it stands.
#[must_use]
pub fn validate_orders_request(
    cache: &mut ReportCache,
    request: &ValidateOrdersRequest,
) -> crate::OrderValidationResult {
    // A shape that cannot be read is treated as no shape at all, which silences the one check that
    // measures a distance rather than failing the whole validation: bad config, not bad orders -
    // exactly how an unusable ruleset is already treated here (`ah-7ale.2.2.1`).
    let geometry = request
        .map_json
        .as_deref()
        .and_then(|json| crate::movement::graph::geometry_from_json(json).ok())
        .flatten();
    let mut options = CheckOptions {
        disabled: disabled_or_default(request.disabled_codes.as_deref()),
        geometry,
        shown: Default::default(),
        // Validation has no error channel, so a list that will not read is nothing known and the
        // warning simply stays: an advisory pane that answers conservatively beats one that
        // refuses to answer (`ah-3u7c.2.2`).
        known_passages: request
            .known_passages_json
            .as_deref()
            .and_then(|json| crate::movement::passages::known_passages_from_json(json).ok())
            .unwrap_or_default(),
        month_end: Default::default(),
        walled_moves: Default::default(),
    };

    // Both the ruleset and the report come from the cache. This runs every time the player stops
    // typing, and re-reading a seventy-kilobyte ruleset and re-parsing four hundred units to reach
    // the same two objects would be the whole cost of the feature. A ruleset that cannot be used is
    // treated as no ruleset at all, as everywhere else: bad config, not bad orders.
    //
    // The report is classified where a ruleset allows it. A headcount that is a guess prices no
    // study, so the unclassified parse would silence every studying unit in the turn.
    let ruleset_json = request.ruleset_json.as_deref();
    let ruleset = ruleset_json.and_then(|json| cache.ruleset(json).ok());
    let report = request
        .raw_report
        .as_deref()
        .map(|raw| cache.classified_when_possible(raw, ruleset_json));
    // Where each unit ends the month, so a shipment is measured after the moves
    // (`rules/sequenceofevents`, `ah-b6fz`), and how far the reports have shown the world
    // (`ah-hc7z`). An error is nothing known - bad config, not bad orders - and every shipment is
    // measured from the report, with a distance the map's shape leaves open staying open, as
    // before. One build of the known map answers both.
    if let (Some(rules), Some(raw), Some(remembered)) = (
        ruleset_json,
        request.raw_report.as_deref(),
        request.remembered_json.as_deref(),
    ) {
        let measures = super::effects::shipment_measures(
            cache,
            rules,
            raw,
            remembered,
            &request.raw_orders,
            request.map_json.as_deref().unwrap_or(""),
            options.clone(),
        )
        .unwrap_or_default();
        options.shown = measures.shown;
        options.month_end = measures.month_end;
        // Every own unit whose MOVE crosses a wall a report proves, including one only an old
        // sighting shows. An error is nothing known - bad config, not bad orders - and no wall is
        // warned about (`ah-wq2e.4`).
        options.walled_moves = super::effects::walled_moves(
            cache,
            rules,
            raw,
            remembered,
            &request.raw_orders,
            options.geometry,
        )
        .unwrap_or_default();
    }

    super::validate_turn(
        &request.raw_orders,
        ruleset.as_deref(),
        report.as_deref(),
        options,
    )
}

/// What the orders document makes of the faction's units, region by region.
///
/// # Errors
///
/// As [`super::effects::preview_orders_on_map`].
pub fn preview_orders_request(
    cache: &mut ReportCache,
    request: &PreviewOrdersRequest,
) -> Result<super::effects::OrdersPreviewResponse, String> {
    // `geometry` stays `None`: the forecast takes the map's shape from `map_json`, which it needs
    // for the movement trace anyway, and reads this field not at all. It works out `shown` from the
    // map it draws and `month_end` from the trace it draws (`ah-b6fz`), so only the `disabled` set
    // crosses into the preview (`ah-7ale.2.2.2`).
    let options = CheckOptions {
        disabled: disabled_or_default(request.disabled_codes.as_deref()),
        ..CheckOptions::default()
    };
    super::effects::preview_orders_on_map(
        cache,
        &request.ruleset_json,
        &request.raw_report,
        &request.remembered_json,
        &request.orders_document,
        &request.map_json,
        &request.passages_json,
        options,
    )
}

/// `None` is `CheckOptions::default().disabled`, so the default is written in one place: absent
/// means the conservative default, `hex-unguarded` off.
fn disabled_or_default(codes: Option<&[String]>) -> BTreeSet<String> {
    codes.map_or_else(
        || CheckOptions::default().disabled,
        |codes| codes.iter().cloned().collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn default_disabled() -> Vec<String> {
        CheckOptions::default().disabled.into_iter().collect()
    }

    #[test]
    fn a_validation_request_reads_the_keys_typescript_writes() {
        let request: ValidateOrdersRequest = serde_json::from_str(
            r#"{"rawOrders":"unit 5\nWORK\n","rulesetJson":null,"disabledCodes":["hex-unguarded"]}"#,
        )
        .expect("reads");
        assert_eq!(
            request,
            ValidateOrdersRequest {
                raw_orders: "unit 5\nWORK\n".into(),
                disabled_codes: Some(vec!["hex-unguarded".into()]),
                ..Default::default()
            }
        );
    }

    #[test]
    fn a_preview_request_reads_the_keys_typescript_writes() {
        let request: PreviewOrdersRequest = serde_json::from_str(
            r#"{"rulesetJson":"r","rawReport":"p","rememberedJson":"[]","ordersDocument":"o",
                "mapJson":"m","passagesJson":"s","disabledCodes":[]}"#,
        )
        .expect("reads");
        assert_eq!(
            request,
            PreviewOrdersRequest {
                ruleset_json: "r".into(),
                raw_report: "p".into(),
                remembered_json: "[]".into(),
                orders_document: "o".into(),
                map_json: "m".into(),
                passages_json: "s".into(),
                disabled_codes: Some(Vec::new()),
            }
        );
    }

    /// `disabled_codes: None` and the explicit conservative default must agree, or a caller that
    /// omits the argument would silently see different checks than one that spells the default
    /// out. `"unit 5\nWORK\n"` is the orders text `hex-unguarded` fires on when it is enabled
    /// (`crates/core/src/orders/semantics.rs`'s `the_broad_guard_check_reports_an_unguarded_hex_when_it_is_asked_to`).
    #[test]
    fn absent_disabled_codes_validate_like_the_conservative_default() {
        let absent = ValidateOrdersRequest {
            raw_orders: "unit 5\nWORK\n".into(),
            ..Default::default()
        };
        let spelled = ValidateOrdersRequest {
            disabled_codes: Some(default_disabled()),
            ..absent.clone()
        };
        assert_eq!(
            validate_orders_request(&mut ReportCache::new(), &absent),
            validate_orders_request(&mut ReportCache::new(), &spelled)
        );
    }

    /// `ah-7ale.2.2.2`: a caller that omits the list forecasts the same month as one that spells
    /// the core's own default out, so the default lives in Rust once.
    #[test]
    fn absent_disabled_codes_preview_the_same_month_as_the_conservative_default() {
        let absent = PreviewOrdersRequest {
            ruleset_json: RULESET.into(),
            raw_report: "Foo (1) Report\n\nplain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n".into(),
            remembered_json: "[]".into(),
            orders_document: "unit 900\nNAME UNIT \"Renamed\"\n".into(),
            ..Default::default()
        };
        let spelled = PreviewOrdersRequest {
            disabled_codes: Some(default_disabled()),
            ..absent.clone()
        };
        assert_eq!(
            preview_orders_request(&mut ReportCache::new(), &absent),
            preview_orders_request(&mut ReportCache::new(), &spelled)
        );
    }

    /// The wall a report proves reaches the Problems check only through the remembered map the
    /// shell hands over (`ah-wq2e.4`).
    #[test]
    fn validation_warns_about_a_move_into_a_wall_with_the_remembered_map() {
        let report = "Foo (1) Report\n\
                      \n\
                      plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\
                      \n\
                      Exits:\n  \
                        Southeast : plain (2,2) in Nowhere.\n\
                      \n\
                      * Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\
                      \n\
                      plain (2,2) in Nowhere, contains Harrowby [village], 10 peasants (orcs), $5.\n\
                      \n\
                      Exits:\n  \
                        Northwest : plain (1,1) in Nowhere.\n  \
                        Southeast : plain (3,3) in Nowhere.\n\
                      \n\
                      plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\
                      \n\
                      Exits:\n  \
                        Northwest : plain (2,2) in Nowhere.\n\
                      \n";
        let walls = |remembered: Option<&str>| -> usize {
            let request = ValidateOrdersRequest {
                raw_orders: "unit 900\nMOVE NE\n".into(),
                ruleset_json: Some(RULESET.into()),
                raw_report: Some(report.into()),
                remembered_json: remembered.map(str::to_string),
                ..Default::default()
            };
            validate_orders_request(&mut ReportCache::new(), &request)
                .diagnostics
                .into_iter()
                .filter(|diagnostic| diagnostic.code == "move-into-a-wall")
                .count()
        };

        assert_eq!(walls(Some("[]")), 1);
        assert_eq!(walls(None), 0);
    }

    /// `ah-b6fz`: validation given the remembered map measures a shipment from where the
    /// quartermaster ends the month (`rules/sequenceofevents`), end to end through the request.
    #[test]
    fn validation_measures_a_shipment_after_the_quartermasters_move() {
        let mut lines = vec!["Foo (1) Report".to_string(), String::new()];
        for y in (0..=10).step_by(2) {
            lines.push(format!("plain (0,{y}) in Nowhere, 10 peasants (orcs), $5."));
            lines.push(String::new());
            lines.push("Exits:".to_string());
            if y > 0 {
                lines.push(format!("  North : plain (0,{}) in Nowhere.", y - 2));
            }
            if y < 10 {
                lines.push(format!("  South : plain (0,{}) in Nowhere.", y + 2));
            }
            lines.push(String::new());
            if y == 0 {
                lines.push(
                    "* Source (900), Foo (1), leader [LEAD], 5 stone [STON]. Weight: 60. \
                     Capacity: 0/0/70/0."
                        .to_string(),
                );
                lines.push(String::new());
            }
            if y == 4 {
                lines.push("+ Post One [1] : Caravanserai.".to_string());
                lines.push(
                    "  * Quarterone (901), Foo (1), leader [LEAD]. Weight: 10. \
                     Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 1 (450)."
                        .to_string(),
                );
                lines.push(String::new());
            }
        }
        let report = lines.join("\n");
        let reach = |remembered: Option<&str>| -> Vec<String> {
            let request = ValidateOrdersRequest {
                raw_orders: "unit 900\nTRANSPORT 901 5 STON\nunit 901\nMOVE S\n".into(),
                ruleset_json: Some(RULESET.into()),
                raw_report: Some(report.clone()),
                map_json: Some(r#"{"width":72,"height":96,"wrapX":false,"wrapY":false}"#.into()),
                remembered_json: remembered.map(str::to_string),
                ..Default::default()
            };
            validate_orders_request(&mut ReportCache::new(), &request)
                .diagnostics
                .into_iter()
                .filter(|diagnostic| diagnostic.code == "transport-out-of-reach")
                .map(|diagnostic| diagnostic.message)
                .collect()
        };

        assert_eq!(
            reach(Some("[]")),
            vec!["Unit 901 is 3 hexes away and takes goods from 2 hexes, so 5 STON stay with this unit.".to_string()]
        );
        // Without the remembered map the shipment is measured from the report, as before.
        assert_eq!(reach(None), Vec::<String>::new());
    }
}
