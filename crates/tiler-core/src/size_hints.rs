//! Portable client size-hint policy (AR12).
//!
//! Zero-dependency: `std` plus the intra-crate [`crate::geometry`] projector
//! and [`crate::directional`] model types only. No transport, JSON, platform,
//! process, or logging imports: the core exposes pure assessments and the
//! adapter/service layers own every log line (the core has no logging
//! channel, so diagnostics ride as typed reply flags instead).
//!
//! Approved policy (review 7.11 as hypothesized, verified against the current
//! implementation: the projector previously ignored client minimums entirely,
//! which fed the drift -> reassert -> park loop):
//! - Observed windows carry `min`/`max` size hints.
//! - Projection honors minimums only, by taking the deficit from siblings in
//!   proportion to their slack above their own minimums. When the minimums
//!   exceed the available extent the proportional allocation is kept and the
//!   windows below their minimum are marked `overconstrained` (never
//!   reasserted). Maximums never reallocate: `max` is only an input to clamp
//!   acceptance below. (An earlier revision applied maximums symmetrically in
//!   projection; that was removed as visible layout beyond the approved
//!   behavior.)
//! - Reconcile accepts an observed size that equals
//!   `clamp(desired, min, max)` (within a small axis-specific tolerance) as
//!   `client-clamped`: it does not count as drift, never perturbs retained
//!   shares, and never synthesizes a plan.
//!
//! Clamp-acceptance rule (deliberately narrow):
//! - Only windows carrying a *meaningful* hint on the differing axis accept a
//!   clamp: at least one of `min`/`max` for that axis must be positive and
//!   within the shared carried-geometry bound. Unhinted drift is never
//!   adopted, no matter how small.
//! - Each axis is judged independently against its own hints with
//!   [`CLAMP_TOLERANCE_PX`] slack for 1px rounding only. The tolerance does
//!   NOT cover arbitrary terminal cell increments (which can be tens of
//!   device units): a reliable increment observation does not exist on the
//!   wire, and none is inferred. A tens-of-pixels mismatch therefore stays
//!   genuine drift even when the window carries hints, unless the observed
//!   size lands on `clamp(desired, min, max)` itself.
//! - A host `max` of `i32::MAX` is the KWin unbounded sentinel, not a real
//!   cap: like every out-of-bound value it sanitizes to absent. In
//!   particular a 56px shortfall with only `min 210` and an unbounded max
//!   never accepts (the clamp of the desired size is the desired size
//!   itself, 56 away), so the available Ghostty evidence stays genuine
//!   drift, not a client clamp.
//! - Position (`x`/`y`) drift is never accepted: clients clamp sizes, not
//!   positions.
//! - Leftover geometry stays explained: the retained desired rectangle
//!   remains the authoritative truth (shares/topology untouched); the
//!   client-clamped observed rectangle is simply left on screen instead of
//!   being rewritten. The next projection re-derives from retained shares, so
//!   no drift accumulates.
//!
//! Interaction notes:
//! - Fullscreen/maximized/sticky/floating windows are session exceptions,
//!   never projected: their hints and rectangles bypass both the minimum
//!   honoring and the clamp assessment.
//! - Hints are ephemeral per-observation inputs, never retained state:
//!   retained shares, topology, focus, and revision are untouched by both the
//!   honoring and the acceptance paths.

use std::collections::BTreeSet;

use crate::bounds::GEOMETRY_BOUND;
use crate::directional::{Axis, Node, NodeId};
use crate::geometry::{ProjectedLeaf, Rect, project};

/// Per-axis clamp tolerance in device units.
///
/// Covers 1px rounding only. It does NOT cover arbitrary terminal cell
/// increments: no reliable increment observation exists on the wire and none
/// is inferred, so a multi-pixel mismatch stays drift unless the observed
/// size lands on `clamp(desired, min, max)` itself.
pub const CLAMP_TOLERANCE_PX: i32 = 2;

