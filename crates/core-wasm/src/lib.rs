//! The core's pure functions (parsing, planning, validation, map export), bound for the browser
//! bundle. Persistence is not part of this crate: the desktop reads and writes through
//! `core-tauri`'s Tauri commands, and the web has its own store in `@atlantis/browser-core`, over
//! IndexedDB. The exceptions are the game backup codec (`encode_game_backup_state`,
//! `decode_game_backup_state`), what one report import writes (`report_import_writes_state`), what a reset keeps
//! (`reset_game_manifest_state`), and
//! which turn a game reopens on (`latest_turn_state`): the rules live in the core, and the web's
//! store calls through here rather than deciding them itself.

use atlantis_hud_core::backup::ManifestEdit;
use atlantis_hud_core::reopen::{latest_turn, TurnRef};
use atlantis_hud_core::report::import::{import_writes, SeenRegion};
use atlantis_hud_core::report::merge::{
    merge_map_export_into_sightings, merge_report_into_sightings, StoredSighting,
};
use atlantis_hud_core::report::sighting::RegionSighting;
use atlantis_hud_core::{
    diff_imported_turn, engine_info, plan_merge, reject_import, ImportedTurnSnapshot, MergePlan,
    OrderCheckOptions, ReportParseResult, ReportParseResultWire,
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

/// Everything the browser storage adapter needs to persist one import.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreparedImportDto {
    turn_number: Option<u32>,
    candidate: ImportedTurnSnapshot,
    parse_result: ReportParseResultWire,
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
    /// Whether the core recognised the file as one of our own map exports.
    ///
    /// The adapter needs it to decide whether to write a merged-report record, and the decision is
    /// the core's for the same reason the merge itself is: the desktop, which writes that record in
    /// Rust, must not be able to answer differently.
    map_export: bool,
    /// `None` when the report may be merged; otherwise why it may not be.
    rejection: Option<String>,
}

/// Returns engine metadata serialized as a JS object.
#[wasm_bindgen]
pub fn get_engine_info() -> Result<JsValue, JsValue> {
    to_js(&engine_info())
}

/// Parses one report and returns tolerant parser output including the viability threshold flag.
#[wasm_bindgen]
pub fn parse_report_state(raw_report: String) -> Result<JsValue, JsValue> {
    let report = atlantis_hud_core::cache::with_global(|cache| cache.report(&raw_report));
    let parsed = ReportParseResultWire::from(atlantis_hud_core::summarize(&report));
    to_js(&parsed)
}

/// Parses a report and returns everything needed to store it, alongside the parse result.
///
/// The browser has no SQLite, so its storage adapter supplies the read and the write while every
/// rule about what gets stored stays here. The stamps and sightings a commit actually writes come
/// from [`report_import_writes_state`], a second call on the same cached parse.
#[wasm_bindgen]
pub fn prepare_report_import_state(
    raw_report: String,
    confirmed_faction_id: String,
    ruleset_json: Option<String>,
) -> Result<JsValue, JsValue> {
    // The report the shell already showed is the report being imported, so this is a cache hit and
    // no parsing happens here at all.
    //
    // Classified when the shell has a ruleset, exactly as the turn on screen is - the same parse
    // `report_import_writes_state` reuses for the sightings, which are the only account of a hex
    // the map ever reads back, so an estimate stored there would put a tilde on every remembered
    // unit forever, however complete the catalogue.
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
        parse_result: ReportParseResultWire::from(parsed),
        rejection,
    };

    to_js(&prepared)
}

