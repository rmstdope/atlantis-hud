//! The core's pure functions (parsing, planning, validation, map export), bound for the browser
//! bundle. Persistence is not part of this crate: the desktop reads and writes through
//! `core-tauri`'s Tauri commands, and the web has its own store in `@atlantis/browser-core`, over
//! IndexedDB.

use atlantis_hud_core::report::merge::{merge_report_into_sightings, StoredSighting};
use atlantis_hud_core::report::sighting::{region_sightings, RegionSighting};
use atlantis_hud_core::{
    diff_imported_turn, engine_info, reject_import, reject_merge, ImportedTurnSnapshot,
    OrderCheckOptions, OrderDiagnosticSeverity, OrderValidationResult, ReportParseResult,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Converts a value into a plain JavaScript object.
///
/// Two defaults have to be overridden for TypeScript to read what Rust writes.
///
/// `serde_wasm_bindgen::to_value` emits a JS `Map` for anything map-shaped, and `#[serde(flatten)]`
/// makes a struct map-shaped; a `Map` does not answer property access, so every field would read
/// as `undefined`. It also emits `undefined` for `Option::None`, which fails the `=== null` checks
/// the TypeScript side writes against its own `T | null` types. Always go through this.
fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_maps_as_objects(true)
        .serialize_missing_as_null(true);
    value
        .serialize(&serializer)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfoDto {
    id: String,
    name: String,
    ruleset_version: String,
    max_faction_count: u16,
}

/// Everything the browser storage adapter needs to persist one import.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreparedImportDto {
    turn_number: Option<u32>,
    candidate: ImportedTurnSnapshot,
    /// Every region the report described, ready to be written one row at a time.
    ///
    /// Serialized here rather than in the browser. The storage adapter used to ask for the whole
    /// parsed model back and stringify each region itself, which meant converting eleven regions
    /// and some four hundred and fifty units into JavaScript objects only to turn them straight
    /// back into text. These are already text, so only the text crosses.
    region_sightings: Vec<RegionSighting>,
    parse_result: ReportParseResultDto,
    /// `None` when the report may be imported; otherwise why it may not be.
    rejection: Option<String>,
}

/// Everything the browser storage adapter needs to complete one merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreparedMergeDto {
    turn_number: Option<u32>,
    merged_faction_id: Option<String>,
    merged_faction_name: Option<String>,
    /// Only the rows that changed, ready to be written under the viewer's faction.
    region_sightings: Vec<RegionSighting>,
    merged_region_count: u32,
    new_region_count: u32,
    /// `None` when the report may be merged; otherwise why it may not be.
    rejection: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderDiagnosticDto {
    code: String,
    message: String,
    line_start: Option<usize>,
    line_end: Option<usize>,
    column_start: Option<usize>,
    column_end: Option<usize>,
    region_id: Option<String>,
    unit_id: Option<String>,
    severity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderValidationResultDto {
    diagnostics: Vec<OrderDiagnosticDto>,
}

impl From<OrderValidationResult> for OrderValidationResultDto {
    fn from(value: OrderValidationResult) -> Self {
        Self {
            diagnostics: value
                .diagnostics
                .into_iter()
                .map(|diagnostic| OrderDiagnosticDto {
                    code: diagnostic.code,
                    message: diagnostic.message,
                    line_start: diagnostic.line_start,
                    line_end: diagnostic.line_end,
                    column_start: diagnostic.column_start,
                    column_end: diagnostic.column_end,
                    region_id: diagnostic.region_id,
                    unit_id: diagnostic.unit_id,
                    severity: match diagnostic.severity {
                        OrderDiagnosticSeverity::Warning => "warning".to_string(),
                        OrderDiagnosticSeverity::Error => "error".to_string(),
                    },
                })
                .collect(),
        }
    }
}

/// Wrapper over `ReportParseResult` that includes the computed threshold boolean.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportParseResultDto {
    #[serde(flatten)]
    inner: ReportParseResult,
    meets_minimum_import_threshold: bool,
}