/// Portable client size hints for one observed window.
///
/// `None` per bound means the host reported no hint there. Values are
/// sanitized at use: only `1..=GEOMETRY_BOUND` counts as meaningful; zero,
/// negative, or absurd values behave as absent (advisory input must never
/// fail a request).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct WindowSizeHints {
    pub min_w: Option<i32>,
    pub min_h: Option<i32>,
    pub max_w: Option<i32>,
    pub max_h: Option<i32>,
}

impl WindowSizeHints {
    /// No hints on any bound.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            min_w: None,
            min_h: None,
            max_w: None,
            max_h: None,
        }
    }

    /// Whether any bound carries a hint (before sanitizing).
    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.min_w.is_none() && self.min_h.is_none() && self.max_w.is_none() && self.max_h.is_none()
    }

    /// Meaningful minimum width, if any.
    #[must_use]
    pub fn meaningful_min_w(self) -> Option<i32> {
        meaningful(self.min_w)
    }

    /// Meaningful minimum height, if any.
    #[must_use]
    pub fn meaningful_min_h(self) -> Option<i32> {
        meaningful(self.min_h)
    }

    /// Meaningful maximum width, if any.
    #[must_use]
    pub fn meaningful_max_w(self) -> Option<i32> {
        meaningful(self.max_w)
    }

    /// Meaningful maximum height, if any.
    #[must_use]
    pub fn meaningful_max_h(self) -> Option<i32> {
        meaningful(self.max_h)
    }

    /// Minimum along `axis`, if meaningful.
    #[must_use]
    pub fn min_for_axis(self, axis: Axis) -> Option<i32> {
        match axis {
            Axis::Horizontal => self.meaningful_min_w(),
            Axis::Vertical => self.meaningful_min_h(),
        }
    }

    /// Maximum along `axis`, if meaningful.
    #[must_use]
    pub fn max_for_axis(self, axis: Axis) -> Option<i32> {
        match axis {
            Axis::Horizontal => self.meaningful_max_w(),
            Axis::Vertical => self.meaningful_max_h(),
        }
    }
}

/// Keep only positive, in-bound hint values.
///
/// A host `max` of `i32::MAX` is the KWin unbounded sentinel, so it (like
/// every other out-of-bound value) behaves as absent, never as a real cap.
fn meaningful(value: Option<i32>) -> Option<i32> {
    match value {
        Some(v) if (1..=GEOMETRY_BOUND).contains(&v) => Some(v),
        _ => None,
    }
}

/// Clamp `desired` into the meaningful `[min, max]` window.
///
/// Absent bounds are open. On a contradictory `max < min` pair the minimum
/// wins (a window that needs room keeps it); sanitization of the pair itself
/// happens in [`sanitized_pair`] at leaf resolution.
pub fn clamp_axis(desired: i32, min: Option<i32>, max: Option<i32>) -> i32 {
    let mut value = desired;
    if let Some(lo) = meaningful(min)
        && value < lo
    {
        value = lo;
    }
    if let Some(hi) = meaningful(max)
        && value > hi
    {
        value = hi;
    }
    // Contradictory pair: the minimum wins over the maximum.
    if let (Some(lo), Some(hi)) = (meaningful(min), meaningful(max))
        && hi < lo
        && value < lo
    {
        value = lo;
    }
    value
}

/// Whether `observed` accepts as a client clamp of `desired` on one axis.
///
/// Requires a meaningful hint on this axis (unhinted drift is never
/// accepted); otherwise the observed value must land within
/// [`CLAMP_TOLERANCE_PX`] of `clamp(desired, min, max)`.
#[must_use]
pub fn axis_accepts_clamp(observed: i32, desired: i32, min: Option<i32>, max: Option<i32>) -> bool {
    if meaningful(min).is_none() && meaningful(max).is_none() {
        return false;
    }
    let clamped = clamp_axis(desired, min, max);
    (i64::from(observed) - i64::from(clamped)).abs() <= i64::from(CLAMP_TOLERANCE_PX)
}

