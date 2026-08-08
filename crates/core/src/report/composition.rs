//! Telling a unit's people from its equipment.
//!
//! A report writes both as one list, `50 gnolls [GNOL], 49 orcs [ORC], 58 mithril swords [MSWO]`,
//! with no marker between them, so the split needs an item reference the report does not carry.
//! The scraped catalogue is that reference.
//!
//! This is kept apart from parsing on purpose. Parsing a report must work with no ruleset loaded,
//! and it must stay tolerant; classification is a later, optional pass that sharpens a figure the
//! parser could only estimate.

use std::collections::BTreeSet;

use crate::movement::rules::Ruleset;
use crate::report::model::ReportUnit;
use crate::report::ParsedReport;

/// What classifying a report turned up.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Classification {
    /// Item tags the catalogue did not recognise, sorted and deduplicated.
    ///
    /// Reported rather than passed over: an unrecognised tag means the ruleset and the report have
    /// drifted apart, and the caller should say so rather than quietly count a widget as a man.
    pub unknown_tags: Vec<String>,
}

/// Counts every unit's people against the catalogue.
///
/// Unknown tags are treated as equipment. Guessing the other way would inflate a headcount, and an
/// inflated headcount makes an enemy look stronger and a route look more dangerous than it is.
pub fn classify_units(report: &mut ParsedReport, ruleset: &Ruleset) -> Classification {
    let mut unknown = BTreeSet::new();

    for region in &mut report.regions {
        for unit in &mut region.units {
            classify_unit(unit, ruleset, &mut unknown);
        }
    }

    Classification {
        unknown_tags: unknown.into_iter().collect(),
    }
}

/// Counts one unit's people, but only when the catalogue recognises everything the unit holds.
///
/// A ruleset is scraped from a live page, so drifting away from the report is the expected way
/// this goes wrong. Counting the tags a stale catalogue happens to recognise and then calling the
/// answer exact is worse than not classifying at all: a unit of ninety-nine would report zero men
/// as a fact. So an unrecognised tag leaves the unit exactly as the parser left it, still carrying
/// the parser's estimate and still saying that is what it is.
fn classify_unit(unit: &mut ReportUnit, ruleset: &Ruleset, unknown: &mut BTreeSet<String>) {
    let mut recognises_everything = true;
    for item in &unit.items {
        if !ruleset.items.contains_key(&item.tag) {
            unknown.insert(item.tag.clone());
            recognises_everything = false;
        }
    }

    if !recognises_everything {
        return;
    }

    // Order follows the report's own, so a unit reads the way it was written.
    unit.men_by_race = unit
        .items
        .iter()
        .filter(|item| ruleset.is_man(&item.tag))
        .cloned()
        .collect();
    unit.men = unit.men_by_race.iter().map(|race| race.amount).sum();
    unit.men_estimated = false;
}
