//! What this turn's own orders claim about where an inner passage comes out.
//!
//! No report names the far side of a passage: `Structure` carries no destination, the catalogue
//! says only that "Units may enter this structure" (`data/objects`, Shaft), and a report narrates
//! no movement. The one honest source is the faction's own history - a unit our orders sent
//! through a passage in one turn, found somewhere else in the next - and this module reads the
//! first half of that pair.

use serde::{Deserialize, Serialize};

use crate::movement::fleet::OrderedUnits;
use crate::movement::orders::first_passage;
use crate::movement::orders::MoveStep;
use crate::report::level::NEXUS;
use crate::report::model::{numbered_structure_label, Coordinate};
use crate::report::ParsedReport;

/// A unit our own orders sent through an inner passage, and where it stood when it went.
///
/// A *claim*, not a fact: it says a crossing was ordered, and only the next turn's report can say
/// where the unit came out. Resolving one is the screen's job, in `passageMemory.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "PassageClaim.ts"))]
pub struct PassageClaim {
    /// The unit that was ordered through. Unit numbers are stable within a game, which is what
    /// makes it findable in the next turn's report.
    pub unit_id: String,
    /// The hex the unit was standing in when the passage was ordered - always the hex the report
    /// found it in, because a claim is only made when nothing moved the unit first.
    pub entry: Coordinate,
    /// The structure's number as the report writes it, which is unique only within its own hex.
    pub structure_id: String,
    /// The structure as a sentence points at one: `Shaft [3]`.
    pub structure: String,
}

/// Every crossing this turn's orders claim, read conservatively.
///
/// A claim is made only when all of this holds, so that the next turn's report can be read as the
/// answer and nothing else:
///
/// - the unit is the reporting faction's own (`ReportUnit::own`);
/// - it wrote no `SAIL` - a passenger moves with its hull, and an `IN` beside a `SAIL` is an order
///   whose outcome nothing here can attribute;
/// - [`first_passage`] finds a passage, and the structure it names is one the report shows in the
///   unit's own hex;
/// - nothing before the passage moved the unit out of that hex: `steps[..before]` holds no
///   [`MoveStep::Go`], so `ENTER`/`OUT` before the `IN` are fine and a direction is not;
/// - nothing after the passage would place it anywhere: `steps_after == 0`;
/// - the hex is not on the nexus level, because `rules/world_nexus` says the region a portal lands
///   in "is somewhat random" and a second crossing would land elsewhere.
///
/// Pure, and reads no map: every fact it needs is in the report and the orders document.
#[must_use]
pub fn passage_claims(report: &ParsedReport, ordered: &OrderedUnits) -> Vec<PassageClaim> {
    let mut claims = Vec::new();

    for region in &report.regions {
        if region.coordinate.z == NEXUS {
            continue;
        }

        for unit in region.units.iter().filter(|unit| unit.own) {
            if ordered.issues_sail(&unit.unit_id) {
                continue;
            }
            let Some(steps) = ordered.steps_for(&unit.unit_id) else {
                continue;
            };
            let Some(passage) = first_passage(ordered.structure_of(unit), steps) else {
                continue;
            };
            if passage.steps_after != 0 {
                continue;
            }
            if steps[..passage.before]
                .iter()
                .any(|step| matches!(step, MoveStep::Go(_)))
            {
                continue;
            }
            let Some(structure_id) = passage.structure_id else {
                continue;
            };
            let Some(structure) = region
                .structures
                .iter()
                .find(|structure| structure.structure_id == structure_id)
            else {
                continue;
            };

            claims.push(PassageClaim {
                unit_id: unit.unit_id.clone(),
                entry: region.coordinate,
                structure_id,
                structure: numbered_structure_label(structure),
            });
        }
    }

    claims
}
