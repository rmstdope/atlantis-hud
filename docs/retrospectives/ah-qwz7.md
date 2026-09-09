# ah-qwz7 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1144

## A scripted insertion anchored on a `fn` name separated an existing `#[test]` from its function

**What happened.** I added tests to `crates/core/src/orders/semantics.rs` with small Python
replacements anchored on the *signature line* of the function they were to precede — e.g.
`s.replace("    fn a_mage_gift_keeps_men_and_skills_in_the_semantic_projection() {", new + anchor)`.
That anchor sits *below* the target's doc comment and its `#[test]`, so the new test was spliced
between the attribute and the function it belonged to. The existing test was thereby deregistered
and the new one inherited its attribute. `cargo test -p atlantis-hud-core --lib` passed — the count
went up, not down, because a new test replaced the lost one — and only `pnpm run check:fast`'s
clippy leg caught it, as `duplicated attribute` plus `function ... is never used`.

**Why.** A Rust test's identity is `#[test]` + `fn`, and the only textual anchor that is unique and
memorable is the function name, which is the wrong end of that pair. Two separate insertions in this
bead used the same wrong anchor.

**Cost.** One fast-gate cycle and about ten minutes, plus a `chore` commit on the branch that the
reviewer then had to reason about.

**Prevent by.** When splicing a Rust test in by text, anchor on the `#[test]` line of the following
test (`    #[test]\n    fn <name>`), never on its `fn` line alone — that keeps the attribute with
its function whichever side the new text lands on. `cargo test` alone does not catch this; the
clippy leg of the fast gate is what does, so a Rust bead that only ran `cargo test` between
increments can carry the fault to the gate.

**Seen before.** None found — `grep -rl "duplicated attribute\|orphan" docs/retrospectives/` returns
`ah-9js` and `ah-5pp`, both about unrelated orphaned *processes* and *buffers*.

## A mutation check proved the wrong assertion, and I posted it as evidence

**What happened.** To show a new `charged_at` assertion was non-vacuous, I disabled the guard it
covers and reported the test's failure output on the PR. The output was the *preceding* assertion in
the same test firing; execution never reached the new one. The delta review caught it and ran the
experiment properly (neutering the earlier assertion as well), which did confirm the assertion — so
the conclusion held and only the proof was wrong. I posted a correction.

**Why.** A test that already asserts something about the same disabled behaviour will fail first, so
its failure says nothing about a *later* assertion in the same function. I read "the test fails" as
"my assertion fails".

**Cost.** One PR comment retracted; no code change and no CI cycle.

**Prevent by.** When mutation-checking a single new assertion inside an existing test, comment out
the assertions above it, or put the check in its own test — and quote the *line number* of the
panic, not just the message, since the line is what identifies which assertion fired.

**Seen before.** None found.
