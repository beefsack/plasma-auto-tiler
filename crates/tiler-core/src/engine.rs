//! Portable world-level engine: owns per-domain sessions without merging them.
//!
//! Adapter-normalized integer geometry only; no transport, JSON, platform, or
//! process imports. Each logical `(OutputId, WorkspaceId)` domain keeps its
//! own independent [`Session`] (independent revisions, fingerprints,
//! divergence isolation, node identity, and outer-gap handling).
//! The engine keeps domains independent while owning seeding, relocation,
//! and typed request outcomes. Protocol keeps
//! envelope validation, ordered ingress fences,
//! and wire serialization.

use std::collections::BTreeMap;

use crate::boundary::{
    ActiveGroupResolution, CoreCommand, CoreEvent, CoreReply, NoGroupReason, ProjectionKind,
    ProjectionPlan, project_retained_tiled_geometry, resolve_active_group,
};
use crate::bounds::{is_gap, is_opaque_id};
use crate::contract::{
    AckOutcome, AdapterAck, DivergenceKind, FocusCapabilities, FocusPostObservation,
    LIFECYCLE_POLICY_VERSION, LifecycleCapabilities, LifecyclePostObservation, Observation,
    PostObservation, ResizeCapabilities, ResizeMode, ResizePostObservation,
};
use crate::directional::{Capabilities, Direction, MoveOperation, OutputId, WindowId, WorkspaceId};
use crate::geometry::Rect;
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::policy::{LayoutPolicy, default_policy};
use crate::seed::EngineWindow;
use crate::session::{
    CanonicalPairError, DomainKey, ExceptionFlags, OutputDomain, ProposeError, RefusalKind,
    Session, SessionCommand, SessionObservation,
};

/// Wire `kind`/`message` for the Session internal pending fence.
///
/// Mirrors the protocol `pending-exists` rejection exactly; single source for
/// the Session-owned conflict outcome so serialization stays byte identical.
const PENDING_EXISTS_KIND: &str = "pending-exists";
const PENDING_EXISTS_MESSAGE: &str = "complete the pending plan before proposing";
/// Wire `kind`/`message` for ambiguous seed order (mirrors `MSG_AMBIGUOUS`).
const AMBIGUOUS_KIND: &str = "ambiguous-placement";
const AMBIGUOUS_MESSAGE: &str = "window placement is ambiguous";
/// Wire `message` for snapshot failures (mirrors `MSG_OBSERVATION`).
const OBSERVATION_MESSAGE: &str = "observation does not cover the known window set";
/// Wire `message` for opaque id failures (mirrors `MSG_OPAQUE_ID`).
const OPAQUE_ID_MESSAGE: &str = "opaque id is invalid";
/// Wire `kind`/`message` for direction failures (mirrors `MSG_DIRECTION`).
const DIRECTION_KIND: &str = "direction-invalid";
const DIRECTION_MESSAGE: &str = "direction is invalid";

/// Portable world engine: per-domain sessions plus binding state.
#[derive(Debug, Clone)]
pub struct Engine {
    /// Selected layout policy carried into every retained session. Stateless
    /// transactionally: cloning, backups, relocation, and canonical
    /// pair/split work carry it without touching revision, divergence,
    /// or gap state. COSMIC v1 is the only implementation.
    policy: std::sync::Arc<dyn LayoutPolicy>,
    sessions: BTreeMap<DomainKey, Session>,
    outer_gaps: BTreeMap<DomainKey, i32>,
    owner: Option<OwnerId>,
    generation: Option<GenerationId>,
    /// Last single-domain observation-convergence report for protocol logging.
    ///
    /// Set only when [`Engine::handle`] converged with nonzero counts; cleared
    /// at the start of every [`Engine::handle`] so callers never read a stale
    /// op. Bounded counts only, never native identifiers; the correlation
    /// binds the existing planner summary boundary (`PLAN_SUMMARY_PREFIX`)
    /// without any [`CoreReply`] change (core has no logging sink). Exact
    /// (zero-count) convergence records nothing so only nonzero counts log.
    last_convergence: Option<EngineConvergenceReport>,
    /// Whether the current [`Engine::handle`] converged (changed or exact).
    ///
    /// Internal reseed guard only, never logged: once converged, partial or
    /// diverged follow-ups fail closed without reset/reseed.
    converged_this_op: bool,
}

/// Bounded correlated observation-convergence report for the protocol logging
/// boundary. Counts only, no window/domain identifiers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineConvergenceReport {
    /// Validated correlation for this op (cross-service lookup key).
    pub correlation: CorrelationId,
    /// Single-domain op token (`reconcile`, `admit`, `remove`, ...).
    pub op: &'static str,
    /// Missing known windows removed by convergence.
    pub removed: usize,
    /// Brand-new normal windows admitted by convergence.
    pub admitted: usize,
    /// Floating adoptions by convergence.
    pub flags_adopted: usize,
}

/// Single-domain convergence routing: absent sessions run the existing seed
/// route, converged sessions run the ordinary operation, and primitive
/// errors return a typed rejection with no operation and no reseed.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ConvergeOutcome {
    /// No retained slot: run the existing fit/seed/relocation route.
    NoSession,
    /// Primitive ran (changed or exact): run the ordinary operation; reseed
    /// is forbidden from here on for this op.
    Converged,
    /// Scoped pending fence or primitive error: return this reply directly;
    /// do not run the operation and do not reseed. Boxed: cold-path only.
    Rejected(Box<CoreReply>),
}

pub fn session_domain_matches(session: &Session, domain: &OutputDomain) -> bool {
    session
        .domains()
        .iter()
        .find(|d| d.id == domain.id && d.workspace == domain.workspace)
        .is_some_and(|d| {
            d.bounds == domain.bounds && d.gap == domain.gap && d.adjacent == domain.adjacent
        })
}

pub fn session_usable(session: &Session) -> bool {
    session.divergence().is_none() && !session.has_pending()
}

/// A committed session with no tiled members and no deferred exceptions holds
/// no topology and must not consume a domain slot.
pub fn committed_session_is_empty(session: &Session) -> bool {
    session.snapshot().windows.is_empty() && session.exception_count() == 0
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            policy: default_policy(),
            sessions: BTreeMap::new(),
            outer_gaps: BTreeMap::new(),
            owner: None,
            generation: None,
            last_convergence: None,
            converged_this_op: false,
        }
    }
}

impl Engine {
    /// Empty retained engine.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Retained engine carrying an explicit layout policy.
    #[must_use]
    pub fn with_policy(policy: std::sync::Arc<dyn LayoutPolicy>) -> Self {
        Self {
            policy,
            ..Self::default()
        }
    }

    /// Selected layout policy carried into retained sessions.
    #[must_use]
    pub fn policy(&self) -> &std::sync::Arc<dyn LayoutPolicy> {
        &self.policy
    }

    /// Number of retained domains.
    #[must_use]
    pub fn retained_domains(&self) -> usize {
        self.sessions.len()
    }

    /// Retained owner binding, if any.
    #[must_use]
    pub fn owner(&self) -> Option<&OwnerId> {
        self.owner.as_ref()
    }

    /// Retained generation binding, if any.
    #[must_use]
    pub fn generation(&self) -> Option<&GenerationId> {
        self.generation.as_ref()
    }

    /// Binding sync: on owner/generation change (adapter restart) discard the
    /// world map and gap map, then rebind.
    pub fn sync_binding(&mut self, owner: &OwnerId, generation: &GenerationId) {
        let owner_changed = self
            .owner
            .as_ref()
            .is_none_or(|o| o.as_str() != owner.as_str());
        let generation_changed = self
            .generation
            .as_ref()
            .is_none_or(|g| g.as_str() != generation.as_str());
        if owner_changed || generation_changed {
            self.sessions.clear();
            self.outer_gaps.clear();
            self.owner = Some(owner.clone());
            self.generation = Some(generation.clone());
        }
    }

    /// Borrow a retained session.
    #[must_use]
    pub fn session(&self, key: &DomainKey) -> Option<&Session> {
        self.sessions.get(key)
    }

    /// Mutably borrow a retained session.
    #[must_use]
    pub fn session_mut(&mut self, key: &DomainKey) -> Option<&mut Session> {
        self.sessions.get_mut(key)
    }

    /// Whether a domain slot exists (including empty/stale slots owned by the
    /// normal seeding path).
    #[must_use]
    pub fn contains(&self, key: &DomainKey) -> bool {
        self.sessions.contains_key(key)
    }

    /// Borrowed ordered domain keys for relocation scans.
    pub fn keys(&self) -> impl Iterator<Item = &DomainKey> {
        self.sessions.keys()
    }

    /// Number of slots including stale ones (relocation capacity check).
    #[must_use]
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Whether no domain slot is retained.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// Ordered retained domain keys.
    #[must_use]
    pub fn domain_keys(&self) -> Vec<DomainKey> {
        self.sessions.keys().cloned().collect()
    }

    /// Retained outer gap for a domain, if any.
    #[must_use]
    pub fn outer_gap(&self, key: &DomainKey) -> Option<i32> {
        self.outer_gaps.get(key).copied()
    }

    /// Borrowed outer-gap entry for protocol fence comparisons.
    #[must_use]
    pub fn outer_gap_ref(&self, key: &DomainKey) -> Option<&i32> {
        self.outer_gaps.get(key)
    }

    /// Last single-domain convergence report for protocol logging, if the
    /// current [`Engine::handle`] converged before its ordinary operation.
    /// Bounded counts plus correlation/op only, never native identifiers.
    #[must_use]
    pub fn last_convergence(&self) -> Option<&EngineConvergenceReport> {
        self.last_convergence.as_ref()
    }

    /// Converge one retained single-domain session to the complete current
    /// observation before its ordinary operation.
    ///
    /// Uses the existing [`Session::converge_observation`] primitive with the
    /// complete carried window set (`floating` plus advisory `fit_excluded`
    /// as carried; no new native flags) and the carried focus. Preserves
    /// survivor topology, exact-match revision semantics (no bump on zeros),
    /// and first-time fit/seed ([`ConvergeOutcome::NoSession`] runs the
    /// existing seed route). Owner/generation mismatches return terminal
    /// divergence without mutating (never diverging the retained session).
    /// Any other primitive error returns its typed rejection and the caller
    /// must not run the operation or reseed.
    fn converge_for_single_domain(
        &mut self,
        event: &CoreEvent,
        op: &'static str,
    ) -> ConvergeOutcome {
        let Some(session) = self.sessions.get(&event.domain_key) else {
            return ConvergeOutcome::NoSession;
        };
        if session.owner() != &event.owner {
            return ConvergeOutcome::Rejected(Box::new(CoreReply::Diverged(
                DivergenceKind::OwnerMismatch,
            )));
        }
        if session.generation() != &event.generation {
            return ConvergeOutcome::Rejected(Box::new(CoreReply::Diverged(
                DivergenceKind::GenerationMismatch,
            )));
        }
        let base = session.accepted_revision();
        let observation = crate::seed::session_observation_for(
            &event.owner,
            &event.generation,
            base,
            event.fingerprint,
            &event.windows,
        );
        let focus = if event.focused_window.0.is_empty() {
            None
        } else {
            Some(&event.focused_window)
        };
        let Some(session_mut) = self.sessions.get_mut(&event.domain_key) else {
            return ConvergeOutcome::NoSession;
        };
        match session_mut.converge_observation(&observation, focus) {
            Ok(counts) => {
                self.converged_this_op = true;
                if counts.removed + counts.admitted + counts.flags_adopted > 0 {
                    self.last_convergence = Some(EngineConvergenceReport {
                        correlation: event.correlation.clone(),
                        op,
                        removed: counts.removed,
                        admitted: counts.admitted,
                        flags_adopted: counts.flags_adopted,
                    });
                }
                ConvergeOutcome::Converged
            }
            Err(ProposeError::PendingExists) => {
                ConvergeOutcome::Rejected(Box::new(CoreReply::Rejected {
                    kind: PENDING_EXISTS_KIND,
                    message: PENDING_EXISTS_MESSAGE,
                }))
            }
            Err(ProposeError::Diverged(reason)) => {
                ConvergeOutcome::Rejected(Box::new(CoreReply::Diverged(reason)))
            }
            Err(error) => ConvergeOutcome::Rejected(Box::new(CoreReply::Rejected {
                kind: error.kind(),
                message: error.message(),
            })),
        }
    }

