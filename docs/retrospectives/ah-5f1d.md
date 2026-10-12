# ah-5f1d — retrospective

## The fast gate's tooling suite timed out on a change that never touches it

**What happened.** The second `pnpm run check:fast` failed its `tooling` leg. Two tests in
`scripts/ensureWasmBuildLock.test.ts` hit their timeouts ("rebuilds a current core when forced, as
build:wasm always has" at 5000 ms, "takes over an empty lock, which a build killed between creating
and writing it leaves" at 3000 ms). The diff only touched `crates/core/src/orders/semantics.rs`. The
same file had passed in the first gate run twenty minutes earlier, and it passed again on its own
(`npx vitest run scripts/ensureWasmBuildLock.test.ts`, 7 of 7, 7 s).

**Why.** Not established. Most likely the machine was loaded: the gate runs the cargo suite and
the tooling suite side by side, other fleet worktrees were building too, and these tests have
fixed wall-clock timeouts of a few seconds.

**Cost.** About two minutes to read the log and rerun the file, plus doubt about whether the gate
was red because of the change.

**Prevent by.** Giving the time-bound tests in `scripts/ensureWasmBuildLock.test.ts` timeouts that
allow for a loaded machine, or having the gate's summary name a timed-out test as a timeout rather
than only as `tooling FAIL`.

**Seen before.** No retrospective mentions `ensureWasmBuildLock`. The memory note on noisy local
smoke timing describes the same kind of load-dependent slowness on this Mac.
