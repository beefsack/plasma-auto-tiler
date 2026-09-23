//! Session workspace operations: same-output send-to-workspace transfer.
//!
//! Responsibility: own the workspace `impl Session` family. World state,
//! shared projection/validation helpers, transaction mechanics, and tests
//! stay in the parent session module.

use super::super::*;

impl super::super::Session {
    /// Propose a portable same-output send-to-workspace transfer of the
    /// keyboard-focused tiled window into an explicit target workspace domain.
    ///
    /// Source: `cosmic-comp` `SendToWorkspace` calls `Shell::move_current`
    /// with no window id and moves only the focused element; `move_element`
    /// unmaps the source (recursive collapse) then maps the tiled element in
    /// the target. The portable gate mirrors [`Session::propose_move`]:
    /// unknown windows refuse as `UnknownWindow`, exception windows or an
    /// unresolved focused leaf as `NotTiled`, and a missing global focus or
    /// requested non-focused tile as `FocusMismatch`. The source domain must
    /// equal the focused domain before mutation.
    ///
    /// Target placement follows `map_to_tree` (`direction=None`): the
    /// remembered destination last-active leaf splits when still linked
    /// there (axis from its projected rect), else the root/output-bounds
    /// fallback applies; empty targets admit a lone root.
    ///
    /// Only same-output, distinct-workspace targets plan. Same-domain targets
    /// refuse as [`RefusalKind::Unchanged`], cross-output targets as
    /// [`RefusalKind::CrossDomainMismatch`], unknown targets as
    /// [`RefusalKind::UnknownDomain`]. The mover keeps its leaf identity with
    /// a retargeted link; legacy numbered sends follow the moved window, so
    /// focus moves to the mover leaf in the target domain on commit.
    /// Plans commit only via acknowledge-then-[`Session::verify_lifecycle`]
    /// with complete source-plus-target geometry.
    #[allow(clippy::too_many_lines)]
    pub(in crate::session) fn propose_move_to_workspace(
        &mut self,
        window: &WindowId,
        target_output: &OutputId,
        target_workspace: &WorkspaceId,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &LifecycleCapabilities,
    ) -> Result<SessionPlan, ProposeError> {
        // Completeness: observed must equal the known tiled-plus-exception
        // set (the transfer adds/removes no window identity).
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
        // Exact propose_move-style focus gate: only the keyboard-focused
        // tiled element moves.
        if !self.windows.contains_key(window) && !self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::UnknownWindow));
        }
        if self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        let link = self.windows.get(window).cloned().expect("tiled link");
        let source_key = DomainKey {
            output: link.output.clone(),
            workspace: link.workspace.clone(),
        };
        let (Some(focused_domain), Some(focused_leaf)) =
            (self.focused_domain.clone(), self.focused_leaf.clone())
        else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        if focused_domain != source_key {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        let Some(focused_window) = self.focused_window_for(&focused_leaf, &source_key) else {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        };
        if window != &focused_window {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        let target_key = DomainKey {
            output: target_output.clone(),
            workspace: target_workspace.clone(),
        };
        if target_key == source_key {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        let Some(target_domain) = self.domains.iter().find(|d| d.key() == target_key).cloned()
        else {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        };
        if target_key.output != source_key.output {
            return Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch));
        }
        let base_revision = session_observation.observation.revision;
        // Source removal with recursive collapse.
        let source_tree = self.trees.get(&source_key).cloned().flatten();
        if !source_tree
            .as_ref()
            .is_some_and(|tree| collect_leaves(tree).contains(&link.leaf))
        {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let new_source = remove_leaf_from_tree(self.policy(), source_tree, &link.leaf);
        if let Some(ref tree) = new_source
            && collect_leaves(tree).contains(&link.leaf)
        {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        // COSMIC `map_to_tree` splits the destination last-active leaf when
        // still linked there, else the root/output-geometry fallback applies.
        let remembered = self.remembered_leaf(&target_key);
        let target_tree = self.trees.get(&target_key).cloned().flatten();
        let axis = remembered
            .as_ref()
            .and_then(|leaf| {
                project_output_geometry(
                    Some(&target_domain),
                    target_tree.as_ref(),
                    &self.windows,
                    &target_key,
                )
                .ok()?
                .into_iter()
                .find(|g| &g.leaf == leaf)
                .map(|g| self.policy().admission_axis_for_rect(&g.rect))
            })
            .unwrap_or_else(|| self.policy().admission_axis_for_rect(&target_domain.bounds));
        let mut node_ids = self.all_node_ids();
        let new_target = insert_tiled(
            self.policy(),
            target_tree,
            remembered.as_ref(),
            link.leaf.clone(),
            axis,
            &mut node_ids,
            window,
            base_revision,
        )
        .ok_or(ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !collect_leaves(&new_target).contains(&link.leaf) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let mut desired_trees = self.trees.clone();
        desired_trees.insert(source_key.clone(), new_source);
        desired_trees.insert(target_key.clone(), Some(new_target));
        let mut desired_windows = self.windows.clone();
        desired_windows.insert(
            window.clone(),
            WindowLink {
                window: window.clone(),
                leaf: link.leaf.clone(),
                output: target_key.output.clone(),
                workspace: target_key.workspace.clone(),
            },
        );
        // Legacy numbered-send follow: the moved window becomes focused in
        // the target domain on commit. Rust remains the structural authority;
        // the adapter follows only this desired focus after an exact accepted
        // ack plus a matching verified post-observation.
        let (desired_focus_domain, desired_focus_leaf) =
            (Some(target_key.clone()), Some(link.leaf.clone()));
        if !validate_topology(
            &self.domains,
            &desired_trees,
            &desired_windows,
            &self.exceptions,
            &desired_focus_domain,
            &desired_focus_leaf,
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let affected = vec![source_key.clone(), target_key.clone()];
        let desired_geometry =
            project_affected_geometry(&self.domains, &desired_trees, &desired_windows, &affected)
                .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !geometry_covers_affected(&desired_geometry, &desired_windows, &affected) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let desired_snapshot = self.snapshot_for(&desired_trees, &desired_windows);
        let intent = LifecycleIntent::MoveToWorkspace {
            window: window.clone(),
            target_output: target_key.output.clone(),
            target_workspace: target_key.workspace.clone(),
        };
        let operation = LifecycleOperation::MoveTiled {
            window: window.clone(),
            leaf: link.leaf.clone(),
            source_output: source_key.output.clone(),
            source_workspace: source_key.workspace.clone(),
            target_output: target_key.output.clone(),
            target_workspace: target_key.workspace.clone(),
        };
        let plan = LifecyclePlan::for_operation(intent, operation);
        let dispatch = match self.reconciler.propose_lifecycle(
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
        self.pending_desired = Some(PendingDesired {
            trees: desired_trees.clone(),
            windows: desired_windows.clone(),
            focused_domain: desired_focus_domain.clone(),
            focused_leaf: desired_focus_leaf.clone(),
            last_active: self.updated_last_active(
                &desired_focus_domain,
                &desired_focus_leaf,
                &desired_trees,
                &desired_windows,
            ),
            exceptions: self.exceptions.clone(),
            retained_float_geometry: self.retained_float_geometry.clone(),
        });
        Ok(SessionPlan {
            dispatch,
            desired_snapshot,
            desired_focus_domain,
            desired_focus_leaf,
            desired_geometry,
        })
    }
}
