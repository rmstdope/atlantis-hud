//! `ah-7g4f`. This turn's FACTION order sets the faction type and the limits the review shows and
//! checks.
//!
//! Rules each piece rests on:
//! - `rules/faction`: FACTION assigns MARTIAL and MAGIC points; too many mages, apprentices or
//!   quartermasters for the new points make it fail.
//! - `rules/tablefactionpoints`: the limits each points value gives, per world.
//! - `rules/playing_factions`: "The faction has 5 Faction Points" (3 in Trident).
//! - `rules/sequenceofevents`: FACTION runs before TAX, PILLAGE and the month-long orders.

use atlantis_hud_core::movement::rules::{FactionPointsRow, Ruleset};

mod common;
use common::{ruleset, trident_ruleset};

#[test]
fn the_committed_rulesets_carry_their_faction_points() {
    let origins = ruleset().faction_points.expect("New Origins states its table");
    assert_eq!(origins.available, 5);
    assert_eq!(
        origins.table.iter().find(|row| row.points == 3),
        Some(&FactionPointsRow {
            points: 3,
            regions: 40,
            quartermasters: 9,
            mages: 4,
            apprentices: 7,
        })
    );

    let trident = trident_ruleset().faction_points.expect("Trident states its table");
    assert_eq!(trident.available, 3);
    assert_eq!(
        trident.table.iter().map(|row| row.points).collect::<Vec<_>>(),
        vec![1, 2]
    );

    let arcanum = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset loads")
        .faction_points
        .expect("Arcanum states its table");
    let row = arcanum.table.iter().find(|row| row.points == 3).expect("row 3");
    assert_eq!((row.regions, row.quartermasters), (56, 16));
}
