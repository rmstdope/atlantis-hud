-- ah-vtgk: a hex merged from an AtlaClient map before ah-m6pw was stored one turn too new.
--
-- AtlaClient stamps a hex with the engine's turn number, while HUD numbered its own turns one lower
-- until ah-m6pw. Migration 15 moved every stored turn up by one, which kept that difference: a hex
-- AtlaClient saw on the newest turn now reads as seen one turn after the newest imported report,
-- and a map export drops its 'N turns before' distance. Nothing records which sighting came from
-- AtlaClient, so the repair is the one bound that is always true: no sighting of a faction holding
-- an AtlaClient merge is newer than that faction's newest imported turn.
--
-- Run once, as a migration, so a map merged after this upgrade is never touched by it.
UPDATE region_sightings
   SET last_seen_turn = (
           SELECT MAX(turn.turn_number)
             FROM imported_turns AS turn
            WHERE turn.game_id = region_sightings.game_id
              AND turn.faction_id = region_sightings.faction_id)
 WHERE EXISTS (
           SELECT 1
             FROM merged_reports AS merge
            WHERE merge.game_id = region_sightings.game_id
              AND merge.faction_id = region_sightings.faction_id
              AND merge.merged_faction_id = 'atlaclient')
   AND last_seen_turn > (
           SELECT MAX(turn.turn_number)
             FROM imported_turns AS turn
            WHERE turn.game_id = region_sightings.game_id
              AND turn.faction_id = region_sightings.faction_id);
