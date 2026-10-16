//! An item's text, read and written from one table.
//!
//! The engine prints a held item through `Item::Report` and `ItemString` (`../Atlantis/items.cpp`):
//! `230 crossbows [XBOW]`, a bare `leader [LEAD]` for one, `unfinished Galleon [GALL] (needs 33)`
//! for a ship still being built, and `balrog [BALR] (illusion)` for an illusion. The parser reads
//! those and the map export writes them back, and each form used to be spelled twice, once per
//! direction - so the parser learned illusions (`ah-qrlx`) and the export did not (`ah-nm65`).
//! [`ITEM_FORMS`] is now the only place a form is spelled; a new one is a row there, and both
//! [`parse_item_amount`] and [`write_item_amount`] read it (`ah-lmfc`).

use super::model::ItemAmount;

/// One way the engine prints an item, with how it reads and how it writes beside each other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Form {
    /// `<amount> <name> [<tag>]`, with a bare `<name> [<tag>]` for one, as `ItemString` writes it.
    Plain,
    /// `<name> [<tag>] (needs <n>)`: an unfinished ship and the work still to do (`ah-uxmh`), the
    /// name already carrying its `unfinished `.
    Needs,
    /// The real item's own text with `suffix` after the tag, which the app reads as an item of its
    /// own: the real name and tag with `name_prefix` and `tag_prefix` in front.
    Marked {
        suffix: &'static str,
        name_prefix: &'static str,
        tag_prefix: &'static str,
    },
}

/// Every form, tried in order: the first that reads a text, or claims an item, is the one used.
///
/// An illusion is written to whoever sees true under its real item with ` (illusion)` appended
/// (`Item::Report`), and is its own item, `illusory balrog [IBALR]` (`data/IBALR`).
const ITEM_FORMS: &[Form] = &[
    Form::Marked {
        suffix: " (illusion)",
        name_prefix: "illusory ",
        tag_prefix: "I",
    },
    Form::Needs,
    Form::Plain,
];

impl Form {
    fn read(self, text: &str) -> Option<ItemAmount> {
        match self {
            Self::Plain => read_plain(text),
            Self::Needs => {
                let (item, needs) = text.strip_suffix(')')?.rsplit_once(" (needs ")?;
                let needs = needs.trim().parse::<i64>().ok()?;
                Some(ItemAmount {
                    needs: Some(needs),
                    ..read_plain(item.trim_end())?
                })
            }
            Self::Marked {
                suffix,
                name_prefix,
                tag_prefix,
            } => {
                let real = parse_item_amount(text.strip_suffix(suffix)?)?;
                Some(ItemAmount {
                    name: format!("{name_prefix}{}", real.name),
                    tag: format!("{tag_prefix}{}", real.tag),
                    ..real
                })
            }
        }
    }

    fn write(self, item: &ItemAmount) -> Option<String> {
        match self {
            Self::Plain => Some(if item.amount == 1 {
                format!("{} [{}]", item.name, item.tag)
            } else {
                format!("{} {} [{}]", item.amount, item.name, item.tag)
            }),
            Self::Needs => item
                .needs
                .map(|needs| format!("{} [{}] (needs {needs})", item.name, item.tag)),
            Self::Marked {
                suffix,
                name_prefix,
                tag_prefix,
            } => {
                let real = ItemAmount {
                    name: item.name.strip_prefix(name_prefix)?.to_string(),
                    tag: item.tag.strip_prefix(tag_prefix)?.to_string(),
                    ..item.clone()
                };
                Some(format!("{}{suffix}", write_item_amount(&real)))
            }
        }
    }
}

/// `230 crossbows [XBOW]` into its amount, name and tag; a bare `leader [LEAD]` is one.
fn read_plain(text: &str) -> Option<ItemAmount> {
    let open = text.rfind('[')?;
    let close = text.rfind(']')?;
    if close < open {
        return None;
    }

    let tag = text[open + 1..close].to_string();
    let head = text[..open].trim();
    let (amount, name) = match head.split_once(' ') {
        Some((first, rest)) if first.chars().all(|c| c.is_ascii_digit()) && !first.is_empty() => {
            (first.parse::<i64>().unwrap_or(1), rest.trim().to_string())
        }
        _ => (1, head.to_string()),
    };

    if name.is_empty() {
        return None;
    }

    Some(ItemAmount {
        amount,
        name,
        tag,
        needs: None,
    })
}

