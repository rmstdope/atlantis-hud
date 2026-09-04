CREATE TABLE IF NOT EXISTS study_plans (
    game_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    skill TEXT,
    target_level INTEGER,
    comment TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (game_id, faction_id, unit_id)
);