impl From<ReportParseResult> for ReportParseResultDto {
    fn from(value: ReportParseResult) -> Self {
        let threshold = value.meets_minimum_import_threshold();
        Self {
            inner: value,
            meets_minimum_import_threshold: threshold,
        }
    }
}

impl From<atlantis_hud_core::EngineInfo> for EngineInfoDto {
    fn from(value: atlantis_hud_core::EngineInfo) -> Self {
        Self {
            id: value.id,
            name: value.name,
            ruleset_version: value.ruleset_version,
            max_faction_count: value.max_faction_count,
        }
    }
}

/// Returns engine metadata serialized as a JS object.
#[wasm_bindgen]
pub fn get_engine_info() -> Result<JsValue, JsValue> {
    to_js(&EngineInfoDto::from(engine_info()))
}

/// Parses one report and returns tolerant parser output including the viability threshold flag.
#[wasm_bindgen]
pub fn parse_report_state(raw_report: String) -> Result<JsValue, JsValue> {
    let report = atlantis_hud_core::cache::with_global(|cache| cache.report(&raw_report));
    let parsed = ReportParseResultDto::from(atlantis_hud_core::summarize(&report));
    to_js(&parsed)
}

/// Parses a report and returns everything needed to store it, alongside the parse result.
///
/// The browser has no SQLite, so its storage adapter supplies the read and the write while every
/// rule about what gets stored stays here.
#[wasm_bindgen]
pub fn prepare_report_import_state(
    raw_report: String,
    confirmed_faction_id: String,
    ruleset_json: Option<String>,
) -> Result<JsValue, JsValue> {
    // The report the shell already showed is the report being imported, so this is a cache hit and
    // no parsing happens here at all. Both shapes come off the one model: the flat summary the
    // import rules are decided against, and the regions that get remembered one by one.
    //
    // Classified when the shell has a ruleset, exactly as the turn on screen is. The sightings are
    // the only account of a hex the map ever reads back, so an estimate stored here would put a
    // tilde on every remembered unit forever, however complete the catalogue.
    let full = atlantis_hud_core::cache::with_global(|cache| {
        cache.classified_when_possible(&raw_report, ruleset_json.as_deref())
    });
    let parsed = atlantis_hud_core::summarize(&full);
    let turn_number = parsed.turn_header.as_ref().map(|header| header.turn_number);
    let rejection = reject_import(&parsed, &confirmed_faction_id);

    let candidate = ImportedTurnSnapshot {
        parsed_payload_json: serde_json::to_string(&parsed)
            .map_err(|error| JsValue::from_str(&error.to_string()))?,
        warnings_payload_json: serde_json::to_string(&parsed.warnings)
            .map_err(|error| JsValue::from_str(&error.to_string()))?,
        raw_report,
    };

    let prepared = PreparedImportDto {
        turn_number,
        candidate,
        // An unimportable report has no turn to file its regions under, so it contributes none.
        region_sightings: turn_number
            .map(|turn| region_sightings(&full, turn))
            .unwrap_or_default(),
        parse_result: ReportParseResultDto::from(parsed),
        rejection,
    };

    to_js(&prepared)
}

