//! Tauri command adapter for Atlantis HUD core APIs.
//!
//! With the `tauri` feature on, the functions in [`commands`] *are* the desktop's Tauri
//! commands: each carries `#[tauri::command]` itself, renamed to its bare name (`command_x` →
//! `x`), and the desktop shell registers them by path rather than wrapping each one again. With
//! the feature off (the default, so `cargo check --workspace` never builds `tauri`) they are
//! plain functions this crate's own tests call directly. The eight commands that resolve a
//! game's `games_root` are the exception: they are wrapped in the shell, which is the only place
//! the games directory is known.

use std::path::Path;

use atlantis_hud_core::report::import::{import_writes, SeenRegion};
use atlantis_hud_core::report::merge::{
    merge_map_export_into_sightings, merge_report_into_sightings, StoredSighting,
};
pub use atlantis_hud_core::report::ParsedReport;
use atlantis_hud_core::{
    completions_at_caret, engine_info, order_argument_completions, order_commands,
    order_vocabulary, parse_report, plan_merge, reject_import, CaretCompletions, EngineInfo,
    MergePlan, OrderCheckOptions, OrderCompletion, OrderValidationResult, ReportParseResult,
    ReportParseResultWire,
};
use atlantis_hud_core_persistence::{
    create_game, delete_army, delete_game, delete_hex_note, export_game, import_game,
    insert_imported_turn, list_allied_mages, list_armies, list_games, list_hex_notes,
    list_imported_turns, list_study_plans, load_imported_turn, load_imported_turn_stamps,
    load_latest_imported_turn, load_merged_reports, load_order_draft, load_region_sightings,
    open_game, preview_imported_turn, reset_game, save_allied_mages, save_study_plans,
    set_active_faction, set_game_map, set_game_name, set_game_ruleset, upsert_army,
    upsert_hex_note, upsert_imported_turn, upsert_merged_report, upsert_order_draft,
    upsert_region_sightings, AlliedMage, AlliedMageKey, Army, ArmyMember, HexNote, ImportedTurnKey,
    ImportedTurnPreview, ImportedTurnRecord, MergedReportRecord, OpenedGame, OrderDraftKey,
    OrderDraftRecord, PersistenceError, StudyPlan, StudyPlanKey,
};
/// The manifest types cross to the shell as themselves: `core-tauri` used to carry a field-for-field
/// `…Dto` copy of each, whose own comments said so (ah-8z4y.2).
pub use atlantis_hud_core_persistence::{GameManifest, GameMetadata, ReportSourceRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedGameDto {
    pub game_file_path: String,
    pub database_path: String,
    pub schema_version: u32,
    pub manifest: GameManifest,
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
    pub parse_result: ReportParseResultWire,
    pub duplicate_preview: ImportedTurnPreviewDto,
    pub turn_number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTurnRecordDto {
    pub key: OrderDraftKeyDto,
    pub raw_report: String,
    pub parse_result: ReportParseResultWire,
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

/// One Army over the wire. Members cross as they are - `ArmyMember` is already `camelCase` serde,
/// so no per-field DTO is needed for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmyDto {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub members: Vec<ArmyMember>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Army> for ArmyDto {
    fn from(value: Army) -> Self {
        Self {
            id: value.id,
            game_id: value.game_id,
            name: value.name,
            members: value.members,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<ArmyDto> for Army {
    fn from(value: ArmyDto) -> Self {
        Self {
            id: value.id,
            game_id: value.game_id,
            name: value.name,
            members: value.members,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<OpenedGame> for OpenedGameDto {
    fn from(value: OpenedGame) -> Self {
        Self {
            game_file_path: value.game_file_path.to_string_lossy().to_string(),
            database_path: value.database_path.to_string_lossy().to_string(),
            schema_version: value.schema_version,
            manifest: value.manifest,
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

pub mod commands {
    use super::*;

    /// Returns canonical engine metadata for the Tauri command surface.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "get_engine_info")
    )]
    pub fn command_get_engine_info() -> EngineInfo {
        engine_info()
    }

    /// Parses a report into the full domain model.
    ///
    /// Returned as the model itself rather than as JSON. It already serializes to exactly the shape the
    /// TypeScript side declares, so converting to a `Value` first would only add a round trip, and it
    /// would force the desktop shell to depend on `serde_json` for a type it never inspects.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "parse_report_full")
    )]
    pub fn command_parse_report_full(raw_report: &str) -> ParsedReport {
        atlantis_hud_core::report::parse_report_full(raw_report)
    }

    /// Every combat skill the report's battle rosters disclosed, in report order.
    ///
    /// Deliberately **not** through `atlantis_hud_core::cache` - the only caller is a scan over many
    /// stored turns, and the cache holds one report, so going through it would evict the player's
    /// open turn on every iteration and make the next order-validation keystroke re-parse it.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "roster_skills")
    )]
    pub fn command_roster_skills(
        raw_report: &str,
    ) -> Vec<atlantis_hud_core::report::battle::RosterSkills> {
        atlantis_hud_core::report::battle::roster_skills(
            &atlantis_hud_core::report::parse_report_full(raw_report).battles,
        )
    }

    /// Parses one report and returns tolerant parser output.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "parse_report")
    )]
    pub fn command_parse_report(raw_report: &str) -> ReportParseResultWire {
        ReportParseResultWire::from(parse_report(raw_report))
    }

    /// Parses one report and previews duplicate conflict for a confirmed faction.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "preview_report_import")
    )]
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
            parse_result: ReportParseResultWire::from(parse_result),
            duplicate_preview: preview,
            turn_number,
        })
    }

    /// Parses and commits one report import after faction confirmation.
    ///
    /// `imported_at` comes from the shell rather than from a clock here, the way `opened_at` and an
    /// order draft's `updated_at` already do, so both platforms write the same format.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "commit_report_import")
    )]
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

        // What the store already holds is handed to the core, and what comes back is written as
        // it is: whether an older report may overwrite a hex, and which stamp a re-import keeps,
        // are the core's rules, decided once for both platforms (`import_writes`).
        let existing = load_imported_turn_stamps(Path::new(database_path), &record.key)
            .map_err(|error| error.to_string())?;
        let seen: Vec<SeenRegion> =
            load_region_sightings(Path::new(database_path), game_id, confirmed_faction_id)
                .map_err(|error| error.to_string())?
                .iter()
                .map(SeenRegion::from)
                .collect();
        let writes = import_writes(
            &report,
            turn_number,
            existing.as_ref().map(|stamps| stamps.imported_at.as_str()),
            &seen,
            imported_at,
        );

        if allow_overwrite {
            upsert_imported_turn(
                Path::new(database_path),
                &record,
                &writes.imported_at,
                &writes.updated_at,
            )
            .map_err(|error| error.to_string())?;
        } else {
            insert_imported_turn(
                Path::new(database_path),
                &record,
                &writes.imported_at,
                &writes.updated_at,
            )
            .map_err(|error| match error {
                PersistenceError::DuplicateImportedTurn { .. } => {
                    "duplicate import exists and requires explicit overwrite confirmation"
                        .to_string()
                }
                _ => error.to_string(),
            })?;
        }

        // Regions get their own rows as well as living inside the turn payload, each carrying the turn
        // it was seen in. Without this the map cannot tell a region in the current report from one held
        // over from an earlier turn, which is the difference between two of its four states. Which
        // rows to write was already decided above, by `import_writes`.
        upsert_region_sightings(
            Path::new(database_path),
            game_id,
            confirmed_faction_id,
            &writes.region_sightings,
        )
        .map_err(|error| error.to_string())?;

        Ok(ImportedTurnPreviewDto::from(preview))
    }

    /// The order vocabulary, for the Tauri command surface.
    ///
    /// Exposed so the shell need not keep a hand-copied list of its own beside the core's; the two used
    /// to drift, and one of them was wrong.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "order_commands")
    )]
    pub fn command_order_commands() -> Vec<String> {
        order_commands().into_iter().map(str::to_string).collect()
    }

    /// Every word the rules know, for the editor that has to spot a keyword as it is typed.
    ///
    /// `ruleset_json` goes through the cache exactly as `command_order_argument_completions` does.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "order_vocabulary")
    )]
    pub fn command_order_vocabulary(ruleset_json: Option<&str>) -> Vec<String> {
        let ruleset = atlantis_hud_core::cache::with_global(|cache| {
            ruleset_json.and_then(|json| cache.ruleset(json).ok())
        });

        order_vocabulary(ruleset.as_deref())
    }

    /// What may stand where the caret is, for the Tauri command surface.
    ///
    /// `ruleset_json` and `raw_report` go through the cache exactly as `command_validate_orders`
    /// does; `unit_id` is whose block is being typed, which is what makes the hex-narrowed
    /// positions (`BUY`, `SELL`, `PRODUCE`) answerable at all.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "order_argument_completions")
    )]
    pub fn command_order_argument_completions(
        line_prefix: &str,
        ruleset_json: Option<&str>,
        raw_report: Option<&str>,
        unit_id: Option<&str>,
    ) -> Vec<OrderCompletion> {
        let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
            let ruleset = ruleset_json.and_then(|json| cache.ruleset(json).ok());
            let report = raw_report.map(|raw| cache.classified_when_possible(raw, ruleset_json));
            (ruleset, report)
        });

        order_argument_completions(line_prefix, ruleset.as_deref(), report.as_deref(), unit_id)
    }

    /// Where the caret is in one order line, for the Tauri command surface.
    ///
    /// One call for all three completion sources, with the position decided in the core so no shell
    /// keeps a rule of its own (ah-vfq). The cache is used exactly as
    /// `command_order_argument_completions` uses it.
    #[must_use]
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "completions_at_caret")
    )]
    pub fn command_completions_at_caret(
        line_prefix: &str,
        ruleset_json: Option<&str>,
        raw_report: Option<&str>,
        unit_id: Option<&str>,
    ) -> CaretCompletions {
        let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
            let ruleset = ruleset_json.and_then(|json| cache.ruleset(json).ok());
            let report = raw_report.map(|raw| cache.classified_when_possible(raw, ruleset_json));
            (ruleset, report)
        });

        completions_at_caret(line_prefix, ruleset.as_deref(), report.as_deref(), unit_id)
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "validate_orders")
    )]
    pub fn command_validate_orders(
        raw_orders: &str,
        ruleset_json: Option<&str>,
        raw_report: Option<&str>,
        disabled_codes: Option<Vec<String>>,
    ) -> OrderValidationResult {
        // Absent means the conservative default: `hex-unguarded` off, same as the bool this
        // replaced defaulted to `false` (do not warn). Reuses `OrderCheckOptions::default()`
        // rather than a hard-coded literal, so a renamed code cannot drift the two out of step.
        // (Moved here from main.rs's wrapper, ah-wxk.1.)
        let disabled = disabled_codes
            .map(|codes| codes.into_iter().collect())
            .unwrap_or_else(|| OrderCheckOptions::default().disabled);
        let options = OrderCheckOptions { disabled };
        let (ruleset, report) = atlantis_hud_core::cache::with_global(|cache| {
            let ruleset = ruleset_json.and_then(|json| cache.ruleset(json).ok());
            let report = raw_report.map(|raw| cache.classified_when_possible(raw, ruleset_json));
            (ruleset, report)
        });

        atlantis_hud_core::validate_turn(raw_orders, ruleset.as_deref(), report.as_deref(), options)
    }

    /// Persists one order draft for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be written.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "save_order_draft")
    )]
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "load_order_draft")
    )]
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "list_hex_notes")
    )]
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "save_hex_note")
    )]
    pub fn command_save_hex_note(
        database_path: &str,
        note: HexNoteDto,
    ) -> Result<HexNoteDto, String> {
        let note: HexNote = note.into();
        upsert_hex_note(Path::new(database_path), &note).map_err(|error| error.to_string())?;
        Ok(note.into())
    }

    /// Deletes one hex note for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be written.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "delete_hex_note")
    )]
    pub fn command_delete_hex_note(
        database_path: &str,
        game_id: &str,
        note_id: &str,
    ) -> Result<bool, String> {
        delete_hex_note(Path::new(database_path), game_id, note_id)
            .map_err(|error| error.to_string())
    }

    /// Lists a game's Armies for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be read.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "list_armies")
    )]
    pub fn command_list_armies(database_path: &str, game_id: &str) -> Result<Vec<ArmyDto>, String> {
        list_armies(Path::new(database_path), game_id)
            .map(|armies| armies.into_iter().map(Into::into).collect())
            .map_err(|error| error.to_string())
    }

    /// Saves one Army for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be written.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "save_army")
    )]
    pub fn command_save_army(database_path: &str, army: ArmyDto) -> Result<ArmyDto, String> {
        let army: Army = army.into();
        upsert_army(Path::new(database_path), &army).map_err(|error| error.to_string())?;
        Ok(army.into())
    }

    /// Deletes one Army for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be written.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "delete_army")
    )]
    pub fn command_delete_army(
        database_path: &str,
        game_id: &str,
        army_id: &str,
    ) -> Result<bool, String> {
        delete_army(Path::new(database_path), game_id, army_id).map_err(|error| error.to_string())
    }

    /// Lists a game's allied mages for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be read.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "list_allied_mages")
    )]
    pub fn command_list_allied_mages(
        database_path: &str,
        game_id: &str,
    ) -> Result<Vec<AlliedMage>, String> {
        list_allied_mages(Path::new(database_path), game_id).map_err(|error| error.to_string())
    }

    /// Stores one sheet's mages and drops the ones the player discarded, in one transaction.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be written.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "save_allied_mages")
    )]
    pub fn command_save_allied_mages(
        database_path: &str,
        game_id: &str,
        mages: Vec<AlliedMage>,
        removed: Vec<AlliedMageKey>,
    ) -> Result<(), String> {
        save_allied_mages(Path::new(database_path), game_id, &mages, &removed)
            .map_err(|error| error.to_string())
    }

    /// Every study plan of one game, in the store's order.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be read.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "list_study_plans")
    )]
    pub fn command_list_study_plans(
        database_path: &str,
        game_id: &str,
    ) -> Result<Vec<StudyPlan>, String> {
        list_study_plans(Path::new(database_path), game_id).map_err(|error| error.to_string())
    }

    /// Stores study plans and drops the rows the player cleared, in one transaction.
    ///
    /// # Errors
    ///
    /// Returns an error when the game's database cannot be written.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "save_study_plans")
    )]
    pub fn command_save_study_plans(
        database_path: &str,
        game_id: &str,
        plans: Vec<StudyPlan>,
        removed: Vec<StudyPlanKey>,
    ) -> Result<(), String> {
        save_study_plans(Path::new(database_path), game_id, &plans, &removed)
            .map_err(|error| error.to_string())
    }

    /// Loads one imported turn payload for the Tauri command surface.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "load_imported_turn")
    )]
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "load_latest_imported_turn")
    )]
    pub fn command_load_latest_imported_turn(
        database_path: &str,
        game_id: &str,
        active_faction_id: Option<String>,
    ) -> Result<Option<ImportedTurnRecordDto>, String> {
        load_latest_imported_turn(
            Path::new(database_path),
            game_id,
            active_faction_id.as_deref(),
        )
        .map_err(|error| error.to_string())?
        .map(imported_turn_dto)
        .transpose()
    }

    /// Lists every turn imported for a game, across every faction, for the Tauri command surface.
    ///
    /// # Errors
    ///
    /// Returns an error when the database cannot be read.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "list_imported_turns")
    )]
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

    /// Reads back every region this faction has ever been seen in.
    ///
    /// A sighting whose payload cannot be parsed is skipped rather than failing the lot: it was written
    /// by an older build, and losing one remembered hex is better than losing the map.
    ///
    /// # Errors
    ///
    /// Returns an error when the database cannot be read.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "load_region_sightings")
    )]
    pub fn command_load_region_sightings(
        database_path: &str,
        game_id: &str,
        faction_id: &str,
    ) -> Result<Vec<RememberedRegionDto>, String> {
        let sightings = load_region_sightings(Path::new(database_path), game_id, faction_id)
            .map_err(|error| error.to_string())?;

        // Which hexes survive, what a stored payload is back-filled with, and the order they come
        // back in are all the core's (`ah-8z4y.3.2`); the SQL's `ORDER BY` above implements that
        // order with an index and hands this a list already in it.
        Ok(atlantis_hud_core::report::sighting::remembered_regions(
            sightings.iter().map(StoredSighting::from).collect(),
        )
        .into_iter()
        .map(|hex| RememberedRegionDto {
            region: hex.region,
            last_seen_turn: hex.last_seen_turn,
        })
        .collect())
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "merge_report")
    )]
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

        // `plan_merge` decides which of the three this file is: one of our own map exports, an
        // allied report, or neither. It lives in the core so the browser cannot answer differently.
        let plan = plan_merge(
            raw_report,
            &parse_result,
            viewer_turn_number,
            viewer_faction_id,
        );
        if let MergePlan::Refused(rejection) = plan {
            return Err(rejection);
        }

        // Clearing the threshold means the report named its faction, so this is present.
        let ally = parse_result
            .detected_factions
            .first()
            .ok_or_else(|| "parsed report does not name the faction it belongs to".to_string())?;
        let existing: Vec<StoredSighting> =
            load_region_sightings(Path::new(database_path), game_id, viewer_faction_id)
                .map_err(|error| error.to_string())?
                .iter()
                .map(StoredSighting::from)
                .collect();
        let outcome = match &plan {
            MergePlan::Refused(_) => unreachable!("refused above"),
            MergePlan::AlliedReport => {
                merge_report_into_sightings(&existing, &report, viewer_turn_number)
            }
            MergePlan::MapExport { file_turn, ages } => {
                merge_map_export_into_sightings(&existing, &report, *file_turn, ages)
            }
        };

        upsert_region_sightings(
            Path::new(database_path),
            game_id,
            viewer_faction_id,
            &outcome.sightings,
        )
        .map_err(|error| error.to_string())?;

        // A map export of the viewer's own map writes no provenance row: its key would name the
        // viewer as their own ally, which is nonsense in front of anything reading merged reports.
        // An ally's map export still writes one, which is the provenance worth keeping.
        let own_map_export =
            matches!(plan, MergePlan::MapExport { .. }) && ally.faction_id == viewer_faction_id;
        if !own_map_export {
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
        }

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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "load_merged_reports")
    )]
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "parse_report_classified")
    )]
    pub fn command_parse_report_classified(raw_report: &str, ruleset_json: &str) -> ParsedReport {
        let report = atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::movement::request::parse_and_classify(
                cache,
                raw_report,
                ruleset_json,
            )
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "plan_route")
    )]
    pub fn command_plan_route(
        ruleset_json: &str,
        raw_report: &str,
        remembered_json: &str,
        unit_id: &str,
        destination: &str,
        map_json: &str,
    ) -> Result<atlantis_hud_core::movement::request::RoutePlanResponse, String> {
        atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::movement::request::plan_on_map(
                cache,
                ruleset_json,
                raw_report,
                remembered_json,
                unit_id,
                destination,
                map_json,
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "export_map")
    )]
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

    /// Writes every named unit out as a report fragment an ally can read back.
    ///
    /// # Errors
    ///
    /// Returns an error when the unit ids cannot be read. An empty list is a successful answer
    /// carrying a header and no units.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "export_mage_sheet")
    )]
    pub fn command_export_mage_sheet(
        raw_report: &str,
        unit_ids_json: &str,
    ) -> Result<String, String> {
        atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::report::export::export_mage_sheet_text(
                cache,
                raw_report,
                unit_ids_json,
            )
        })
    }

    /// Resolves everything the faction knows about the map, once, for a caller on either shell.
    ///
    /// The desktop twin of the wasm binding, delegating to the same core entry so the two shells
    /// cannot drift about who is in a hex.
    ///
    /// # Errors
    ///
    /// Returns an error when the remembered regions cannot be read.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "known_map")
    )]
    pub fn command_known_map(
        raw_report: &str,
        ruleset_json: Option<&str>,
        remembered_json: &str,
    ) -> Result<atlantis_hud_core::known_map::KnownMap, String> {
        atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::known_map::known_map_json(
                cache,
                raw_report,
                ruleset_json,
                remembered_json,
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
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "trace_move_orders")
    )]
    pub fn command_trace_move_orders(
        ruleset_json: &str,
        raw_report: &str,
        remembered_json: &str,
        unit_id: &str,
        orders_document: &str,
        map_json: &str,
    ) -> Result<atlantis_hud_core::movement::request::MoveOrderTraceResponse, String> {
        atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::movement::request::trace_orders_on_map(
                cache,
                ruleset_json,
                raw_report,
                remembered_json,
                unit_id,
                orders_document,
                map_json,
            )
        })
    }

    /// What the orders document makes of the faction's units, region by region.
    ///
    /// Returns an error only when the ruleset or the remembered regions cannot be read. Orders that
    /// change nothing are a successful, empty answer.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "preview_orders")
    )]
    pub fn command_preview_orders(
        ruleset_json: &str,
        raw_report: &str,
        remembered_json: &str,
        orders_document: &str,
        map_json: &str,
    ) -> Result<atlantis_hud_core::orders::effects::OrdersPreviewResponse, String> {
        atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::orders::effects::preview_orders_on_map(
                cache,
                ruleset_json,
                raw_report,
                remembered_json,
                orders_document,
                map_json,
            )
        })
    }

    /// Every trade worth making in the map the faction has seen.
    ///
    /// The desktop twin of the wasm binding, delegating to the same core entry so the two shells
    /// cannot drift into pricing trades differently.
    ///
    /// # Errors
    ///
    /// Returns an error only when the ruleset cannot be used or the remembered regions cannot be
    /// read. A report with nothing to trade is a successful answer carrying an empty list.
    #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "trade_routes")
    )]
    pub fn command_trade_routes(
        ruleset_json: &str,
        raw_report: &str,
        remembered_json: &str,
        map_json: &str,
    ) -> Result<Vec<atlantis_hud_core::trade::TradeRoute>, String> {
        atlantis_hud_core::cache::with_global(|cache| {
            atlantis_hud_core::trade::trade_routes_on_map(
                cache,
                ruleset_json,
                raw_report,
                remembered_json,
                map_json,
            )
        })
    }
}

