# ah-7ale.2.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-12
- **PR:** #1200

## A `FORM`ed unit with no men dissolves, and takes the goods you just gave it with it

**What happened.** The review asked for an end-to-end test of a formed sender. I wrote
`unit 900 / FORM 1 / TRANSPORT 901 5 STON / END / GIVE NEW 1 5 STON` and asserted the formed row
kept its stone. It held nothing at all, and unit 900 still held all five — no error, no issue, no
diagnostic. `dissolve_empty_forms` had dissolved the block for having no men and reverted its goods
to the parent. `GIVE NEW 1 1 LEAD` before the stone fixed it. Two guesses were spent first on the
wrong hypothesis (that `GIVE NEW` had to precede or follow the `FORM` block), because the symptom —
an empty formed unit — looks exactly like a give that did not resolve.
**Why.** Established. `settle` runs `dissolve_empty_forms` before `apply_transports`
(`crates/core/src/orders/effects.rs`), and a form with no men is empty by definition however many
items it was given.
**Cost.** About ten minutes and three `cargo test` cycles.
**Prevent by.** `implement-bead`'s *Traps this fleet has already paid for*, or
`.cerebro/traps.md`, gaining one line: **a `FORM` fixture needs `GIVE NEW <n> 1 LEAD` before any
other `GIVE NEW`, or the block dissolves and its goods revert silently.** The knowledge exists — four
retrospectives now contain the incantation — but only as the fix inside four unrelated stories, so
each bead rediscovers it from the symptom. Naming it once where a fixture is being written is what
would stop the fifth.
**Seen before.** `ah-4hux` ("The formed unit dissolved on every run"), `ah-8cjs`, `ah-dhga`, and
`ah-ty3s.3` on the adjacent recipient-search question. This is the fourth time the same line has been
written down as a fix and the first time it is being proposed as a rule.

## `OrdersPreviewResponse` omits every unit the orders leave alone, which reads as a missing unit

**What happened.** The plan's increment-4 test compares the sender's weight against a preview run
over an *empty* orders document, to show the weight did not move. That run draws nothing: the
response's own doc comment says "Regions and units the orders leave alone are simply absent", so the
lookup panicked with "the unit is previewed". The same shape bit the assertion one line earlier —
the refused shipment's target is unchanged, so it too is absent, and `held(target, "STON") == 0` has
to mean "absent, or zero" rather than reading a row.
**Why.** Established, from `OrdersPreviewResponse`'s own documentation.
**Cost.** Two failed test runs and one debug print, about ten minutes.
**Prevent by.** A plan that asks for a *negative* assertion over the preview — a unit that did not
change, a control run with no orders — should say which row it expects to exist. This one named a
no-orders comparison run that cannot produce one. The check is cheap: any test helper that looks a
unit up in an `OrdersPreviewResponse` and `expect`s it wants to be `Option`-shaped unless the orders
provably changed that unit.
**Seen before.** None found.
