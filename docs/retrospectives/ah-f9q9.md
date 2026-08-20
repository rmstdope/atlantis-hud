# ah-f9q9 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #465

## The walk-buttons smoke spec failed in CI and passed eleven times out of eleven locally

**What happened.** `smoke (web, 1, 2)` failed on
`tests/smoke/shortcuts.spec.ts:358 › the walk buttons step to the next problem and back, and wrap at
the end` — `expect(unitPane).toHaveText(first)` timed out after 15s having resolved the locator 34
times to the *previous* unit's text. The same run reported
`orders-editor.spec.ts:360 › with Order OCD off, nothing is uppercased` as **flaky** (passed on
retry) with a 15s `expect.poll` timeout on the draft. 103 tests passed. Running the whole spec file
locally with `SMOKE_PROJECT=web CI=1` passed 11/11 in 11.6s. A single job re-run went green.

**Why.** Not established with certainty, but the shape matches ah-dlao exactly: both failing
assertions wait on state that only lands after the debounced validation runs, and both timed out
rather than asserting a wrong value. A CI runner under four concurrent smoke shards is slower than
this machine by more than the margin those 15s ceilings leave.

The containerisation this bead did is **not** implicated. It changes where the browser's system
libraries come from, not the application, the debounce or the timeouts; the other three shards and
`pwa` were green on the same commit, and both wobbling specs are ones ah-dlao already recorded as
racing validation.

**Cost.** Two CI cycles and one local spec run, about 20 minutes.

**Prevent by.** ah-dlao's prevention is the right one and has not been applied to this spec: a smoke
test that walks, counts or jumps between problems must first wait on the header's `problems-chip`
showing a non-zero count, which is the only on-screen barrier meaning "validation has landed".
`shortcuts.spec.ts:358` still does not, and it is now the second recorded failure of that same spec
for that same reason. Worth a bead against `tests/smoke/shortcuts.spec.ts` rather than another
re-run next time — recording only, per this role.

**Seen before.** ah-dlao — same spec, same debounced-validation race, diagnosed there as a wiring
fault for three runs before the cause was found.

## The Playwright container needed nothing adjusting, which the plan expected to be the risk

**What happened.** The plan named four likely container-migration snags — `actions/setup-node`
fighting the image's own Node, corepack for pnpm, root permissions, and `actions/cache` paths
resolving inside the container — and called increment 3 "the whole risk of the bead". None of them
occurred. `smoke` and `pwa` were green on the first push with no change beyond `container:` and the
two deleted `uses:` lines, at 3m10s–4m52s and 56s: inside the 1–4 minute and sub-one-minute baseline
ah-3c80 measured.

**Why.** `mcr.microsoft.com/playwright:v1.62.1-noble` ships a Node that satisfies `.nvmrc` (22), and
`actions/setup-node` and `pnpm/action-setup` both install into the container rather than conflicting
with it. No step in either job depended on the runner user or a host-relative cache path.

**Cost.** None — recorded because it is *cheaper than the plan predicted*, which is as useful to the
next person as an overrun.

**Prevent by.** Nothing to prevent. The next bead containerising a job — `deploy.yml` and
`release.yml`, explicitly out of scope here because they build Rust and wasm-pack — can treat the
Node/pnpm/permissions/cache list as answered for these two jobs and spend its caution on the
toolchain question, which is the part genuinely unsolved.

**Seen before.** None found.
