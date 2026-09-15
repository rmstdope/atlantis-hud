//! The Production window's facts (`ah-nneu`): every region this month's orders use a tax or trade
//! slot in, whether its tax is collected in full, and how much of each raw resource it offers is
//! produced. Facts only - every word the window shows is made in `productionView.ts`.

use serde::{Deserialize, Serialize};

/// Every region this month's orders use a tax or trade slot in, and the limits they count against.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ProductionOverview {
    pub limits: RegionLimits,
    /// One entry per region, in the report's region order.
    pub regions: Vec<WorkedRegion>,
}

/// The `Faction Status:` region limits, as maxima. All three `None`: the report printed none.
/// `pooled` is the newer `Regions`; `tax`/`trade` the older `Tax Regions`/`Trade Regions`.
/// Never `pooled` together with either of the other two.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct RegionLimits {
    pub pooled: Option<i64>,
    pub tax: Option<i64>,
    pub trade: Option<i64>,
}

/// One region a slot is used in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct WorkedRegion {
    pub region_id: String,
    /// Distinct, in this order: `Tax`, `TaxByFlag`, `Pillage`, then `Produce` with `crafted: None`,
    /// then one `Produce` per distinct crafted name, sorted by name.
    pub orders: Vec<SlotOrder>,
    /// TAX, the taxing flag or PILLAGE is used here.
    pub uses_tax_slot: bool,
    /// PRODUCE is used here.
    pub uses_trade_slot: bool,
    pub tax: WorkedTax,
    /// One per entry of the region's `Products` line, in report order.
    pub resources: Vec<WorkedResource>,
}

/// One kind of slot-using order in a region.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SlotOrder {
    pub kind: SlotOrderKind,
    /// For `Produce` only: the plural name of an item made from materials (`swords`). `None` for
    /// a PRODUCE that draws on the region's own resources, and for every other kind.
    pub crafted: Option<String>,
}

/// Which order uses the slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum SlotOrderKind {
    Tax,
    TaxByFlag,
    Pillage,
    Produce,
}

/// A region's tax, as this month's orders collect it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct WorkedTax {
    /// `ReportRegion::tax_base`.
    pub base: Option<i64>,
    /// Some own unit here taxes, by order or by flag.
    pub taxed: bool,
    /// Silver the taxers collect, summed and never above `base` when `base` is known.
    pub collected: i64,
    /// `Some(take)` when an own unit here pillages: the sum of their `Pillaged` changes.
    pub pillaged: Option<i64>,
    /// The tax or pillage figure is an upper bound rather than a forecast.
    pub at_most: bool,
}

/// One raw resource a region offers, and how much of it this month's orders produce.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct WorkedResource {
    /// The region's own word from its `Products` line.
    pub name: String,
    pub tag: String,
    /// Sum of `UnitSilver::produced` over the own units producing this tag against this region.
    pub produced: i64,
    /// The amount the region offers. `None` means the amount is not known.
    pub available: Option<i64>,
}
