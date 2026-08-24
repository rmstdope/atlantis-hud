# ah-nmts — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #657

## The plan named a back-fill site that cannot carry a structure

**What happened.** The plan's increment 2 was specific: back-fill old snapshots in
`hydrate_parse_result_state` (`crates/core-wasm/src/lib.rs:229`), because `ReportParseResult` is
stored as `parsedPayloadJson` and read back by deserialisation. It even repeated that as a *Known
trap* about `kind` not changing meaning. But `ReportParseResult.regions` is
`Vec<RegionSummary>` — a `region_id` and a `name`, nothing else (`crates/core/src/lib.rs:195`), so
no structure ever passes through that function. Writing the back-fill where the plan said would have
compiled, passed its tests and back-filled nothing.

The real path is the remembered-region payload: stored as the region's own JSON and handed to each
shell as raw JSON at exactly one place each —
`webCoreAdapter.loadRegionSightings` and `command_load_region_sightings`. The back-fill went there
instead, and works on `serde_json::Value` rather than on `ReportRegion`, which also keeps the
existing decision in `sighting_from_payload` not to round-trip a stored payload through a struct.

**Why.** Established. Both `ReportParseResult` and `ReportRegion` are "the parse result", and the
plan's author reasoned from the name. `parsedPayloadJson` is a real stored blob and `hydrate_parse_result_state`
is a real hydrator; the only thing wrong is that structures are not in it.

**Cost.** About 20 minutes: writing the typed `backfill_structure_kinds(&mut [ReportRegion])` with
two tests, finding it unreachable while wiring it up, then rewriting it and its tests against the
JSON payload and adding a wasm entry point the plan had not anticipated.

**Prevent by.** When a plan names a persistence site, it should name the **field** the data is read
back from and not only the function — here, `RememberedRegionDto.region` rather than
"`hydrate_parse_result_state`". A planner can check that in one command
(`grep -n "structures" crates/core/src/lib.rs`), and an implementer who is handed the field name
cannot wire the back-fill into the wrong funnel.

**Seen before.** None found.
