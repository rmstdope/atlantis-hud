# ah-yaot2 — retrospective

- **Implementer:** Bishop (bugfixer)
- **Date:** 2026-11-25
- **PR:** #2003

## A Dependabot major bump of @wdio/cli alone failed `native` at its typecheck

**What happened.** Dependabot's #2003 moved `@wdio/cli` from 9 to 10 and left `@wdio/globals`,
`@wdio/local-runner` and `@wdio/mocha-framework` on 9. Because `@wdio/cli` 10 pulls in
webdriverio 10, the lockfile resolved `@wdio/globals` 9 against webdriverio 10 too: a mixed tree.
WebdriverIO 10 removed `browser.executeAsync`, so the `native` job's "Typecheck the native suite"
step (`pnpm exec tsc -p tests/native/tsconfig.json`) failed with TS2339 at `tests/native/helpers.ts`.
The fix moved the whole `@wdio` family to 10 by hand and replaced `executeAsync` with an `async`
function passed to `execute`.

**Why.** `.github/dependabot.yml` groups only the React packages. Every other family whose members
must move together still arrives one package per PR. `@wdio/*` all release on the same version
number, and webdriverio's peer ranges expect them to match.

**Cost.** One red Dependabot PR, a bugfix bead and a bugfixer pass (about 40 minutes, two CI runs).
The major-version API change (`executeAsync`) would have needed hand work anyway. A grouped PR
would still have gone red, but on one PR that carries the whole family, not on one with a mixed
tree that has to be widened before it can be fixed.

**Prevent by.** A `wdio` group in `.github/dependabot.yml`'s npm entry, beside the `react` group,
with the pattern `"@wdio/*"`, plus a matching security-updates group as React has. It is the same
remedy ah-6gn7c applied to React and ah-8v1io and ah-6fcsh propose for the Tauri crate/npm pairs.

**Seen before.** ah-8v1io and ah-6fcsh (Tauri crate and npm package split across Dependabot PRs,
`native` red); ah-h05yn / ah-6gn7c (react-dom ahead of react, #1978). This is the third family to
hit it.
