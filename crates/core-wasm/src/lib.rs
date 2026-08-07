//! WASM adapter surface for Atlantis HUD core APIs.

#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use atlantis_hud_core::{game_info, parse_report, ReportParseResult};
#[cfg(not(target_arch = "wasm32"))]
use atlantis_hud_core_persistence::{
    create_project, insert_imported_turn, open_project, preview_imported_turn,
    upsert_imported_turn, ImportedTurnKey, ImportedTurnPreview, ImportedTurnRecord, OpenedProject,
    PersistenceError, ProjectManifest, ProjectMetadata, ReportSourceRef,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameInfoDto {
    id: String,
    name: String,
    ruleset_version: String,
    max_faction_count: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct ProjectMetadataDto {
    project_id: String,
    project_name: String,
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
struct ProjectManifestDto {
    manifest_version: u32,
    metadata: ProjectMetadataDto,
    report_sources: Vec<ReportSourceRefDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
struct OpenedProjectDto {
    project_file_path: String,
    database_path: String,
    schema_version: u32,
    manifest: ProjectManifestDto,
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

#[cfg(not(target_arch = "wasm32"))]
impl From<ProjectMetadataDto> for ProjectMetadata {
    fn from(value: ProjectMetadataDto) -> Self {
        Self {
            project_id: value.project_id,
            project_name: value.project_name,
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
impl From<ProjectManifestDto> for ProjectManifest {
    fn from(value: ProjectManifestDto) -> Self {
        Self {
            manifest_version: value.manifest_version,
            metadata: value.metadata.into(),
            report_sources: value.report_sources.into_iter().map(Into::into).collect(),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<ProjectMetadata> for ProjectMetadataDto {
    fn from(value: ProjectMetadata) -> Self {
        Self {
            project_id: value.project_id,
            project_name: value.project_name,
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
impl From<ProjectManifest> for ProjectManifestDto {
    fn from(value: ProjectManifest) -> Self {
        Self {
            manifest_version: value.manifest_version,
            metadata: value.metadata.into(),
            report_sources: value.report_sources.into_iter().map(Into::into).collect(),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
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

/// Returns game metadata serialized as a JS object.
#[wasm_bindgen]
pub fn get_game_info() -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&GameInfoDto::from(game_info()))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Parses one report and returns tolerant parser output including the viability threshold flag.
#[wasm_bindgen]
pub fn parse_report_state(raw_report: String) -> Result<JsValue, JsValue> {
    let parsed = ReportParseResultDto::from(parse_report(&raw_report));
    serde_wasm_bindgen::to_value(&parsed).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Creates a project manifest and sidecar SQLite database.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn create_project_state(
    project_file_path: String,
    manifest: JsValue,
) -> Result<JsValue, JsValue> {
    let manifest_dto = serde_wasm_bindgen::from_value::<ProjectManifestDto>(manifest)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let opened = create_project(
        Path::new(&project_file_path),
        &ProjectManifest::from(manifest_dto),
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    serde_wasm_bindgen::to_value(&OpenedProjectDto::from(opened))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Opens an existing project and applies pending schema migrations.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn open_project_state(project_file_path: String) -> Result<JsValue, JsValue> {
    let opened = open_project(Path::new(&project_file_path))
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    serde_wasm_bindgen::to_value(&OpenedProjectDto::from(opened))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Previews duplicate conflict for a report import candidate.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn preview_report_import_state(
    database_path: String,
    project_id: String,
    confirmed_faction_id: String,
    raw_report: String,
) -> Result<JsValue, JsValue> {
    let parsed = parse_report(&raw_report);
    let turn_number = parsed.turn_header.as_ref().map(|header| header.turn_number);

    let duplicate_preview = if let Some(current_turn) = turn_number {
        let candidate = ImportedTurnRecord {
            key: ImportedTurnKey {
                project_id,
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
    serde_wasm_bindgen::to_value(&result).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Commits a report import candidate to persistence.
#[wasm_bindgen]
#[cfg(not(target_arch = "wasm32"))]
pub fn commit_report_import_state(
    database_path: String,
    project_id: String,
    confirmed_faction_id: String,
    raw_report: String,
    allow_overwrite: bool,
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
            project_id,
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
        upsert_imported_turn(Path::new(&database_path), &candidate)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    } else {
        insert_imported_turn(Path::new(&database_path), &candidate).map_err(
            |error| match error {
                PersistenceError::DuplicateImportedTurn { .. } => JsValue::from_str(
                    "duplicate import exists and requires explicit overwrite confirmation",
                ),
                _ => JsValue::from_str(&error.to_string()),
            },
        )?;
    }

    serde_wasm_bindgen::to_value(&ImportedTurnPreviewDto::from(preview))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Creates a project manifest and sidecar SQLite database.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn create_project_state(
    _project_file_path: String,
    _manifest: JsValue,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "project persistence is not linked in this wasm32 build",
    ))
}

/// Opens an existing project and applies pending schema migrations.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn open_project_state(_project_file_path: String) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "project persistence is not linked in this wasm32 build",
    ))
}

/// Previews duplicate conflict for a report import candidate.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn preview_report_import_state(
    _database_path: String,
    _project_id: String,
    _confirmed_faction_id: String,
    _raw_report: String,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "project persistence is not linked in this wasm32 build",
    ))
}

/// Commits a report import candidate to persistence.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub fn commit_report_import_state(
    _database_path: String,
    _project_id: String,
    _confirmed_faction_id: String,
    _raw_report: String,
    _allow_overwrite: bool,
) -> Result<JsValue, JsValue> {
    Err(JsValue::from_str(
        "project persistence is not linked in this wasm32 build",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(target_arch = "wasm32"))]
    use tempfile::tempdir;

    #[test]
    fn dto_maps_core_fields() {
        let dto = GameInfoDto::from(game_info());
        assert_eq!(dto.id, "atlantis");
        assert_eq!(dto.name, "Atlantis PBEM");
        assert_eq!(dto.ruleset_version, "4.0");
        assert_eq!(dto.max_faction_count, 128);
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn persistence_dto_maps_bidirectionally() {
        let dto = ProjectManifestDto {
            manifest_version: 1,
            metadata: ProjectMetadataDto {
                project_id: "faction-7".to_string(),
                project_name: "Faction 7".to_string(),
            },
            report_sources: vec![ReportSourceRefDto {
                source_id: "report-7".to_string(),
                label: "Turn 7 report".to_string(),
            }],
        };

        let manifest = ProjectManifest::from(dto.clone());
        assert_eq!(ProjectManifestDto::from(manifest), dto);
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn create_project_state_can_be_reopened() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("web.atlantis-project.json");
        let manifest = ProjectManifest {
            manifest_version: 1,
            metadata: ProjectMetadata {
                project_id: "faction-web".to_string(),
                project_name: "Faction Web".to_string(),
            },
            report_sources: vec![ReportSourceRef {
                source_id: "report-web".to_string(),
                label: "Web report".to_string(),
            }],
        };

        let created = create_project(&project_path, &manifest).expect("project should be created");
        let reopened = open_project(&project_path).expect("project should reopen");
        assert_eq!(created.schema_version, reopened.schema_version);
        assert_eq!(reopened.manifest, manifest);
    }
}
