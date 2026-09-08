//! Durable platform-neutral authoritative session/domain and lifecycle foundation.
//!
//! transport-independent authoritative lifecycle over the ordered N-ary
//! [`crate::directional`] topology and the [`crate::geometry`] projector.
//! No platform, process, IPC, or native execution imports; only directional
//! semantic types, the portable projector, and the [`crate::contract`] /
//! [`crate::reconcile`] identity and acknowledgement model.
//!
//! Transaction model (immutable/transactional):
//! - `Session` owns logical `(OutputId, WorkspaceId)` domains, tiled topology
//!   and shares, the focused leaf, exception observation state, and the accepted
//!   revision (mirroring the internal [`crate::reconcile::Reconciler`]).
//! - `propose`: `&mut Session` + command/observation -> `SessionPlan` or
//!   refusal. Refusals leave state unchanged (except terminal divergence,
//!   which clears pending like the reconciler). At most one pending plan.
//! - `acknowledge`: delegates to the reconciler acknowledgement binding;
//!   terminal divergence clears the pending desired state like
//!   `note_adapter_loss`.
//! - `verify_lifecycle`: delegates to the reconciler lifecycle verifier; on
//!   commit the pending desired topology/focus/exceptions are applied and the
//!   accepted revision advances by exactly one. Terminal divergence clears the
//!   pending desired state.
//! - Acknowledgement/verification reuse the existing reconciler state machine;
//!   no second acknowledgement state machine exists here.
//!
//! Placement policy (explicit `cosmic_v1` lifecycle policy, deterministic,
//! no source COSMIC parity claim):
//! - Versioned [`crate::contract::LIFECYCLE_POLICY_VERSION`] (`cosmic_v1`);
//!   plans/dispatch carry the binding and the reconciler rejects mismatches.
//!   Frozen R1-R4 movement APIs/fixtures are unaffected.
//! - The first tiled admitted window in an empty logical domain becomes a root
//!   leaf.
//! - A subsequent normal tiled window inserts as a sibling after the focused
//!   eligible leaf in its parent when the parent axis matches the input
//!   placement orientation; otherwise the focused leaf and the new leaf nest
//!   beneath a generated group with the input orientation and equal `[1, 1]`
//!   shares. Sibling insertion preserves existing shares and inserts share `1`
//!   for the entrant. The new leaf is focused.
//! - Input placement orientation is carried explicitly as logical `bounds`
//!   (`w >= h` selects [`Axis::Horizontal`], else [`Axis::Vertical`];
//!   horizontal on tie).
//! - When no eligible focus exists in the target domain, appending after the
//!   last root child (group root) or nesting the single root leaf is
//!   project-selected fallback, not source COSMIC parity.
//! - Removal retains empty logical domains (trees become
//!   `None`), removes empty groups, and collapses single-child groups
//!   recursively. Unaffected subtree identity/order and shares are preserved
//!   (a collapsed child inherits its collapsed parent slot). Focus moves to the
//!   next sibling leaf, then the previous, then the first remaining leaf,
//!   deterministically; non-focused removals preserve focus.
//! - Floating/fullscreen/maximized/sticky exception flags are explicit. An
//!   admission carrying any set flag without an explicit
//!   [`ExceptionBehavior`] fails closed instead of silently tiling. An
//!   admission carrying `Some` behavior with no set flag is malformed and
//!   refused.
//!
//! Domain model: logical outputs and workspaces are separate domains keyed by
//! the distinct `(OutputId, WorkspaceId)` pair with exact opaque ids preserved
//! and deterministic construction order. Trees, focus, and projected geometry
//! are domain-scoped. The portable [`SessionSnapshot`] carries ordered N-ary
//! trees and [`WindowLink`]s and may repeat an `OutputId` across workspaces;
//! the frozen [`crate::directional::Snapshot`] cannot represent duplicate
//! output ids and is therefore exposed only per single logical domain via
//! [`Session::domain_snapshot`], never as a global abused snapshot.
//!
//! Plans carry full portable identity binding (owner/generation/correlation/
//! base revision via [`crate::contract::LifecycleDispatch`]), the semantic
//! lifecycle intent, affected ids (operation plus desired snapshot), required
//! capabilities/preconditions, desired topology/focus, and complete desired
//! geometry for affected tiled windows. No native commands exist here.

use std::collections::{BTreeMap, BTreeSet};

use crate::contract::{
    Dispatch, DivergenceKind, FocusCapabilities, FocusDispatch, FocusIntent, FocusOperation,
    FocusPlanContract, FocusPostObservation, LifecycleCapabilities, LifecycleDispatch,
    LifecycleIntent, LifecycleOperation, LifecyclePlan, LifecyclePostObservation, Observation,
    PostObservation, ResizeCapabilities, ResizeDispatch, ResizeIntent, ResizeOperation, ResizePlan,
    ResizePostObservation, is_revision,
};
use crate::directional::{
    Axis, Capabilities, Direction, FocusPlan, MoveOperation, MovePlan, Node, NodeId, OutputId,
    Snapshot, WindowId, WindowLink, WorkspaceId,
};
use crate::geometry::{Rect, project};
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::reconcile::{AckApplied, AckError, Commit, Reconciler, StatusView, VerifyError};

/// Observed-window vector bound.
pub const MAX_OBSERVED_WINDOWS: usize = 64;
/// Logical domain bound.
pub const MAX_DOMAINS: usize = 16;

/// Logical output domain: separate output/workspace scope with explicit
/// portable bounds and gap for the deterministic projector, plus configured
/// logical same-workspace output adjacency for R4 planning. Adjacency maps a
/// portable [`Direction`] to a neighboring [`OutputId`] in the same workspace;
/// targets resolve as `(target_output, self.workspace)` domain keys and are
/// validated strictly reciprocal/known/non-self/same-workspace at
/// [`Session::new`]. No platform enums or native data appear here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputDomain {
    pub id: OutputId,
    pub workspace: WorkspaceId,
    pub bounds: Rect,
    pub gap: i32,
    pub adjacent: BTreeMap<Direction, OutputId>,
}

impl OutputDomain {
    /// Validity without echoing input (shape only; reciprocal/known/same
    /// workspace membership is validated across all domains at construction).
    #[must_use]
    pub fn validate(&self) -> bool {
        !self.id.0.is_empty()
            && !self.workspace.0.is_empty()
            && self.bounds.w > 0
            && self.bounds.h > 0
            && self.bounds.x.checked_add(self.bounds.w).is_some()
            && self.bounds.y.checked_add(self.bounds.h).is_some()
            && self.gap >= 0
            && self.adjacent.len() <= 4
            && self
                .adjacent
                .iter()
                .all(|(_, target)| !target.0.is_empty() && target != &self.id)
    }

    /// Domain key for this logical domain.
    #[must_use]
    pub fn key(&self) -> DomainKey {
        DomainKey {
            output: self.id.clone(),
            workspace: self.workspace.clone(),
        }
    }
}

/// Logical domain key: distinct `(OutputId, WorkspaceId)` pair with exact
/// opaque ids preserved. Logical outputs and workspaces remain separate
/// domains, so one output id may appear with several workspace ids.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DomainKey {
    pub output: OutputId,
    pub workspace: WorkspaceId,
}

/// Portable view of one logical domain: exact opaque ids plus its ordered
/// N-ary tree (`None` for an empty retained domain).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionDomainView {
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub tree: Option<Node>,
}

/// Portable session snapshot: ordered domain views in session construction
/// order plus window links sorted by window id. Unlike
/// [`crate::directional::Snapshot`], an `OutputId` may repeat across distinct
/// workspace domains.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub domains: Vec<SessionDomainView>,
    pub windows: Vec<WindowLink>,
}

/// Explicit observed exception flags for one window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExceptionFlags {
    pub floating: bool,
    pub fullscreen: bool,
    pub maximized: bool,
    pub sticky: bool,
}

impl ExceptionFlags {
    /// No exception flags set.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        }
    }

    /// Whether any exception flag is set.
    #[must_use]
    pub const fn any(self) -> bool {
        self.floating || self.fullscreen || self.maximized || self.sticky
    }
}

/// Explicit caller-selected behavior for an observed exception window. Fail
/// closed: admission with any set flag and `None` behavior is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExceptionBehavior {
    Defer,
}

/// One adapter-observed window with explicit exception flags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedWindow {
    pub window: WindowId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub floating: bool,
    pub fullscreen: bool,
    pub maximized: bool,
    pub sticky: bool,
}

impl ObservedWindow {
    /// Exception flags for this observation.
    #[must_use]
    pub const fn flags(&self) -> ExceptionFlags {
        ExceptionFlags {
            floating: self.floating,
            fullscreen: self.fullscreen,
            maximized: self.maximized,
            sticky: self.sticky,
        }
    }
}

/// Session observation: identity-bound revision plus the complete normalized
/// observed window list. Completeness is enforced at proposal: the observed
/// set must equal the known tiled-plus-exception set (plus the admitted window
/// for admissions).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionObservation {
    pub observation: Observation,
    pub windows: Vec<ObservedWindow>,
}

/// Lifecycle command against the accepted session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionCommand {
    Admit {
        window: WindowId,
        output: OutputId,
        workspace: WorkspaceId,
        exceptions: ExceptionFlags,
        exception_behavior: Option<ExceptionBehavior>,
        placement_bounds: Rect,
    },
    Remove {
        window: WindowId,
    },
}

/// Non-divergent session refusal reasons. Fixed redacted messages only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalKind {
    DuplicateWindow,
    UnknownWindow,
    UnknownDomain,
    FocusMismatch,
    NotTiled,
    PlannerNoop,
    PlannerRejected,
    UnsupportedCapability,
    CrossDomainMismatch,
    MalformedInput,
    MalformedTopology,
    PartialObservation,
    ExceptionBehaviorUnselected,
    Unchanged,
}

impl RefusalKind {
    /// Stable kind string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DuplicateWindow => "duplicate-window",
            Self::UnknownWindow => "unknown-window",
            Self::UnknownDomain => "unknown-domain",
            Self::FocusMismatch => "focus-mismatch",
            Self::NotTiled => "not-tiled",
            Self::PlannerNoop => "planner-noop",
            Self::PlannerRejected => "planner-rejected",
            Self::UnsupportedCapability => "unsupported-capability",
            Self::CrossDomainMismatch => "cross-domain-mismatch",
            Self::MalformedInput => "malformed-input",
            Self::MalformedTopology => "malformed-topology",
            Self::PartialObservation => "partial-observation",
            Self::ExceptionBehaviorUnselected => "exception-behavior-unselected",
            Self::Unchanged => "unchanged",
        }
    }

    /// Fixed redacted message; never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::DuplicateWindow => "window is already known to the session",
            Self::UnknownWindow => "window is not known to the session",
            Self::UnknownDomain => "domain is not known to the session",
            Self::FocusMismatch => "focus does not resolve to the selected domain",
            Self::NotTiled => "focused window is not a tiled window",
            Self::PlannerNoop => "planner reports no movement",
            Self::PlannerRejected => "planner rejects the movement",
            Self::UnsupportedCapability => "adapter does not declare the required capability",
            Self::CrossDomainMismatch => {
                "input output or workspace does not match a logical domain"
            }
            Self::MalformedInput => "command or observation input is malformed",
            Self::MalformedTopology => "topology or shares are malformed or not projectable",
            Self::PartialObservation => "observation does not cover the known window set",
            Self::ExceptionBehaviorUnselected => {
                "exception window requires an explicit behavior selection"
            }
            Self::Unchanged => "command would not change session state",
        }
    }
}

/// Session proposal failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposeError {
    /// At most one pending plan.
    PendingExists,
    /// Fail-closed divergence; terminal like the reconciler.
    Diverged(DivergenceKind),
    /// Non-divergent refusal; state unchanged and still usable.
    Refused(RefusalKind),
}

impl ProposeError {
    /// Stable kind string, never echoes input.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::PendingExists => "pending-exists",
            Self::Diverged(reason) => reason.as_str(),
            Self::Refused(reason) => reason.as_str(),
        }
    }

    /// Fixed redacted message, never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::PendingExists => "complete the pending plan before proposing",
            Self::Diverged(reason) => reason.message(),
            Self::Refused(reason) => reason.message(),
        }
    }
}

/// Construction failure (pre-state, never divergence).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionNewError {
    InvalidOwner,
    InvalidGeneration,
    RevisionOutOfBounds,
    InvalidDomain,
}

impl SessionNewError {
    /// Stable kind string.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::InvalidOwner => "owner-invalid",
            Self::InvalidGeneration => "generation-invalid",
            Self::RevisionOutOfBounds => "revision-out-of-bounds",
            Self::InvalidDomain => "domain-invalid",
        }
    }
}

/// Complete desired geometry for one affected tiled window.
/// Domain-scoped: names the exact `(output, workspace)` domain plus leaf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesiredGeometry {
    pub window: WindowId,
    pub leaf: NodeId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub rect: Rect,
}

/// Authoritative session plan: reconciler identity-bound lifecycle dispatch
/// plus desired topology/focus and complete desired geometry for affected
/// tiled windows. No native commands. The dispatch carries the
/// `cosmic_v1` lifecycle policy binding
/// ([`crate::contract::LIFECYCLE_POLICY_VERSION`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPlan {
    pub dispatch: LifecycleDispatch,
    pub desired_snapshot: SessionSnapshot,
    pub desired_focus_domain: Option<DomainKey>,
    pub desired_focus_leaf: Option<NodeId>,
    pub desired_geometry: Vec<DesiredGeometry>,
}

