# ah-qled.5.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#72, and this one

## A rename sweep's grep missed every reference written as a glob

**What happened.** The bead deleted seven `run-*` launcher shims, and its plan's *Known traps*
warned twice that "deleting a shim is easy to under-grep" and gave the sweep as
`grep -rn "scripts/run-"`. I ran that, plus greps for each shim's literal name, and both came back
clean. The Copilot review then found four places that still described the shims as a live mechanism
— `CLAUDE.md:269` ("every `run-*` script is a shim over it"), `CLAUDE.md:294`, `agents/orchestrator.md:387`
and `tests/launchers.sh:4` — none of which either grep could match, because all four refer to the
shims *collectively*, as the bare glob `run-*`, and never name a script or a path.

**Why.** Established. The two greps the plan supplied both look for a **specific** reference: a path
prefix (`scripts/run-`) or a full name (`run-forge`). Prose about a family of scripts does not
contain either — it contains the pattern. So the validation items that were supposed to *be* the
sweep (items 7 and 8) were structurally incapable of finding this class of reference, and passed.

**Cost.** One review round and one extra CI cycle on the cerebro PR, roughly fifteen minutes. Cheap
here only because the reviewer caught it; had it not, the merge would have left the repository's own
CLAUDE.md describing a mechanism the same commit had removed.

**Prevent by.** When a bead removes a *family* of things sharing a name prefix, grep for the family
as it is written in prose, not only as it is written in a command — `grep -rn "run-\*"` alongside
`grep -rn "scripts/run-"`. More generally: a plan that supplies its own sweep command has already
decided what the sweep can find, and a plan-supplied grep is a floor rather than the whole search.
Worth adding to `implement-bead`'s *Traps* if a second bead hits it — the navigator's call, not mine.

**Seen before.** None for this exact shape. The nearest neighbour is `ah-60m`, "A failed glob hid an
existing test file, and I overwrote it" — a different mechanism (a glob that matched nothing was
read as "nothing is there"), but the same underlying trust: a search that comes back empty was taken
as proof of absence rather than as a fact about the pattern.
