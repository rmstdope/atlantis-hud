# ah-rx0r.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-05
- **PR:** #963

## `implement-bead`'s `model-for` line fails as written under zsh

**What happened.** The review section of `implement-bead` gives this to resolve the reviewer's model,
and insists the provider be passed:

```bash
provider="$(.claude/cerebro/scripts/agent-cli)" || provider=""
.claude/cerebro/scripts/model-for ${provider:+--provider "$provider"} --role reviewer
```

Run verbatim it printed `usage: model-for [--provider <p>] [--name <n>] [--role <r>]` and exited 2.

**Why.** Established. Sessions here run zsh (`$ZSH_VERSION` 5.9), which does **not** word-split an
unquoted parameter expansion the way bash does, so `${provider:+--provider "$provider"}` reaches the
script as the single argument `--provider claude` rather than as two. Reproduced both ways:
`model-for --provider claude --role reviewer` prints `default@claude opus medium` and exits 0;
`provider=claude; model-for ${provider:+--provider "$provider"} --role reviewer` prints the usage
line and exits 2.

**Cost.** Small — one extra command and about a minute. The reason to record it anyway is the
*direction* of the failure: the skill says passing the provider is what stops a consumer with a
`reviewer@<provider>` row silently matching the plain key instead, and this line makes the provider
never arrive. Here the answer happened to be the same either way; on a consumer that carries a
per-provider row it would not be, and nothing in the output says the provider was dropped.

**Prevent by.** The skill's *The review loop* should give a line that works in zsh as well as bash —
`${provider:+--provider} ${provider}` with two separate expansions, or an explicit `if`. Changing the
skill is the navigator's, not an implementer's, which is why this is recorded rather than fixed.

**Seen before.** None found — `grep -rl "zsh\|model-for" docs/retrospectives/` matches nothing.