/// Folds an allied report into a stored map and returns the rows to write.
///
/// The counterpart of [`prepare_report_import_state`] for issue #53. The browser supplies the read
/// and the write - it hands over what it has stored for the viewer's faction and writes back what
/// comes out - while every rule about which account of a hex wins stays in the core, so a hex
/// merged in the browser and the same hex merged on the desktop cannot come out different.
///
/// `existing_sightings_json` is what the store already holds for the *viewer*, as
/// `[{ regionId, lastSeenTurn, payloadJson }]`. That is the whole of what a merge reads, and the
/// whole of what the browser's own row shape can offer.
///
/// # Errors
///
/// Returns an error when the stored sightings cannot be read as JSON, or when the outcome cannot be
/// handed back to JavaScript. A report that may not be merged is not an error: it comes back with
/// `rejection` set, so the caller can say why in the same shape it says everything else.
#[wasm_bindgen]
pub fn prepare_report_merge_state(
    raw_report: String,
    viewer_turn_number: u32,
    existing_sightings_json: String,
    ruleset_json: Option<String>,
) -> Result<JsValue, JsValue> {
    let existing: Vec<StoredSighting> = serde_json::from_str(&existing_sightings_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    // Classified for the same reason an import is: the ally's units enter the map through these
    // sightings and nowhere else, so what is stored here is what the table will draw.
    let report = atlantis_hud_core::cache::with_global(|cache| {
        cache.classified_when_possible(&raw_report, ruleset_json.as_deref())
    });
    let parse_result = atlantis_hud_core::summarize(&report);

    // `reject_merge`, never `reject_import`. The latter asks whether a report may be filed under a
    // faction, and answers from a candidate list that holds only the reporting faction - so it
    // refuses every ally there is.
    if let Some(rejection) = reject_merge(&parse_result, viewer_turn_number) {
        return to_js(&PreparedMergeDto {
            turn_number: parse_result.turn_header.as_ref().map(|it| it.turn_number),
            merged_faction_id: None,
            merged_faction_name: None,
            region_sightings: Vec::new(),
            merged_region_count: 0,
            new_region_count: 0,
            rejection: Some(rejection),
        });
    }

    // Clearing the threshold means the report named its faction, so this is present.
    let ally = parse_result.detected_factions.first();
    let outcome = merge_report_into_sightings(&existing, &report, viewer_turn_number);

    to_js(&PreparedMergeDto {
        turn_number: Some(viewer_turn_number),
        merged_faction_id: ally.map(|faction| faction.faction_id.clone()),
        merged_faction_name: ally.map(|faction| faction.name.clone()),
        region_sightings: outcome.sightings,
        merged_region_count: u32::try_from(outcome.merged_region_count).unwrap_or(u32::MAX),
        new_region_count: u32::try_from(outcome.new_region_count).unwrap_or(u32::MAX),
        rejection: None,
    })
}

/// Rebuilds a parse result from a stored payload, recomputing the import threshold.
///
/// The threshold is a domain rule, so a storage adapter must never derive it itself.
#[wasm_bindgen]
pub fn hydrate_parse_result_state(parsed_payload_json: String) -> Result<JsValue, JsValue> {
    let parsed = serde_json::from_str::<ReportParseResult>(&parsed_payload_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&ReportParseResultDto::from(parsed))
}

/// Compares a prepared import candidate against the stored snapshot, if any.
///
/// Pass `null` for `existing` when nothing is stored under the key.
#[wasm_bindgen]
pub fn diff_imported_turn_state(existing: JsValue, candidate: JsValue) -> Result<JsValue, JsValue> {
    let existing: Option<ImportedTurnSnapshot> = if existing.is_null() || existing.is_undefined() {
        None
    } else {
        Some(
            serde_wasm_bindgen::from_value(existing)
                .map_err(|error| JsValue::from_str(&error.to_string()))?,
        )
    };
    let candidate: ImportedTurnSnapshot = serde_wasm_bindgen::from_value(candidate)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let diff = diff_imported_turn(existing.as_ref(), &candidate);
    to_js(&diff)
}

/// Parses a report and counts each unit's men against the catalogue.
#[wasm_bindgen]
pub fn parse_report_classified_state(
    raw_report: String,
    ruleset_json: String,
) -> Result<JsValue, JsValue> {
    // The lock is released before serializing: the model is large, and the cache is of no use to
    // anyone while it is being converted into JS objects.
    let report = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::parse_and_classify(cache, &raw_report, &ruleset_json)
    });
    to_js(&*report)
}