/// The stamps and sightings one import writes, given what the browser store already holds.
///
/// The counterpart of [`prepare_report_merge_state`]: the store hands over the earlier import's
/// stamp (if any) and `[{ regionId, lastSeenTurn }]` for every hex it remembers for the faction,
/// and writes back exactly what comes out. Same parse as [`prepare_report_import_state`] - a cache
/// hit - and classified for the same reason: the sightings are the only account of a hex the map
/// ever reads back, so an estimate stored here would put a tilde on every remembered unit forever.
///
/// # Errors
///
/// Returns an error when `seen_json` cannot be read as JSON, the report has no turn header, or the
/// outcome cannot be handed back to JavaScript.
#[wasm_bindgen]
pub fn report_import_writes_state(
    raw_report: String,
    ruleset_json: Option<String>,
    existing_imported_at: Option<String>,
    seen_json: String,
    at: String,
) -> Result<JsValue, JsValue> {
    let seen: Vec<SeenRegion> =
        serde_json::from_str(&seen_json).map_err(|error| JsValue::from_str(&error.to_string()))?;

    let full = atlantis_hud_core::cache::with_global(|cache| {
        cache.classified_when_possible(&raw_report, ruleset_json.as_deref())
    });
    let turn_number = atlantis_hud_core::summarize(&full)
        .turn_header
        .map(|header| header.turn_number)
        .ok_or_else(|| JsValue::from_str("turn header missing from parsed report"))?;

    let writes = import_writes(
        &full,
        turn_number,
        existing_imported_at.as_deref(),
        &seen,
        &at,
    );

    to_js(&writes)
}