/// Authoritative movement plan: reconciler identity-bound directional
/// [`Dispatch`] (operation/preconditions/rule/capability/intent) plus desired
/// topology/snapshot, desired focus, and complete desired rectangles for every
/// tiled window in affected domains. No KWin execution fields. Affected
/// domains are the source domain for R1-R3 and source plus adjacent target
/// for R4. The mover remains focused (for R4 the focus domain changes with
/// it). Immutable and complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMovePlan {
    pub dispatch: Dispatch,
    pub desired_snapshot: SessionSnapshot,
    pub desired_focus_domain: DomainKey,
    pub desired_focus_leaf: NodeId,
    pub desired_geometry: Vec<DesiredGeometry>,
}

/// Authoritative focus plan: reconciler identity-bound portable
/// [`FocusDispatch`] (semantic focus operation/preconditions/capability/intent
/// plus owner/generation/correlation/base revision) plus the deterministic
/// directional [`FocusPlan`], desired topology/snapshot (unmodified),
/// desired focus, and complete desired rectangles for the selected domain.
/// No native commands. The focus mover commits only via
/// acknowledge-then-[`Session::verify_focus`]; exhausted edges refuse as
/// [`RefusalKind::Unchanged`] with no plan and no pending. Immutable and
/// complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFocusPlan {
    pub dispatch: FocusDispatch,
    pub focus_plan: FocusPlan,
    pub desired_snapshot: SessionSnapshot,
    pub desired_focus_domain: DomainKey,
    pub desired_focus_leaf: NodeId,
    pub desired_geometry: Vec<DesiredGeometry>,
}

/// Authoritative resize plan: reconciler identity-bound portable
/// [`ResizeDispatch`] (semantic resize operation/preconditions/
/// capability/intent plus owner/generation/correlation/base revision) plus the
/// deterministic contract [`ResizePlan`], desired topology/snapshot (shares
/// only), unchanged desired focus, and complete desired rectangles for every
/// tiled window in the affected domain. No native commands. The resizer
/// commits only via acknowledge-then-[`Session::verify_resize`]; missing
/// boundaries refuse as [`RefusalKind::Unchanged`] with no plan and no
/// pending. Focus is retained exactly. Immutable and complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionResizePlan {
    pub dispatch: ResizeDispatch,
    pub resize_plan: ResizePlan,
    pub desired_snapshot: SessionSnapshot,
    pub desired_focus_domain: DomainKey,
    pub desired_focus_leaf: NodeId,
    pub desired_geometry: Vec<DesiredGeometry>,
}

/// Stored exception record for a deferred window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExceptionRecord {
    pub window: WindowId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub flags: ExceptionFlags,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingDesired {
    trees: BTreeMap<DomainKey, Option<Node>>,
    windows: BTreeMap<WindowId, WindowLink>,
    focused_domain: Option<DomainKey>,
    focused_leaf: Option<NodeId>,
    exceptions: BTreeMap<WindowId, ExceptionRecord>,
}

/// Durable authoritative session. See module docs for the transaction model.
#[derive(Debug, Clone)]
pub struct Session {
    owner: OwnerId,
    generation: GenerationId,
    accepted_fingerprint: u64,
    domains: Vec<OutputDomain>,
    trees: BTreeMap<DomainKey, Option<Node>>,
    windows: BTreeMap<WindowId, WindowLink>,
    focused_domain: Option<DomainKey>,
    focused_leaf: Option<NodeId>,
    exceptions: BTreeMap<WindowId, ExceptionRecord>,
    reconciler: Reconciler,
    pending_desired: Option<PendingDesired>,
}

impl Session {
    /// Create an empty session over explicit logical domains.
    pub fn new(
        owner: OwnerId,
        generation: GenerationId,
        initial_revision: u64,
        initial_fingerprint: u64,
        domains: Vec<OutputDomain>,
    ) -> Result<Self, SessionNewError> {
        if !crate::contract::is_owner_id(owner.as_str()) {
            return Err(SessionNewError::InvalidOwner);
        }
        if !crate::contract::is_generation_id(generation.as_str()) {
            return Err(SessionNewError::InvalidGeneration);
        }
        if !is_revision(initial_revision) {
            return Err(SessionNewError::RevisionOutOfBounds);
        }
        if domains.is_empty()
            || domains.len() > MAX_DOMAINS
            || !domains.iter().all(|d| d.validate())
        {
            return Err(SessionNewError::InvalidDomain);
        }
        let mut seen = BTreeSet::new();
        for domain in &domains {
            if !seen.insert((domain.id.clone(), domain.workspace.clone())) {
                return Err(SessionNewError::InvalidDomain);
            }
        }
        if !validate_adjacency(&domains) {
            return Err(SessionNewError::InvalidDomain);
        }
        let reconciler = Reconciler::new(
            owner.clone(),
            generation.clone(),
            initial_revision,
            initial_fingerprint,
        )
        .map_err(|_| SessionNewError::RevisionOutOfBounds)?;
        let trees = domains.iter().map(|d| (d.key(), None)).collect();
        Ok(Self {
            owner,
            generation,
            accepted_fingerprint: initial_fingerprint,
            domains,
            trees,
            windows: BTreeMap::new(),
            focused_domain: None,
            focused_leaf: None,
            exceptions: BTreeMap::new(),
            reconciler,
            pending_desired: None,
        })
    }

    /// Accepted revision (mirrors the reconciler verified revision).
    #[must_use]
    pub fn accepted_revision(&self) -> u64 {
        self.reconciler.verified_revision()
    }

    /// Accepted fingerprint from the last commit (or initial seed).
    #[must_use]
    pub const fn accepted_fingerprint(&self) -> u64 {
        self.accepted_fingerprint
    }

    /// Session owner binding (mirrors the reconciler binding).
    #[must_use]
    pub fn owner(&self) -> &OwnerId {
        &self.owner
    }

    /// Session generation binding (mirrors the reconciler binding).
    #[must_use]
    pub fn generation(&self) -> &GenerationId {
        &self.generation
    }

    /// Recorded divergence, if fail-closed.
    #[must_use]
    pub fn divergence(&self) -> Option<DivergenceKind> {
        self.reconciler.divergence()
    }

    /// Redacted status view (delegates to the reconciler).
    #[must_use]
    pub fn status(&self) -> StatusView {
        self.reconciler.status()
    }

    /// Whether a plan is pending acknowledgement/verification.
    #[must_use]
    pub fn has_pending(&self) -> bool {
        self.reconciler.status().pending
    }

    /// Whether pending desired session state is staged.
    #[must_use]
    pub fn has_pending_desired(&self) -> bool {
        self.pending_desired.is_some()
    }

    /// Logical domains in deterministic construction order.
    #[must_use]
    pub fn domains(&self) -> &[OutputDomain] {
        &self.domains
    }

    /// Current authoritative portable snapshot (domain order; windows sorted
    /// by window id). May repeat an `OutputId` across workspace domains.
    #[must_use]
    pub fn snapshot(&self) -> SessionSnapshot {
        self.snapshot_for(&self.trees, &self.windows)
    }

    /// Single-domain directional snapshot for movement reuse. Returns `None`
    /// for unknown domains. Scoped to exactly one logical domain so the
    /// frozen directional unique-output invariant is never abused.
    #[must_use]
    pub fn domain_snapshot(&self, output: &OutputId, workspace: &WorkspaceId) -> Option<Snapshot> {
        use crate::directional::Output;
        let domain = self.domain_for(output, workspace)?;
        let key = domain.key();
        let tree = self.trees.get(&key).cloned().flatten();
        let windows: Vec<WindowLink> = self
            .windows
            .values()
            .filter(|l| &l.output == output && &l.workspace == workspace)
            .cloned()
            .collect();
        Some(Snapshot {
            outputs: vec![Output {
                id: output.clone(),
                workspace: workspace.clone(),
                tree,
                adjacent: BTreeMap::new(),
            }],
            windows,
        })
    }

    /// Current domain-scoped focus: the focused `(output, workspace)` domain
    /// plus the focused leaf.
    #[must_use]
    pub fn focus(&self) -> (Option<DomainKey>, Option<NodeId>) {
        (self.focused_domain.clone(), self.focused_leaf.clone())
    }

    /// Number of tracked exception windows.
    #[must_use]
    pub fn exception_count(&self) -> usize {
        self.exceptions.len()
    }

    /// Whether a window is tracked as an exception.
    #[must_use]
    pub fn is_exception(&self, window: &WindowId) -> bool {
        self.exceptions.contains_key(window)
    }

    /// Exception entries as observed windows (sorted by window id).
    #[must_use]
    pub fn exception_observed(&self) -> Vec<ObservedWindow> {
        self.exceptions
            .values()
            .map(|record| ObservedWindow {
                window: record.window.clone(),
                output: record.output.clone(),
                workspace: record.workspace.clone(),
                floating: record.flags.floating,
                fullscreen: record.flags.fullscreen,
                maximized: record.flags.maximized,
                sticky: record.flags.sticky,
            })
            .collect()
    }

    fn snapshot_for(
        &self,
        trees: &BTreeMap<DomainKey, Option<Node>>,
        windows: &BTreeMap<WindowId, WindowLink>,
    ) -> SessionSnapshot {
        let mut domains = Vec::with_capacity(self.domains.len());
        for domain in &self.domains {
            domains.push(SessionDomainView {
                output: domain.id.clone(),
                workspace: domain.workspace.clone(),
                tree: trees.get(&domain.key()).cloned().flatten(),
            });
        }
        let windows = windows.values().cloned().collect();
        SessionSnapshot { domains, windows }
    }

    fn domain_for(&self, output: &OutputId, workspace: &WorkspaceId) -> Option<&OutputDomain> {
        self.domains
            .iter()
            .find(|d| &d.id == output && &d.workspace == workspace)
    }

    fn all_node_ids(&self) -> BTreeSet<NodeId> {
        let mut ids = BTreeSet::new();
        for tree in self.trees.values().flatten() {
            collect_node_ids(tree, &mut ids);
        }
        ids
    }

    fn validate_current_topology(&self) -> bool {
        validate_topology(
            &self.domains,
            &self.trees,
            &self.windows,
            &self.exceptions,
            &self.focused_domain,
            &self.focused_leaf,
        )
    }

