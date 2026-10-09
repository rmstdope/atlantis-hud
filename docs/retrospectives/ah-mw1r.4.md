# ah-mw1r.4 — retrospective

## CI's checks job failed downloading binaryen

**What happened.** On PR #1483 the `checks` job failed after 1m42s. The step was `packages/browser-core pretypecheck` (`node ../../scripts/ensure-wasm.mjs`): "failed to download from https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz". The same typecheck passed locally under `pnpm run check:fast`. A bare re-run of the failed job went green with no change to the code.

**Why.** Not established. A release asset fetched from GitHub over the network on every run went unreachable once. Nothing in the job caches it or retries the download.

**Cost.** One of the bead's two bare re-runs. About ten minutes waiting for the rest of the run to finish before the failed job could be re-run.

**Prevent by.** In `scripts/ensure-wasm.mjs`, retry the binaryen download a few times with a backoff. Or cache the binaryen tarball in the CI workflow, keyed on its version, so a run does not depend on reaching GitHub releases.

**Seen before.** No: nothing in `docs/retrospectives/` mentions binaryen.
