# ah-wxk.1 — retrospective

- **Role:** verifier
- **Date:** 2026-08-16
- **PR:** (this retrospective; the original build merged in #329)

## Launching the desktop dev build without `--features desktop-runtime` runs the stub `main`

**What happened.** Verifying ah-wxk.1 (the desktop Tauri command consolidation) called for the
desktop shell, so I ran `pnpm --filter @atlantis/desktop exec tauri dev` as this role's own
instructions describe it — no `--features` flag. `apps/desktop/src-tauri/src/main.rs` has always
had two `main` functions gated on `cfg(all(any(target_os = ...), feature = "desktop-runtime"))`;
with `desktop-runtime` off (`Cargo.toml`'s `default = []`), Tauri's `DevCommand` ran
`cargo run --no-default-features --color always --`, which compiled the fallback stub — it prints
`atlantis-hud desktop shell is supported on macOS and Windows` and exits immediately. No window
ever opened. I told the navigator to look before noticing the process had already exited; they
had nothing to look at and asked whether I'd made the same mistake before.
**Why.** `--features desktop-runtime` is not implied by anything in `tauri.conf.json` or a
`.cargo/config.toml` default — it is passed explicitly at every call site that needs the real
binary: `.github/workflows/ci.yml` (`cargo check`/`clippy`/`tauri build --debug --no-bundle`) and
`.github/workflows/release.yml` (`tauri build --features desktop-runtime` on every platform). The
verifier role's own instructions for launching the desktop shell
(`.claude/agents/verifier.md`, *Preparing, before you ask for anything*) give
`pnpm --filter @atlantis/desktop exec tauri dev` with no feature flag, so following them exactly
reproduces the stub every time — this is not specific to ah-wxk.1's diff.
**Cost.** One cold Tauri/Rust build (~2 minutes) thrown away, plus the navigator's attention for a
launch that had nothing to show — the kind of wasted five minutes this role exists to avoid
spending.
**Prevent by.** `.claude/agents/verifier.md`'s desktop bullet under *Preparing, before you ask for
anything* should read
`pnpm --filter @atlantis/desktop exec tauri dev --features desktop-runtime`, matching every other
call site that runs the real binary. That is a change to the verifier's own process/instructions,
so it is the navigator's to make, not mine to apply from inside a verification pass — recorded
here rather than acted on.
**Seen before.** None found (`ah-m9q.2-verifier.md` is a different failure — a stale build, not a
missing feature flag — but is the same shape of lesson: pin down exactly what got built before
asking for the navigator's time).
