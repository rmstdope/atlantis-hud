//! Resolving an order's item argument to a canonical tag.
//!
//! One function, because three of them disagreed: the units-table preview searched a holder's
//! inventory, the transfer walk searched the catalogue, and the ledger searched both - so a legal
//! spelling of a legal order moved men in one column of a row and not another (`ah-vcp8.1`).

use crate::movement::rules::{item_spellings, Ruleset};
use crate::report::model::ItemAmount;

/// The canonical, upper-cased tag an order's item argument names.
///
/// Searches the catalogue and every item list the caller can see, **spelling-major**: each
/// spelling [`item_spellings`] offers is tried against the catalogue and then against everything
/// `seen` yields, and only when none of them answers is the next spelling tried. That order is
/// `item_spellings`' own requirement - an entry whose name ends in `s` must not be beaten by
/// another entry matching its stripped form - and honouring it in one place is the whole point of
/// this function.
///
/// The catalogue answers first within a spelling, because its tag is the canonical one; a report's
/// inventory carries the same tags, so where both answer they answer the same thing. An item the
/// catalogue does not carry is still found in a holding, which is how an advanced item nobody has
/// scraped still resolves.
///
/// `seen` is a closure rather than a slice because each caller has a different shape of thing to
/// walk - one unit's list, a `BTreeMap`'s values, or a chain across a hex - and it is called once
/// per spelling, at most three times.
///
/// `None` where nothing answers, and for an empty argument.
#[must_use]
pub fn item_named<'a, I: Iterator<Item = &'a ItemAmount>>(
    ruleset: Option<&Ruleset>,
    text: &str,
    seen: impl Fn() -> I,
) -> Option<String> {
    let written = text.replace('_', " ");
    // Bound to a local so the borrowed `written` outlives the search, as [`Ruleset::find_item`]
    // does for the same reason.
    let found = item_spellings(&written)
        .into_iter()
        .flatten()
        .find_map(|spelling| {
            ruleset
                .and_then(|ruleset| ruleset.item_spelled(spelling))
                .map(|entry| entry.tag.clone())
                .or_else(|| {
                    seen()
                        .find(|item| {
                            item.tag.eq_ignore_ascii_case(spelling)
                                || item.name.eq_ignore_ascii_case(spelling)
                        })
                        .map(|item| item.tag.clone())
                })
        })
        .map(|tag| tag.to_ascii_uppercase());
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed ruleset, for the lookups that read the real catalogue.
    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    /// One holder's item list, written as the report shows it: an amount, the printed name and the
    /// tag in brackets.
    fn held(items: &[(i64, &str, &str)]) -> Vec<ItemAmount> {
        items
            .iter()
            .map(|(amount, name, tag)| ItemAmount {
                amount: *amount,
                name: (*name).to_string(),
                tag: (*tag).to_string(),
            })
            .collect()
    }

    /// The catalogue's own singular, against a holding that shows the report's plural and an
    /// abbreviated tag. This is what the units-table preview could not resolve.
    #[test]
    fn the_catalogues_singular_names_an_item_a_unit_holds_as_a_plural() {
        let leaders = held(&[(8, "leaders", "LEAD")]);
        assert_eq!(
            item_named(Some(&ruleset()), "LEADER", || leaders.iter()),
            Some("LEAD".to_string())
        );
    }

    /// The report's own plural of a multi-word race. `item_spellings` strips `wood elves` to
    /// `wood elv`, which the catalogue's `wood elf` does not match - so only the holding can answer.
    #[test]
    fn the_reports_plural_of_a_multi_word_race_names_the_item() {
        let elves = held(&[(5, "wood elves", "WELF")]);
        assert_eq!(
            item_named(Some(&ruleset()), "wood_elves", || elves.iter()),
            Some("WELF".to_string())
        );
    }

    /// Spelling-major, as `item_spellings` requires: the written spelling is tried against
    /// everything before its stripped form is tried against anything. Walking entry by entry
    /// instead lets an entry holding the singular beat the entry holding the exact word.
    ///
    /// `moonbeam` is not a catalogue item, and that is the point: the catalogue answers first
    /// within a spelling, so a pair it knows would never reach the holdings at all.
    #[test]
    fn the_written_spelling_beats_a_stripped_one_from_an_earlier_entry() {
        let both = held(&[(2, "moonbeam", "AAAA"), (3, "moonbeams", "BBBB")]);
        assert_eq!(
            item_named(Some(&ruleset()), "moonbeams", || both.iter()),
            Some("BBBB".to_string())
        );
    }

    /// The tag and the report's plural, which already worked, and must go on working.
    #[test]
    fn a_tag_and_a_reported_plural_both_name_the_item() {
        let orcs = held(&[(8, "orcs", "ORC")]);
        assert_eq!(
            item_named(Some(&ruleset()), "ORCS", || orcs.iter()),
            Some("ORC".to_string())
        );
        assert_eq!(
            item_named(Some(&ruleset()), "LEAD", || orcs.iter()),
            Some("LEAD".to_string())
        );
    }

    /// Nothing names it, and an empty argument names nothing.
    #[test]
    fn a_word_that_names_nothing_resolves_to_nothing() {
        let orcs = held(&[(8, "orcs", "ORC")]);
        assert_eq!(item_named(Some(&ruleset()), "swordz", || orcs.iter()), None);
        assert_eq!(item_named(Some(&ruleset()), "", || orcs.iter()), None);
    }

    /// Without a ruleset the holdings are the only authority, which is what the ledger already
    /// assumed and must keep.
    #[test]
    fn without_a_catalogue_the_holdings_still_answer() {
        let orcs = held(&[(8, "orcs", "ORC")]);
        assert_eq!(
            item_named(None, "orcs", || orcs.iter()),
            Some("ORC".to_string())
        );
        assert_eq!(item_named(None, "LEADER", || orcs.iter()), None);
    }
}
