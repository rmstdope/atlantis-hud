use atlantis_hud_core_tauri::{command_get_game_info, GameInfoDto};

#[tauri::command]
fn get_game_info() -> GameInfoDto {
    command_get_game_info()
}

fn main() {
    let _builder =
        tauri::Builder::default().invoke_handler(tauri::generate_handler![get_game_info]);
    println!("atlantis-hud desktop shell command adapter registered");
}
