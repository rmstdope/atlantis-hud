#!/usr/bin/env bash
#
# Runs the implementation role, one bead per process.
#
# `implement-bead` deliberately stops after a single bead. Looping inside one session was the
# obvious design and the wrong one: a context carries every finished bead's diffs, test output, CI
# watches and review threads into the next bead, and grows until compaction starts summarising work
# that is already merged. An agent cannot clear its own context - `/clear` is a built-in command the
# user types, not something a session can invoke - so the loop lives out here, where each iteration
# is a new process with an empty window.
#
# Nothing is lost between beads, which is what makes this free rather than a workaround. Every piece
# of state an implementer carries forward is in bd (the claim, the labels, the plan in `design`) or
# in git (main, the PR). The conversation holds nothing the next bead needs.
#
#     scripts/implement-loop.sh                  # until the planned queue is dry
#     MAX_BEADS=3 scripts/implement-loop.sh      # or until three have been done
#
# Environment:
#   MAX_BEADS         how many iterations at most (default 20). A backstop against a loop that
#                     never makes progress, not a target.
#   PERMISSION_MODE   passed to `claude --permission-mode` (default acceptEdits). Choose this
#                     deliberately: the default prompts for anything beyond an edit, and an
#                     unattended run stalls at the first prompt.
#   MAX_TURNS         passed to `claude --max-turns` (default 400). One bead is a long cycle -
#                     TDD, a full gate, a CI watch, a review - so this is high on purpose; it is
#                     there to stop a runaway, not to bound honest work.

set -euo pipefail

MAX_BEADS="${MAX_BEADS:-20}"
PERMISSION_MODE="${PERMISSION_MODE:-acceptEdits}"
MAX_TURNS="${MAX_TURNS:-400}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for tool in claude bd jq; do
  command -v "$tool" >/dev/null || { echo "implement-loop: $tool is not on PATH" >&2; exit 1; }
done

say() { printf '\n== implement-loop: %s\n\n' "$1"; }

# Only a peek. The claim belongs to the agent, which takes it with `bd ready --claim` as part of the
# role - claiming out here would hand it a bead it never picked, and would race with the other
# implementers sharing this backlog.
planned_is_waiting() {
  bd dolt pull >/dev/null 2>&1 || true
  local count
  count="$(bd ready --label planned --exclude-label human --exclude-type epic --json 2>/dev/null \
    | jq 'length' 2>/dev/null || echo 0)"
  [ "${count:-0}" -gt 0 ]
}

done_count=0
while [ "$done_count" -lt "$MAX_BEADS" ]; do
  if ! planned_is_waiting; then
    say "nothing planned is ready. Stopping after $done_count bead(s)."
    exit 0
  fi

  say "starting bead $((done_count + 1)) of at most $MAX_BEADS, in a fresh session"

  # A bead that fails does not stop the run: the agent hands it back to the `human` queue itself,
  # and the next iteration takes different work. A crash here would otherwise strand the queue
  # behind one bad bead.
  if ! claude -p "/implement-bead" \
      --permission-mode "$PERMISSION_MODE" \
      --max-turns "$MAX_TURNS"; then
    say "that session exited non-zero. Carrying on; check the bead's state before trusting it."
  fi

  done_count=$((done_count + 1))
done

say "reached MAX_BEADS=$MAX_BEADS. Run again to continue."
