//! Tauri command adapter for Atlantis HUD core APIs.

use std::path::Path;

use atlantis_hud_core::{game_info, parse_report, ReportParseResult, WarningSeverity};
use atlantis_hud_core_persistence::{
    create_project, insert_imported_turn, open_project, preview_imported_turn,
    upsert_imported_turn, ImportedTurnKey, ImportedTurnPreview, ImportedTurnRecord, OpenedProject,
    PersistenceError, ProjectManifest, ProjectMetadata, ReportSourceRef,
};
use serde::{Deserialize, Serialize};

/// JSON contract returned by Tauri for game metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfoDto {
    pub id: String,
    pub name: String,
    pub ruleset_version: String,
    pub max_faction_count: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadataDto {
    pub project_id: String,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSourceRefDto {
    pub source_id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifestDto {
    pub manifest_version: u32,
    pub metadata: ProjectMetadataDto,
    pub report_sources: Vec<ReportSourceRefDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectDto {
    pub project_file_path: String,
    pub database_path: String,
    pub schema_version: u32,
    pub manifest: ProjectManifestDto,
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

impl From<atlantis_hud_core::GameInfo> for GameInfoDto {
    fn from(value: atlantis_hud_core::GameInfo) -> Self {
        Self {
            id: value.id,
            name: value.name,
            ruleset_version: value.ruleset_version,
            max_faction_count: value.max_faction_count,
        }
    }
}

impl From<ProjectMetadataDto> for ProjectMetadata {
    fn from(value: ProjectMetadataDto) -> Self {
        Self {
            project_id: value.project_id,
            project_name: value.project_name,
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

impl From<ProjectManifestDto> for ProjectManifest {
    fn from(value: ProjectManifestDto) -> Self {
        Self {
            manifest_version: value.manifest_version,
            metadata: value.metadata.into(),
            report_sources: value.report_sources.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ProjectMetadata> for ProjectMetadataDto {
    fn from(value: ProjectMetadata) -> Self {
        Self {
            project_id: value.project_id,
            project_name: value.project_name,
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

impl From<ProjectManifest> for ProjectManifestDto {
    fn from(value: ProjectManifest) -> Self {
        Self {
            manifest_version: value.manifest_version,
            metadata: value.metadata.into(),
            report_sources: value.report_sources.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<OpenedProject> for OpenedProjectDto {
    fn from(value: OpenedProject) -> Self {
        Self {
            project_file_path: value.project_file_path.to_string_lossy().to_string(),
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

/// Returns canonical game metadata for a Tauri command wrapper.
#[must_use]
pub fn command_get_game_info() -> GameInfoDto {
    GameInfoDto::from(game_info())
}

/// Creates a project manifest + sidecar SQLite database and applies migrations.
pub fn command_create_project(
    project_file_path: &str,
    manifest: ProjectManifestDto,
) -> Result<OpenedProjectDto, String> {
    create_project(
        Path::new(project_file_path),
        &ProjectManifest::from(manifest),
    )
    .map(OpenedProjectDto::from)
    .map_err(|error| error.to_string())
}

/// Opens an existing project and applies pending migrations.
pub fn command_open_project(project_file_path: &str) -> Result<OpenedProjectDto, String> {
    open_project(Path::new(project_file_path))
        .map(OpenedProjectDto::from)
        .map_err(|error| error.to_string())
}

/// Parses one report and returns tolerant parser output.
#[must_use]
pub fn command_parse_report(raw_report: &str) -> ReportParseResultDto {
    ReportParseResultDto::from(parse_report(raw_report))
}

/// Parses one report and previews duplicate conflict for a confirmed faction.
pub fn command_preview_report_import(
    database_path: &str,
    project_id: &str,
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
                project_id: project_id.to_string(),
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
    project_id: &str,
    confirmed_faction_id: &str,
    raw_report: &str,
    allow_overwrite: bool,
) -> Result<ImportedTurnPreviewDto, String> {
    let parse_result = parse_report(raw_report);
    if !parse_result.meets_minimum_import_threshold() {
        return Err("parsed report did not meet minimum import threshold".to_string());
    }

    let faction_is_detected = parse_result
        .detected_factions
        .iter()
        .any(|faction| faction.faction_id == confirmed_faction_id);
    if !faction_is_detected {
        return Err("confirmed faction does not exist in parsed report candidates".to_string());
    }

    let turn_number = parse_result
        .turn_header
        .as_ref()
        .map(|header| header.turn_number)
        .ok_or_else(|| "turn header missing from parsed report".to_string())?;

    let record = ImportedTurnRecord {
        key: ImportedTurnKey {
            project_id: project_id.to_string(),
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

    Ok(ImportedTurnPreviewDto::from(preview))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn tauri_adapter_returns_core_contract_values() {
        let response = command_get_game_info();

        assert_eq!(
            response,
            GameInfoDto {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }

    #[test]
    fn tauri_adapter_creates_and_reopens_project() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let project_path_string = project_path.to_string_lossy().to_string();
        let manifest = ProjectManifestDto {
            manifest_version: 1,
            metadata: ProjectMetadataDto {
                project_id: "faction-12".to_string(),
                project_name: "Faction 12".to_string(),
            },
            report_sources: vec![ReportSourceRefDto {
                source_id: "report-12".to_string(),
                label: "Turn 12 report".to_string(),
            }],
        };

        let created = command_create_project(&project_path_string, manifest.clone())
            .expect("project creation should succeed");
        let reopened =
            command_open_project(&project_path_string).expect("project reopen should succeed");

        assert_eq!(created.manifest, manifest);
        assert_eq!(reopened.manifest, manifest);
        assert_eq!(created.schema_version, 2);
        assert_eq!(reopened.schema_version, 2);
    }

    #[test]
    fn tauri_adapter_previews_and_commits_imports() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let project_path_string = project_path.to_string_lossy().to_string();
        let created = command_create_project(
            &project_path_string,
            ProjectManifestDto {
                manifest_version: 1,
                metadata: ProjectMetadataDto {
                    project_id: "faction-12".to_string(),
                    project_name: "Faction 12".to_string(),
                },
                report_sources: Vec::new(),
            },
        )
        .expect("create project");
        let report = "\
TURN: 12 Spring
FACTION: 17 | Crimson Tide
REGION: R1 | Coast of Dawn
UNIT: U100 | Guard Patrol | R1
MESSAGE: order | U100 | MOVE R2";

        let preview =
            command_preview_report_import(&created.database_path, "faction-12", "17", report)
                .expect("preview import");
        assert_eq!(preview.turn_number, Some(12));
        assert!(!preview.duplicate_preview.exists);
        assert!(preview.parse_result.meets_minimum_import_threshold);

        command_commit_report_import(&created.database_path, "faction-12", "17", report, false)
            .expect("first import should commit");
        let duplicate_error =
            command_commit_report_import(&created.database_path, "faction-12", "17", report, false)
                .expect_err("duplicate without overwrite should fail");
        assert!(duplicate_error.contains("requires explicit overwrite confirmation"));
    }
}
