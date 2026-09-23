//! Per-domain pending pair transactions owned by [`crate::engine::Engine`].
//!
//! Portable, serde-free retained state for the standalone workspace-send and
//! directional R4 cross-output routes. Each pending keeps its own independent
//! two-domain [`Session`] (never merged across routes), base/request
//! revisions, identity binding, desired geometry, outer gaps, and the exact
//! dispatch-time pre-image. The pre-image crosses as [`EngineWindow`] sets
//! plus a [`WindowId`] focus (never DTOs): matching is order-insensitive but
//! otherwise exact over window/output/workspace/rectangle/flags.
//!
//! This module owns no wire parsing and no fences beyond its pure match
//! predicates: identity/correlation/revision binding, scope binding,
//! ack/verify dispatch ordering, and reply serialization stay in protocol.

use std::collections::HashMap;

use crate::directional::{MoveOperation, Precondition, WindowId};
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::seed::{EngineWindow, workspace_post_matches};
use crate::session::{DesiredGeometry, DomainKey, Session};

/// One retained pending two-domain workspace-send session.
///
/// Bound to owner/generation/correlation/base revision; no owner rebind during
/// pending. `request_revision` is the revision the dispatching request
/// carried (distinct from the seeded `base_revision`); cancellation must echo
/// it, never a base learned from a stale probe.
#[derive(Debug, Clone)]
pub struct WorkspacePending {
    owner: OwnerId,
    generation: GenerationId,
    correlation: CorrelationId,
    base_revision: u64,
    request_revision: u64,
    session: Session,
    desired_geometry: Vec<DesiredGeometry>,
    pre_focused: WindowId,
    pre_windows: Vec<EngineWindow>,
    pre_target_windows: Vec<EngineWindow>,
}

impl WorkspacePending {
    /// Retain a staged workspace transaction with its dispatch-time pre-image.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn new(
        owner: OwnerId,
        generation: GenerationId,
        correlation: CorrelationId,
        base_revision: u64,
        request_revision: u64,
        session: Session,
        desired_geometry: Vec<DesiredGeometry>,
        pre_focused: WindowId,
        pre_windows: Vec<EngineWindow>,
        pre_target_windows: Vec<EngineWindow>,
    ) -> Self {
        Self {
            owner,
            generation,
            correlation,
            base_revision,
            request_revision,
            session,
            desired_geometry,
            pre_focused,
            pre_windows,
            pre_target_windows,
        }
    }

    /// Retained owner binding.
    #[must_use]
    pub fn owner(&self) -> &OwnerId {
        &self.owner
    }

    /// Retained generation binding.
    #[must_use]
    pub fn generation(&self) -> &GenerationId {
        &self.generation
    }

    /// Retained correlation binding.
    #[must_use]
    pub fn correlation(&self) -> &CorrelationId {
        &self.correlation
    }

    /// Seeded base revision the ack/verify/status path must echo.
    #[must_use]
    pub fn base_revision(&self) -> u64 {
        self.base_revision
    }

    /// Dispatching request revision the cancel path must echo.
    #[must_use]
    pub fn request_revision(&self) -> u64 {
        self.request_revision
    }

    /// Borrow the retained two-domain session.
    #[must_use]
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// Mutably borrow the retained two-domain session.
    #[must_use]
    pub fn session_mut(&mut self) -> &mut Session {
        &mut self.session
    }

    /// Retained desired geometry (the exact expected post-observation).
    #[must_use]
    pub fn desired_geometry(&self) -> &[DesiredGeometry] {
        &self.desired_geometry
    }

    /// Dispatch-time focused window.
    #[must_use]
    pub fn pre_focused(&self) -> &WindowId {
        &self.pre_focused
    }

    /// Dispatch-time source window set.
    #[must_use]
    pub fn pre_windows(&self) -> &[EngineWindow] {
        &self.pre_windows
    }

    /// Dispatch-time target window set.
    #[must_use]
    pub fn pre_target_windows(&self) -> &[EngineWindow] {
        &self.pre_target_windows
    }

    /// Complete post-observation validation against the retained plan: every
    /// desired window must be carried exactly once (source plus target) with
    /// the expected output, workspace, and rectangle.
    #[must_use]
    pub fn post_matches(&self, source: &[EngineWindow], target: &[EngineWindow]) -> bool {
        workspace_post_matches(&self.desired_geometry, source, target)
    }

    /// Dispatch-time pre-image equality: focus plus the complete source/target
    /// window sets, order-insensitive but otherwise exact.
    #[must_use]
    pub fn pre_image_matches(
        &self,
        focused: &WindowId,
        windows: &[EngineWindow],
        target_windows: &[EngineWindow],
    ) -> bool {
        pre_image_matches_engine(
            &self.pre_focused,
            &self.pre_windows,
            &self.pre_target_windows,
            focused,
            windows,
            target_windows,
        )
    }
}

