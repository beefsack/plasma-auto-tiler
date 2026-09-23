//! Portable layout-policy seam over the COSMIC v1 behavior.
//!
//! [`LayoutPolicy`] groups every COSMIC-specific semantic consumed by
//! [`crate::session::Session`]: movement planning, admission axis and share
//! arithmetic, keyboard/pointer pixel resize, and drag/drop classification.
//! [`CosmicV1Policy`] is the only implementation and delegates each operation
//! to [`crate::cosmic_v1`]. Sessions and the engine hold the selected policy
//! and route every policy decision through it, preserving exact behavior.
//!
//! Dependency-free: `std` plus intra-crate portable modules only, so the
//! existing portable gate is unaffected.

use std::fmt::Debug;
use std::sync::Arc;

use crate::contract::DragSide;
use crate::cosmic_v1;
use crate::directional::{Axis, Capabilities, MoveIntent, MoveOutcome, NodeId, Snapshot};
use crate::geometry::Rect;

pub use crate::cosmic_v1::PriorGroupEdge;

/// Portable layout policy: the COSMIC-specific decisions a session needs.
///
/// Grouped by the actual session call sites (planning, admission/shares,
/// resize, drag/drop). Implementations must preserve the exact COSMIC v1
/// semantics documented on each [`crate::cosmic_v1`] item.
pub trait LayoutPolicy: Debug + Send + Sync {
    /// Accepted movement planning for one focused move intent.
    fn plan_move(
        &self,
        snapshot: &Snapshot,
        intent: &MoveIntent,
        capabilities: &Capabilities,
    ) -> MoveOutcome;

    /// Admission split axis for a placement target geometry.
    fn admission_axis_for_rect(&self, bounds: &Rect) -> Axis;
    /// New-group shares for an equal-halves admission split.
    fn new_group_shares(&self) -> [u64; 2];
    /// Proportional N-ary insertion shares preserving survivor ratios.
    fn proportional_insertion_shares(
        &self,
        existing: &[u64],
        insertion_index: usize,
    ) -> Option<Vec<u64>>;
    /// Proportional N-ary removal shares preserving survivor ratios.
    fn proportional_removal_shares(
        &self,
        existing: &[u64],
        removed_index: usize,
    ) -> Option<Vec<u64>>;

    /// Keyboard resize step schedule in physical pixels.
    fn keyboard_step_px(&self, press_index: u32) -> i32;
    /// Whether a resize pair with direct pair extents admits a resize.
    fn pair_admits_resize(&self, pair_w: i64, pair_h: i64, axis: Axis) -> bool;
    /// Pointer two-sided clamped split of a physical pair extent.
    fn clamp_pair_split(
        &self,
        pair_total: i64,
        desired_first: i64,
        axis: Axis,
    ) -> Option<(i64, i64)>;
    /// Keyboard one-sided shrink step on a physical pair.
    fn clamp_keyboard_shrink_pair(
        &self,
        shrink: i64,
        grow: i64,
        amount: i64,
        axis: Axis,
    ) -> Option<(i64, i64)>;
    /// Resize pair minimum along an axis in physical pixels.
    fn pair_min_for_axis(&self, axis: Axis) -> i64;
    /// Resized child minimum along an axis in physical pixels.
    fn child_min_for_axis(&self, axis: Axis) -> i64;

    /// Window-drop classification of a point inside a projected window rect.
    fn classify_window_point(&self, rect: &Rect, x: i32, y: i32) -> Option<DragSide>;
    /// Group-edge classification of a point inside a projected group rect.
    fn classify_group_point(
        &self,
        rect: &Rect,
        group: &NodeId,
        x: i32,
        y: i32,
        prior: Option<&PriorGroupEdge>,
    ) -> Option<DragSide>;
    /// Predecessor index for a group-interior drop at an absolute offset.
    fn insertion_index_for_offset(&self, child_starts: &[i64], offset: i64) -> usize;
}

/// COSMIC v1 policy: the only selected implementation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CosmicV1Policy;

impl LayoutPolicy for CosmicV1Policy {
    fn plan_move(
        &self,
        snapshot: &Snapshot,
        intent: &MoveIntent,
        capabilities: &Capabilities,
    ) -> MoveOutcome {
        cosmic_v1::plan_move_with_capabilities(snapshot, intent, capabilities)
    }

    fn admission_axis_for_rect(&self, bounds: &Rect) -> Axis {
        cosmic_v1::admission_axis_for_rect(bounds)
    }

    fn new_group_shares(&self) -> [u64; 2] {
        cosmic_v1::new_group_shares()
    }

    fn proportional_insertion_shares(
        &self,
        existing: &[u64],
        insertion_index: usize,
    ) -> Option<Vec<u64>> {
        cosmic_v1::proportional_insertion_shares(existing, insertion_index)
    }

    fn proportional_removal_shares(
        &self,
        existing: &[u64],
        removed_index: usize,
    ) -> Option<Vec<u64>> {
        cosmic_v1::proportional_removal_shares(existing, removed_index)
    }

    fn keyboard_step_px(&self, press_index: u32) -> i32 {
        cosmic_v1::keyboard_step_px(press_index)
    }

    fn pair_admits_resize(&self, pair_w: i64, pair_h: i64, axis: Axis) -> bool {
        cosmic_v1::pair_admits_resize(pair_w, pair_h, axis)
    }

    fn clamp_pair_split(
        &self,
        pair_total: i64,
        desired_first: i64,
        axis: Axis,
    ) -> Option<(i64, i64)> {
        cosmic_v1::clamp_pair_split(pair_total, desired_first, axis)
    }

    fn clamp_keyboard_shrink_pair(
        &self,
        shrink: i64,
        grow: i64,
        amount: i64,
        axis: Axis,
    ) -> Option<(i64, i64)> {
        cosmic_v1::clamp_keyboard_shrink_pair(shrink, grow, amount, axis)
    }

    fn pair_min_for_axis(&self, axis: Axis) -> i64 {
        cosmic_v1::pair_min_for_axis(axis)
    }

    fn child_min_for_axis(&self, axis: Axis) -> i64 {
        cosmic_v1::child_min_for_axis(axis)
    }

    fn classify_window_point(&self, rect: &Rect, x: i32, y: i32) -> Option<DragSide> {
        cosmic_v1::classify_window_point(rect, x, y)
    }

    fn classify_group_point(
        &self,
        rect: &Rect,
        group: &NodeId,
        x: i32,
        y: i32,
        prior: Option<&PriorGroupEdge>,
    ) -> Option<DragSide> {
        cosmic_v1::classify_group_point(rect, group, x, y, prior)
    }

    fn insertion_index_for_offset(&self, child_starts: &[i64], offset: i64) -> usize {
        cosmic_v1::insertion_index_for_offset(child_starts, offset)
    }
}

/// Default selected policy handle (COSMIC v1, the only implementation).
#[must_use]
pub fn default_policy() -> Arc<dyn LayoutPolicy> {
    Arc::new(CosmicV1Policy)
}
