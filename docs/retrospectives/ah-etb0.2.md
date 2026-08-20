# ah-etb0.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #434

## One extra button in the header broke two unrelated smoke tests, in the desktop project only

**What happened.** The bead adds a fourth control to the header strip. That made the strip wrap onto
a second row at the desktop-shell viewport width, which moved the whole map area — and everything
floating over it — down by one row. Three smoke tests then failed with Playwright's
"subtree intercepts pointer events": the Badges popover, which hangs off the `layer-chips` row
floating over the map, now reached far enough down to be covered by the `units-splitter`
(`z-10`, `pointer-events-auto`, full width), and once the chips row was raised above the splitter it
in turn covered the header's own messages popover. None of the three tests names the header or the
Send button. All of them passed in the `web` project, where the button does not render at all —
which reads as a flake until you notice the pattern.

**Why.** Established. Three overlay layers each carried a locally-correct z-index but sat in
different stacking contexts: the header had none at all, so its popovers lost to anything the map
floated regardless of their own `z-20`. Nothing had exposed it before because the header had always
been one row, and one row put every panel above the splitter by geometry rather than by stacking
order. The fix is two lines — `relative z-30` on the header, `z-20` on the chips row — and no
layout change.

**Cost.** Two CI cycles and about 40 minutes, most of it two full local smoke runs (13 minutes each)
to find the second and third failure after fixing the first.

**Prevent by.** A plan that adds or removes a control in the header strip should say, in *Known
traps*, that the strip's wrap point moves the map overlays with it, and that the check is
`pnpm run test:smoke --project=desktop-shell` in full rather than the bead's own new case. This
plan's traps did warn that "the header strip already wraps… check the narrow window before merging",
which was the right instinct — but it framed the consequence as the smoke suite's *header
assertions* needing updating, so the failures it actually produced, in tests about badges and turn
messages, did not read as the predicted one.

**Seen before.** ah-1uj — also a header-chip change breaking smoke tests that had never failed and
do not name the header. Different mechanism (pixel-exact assertions there, stacking contexts here),
same shape: the header strip is shared ground, and a change to it surfaces somewhere unrelated.
