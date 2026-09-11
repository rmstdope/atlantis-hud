# ah-g9sf.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-11
- **PR:** #1174

## The settings smoke assertion lagged behind the read-only UI

**What happened.** CI run `34619252446` failed the web and desktop smoke jobs because
`tests/smoke/settings.spec.ts` still expected `settings-game-ruleset` to be an enabled input with
value `neworigins`. The implementation intentionally changed that control to read-only text. The
automatic retries passed, but the failed first attempts left the PR red. Updating the assertion to
check the visible `New Origins` label and the explanatory sentence, followed by the targeted web and
desktop smoke runs, made the current head green.
**Why.** The fast gate does not run browser smoke tests, and the existing smoke assertion was not
updated alongside the UI change.
**Cost.** One CI cycle, one fix commit, one delta review, and the time to reproduce both shell
variants locally.
**Prevent by.** When a bead changes an audience-visible control, run the affected smoke spec for
both `web` and `desktop-shell` before opening the PR, even when the fast gate is green.
**Seen before.** None found for a smoke assertion retaining the old control semantics after a
read-only UI change.
