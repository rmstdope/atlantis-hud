#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
use atlantis_hud_core_tauri::{
    command_create_game, command_delete_game, command_export_game, command_import_game,
    command_list_games, command_open_game, command_reset_game, command_set_active_faction,
    command_set_game_name, command_set_game_ruleset, GameManifestDto, OpenedGameDto,
};

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
fn reset_game(
    app: tauri::AppHandle,
    game_id: String,
    now: String,
) -> Result<OpenedGameDto, String> {
    command_reset_game(&games_root(&app)?, &game_id, &now)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn export_game(
    app: tauri::AppHandle,
    game_id: String,
    exported_at: String,
) -> Result<String, String> {
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
fn set_game_name(
    app: tauri::AppHandle,
    game_id: String,
    game_name: String,
) -> Result<GameManifestDto, String> {
    command_set_game_name(&games_root(&app)?, &game_id, &game_name)
}

#[cfg(all(
    any(target_os = "linux", target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
))]
#[tauri::command(rename_all = "snake_case")]
fn set_active_faction(
    app: tauri::AppHandle,
    game_id: String,
    faction_id: String,
) -> Result<GameManifestDto, String> {
    command_set_active_faction(&games_root(&app)?, &game_id, &faction_id)
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
        // Where a map export goes. The web build can only hand the file to the browser and hope
        // the player finds it; the desktop can ask them where to put it and then say exactly where
        // it went, which is what a file meant to be sent on to somebody else needs.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            atlantis_hud_core_tauri::command_get_engine_info,
            create_game,
            open_game,
            list_games,
            delete_game,
            reset_game,
            export_game,
            import_game,
            set_game_ruleset,
            set_game_name,
            set_active_faction,
            atlantis_hud_core_tauri::command_parse_report,
            atlantis_hud_core_tauri::command_parse_report_full,
            atlantis_hud_core_tauri::command_preview_report_import,
            atlantis_hud_core_tauri::command_commit_report_import,
            atlantis_hud_core_tauri::command_load_imported_turn,
            atlantis_hud_core_tauri::command_load_latest_imported_turn,
            atlantis_hud_core_tauri::command_list_imported_turns,
            atlantis_hud_core_tauri::command_validate_orders,
            atlantis_hud_core_tauri::command_order_commands,
            atlantis_hud_core_tauri::command_order_argument_completions,
            atlantis_hud_core_tauri::command_completions_at_caret,
            atlantis_hud_core_tauri::command_save_order_draft,
            atlantis_hud_core_tauri::command_load_order_draft,
            atlantis_hud_core_tauri::command_list_hex_notes,
            atlantis_hud_core_tauri::command_save_hex_note,
            atlantis_hud_core_tauri::command_delete_hex_note,
            atlantis_hud_core_tauri::command_plan_route,
            atlantis_hud_core_tauri::command_export_map,
            atlantis_hud_core_tauri::command_known_map,
            atlantis_hud_core_tauri::command_trace_move_orders,
            atlantis_hud_core_tauri::command_preview_orders,
            atlantis_hud_core_tauri::command_load_region_sightings,
            atlantis_hud_core_tauri::command_merge_report,
            atlantis_hud_core_tauri::command_load_merged_reports,
            atlantis_hud_core_tauri::command_parse_report_classified,
            atlantis_hud_core_tauri::command_trade_routes
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
