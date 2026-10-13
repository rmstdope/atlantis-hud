-- ah-m6pw: turn numbers move to the engine's count, one higher than before.
--
-- `turn_number_for` used to call February of Year 1 turn 1; the engine's `Game::TurnNumber`
-- (game.cpp) is `(year - 1) * 12 + month + 1` with January as month 0, so January of Year 1 is
-- turn 1 and every turn this game stored is one low. Every stored turn moves up by one, in every
-- table and in every JSON column that names one, so a report imported after this upgrade lands on
-- the same key as the copy imported before it. A uniform shift also keeps every comparison the
-- stored data already made - which sighting is newer, how stale a hex is - exactly as it was.
--
-- The JSON1 functions are part of the SQLite rusqlite bundles (built in since 3.38); the
-- persistence tests run this migration against that same build.

-- Turn numbers sit in three primary keys, and SQLite checks a key row by row, so a plain `+ 1`
-- collides whenever turns N and N + 1 are both stored. Negating first parks every row on a key no
-- real turn uses, and the second pass brings them back one higher.
UPDATE imported_turns SET turn_number = -(turn_number + 1);
UPDATE imported_turns SET turn_number = -turn_number;
UPDATE order_drafts SET turn_number = -(turn_number + 1);
UPDATE order_drafts SET turn_number = -turn_number;
UPDATE merged_reports SET turn_number = -(turn_number + 1);
UPDATE merged_reports SET turn_number = -turn_number;

UPDATE region_sightings SET last_seen_turn = last_seen_turn + 1;
UPDATE hex_notes SET turn = turn + 1;
UPDATE allied_mages SET sheet_turn = sheet_turn + 1;

-- The parsed payload carries the header's turn too, under the camelCase name since ah-164.1 and
-- the snake_case one before it.
UPDATE imported_turns
   SET parsed_payload_json = json_set(
           parsed_payload_json,
           '$.turnHeader.turnNumber',
           json_extract(parsed_payload_json, '$.turnHeader.turnNumber') + 1)
 WHERE json_valid(parsed_payload_json)
   AND json_type(parsed_payload_json, '$.turnHeader.turnNumber') = 'integer';
UPDATE imported_turns
   SET parsed_payload_json = json_set(
           parsed_payload_json,
           '$.turn_header.turn_number',
           json_extract(parsed_payload_json, '$.turn_header.turn_number') + 1)
 WHERE json_valid(parsed_payload_json)
   AND json_type(parsed_payload_json, '$.turn_header.turn_number') = 'integer';

-- An army member remembers the turn of the report that last showed it.
UPDATE armies
   SET members_json = (
           SELECT json_group_array(
                      CASE WHEN json_type(member.value, '$.seenTurn') = 'integer'
                           THEN json_set(member.value, '$.seenTurn',
                                         json_extract(member.value, '$.seenTurn') + 1)
                           ELSE json(member.value) END)
             FROM (SELECT value FROM json_each(armies.members_json) ORDER BY key) AS member)
 WHERE json_valid(members_json) AND json_type(members_json) = 'array';

-- A planned goal or cast names its turn. A goal's turn 0 marks a goal written before goals had
-- turns, which every reader drops, so it stays 0 - a real January of Year 1 goal is indistinguishable
-- from it and was already dropped. A cast has no turnless form, so every cast moves.
UPDATE study_plans
   SET goals_json = (
           SELECT json_group_array(
                      CASE WHEN json_type(goal.value, '$.turn') = 'integer'
                                AND json_extract(goal.value, '$.turn') > 0
                           THEN json_set(goal.value, '$.turn',
                                         json_extract(goal.value, '$.turn') + 1)
                           ELSE json(goal.value) END)
             FROM (SELECT value FROM json_each(study_plans.goals_json) ORDER BY key) AS goal)
 WHERE json_valid(goals_json) AND json_type(goals_json) = 'array';
UPDATE study_plans
   SET casts_json = (
           SELECT json_group_array(
                      CASE WHEN json_type(planned.value, '$.turn') = 'integer'
                           THEN json_set(planned.value, '$.turn',
                                         json_extract(planned.value, '$.turn') + 1)
                           ELSE json(planned.value) END)
             FROM (SELECT value FROM json_each(study_plans.casts_json) ORDER BY key) AS planned)
 WHERE json_valid(casts_json) AND json_type(casts_json) = 'array';
