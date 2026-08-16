# ah-j2w — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** #339

## The plan's test list missed the smoke suite, whose own fixture unit shares

**What happened.** `pnpm run check:fast` and `cargo test --workspace` were green locally and the
PR opened clean. The first CI run failed two smoke jobs (`smoke (web, 2, 2)` and
`smoke (desktop-shell, 2, 2)`), both on `tests/smoke/workspace.spec.ts`: one asserted the old
"...units sharing in this hex..." wording, the other expected a per-unit item-shortfall warning in
`orders-diagnostics` that had moved to the hex-level `region-problems` panel instead.

**Why.** The smoke fixture's own faction unit, Seven of Eight (18642, `OWN_UNIT` in the spec),
carries the `sharing` flag itself (turn 71, the real report every smoke spec loads). Before this
bead only silver pooled, and only sharers borrowed from sharers — silver flowed through the old
`report_shared_purse` path either way, so the smoke suite's silver test already expected a
hex-level finding and needed only a wording fix. Items never pooled at all, so the smoke suite's
item-shortfall test had always exercised the *per-unit* path — and after this bead, because the
unit itself shares, its own item shortfall now pools too and moved to the hex. The bead's plan
listed only the Rust and TypeScript unit suites to update; the browser suites are not run locally
by `check:fast` (by design — CI's parallel jobs are the gate), so this was invisible until CI ran
smoke.

**Cost.** One CI cycle (~4 minutes) plus the diagnosis and a second push; no rebase or bead
hand-back needed since both fixes were mechanical once the CI log named the two failing
assertions.

**Prevent by.** When a plan changes which panel or per-unit/hex-level bucket an existing finding
type reports through, its *Files to change* section should say to `grep` the smoke specs
(`tests/smoke/`) for the changed testids/wording (`region-problems`, `orders-diagnostics`,
message substrings like `"sharing"`) — the same way the `implement-bead` skill's traps section
already tells implementers to grep for a moved control's selectors before writing code. Here that
grep (`grep -rn "sharing\|orders-diagnostics" tests/smoke/workspace.spec.ts`) would have found
both sites before the PR opened, at the cost of one command instead of one CI cycle.

**Seen before.** None found — the skill's existing "grep for a moved control's selectors" trap
(atlantis-hud #128) is about a UI control moving behind an affordance, not about a finding's
attribution (unit vs. hex) moving between panels; this is a new instance of the same underlying
lesson (a fixture whose real-world data happens to exercise the code path under test can flip
silently when the classification logic changes).
