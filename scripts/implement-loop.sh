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
#     scripts/implement-loop.sh alpha             # until the planned queue is dry
#     MAX_BEADS=3 scripts/implement-loop.sh beta  # or until three have been done
#
# The name is required. Every session this starts runs with Remote Control enabled under that name,
# so a loop can be found and driven from elsewhere - a phone, another machine - and so two loops on
# one machine are told apart by something a human chose rather than by a session hash. There is no
# sensible default: an unnamed session is exactly the one nobody can find later.
#
# The name is reused for every bead rather than suffixed with a counter. A finished `claude -p`
# session leaves the peer list when it exits (measured), so at any moment the loop has exactly one
# session listed, and "connect to alpha" always reaches the bead being worked on now.
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

usage() {
  cat >&2 <<'USAGE'
usage: scripts/implement-loop.sh <name>

  <name>  what to call this loop's sessions under Remote Control, e.g. alpha.
          Required, and it must not be empty.

  MAX_BEADS=3 PERMISSION_MODE=acceptEdits MAX_TURNS=400 scripts/implement-loop.sh alpha
USAGE
  exit 2
}

[ "$#" -eq 1 ] || usage
SESSION_NAME="$1"
[ -n "${SESSION_NAME//[[:space:]]/}" ] || usage

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

  say "starting bead $((done_count + 1)) of at most $MAX_BEADS, in a fresh session named $SESSION_NAME"

  # `--remote-control` takes the name and is what puts the session in the peer list; `--name` is the
  # local half of the same idea - the prompt box, the /resume picker and the terminal title - so the
  # window running this loop says which loop it is. Both, because they are read in different places.
  #
  # A bead that fails does not stop the run: the agent hands it back to the `human` queue itself,
  # and the next iteration takes different work. A crash here would otherwise strand the queue
  # behind one bad bead.
  if ! claude -p "/implement-bead" \
      --remote-control "$SESSION_NAME" \
      --name "$SESSION_NAME" \
      --permission-mode "$PERMISSION_MODE" \
      --max-turns "$MAX_TURNS"; then
    say "that session exited non-zero. Carrying on; check the bead's state before trusting it."
  fi

  done_count=$((done_count + 1))
done

say "reached MAX_BEADS=$MAX_BEADS. Run again to continue."