/// Per-window clamp assessment of an observed rectangle against the retained
/// desired rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClampAssessment {
    /// True when every differing axis accepts via its own hints (position
    /// must match exactly; equal sizes accept trivially).
    pub accepted: bool,
    /// Whether the width axis accepts (equal widths accept trivially).
    pub width_accepted: bool,
    /// Whether the height axis accepts (equal heights accept trivially).
    pub height_accepted: bool,
}

/// Assess one observed client rectangle against its desired allocation.
///
/// Position drift is never accepted. Each size axis accepts when equal or
/// when [`axis_accepts_clamp`] holds for that axis's hints.
#[must_use]
pub fn assess_window_clamp(
    observed: &Rect,
    desired: &Rect,
    hints: &WindowSizeHints,
) -> ClampAssessment {
    if observed.x != desired.x || observed.y != desired.y {
        return ClampAssessment {
            accepted: false,
            width_accepted: false,
            height_accepted: false,
        };
    }
    let width_accepted = observed.w == desired.w
        || axis_accepts_clamp(observed.w, desired.w, hints.min_w, hints.max_w);
    let height_accepted = observed.h == desired.h
        || axis_accepts_clamp(observed.h, desired.h, hints.min_h, hints.max_h);
    ClampAssessment {
        accepted: width_accepted && height_accepted,
        width_accepted,
        height_accepted,
    }
}

/// Raise entries below their minimums by taking the deficit from siblings in
/// proportion to their slack above their own minimums.
///
/// Every entry keeps at least one device unit (the projector invariant that
/// every leaf has a positive extent): feasibility is
/// `sum(max(min, 1)) <= total`. Returns `false` and leaves `sizes` exactly
/// untouched when infeasible. Integer-only and deterministic: floor takes
/// with the remainder distributed in child order.
pub fn enforce_minimums(sizes: &mut [i64], mins: &[i64]) -> bool {
    if sizes.len() != mins.len() {
        return false;
    }
    let total: i64 = sizes.iter().sum();
    let floors: Vec<i64> = mins.iter().map(|m| (*m).max(1)).collect();
    if floors.iter().sum::<i64>() > total {
        return false;
    }
    let mut deficit: i64 = 0;
    let mut slack_total: i64 = 0;
    for (size, floor) in sizes.iter().zip(floors.iter()) {
        if *size < *floor {
            deficit += *floor - *size;
        } else {
            slack_total += *size - *floor;
        }
    }
    if deficit == 0 {
        return true;
    }
    // Feasible by the floors-sum check: deficit <= slack_total.
    let mut takes = vec![0i64; sizes.len()];
    let mut taken: i64 = 0;
    for (index, (size, floor)) in sizes.iter().zip(floors.iter()).enumerate() {
        if *size > *floor && slack_total > 0 {
            let slack = *size - *floor;
            let take = deficit * slack / slack_total;
            let take = take.min(slack);
            takes[index] = take;
            taken += take;
        }
    }
    let mut remaining = deficit - taken;
    for (index, (size, floor)) in sizes.iter().zip(floors.iter()).enumerate() {
        if remaining == 0 {
            break;
        }
        if *size - takes[index] > *floor {
            takes[index] += 1;
            remaining -= 1;
        }
    }
    if remaining != 0 {
        return false;
    }
    for ((size, floor), take) in sizes.iter_mut().zip(floors.iter()).zip(takes.iter()) {
        if *size < *floor {
            *size = *floor;
        } else {
            *size -= *take;
        }
    }
    debug_assert_eq!(sizes.iter().sum::<i64>(), total);
    true
}

