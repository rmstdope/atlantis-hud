# ah-pfa0 — retrospective

## Landing-hex smoke tests red in CI, green locally

**What happened.** On PR #1811 the `smoke (web, 1, 2)` shard failed two tests in
`tests/smoke/orders-editor.spec.ts`, both through the shared `landingHexButton` helper:
`Show problems on a passenger's landing-hex marker goes to that hex` and
`a landing-hex jump made with the Region panel folded never flashes later`. Each expected one
`.cm-lintRange-warning` on 10594's `study` and found 0 (line 1297), on both of Playwright's retries.
The same head passed both tests alone, and passed the whole spec file (42/42), under `smoke-port`
locally. A bare re-run of the failed job went green.

**Why.** Not established. The bead's change (a new `work-earns-nothing` finding, and dropping a
wage-pool sentence for those units) does not touch the STUDY or landing-hex findings, and local
runs on the same code could not reproduce it. Most likely a timing race between the lint marker
appearing and the assertion on the CI runner, but that is a guess.

**Cost.** One ~11-minute CI shard, two local smoke runs (~2 minutes), and one of the bead's two
bare re-runs.

**Prevent by.** `landingHexButton` in `tests/smoke/orders-editor.spec.ts` asserts the marker count
straight after `expectOrders`; waiting on the diagnostics list (`orders-diagnostic`) for 10594
before counting lint ranges would show whether the marker is late rather than missing.

**Seen before.** Not in `docs/retrospectives/` (searched for landing-hex, landingHex, cm-lintRange).
