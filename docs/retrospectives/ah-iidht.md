# ah-iidht — a runner image change turned a required check red mid-bead

## What happened

PR #1891 was reviewed and every required check was green at a4548e2e except `native`, which failed
in `apt` before any test ran: `ubuntu-latest` had moved to Ubuntu 26.04, where the
`webkit2gtk-driver` package no longer exists (run 41154038392). Nothing in the diff touched CI.

## Why

The native job pinned `runs-on: ubuntu-latest` and installed a package by a name that is
distribution-specific, so a runner image rollout broke it for every open PR at once.

## Cost

The bead parked for the navigator, a separate P0 bead (ah-0f0b0) to move the job to 26.04, and a
second session to catch the PR up, re-run CI and merge.

## Prevent by

`.github/workflows/ci.yml`, the native job: pin the runner to a named image (`ubuntu-26.04`)
rather than `ubuntu-latest`, so an image change arrives as a deliberate bump rather than a red
check on unrelated PRs.

## Seen before

Nothing like it in docs/retrospectives/.