pub use commands::{
    command_commit_report_import, command_completions_at_caret, command_delete_army,
    command_delete_hex_note, command_export_mage_sheet, command_export_map,
    command_get_engine_info, command_known_map, command_list_allied_mages, command_list_armies,
    command_list_hex_notes, command_list_imported_turns, command_list_study_plans,
    command_load_imported_turn, command_load_latest_imported_turn, command_load_merged_reports,
    command_load_order_draft, command_load_region_sightings, command_merge_report,
    command_order_argument_completions, command_order_commands, command_order_vocabulary,
    command_parse_report, command_parse_report_classified, command_parse_report_full,
    command_plan_route, command_preview_orders, command_preview_report_import,
    command_roster_skills, command_save_allied_mages, command_save_army, command_save_hex_note,
    command_save_order_draft, command_save_study_plans, command_trace_move_orders,
    command_trade_routes, command_validate_orders,
};

/// Creates a game under the application's games directory and applies migrations.
///
/// # Errors
///
/// Returns an error when a game already exists under this id, or when it cannot be written.
pub fn command_create_game(
    games_root: &str,
    manifest: GameManifest,
) -> Result<OpenedGameDto, String> {
    create_game(Path::new(games_root), &manifest)
        .map(OpenedGameDto::from)
        .map_err(|error| error.to_string())
}

