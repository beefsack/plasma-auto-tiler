//! Portable shared bounds and pure predicates.
//!
//! Single portable source for wire/core geometry and identity gates that
//! previously drifted across `seed`, `engine`/`active_group`, and the planner
//! protocol layer. No transport, JSON, platform, or process imports; only
//! [`crate::geometry::Rect`] plus `std`. Validation order, admissibility, and
//! error messages stay at the call sites; this only owns the shared numbers
//! and the byte-identical pure checks.

use crate::geometry::Rect;

/// Observed-window vector bound.
pub const MAX_OBSERVED_WINDOWS: usize = 64;
/// Opaque id bound.
pub const MAX_OPAQUE_ID_LEN: usize = 128;
/// Bounded carried-geometry extent.
pub const GEOMETRY_BOUND: i32 = 16384;
/// Bounded gap extent for carried work-area geometry (inner and outer).
pub const MAX_GAP: i32 = 64;

/// Opaque id gate: non-empty bounded token over `[A-Za-z0-9-_.]`.
#[must_use]
pub fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_OPAQUE_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Carried rectangle gate over adapter-normalized integer geometry.
#[must_use]
pub fn valid_carried_rect(x: i32, y: i32, w: i32, h: i32) -> bool {
    w > 0
        && h > 0
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&x)
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&y)
        && w <= GEOMETRY_BOUND
        && h <= GEOMETRY_BOUND
        && (i64::from(x) + i64::from(w) <= i64::from(i32::MAX))
        && (i64::from(y) + i64::from(h) <= i64::from(i32::MAX))
}

/// Containment gate with checked `i64` edges.
#[must_use]
pub fn rect_contained(inner: Rect, outer: Rect) -> bool {
    let inner_right = i64::from(inner.x) + i64::from(inner.w);
    let inner_bottom = i64::from(inner.y) + i64::from(inner.h);
    let outer_right = i64::from(outer.x) + i64::from(outer.w);
    let outer_bottom = i64::from(outer.y) + i64::from(outer.h);
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner_right <= outer_right
        && inner_bottom <= outer_bottom
}

/// Gap gate: non-negative and within the shared bound.
#[must_use]
pub fn is_gap(value: i32) -> bool {
    (0..=MAX_GAP).contains(&value)
}
