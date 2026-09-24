//! Portable active-group membership/projection/intent (highlight query).
//!
//! Rust owns membership, projection, and intent: given the retained
//! focused-domain split tree, derive only the active focused leaf's immediate
//! parent [`Node::Group`], recursively include its descendant leaves, and
//! project them with the engine projector ([`crate::geometry::project`]).
//! Never consults native/client rectangles for topology: member rectangles
//! come solely from projection, and the group bounds is their checked union.
//! No timers, no Meta state, no polling/retry/fallback; no Qt/KWin types.
//! Fail-closed (`None`) on any invalid/missing/non-tiled focus, missing
//! domain/tree, root-leaf focus (no parent group), unmapped members,
//! projection failure, overflow, or bound violations.

use std::collections::{BTreeMap, BTreeSet};

use crate::bounds::is_opaque_id;
use crate::directional::{Node, NodeId, WindowId};
use crate::geometry::{Rect, project};

/// Opaque id bound (single source: [`crate::bounds`]).
pub const MAX_ACTIVE_GROUP_ID_LEN: usize = crate::bounds::MAX_OPAQUE_ID_LEN;

/// One projected group member: opaque window/leaf identities plus the
/// engine-projected rectangle (never a native/client rectangle).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveGroupMember {
    pub window: WindowId,
    pub leaf: NodeId,
    pub rect: Rect,
}

/// Portable active-group intent: the immediate parent group id, its
/// recursively collected members in projection order, and their checked
/// union bounds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveGroup {
    pub group: NodeId,
    pub members: Vec<ActiveGroupMember>,
    pub bounds: Rect,
}

/// Immediate parent [`Node::Group`] of the focused leaf: the direct container
/// whose children contain the focused leaf id. `None` for a root leaf (no
/// parent group) or an absent leaf.
pub fn immediate_parent_group<'a>(tree: &'a Node, focused_leaf: &NodeId) -> Option<&'a Node> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group { children, .. } => {
            if children.iter().any(|child| child.id() == focused_leaf) {
                return Some(tree);
            }
            children
                .iter()
                .filter_map(|child| immediate_parent_group(child, focused_leaf))
                .next()
        }
    }
}

fn collect_descendant_leaves(node: &Node, out: &mut Vec<NodeId>) {
    match node {
        Node::Leaf { id } => out.push(id.clone()),
        Node::Group { children, .. } => {
            for child in children {
                collect_descendant_leaves(child, out);
            }
        }
    }
}

fn union_rect(rects: &[Rect]) -> Option<Rect> {
    let mut min_x = i64::MAX;
    let mut min_y = i64::MAX;
    let mut max_r = i64::MIN;
    let mut max_b = i64::MIN;
    for rect in rects {
        if rect.w <= 0 || rect.h <= 0 {
            return None;
        }
        let right = i64::from(rect.x).checked_add(i64::from(rect.w))?;
        let bottom = i64::from(rect.y).checked_add(i64::from(rect.h))?;
        min_x = min_x.min(i64::from(rect.x));
        min_y = min_y.min(i64::from(rect.y));
        max_r = max_r.max(right);
        max_b = max_b.max(bottom);
    }
    let w = i32::try_from(max_r.checked_sub(min_x)?).ok()?;
    let h = i32::try_from(max_b.checked_sub(min_y)?).ok()?;
    if w <= 0 || h <= 0 {
        return None;
    }
    Some(Rect {
        x: i32::try_from(min_x).ok()?,
        y: i32::try_from(min_y).ok()?,
        w,
        h,
    })
}

