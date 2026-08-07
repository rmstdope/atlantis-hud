CREATE TABLE IF NOT EXISTS order_drafts (
    project_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    order_text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, faction_id, turn_number)
);

CREATE INDEX IF NOT EXISTS order_drafts_project_turn_idx
    ON order_drafts (project_id, turn_number);
