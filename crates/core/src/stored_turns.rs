//! Which stored fields hold a turn number, written once for every store (ah-aguu).
//!
//! A turn number is part of what a game stores - in keys, in sightings, in plans - so a change to
//! what a turn number means is a data move over every one of those fields. ah-m6pw made such a move
//! and had to list the fields three times, once per store, in three languages. The list lives here
//! instead: the browser's IndexedDB upgrade asks for it through core-wasm, and a backup restore
//! uses it directly. A test in `backup.rs` pins it against the backup collections, so a record that
//! gains a turn field fails until this list says how that field moves.
//!
//! The records are handled as `serde_json::Value` under the collections' camelCase names - the
//! names the backup document and the browser's stores both use (ah-bmb3.3) - so a key a store keeps
//! beside the wire fields (`databasePath`, `gameId`) passes through untouched.

use serde_json::Value;

/// Where a stored record names a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnField {
    /// A number at this key of the record.
    Field(&'static str),
    /// A number at `field` of every entry of the list at `list`. `keep_zero` leaves an entry whose
    /// turn is 0 as it is.
    EachEntry {
        list: &'static str,
        field: &'static str,
        keep_zero: bool,
    },
    /// The report header's turn inside the parsed payload, a JSON string at this key - under
    /// `turnHeader.turnNumber`, or `turn_header.turn_number` as payloads before ah-164.1 spell it.
    PayloadHeader(&'static str),
}

/// Every collection whose records name a turn, and where. A collection not listed names none.
///
/// A study goal's turn 0 marks a goal written before goals had turns, which every reader drops, so
/// it is never moved. A cast has no turnless form, so a cast on turn 0 moves like any other.
pub const COLLECTIONS_NAMING_A_TURN: &[(&str, &[TurnField])] = &[
    (
        "importedTurns",
        &[
            TurnField::Field("turnNumber"),
            TurnField::PayloadHeader("parsedPayloadJson"),
        ],
    ),
    ("orderDrafts", &[TurnField::Field("turnNumber")]),
    ("mergedReports", &[TurnField::Field("turnNumber")]),
    ("regionSightings", &[TurnField::Field("lastSeenTurn")]),
    ("hexNotes", &[TurnField::Field("turn")]),
    ("alliedMages", &[TurnField::Field("sheetTurn")]),
    (
        "armies",
        &[TurnField::EachEntry {
            list: "members",
            field: "seenTurn",
            keep_zero: false,
        }],
    ),
    (
        "studyPlans",
        &[
            TurnField::EachEntry {
                list: "goals",
                field: "turn",
                keep_zero: true,
            },
            TurnField::EachEntry {
                list: "casts",
                field: "turn",
                keep_zero: false,
            },
        ],
    ),
];

/// Where `collection`'s records name a turn; empty for a collection that names none.
pub fn turn_fields(collection: &str) -> &'static [TurnField] {
    COLLECTIONS_NAMING_A_TURN
        .iter()
        .find(|(name, _)| *name == collection)
        .map_or(&[], |(_, fields)| fields)
}

fn later(value: &mut Value, keep_zero: bool) {
    if let Some(turn) = value.as_u64() {
        if !(keep_zero && turn == 0) {
            *value = Value::from(turn.saturating_add(1));
        }
    }
}

fn payload_later(payload: &mut Value) {
    let Some(text) = payload.as_str() else {
        return;
    };
    // Through the typed result first, so the payload comes back in the shape an import writes: a
    // re-import compares payloads as text (`diff_imported_turn`), and re-ordered keys would read
    // as a changed parse.
    if let Ok(mut parsed) = serde_json::from_str::<crate::ReportParseResult>(text) {
        if let Some(header) = parsed.turn_header.as_mut() {
            header.turn_number = header.turn_number.saturating_add(1);
            if let Ok(json) = serde_json::to_string(&parsed) {
                *payload = Value::String(json);
                return;
            }
        }
    }
    // Otherwise as plain JSON, under either spelling. A payload that does not read at all is left
    // alone: it is only ever consulted for its season and to compare against a re-import.
    let Ok(mut parsed) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let mut moved = false;
    for (header, turn) in [("turnHeader", "turnNumber"), ("turn_header", "turn_number")] {
        if let Some(value) = parsed.get_mut(header).and_then(|h| h.get_mut(turn)) {
            later(value, false);
            moved = true;
        }
    }
    if moved {
        *payload = Value::String(parsed.to_string());
    }
}

