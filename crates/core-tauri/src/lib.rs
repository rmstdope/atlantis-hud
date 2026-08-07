//! Tauri command adapter for Atlantis HUD core APIs.

use std::path::Path;

use atlantis_hud_core::game_info;
use atlantis_hud_core_persistence::{
    create_project, open_project, OpenedProject, ProjectManifest, ProjectMetadata, ReportSourceRef,
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
        assert_eq!(created.schema_version, 1);
        assert_eq!(reopened.schema_version, 1);
    }
}
