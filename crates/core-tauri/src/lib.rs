//! Tauri command adapter for Atlantis HUD core APIs.

use std::path::Path;

use atlantis_hud_core::report::merge::{merge_report_into_sightings, StoredSighting};
pub use atlantis_hud_core::report::ParsedReport;
use atlantis_hud_core::{
    engine_info, order_commands, parse_report, reject_import, reject_merge, OrderCheckOptions,
    OrderDiagnosticSeverity, ReportParseResult, WarningSeverity,
};
use atlantis_hud_core_persistence::{
    create_game, delete_game, delete_hex_note, export_game, import_game, insert_imported_turn,
    list_games, list_hex_notes, list_imported_turns, load_imported_turn, load_latest_imported_turn,
    load_merged_reports, load_order_draft, load_region_sightings, open_game, preview_imported_turn,
    set_game_ruleset, upsert_hex_note, upsert_imported_turn, upsert_merged_report,
    upsert_order_draft, upsert_region_sightings, GameManifest, GameMetadata, HexNote,
    ImportedTurnKey, ImportedTurnPreview, ImportedTurnRecord, MergedReportRecord, OpenedGame,
    OrderDraftKey, OrderDraftRecord, PersistenceError, ReportSourceRef,
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
pub struct ImportedTurnSummaryDto {
    pub key: OrderDraftKeyDto,
    pub season: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDiagnosticDto {
    pub code: String,
    pub message: String,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
    pub column_start: Option<usize>,
    pub column_end: Option<usize>,
    pub region_id: Option<String>,
    pub unit_id: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HexNoteDto {
    pub id: String,
    pub game_id: String,
    pub region_id: String,
    pub text: String,
    pub on_map: bool,
    pub turn: u32,
    pub created_at: String,
    pub updated_at: String,
}

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

/// Changes which ruleset a game is played under, returning the updated manifest.
///
/// # Errors
///
/// Returns an error when no game exists under this id, or when the change cannot be written.
pub fn command_set_game_ruleset(
    games_root: &str,
    game_id: &str,
    ruleset_id: &str,
) -> Result<GameManifestDto, String> {
    set_game_ruleset(Path::new(games_root), game_id, ruleset_id)
        .map(GameManifestDto::from)
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

/// Serializes one whole game to one JSON document.
pub fn command_export_game(
    games_root: &str,
    game_id: &str,
    exported_at: &str,
) -> Result<String, String> {
    export_game(Path::new(games_root), game_id, exported_at).map_err(|error| error.to_string())
}

/// Creates and opens one whole game from one exported JSON document.
pub fn command_import_game(
    games_root: &str,
    backup_json: &str,
    opened_at: &str,
) -> Result<OpenedGameDto, String> {
    import_game(Path::new(games_root), backup_json, opened_at)
        .map(OpenedGameDto::from)
        .map_err(|error| error.to_string())
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
///
/// `imported_at` comes from the shell rather than from a clock here, the way `opened_at` and an
/// order draft's `updated_at` already do, so both platforms write the same format.
pub fn command_commit_report_import(
    database_path: &str,
    game_id: &str,
    confirmed_faction_id: &str,
    raw_report: &str,
    ruleset_json: Option<&str>,
    allow_overwrite: bool,
    imported_at: &str,
) -> Result<ImportedTurnPreviewDto, String> {
    // Both shapes come off one parse, and that parse is the one the shell already made when it
    // showed the turn: the flat summary the import rules are decided against and that gets stored,
    // and the full model the remembered regions are built from further down.
    //
    // Classified when the shell has a ruleset, exactly as the turn on screen is. The sightings
    // below are the only account of a hex the map ever reads back, so an estimate stored here is
    // an estimate forever - a tilde on every remembered unit, however complete the catalogue.
    let report = atlantis_hud_core::cache::with_global(|cache| {
        cache.classified_when_possible(raw_report, ruleset_json)
    });
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
        upsert_imported_turn(Path::new(database_path), &record, imported_at)
            .map_err(|error| error.to_string())?;
    } else {
        insert_imported_turn(Path::new(database_path), &record, imported_at).map_err(|error| {
            match error {
                PersistenceError::DuplicateImportedTurn { .. } => {
                    "duplicate import exists and requires explicit overwrite confirmation"
                        .to_string()
                }
                _ => error.to_string(),
            }
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

/// The order vocabulary, for the Tauri command surface.
///
/// Exposed so the shell need not keep a hand-copied list of its own beside the core's; the two used
/// to drift, and one of them was wrong.
#[must_use]
pub fn command_order_commands() -> Vec<String> {
    order_commands().into_iter().map(str::to_string).collect()
}

/// Validates one order draft for the Tauri command surface.
///
/// `ruleset_json` is the served ruleset when the shell has it; without it item names go unchecked
/// and everything else is checked as usual. `raw_report` is the turn the orders were written for,
/// when one has been imported: with it the answer covers the checks that read what each unit holds
/// and where it stands, and without it the answer is the syntax check alone.
///
/// Both go through the cache, as they do on the web. This runs whenever the player stops typing,
/// and the desktop is not entitled to be slower about it than the browser.
#[must_use]
pub fn command_validate_orders(
    raw_orders: &str,
    ruleset_json: Option<&str>,
    raw_report: Option<&str>,
    disabled_codes: Vec<String>,
) -> OrderValidationResultDto {
    let options = OrderCheckOptions {
        disabled: disabled_codes.into_iter().collect(),
    };
    let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
        let ruleset = ruleset_json.and_then(|json| cache.ruleset(json).ok());
        let report = raw_report.map(|raw| cache.classified_when_possible(raw, ruleset_json));
        (ruleset, report)
    });

    let result = atlantis_hud_core::validate_turn(
        raw_orders,
        ruleset.as_deref(),
        report.as_deref(),
        options,
    );
    OrderValidationResultDto {
        diagnostics: result
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

/// Persists one order draft for the Tauri command surface.
///
/// # Errors
///
/// Returns an error when the game's database cannot be written.
pub fn command_save_order_draft(
    database_path: &str,
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
    upsert_order_draft(Path::new(database_path), &record).map_err(|error| error.to_string())?;
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
///
/// # Errors
///
/// Returns an error when the game's database cannot be read.
pub fn command_load_order_draft(
    database_path: &str,
    game_id: &str,
    faction_id: &str,
    turn_number: u32,
) -> Result<Option<OrderDraftRecordDto>, String> {
    let loaded = load_order_draft(
        Path::new(database_path),
        &OrderDraftKey {
            game_id: game_id.to_string(),
            faction_id: faction_id.to_string(),
            turn_number,
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

/// Lists a game's hex notes for the Tauri command surface.
///
/// # Errors
///
/// Returns an error when the game's database cannot be read.
pub fn command_list_hex_notes(
    database_path: &str,
    game_id: &str,
) -> Result<Vec<HexNoteDto>, String> {
    list_hex_notes(Path::new(database_path), game_id)
        .map(|notes| notes.into_iter().map(Into::into).collect())
        .map_err(|error| error.to_string())
}

/// Saves one hex note for the Tauri command surface.
///
/// # Errors
///
/// Returns an error when the game's database cannot be written.
pub fn command_save_hex_note(database_path: &str, note: HexNoteDto) -> Result<HexNoteDto, String> {
    let note: HexNote = note.into();
    upsert_hex_note(Path::new(database_path), &note).map_err(|error| error.to_string())?;
    Ok(note.into())
}

/// Deletes one hex note for the Tauri command surface.
///
/// # Errors
///
/// Returns an error when the game's database cannot be written.
pub fn command_delete_hex_note(
    database_path: &str,
    game_id: &str,
    note_id: &str,
) -> Result<bool, String> {
    delete_hex_note(Path::new(database_path), game_id, note_id).map_err(|error| error.to_string())
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

    loaded.map(imported_turn_dto).transpose()
}

/// Loads the turn this game was last worked on, for the Tauri command surface.
///
/// `None` means the game holds no imports, which is what a game just created looks like.
///
/// # Errors
///
/// Returns an error when the database cannot be read, or when a stored payload will not parse.
pub fn command_load_latest_imported_turn(
    database_path: &str,
    game_id: &str,
) -> Result<Option<ImportedTurnRecordDto>, String> {
    load_latest_imported_turn(Path::new(database_path), game_id)
        .map_err(|error| error.to_string())?
        .map(imported_turn_dto)
        .transpose()
}

/// Lists every turn imported for a game, across every faction, for the Tauri command surface.
///
/// # Errors
///
/// Returns an error when the database cannot be read.
pub fn command_list_imported_turns(
    database_path: &str,
    game_id: &str,
) -> Result<Vec<ImportedTurnSummaryDto>, String> {
    let listed = list_imported_turns(Path::new(database_path), game_id)
        .map_err(|error| error.to_string())?;

    Ok(listed
        .into_iter()
        .map(|summary| ImportedTurnSummaryDto {
            key: OrderDraftKeyDto {
                game_id: summary.key.game_id,
                faction_id: summary.key.faction_id,
                turn_number: summary.key.turn_number,
            },
            season: summary.season,
            imported_at: summary.imported_at,
            updated_at: summary.updated_at,
        })
        .collect())
}

fn imported_turn_dto(record: ImportedTurnRecord) -> Result<ImportedTurnRecordDto, String> {
    let parse_result = serde_json::from_str::<ReportParseResult>(&record.parsed_payload_json)
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

/// What merging one allied report did to a faction's map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMergeResultDto {
    pub turn_number: u32,
    pub merged_faction_id: String,
    pub merged_faction_name: String,
    /// Regions the allied report contributed.
    pub merged_region_count: u32,
    /// Of those, the hexes that were new to the map.
    pub new_region_count: u32,
}

/// One allied report folded into a faction's map, as the workspace reads it back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedReportRecordDto {
    pub game_id: String,
    pub faction_id: String,
    pub turn_number: u32,
    pub merged_faction_id: String,
    pub merged_faction_name: String,
    pub merged_at: String,
}

impl From<MergedReportRecord> for MergedReportRecordDto {
    fn from(record: MergedReportRecord) -> Self {
        Self {
            game_id: record.game_id,
            faction_id: record.faction_id,
            turn_number: record.turn_number,
            merged_faction_id: record.merged_faction_id,
            merged_faction_name: record.merged_faction_name,
            merged_at: record.merged_at,
        }
    }
}

/// Folds an allied report for the same turn into the viewer's remembered map.
///
/// Deliberately stores no imported turn of the ally's. The turn on screen is still the viewer's,
/// and writing the ally's would put it at the top of `load_latest_imported_turn` - so reopening the
/// game would come back up as the ally, silently performing the faction switch the player declined.
///
/// The sightings land under `viewer_faction_id`, which is what makes them visible at all: the map
/// is read back for one faction, and a row written under the ally's id would be stored perfectly
/// and never looked at.
///
/// # Errors
///
/// Returns an error when the report cannot be merged into this turn, or when the database cannot be
/// read or written.
pub fn command_merge_report(
    database_path: &str,
    game_id: &str,
    viewer_faction_id: &str,
    viewer_turn_number: u32,
    raw_report: &str,
    ruleset_json: Option<&str>,
    merged_at: &str,
) -> Result<ReportMergeResultDto, String> {
    // Classified for the same reason an import is: the ally's units enter the map through these
    // sightings and nowhere else, so what is stored here is what the table will draw.
    let report = atlantis_hud_core::cache::with_global(|cache| {
        cache.classified_when_possible(raw_report, ruleset_json)
    });
    let parse_result = atlantis_hud_core::summarize(&report);
    if let Some(rejection) = reject_merge(&parse_result, viewer_turn_number) {
        return Err(rejection);
    }

    // Clearing the threshold means the report named its faction, so this is present.
    let ally = parse_result
        .detected_factions
        .first()
        .ok_or_else(|| "parsed report does not name the faction it belongs to".to_string())?;
    if ally.faction_id == viewer_faction_id {
        return Err("a faction's own report is loaded rather than merged".to_string());
    }

    let existing: Vec<StoredSighting> =
        load_region_sightings(Path::new(database_path), game_id, viewer_faction_id)
            .map_err(|error| error.to_string())?
            .iter()
            .map(StoredSighting::from)
            .collect();
    let outcome = merge_report_into_sightings(&existing, &report, viewer_turn_number);

    upsert_region_sightings(
        Path::new(database_path),
        game_id,
        viewer_faction_id,
        &outcome.sightings,
    )
    .map_err(|error| error.to_string())?;

    upsert_merged_report(
        Path::new(database_path),
        &MergedReportRecord {
            game_id: game_id.to_string(),
            faction_id: viewer_faction_id.to_string(),
            turn_number: viewer_turn_number,
            merged_faction_id: ally.faction_id.clone(),
            merged_faction_name: ally.name.clone(),
            merged_at: merged_at.to_string(),
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(ReportMergeResultDto {
        turn_number: viewer_turn_number,
        merged_faction_id: ally.faction_id.clone(),
        merged_faction_name: ally.name.clone(),
        merged_region_count: u32::try_from(outcome.merged_region_count).unwrap_or(u32::MAX),
        new_region_count: u32::try_from(outcome.new_region_count).unwrap_or(u32::MAX),
    })
}

/// Every allied report folded into one faction's map for one turn.
///
/// # Errors
///
/// Returns an error when the database cannot be read.
pub fn command_load_merged_reports(
    database_path: &str,
    game_id: &str,
    faction_id: &str,
    turn_number: u32,
) -> Result<Vec<MergedReportRecordDto>, String> {
    load_merged_reports(Path::new(database_path), game_id, faction_id, turn_number)
        .map(|records| {
            records
                .into_iter()
                .map(MergedReportRecordDto::from)
                .collect()
        })
        .map_err(|error| error.to_string())
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

/// Writes the known map inside one rectangle out as report-shaped text.
///
/// The desktop twin of the wasm binding, delegating to the same core entry so a map exported on
/// the desktop and the same map exported in the browser come out byte for byte identical.
///
/// # Errors
///
/// Returns an error when the remembered regions or the request cannot be read. An empty rectangle
/// is a successful answer carrying a header and no regions.
pub fn command_export_map(
    raw_report: &str,
    remembered_json: &str,
    request_json: &str,
) -> Result<String, String> {
    atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::report::export::export_map_text(
            cache,
            raw_report,
            remembered_json,
            request_json,
        )
    })
}

/// Traces the MOVE or ADVANCE order in a unit's written orders across the remembered map.
///
/// The desktop twin of the wasm binding, delegating to the same core entry so the two shells
/// cannot drift into tracing differently.
///
/// # Errors
///
/// Returns an error only when the ruleset or the remembered regions cannot be read. An order that
/// cannot be traced is a successful answer carrying no path.
pub fn command_trace_move_orders(
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    unit_id: &str,
    orders: &str,
) -> Result<atlantis_hud_core::movement::request::MoveOrderTraceResponse, String> {
    atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::movement::request::trace_orders_for_remembered_report(
            cache,
            ruleset_json,
            raw_report,
            remembered_json,
            unit_id,
            orders,
        )
    })
}

/// What the orders document makes of the faction's units, region by region.
///
/// Returns an error only when the ruleset or the remembered regions cannot be read. Orders that
/// change nothing are a successful, empty answer.
pub fn command_preview_orders(
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    orders_document: &str,
) -> Result<atlantis_hud_core::orders::effects::OrdersPreviewResponse, String> {
    atlantis_hud_core::cache::with_global(|cache| {
        atlantis_hud_core::orders::effects::preview_orders_for_remembered_report(
            cache,
            ruleset_json,
            raw_report,
            remembered_json,
            orders_document,
        )
    })
}

#[cfg(test)]
mod preview_orders_command_tests {
    use super::*;

    const RULESET: &str = include_str!("../../../config/public/ruleset.json");

    #[test]
    fn previews_the_orders_it_is_handed() {
        let report = "Foo (1) Report\n\nplain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n";

        let answer =
            command_preview_orders(RULESET, report, "[]", "unit 900\nNAME UNIT \"Renamed\"\n")
                .expect("the ruleset loads");

        assert_eq!(answer.regions.len(), 1);
        assert_eq!(answer.regions[0].units[0].unit.name, "Renamed");
    }
}

#[cfg(test)]
mod trace_move_orders_command_tests {
    use super::*;

    const RULESET: &str = include_str!("../../../config/public/ruleset.json");

    fn corridor(terrain: &str, x: i32, y: i32, exits: &str) -> String {
        format!("{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\nExits:\n{exits}\n")
    }

    /// The command must trace over the memory it is handed, exactly as the planner learned to.
    /// A hardcoded empty memory here would draw every order one step long.
    #[test]
    fn traces_over_the_memory_it_is_handed() {
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

        let answer = command_trace_move_orders(RULESET, &current, &remembered, "900", "MOVE SE SE")
            .expect("the ruleset loads");
        let path = answer.path.expect("a traced path");

        assert_eq!(path.steps.len(), 2);
        assert_eq!(
            path.steps[1].terrain, "plain",
            "the remembered hex named the far side, so its terrain is real rather than guessed"
        );
    }

    #[test]
    fn an_order_that_is_not_movement_answers_with_no_path() {
        let current = format!(
            "Foo (1) Report\n\n{}\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n",
            corridor("plain", 1, 1, "  Southeast : plain (2,2) in Nowhere.")
        );

        let answer = command_trace_move_orders(RULESET, &current, "[]", "900", "work")
            .expect("the ruleset loads");
        assert_eq!(answer.path, None);
    }
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
        assert!(
            alone
                .plan
                .expect("the fog is crossed by estimate")
                .steps
                .iter()
                .any(|step| step.estimated),
            "one report cannot describe that far, so part of the route is invented"
        );

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
    /// The shell's clock, which is where an import's timestamp comes from.
    pub const IMPORTED_AT: &str = "2026-08-09T10:00:00Z";

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
mod ruleset_command_tests {
    use super::test_support::manifest_dto;
    use super::*;
    use tempfile::tempdir;

    /// The settings dialog's per-game tab drives this command; what it needs back is the updated
    /// manifest, so the shell can refresh its state without a second round trip.
    #[test]
    fn changing_a_games_ruleset_returns_the_updated_manifest() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        command_create_game(root, manifest_dto("faction-95", "Borg TNG")).expect("created");

        let updated = command_set_game_ruleset(root, "faction-95", "magicdeep")
            .expect("the ruleset change should succeed");
        assert_eq!(updated.metadata.ruleset_id, "magicdeep");

        // And it stuck: a fresh listing reads the manifest back off disk.
        let listed = command_list_games(root).expect("listing should succeed");
        assert_eq!(listed[0].metadata.ruleset_id, "magicdeep");
    }

    #[test]
    fn changing_the_ruleset_of_a_missing_game_names_it() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");

        let error = command_set_game_ruleset(root, "no-such-game", "magicdeep")
            .expect_err("changing a missing game should fail");

        assert!(error.contains("no-such-game"));
    }
}

#[cfg(test)]
mod sightings_tests {
    use super::test_support::{manifest_dto, IMPORTED_AT};
    use super::*;
    use tempfile::tempdir;

    const TURN_71: &str =
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");
    /// The catalogue the shell serves, which recognises everything these fixtures carry.
    const RULESET: &str = include_str!("../../../config/public/ruleset.json");

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

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            None,
            true,
            IMPORTED_AT,
        )
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

    /// The shell shows this turn classified, so what it stores must say the same thing: a hex read
    /// back from memory used to carry `menEstimated: true` on every unit forever, however good the
    /// catalogue - which is why merged and remembered units all wore a tilde.
    #[test]
    fn remembered_units_are_counted_when_the_ruleset_is_to_hand() {
        let directory = tempdir().expect("a temporary directory");
        let created = game(directory.path());

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            Some(RULESET),
            true,
            IMPORTED_AT,
        )
        .expect("the import commits");

        let remembered = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");

        let estimated = units_still_estimated(&remembered);
        assert!(
            estimated.is_empty(),
            "every unit in this report classifies exactly, yet these stayed estimates: {estimated:?}"
        );
    }

    /// Without a ruleset the estimate is all there is, and the payload must keep saying so.
    #[test]
    fn without_a_ruleset_the_stored_estimate_says_it_is_one() {
        let directory = tempdir().expect("a temporary directory");
        let created = game(directory.path());

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            None,
            true,
            IMPORTED_AT,
        )
        .expect("the import commits");

        let remembered = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");

        assert!(
            !units_still_estimated(&remembered).is_empty(),
            "with no catalogue to count against, the stored figures are estimates and say so"
        );
    }
}

/// Every `region_id:unit_id` in the stored payloads whose men count is still marked as a guess.
#[cfg(test)]
fn units_still_estimated(remembered: &[RememberedRegionDto]) -> Vec<String> {
    remembered
        .iter()
        .flat_map(|entry| {
            entry
                .region
                .get("units")
                .and_then(|units| units.as_array())
                .into_iter()
                .flatten()
        })
        .filter(|unit| {
            unit.get("menEstimated")
                .and_then(serde_json::Value::as_bool)
                == Some(true)
        })
        .map(|unit| {
            format!(
                "{}:{}",
                unit.get("regionId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("?"),
                unit.get("unitId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("?"),
            )
        })
        .collect()
}

#[cfg(test)]
mod merge_tests {
    use super::test_support::{manifest_dto, IMPORTED_AT};
    use super::*;
    use tempfile::tempdir;

    const TURN_71: &str =
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");
    const ALLY_TURN_71: &str =
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g8-f73-t71.rep");
    const TURN_2: &str =
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g8-f73-t2.rep");
    const RULESET: &str = include_str!("../../../config/public/ruleset.json");
    const MERGED_AT: &str = "2026-08-10T18:30:00Z";

    /// A game with faction 95's turn 71 already imported, which is the state a merge starts from.
    fn game_with_turn_71(directory: &std::path::Path) -> OpenedGameDto {
        let created = command_create_game(
            directory.to_str().expect("a path"),
            manifest_dto("faction-95", "Borg TNG"),
        )
        .expect("the game is created");

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            None,
            true,
            IMPORTED_AT,
        )
        .expect("the viewer's own turn commits");

        created
    }

    #[test]
    fn merging_an_allied_report_grows_the_map_without_giving_it_away() {
        let directory = tempdir().expect("a temporary directory");
        let created = game_with_turn_71(directory.path());

        let result = command_merge_report(
            &created.database_path,
            "faction-95",
            "95",
            71,
            ALLY_TURN_71,
            None,
            MERGED_AT,
        )
        .expect("the merge succeeds");

        assert_eq!(result.merged_faction_id, "73");
        assert_eq!(result.merged_faction_name, "Borg");
        assert_eq!(result.merged_region_count, 3);
        assert_eq!(result.new_region_count, 2);

        let viewers_map = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");
        assert_eq!(
            viewers_map.len(),
            13,
            "eleven of its own and two of the ally's"
        );

        let allys_map = command_load_region_sightings(&created.database_path, "faction-95", "73")
            .expect("the sightings load");
        assert!(
            allys_map.is_empty(),
            "the ally's own map is untouched; merging is not importing"
        );
    }

    /// The ally's units enter the map through storage and nowhere else, so what the merge writes
    /// is what the table draws. Written from the plain parse they all read as guesses - the tilde
    /// on every merged unit - however complete the catalogue was at the time.
    #[test]
    fn merged_units_are_counted_when_the_ruleset_is_to_hand() {
        let directory = tempdir().expect("a temporary directory");
        let created = command_create_game(
            directory.path().to_str().expect("a path"),
            manifest_dto("faction-95", "Borg TNG"),
        )
        .expect("the game is created");

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            Some(RULESET),
            true,
            IMPORTED_AT,
        )
        .expect("the viewer's own turn commits");

        command_merge_report(
            &created.database_path,
            "faction-95",
            "95",
            71,
            ALLY_TURN_71,
            Some(RULESET),
            MERGED_AT,
        )
        .expect("the merge succeeds");

        let viewers_map = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");

        let estimated = units_still_estimated(&viewers_map);
        assert!(
            estimated.is_empty(),
            "both reports classify exactly, yet these stayed estimates: {estimated:?}"
        );
    }

    /// The proof that merging does not switch faction behind the player's back: reopening a game
    /// restores whichever turn was touched last, and a merged-in report must not be a candidate.
    #[test]
    fn merging_leaves_the_turn_that_reopens_alone() {
        let directory = tempdir().expect("a temporary directory");
        let created = game_with_turn_71(directory.path());

        command_merge_report(
            &created.database_path,
            "faction-95",
            "95",
            71,
            ALLY_TURN_71,
            None,
            MERGED_AT,
        )
        .expect("the merge succeeds");

        let latest = command_load_latest_imported_turn(&created.database_path, "faction-95")
            .expect("the lookup succeeds")
            .expect("a turn reopens");
        assert_eq!(latest.key.faction_id, "95");
        assert_eq!(latest.key.turn_number, 71);
    }

    #[test]
    fn merging_records_who_was_merged_and_when() {
        let directory = tempdir().expect("a temporary directory");
        let created = game_with_turn_71(directory.path());

        command_merge_report(
            &created.database_path,
            "faction-95",
            "95",
            71,
            ALLY_TURN_71,
            None,
            MERGED_AT,
        )
        .expect("the merge succeeds");

        let merged = command_load_merged_reports(&created.database_path, "faction-95", "95", 71)
            .expect("the record loads");
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].merged_faction_id, "73");
        assert_eq!(merged[0].merged_faction_name, "Borg");
        assert_eq!(merged[0].merged_at, MERGED_AT);
    }

    #[test]
    fn a_report_from_another_turn_cannot_be_merged() {
        let directory = tempdir().expect("a temporary directory");
        let created = game_with_turn_71(directory.path());

        let rejection = command_merge_report(
            &created.database_path,
            "faction-95",
            "95",
            71,
            TURN_2,
            None,
            MERGED_AT,
        )
        .expect_err("turn 2 is not turn 71");

        assert_eq!(
            rejection,
            "a report from turn 2 cannot be merged into turn 71"
        );
    }

    /// A faction's own report is loaded, not merged. Allowing it would write the turn's regions
    /// twice by two different routes, one of which stores no turn at all.
    #[test]
    fn a_factions_own_report_is_not_something_to_merge() {
        let directory = tempdir().expect("a temporary directory");
        let created = game_with_turn_71(directory.path());

        let rejection = command_merge_report(
            &created.database_path,
            "faction-95",
            "95",
            71,
            TURN_71,
            None,
            MERGED_AT,
        )
        .expect_err("the viewer's own report is refused");

        assert_eq!(
            rejection,
            "a faction's own report is loaded rather than merged"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{manifest_dto, IMPORTED_AT, OPENED_AT};
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

        command_commit_report_import(
            &created.database_path,
            "faction-12",
            "17",
            report,
            None,
            false,
            IMPORTED_AT,
        )
        .expect("first import should commit");
        let duplicate_error = command_commit_report_import(
            &created.database_path,
            "faction-12",
            "17",
            report,
            None,
            false,
            IMPORTED_AT,
        )
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

        let validation = command_validate_orders("FLY 1 2", None, None, Vec::new());
        assert_eq!(
            validation.diagnostics,
            vec![OrderDiagnosticDto {
                code: "unknown-command".to_string(),
                message: "unknown order command: FLY".to_string(),
                line_start: Some(1),
                line_end: Some(1),
                column_start: Some(0),
                column_end: Some(3),
                // A misspelled keyword belongs to no hex and to no unit.
                region_id: None,
                unit_id: None,
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
    fn tauri_adapter_saves_lists_and_deletes_hex_notes() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            manifest_dto("faction-12", "Faction 12"),
        )
        .expect("create game");

        let note = HexNoteDto {
            id: "note-1".to_string(),
            game_id: "faction-12".to_string(),
            region_id: "1:7,53".to_string(),
            text: "Mustn't forget the mountain pass".to_string(),
            on_map: true,
            turn: 12,
            created_at: "2026-08-07T12:00:00Z".to_string(),
            updated_at: "2026-08-07T12:00:00Z".to_string(),
        };
        let saved = command_save_hex_note(&created.database_path, note.clone()).expect("save note");
        assert_eq!(saved, note);

        let listed =
            command_list_hex_notes(&created.database_path, "faction-12").expect("list notes");
        assert_eq!(listed, vec![note]);

        assert!(
            command_delete_hex_note(&created.database_path, "faction-12", "note-1")
                .expect("delete note"),
            "deleting an existing note reports true"
        );
        assert!(
            !command_delete_hex_note(&created.database_path, "faction-12", "note-1")
                .expect("delete note"),
            "deleting an already-deleted note reports false"
        );
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

        command_commit_report_import(
            &created.database_path,
            "faction-12",
            "17",
            report,
            None,
            false,
            IMPORTED_AT,
        )
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

        command_commit_report_import(
            &created.database_path,
            "faction-12",
            "17",
            report,
            None,
            false,
            IMPORTED_AT,
        )
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

    #[test]
    fn command_list_imported_turns_reports_every_committed_turn() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            manifest_dto("faction-12", "Faction 12"),
        )
        .expect("create game");
        let march = "\
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
        let april = "\
Atlantis Report For:
Crimson Tide (17) (Magic 5)
April, Year 1

Atlantis Engine Version: 5.2.5 (beta)
NewOrigins, Version: 3.0.0 (beta)

plain (12,34) in Coast of Dawn, contains Dawnhaven [town], 1200 peasants (humans), $500.
------------------------------------------------------------
  Wages: $12.0 (Max: $300).

* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN].
";

        command_commit_report_import(
            &created.database_path,
            "faction-12",
            "17",
            march,
            None,
            false,
            IMPORTED_AT,
        )
        .expect("march should commit");
        command_commit_report_import(
            &created.database_path,
            "faction-12",
            "17",
            april,
            None,
            false,
            IMPORTED_AT,
        )
        .expect("april should commit");

        let listed = command_list_imported_turns(&created.database_path, "faction-12")
            .expect("listing should succeed");

        let turn_numbers: Vec<u32> = listed
            .iter()
            .map(|summary| summary.key.turn_number)
            .collect();
        assert_eq!(turn_numbers, vec![2, 3]);
        assert_eq!(listed[0].season.as_deref(), Some("March"));
        assert_eq!(listed[1].season.as_deref(), Some("April"));
    }
}
