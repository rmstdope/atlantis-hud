//! The one file an assistant may ask the shell to write: a battle file for the simulators
//! (`export_battle_file`), to a path the assistant names.
//!
//! The webview's own write permission covers only paths the player chose in a save dialog, so this
//! write happens in the shell instead. It is held to what that tool needs - an absolute path to a
//! `.json` file in a folder that already exists - rather than being a general way onto the disk.

use std::path::Path;

/// Writes `text` to `path`, replacing a file already there, or says in one sentence why it will not.
pub fn write_assistant_file(path: &Path, text: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("{} is not an absolute path.", path.display()));
    }
    let is_json = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err(format!("{} does not end in .json.", path.display()));
    }
    match path.parent() {
        Some(folder) if folder.is_dir() => {}
        Some(folder) => return Err(format!("the folder {} does not exist.", folder.display())),
        None => return Err(format!("{} names no folder.", path.display())),
    }
    std::fs::write(path, text).map_err(|error| format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A folder of its own under the temporary directory, which the test does not create.
    fn unmade_dir(label: &str) -> PathBuf {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        std::env::temp_dir().join(format!(
            "assistant-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn scratch_dir() -> PathBuf {
        let dir = unmade_dir("file");
        std::fs::create_dir_all(&dir).expect("the directory");
        dir
    }

    #[test]
    fn writes_a_battle_file_where_the_assistant_named_and_replaces_one_already_there() {
        let dir = scratch_dir();
        let path = dir.join("host-vs-watch.json");

        write_assistant_file(&path, "{\"first\":1}").expect("the first write");
        write_assistant_file(&path, "{\"second\":2}").expect("the second write");

        assert_eq!(
            std::fs::read_to_string(&path).expect("the file"),
            "{\"second\":2}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_a_relative_path() {
        let error = write_assistant_file(Path::new("battle.json"), "{}").expect_err("a refusal");

        assert_eq!(error, "battle.json is not an absolute path.");
    }

    #[test]
    fn refuses_a_path_that_is_not_a_json_file() {
        let dir = scratch_dir();
        let path = dir.join("notes.txt");

        let error = write_assistant_file(&path, "{}").expect_err("a refusal");

        assert_eq!(error, format!("{} does not end in .json.", path.display()));
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_a_folder_that_does_not_exist_rather_than_making_it() {
        let dir = unmade_dir("missing");
        let path = dir.join("battle.json");

        let error = write_assistant_file(&path, "{}").expect_err("a refusal");

        assert_eq!(
            error,
            format!("the folder {} does not exist.", dir.display())
        );
        assert!(!dir.exists());
    }
}