    /// Propose a lifecycle command against a complete session observation.
    ///
    /// Transactional: refusals leave state unchanged and usable; terminal
    /// divergences (stale revision, capability, binding mismatch) clear pending
    /// like the reconciler. At most one pending plan.
    pub fn propose(
        &mut self,
        command: &SessionCommand,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &LifecycleCapabilities,
    ) -> Result<SessionPlan, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if self.has_pending() {
            return Err(ProposeError::PendingExists);
        }
        if !self.validate_current_topology() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        // Shape checks (non-divergent refusals).
        if !valid_command_shapes(command) {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        if session_observation.windows.len() > MAX_OBSERVED_WINDOWS
            || !valid_observed_shapes(&session_observation.windows)
        {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        // Cross-domain checks before duplicate/unknown so unknown domains
        // classify deterministically.
        if let Err(kind) = self.check_domains(command, &session_observation.windows) {
            return Err(ProposeError::Refused(kind));
        }
        match command {
            SessionCommand::Admit {
                window,
                output,
                workspace,
                exceptions,
                exception_behavior,
                placement_bounds,
            } => self.propose_admit(
                window,
                output,
                workspace,
                *exceptions,
                *exception_behavior,
                *placement_bounds,
                session_observation,
                correlation_id,
                capabilities,
            ),
            SessionCommand::Remove { window } => {
                self.propose_remove(window, session_observation, correlation_id, capabilities)
            }
        }
    }

    fn check_domains(
        &self,
        command: &SessionCommand,
        observed: &[ObservedWindow],
    ) -> Result<(), RefusalKind> {
        match command {
            SessionCommand::Admit {
                output, workspace, ..
            } => {
                if self.domain_for(output, workspace).is_none() {
                    return Err(RefusalKind::CrossDomainMismatch);
                }
            }
            SessionCommand::Remove { .. } => {}
        }
        for entry in observed {
            if self.domain_for(&entry.output, &entry.workspace).is_none() {
                return Err(RefusalKind::CrossDomainMismatch);
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn propose_admit(
        &mut self,
        window: &WindowId,
        output: &OutputId,
        workspace: &WorkspaceId,
        exceptions: ExceptionFlags,
        exception_behavior: Option<ExceptionBehavior>,
        placement_bounds: Rect,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &LifecycleCapabilities,
    ) -> Result<SessionPlan, ProposeError> {
        if self.windows.contains_key(window) || self.exceptions.contains_key(window) {
            return Err(ProposeError::Refused(RefusalKind::DuplicateWindow));
        }
        // Completeness: observed must equal known plus the admitted window.
        let mut known: BTreeSet<&WindowId> =
            self.windows.keys().chain(self.exceptions.keys()).collect();
        known.insert(window);
        let observed_ids: BTreeSet<&WindowId> = session_observation
            .windows
            .iter()
            .map(|w| &w.window)
            .collect();
        if observed_ids != known {
            return Err(ProposeError::Refused(RefusalKind::PartialObservation));
        }
        let Some(entry) = session_observation
            .windows
            .iter()
            .find(|w| &w.window == window)
        else {
            return Err(ProposeError::Refused(RefusalKind::PartialObservation));
        };
        if &entry.output != output || &entry.workspace != workspace || entry.flags() != exceptions {
            return Err(ProposeError::Refused(RefusalKind::PartialObservation));
        }
        // Known-window observation bindings must match stored state.
        if !self.observed_known_match(&session_observation.windows, Some(window)) {
            return Err(ProposeError::Refused(RefusalKind::PartialObservation));
        }
        if exceptions.any() && exception_behavior.is_none() {
            return Err(ProposeError::Refused(
                RefusalKind::ExceptionBehaviorUnselected,
            ));
        }
        if !exceptions.any() && exception_behavior.is_some() {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        if !valid_rect_shape(&placement_bounds) {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        let deferred = exceptions.any();
        if deferred {
            // Exception deferral: no topology effect, exception set grows.
            let mut desired_exceptions = self.exceptions.clone();
            desired_exceptions.insert(
                window.clone(),
                ExceptionRecord {
                    window: window.clone(),
                    output: output.clone(),
                    workspace: workspace.clone(),
                    flags: exceptions,
                },
            );
            let desired_snapshot = self.snapshot_for(&self.trees, &self.windows);
            if desired_exceptions == self.exceptions {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            }
            let intent = LifecycleIntent::Admit {
                window: window.clone(),
                output: output.clone(),
                workspace: workspace.clone(),
            };
            let operation = LifecycleOperation::AdmitDeferred {
                window: window.clone(),
                output: output.clone(),
                workspace: workspace.clone(),
            };
            let plan = LifecyclePlan::for_operation(intent, operation);
            let dispatch = self
                .reconciler
                .propose_lifecycle(
                    &plan,
                    &session_observation.observation,
                    correlation_id,
                    capabilities,
                )
                .map_err(|e| match e {
                    crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                    crate::reconcile::ProposeError::Diverged(reason) => {
                        ProposeError::Diverged(reason)
                    }
                })?;
            self.pending_desired = Some(PendingDesired {
                trees: self.trees.clone(),
                windows: self.windows.clone(),
                focused_domain: self.focused_domain.clone(),
                focused_leaf: self.focused_leaf.clone(),
                exceptions: desired_exceptions,
            });
            return Ok(SessionPlan {
                dispatch,
                desired_snapshot,
                desired_focus_domain: self.focused_domain.clone(),
                desired_focus_leaf: self.focused_leaf.clone(),
                desired_geometry: Vec::new(),
            });
        }
        // Normal tiled admission.
        let orientation = orientation_from_bounds(&placement_bounds);
        let mut node_ids = self.all_node_ids();
        let leaf_id = generate_leaf_id(window, &mut node_ids);
        node_ids.insert(leaf_id.clone());
        let base_revision = session_observation.observation.revision;
        let key = DomainKey {
            output: output.clone(),
            workspace: workspace.clone(),
        };
        let mut desired_trees = self.trees.clone();
        let target_tree = desired_trees.get(&key).cloned().flatten();
        let eligible_focus = self.eligible_focus_in(&key);
        let new_target = insert_tiled(
            target_tree,
            eligible_focus.as_ref(),
            leaf_id.clone(),
            orientation,
            &mut node_ids,
            window,
            base_revision,
        );
        desired_trees.insert(key.clone(), new_target);
        // Desired window links (sorted via BTreeMap).
        let mut desired_windows = self.windows.clone();
        desired_windows.insert(
            window.clone(),
            WindowLink {
                window: window.clone(),
                leaf: leaf_id.clone(),
                output: output.clone(),
                workspace: workspace.clone(),
            },
        );
        let desired_snapshot = self.snapshot_for(&desired_trees, &desired_windows);
        if !validate_topology(
            &self.domains,
            &desired_trees,
            &desired_windows,
            &self.exceptions,
            &Some(key.clone()),
            &Some(leaf_id.clone()),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        if desired_trees == self.trees
            && desired_windows == self.windows
            && self.focused_domain.as_ref() == Some(&key)
            && self.focused_leaf.as_ref() == Some(&leaf_id)
        {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        let desired_geometry = project_output_geometry(
            self.domain_for(output, workspace),
            desired_trees.get(&key).cloned().flatten().as_ref(),
            &desired_windows,
            &key,
        )
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if desired_geometry.is_empty() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let intent = LifecycleIntent::Admit {
            window: window.clone(),
            output: output.clone(),
            workspace: workspace.clone(),
        };
        let operation = LifecycleOperation::Admit {
            window: window.clone(),
            leaf: leaf_id.clone(),
            output: output.clone(),
            workspace: workspace.clone(),
        };
        let plan = LifecyclePlan::for_operation(intent, operation);
        let dispatch = self
            .reconciler
            .propose_lifecycle(
                &plan,
                &session_observation.observation,
                correlation_id,
                capabilities,
            )
            .map_err(|e| match e {
                crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                crate::reconcile::ProposeError::Diverged(reason) => ProposeError::Diverged(reason),
            })?;
        self.pending_desired = Some(PendingDesired {
            trees: desired_trees.clone(),
            windows: desired_windows.clone(),
            focused_domain: Some(key.clone()),
            focused_leaf: Some(leaf_id.clone()),
            exceptions: self.exceptions.clone(),
        });
        Ok(SessionPlan {
            dispatch,
            desired_snapshot,
            desired_focus_domain: Some(key),
            desired_focus_leaf: Some(leaf_id),
            desired_geometry,
        })
    }

    fn propose_remove(
        &mut self,
        window: &WindowId,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &LifecycleCapabilities,
    ) -> Result<SessionPlan, ProposeError> {
        let tiled = self.windows.get(window).cloned();
        let deferred = self.exceptions.get(window).cloned();
        if tiled.is_none() && deferred.is_none() {
            return Err(ProposeError::Refused(RefusalKind::UnknownWindow));
        }
        if tiled.is_some() && deferred.is_some() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        // Completeness: observed must equal the known set (includes removed).
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
        if let Some(record) = deferred {
            // Exception removal: topology unchanged, exception set shrinks.
            let mut desired_exceptions = self.exceptions.clone();
            desired_exceptions.remove(window);
            let desired_snapshot = self.snapshot_for(&self.trees, &self.windows);
            let (mut focus_domain, mut focus_leaf) =
                (self.focused_domain.clone(), self.focused_leaf.clone());
            // Exception windows never hold leaf focus; preserve focus as long
            // as it still resolves, else fall back.
            if !self.focus_resolves(&focus_domain, &focus_leaf, &self.trees, &self.windows) {
                let fallback = first_leaf_global(&self.domains, &self.trees);
                focus_domain = fallback.clone().map(|(k, _)| k);
                focus_leaf = fallback.map(|(_, l)| l);
            }
            let intent = LifecycleIntent::Remove {
                window: window.clone(),
            };
            let operation = LifecycleOperation::RemoveDeferred {
                window: window.clone(),
                output: record.output.clone(),
                workspace: record.workspace.clone(),
            };
            let plan = LifecyclePlan::for_operation(intent, operation);
            let dispatch = self
                .reconciler
                .propose_lifecycle(
                    &plan,
                    &session_observation.observation,
                    correlation_id,
                    capabilities,
                )
                .map_err(|e| match e {
                    crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                    crate::reconcile::ProposeError::Diverged(reason) => {
                        ProposeError::Diverged(reason)
                    }
                })?;
            self.pending_desired = Some(PendingDesired {
                trees: self.trees.clone(),
                windows: self.windows.clone(),
                focused_domain: focus_domain.clone(),
                focused_leaf: focus_leaf.clone(),
                exceptions: desired_exceptions,
            });
            return Ok(SessionPlan {
                dispatch,
                desired_snapshot,
                desired_focus_domain: focus_domain,
                desired_focus_leaf: focus_leaf,
                desired_geometry: Vec::new(),
            });
        }
        let link = tiled.clone().expect("tiled link present");
        let key = DomainKey {
            output: link.output.clone(),
            workspace: link.workspace.clone(),
        };
        let leaf = link.leaf.clone();
        let mut desired_trees = self.trees.clone();
        let target_tree = desired_trees.get(&key).cloned().flatten();
        let pre_leaves = target_tree.as_ref().map(collect_leaves).unwrap_or_default();
        let removed_pos = pre_leaves.iter().position(|id| id == &leaf);
        let new_target = remove_leaf_from_tree(target_tree, &leaf);
        desired_trees.insert(key.clone(), new_target.clone());
        let mut desired_windows = self.windows.clone();
        desired_windows.remove(window);
        let desired_snapshot = self.snapshot_for(&desired_trees, &desired_windows);
        // Focus: preserve unless the removed leaf was focused.
        let was_focused =
            self.focused_leaf.as_ref() == Some(&leaf) && self.focused_domain.as_ref() == Some(&key);
        let (desired_focus_domain, desired_focus_leaf) = if was_focused {
            let post_leaves = new_target.as_ref().map(collect_leaves).unwrap_or_default();
            if post_leaves.is_empty() {
                match first_leaf_global(&self.domains, &desired_trees) {
                    Some((k, l)) => (Some(k), Some(l)),
                    None => (None, None),
                }
            } else {
                let next = removed_pos
                    .filter(|pos| *pos < post_leaves.len())
                    .map(|pos| post_leaves[pos].clone())
                    .unwrap_or_else(|| post_leaves.last().expect("non-empty").clone());
                (Some(key.clone()), Some(next))
            }
        } else {
            // Preserve focus if it still resolves, else deterministic fallback.
            if self.focus_resolves(
                &self.focused_domain,
                &self.focused_leaf,
                &desired_trees,
                &desired_windows,
            ) {
                (self.focused_domain.clone(), self.focused_leaf.clone())
            } else {
                match first_leaf_global(&self.domains, &desired_trees) {
                    Some((k, l)) => (Some(k), Some(l)),
                    None => (None, None),
                }
            }
        };
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
        if desired_trees == self.trees
            && desired_windows == self.windows
            && desired_focus_domain == self.focused_domain
            && desired_focus_leaf == self.focused_leaf
        {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        // Complete desired geometry for the affected domain when tiled leaves
        // remain; empty when the domain is now empty.
        let desired_geometry = match new_target.as_ref() {
            Some(tree) => project_output_geometry(
                self.domain_for(&key.output, &key.workspace),
                Some(tree),
                &desired_windows,
                &key,
            )
            .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?,
            None => Vec::new(),
        };
        let intent = LifecycleIntent::Remove {
            window: window.clone(),
        };
        let operation = LifecycleOperation::Remove {
            window: window.clone(),
            leaf: leaf.clone(),
            output: key.output.clone(),
            workspace: key.workspace.clone(),
        };
        let plan = LifecyclePlan::for_operation(intent, operation);
        let dispatch = self
            .reconciler
            .propose_lifecycle(
                &plan,
                &session_observation.observation,
                correlation_id,
                capabilities,
            )
            .map_err(|e| match e {
                crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                crate::reconcile::ProposeError::Diverged(reason) => ProposeError::Diverged(reason),
            })?;
        self.pending_desired = Some(PendingDesired {
            trees: desired_trees.clone(),
            windows: desired_windows.clone(),
            focused_domain: desired_focus_domain.clone(),
            focused_leaf: desired_focus_leaf.clone(),
            exceptions: self.exceptions.clone(),
        });
        Ok(SessionPlan {
            dispatch,
            desired_snapshot,
            desired_focus_domain,
            desired_focus_leaf,
            desired_geometry,
        })
    }

    fn observed_known_match(
        &self,
        observed: &[ObservedWindow],
        admit_new: Option<&WindowId>,
    ) -> bool {
        let by_id: BTreeMap<&WindowId, &ObservedWindow> =
            observed.iter().map(|w| (&w.window, w)).collect();
        for (id, link) in &self.windows {
            let Some(entry) = by_id.get(id) else {
                return false;
            };
            if entry.output != link.output || entry.workspace != link.workspace {
                return false;
            }
            if entry.flags().any() {
                return false;
            }
        }
        for (id, record) in &self.exceptions {
            if Some(id) == admit_new {
                continue;
            }
            let Some(entry) = by_id.get(id) else {
                return false;
            };
            if entry.output != record.output
                || entry.workspace != record.workspace
                || entry.flags() != record.flags
            {
                return false;
            }
        }
        true
    }

    fn eligible_focus_in(&self, key: &DomainKey) -> Option<NodeId> {
        if self.focused_domain.as_ref() != Some(key) {
            return None;
        }
        let focused = self.focused_leaf.clone()?;
        let tree = self.trees.get(key).cloned().flatten()?;
        if collect_leaves(&tree).contains(&focused) {
            let link_holds = self.windows.values().any(|l| {
                l.leaf == focused && l.output == key.output && l.workspace == key.workspace
            });
            if link_holds {
                return Some(focused);
            }
        }
        None
    }

    fn focus_resolves(
        &self,
        domain: &Option<DomainKey>,
        leaf: &Option<NodeId>,
        trees: &BTreeMap<DomainKey, Option<Node>>,
        windows: &BTreeMap<WindowId, WindowLink>,
    ) -> bool {
        let (Some(domain), Some(leaf)) = (domain, leaf) else {
            return domain.is_none() && leaf.is_none();
        };
        let Some(tree) = trees.get(domain).cloned().flatten() else {
            return false;
        };
        if !collect_leaves(&tree).contains(leaf) {
            return false;
        }
        windows.values().any(|l| {
            &l.leaf == leaf && l.output == domain.output && l.workspace == domain.workspace
        })
    }

    fn focused_window_for(&self, leaf: &NodeId, key: &DomainKey) -> Option<WindowId> {
        self.windows
            .values()
            .find(|l| &l.leaf == leaf && l.output == key.output && l.workspace == key.workspace)
            .map(|l| l.window.clone())
    }

    /// Same-workspace directional snapshot for movement: source plus every
    /// domain sharing the source workspace (adjacent or not), so the frozen
    /// planner validates against unique outputs without cross-workspace leaks.
    /// Window links cover tiled windows in those domains only.
    fn move_snapshot(&self, source: &DomainKey) -> Option<Snapshot> {
        use crate::directional::Output;
        let source_domain = self.domains.iter().find(|d| &d.key() == source)?;
        let mut outputs = Vec::new();
        for domain in &self.domains {
            if domain.workspace != source_domain.workspace {
                continue;
            }
            let tree = self.trees.get(&domain.key()).cloned().flatten();
            outputs.push(Output {
                id: domain.id.clone(),
                workspace: domain.workspace.clone(),
                tree,
                adjacent: domain.adjacent.clone(),
            });
        }
        outputs.iter().find(|o| o.id == source.output)?;
        let mut windows = Vec::new();
        for link in self.windows.values() {
            if link.workspace != source_domain.workspace {
                continue;
            }
            // Only links whose output resolves to an included same-workspace
            // domain participate; others would be stale.
            if outputs.iter().any(|o| o.id == link.output) {
                windows.push(link.clone());
            }
        }
        Some(Snapshot { outputs, windows })
    }

    /// Propose directional movement for the selected exact opaque
    /// `(domain, window)` pair.
    ///
    /// The supplied opaque [`WindowId`] must equal the authoritative logical
    /// focused tiled window in exactly `domain`; mismatch, unknown windows,
    /// or exception windows refuse without pending. The frozen
    /// `cosmic_v1::plan_move_with_capabilities` planner is invoked on a
    /// same-workspace directional snapshot, then exactly its [`MovePlan`]
    /// is applied mechanically to the desired topology via
    /// [`apply_move_operation`], which fail-closes against every frozen
    /// planner semantic field. R1-R3 affect only the source domain; R4
    /// affects source plus the adjacent same-workspace target. The mover
    /// remains focused (for R4 the focus domain changes).
    ///
    /// Transactional like lifecycle: refusals and planner noops leave state
    /// unchanged with no pending; only an accepted plan stages pending desired
    /// state through the shared single reconciler slot.
    pub fn propose_move(
        &mut self,
        domain: &DomainKey,
        window: &WindowId,
        direction: Direction,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &Capabilities,
    ) -> Result<SessionMovePlan, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if self.has_pending() {
            return Err(ProposeError::PendingExists);
        }
        let Some(source_domain) = self.domains.iter().find(|d| &d.key() == domain).cloned() else {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        };
        if !self.validate_current_topology() {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
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
        // Completeness: observed must equal known tiled-plus-exception set.
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
        if window.0.is_empty() {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        // Exact opaque scope: supplied window must equal the authoritative
        // logical focused tiled window in exactly `domain`.
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
        if self.exceptions.contains_key(&focused_window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        if window != &focused_window {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        let Some(snapshot) = self.move_snapshot(domain) else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let intent = crate::directional::MoveIntent {
            source_output: domain.output.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
        };
        let outcome =
            crate::cosmic_v1::plan_move_with_capabilities(&snapshot, &intent, capabilities);
        let plan = match outcome {
            crate::directional::MoveOutcome::Planned(plan) => plan,
            crate::directional::MoveOutcome::Noop { .. } => {
                return Err(ProposeError::Refused(RefusalKind::PlannerNoop));
            }
            crate::directional::MoveOutcome::Rejected { reason } => {
                if reason.kind == crate::directional::RejectionKind::UnsupportedTopology {
                    return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
                }
                return Err(ProposeError::Refused(RefusalKind::PlannerRejected));
            }
        };
        let base_revision = session_observation.observation.revision;
        let Some((desired_trees, desired_windows, desired_focus_domain, desired_focus_leaf)) =
            apply_move_operation(
                &self.trees,
                &self.windows,
                &self.domains,
                domain,
                &focused_leaf,
                direction,
                &plan,
                base_revision,
            )
        else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        // Strict no cross-domain except source/adjacent R4 in same workspace.
        if !move_touches_only_allowed(
            &self.trees,
            &desired_trees,
            domain,
            &plan.operation,
            &self.domains,
        ) {
            return Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch));
        }
        if !validate_topology(
            &self.domains,
            &desired_trees,
            &desired_windows,
            &self.exceptions,
            &Some(desired_focus_domain.clone()),
            &Some(desired_focus_leaf.clone()),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let affected: Vec<DomainKey> = match &plan.operation {
            MoveOperation::CrossOutput { target_output, .. } => {
                let target_key = DomainKey {
                    output: target_output.clone(),
                    workspace: domain.workspace.clone(),
                };
                vec![domain.clone(), target_key]
            }
            _ => vec![domain.clone()],
        };
        let desired_geometry =
            project_affected_geometry(&self.domains, &desired_trees, &desired_windows, &affected)
                .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        // Completeness: every tiled window in affected domains must have a
        // positive rectangle.
        if !geometry_covers_affected(&desired_geometry, &desired_windows, &affected) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let _ = source_domain;
        let dispatch = self
            .reconciler
            .propose(
                &plan,
                &session_observation.observation,
                correlation_id,
                capabilities,
            )
            .map_err(|e| match e {
                crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                crate::reconcile::ProposeError::Diverged(reason) => ProposeError::Diverged(reason),
            })?;
        self.pending_desired = Some(PendingDesired {
            trees: desired_trees.clone(),
            windows: desired_windows.clone(),
            focused_domain: Some(desired_focus_domain.clone()),
            focused_leaf: Some(desired_focus_leaf.clone()),
            exceptions: self.exceptions.clone(),
        });
        Ok(SessionMovePlan {
            dispatch,
            desired_snapshot: self.snapshot_for(&desired_trees, &desired_windows),
            desired_focus_domain,
            desired_focus_leaf,
            desired_geometry,
        })
    }

    /// Commit a pending movement plan after acknowledgement. On commit the
    /// pending desired topology/focus apply atomically and the accepted
    /// revision advances by exactly one. Terminal divergence clears the pending
    /// desired state. Lifecycle plans must use [`Session::verify_lifecycle`].
    pub fn verify_move(&mut self, post: &PostObservation) -> Result<Commit, VerifyError> {
        match self.reconciler.verify(post) {
            Ok(commit) => {
                if let Some(desired) = self.pending_desired.take() {
                    self.trees = desired.trees;
                    self.windows = desired.windows;
                    self.focused_domain = desired.focused_domain;
                    self.focused_leaf = desired.focused_leaf;
                    self.exceptions = desired.exceptions;
                    self.accepted_fingerprint = commit.fingerprint;
                }
                Ok(commit)
            }
            Err(VerifyError::Diverged(reason)) => {
                self.pending_desired = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

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
        };
        let plan = FocusPlanContract::for_operation(intent, operation);
        let dispatch = self
            .reconciler
            .propose_focus(
                &plan,
                &session_observation.observation,
                correlation_id,
                capabilities,
            )
            .map_err(|e| match e {
                crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                crate::reconcile::ProposeError::Diverged(reason) => ProposeError::Diverged(reason),
            })?;
        let desired_snapshot = self.snapshot_for(&self.trees, &self.windows);
        self.pending_desired = Some(PendingDesired {
            trees: self.trees.clone(),
            windows: self.windows.clone(),
            focused_domain: Some(domain.clone()),
            focused_leaf: Some(target_leaf.clone()),
            exceptions: self.exceptions.clone(),
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
                    self.exceptions = desired.exceptions;
                    self.accepted_fingerprint = commit.fingerprint;
                }
                Ok(commit)
            }
            Err(VerifyError::Diverged(reason)) => {
                self.pending_desired = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Propose portable keyboard split-share resize for the selected exact
    /// opaque `(domain, window)` pair.
    ///
    /// The supplied opaque [`WindowId`] must equal the authoritative logical
    /// focused tiled window in exactly `domain`; mismatch, unknown windows,
    /// or exception windows refuse without pending. The pure
    /// [`crate::directional::plan_resize_step`] nearest matching-axis ancestor
    /// boundary is resolved, the deterministic 1/16 share-step transfer is
    /// computed, and the normalized shares are applied through the reusable
    /// [`crate::directional::apply_resize_shares`] primitive (future
    /// pointer-resize submits normalized boundary/share operations through the
    /// same primitive). Only the two selected adjacent shares change (plus an
    /// exact x16 ratio-preserving normalization of the whole selected group
    /// when the pair total is not divisible by 16); descendants/topology/order
    /// are unchanged and focus is retained exactly.
    ///
    /// Complete geometry for every tiled window in the affected domain must
    /// project before any pending is staged; unprojectable/minimum-geometry
    /// failures refuse without pending. Missing boundaries refuse as
    /// [`RefusalKind::Unchanged`] with no plan and no pending. Stale,
    /// incomplete, malformed, pending, or unsupported-resize-capability inputs
    /// refuse or diverge fail-closed.
    pub fn propose_resize(
        &mut self,
        domain: &DomainKey,
        window: &WindowId,
        direction: Direction,
        session_observation: &SessionObservation,
        correlation_id: &CorrelationId,
        capabilities: &ResizeCapabilities,
    ) -> Result<SessionResizePlan, ProposeError> {
        if let Some(reason) = self.reconciler.divergence() {
            return Err(ProposeError::Diverged(reason));
        }
        if self.has_pending() {
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
        if self.exceptions.contains_key(&focused_window) {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        if window != &focused_window {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        }
        // Exception/floating/fullscreen/maximized/sticky focus refuses: the
        // observed entry for the focused tiled window must carry no flags
        // (tiled bindings already checked via observed_known_match, but check
        // explicitly for a stable NotTiled classification).
        if let Some(entry) = session_observation
            .windows
            .iter()
            .find(|w| w.window == focused_window)
            && entry.flags().any()
        {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        if !capabilities.supports(crate::contract::ResizeCapability::KeyboardResize) {
            return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
        }
        let Some(tree) = self.trees.get(domain).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        let step = match crate::cosmic_v1::plan_resize_step(&tree, &focused_leaf, direction) {
            Ok(step) => step,
            Err(crate::cosmic_v1::ResizePlanError::NoBoundary) => {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            }
            Err(crate::cosmic_v1::ResizePlanError::Malformed) => {
                return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
            }
        };
        let Some(updated_tree) =
            crate::cosmic_v1::apply_resize_shares(&tree, &step.target_group, &step.new_shares)
        else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let mut desired_trees = self.trees.clone();
        desired_trees.insert(domain.clone(), Some(updated_tree));
        if desired_trees == self.trees {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        if !validate_topology(
            &self.domains,
            &desired_trees,
            &self.windows,
            &self.exceptions,
            &Some(domain.clone()),
            &Some(focused_leaf.clone()),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let desired_geometry = project_affected_geometry(
            &self.domains,
            &desired_trees,
            &self.windows,
            std::slice::from_ref(domain),
        )
        .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !geometry_covers_affected(
            &desired_geometry,
            &self.windows,
            std::slice::from_ref(domain),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let intent = ResizeIntent {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
        };
        let operation = ResizeOperation {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
            target_group: step.target_group.clone(),
            focused_child: step.focused_child.clone(),
            neighbor_child: step.neighbor_child.clone(),
            focused_index: step.focused_index,
            neighbor_index: step.neighbor_index,
            old_shares: step.old_shares.clone(),
            new_shares: step.new_shares.clone(),
        };
        let plan = ResizePlan::for_operation(intent, operation);
        let dispatch = self
            .reconciler
            .propose_resize(
                &plan,
                &session_observation.observation,
                correlation_id,
                capabilities,
            )
            .map_err(|e| match e {
                crate::reconcile::ProposeError::PendingExists => ProposeError::PendingExists,
                crate::reconcile::ProposeError::Diverged(reason) => ProposeError::Diverged(reason),
            })?;
        let desired_snapshot = self.snapshot_for(&desired_trees, &self.windows);
        self.pending_desired = Some(PendingDesired {
            trees: desired_trees.clone(),
            windows: self.windows.clone(),
            focused_domain: Some(domain.clone()),
            focused_leaf: Some(focused_leaf.clone()),
            exceptions: self.exceptions.clone(),
        });
        Ok(SessionResizePlan {
            dispatch,
            resize_plan: plan,
            desired_snapshot,
            desired_focus_domain: domain.clone(),
            desired_focus_leaf: focused_leaf,
            desired_geometry,
        })
    }

    /// Commit a pending resize plan after acknowledgement. On commit only the
    /// resized shares apply atomically (windows/focus/exceptions unmodified)
    /// and the accepted revision advances by exactly one. Terminal divergence
    /// clears the pending desired state. Movement plans must use
    /// [`Session::verify_move`]; lifecycle plans must use
    /// [`Session::verify_lifecycle`]; focus plans must use
    /// [`Session::verify_focus`].
    pub fn verify_resize(&mut self, post: &ResizePostObservation) -> Result<Commit, VerifyError> {
        match self.reconciler.verify_resize(post) {
            Ok(commit) => {
                if let Some(desired) = self.pending_desired.take() {
                    self.trees = desired.trees;
                    self.windows = desired.windows;
                    self.focused_domain = desired.focused_domain;
                    self.focused_leaf = desired.focused_leaf;
                    self.exceptions = desired.exceptions;
                    self.accepted_fingerprint = commit.fingerprint;
                }
                Ok(commit)
            }
            Err(VerifyError::Diverged(reason)) => {
                self.pending_desired = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Record an explicit adapter acknowledgement (shared binding for movement
    /// and lifecycle pending plans). Terminal divergence clears the pending
    /// desired state, matching [`Session::note_adapter_loss`].
    pub fn acknowledge(
        &mut self,
        ack: &crate::contract::AdapterAck,
    ) -> Result<AckApplied, AckError> {
        match self.reconciler.acknowledge(ack) {
            Ok(applied) => Ok(applied),
            Err(AckError::NoPending) => Err(AckError::NoPending),
            Err(AckError::Diverged(reason)) => {
                self.pending_desired = None;
                Err(AckError::Diverged(reason))
            }
        }
    }

    /// Commit a pending lifecycle plan after acknowledgement. On commit the
    /// pending desired topology/focus/exceptions apply atomically and the
    /// accepted revision advances by exactly one. Terminal divergence clears
    /// the pending desired state, matching [`Session::note_adapter_loss`].
    pub fn verify_lifecycle(
        &mut self,
        post: &LifecyclePostObservation,
    ) -> Result<Commit, VerifyError> {
        match self.reconciler.verify_lifecycle(post) {
            Ok(commit) => {
                if let Some(desired) = self.pending_desired.take() {
                    self.trees = desired.trees;
                    self.windows = desired.windows;
                    self.focused_domain = desired.focused_domain;
                    self.focused_leaf = desired.focused_leaf;
                    self.exceptions = desired.exceptions;
                    self.accepted_fingerprint = commit.fingerprint;
                }
                Ok(commit)
            }
            Err(VerifyError::Diverged(reason)) => {
                self.pending_desired = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Explicit adapter-loss signal: terminal divergence, pending discarded.
    pub fn note_adapter_loss(&mut self) -> DivergenceKind {
        self.pending_desired = None;
        self.reconciler.note_adapter_loss()
    }
}

fn opposite_direction(direction: Direction) -> Direction {
    match direction {
        Direction::Left => Direction::Right,
        Direction::Right => Direction::Left,
        Direction::Up => Direction::Down,
        Direction::Down => Direction::Up,
    }
}

/// Strict adjacency validation: every target is known, non-self, same
/// workspace (resolved as `(target_output, source_workspace)`), and strictly
/// reciprocal via the opposite direction.
fn validate_adjacency(domains: &[OutputDomain]) -> bool {
    use std::collections::BTreeMap;
    let mut by_key: BTreeMap<(OutputId, WorkspaceId), &OutputDomain> = BTreeMap::new();
    for domain in domains {
        by_key.insert((domain.id.clone(), domain.workspace.clone()), domain);
    }
    for domain in domains {
        for (direction, target) in &domain.adjacent {
            if target.0.is_empty() || target == &domain.id {
                return false;
            }
            let Some(target_domain) = by_key.get(&(target.clone(), domain.workspace.clone()))
            else {
                return false;
            };
            if target_domain.workspace != domain.workspace {
                return false;
            }
            let opposite = opposite_direction(*direction);
            match target_domain.adjacent.get(&opposite) {
                Some(back) if back == &domain.id => {}
                _ => return false,
            }
        }
    }
    true
}

fn step_for_direction(direction: Direction) -> i32 {
    match direction {
        Direction::Right | Direction::Down => 1,
        Direction::Left | Direction::Up => -1,
    }
}

fn generate_move_group_id(
    focused_leaf: &NodeId,
    base_revision: u64,
    rule: &str,
    existing: &BTreeSet<NodeId>,
) -> NodeId {
    let base = format!("grp-{}-r{}-{}", focused_leaf.0, base_revision, rule);
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

fn find_group_id(tree: &Node, id: &NodeId) -> bool {
    if tree.id() == id {
        return matches!(tree, Node::Group { .. });
    }
    match tree {
        Node::Leaf { .. } => false,
        Node::Group { children, .. } => children.iter().any(|c| find_group_id(c, id)),
    }
}

fn replace_node_by_id(tree: Node, target: &NodeId, replacement: Node) -> Option<Node> {
    if tree.id() == target {
        return Some(replacement);
    }
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            children,
            shares,
        } => {
            let mut new_children = children;
            for child in new_children.iter_mut() {
                if child.id() == target || subtree_contains_id(child, target) {
                    let updated = replace_node_by_id(child.clone(), target, replacement.clone())?;
                    *child = updated;
                    return Some(Node::Group {
                        id,
                        axis,
                        children: new_children,
                        shares,
                    });
                }
            }
            // Direct child fast path already covered; no match.
            None
        }
    }
}

fn subtree_contains_id(node: &Node, id: &NodeId) -> bool {
    if node.id() == id {
        return true;
    }
    match node {
        Node::Leaf { .. } => false,
        Node::Group { children, .. } => children.iter().any(|c| subtree_contains_id(c, id)),
    }
}

fn group_children_len(tree: &Node, id: &NodeId) -> Option<usize> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id: gid, children, ..
        } => {
            if gid == id {
                return Some(children.len());
            }
            for child in children {
                if let Some(len) = group_children_len(child, id) {
                    return Some(len);
                }
            }
            None
        }
    }
}

fn insert_leaf_into_group(
    tree: Node,
    group_id: &NodeId,
    index: usize,
    leaf: Node,
    share: u64,
) -> Option<Node> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            mut children,
            mut shares,
        } => {
            if &id == group_id {
                if index > children.len() {
                    return None;
                }
                children.insert(index, leaf);
                shares.insert(index, share);
                return Some(Node::Group {
                    id,
                    axis,
                    children,
                    shares,
                });
            }
            for (pos, child) in children.iter().enumerate() {
                if child.id() == group_id || subtree_contains_id(child, group_id) {
                    let updated = insert_leaf_into_group(
                        child.clone(),
                        group_id,
                        index,
                        leaf.clone(),
                        share,
                    )?;
                    children[pos] = updated;
                    return Some(Node::Group {
                        id,
                        axis,
                        children,
                        shares,
                    });
                }
            }
            None
        }
    }
}

type AppliedMove = (
    BTreeMap<DomainKey, Option<Node>>,
    BTreeMap<WindowId, WindowLink>,
    DomainKey,
    NodeId,
);

/// Mechanically apply exactly the frozen planner [`MovePlan`] to the desired
/// topology. Fail-closed against every frozen planner semantic field: the
/// plan `rule` must equal its operation rule and the canonical rule for the
/// operation variant, capability/preconditions must be canonical, and the
/// intent must bind source output, focused leaf/window, and direction.
/// Per-variant structural bindings (direction/axis/edge/parent/container,
/// insertion kind/index/target, split midpoint/axis/focused-side, R2a len==2,
/// R2c directional neighbor, R3 edge/parent/insertion-or-R1, R4 root edge)
/// are validated against the pre-mutation source topology before any
/// mechanical edit. Returns desired trees/windows plus desired focus on
/// success. New wrapper groups take deterministic unique ids; untouched
/// subtree identity/order/shares are preserved; entrant shares are `1` and
/// new splits are `[1, 1]`; R2c wrappers carry the summed pair share;
/// R2a swaps preserve the window-share binding (no resize). No replacement
/// planning occurs here.
#[allow(clippy::too_many_arguments)]
fn apply_move_operation(
    trees: &BTreeMap<DomainKey, Option<Node>>,
    windows: &BTreeMap<WindowId, WindowLink>,
    domains: &[OutputDomain],
    source: &DomainKey,
    focused_leaf: &NodeId,
    direction: Direction,
    plan: &MovePlan,
    base_revision: u64,
) -> Option<AppliedMove> {
    use crate::directional::{EscapeContinuation, FocusedSide, Insertion, Rule};
    let operation = &plan.operation;
    // Frozen binding: plan must exactly match its own semantic operation.
    if plan.rule != operation.rule() {
        return None;
    }
    if plan.required_capability != operation.required_capability() {
        return None;
    }
    if plan.preconditions != operation.preconditions() {
        return None;
    }
    if plan.preconditions.len() > crate::contract::MAX_PRECONDITIONS {
        return None;
    }
    if !plan
        .preconditions
        .contains(&crate::directional::Precondition::AdapterMustVerifyPostconditions)
    {
        return None;
    }
    // Canonical rule per operation variant.
    let canonical = match operation {
        MoveOperation::WrapPerpendicular { .. } => Rule::R1,
        MoveOperation::SwapNeighbor { .. } => Rule::R2a,
        MoveOperation::InsertIntoGroup { .. } => Rule::R2b,
        MoveOperation::SplitGroupChild { .. } => Rule::R2b,
        MoveOperation::WrapNeighbor { .. } => Rule::R2c,
        MoveOperation::EscapeParent { .. } => Rule::R3,
        MoveOperation::CrossOutput { .. } => Rule::R4,
    };
    if plan.rule != canonical || operation.rule() != canonical {
        return None;
    }
    // Intentional bindings.
    if plan.intent.source_output != source.output {
        return None;
    }
    if plan.intent.focused_leaf != *focused_leaf {
        return None;
    }
    if plan.intent.direction != direction {
        return None;
    }
    let mover_window = windows
        .values()
        .find(|l| {
            &l.leaf == focused_leaf && l.output == source.output && l.workspace == source.workspace
        })?
        .window
        .clone();
    if plan.intent.focused_window != mover_window {
        return None;
    }
    let mut desired_trees = trees.clone();
    let mut desired_windows = windows.clone();
    let mut node_ids = BTreeSet::new();
    for tree in desired_trees.values().flatten() {
        collect_node_ids(tree, &mut node_ids);
    }
    let mover_leaf_node = Node::Leaf {
        id: focused_leaf.clone(),
    };
    let direction_axis = Axis::for_direction(direction);
    let step = step_for_direction(direction);
    match operation {
        MoveOperation::WrapPerpendicular {
            container, axis, ..
        } => {
            // Intentional axis: operation axis must name the D axis.
            if *axis != direction_axis {
                return None;
            }
            let tree = desired_trees.get(source).cloned().flatten()?;
            if !find_group_id(&tree, container) {
                return None;
            }
            // Extract focused leaf from its container.
            let (container_children, container_axis, container_id) =
                match find_group(&tree, container) {
                    Some((children, axis, id)) => (children, axis, id),
                    None => return None,
                };
            // Container must be the direct parent and perpendicular to D.
            if container_axis == direction_axis {
                return None;
            }
            if direct_parent_of_leaf(&tree, focused_leaf)? != *container {
                return None;
            }
            let pos = container_children
                .iter()
                .position(|c| c.id() == focused_leaf)?;
            // Focused must be a direct leaf child.
            if !matches!(container_children[pos], Node::Leaf { .. }) {
                return None;
            }
            let mut remaining_children = container_children.clone();
            let mut remaining_shares = find_group_shares(&tree, container)?;
            remaining_children.remove(pos);
            remaining_shares.remove(pos);
            let remainder: Node = if remaining_children.len() == 1 {
                remaining_children.into_iter().next()?
            } else if remaining_children.is_empty() {
                return None;
            } else {
                Node::Group {
                    id: container_id.clone(),
                    axis: container_axis,
                    children: remaining_children,
                    shares: remaining_shares,
                }
            };
            // W at the D end: negative first, positive last.
            let new_id = generate_move_group_id(focused_leaf, base_revision, "r1", &node_ids);
            node_ids.insert(new_id.clone());
            let new_group = if step_for_direction(direction) == -1 {
                Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![mover_leaf_node, remainder],
                    shares: vec![1, 1],
                }
            } else {
                Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![remainder, mover_leaf_node],
                    shares: vec![1, 1],
                }
            };
            let new_tree = replace_node_by_id(tree, container, new_group)?;
            desired_trees.insert(source.clone(), Some(new_tree));
            Some((
                desired_trees,
                desired_windows,
                source.clone(),
                focused_leaf.clone(),
            ))
        }
        MoveOperation::SwapNeighbor {
            container,
            neighbor,
            ..
        } => {
            let tree = desired_trees.get(source).cloned().flatten()?;
            // R2a: exactly 2 direct children, parallel container, directional
            // leaf neighbor. Uneven shares travel with their windows (no
            // resize): `swap_direct_children` swaps children and shares
            // together so each window retains its absolute share.
            let (children, shares, caxis) = match find_group(&tree, container) {
                Some((children, axis, _)) => {
                    let s = find_group_shares(&tree, container)?;
                    (children, s, axis)
                }
                None => return None,
            };
            if children.len() != 2 {
                return None;
            }
            if caxis != direction_axis {
                return None;
            }
            if direct_parent_of_leaf(&tree, focused_leaf)? != *container {
                return None;
            }
            let iw = children.iter().position(|c| c.id() == focused_leaf)?;
            let ineighbor = children.iter().position(|c| c.id() == neighbor)?;
            if (iw as i32 - ineighbor as i32).abs() != 1 {
                return None;
            }
            if ineighbor as i32 != iw as i32 + step {
                return None;
            }
            if !matches!(children[iw], Node::Leaf { .. })
                || !matches!(children[ineighbor], Node::Leaf { .. })
            {
                return None;
            }
            if shares.len() != 2 {
                return None;
            }
            let updated = swap_direct_children(tree, container, focused_leaf, neighbor)?;
            desired_trees.insert(source.clone(), Some(updated));
            Some((
                desired_trees,
                desired_windows,
                source.clone(),
                focused_leaf.clone(),
            ))
        }
        MoveOperation::WrapNeighbor {
            container,
            neighbor,
            focused_before_neighbor,
            axis,
            ..
        } => {
            // R2c: 3+ parallel children, directional neighbor, operation axis
            // names the container orientation (== D axis).
            if *axis != direction_axis {
                return None;
            }
            let tree = desired_trees.get(source).cloned().flatten()?;
            let (children, shares, cid, caxis) = find_group_full(&tree, container)?;
            if children.len() < 3 {
                return None;
            }
            if caxis != direction_axis || caxis != *axis {
                return None;
            }
            if direct_parent_of_leaf(&tree, focused_leaf)? != *container {
                return None;
            }
            let iw = children.iter().position(|c| c.id() == focused_leaf)?;
            let ineighbor = children.iter().position(|c| c.id() == neighbor)?;
            // Must be adjacent with the advertised order and direction.
            if (iw as i32 - ineighbor as i32).abs() != 1 {
                return None;
            }
            if ineighbor as i32 != iw as i32 + step {
                return None;
            }
            if *focused_before_neighbor != (iw < ineighbor) {
                return None;
            }
            if &caxis != axis {
                // Operation axis names the container orientation; enforce.
                return None;
            }
            let first = iw.min(ineighbor);
            let pair_share: u64 = shares[iw].checked_add(shares[ineighbor])?;
            let w_node = children[iw].clone();
            let s_node = children[ineighbor].clone();
            if w_node.id() != focused_leaf {
                return None;
            }
            let mut new_children = children.clone();
            let mut new_shares = shares.clone();
            // Remove higher index first.
            let hi = iw.max(ineighbor);
            let lo = iw.min(ineighbor);
            new_children.remove(hi);
            new_shares.remove(hi);
            new_children.remove(lo);
            new_shares.remove(lo);
            let new_id = generate_move_group_id(focused_leaf, base_revision, "r2c", &node_ids);
            node_ids.insert(new_id.clone());
            let wrapper = if *focused_before_neighbor {
                Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![w_node, s_node],
                    shares: vec![1, 1],
                }
            } else {
                Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![s_node, w_node],
                    shares: vec![1, 1],
                }
            };
            new_children.insert(first, wrapper);
            new_shares.insert(first, pair_share);
            let updated = replace_group_children(tree, &cid, new_children, new_shares)?;
            desired_trees.insert(source.clone(), Some(updated));
            Some((
                desired_trees,
                desired_windows,
                source.clone(),
                focused_leaf.clone(),
            ))
        }
        MoveOperation::InsertIntoGroup {
            container,
            target_group,
            insertion_index,
            insertion,
            ..
        } => {
            let tree = desired_trees.get(source).cloned().flatten()?;
            // R2b insert: len==2 parallel container, directional group
            // neighbor == target, insertion kind/index/target constraints.
            let (container_children, container_axis) = match find_group(&tree, container) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            if container_children.len() != 2 {
                return None;
            }
            if container_axis != direction_axis {
                return None;
            }
            if direct_parent_of_leaf(&tree, focused_leaf)? != *container {
                return None;
            }
            let iw = container_children
                .iter()
                .position(|c| c.id() == focused_leaf)?;
            let ineighbor = (iw as i32 + step) as usize;
            let (t_children, t_axis) = match find_group(&tree, target_group) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            // Neighbor in D must be exactly the target group.
            let neighbor_node = container_children.get(ineighbor)?;
            if neighbor_node.id() != target_group {
                return None;
            }
            if !matches!(neighbor_node, Node::Group { .. }) {
                return None;
            }
            if t_children.len() < 2 {
                return None;
            }
            // Insertion kind/index must match frozen planner semantics:
            // parallel target => NearEdge at the W-adjacent edge (0 or len);
            // perpendicular even target => Midpoint at n/2.
            if t_axis == container_axis {
                if *insertion != Insertion::NearEdge {
                    return None;
                }
                let expected = if iw < ineighbor { 0 } else { t_children.len() };
                if *insertion_index != expected {
                    return None;
                }
            } else {
                if t_children.len() % 2 != 0 {
                    return None;
                }
                if *insertion != Insertion::Midpoint {
                    return None;
                }
                if *insertion_index != t_children.len() / 2 {
                    return None;
                }
            }
            // Extract mover from its container first. `None` (emptied source)
            // cannot happen for a planned move (SingleRootLeaf is a noop).
            let working = remove_leaf_from_tree(Some(tree), focused_leaf)?;
            // Target must still exist after extraction with unchanged length.
            let (post_children, _) = match find_group(&working, target_group) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            if post_children.len() != t_children.len() {
                return None;
            }
            if *insertion_index > post_children.len() {
                return None;
            }
            let updated = insert_leaf_into_group(
                working,
                target_group,
                *insertion_index,
                mover_leaf_node,
                1,
            )?;
            desired_trees.insert(source.clone(), Some(updated));
            Some((
                desired_trees,
                desired_windows,
                source.clone(),
                focused_leaf.clone(),
            ))
        }
        MoveOperation::SplitGroupChild {
            container,
            target_group,
            target_child,
            target_child_index,
            focused_side,
            axis,
            ..
        } => {
            // R2b split: len==2 parallel container, perpendicular odd target,
            // midpoint victim, D-axis split, focused side matches step.
            if *axis != direction_axis {
                return None;
            }
            let tree = desired_trees.get(source).cloned().flatten()?;
            let (container_children, container_axis) = match find_group(&tree, container) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            if container_children.len() != 2 {
                return None;
            }
            if container_axis != direction_axis {
                return None;
            }
            if direct_parent_of_leaf(&tree, focused_leaf)? != *container {
                return None;
            }
            let iw = container_children
                .iter()
                .position(|c| c.id() == focused_leaf)?;
            let ineighbor = (iw as i32 + step) as usize;
            let neighbor_node = container_children.get(ineighbor)?;
            if neighbor_node.id() != target_group {
                return None;
            }
            let (t_children, t_axis) = match find_group(&tree, target_group) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            if t_axis == container_axis {
                return None;
            }
            if t_children.len() % 2 == 0 || t_children.len() < 3 {
                return None;
            }
            if *target_child_index != t_children.len() / 2 {
                return None;
            }
            if t_children[*target_child_index].id() != target_child {
                return None;
            }
            let expected_side = if step == -1 {
                FocusedSide::First
            } else {
                FocusedSide::Second
            };
            if *focused_side != expected_side {
                return None;
            }
            let working = remove_leaf_from_tree(Some(tree), focused_leaf)?;
            let (children, _, _, _) = find_group_full(&working, target_group)?;
            if *target_child_index >= children.len() {
                return None;
            }
            if children[*target_child_index].id() != target_child {
                return None;
            }
            let victim = children[*target_child_index].clone();
            let victim_share = find_group_shares(&working, target_group)?[*target_child_index];
            let new_id = generate_move_group_id(focused_leaf, base_revision, "r2b", &node_ids);
            node_ids.insert(new_id.clone());
            let split = match focused_side {
                FocusedSide::First => Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![mover_leaf_node, victim],
                    shares: vec![1, 1],
                },
                FocusedSide::Second => Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![victim, mover_leaf_node],
                    shares: vec![1, 1],
                },
            };
            let updated = replace_child_at(
                &working,
                target_group,
                *target_child_index,
                split,
                victim_share,
            )?;
            desired_trees.insert(source.clone(), Some(updated));
            Some((
                desired_trees,
                desired_windows,
                source.clone(),
                focused_leaf.clone(),
            ))
        }
        MoveOperation::EscapeParent {
            container,
            parent,
            container_child_index,
            parent_insertion_index,
            continuation,
            ..
        } => {
            let tree = desired_trees.get(source).cloned().flatten()?;
            // R3: parallel container at its D edge, actual parent binding,
            // same-axis insertion immediately on the D side or perpendicular
            // R1 wrap of the parent.
            let (container_children, container_axis) = match find_group(&tree, container) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            if container_axis != direction_axis {
                return None;
            }
            if direct_parent_of_leaf(&tree, focused_leaf)? != *container {
                return None;
            }
            let iw = container_children
                .iter()
                .position(|c| c.id() == focused_leaf)?;
            // Must sit at the container edge in D (no neighbor).
            if iw as i32 + step >= 0 && (iw as i32 + step) < container_children.len() as i32 {
                return None;
            }
            let (parent_children, parent_axis) = match find_group(&tree, parent) {
                Some((children, axis, _)) => (children, axis),
                None => return None,
            };
            let actual_container_index =
                parent_children.iter().position(|c| c.id() == container)?;
            if actual_container_index != *container_child_index {
                return None;
            }
            // Container must be a direct child of the parent.
            if parent_of_group(&tree, container)? != *parent {
                return None;
            }
            let same_axis = parent_axis == container_axis;
            if same_axis {
                if *continuation != EscapeContinuation::None {
                    return None;
                }
                let expected = actual_container_index + usize::from(step == 1);
                if *parent_insertion_index != Some(expected) {
                    return None;
                }
            } else {
                if *continuation != EscapeContinuation::R1 {
                    return None;
                }
                if parent_insertion_index.is_some() {
                    return None;
                }
                if parent_axis == direction_axis {
                    return None;
                }
            }
            let mut working = remove_leaf_from_tree(Some(tree), focused_leaf)?;
            match continuation {
                EscapeContinuation::None => {
                    let index = (*parent_insertion_index)?;
                    if !find_group_id(&working, parent) {
                        return None;
                    }
                    let post_len = group_children_len(&working, parent)?;
                    if index > post_len {
                        return None;
                    }
                    working = insert_leaf_into_group(working, parent, index, mover_leaf_node, 1)?;
                }
                EscapeContinuation::R1 => {
                    // Perpendicular receiving parent: wrap the parent with the
                    // mover at the D end (new D-axis split).
                    let parent_subtree = find_subtree(&working, parent)?.clone();
                    let axis = Axis::for_direction(direction);
                    if axis != direction_axis {
                        return None;
                    }
                    let new_id =
                        generate_move_group_id(focused_leaf, base_revision, "r3r1", &node_ids);
                    node_ids.insert(new_id.clone());
                    let wrapped = if step_for_direction(direction) == -1 {
                        Node::Group {
                            id: new_id,
                            axis,
                            children: vec![mover_leaf_node, parent_subtree],
                            shares: vec![1, 1],
                        }
                    } else {
                        Node::Group {
                            id: new_id,
                            axis,
                            children: vec![parent_subtree, mover_leaf_node],
                            shares: vec![1, 1],
                        }
                    };
                    working = replace_node_by_id(working, parent, wrapped)?;
                }
            }
            desired_trees.insert(source.clone(), Some(updated_tree(working)));
            Some((
                desired_trees,
                desired_windows,
                source.clone(),
                focused_leaf.clone(),
            ))
        }
        MoveOperation::CrossOutput {
            target_output,
            source_root_child_index,
            target,
            ..
        } => {
            use crate::directional::CrossOutputTarget;
            let target_key = DomainKey {
                output: target_output.clone(),
                workspace: source.workspace.clone(),
            };
            // Target must be a known same-workspace domain.
            domains.iter().find(|d| d.key() == target_key)?;
            // Adjacency must name this exact target in the requested direction.
            let source_domain = domains.iter().find(|d| &d.key() == source)?;
            if source_domain.adjacent.get(&direction) != Some(target_output) {
                return None;
            }
            let source_tree = desired_trees.get(source).cloned().flatten()?;
            // R4: source must be a root group with the mover as a direct
            // root-edge child in D; target occupancy must match.
            if !matches!(source_tree, Node::Group { .. }) {
                return None;
            }
            let (children, _shares, _sid, _saxis) =
                find_group_full(&source_tree, source_tree.id())?;
            if *source_root_child_index >= children.len() {
                return None;
            }
            if children[*source_root_child_index].id() != focused_leaf {
                return None;
            }
            // Source root edge: first child for negative D, last for positive.
            let expected_edge = if step == -1 {
                0
            } else {
                children.len().checked_sub(1)?
            };
            if *source_root_child_index != expected_edge {
                return None;
            }
            if !matches!(children[*source_root_child_index], Node::Leaf { .. }) {
                return None;
            }
            // Extract mover from source.
            let new_source = remove_leaf_from_tree(Some(source_tree), focused_leaf);
            desired_trees.insert(source.clone(), new_source);
            // Attach to target.
            let target_tree = desired_trees.get(&target_key).cloned().flatten();
            match target {
                CrossOutputTarget::Empty => {
                    if target_tree.is_some() {
                        return None;
                    }
                    desired_trees.insert(target_key.clone(), Some(mover_leaf_node));
                }
                CrossOutputTarget::Occupied => {
                    let existing = target_tree?;
                    let axis = Axis::for_direction(direction);
                    let new_id =
                        generate_move_group_id(focused_leaf, base_revision, "r4", &node_ids);
                    node_ids.insert(new_id.clone());
                    // W nearest the source: positive directions first,
                    // negative directions last.
                    let combined = if step_for_direction(direction) == 1 {
                        Node::Group {
                            id: new_id,
                            axis,
                            children: vec![mover_leaf_node, existing],
                            shares: vec![1, 1],
                        }
                    } else {
                        Node::Group {
                            id: new_id,
                            axis,
                            children: vec![existing, mover_leaf_node],
                            shares: vec![1, 1],
                        }
                    };
                    desired_trees.insert(target_key.clone(), Some(combined));
                }
            }
            // Mover link follows to the target domain; leaf identity kept.
            let mover_window = windows
                .values()
                .find(|l| {
                    &l.leaf == focused_leaf
                        && l.output == source.output
                        && l.workspace == source.workspace
                })?
                .window
                .clone();
            desired_windows.insert(
                mover_window.clone(),
                WindowLink {
                    window: mover_window,
                    leaf: focused_leaf.clone(),
                    output: target_key.output.clone(),
                    workspace: target_key.workspace.clone(),
                },
            );
            Some((
                desired_trees,
                desired_windows,
                target_key,
                focused_leaf.clone(),
            ))
        }
    }
}

fn updated_tree(tree: Node) -> Node {
    tree
}

fn find_group(tree: &Node, id: &NodeId) -> Option<(Vec<Node>, Axis, NodeId)> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id: gid,
            axis,
            children,
            ..
        } => {
            if gid == id {
                return Some((children.clone(), *axis, gid.clone()));
            }
            for child in children {
                if let Some(found) = find_group(child, id) {
                    return Some(found);
                }
            }
            None
        }
    }
}

fn find_group_shares(tree: &Node, id: &NodeId) -> Option<Vec<u64>> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id: gid,
            children,
            shares,
            ..
        } => {
            if gid == id {
                return Some(shares.clone());
            }
            for child in children {
                if let Some(found) = find_group_shares(child, id) {
                    return Some(found);
                }
            }
            None
        }
    }
}

fn find_group_full(tree: &Node, id: &NodeId) -> Option<(Vec<Node>, Vec<u64>, NodeId, Axis)> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id: gid,
            axis,
            children,
            shares,
        } => {
            if gid == id {
                return Some((children.clone(), shares.clone(), gid.clone(), *axis));
            }
            for child in children {
                if let Some(found) = find_group_full(child, id) {
                    return Some(found);
                }
            }
            None
        }
    }
}

/// Direct parent group id of a leaf, if the leaf is a direct child.
fn direct_parent_of_leaf(tree: &Node, leaf: &NodeId) -> Option<NodeId> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group { id, children, .. } => {
            for child in children {
                if child.id() == leaf && matches!(child, Node::Leaf { .. }) {
                    return Some(id.clone());
                }
            }
            for child in children {
                if let Some(found) = direct_parent_of_leaf(child, leaf) {
                    return Some(found);
                }
            }
            None
        }
    }
}

/// Direct parent group id of a group, if it is a direct child.
fn parent_of_group(tree: &Node, group: &NodeId) -> Option<NodeId> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group { id, children, .. } => {
            for child in children {
                if child.id() == group {
                    return Some(id.clone());
                }
            }
            for child in children {
                if let Some(found) = parent_of_group(child, group) {
                    return Some(found);
                }
            }
            None
        }
    }
}

fn find_subtree<'a>(tree: &'a Node, id: &NodeId) -> Option<&'a Node> {
    if tree.id() == id {
        return Some(tree);
    }
    match tree {
        Node::Leaf { .. } => None,
        Node::Group { children, .. } => {
            for child in children {
                if let Some(found) = find_subtree(child, id) {
                    return Some(found);
                }
            }
            None
        }
    }
}