/// Every game the player has, newest activity first is the caller's business, not ours.
///
/// # Errors
///
/// Returns an error when the games directory exists but cannot be read.
pub fn command_list_games(games_root: &str) -> Result<Vec<GameManifest>, String> {
    list_games(Path::new(games_root)).map_err(|error| error.to_string())
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
) -> Result<GameManifest, String> {
    set_game_ruleset(Path::new(games_root), game_id, ruleset_id).map_err(|error| error.to_string())
}

/// Records the map a game is played on, returning the updated manifest.
///
/// `map_json` is the game's `{"width":..,"height":..,"wrapX":..,"wrapY":..}`, or empty to clear it
/// - which puts the game back to assuming its ruleset's declared default.
///
/// # Errors
///
/// Returns an error when no game exists under this id, when the map cannot be read, or when the
/// change cannot be written.
pub fn command_set_game_map(
    games_root: &str,
    game_id: &str,
    map_json: &str,
) -> Result<GameManifest, String> {
    let map = atlantis_hud_core::movement::graph::geometry_from_json(map_json)?;
    set_game_map(Path::new(games_root), game_id, map).map_err(|error| error.to_string())
}

/// Renames a game, returning the updated manifest.
///
/// # Errors
///
/// Returns an error when no game exists under this id, or when the change cannot be written.
pub fn command_set_game_name(
    games_root: &str,
    game_id: &str,
    game_name: &str,
) -> Result<GameManifest, String> {
    set_game_name(Path::new(games_root), game_id, game_name).map_err(|error| error.to_string())
}

