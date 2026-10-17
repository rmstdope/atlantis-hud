# ah-0ace — a draft-persistence smoke test went red on a Rust-only diff

**What happened.** PR #1718 changed only `crates/core` (EVICT modelling) and one Rust test. CI's
`smoke (desktop-shell, 1, 2)` failed in `tests/smoke/persistence.spec.ts:236` "a saved draft gains
its missing trailing newline without moving the cursor": `expect(received).toMatch(expected)`,
"Timeout 15000ms exceeded while waiting on the predicate", twice (with the retry). Locally on the same
branch the spec passed 3 of 3 (`--repeat-each 3`, desktop-shell, about 0.85 s each). A bare re-run of
the failed job was green; the next push (the retrospective commit) failed it again, with the stored
draft read back as `"@work..."` without the newline the pattern waits for. Main fails the same test
too: run 39068208710 at cfdaffed, `smoke (web, 1, 2)`, 2026-10-17.

**Why.** Not established. The diff cannot reach the draft editor; the 15 s wait points at the
autosave flush timing on a loaded CI runner rather than at the assertion.

**Cost.** One bare re-run and one extra push, about 25 minutes of CI, and a local reproduction
attempt.

**Prevent by.** `tests/smoke/persistence.spec.ts`, the trailing-newline test: wait on the autosave
flush helper the suite already keeps (see the smoke-suite cost notes) before reading the saved draft,
rather than polling the stored text against a fixed 15 s timeout.

**Seen before.** Nothing in `docs/retrospectives/` mentions this test; it is red on main as well
(above), so every open PR is meeting it.