/// Plans a route for one unit against a ruleset the caller supplies.
///
/// Available on every target: planning needs no native backing, unlike the persistence entry
/// points. The ruleset arrives as text because the shell loads it from a served file - the core
/// never touches a filesystem, which is what keeps it compiling to wasm at all.
///
/// The call is stateless in the sense that matters: there is no session to open and none to
/// invalidate, because the report text is itself the key the core remembers its last parse under.
/// Planning the same turn twice therefore parses nothing the second time. See
/// `atlantis_hud_core::cache`.
///
/// A route that cannot be planned resolves rather than rejecting: the reason is part of the answer.
/// Only a ruleset the core cannot use is an error.
#[wasm_bindgen]
pub fn plan_route_state(
    ruleset_json: String,
    raw_report: String,
    remembered_json: String,
    unit_id: String,
    destination: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::plan_for_remembered_report(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &unit_id,
            &destination,
        )
    })
    .map_err(|error| JsValue::from_str(&error))?;
    to_js(&response)
}

/// Writes the known map inside one rectangle out as report-shaped text.
///
/// The browser twin of the desktop command, calling the same core entry so a map exported in the
/// browser and the same map exported on the desktop come out byte for byte identical. The text is
/// the whole answer: the core never touches a filesystem, so saving it is the shell's business.
#[wasm_bindgen]
pub fn export_map_state(
    raw_report: String,
    remembered_json: String,
    request_json: String,
) -> Result<JsValue, JsValue> {
    let text = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::report::export::export_map_text(
            cache,
            &raw_report,
            &remembered_json,
            &request_json,
        )
    })
    .map_err(|error| JsValue::from_str(&error))?;
    to_js(&text)
}

/// Resolves everything the faction knows about the map, once, for a caller on either shell.
///
/// The browser twin of the desktop command, calling the same core entry so the two shells cannot
/// drift about who is in a hex.
#[wasm_bindgen]
pub fn known_map_state(
    raw_report: String,
    ruleset_json: Option<String>,
    remembered_json: String,
) -> Result<JsValue, JsValue> {
    let known_map = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::known_map::known_map_json(
            cache,
            &raw_report,
            ruleset_json.as_deref(),
            &remembered_json,
        )
    })
    .map_err(|error| JsValue::from_str(&error))?;
    to_js(&known_map)
}

/// Traces the MOVE or ADVANCE order in a unit's written orders across the remembered map.
///
/// The browser twin of the desktop command, calling the same core entry so the two shells cannot
/// drift into tracing differently. An order that cannot be traced resolves to an answer carrying
/// no path; only an unusable ruleset or unreadable memory rejects.
#[wasm_bindgen]
pub fn trace_move_orders_state(
    ruleset_json: String,
    raw_report: String,
    remembered_json: String,
    unit_id: String,
    orders: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::trace_orders_for_remembered_report(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &unit_id,
            &orders,
        )
    })
    .map_err(|error| JsValue::from_str(&error))?;
    to_js(&response)
}

/// What the orders document makes of the faction's units, region by region.
///
/// Thin over the core exactly as the trace is, and for the same reason: the desktop and the
/// browser must preview the same coming month. An order that changes nothing resolves to an empty
/// answer; only an unusable ruleset or unreadable memory rejects.
#[wasm_bindgen]
pub fn preview_orders_state(
    ruleset_json: String,
    raw_report: String,
    remembered_json: String,
    orders_document: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::orders::effects::preview_orders_for_remembered_report(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &orders_document,
        )
    })
    .map_err(|error| JsValue::from_str(&error))?;
    to_js(&response)
}