/// Records which faction in this game is the player's, returning the updated manifest.
///
/// # Errors
///
/// Returns an error when no game exists under this id, or when the change cannot be written.
pub fn command_set_active_faction(
    games_root: &str,
    game_id: &str,
    faction_id: &str,
) -> Result<GameManifest, String> {
    set_active_faction(Path::new(games_root), game_id, faction_id)
        .map_err(|error| error.to_string())
}

/// Empties a game and keeps it, returning the fresh game.
///
/// # Errors
///
/// Returns an error when no game exists under this id, or when it cannot be replaced.
pub fn command_reset_game(
    games_root: &str,
    game_id: &str,
    now: &str,
) -> Result<OpenedGameDto, String> {
    reset_game(Path::new(games_root), game_id, now)
        .map(OpenedGameDto::from)
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
        parse_result: ReportParseResultWire::from(parse_result),
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

#[cfg(test)]
mod preview_orders_command_tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    #[test]
    fn previews_the_orders_it_is_handed() {
        let report = "Foo (1) Report\n\nplain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n";

        let answer = command_preview_orders(
            RULESET,
            report,
            "[]",
            "unit 900\nNAME UNIT \"Renamed\"\n",
            "",
        )
        .expect("the ruleset loads");

        assert_eq!(answer.regions.len(), 1);
        assert_eq!(answer.regions[0].units[0].unit.name, "Renamed");
    }
}

