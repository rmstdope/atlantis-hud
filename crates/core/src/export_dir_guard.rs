//! Keeps a `cargo test` run from exporting TypeScript bindings into another checkout.
//!
//! Cargo finds `.cargo/config.toml` by walking up from the **working directory**, and used to
//! resolve `TS_RS_EXPORT_DIR` against the directory holding it. Every agent worktree lives under
//! `.cerebro/worktrees/` *inside* the main checkout, so a run whose cwd was the repository root and
//! whose `--manifest-path` pointed into a worktree wrote that worktree's bindings into the main
//! checkout's `packages/core-client/src/generated`. That happened on 2026-09-04 (ah-16pb).
//!
//! The anchor is fixed in `.cargo/config.toml`; this module is the guard that says so loudly if
//! anything ever points the export directory outside the tree being built.

use std::path::{Component, Path, PathBuf};

/// The environment variable a tool sets to say it means to export outside this tree.
pub(crate) const ALLOW_EXTERNAL: &str = "ATLANTIS_HUD_ALLOW_EXTERNAL_EXPORT_DIR";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// The export directory is this workspace's own.
    Inside,
    /// No `TS_RS_EXPORT_DIR` reached the test at all.
    Unset,
    /// Outside this workspace, and the caller said so on purpose.
    External,
    /// Outside this workspace, and nobody said so.
    Escapes {
        export_dir: PathBuf,
        workspace: PathBuf,
    },
}

/// Lexically resolve `.` and `..`. No filesystem access and no symlink resolution, on purpose: the
/// directory being judged does not have to exist yet, and `checkGenerated.ts`'s temporary tree does
/// not.
///
/// A leading `..` is dropped rather than preserved: on an absolute path that is a no-op pop off the
/// root, but on a relative one it yields a *different* path (`../x` normalizes to `x`). `verdict`
/// only ever calls this on `cwd.join(dir)`, which is absolute whenever `cwd` is, so that case does
/// not arise there; a future caller passing a relative path must know it.
pub(crate) fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Is `path` `root` itself, or under it? `Path::starts_with` compares whole components, so
/// `/repo-old/x` is not inside `/repo`.
pub(crate) fn is_inside(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
}

/// The verdict for one run. `cwd` is where the test process is, `workspace` the root of the manifest
/// it was built from; an absolute `export_dir` ignores `cwd`, which is what `Path::join` already
/// does.
pub(crate) fn verdict(
    export_dir: Option<&str>,
    cwd: &Path,
    workspace: &Path,
    allow_external: bool,
) -> Verdict {
    let Some(dir) = export_dir else {
        return Verdict::Unset;
    };
    let resolved = normalize(&cwd.join(dir));
    let root = normalize(workspace);
    if is_inside(&root, &resolved) {
        Verdict::Inside
    } else if allow_external {
        Verdict::External
    } else {
        Verdict::Escapes {
            export_dir: resolved,
            workspace: root,
        }
    }
}

/// What to say about a verdict, or `None` when there is nothing wrong.
pub(crate) fn describe(verdict: &Verdict) -> Option<String> {
    match verdict {
        Verdict::Inside | Verdict::External => None,
        Verdict::Unset => Some(
            "TS_RS_EXPORT_DIR is not set, so ts-rs would write the bindings under \
             crates/core/bindings\ninstead of packages/core-client/src/generated. The value comes \
             from .cargo/config.toml's [env]\ntable, which cargo finds by walking up from the \
             working directory - so this usually means cargo\nwas run from outside any checkout of \
             this repository. Run it from inside the tree you mean to\nbuild."
                .to_owned(),
        ),
        Verdict::Escapes { export_dir, workspace } => Some(format!(
            "TS_RS_EXPORT_DIR points outside the workspace being built, so this run would write \
             generated\nbindings into another tree:\n  export directory: {}\n  this workspace:   \
             {}\ncargo finds .cargo/config.toml by walking up from the working directory, not from \
             the manifest,\nso a run whose cwd is one checkout and whose --manifest-path is another \
             used to resolve the\nexport directory against the wrong one (ah-16pb). Run cargo from \
             the tree you are building. A\ntool that means to export outside this tree - \
             scripts/checkGenerated.ts does - sets\nATLANTIS_HUD_ALLOW_EXTERNAL_EXPORT_DIR=1.",
            export_dir.display(),
            workspace.display(),
        )),
    }
}

