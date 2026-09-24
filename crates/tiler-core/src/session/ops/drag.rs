//! Session drag operations: capture, preview, release, snap-back, and verification.
//!
//! Responsibility: own the drag `impl Session` family. World state,
//! shared projection/validation helpers, transaction mechanics, and tests
//! stay in the parent session module.

use super::super::*;

impl super::super::Session {
    /// Commit a pending drag plan after acknowledgement. On commit the pending
    /// desired topology applies atomically (windows/exceptions unmodified, focus
    /// preserved on the moved window) and the accepted revision advances by
    /// exactly one. Terminal divergence clears the pending desired state.
    /// Movement plans must use [`Session::verify_move`]; lifecycle plans must
    /// use [`Session::verify_lifecycle`]; focus plans must use
    /// [`Session::verify_focus`]; resize plans must use
    /// [`Session::verify_resize`].
    pub fn verify_drag(&mut self, post: &DragPostObservation) -> Result<Commit, VerifyError> {
        match self.reconciler.verify_drag(post) {
            Ok(commit) => {
                if let Some(desired) = self.pending_desired.take() {
                    self.trees = desired.trees;
                    self.windows = desired.windows;
                    self.focused_domain = desired.focused_domain;
                    self.focused_leaf = desired.focused_leaf;
                    self.focus_stack = self.updated_focus_stack(
                        &self.focused_domain,
                        &self.focused_leaf,
                        &self.trees,
                        &self.windows,
                    );
                    self.exceptions = desired.exceptions;
                    self.retained_float_geometry = desired.retained_float_geometry;
                    self.accepted_fingerprint = commit.fingerprint;
                }
                Ok(commit)
            }
            Err(VerifyError::Diverged(reason)) => {
                self.pending_desired = None;
                self.drag = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Whether a transient drag capture is active.
    #[must_use]
    pub fn has_drag(&self) -> bool {
        self.drag.is_some()
    }

    /// Begin a product-facing drag for the authoritative logical focused tiled
    /// window `window`.
    ///
    /// Captures the source domain/leaf, the accepted revision/generation, the
    /// current topology/membership/focus, and the projected source/work-area
    /// geometry preconditions. Alters no authoritative topology, stages no
    /// reconciler pending slot, and emits no native commands. Active drags,
    /// reconciler pending plans, unknown or exception windows, focus mismatches
    /// (the source must be the focused tiled window), cross-domain or partial
    /// observations, and malformed or unprojectable states refuse fail-closed.
    /// Observation identity mismatches (owner/generation/revision) refuse as
    /// malformed without touching the shared reconciler; revision freshness at
    /// release is enforced by [`Session::drop_drag`] through it.
    pub fn begin_drag(
        &mut self,
        window: &WindowId,
        session_observation: &SessionObservation,
    ) -> Result<DragCapture, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if self.has_pending() || self.drag.is_some() {
            return Err(ProposeError::PendingExists);
        }
        if !self.validate_current_topology() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        if window.0.is_empty() {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        if !valid_observed_shapes(&session_observation.windows) {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        for entry in &session_observation.windows {
            if self.domain_for(&entry.output, &entry.workspace).is_none() {
                return Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch));
            }
        }
        let known: BTreeSet<&WindowId> =
            self.windows.keys().chain(self.exceptions.keys()).collect();
        let observed_ids: BTreeSet<&WindowId> = session_observation
            .windows
            .iter()
            .map(|w| &w.window)
            .collect();
        if observed_ids != known {
            return Err(ProposeError::Refused(RefusalKind::PartialObservation));
        }
        if !self.observed_known_match(&session_observation.windows, None) {
            return Err(ProposeError::Refused(RefusalKind::PartialObservation));
        }
        if session_observation.observation.owner != self.owner
            || session_observation.observation.generation != self.generation
            || session_observation.observation.revision != self.accepted_revision()
        {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        if self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        let Some(link) = self.windows.get(window).cloned() else {
            return Err(ProposeError::Refused(RefusalKind::UnknownWindow));
        };
        let key = DomainKey {
            output: link.output.clone(),
            workspace: link.workspace.clone(),
        };
        if self.domains.iter().find(|d| d.key() == key).is_none() {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        }
        // The drag source must be the authoritative logical focused tiled
        // window in its domain; focus is preserved on it through release.
        if self.focused_domain.as_ref() != Some(&key)
            || self.focused_leaf.as_ref() != Some(&link.leaf)
        {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        if let Some(entry) = session_observation
            .windows
            .iter()
            .find(|w| &w.window == window)
            && entry.flags().any()
        {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        let Some(domain) = self.domains.iter().find(|d| d.key() == key).cloned() else {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        };
        let tree = self.trees.get(&key).cloned().flatten();
        let geometry = project_output_geometry(
            Some(&domain),
            tree.as_ref(),
            &self.windows,
            &key,
            &hints_from_observed(&session_observation.windows),
        )
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        let Some(source_rect) = geometry
            .iter()
            .find(|g| g.leaf == link.leaf)
            .map(|g| g.rect)
        else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let revision = self.accepted_revision();
        self.drag = Some(DragState {
            domain: key.clone(),
            source_leaf: link.leaf.clone(),
            source_window: window.clone(),
            revision,
            generation: self.generation.clone(),
            trees: self.trees.clone(),
            windows: self.windows.clone(),
            exceptions: self.exceptions.clone(),
            focused_domain: self.focused_domain.clone(),
            focused_leaf: self.focused_leaf.clone(),
            source_rect,
            work_area: domain.bounds,
            prior: None,
        });
        Ok(DragCapture {
            domain: key,
            source_leaf: link.leaf,
            source_window: window.clone(),
            revision,
            source_rect,
            work_area: domain.bounds,
        })
    }

    /// Drag preview for the active capture at logical pointer coordinates
    /// `(x, y)`.
    ///
    /// Uses the shared portable resolver identically to [`Session::drop_drag`]:
    /// group nodes classify via source `classify_group_point` with the stored
    /// portable prior hover (sticky 80/32; smallest `PriorGroupEdge` in
    /// `DragState` only), leaf nodes via source `classify_window_point`.
    /// GroupEdge resolves same-axis N-ary first/last or perpendicular wrapping;
    /// GroupInterior resolves the source predecessor plus `min(len, idx+1)`;
    /// window edges retain source split semantics; center (stack fact) fails
    /// as explicit unsupported with no preview. Self refuses as Unchanged;
    /// out-of-area refuses as CrossDomainMismatch. On a resolved target the
    /// stored prior updates (GroupEdge sets it, all other targets clear it);
    /// stale captures refuse as MalformedTopology. Stages nothing and touches
    /// no reconciler state.
    pub fn preview_drag(&mut self, x: i32, y: i32) -> Result<DragPreview, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if !self.validate_current_topology() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let capture_snapshot = self
            .drag
            .clone()
            .ok_or(ProposeError::Refused(RefusalKind::MalformedInput))?;
        if drag_capture_stale(self, &capture_snapshot) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let Some(current) = self.trees.get(&capture_snapshot.domain).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let Some(domain) = self
            .domains
            .iter()
            .find(|d| d.key() == capture_snapshot.domain)
            .cloned()
        else {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        };
        let resolved = match resolve_drag_shared(
            self.policy(),
            &current,
            &domain,
            &self.windows,
            &self.exceptions,
            &capture_snapshot,
            x,
            y,
        ) {
            Ok(resolved) => resolved,
            Err(ProposeError::Refused(kind)) => {
                if let Some(drag) = self.drag.as_mut() {
                    drag.prior = None;
                }
                return Err(ProposeError::Refused(kind));
            }
            Err(other) => return Err(other),
        };
        if let Some(drag) = self.drag.as_mut() {
            drag.prior = resolved.next_prior.clone();
        }
        let placement = resolved.placement;
        if placement.tree == current {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        let mut desired_trees = self.trees.clone();
        desired_trees.insert(
            capture_snapshot.domain.clone(),
            Some(placement.tree.clone()),
        );
        let desired_geometry = project_affected_geometry(
            &self.domains,
            &desired_trees,
            &self.windows,
            std::slice::from_ref(&capture_snapshot.domain),
            // Preview-only projection over retained state (no observation in
            // scope): hints stay empty, exactly as before.
            &BTreeMap::new(),
        )
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        let Some(proposed_rect) = desired_geometry
            .iter()
            .find(|g| g.leaf == capture_snapshot.source_leaf)
            .map(|g| g.rect)
        else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        Ok(DragPreview {
            domain: capture_snapshot.domain.clone(),
            source_leaf: capture_snapshot.source_leaf.clone(),
            source_window: capture_snapshot.source_window.clone(),
            source_rect: capture_snapshot.source_rect,
            target_leaf: resolved.target_leaf,
            target_window: resolved.target_window,
            target_rect: resolved.target_rect,
            proposed_rect,
            side: resolved.side,
            axis: resolved.axis,
            before: resolved.before,
            wrap: placement.wrap,
            target_group: placement.target_group,
            insertion_index: placement.insertion_index,
        })
    }

    /// Release the active drag at logical pointer coordinates `(x, y)`.
    ///
    /// Recomputes the same deterministic result as [`Session::preview_drag`]
    /// through the shared resolver (group rects/child starts, sticky prior
    /// hover, GroupEdge first/last or wrapping, GroupInterior predecessor
    /// plus `min(len, idx+1)`, window split semantics, center unsupported),
    /// then freshly validates the begin capture plus the supplied observation
    /// (source/target/domain/membership/projected geometry/revision) and the
    /// required drag capability through the shared one-pending reconciler slot
    /// before emitting a complete structural/focus/geometry [`SessionDragPlan`]
    /// (focus preserved on the moved window). Edge drops need
    /// [`crate::contract::DragCapability::PlaceTiled`]; center (source stack
    /// fact) fails closed as [`RefusalKind::UnsupportedCapability`] with no
    /// plan and no commit. No topology commits until the
    /// existing acknowledgement plus a matching drag post-observation complete
    /// via [`Session::verify_drag`]; refusal, partial, mismatch, or loss paths
    /// diverge fail-closed through shared reconciler semantics. Self,
    /// out-of-area, and no-op releases are invalid: they clear only the
    /// transient drag state and return a portable no-structure snap-back with
    /// the accepted source rect, without touching the reconciler. Once an
    /// active capture is loaded with no competing pending plan, every other
    /// non-divergent invalid-release validation failure (malformed, partial,
    /// or cross-domain observed shape; invalid capture, topology, or geometry;
    /// unsupported edge-drop capability) also clears only the transient drag and
    /// returns a snap-back; terminal reconciler owner, generation, revision,
    /// correlation, and capability divergences stay terminal errors. The stored
    /// prior updates after a resolved target before the terminal clear.
    pub fn drop_drag(
        &mut self,
        x: i32,
        y: i32,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &DragCapabilities,
    ) -> Result<DragRelease, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            self.pending_desired = None;
            self.drag = None;
            return Err(ProposeError::Diverged(reason));
        }
        let Some(capture) = self.drag.clone() else {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        };
        if self.has_pending() {
            return Err(ProposeError::PendingExists);
        }
        if !self.validate_current_topology() {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        if !valid_observed_shapes(&session_observation.windows) {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        for entry in &session_observation.windows {
            if self.domain_for(&entry.output, &entry.workspace).is_none() {
                return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
            }
        }
        let known: BTreeSet<&WindowId> =
            self.windows.keys().chain(self.exceptions.keys()).collect();
        let observed_ids: BTreeSet<&WindowId> = session_observation
            .windows
            .iter()
            .map(|w| &w.window)
            .collect();
        if observed_ids != known {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        if !self.observed_known_match(&session_observation.windows, None) {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        // The begin capture still binds the live session: no revision,
        // generation, topology, membership, or focus drift is accepted between
        // begin and drop (prior hover excluded: it evolves across previews).
        // Stale captures snap back so no permanently unusable capture remains.
        if drag_capture_stale(self, &capture) {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        // Shared resolution identical to preview; refused points snap back,
        // center fails as unsupported with no plan.
        let Some(current) = self.trees.get(&capture.domain).cloned().flatten() else {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        };
        let Some(domain) = self
            .domains
            .iter()
            .find(|d| d.key() == capture.domain)
            .cloned()
        else {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        };
        let resolved = match resolve_drag_shared(
            self.policy(),
            &current,
            &domain,
            &self.windows,
            &self.exceptions,
            &capture,
            x,
            y,
        ) {
            Ok(resolved) => {
                if let Some(drag) = self.drag.as_mut() {
                    drag.prior = resolved.next_prior.clone();
                }
                resolved
            }
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability)) => {
                self.drag = None;
                return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
            }
            Err(ProposeError::Refused(_)) => {
                return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
            }
            Err(ProposeError::Diverged(reason)) => {
                self.pending_desired = None;
                self.drag = None;
                return Err(ProposeError::Diverged(reason));
            }
            Err(other) => return Err(other),
        };
        if !capabilities.supports(crate::contract::DragCapability::PlaceTiled) {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        let placement = resolved.placement;
        if placement.tree == current {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        let mut desired_trees = self.trees.clone();
        desired_trees.insert(capture.domain.clone(), Some(placement.tree));
        if !validate_topology(
            &self.domains,
            &desired_trees,
            &self.windows,
            &self.exceptions,
            &Some(capture.domain.clone()),
            &Some(capture.source_leaf.clone()),
        ) {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        let desired_geometry = match project_affected_geometry(
            &self.domains,
            &desired_trees,
            &self.windows,
            std::slice::from_ref(&capture.domain),
            &hints_from_observed(&session_observation.windows),
        ) {
            Ok(geometry) => geometry,
            Err(_) => {
                return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
            }
        };
        if !geometry_covers_affected(
            &desired_geometry,
            &self.windows,
            std::slice::from_ref(&capture.domain),
        ) {
            return Ok(DragRelease::SnapBack(self.clear_drag_snap_back(&capture)));
        }
        let intent = DragIntent {
            domain_output: capture.domain.output.clone(),
            domain_workspace: capture.domain.workspace.clone(),
            source_leaf: capture.source_leaf.clone(),
            source_window: capture.source_window.clone(),
            target_leaf: resolved.target_leaf.clone(),
            target_window: resolved.target_window.clone(),
            side: resolved.side,
        };
        let operation = DragOperation {
            domain_output: capture.domain.output.clone(),
            domain_workspace: capture.domain.workspace.clone(),
            source_leaf: capture.source_leaf.clone(),
            source_window: capture.source_window.clone(),
            target_leaf: resolved.target_leaf.clone(),
            target_window: resolved.target_window.clone(),
            side: resolved.side,
            axis: resolved.axis,
            before: resolved.before,
            target_group: placement.target_group.clone(),
            insertion_index: placement.insertion_index,
            wrap: placement.wrap,
            new_group: placement.new_group.clone(),
        };
        let plan = DragPlan::for_operation(intent, operation);
        let dispatch = match self.reconciler.propose_drag(
            &plan,
            &session_observation.observation,
            correlation_id,
            capabilities,
        ) {
            Ok(dispatch) => dispatch,
            Err(crate::reconcile::ProposeError::PendingExists) => {
                return Err(ProposeError::PendingExists);
            }
            Err(crate::reconcile::ProposeError::Diverged(reason)) => {
                self.pending_desired = None;
                self.drag = None;
                return Err(ProposeError::Diverged(reason));
            }
        };
        let desired_snapshot = self.snapshot_for(&desired_trees, &self.windows);
        self.pending_desired = Some(PendingDesired {
            trees: desired_trees.clone(),
            windows: self.windows.clone(),
            focused_domain: Some(capture.domain.clone()),
            focused_leaf: Some(capture.source_leaf.clone()),
            last_active: self.last_active.clone(),
            exceptions: self.exceptions.clone(),
            retained_float_geometry: self.retained_float_geometry.clone(),
        });
        self.drag = None;
        Ok(DragRelease::Planned(Box::new(SessionDragPlan {
            dispatch,
            drag_plan: plan,
            desired_snapshot,
            desired_focus_domain: capture.domain,
            desired_focus_leaf: capture.source_leaf,
            desired_geometry,
        })))
    }

    /// Cancel the active drag, clearing only transient drag state and returning
    /// a portable no-structure snap-back with the accepted source rect. Never
    /// mutates topology and never touches the reconciler pending slot. Returns
    /// `None` when no drag is active.
    pub fn cancel_drag(&mut self) -> Option<DragSnapBack> {
        let capture = self.drag.clone()?;
        Some(self.clear_drag_snap_back(&capture))
    }

    pub(in crate::session) fn clear_drag_snap_back(&mut self, capture: &DragState) -> DragSnapBack {
        // The accepted source rect is re-projected so cancel reflects accepted
        // state; the captured rect is the fail-closed fallback.
        let rect = self
            .domains
            .iter()
            .find(|d| d.key() == capture.domain)
            .and_then(|domain| {
                let tree = self.trees.get(&capture.domain).cloned().flatten();
                project_output_geometry(
                    Some(domain),
                    tree.as_ref(),
                    &self.windows,
                    &capture.domain,
                    // Snap-back reflects accepted state (no observation in
                    // scope): hints stay empty, exactly as before.
                    &BTreeMap::new(),
                )
                .ok()
            })
            .and_then(|geometry| {
                geometry
                    .iter()
                    .find(|g| g.leaf == capture.source_leaf)
                    .map(|g| g.rect)
            })
            .unwrap_or(capture.source_rect);
        self.drag = None;
        DragSnapBack {
            domain: capture.domain.clone(),
            source_leaf: capture.source_leaf.clone(),
            source_window: capture.source_window.clone(),
            source_rect: rect,
        }
    }
}

/// Shared drag resolution outcome (preview and drop agree): the portable
/// target identities/rect, the edge (window edges and group edges carry the
/// source edge; group interior carries the canonical group-axis edge
/// Left/Top with the interior `insertion_index` distinguishing it from the
/// first/last edge slots), the derived axis/order, the placement, and the
/// next portable prior hover (Some only for a resolved GroupEdge).
pub(in crate::session) struct SharedDragResolved {
    target_leaf: NodeId,
    target_window: WindowId,
    target_rect: Rect,
    side: DragSide,
    axis: Axis,
    before: bool,
    placement: DragPlacement,
    next_prior: Option<crate::policy::PriorGroupEdge>,
}

/// Deterministic drag placement: the new domain tree plus the resolved
/// operation bindings (`target_group`/`insertion_index`/`wrap`/`new_group`).
pub(in crate::session) struct DragPlacement {
    pub(in crate::session) tree: Node,
    pub(in crate::session) target_group: NodeId,
    pub(in crate::session) insertion_index: usize,
    pub(in crate::session) wrap: bool,
    pub(in crate::session) new_group: Option<NodeId>,
}

pub(in crate::session) fn contains_point(rect: &Rect, x: i32, y: i32) -> bool {
    x >= rect.x
        && y >= rect.y
        && x.checked_sub(rect.x).is_some_and(|dx| dx < rect.w)
        && y.checked_sub(rect.y).is_some_and(|dy| dy < rect.h)
}

/// Stale-capture check excluding the evolving prior hover: revision,
/// generation, topology, membership, and focus must match live session state.
pub(in crate::session) fn drag_capture_stale(session: &Session, capture: &DragState) -> bool {
    capture.revision != session.accepted_revision()
        || capture.generation != session.generation
        || session.trees != capture.trees
        || session.windows != capture.windows
        || session.exceptions != capture.exceptions
        || session.focused_domain != capture.focused_domain
        || session.focused_leaf != capture.focused_leaf
}

/// Shared portable drag resolver used identically by preview and drop.
///
/// Projects group rects (union of descendant leaves) and ordered child starts
/// without native data, walks to the deepest containing node (group or leaf),
/// then classifies: group nodes via source `classify_group_point` with the
/// portable prior hover (sticky 80/32), leaf nodes via source
/// `classify_window_point`. GroupEdge resolves same-axis N-ary first/last or
/// perpendicular group wrapping; GroupInterior resolves the source
/// predecessor plus `min(len, idx + 1)`; window edges retain source split
/// semantics; center (window stack fact) returns Unsupported with no plan.
/// Self hits return Unchanged; out-of-area returns CrossDomainMismatch.
#[allow(clippy::too_many_arguments)]
pub(in crate::session) fn resolve_drag_shared(
    policy: &dyn LayoutPolicy,
    tree: &Node,
    domain: &OutputDomain,
    windows: &BTreeMap<WindowId, WindowLink>,
    exceptions: &BTreeMap<WindowId, ExceptionRecord>,
    capture: &DragState,
    x: i32,
    y: i32,
) -> Result<SharedDragResolved, ProposeError> {
    let area = capture.work_area;
    if x < area.x
        || y < area.y
        || x.checked_sub(area.x).is_none_or(|dx| dx >= area.w)
        || y.checked_sub(area.y).is_none_or(|dy| dy >= area.h)
    {
        return Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch));
    }
    let projected = crate::geometry::project(tree, domain.bounds, domain.gap)
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
    let mut leaf_rects: BTreeMap<NodeId, Rect> = BTreeMap::new();
    for leaf in &projected {
        leaf_rects.insert(leaf.leaf.clone(), leaf.rect);
    }
    let layouts = drag_group_layouts(tree, &leaf_rects);
    let layout_by_id: BTreeMap<&NodeId, &GroupLayout> =
        layouts.iter().map(|l| (&l.id, l)).collect();
    // Deepest-node group resolution (source update_pointer_position descent):
    // group targets resolve only for group-only (gap) points so window edges
    // retain source split semantics; group edge/interior classification uses
    // the stored portable prior hover.
    // Deepest containing node walk (mirrors update_pointer_position descent
    // through child geometries containing the pointer) for window vs interior.
    let mut current_id = tree.id().clone();
    loop {
        let Some(node) = find_subtree(tree, &current_id) else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        match node {
            Node::Leaf { .. } => break,
            Node::Group { children, .. } => {
                let mut next: Option<NodeId> = None;
                for child in children {
                    let contains = match child {
                        Node::Leaf { id } => {
                            leaf_rects.get(id).is_some_and(|r| contains_point(r, x, y))
                        }
                        Node::Group { id, .. } => layout_by_id
                            .get(id)
                            .is_some_and(|l| contains_point(&l.rect, x, y)),
                    };
                    if contains {
                        next = Some(child.id().clone());
                        break;
                    }
                }
                match next {
                    Some(id) => current_id = id,
                    None => break,
                }
            }
        }
    }
    let Some(target_node) = find_subtree(tree, &current_id) else {
        return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
    };
    match target_node {
        Node::Group { .. } => {
            // Group-only (gap) point: sticky source edge first, else interior.
            let layout = layout_by_id
                .get(&current_id)
                .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
            if let Some(edge) =
                policy.classify_group_point(&layout.rect, &layout.id, x, y, capture.prior.as_ref())
            {
                let rep = group_rep_window(
                    tree,
                    &layout.id,
                    windows,
                    &capture.source_window,
                    &capture.domain,
                )
                .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
                if exceptions.contains_key(&rep) {
                    return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
                }
                let (Some(axis), Some(before)) = (edge.axis(), edge.before()) else {
                    return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
                };
                let placement = apply_group_edge_placement(
                    policy,
                    tree,
                    &capture.source_leaf,
                    &layout.id,
                    edge,
                    capture.revision,
                )
                .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
                return Ok(SharedDragResolved {
                    target_leaf: layout.id.clone(),
                    target_window: rep,
                    target_rect: layout.rect,
                    side: edge,
                    axis,
                    before,
                    placement,
                    next_prior: Some(crate::policy::PriorGroupEdge {
                        group: layout.id.clone(),
                        edge,
                    }),
                });
            }
            // GroupInterior: source predecessor plus min(len, idx+1) at drop.
            let offset = match layout.axis {
                Axis::Horizontal => i64::from(x),
                Axis::Vertical => i64::from(y),
            };
            let predecessor = policy.insertion_index_for_offset(&layout.child_starts, offset);
            let rep = group_rep_window(
                tree,
                &layout.id,
                windows,
                &capture.source_window,
                &capture.domain,
            )
            .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
            if exceptions.contains_key(&rep) {
                return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
            }
            let placement = apply_group_interior_placement(
                policy,
                tree,
                &capture.source_leaf,
                &layout.id,
                predecessor,
                capture.revision,
            )
            .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
            // Canonical interior edge carries the group axis (Left/Top);
            // the interior insertion_index distinguishes it from edge slots.
            let side = match layout.axis {
                Axis::Horizontal => DragSide::Left,
                Axis::Vertical => DragSide::Top,
            };
            let (Some(axis), Some(before)) = (side.axis(), side.before()) else {
                return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
            };
            Ok(SharedDragResolved {
                target_leaf: layout.id.clone(),
                target_window: rep,
                target_rect: layout.rect,
                side,
                axis,
                before,
                placement,
                next_prior: None,
            })
        }
        Node::Leaf { id } => {
            if id == &capture.source_leaf {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            }
            let rect = leaf_rects
                .get(id)
                .copied()
                .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
            let Some(side) = policy.classify_window_point(&rect, x, y) else {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            };
            if side.is_stack() {
                return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
            }
            let target_window = windows
                .values()
                .find(|l| {
                    l.leaf == *id
                        && l.output == capture.domain.output
                        && l.workspace == capture.domain.workspace
                })
                .map(|l| l.window.clone())
                .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
            if exceptions.contains_key(&target_window) {
                return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
            }
            let (Some(axis), Some(before)) = (side.axis(), side.before()) else {
                return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
            };
            let placement = apply_drag_placement(
                policy,
                tree,
                &capture.source_leaf,
                id,
                side,
                capture.revision,
            )
            .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
            Ok(SharedDragResolved {
                target_leaf: id.clone(),
                target_window,
                target_rect: rect,
                side,
                axis,
                before,
                placement,
                next_prior: None,
            })
        }
    }
}

pub(in crate::session) fn generate_drag_group_id(
    source_leaf: &NodeId,
    base_revision: u64,
    existing: &BTreeSet<NodeId>,
) -> NodeId {
    let base = format!("grp-{}-r{}-drag", source_leaf.0, base_revision);
    if !existing.contains(&NodeId(base.clone())) {
        return NodeId(base);
    }
    let mut n = 1u32;
    loop {
        let candidate = NodeId(format!("{base}-{n}"));
        if !existing.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Deterministically place `source_leaf` onto `target_leaf`'s edge `side`
/// (edges only; center never reaches here).
///
/// Removes the source first (recursively collapsing emptied/single-child
/// groups with proportional shares), then either inserts it as an ordered
/// N-ary sibling via proportional shares in the target parent when that
/// parent runs along the drop axis, or wraps only the target subtree in a new
/// smallest 2-child split ordered before/after by side. Unaffected subtree
/// order/identity/shares are preserved; wraps carry `[1, 1]` with the wrapper
/// inheriting the target share slot. Returns `None` when the target cannot
/// resolve or `side` is center; callers compare against the input tree to
/// refuse no-op placements as unchanged.
pub(in crate::session) fn apply_drag_placement(
    policy: &dyn LayoutPolicy,
    tree: &Node,
    source_leaf: &NodeId,
    target_leaf: &NodeId,
    side: DragSide,
    base_revision: u64,
) -> Option<DragPlacement> {
    if source_leaf == target_leaf {
        return None;
    }
    let (Some(axis), Some(before)) = (side.axis(), side.before()) else {
        return None;
    };
    let mover = Node::Leaf {
        id: source_leaf.clone(),
    };
    // Remove the source first; collapse is recursive inside.
    let working = remove_leaf_from_tree(policy, Some(tree.clone()), source_leaf)?;
    if collect_leaves(&working).contains(source_leaf) {
        return None;
    }
    if !collect_leaves(&working).contains(target_leaf) {
        return None;
    }
    let mut node_ids = BTreeSet::new();
    collect_node_ids(&working, &mut node_ids);
    // Same-axis insert when the post-removal target parent runs along the
    // drop axis; otherwise wrap only the target subtree.
    let parent = direct_parent_of_leaf(&working, target_leaf);
    if let Some(parent_id) = parent {
        let (children, parent_axis) = match find_group(&working, &parent_id) {
            Some((children, axis, _)) => (children, axis),
            None => return None,
        };
        if parent_axis == axis {
            let index = children.iter().position(|c| c.id() == target_leaf)?;
            let insertion_index = if before { index } else { index + 1 };
            if insertion_index > children.len() {
                return None;
            }
            let updated =
                insert_leaf_into_group(policy, working, &parent_id, insertion_index, mover)?;
            return Some(DragPlacement {
                tree: updated,
                target_group: parent_id,
                insertion_index,
                wrap: false,
                new_group: None,
            });
        }
    }
    // Perpendicular: wrap only the target subtree in a new 2-child split.
    // New-group shares come from the cosmic_v1 policy (equal-halves source
    // behavior adapted to N-ary integer shares).
    let new_id = generate_drag_group_id(source_leaf, base_revision, &node_ids);
    let new_shares = policy.new_group_shares().to_vec();
    let wrapper = if before {
        Node::Group {
            id: new_id.clone(),
            axis,
            children: vec![
                mover,
                Node::Leaf {
                    id: target_leaf.clone(),
                },
            ],
            shares: new_shares,
        }
    } else {
        Node::Group {
            id: new_id.clone(),
            axis,
            children: vec![
                Node::Leaf {
                    id: target_leaf.clone(),
                },
                mover,
            ],
            shares: policy.new_group_shares().to_vec(),
        }
    };
    if working.id() == target_leaf {
        return Some(DragPlacement {
            tree: wrapper,
            target_group: target_leaf.clone(),
            insertion_index: 0,
            wrap: true,
            new_group: Some(new_id),
        });
    }
    let parent_id = direct_parent_of_leaf(&working, target_leaf)?;
    let (children, shares) = match find_group(&working, &parent_id) {
        Some((children, _, _)) => {
            let shares = find_group_shares(&working, &parent_id)?;
            (children, shares)
        }
        None => return None,
    };
    let index = children.iter().position(|c| c.id() == target_leaf)?;
    let target_share = *shares.get(index)?;
    let updated = replace_child_at(&working, &parent_id, index, wrapper, target_share)?;
    Some(DragPlacement {
        tree: updated,
        target_group: parent_id,
        insertion_index: index,
        wrap: true,
        new_group: Some(new_id),
    })
}

/// Portable group layout derived without native data: the group bounding rect
/// (union of descendant projected leaves, including interior gaps) plus the
/// ordered child start edges along the group axis (absolute, ascending, one
/// per child, each the minimum origin among that child's descendant leaves).
pub(in crate::session) struct GroupLayout {
    pub(in crate::session) id: NodeId,
    pub(in crate::session) axis: Axis,
    pub(in crate::session) rect: Rect,
    pub(in crate::session) child_starts: Vec<i64>,
}

pub(in crate::session) fn drag_group_layouts(
    tree: &Node,
    leaf_rects: &BTreeMap<NodeId, Rect>,
) -> Vec<GroupLayout> {
    let mut out = Vec::new();
    collect_group_layouts(tree, leaf_rects, &mut out);
    out
}

pub(in crate::session) fn collect_group_layouts(
    node: &Node,
    leaf_rects: &BTreeMap<NodeId, Rect>,
    out: &mut Vec<GroupLayout>,
) {
    if let Node::Group {
        id, axis, children, ..
    } = node
    {
        let mut leaves: Vec<NodeId> = Vec::new();
        collect_leaves_into(node, &mut leaves);
        let mut min_x: Option<i64> = None;
        let mut min_y: Option<i64> = None;
        let mut max_x: Option<i64> = None;
        let mut max_y: Option<i64> = None;
        for leaf in &leaves {
            let Some(rect) = leaf_rects.get(leaf) else {
                continue;
            };
            let x0 = i64::from(rect.x);
            let y0 = i64::from(rect.y);
            let x1 = x0 + i64::from(rect.w);
            let y1 = y0 + i64::from(rect.h);
            min_x = Some(min_x.map_or(x0, |m| m.min(x0)));
            min_y = Some(min_y.map_or(y0, |m| m.min(y0)));
            max_x = Some(max_x.map_or(x1, |m| m.max(x1)));
            max_y = Some(max_y.map_or(y1, |m| m.max(y1)));
        }
        if let (Some(x0), Some(y0), Some(x1), Some(y1)) = (min_x, min_y, max_x, max_y) {
            let rect = Rect {
                x: i32::try_from(x0).unwrap_or(i32::MIN),
                y: i32::try_from(y0).unwrap_or(i32::MIN),
                w: i32::try_from(x1 - x0).unwrap_or(0),
                h: i32::try_from(y1 - y0).unwrap_or(0),
            };
            let mut child_starts = Vec::with_capacity(children.len());
            for child in children {
                let mut c_leaves = Vec::new();
                collect_leaves_into(child, &mut c_leaves);
                let mut start: Option<i64> = None;
                for leaf in &c_leaves {
                    let Some(r) = leaf_rects.get(leaf) else {
                        continue;
                    };
                    let s = match axis {
                        Axis::Horizontal => i64::from(r.x),
                        Axis::Vertical => i64::from(r.y),
                    };
                    start = Some(start.map_or(s, |m| m.min(s)));
                }
                child_starts.push(start.unwrap_or(0));
            }
            out.push(GroupLayout {
                id: id.clone(),
                axis: *axis,
                rect,
                child_starts,
            });
        }
        for child in children {
            collect_group_layouts(child, leaf_rects, out);
        }
    }
}

/// Representative member window for a group target (first non-source leaf
/// window in traversal order). Keeps `DragOperation.target_window`
/// non-empty and distinct from the source without native data.
pub(in crate::session) fn group_rep_window(
    tree: &Node,
    group: &NodeId,
    windows: &BTreeMap<WindowId, WindowLink>,
    source_window: &WindowId,
    domain: &DomainKey,
) -> Option<WindowId> {
    let node = find_subtree(tree, group)?;
    let leaves = collect_leaves(node);
    for leaf in leaves {
        let Some(link) = windows.values().find(|l| {
            l.leaf == leaf && l.output == domain.output && l.workspace == domain.workspace
        }) else {
            continue;
        };
        if &link.window != source_window {
            return Some(link.window.clone());
        }
    }
    None
}

/// Source `drop_window` GroupEdge placement (2666-2824): same-axis N-ary
/// first/last insertion via proportional shares, perpendicular wrapping of
/// the whole group in a new smallest 2-child split ordered by side.
pub(in crate::session) fn apply_group_edge_placement(
    policy: &dyn LayoutPolicy,
    tree: &Node,
    source_leaf: &NodeId,
    group_id: &NodeId,
    side: DragSide,
    base_revision: u64,
) -> Option<DragPlacement> {
    let (Some(axis), Some(before)) = (side.axis(), side.before()) else {
        return None;
    };
    if source_leaf == group_id {
        return None;
    }
    let mover = Node::Leaf {
        id: source_leaf.clone(),
    };
    let working = remove_leaf_from_tree(policy, Some(tree.clone()), source_leaf)?;
    if collect_leaves(&working).contains(source_leaf) {
        return None;
    }
    let (children, shares, gid, group_axis) = find_group_full(&working, group_id)?;
    debug_assert_eq!(&gid, group_id);
    if children.is_empty() {
        return None;
    }
    let _ = shares;
    let mut node_ids = BTreeSet::new();
    collect_node_ids(&working, &mut node_ids);
    if group_axis == axis {
        let insertion_index = if before { 0 } else { children.len() };
        let updated = insert_leaf_into_group(policy, working, group_id, insertion_index, mover)?;
        return Some(DragPlacement {
            tree: updated,
            target_group: group_id.clone(),
            insertion_index,
            wrap: false,
            new_group: None,
        });
    }
    // Perpendicular: wrap the whole group, preserving its slot/share.
    let new_id = generate_drag_group_id(source_leaf, base_revision, &node_ids);
    let new_shares = policy.new_group_shares().to_vec();
    let group_node = find_subtree(&working, group_id)?.clone();
    let wrapper = if before {
        Node::Group {
            id: new_id.clone(),
            axis,
            children: vec![mover, group_node],
            shares: new_shares,
        }
    } else {
        Node::Group {
            id: new_id.clone(),
            axis,
            children: vec![group_node, mover],
            shares: policy.new_group_shares().to_vec(),
        }
    };
    if working.id() == group_id {
        return Some(DragPlacement {
            tree: wrapper,
            target_group: group_id.clone(),
            insertion_index: 0,
            wrap: true,
            new_group: Some(new_id),
        });
    }
    let parent_id = parent_of_group(&working, group_id)?;
    let (siblings, parent_shares) = match find_group(&working, &parent_id) {
        Some((children, _, _)) => {
            let shares = find_group_shares(&working, &parent_id)?;
            (children, shares)
        }
        None => return None,
    };
    let index = siblings.iter().position(|c| c.id() == group_id)?;
    let target_share = *parent_shares.get(index)?;
    let updated = replace_child_at(&working, &parent_id, index, wrapper, target_share)?;
    Some(DragPlacement {
        tree: updated,
        target_group: parent_id,
        insertion_index: index,
        wrap: true,
        new_group: Some(new_id),
    })
}

/// Source `drop_window` GroupInterior placement (2725-2730): insert at
/// `min(len, idx + 1)` where `idx` is the source predecessor from
/// `insertion_index_for_offset` and `len` is the post-removal group length.
pub(in crate::session) fn apply_group_interior_placement(
    policy: &dyn LayoutPolicy,
    tree: &Node,
    source_leaf: &NodeId,
    group_id: &NodeId,
    predecessor: usize,
    base_revision: u64,
) -> Option<DragPlacement> {
    if source_leaf == group_id {
        return None;
    }
    let mover = Node::Leaf {
        id: source_leaf.clone(),
    };
    let working = remove_leaf_from_tree(policy, Some(tree.clone()), source_leaf)?;
    if collect_leaves(&working).contains(source_leaf) {
        return None;
    }
    let (children, _, _, _) = find_group_full(&working, group_id)?;
    let len = children.len();
    let insertion_index = len.min(predecessor.saturating_add(1));
    if insertion_index > len {
        return None;
    }
    let _ = base_revision;
    let updated = insert_leaf_into_group(policy, working, group_id, insertion_index, mover)?;
    Some(DragPlacement {
        tree: updated,
        target_group: group_id.clone(),
        insertion_index,
        wrap: false,
        new_group: None,
    })
}