#[cfg(test)]
mod trace_move_orders_command_tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

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

        // The whole orders document, not one unit's block: a passenger's route is the hull's, so
        // the core is given every unit's orders and finds the one this unit follows (ah-048).
        let answer = command_trace_move_orders(
            RULESET,
            &current,
            &remembered,
            "900",
            "unit 900\nMOVE SE SE",
            "",
        )
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

        let answer =
            command_trace_move_orders(RULESET, &current, "[]", "900", "unit 900\nwork", "")
                .expect("the ruleset loads");
        assert_eq!(answer.path, None);
    }
}

#[cfg(test)]
mod plan_route_command_tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

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

        let alone = command_plan_route(RULESET, &current, "[]", "900", "1:3,3", "")
            .expect("the ruleset loads");
        assert!(
            alone
                .plan
                .expect("the fog is crossed by estimate")
                .steps
                .iter()
                .any(|step| step.estimated),
            "one report cannot describe that far, so part of the route is invented"
        );

        let together = command_plan_route(RULESET, &current, &remembered, "900", "1:3,3", "")
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
    use super::{GameManifest, GameMetadata};

    pub const OPENED_AT: &str = "2026-08-09T09:00:00Z";
    /// The shell's clock, which is where an import's timestamp comes from.
    pub const IMPORTED_AT: &str = "2026-08-09T10:00:00Z";

    pub fn a_manifest(game_id: &str, game_name: &str) -> GameManifest {
        GameManifest {
            manifest_version: 1,
            metadata: GameMetadata {
                game_id: game_id.to_string(),
                game_name: game_name.to_string(),
                ruleset_id: "neworigins".to_string(),
                active_faction_id: None,
                map: None,
            },
            report_sources: Vec::new(),
            created_at: OPENED_AT.to_string(),
            last_opened_at: OPENED_AT.to_string(),
        }
    }
}