fn replace_group_children(
    tree: Node,
    group_id: &NodeId,
    children: Vec<Node>,
    shares: Vec<u64>,
) -> Option<Node> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            children: old_children,
            shares: old_shares,
        } => {
            if &id == group_id {
                if children.len() < 2 || shares.len() != children.len() {
                    return None;
                }
                return Some(Node::Group {
                    id,
                    axis,
                    children,
                    shares,
                });
            }
            let mut new_children = old_children;
            for child in new_children.iter_mut() {
                if child.id() == group_id || subtree_contains_id(child, group_id) {
                    let updated = replace_group_children(
                        child.clone(),
                        group_id,
                        children.clone(),
                        shares.clone(),
                    )?;
                    *child = updated;
                    return Some(Node::Group {
                        id,
                        axis,
                        children: new_children,
                        shares: old_shares,
                    });
                }
            }
            None
        }
    }
}

fn replace_child_at(
    tree: &Node,
    group_id: &NodeId,
    index: usize,
    replacement: Node,
    replacement_share: u64,
) -> Option<Node> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            children,
            shares,
        } => {
            if id == group_id {
                if index >= children.len() {
                    return None;
                }
                let mut new_children = children.clone();
                let mut new_shares = shares.clone();
                new_children[index] = replacement;
                new_shares[index] = replacement_share;
                return Some(Node::Group {
                    id: id.clone(),
                    axis: *axis,
                    children: new_children,
                    shares: new_shares,
                });
            }
            for (pos, child) in children.iter().enumerate() {
                if child.id() == group_id || subtree_contains_id(child, group_id) {
                    let updated = replace_child_at(
                        child,
                        group_id,
                        index,
                        replacement.clone(),
                        replacement_share,
                    )?;
                    let mut new_children = children.clone();
                    new_children[pos] = updated;
                    return Some(Node::Group {
                        id: id.clone(),
                        axis: *axis,
                        children: new_children,
                        shares: shares.clone(),
                    });
                }
            }
            None
        }
    }
}

