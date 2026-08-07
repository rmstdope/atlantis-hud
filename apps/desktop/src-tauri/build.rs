fn main() {
    // Only run tauri_build when Tauri CLI is driving the build.
    // Plain `cargo check/build` (e.g., in CI typecheck) does not set TAURI_CONFIG
    // and tauri-build would panic with "missing cargo:dev instruction".
    if std::env::var("TAURI_CONFIG").is_ok() || std::env::var("TAURI_INVOKE_KEY").is_ok() {
        tauri_build::build()
    }
}
