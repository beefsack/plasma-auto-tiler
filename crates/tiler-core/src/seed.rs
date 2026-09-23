//! Serde-free near-layout fitting and seed ordering for session rebuilds.
//!
//! Portable typed boundary over adapter-normalized integer geometry: no
//! transport, JSON, or platform imports. [`EngineWindow`] is the smallest
//! coherent observation carrier (window/output/workspace identity plus the
//! carried frame rectangle and fit flags). Ordering, revision-adjacent seed
//! sequence identity (`fit-l{i}`/`fit-g0`), focus-last handling, and
//! outer-gap handling (via the already-inset [`OutputDomain::bounds`]) match
//! the planner protocol behavior exactly.

use crate::directional::{Axis, Node, NodeId, OutputId, WindowId, WindowLink, WorkspaceId};
use crate::geometry::{Rect, project};
use crate::session::{MAX_OBSERVED_WINDOWS, OutputDomain};

/// Bounded carried-geometry extent (mirrors the planner wire bound).
const GEOMETRY_BOUND: i32 = 16384;

/// Serde-free observed window for seed ordering and strip fitting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineWindow {
    pub window: WindowId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub rect: Rect,
    pub floating: bool,
    pub fit_excluded: bool,
}

fn valid_carried_rect(x: i32, y: i32, w: i32, h: i32) -> bool {
    w > 0
        && h > 0
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&x)
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&y)
        && w <= GEOMETRY_BOUND
        && h <= GEOMETRY_BOUND
        && (i64::from(x) + i64::from(w) <= i64::from(i32::MAX))
        && (i64::from(y) + i64::from(h) <= i64::from(i32::MAX))
}

fn rect_contained(inner: Rect, outer: Rect) -> bool {
    let inner_right = i64::from(inner.x) + i64::from(inner.w);
    let inner_bottom = i64::from(inner.y) + i64::from(inner.h);
    let outer_right = i64::from(outer.x) + i64::from(outer.w);
    let outer_bottom = i64::from(outer.y) + i64::from(outer.h);
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner_right <= outer_right
        && inner_bottom <= outer_bottom
}

/// Deterministic near-strip fit over the current admission's complete
/// carried rectangles.
///
/// A simple best-effort project policy, not topology reconstruction and not
/// exact recognition: succeeds only when every non-excluded rectangle is
/// valid, contained in the already-inset domain, and non-overlapping, plus
/// one axis has unambiguous sequential primary intervals. A horizontal
/// near-strip sorts by the existing `(x, y, w, h)` key and needs each
/// carried positive x interval strictly non-overlapping and sequential
/// (`previous.x + previous.w <= next.x`), regardless of domain edge offsets,
/// cross-axis drift, or the observed inter-window gap; vertical mirrors by
/// sorting on `(y, x, h, w)` and checking `previous.y + previous.h <=
/// next.y`. A single window stays on the normal path (`None`).
///
/// Each supported axis builds one ordered flat N-ary `Node::Group` along
/// that axis with the observed primary spans (`w` horizontal, `h` vertical)
/// as shares, then projects it with the existing
/// `project(domain.bounds, domain.gap)` as the canonical valid complete
/// result with the configured gap. No exact input reprojection is required.
/// When both axes support, the fixed Horizontal tie-break applies. Anything
/// else returns `None` for the normal deterministic seed/reflow. Grids,
/// nested, and T arrangements with primary-interval overlap on both axes are
/// normal unsupported fallback, not fitted topology. Topology decisions use
/// only rectangle geometry (never opaque window ids); leaf/group ids are
/// safe internal deterministic index names.
#[must_use]
pub fn try_flat_strip_fit(
    domain: &OutputDomain,
    windows: &[EngineWindow],
) -> Option<(Node, Vec<WindowLink>)> {
    if windows.len() < 2 || windows.len() > MAX_OBSERVED_WINDOWS {
        return None;
    }
    if windows.iter().any(|w| w.floating || w.fit_excluded) {
        return None;
    }
    let mut items: Vec<(WindowId, Rect)> = Vec::with_capacity(windows.len());
    for entry in windows {
        let rect = entry.rect;
        if !valid_carried_rect(rect.x, rect.y, rect.w, rect.h) {
            return None;
        }
        if !rect_contained(rect, domain.bounds) {
            return None;
        }
        items.push((entry.window.clone(), rect));
    }
    for i in 0..items.len() {
        for (_, other) in items.iter().skip(i + 1) {
            let (a, b) = (items[i].1, *other);
            if a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h {
                return None;
            }
        }
    }
    // One axis attempt: sort by the existing geometry key, require strictly
    // non-overlapping sequential primary intervals with no tolerance knobs,
    // then project one flat N-ary group with observed primary spans as
    // shares. Edge offsets, cross-axis drift, and observed gaps never gate
    // support; the configured-gap projection is the canonical result.
    fn strip_candidate(
        domain: &OutputDomain,
        items: &[(WindowId, Rect)],
        axis: Axis,
    ) -> Option<(Node, Vec<WindowLink>)> {
        let mut ordered: Vec<(WindowId, Rect)> = items.to_vec();
        match axis {
            Axis::Horizontal => ordered.sort_by_key(|a| (a.1.x, a.1.y, a.1.w, a.1.h)),
            Axis::Vertical => ordered.sort_by_key(|a| (a.1.y, a.1.x, a.1.h, a.1.w)),
        }
        for pair in ordered.windows(2) {
            let (previous, next) = (pair[0].1, pair[1].1);
            match axis {
                Axis::Horizontal => {
                    if i64::from(previous.x) + i64::from(previous.w) > i64::from(next.x) {
                        return None;
                    }
                }
                Axis::Vertical => {
                    if i64::from(previous.y) + i64::from(previous.h) > i64::from(next.y) {
                        return None;
                    }
                }
            }
        }
        let shares: Vec<u64> = ordered
            .iter()
            .map(|(_, rect)| match axis {
                Axis::Horizontal => rect.w as u64,
                Axis::Vertical => rect.h as u64,
            })
            .collect();
        if shares.contains(&0) {
            return None;
        }
        let children: Vec<Node> = (0..ordered.len())
            .map(|i| Node::Leaf {
                id: NodeId(format!("fit-l{i}")),
            })
            .collect();
        let tree = Node::Group {
            id: NodeId("fit-g0".to_owned()),
            axis,
            children,
            shares,
        };
        let projected = project(&tree, domain.bounds, domain.gap).ok()?;
        if projected.len() != ordered.len() {
            return None;
        }
        let links: Vec<WindowLink> = ordered
            .iter()
            .enumerate()
            .map(|(index, (window, _))| WindowLink {
                window: window.clone(),
                leaf: NodeId(format!("fit-l{index}")),
                output: domain.id.clone(),
                workspace: domain.workspace.clone(),
            })
            .collect();
        Some((tree, links))
    }
    let horizontal = strip_candidate(domain, &items, Axis::Horizontal);
    let vertical = strip_candidate(domain, &items, Axis::Vertical);
    match (horizontal, vertical) {
        // Fixed Horizontal tie-break keeps the choice deterministic when both
        // interval orders support a near strip.
        (Some(h), Some(_)) => Some(h),
        (Some(h), None) => Some(h),
        (None, Some(v)) => Some(v),
        (None, None) => None,
    }
}

