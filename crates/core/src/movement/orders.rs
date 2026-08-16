//! Reading and writing the MOVE order a route becomes.
//!
//! Both directions matter. A planned route has to turn into an order the game will accept, and an
//! order the player wrote by hand has to be readable so the same cost and risk checks can be run
//! against it - which is the difference between a planner and an oracle.

use serde::{Deserialize, Serialize};

use crate::movement::graph::{Direction, MapKnowledge};
use crate::report::model::Coordinate;

/// One token of a MOVE order.
///
/// Entering and leaving a structure are part of the order but are not steps across the map:
/// "Moving into or out of a structure does not use any movement points at all." Keeping them as
/// their own variants stops the planner mistaking one for a hex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum MoveStep {
    /// A step into the neighbouring hex.
    Go(Direction),
    /// Into a structure, named by id when the order names one.
    In(Option<String>),
    /// Out of whatever structure the unit is in.
    Out,
}

/// Where an order takes a unit, as far as the map can say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowedMove {
    /// The hexes entered, in order. Shorter than the order itself when the map runs out.
    pub hexes: Vec<Coordinate>,
    /// Whether the order carried on past everything the faction knows.
    ///
    /// Not an error: a player may well be ordering a unit into unexplored country deliberately. It
    /// does mean the rest of the route cannot be costed or assessed.
    pub left_the_map: bool,
}

/// The order words that move a unit across the map. `parse_move` reads exactly these; the intents
/// reader files exactly these as movement; the shell's generated vocabulary carries exactly these.
pub const MOVEMENT_ORDER_COMMANDS: [&str; 3] = ["MOVE", "ADVANCE", "SAIL"];

/// Whether `word` (a bare command token, no leading `@`) is one of [`MOVEMENT_ORDER_COMMANDS`], in
/// any case.
#[must_use]
pub fn is_movement_command(word: &str) -> bool {
    MOVEMENT_ORDER_COMMANDS
        .iter()
        .any(|command| command.eq_ignore_ascii_case(word))
}

/// Reads a MOVE, ADVANCE or SAIL order.
///
/// Returns nothing for any other line, and also for an order carrying a direction the game has no
/// such thing as - dropping the unreadable part would plan a journey to somewhere the player never
/// asked for, which is worse than admitting the order cannot be read.
#[must_use]
pub fn parse_move(line: &str) -> Option<Vec<MoveStep>> {
    let trimmed = line.trim();
    // A leading `@` marks an order the game repeats every turn; it does not change which order it
    // is.
    let without_repeat = trimmed.strip_prefix('@').unwrap_or(trimmed);

    let mut tokens = without_repeat.split_whitespace();
    let command = tokens.next()?;
    // ADVANCE is MOVE that attacks whatever bars the way, so it takes the same route. SAIL is the
    // fleet's word for the same thing - both read to the same steps, because a step is a step
    // whichever order names it; only the mode a unit sails or walks under decides which word a
    // written route is rendered with, in `render_move`/`render_sail`.
    if !is_movement_command(command) {
        return None;
    }

    let mut steps = Vec::new();
    let mut remaining = tokens.peekable();
    while let Some(token) = remaining.next() {
        let token = token.trim_end_matches(['.', ';']);
        if token.is_empty() {
            continue;
        }

        if token.eq_ignore_ascii_case("out") {
            steps.push(MoveStep::Out);
        } else if token.eq_ignore_ascii_case("in") {
            // `IN 4` enters a numbered structure; a bare `IN` enters the only one there is.
            let structure = remaining
                .peek()
                .filter(|next| next.chars().all(|c| c.is_ascii_digit()))
                .map(|next| (*next).to_string());
            if structure.is_some() {
                remaining.next();
            }
            steps.push(MoveStep::In(structure));
        } else {
            // An unreadable direction ends the whole reading rather than shortening the route.
            steps.push(MoveStep::Go(Direction::parse(token)?));
        }
    }

    // "MOVE needs at least one direction" - an order that goes nowhere is not one.
    if steps.is_empty() {
        None
    } else {
        Some(steps)
    }
}

/// Writes a MOVE order the game will accept.
#[must_use]
pub fn render_move(steps: &[MoveStep]) -> String {
    render_order("MOVE", steps)
}

/// Writes the SAIL twin of [`render_move`] - the same steps, under the word a fleet uses.
#[must_use]
pub fn render_sail(steps: &[MoveStep]) -> String {
    render_order("SAIL", steps)
}

fn render_order(command: &str, steps: &[MoveStep]) -> String {
    let mut order = String::from(command);

    for step in steps {
        match step {
            MoveStep::Go(direction) => {
                order.push(' ');
                order.push_str(direction.abbreviation());
            }
            MoveStep::In(structure) => {
                order.push_str(" IN");
                if let Some(id) = structure {
                    order.push(' ');
                    order.push_str(id);
                }
            }
            MoveStep::Out => order.push_str(" OUT"),
        }
    }

    order
}

/// Walks an order across the map from where a unit stands.
///
/// Stops at the first step the map cannot follow, and says so. Entering and leaving structures
/// move a unit within its hex, so they change no coordinate.
#[must_use]
pub fn follow_move(map: &MapKnowledge, from: Coordinate, steps: &[MoveStep]) -> FollowedMove {
    let mut hexes = Vec::new();
    let mut position = from;

    for step in steps {
        let MoveStep::Go(direction) = step else {
            continue;
        };

        let Some((_, neighbour)) = map
            .neighbours(position)
            .find(|(heading, _)| heading == direction)
        else {
            return FollowedMove {
                hexes,
                left_the_map: true,
            };
        };

        position = neighbour;
        hexes.push(neighbour);
    }

    FollowedMove {
        hexes,
        left_the_map: false,
    }
}
