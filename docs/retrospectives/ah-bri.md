# ah-bri — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** rmstdope/cerebro#24

## `PATH=X command ...` looks up `command` itself under X, not the invoking shell's PATH

**What happened.** Writing the claude-missing launcher test, I ran
`PATH="$no_claude_dir" bash "$repo_root/scripts/run-bishop"` expecting `bash` to be found via the
invoking shell (since `bash` was already resolved and running) and only the *script's* commands to
be restricted by the new `PATH`. It failed instead with `env: bash: No such file or directory`,
exit 127 — not from `run-bishop` at all, but from `launch-preflight`, which the launcher execs
directly and which carries its own `#!/usr/bin/env bash` shebang; the kernel's shebang handling
invokes `env bash`, and `env` resolved `bash` against the *new*, restricted `PATH`.
**Why.** `VAR=value command args` sets `VAR` in `command`'s environment before it runs, and if
`VAR` is `PATH`, the shell's own lookup of `command`'s name (here, indirectly, `env`'s lookup of
`bash`) uses that new value too — there is no split between "the environment handed to the process"
and "the PATH used to find it". A restricted `PATH` bites every subsequent shebang-invoked script in
the chain, not just the top-level one named on the command line.
**Cost.** About 10 minutes: one failed run, reading the exit code and stderr, and two edits (first
resolving `bash`'s own path with `command -v` for the top-level invocation, which still failed;
then noticing `launch-preflight` is *exec'd directly* and needs its own `bash` symlink inside the
restricted `PATH`).
**Prevent by.** When a test deliberately restricts `PATH` to prove a command is missing, populate the
restricted directory with symlinks to *everything* actually needed to reach the assertion — including
`bash` itself, if any script in the call chain (directly invoked, not sourced) carries a
`#!/usr/bin/env bash` shebang — rather than assuming the invoking shell's own resolution carries
through.
**Seen before.** None found.