/// Admission seed order: spatial `(y, x, h, w)` sort with the focused window
/// last.
///
/// Stable sorting preserves the adapter's observation order when carried
/// rectangles tie during admission. Admission assigns new geometry, so an
/// uninformative incoming rectangle must not reject the other members. When
/// `allow_tied_observations` is false (non-admission rebuilds reconstructing
/// existing tiled state), equal frame rectangles on non-focused windows lack
/// a safe topology signal and fail closed with `None`.
#[must_use]
pub fn order_spatial_with_focus_last(
    mut windows: Vec<EngineWindow>,
    focused: &WindowId,
    allow_tied_observations: bool,
) -> Option<Vec<EngineWindow>> {
    if !allow_tied_observations {
        // Non-admission rebuilds reconstruct existing tiled state, so equal
        // frame rectangles still lack a safe topology signal.
        for (index, left) in windows.iter().enumerate() {
            if &left.window == focused {
                continue;
            }
            if windows[index + 1..].iter().any(|right| {
                &right.window != focused
                    && left.rect.x == right.rect.x
                    && left.rect.y == right.rect.y
                    && left.rect.w == right.rect.w
                    && left.rect.h == right.rect.h
            }) {
                return None;
            }
        }
    }
    // Stable sorting preserves the adapter's observation order when carried
    // rectangles tie during admission. Admission assigns new geometry, so an
    // uninformative incoming rectangle must not reject the other members.
    windows.sort_by(
        |left, right| match (&left.window == focused, &right.window == focused) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => (left.rect.y, left.rect.x, left.rect.h, left.rect.w).cmp(&(
                right.rect.y,
                right.rect.x,
                right.rect.h,
                right.rect.w,
            )),
        },
    );
    Some(windows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn window(id: &str, x: i32, y: i32, w: i32, h: i32) -> EngineWindow {
        EngineWindow {
            window: WindowId(id.to_owned()),
            output: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            rect: Rect { x, y, w, h },
            floating: false,
            fit_excluded: false,
        }
    }

    fn domain() -> OutputDomain {
        OutputDomain {
            id: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 300,
                h: 100,
            },
            gap: 0,
            adjacent: BTreeMap::new(),
        }
    }

    #[test]
    fn horizontal_strip_orders_by_x_with_deterministic_ids() {
        let domain = domain();
        let windows = vec![window("b", 100, 0, 100, 100), window("a", 0, 0, 100, 100)];
        let (tree, links) = try_flat_strip_fit(&domain, &windows).expect("horizontal strip fits");
        match &tree {
            Node::Group { axis, shares, .. } => {
                assert_eq!(*axis, Axis::Horizontal);
                assert_eq!(*shares, vec![100, 100]);
            }
            Node::Leaf { .. } => panic!("expected group"),
        }
        assert_eq!(links[0].window.0, "a");
        assert_eq!(links[0].leaf.0, "fit-l0");
        assert_eq!(links[1].window.0, "b");
        assert_eq!(links[1].leaf.0, "fit-l1");
    }

    #[test]
    fn overlapping_rects_decline_fitting() {
        let domain = domain();
        let windows = vec![window("a", 0, 0, 200, 100), window("b", 100, 0, 200, 100)];
        assert!(try_flat_strip_fit(&domain, &windows).is_none());
    }

    #[test]
    fn focus_sorts_last_with_spatial_order() {
        let focused = WindowId("focus".to_owned());
        let windows = vec![
            window("focus", 0, 0, 10, 10),
            window("b", 50, 0, 10, 10),
            window("a", 20, 0, 10, 10),
        ];
        let ordered =
            order_spatial_with_focus_last(windows, &focused, true).expect("admission orders");
        let ids: Vec<&str> = ordered.iter().map(|w| w.window.0.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "focus"]);
    }

    #[test]
    fn tied_non_focused_rects_fail_closed_without_admission() {
        let focused = WindowId("focus".to_owned());
        let windows = vec![
            window("a", 0, 0, 10, 10),
            window("b", 0, 0, 10, 10),
            window("focus", 50, 0, 10, 10),
        ];
        assert!(order_spatial_with_focus_last(windows, &focused, false).is_none());
    }
}