fn swap_direct_children(tree: Node, container: &NodeId, a: &NodeId, b: &NodeId) -> Option<Node> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            mut children,
            mut shares,
        } => {
            if &id == container {
                let ia = children.iter().position(|c| c.id() == a)?;
                let ib = children.iter().position(|c| c.id() == b)?;
                // Both must be direct leaf children.
                if !matches!(children[ia], Node::Leaf { .. })
                    || !matches!(children[ib], Node::Leaf { .. })
                {
                    return None;
                }
                children.swap(ia, ib);
                shares.swap(ia, ib);
                return Some(Node::Group {
                    id,
                    axis,
                    children,
                    shares,
                });
            }
            for (pos, child) in children.iter().enumerate() {
                if child.id() == container || subtree_contains_id(child, container) {
                    let updated = swap_direct_children(child.clone(), container, a, b)?;
                    children[pos] = updated;
                    return Some(Node::Group {
                        id,
                        axis,
                        children,
                        shares,
                    });
                }
            }
            None
        }
    }
}

fn project_affected_geometry(
    domains: &[OutputDomain],
    trees: &BTreeMap<DomainKey, Option<Node>>,
    windows: &BTreeMap<WindowId, WindowLink>,
    affected: &[DomainKey],
) -> Result<Vec<DesiredGeometry>, ()> {
    let mut out = Vec::new();
    for key in affected {
        let Some(domain) = domains.iter().find(|d| &d.key() == key) else {
            return Err(());
        };
        let tree = trees.get(key).cloned().flatten();
        let projected =
            project_output_geometry(Some(domain), tree.as_ref(), windows, key).map_err(|_| ())?;
        out.extend(projected);
    }
    out.sort_by(|a, b| {
        a.output
            .0
            .cmp(&b.output.0)
            .then(a.workspace.0.cmp(&b.workspace.0))
            .then(a.leaf.0.cmp(&b.leaf.0))
    });
    Ok(out)
}

