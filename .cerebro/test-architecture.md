# Test architecture

Agreed with the navigator 2026-10-24.

## Rust unit       crates/*/src, #[cfg(test)]
  Belongs here:    one core decision: parsing a report line, checking one order, a movement cost, a rules lookup
  Not here:        files, the database, wasm or Tauri, a whole turn's situation
  Enough is:       every branch of a decision once

## Core scenarios  crates/core/tests/*.rs
  Belongs here:    one game situation taken from a report through the core's public API (orders preview, checks), citing the rule it rests on
  Not here:        a single decision's branches, wasm or Tauri, anything the player sees
  Enough is:       each rule interaction once

## Client unit     packages/*/src/**/*.test.ts(x) (not *.wasm.test.ts), apps/*/src/**/*.test.ts(x)
  Belongs here:    client decisions: view models, layout arithmetic, what a component renders for given props (renderToStaticMarkup, no DOM)
  Not here:        the real core, a browser, storage, timers, focus, pointer or scroll
  Enough is:       every branch of a decision once

## Core boundary   packages/browser-core/src/*.wasm.test.ts, tests/native/binding.spec.ts
  Belongs here:    a core command's arguments and answer crossing wasm or Tauri IPC; a storage round trip
  Not here:        rule logic, what a component draws
  Enough is:       every command once per boundary

## Tooling         scripts/**/*.test.ts
  Belongs here:    the repository's own scripts: gate, release, fleet, rules lookup
  Not here:        anything the application does
  Enough is:       every branch of a script's decision once

## Browser interaction  tests/smoke/*.spec.ts (any test no requirement names)
  Belongs here:    what needs a real DOM: focus, keyboard, pointer, drag, scroll, what fits on screen
  Not here:        a decision a pure function already makes (rules, arithmetic), re-asserting a unit test's cases
  Enough is:       each interaction once, in one shell unless the shells differ

## System          tests/smoke/*.spec.ts, tests/pwa/*.spec.ts, tests/native/workspace.spec.ts
  Belongs here:    one requirement each, walked through the built app, named by its number (R<n>)
  Not here:        a script's own refusals, a rule's edge cases, layout arithmetic
  Enough is:       every requirement once, in each shell where it differs