/// Minimum extent the subtree rooted at `node` needs along `axis`, including
/// internal descendant gaps. Cross-axis groups need the maximum of their
/// children (every child spans the full cross extent).
fn subtree_min(
    node: &Node,
    axis: Axis,
    gap: i64,
    resolve: &dyn Fn(&NodeId) -> WindowSizeHints,
) -> i64 {
    match node {
        Node::Leaf { id } => resolve(id).min_for_axis(axis).map_or(0, i64::from),
        Node::Group {
            axis: group_axis,
            children,
            ..
        } => {
            if *group_axis == axis {
                let mut sum: i64 = 0;
                for child in children {
                    sum = sum.saturating_add(subtree_min(child, axis, gap, resolve));
                }
                sum.saturating_add(gap.saturating_mul(children.len().saturating_sub(1) as i64))
            } else {
                children
                    .iter()
                    .map(|child| subtree_min(child, axis, gap, resolve))
                    .max()
                    .unwrap_or(0)
            }
        }
    }
}

/// Fail-closed hinted-projection rejection with a fixed diagnostic message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HintProjectionError {
    message: String,
}

impl HintProjectionError {
    /// Diagnostic message (fixed redacted vocabulary; never echoes ids).
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for HintProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for HintProjectionError {}

fn hint_error(message: impl Into<String>) -> HintProjectionError {
    HintProjectionError {
        message: message.into(),
    }
}

/// Hinted projection result: leaf rectangles in child-order visitation order
/// plus the leaves whose final rectangle violates their own minimum
/// (unsatisfiable along the split axis, the cross axis, or both).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HintedProjection {
    pub leaves: Vec<ProjectedLeaf>,
    pub overconstrained: Vec<NodeId>,
}

/// Project `tree` leaves into `bounds` separated by `gap`, honoring per-leaf
/// minimum size hints resolved through `resolve`. Maximum hints never
/// reallocate here; they only feed clamp acceptance.
///
/// The base allocation at every group is byte-identical to
/// [`crate::geometry::project`] (same proportional formula); with no
/// meaningful minimums the output matches it exactly. Each group then
/// enforces child minimums (deficit from siblings proportional to slack).
/// Infeasible minimums keep the proportional sizes; leaves below their own
/// minimum land in [`HintedProjection::overconstrained`].
///
/// A single-leaf tree has no siblings to take slack from, so its rectangle
/// is always the plain allocation: it is flagged overconstrained when that
/// rectangle violates its own minimum, but projection still succeeds (never
/// refused for unsatisfiable minimums).
///
/// Validation (bounds, gap, topology) runs through [`project`] first, so
/// every rejection the plain projector reports (including gap-budget
/// infeasibility) is preserved byte-identically.
pub fn project_with_hints(
    tree: &Node,
    bounds: Rect,
    gap: i32,
    resolve: &dyn Fn(&NodeId) -> WindowSizeHints,
) -> Result<HintedProjection, HintProjectionError> {
    project(tree, bounds, gap).map_err(|error| hint_error(error.message()))?;
    let mut leaves = Vec::new();
    let mut overconstrained = Vec::new();
    let mut seen_over = BTreeSet::new();
    layout_hinted(
        tree,
        bounds,
        gap,
        resolve,
        &mut leaves,
        &mut overconstrained,
        &mut seen_over,
    )?;
    Ok(HintedProjection {
        leaves,
        overconstrained,
    })
}

