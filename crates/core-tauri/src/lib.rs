//! Tauri command adapter for Atlantis HUD core APIs.

use std::path::Path;

pub use atlantis_hud_core::report::ParsedReport;
use atlantis_hud_core::{
    engine_info, parse_report, reject_import, validate_orders, OrderDiagnosticSeverity,
    ReportParseResult, WarningSeverity,
};
use atlantis_hud_core_persistence::{
    create_game, delete_game, insert_imported_turn, list_games, load_imported_turn,
    load_order_draft, load_region_sightings, open_game, preview_imported_turn,
    upsert_imported_turn, upsert_order_draft, upsert_region_sightings, GameManifest, GameMetadata,
    ImportedTurnKey, ImportedTurnPreview, ImportedTurnRecord, OpenedGame, OrderDraftKey,
    OrderDraftRecord, PersistenceError, ReportSourceRef,
};
use serde::{Deserialize, Serialize};

/// JSON contract returned by Tauri for engine metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfoDto {
    pub id: String,
    pub name: String,
    pub ruleset_version: String,
    pub max_faction_count: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadataDto {
    pub game_id: String,
    pub game_name: String,
    pub ruleset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSourceRefDto {
    pub source_id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameManifestDto {
    pub manifest_version: u32,
    pub metadata: GameMetadataDto,
    pub report_sources: Vec<ReportSourceRefDto>,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedGameDto {
    pub game_file_path: String,
    pub database_path: String,
    pub schema_version: u32,
    pub manifest: GameManifestDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseWarningDto {
    pub code: String,
    pub section: String,
    pub message: String,
    pub line_start: usize,
    pub line_end: usize,
    pub severity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnHeaderDto {
    pub turn_number: u32,
    pub season: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactionInfoDto {
    pub faction_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSummaryDto {
    pub region_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitSummaryDto {
    pub unit_id: String,
    pub name: String,
    pub region_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemDto {
    pub unit_id: String,
    pub item: String,
    pub quantity: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummaryDto {
    pub kind: String,
    pub source: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportParseResultDto {
    pub turn_header: Option<TurnHeaderDto>,
    pub detected_factions: Vec<FactionInfoDto>,
    pub regions: Vec<RegionSummaryDto>,
    pub units: Vec<UnitSummaryDto>,
    pub inventories: Vec<InventoryItemDto>,
    pub message_summaries: Vec<MessageSummaryDto>,
    pub warnings: Vec<ParseWarningDto>,
    pub meets_minimum_import_threshold: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTurnPreviewDto {
    pub exists: bool,
    pub raw_changed: bool,
    pub parsed_changed: bool,
    pub warnings_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportImportPreviewDto {
    pub parse_result: ReportParseResultDto,
    pub duplicate_preview: ImportedTurnPreviewDto,
    pub turn_number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTurnRecordDto {
    pub key: OrderDraftKeyDto,
    pub raw_report: String,
    pub parse_result: ReportParseResultDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDiagnosticDto {
    pub code: String,
    pub message: String,
    pub line_start: usize,
    pub line_end: usize,
    pub severity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderValidationResultDto {
    pub diagnostics: Vec<OrderDiagnosticDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDraftKeyDto {
    pub game_id: String,
    pub faction_id: String,
    pub turn_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDraftRecordDto {
    pub key: OrderDraftKeyDto,
    pub order_text: String,
    pub updated_at: String,
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

impl From<GameMetadataDto> for GameMetadata {
    fn from(value: GameMetadataDto) -> Self {
        Self {
            game_id: value.game_id,
            game_name: value.game_name,
            ruleset_id: value.ruleset_id,
        }
    }
}

impl From<ReportSourceRefDto> for ReportSourceRef {
    fn from(value: ReportSourceRefDto) -> Self {
        Self {
            source_id: value.source_id,
            label: value.label,
        }
    }
}

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

impl From<GameMetadata> for GameMetadataDto {
    fn from(value: GameMetadata) -> Self {
        Self {
            game_id: value.game_id,
            game_name: value.game_name,
            ruleset_id: value.ruleset_id,
        }
    }
}

impl From<ReportSourceRef> for ReportSourceRefDto {
    fn from(value: ReportSourceRef) -> Self {
        Self {
            source_id: value.source_id,
            label: value.label,
        }
    }
}

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

impl From<ReportParseResult> for ReportParseResultDto {
    fn from(value: ReportParseResult) -> Self {
        let meets_minimum_import_threshold = value.meets_minimum_import_threshold();
        Self {
            turn_header: value.turn_header.map(|header| TurnHeaderDto {
                turn_number: header.turn_number,
                season: header.season,
            }),
            detected_factions: value
                .detected_factions
                .into_iter()
                .map(|faction| FactionInfoDto {
                    faction_id: faction.faction_id,
                    name: faction.name,
                })
                .collect(),
            regions: value
                .regions
                .into_iter()
                .map(|region| RegionSummaryDto {
                    region_id: region.region_id,
                    name: region.name,
                })
                .collect(),
            units: value
                .units
                .into_iter()
                .map(|unit| UnitSummaryDto {
                    unit_id: unit.unit_id,
                    name: unit.name,
                    region_id: unit.region_id,
                })
                .collect(),
            inventories: value
                .inventories
                .into_iter()
                .map(|item| InventoryItemDto {
                    unit_id: item.unit_id,
                    item: item.item,
                    quantity: item.quantity,
                })
                .collect(),
            message_summaries: value
                .message_summaries
                .into_iter()
                .map(|summary| MessageSummaryDto {
                    kind: summary.kind,
                    source: summary.source,
                    text: summary.text,
                })
                .collect(),
            warnings: value
                .warnings
                .into_iter()
                .map(|warning| ParseWarningDto {
                    code: warning.code,
                    section: warning.section,
                    message: warning.message,
                    line_start: warning.line_start,
                    line_end: warning.line_end,
                    severity: match warning.severity {
                        WarningSeverity::Warning => "warning".to_string(),
                        WarningSeverity::Error => "error".to_string(),
                    },
                })
                .collect(),
            meets_minimum_import_threshold,
        }
    }
}

/// Returns canonical engine metadata for a Tauri command wrapper.
#[must_use]
pub fn command_get_engine_info() -> EngineInfoDto {
    EngineInfoDto::from(engine_info())
}

/// Creates a game under the application's games directory and applies migrations.
///
/// # Errors
///
/// Returns an error when a game already exists under this id, or when it cannot be written.
pub fn command_create_game(
    games_root: &str,
    manifest: GameManifestDto,
) -> Result<OpenedGameDto, String> {
    create_game(Path::new(games_root), &GameManifest::from(manifest))
        .map(OpenedGameDto::from)
        .map_err(|error| error.to_string())
}

/// Every game the player has, newest activity first is the caller's business, not ours.
///
/// # Errors
///
/// Returns an error when the games directory exists but cannot be read.
pub fn command_list_games(games_root: &str) -> Result<Vec<GameManifestDto>, String> {
    list_games(Path::new(games_root))
        .map(|games| games.into_iter().map(GameManifestDto::from).collect())
        .map_err(|error| error.to_string())
}

/// Deletes a game and everything it stored.
///
/// # Errors
///
/// Returns an error naming the game when it does not exist, or when it cannot be removed.
pub fn command_delete_game(games_root: &str, game_id: &str) -> Result<(), String> {
    delete_game(Path::new(games_root), game_id).map_err(|error| error.to_string())
}

/// Opens a game by id, applies pending migrations, and records that it was opened.
///
/// # Errors
///
/// Returns an error when no game exists under this id, or when its database cannot be opened.
pub fn command_open_game(
    games_root: &str,
    game_id: &str,
    opened_at: &str,
) -> Result<OpenedGameDto, String> {
    open_game(Path::new(games_root), game_id, opened_at)
        .map(OpenedGameDto::from)
        .map_err(|error| error.to_string())
}

/// Parses a report into the full domain model.
///
/// Returned as the model itself rather than as JSON. It already serializes to exactly the shape the
/// TypeScript side declares, so converting to a `Value` first would only add a round trip, and it
/// would force the desktop shell to depend on `serde_json` for a type it never inspects.
#[must_use]
pub fn command_parse_report_full(raw_report: &str) -> ParsedReport {
    atlantis_hud_core::report::parse_report_full(raw_report)
}

/// Parses one report and returns tolerant parser output.
#[must_use]
pub fn command_parse_report(raw_report: &str) -> ReportParseResultDto {
    ReportParseResultDto::from(parse_report(raw_report))
}

/// Parses one report and previews duplicate conflict for a confirmed faction.
pub fn command_preview_report_import(
    database_path: &str,
    game_id: &str,
    confirmed_faction_id: &str,
    raw_report: &str,
) -> Result<ReportImportPreviewDto, String> {
    let parse_result = parse_report(raw_report);
    let turn_number = parse_result
        .turn_header
        .as_ref()
        .map(|header| header.turn_number);
    let parsed_payload_json =
        serde_json::to_string(&parse_result).map_err(|error| error.to_string())?;
    let warnings_payload_json =
        serde_json::to_string(&parse_result.warnings).map_err(|error| error.to_string())?;

    let preview = if let Some(current_turn_number) = turn_number {
        let candidate = ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id: game_id.to_string(),
                faction_id: confirmed_faction_id.to_string(),
                turn_number: current_turn_number,
            },
            raw_report: raw_report.to_string(),
            parsed_payload_json,
            warnings_payload_json,
        };
        preview_imported_turn(Path::new(database_path), &candidate)
            .map(ImportedTurnPreviewDto::from)
            .map_err(|error| error.to_string())?
    } else {
        ImportedTurnPreviewDto {
            exists: false,
            raw_changed: false,
            parsed_changed: false,
            warnings_changed: false,
        }
    };

    Ok(ReportImportPreviewDto {
        parse_result: ReportParseResultDto::from(parse_result),
        duplicate_preview: preview,
        turn_number,
    })
}

/// Parses and commits one report import after faction confirmation.
pub fn command_commit_report_import(
    database_path: &str,
    game_id: &str,
    confirmed_faction_id: &str,
    raw_report: &str,
    allow_overwrite: bool,
) -> Result<ImportedTurnPreviewDto, String> {
    // Both shapes come off one parse, and that parse is the one the shell already made when it
    // showed the turn: the flat summary the import rules are decided against and that gets stored,
    // and the full model the remembered regions are built from further down.
    let report = atlantis_hud_core::cache::with_global(|cache| cache.report(raw_report));
    let parse_result = atlantis_hud_core::summarize(&report);
    if let Some(rejection) = reject_import(&parse_result, confirmed_faction_id) {
        return Err(rejection);
    }

    let turn_number = parse_result
        .turn_header
        .as_ref()
        .map(|header| header.turn_number)
        .ok_or_else(|| "turn header missing from parsed report".to_string())?;

    let record = ImportedTurnRecord {
        key: ImportedTurnKey {
            game_id: game_id.to_string(),
            faction_id: confirmed_faction_id.to_string(),
            turn_number,
        },
        raw_report: raw_report.to_string(),
        parsed_payload_json: serde_json::to_string(&parse_result)
            .map_err(|error| error.to_string())?,
        warnings_payload_json: serde_json::to_string(&parse_result.warnings)
            .map_err(|error| error.to_string())?,
    };
    let preview = preview_imported_turn(Path::new(database_path), &record)
        .map_err(|error| error.to_string())?;
    if allow_overwrite {
        upsert_imported_turn(Path::new(database_path), &record)
            .map_err(|error| error.to_string())?;
    } else {
        insert_imported_turn(Path::new(database_path), &record).map_err(|error| match error {
            PersistenceError::DuplicateImportedTurn { .. } => {
                "duplicate import exists and requires explicit overwrite confirmation".to_string()
            }
            _ => error.to_string(),
        })?;
    }

    // Regions get their own rows as well as living inside the turn payload, each carrying the turn
    // it was seen in. Without this the map cannot tell a region in the current report from one held
    // over from an earlier turn, which is the difference between two of its four states.
    let sightings = atlantis_hud_core::report::sighting::region_sightings(&report, turn_number);

    upsert_region_sightings(
        Path::new(database_path),
        game_id,
        confirmed_faction_id,
        &sightings,
    )
    .map_err(|error| error.to_string())?;

    Ok(ImportedTurnPreviewDto::from(preview))
}

/// Validates one order draft for the Tauri command surface.
#[must_use]
pub fn command_validate_orders(raw_orders: &str) -> OrderValidationResultDto {
    let result = validate_orders(raw_orders);
    OrderValidationResultDto {
        diagnostics: result
            .diagnostics
            .into_iter()
            .map(|diagnostic| OrderDiagnosticDto {
                code: diagnostic.code,
                message: diagnostic.message,
                line_start: diagnostic.line_start,
                line_end: diagnostic.line_end,
                severity: match diagnostic.severity {
                    OrderDiagnosticSeverity::Warning => "warning".to_string(),
                    OrderDiagnosticSeverity::Error => "error".to_string(),
                },
            })
            .collect(),
    }
}

/// Persists one order draft for the Tauri command surface.
pub fn command_save_order_draft(
    _database_path: &str,
    game_id: &str,
    faction_id: &str,
    turn_number: u32,
    order_text: &str,
    updated_at: &str,
) -> Result<OrderDraftRecordDto, String> {
    let record = OrderDraftRecord {
        key: OrderDraftKey {
            game_id: game_id.to_string(),
            faction_id: faction_id.to_string(),
            turn_number,
        },
        order_text: order_text.to_string(),
        updated_at: updated_at.to_string(),
    };
    upsert_order_draft(Path::new(_database_path), &record).map_err(|error| error.to_string())?;
    Ok(OrderDraftRecordDto {
        key: OrderDraftKeyDto {
            game_id: record.key.game_id,
            faction_id: record.key.faction_id,
            turn_number: record.key.turn_number,
        },
        order_text: record.order_text,
        updated_at: record.updated_at,
    })
}

/// Loads one order draft for the Tauri command surface.
pub fn command_load_order_draft(
    _database_path: &str,
    _game_id: &str,
    _faction_id: &str,
    _turn_number: u32,
) -> Result<Option<OrderDraftRecordDto>, String> {
    let loaded = load_order_draft(
        Path::new(_database_path),
        &OrderDraftKey {
            game_id: _game_id.to_string(),
            faction_id: _faction_id.to_string(),
            turn_number: _turn_number,
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(loaded.map(|record| OrderDraftRecordDto {
        key: OrderDraftKeyDto {
            game_id: record.key.game_id,
            faction_id: record.key.faction_id,
            turn_number: record.key.turn_number,
        },
        order_text: record.order_text,
        updated_at: record.updated_at,
    }))
}

/// Loads one imported turn payload for the Tauri command surface.
pub fn command_load_imported_turn(
    database_path: &str,
    game_id: &str,
    faction_id: &str,
    turn_number: u32,
) -> Result<Option<ImportedTurnRecordDto>, String> {
    let loaded = load_imported_turn(
        Path::new(database_path),
        &ImportedTurnKey {
            game_id: game_id.to_string(),
            faction_id: faction_id.to_string(),
            turn_number,
        },
    )
    .map_err(|error| error.to_string())?;

    loaded
        .map(|record| {
            let parse_result =
                serde_json::from_str::<ReportParseResult>(&record.parsed_payload_json)
                    .map_err(|error| error.to_string())?;
            Ok(ImportedTurnRecordDto {
                key: OrderDraftKeyDto {
                    game_id: record.key.game_id,
                    faction_id: record.key.faction_id,
                    turn_number: record.key.turn_number,
                },
                raw_report: record.raw_report,
                parse_result: ReportParseResultDto::from(parse_result),
            })
        })
        .transpose()
}

/// One region the faction saw in some earlier turn, as the map wants it.
///
/// The stored payload is a whole `ReportRegion`, exits included, which is what lets an accumulated
/// map join up into a graph a route can cross.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedRegionDto {
    pub region: serde_json::Value,
    pub last_seen_turn: u32,
}

/// Reads back every region this faction has ever been seen in.
///
/// A sighting whose payload cannot be parsed is skipped rather than failing the lot: it was written
/// by an older build, and losing one remembered hex is better than losing the map.
///
/// # Errors
///
/// Returns an error when the database cannot be read.
pub fn command_load_region_sightings(
    database_path: &str,
    game_id: &str,
    faction_id: &str,
) -> Result<Vec<RememberedRegionDto>, String> {
    let sightings = load_region_sightings(Path::new(database_path), game_id, faction_id)
        .map_err(|error| error.to_string())?;

    Ok(sightings
        .into_iter()
        .filter_map(|sighting| {
            serde_json::from_str::<serde_json::Value>(&sighting.payload_json)
                .ok()
                .filter(|payload| !payload.is_null())
                .map(|region| RememberedRegionDto {
                    region,
                    last_seen_turn: sighting.last_seen_turn,
                })
        })
        .collect())
}

/// Parses a report and counts each unit's men against the catalogue.
///
/// The classifying counterpart of `command_parse_report_full`. Kept separate rather than replacing
/// it, because parsing has to keep working with no ruleset loaded.
#[must_use]
pub fn command_parse_report_classified(raw_report: &str, ruleset_json: &str) -> ParsedReport {
    let report = atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::parse_and_classify(cache, raw_report, ruleset_json)
    });
    (*report).clone()
}

/// Plans a route for one unit against a ruleset the caller supplies.
///
/// A thin delegation: the work lives in the core so the wasm adapter can call exactly the same
/// function without depending on this crate, which pulls in native SQLite.
///
/// # Errors
///
/// Returns an error only when the ruleset itself cannot be used, or the destination is not a hex
/// identifier. A route that cannot be planned is a successful answer carrying a reason.
pub fn command_plan_route(
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    unit_id: &str,
    destination: &str,
) -> Result<atlantis_hud_core::movement::request::RoutePlanResponse, String> {
    atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::plan_for_remembered_report(
            cache,
            ruleset_json,
            raw_report,
            remembered_json,
            unit_id,
            destination,
        )
    })
}

#[cfg(test)]
mod plan_route_command_tests {
    use super::*;

    const RULESET: &str = include_str!("../../../config/public/ruleset.json");

    fn corridor(terrain: &str, x: i32, y: i32, exits: &str) -> String {
        format!("{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\nExits:\n{exits}\n")
    }

    /// The command the interface actually calls must plan over the memory it is handed.
    ///
    /// This delegated with a hardcoded empty memory for a while, so importing a second turn grew
    /// the drawn map and left the planner's graph untouched - every route stayed one step long
    /// however many turns had been imported. The core function was correct throughout; nothing
    /// ever called it with anything.
    #[test]
    fn plans_over_the_memory_it_is_handed() {
        let current = format!(
            "Foo (1) Report\n\n{}\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n",
            corridor("plain", 1, 1, "  Southeast : plain (2,2) in Nowhere.")
        );
        let far_side = atlantis_hud_core::report::parse_report_full(&format!(
            "Foo (1) Report\n\n{}",
            corridor(
                "plain",
                2,
                2,
                "  Northwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,3) in Nowhere."
            )
        ));
        let remembered = format!(
            "[{{\"region\":{},\"lastSeenTurn\":40}}]",
            serde_json::to_string(&far_side.regions[0]).expect("serializes")
        );

        let alone =
            command_plan_route(RULESET, &current, "[]", "900", "1:3,3").expect("the ruleset loads");
        assert!(alone.plan.is_none(), "one report cannot reach that far");

        let together = command_plan_route(RULESET, &current, &remembered, "900", "1:3,3")
            .expect("the ruleset loads");
        assert_eq!(
            together
                .plan
                .expect("a route across remembered ground")
                .steps
                .len(),
            2,
            "the memory handed in has to reach the search"
        );
    }
}

/// Manifest fixtures, shared by the test modules below so a change to the manifest shape lands in
/// one place rather than six.
#[cfg(test)]
mod test_support {
    use super::{GameManifestDto, GameMetadataDto};

    pub const OPENED_AT: &str = "2026-08-09T09:00:00Z";

    pub fn manifest_dto(game_id: &str, game_name: &str) -> GameManifestDto {
        GameManifestDto {
            manifest_version: 1,
            metadata: GameMetadataDto {
                game_id: game_id.to_string(),
                game_name: game_name.to_string(),
                ruleset_id: "neworigins".to_string(),
            },
            report_sources: Vec::new(),
            created_at: OPENED_AT.to_string(),
            last_opened_at: OPENED_AT.to_string(),
        }
    }
}

#[cfg(test)]
mod sightings_tests {
    use super::test_support::manifest_dto;
    use super::*;
    use tempfile::tempdir;

    const TURN_71: &str =
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");

    fn game(directory: &std::path::Path) -> OpenedGameDto {
        command_create_game(
            directory.to_str().expect("a path"),
            manifest_dto("faction-95", "Borg TNG"),
        )
        .expect("the game is created")
    }

    /// A committed import is what puts regions in the store, and reading them back is what makes a
    /// route longer than one step possible. Nothing had ever read them back before.
    #[test]
    fn reads_back_the_regions_a_committed_import_stored() {
        let directory = tempdir().expect("a temporary directory");
        let created = game(directory.path());

        command_commit_report_import(&created.database_path, "faction-95", "95", TURN_71, true)
            .expect("the import commits");

        let remembered = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");

        assert_eq!(
            remembered.len(),
            11,
            "the eleven regions the report visited"
        );
        assert!(
            remembered.iter().all(|entry| entry.last_seen_turn == 71),
            "every one of them was seen in turn 71"
        );

        // The payload is a whole region, exits included - which is the point of storing it, and
        // what lets an accumulated map join up.
        let first = &remembered[0].region;
        assert!(
            first.get("exits").is_some(),
            "a remembered region keeps its exits"
        );
        assert!(first.get("terrain").is_some());
    }

    #[test]
    fn a_game_with_no_imports_remembers_nothing() {
        let directory = tempdir().expect("a temporary directory");
        let created = game(directory.path());

        let remembered = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");

        assert!(remembered.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{manifest_dto, OPENED_AT};
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn tauri_adapter_returns_core_contract_values() {
        let response = command_get_engine_info();

        assert_eq!(
            response,
            EngineInfoDto {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }

    #[test]
    fn tauri_adapter_creates_and_reopens_a_game() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        let mut manifest = manifest_dto("faction-12", "Faction 12");
        manifest.report_sources = vec![ReportSourceRefDto {
            source_id: "report-12".to_string(),
            label: "Turn 12 report".to_string(),
        }];

        let created =
            command_create_game(root, manifest.clone()).expect("game creation should succeed");
        let reopened =
            command_open_game(root, "faction-12", OPENED_AT).expect("game reopen should succeed");

        assert_eq!(created.manifest, manifest);
        assert_eq!(reopened.manifest, manifest);
        // The number itself is pinned in the persistence crate, which owns the migrations. What
        // this test is for is that the adapter hands back whatever that layer decided, unaltered.
        assert_eq!(
            created.schema_version,
            atlantis_hud_core_persistence::CURRENT_SCHEMA_VERSION
        );
        assert_eq!(
            reopened.schema_version,
            atlantis_hud_core_persistence::CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn tauri_adapter_previews_and_commits_imports() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            manifest_dto("faction-12", "Faction 12"),
        )
        .expect("create game");
        let report = "\
Atlantis Report For:
Crimson Tide (17) (Magic 5)
March, Year 1

Atlantis Engine Version: 5.2.5 (beta)
NewOrigins, Version: 3.0.0 (beta)

plain (12,34) in Coast of Dawn, contains Dawnhaven [town], 1200 peasants (humans), $500.
------------------------------------------------------------
  Wages: $12.0 (Max: $300).

* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN].
";

        let preview =
            command_preview_report_import(&created.database_path, "faction-12", "17", report)
                .expect("preview import");
        assert_eq!(preview.turn_number, Some(2));
        assert!(!preview.duplicate_preview.exists);
        assert!(preview.parse_result.meets_minimum_import_threshold);

        command_commit_report_import(&created.database_path, "faction-12", "17", report, false)
            .expect("first import should commit");
        let duplicate_error =
            command_commit_report_import(&created.database_path, "faction-12", "17", report, false)
                .expect_err("duplicate without overwrite should fail");
        assert!(duplicate_error.contains("requires explicit overwrite confirmation"));
    }

    #[test]
    fn tauri_adapter_validates_and_loads_order_drafts() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            manifest_dto("faction-12", "Faction 12"),
        )
        .expect("create game");

        let validation = command_validate_orders("FLY 1 2");
        assert_eq!(
            validation.diagnostics,
            vec![OrderDiagnosticDto {
                code: "unknown-command".to_string(),
                message: "unknown order command: FLY".to_string(),
                line_start: 1,
                line_end: 1,
                severity: "error".to_string(),
            }]
        );

        let saved = command_save_order_draft(
            &created.database_path,
            "faction-12",
            "17",
            12,
            "MOVE U100 R2",
            "2026-08-07T12:00:00Z",
        )
        .expect("save draft");
        let loaded = command_load_order_draft(&created.database_path, "faction-12", "17", 12)
            .expect("load draft");

        assert_eq!(loaded, Some(saved));
    }

    #[test]
    fn committing_an_import_records_when_each_region_was_seen() {
        use atlantis_hud_core_persistence::load_region_sightings;

        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            manifest_dto("faction-12", "Faction 12"),
        )
        .expect("create game");

        let report = "\
Atlantis Report For:
Crimson Tide (17) (Magic 5)
March, Year 1

plain (12,34) in Coast of Dawn, contains Dawnhaven [town], 1200 peasants (humans), $500.
------------------------------------------------------------
  Wages: $12.0 (Max: $300).

* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN].
";

        command_commit_report_import(&created.database_path, "faction-12", "17", report, false)
            .expect("commit import");

        let sightings =
            load_region_sightings(Path::new(&created.database_path), "faction-12", "17")
                .expect("load sightings");

        assert_eq!(sightings.len(), 1);
        assert_eq!(sightings[0].region_id, "1:12,34");
        assert_eq!(sightings[0].terrain, "plain");
        // March of Year 1 is turn 2, and the sighting carries that rather than nothing.
        assert_eq!(sightings[0].last_seen_turn, 2);
    }

    #[test]
    fn tauri_adapter_loads_imported_turn_payload_after_commit() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            manifest_dto("faction-12", "Faction 12"),
        )
        .expect("create game");
        let report = "\
Atlantis Report For:
Crimson Tide (17) (Magic 5)
March, Year 1

Atlantis Engine Version: 5.2.5 (beta)
NewOrigins, Version: 3.0.0 (beta)

plain (12,34) in Coast of Dawn, contains Dawnhaven [town], 1200 peasants (humans), $500.
------------------------------------------------------------
  Wages: $12.0 (Max: $300).

* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN].
";

        command_commit_report_import(&created.database_path, "faction-12", "17", report, false)
            .expect("import commit should succeed");

        let loaded = command_load_imported_turn(&created.database_path, "faction-12", "17", 2)
            .expect("load imported turn should succeed")
            .expect("imported turn should exist");

        assert_eq!(loaded.key.game_id, "faction-12");
        assert_eq!(loaded.key.faction_id, "17");
        assert_eq!(loaded.key.turn_number, 2);
        assert_eq!(loaded.parse_result.regions[0].region_id, "1:12,34");
        assert_eq!(loaded.parse_result.units[0].region_id, "1:12,34");
    }
}