/// Reads one item as the report prints it, by the first form in [`ITEM_FORMS`] that reads it.
#[must_use]
pub fn parse_item_amount(input: &str) -> Option<ItemAmount> {
    let text = input.trim().trim_end_matches('.');
    ITEM_FORMS.iter().find_map(|form| form.read(text))
}

/// Writes one item as the engine's `Item::Report` would, by the first form in [`ITEM_FORMS`] that
/// claims it - the inverse of [`parse_item_amount`].
#[must_use]
pub fn write_item_amount(item: &ItemAmount) -> String {
    ITEM_FORMS
        .iter()
        .find_map(|form| form.write(item))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(amount: i64, name: &str, tag: &str, needs: Option<i64>) -> ItemAmount {
        ItemAmount {
            amount,
            name: name.to_string(),
            tag: tag.to_string(),
            needs,
        }
    }

    /// Reads `text` as `expected`, and writes `expected` back as exactly `text`.
    fn both_ways(text: &str, expected: &ItemAmount) {
        assert_eq!(parse_item_amount(text).as_ref(), Some(expected), "{text}");
        assert_eq!(write_item_amount(expected), text);
    }

    /// `ItemString` writes an amount of one bare and any other amount in front of the plural
    /// (`../Atlantis/items.cpp`).
    #[test]
    fn plain_items_read_and_write_as_the_engine_prints_them() {
        both_ways("leader [LEAD]", &item(1, "leader", "LEAD", None));
        both_ways("230 crossbows [XBOW]", &item(230, "crossbows", "XBOW", None));
    }

    /// The engine's `Item::Report` writes an unfinished ship as `unfinished <name> [<tag>] (needs
    /// <num>)`, the work still to do (`ah-uxmh`). One ship, with what it still needs.
    #[test]
    fn an_unfinished_ship_carries_what_it_needs_both_ways() {
        both_ways(
            "unfinished Galleon [GALL] (needs 33)",
            &item(1, "unfinished Galleon", "GALL", Some(33)),
        );
        assert_eq!(
            parse_item_amount("230 crossbows [XBOW]")
                .expect("item")
                .needs,
            None
        );
    }

    /// The engine's `Item::Report` writes an illusion under its real item's name and tag with
    /// ` (illusion)` appended, for its owner and for an observer with true sight
    /// (`../Atlantis/items.cpp`, `unit.cpp`'s `items.Report(obs, truesight, 0)`). It is its
    /// own item, `illusory balrog [IBALR], weight 1` (`data/IBALR`), and is read as that, or it
    /// weighs as a real balrog (`data/BALR`, weight 250) and the two lines share one tag
    /// (`ah-qrlx`). The export writes it back in the engine's form, never as the app names it
    /// (`ah-nm65`).
    #[test]
    fn an_illusion_is_its_illusory_item_both_ways() {
        both_ways(
            "balrog [BALR] (illusion)",
            &item(1, "illusory balrog", "IBALR", None),
        );
        both_ways(
            "3 imps [IMP] (illusion)",
            &item(3, "illusory imps", "IIMP", None),
        );
        // A foreign unit's, as `neworigins-3.0.0-g3-f42-t82.rep` shows zZZ (12730), at the end of
        // its line.
        assert_eq!(
            parse_item_amount("3 demons [DEMO] (illusion)."),
            Some(item(3, "illusory demons", "IDEMO", None))
        );
    }

    /// A real item whose tag happens to begin with `I` is not an illusion: only the pair of
    /// prefixes together claims one.
    #[test]
    fn a_real_item_tagged_with_an_i_is_written_plain() {
        both_ways("12 iron [IRON]", &item(12, "iron", "IRON", None));
    }

    /// A `(needs ...)` that is not a number is not the unfinished-ship form; the text reads as it
    /// did before the form was recognised.
    #[test]
    fn a_needs_that_is_not_a_number_reads_as_plain() {
        assert_eq!(
            parse_item_amount("unfinished Galleon [GALL] (needs lots)"),
            Some(item(1, "unfinished Galleon", "GALL", None))
        );
    }
}