#[cfg(test)]
mod ruleset_command_tests {
    use super::test_support::a_manifest;
    use super::*;
    use tempfile::tempdir;

    /// The settings dialog's per-game tab drives this command; what it needs back is the updated
    /// manifest, so the shell can refresh its state without a second round trip.
    #[test]
    fn changing_a_games_ruleset_returns_the_updated_manifest() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        command_create_game(root, a_manifest("faction-95", "Borg TNG")).expect("created");

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
mod rename_command_tests {
    use super::test_support::a_manifest;
    use super::*;
    use tempfile::tempdir;

    /// The This game panel drives this command; what it needs back is the updated manifest, so the
    /// shell can refresh its state without a second round trip.
    #[test]
    fn renaming_a_game_returns_the_updated_manifest() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        command_create_game(root, a_manifest("faction-95", "Borg TNG")).expect("created");

        let updated = command_set_game_name(root, "faction-95", "Binding of the North")
            .expect("the rename should succeed");
        assert_eq!(updated.metadata.game_name, "Binding of the North");

        // And it stuck: a fresh listing reads the manifest back off disk.
        let listed = command_list_games(root).expect("listing should succeed");
        assert_eq!(listed[0].metadata.game_name, "Binding of the North");
    }

    #[test]
    fn setting_the_active_faction_returns_the_updated_manifest() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        command_create_game(root, a_manifest("faction-95", "Borg TNG")).expect("created");

        let updated = command_set_active_faction(root, "faction-95", "95")
            .expect("recording the active faction should succeed");
        assert_eq!(updated.metadata.active_faction_id, Some("95".to_string()));

        // And it stuck: a fresh listing reads the manifest back off disk.
        let listed = command_list_games(root).expect("listing should succeed");
        assert_eq!(listed[0].metadata.active_faction_id, Some("95".to_string()));
    }

    #[test]
    fn renaming_a_missing_game_names_it() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");

        let error = command_set_game_name(root, "no-such-game", "Binding of the North")
            .expect_err("renaming a missing game should fail");

        assert!(error.contains("no-such-game"));
    }

    #[test]
    fn resetting_a_game_returns_the_fresh_game() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        command_create_game(root, a_manifest("faction-95", "Borg TNG")).expect("created");
        command_set_active_faction(root, "faction-95", "95").expect("faction recorded");

        let reset = command_reset_game(root, "faction-95", "2026-08-17T09:00:00Z")
            .expect("the reset should succeed");

        assert_eq!(reset.manifest.metadata.game_id, "faction-95");
        assert_eq!(reset.manifest.metadata.game_name, "Borg TNG");
        assert_eq!(reset.manifest.metadata.active_faction_id, None);
        assert!(reset.manifest.report_sources.is_empty());

        // And it stuck: a fresh listing reads the manifest back off disk.
        let listed = command_list_games(root).expect("listing should succeed");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].metadata.game_name, "Borg TNG");
        assert!(listed[0].report_sources.is_empty());
    }
}

#[cfg(test)]
mod sightings_tests {
    use super::test_support::{a_manifest, IMPORTED_AT};
    use super::*;
    use tempfile::tempdir;

    const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
    const TURN_70: &str = atlantis_hud_fixtures::G7_F95_T70.text;
    /// The catalogue the shell serves, which recognises everything these fixtures carry.
    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn game(directory: &std::path::Path) -> OpenedGameDto {
        command_create_game(
            directory.to_str().expect("a path"),
            a_manifest("faction-95", "Borg TNG"),
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

    /// The whole desktop path, end to end: an older turn imported after a newer one leaves the
    /// newer account of a shared hex in place. `TURN_70` names exactly one region, a swamp at
    /// (10,50) in Cebo, which `TURN_71` also names.
    #[test]
    fn importing_an_older_report_leaves_the_newer_memory_of_a_hex() {
        let directory = tempdir().expect("a temporary directory");
        let created = game(directory.path());

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            None,
            false,
            IMPORTED_AT,
        )
        .expect("the newer import commits");
        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_70,
            None,
            false,
            IMPORTED_AT,
        )
        .expect("the older import commits");

        let remembered = command_load_region_sightings(&created.database_path, "faction-95", "95")
            .expect("the sightings load");

        assert_eq!(remembered.len(), 11);
        let shared = remembered
            .iter()
            .find(|entry| {
                entry
                    .region
                    .get("regionId")
                    .and_then(serde_json::Value::as_str)
                    == Some("1:10,50")
            })
            .expect("the shared hex is remembered");
        assert_eq!(shared.last_seen_turn, 71);
    }

