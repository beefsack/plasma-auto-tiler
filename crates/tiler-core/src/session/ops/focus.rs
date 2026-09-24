//! Session focus operations: directional, verification, and cross-output focus.
//!
//! Responsibility: own the focus `impl Session` family. World state,
//! shared projection/validation helpers, transaction mechanics, and tests
//! stay in the parent session module.

use super::super::*;

impl super::super::Session {
    /// Propose portable directional focus for the selected exact opaque
    /// `(domain, window)` pair.
    ///
    /// The supplied opaque [`WindowId`] must equal the authoritative logical
    /// focused tiled window in exactly `domain`; mismatch, unknown windows,
    /// or exception windows refuse without pending. The pure
    /// [`crate::directional::plan_focus`] tree-relative plan is wrapped as a
    /// capability-gated portable semantic [`FocusOperation`] with complete
    /// rectangles/topology (unmodified) and identity/revision/correlation/
    /// generation binding, then staged through the shared single reconciler
    /// slot: one pending acknowledgement then matching post-observation
    /// verification via [`Session::verify_focus`] before committing logical
    /// focus intent. Core holds no native commands. Exhausted edges report
    /// [`FocusPlan::Edge`] as [`RefusalKind::Unchanged`] with no plan and no
    /// pending. Stale, incomplete, malformed, pending, or unsupported-focus
    /// capability inputs refuse or diverge fail-closed.
    pub fn propose_focus(
        &mut self,
        domain: &DomainKey,
        window: &WindowId,
        direction: Direction,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &FocusCapabilities,
    ) -> Result<SessionFocusPlan, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if self.has_pending() {
            return Err(ProposeError::PendingExists);
        }
        if self.drag.is_some() {
            return Err(ProposeError::PendingExists);
        }
        if self.domains.iter().find(|d| &d.key() == domain).is_none() {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        }
        if !self.validate_current_topology() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        if window.0.is_empty() {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        if session_observation.windows.len() > MAX_OBSERVED_WINDOWS
            || !valid_observed_shapes(&session_observation.windows)
        {
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
        if !self.windows.contains_key(window) && !self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::UnknownWindow));
        }
        if self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        let (Some(focused_domain), Some(focused_leaf)) =
            (self.focused_domain.clone(), self.focused_leaf.clone())
        else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        if &focused_domain != domain {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        let Some(focused_window) = self.focused_window_for(&focused_leaf, domain) else {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        };
        if window != &focused_window {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        let Some(tree) = self.trees.get(domain).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        let Some(focus_plan) = crate::directional::plan_focus(&tree, &focused_leaf, direction)
        else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let (target_leaf, route) = match &focus_plan {
            FocusPlan::Focused { leaf, route } => (leaf.clone(), route.clone()),
            FocusPlan::Edge => {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            }
        };
        let Some(target_window) = self.focused_window_for(&target_leaf, domain) else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        if self.exceptions.contains_key(&target_window) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        if target_leaf == focused_leaf {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        if !capabilities.supports(crate::contract::FocusCapability::DirectionalFocus) {
            return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
        }
        // Complete geometry for the unmodified domain must project before any
        // pending is staged; failure refuses without pending.
        let desired_geometry = project_affected_geometry(
            &self.domains,
            &self.trees,
            &self.windows,
            std::slice::from_ref(domain),
            &hints_from_observed(&session_observation.windows),
        )
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !geometry_covers_affected(
            &desired_geometry,
            &self.windows,
            std::slice::from_ref(domain),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let intent = FocusIntent {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
        };
        let operation = FocusOperation {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            from_leaf: focused_leaf.clone(),
            to_leaf: target_leaf.clone(),
            from_window: focused_window.clone(),
            to_window: target_window.clone(),
            direction,
            route,
            cross_source_output: None,
            cross_source_workspace: None,
        };
        let plan = FocusPlanContract::for_operation(intent, operation);
        let dispatch = match self.reconciler.propose_focus(
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
        let desired_snapshot = self.snapshot_for(&self.trees, &self.windows);
        self.pending_desired = Some(PendingDesired {
            trees: self.trees.clone(),
            windows: self.windows.clone(),
            focused_domain: Some(domain.clone()),
            focused_leaf: Some(target_leaf.clone()),
            last_active: self.updated_last_active(
                &Some(domain.clone()),
                &Some(target_leaf.clone()),
                &self.trees,
                &self.windows,
            ),
            exceptions: self.exceptions.clone(),
            retained_float_geometry: self.retained_float_geometry.clone(),
        });
        Ok(SessionFocusPlan {
            dispatch,
            focus_plan,
            desired_snapshot,
            desired_focus_domain: domain.clone(),
            desired_focus_leaf: target_leaf,
            desired_geometry,
        })
    }

    /// Commit a pending focus plan after acknowledgement. On commit only the
    /// logical focus applies atomically (topology/windows/exceptions
    /// unmodified) and the accepted revision advances by exactly one.
    /// Terminal divergence clears the pending desired state. Movement plans
    /// must use [`Session::verify_move`]; lifecycle plans must use
    /// [`Session::verify_lifecycle`].
    pub fn verify_focus(&mut self, post: &FocusPostObservation) -> Result<Commit, VerifyError> {
        match self.reconciler.verify_focus(post) {
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
                    self.last_active = desired.last_active;
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

    /// Propose cross-output directional focus for an exhausted horizontal
    /// edge (`Meta+Left`/`Meta+Right` only).
    ///
    /// Source COSMIC default Vertical layout output axis only: after local
    /// [`crate::directional::plan_focus`] reports [`FocusPlan::Edge`] in
    /// `direction`, focus crosses to the horizontally adjacent output's
    /// currently selected logical workspace (its domain workspace, which may
    /// differ from the source workspace), then to that domain's valid
    /// last-focused tiled leaf/window. No layout/window mutation; only logical
    /// focus moves on commit via [`Session::verify_focus`].
    ///
    /// Fail-closed before any native action or pending: missing adjacency,
    /// ambiguous duplicate output ids, empty target, exceptional target
    /// window, stale/nonreciprocal target links, changed targets, pending,
    /// divergence, non-Left/Right directions, or a non-exhausted local edge
    /// (local focus wins) refuse as [`RefusalKind::Unchanged`]/[`NotTiled`]/
    /// [`PartialObservation`]/[`MalformedTopology`] with no plan and no
    /// pending. `Up`/`Down` always refuse [`RefusalKind::Unchanged`] (current
    /// local behavior preserved; no vertical crossing, no workspace cycling).
    pub fn propose_cross_output_focus(
        &mut self,
        domain: &DomainKey,
        window: &WindowId,
        direction: Direction,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &FocusCapabilities,
    ) -> Result<SessionFocusPlan, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if self.has_pending() {
            return Err(ProposeError::PendingExists);
        }
        if self.drag.is_some() {
            return Err(ProposeError::PendingExists);
        }
        if !matches!(direction, Direction::Left | Direction::Right) {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        if self.domains.iter().find(|d| &d.key() == domain).is_none() {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        }
        if !self.validate_current_topology() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        if window.0.is_empty() {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        if session_observation.windows.len() > MAX_OBSERVED_WINDOWS
            || !valid_observed_shapes(&session_observation.windows)
        {
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
        if !self.windows.contains_key(window) && !self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::UnknownWindow));
        }
        if self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        let (Some(focused_domain), Some(focused_leaf)) =
            (self.focused_domain.clone(), self.focused_leaf.clone())
        else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        if &focused_domain != domain {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        let Some(focused_window) = self.focused_window_for(&focused_leaf, domain) else {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        };
        if window != &focused_window {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        // Local focus must be exhausted: any local target wins (no cross).
        let Some(tree) = self.trees.get(domain).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        let Some(focus_plan) = crate::directional::plan_focus(&tree, &focused_leaf, direction)
        else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        if !matches!(focus_plan, FocusPlan::Edge) {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        // Adjacent output in D; exactly one domain must own that output id
        // (ambiguity fails closed).
        let source_domain = self
            .domains
            .iter()
            .find(|d| &d.key() == domain)
            .cloned()
            .expect("known");
        let Some(target_output) = source_domain.adjacent.get(&direction).cloned() else {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        };
        let mut candidates = self.domains.iter().filter(|d| d.id == target_output);
        let Some(target_domain) = candidates.next().cloned() else {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        };
        if candidates.next().is_some() {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        // Reciprocal adjacency required.
        if target_domain.adjacent.get(&opposite_direction(direction)) != Some(&domain.output) {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        let target_key = target_domain.key();
        // Target must be non-empty with a valid last-focused tiled leaf.
        let Some(target_tree) = self.trees.get(&target_key).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        };
        let _ = target_tree;
        let Some(target_leaf) = self.remembered_leaf(&target_key) else {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        };
        let Some(target_window) = self.focused_window_for(&target_leaf, &target_key) else {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        };
        if self.exceptions.contains_key(&target_window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        if !capabilities.supports(crate::contract::FocusCapability::DirectionalFocus) {
            return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
        }
        // Complete geometry for source plus target must project before any
        // pending is staged; failure refuses without pending.
        let affected = vec![domain.clone(), target_key.clone()];
        let desired_geometry = project_affected_geometry(
            &self.domains,
            &self.trees,
            &self.windows,
            &affected,
            &hints_from_observed(&session_observation.windows),
        )
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !geometry_covers_affected(&desired_geometry, &self.windows, &affected) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let intent = FocusIntent {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
        };
        let operation = FocusOperation {
            domain_output: target_key.output.clone(),
            domain_workspace: target_key.workspace.clone(),
            from_leaf: focused_leaf.clone(),
            to_leaf: target_leaf.clone(),
            from_window: focused_window.clone(),
            to_window: target_window.clone(),
            direction,
            route: vec![target_leaf.clone()],
            cross_source_output: Some(domain.output.clone()),
            cross_source_workspace: Some(domain.workspace.clone()),
        };
        let plan = FocusPlanContract::for_operation(intent, operation);
        let dispatch = match self.reconciler.propose_focus(
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
        let desired_snapshot = self.snapshot_for(&self.trees, &self.windows);
        self.pending_desired = Some(PendingDesired {
            trees: self.trees.clone(),
            windows: self.windows.clone(),
            focused_domain: Some(target_key.clone()),
            focused_leaf: Some(target_leaf.clone()),
            last_active: self.updated_last_active(
                &Some(target_key.clone()),
                &Some(target_leaf.clone()),
                &self.trees,
                &self.windows,
            ),
            exceptions: self.exceptions.clone(),
            retained_float_geometry: self.retained_float_geometry.clone(),
        });
        Ok(SessionFocusPlan {
            dispatch,
            focus_plan: FocusPlan::Focused {
                leaf: target_leaf.clone(),
                route: vec![target_leaf.clone()],
            },
            desired_snapshot,
            desired_focus_domain: target_key,
            desired_focus_leaf: target_leaf,
            desired_geometry,
        })
    }
}