/// Parses a report into the full domain model: regions, units, structures, exits and markets.
///
/// The flat summary `parse_report_state` returns is derived from this same parse, and remains for
/// the panels that have not moved over yet.
///
/// Goes through the cache like every other entry point. The shell takes this branch rather than the
/// classified one whenever the ruleset has not arrived yet, and a report shown this way still has
/// to be the report the import and the planner get, or the load pays for two parses.
#[wasm_bindgen]
pub fn parse_report_full_state(raw_report: String) -> Result<JsValue, JsValue> {
    let report = atlantis_hud_core::cache::with_global(|cache| cache.report(&raw_report));
    to_js(&*report)
}

/// Validates one draft of Atlantis orders and returns structured diagnostics.
///
/// Order validation is pure, so unlike the persistence entry points this is available on every
/// target.
///
/// `raw_report` is the turn the orders were written for, when one has been imported. With it the
/// answer covers the checks that need to know what each unit holds and where it stands; without it
/// the answer is the syntax check alone, which is what the pane needs before any import. The report
/// goes through the same cache every other entry point uses, so the whole-map pass this runs on
/// each keystroke re-parses nothing.
#[wasm_bindgen]
pub fn validate_orders_state(
    raw_orders: String,
    ruleset_json: Option<String>,
    raw_report: Option<String>,
    disabled_codes: Option<Vec<String>>,
) -> Result<JsValue, JsValue> {
    let options = OrderCheckOptions {
        disabled: disabled_codes
            .map(|codes| codes.into_iter().collect())
            .unwrap_or_else(|| OrderCheckOptions::default().disabled),
    };

    // Both the ruleset and the report come from the cache. This runs every time the player stops
    // typing, and re-reading a seventy-kilobyte ruleset and re-parsing four hundred units to reach
    // the same two objects would be the whole cost of the feature. A ruleset that cannot be used is
    // treated as no ruleset at all, as everywhere else: bad config, not bad orders.
    //
    // The report is classified where a ruleset allows it. A headcount that is a guess prices no
    // study, so the unclassified parse would silence every studying unit in the turn.
    let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
        let ruleset = ruleset_json
            .as_deref()
            .and_then(|json| cache.ruleset(json).ok());
        let report = raw_report
            .as_deref()
            .map(|raw| cache.classified_when_possible(raw, ruleset_json.as_deref()));
        (ruleset, report)
    });

    let result = OrderValidationResultDto::from(atlantis_hud_core::validate_turn(
        &raw_orders,
        ruleset.as_deref(),
        report.as_deref(),
        options,
    ));
    to_js(&result)
}

/// The order vocabulary, so the shell need not keep a copy of its own.
#[wasm_bindgen]
pub fn order_commands_state() -> Result<JsValue, JsValue> {
    to_js(&atlantis_hud_core::order_commands())
}

#[cfg(test)]
mod tests {
    use super::*;
    // The syntax-only entry point, which the binding above no longer calls: it goes through
    // `validate_turn` so the checks that read the report come with it. These DTO tests want the
    // narrow one, since what they are about is the severity mapping and not the checking.
    use atlantis_hud_core::validate_orders;

    #[test]
    fn dto_maps_core_fields() {
        let dto = EngineInfoDto::from(engine_info());
        assert_eq!(dto.id, "atlantis");
        assert_eq!(dto.name, "Atlantis PBEM");
        assert_eq!(dto.ruleset_version, "4.0");
        assert_eq!(dto.max_faction_count, 128);
    }

    #[test]
    fn order_validation_dto_flattens_severity_to_strings() {
        let dto = OrderValidationResultDto::from(validate_orders("FLY 1 2\nMOVE", None));

        let severities: Vec<&str> = dto
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.severity.as_str())
            .collect();

        assert_eq!(severities, vec!["error", "error"]);
        assert_eq!(dto.diagnostics[0].code, "unknown-command");
        assert_eq!(dto.diagnostics[1].code, "missing-arguments");
    }

    #[test]
    fn order_validation_dto_is_empty_for_valid_orders() {
        let dto = OrderValidationResultDto::from(validate_orders("MOVE n n\nwork", None));
        assert!(dto.diagnostics.is_empty());
    }
}