#[allow(clippy::too_many_arguments)]
fn layout_hinted(
    node: &Node,
    rect: Rect,
    gap: i32,
    resolve: &dyn Fn(&NodeId) -> WindowSizeHints,
    out: &mut Vec<ProjectedLeaf>,
    overconstrained: &mut Vec<NodeId>,
    seen_over: &mut BTreeSet<NodeId>,
) -> Result<(), HintProjectionError> {
    match node {
        Node::Leaf { id } => {
            let hints = resolve(id);
            if violates_minimum(&rect, &hints) && seen_over.insert(id.clone()) {
                overconstrained.push(id.clone());
            }
            out.push(ProjectedLeaf {
                leaf: id.clone(),
                rect,
            });
            Ok(())
        }
        Node::Group {
            axis,
            children,
            shares,
            ..
        } => {
            let n = children.len();
            // Same proportional base as geometry::layout_into: reserve one
            // unit per child, then floor shares of the distributable.
            let mut total: u64 = 0;
            for share in shares {
                total = total
                    .checked_add(*share)
                    .ok_or_else(|| hint_error("group shares total overflows"))?;
            }
            let extent: i64 = match axis {
                Axis::Horizontal => i64::from(rect.w),
                Axis::Vertical => i64::from(rect.h),
            };
            let gaps_total: i64 = i64::from(gap)
                .checked_mul(n as i64 - 1)
                .ok_or_else(|| hint_error("gap budget overflows"))?;
            let avail: i64 = extent - gaps_total;
            let distributable = avail - n as i64;
            let mut sizes: Vec<i64> = Vec::with_capacity(n);
            let mut used: i64 = 0;
            for (index, share) in shares.iter().enumerate() {
                if index + 1 == n {
                    sizes.push(avail - used);
                } else {
                    let proportional: i64 = (i128::from(distributable) * i128::from(*share)
                        / i128::from(total))
                    .try_into()
                    .map_err(|_| hint_error("segment size overflows"))?;
                    let size = proportional + 1;
                    sizes.push(size);
                    used += size;
                }
            }
            // Honor child minimums along the split axis only. Maximums never
            // reallocate (approved projection honors minimums; max feeds
            // clamp acceptance). Infeasible minimums keep the base sizes.
            let gap64 = i64::from(gap);
            let mins: Vec<i64> = children
                .iter()
                .map(|child| subtree_min(child, *axis, gap64, resolve))
                .collect();
            let _ = enforce_minimums(&mut sizes, &mins);
            let mut cursor: i64 = match axis {
                Axis::Horizontal => i64::from(rect.x),
                Axis::Vertical => i64::from(rect.y),
            };
            for (index, (child, size)) in children.iter().zip(sizes.iter()).enumerate() {
                let size_i32: i32 = (*size)
                    .try_into()
                    .map_err(|_| hint_error("segment size overflows"))?;
                let child_rect = match axis {
                    Axis::Horizontal => Rect {
                        x: i32::try_from(cursor)
                            .map_err(|_| hint_error("segment offset overflows"))?,
                        y: rect.y,
                        w: size_i32,
                        h: rect.h,
                    },
                    Axis::Vertical => Rect {
                        x: rect.x,
                        y: i32::try_from(cursor)
                            .map_err(|_| hint_error("segment offset overflows"))?,
                        w: rect.w,
                        h: size_i32,
                    },
                };
                layout_hinted(
                    child,
                    child_rect,
                    gap,
                    resolve,
                    out,
                    overconstrained,
                    seen_over,
                )?;
                if index + 1 < children.len() {
                    cursor = cursor
                        .checked_add(*size)
                        .and_then(|next| next.checked_add(i64::from(gap)))
                        .ok_or_else(|| hint_error("segment offset overflows"))?;
                }
            }
            Ok(())
        }
    }
}