/// The live guard: this run's own export directory must be inside this workspace.
///
/// Green as written against the current config, so it was proved able to fail rather than started
/// from red:
///
/// ```text
/// TS_RS_EXPORT_DIR=/tmp/elsewhere cargo test -p atlantis-hud-core --lib \
///   export_bindings_stay_inside_this_workspace     # fails, naming both paths
/// cargo test -p atlantis-hud-core --lib export_bindings_stay_inside_this_workspace  # passes
/// ATLANTIS_HUD_ALLOW_EXTERNAL_EXPORT_DIR=1 TS_RS_EXPORT_DIR=/tmp/elsewhere \
///   cargo test -p atlantis-hud-core --lib export_bindings_stay_inside_this_workspace  # passes
/// ```
///
/// The name contains `export_bindings_` deliberately: that substring is the filter
/// `scripts/checkGenerated.ts`'s `REGENERATE` command uses, so a differently-named guard would never
/// run under `pnpm run check:generated`.
#[test]
fn export_bindings_stay_inside_this_workspace() {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cwd = std::env::current_dir().expect("a working directory");
    let configured = std::env::var("TS_RS_EXPORT_DIR").ok();
    let allowed = std::env::var(ALLOW_EXTERNAL).is_ok_and(|value| value == "1");

    if let Some(message) = describe(&verdict(configured.as_deref(), &cwd, &workspace, allowed)) {
        panic!("{message}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_dir_in_an_outer_checkout_is_an_escape() {
        assert_eq!(
            verdict(
                Some("/repo/packages/core-client/src/generated"),
                Path::new("/repo/.cerebro/worktrees/ah-omn7/crates/core"),
                Path::new("/repo/.cerebro/worktrees/ah-omn7"),
                false,
            ),
            Verdict::Escapes {
                export_dir: PathBuf::from("/repo/packages/core-client/src/generated"),
                workspace: PathBuf::from("/repo/.cerebro/worktrees/ah-omn7"),
            }
        );
    }

    #[test]
    fn an_export_dir_inside_the_workspace_is_fine() {
        assert_eq!(
            verdict(
                Some("/repo/packages/core-client/src/generated"),
                Path::new("/repo/crates/core"),
                Path::new("/repo"),
                false,
            ),
            Verdict::Inside
        );
    }

    #[test]
    fn a_relative_export_dir_is_resolved_against_the_working_directory() {
        assert_eq!(
            verdict(
                Some("../../packages/core-client/src/generated"),
                Path::new("/repo/crates/core"),
                Path::new("/repo"),
                false,
            ),
            Verdict::Inside
        );
    }

    #[test]
    fn an_export_dir_outside_every_checkout_is_still_an_escape_unless_it_is_allowed() {
        let outside = Some("/tmp/x/packages/core-client/src/generated");
        assert_eq!(
            verdict(
                outside,
                Path::new("/repo/crates/core"),
                Path::new("/repo"),
                false
            ),
            Verdict::Escapes {
                export_dir: PathBuf::from("/tmp/x/packages/core-client/src/generated"),
                workspace: PathBuf::from("/repo"),
            }
        );
        assert_eq!(
            verdict(
                outside,
                Path::new("/repo/crates/core"),
                Path::new("/repo"),
                true
            ),
            Verdict::External
        );
    }

    #[test]
    fn an_unset_export_dir_is_reported_rather_than_ignored() {
        assert_eq!(
            verdict(
                None,
                Path::new("/repo/crates/core"),
                Path::new("/repo"),
                false
            ),
            Verdict::Unset
        );
    }

    #[test]
    fn a_sibling_named_like_the_workspace_is_not_inside_it() {
        assert_eq!(
            verdict(
                Some("/repo-old/packages/core-client/src/generated"),
                Path::new("/repo/crates/core"),
                Path::new("/repo"),
                false,
            ),
            Verdict::Escapes {
                export_dir: PathBuf::from("/repo-old/packages/core-client/src/generated"),
                workspace: PathBuf::from("/repo"),
            }
        );
    }

    #[test]
    fn describe_says_nothing_when_the_export_directory_is_this_workspace() {
        assert_eq!(describe(&Verdict::Inside), None);
        assert_eq!(describe(&Verdict::External), None);

        let escapes = describe(&Verdict::Escapes {
            export_dir: PathBuf::from("/repo/packages/core-client/src/generated"),
            workspace: PathBuf::from("/repo/.cerebro/worktrees/ah-omn7"),
        })
        .expect("an escape is described");
        assert!(
            escapes.contains("/repo/packages/core-client/src/generated"),
            "{escapes}"
        );
        assert!(
            escapes.contains("/repo/.cerebro/worktrees/ah-omn7"),
            "{escapes}"
        );

        let unset = describe(&Verdict::Unset).expect("an unset export dir is described");
        assert!(unset.contains("crates/core/bindings"), "{unset}");
    }
}
