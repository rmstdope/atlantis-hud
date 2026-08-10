#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
use atlantis_hud_core_tauri::{
    command_commit_report_import, command_create_game, command_delete_game, command_export_game,
    command_import_game, command_list_games, command_load_imported_turn, command_load_order_draft,
    command_open_game, command_parse_report, command_parse_report_full,
    command_set_game_ruleset, command_validate_orders, GameManifestDto, ImportedTurnPreviewDto,
    ImportedTurnRecordDto, OpenedGameDto, OrderDraftRecordDto, OrderValidationResultDto,
    ParsedReport, ReportImportPreviewDto, ReportParseResultDto,
};
#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
use atlantis_hud_core_tauri::{command_get_engine_info, EngineInfoDto};

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn get_engine_info() -> EngineInfoDto {
    command_get_engine_info()
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
/// Where this installation keeps its games.
///
/// Resolved here rather than in the frontend, and rooted in the platform's application data
/// directory rather than in the process working directory. A frontend that composes its own
/// relative path writes games wherever the app happened to be launched from, which is how a
/// database once ended up committed inside the repository.
fn games_root(app: &tauri::AppHandle) -> Result<String, String> {
    let root = tauri::Manager::path(app)
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("games");

    root.to_str()
        .map(str::to_string)
        .ok_or_else(|| format!("games directory is not valid unicode: {}", root.display()))
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn create_game(app: tauri::AppHandle, manifest: GameManifestDto) -> Result<OpenedGameDto, String> {
    command_create_game(&games_root(&app)?, manifest)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn open_game(
    app: tauri::AppHandle,
    game_id: String,
    opened_at: String,
) -> Result<OpenedGameDto, String> {
    command_open_game(&games_root(&app)?, &game_id, &opened_at)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn list_games(app: tauri::AppHandle) -> Result<Vec<GameManifestDto>, String> {
    command_list_games(&games_root(&app)?)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn delete_game(app: tauri::AppHandle, game_id: String) -> Result<(), String> {
    command_delete_game(&games_root(&app)?, &game_id)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn export_game(app: tauri::AppHandle, game_id: String, exported_at: String) -> Result<String, String> {
    command_export_game(&games_root(&app)?, &game_id, &exported_at)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn import_game(
    app: tauri::AppHandle,
    backup_json: String,
    opened_at: String,
) -> Result<OpenedGameDto, String> {
    command_import_game(&games_root(&app)?, &backup_json, &opened_at)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn set_game_ruleset(
    app: tauri::AppHandle,
    game_id: String,
    ruleset_id: String,
) -> Result<GameManifestDto, String> {
    command_set_game_ruleset(&games_root(&app)?, &game_id, &ruleset_id)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn parse_report(raw_report: String) -> ReportParseResultDto {
    command_parse_report(&raw_report)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn parse_report_classified(raw_report: String, ruleset_json: String) -> ParsedReport {
    atlantis_hud_core_tauri::command_parse_report_classified(&raw_report, &ruleset_json)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_region_sightings(
    database_path: String,
    game_id: String,
    faction_id: String,
) -> Result<Vec<atlantis_hud_core_tauri::RememberedRegionDto>, String> {
    atlantis_hud_core_tauri::command_load_region_sightings(&database_path, &game_id, &faction_id)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn merge_report(
    database_path: String,
    game_id: String,
    viewer_faction_id: String,
    viewer_turn_number: u32,
    raw_report: String,
    merged_at: String,
) -> Result<atlantis_hud_core_tauri::ReportMergeResultDto, String> {
    atlantis_hud_core_tauri::command_merge_report(
        &database_path,
        &game_id,
        &viewer_faction_id,
        viewer_turn_number,
        &raw_report,
        &merged_at,
    )
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_merged_reports(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<Vec<atlantis_hud_core_tauri::MergedReportRecordDto>, String> {
    atlantis_hud_core_tauri::command_load_merged_reports(
        &database_path,
        &game_id,
        &faction_id,
        turn_number,
    )
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
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
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn parse_report_full(raw_report: String) -> ParsedReport {
    command_parse_report_full(&raw_report)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn preview_report_import(
    database_path: String,
    game_id: String,
    confirmed_faction_id: String,
    raw_report: String,
) -> Result<ReportImportPreviewDto, String> {
    command_preview_report_import(&database_path, &game_id, &confirmed_faction_id, &raw_report)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn commit_report_import(
    database_path: String,
    game_id: String,
    confirmed_faction_id: String,
    raw_report: String,
    allow_overwrite: bool,
    imported_at: String,
) -> Result<ImportedTurnPreviewDto, String> {
    command_commit_report_import(
        &database_path,
        &game_id,
        &confirmed_faction_id,
        &raw_report,
        allow_overwrite,
        &imported_at,
    )
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_imported_turn(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<Option<ImportedTurnRecordDto>, String> {
    command_load_imported_turn(&database_path, &game_id, &faction_id, turn_number)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_latest_imported_turn(
    database_path: String,
    game_id: String,
) -> Result<Option<ImportedTurnRecordDto>, String> {
    atlantis_hud_core_tauri::command_load_latest_imported_turn(&database_path, &game_id)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn validate_orders(raw_orders: String) -> OrderValidationResultDto {
    command_validate_orders(&raw_orders)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn save_order_draft(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
    order_text: String,
    updated_at: String,
) -> Result<OrderDraftRecordDto, String> {
    command_save_order_draft(
        &database_path,
        &game_id,
        &faction_id,
        turn_number,
        &order_text,
        &updated_at,
    )
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn load_order_draft(
    database_path: String,
    game_id: String,
    faction_id: String,
    turn_number: u32,
) -> Result<Option<OrderDraftRecordDto>, String> {
    command_load_order_draft(&database_path, &game_id, &faction_id, turn_number)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
fn main() {
    tauri::Builder::default()
        // Opening the releases page in the player's own browser is the whole of the desktop update
        // check. It has to be their browser rather than a window of ours: this repository is
        // private, so the page needs a GitHub session, and the one they already have is in there.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            create_game,
            open_game,
            list_games,
            delete_game,
            export_game,
            import_game,
            set_game_ruleset,
            parse_report,
            parse_report_full,
            preview_report_import,
            commit_report_import,
            load_imported_turn,
            load_latest_imported_turn,
            validate_orders,
            save_order_draft,
            load_order_draft,
            plan_route,
            load_region_sightings,
            merge_report,
            load_merged_reports,
            parse_report_classified
        ])
        .run(tauri::generate_context!())
        .expect("error while running atlantis-hud desktop shell");
}

#[cfg(not(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
)))]
fn main() {
    println!("atlantis-hud desktop shell is supported on macOS and Windows");
}
