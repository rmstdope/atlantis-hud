//! The AtlaClient sighting cap, written once for every store (ah-vtgk, ah-4pbr).
//!
//! Before ah-m6pw an AtlaClient map's stamps were already the engine's turns while HUD numbered its
//! own one lower, so a hex merged from one was stored a turn too new, and the move to the engine's
//! count ([`crate::stored_turns`]) keeps that difference. Nothing records which sighting came from
//! AtlaClient, so the repair is the bound that always holds: no sighting of a faction holding an
//! AtlaClient merge is newer than that faction's newest imported turn.
//!
//! The browser's IndexedDB upgrade asks for it through core-wasm, one sighting at a time, and a
//! version-1 backup's restore applies it to the whole document. Migration 16
//! (`crates/core-persistence/migrations/0016_cap_atlaclient_sightings.sql`) makes the same repair to
//! a stored desktop game in SQL, since a migration cannot call the core row by row.
//!
//! Records are `serde_json::Value`s under the collections' camelCase names, as in
//! [`crate::stored_turns`].

use std::collections::BTreeMap;

use serde_json::Value;

/// The newest imported turn of every faction holding an AtlaClient merge, by faction id.
pub type AtlaClientCaps = BTreeMap<String, u64>;

/// The cap of every faction among `merged_reports` (records of the `mergedReports` collection)
/// holding an AtlaClient merge, read from `imported_turns` as `(factionId, turnNumber)`.
pub fn atlaclient_caps<'a>(
    merged_reports: impl IntoIterator<Item = &'a Value>,
    imported_turns: impl IntoIterator<Item = (&'a str, u64)>,
) -> AtlaClientCaps {
    let merged: std::collections::BTreeSet<&str> = merged_reports
        .into_iter()
        .filter(|merge| {
            merge.get("mergedFactionId").and_then(Value::as_str)
                == Some(crate::report::atlaclient::ATLACLIENT_SOURCE_ID)
        })
        .filter_map(|merge| merge.get("factionId").and_then(Value::as_str))
        .collect();
    let mut caps = AtlaClientCaps::new();
    for (faction_id, turn_number) in imported_turns {
        if merged.contains(faction_id) {
            let cap = caps.entry(faction_id.to_string()).or_insert(turn_number);
            *cap = (*cap).max(turn_number);
        }
    }
    caps
}

/// Brings a `regionSightings` record's `lastSeenTurn` down to its faction's cap. Returns whether
/// it changed; a record with no cap, at or under it, or without the fields, is left as it is.
pub fn cap_atlaclient_sighting(caps: &AtlaClientCaps, sighting: &mut Value) -> bool {
    let Some(&cap) = sighting
        .get("factionId")
        .and_then(Value::as_str)
        .and_then(|faction_id| caps.get(faction_id))
    else {
        return false;
    };
    match sighting.get_mut("lastSeenTurn") {
        Some(turn) if turn.as_u64().is_some_and(|seen| seen > cap) => {
            *turn = Value::from(cap);
            true
        }
        _ => false,
    }
}

/// [`atlaclient_caps`] and [`cap_atlaclient_sighting`] over a backup document, whose collections
/// sit at its top level.
pub fn cap_atlaclient_sightings(document: &mut Value) {
    let records = |collection: &str| {
        document
            .get(collection)
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice)
    };
    let caps = atlaclient_caps(
        records("mergedReports"),
        records("importedTurns").iter().filter_map(|turn| {
            Some((
                turn.get("factionId")?.as_str()?,
                turn.get("turnNumber")?.as_u64()?,
            ))
        }),
    );
    if let Some(sightings) = document
        .get_mut("regionSightings")
        .and_then(Value::as_array_mut)
    {
        for sighting in sightings {
            cap_atlaclient_sighting(&caps, sighting);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn merges() -> Vec<Value> {
        vec![
            json!({"factionId": "95", "turnNumber": 72, "mergedFactionId": "atlaclient"}),
            json!({"factionId": "73", "turnNumber": 72, "mergedFactionId": "21"}),
        ]
    }

    fn caps() -> AtlaClientCaps {
        atlaclient_caps(&merges(), [("95", 71), ("95", 72), ("73", 72)])
    }

    #[test]
    fn only_a_faction_holding_an_atlaclient_merge_is_capped_at_its_newest_turn() {
        assert_eq!(caps(), AtlaClientCaps::from([("95".to_string(), 72)]));
    }

    #[test]
    fn a_sighting_above_the_cap_comes_down_to_it() {
        let mut sighting = json!({"factionId": "95", "regionId": "1:1,1", "lastSeenTurn": 73});

        assert!(cap_atlaclient_sighting(&caps(), &mut sighting));
        assert_eq!(
            sighting,
            json!({"factionId": "95", "regionId": "1:1,1", "lastSeenTurn": 72})
        );
    }

    #[test]
    fn a_sighting_at_or_below_the_cap_and_another_factions_are_left_as_they_were() {
        for original in [
            json!({"factionId": "95", "regionId": "1:2,2", "lastSeenTurn": 72}),
            json!({"factionId": "95", "regionId": "1:3,3", "lastSeenTurn": 70}),
            json!({"factionId": "73", "regionId": "1:1,1", "lastSeenTurn": 73}),
        ] {
            let mut sighting = original.clone();
            assert!(!cap_atlaclient_sighting(&caps(), &mut sighting));
            assert_eq!(sighting, original);
        }
    }

    #[test]
    fn a_record_without_the_fields_is_left_alone() {
        for original in [
            json!({"regionId": "1:1,1", "lastSeenTurn": 73}),
            json!({"factionId": "95", "regionId": "1:1,1"}),
            json!({"factionId": "95", "lastSeenTurn": "73"}),
        ] {
            let mut sighting = original.clone();
            assert!(!cap_atlaclient_sighting(&caps(), &mut sighting));
            assert_eq!(sighting, original);
        }
    }

    #[test]
    fn a_document_caps_its_sightings_from_its_own_merges_and_turns() {
        let mut document = json!({
            "format": "atlantis-hud-game-backup",
            "importedTurns": [
                {"factionId": "95", "turnNumber": 71},
                {"factionId": "95", "turnNumber": 72},
                {"factionId": "73", "turnNumber": 72}
            ],
            "mergedReports": merges(),
            "regionSightings": [
                {"factionId": "95", "regionId": "1:1,1", "lastSeenTurn": 73},
                {"factionId": "73", "regionId": "1:1,1", "lastSeenTurn": 73}
            ]
        });

        cap_atlaclient_sightings(&mut document);

        assert_eq!(
            document["regionSightings"],
            json!([
                {"factionId": "95", "regionId": "1:1,1", "lastSeenTurn": 72},
                {"factionId": "73", "regionId": "1:1,1", "lastSeenTurn": 73}
            ])
        );
    }
}