/// Whether `rect` violates the leaf's own meaningful minimums.
fn violates_minimum(rect: &Rect, hints: &WindowSizeHints) -> bool {
    if let Some(min_w) = hints.meaningful_min_w()
        && rect.w < min_w
    {
        return true;
    }
    if let Some(min_h) = hints.meaningful_min_h()
        && rect.h < min_h
    {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directional::Axis;

    fn leaf(id: &str) -> Node {
        Node::Leaf {
            id: NodeId::from(id),
        }
    }

    fn group(id: &str, axis: Axis, children: Vec<Node>, shares: Vec<u64>) -> Node {
        Node::Group {
            id: NodeId::from(id),
            axis,
            children,
            shares,
        }
    }

    fn hints(min_w: Option<i32>, min_h: Option<i32>) -> WindowSizeHints {
        WindowSizeHints {
            min_w,
            min_h,
            max_w: None,
            max_h: None,
        }
    }

    #[test]
    fn meaningful_filters_non_positive_absurd_and_unbounded_sentinel() {
        assert_eq!(meaningful(None), None);
        assert_eq!(meaningful(Some(0)), None);
        assert_eq!(meaningful(Some(-5)), None);
        assert_eq!(meaningful(Some(1)), Some(1));
        assert_eq!(meaningful(Some(GEOMETRY_BOUND)), Some(GEOMETRY_BOUND));
        assert_eq!(meaningful(Some(GEOMETRY_BOUND + 1)), None);
        // KWin reports no cap as i32::MAX: unbounded, never a real maximum.
        assert_eq!(meaningful(Some(i32::MAX)), None);
    }

    #[test]
    fn clamp_axis_applies_min_then_max_with_min_winning_conflicts() {
        assert_eq!(clamp_axis(100, Some(50), Some(200)), 100);
        assert_eq!(clamp_axis(10, Some(50), None), 50);
        assert_eq!(clamp_axis(300, None, Some(200)), 200);
        assert_eq!(clamp_axis(100, None, None), 100);
        // Contradictory pair: minimum wins.
        assert_eq!(clamp_axis(100, Some(200), Some(50)), 200);
        // Non-meaningful bounds are open.
        assert_eq!(clamp_axis(10, Some(0), Some(-3)), 10);
    }

    #[test]
    fn axis_acceptance_needs_meaningful_hints_and_rounding_tolerance() {
        // Unhinted drift never accepted, however small.
        assert!(!axis_accepts_clamp(101, 100, None, None));
        assert!(!axis_accepts_clamp(100, 100, None, None));
        // Exact clamp match accepts.
        assert!(axis_accepts_clamp(50, 10, Some(50), None));
        assert!(axis_accepts_clamp(200, 300, None, Some(200)));
        // Within rounding tolerance accepts.
        assert!(axis_accepts_clamp(52, 10, Some(50), None));
        assert!(axis_accepts_clamp(48, 10, Some(50), None));
        // Beyond tolerance still drift.
        assert!(!axis_accepts_clamp(53, 10, Some(50), None));
        assert!(!axis_accepts_clamp(100, 10, Some(50), None));
        // No drift (observed equals desired inside hints) accepts.
        assert!(axis_accepts_clamp(100, 100, Some(50), Some(200)));
        // Tolerance is rounding only: a 10px shortfall against a real
        // maximum is drift, not an inferred cell increment.
        assert!(!axis_accepts_clamp(734, 744, None, Some(744)));
        // Available Ghostty evidence stays genuine drift: 56 short with only
        // min 210 and the unbounded max sentinel (the clamp of the desired
        // size is the desired size itself, 56 away).
        assert!(!axis_accepts_clamp(1036, 1092, Some(210), Some(i32::MAX)));
        assert!(!axis_accepts_clamp(1036, 1092, Some(210), None));
    }

    #[test]
    fn window_assessment_rejects_position_drift_but_accepts_size_clamp() {
        let desired = Rect {
            x: 0,
            y: 0,
            w: 600,
            h: 800,
        };
        let clamp_hints = WindowSizeHints {
            min_w: None,
            min_h: None,
            max_w: None,
            max_h: Some(744),
        };
        // Ghostty-like short frame against a REAL carried maximum: same
        // position, observed exactly at the cap. (A 56px shortfall with only
        // a small min and an unbounded max stays drift; see the axis test.)
        let short = Rect {
            x: 0,
            y: 0,
            w: 600,
            h: 744,
        };
        let assessed = assess_window_clamp(&short, &desired, &clamp_hints);
        assert!(assessed.accepted);
        assert!(assessed.width_accepted && assessed.height_accepted);
        // Shifted position never accepted, even with hints.
        let moved = Rect { x: 4, ..short };
        assert!(!assess_window_clamp(&moved, &desired, &clamp_hints).accepted);
        // Unhinted size drift never accepted.
        let unhinted = assess_window_clamp(&short, &desired, &WindowSizeHints::none());
        assert!(!unhinted.accepted);
        assert!(!unhinted.height_accepted);
        assert!(unhinted.width_accepted);
    }

    #[test]
    fn minimums_take_deficit_proportional_to_slack() {
        // [500, 500] with mins [600, 0]: 100 deficit from sibling slack.
        let mut sizes = vec![500i64, 500];
        assert!(enforce_minimums(&mut sizes, &[600, 0]));
        assert_eq!(sizes, vec![600, 400]);
        // Proportional across two donors: [100, 400, 500] mins [0, 0, 700]:
        // deficit 200, slack 100+400=500 -> takes 40 and 160.
        let mut sizes = vec![100i64, 400, 500];
        assert!(enforce_minimums(&mut sizes, &[0, 0, 700]));
        assert_eq!(sizes, vec![60, 240, 700]);
        // Already satisfied: untouched.
        let mut sizes = vec![600i64, 400];
        assert!(enforce_minimums(&mut sizes, &[600, 0]));
        assert_eq!(sizes, vec![600, 400]);
    }

    #[test]
    fn minimums_refuse_infeasible_without_mutation() {
        let mut sizes = vec![500i64, 500];
        assert!(!enforce_minimums(&mut sizes, &[600, 500]));
        assert_eq!(sizes, vec![500, 500]);
        // Positivity floor: [3] extent cannot host min 3 plus a sibling.
        let mut sizes = vec![1i64, 1, 1];
        assert!(!enforce_minimums(&mut sizes, &[3, 0, 0]));
        assert_eq!(sizes, vec![1, 1, 1]);
    }

    #[test]
    fn hinted_projection_without_hints_matches_plain_projection() {
        let tree = group(
            "root",
            Axis::Horizontal,
            vec![
                leaf("A"),
                group(
                    "inner",
                    Axis::Vertical,
                    vec![leaf("B"), leaf("C")],
                    vec![1, 3],
                ),
            ],
            vec![1, 1],
        );
        let bounds = Rect {
            x: 10,
            y: 20,
            w: 94,
            h: 60,
        };
        let plain = project(&tree, bounds, 8).expect("valid");
        let hinted =
            project_with_hints(&tree, bounds, 8, &|_| WindowSizeHints::none()).expect("valid");
        assert!(hinted.overconstrained.is_empty());
        assert_eq!(hinted.leaves, plain);
    }

    #[test]
    fn hinted_projection_without_hints_matches_plain_across_matrix() {
        // No-hint equivalence is structural, not single-case: every share
        // set, axis nesting, gap, and bound below must project byte-identical
        // with empty hints and flag nothing.
        let share_sets: &[Vec<u64>] = &[vec![1, 1], vec![2, 1], vec![3, 1, 1], vec![1, 1, 1, 1]];
        let bounds_list = [
            Rect {
                x: 0,
                y: 0,
                w: 120,
                h: 80,
            },
            Rect {
                x: 10,
                y: 20,
                w: 94,
                h: 60,
            },
            Rect {
                x: 0,
                y: 0,
                w: 1200,
                h: 800,
            },
        ];
        for shares in share_sets {
            for root_axis in [Axis::Horizontal, Axis::Vertical] {
                let n = shares.len();
                let names = ["L0", "L1", "L2", "L3"];
                let children: Vec<Node> = names[..n].iter().map(|name| leaf(name)).collect();
                let tree = group("root", root_axis, children, shares.clone());
                for bounds in bounds_list {
                    for gap in [0, 2, 8] {
                        let plain = project(&tree, bounds, gap).expect("matrix valid");
                        let hinted =
                            project_with_hints(&tree, bounds, gap, &|_| WindowSizeHints::none())
                                .expect("matrix valid");
                        assert!(hinted.overconstrained.is_empty());
                        assert_eq!(hinted.leaves, plain);
                    }
                }
            }
        }
    }

    #[test]
    fn hinted_projection_honors_satisfiable_minimum_from_sibling_slack() {
        // Equal halves of 1000; B needs 600: A yields 200 of its slack.
        let tree = group(
            "root",
            Axis::Horizontal,
            vec![leaf("A"), leaf("B")],
            vec![1, 1],
        );
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 1000,
            h: 800,
        };
        let resolve = |id: &NodeId| {
            if id.0 == "B" {
                hints(Some(600), None)
            } else {
                WindowSizeHints::none()
            }
        };
        let hinted = project_with_hints(&tree, bounds, 0, &resolve).expect("valid");
        assert!(hinted.overconstrained.is_empty());
        assert_eq!(hinted.leaves.len(), 2);
        assert_eq!(hinted.leaves[0].rect.w, 400);
        assert_eq!(hinted.leaves[1].rect.w, 600);
        assert_eq!(hinted.leaves[0].rect.x, 0);
        assert_eq!(hinted.leaves[1].rect.x, 400);
    }

    #[test]
    fn hinted_projection_marks_overconstrained_and_keeps_proportional() {
        // Minimums exceed the extent: proportional fallback, both flagged.
        let tree = group(
            "root",
            Axis::Horizontal,
            vec![leaf("A"), leaf("B")],
            vec![1, 1],
        );
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 1000,
            h: 800,
        };
        let resolve = |_: &NodeId| hints(Some(600), None);
        let hinted = project_with_hints(&tree, bounds, 0, &resolve).expect("valid");
        let plain = project(&tree, bounds, 0).expect("valid");
        assert_eq!(
            hinted.leaves, plain,
            "fallback keeps proportional allocation"
        );
        assert_eq!(hinted.overconstrained.len(), 2);
    }

    #[test]
    fn hinted_projection_single_leaf_flags_without_refusing() {
        // A lone leaf has no siblings: unsatisfiable minimums flag
        // overconstrained, but projection still succeeds with the plain
        // rectangle (never refused for minimums alone).
        let tree = leaf("A");
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 600,
            h: 800,
        };
        let resolve = |_: &NodeId| hints(Some(700), None);
        let hinted = project_with_hints(&tree, bounds, 0, &resolve).expect("never refused");
        let plain = project(&tree, bounds, 0).expect("valid");
        assert_eq!(hinted.leaves, plain);
        assert_eq!(hinted.overconstrained, vec![NodeId::from("A")]);
        // Satisfiable single leaf: no flag.
        let resolve_ok = |_: &NodeId| hints(Some(500), None);
        let ok = project_with_hints(&tree, bounds, 0, &resolve_ok).expect("valid");
        assert!(ok.overconstrained.is_empty());
    }

    #[test]
    fn hinted_projection_gap_infeasibility_matches_plain_refusal() {
        // Gap-budget infeasibility refuses exactly as before; hints never
        // turn a projectable tree unprojectable nor rescue an unprojectable
        // one.
        let tree = group(
            "root",
            Axis::Horizontal,
            vec![leaf("A"), leaf("B")],
            vec![1, 1],
        );
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 10,
            h: 10,
        };
        assert!(project(&tree, bounds, 11).is_err());
        assert!(project_with_hints(&tree, bounds, 11, &|_| WindowSizeHints::none()).is_err());
        let resolve = |_: &NodeId| hints(Some(4), None);
        assert!(project_with_hints(&tree, bounds, 11, &resolve).is_err());
    }

    #[test]
    fn hinted_projection_flags_cross_axis_minimum_violation() {
        // Plenty of width, but the inherited height cannot host the minimum.
        let tree = group(
            "root",
            Axis::Horizontal,
            vec![leaf("A"), leaf("B")],
            vec![1, 1],
        );
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 1000,
            h: 800,
        };
        let resolve = |id: &NodeId| {
            if id.0 == "B" {
                hints(None, Some(900))
            } else {
                WindowSizeHints::none()
            }
        };
        let hinted = project_with_hints(&tree, bounds, 0, &resolve).expect("valid");
        assert_eq!(hinted.overconstrained, vec![NodeId::from("B")]);
        // Satisfiable sibling keeps its proportional share.
        assert_eq!(hinted.leaves[0].rect.w, 500);
    }
}
