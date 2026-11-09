//! The assistant's way in: an MCP server on a loopback port, whose tools the frontend answers.
//!
//! The relay itself is `atlantis-hud-assistant-mcp`; this is the Tauri end of it. Each call a client
//! makes is emitted to the window as `assistant://call`, and the frontend sends its answer back
//! with the `assistant_answer` command. The tools are whatever the frontend registered with
//! `assistant_register_tools` when it started.
//!
//! The token is created once and kept in the application data directory, so the command that
//! connects Claude Code (`assistant_connection`) stays the same from one launch to the next.

use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use atlantis_hud_assistant_mcp::{CancellationToken, Relay, ToolAnswer};
use serde::Serialize;
use tauri::{Emitter, Manager};

/// The port Claude Code is told to connect to. Overridden by `ATLANTIS_HUD_MCP_PORT`.
const DEFAULT_PORT: u16 = 47615;
/// How long a call waits for the frontend before it fails. Validation of a large turn can take a
/// few seconds; anything much longer is a window that is not there.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const TOKEN_FILE: &str = "assistant-token";

/// What the settings dialog shows: where the server is, and how to reach it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantConnection {
    pub url: String,
    pub token: String,
    /// Why the server is not listening, or `None` when it is.
    pub error: Option<String>,
}

pub struct AssistantState {
    relay: Arc<Relay>,
    connection: Mutex<AssistantConnection>,
    _stop: CancellationToken,
}

fn port() -> u16 {
    std::env::var("ATLANTIS_HUD_MCP_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// The token kept in `dir`, created on first use.
fn token_in(dir: &Path) -> Result<String, String> {
    let path = dir.join(TOKEN_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            keep_private(&path).map_err(|error| error.to_string())?;
            return Ok(existing.to_string());
        }
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    // Emptied and made private before the token goes in, so it is never readable by anyone else.
    let mut file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    keep_private(&path).map_err(|error| error.to_string())?;
    file.write_all(token.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(token)
}

/// The token is what stops another account on this machine writing the player's orders.
#[cfg(unix)]
fn keep_private(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

/// Windows has no mode bits; the application data directory is already per-user there.
#[cfg(not(unix))]
fn keep_private(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Starts the server and puts its state where the commands below can reach it.
///
/// Never fails the launch: a port already taken (a second window, another program) leaves the HUD
/// working as before, and the settings dialog says why the assistant cannot connect.
pub fn start(app: &tauri::App) {
    let handle = app.handle().clone();
    let relay = Relay::new(CALL_TIMEOUT, move |call| {
        let _ = handle.emit("assistant://call", call);
    });
    let port = port();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let stop = CancellationToken::new();

    let token = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .and_then(|dir| token_in(&dir));
    let connection = match token {
        Ok(token) => AssistantConnection {
            url,
            token,
            error: None,
        },
        Err(error) => AssistantConnection {
            url,
            token: String::new(),
            error: Some(format!("no token could be kept: {error}")),
        },
    };

    app.manage(AssistantState {
        relay: relay.clone(),
        connection: Mutex::new(connection.clone()),
        _stop: stop.clone(),
    });

    if connection.error.is_some() {
        return;
    }
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let bound = tokio::net::TcpListener::bind(("127.0.0.1", port)).await;
        let outcome = match bound {
            Ok(listener) => {
                atlantis_hud_assistant_mcp::serve(relay, listener, connection.token, stop).await
            }
            Err(error) => Err(error),
        };
        if let Err(error) = outcome {
            let state = handle.state::<AssistantState>();
            let mut shown = state
                .connection
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            shown.error = Some(format!("port {port}: {error}"));
        }
    });
}

#[tauri::command(rename_all = "snake_case")]
pub fn assistant_register_tools(
    state: tauri::State<'_, AssistantState>,
    tools: serde_json::Value,
) -> Result<(), String> {
    state.relay.set_tools(&tools)
}

#[tauri::command(rename_all = "snake_case")]
pub fn assistant_answer(
    state: tauri::State<'_, AssistantState>,
    id: u64,
    answer: ToolAnswer,
) -> bool {
    state.relay.answer(id, answer)
}

#[tauri::command(rename_all = "snake_case")]
pub fn assistant_connection(state: tauri::State<'_, AssistantState>) -> AssistantConnection {
    state
        .connection
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_one_token_across_launches() {
        let dir = std::env::temp_dir().join(format!("assistant-token-{}", uuid::Uuid::new_v4()));

        let first = token_in(&dir).expect("a token");
        let second = token_in(&dir).expect("the same token");

        assert_eq!(first.len(), 32);
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .expect("the token file")
            .permissions()
            .mode()
            & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn a_new_token_is_readable_only_by_its_owner() {
        let dir = std::env::temp_dir().join(format!("assistant-token-{}", uuid::Uuid::new_v4()));

        token_in(&dir).expect("a token");

        assert_eq!(mode_of(&dir.join(TOKEN_FILE)), 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_token_an_earlier_build_left_readable_is_made_private_and_kept() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("assistant-token-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("the directory");
        let path = dir.join(TOKEN_FILE);
        std::fs::write(&path, "an-earlier-token").expect("the old token");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))
            .expect("the old mode");

        assert_eq!(token_in(&dir).expect("the token"), "an-earlier-token");

        assert_eq!(mode_of(&path), 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }
}