/// One retained pending two-domain directional R4 cross-output move.
///
/// Bound to owner/generation/correlation/base revision plus the source/target
/// pair keys and outer gaps; no owner rebind during pending and no new
/// topology seeding. R1-R3 never stage this pending and stay synchronous.
#[derive(Debug, Clone)]
pub struct DirectionalMovePending {
    owner: OwnerId,
    generation: GenerationId,
    correlation: CorrelationId,
    base_revision: u64,
    request_revision: u64,
    session: Session,
    source_key: DomainKey,
    target_key: DomainKey,
    source_outer_gap: i32,
    target_outer_gap: i32,
    desired_geometry: Vec<DesiredGeometry>,
    operation: MoveOperation,
    preconditions: Vec<Precondition>,
    pre_focused: WindowId,
    pre_windows: Vec<EngineWindow>,
}

impl DirectionalMovePending {
    /// Retain a staged R4 pair transaction with its dispatch-time pre-image.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn new(
        owner: OwnerId,
        generation: GenerationId,
        correlation: CorrelationId,
        base_revision: u64,
        request_revision: u64,
        session: Session,
        source_key: DomainKey,
        target_key: DomainKey,
        source_outer_gap: i32,
        target_outer_gap: i32,
        desired_geometry: Vec<DesiredGeometry>,
        operation: MoveOperation,
        preconditions: Vec<Precondition>,
        pre_focused: WindowId,
        pre_windows: Vec<EngineWindow>,
    ) -> Self {
        Self {
            owner,
            generation,
            correlation,
            base_revision,
            request_revision,
            session,
            source_key,
            target_key,
            source_outer_gap,
            target_outer_gap,
            desired_geometry,
            operation,
            preconditions,
            pre_focused,
            pre_windows,
        }
    }

    /// Retained owner binding.
    #[must_use]
    pub fn owner(&self) -> &OwnerId {
        &self.owner
    }

    /// Retained generation binding.
    #[must_use]
    pub fn generation(&self) -> &GenerationId {
        &self.generation
    }

    /// Retained correlation binding.
    #[must_use]
    pub fn correlation(&self) -> &CorrelationId {
        &self.correlation
    }

    /// Seeded base revision the ack/verify/status path must echo.
    #[must_use]
    pub fn base_revision(&self) -> u64 {
        self.base_revision
    }

    /// Dispatching request revision the cancel path must echo.
    #[must_use]
    pub fn request_revision(&self) -> u64 {
        self.request_revision
    }

    /// Borrow the retained pair session.
    #[must_use]
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// Mutably borrow the retained pair session.
    #[must_use]
    pub fn session_mut(&mut self) -> &mut Session {
        &mut self.session
    }

    /// Retained source pair key.
    #[must_use]
    pub fn source_key(&self) -> &DomainKey {
        &self.source_key
    }

    /// Retained target pair key.
    #[must_use]
    pub fn target_key(&self) -> &DomainKey {
        &self.target_key
    }

    /// Retained source outer gap.
    #[must_use]
    pub fn source_outer_gap(&self) -> i32 {
        self.source_outer_gap
    }

    /// Retained target outer gap.
    #[must_use]
    pub fn target_outer_gap(&self) -> i32 {
        self.target_outer_gap
    }

    /// Retained desired geometry (the exact expected post-observation).
    #[must_use]
    pub fn desired_geometry(&self) -> &[DesiredGeometry] {
        &self.desired_geometry
    }

    /// Retained R4 operation the verify echo must bind exactly.
    #[must_use]
    pub fn operation(&self) -> &MoveOperation {
        &self.operation
    }

    /// Retained preconditions the verify echo must bind exactly.
    #[must_use]
    pub fn preconditions(&self) -> &[Precondition] {
        &self.preconditions
    }

    /// Dispatch-time focused window.
    #[must_use]
    pub fn pre_focused(&self) -> &WindowId {
        &self.pre_focused
    }

    /// Dispatch-time combined (source plus target homed) window set.
    #[must_use]
    pub fn pre_windows(&self) -> &[EngineWindow] {
        &self.pre_windows
    }

    /// Complete directional post-observation validation against the retained
    /// R4 plan: every desired window must be carried exactly once with the
    /// expected output, workspace, and rectangle.
    #[must_use]
    pub fn post_matches(&self, observed: &[EngineWindow]) -> bool {
        directional_post_matches_engine(&self.desired_geometry, observed)
    }

    /// Dispatch-time pre-image equality over the combined window set.
    #[must_use]
    pub fn pre_image_matches(&self, focused: &WindowId, windows: &[EngineWindow]) -> bool {
        pre_image_matches_engine(
            &self.pre_focused,
            &self.pre_windows,
            &[],
            focused,
            windows,
            &[],
        )
    }

    /// Whether an observed scope touches either key of this live pair: the
    /// request domain key, any carried directional domain key, or (for the
    /// workspace route) a target domain homed on either pair key.
    #[must_use]
    pub fn affects(
        &self,
        domain_key: &DomainKey,
        directional_keys: Option<&[DomainKey]>,
        target: Option<(&str, &str)>,
    ) -> bool {
        if *domain_key == self.source_key || *domain_key == self.target_key {
            return true;
        }
        if let Some(keys) = directional_keys {
            for key in keys {
                if *key == self.source_key || *key == self.target_key {
                    return true;
                }
            }
        }
        if let Some((output, workspace)) = target
            && ((output == self.source_key.output.0.as_str()
                && workspace == self.source_key.workspace.0.as_str())
                || (output == self.target_key.output.0.as_str()
                    && workspace == self.target_key.workspace.0.as_str()))
        {
            return true;
        }
        false
    }
}

