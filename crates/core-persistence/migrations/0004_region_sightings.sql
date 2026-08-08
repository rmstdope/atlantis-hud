-- Regions become queryable rows rather than living only inside an imported turn's JSON payload.
--
-- The map needs to distinguish a region seen in the current report from one held over from an
-- earlier turn, so each row records the turn it was last seen in. Without this, staleness cannot be
-- computed at all: the store would only know about the latest import.
CREATE TABLE IF NOT EXISTS region_sightings (
    project_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    z INTEGER NOT NULL,
    terrain TEXT NOT NULL,
    province TEXT NOT NULL,
    label TEXT NOT NULL,
    last_seen_turn INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (project_id, faction_id, region_id)
);

CREATE INDEX IF NOT EXISTS region_sightings_last_seen_idx
    ON region_sightings (project_id, faction_id, last_seen_turn);
