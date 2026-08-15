//! WASM adapter surface for Atlantis HUD core APIs.

#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use atlantis_hud_core::report::merge::{merge_report_into_sightings, StoredSighting};
use atlantis_hud_core::report::sighting::{region_sightings, RegionSighting};
// Only the persistence-backed import previews call it, and those are not linked into a wasm
// build, so on wasm32 this import would sit unused and trip the warning gate.
#[cfg(not(target_arch = "wasm32"))]
use atlantis_hud_core::parse_report;
use atlantis_hud_core::{
    diff_imported_turn, engine_info, reject_import, reject_merge, ImportedTurnSnapshot,
    OrderCheckOptions, OrderDiagnosticSeverity, OrderValidationResult, ReportParseResult,
};
#[cfg(not(target_arch = "wasm32"))]
use atlantis_hud_core_persistence::{
    create_game, delete_game, delete_hex_note, insert_imported_turn, list_games, list_hex_notes,
    list_imported_turns, load_imported_turn, load_latest_imported_turn, load_order_draft,
    open_game, preview_imported_turn, set_game_ruleset, upsert_hex_note, upsert_imported_turn,
    upsert_order_draft, GameManifest, GameMetadata, HexNote, ImportedTurnKey, ImportedTurnPreview,
    ImportedTurnRecord, OpenedGame, OrderDraftKey, OrderDraftRecord, PersistenceError,
    ReportSourceRef,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct OrderDraftKeyDto {
    game_id: String,
    faction_id: String,
    turn_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct OrderDraftRecordDto {
    key: OrderDraftKeyDto,
    order_text: String,
    updated_at: String,
}

#[cfg(not(target_arch = "wasm32"))]
impl From<OrderDraftRecord> for OrderDraftRecordDto {
    fn from(value: OrderDraftRecord) -> Self {
        Self {
            key: OrderDraftKeyDto {
                game_id: value.key.game_id,
                faction_id: value.key.faction_id,
                turn_number: value.key.turn_number,
            },
            order_text: value.order_text,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct HexNoteDto {
    id: String,
    game_id: String,
    region_id: String,
    text: String,
    on_map: bool,
    turn: u32,
    created_at: String,
    updated_at: String,
}

#[cfg(not(target_arch = "wasm32"))]
impl From<HexNote> for HexNoteDto {
    fn from(value: HexNote) -> Self {
        Self {
            id: value.id,
            game_id: value.game_id,
            region_id: value.region_id,
            text: value.text,
            on_map: value.on_map,
            turn: value.turn,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<HexNoteDto> for HexNote {
    fn from(value: HexNoteDto) -> Self {
        Self {
            id: value.id,
            game_id: value.game_id,
            region_id: value.region_id,
            text: value.text,
            on_map: value.on_map,
            turn: value.turn,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct GameMetadataDto {
    game_id: String,
    game_name: String,
    ruleset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ReportSourceRefDto {
    source_id: String,
    label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct GameManifestDto {
    manifest_version: u32,
    metadata: GameMetadataDto,
    report_sources: Vec<ReportSourceRefDto>,
    created_at: String,
    last_opened_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct OpenedGameDto {
    game_file_path: String,
    database_path: String,
    schema_version: u32,
    manifest: GameManifestDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ImportedTurnPreviewDto {
    exists: bool,
    raw_changed: bool,
    parsed_changed: bool,
    warnings_changed: bool,
}

#[cfg(not(target_arch = "wasm32"))]
impl From<ImportedTurnPreview> for ImportedTurnPreviewDto {
    fn from(value: ImportedTurnPreview) -> Self {
        Self {
            exists: value.exists,
            raw_changed: value.raw_changed,
            parsed_changed: value.parsed_changed,
            warnings_changed: value.warnings_changed,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ReportImportPreviewDto {
    parse_result: ReportParseResultDto,
    duplicate_preview: ImportedTurnPreviewDto,
    turn_number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ImportedTurnKeyDto {
    game_id: String,
    faction_id: String,
    turn_number: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ImportedTurnRecordDto {
    key: ImportedTurnKeyDto,
    raw_report: String,
    parse_result: ReportParseResultDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ImportedTurnSummaryDto {
    key: ImportedTurnKeyDto,
    season: Option<String>,
    imported_at: String,
    updated_at: String,
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

#[cfg(not(target_arch = "wasm32"))]
impl From<GameMetadataDto> for GameMetadata {
    fn from(value: GameMetadataDto) -> Self {
        Self {
            game_id: value.game_id,
            game_name: value.game_name,
            ruleset_id: value.ruleset_id,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<ReportSourceRefDto> for ReportSourceRef {
    fn from(value: ReportSourceRefDto) -> Self {
        Self {
            source_id: value.source_id,
            label: value.label,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<GameManifestDto> for GameManifest {
    fn from(value: GameManifestDto) -> Self {
        Self {
            manifest_version: value.manifest_version,
            metadata: value.metadata.into(),
            report_sources: value.report_sources.into_iter().map(Into::into).collect(),
            created_at: value.created_at,
            last_opened_at: value.last_opened_at,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<GameMetadata> for GameMetadataDto {
    fn from(value: GameMetadata) -> Self {
        Self {
            game_id: value.game_id,
            game_name: value.game_name,
            ruleset_id: value.ruleset_id,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<ReportSourceRef> for ReportSourceRefDto {
    fn from(value: ReportSourceRef) -> Self {
        Self {
            source_id: value.source_id,
            label: value.label,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<GameManifest> for GameManifestDto {
    fn from(value: GameManifest) -> Self {
        Self {
            manifest_version: value.manifest_version,
            metadata: value.metadata.into(),
            report_sources: value.report_sources.into_iter().map(Into::into).collect(),
            created_at: value.created_at,
            last_opened_at: value.last_opened_at,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<OpenedGame> for OpenedGameDto {
    fn from(value: OpenedGame) -> Self {
        Self {
            game_file_path: value.game_file_path.to_string_lossy().to_string(),
            database_path: value.database_path.to_string_lossy().to_string(),
            schema_version: value.schema_version,
            manifest: value.manifest.into(),
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

/// Creates a game manifest and sidecar SQLite database.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn create_game_state(games_root: String, manifest: JsValue) -> Result<JsValue, JsValue> {
    let manifest_dto = serde_wasm_bindgen::from_value::<GameManifestDto>(manifest)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let opened = create_game(Path::new(&games_root), &GameManifest::from(manifest_dto))
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&OpenedGameDto::from(opened))
}

/// Every game under the games directory.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn list_games_state(games_root: String) -> Result<JsValue, JsValue> {
    let games = list_games(Path::new(&games_root))
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(
        &games
            .into_iter()
            .map(GameManifestDto::from)
            .collect::<Vec<_>>(),
    )
}

/// Deletes a game and everything it stored.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn delete_game_state(games_root: String, game_id: String) -> Result<JsValue, JsValue> {
    delete_game(Path::new(&games_root), &game_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(JsValue::NULL)
}

/// Opens an existing game and applies pending schema migrations.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn open_game_state(
    games_root: String,
    game_id: String,
    opened_at: String,
) -> Result<JsValue, JsValue> {
    let opened = open_game(Path::new(&games_root), &game_id, &opened_at)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&OpenedGameDto::from(opened))
}

/// Changes which ruleset a game is played under, returning the updated manifest.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn set_game_ruleset_state(
    games_root: String,
    game_id: String,
    ruleset_id: String,
) -> Result<JsValue, JsValue> {
    let manifest = set_game_ruleset(Path::new(&games_root), &game_id, &ruleset_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&GameManifestDto::from(manifest))
}

/// Previews duplicate conflict for a report import candidate.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn preview_report_import_state(
    database_path: String,
    game_id: String,
    confirmed_faction_id: String,
    raw_report: String,
) -> Result<JsValue, JsValue> {
    let parsed = parse_report(&raw_report);
    let turn_number = parsed.turn_header.as_ref().map(|header| header.turn_number);

    let duplicate_preview = if let Some(current_turn) = turn_number {
        let candidate = ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id,
                faction_id: confirmed_faction_id,
                turn_number: current_turn,
            },
            raw_report,
            parsed_payload_json: serde_json::to_string(&parsed)
                .map_err(|error| JsValue::from_str(&error.to_string()))?,
            warnings_payload_json: serde_json::to_string(&parsed.warnings)
                .map_err(|error| JsValue::from_str(&error.to_string()))?,
        };
        preview_imported_turn(Path::new(&database_path), &candidate)
            .map(ImportedTurnPreviewDto::from)
            .map_err(|error| JsValue::from_str(&error.to_string()))?
    } else {
        ImportedTurnPreviewDto {
            exists: false,
            raw_changed: false,
            parsed_changed: false,
            warnings_changed: false,
        }
    };

    let result = ReportImportPreviewDto {
        parse_result: ReportParseResultDto::from(parsed),
        duplicate_preview,
        turn_number,
    };
    to_js(&result)
}

/// Commits a report import candidate to persistence.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn commit_report_import_state(
    database_path: String,
    game_id: String,
    confirmed_faction_id: String,
    raw_report: String,
    // Accepted to keep every export of this name positionally identical to the adapter's
    // declaration. This variant stores only the turn payload - a flat summary carrying no men
    // counts - and no sightings, so there is nothing here for a ruleset to classify.
    _ruleset_json: Option<String>,
    allow_overwrite: bool,
    imported_at: String,
) -> Result<JsValue, JsValue> {
    let parsed = parse_report(&raw_report);
    if !parsed.meets_minimum_import_threshold() {
        return Err(JsValue::from_str(
            "parsed report did not meet minimum import threshold",
        ));
    }

    let faction_is_detected = parsed
        .detected_factions
        .iter()
        .any(|faction| faction.faction_id == confirmed_faction_id);
    if !faction_is_detected {
        return Err(JsValue::from_str(
            "confirmed faction does not exist in parsed report candidates",
        ));
    }

    let turn_number = parsed
        .turn_header
        .as_ref()
        .map(|header| header.turn_number)
        .ok_or_else(|| JsValue::from_str("turn header missing from parsed report"))?;

    let candidate = ImportedTurnRecord {
        key: ImportedTurnKey {
            game_id,
            faction_id: confirmed_faction_id,
            turn_number,
        },
        raw_report,
        parsed_payload_json: serde_json::to_string(&parsed)
            .map_err(|error| JsValue::from_str(&error.to_string()))?,
        warnings_payload_json: serde_json::to_string(&parsed.warnings)
            .map_err(|error| JsValue::from_str(&error.to_string()))?,
    };
    let preview = preview_imported_turn(Path::new(&database_path), &candidate)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    if allow_overwrite {
        upsert_imported_turn(Path::new(&database_path), &candidate, &imported_at)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    } else {
        insert_imported_turn(Path::new(&database_path), &candidate, &imported_at).map_err(
            |error| match error {
                PersistenceError::DuplicateImportedTurn { .. } => JsValue::from_str(
                    "duplicate import exists and requires explicit overwrite confirmation",
                ),
                _ => JsValue::from_str(&error.to_string()),
            },
        )?;
    }

    to_js(&ImportedTurnPreviewDto::from(preview))
}

/// Loads one imported turn payload by composite key.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn load_imported_turn_state(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<JsValue, JsValue> {
    let loaded = load_imported_turn(
        Path::new(&database_path),
        &ImportedTurnKey {
            game_id,
            faction_id,
            turn_number,
        },
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let dto = loaded.map(imported_turn_dto).transpose()?;

    to_js(&dto)
}

/// Loads the turn this game was last worked on.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn load_latest_imported_turn_state(
    database_path: String,
    game_id: String,
) -> Result<JsValue, JsValue> {
    let loaded = load_latest_imported_turn(Path::new(&database_path), &game_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&loaded.map(imported_turn_dto).transpose()?)
}

/// Lists every turn imported for a game, across every faction, in turn order.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn list_imported_turns_state(
    database_path: String,
    game_id: String,
) -> Result<JsValue, JsValue> {
    let listed = list_imported_turns(Path::new(&database_path), &game_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let dtos: Vec<ImportedTurnSummaryDto> = listed
        .into_iter()
        .map(|summary| ImportedTurnSummaryDto {
            key: ImportedTurnKeyDto {
                game_id: summary.key.game_id,
                faction_id: summary.key.faction_id,
                turn_number: summary.key.turn_number,
            },
            season: summary.season,
            imported_at: summary.imported_at,
            updated_at: summary.updated_at,
        })
        .collect();

    to_js(&dtos)
}

#[cfg(not(target_arch = "wasm32"))]
fn imported_turn_dto(record: ImportedTurnRecord) -> Result<ImportedTurnRecordDto, JsValue> {
    let parse_result = serde_json::from_str::<ReportParseResult>(&record.parsed_payload_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(ImportedTurnRecordDto {
        key: ImportedTurnKeyDto {
            game_id: record.key.game_id,
            faction_id: record.key.faction_id,
            turn_number: record.key.turn_number,
        },
        raw_report: record.raw_report,
        parse_result: ReportParseResultDto::from(parse_result),
    })
}

/// Saves one order draft, keyed by game, faction and turn.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn save_order_draft_state(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
    order_text: String,
    updated_at: String,
) -> Result<JsValue, JsValue> {
    let record = OrderDraftRecord {
        key: OrderDraftKey {
            game_id,
            faction_id,
            turn_number,
        },
        order_text,
        updated_at,
    };

    upsert_order_draft(Path::new(&database_path), &record)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&OrderDraftRecordDto::from(record))
}

/// Loads one order draft by composite key, or null when none is stored.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn load_order_draft_state(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<JsValue, JsValue> {
    let loaded = load_order_draft(
        Path::new(&database_path),
        &OrderDraftKey {
            game_id,
            faction_id,
            turn_number,
        },
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let dto = loaded.map(OrderDraftRecordDto::from);
    to_js(&dto)
}

/// Lists a game's hex notes, newest first.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn list_hex_notes_state(database_path: String, game_id: String) -> Result<JsValue, JsValue> {
    let notes = list_hex_notes(Path::new(&database_path), &game_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&notes.into_iter().map(HexNoteDto::from).collect::<Vec<_>>())
}

/// Saves one hex note.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn save_hex_note_state(database_path: String, note: JsValue) -> Result<JsValue, JsValue> {
    let note = serde_wasm_bindgen::from_value::<HexNoteDto>(note)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let note: HexNote = note.into();

    upsert_hex_note(Path::new(&database_path), &note)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&HexNoteDto::from(note))
}

/// Deletes one hex note; resolves to whether a row existed.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn delete_hex_note_state(
    database_path: String,
    game_id: String,
    note_id: String,
) -> Result<JsValue, JsValue> {
    let existed = delete_hex_note(Path::new(&database_path), &game_id, &note_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&existed)
}

/// Creates a game manifest and sidecar SQLite database.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn create_game_state(_games_root: String, _manifest: JsValue) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Every game under the games directory.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn list_games_state(_games_root: String) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Deletes a game and everything it stored.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn delete_game_state(_games_root: String, _game_id: String) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Opens an existing game and applies pending schema migrations.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn open_game_state(
    _games_root: String,
    _game_id: String,
    _opened_at: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Changes which ruleset a game is played under.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn set_game_ruleset_state(
    _games_root: String,
    _game_id: String,
    _ruleset_id: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Previews duplicate conflict for a report import candidate.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn preview_report_import_state(
    _database_path: String,
    _game_id: String,
    _confirmed_faction_id: String,
    _raw_report: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Commits a report import candidate to persistence.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn commit_report_import_state(
    _database_path: String,
    _game_id: String,
    _confirmed_faction_id: String,
    _raw_report: String,
    _ruleset_json: Option<String>,
    _allow_overwrite: bool,
    _imported_at: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Loads one imported turn payload by composite key.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn load_imported_turn_state(
    _database_path: String,
    _game_id: String,
    _faction_id: String,
    _turn_number: u32,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Loads the turn this game was last worked on.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn load_latest_imported_turn_state(
    _database_path: String,
    _game_id: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Lists every turn imported for a game, across every faction, in turn order.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn list_imported_turns_state(
    _database_path: String,
    _game_id: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Saves one order draft, keyed by game, faction and turn.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn save_order_draft_state(
    _database_path: String,
    _game_id: String,
    _faction_id: String,
    _turn_number: u32,
    _order_text: String,
    _updated_at: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Loads one order draft by composite key, or null when none is stored.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn load_order_draft_state(
    _database_path: String,
    _game_id: String,
    _faction_id: String,
    _turn_number: u32,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Lists a game's hex notes.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn list_hex_notes_state(_database_path: String, _game_id: String) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Saves one hex note.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn save_hex_note_state(_database_path: String, _note: JsValue) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

/// Deletes one hex note.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn delete_hex_note_state(
    _database_path: String,
    _game_id: String,
    _note_id: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "game persistence is not linked in this wasm32 build",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    // The syntax-only entry point, which the binding above no longer calls: it goes through
    // `validate_turn` so the checks that read the report come with it. These DTO tests want the
    // narrow one, since what they are about is the severity mapping and not the checking.
    use atlantis_hud_core::validate_orders;
    #[cfg(not(target_arch = "wasm32"))]
    use tempfile::tempdir;

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

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn order_draft_dto_maps_composite_key() {
        let dto = OrderDraftRecordDto::from(OrderDraftRecord {
            key: OrderDraftKey {
                game_id: "faction-95".to_string(),
                faction_id: "95".to_string(),
                turn_number: 71,
            },
            order_text: "@study obse".to_string(),
            updated_at: "2026-08-08T12:00:00Z".to_string(),
        });

        assert_eq!(dto.key.game_id, "faction-95");
        assert_eq!(dto.key.faction_id, "95");
        assert_eq!(dto.key.turn_number, 71);
        assert_eq!(dto.order_text, "@study obse");
        assert_eq!(dto.updated_at, "2026-08-08T12:00:00Z");
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn hex_note_dto_maps_both_ways() {
        let note = HexNote {
            id: "note-1".to_string(),
            game_id: "faction-95".to_string(),
            region_id: "1:7,53".to_string(),
            text: "Mustn't forget the mountain pass".to_string(),
            on_map: true,
            turn: 71,
            created_at: "2026-08-08T12:00:00Z".to_string(),
            updated_at: "2026-08-08T12:00:00Z".to_string(),
        };

        let dto = HexNoteDto::from(note.clone());
        assert_eq!(dto.id, "note-1");
        assert_eq!(dto.game_id, "faction-95");
        assert_eq!(dto.region_id, "1:7,53");
        assert_eq!(dto.text, "Mustn't forget the mountain pass");
        assert!(dto.on_map);
        assert_eq!(dto.turn, 71);
        assert_eq!(dto.created_at, "2026-08-08T12:00:00Z");
        assert_eq!(dto.updated_at, "2026-08-08T12:00:00Z");

        let round_tripped = HexNote::from(dto);
        assert_eq!(round_tripped, note);
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn persistence_dto_maps_bidirectionally() {
        let dto = GameManifestDto {
            manifest_version: 1,
            metadata: GameMetadataDto {
                game_id: "faction-7".to_string(),
                game_name: "Faction 7".to_string(),
                ruleset_id: "neworigins".to_string(),
            },
            report_sources: vec![ReportSourceRefDto {
                source_id: "report-7".to_string(),
                label: "Turn 7 report".to_string(),
            }],
            created_at: "2026-08-01T09:00:00Z".to_string(),
            last_opened_at: "2026-08-02T09:00:00Z".to_string(),
        };

        let manifest = GameManifest::from(dto.clone());
        assert_eq!(GameManifestDto::from(manifest), dto);
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn create_game_state_can_be_reopened() {
        let dir = tempdir().expect("tempdir");
        let manifest = GameManifest {
            manifest_version: 1,
            metadata: GameMetadata {
                game_id: "faction-web".to_string(),
                game_name: "Faction Web".to_string(),
                ruleset_id: "neworigins".to_string(),
            },
            report_sources: vec![ReportSourceRef {
                source_id: "report-web".to_string(),
                label: "Web report".to_string(),
            }],
            created_at: "2026-08-01T09:00:00Z".to_string(),
            last_opened_at: "2026-08-01T09:00:00Z".to_string(),
        };

        let created = create_game(dir.path(), &manifest).expect("game should be created");
        let reopened = open_game(dir.path(), "faction-web", "2026-08-01T09:00:00Z")
            .expect("game should reopen");
        assert_eq!(created.schema_version, reopened.schema_version);
        assert_eq!(reopened.manifest, manifest);
    }
}
