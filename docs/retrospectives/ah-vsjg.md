# ah-vsjg — retrospective

## The plan named `native` as the WebKit check, and the PR's CI skipped it

**What happened.** The plan answered the traps.md entry on WebKit ("`native` is the job that tells
you") by putting the lake tint in an SVG `filter` on a group, with "the `native` CI job is the check".
PR #1412 touches only `packages/shared` and stylesheets. On both heads `native` reported `skipping`,
so the only WebKit evidence before merge was the reasoning in the plan. The review sub-agent raised a
separate WebKit risk (a filtered group in a 1×1 `objectBoundingBox` pattern may be rasterised at low
resolution), and no pre-merge job could confirm or rule it out.

**Why.** On a pull request, `ci.yml`'s `changes` job sets `native=true` only for native-shaped paths.
On a push to main it runs everything. So for a shared-UI change, `native` runs after the merge, not
before it. The trap entry does not say that.

**Cost.** Small this time: the WebKit question went to verification instead of being answered in CI.
A WebKit-only rendering defect in shared UI code would reach main before any job could show it.

**Prevent by.** The WebKit entry in `.cerebro/traps.md` saying that `native` is skipped on a PR whose
diff is not native-shaped, and runs on main after the merge. A plan that relies on WebKit behaviour
then either gets the job run on the PR, or names the native-shell check in its *Validation*.

**Seen before.** Not this symptom. `ah-vzj9` records the opposite: the `changes` filter treating a
workflow file as native-shaped.