fn geometry_covers_affected(
    geometry: &[DesiredGeometry],
    windows: &BTreeMap<WindowId, WindowLink>,
    affected: &[DomainKey],
) -> bool {
    use std::collections::BTreeSet;
    for key in affected {
        let expected: BTreeSet<&NodeId> = windows
            .values()
            .filter(|l| l.output == key.output && l.workspace == key.workspace)
            .map(|l| &l.leaf)
            .collect();
        let got: BTreeSet<&NodeId> = geometry
            .iter()
            .filter(|g| g.output == key.output && g.workspace == key.workspace)
            .map(|g| &g.leaf)
            .collect();
        if expected != got {
            return false;
        }
        for entry in geometry
            .iter()
            .filter(|g| g.output == key.output && g.workspace == key.workspace)
        {
            if entry.window.0.is_empty() || entry.leaf.0.is_empty() {
                return false;
            }
            if entry.rect.w <= 0 || entry.rect.h <= 0 {
                return false;
            }
            let Some(link) = windows.get(&entry.window) else {
                return false;
            };
            if link.leaf != entry.leaf
                || link.output != entry.output
                || link.workspace != entry.workspace
            {
                return false;
            }
        }
    }
    // No geometry may leak outside affected domains.
    for entry in geometry {
        if !affected
            .iter()
            .any(|k| k.output == entry.output && k.workspace == entry.workspace)
        {
            return false;
        }
    }
    true
}