/// Serde-free pre-image equality shared by both pending kinds.
fn pre_image_matches_engine(
    pre_focused: &WindowId,
    pre_windows: &[EngineWindow],
    pre_target_windows: &[EngineWindow],
    focused: &WindowId,
    windows: &[EngineWindow],
    target_windows: &[EngineWindow],
) -> bool {
    if focused != pre_focused {
        return false;
    }
    let mut retained: HashMap<&str, &EngineWindow> =
        HashMap::with_capacity(pre_windows.len() + pre_target_windows.len());
    for entry in pre_windows.iter().chain(pre_target_windows.iter()) {
        if retained.insert(entry.window.0.as_str(), entry).is_some() {
            return false;
        }
    }
    let mut observed: HashMap<&str, &EngineWindow> =
        HashMap::with_capacity(windows.len() + target_windows.len());
    for entry in windows.iter().chain(target_windows.iter()) {
        if observed.insert(entry.window.0.as_str(), entry).is_some() {
            return false;
        }
    }
    if observed.len() != retained.len() {
        return false;
    }
    for (id, want) in &retained {
        let Some(got) = observed.get(id) else {
            return false;
        };
        if *got != *want {
            return false;
        }
    }
    true
}

/// Serde-free directional post-observation match shared by the R4 route.
fn directional_post_matches_engine(
    desired_geometry: &[DesiredGeometry],
    observed: &[EngineWindow],
) -> bool {
    let mut seen: HashMap<&str, &EngineWindow> = HashMap::with_capacity(observed.len());
    for entry in observed {
        if seen.insert(entry.window.0.as_str(), entry).is_some() {
            return false;
        }
    }
    if seen.len() != desired_geometry.len() {
        return false;
    }
    for desired in desired_geometry {
        let Some(entry) = seen.get(desired.window.0.as_str()) else {
            return false;
        };
        if entry.output != desired.output
            || entry.workspace != desired.workspace
            || entry.rect != desired.rect
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Rect;
    use std::collections::BTreeMap;

    fn window(id: &str, output: &str, workspace: &str, x: i32) -> EngineWindow {
        EngineWindow {
            window: WindowId(id.to_owned()),
            output: crate::directional::OutputId(output.to_owned()),
            workspace: crate::directional::WorkspaceId(workspace.to_owned()),
            rect: Rect {
                x,
                y: 0,
                w: 10,
                h: 10,
            },
            floating: false,
            fit_excluded: false,
        }
    }

    fn workspace_pending_fixture() -> WorkspacePending {
        let (owner, generation) = (
            OwnerId::parse("owner-a").expect("valid"),
            GenerationId::parse("gen-1").expect("valid"),
        );
        let correlation = CorrelationId::parse("corr-1").expect("valid");
        let domain = crate::session::OutputDomain {
            id: crate::directional::OutputId("out".to_owned()),
            workspace: crate::directional::WorkspaceId("ws".to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 800,
                h: 600,
            },
            gap: 0,
            adjacent: BTreeMap::new(),
        };
        let session =
            Session::new(owner.clone(), generation.clone(), 0, 0, vec![domain]).expect("session");
        WorkspacePending::new(
            owner,
            generation,
            correlation,
            0,
            0,
            session,
            Vec::new(),
            WindowId("focus".to_owned()),
            vec![window("a", "out", "ws", 0)],
            vec![window("b", "out", "ws-2", 20)],
        )
    }

    #[test]
    fn workspace_pre_image_is_order_insensitive_but_exact() {
        let pending = workspace_pending_fixture();
        let focused = WindowId("focus".to_owned());
        assert!(pending.pre_image_matches(
            &focused,
            &[window("a", "out", "ws", 0)],
            &[window("b", "out", "ws-2", 20)],
        ));
        assert!(pending.pre_image_matches(
            &focused,
            &[window("b", "out", "ws-2", 20), window("a", "out", "ws", 0),],
            &[],
        ));
        assert!(!pending.pre_image_matches(
            &WindowId("other".to_owned()),
            &[window("a", "out", "ws", 0)],
            &[window("b", "out", "ws-2", 20)],
        ));
        assert!(!pending.pre_image_matches(
            &focused,
            &[window("a", "out", "ws", 1)],
            &[window("b", "out", "ws-2", 20)],
        ));
    }

    #[test]
    fn workspace_post_match_rejects_duplicates_and_extras() {
        let mut pending = workspace_pending_fixture();
        let _ = &mut pending;
        let desired = vec![crate::session::DesiredGeometry {
            window: WindowId("a".to_owned()),
            leaf: crate::directional::NodeId::from("a"),
            output: crate::directional::OutputId("out".to_owned()),
            workspace: crate::directional::WorkspaceId("ws".to_owned()),
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
        }];
        assert!(directional_post_matches_engine(
            &desired,
            &[window("a", "out", "ws", 0)]
        ));
        assert!(!directional_post_matches_engine(
            &desired,
            &[window("a", "out", "ws", 0), window("a", "out", "ws", 0)]
        ));
        assert!(!directional_post_matches_engine(
            &desired,
            &[window("a", "out", "ws", 0), window("b", "out", "ws", 20)]
        ));
        assert!(!directional_post_matches_engine(
            &desired,
            &[window("a", "out", "ws", 1)]
        ));
    }

    #[test]
    fn pending_structs_carry_identity_geometry_and_pre_image() {
        let pending = workspace_pending_fixture();
        assert_eq!(pending.base_revision(), 0);
        assert_eq!(pending.request_revision(), 0);
        assert_eq!(pending.pre_focused().0, "focus");
        assert_eq!(pending.pre_windows().len(), 1);
        assert_eq!(pending.pre_target_windows().len(), 1);
        assert!(pending.desired_geometry().is_empty());
        assert!(pending.session().domains().len() == 1);
    }
}
