# ah-qled.10.3 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-22
- **PR:** #86 (cerebro), and the pin bump in atlantis-hud

## The plan's own validation command cannot finish inside a default `Bash` call

**What happened.** The plan's *Validation* section says to run cerebro's suites as
`for t in tests/*.sh; do bash "$t" || echo "FAILED: $t"; done`. Run as written, the call was killed
at the `Bash` tool's default 120000ms timeout with exit 143, having got through perhaps three of the
22 suites. Re-run with an explicit timeout and per-suite timing, the whole set takes **about 7
minutes**, and one suite — `tests/agent-state.sh` — takes **over 100 seconds on its own**, so a
per-suite cap of 100s reports it as `FAILED` when it passes.

**Why.** Established. cerebro's suites each build a throwaway consumer repo with `git init` and real
script symlinks; several are inherently slow (`launchers.sh` 86s, `launch-preflight.sh` 69s,
`consumer-fixture.sh` 66s, `agent-alive.sh` 46s). Nothing about this is a defect — it is simply
longer than the default any caller gets.

**Cost.** Two wasted runs and about four minutes, plus a moment believing `agent-state.sh` was red
when it was only slow.

**Prevent by.** Any plan whose *Validation* names cerebro's full suite should say what it costs and
how to run it: `timeout 500` per suite, an explicit `timeout: 600000` on the `Bash` call, and a note
that `tests/agent-state.sh` alone exceeds 100s. The same line would fit `implement-bead`'s *Traps*
section, which already warns about waits that look like hangs.

**Seen before.** none found — ah-bqi and ah-2sy record cerebro suites failing, but for
environment reasons, not for taking longer than the caller allowed.