    /// Re-importing the same turn moves `updatedAt` but leaves `importedAt` where it was: when a
    /// turn first arrived does not change because it arrived again.
    #[test]
    fn re_importing_a_turn_keeps_when_it_first_arrived() {
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
        .expect("the first import commits");
        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "95",
            TURN_71,
            None,
            true,
            "2026-08-10T10:00:00Z",
        )
        .expect("the re-import commits");

        let stamps = load_imported_turn_stamps(
            std::path::Path::new(&created.database_path),
            &ImportedTurnKey {
                game_id: "faction-95".to_string(),
                faction_id: "95".to_string(),
                turn_number: 71,
            },
        )
        .expect("load should succeed")
        .expect("the turn was imported");

        assert_eq!(stamps.imported_at, IMPORTED_AT);
        assert_eq!(stamps.updated_at, "2026-08-10T10:00:00Z");
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
    use super::test_support::{a_manifest, IMPORTED_AT};
    use super::*;
    use tempfile::tempdir;

    const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
    const ALLY_TURN_71: &str = atlantis_hud_fixtures::G8_F73_T71.text;
    const TURN_2: &str = atlantis_hud_fixtures::G8_F73_T2.text;
    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;
    const MERGED_AT: &str = "2026-08-10T18:30:00Z";

    /// A game with faction 95's turn 71 already imported, which is the state a merge starts from.
    fn game_with_turn_71(directory: &std::path::Path) -> OpenedGameDto {
        let created = command_create_game(
            directory.to_str().expect("a path"),
            a_manifest("faction-95", "Borg TNG"),
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
            a_manifest("faction-95", "Borg TNG"),
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

        let latest = command_load_latest_imported_turn(&created.database_path, "faction-95", None)
            .expect("the lookup succeeds")
            .expect("a turn reopens");
        assert_eq!(latest.key.faction_id, "95");
        assert_eq!(latest.key.turn_number, 71);
    }

    /// The remembered faction reaches the query rather than stopping at the command boundary.
    ///
    /// Two factions hold turn 71; which one reopens is decided by the argument alone.
    #[test]
    fn the_remembered_faction_reaches_the_query() {
        let directory = tempdir().expect("a temporary directory");
        let created = game_with_turn_71(directory.path());

        command_commit_report_import(
            &created.database_path,
            "faction-95",
            "73",
            ALLY_TURN_71,
            None,
            true,
            IMPORTED_AT,
        )
        .expect("the ally's own turn commits");

        for remembered in ["95", "73"] {
            let latest = command_load_latest_imported_turn(
                &created.database_path,
                "faction-95",
                Some(remembered.to_string()),
            )
            .expect("the lookup succeeds")
            .expect("a turn reopens");
            assert_eq!(latest.key.faction_id, remembered);
            assert_eq!(latest.key.turn_number, 71);
        }
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
    use super::test_support::{a_manifest, IMPORTED_AT, OPENED_AT};
    use super::*;
    use atlantis_hud_core::backup::StudyGoal;
    use atlantis_hud_core::report::model::ReportUnit;
    use tempfile::tempdir;

    #[test]
    fn tauri_adapter_returns_core_contract_values() {
        let response = command_get_engine_info();

        assert_eq!(
            response,
            EngineInfo {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }

    /// The command hands back the core's own wire wrapper, camelCase throughout with the
    /// threshold flag flattened alongside it (ah-164.1).
    #[test]
    fn parse_report_command_returns_the_core_wire_shape() {
        let value = serde_json::to_value(command_parse_report("garbage\n"))
            .expect("parse result should serialize");

        assert!(value.get("turnHeader").is_some());
        assert_eq!(value["warnings"][0]["severity"], "warning");
        assert_eq!(value["meetsMinimumImportThreshold"], false);
    }

    #[test]
    fn tauri_adapter_creates_and_reopens_a_game() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("a path");
        let mut manifest = a_manifest("faction-12", "Faction 12");
        manifest.report_sources = vec![ReportSourceRef {
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
            a_manifest("faction-12", "Faction 12"),
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
            a_manifest("faction-12", "Faction 12"),
        )
        .expect("create game");

        let validation = command_validate_orders("FLY 1 2", None, None, Some(Vec::new()));
        assert_eq!(
            validation.diagnostics,
            vec![atlantis_hud_core::OrderDiagnostic {
                code: "unknown-command".to_string(),
                message: "unknown order command: FLY".to_string(),
                line_start: Some(1),
                line_end: Some(1),
                column_start: Some(0),
                column_end: Some(3),
                // A misspelled keyword belongs to no hex and to no unit.
                region_id: None,
                unit_id: None,
                formed: None,
                severity: atlantis_hud_core::OrderDiagnosticSeverity::Error,
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

    /// `disabled_codes: None` and the explicit conservative default must agree, or a caller that
    /// omits the argument would silently see different checks than one that spells the default
    /// out. `"unit 5\nWORK\n"` is the orders text `hex-unguarded` fires on when it is enabled
    /// (`crates/core/src/orders/semantics.rs`'s `the_broad_guard_check_reports_an_unguarded_hex_when_it_is_asked_to`).
    #[test]
    fn absent_disabled_codes_use_the_conservative_default() {
        let orders = "unit 5\nWORK\n";
        let default_disabled: Vec<String> = atlantis_hud_core::OrderCheckOptions::default()
            .disabled
            .into_iter()
            .collect();

        assert_eq!(
            command_validate_orders(orders, None, None, None),
            command_validate_orders(orders, None, None, Some(default_disabled))
        );
    }

    #[test]
    fn tauri_adapter_saves_lists_and_deletes_hex_notes() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            a_manifest("faction-12", "Faction 12"),
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
    fn army_commands_round_trip() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            a_manifest("faction-12", "Faction 12"),
        )
        .expect("create game");

        let army = ArmyDto {
            id: "army-1".to_string(),
            game_id: "faction-12".to_string(),
            name: "Northern escort".to_string(),
            members: vec![ArmyMember {
                unit_id: "204".to_string(),
                name: "Pikes".to_string(),
                faction_id: None,
                faction_name: None,
                own: false,
                region_id: "1:7,53".to_string(),
                flags: vec!["behind".to_string()],
                items: vec![],
                skills: vec![],
                combat_spell: None,
                men: 12,
                seen_turn: 68,
                seen_at: "2026-08-07T12:00:00Z".to_string(),
            }],
            created_at: "2026-08-07T12:00:00Z".to_string(),
            updated_at: "2026-08-07T12:00:00Z".to_string(),
        };
        let saved = command_save_army(&created.database_path, army.clone()).expect("save army");
        assert_eq!(saved, army);

        let listed =
            command_list_armies(&created.database_path, "faction-12").expect("list armies");
        assert_eq!(listed, vec![army]);

        assert!(
            command_delete_army(&created.database_path, "faction-12", "army-1")
                .expect("delete army"),
            "deleting an existing Army reports true"
        );
        assert!(
            !command_delete_army(&created.database_path, "faction-12", "army-1")
                .expect("delete army"),
            "deleting an already-deleted Army reports false"
        );
    }

    #[test]
    fn allied_mage_commands_round_trip() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            a_manifest("faction-12", "Faction 12"),
        )
        .expect("create game");

        let mage = AlliedMage {
            faction_id: "21".to_string(),
            faction_name: Some("Borg".to_string()),
            unit: ReportUnit {
                unit_id: "9001".to_string(),
                name: "Sweep Mage".to_string(),
                region_id: "1:7,53".to_string(),
                faction_id: Some("21".to_string()),
                faction_name: Some("Borg".to_string()),
                own: false,
                on_guard: false,
                flags: vec![],
                items: vec![],
                skills: vec![],
                combat_spell: None,
                men: 1,
                men_estimated: true,
                men_by_race: vec![],
                weight: None,
                capacity: None,
                movement: None,
                structure_id: None,
            },
            sheet_turn: 23,
            received_at: "2026-08-07T12:00:00Z".to_string(),
        };

        command_save_allied_mages(
            &created.database_path,
            "faction-12",
            vec![mage.clone()],
            vec![],
        )
        .expect("save mages");
        assert_eq!(
            command_list_allied_mages(&created.database_path, "faction-12").expect("list mages"),
            vec![mage]
        );

        command_save_allied_mages(
            &created.database_path,
            "faction-12",
            vec![],
            vec![AlliedMageKey {
                faction_id: "21".to_string(),
                unit_id: "9001".to_string(),
            }],
        )
        .expect("remove mage");
        assert!(
            command_list_allied_mages(&created.database_path, "faction-12")
                .expect("list mages")
                .is_empty(),
            "a mage named in `removed` is gone"
        );
    }

    #[test]
    fn study_plan_commands_round_trip() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            a_manifest("faction-12", "Faction 12"),
        )
        .expect("create game");

        let plan = StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9001".to_string(),
            goals: vec![
                StudyGoal::Study {
                    skill: "FORC".to_string(),
                    target_level: Some(4),
                },
                StudyGoal::Study {
                    skill: "PATT".to_string(),
                    target_level: None,
                },
            ],
            comment: "heading for Gate Lore".to_string(),
            updated_at: "2026-08-07T12:00:00Z".to_string(),
        };

        command_save_study_plans(
            &created.database_path,
            "faction-12",
            vec![plan.clone()],
            vec![],
        )
        .expect("save plans");
        assert_eq!(
            command_list_study_plans(&created.database_path, "faction-12").expect("list plans"),
            vec![plan]
        );

        command_save_study_plans(
            &created.database_path,
            "faction-12",
            vec![],
            vec![StudyPlanKey {
                faction_id: "21".to_string(),
                unit_id: "9001".to_string(),
            }],
        )
        .expect("remove plan");
        assert!(
            command_list_study_plans(&created.database_path, "faction-12")
                .expect("list plans")
                .is_empty(),
            "a plan named in `removed` is gone"
        );
    }

    #[test]
    fn committing_an_import_records_when_each_region_was_seen() {
        use atlantis_hud_core_persistence::load_region_sightings;

        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            a_manifest("faction-12", "Faction 12"),
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
            a_manifest("faction-12", "Faction 12"),
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
        assert_eq!(loaded.parse_result.result.regions[0].region_id, "1:12,34");
        assert_eq!(loaded.parse_result.result.units[0].region_id, "1:12,34");
    }

    #[test]
    fn command_list_imported_turns_reports_every_committed_turn() {
        let dir = tempdir().expect("tempdir");
        let created = command_create_game(
            dir.path().to_str().expect("a path"),
            a_manifest("faction-12", "Faction 12"),
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

        let mut listed = command_list_imported_turns(&created.database_path, "faction-12")
            .expect("listing should succeed");
        listed.sort_by_key(|summary| summary.key.turn_number);

        let turn_numbers: Vec<u32> = listed
            .iter()
            .map(|summary| summary.key.turn_number)
            .collect();
        assert_eq!(turn_numbers, vec![2, 3]);
        assert_eq!(listed[0].season.as_deref(), Some("March"));
        assert_eq!(listed[1].season.as_deref(), Some("April"));
    }
}