/// Moves every turn one record of `collection` names up by one - the move from the count that
/// called February of Year 1 turn 1 to the engine's (ah-m6pw). A field the record lacks, or holds
/// as something other than a number, is left as it is.
pub fn move_record_to_engine_turns(collection: &str, record: &mut Value) {
    for field in turn_fields(collection) {
        match *field {
            TurnField::Field(key) => {
                if let Some(value) = record.get_mut(key) {
                    later(value, false);
                }
            }
            TurnField::EachEntry {
                list,
                field,
                keep_zero,
            } => {
                if let Some(entries) = record.get_mut(list).and_then(Value::as_array_mut) {
                    for value in entries.iter_mut().filter_map(|entry| entry.get_mut(field)) {
                        later(value, keep_zero);
                    }
                }
            }
            TurnField::PayloadHeader(key) => {
                if let Some(payload) = record.get_mut(key) {
                    payload_later(payload);
                }
            }
        }
    }
}

/// [`move_record_to_engine_turns`] over every collection array `document` holds under its
/// collection's name - a backup document, whose collections sit at its top level.
pub fn move_collections_to_engine_turns(document: &mut Value) {
    for (collection, _) in COLLECTIONS_NAMING_A_TURN {
        if let Some(records) = document.get_mut(*collection).and_then(Value::as_array_mut) {
            for record in records {
                move_record_to_engine_turns(collection, record);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn moved(collection: &str, mut record: Value) -> Value {
        move_record_to_engine_turns(collection, &mut record);
        record
    }

    #[test]
    fn an_imported_turn_moves_its_key_and_the_turn_its_payload_names() {
        let record = moved(
            "importedTurns",
            json!({
                "factionId": "95",
                "turnNumber": 71,
                "parsedPayloadJson": r#"{"turnHeader":{"turnNumber":71,"season":"December"},"regions":[]}"#,
                "warningsPayloadJson": "[]"
            }),
        );

        assert_eq!(record["turnNumber"], 72);
        let payload: Value =
            serde_json::from_str(record["parsedPayloadJson"].as_str().unwrap()).unwrap();
        assert_eq!(
            payload,
            json!({"turnHeader": {"turnNumber": 72, "season": "December"}, "regions": []})
        );
        assert_eq!(record["warningsPayloadJson"], "[]");
    }

    /// A re-import compares payloads as text (`diff_imported_turn`), so a payload that reads is
    /// written back in the shape an import writes, not with its keys re-ordered.
    #[test]
    fn a_payload_that_reads_comes_back_as_an_import_writes_it() {
        let mut parsed = crate::parse_report("Atlantis Report For:\nFoo (1)\nDecember, Year 6\n");
        parsed
            .turn_header
            .as_mut()
            .expect("a dated report")
            .turn_number = 71;
        let mut expected = parsed.clone();
        expected
            .turn_header
            .as_mut()
            .expect("a dated report")
            .turn_number = 72;

        let record = moved(
            "importedTurns",
            json!({"turnNumber": 71, "parsedPayloadJson": serde_json::to_string(&parsed).unwrap()}),
        );

        assert_eq!(
            record["parsedPayloadJson"],
            serde_json::to_string(&expected).unwrap()
        );
    }

    #[test]
    fn a_payload_from_before_camel_case_moves_under_its_own_spelling() {
        let record = moved(
            "importedTurns",
            json!({
                "turnNumber": 2,
                "parsedPayloadJson": r#"{"turn_header":{"turn_number":2,"season":"March"}}"#
            }),
        );

        let payload: Value =
            serde_json::from_str(record["parsedPayloadJson"].as_str().unwrap()).unwrap();
        assert_eq!(
            payload,
            json!({"turn_header": {"turn_number": 3, "season": "March"}})
        );
    }

    #[test]
    fn a_payload_that_does_not_read_is_left_as_it_was() {
        let record = moved(
            "importedTurns",
            json!({"turnNumber": 2, "parsedPayloadJson": "not json"}),
        );

        assert_eq!(record["parsedPayloadJson"], "not json");
        assert_eq!(record["turnNumber"], 3);
    }

    #[test]
    fn every_other_collection_moves_its_turn() {
        assert_eq!(
            moved("orderDrafts", json!({"turnNumber": 71}))["turnNumber"],
            72
        );
        assert_eq!(
            moved("mergedReports", json!({"turnNumber": 71}))["turnNumber"],
            72
        );
        assert_eq!(
            moved("regionSightings", json!({"lastSeenTurn": 68}))["lastSeenTurn"],
            69
        );
        assert_eq!(moved("hexNotes", json!({"turn": 69}))["turn"], 70);
        assert_eq!(
            moved("alliedMages", json!({"sheetTurn": 23}))["sheetTurn"],
            24
        );
        assert_eq!(
            moved(
                "armies",
                json!({"id": "a1", "members": [{"unitId": "1", "seenTurn": 66}, {"unitId": "2", "seenTurn": 67}]})
            )["members"],
            json!([{"unitId": "1", "seenTurn": 67}, {"unitId": "2", "seenTurn": 68}])
        );
    }

    #[test]
    fn a_goal_on_turn_zero_stays_and_a_cast_on_turn_zero_moves() {
        let plan = moved(
            "studyPlans",
            json!({
                "factionId": "21",
                "unitId": "9001",
                "goals": [
                    {"kind": "study", "turn": 0, "skill": "FORC"},
                    {"kind": "teach", "turn": 24, "students": [], "live": true}
                ],
                "casts": [{"turn": 0, "spell": "FARS"}, {"turn": 24, "spell": "FIRE"}]
            }),
        );

        assert_eq!(
            plan["goals"],
            json!([
                {"kind": "study", "turn": 0, "skill": "FORC"},
                {"kind": "teach", "turn": 25, "students": [], "live": true}
            ])
        );
        assert_eq!(
            plan["casts"],
            json!([{"turn": 1, "spell": "FARS"}, {"turn": 25, "spell": "FIRE"}])
        );
    }

    #[test]
    fn keys_a_store_keeps_beside_the_wire_fields_pass_through() {
        let record = moved(
            "orderDrafts",
            json!({"databasePath": "idb://game-g7", "gameId": "g7", "turnNumber": 5, "orderText": "x"}),
        );

        assert_eq!(
            record,
            json!({"databasePath": "idb://game-g7", "gameId": "g7", "turnNumber": 6, "orderText": "x"})
        );
    }

    #[test]
    fn a_collection_that_names_no_turn_is_left_as_it_was() {
        let record = json!({"gameId": "g7", "turnNumber": 5});

        assert_eq!(moved("games", record.clone()), record);
        assert!(turn_fields("games").is_empty());
    }

    #[test]
    fn a_document_moves_every_collection_it_holds() {
        let mut document = json!({
            "format": "atlantis-hud-game-backup",
            "version": 1,
            "orderDrafts": [{"turnNumber": 1}, {"turnNumber": 2}],
            "hexNotes": [{"turn": 9}]
        });

        move_collections_to_engine_turns(&mut document);

        assert_eq!(
            document["orderDrafts"],
            json!([{"turnNumber": 2}, {"turnNumber": 3}])
        );
        assert_eq!(document["hexNotes"], json!([{"turn": 10}]));
        assert_eq!(document["version"], 1);
    }
}