/// Strict domain isolation: only the source domain may change, except R4
/// which may change exactly source plus its adjacent same-workspace target.
fn move_touches_only_allowed(
    before: &BTreeMap<DomainKey, Option<Node>>,
    after: &BTreeMap<DomainKey, Option<Node>>,
    source: &DomainKey,
    operation: &MoveOperation,
    domains: &[OutputDomain],
) -> bool {
    let mut changed = Vec::new();
    for (key, before_tree) in before {
        let after_tree = after.get(key);
        if after_tree != Some(before_tree) {
            changed.push(key.clone());
        }
    }
    // Any unknown keys fail closed.
    if after.keys().any(|k| !before.contains_key(k)) {
        return false;
    }
    match operation {
        MoveOperation::CrossOutput { target_output, .. } => {
            let target = DomainKey {
                output: target_output.clone(),
                workspace: source.workspace.clone(),
            };
            if domains.iter().find(|d| d.key() == target).is_none() {
                return false;
            }
            if target == *source {
                return false;
            }
            changed.len() == 2 && changed.contains(source) && changed.contains(&target)
        }
        _ => changed.len() == 1 && changed.contains(source),
    }
}

fn valid_rect_shape(rect: &Rect) -> bool {
    rect.w > 0
        && rect.h > 0
        && rect.x.checked_add(rect.w).is_some()
        && rect.y.checked_add(rect.h).is_some()
}

fn valid_command_shapes(command: &SessionCommand) -> bool {
    match command {
        SessionCommand::Admit {
            window,
            output,
            workspace,
            placement_bounds,
            ..
        } => {
            !window.0.is_empty()
                && !output.0.is_empty()
                && !workspace.0.is_empty()
                && valid_rect_shape(placement_bounds)
        }
        SessionCommand::Remove { window } => !window.0.is_empty(),
    }
}

fn valid_observed_shapes(observed: &[ObservedWindow]) -> bool {
    let mut seen = BTreeSet::new();
    for entry in observed {
        if entry.window.0.is_empty() || entry.output.0.is_empty() || entry.workspace.0.is_empty() {
            return false;
        }
        if !seen.insert(entry.window.clone()) {
            return false;
        }
    }
    true
}

/// Horizontal when `w >= h`, else vertical (horizontal on tie).
fn orientation_from_bounds(bounds: &Rect) -> Axis {
    if bounds.w >= bounds.h {
        Axis::Horizontal
    } else {
        Axis::Vertical
    }
}

fn collect_node_ids(node: &Node, out: &mut BTreeSet<NodeId>) {
    out.insert(node.id().clone());
    if let Node::Group { children, .. } = node {
        for child in children {
            collect_node_ids(child, out);
        }
    }
}

fn collect_leaves(node: &Node) -> Vec<NodeId> {
    let mut out = Vec::new();
    collect_leaves_into(node, &mut out);
    out
}

fn collect_leaves_into(node: &Node, out: &mut Vec<NodeId>) {
    match node {
        Node::Leaf { id } => out.push(id.clone()),
        Node::Group { children, .. } => {
            for child in children {
                collect_leaves_into(child, out);
            }
        }
    }
}

