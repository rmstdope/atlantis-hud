//! How a sentence names a unit (`ah-uxaw`).
//!
//! A unit the report shows reads `<name> (<id>)`. A unit this month's `FORM` creates has no number
//! yet, so it reads by the alias the player writes for it - `rules/form`: "The new unit can then be
//! referred to as NEW in place of the regular unit number" - followed by the unit whose orders form
//! it: `new 1, formed by Ivanhoe (683)`. Another faction's (`rules/form`: "FACTION 15 NEW 2 will
//! refer to faction 15's newly created unit with alias 2") reads `faction 15's new 2`, since the
//! report cannot show who forms it.
//!
//! The words are the navigator's (the bead's acceptance, `docs/ui/ah-uxaw-formed-unit-name.html`).

use std::borrow::Cow;

use crate::report::model::ReportUnit;

/// The id prefix a formed unit is filed under (`effects::FORMED_ID_PREFIX`).
const FORMED_PREFIX: &str = super::effects::FORMED_ID_PREFIX;

/// What a formed phrase carries between its alias and its former, and what [`mid_sentence`] reads.
const FORMED_BY: &str = ", formed by ";

/// `new 1, formed by Ivanhoe (683)`, or `new 1` alone when the former is not known.
pub(crate) fn formed_unit_phrase(alias: &str, former: Option<&str>) -> String {
    match former {
        Some(former) => format!("new {alias}{FORMED_BY}{former}"),
        None => format!("new {alias}"),
    }
}

/// How the former reads inside [`formed_unit_phrase`]: `Ivanhoe (683)`, or by its own short name
/// `new 1` when it is itself formed this month - never a chain.
pub(crate) fn former_name(unit_id: &str, name: &str) -> String {
    match unit_id.strip_prefix(FORMED_PREFIX) {
        Some(alias) => format!("new {alias}"),
        None => format!("{name} ({unit_id})"),
    }
}

/// `faction 15's new 2`.
pub(crate) fn foreign_new_unit(faction: &str, alias: &str) -> String {
    format!("faction {faction}'s new {alias}")
}

/// A report unit by itself: `<name> (<id>)`, or `new <alias>` for a formed one - the fallback for
/// a sentence that cannot see which unit formed it, and never doubled.
pub(crate) fn report_unit_label(unit: &ReportUnit) -> String {
    unit_label(&unit.unit_id, &unit.name)
}

/// [`report_unit_label`] from the two fields it reads.
pub(crate) fn unit_label(unit_id: &str, name: &str) -> String {
    former_name(unit_id, name)
}

/// `label` as it stands when the sentence goes on after it: a formed phrase is set off by commas,
/// so it gains its closing one; every other label is returned as it is.
pub(crate) fn mid_sentence(label: &str) -> Cow<'_, str> {
    if label.contains(FORMED_BY) {
        Cow::Owned(format!("{label},"))
    } else {
        Cow::Borrowed(label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formed_unit_phrase_names_the_former() {
        assert_eq!(
            formed_unit_phrase("1", Some("Ivanhoe (683)")),
            "new 1, formed by Ivanhoe (683)"
        );
        assert_eq!(formed_unit_phrase("1", None), "new 1");
    }

    #[test]
    fn a_former_that_is_itself_formed_is_named_by_alias() {
        assert_eq!(former_name("683", "Ivanhoe"), "Ivanhoe (683)");
        assert_eq!(former_name("new-1", "Unit (new 1)"), "new 1");
        assert_eq!(
            formed_unit_phrase("2", Some(&former_name("new-1", "Unit (new 1)"))),
            "new 2, formed by new 1"
        );
    }

    #[test]
    fn another_factions_new_unit_names_its_faction() {
        assert_eq!(foreign_new_unit("15", "2"), "faction 15's new 2");
    }

    #[test]
    fn a_report_unit_reads_name_and_number_and_a_formed_one_its_alias() {
        assert_eq!(unit_label("683", "Ivanhoe"), "Ivanhoe (683)");
        assert_eq!(unit_label("new-1", "Unit (new 1)"), "new 1");
    }

    #[test]
    fn mid_sentence_closes_only_a_formed_phrase() {
        assert_eq!(
            mid_sentence("new 1, formed by Ivanhoe (683)"),
            "new 1, formed by Ivanhoe (683),"
        );
        assert_eq!(mid_sentence("Ivanhoe (683)"), "Ivanhoe (683)");
        assert_eq!(mid_sentence("new 1"), "new 1");
        assert_eq!(mid_sentence("faction 15's new 2"), "faction 15's new 2");
    }
}
