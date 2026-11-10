//! The one file an assistant may ask the shell to write: a battle file for the simulators
//! (`export_battle_file`), to a path the assistant names.
//!
//! The webview's own write permission covers only paths the player chose in a save dialog, so this
//! write happens in the shell instead. It is held to what that tool needs - an absolute path to a
//! `.json` file in a folder that already exists, replacing only an earlier battle file - rather
//! than being a general way onto the disk.

use std::path::Path;

/// Writes `text` to `path`, or says in one sentence why it will not. A file already at `path` is
/// replaced only when it is itself a battle file, so a careless path cannot clobber other JSON.
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
    if path.exists() && !is_battle_file(path) {
        return Err(format!(
            "{} already exists and is not a battle file; choose another name.",
            path.display()
        ));
    }
    std::fs::write(path, text).map_err(|error| format!("{}: {error}", path.display()))
}

/// A JSON object holding both of the keys every battle file the HUD writes carries.
fn is_battle_file(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|value| value.get("attackers").is_some() && value.get("defenders").is_some())
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

    const BATTLE: &str = "{\"attackers\":{\"units\":[]},\"defenders\":{\"units\":[]}}";

    #[test]
    fn writes_a_battle_file_where_the_assistant_named_and_replaces_an_earlier_one() {
        let dir = scratch_dir();
        let path = dir.join("host-vs-watch.json");
        let again = BATTLE.replace("[]}}", "[{}]}}");

        write_assistant_file(&path, BATTLE).expect("the first write");
        write_assistant_file(&path, &again).expect("the second write");

        assert_eq!(std::fs::read_to_string(&path).expect("the file"), again);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn keeps_a_file_already_there_that_is_not_a_battle_file() {
        let dir = scratch_dir();
        let path = dir.join("package.json");
        std::fs::write(&path, "{\"name\":\"keep me\"}").expect("the other file");

        let error = write_assistant_file(&path, BATTLE).expect_err("a refusal");

        assert_eq!(
            error,
            format!(
                "{} already exists and is not a battle file; choose another name.",
                path.display()
            )
        );
        assert_eq!(
            std::fs::read_to_string(&path).expect("the file"),
            "{\"name\":\"keep me\"}"
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
