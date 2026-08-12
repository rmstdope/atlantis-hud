fn main() {
    // Whether this build is the desktop application, asked of the feature that decides it rather
    // than of the environment the Tauri CLI happens to export.
    //
    // The environment was the wrong question, and quietly so. `tauri dev` and `tauri build` set
    // neither `TAURI_CONFIG` (only `--config` does) nor `TAURI_INVOKE_KEY` for the build script, so
    // the old guard skipped `tauri_build::build()` for ordinary builds - and cargo, which does not
    // track a build script's environment, cached that skip for later ones. The application then
    // compiled with no ACL generated at all: every plugin permission missing, and any call into a
    // plugin refused at runtime with "not allowed. Plugin not found", which reads exactly like a
    // mistake in the capability file. The map export's save dialog found it; the update check's
    // opener call had the same hole and nobody had cause to notice.
    //
    // `CARGO_FEATURE_*` is set by cargo itself, is part of the fingerprint, and says precisely what
    // the guard meant: a plain `cargo check --workspace` builds this crate without the feature and
    // must not drag the Tauri codegen in, because it would panic without the CLI around it.
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_DESKTOP_RUNTIME");

    if std::env::var("CARGO_FEATURE_DESKTOP_RUNTIME").is_ok() {
        tauri_build::build()
    }
}