/// Derive the focused leaf's immediate parent group with recursive
/// descendants projected through the engine projector.
///
/// - `tree` is the retained focused-domain split tree (authoritative).
/// - `bounds`/`gap` are the retained domain projection inputs.
/// - `leaf_to_window` maps every tiled leaf to its opaque window.
///
/// Fail-closed (`None`) on any invalid input, unmapped member, projection
/// failure, or bound violation. Member order follows projection order.
pub fn describe_active_group(
    tree: &Node,
    bounds: Rect,
    gap: i32,
    focused_leaf: &NodeId,
    leaf_to_window: &BTreeMap<NodeId, WindowId>,
) -> Option<ActiveGroup> {
    if focused_leaf.0.is_empty() || !is_opaque_id(&focused_leaf.0) {
        return None;
    }
    let parent = immediate_parent_group(tree, focused_leaf)?;
    let Node::Group { id: group_id, .. } = parent else {
        return None;
    };
    if !is_opaque_id(&group_id.0) {
        return None;
    }
    let mut descendant_leaves = Vec::new();
    collect_descendant_leaves(parent, &mut descendant_leaves);
    if descendant_leaves.len() < 2 {
        return None;
    }
    let descendant_set: BTreeSet<&NodeId> = descendant_leaves.iter().collect();
    if !descendant_set.contains(focused_leaf) {
        return None;
    }
    let projected = project(tree, bounds, gap).ok()?;
    let mut members = Vec::with_capacity(descendant_leaves.len());
    for entry in &projected {
        if !descendant_set.contains(&entry.leaf) {
            continue;
        }
        let window = leaf_to_window.get(&entry.leaf)?;
        if !is_opaque_id(&window.0) || !is_opaque_id(&entry.leaf.0) {
            return None;
        }
        if entry.rect.w <= 0 || entry.rect.h <= 0 {
            return None;
        }
        members.push(ActiveGroupMember {
            window: window.clone(),
            leaf: entry.leaf.clone(),
            rect: entry.rect,
        });
    }
    if members.len() != descendant_leaves.len() {
        return None;
    }
    let rects: Vec<Rect> = members.iter().map(|member| member.rect).collect();
    let bounds = union_rect(&rects)?;
    Some(ActiveGroup {
        group: group_id.clone(),
        members,
        bounds,
    })
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

    fn group(id: &str, axis: Axis, children: Vec<Node>) -> Node {
        let shares = vec![1u64; children.len()];
        Node::Group {
            id: NodeId::from(id),
            axis,
            children,
            shares,
        }
    }

    fn window_map(pairs: &[(&str, &str)]) -> BTreeMap<NodeId, WindowId> {
        pairs
            .iter()
            .map(|(leaf, window)| (NodeId::from(*leaf), WindowId::from(*window)))
            .collect()
    }

    fn bounds() -> Rect {
        Rect {
            x: 0,
            y: 0,
            w: 1200,
            h: 800,
        }
    }

    #[test]
    fn nested_membership_projects_through_engine() {
        // Root H [A | inner V [B | C]]; focus B resolves to inner only.
        let tree = group(
            "root",
            Axis::Horizontal,
            vec![
                leaf("a-leaf"),
                group(
                    "inner",
                    Axis::Vertical,
                    vec![leaf("b-leaf"), leaf("c-leaf")],
                ),
            ],
        );
        let map = window_map(&[
            ("a-leaf", "win-1"),
            ("b-leaf", "win-2"),
            ("c-leaf", "win-3"),
        ]);
        let group = describe_active_group(&tree, bounds(), 0, &NodeId::from("b-leaf"), &map)
            .expect("inner group resolves");
        assert_eq!(group.group, NodeId::from("inner"));
        assert_eq!(group.members.len(), 2);
        assert!(
            group
                .members
                .iter()
                .any(|m| m.window == WindowId::from("win-2"))
        );
        assert!(
            group
                .members
                .iter()
                .any(|m| m.window == WindowId::from("win-3"))
        );
        assert!(
            !group
                .members
                .iter()
                .any(|m| m.window == WindowId::from("win-1"))
        );
        // Engine projection: landscape bounds split left/right at the root,
        // inner stacks top/bottom. Union of B+C equals the inner segment.
        let projected = project(&tree, bounds(), 0).expect("projectable");
        let inner_rects: Vec<Rect> = projected
            .iter()
            .filter(|entry| entry.leaf.0 != "a-leaf")
            .map(|entry| entry.rect)
            .collect();
        assert_eq!(inner_rects.len(), 2);
        let union = union_rect(&inner_rects).expect("union");
        assert_eq!(group.bounds, union);
        assert_eq!(
            group.bounds,
            Rect {
                x: 600,
                y: 0,
                w: 600,
                h: 800
            }
        );
        for member in &group.members {
            assert!(member.rect.x >= group.bounds.x);
            assert!(member.rect.y >= group.bounds.y);
            assert!(member.rect.x + member.rect.w <= group.bounds.x + group.bounds.w);
            assert!(member.rect.y + member.rect.h <= group.bounds.y + group.bounds.h);
        }
    }

    #[test]
    fn root_leaf_has_no_parent_group() {
        let tree = leaf("solo");
        let map = window_map(&[("solo", "win-1")]);
        assert!(describe_active_group(&tree, bounds(), 0, &NodeId::from("solo"), &map).is_none());
        assert!(immediate_parent_group(&tree, &NodeId::from("solo")).is_none());
    }

    #[test]
    fn missing_or_unmapped_focus_clears() {
        let tree = group("root", Axis::Horizontal, vec![leaf("a"), leaf("b")]);
        let map = window_map(&[("a", "win-1"), ("b", "win-2")]);
        assert!(describe_active_group(&tree, bounds(), 0, &NodeId::from("ghost"), &map).is_none());
        assert!(describe_active_group(&tree, bounds(), 0, &NodeId::from(""), &map).is_none());
        let partial = window_map(&[("a", "win-1")]);
        assert!(describe_active_group(&tree, bounds(), 0, &NodeId::from("b"), &partial).is_none());
    }
}
