CREATE TABLE IF NOT EXISTS imported_turns (
    project_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    raw_report TEXT NOT NULL,
    parsed_payload_json TEXT NOT NULL,
    warnings_payload_json TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, faction_id, turn_number)
);

CREATE INDEX IF NOT EXISTS imported_turns_project_turn_idx
    ON imported_turns (project_id, turn_number);
