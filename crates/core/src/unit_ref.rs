//! Which unit a row of this month is: the hex it is listed in, its number, and - for a row that
//! only arrives in that hex - the hex it set out from.

use serde::{Deserialize, Serialize};

/// A unit of this month, as a row names it.
///
/// A number alone is not enough: `rules/form` scopes a `FORM` alias to its region, so two hexes may
/// each hold a `new-1`, and a unit arriving in a hex can share both hex and number with one formed
/// there. Every layer that names "this unit" - the table's row key, the cursor, the trace request -
/// uses this type, so a new dimension of identity is one field here.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "UnitRef.ts"))]
pub struct UnitRef {
    /// The hex the row is listed in.
    pub region_id: String,
    pub unit_id: String,
    /// The hex an arriving row set out from; absent for every row that does not arrive.
    pub arriving_from: Option<String>,
}

impl UnitRef {
    /// The hex this unit set out from this month: `arriving_from`, else `region_id`.
    pub fn set_out_hex(&self) -> &str {
        self.arriving_from.as_deref().unwrap_or(&self.region_id)
    }
}

#[cfg(test)]
mod tests {
    use super::UnitRef;

    #[test]
    fn set_out_hex_is_the_origin_of_an_arrival_and_the_listed_hex_otherwise() {
        let arrival = UnitRef {
            region_id: "1:1,1".into(),
            unit_id: "new-1".into(),
            arriving_from: Some("1:1,5".into()),
        };
        assert_eq!(arrival.set_out_hex(), "1:1,5");
        let staying = UnitRef {
            arriving_from: None,
            ..arrival
        };
        assert_eq!(staying.set_out_hex(), "1:1,1");
    }

    #[test]
    fn crosses_in_camel_case_with_a_null_origin() {
        let unit = UnitRef {
            region_id: "1:1,1".into(),
            unit_id: "900".into(),
            arriving_from: None,
        };
        assert_eq!(
            serde_json::to_value(&unit).unwrap(),
            serde_json::json!({ "regionId": "1:1,1", "unitId": "900", "arrivingFrom": null })
        );
    }
}