    /// Converge one assembled paired Session once on the complete carried
    /// observation, then split/store it atomically so valid convergence
    /// persists even if the ordinary command refuses.
    ///
    /// Same [`Session::converge_observation`] primitive as the single-domain
    /// path, called exactly once on the assembled two-domain world (never two
    /// per-domain primitives): the pair already carries BOTH domains, so one
    /// call converges source and target membership together. Focus rides from
    /// the source observation, the observation revision rides from the
    /// assembled Session, and nothing is fabricated. On success the converged
    /// pair splits/stores through the existing canonical machinery
    /// (revisions and exception state preserved, no new machinery) before the
    /// caller rebuilds its command observation at the converged revision.
    /// Primitive errors return their typed reply with no store and no command.
    fn converge_assembled_pair(
        &mut self,
        session: &mut Session,
        event: &CoreEvent,
        op: &'static str,
        source_key: &DomainKey,
        target_key: &DomainKey,
    ) -> Result<(u64, SessionObservation), Box<CoreReply>> {
        let base = session.accepted_revision();
        let observation = crate::seed::session_observation_for(
            &event.owner,
            &event.generation,
            base,
            event.fingerprint,
            &event.windows,
        );
        let focus = if event.focused_window.0.is_empty() {
            None
        } else {
            Some(&event.focused_window)
        };
        match session.converge_observation(&observation, focus) {
            Ok(counts) => {
                self.converged_this_op = true;
                if counts.removed + counts.admitted + counts.flags_adopted > 0 {
                    self.last_convergence = Some(EngineConvergenceReport {
                        correlation: event.correlation.clone(),
                        op,
                        removed: counts.removed,
                        admitted: counts.admitted,
                        flags_adopted: counts.flags_adopted,
                    });
                }
                if !self.store_canonical_pair(
                    source_key.clone(),
                    target_key.clone(),
                    session.clone(),
                    event.outer_gap,
                ) {
                    return Err(Box::new(CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "commit-rejected",
                    }));
                }
                let base = session.accepted_revision();
                let observation = crate::seed::session_observation_for(
                    &event.owner,
                    &event.generation,
                    base,
                    event.fingerprint,
                    &event.windows,
                );
                Ok((base, observation))
            }
            Err(ProposeError::PendingExists) => Err(Box::new(CoreReply::Rejected {
                kind: PENDING_EXISTS_KIND,
                message: PENDING_EXISTS_MESSAGE,
            })),
            Err(ProposeError::Diverged(reason)) => Err(Box::new(CoreReply::Diverged(reason))),
            Err(error) => Err(Box::new(CoreReply::Rejected {
                kind: error.kind(),
                message: error.message(),
            })),
        }
    }

    /// Remove a domain slot and its outer gap.
    pub fn remove(&mut self, key: &DomainKey) {
        self.sessions.remove(key);
        self.outer_gaps.remove(key);
    }

    /// Direct insert used only by pair-relocation paths that already validated
    /// on a clone and manage capacity explicitly. Normal commits must use
    /// [`Engine::store_committed`].
    pub fn insert_raw(&mut self, key: DomainKey, mut session: Session, outer_gap: i32) {
        // Retaining carries the selected policy; no revision, divergence,
        // pending, gap, or topology state is touched.
        session.set_policy(self.policy.clone());
        self.outer_gaps.insert(key.clone(), outer_gap);
        self.sessions.insert(key, session);
    }

    /// Restore a session without an outer-gap entry (exact legacy restore
    /// when the source had no gap recorded).
    pub fn insert_session_only(&mut self, key: DomainKey, mut session: Session) {
        session.set_policy(self.policy.clone());
        self.sessions.insert(key, session);
    }

    /// Remove only the outer-gap entry (pair-relocation source teardown).
    pub fn remove_outer_gap(&mut self, key: &DomainKey) {
        self.outer_gaps.remove(key);
    }

    /// Record an outer-gap change without touching the session (update-gaps
    /// commit path after `Session::update_domain_gaps` succeeds).
    pub fn set_outer_gap(&mut self, key: DomainKey, outer_gap: i32) {
        self.outer_gaps.insert(key, outer_gap);
    }

    /// Take a usable session clone for the propose/commit path: the slot must
    /// exist, be divergence/pending free, match the observed domain exactly,
    /// and hold topology. Unusable or empty slots are retired lazily without
    /// proposing so a later admission can reuse the slot.
    pub fn take_usable_session(
        &mut self,
        domain_key: &DomainKey,
        domain: &OutputDomain,
    ) -> Option<Session> {
        let session = self.sessions.get(domain_key)?;
        if !session_usable(session) || !session_domain_matches(session, domain) {
            self.sessions.remove(domain_key);
            self.outer_gaps.remove(domain_key);
            return None;
        }
        if committed_session_is_empty(session) {
            self.sessions.remove(domain_key);
            self.outer_gaps.remove(domain_key);
            return None;
        }
        Some(session.clone())
    }

    /// Store a committed session: empty results retire the slot, otherwise
    /// the slot and outer gap are recorded.
    pub fn store_committed(&mut self, domain_key: DomainKey, mut session: Session, outer_gap: i32) {
        if committed_session_is_empty(&session) {
            self.sessions.remove(&domain_key);
            self.outer_gaps.remove(&domain_key);
            return;
        }
        session.set_policy(self.policy.clone());
        self.outer_gaps.insert(domain_key.clone(), outer_gap);
        self.sessions.insert(domain_key, session);
    }

    /// Canonical component view: retained domain identity/bounds/gap with
    /// adjacency stripped for pair assembly.
    #[must_use]
    pub fn canonical_component_domain(domain: &OutputDomain) -> OutputDomain {
        OutputDomain {
            id: domain.id.clone(),
            workspace: domain.workspace.clone(),
            bounds: domain.bounds,
            gap: domain.gap,
            adjacent: std::collections::BTreeMap::new(),
        }
    }

    /// Unique relocation source for a target key: the single retained domain
    /// sharing the workspace id on a different output. `None` when missing or
    /// ambiguous (fail closed, no mutation).
    #[must_use]
    pub fn find_unique_source_for_target(&self, target_key: &DomainKey) -> Option<DomainKey> {
        let mut source_key: Option<DomainKey> = None;
        for key in self.sessions.keys() {
            if key.workspace == target_key.workspace && key.output != target_key.output {
                if source_key.is_some() {
                    return None;
                }
                source_key = Some(key.clone());
            }
        }
        source_key
    }

    /// Whether the retained outer gap for `key` equals the carried value.
    #[must_use]
    pub fn outer_gap_matches(&self, key: &DomainKey, outer_gap: i32) -> bool {
        self.outer_gaps.get(key).copied() == Some(outer_gap)
    }

    /// Assemble a temporary directional view solely from canonical per-domain
    /// sessions. Never infers a tree from current geometry: selected
    /// cross-output paths require retained authoritative state.
    pub fn assemble_directional_pair(
        &self,
        source_domain: &OutputDomain,
        source_key: &DomainKey,
        target_domain: &OutputDomain,
        target_key: &DomainKey,
    ) -> Result<Session, &'static str> {
        let source_component = Self::canonical_component_domain(source_domain);
        let target_component = Self::canonical_component_domain(target_domain);
        let source = self
            .sessions
            .get(source_key)
            .filter(|session| {
                session_usable(session)
                    && !committed_session_is_empty(session)
                    && session_domain_matches(session, &source_component)
            })
            .cloned()
            .ok_or("canonical-source-unavailable")?;
        let target = match self.sessions.get(target_key) {
            None => None,
            Some(session)
                if session_usable(session)
                    && !committed_session_is_empty(session)
                    && session_domain_matches(session, &target_component) =>
            {
                Some(session.clone())
            }
            Some(_) => return Err("canonical-pair-unusable"),
        };
        Session::paired_from_canonical(
            &source,
            target.as_ref(),
            vec![source_domain.clone(), target_domain.clone()],
        )
        .map_err(|error| match error {
            CanonicalPairError::MismatchedIdentity => "canonical-pair-identity-mismatch",
            CanonicalPairError::UnusableInput => "canonical-pair-unusable",
            CanonicalPairError::DomainMismatch => "canonical-pair-domain-mismatch",
            CanonicalPairError::DuplicateState => "canonical-pair-duplicate-state",
        })
    }

    /// Return a terminal two-domain transaction to the sole canonical state
    /// authority. The pair is never retained after this boundary.
    pub fn store_canonical_pair(
        &mut self,
        source_key: DomainKey,
        target_key: DomainKey,
        pair: Session,
        source_outer_gap: i32,
    ) -> bool {
        let Ok((source, target)) = pair.split_canonical_pair() else {
            return false;
        };
        let target_outer_gap = self.outer_gaps.get(&target_key).copied().unwrap_or(0);
        self.store_committed(source_key, source, source_outer_gap);
        if let Some(target) = target {
            self.store_committed(target_key, target, target_outer_gap);
        } else {
            self.sessions.remove(&target_key);
            self.outer_gaps.remove(&target_key);
        }
        true
    }

    /// Typed world-level entry point for the workspace-send, reconcile,
    /// update-gaps, and active-group request phases. Direct send/R4 request
    /// commits immediately with native assignment plus geometry.
    pub fn handle(&mut self, event: &CoreEvent) -> CoreReply {
        // Single-domain observation convergence before the ordinary operation:
        // one primitive with the complete current observation and focus keeps
        // survivor topology and preserves exact-match/fit/seed paths.
        // Primitive errors return a typed rejection with no operation and no
        // reseed; absent sessions run the existing seed route. Pair
        // (two-domain) moves/focuses converge once on the assembled
        // BOTH-domain world inside their request arms (same primitive, never
        // two per-domain calls). `run_retained` never converges again, so no
        // double converge.
        self.last_convergence = None;
        self.converged_this_op = false;
        match &event.command {
            CoreCommand::Reconcile => match self.converge_for_single_domain(event, "reconcile") {
                ConvergeOutcome::Rejected(reply) => *reply,
                _ => self.reconcile_request(event),
            },
            CoreCommand::UpdateGaps => {
                match self.converge_for_single_domain(event, "update-gaps") {
                    ConvergeOutcome::Rejected(reply) => *reply,
                    _ => self.update_gaps_request(event),
                }
            }
            CoreCommand::SendToWorkspace { .. } => self.workspace_request(event),
            CoreCommand::ActiveGroup => self.active_group_request(event),
            CoreCommand::ToggleFloat { .. } => {
                match self.converge_for_single_domain(event, "toggle-float") {
                    ConvergeOutcome::Rejected(reply) => *reply,
                    _ => self.toggle_float_request(event),
                }
            }
            CoreCommand::Move { .. } => {
                if event
                    .directional
                    .as_ref()
                    .is_none_or(|pair| pair.len() != 2)
                    && let ConvergeOutcome::Rejected(reply) =
                        self.converge_for_single_domain(event, "move")
                {
                    return *reply;
                }
                self.directional_move_request(event)
            }
            CoreCommand::Focus { .. } => {
                if event
                    .directional
                    .as_ref()
                    .is_none_or(|pair| pair.len() != 2)
                    && let ConvergeOutcome::Rejected(reply) =
                        self.converge_for_single_domain(event, "focus")
                {
                    return *reply;
                }
                self.directional_focus_request(event)
            }
            CoreCommand::Resize { .. } => match self.converge_for_single_domain(event, "resize") {
                ConvergeOutcome::Rejected(reply) => *reply,
                _ => self.resize_request(event),
            },
            CoreCommand::PointerResize { .. } => {
                match self.converge_for_single_domain(event, "pointer-resize") {
                    ConvergeOutcome::Rejected(reply) => *reply,
                    _ => self.pointer_resize_request(event),
                }
            }
        }
    }

    /// Fresh-domain seed anchor for public reconcile: the focused tiled
    /// member, else the first tiled member in observation order. Mirrors the
    /// KWin fresh-admit naming so fit eligibility (`window == focused`) and
    /// seed order match the admit route exactly. `None` when no tiled
    /// member exists (all-floating or truly empty observation).
    fn fresh_reconcile_seed_anchor(event: &CoreEvent) -> Option<WindowId> {
        if !event.focused_window.0.is_empty()
            && event
                .windows
                .iter()
                .any(|entry| entry.window == event.focused_window && !entry.floating)
        {
            return Some(event.focused_window.clone());
        }
        event
            .windows
            .iter()
            .find(|entry| !entry.floating)
            .map(|entry| entry.window.clone())
    }

    /// Shared fresh-domain admission route: flat-strip fit fast path,
    /// floating-aware convergence build, deterministic seed order, seeding,
    /// relocation, propose/commit, and store.
    ///
    /// Invoked by the fresh public reconcile path (`report_op = "reconcile"`)
    /// with the same anchor/placement inputs, so startup fit, seed fallback,
    /// focus-last placement, mixed float+tiled handling, and revision shape
    /// stay byte-identical without fabricating a synthetic admit command.
    fn fresh_admit_shared(
        &mut self,
        event: &CoreEvent,
        window: &WindowId,
        output: &OutputId,
        workspace: &WorkspaceId,
        placement_bounds: Option<Rect>,
        report_op: &'static str,
    ) -> CoreReply {
        use crate::boundary::{TiledKind, TiledPlan};
        if placement_bounds.is_none()
            && window.0 == event.focused_window.0
            && self.session(&event.domain_key).is_none()
            && let Some((tree, links)) =
                crate::seed::try_flat_strip_fit(&event.domain, &event.windows)
            && let Some(focus_leaf) = links
                .iter()
                .find(|l| l.window.0 == window.0)
                .map(|l| l.leaf.clone())
            && let Ok(mut fitted) = Session::new(
                event.owner.clone(),
                event.generation.clone(),
                0,
                event.fingerprint,
                vec![event.domain.clone()],
            )
        {
            fitted.set_policy(self.policy.clone());
            let base = fitted.accepted_revision();
            let observation = crate::seed::session_observation_for(
                &event.owner,
                &event.generation,
                base,
                event.fingerprint,
                &event.windows,
            );
            if let Ok(plan) = fitted.propose_fitted_admit(
                tree,
                links,
                focus_leaf,
                window,
                output,
                workspace,
                &observation,
                &event.correlation,
                &LifecycleCapabilities::full(),
            ) {
                let typed = CoreReply::Tiled(TiledPlan::from_lifecycle(TiledKind::Admit, &plan));
                if Self::commit_lifecycle(&mut fitted, &plan, event, base) {
                    self.store_committed(event.domain_key.clone(), fitted, event.outer_gap);
                    return typed;
                }
            }
        }
        // Fresh floating-aware build: no retained slot, no relocation source,
        // and floating members present, so the tiled-only seed cannot run. One
        // empty session plus the same single convergence primitive admits
        // normal members and retains floating exceptions atomically; no staged
        // or fabricated observations. Relocation candidates always keep the
        // legacy route byte-for-byte, as do all-normal fresh observations.
        if self.session(&event.domain_key).is_none()
            && event.windows.iter().any(|w| w.floating)
            && self
                .find_unique_source_for_target(&event.domain_key)
                .is_none()
            && let Ok(mut fresh) = Session::new(
                event.owner.clone(),
                event.generation.clone(),
                0,
                event.fingerprint,
                vec![event.domain.clone()],
            )
        {
            fresh.set_policy(self.policy.clone());
            let observation = crate::seed::session_observation_for(
                &event.owner,
                &event.generation,
                fresh.accepted_revision(),
                event.fingerprint,
                &event.windows,
            );
            let focus = if event.focused_window.0.is_empty() {
                None
            } else {
                Some(&event.focused_window)
            };
            match fresh.converge_observation(&observation, focus) {
                Err(ProposeError::PendingExists) => {
                    return CoreReply::Rejected {
                        kind: PENDING_EXISTS_KIND,
                        message: PENDING_EXISTS_MESSAGE,
                    };
                }
                Err(ProposeError::Diverged(reason)) => return CoreReply::Diverged(reason),
                Err(error) => {
                    return CoreReply::Rejected {
                        kind: error.kind(),
                        message: error.message(),
                    };
                }
                Ok(counts) => {
                    self.converged_this_op = true;
                    if counts.removed + counts.admitted + counts.flags_adopted > 0 {
                        self.last_convergence = Some(EngineConvergenceReport {
                            correlation: event.correlation.clone(),
                            op: report_op,
                            removed: counts.removed,
                            admitted: counts.admitted,
                            flags_adopted: counts.flags_adopted,
                        });
                    }
                    self.store_committed(event.domain_key.clone(), fresh, event.outer_gap);
                }
            }
            // Fresh mixed float+tiled projection: convergence above already
            // admitted normals and retained floating exceptions; project the
            // newly converged session directly at its committed revision.
            if let Some(session) = self.session(&event.domain_key).cloned()
                && session
                    .snapshot()
                    .windows
                    .iter()
                    .any(|l| &l.window == window)
            {
                let mut focused = session;
                let _ = focused.sync_focus_from_window(&event.domain_key, window);
                if committed_session_is_empty(&focused) {
                    return CoreReply::Tiled(TiledPlan {
                        base_revision: focused.accepted_revision(),
                        policy_version: LIFECYCLE_POLICY_VERSION,
                        kind: TiledKind::Admit,
                        geometry: Vec::new(),
                        focus_domain: None,
                        focus_leaf: None,
                        float_window: None,
                        float_rect: None,
                    });
                }
                let (focus_domain, focus_leaf) = focused.focus();
                if let (Some(focus_domain), Some(focus_leaf)) = (focus_domain, focus_leaf) {
                    let hints = event
                        .windows
                        .iter()
                        .map(|entry| (entry.window.clone(), entry.hints))
                        .collect::<BTreeMap<_, _>>();
                    if let Some(plan) = project_retained_tiled_geometry(
                        &focused,
                        &event.domain_key,
                        event.domain.bounds,
                        event.domain.gap,
                        Some((focus_domain, focus_leaf)),
                        ProjectionKind::Reconcile,
                        &hints,
                        &event.windows,
                    ) {
                        if let Some(stored) = self.session_mut(&event.domain_key) {
                            *stored = focused;
                        }
                        return CoreReply::Tiled(TiledPlan {
                            base_revision: plan.base_revision,
                            policy_version: LIFECYCLE_POLICY_VERSION,
                            kind: TiledKind::Admit,
                            geometry: plan.geometry,
                            focus_domain: plan.focus_domain,
                            focus_leaf: plan.focus_leaf,
                            float_window: None,
                            float_rect: None,
                        });
                    }
                }
            }
        }
        let seed_order = crate::seed::order_spatial_with_focus_last(
            event
                .windows
                .iter()
                .filter(|w| w.window != *window)
                .cloned()
                .collect(),
            &event.focused_window,
            true,
        );
        let window = window.clone();
        let output = output.clone();
        let workspace = workspace.clone();
        let domain = event.domain.clone();
        let placement_explicit = placement_bounds;
        self.run_retained(
            event,
            seed_order,
            false,
            |session, observation| {
                let placement = placement_explicit
                    .unwrap_or_else(|| crate::seed::seed_target_bounds(session, &domain));
                session.propose(
                    &SessionCommand::Admit {
                        window: window.clone(),
                        output: output.clone(),
                        workspace: workspace.clone(),
                        exceptions: ExceptionFlags::none(),
                        exception_behavior: None,
                        placement_bounds: placement,
                    },
                    observation,
                    &event.correlation,
                    &LifecycleCapabilities::full(),
                )
            },
            |plan| CoreReply::Tiled(TiledPlan::from_lifecycle(TiledKind::Admit, plan)),
            Self::commit_lifecycle,
        )
    }

    /// Fresh-domain reconcile on an absent domain: seed through the SAME
    /// existing fresh admission machinery (flat-strip fit fast path,
    /// floating-aware convergence build, deterministic seed order) without
    /// requiring KWin to derive an admit.
    ///
    /// Tiled observations route internally via [`Engine::fresh_admit_shared`]
    /// with the anchor window, event domain/output/workspace, and no
    /// placement bounds; the reply is the complete admission projection at
    /// the committed revision.
    /// All-floating observations build an empty session and run the same
    /// single convergence primitive, then project no geometry. Truly empty
    /// observations retain nothing and project no geometry at revision 0.
    /// No lifecycle observation is fabricated: every path consumes the
    /// validated carried window set.
    ///
    /// Ambiguous same-workspace sources do NOT refuse: the fresh domain
    /// seeds without relocating (like a fresh admit), leaving every
    /// candidate source untouched. Only a genuinely absent domain seeds
    /// here; a unique safe source relocates in
    /// [`Engine::reconcile_request`] before this arm runs.
    fn fresh_reconcile_request(&mut self, event: &CoreEvent) -> CoreReply {
        if event.windows.is_empty() {
            return CoreReply::Projection(ProjectionPlan {
                base_revision: 0,
                kind: ProjectionKind::Reconcile,
                geometry: Vec::new(),
                focus_domain: None,
                focus_leaf: None,
            });
        }
        if let Some(anchor) = Self::fresh_reconcile_seed_anchor(event) {
            return self.fresh_admit_shared(
                event,
                &anchor,
                &event.domain.id,
                &event.domain.workspace,
                None,
                "reconcile",
            );
        }
        let mut fresh = match Session::new(
            event.owner.clone(),
            event.generation.clone(),
            0,
            event.fingerprint,
            vec![event.domain.clone()],
        ) {
            Ok(session) => session,
            Err(_) => {
                return CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail: "seed-failed",
                };
            }
        };
        fresh.set_policy(self.policy.clone());
        let observation = crate::seed::session_observation_for(
            &event.owner,
            &event.generation,
            fresh.accepted_revision(),
            event.fingerprint,
            &event.windows,
        );
        let focus = if event.focused_window.0.is_empty() {
            None
        } else {
            Some(&event.focused_window)
        };
        match fresh.converge_observation(&observation, focus) {
            Ok(counts) => {
                self.converged_this_op = true;
                if counts.removed + counts.admitted + counts.flags_adopted > 0 {
                    self.last_convergence = Some(EngineConvergenceReport {
                        correlation: event.correlation.clone(),
                        op: "reconcile",
                        removed: counts.removed,
                        admitted: counts.admitted,
                        flags_adopted: counts.flags_adopted,
                    });
                }
                let base = fresh.accepted_revision();
                self.store_committed(event.domain_key.clone(), fresh, event.outer_gap);
                CoreReply::Projection(ProjectionPlan {
                    base_revision: base,
                    kind: ProjectionKind::Reconcile,
                    geometry: Vec::new(),
                    focus_domain: None,
                    focus_leaf: None,
                })
            }
            Err(ProposeError::PendingExists) => CoreReply::Rejected {
                kind: PENDING_EXISTS_KIND,
                message: PENDING_EXISTS_MESSAGE,
            },
            Err(ProposeError::Diverged(reason)) => CoreReply::Diverged(reason),
            Err(error) => CoreReply::Rejected {
                kind: error.kind(),
                message: error.message(),
            },
        }
    }

    /// Reconcile request phase: retained-tree projection with displaced
    /// workspace relocation and work-area reprojection.
    ///
    /// Fence order matches the legacy protocol handler exactly: unknown
    /// session (fresh domains seed instead of refusing), divergence
    /// (as rejection, never terminal), pending/drag (`pending-exists`),
    /// retained domain binding (`unknown-domain`), inner-gap and outer-gap
    /// binding (`domain-mismatch` with the exact message), membership on the
    /// relocated target-miss path only (`partial-observation` with atomic
    /// rollback; retained targets ride the pre-request convergence),
    /// empty-domain projection (retire a fully empty slot, else reproject on
    /// bounds change, else `malformed-topology`), focus binding
    /// (`focus-mismatch`), pure projection (`malformed-topology` on shape
    /// failure), then work-area reprojection on bounds change. The projection
    /// honors carried client size hints (AR12: satisfiable minimums take
    /// sibling slack, unsatisfiable windows flag `overconstrained`) and
    /// assesses observed rectangles as client clamps (`client_clamped` flags
    /// for accepted clamps, never adopted, shares untouched). Relocation is
    /// atomic: the outer gap is pre-validated against the unique source
    /// before mutating, and any later rejection restores the pre-request
    /// world exactly.
    fn reconcile_request(&mut self, event: &CoreEvent) -> CoreReply {
        let backup = self.clone();
        let mut relocated_here = false;
        if !self.contains(&event.domain_key) {
            let outer_ok = match self.find_unique_source_for_target(&event.domain_key) {
                Some(source) => {
                    if !self.outer_gap_matches(&source, event.outer_gap) {
                        false
                    } else if let Some(session) = self.sessions.get(&source) {
                        let snapshot = session.snapshot();
                        event.windows.iter().any(|entry| {
                            snapshot
                                .windows
                                .iter()
                                .any(|link| link.window == entry.window)
                                || session.is_exception(&entry.window)
                        })
                    } else {
                        false
                    }
                }
                None => false,
            };
            if outer_ok {
                relocated_here =
                    self.try_relocate_for_target(&event.domain_key, &event.domain, event.outer_gap);
            }
        }
        let restore = |engine: &mut Self, backup: &Self, relocated: bool| {
            if relocated {
                *engine = backup.clone();
            }
        };
        let Some(session) = self.session(&event.domain_key).cloned() else {
            restore(self, &backup, relocated_here);
            // Absent domain with no relocation source: seed through the same
            // fresh admission route instead of refusing `unknown-domain`, so
            // KWin never derives an admit. Relocation already ran above; this
            // arm only sees genuinely fresh domains.
            return self.fresh_reconcile_request(event);
        };
        if let Some(reason) = session.divergence() {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: reason.as_str(),
                message: reason.message(),
            };
        }
        if session.has_pending() || session.has_pending_desired() || session.has_drag() {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: PENDING_EXISTS_KIND,
                message: PENDING_EXISTS_MESSAGE,
            };
        }
        let Some(retained_domain) = session
            .domains()
            .iter()
            .find(|d| d.key() == event.domain_key)
            .cloned()
        else {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: RefusalKind::UnknownDomain.as_str(),
                message: RefusalKind::UnknownDomain.message(),
            };
        };
        if retained_domain.gap != event.domain.gap {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: "domain-mismatch",
                message: "domain gap does not match retained state",
            };
        }
        if self.outer_gap_ref(&event.domain_key).copied() != Some(event.outer_gap) {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: "domain-mismatch",
                message: "domain outer gap does not match retained state",
            };
        }
        let bounds_changed = retained_domain.bounds != event.domain.bounds;
        let snapshot = session.snapshot();
        // Membership rides the pre-request convergence for retained targets.
        // A relocated target missed convergence (`NoSession` before the move),
        // so only that path keeps its exact-set fence with atomic rollback.
        if relocated_here {
            let mut known: std::collections::BTreeSet<String> = snapshot
                .windows
                .iter()
                .map(|l| l.window.0.clone())
                .collect();
            for entry in session.exception_observed() {
                known.insert(entry.window.0.clone());
            }
            let observed: std::collections::BTreeSet<String> =
                event.windows.iter().map(|w| w.window.0.clone()).collect();
            if observed != known {
                restore(self, &backup, relocated_here);
                return CoreReply::Rejected {
                    kind: RefusalKind::PartialObservation.as_str(),
                    message: RefusalKind::PartialObservation.message(),
                };
            }
        }
        let domain_view = snapshot.domains.into_iter().find(|d| {
            d.output.0 == event.domain_key.output.0 && d.workspace.0 == event.domain_key.workspace.0
        });
        if domain_view.and_then(|d| d.tree).is_none() {
            // An empty domain or one containing only floating exceptions has
            // no tiled geometry to project. A missing tree with tiled links
            // is still malformed.
            if !snapshot.windows.iter().any(|link| {
                link.output == event.domain_key.output
                    && link.workspace == event.domain_key.workspace
            }) {
                if committed_session_is_empty(&session) {
                    // Post-convergence empty: retire the slot at this applied
                    // boundary and report the converged revision. Bounds
                    // changes are moot once retired.
                    let base = session.accepted_revision();
                    self.remove(&event.domain_key);
                    return CoreReply::Projection(ProjectionPlan {
                        base_revision: base,
                        kind: ProjectionKind::Reconcile,
                        geometry: Vec::new(),
                        focus_domain: None,
                        focus_leaf: None,
                    });
                }
                if bounds_changed {
                    self.reproject_retained(&event.domain_key, event.domain.bounds);
                }
                return CoreReply::Projection(ProjectionPlan {
                    base_revision: session.accepted_revision(),
                    kind: ProjectionKind::Reconcile,
                    geometry: Vec::new(),
                    focus_domain: None,
                    focus_leaf: None,
                });
            }
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: RefusalKind::MalformedTopology.as_str(),
                message: RefusalKind::MalformedTopology.message(),
            };
        }
        let (focus_domain, focus_leaf) = session.focus();
        let (Some(focus_domain), Some(focus_leaf)) = (focus_domain, focus_leaf) else {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: RefusalKind::FocusMismatch.as_str(),
                message: RefusalKind::FocusMismatch.message(),
            };
        };
        if focus_domain != event.domain_key {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: RefusalKind::FocusMismatch.as_str(),
                message: RefusalKind::FocusMismatch.message(),
            };
        }
        let hints = event
            .windows
            .iter()
            .map(|entry| (entry.window.clone(), entry.hints))
            .collect::<BTreeMap<_, _>>();
        let Some(plan) = project_retained_tiled_geometry(
            &session,
            &event.domain_key,
            event.domain.bounds,
            retained_domain.gap,
            Some((focus_domain.clone(), focus_leaf.clone())),
            ProjectionKind::Reconcile,
            &hints,
            &event.windows,
        ) else {
            restore(self, &backup, relocated_here);
            return CoreReply::Rejected {
                kind: RefusalKind::MalformedTopology.as_str(),
                message: RefusalKind::MalformedTopology.message(),
            };
        };
        if bounds_changed {
            self.reproject_retained(&event.domain_key, event.domain.bounds);
        }
        CoreReply::Projection(plan)
    }

    /// Update-gaps request phase: deliberate gap-update reprojection.
    ///
    /// Same fence order as [`Engine::reconcile_request`] minus relocation:
    /// unknown session, divergence (as rejection), pending/drag, domain
    /// binding, empty/exception-only gap adoption (a missing tree with no
    /// tiled links and no tiled observation adopts the gaps and projects
    /// empty; a missing tree alongside tiled links or a tiled observation
    /// stays `malformed-topology`), focus binding, pure projection with the
    /// new inner gap into the new bounds before mutating, then gap adoption
    /// plus store. Membership rides the pre-request convergence, like the
    /// non-relocated reconcile path. A fully empty slot retires instead of
    /// retaining. Never seeds, relocates, resets, or reseeds: an unknown
    /// domain refuses so the fresh reconcile path seeds it.
    fn update_gaps_request(&mut self, event: &CoreEvent) -> CoreReply {
        let Some(session) = self.session(&event.domain_key).cloned() else {
            return CoreReply::Rejected {
                kind: RefusalKind::UnknownDomain.as_str(),
                message: RefusalKind::UnknownDomain.message(),
            };
        };
        if let Some(reason) = session.divergence() {
            return CoreReply::Rejected {
                kind: reason.as_str(),
                message: reason.message(),
            };
        }
        if session.has_pending() || session.has_pending_desired() || session.has_drag() {
            return CoreReply::Rejected {
                kind: PENDING_EXISTS_KIND,
                message: PENDING_EXISTS_MESSAGE,
            };
        }
        if session
            .domains()
            .iter()
            .find(|d| d.key() == event.domain_key)
            .is_none()
        {
            return CoreReply::Rejected {
                kind: RefusalKind::UnknownDomain.as_str(),
                message: RefusalKind::UnknownDomain.message(),
            };
        }
        let snapshot = session.snapshot();
        let domain_view = snapshot.domains.into_iter().find(|d| {
            d.output.0 == event.domain_key.output.0 && d.workspace.0 == event.domain_key.workspace.0
        });
        if domain_view.and_then(|d| d.tree).is_none() {
            // No tiled tree: adopt gaps and project empty when neither the
            // converged session nor the complete observation holds a tiled
            // member for this domain (truly empty or floating exceptions
            // only). A missing tree alongside tiled links or a tiled
            // observation stays malformed.
            let has_tiled_links = snapshot.windows.iter().any(|link| {
                link.output == event.domain_key.output
                    && link.workspace == event.domain_key.workspace
            });
            let has_tiled_observed = event.windows.iter().any(|entry| {
                !entry.floating
                    && entry.output == event.domain.id
                    && entry.workspace == event.domain.workspace
            });
            if !has_tiled_links && !has_tiled_observed {
                if event.windows.is_empty() && committed_session_is_empty(&session) {
                    // Post-convergence fully empty: retire the slot and
                    // report the converged revision; gap adoption is moot.
                    let base = session.accepted_revision();
                    self.remove(&event.domain_key);
                    return CoreReply::Projection(ProjectionPlan {
                        base_revision: base,
                        kind: ProjectionKind::UpdateGaps,
                        geometry: Vec::new(),
                        focus_domain: None,
                        focus_leaf: None,
                    });
                }
                let base = session.accepted_revision();
                if let Some(stored) = self.session_mut(&event.domain_key)
                    && !stored.update_domain_gaps(
                        &event.domain_key,
                        event.domain.bounds,
                        event.domain.gap,
                    )
                {
                    return CoreReply::Rejected {
                        kind: RefusalKind::MalformedTopology.as_str(),
                        message: RefusalKind::MalformedTopology.message(),
                    };
                }
                self.set_outer_gap(event.domain_key.clone(), event.outer_gap);
                return CoreReply::Projection(ProjectionPlan {
                    base_revision: base,
                    kind: ProjectionKind::UpdateGaps,
                    geometry: Vec::new(),
                    focus_domain: None,
                    focus_leaf: None,
                });
            }
            return CoreReply::Rejected {
                kind: RefusalKind::MalformedTopology.as_str(),
                message: RefusalKind::MalformedTopology.message(),
            };
        }
        let (focus_domain, focus_leaf) = session.focus();
        let (Some(focus_domain), Some(focus_leaf)) = (focus_domain, focus_leaf) else {
            return CoreReply::Rejected {
                kind: RefusalKind::FocusMismatch.as_str(),
                message: RefusalKind::FocusMismatch.message(),
            };
        };
        if focus_domain != event.domain_key {
            return CoreReply::Rejected {
                kind: RefusalKind::FocusMismatch.as_str(),
                message: RefusalKind::FocusMismatch.message(),
            };
        }
        let hints = event
            .windows
            .iter()
            .map(|entry| (entry.window.clone(), entry.hints))
            .collect::<BTreeMap<_, _>>();
        let Some(mut plan) = project_retained_tiled_geometry(
            &session,
            &event.domain_key,
            event.domain.bounds,
            event.domain.gap,
            Some((focus_domain.clone(), focus_leaf.clone())),
            ProjectionKind::UpdateGaps,
            &hints,
            &event.windows,
        ) else {
            return CoreReply::Rejected {
                kind: RefusalKind::MalformedTopology.as_str(),
                message: RefusalKind::MalformedTopology.message(),
            };
        };
        let mut session = session;
        if !session.update_domain_gaps(&event.domain_key, event.domain.bounds, event.domain.gap) {
            return CoreReply::Rejected {
                kind: RefusalKind::MalformedTopology.as_str(),
                message: RefusalKind::MalformedTopology.message(),
            };
        }
        plan.base_revision = session.accepted_revision();
        self.store_committed(event.domain_key.clone(), session, event.outer_gap);
        CoreReply::Projection(plan)
    }

    /// Active-group request phase: focus-only retained sync plus read-only
    /// resolution.
    ///
    /// Aligns retained focus from the valid observed snapshot before resolving
    /// the immediate parent group. Focus-only sync: no topology or geometry
    /// mutation. Fails closed on divergence, pending/drag residue,
    /// unknown/exception/cross-domain windows, or domain bounds/gap mismatch
    /// (then the resolver still replies fail-closed `no-group` without
    /// persisting). The carried revision is never a staleness gate: this is a
    /// current-state snapshot whose authoritative `base_revision` is returned
    /// for downstream ordering. Protocol keeps envelope validation, tagged
    /// command decoding, and wire serialization; by the time an event reaches
    /// here the command decoded and the observation validated.
    fn active_group_request(&mut self, event: &CoreEvent) -> CoreReply {
        let Some(mut session) = self.session(&event.domain_key).cloned() else {
            return CoreReply::NoGroup {
                base_revision: None,
                reason: NoGroupReason::NoSession,
            };
        };
        if !event.focused_window.0.is_empty()
            && let Some(retained_domain) = session
                .domains()
                .iter()
                .find(|domain| domain.key() == event.domain_key)
            && retained_domain.bounds == event.domain.bounds
            && retained_domain.gap == event.domain.gap
        {
            let before = session.focus();
            if session.sync_focus_from_window(&event.domain_key, &event.focused_window)
                && session.focus() != before
                && let Some(stored) = self.session_mut(&event.domain_key)
            {
                *stored = session.clone();
            }
        }
        match resolve_active_group(Some(&session), event) {
            ActiveGroupResolution::Found(found) => CoreReply::ActiveGroup(found),
            ActiveGroupResolution::NoGroup {
                base_revision,
                reason,
            } => CoreReply::NoGroup {
                base_revision,
                reason,
            },
        }
    }

    /// Workspace-send request phase: canonical-pair immediate commit.
    ///
    /// Assembles the temporary canonical source/target pair from the retained
    /// per-domain sessions (same-output distinct-workspace accepted by
    /// `Session::paired_from_canonical`), preserving both survivor trees. A
    /// previously absent source seeds once from its complete observation; a
    /// retained source is never reseeded. An empty target uses `None`.
    /// Converges once over BOTH domains with the combined
    /// `workspace_observation_for` (never `event.windows` alone), split/stored
    /// before the command so a refused proposal keeps the converged
    /// observation. Then proposes `MoveToWorkspace` and synchronously commits
    /// its planned topology via `commit_lifecycle`, split/storing both
    /// canonical sessions (source `event.outer_gap`, retained-or-zero target
    /// gap) and returning `SendWorkspace`. No pair survives the call. A
    /// failed commit stores nothing further, so no half pair persists.
    ///
    /// Fence order: target presence/shape, focus binding, canonical assembly
    /// (`canonical-*`), fresh-source seed (`seed-failed`), one combined
    /// convergence, focus sync (`focus-mismatch`), propose (mapped to
    /// `Rejected`), and the `MoveTiled` shape gate (`move-op-invalid`).
    fn workspace_request(&mut self, event: &CoreEvent) -> CoreReply {
        let CoreCommand::SendToWorkspace {
            window,
            target_output,
            target_workspace,
        } = &event.command
        else {
            return CoreReply::Rejected {
                kind: "unknown-value",
                message: "request contains an unknown value",
            };
        };
        let Some((target_domain, target_key)) = event.target_domain.as_ref() else {
            return CoreReply::Rejected {
                kind: "workspace-target-invalid",
                message: "target workspace domain is missing",
            };
        };
        if target_output != &target_key.output.0 || target_workspace != &target_key.workspace.0 {
            return CoreReply::Rejected {
                kind: "target-mismatch",
                message: "command target does not match the target domain",
            };
        }
        if event.focused_window.0.is_empty() {
            return CoreReply::Rejected {
                kind: "absent-focus",
                message: "no focused window is observed",
            };
        }
        if window != &event.focused_window.0 {
            return CoreReply::Rejected {
                kind: "focus-mismatch",
                message: "the moved window is not the focused window",
            };
        }
        let source_key = event.domain_key.clone();
        let target_key = target_key.clone();
        // First-time source seed from the complete observation when absent.
        // Never reseeds a retained source: presence (even unusable/empty)
        // falls through to canonical assembly below, which fails closed.
        if !self.contains(&source_key) {
            let canonical_source = Self::canonical_component_domain(&event.domain);
            let mut seeded = match Session::new(
                event.owner.clone(),
                event.generation.clone(),
                0,
                event.fingerprint,
                vec![canonical_source],
            ) {
                Ok(session) => session,
                Err(_) => {
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "seed-failed",
                    };
                }
            };
            seeded.set_policy(self.policy.clone());
            let seed_observation = crate::seed::session_observation_for(
                &event.owner,
                &event.generation,
                seeded.accepted_revision(),
                event.fingerprint,
                &event.windows,
            );
            let seed_focus = if event.focused_window.0.is_empty() {
                None
            } else {
                Some(&event.focused_window)
            };
            match seeded.converge_observation(&seed_observation, seed_focus) {
                Ok(_) => {
                    self.store_committed(source_key.clone(), seeded, event.outer_gap);
                }
                Err(ProposeError::PendingExists) => {
                    return CoreReply::Rejected {
                        kind: PENDING_EXISTS_KIND,
                        message: PENDING_EXISTS_MESSAGE,
                    };
                }
                Err(ProposeError::Diverged(reason)) => {
                    return CoreReply::Diverged(reason);
                }
                Err(_) => {
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "seed-failed",
                    };
                }
            }
        }
        // Canonical pair assembly preserving both survivor trees. Empty
        // target observation uses `None`; a retained unusable target fails
        // closed rather than inventing.
        let source_component = Self::canonical_component_domain(&event.domain);
        let target_component = Self::canonical_component_domain(target_domain);
        let source = match self.sessions.get(&source_key).filter(|session| {
            session_usable(session)
                && !committed_session_is_empty(session)
                && session_domain_matches(session, &source_component)
        }) {
            Some(session) => session.clone(),
            None => {
                return CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail: if self.contains(&source_key) {
                        "canonical-pair-unusable"
                    } else {
                        "canonical-source-unavailable"
                    },
                };
            }
        };
        let target = if event.target_windows.is_empty() {
            None
        } else {
            match self.sessions.get(&target_key) {
                None => None,
                Some(session)
                    if session_usable(session)
                        && !committed_session_is_empty(session)
                        && session_domain_matches(session, &target_component) =>
                {
                    Some(session.clone())
                }
                Some(_) => {
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "canonical-pair-unusable",
                    };
                }
            }
        };
        let mut session = match Session::paired_from_canonical(
            &source,
            target.as_ref(),
            vec![event.domain.clone(), target_domain.clone()],
        ) {
            Ok(session) => session,
            Err(error) => {
                return CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail: match error {
                        CanonicalPairError::MismatchedIdentity => {
                            "canonical-pair-identity-mismatch"
                        }
                        CanonicalPairError::UnusableInput => "canonical-pair-unusable",
                        CanonicalPairError::DomainMismatch => "canonical-pair-domain-mismatch",
                        CanonicalPairError::DuplicateState => "canonical-pair-duplicate-state",
                    },
                };
            }
        };
        // One convergence over BOTH domains with the combined observation.
        let base = session.accepted_revision();
        let combined = crate::seed::workspace_observation_for(
            &event.owner,
            &event.generation,
            base,
            event.fingerprint,
            &event.windows,
            &event.target_windows,
        );
        let focus = if event.focused_window.0.is_empty() {
            None
        } else {
            Some(&event.focused_window)
        };
        let (base, observation) = match session.converge_observation(&combined, focus) {
            Ok(counts) => {
                self.converged_this_op = true;
                if counts.removed + counts.admitted + counts.flags_adopted > 0 {
                    self.last_convergence = Some(EngineConvergenceReport {
                        correlation: event.correlation.clone(),
                        op: "send-to-workspace",
                        removed: counts.removed,
                        admitted: counts.admitted,
                        flags_adopted: counts.flags_adopted,
                    });
                }
                if !self.store_canonical_pair(
                    source_key.clone(),
                    target_key.clone(),
                    session.clone(),
                    event.outer_gap,
                ) {
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "commit-rejected",
                    };
                }
                let base = session.accepted_revision();
                let observation = crate::seed::workspace_observation_for(
                    &event.owner,
                    &event.generation,
                    base,
                    event.fingerprint,
                    &event.windows,
                    &event.target_windows,
                );
                (base, observation)
            }
            Err(ProposeError::PendingExists) => {
                return CoreReply::Rejected {
                    kind: PENDING_EXISTS_KIND,
                    message: PENDING_EXISTS_MESSAGE,
                };
            }
            Err(ProposeError::Diverged(reason)) => return CoreReply::Diverged(reason),
            Err(error) => {
                return CoreReply::Rejected {
                    kind: error.kind(),
                    message: error.message(),
                };
            }
        };
        if !session.sync_focus_from_window(&source_key, &event.focused_window) {
            let kind = RefusalKind::FocusMismatch;
            return CoreReply::Rejected {
                kind: kind.as_str(),
                message: kind.message(),
            };
        }
        let session_command = SessionCommand::MoveToWorkspace {
            window: crate::directional::WindowId(window.clone()),
            target_output: target_key.output.clone(),
            target_workspace: target_key.workspace.clone(),
        };
        match session.propose(
            &session_command,
            &observation,
            &event.correlation,
            &LifecycleCapabilities::full(),
        ) {
            Ok(plan) => {
                let Some(typed) = crate::boundary::SendWorkspacePlan::from_session(&plan) else {
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "move-op-invalid",
                    };
                };
                if Self::commit_lifecycle(&mut session, &plan, event, base)
                    && self.store_canonical_pair(source_key, target_key, session, event.outer_gap)
                {
                    return CoreReply::SendWorkspace(typed);
                }
                CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail: "commit-rejected",
                }
            }
            Err(error) => CoreReply::Rejected {
                kind: error.kind(),
                message: error.message(),
            },
        }
    }

    /// Shared retained propose/commit: try the usable retained session, then
    /// rebuild once from `seed_order`. `ambiguous_as_snapshot` selects the
    /// fail-closed kind when no safe order exists (toggle-float uses
    /// `snapshot-invalid`). Mirrors the legacy protocol `run_retained` over the
    /// typed [`CoreEvent`]: target presence gates relocation, usable sessions
    /// propose directly, rebuilds fall back to relocation then seeding, and
    /// every outcome maps to the identical typed [`CoreReply`].
    ///
    /// Once [`Engine::handle`] converged the domain for this op
    /// (`converged_this_op`, changed or exact), partial/diverged mismatches
    /// fail closed without reset/reseed: no discard, no relocation retry, no
    /// seeding. First-time (no convergence) keeps the exact legacy rebuild.
    fn run_retained<R>(
        &mut self,
        event: &CoreEvent,
        seed_order: Option<Vec<EngineWindow>>,
        ambiguous_as_snapshot: bool,
        propose: impl Fn(&mut Session, &SessionObservation) -> Result<R, ProposeError>,
        reply: impl Fn(&R) -> CoreReply,
        commit: impl Fn(&mut Session, &R, &CoreEvent, u64) -> bool,
    ) -> CoreReply {
        let converged = self.converged_this_op;
        let target_existed = self.contains(&event.domain_key);
        // Do not let the mutating take discard a just-converged mismatched
        // domain; the existing converged refusal below keeps its topology.
        let candidate = if converged
            && target_existed
            && self.sessions.get(&event.domain_key).is_some_and(|session| {
                !session_usable(session)
                    || !session_domain_matches(session, &event.domain)
                    || committed_session_is_empty(session)
            }) {
            None
        } else {
            self.take_usable_session(&event.domain_key, &event.domain)
        };
        if let Some(mut session) = candidate {
            let base = session.accepted_revision();
            let observation = crate::seed::session_observation_for(
                &event.owner,
                &event.generation,
                base,
                event.fingerprint,
                &event.windows,
            );
            match propose(&mut session, &observation) {
                Ok(plan) => {
                    let typed = reply(&plan);
                    if commit(&mut session, &plan, event, base) {
                        self.store_committed(event.domain_key.clone(), session, event.outer_gap);
                        return typed;
                    }
                    self.remove(&event.domain_key);
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "commit-rejected",
                    };
                }
                Err(error) if engine_needs_rebuild(&error) => {
                    if converged {
                        return CoreReply::Rejected {
                            kind: error.kind(),
                            message: error.message(),
                        };
                    }
                    self.remove(&event.domain_key);
                }
                Err(error) => {
                    return CoreReply::Rejected {
                        kind: error.kind(),
                        message: error.message(),
                    };
                }
            }
        } else if !target_existed {
            let backup = self.clone();
            if self.try_relocate_for_target(&event.domain_key, &event.domain, event.outer_gap) {
                if let Some(mut session) =
                    self.take_usable_session(&event.domain_key, &event.domain)
                {
                    let base = session.accepted_revision();
                    let observation = crate::seed::session_observation_for(
                        &event.owner,
                        &event.generation,
                        base,
                        event.fingerprint,
                        &event.windows,
                    );
                    match propose(&mut session, &observation) {
                        Ok(plan) => {
                            let typed = reply(&plan);
                            if commit(&mut session, &plan, event, base) {
                                self.store_committed(
                                    event.domain_key.clone(),
                                    session,
                                    event.outer_gap,
                                );
                                return typed;
                            }
                            *self = backup;
                            return CoreReply::SnapshotInvalid {
                                message: OBSERVATION_MESSAGE,
                                detail: "commit-rejected",
                            };
                        }
                        Err(error) if engine_needs_rebuild(&error) => {
                            *self = backup;
                        }
                        Err(error) => {
                            *self = backup;
                            return CoreReply::Rejected {
                                kind: error.kind(),
                                message: error.message(),
                            };
                        }
                    }
                } else {
                    *self = backup;
                }
            }
        }
        // Once converged, never reseed: fail closed without reset. Ambiguous
        // seed order keeps its exact legacy shape (no seeding either way);
        // a concrete order refuses instead of rebuilding survivors.
        if converged {
            let Some(_order) = seed_order else {
                if ambiguous_as_snapshot {
                    return CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "missing-seed-order",
                    };
                }
                return CoreReply::Rejected {
                    kind: AMBIGUOUS_KIND,
                    message: AMBIGUOUS_MESSAGE,
                };
            };
            return CoreReply::Rejected {
                kind: RefusalKind::PartialObservation.as_str(),
                message: RefusalKind::PartialObservation.message(),
            };
        }
        let Some(order) = seed_order else {
            if ambiguous_as_snapshot {
                return CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail: "missing-seed-order",
                };
            }
            return CoreReply::Rejected {
                kind: AMBIGUOUS_KIND,
                message: AMBIGUOUS_MESSAGE,
            };
        };
        let Some(mut session) = crate::seed::seed_session(
            &event.owner,
            &event.generation,
            event.fingerprint,
            &event.domain,
            &order,
        ) else {
            return CoreReply::SnapshotInvalid {
                message: OBSERVATION_MESSAGE,
                detail: "seed-failed",
            };
        };
        session.set_policy(self.policy.clone());
        let base = session.accepted_revision();
        let observation = crate::seed::session_observation_for(
            &event.owner,
            &event.generation,
            base,
            event.fingerprint,
            &event.windows,
        );
        match propose(&mut session, &observation) {
            Ok(plan) => {
                let typed = reply(&plan);
                if commit(&mut session, &plan, event, base) {
                    self.store_committed(event.domain_key.clone(), session, event.outer_gap);
                    return typed;
                }
                CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail: "commit-rejected",
                }
            }
            Err(error) => CoreReply::Rejected {
                kind: error.kind(),
                message: error.message(),
            },
        }
    }

    /// Synchronous acknowledge plus `verify_lifecycle` commit for one
    /// retained lifecycle plan. Mirrors the legacy protocol commit closure
    /// exactly.
    fn commit_lifecycle(
        session: &mut Session,
        plan: &crate::session::SessionPlan,
        event: &CoreEvent,
        base: u64,
    ) -> bool {
        if !engine_acknowledge(session, event, base) {
            return false;
        }
        let post = LifecyclePostObservation::new(
            Observation::new(
                event.owner.clone(),
                event.generation.clone(),
                base,
                event.fingerprint,
            ),
            event.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        );
        session.verify_lifecycle(&post).is_ok()
    }

    /// Toggle-float request phase through the shared retained lifecycle.
    ///
    /// Protocol keeps the raw-window floating `not-tiled` probe, tagged
    /// decoding, opaque window checks, carried-bounds validation, and
    /// partial-observation at their exact positions; this owns seed ordering,
    /// seeding, relocation, propose/commit, and store, including the
    /// pending-float effective rectangle.
    ///
    /// Fresh domains whose complete observation contains floating members
    /// cannot seed (the seed rebuild is tiled-only): like the fresh reconcile
    /// path,
    /// an empty session plus the same single convergence primitive retains
    /// the floating exceptions first, then the ordinary toggle below unfloats
    /// into the current domain. No staged or fabricated observations.
    /// Relocation candidates and all-tiled fresh observations keep the legacy
    /// route byte-for-byte.
    fn toggle_float_request(&mut self, event: &CoreEvent) -> CoreReply {
        use crate::boundary::TiledPlan;
        let CoreCommand::ToggleFloat { window, float_rect } = &event.command else {
            return CoreReply::Rejected {
                kind: "unknown-value",
                message: "request contains an unknown value",
            };
        };
        if self.session(&event.domain_key).is_none()
            && event.windows.iter().any(|w| w.floating)
            && self
                .find_unique_source_for_target(&event.domain_key)
                .is_none()
            && let Ok(mut fresh) = Session::new(
                event.owner.clone(),
                event.generation.clone(),
                0,
                event.fingerprint,
                vec![event.domain.clone()],
            )
        {
            fresh.set_policy(self.policy.clone());
            let observation = crate::seed::session_observation_for(
                &event.owner,
                &event.generation,
                fresh.accepted_revision(),
                event.fingerprint,
                &event.windows,
            );
            let focus = if event.focused_window.0.is_empty() {
                None
            } else {
                Some(&event.focused_window)
            };
            match fresh.converge_observation(&observation, focus) {
                Err(ProposeError::PendingExists) => {
                    return CoreReply::Rejected {
                        kind: PENDING_EXISTS_KIND,
                        message: PENDING_EXISTS_MESSAGE,
                    };
                }
                Err(ProposeError::Diverged(reason)) => return CoreReply::Diverged(reason),
                Err(error) => {
                    return CoreReply::Rejected {
                        kind: error.kind(),
                        message: error.message(),
                    };
                }
                Ok(counts) => {
                    self.converged_this_op = true;
                    if counts.removed + counts.admitted + counts.flags_adopted > 0 {
                        self.last_convergence = Some(EngineConvergenceReport {
                            correlation: event.correlation.clone(),
                            op: "toggle-float",
                            removed: counts.removed,
                            admitted: counts.admitted,
                            flags_adopted: counts.flags_adopted,
                        });
                    }
                    self.store_committed(event.domain_key.clone(), fresh, event.outer_gap);
                }
            }
            if self.session(&event.domain_key).is_none() {
                // Converged empty retires the slot: behave as if never
                // converged so the legacy route keeps its exact shape.
                self.converged_this_op = false;
                self.last_convergence = None;
            }
        }
        let seed_order = crate::seed::order_spatial_with_focus_last(
            event.windows.clone(),
            &event.focused_window,
            false,
        );
        let window = WindowId(window.clone());
        let float_rect = *float_rect;
        self.run_retained(
            event,
            seed_order,
            true,
            |session, observation| {
                session
                    .propose(
                        &SessionCommand::ToggleFloat {
                            window: window.clone(),
                            float_geometry: float_rect,
                        },
                        observation,
                        &event.correlation,
                        &LifecycleCapabilities::full(),
                    )
                    .map(|plan| {
                        let effective = session.pending_float_geometry(&window);
                        (plan, effective)
                    })
            },
            |result| CoreReply::Tiled(TiledPlan::for_toggle_float(&result.0, result.1)),
            |session, result, e, base| Self::commit_lifecycle(session, &result.0, e, base),
        )
    }

    /// Directional move request phase: two-domain pair planning with R4
    /// staging, plus the legacy single-domain local path. Protocol keeps
    /// envelope validation, tagged command decoding, pair scope shape
    /// validation, mover binding, parsed-direction/op validation, and wire
    /// serialization at their exact positions; by the time an event reaches
    /// here the command decoded and the pair shape-checked. This owns the
    /// planning outcome and the one-shot transition: canonical pair assembly,
    /// focus sync, capability-gated propose, R4 pending staging, and the
    /// R1-R3 synchronous acknowledge/verify/split/store. Single-domain
    /// observations (no two-entry pair) run the local retained
    /// propose/commit through [`Engine::local_move_request`], preserving the
    /// legacy `run_retained` order exactly.
    ///
    /// Fence order matches the legacy protocol handler exactly: window opaque
    /// (`move-window-invalid`), parsed direction (`direction-invalid`), pair
    /// presence (`domain-invalid`), scoped pending pre-fence across either
    /// pair domain, canonical assembly (`canonical-*`), one convergence
    /// primitive on the assembled world (split/stored before the command),
    /// propose (mapped to `Rejected` with the exact kind/message, including
    /// divergences as rejections like the legacy `propose_failure`), then
    /// the R4 immediate commit or the R1-R3 sync commit (`commit-rejected`
    /// on failure).
    fn directional_move_request(&mut self, event: &CoreEvent) -> CoreReply {
        use crate::boundary::MovePlanReply;
        let CoreCommand::Move {
            window,
            direction,
            cross_output_transfer,
        } = &event.command
        else {
            return CoreReply::Rejected {
                kind: "unknown-value",
                message: "request contains an unknown value",
            };
        };
        if event
            .directional
            .as_ref()
            .is_none_or(|pair| pair.len() != 2)
        {
            return self.local_move_request(event, window, direction);
        }
        if !is_opaque_id(window) {
            return CoreReply::SnapshotInvalid {
                message: OPAQUE_ID_MESSAGE,
                detail: "move-window-invalid",
            };
        }
        let Some(direction) = parse_engine_direction(direction) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        let Some(pair) = event.directional.as_ref().filter(|pair| pair.len() == 2) else {
            return CoreReply::SnapshotInvalid {
                message: OBSERVATION_MESSAGE,
                detail: "domain-invalid",
            };
        };
        let (source_domain, source_key) = &pair[0];
        let (target_domain, target_key) = &pair[1];
        let window = WindowId(window.clone());
        let mut session = match self.assemble_directional_pair(
            source_domain,
            source_key,
            target_domain,
            target_key,
        ) {
            Ok(session) => session,
            Err(detail) => {
                return CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail,
                };
            }
        };
        // One primitive on the assembled BOTH-domain world (never two
        // per-domain calls); the converged split persists below even if the
        // ordinary move refuses.
        let (base, observation) =
            match self.converge_assembled_pair(&mut session, event, "move", source_key, target_key)
            {
                Ok(next) => next,
                Err(reply) => return *reply,
            };
        let _ = session.sync_focus_from_window(source_key, &event.focused_window.clone());
        let mut capabilities = Capabilities::full();
        capabilities.cross_output_transfer = *cross_output_transfer;
        match session.propose_move(
            source_key,
            &window,
            direction,
            &observation,
            &event.correlation,
            &capabilities,
        ) {
            Ok(plan) => {
                if matches!(plan.dispatch.operation, MoveOperation::CrossOutput { .. }) {
                    let target_outer_gap = event
                        .directional_target_outer_gap
                        .filter(|gap| is_gap(*gap))
                        .unwrap_or(0);
                    let Some(typed) =
                        MovePlanReply::from_cross(&plan, &source_key.output, &source_key.workspace)
                    else {
                        return CoreReply::SnapshotInvalid {
                            message: OBSERVATION_MESSAGE,
                            detail: "domain-invalid",
                        };
                    };
                    if Self::commit_directional_move(&mut session, event, &plan, base) {
                        let Ok((source, target)) = session.split_canonical_pair() else {
                            return CoreReply::SnapshotInvalid {
                                message: OBSERVATION_MESSAGE,
                                detail: "commit-rejected",
                            };
                        };
                        self.store_committed(source_key.clone(), source, event.outer_gap);
                        if let Some(target) = target {
                            self.store_committed(target_key.clone(), target, target_outer_gap);
                        } else {
                            self.sessions.remove(target_key);
                            self.outer_gaps.remove(target_key);
                        }
                        return CoreReply::MoveDirectional(typed);
                    }
                    CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "commit-rejected",
                    }
                } else {
                    let typed = MovePlanReply::from_local(direction, &plan);
                    if Self::commit_directional_move(&mut session, event, &plan, base) {
                        let source_key = source_key.clone();
                        let target_key = target_key.clone();
                        let source_outer_gap = event.outer_gap;
                        if self.store_canonical_pair(
                            source_key,
                            target_key,
                            session,
                            source_outer_gap,
                        ) {
                            return CoreReply::MoveDirectional(typed);
                        }
                    }
                    CoreReply::SnapshotInvalid {
                        message: OBSERVATION_MESSAGE,
                        detail: "commit-rejected",
                    }
                }
            }
            Err(error) => CoreReply::Rejected {
                kind: error.kind(),
                message: error.message(),
            },
        }
    }

    /// Synchronous acknowledge/verify/split for an R1-R3 directional move
    /// plan. Mirrors the legacy protocol commit helper exactly.
    fn commit_directional_move(
        session: &mut Session,
        event: &CoreEvent,
        plan: &crate::session::SessionMovePlan,
        base: u64,
    ) -> bool {
        let ack = AdapterAck::new(
            event.correlation.clone(),
            event.owner.clone(),
            event.generation.clone(),
            base,
            AckOutcome::Accepted,
        );
        if session.acknowledge(&ack).is_err() {
            return false;
        }
        let post = PostObservation::new(
            Observation::new(
                event.owner.clone(),
                event.generation.clone(),
                base,
                event.fingerprint,
            ),
            event.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        );
        session.verify_move(&post).is_ok()
    }

    /// Directional focus request phase: two-domain pair planning with local
    /// first then exhausted Left/Right cross, plus the legacy single-domain
    /// local path. Same ownership contract as
    /// [`Engine::directional_move_request`]: protocol keeps envelope,
    /// tagged decoding, pair scope shape, parsed-direction/op validation, and
    /// serialization; this owns assembly, focus sync, propose, and the
    /// synchronous acknowledge/verify/split/store. Single-domain observations
    /// (no two-entry pair) run the local retained propose/commit through
    /// [`Engine::local_focus_request`], preserving the legacy `run_retained`
    /// order exactly.
    ///
    /// Fence order matches the legacy protocol handler exactly: window opaque
    /// (`focus-window-invalid`), parsed direction (`direction-invalid`), pair
    /// presence (`domain-invalid`), canonical assembly (`canonical-*`), one
    /// convergence primitive on the assembled world (split/stored before the
    /// command), propose (mapped like `propose_failure`), then the sync
    /// commit (`commit-rejected` on failure).
    fn directional_focus_request(&mut self, event: &CoreEvent) -> CoreReply {
        use crate::boundary::FocusPlanReply;
        let CoreCommand::Focus {
            window, direction, ..
        } = &event.command
        else {
            return CoreReply::Rejected {
                kind: "unknown-value",
                message: "request contains an unknown value",
            };
        };
        if event
            .directional
            .as_ref()
            .is_none_or(|pair| pair.len() != 2)
        {
            return self.local_focus_request(event, window, direction);
        }
        if !is_opaque_id(window) {
            return CoreReply::SnapshotInvalid {
                message: OPAQUE_ID_MESSAGE,
                detail: "focus-window-invalid",
            };
        }
        let Some(direction) = parse_engine_direction(direction) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        let Some(pair) = event.directional.as_ref().filter(|pair| pair.len() == 2) else {
            return CoreReply::SnapshotInvalid {
                message: OBSERVATION_MESSAGE,
                detail: "domain-invalid",
            };
        };
        let (source_domain, source_key) = &pair[0];
        let (target_domain, target_key) = &pair[1];
        let window = WindowId(window.clone());
        let mut session = match self.assemble_directional_pair(
            source_domain,
            source_key,
            target_domain,
            target_key,
        ) {
            Ok(session) => session,
            Err(detail) => {
                return CoreReply::SnapshotInvalid {
                    message: OBSERVATION_MESSAGE,
                    detail,
                };
            }
        };
        // One primitive on the assembled BOTH-domain world (never two
        // per-domain calls); the converged split persists below even if the
        // ordinary focus refuses.
        let (base, observation) = match self.converge_assembled_pair(
            &mut session,
            event,
            "focus",
            source_key,
            target_key,
        ) {
            Ok(next) => next,
            Err(reply) => return *reply,
        };
        let _ = session.sync_focus_from_window(source_key, &event.focused_window.clone());
        let (plan, crossed) = match session.propose_focus(
            source_key,
            &window,
            direction,
            &observation,
            &event.correlation,
            &FocusCapabilities::full(),
        ) {
            Ok(plan) => (plan, false),
            Err(ProposeError::Refused(RefusalKind::Unchanged))
                if matches!(direction, Direction::Left | Direction::Right) =>
            {
                match session.propose_cross_output_focus(
                    source_key,
                    &window,
                    direction,
                    &observation,
                    &event.correlation,
                    &FocusCapabilities::full(),
                ) {
                    Ok(plan) => (plan, true),
                    Err(error) => {
                        return CoreReply::Rejected {
                            kind: error.kind(),
                            message: error.message(),
                        };
                    }
                }
            }
            Err(error) => {
                return CoreReply::Rejected {
                    kind: error.kind(),
                    message: error.message(),
                };
            }
        };
        let typed = if crossed {
            FocusPlanReply::from_cross(direction, &plan)
        } else {
            FocusPlanReply::from_local(direction, &plan)
        };
        if Self::commit_directional_focus(&mut session, event, &plan, base) {
            let source_key = source_key.clone();
            let target_key = target_key.clone();
            let source_outer_gap = event.outer_gap;
            if self.store_canonical_pair(source_key, target_key, session, source_outer_gap) {
                return CoreReply::FocusDirectional(typed);
            }
        }
        CoreReply::SnapshotInvalid {
            message: OBSERVATION_MESSAGE,
            detail: "commit-rejected",
        }
    }

    /// Synchronous acknowledge/verify/split for a directional focus plan.
    /// Mirrors the legacy protocol commit helper exactly.
    fn commit_directional_focus(
        session: &mut Session,
        event: &CoreEvent,
        plan: &crate::session::SessionFocusPlan,
        base: u64,
    ) -> bool {
        let ack = AdapterAck::new(
            event.correlation.clone(),
            event.owner.clone(),
            event.generation.clone(),
            base,
            AckOutcome::Accepted,
        );
        if session.acknowledge(&ack).is_err() {
            return false;
        }
        let post = FocusPostObservation::new(
            Observation::new(
                event.owner.clone(),
                event.generation.clone(),
                base,
                event.fingerprint,
            ),
            event.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        );
        session.verify_focus(&post).is_ok()
    }

    /// Legacy single-domain move through the shared retained lifecycle.
    ///
    /// Protocol keeps tagged command decoding, the directional-pair branch,
    /// window/direction authorization, and wire serialization at their exact
    /// positions; by the time an event reaches here the command decoded. This
    /// owns seed ordering, focus sync, capability-gated propose, relocation,
    /// commit, and store, preserving the legacy `run_retained` order exactly
    /// (ambiguous seed as `snapshot-invalid`/`missing-seed-order`, full
    /// capabilities so the carried transfer flag stays transport-only).
    fn local_move_request(
        &mut self,
        event: &CoreEvent,
        window: &str,
        direction: &str,
    ) -> CoreReply {
        use crate::boundary::MovePlanReply;
        if !is_opaque_id(window) {
            return CoreReply::SnapshotInvalid {
                message: OPAQUE_ID_MESSAGE,
                detail: "move-window-invalid",
            };
        }
        let Some(direction) = parse_engine_direction(direction) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        let seed_order = crate::seed::order_spatial_with_focus_last(
            event.windows.clone(),
            &event.focused_window,
            false,
        );
        let window = WindowId(window.to_owned());
        self.run_retained(
            event,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(&event.domain_key, &event.focused_window);
                session.propose_move(
                    &event.domain_key,
                    &window,
                    direction,
                    observation,
                    &event.correlation,
                    &Capabilities::full(),
                )
            },
            |plan| CoreReply::MoveDirectional(MovePlanReply::from_local(direction, plan)),
            |session, plan, event, base| Self::commit_directional_move(session, event, plan, base),
        )
    }

    /// Legacy single-domain focus through the shared retained lifecycle.
    ///
    /// Same ownership contract as [`Engine::local_move_request`]: protocol
    /// keeps tagged decoding, the directional-pair branch, and
    /// window/direction authorization; this owns seed ordering, focus sync,
    /// propose (local only, no cross fallback), commit, and store.
    fn local_focus_request(
        &mut self,
        event: &CoreEvent,
        window: &str,
        direction: &str,
    ) -> CoreReply {
        use crate::boundary::FocusPlanReply;
        if !is_opaque_id(window) {
            return CoreReply::SnapshotInvalid {
                message: OPAQUE_ID_MESSAGE,
                detail: "focus-window-invalid",
            };
        }
        let Some(direction) = parse_engine_direction(direction) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        let seed_order = crate::seed::order_spatial_with_focus_last(
            event.windows.clone(),
            &event.focused_window,
            false,
        );
        let window = WindowId(window.to_owned());
        self.run_retained(
            event,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(&event.domain_key, &event.focused_window);
                session.propose_focus(
                    &event.domain_key,
                    &window,
                    direction,
                    observation,
                    &event.correlation,
                    &FocusCapabilities::full(),
                )
            },
            |plan| CoreReply::FocusDirectional(FocusPlanReply::from_local(direction, plan)),
            |session, plan, event, base| Self::commit_directional_focus(session, event, plan, base),
        )
    }

    /// Legacy keyboard resize through the shared retained lifecycle.
    ///
    /// Protocol keeps tagged command decoding, window/direction/mode
    /// authorization, and wire serialization at their exact positions; this
    /// owns seed ordering, focus sync, keyboard-gated propose, commit, and
    /// store. Mode failures map to `direction-invalid` exactly like the
    /// legacy handler, and resize shares flow through the typed
    /// [`crate::boundary::ResizePlanReply`] unchanged.
    fn resize_request(&mut self, event: &CoreEvent) -> CoreReply {
        use crate::boundary::ResizePlanReply;
        let CoreCommand::Resize {
            window,
            direction,
            mode,
            press_index,
        } = &event.command
        else {
            return CoreReply::Rejected {
                kind: "unknown-value",
                message: "request contains an unknown value",
            };
        };
        if !is_opaque_id(window) {
            return CoreReply::SnapshotInvalid {
                message: OPAQUE_ID_MESSAGE,
                detail: "resize-window-invalid",
            };
        }
        let Some(direction) = parse_engine_direction(direction) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        let Some(mode) = parse_engine_mode(mode) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        let seed_order = crate::seed::order_spatial_with_focus_last(
            event.windows.clone(),
            &event.focused_window,
            false,
        );
        let window = WindowId(window.to_owned());
        let press_index = *press_index;
        self.run_retained(
            event,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(&event.domain_key, &event.focused_window);
                session.propose_resize(
                    &event.domain_key,
                    &window,
                    direction,
                    mode,
                    press_index,
                    observation,
                    &event.correlation,
                    &ResizeCapabilities {
                        keyboard_resize: true,
                        pointer_resize: false,
                    },
                )
            },
            |plan| CoreReply::Resize(ResizePlanReply::from_keyboard(direction, mode, plan)),
            |session, plan, event, base| Self::commit_resize(session, event, plan, base),
        )
    }

    /// Legacy pointer resize through the shared retained lifecycle.
    ///
    /// Same ownership contract as [`Engine::resize_request`] with the pointer
    /// capability gate and carried boundary; the boundary crosses opaquely
    /// with no authorization beyond the tagged decode, exactly like the
    /// legacy handler.
    fn pointer_resize_request(&mut self, event: &CoreEvent) -> CoreReply {
        use crate::boundary::ResizePlanReply;
        use crate::directional::Axis;
        let CoreCommand::PointerResize {
            window,
            direction,
            boundary,
            direction2,
            boundary2,
        } = &event.command
        else {
            return CoreReply::Rejected {
                kind: "unknown-value",
                message: "request contains an unknown value",
            };
        };
        if !is_opaque_id(window) {
            return CoreReply::SnapshotInvalid {
                message: OPAQUE_ID_MESSAGE,
                detail: "pointer-resize-window-invalid",
            };
        }
        let Some(direction) = parse_engine_direction(direction) else {
            return CoreReply::Rejected {
                kind: DIRECTION_KIND,
                message: DIRECTION_MESSAGE,
            };
        };
        // Corner second axis: both-or-neither (the protocol layer refuses a
        // half-present pair before this boundary); a present pair must parse
        // and must span perpendicular axes.
        let corner = match (direction2, boundary2) {
            (None, None) => None,
            (Some(raw), Some(second)) => {
                let Some(parsed) = parse_engine_direction(raw) else {
                    return CoreReply::Rejected {
                        kind: DIRECTION_KIND,
                        message: DIRECTION_MESSAGE,
                    };
                };
                if Axis::for_direction(direction) == Axis::for_direction(parsed) {
                    return CoreReply::Rejected {
                        kind: DIRECTION_KIND,
                        message: DIRECTION_MESSAGE,
                    };
                }
                Some((parsed, *second))
            }
            _ => {
                return CoreReply::Rejected {
                    kind: "unknown-value",
                    message: "request contains an unknown value",
                };
            }
        };
        let seed_order = crate::seed::order_spatial_with_focus_last(
            event.windows.clone(),
            &event.focused_window,
            false,
        );
        let window = WindowId(window.to_owned());
        let boundary = *boundary;
        match corner {
            None => self.run_retained(
                event,
                seed_order,
                true,
                |session, observation| {
                    let _ =
                        session.sync_focus_from_window(&event.domain_key, &event.focused_window);
                    session.propose_pointer_resize(
                        &event.domain_key,
                        &window,
                        direction,
                        boundary,
                        observation,
                        &event.correlation,
                        &ResizeCapabilities {
                            keyboard_resize: false,
                            pointer_resize: true,
                        },
                    )
                },
                |plan| CoreReply::Resize(ResizePlanReply::from_pointer(direction, boundary, plan)),
                |session, plan, event, base| Self::commit_resize(session, event, plan, base),
            ),
            Some((second_direction, second_boundary)) => {
                // Axis-normalized corner: horizontal primary, vertical
                // secondary, regardless of wire order.
                let (direction_h, boundary_h, direction_v, boundary_v) =
                    if Axis::for_direction(direction) == Axis::Horizontal {
                        (direction, boundary, second_direction, second_boundary)
                    } else {
                        (second_direction, second_boundary, direction, boundary)
                    };
                self.run_retained(
                    event,
                    seed_order,
                    true,
                    |session, observation| {
                        let _ = session
                            .sync_focus_from_window(&event.domain_key, &event.focused_window);
                        session.propose_pointer_resize_corner(
                            &event.domain_key,
                            &window,
                            direction_h,
                            boundary_h,
                            direction_v,
                            boundary_v,
                            observation,
                            &event.correlation,
                            &ResizeCapabilities {
                                keyboard_resize: false,
                                pointer_resize: true,
                            },
                        )
                    },
                    |plan| {
                        CoreReply::Resize(ResizePlanReply::from_pointer_corner(
                            direction_h,
                            boundary_h,
                            direction_v,
                            boundary_v,
                            plan,
                        ))
                    },
                    |session, plan, event, base| {
                        Self::commit_resize_corner(session, event, plan, base)
                    },
                )
            }
        }
    }

    /// Synchronous acknowledge/verify for a retained resize plan. Mirrors the
    /// legacy protocol commit closure exactly.
    fn commit_resize(
        session: &mut Session,
        event: &CoreEvent,
        plan: &crate::session::SessionResizePlan,
        base: u64,
    ) -> bool {
        if !engine_acknowledge(session, event, base) {
            return false;
        }
        let post = ResizePostObservation::new(
            Observation::new(
                event.owner.clone(),
                event.generation.clone(),
                base,
                event.fingerprint,
            ),
            event.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        );
        session.verify_resize(&post).is_ok()
    }

    /// Synchronous acknowledge/verify for a retained atomic corner resize
    /// plan. Mirrors [`Engine::commit_resize`] with both operation echoes
    /// bound, so the single pending corner transaction commits exactly once.
    fn commit_resize_corner(
        session: &mut Session,
        event: &CoreEvent,
        plan: &crate::session::SessionResizePlan,
        base: u64,
    ) -> bool {
        if !engine_acknowledge(session, event, base) {
            return false;
        }
        let post = ResizePostObservation::new_with_secondary(
            Observation::new(
                event.owner.clone(),
                event.generation.clone(),
                base,
                event.fingerprint,
            ),
            event.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
            plan.dispatch.secondary_operation.clone(),
        );
        session.verify_resize(&post).is_ok()
    }

    /// Portable output relocation: when no usable session exists for the
    /// target key, move a usable retained session with the same workspace id
    /// from a different output to the target, preserving topology, shares,
    /// focus, exceptions, and revision. Target collision, unique source,
    /// capacity rollback, and empty-session rules match the legacy behavior
    /// exactly.
    pub fn try_relocate_for_target(
        &mut self,
        target_key: &DomainKey,
        target_domain: &OutputDomain,
        request_outer_gap: i32,
    ) -> bool {
        if !is_gap(request_outer_gap) {
            return false;
        }
        if self.sessions.contains_key(target_key) {
            return false;
        }
        let mut source_key: Option<DomainKey> = None;
        for key in self.sessions.keys() {
            if key.workspace == target_key.workspace && key.output != target_key.output {
                if source_key.is_some() {
                    return false;
                }
                source_key = Some(key.clone());
            }
        }
        let Some(source) = source_key else {
            return false;
        };
        let Some(session) = self.sessions.get(&source).cloned() else {
            return false;
        };
        if !session_usable(&session) {
            return false;
        }
        if session.has_pending_desired() || session.has_drag() {
            return false;
        }
        if committed_session_is_empty(&session) {
            return false;
        }
        let mut moved = session.clone();
        if !moved.relocate_domain(&source, target_key, target_domain.bounds, target_domain.gap) {
            return false;
        }
        if committed_session_is_empty(&moved) {
            return false;
        }
        self.sessions.remove(&source);
        self.outer_gaps.remove(&source);
        self.outer_gaps
            .insert(target_key.clone(), request_outer_gap);
        self.sessions.insert(target_key.clone(), moved);
        true
    }

    /// Hotplug reprojection: update retained bounds for `key` without touching
    /// topology, shares, membership, focus, or revision. `false` when unknown.
    pub fn reproject_retained(&mut self, key: &DomainKey, bounds: Rect) -> bool {
        let Some(session) = self.sessions.get_mut(key) else {
            return false;
        };
        session.reproject_domain(key, bounds);
        true
    }
}