fn generate_leaf_id(window: &WindowId, existing: &mut BTreeSet<NodeId>) -> NodeId {
    let base = format!("leaf-{}", window.0);
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

fn generate_group_id(
    window: &WindowId,
    base_revision: u64,
    existing: &mut BTreeSet<NodeId>,
) -> NodeId {
    let base = format!("grp-{}-r{}", window.0, base_revision);
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

fn find_parent_axis_and_index(node: &Node, leaf: &NodeId) -> Option<(Axis, usize)> {
    match node {
        Node::Leaf { .. } => None,
        Node::Group { axis, children, .. } => {
            for (index, child) in children.iter().enumerate() {
                match child {
                    Node::Leaf { id } if id == leaf => return Some((*axis, index)),
                    _ => {
                        if let Some(found) = find_parent_axis_and_index(child, leaf) {
                            return Some(found);
                        }
                    }
                }
            }
            None
        }
    }
}

fn insert_into_parent_after(
    node: Node,
    focused: &NodeId,
    new_leaf: Node,
    new_share: u64,
) -> Option<Node> {
    match node {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            children,
            shares,
        } => {
            for (index, child) in children.iter().enumerate() {
                if child.id() == focused {
                    let mut new_children = children.clone();
                    let mut new_shares = shares.clone();
                    new_children.insert(index + 1, new_leaf.clone());
                    new_shares.insert(index + 1, new_share);
                    return Some(Node::Group {
                        id,
                        axis,
                        children: new_children,
                        shares: new_shares,
                    });
                }
            }
            // Recurse without mutating on miss: clone the matching subtree and
            // replace only on recursive success, so a miss leaves the input
            // tree intact for the caller.
            for (index, child) in children.iter().enumerate() {
                if subtree_contains(child, focused) {
                    let updated = insert_into_parent_after(
                        child.clone(),
                        focused,
                        new_leaf.clone(),
                        new_share,
                    )?;
                    let mut new_children = children.clone();
                    new_children[index] = updated;
                    return Some(Node::Group {
                        id,
                        axis,
                        children: new_children,
                        shares: shares.clone(),
                    });
                }
            }
            None
        }
    }
}

fn subtree_contains(node: &Node, leaf: &NodeId) -> bool {
    if node.id() == leaf {
        return true;
    }
    match node {
        Node::Leaf { .. } => false,
        Node::Group { children, .. } => children.iter().any(|c| subtree_contains(c, leaf)),
    }
}

fn nest_focused_with_new(
    node: Node,
    focused: &NodeId,
    new_leaf: Node,
    group_id: NodeId,
    axis: Axis,
) -> Option<Node> {
    match node {
        Node::Leaf { id } if &id == focused => Some(Node::Group {
            id: group_id,
            axis,
            children: vec![Node::Leaf { id }, new_leaf],
            shares: vec![1, 1],
        }),
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis: parent_axis,
            children,
            shares,
        } => {
            for (index, child) in children.iter().enumerate() {
                if subtree_contains(child, focused) {
                    let updated = nest_focused_with_new(
                        child.clone(),
                        focused,
                        new_leaf.clone(),
                        group_id.clone(),
                        axis,
                    )?;
                    let mut new_children = children.clone();
                    new_children[index] = updated;
                    return Some(Node::Group {
                        id,
                        axis: parent_axis,
                        children: new_children,
                        shares: shares.clone(),
                    });
                }
            }
            None
        }
    }
}

fn insert_tiled(
    tree: Option<Node>,
    focused: Option<&NodeId>,
    new_leaf_id: NodeId,
    orientation: Axis,
    existing_ids: &mut BTreeSet<NodeId>,
    window: &WindowId,
    base_revision: u64,
) -> Option<Node> {
    let new_leaf = Node::Leaf { id: new_leaf_id };
    let Some(tree) = tree else {
        return Some(new_leaf);
    };
    let Some(focused) = focused else {
        // No eligible focus in this output: append after the last root child
        // when rooted at a group, else nest the single root leaf.
        match tree {
            Node::Leaf { id } => {
                let group_id = generate_group_id(window, base_revision, existing_ids);
                existing_ids.insert(group_id.clone());
                return Some(Node::Group {
                    id: group_id,
                    axis: orientation,
                    children: vec![Node::Leaf { id }, new_leaf],
                    shares: vec![1, 1],
                });
            }
            Node::Group {
                id,
                axis,
                mut children,
                mut shares,
            } => {
                children.push(new_leaf);
                shares.push(1);
                return Some(Node::Group {
                    id,
                    axis,
                    children,
                    shares,
                });
            }
        }
    };
    // Focused is the root leaf itself.
    if tree.id() == focused && matches!(tree, Node::Leaf { .. }) {
        let group_id = generate_group_id(window, base_revision, existing_ids);
        existing_ids.insert(group_id.clone());
        return nest_focused_with_new(tree, focused, new_leaf, group_id, orientation);
    }
    let parent_matches = find_parent_axis_and_index(&tree, focused).map(|(a, _)| a == orientation);
    match parent_matches {
        Some(true) => insert_into_parent_after(tree, focused, new_leaf, 1),
        _ => {
            let group_id = generate_group_id(window, base_revision, existing_ids);
            existing_ids.insert(group_id.clone());
            nest_focused_with_new(tree, focused, new_leaf, group_id, orientation)
        }
    }
}

fn remove_leaf_from_tree(tree: Option<Node>, leaf: &NodeId) -> Option<Node> {
    let node = tree?;
    remove_node(node, leaf)
}

fn remove_node(node: Node, leaf: &NodeId) -> Option<Node> {
    match node {
        Node::Leaf { id } => {
            if &id == leaf {
                None
            } else {
                Some(Node::Leaf { id })
            }
        }
        Node::Group {
            id,
            axis,
            children,
            shares,
        } => {
            let mut new_children = Vec::with_capacity(children.len());
            let mut new_shares = Vec::with_capacity(shares.len());
            for (child, share) in children.into_iter().zip(shares) {
                if child.id() == leaf && matches!(child, Node::Leaf { .. }) {
                    continue;
                }
                match remove_node(child, leaf) {
                    Some(updated) => {
                        new_children.push(updated);
                        new_shares.push(share);
                    }
                    None => {
                        // Subtree emptied: drop this slot entirely. This only
                        // happens when a nested single leaf matched.
                    }
                }
            }
            match new_children.len() {
                0 => None,
                1 => Some(new_children.into_iter().next().expect("one child")),
                _ => Some(Node::Group {
                    id,
                    axis,
                    children: new_children,
                    shares: new_shares,
                }),
            }
        }
    }
}

fn validate_topology(
    domains: &[OutputDomain],
    trees: &BTreeMap<DomainKey, Option<Node>>,
    windows: &BTreeMap<WindowId, WindowLink>,
    exceptions: &BTreeMap<WindowId, ExceptionRecord>,
    focused_domain: &Option<DomainKey>,
    focused_leaf: &Option<NodeId>,
) -> bool {
    if domains.is_empty() {
        return false;
    }
    // Every domain key must have exactly one tree slot; no unknown keys.
    if trees.len() != domains.len() {
        return false;
    }
    for domain in domains {
        if !domain.validate() {
            return false;
        }
        if !trees.contains_key(&domain.key()) {
            return false;
        }
    }
    for key in trees.keys() {
        if !domains.iter().any(|d| &d.key() == key) {
            return false;
        }
    }
    let mut node_ids = BTreeSet::new();
    for domain in domains {
        if let Some(tree) = trees.get(&domain.key()).cloned().flatten()
            && !validate_node_shares(&tree, &mut node_ids)
        {
            return false;
        }
    }
    // Tiled windows and deferred exceptions must be disjoint.
    for id in windows.keys() {
        if exceptions.contains_key(id) {
            return false;
        }
    }
    // Exception records must name known domains with non-empty ids.
    for record in exceptions.values() {
        if record.window.0.is_empty() || record.output.0.is_empty() || record.workspace.0.is_empty()
        {
            return false;
        }
        if domains
            .iter()
            .find(|d| d.id == record.output && d.workspace == record.workspace)
            .is_none()
        {
            return false;
        }
    }
    // Reciprocal leaf/window bindings scoped to the exact domain pair.
    let mut seen_leaves = BTreeSet::new();
    for link in windows.values() {
        if link.window.0.is_empty() || link.leaf.0.is_empty() || link.output.0.is_empty() {
            return false;
        }
        if link.workspace.0.is_empty() {
            return false;
        }
        if !seen_leaves.insert(link.leaf.clone()) {
            return false;
        }
        let key = DomainKey {
            output: link.output.clone(),
            workspace: link.workspace.clone(),
        };
        if domains.iter().find(|d| d.key() == key).is_none() {
            return false;
        }
        let Some(tree) = trees.get(&key).cloned().flatten() else {
            return false;
        };
        if !collect_leaves(&tree).contains(&link.leaf) {
            return false;
        }
    }
    // Every leaf needs exactly one link, scoped to its domain.
    for domain in domains {
        if let Some(tree) = trees.get(&domain.key()).cloned().flatten() {
            for leaf in collect_leaves(&tree) {
                if !windows.values().any(|l| {
                    l.leaf == leaf && l.output == domain.id && l.workspace == domain.workspace
                }) {
                    return false;
                }
            }
        }
    }
    // Focus must resolve to a linked leaf in its domain, or be fully empty.
    match (focused_domain, focused_leaf) {
        (None, None) => true,
        (Some(key), Some(leaf)) => {
            let Some(tree) = trees.get(key).cloned().flatten() else {
                return false;
            };
            if !collect_leaves(&tree).contains(leaf) {
                return false;
            }
            windows
                .values()
                .any(|l| &l.leaf == leaf && l.output == key.output && l.workspace == key.workspace)
        }
        _ => false,
    }
}

fn validate_node_shares(node: &Node, seen: &mut BTreeSet<NodeId>) -> bool {
    if node.id().0.is_empty() || !seen.insert(node.id().clone()) {
        return false;
    }
    match node {
        Node::Leaf { .. } => true,
        Node::Group {
            children, shares, ..
        } => {
            if children.len() < 2 || shares.len() != children.len() {
                return false;
            }
            if shares.contains(&0) {
                return false;
            }
            let mut total: u64 = 0;
            for share in shares {
                match total.checked_add(*share) {
                    Some(next) => total = next,
                    None => return false,
                }
            }
            if total == 0 {
                return false;
            }
            children.iter().all(|c| validate_node_shares(c, seen))
        }
    }
}

fn first_leaf_global(
    domains: &[OutputDomain],
    trees: &BTreeMap<DomainKey, Option<Node>>,
) -> Option<(DomainKey, NodeId)> {
    for domain in domains {
        if let Some(tree) = trees.get(&domain.key()).cloned().flatten()
            && let Some(first) = collect_leaves(&tree).into_iter().next()
        {
            return Some((domain.key(), first));
        }
    }
    None
}

fn project_output_geometry(
    domain: Option<&OutputDomain>,
    tree: Option<&Node>,
    windows: &BTreeMap<WindowId, WindowLink>,
    key: &DomainKey,
) -> Result<Vec<DesiredGeometry>, ()> {
    let (Some(domain), Some(tree)) = (domain, tree) else {
        return Ok(Vec::new());
    };
    let projected = project(tree, domain.bounds, domain.gap).map_err(|_| ())?;
    let leaf_to_window: BTreeMap<&NodeId, &WindowId> = windows
        .values()
        .filter(|l| l.output == key.output && l.workspace == key.workspace)
        .map(|l| (&l.leaf, &l.window))
        .collect();
    let mut out = Vec::with_capacity(projected.len());
    for leaf in projected {
        let Some(window) = leaf_to_window.get(&leaf.leaf) else {
            return Err(());
        };
        if leaf.rect.w <= 0 || leaf.rect.h <= 0 {
            return Err(());
        }
        out.push(DesiredGeometry {
            window: (*window).clone(),
            leaf: leaf.leaf,
            output: key.output.clone(),
            workspace: key.workspace.clone(),
            rect: leaf.rect,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> OwnerId {
        OwnerId::parse("owner-1").expect("valid")
    }

    fn generation() -> GenerationId {
        GenerationId::parse("gen-1").expect("valid")
    }

    fn domain() -> OutputDomain {
        OutputDomain {
            id: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 120,
                h: 80,
            },
            gap: 0,
            adjacent: BTreeMap::new(),
        }
    }

    #[test]
    fn orientation_prefers_horizontal_on_tie() {
        assert_eq!(
            orientation_from_bounds(&Rect {
                x: 0,
                y: 0,
                w: 100,
                h: 100
            }),
            Axis::Horizontal
        );
        assert_eq!(
            orientation_from_bounds(&Rect {
                x: 0,
                y: 0,
                w: 50,
                h: 100
            }),
            Axis::Vertical
        );
    }

    #[test]
    fn empty_session_snapshot_has_retained_domains() {
        let session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("new");
        let snapshot = session.snapshot();
        assert_eq!(snapshot.domains.len(), 1);
        assert!(snapshot.domains[0].tree.is_none());
        assert!(snapshot.windows.is_empty());
    }

    #[test]
    fn leaf_removal_collapses_single_child_group() {
        let tree = Node::Group {
            id: NodeId("root".to_owned()),
            axis: Axis::Horizontal,
            children: vec![
                Node::Leaf {
                    id: NodeId("A".to_owned()),
                },
                Node::Group {
                    id: NodeId("inner".to_owned()),
                    axis: Axis::Vertical,
                    children: vec![
                        Node::Leaf {
                            id: NodeId("B".to_owned()),
                        },
                        Node::Leaf {
                            id: NodeId("C".to_owned()),
                        },
                    ],
                    shares: vec![1, 1],
                },
            ],
            shares: vec![1, 1],
        };
        let after = remove_leaf_from_tree(Some(tree), &NodeId("B".to_owned())).expect("tree");
        // Inner collapses to C; root keeps [A, C] with preserved shares.
        assert_eq!(
            after,
            Node::Group {
                id: NodeId("root".to_owned()),
                axis: Axis::Horizontal,
                children: vec![
                    Node::Leaf {
                        id: NodeId("A".to_owned()),
                    },
                    Node::Leaf {
                        id: NodeId("C".to_owned()),
                    },
                ],
                shares: vec![1, 1],
            }
        );
    }
}