/// The manifest a reset leaves behind, given the one the store holds now.
///
/// The counterpart of the desktop's own call into [`atlantis_hud_core::backup::reset_manifest`]:
/// the browser store hands over the game's current manifest and writes back exactly what comes
/// out, so neither platform holds an opinion about what a reset keeps (`ah-8z4y.1`).
///
/// # Errors
///
/// Returns an error when `manifest_json` cannot be read as a `GameManifest`, or when the result
/// cannot be handed back to JavaScript.
#[wasm_bindgen]
pub fn reset_game_manifest_state(manifest_json: String, now: String) -> Result<JsValue, JsValue> {
    let previous: atlantis_hud_core::backup::GameManifest = serde_json::from_str(&manifest_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js(&atlantis_hud_core::backup::reset_manifest(&previous, &now))
}

/// The faction's remembered map, from the rows the store holds.
///
/// The counterpart of the desktop's own call into
/// [`atlantis_hud_core::report::sighting::remembered_regions`]: the browser hands over its stored
/// rows and draws exactly what comes out, so neither platform holds an opinion about which hexes
/// are dropped or what order they come back in (`ah-8z4y.3.2`).
///
/// Replaces `hydrate_remembered_region`'s one-hex-at-a-time shape, which left the browser deciding
/// *which* hexes to drop by catching a throw - and it does not throw on a stored `null`.
///
/// # Errors
///
/// Returns an error when `stored_json` cannot be read as a list of stored sightings, or when the
/// result cannot be handed back to JavaScript.
#[wasm_bindgen]
pub fn remembered_regions_state(stored_json: String) -> Result<JsValue, JsValue> {
    let stored: Vec<atlantis_hud_core::report::merge::StoredSighting> =
        serde_json::from_str(&stored_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js(&atlantis_hud_core::report::sighting::remembered_regions(
        stored,
    ))
}

/// The merged reports of one turn, in the order both platforms list them in.
///
/// The desktop gets this order from its `ORDER BY` and the core states it once
/// ([`atlantis_hud_core::report::merge::order_merged_reports`]); the browser, whose store has no
/// `ORDER BY`, calls the definition rather than writing the comparator out again (`ah-8z4y.3.2`).
///
/// # Errors
///
/// Returns an error when `records_json` cannot be read as a list of merged reports, or when the
/// result cannot be handed back to JavaScript.
#[wasm_bindgen]
pub fn ordered_merged_reports_state(records_json: String) -> Result<JsValue, JsValue> {
    let mut records: Vec<atlantis_hud_core::report::merge::MergedReportRecord> =
        serde_json::from_str(&records_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    atlantis_hud_core::report::merge::order_merged_reports(&mut records);
    to_js(&records)
}

/// The manifest after one edit, given the one the store holds now.
///
/// One export for every edit, because the edits are one list ([`ManifestEdit`]) - see
/// `ah-8z4y.3.1`. The browser hands over its stored manifest and writes back what comes out,
/// exactly as it does for a reset (`reset_game_manifest_state`).
///
/// This is also what makes the browser's hand-coded `delete metadata.map` unnecessary: the result
/// goes out through serde, and `skip_serializing_if = "Option::is_none"` on `GameMetadata::map`
/// means a cleared map comes back as an object with **no `map` key at all** rather than
/// `map: null` - the rule the settings dialog reads, obtained in one place.
///
/// # Errors
///
/// Returns an error when either argument cannot be read, or when the result cannot be handed back
/// to JavaScript.
#[wasm_bindgen]
pub fn edit_game_manifest_state(
    manifest_json: String,
    edit_json: String,
) -> Result<JsValue, JsValue> {
    let mut manifest: atlantis_hud_core::backup::GameManifest =
        serde_json::from_str(&manifest_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let edit: ManifestEdit =
        serde_json::from_str(&edit_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
    atlantis_hud_core::backup::apply_manifest_edit(&mut manifest, &edit);
    to_js(&manifest)
}

/// Folds an allied report into a stored map and returns the rows to write.
///
/// The counterpart of [`prepare_report_import_state`] for issue #53. The browser supplies the read
/// and the write - it hands over what it has stored for the viewer's faction and writes back what
/// comes out - while every rule about which account of a hex wins stays in the core, so a hex
/// merged in the browser and the same hex merged on the desktop cannot come out different.
///
/// `viewer_faction_id` is whose map is being merged into. The core needs it to refuse a faction's
/// own report - a refusal both shells used to make themselves, in the same words, only because the
/// core was never told (`ah-8z4y.3.2`).
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
    viewer_faction_id: String,
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

    // `plan_merge` decides which of the three this file is: one of our own map exports, an
    // allied report, or neither. It is in the core so the desktop cannot answer differently, and
    // it uses `reject_merge` rather than `reject_import` - the latter asks whether a report may be
    // filed under a faction, and answers from a candidate list that holds only the reporting
    // faction, so it refuses every ally there is.
    let plan = plan_merge(
        &raw_report,
        &parse_result,
        viewer_turn_number,
        &viewer_faction_id,
    );
    let map_export = matches!(plan, MergePlan::MapExport { .. });
    let outcome = match plan {
        MergePlan::Refused(rejection) => {
            return to_js(&PreparedMergeDto {
                turn_number: parse_result.turn_header.as_ref().map(|it| it.turn_number),
                merged_faction_id: None,
                merged_faction_name: None,
                region_sightings: Vec::new(),
                merged_region_count: 0,
                new_region_count: 0,
                map_export: false,
                rejection: Some(rejection),
            });
        }
        MergePlan::AlliedReport => {
            merge_report_into_sightings(&existing, &report, viewer_turn_number)
        }
        MergePlan::MapExport { file_turn, ages } => {
            merge_map_export_into_sightings(&existing, &report, file_turn, &ages)
        }
    };

    // Clearing the threshold means the report named its faction, so this is present.
    let ally = parse_result.detected_factions.first();

    to_js(&PreparedMergeDto {
        turn_number: Some(viewer_turn_number),
        merged_faction_id: ally.map(|faction| faction.faction_id.clone()),
        merged_faction_name: ally.map(|faction| faction.name.clone()),
        region_sightings: outcome.sightings,
        merged_region_count: u32::try_from(outcome.merged_region_count).unwrap_or(u32::MAX),
        new_region_count: u32::try_from(outcome.new_region_count).unwrap_or(u32::MAX),
        map_export,
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

    to_js(&ReportParseResultWire::from(parsed))
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

/// Which turn a game reopens on, from what the browser store holds.
///
/// `turns_json` is `[{ factionId, turnNumber }]` - the store's imported turns, two fields each;
/// the payloads stay behind. `active_faction_id` is the faction the game remembers as the
/// player's, or `None` for a manifest that remembers none. Returns `{ factionId, turnNumber }` or
/// `null`.
#[wasm_bindgen]
pub fn latest_turn_state(
    turns_json: String,
    active_faction_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let turns: Vec<TurnRef> =
        serde_json::from_str(&turns_json).map_err(|error| JsValue::from_str(&error.to_string()))?;

    to_js(&latest_turn(&turns, active_faction_id.as_deref()))
}

/// Encodes one game's rows as one backup document. `content_json` is the browser store's own
/// records under the seven keys of `GameBackupContent`; keys the codec does not know are ignored.
#[wasm_bindgen]
pub fn encode_game_backup_state(
    content_json: String,
    exported_at: String,
) -> Result<String, JsValue> {
    atlantis_hud_core::backup::encode_game_backup_json(&content_json, &exported_at)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Decodes one backup document into rows the browser store writes, or throws the codec's reason.
#[wasm_bindgen]
pub fn decode_game_backup_state(
    backup_json: String,
    opened_at: String,
) -> Result<JsValue, JsValue> {
    let decoded = atlantis_hud_core::backup::decode_game_backup(&backup_json, &opened_at)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js(&decoded)
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
    map_json: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::plan_on_map(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &unit_id,
            &destination,
            &map_json,
        )
    })
    .map_err(|error| JsValue::from_str(&error))?;
    to_js(&response)
}

/// Finds every trade worth making in the map the faction has seen.
///
/// The browser twin of the desktop command, calling the same core entry so the browser and the
/// desktop cannot drift into pricing trades differently. A report with nothing to trade resolves
/// to an empty list; only an unusable ruleset or unreadable remembered regions reject.
#[wasm_bindgen]
pub fn trade_routes_state(
    ruleset_json: String,
    raw_report: String,
    remembered_json: String,
    map_json: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::trade::trade_routes_on_map(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &map_json,
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

/// Writes every named unit out as a report fragment an ally can read back.
///
/// The browser twin of the desktop command, calling the same core entry so a sheet exported in the
/// browser and the same sheet exported on the desktop come out byte for byte identical.
#[wasm_bindgen]
pub fn export_mage_sheet_state(
    raw_report: String,
    unit_ids_json: String,
) -> Result<JsValue, JsValue> {
    let text = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::report::export::export_mage_sheet_text(
            cache,
            &raw_report,
            &unit_ids_json,
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
    orders_document: String,
    map_json: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::trace_orders_on_map(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &unit_id,
            &orders_document,
            &map_json,
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
    map_json: String,
) -> Result<JsValue, JsValue> {
    let response = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::orders::effects::preview_orders_on_map(
            cache,
            &ruleset_json,
            &raw_report,
            &remembered_json,
            &orders_document,
            &map_json,
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

/// Every combat skill the report's battle rosters disclosed, in report order.
///
/// Deliberately **not** through `atlantis_hud_core::cache`, unlike every neighbouring entry point
/// here: the only caller is a scan over many stored turns, and the cache holds one report, so going
/// through it would evict the player's open turn on every iteration and make the next
/// order-validation keystroke re-parse it.
///
/// # Errors
///
/// Returns an error only when the answer cannot be serialised to JS.
#[wasm_bindgen]
pub fn roster_skills_state(raw_report: String) -> Result<JsValue, JsValue> {
    let report = atlantis_hud_core::report::parse_report_full(&raw_report);
    to_js(&atlantis_hud_core::report::battle::roster_skills(
        &report.battles,
    ))
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

    let result = atlantis_hud_core::validate_turn(
        &raw_orders,
        ruleset.as_deref(),
        report.as_deref(),
        options,
    );
    to_js(&result)
}

/// Every order name, so the shell need not keep a copy of its own. Its wider twin below,
/// `order_vocabulary_state`, answers every word the rules know rather than only the commands.
#[wasm_bindgen]
pub fn order_commands_state() -> Result<JsValue, JsValue> {
    to_js(&atlantis_hud_core::order_commands())
}

/// Every word the rules know, for the editor that has to spot a keyword as it is typed.
///
/// `ruleset_json` goes through the same process-global cache every other entry point uses, so a
/// ruleset already parsed for this game is not parsed again.
///
/// # Errors
///
/// Returns an error only when the answer cannot be serialized to JavaScript.
#[wasm_bindgen]
pub fn order_vocabulary_state(ruleset_json: Option<String>) -> Result<JsValue, JsValue> {
    let ruleset = atlantis_hud_core::cache::with_global(|cache| {
        ruleset_json
            .as_deref()
            .and_then(|json| cache.ruleset(json).ok())
    });

    to_js(&atlantis_hud_core::order_vocabulary(ruleset.as_deref()))
}

/// What may stand where the caret is, so the editor's popup can answer an argument position.
///
/// `ruleset_json` and `raw_report` go through the same cache every other entry point uses - this
/// runs on every keystroke, so re-parsing a seventy-kilobyte ruleset or a four-hundred-unit report
/// per call would be the whole cost of the feature. `unit_id` is whose block is being typed, which
/// is what makes the hex-narrowed positions (`BUY`, `SELL`, `PRODUCE`) answerable at all.
#[wasm_bindgen]
pub fn order_argument_completions_state(
    line_prefix: String,
    ruleset_json: Option<String>,
    raw_report: Option<String>,
    unit_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
        let ruleset = ruleset_json
            .as_deref()
            .and_then(|json| cache.ruleset(json).ok());
        let report = raw_report
            .as_deref()
            .map(|raw| cache.classified_when_possible(raw, ruleset_json.as_deref()));
        (ruleset, report)
    });

    to_js(&atlantis_hud_core::order_argument_completions(
        &line_prefix,
        ruleset.as_deref(),
        report.as_deref(),
        unit_id.as_deref(),
    ))
}

/// Where the caret is in one order line, what word is being typed, and what may stand there.
///
/// One call for all three completion sources: they ask about the same caret on the same keystroke,
/// and the position is decided in the core so no shell keeps a rule of its own (ah-vfq). The cache
/// is used exactly as `order_argument_completions_state` uses it, and for the same reason.
#[wasm_bindgen]
pub fn completions_at_caret_state(
    line_prefix: String,
    ruleset_json: Option<String>,
    raw_report: Option<String>,
    unit_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
        let ruleset = ruleset_json
            .as_deref()
            .and_then(|json| cache.ruleset(json).ok());
        let report = raw_report
            .as_deref()
            .map(|raw| cache.classified_when_possible(raw, ruleset_json.as_deref()));
        (ruleset, report)
    });

    to_js(&atlantis_hud_core::completions_at_caret(
        &line_prefix,
        ruleset.as_deref(),
        report.as_deref(),
        unit_id.as_deref(),
    ))
}

#[cfg(test)]
mod tests {
    // The syntax-only entry point, which the binding above no longer calls: it goes through
    // `validate_turn` so the checks that read the report come with it. These DTO tests want the
    // narrow one, since what they are about is the severity mapping and not the checking.
    use atlantis_hud_core::validate_orders;

    /// `OrderValidationResult` serializes its severity as lowercase strings on its own now — the
    /// DTO that used to hand-map it is gone (ah-164.1). `EngineInfo`'s own camelCase serialization
    /// is pinned in core, so nothing here duplicates that.
    #[test]
    fn order_validation_serializes_severity_lowercase() {
        let value = serde_json::to_value(validate_orders("FLY 1 2\nMOVE", None))
            .expect("validation result should serialize");
        let diagnostics = value["diagnostics"].as_array().expect("diagnostics array");

        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0]["severity"], "error");
        assert_eq!(diagnostics[0]["code"], "unknown-command");
        assert_eq!(diagnostics[1]["severity"], "error");
        assert_eq!(diagnostics[1]["code"], "missing-arguments");
    }

    #[test]
    fn order_validation_is_empty_for_valid_orders() {
        let result = validate_orders("MOVE n n\nwork", None);
        assert!(result.diagnostics.is_empty());
    }
}