/// Retained rebuild gate mirroring the protocol `needs_rebuild`: diverged or
/// partial-observation proposals discard and rebuild once, everything else
/// fails closed.
fn engine_needs_rebuild(error: &ProposeError) -> bool {
    match error {
        ProposeError::Diverged(_) => true,
        ProposeError::Refused(RefusalKind::PartialObservation) => true,
        ProposeError::PendingExists => false,
        ProposeError::Refused(_) => false,
    }
}

/// Synchronous acknowledge helper mirroring the protocol commit closure.
fn engine_acknowledge(session: &mut Session, event: &CoreEvent, base: u64) -> bool {
    let ack = AdapterAck::new(
        event.correlation.clone(),
        event.owner.clone(),
        event.generation.clone(),
        base,
        AckOutcome::Accepted,
    );
    session.acknowledge(&ack).is_ok()
}

/// Parsed-direction gate mirroring the protocol vocabulary.
fn parse_engine_direction(value: &str) -> Option<Direction> {
    match value {
        "left" => Some(Direction::Left),
        "right" => Some(Direction::Right),
        "up" => Some(Direction::Up),
        "down" => Some(Direction::Down),
        _ => None,
    }
}

/// Parsed-mode gate mirroring the protocol vocabulary.
fn parse_engine_mode(value: &str) -> Option<ResizeMode> {
    match value {
        "inwards" => Some(ResizeMode::Inwards),
        "outwards" => Some(ResizeMode::Outwards),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directional::{OutputId, WorkspaceId};
    use crate::geometry::Rect;
    use std::collections::BTreeMap;

    fn domain(output: &str, workspace: &str) -> OutputDomain {
        OutputDomain {
            id: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 800,
                h: 600,
            },
            gap: 0,
            adjacent: BTreeMap::new(),
        }
    }

    fn new_session(owner: &OwnerId, gen_id: &GenerationId, domain: OutputDomain) -> Session {
        Session::new(
            OwnerId::parse(owner.as_str()).expect("valid"),
            GenerationId::parse(gen_id.as_str()).expect("valid"),
            0,
            7,
            vec![domain],
        )
        .expect("session")
    }

    #[test]
    fn binding_change_clears_world() {
        let mut engine = Engine::new();
        let owner_a = OwnerId::parse("owner-a").expect("valid");
        let owner_b = OwnerId::parse("owner-b").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner_a, &gen_id);
        assert_eq!(engine.owner().expect("bound").as_str(), "owner-a");
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner_a, &gen_id, d);
        engine.insert_raw(key.clone(), session, 0);
        assert_eq!(engine.retained_domains(), 1);
        engine.sync_binding(&owner_a, &gen_id);
        assert_eq!(engine.retained_domains(), 1);
        engine.sync_binding(&owner_b, &gen_id);
        assert_eq!(engine.retained_domains(), 0);
        assert_eq!(engine.outer_gap(&key), None);
    }

    /// Admit one window into a fresh single-domain session through the full
    /// propose/acknowledge/verify cycle, leaving committed (non-empty) state.
    fn admit_one(
        session: &mut Session,
        owner: &OwnerId,
        gen_id: &GenerationId,
        output: &str,
        workspace: &str,
        window: &str,
    ) {
        use crate::contract::{
            AckOutcome, AdapterAck, LifecycleCapabilities, LifecyclePostObservation, Observation,
        };
        use crate::directional::WindowId;
        use crate::ids::CorrelationId;
        use crate::session::{ExceptionFlags, ObservedWindow, SessionCommand, SessionObservation};
        let rev = session.accepted_revision();
        let window_id = WindowId(window.to_owned());
        let observation = SessionObservation {
            observation: Observation::new(owner.clone(), gen_id.clone(), rev, 100 + rev),
            windows: vec![ObservedWindow {
                window: window_id.clone(),
                output: OutputId(output.to_owned()),
                workspace: WorkspaceId(workspace.to_owned()),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }],
        };
        let correlation = CorrelationId::parse(&format!("corr-{window}")).expect("valid");
        let command = SessionCommand::Admit {
            window: window_id,
            output: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
            exceptions: ExceptionFlags::none(),
            exception_behavior: None,
            placement_bounds: Rect {
                x: 0,
                y: 0,
                w: 100,
                h: 50,
            },
        };
        let plan = session
            .propose(
                &command,
                &observation,
                &correlation,
                &LifecycleCapabilities::full(),
            )
            .expect("admit propose");
        session
            .acknowledge(&AdapterAck::new(
                correlation.clone(),
                owner.clone(),
                gen_id.clone(),
                rev,
                AckOutcome::Accepted,
            ))
            .expect("admit ack");
        session
            .verify_lifecycle(&LifecyclePostObservation::new(
                Observation::new(owner.clone(), gen_id.clone(), rev, 200 + rev),
                correlation,
                true,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            ))
            .expect("admit verify");
    }

    #[test]
    fn store_committed_retains_beyond_old_domain_cap_and_retires_empty() {
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        // Empty results still retire through the production commit path.
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner, &gen_id, d);
        engine.store_committed(key.clone(), session.clone(), 4);
        assert_eq!(engine.retained_domains(), 0);
        assert_eq!(engine.outer_gap(&key), None);
        // No retained-domain count cap on the production path: 20 committed
        // single-window sessions (well beyond the old 16-domain bound) are
        // all retained via `store_committed`, never refused or evicted.
        for i in 0..20 {
            let output = format!("out-{i}");
            let workspace = format!("ws-{i}");
            let window = format!("win-{i}");
            let d = domain(&output, &workspace);
            let key = d.key();
            let mut session = new_session(&owner, &gen_id, d);
            admit_one(&mut session, &owner, &gen_id, &output, &workspace, &window);
            engine.store_committed(key.clone(), session, 0);
            assert!(engine.contains(&key), "domain {i} retained");
            assert_eq!(engine.retained_domains(), i + 1);
        }
    }

    #[test]
    fn take_usable_retires_mismatch_without_proposing() {
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner, &gen_id, d.clone());
        engine.insert_raw(key.clone(), session, 0);
        assert!(engine.take_usable_session(&key, &d).is_none());
        assert!(!engine.contains(&key));
    }

    #[test]
    fn converged_move_with_changed_bounds_retains_session() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        use crate::seed::EngineWindow;
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let seed_order = ["win-1", "win-2"]
            .iter()
            .map(|window| EngineWindow {
                window: WindowId(window.to_string()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            })
            .collect::<Vec<_>>();
        let seeded =
            crate::seed::seed_session(&owner, &gen_id, 7, &d, &seed_order).expect("seeds two");
        let pre_revision = seeded.accepted_revision();
        engine.store_committed(key.clone(), seeded, 0);
        let mut changed = d.clone();
        changed.bounds = Rect {
            x: 0,
            y: 0,
            w: 1024,
            h: 768,
        };
        let windows = ["win-1", "win-2", "win-3"]
            .iter()
            .enumerate()
            .map(|(i, window)| EngineWindow {
                window: WindowId(window.to_string()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: (i as i32) * 100,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            })
            .collect::<Vec<_>>();
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-conv-bounds-retain").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: changed,
            domain_key: key.clone(),
            outer_gap: 0,
            focused_window: WindowId("win-1".to_owned()),
            windows: windows.clone(),
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Move {
                window: "win-1".to_owned(),
                direction: "left".to_owned(),
                cross_output_transfer: false,
            },
        };
        match engine.handle(&event) {
            CoreReply::Rejected { kind, message } => {
                assert_eq!(kind, "partial-observation");
                assert_eq!(message, "observation does not cover the known window set");
            }
            other => panic!("changed-bounds move must reject partial-observation, got {other:?}"),
        }
        assert!(engine.contains(&key), "refused op must retain slot");
        assert_eq!(engine.outer_gap(&key), Some(0), "outer gap preserved");
        let retained = engine.session(&key).expect("session retained");
        assert!(
            retained.accepted_revision() >= pre_revision,
            "converged revision preserved"
        );
        let mut members: Vec<String> = retained
            .snapshot()
            .windows
            .iter()
            .map(|l| l.window.0.clone())
            .collect();
        members.sort();
        assert_eq!(
            members,
            vec![
                "win-1".to_string(),
                "win-2".to_string(),
                "win-3".to_string()
            ],
            "converged membership preserved"
        );
        let reconcile = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-conv-bounds-reconcile").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: d.clone(),
            domain_key: key.clone(),
            outer_gap: 0,
            focused_window: WindowId("win-1".to_owned()),
            windows,
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&reconcile) {
            CoreReply::Projection(plan) => assert_eq!(
                plan.geometry.len(),
                3,
                "correct-domain reconcile projects survivors"
            ),
            other => panic!("reconcile must project survivors, got {other:?}"),
        }
    }

    #[test]
    fn relocate_refuses_pending_gap_collision_and_ambiguity() {
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner, &gen_id, d.clone());
        engine.insert_raw(key.clone(), session, 5);
        let target = domain("out-2", "ws");
        let target_key = target.key();
        // Empty source refuses (no topology to preserve).
        assert!(!engine.try_relocate_for_target(&target_key, &target, 0));
        assert!(!engine.contains(&target_key));
        assert!(engine.contains(&key));
        // Out-of-range outer gap refuses.
        assert!(!engine.try_relocate_for_target(&target_key, &target, 65));
        assert!(!engine.try_relocate_for_target(&target_key, &target, -1));
        // Target collision refuses even though the target slot is empty.
        engine.insert_raw(
            target_key.clone(),
            new_session(&owner, &gen_id, target.clone()),
            0,
        );
        assert!(!engine.try_relocate_for_target(&target_key, &target, 0));
        engine.remove(&target_key);
        // Ambiguous sources refuse.
        engine.insert_raw(
            domain("out-3", "ws").key(),
            new_session(&owner, &gen_id, domain("out-3", "ws")),
            0,
        );
        assert_eq!(engine.find_unique_source_for_target(&target_key), None);
        assert!(!engine.try_relocate_for_target(&target_key, &target, 0));
    }

    #[test]
    fn relocate_moves_seeded_topology_with_outer_gap() {
        use crate::directional::{OutputId, WorkspaceId};
        use crate::seed::{EngineWindow, seed_session};
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let source_domain = domain("out", "ws");
        let source_key = source_domain.key();
        let order = vec![EngineWindow {
            window: crate::directional::WindowId("win-1".to_owned()),
            output: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
            floating: false,
            fit_excluded: false,
            hints: crate::size_hints::WindowSizeHints::none(),
        }];
        let seeded = seed_session(&owner, &gen_id, 7, &source_domain, &order).expect("seeds");
        let revision = seeded.accepted_revision();
        engine.insert_raw(source_key.clone(), seeded, 3);
        let target_domain = OutputDomain {
            id: OutputId("out-2".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 800,
                h: 600,
            },
            gap: 0,
            adjacent: BTreeMap::new(),
        };
        let target_key = target_domain.key();
        assert_eq!(
            engine.find_unique_source_for_target(&target_key),
            Some(source_key.clone())
        );
        assert!(engine.outer_gap_matches(&source_key, 3));
        assert!(!engine.outer_gap_matches(&source_key, 0));
        assert!(engine.try_relocate_for_target(&target_key, &target_domain, 9));
        assert!(!engine.contains(&source_key));
        assert!(engine.contains(&target_key));
        assert_eq!(engine.outer_gap(&target_key), Some(9));
        let moved = engine.session(&target_key).expect("moved");
        assert_eq!(moved.accepted_revision(), revision);
        assert_eq!(moved.snapshot().windows.len(), 1);
    }

    #[test]
    fn relocated_target_skew_rejects_partial_observation_with_rollback() {
        use crate::boundary::CoreCommand;
        use crate::directional::WindowId;
        use crate::ids::CorrelationId;
        use crate::seed::EngineWindow;
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        // Source with two committed members; the target slot is absent so the
        // reconcile relocates (same outer gap) without converging first.
        let source_domain = domain("out", "ws");
        let source_key = source_domain.key();
        let seed_order = ["win-1", "win-2"]
            .iter()
            .map(|window| EngineWindow {
                window: WindowId(window.to_string()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            })
            .collect::<Vec<_>>();
        let source = crate::seed::seed_session(&owner, &gen_id, 7, &source_domain, &seed_order)
            .expect("seeds two");
        let source_revision = source.accepted_revision();
        engine.store_committed(source_key.clone(), source, 3);
        let target_domain = domain("out-2", "ws");
        let target_key = target_domain.key();
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-reloc-skew").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: target_domain.clone(),
            domain_key: target_key.clone(),
            outer_gap: 3,
            focused_window: WindowId("win-1".to_owned()),
            windows: vec![EngineWindow {
                window: WindowId("win-1".to_owned()),
                output: OutputId("out-2".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Rejected { kind, .. } => assert_eq!(
                kind, "partial-observation",
                "relocated skew must reject without projecting"
            ),
            other => panic!("relocated skew must reject partial-observation, got {other:?}"),
        }
        // Atomic rollback: the exact source state returns, the target stays
        // absent, and no revision or outer gap moved.
        assert!(!engine.contains(&target_key), "target stays absent");
        assert!(engine.contains(&source_key), "source restored");
        let restored = engine.session(&source_key).expect("source restored");
        assert_eq!(restored.accepted_revision(), source_revision);
        let mut members: Vec<String> = restored
            .snapshot()
            .windows
            .iter()
            .map(|l| l.window.0.clone())
            .collect();
        members.sort();
        assert_eq!(members, vec!["win-1".to_string(), "win-2".to_string()]);
        assert_eq!(engine.outer_gap(&source_key), Some(3));
        assert_eq!(engine.outer_gap(&target_key), None);
    }

    #[test]
    fn fresh_reconcile_mixed_float_names_first_tiled() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        // Focused window is floating, so the anchor is the first tiled
        // member; the complete observation still converges the exception.
        let d = domain("out", "ws");
        let key = d.key();
        let windows = vec![
            EngineWindow {
                window: WindowId("win-float".to_owned()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 100,
                    h: 100,
                },
                floating: true,
                fit_excluded: true,
                hints: crate::size_hints::WindowSizeHints::none(),
            },
            EngineWindow {
                window: WindowId("win-1".to_owned()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 400,
                    h: 600,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            },
            EngineWindow {
                window: WindowId("win-2".to_owned()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 400,
                    y: 0,
                    w: 400,
                    h: 600,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            },
        ];
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-mixed").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: d,
            domain_key: key.clone(),
            outer_gap: 0,
            focused_window: WindowId("win-float".to_owned()),
            windows,
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Tiled(plan) => {
                let mut members: Vec<String> = plan
                    .geometry
                    .iter()
                    .map(|entry| entry.window.0.clone())
                    .collect();
                members.sort();
                assert_eq!(members, vec!["win-1".to_string(), "win-2".to_string()]);
            }
            other => panic!("fresh mixed reconcile must plan tiled, got {other:?}"),
        }
        let session = engine.session(&key).expect("fresh domain retained");
        assert!(
            session.is_exception(&WindowId("win-float".to_owned())),
            "floating member converges as an exception"
        );
    }

    #[test]
    fn fresh_reconcile_prefers_relocation_over_seeding() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        // A unique same-workspace source relocates exactly like the retained
        // path instead of seeding a second session.
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let source_domain = domain("out", "ws");
        let source_key = source_domain.key();
        let order = vec![EngineWindow {
            window: WindowId("win-1".to_owned()),
            output: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
            floating: false,
            fit_excluded: false,
            hints: crate::size_hints::WindowSizeHints::none(),
        }];
        let seeded =
            crate::seed::seed_session(&owner, &gen_id, 7, &source_domain, &order).expect("seeds");
        engine.store_committed(source_key.clone(), seeded, 3);
        let target_domain = domain("out-2", "ws");
        let target_key = target_domain.key();
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-reloc").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: target_domain,
            domain_key: target_key.clone(),
            outer_gap: 3,
            focused_window: WindowId("win-1".to_owned()),
            windows: vec![EngineWindow {
                window: WindowId("win-1".to_owned()),
                output: OutputId("out-2".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Projection(plan) => assert_eq!(plan.geometry.len(), 1),
            other => panic!("relocated fresh reconcile must project, got {other:?}"),
        }
        assert!(!engine.contains(&source_key), "source moved");
        assert!(engine.contains(&target_key), "target retained");
    }

    #[test]
    fn fresh_reconcile_disjoint_unique_source_seeds_separate_domain() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        // Unique same-workspace source with disjoint observed windows must
        // not relocate: the fresh domain seeds separately and the source
        // stays untouched. Overlap relocation exact-set/rollback stays
        // covered by `fresh_reconcile_prefers_relocation_over_seeding` and
        // `relocated_target_skew_rejects_partial_observation_with_rollback`.
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let source_domain = domain("out", "ws");
        let source_key = source_domain.key();
        let order = vec![EngineWindow {
            window: WindowId("win-1".to_owned()),
            output: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
            floating: false,
            fit_excluded: false,
            hints: crate::size_hints::WindowSizeHints::none(),
        }];
        let seeded =
            crate::seed::seed_session(&owner, &gen_id, 7, &source_domain, &order).expect("seeds");
        let source_revision = seeded.accepted_revision();
        engine.store_committed(source_key.clone(), seeded, 3);
        let target_domain = domain("out-2", "ws");
        let target_key = target_domain.key();
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-disjoint").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: target_domain,
            domain_key: target_key.clone(),
            outer_gap: 3,
            focused_window: WindowId("win-9".to_owned()),
            windows: vec![EngineWindow {
                window: WindowId("win-9".to_owned()),
                output: OutputId("out-2".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Tiled(plan) => assert_eq!(plan.geometry.len(), 1),
            other => panic!("disjoint fresh reconcile must seed, got {other:?}"),
        }
        assert!(engine.contains(&target_key), "fresh target seeded");
        assert!(engine.contains(&source_key), "disjoint source preserved");
        let restored = engine.session(&source_key).expect("source kept");
        assert_eq!(restored.accepted_revision(), source_revision);
        assert_eq!(engine.retained_domains(), 2);
    }

    #[test]
    fn retained_reconcile_empty_retires_slot() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let order = ["win-1", "win-2"]
            .iter()
            .map(|window| EngineWindow {
                window: WindowId(window.to_string()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            })
            .collect::<Vec<_>>();
        let seeded = crate::seed::seed_session(&owner, &gen_id, 7, &d, &order).expect("seeds");
        let pre = seeded.accepted_revision();
        engine.store_committed(key.clone(), seeded, 0);
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-retire").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: d,
            domain_key: key.clone(),
            outer_gap: 0,
            focused_window: WindowId(String::new()),
            windows: vec![],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Projection(plan) => {
                assert!(plan.geometry.is_empty());
                assert_eq!(
                    plan.base_revision,
                    pre + 1,
                    "retire reports the converged revision"
                );
            }
            other => panic!("retained empty reconcile must project empty, got {other:?}"),
        }
        assert!(!engine.contains(&key), "empty slot retires");
        assert_eq!(engine.outer_gap(&key), None);
    }

    #[test]
    fn retained_reconcile_empty_keeps_gap_fence_before_retire() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        // Gap mismatch still refuses before any retire: the slot survives.
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let order = vec![EngineWindow {
            window: WindowId("win-1".to_owned()),
            output: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
            floating: false,
            fit_excluded: false,
            hints: crate::size_hints::WindowSizeHints::none(),
        }];
        let seeded = crate::seed::seed_session(&owner, &gen_id, 7, &d, &order).expect("seeds");
        engine.store_committed(key.clone(), seeded, 0);
        let mut gapped = d.clone();
        gapped.gap = 8;
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-gapfence").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: gapped,
            domain_key: key.clone(),
            outer_gap: 0,
            focused_window: WindowId(String::new()),
            windows: vec![],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Rejected { kind, .. } => assert_eq!(kind, "domain-mismatch"),
            other => panic!("gap-skewed empty reconcile must reject, got {other:?}"),
        }
        assert!(engine.contains(&key), "fenced slot survives");
    }

    #[test]
    fn retained_reconcile_empty_keeps_owner_fence_before_retire() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let order = vec![EngineWindow {
            window: WindowId("win-1".to_owned()),
            output: OutputId("out".to_owned()),
            workspace: WorkspaceId("ws".to_owned()),
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
            floating: false,
            fit_excluded: false,
            hints: crate::size_hints::WindowSizeHints::none(),
        }];
        let seeded = crate::seed::seed_session(&owner, &gen_id, 7, &d, &order).expect("seeds");
        engine.store_committed(key.clone(), seeded, 0);
        let event = CoreEvent {
            owner: OwnerId::parse("owner-b").expect("valid"),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-owner").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: d,
            domain_key: key.clone(),
            outer_gap: 0,
            focused_window: WindowId(String::new()),
            windows: vec![],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Diverged(_) => {}
            other => panic!("foreign-owner empty reconcile must diverge, got {other:?}"),
        }
        assert!(engine.contains(&key), "diverged slot survives");
    }

    #[test]
    fn update_gaps_malformed_tiled_links_still_reject() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        // A tiled observation homed to the domain while the converged tree
        // is missing cannot happen through convergence, so this pins the
        // fail-closed shape indirectly: a tiled member observed under an
        // unknown domain refuses instead of seeding through update-gaps.
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-gap-unknown").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: d,
            domain_key: key,
            outer_gap: 0,
            focused_window: WindowId("win-1".to_owned()),
            windows: vec![EngineWindow {
                window: WindowId("win-1".to_owned()),
                output: OutputId("out".to_owned()),
                workspace: WorkspaceId("ws".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::UpdateGaps,
        };
        match engine.handle(&event) {
            CoreReply::Rejected { kind, .. } => assert_eq!(kind, "unknown-domain"),
            other => panic!("fresh tiled update-gaps must refuse, got {other:?}"),
        }
        assert_eq!(engine.retained_domains(), 0, "refused update never seeds");
    }

    #[test]
    fn fresh_reconcile_seeds_despite_ambiguous_candidates() {
        use crate::boundary::{CoreCommand, CoreEvent, CoreReply};
        use crate::ids::CorrelationId;
        // Multiple same-workspace other-output sessions make relocation
        // ambiguous, so no source moves; with no pending, the absent domain
        // still seeds fresh (same as the admit path) while both candidates
        // stay untouched.
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        let mut engine = Engine::new();
        engine.sync_binding(&owner, &gen_id);
        for (output, window) in [("out-a", "win-a"), ("out-b", "win-b")] {
            let d = domain(output, "ws-x");
            let key = d.key();
            let order = vec![EngineWindow {
                window: WindowId(window.to_owned()),
                output: OutputId(output.to_owned()),
                workspace: WorkspaceId("ws-x".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }];
            let seeded = crate::seed::seed_session(&owner, &gen_id, 7, &d, &order).expect("seeds");
            engine.store_committed(key, seeded, 0);
        }
        assert_eq!(engine.retained_domains(), 2);
        let target = domain("out-c", "ws-x");
        let target_key = target.key();
        let event = CoreEvent {
            owner: owner.clone(),
            generation: gen_id.clone(),
            correlation: CorrelationId::parse("corr-rec-amb").expect("valid"),
            revision: 0,
            fingerprint: 7,
            domain: target,
            domain_key: target_key.clone(),
            outer_gap: 0,
            focused_window: WindowId("win-a".to_owned()),
            windows: vec![EngineWindow {
                window: WindowId("win-a".to_owned()),
                output: OutputId("out-c".to_owned()),
                workspace: WorkspaceId("ws-x".to_owned()),
                rect: Rect {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                floating: false,
                fit_excluded: false,
                hints: crate::size_hints::WindowSizeHints::none(),
            }],
            directional: None,
            directional_target_outer_gap: None,
            target_domain: None,
            target_windows: vec![],
            command: CoreCommand::Reconcile,
        };
        match engine.handle(&event) {
            CoreReply::Tiled(plan) => assert_eq!(plan.geometry.len(), 1),
            other => panic!("ambiguous fresh reconcile must seed, got {other:?}"),
        }
        assert!(engine.contains(&target_key), "fresh target seeded");
        assert_eq!(engine.retained_domains(), 3, "candidates untouched");
    }

    #[test]
    fn canonical_pair_helpers_stay_typed() {
        let mut anchored = domain("out", "ws");
        anchored.adjacent = BTreeMap::from([(
            crate::directional::Direction::Right,
            crate::directional::OutputId("out-2".to_owned()),
        )]);
        let stripped = Engine::canonical_component_domain(&anchored);
        assert!(stripped.adjacent.is_empty());
        assert_eq!(stripped.bounds, anchored.bounds);
        let engine = Engine::new();
        let target = domain("out-2", "ws");
        assert_eq!(
            engine
                .assemble_directional_pair(&anchored, &anchored.key(), &target, &target.key())
                .unwrap_err(),
            "canonical-source-unavailable"
        );
    }

    #[test]
    fn reproject_updates_bounds_only() {
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        engine.insert_raw(key.clone(), new_session(&owner, &gen_id, d), 0);
        let next = Rect {
            x: 0,
            y: 0,
            w: 1024,
            h: 768,
        };
        assert!(engine.reproject_retained(&key, next));
        assert_eq!(
            engine.session(&key).expect("kept").domains()[0].bounds,
            next
        );
        assert!(!engine.reproject_retained(&domain("missing", "ws").key(), next));
    }
}
