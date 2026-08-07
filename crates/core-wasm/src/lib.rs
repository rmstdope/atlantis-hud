//! WASM adapter surface for Atlantis HUD core APIs.

#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use atlantis_hud_core::game_info;
#[cfg(not(target_arch = "wasm32"))]
use atlantis_hud_core_persistence::{
    create_project, open_project, OpenedProject, ProjectManifest, ProjectMetadata, ReportSourceRef,
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
