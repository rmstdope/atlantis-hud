#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
use atlantis_hud_core_tauri::{
    command_commit_report_import, command_create_project, command_load_imported_turn,
    command_open_project, command_parse_report, command_preview_report_import,
    ImportedTurnPreviewDto, ImportedTurnRecordDto, OpenedProjectDto, ProjectManifestDto,
    ReportImportPreviewDto, ReportParseResultDto,
};
#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
use atlantis_hud_core_tauri::{command_get_game_info, GameInfoDto};

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn get_game_info() -> GameInfoDto {
    command_get_game_info()
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn create_project(
    project_file_path: String,
    manifest: ProjectManifestDto,
) -> Result<OpenedProjectDto, String> {
    command_create_project(&project_file_path, manifest)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn open_project(project_file_path: String) -> Result<OpenedProjectDto, String> {
    command_open_project(&project_file_path)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn parse_report(raw_report: String) -> ReportParseResultDto {
    command_parse_report(&raw_report)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn preview_report_import(
    database_path: String,
    project_id: String,
    confirmed_faction_id: String,
    raw_report: String,
) -> Result<ReportImportPreviewDto, String> {
    command_preview_report_import(
        &database_path,
        &project_id,
        &confirmed_faction_id,
        &raw_report,
    )
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn commit_report_import(
    database_path: String,
    project_id: String,
    confirmed_faction_id: String,
    raw_report: String,
    allow_overwrite: bool,
) -> Result<ImportedTurnPreviewDto, String> {
    command_commit_report_import(
        &database_path,
        &project_id,
        &confirmed_faction_id,
        &raw_report,
        allow_overwrite,
    )
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command]
fn load_imported_turn(
    database_path: String,
    project_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<Option<ImportedTurnRecordDto>, String> {
    command_load_imported_turn(&database_path, &project_id, &faction_id, turn_number)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_game_info,
            create_project,
            open_project,
            parse_report,
            preview_report_import,
            commit_report_import,
            load_imported_turn
        ])
        .run(tauri::generate_context!())
        .expect("error while running atlantis-hud desktop shell");
}

#[cfg(not(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
)))]
fn main() {
    println!("atlantis-hud desktop shell is supported on macOS and Windows");
}
