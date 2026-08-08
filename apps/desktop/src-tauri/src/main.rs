#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
use atlantis_hud_core_tauri::{
    command_commit_report_import, command_create_project, command_load_imported_turn,
    command_load_order_draft, command_open_project, command_parse_report,
    command_parse_report_full, command_preview_report_import, command_save_order_draft,
    command_validate_orders, ImportedTurnPreviewDto, ImportedTurnRecordDto, OpenedProjectDto,
    OrderDraftRecordDto, OrderValidationResultDto, ParsedReport, ProjectManifestDto,
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
#[tauri::command(rename_all = "snake_case")]
fn get_game_info() -> GameInfoDto {
    command_get_game_info()
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command(rename_all = "snake_case")]
fn open_project(project_file_path: String) -> Result<OpenedProjectDto, String> {
    command_open_project(&project_file_path)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn parse_report(raw_report: String) -> ReportParseResultDto {
    command_parse_report(&raw_report)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn parse_report_classified(raw_report: String, ruleset_json: String) -> ParsedReport {
    atlantis_hud_core_tauri::command_parse_report_classified(&raw_report, &ruleset_json)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_region_sightings(
    database_path: String,
    project_id: String,
    faction_id: String,
) -> Result<Vec<atlantis_hud_core_tauri::RememberedRegionDto>, String> {
    atlantis_hud_core_tauri::command_load_region_sightings(&database_path, &project_id, &faction_id)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn plan_route(
    ruleset_json: String,
    raw_report: String,
    remembered_json: String,
    unit_id: String,
    destination: String,
) -> Result<atlantis_hud_core::movement::request::RoutePlanResponse, String> {
    atlantis_hud_core_tauri::command_plan_route(
        &ruleset_json,
        &raw_report,
        &remembered_json,
        &unit_id,
        &destination,
    )
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn parse_report_full(raw_report: String) -> ParsedReport {
    command_parse_report_full(&raw_report)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command(rename_all = "snake_case")]
fn validate_orders(raw_orders: String) -> OrderValidationResultDto {
    command_validate_orders(&raw_orders)
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn save_order_draft(
    database_path: String,
    project_id: String,
    faction_id: String,
    turn_number: u32,
    order_text: String,
    updated_at: String,
) -> Result<OrderDraftRecordDto, String> {
    command_save_order_draft(
        &database_path,
        &project_id,
        &faction_id,
        turn_number,
        &order_text,
        &updated_at,
    )
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_order_draft(
    database_path: String,
    project_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<Option<OrderDraftRecordDto>, String> {
    command_load_order_draft(&database_path, &project_id, &faction_id, turn_number)
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
            parse_report_full,
            preview_report_import,
            commit_report_import,
            load_imported_turn,
            validate_orders,
            save_order_draft,
            load_order_draft,
            plan_route,
            load_region_sightings,
            parse_report_classified
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
