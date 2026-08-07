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
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_game_info])
        .run(tauri::generate_context!(
            "tauri.conf.json",
            crate,
            test = true
        ))
        .expect("error while running atlantis-hud desktop shell");
}

#[cfg(not(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "desktop-runtime"
)))]
fn main() {
    println!("atlantis-hud desktop shell is supported on macOS and Windows");
}
