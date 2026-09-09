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
//! source-evidenced where COSMIC establishes behavior):
//! - Versioned [`crate::contract::LIFECYCLE_POLICY_VERSION`] (`cosmic_v1`);
//!   plans/dispatch carry the binding and the reconciler rejects mismatches.
//!   Frozen R1-R4 movement APIs/fixtures are unaffected.
//! - Admission axis is owned by [`crate::cosmic_v1::admission_axis`]:
//!   target geometry width strictly greater than height selects portable
//!   [`Axis::Horizontal`] (splits width, source `Orientation::Vertical`),
//!   otherwise [`Axis::Vertical`] (vertical on tie).
//!   The first tiled admitted window in an empty logical domain becomes a root
//!   leaf; automatic admission always wraps the focused eligible leaf in an
//!   ordered binary group old/new carrying the admission axis and
//!   [`crate::cosmic_v1::new_group_shares`] (source `TilingLayout::new_group`
//!   2898-2936 via `map_to_tree` 548-617). Same-axis N-ary parent append never
//!   applies to admission; N-ary groups remain for movement/drag only. The new
//!   leaf is focused (deterministic project fallback; COSMIC does not
//!   establish admission focus).
//! - Input placement orientation is carried explicitly as logical `bounds`
//!   (target geometry for the split, output geometry for the no-focus root
//!   case under the same rule).
//! - When no eligible focus exists in the target domain but a tree exists,
//!   the entire root is wrapped old/new under the same admission axis/shares;
//!   focus fallback only, not source COSMIC parity.
//! - Removal retains empty logical domains (trees become
//!   `None`), removes empty groups, and collapses single-child groups
//!   recursively (survivor promotion mirrors `unmap_internal` structurally;
//!   focus selection below is deterministic project fallback, not COSMIC:
//!   `unmap_internal` does not establish next/previous/first focus).
//!   Shares use [`crate::cosmic_v1::proportional_removal_shares`] before
//!   collapse (portable N-ary adaptation of `remove_window` 255-283).
//!   Unaffected subtree identity/order and shares are preserved
//!   (a collapsed child inherits its collapsed parent slot). Focus moves to the
//!   next sibling leaf, then the previous, then the first remaining leaf,
//!   deterministically (project fallback, explicitly outside cosmic_v1
//!   evidence); non-focused removals preserve focus.
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
    Dispatch, DivergenceKind, DragCapabilities, DragDispatch, DragIntent, DragOperation, DragPlan,
    DragPostObservation, DragSide, FocusCapabilities, FocusDispatch, FocusIntent, FocusOperation,
    FocusPlanContract, FocusPostObservation, LifecycleCapabilities, LifecycleDispatch,
    LifecycleIntent, LifecycleOperation, LifecyclePlan, LifecyclePostObservation, Observation,
    PostObservation, ResizeCapabilities, ResizeDispatch, ResizeIntent, ResizeMode, ResizeOperation,
    ResizePlan, ResizePostObservation, is_revision,
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

/// Authoritative drag plan: reconciler identity-bound portable
/// [`DragDispatch`] (semantic drag operation/preconditions/capability/intent
/// plus owner/generation/correlation/base revision) plus the deterministic
/// contract [`DragPlan`], desired topology/snapshot (edge drops: source
/// removed, collapsed, then inserted/wrapped; center never plans
/// topology rendered natively by the compositor), preserved focus on the moved
/// window, and complete desired rectangles for every tiled window in the
/// affected domain. No native
/// commands. The drag commits only via acknowledge-then-[`Session::verify_drag`];
/// self/invalid releases snap back with no plan and no pending. Focus is
/// preserved on the moved window. Immutable and complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionDragPlan {
    pub dispatch: DragDispatch,
    pub drag_plan: DragPlan,
    pub desired_snapshot: SessionSnapshot,
    pub desired_focus_domain: DomainKey,
    pub desired_focus_leaf: NodeId,
    pub desired_geometry: Vec<DesiredGeometry>,
}

/// Portable drag capture returned by [`Session::begin_drag`]: the source domain
/// and tiled leaf/window, the accepted revision bound to the capture, and the
/// projected source rectangle plus the domain work area. Carries no topology
/// mutation and no native commands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DragCapture {
    pub domain: DomainKey,
    pub source_leaf: NodeId,
    pub source_window: WindowId,
    pub revision: u64,
    pub source_rect: Rect,
    pub work_area: Rect,
}

/// Pure non-mutating drag preview from logical pointer coordinates. Names the
/// source and target portable ids with their projected rectangles plus the
/// normalized `side`/`axis`/`before` ordering and the resolved placement form
/// (`wrap` with `target_group`/`insertion_index`). `proposed_rect` is the
/// deterministic projected desired source rectangle after applying the
/// placement (subregion of the work area for the moved source leaf), not the
/// target current rectangle alone. No native rendering or effects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DragPreview {
    pub domain: DomainKey,
    pub source_leaf: NodeId,
    pub source_window: WindowId,
    pub source_rect: Rect,
    pub target_leaf: NodeId,
    pub target_window: WindowId,
    pub target_rect: Rect,
    pub proposed_rect: Rect,
    pub side: DragSide,
    pub axis: Axis,
    pub before: bool,
    pub wrap: bool,
    pub target_group: NodeId,
    pub insertion_index: usize,
}

/// Portable no-structure snap-back intent: the accepted source rectangle the
/// adapter must restore visually. Carries no topology and no geometry beyond
/// the accepted source rect. Returned by [`Session::cancel_drag`] and by
/// invalid [`Session::drop_drag`] releases.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DragSnapBack {
    pub domain: DomainKey,
    pub source_leaf: NodeId,
    pub source_window: WindowId,
    pub source_rect: Rect,
}

/// Drag release outcome: either a complete structural/focus/geometry
/// [`SessionDragPlan`] staged through the shared reconciler slot, or a
/// no-structure [`DragSnapBack`] with no reconciler use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DragRelease {
    Planned(Box<SessionDragPlan>),
    SnapBack(DragSnapBack),
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

/// Transient drag capture: source identity plus the accepted
/// revision/generation, the full topology/membership/focus at capture time,
/// and the projected source/work-area geometry preconditions. Holds no
/// reconciler pending slot; cleared by drop, cancel, commit-divergence paths,
/// or acknowledgement-divergence. The smallest portable prior hover
/// (`cosmic_v1::PriorGroupEdge`: last emitted group-edge identity, or `None`
/// when the last hover was not a group edge) lives here only and drives the
/// sticky 80px/32px group-edge depths; it updates after each resolved
/// preview/drop target and never participates in stale-capture equality.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DragState {
    domain: DomainKey,
    source_leaf: NodeId,
    source_window: WindowId,
    revision: u64,
    generation: GenerationId,
    trees: BTreeMap<DomainKey, Option<Node>>,
    windows: BTreeMap<WindowId, WindowLink>,
    exceptions: BTreeMap<WindowId, ExceptionRecord>,
    focused_domain: Option<DomainKey>,
    focused_leaf: Option<NodeId>,
    source_rect: Rect,
    work_area: Rect,
    prior: Option<crate::cosmic_v1::PriorGroupEdge>,
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
    drag: Option<DragState>,
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
            drag: None,
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
        if self.drag.is_some() {
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
        if self.drag.is_some() {
            return Err(ProposeError::PendingExists);
        }
        let Some(_source_domain) = self.domains.iter().find(|d| &d.key() == domain).cloned() else {
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
        let dispatch = match self.reconciler.propose(
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
                self.drag = None;
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
                self.drag = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Propose COSMIC keyboard pixel resize for the selected exact
    /// opaque `(domain, window)` pair.
    ///
    /// The supplied opaque [`WindowId`] must equal the authoritative logical
    /// focused tiled window in exactly `domain`; mismatch, unknown windows,
    /// or exception windows refuse without pending. Source selection
    /// (`tiling/mod.rs` 2514-2600): the nearest matching-edge-axis ancestor
    /// wins, `direction` is the cardinal edge determining the neighbor side
    /// and `mode` is the source `ResizeDirection` (`Inwards` shrinks the
    /// focused node, `Outwards` grows it). The [`crate::cosmic_v1`] keyboard
    /// step schedule moves the shared boundary by
    /// [`crate::cosmic_v1::keyboard_step_px`](`press_index`) physical pixels
    /// (12px first operation, then 14, 16, 18, 20), source pair/child minima
    /// ([`crate::cosmic_v1::pair_admits_resize`],
    /// [`crate::cosmic_v1::clamp_keyboard_shrink_pair`]) gate and clamp the
    /// move one-sided on direct pair sums `sizes[i] + sizes[i + 1]` (never union
    /// including gap), and the resulting pixel sizes are converted to exact
    /// projector-representable integer shares applied through the reusable
    /// [`crate::directional::apply_resize_shares`] primitive. Only the two
    /// selected adjacent shares change ratios (plus an exact
    /// ratio-preserving whole-group integer scaling when pixel precision
    /// requires it); descendants/topology/order are unchanged and focus is
    /// retained exactly. The session orchestrates; all COSMIC semantics live
    /// in [`crate::cosmic_v1`].
    ///
    /// `press_index` is the explicit portable key-repeat state: 0 is the
    /// initial press (12px), each subsequent held repeat increments by one.
    /// The adapter must supply `direction` (edge), `mode`, and `press_index`;
    /// none default.
    ///
    /// Complete geometry for every tiled window in the affected domain must
    /// project before any pending is staged; unprojectable/minimum-geometry
    /// failures refuse without pending. Source no-op pairs (direct sum under
    /// the axis pair minimum) and exhausted/clamped-unchanged boundaries
    /// refuse as [`RefusalKind::Unchanged`] with no plan and no pending.
    /// Stale, incomplete, malformed, pending, or unsupported-resize-capability
    /// inputs refuse or diverge fail-closed.
    #[allow(clippy::too_many_arguments)]
    pub fn propose_resize(
        &mut self,
        domain: &DomainKey,
        window: &WindowId,
        direction: Direction,
        mode: ResizeMode,
        press_index: u32,
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
        let Some(own_domain) = self.domains.iter().find(|d| &d.key() == domain).cloned() else {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        };
        let Some(tree) = self.trees.get(domain).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        // Accepted projected geometry is the normalized current geometry for
        // the COSMIC pixel policy.
        let accepted_geometry =
            project_output_geometry(Some(&own_domain), Some(&tree), &self.windows, domain)
                .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !geometry_covers_affected(
            &accepted_geometry,
            &self.windows,
            std::slice::from_ref(domain),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let step_px = crate::cosmic_v1::keyboard_step_px(press_index);
        let Some(derived) = derive_keyboard_pixel_shares(
            &tree,
            &focused_leaf,
            direction,
            mode,
            step_px,
            &own_domain,
            &accepted_geometry,
        ) else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let (target, new_shares) = match derived {
            PixelDerived::Unchanged => {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            }
            PixelDerived::Planned { target, new_shares } => (target, new_shares),
        };
        let Some(updated_tree) =
            crate::directional::apply_resize_shares(&tree, &target.group_id, &new_shares)
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
        // Minimum-size projectability on the COSMIC axis minima (keyboard
        // one-sided: only the shrink side keeps the child minimum).
        if !keyboard_minimum_holds(
            &desired_geometry,
            &target,
            domain,
            Axis::for_direction(direction),
            mode,
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let intent = ResizeIntent {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
            mode,
        };
        let operation = ResizeOperation {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
            mode,
            target_group: target.group_id.clone(),
            focused_child: target.focused_child.clone(),
            neighbor_child: target.neighbor_child.clone(),
            focused_index: target.focused_index,
            neighbor_index: target.neighbor_index,
            old_shares: target.old_shares.clone(),
            new_shares: new_shares.clone(),
        };
        let plan = ResizePlan::for_operation(intent, operation);
        // Dedicated keyboard dispatch/reconcile path (one pending slot plus
        // exact ack/post verification shared with pointer via `verify_resize`).
        // Never routes through `propose_pointer_resize`: the one-sided
        // keyboard derivation above and the fixed share/semantic keyboard
        // operation validate here before commit.
        let dispatch = match self.reconciler.propose_resize(
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
                self.drag = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Propose COSMIC pointer pixel resize for the selected exact
    /// opaque `(domain, window)` pair.
    ///
    /// Rust derives the target matching-axis split boundary and the two
    /// adjacent shares itself; the caller never supplies shares. Inputs are
    /// the captured focused tiled source/domain, the intentional `direction`
    /// selecting which adjacent boundary of the focused leaf moves, and the
    /// absolute `proposed_boundary` coordinate in domain work-area
    /// space along the matching axis (`x` for horizontal, `y` for vertical).
    /// Structural preconditions are the complete session observation plus
    /// the accepted topology/membership/focus/capability binding, exactly
    /// like [`Session::propose_resize`].
    ///
    /// Derivation: nearest matching-axis ancestor with a direct neighbor in
    /// `direction` (keyboard ancestor rule, outward on exhausted pairs);
    /// the proposed coordinate is mapped to desired adjacent pixel extents
    /// inside that pair region, gated by the source pair minimum and clamped
    /// two-sided to the source child minima
    /// ([`crate::cosmic_v1::pair_admits_resize`],
    /// [`crate::cosmic_v1::clamp_pair_split`]), then converted to exact
    /// pixel-projectable integer shares (only the two adjacent shares change
    /// ratios, plus an exact ratio-preserving normalization of the rest of
    /// the selected group when precision requires it; topology/order/
    /// descendants unchanged, focus retained). The session orchestrates; all
    /// COSMIC semantics live in [`crate::cosmic_v1`]. KWin/JS share math is
    /// never trusted: computed shares pass through the shared
    /// [`crate::directional::apply_resize_shares`] primitive and the full
    /// projector before any pending is staged.
    ///
    /// Fail-closed: stale/revision/membership/domain/capability/pending
    /// inputs refuse or diverge like keyboard; proposed coordinates outside
    /// the domain work-area extent refuse as [`RefusalKind::MalformedInput`];
    /// unprojectable results refuse as [`RefusalKind::MalformedTopology`];
    /// source no-op pairs, exhausted minima, and clamped-unchanged boundaries
    /// refuse as [`RefusalKind::Unchanged`] with no plan and no pending. Commits only
    /// via acknowledge-then-[`Session::verify_resize`], sharing the keyboard
    /// reconciliation boundary and operation shape.
    #[allow(clippy::too_many_arguments)]
    pub fn propose_pointer_resize(
        &mut self,
        domain: &DomainKey,
        window: &WindowId,
        direction: Direction,
        proposed_boundary: i32,
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
        if self.drag.is_some() {
            return Err(ProposeError::PendingExists);
        }
        let Some(own_domain) = self.domains.iter().find(|d| &d.key() == domain).cloned() else {
            return Err(ProposeError::Refused(RefusalKind::UnknownDomain));
        };
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
        if let Some(entry) = session_observation
            .windows
            .iter()
            .find(|w| w.window == focused_window)
            && entry.flags().any()
        {
            return Err(ProposeError::Refused(RefusalKind::NotTiled));
        }
        if !capabilities.supports(crate::contract::ResizeCapability::PointerResize) {
            return Err(ProposeError::Refused(RefusalKind::UnsupportedCapability));
        }
        // Normalized coordinate must land inside the domain work-area extent
        // along the matching axis; outside is malformed, never clamped.
        let wanted = Axis::for_direction(direction);
        let inside_work_area = match wanted {
            Axis::Horizontal => {
                proposed_boundary >= own_domain.bounds.x
                    && proposed_boundary <= own_domain.bounds.x + own_domain.bounds.w
            }
            Axis::Vertical => {
                proposed_boundary >= own_domain.bounds.y
                    && proposed_boundary <= own_domain.bounds.y + own_domain.bounds.h
            }
        };
        if !inside_work_area {
            return Err(ProposeError::Refused(RefusalKind::MalformedInput));
        }
        let Some(tree) = self.trees.get(domain).cloned().flatten() else {
            return Err(ProposeError::Refused(RefusalKind::FocusMismatch));
        };
        // Project the accepted topology once: source of truth for group
        // extents and adjacent pixel sizes.
        let accepted_geometry =
            project_output_geometry(Some(&own_domain), Some(&tree), &self.windows, domain)
                .map_err(|_| ProposeError::Refused(RefusalKind::MalformedTopology))?;
        if !geometry_covers_affected(
            &accepted_geometry,
            &self.windows,
            std::slice::from_ref(domain),
        ) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        let Some(pointer) = derive_pointer_shares(
            &tree,
            &focused_leaf,
            direction,
            proposed_boundary,
            &own_domain,
            &accepted_geometry,
        ) else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        let (target, new_shares, effective_boundary, mode) = match pointer {
            PointerDerived::Unchanged => {
                return Err(ProposeError::Refused(RefusalKind::Unchanged));
            }
            PointerDerived::Planned {
                target,
                new_shares,
                effective_boundary,
                mode,
            } => (target, new_shares, effective_boundary, mode),
        };
        let Some(updated_tree) =
            crate::directional::apply_resize_shares(&tree, &target.group_id, &new_shares)
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
        // Minimum-size projectability: every desired leaf in the affected
        // domain keeps a positive extent along the resize axis with at least
        // the portable minimum on the two resized adjacent children.
        if !pointer_minimum_holds(&desired_geometry, &target, domain, wanted) {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        }
        // Exact projectability: the complete projected geometry must place
        // the effective (clamped) boundary exactly after integer projection
        // (including nested/N-ary/gaps). Unclamped proposals have
        // `effective == proposed`; clamped in-work-area proposals bind the
        // clamped edge. A mismatch means the clamped result cannot represent
        // the proposal; refuse as unchanged with no plan and no pending, so
        // the adapter never faces a post-observation mismatch for a
        // native-owned source showing the effective edge. Never snap to a
        // nearby boundary.
        let Some(projected_boundary) = pointer_projected_boundary(
            &desired_geometry,
            desired_trees
                .get(domain)
                .cloned()
                .flatten()
                .as_ref()
                .expect("desired tree present"),
            &target,
            wanted,
        ) else {
            return Err(ProposeError::Refused(RefusalKind::MalformedTopology));
        };
        if projected_boundary != effective_boundary {
            return Err(ProposeError::Refused(RefusalKind::Unchanged));
        }
        let intent = ResizeIntent {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
            mode,
        };
        let operation = ResizeOperation {
            domain_output: domain.output.clone(),
            domain_workspace: domain.workspace.clone(),
            focused_leaf: focused_leaf.clone(),
            focused_window: focused_window.clone(),
            direction,
            mode,
            target_group: target.group_id.clone(),
            focused_child: target.focused_child.clone(),
            neighbor_child: target.neighbor_child.clone(),
            focused_index: target.focused_index,
            neighbor_index: target.neighbor_index,
            old_shares: target.old_shares.clone(),
            new_shares: new_shares.clone(),
        };
        // Pointer route binds `PointerResize` explicitly: the shared operation
        // shape reports `KeyboardResize` via `required_capability()`, so the
        // plan is constructed directly instead of via `for_operation`.
        let plan = ResizePlan {
            intent,
            operation: operation.clone(),
            required_capability: crate::contract::ResizeCapability::PointerResize,
            preconditions: operation.preconditions(),
        };
        let dispatch = match self.reconciler.propose_pointer_resize(
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
                    self.exceptions = desired.exceptions;
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
        let geometry = project_output_geometry(Some(&domain), tree.as_ref(), &self.windows, &key)
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
        if session_observation.windows.len() > MAX_OBSERVED_WINDOWS
            || !valid_observed_shapes(&session_observation.windows)
        {
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
            trees: desired_trees,
            windows: self.windows.clone(),
            focused_domain: Some(capture.domain.clone()),
            focused_leaf: Some(capture.source_leaf.clone()),
            exceptions: self.exceptions.clone(),
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

    fn clear_drag_snap_back(&mut self, capture: &DragState) -> DragSnapBack {
        // The accepted source rect is re-projected so cancel reflects accepted
        // state; the captured rect is the fail-closed fallback.
        let rect = self
            .domains
            .iter()
            .find(|d| d.key() == capture.domain)
            .and_then(|domain| {
                let tree = self.trees.get(&capture.domain).cloned().flatten();
                project_output_geometry(Some(domain), tree.as_ref(), &self.windows, &capture.domain)
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

    /// Record an explicit adapter acknowledgement (shared binding for movement,
    /// lifecycle, focus, resize, and drag pending plans). Terminal divergence
    /// clears the pending desired state, matching [`Session::note_adapter_loss`].
    pub fn acknowledge(
        &mut self,
        ack: &crate::contract::AdapterAck,
    ) -> Result<AckApplied, AckError> {
        match self.reconciler.acknowledge(ack) {
            Ok(applied) => Ok(applied),
            Err(AckError::NoPending) => Err(AckError::NoPending),
            Err(AckError::Diverged(reason)) => {
                self.pending_desired = None;
                self.drag = None;
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
                self.drag = None;
                Err(VerifyError::Diverged(reason))
            }
            Err(other) => Err(other),
        }
    }

    /// Explicit adapter-loss signal: terminal divergence, pending discarded.
    pub fn note_adapter_loss(&mut self) -> DivergenceKind {
        self.pending_desired = None;
        self.drag = None;
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

fn insert_leaf_into_group(tree: Node, group_id: &NodeId, index: usize, leaf: Node) -> Option<Node> {
    match tree {
        Node::Leaf { .. } => None,
        Node::Group {
            id,
            axis,
            mut children,
            shares,
        } => {
            if &id == group_id {
                if index > children.len() {
                    return None;
                }
                let new_shares = crate::cosmic_v1::proportional_insertion_shares(&shares, index)?;
                children.insert(index, leaf);
                return Some(Node::Group {
                    id,
                    axis,
                    children,
                    shares: new_shares,
                });
            }
            for (pos, child) in children.iter().enumerate() {
                if child.id() == group_id || subtree_contains_id(child, group_id) {
                    let updated =
                        insert_leaf_into_group(child.clone(), group_id, index, leaf.clone())?;
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
                    shares: crate::cosmic_v1::new_group_shares().to_vec(),
                }
            } else {
                Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![remainder, mover_leaf_node],
                    shares: crate::cosmic_v1::new_group_shares().to_vec(),
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
                    shares: crate::cosmic_v1::new_group_shares().to_vec(),
                }
            } else {
                Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![s_node, w_node],
                    shares: crate::cosmic_v1::new_group_shares().to_vec(),
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
            let updated =
                insert_leaf_into_group(working, target_group, *insertion_index, mover_leaf_node)?;
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
                    shares: crate::cosmic_v1::new_group_shares().to_vec(),
                },
                FocusedSide::Second => Node::Group {
                    id: new_id,
                    axis: *axis,
                    children: vec![victim, mover_leaf_node],
                    shares: crate::cosmic_v1::new_group_shares().to_vec(),
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
                    working = insert_leaf_into_group(working, parent, index, mover_leaf_node)?;
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
                            shares: crate::cosmic_v1::new_group_shares().to_vec(),
                        }
                    } else {
                        Node::Group {
                            id: new_id,
                            axis,
                            children: vec![parent_subtree, mover_leaf_node],
                            shares: crate::cosmic_v1::new_group_shares().to_vec(),
                        }
                    };
                    working = replace_node_by_id(working, parent, wrapped)?;
                }
            }
            desired_trees.insert(source.clone(), Some(working));
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
                            shares: crate::cosmic_v1::new_group_shares().to_vec(),
                        }
                    } else {
                        Node::Group {
                            id: new_id,
                            axis,
                            children: vec![existing, mover_leaf_node],
                            shares: crate::cosmic_v1::new_group_shares().to_vec(),
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

/// Shared drag resolution outcome (preview and drop agree): the portable
/// target identities/rect, the edge (window edges and group edges carry the
/// source edge; group interior carries the canonical group-axis edge
/// Left/Top with the interior `insertion_index` distinguishing it from the
/// first/last edge slots), the derived axis/order, the placement, and the
/// next portable prior hover (Some only for a resolved GroupEdge).
struct SharedDragResolved {
    target_leaf: NodeId,
    target_window: WindowId,
    target_rect: Rect,
    side: DragSide,
    axis: Axis,
    before: bool,
    placement: DragPlacement,
    next_prior: Option<crate::cosmic_v1::PriorGroupEdge>,
}

/// Deterministic drag placement: the new domain tree plus the resolved
/// operation bindings (`target_group`/`insertion_index`/`wrap`/`new_group`).
struct DragPlacement {
    tree: Node,
    target_group: NodeId,
    insertion_index: usize,
    wrap: bool,
    new_group: Option<NodeId>,
}

fn contains_point(rect: &Rect, x: i32, y: i32) -> bool {
    x >= rect.x
        && y >= rect.y
        && x.checked_sub(rect.x).is_some_and(|dx| dx < rect.w)
        && y.checked_sub(rect.y).is_some_and(|dy| dy < rect.h)
}

/// COSMIC window-drop classification inside a projected target rectangle.
/// Delegates to [`crate::cosmic_v1::classify_window_point`]: the middle third
/// (rounded thirds) is the center stack source fact
/// (`Some(DragSide::Center)`), any other location selects an edge by strict
/// normalized half-distance (ties choose vertical), and points outside yield
/// `None`. The session orchestrates; all COSMIC zone semantics live in
/// [`crate::cosmic_v1`]. Center never plans (unsupported stack behavior).
fn drag_edge_for(rect: &Rect, x: i32, y: i32) -> Option<DragSide> {
    crate::cosmic_v1::classify_window_point(rect, x, y)
}

/// Stale-capture check excluding the evolving prior hover: revision,
/// generation, topology, membership, and focus must match live session state.
fn drag_capture_stale(session: &Session, capture: &DragState) -> bool {
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
fn resolve_drag_shared(
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
            if let Some(edge) = crate::cosmic_v1::classify_group_point(
                &layout.rect,
                &layout.id,
                x,
                y,
                capture.prior.as_ref(),
            ) {
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
                    next_prior: Some(crate::cosmic_v1::PriorGroupEdge {
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
            let predecessor =
                crate::cosmic_v1::insertion_index_for_offset(&layout.child_starts, offset);
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
            let Some(side) = drag_edge_for(&rect, x, y) else {
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
            let placement =
                apply_drag_placement(tree, &capture.source_leaf, id, side, capture.revision)
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

fn generate_drag_group_id(
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
fn apply_drag_placement(
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
    let working = remove_leaf_from_tree(Some(tree.clone()), source_leaf)?;
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
            let updated = insert_leaf_into_group(working, &parent_id, insertion_index, mover)?;
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
    let new_shares = crate::cosmic_v1::new_group_shares().to_vec();
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
            shares: crate::cosmic_v1::new_group_shares().to_vec(),
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
struct GroupLayout {
    id: NodeId,
    axis: Axis,
    rect: Rect,
    child_starts: Vec<i64>,
}

fn drag_group_layouts(tree: &Node, leaf_rects: &BTreeMap<NodeId, Rect>) -> Vec<GroupLayout> {
    let mut out = Vec::new();
    collect_group_layouts(tree, leaf_rects, &mut out);
    out
}

fn collect_group_layouts(
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
fn group_rep_window(
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
fn apply_group_edge_placement(
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
    let working = remove_leaf_from_tree(Some(tree.clone()), source_leaf)?;
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
        let updated = insert_leaf_into_group(working, group_id, insertion_index, mover)?;
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
    let new_shares = crate::cosmic_v1::new_group_shares().to_vec();
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
            shares: crate::cosmic_v1::new_group_shares().to_vec(),
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
fn apply_group_interior_placement(
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
    let working = remove_leaf_from_tree(Some(tree.clone()), source_leaf)?;
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
    let updated = insert_leaf_into_group(working, group_id, insertion_index, mover)?;
    Some(DragPlacement {
        tree: updated,
        target_group: group_id.clone(),
        insertion_index,
        wrap: false,
        new_group: None,
    })
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

/// COSMIC admission axis for a target geometry. Delegates to
/// [`crate::cosmic_v1::admission_axis`]: width strictly greater than height
/// selects portable [`Axis::Horizontal`] (splits width), otherwise
/// [`Axis::Vertical`] (vertical on tie).
fn orientation_from_bounds(bounds: &Rect) -> Axis {
    crate::cosmic_v1::admission_axis_for_rect(bounds)
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

/// Portable pointer target: the Rust-derived matching-axis split boundary
/// plus the selected adjacent pair and its current shares.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PointerTarget {
    group_id: NodeId,
    focused_index: usize,
    neighbor_index: usize,
    focused_child: NodeId,
    neighbor_child: NodeId,
    old_shares: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PointerDerived {
    Unchanged,
    Planned {
        target: PointerTarget,
        new_shares: Vec<u64>,
        effective_boundary: i32,
        mode: ResizeMode,
    },
}

struct PointerLevel {
    group_id: NodeId,
    axis: Axis,
    children: Vec<NodeId>,
    shares: Vec<u64>,
    child_index: usize,
}

fn pointer_path(node: &Node, focused: &NodeId, out: &mut Vec<PointerLevel>) -> bool {
    match node {
        Node::Leaf { .. } => false,
        Node::Group {
            id,
            axis,
            children,
            shares,
        } => {
            for (index, child) in children.iter().enumerate() {
                if child.id() == focused {
                    out.push(PointerLevel {
                        group_id: id.clone(),
                        axis: *axis,
                        children: children.iter().map(|c| c.id().clone()).collect(),
                        shares: shares.clone(),
                        child_index: index,
                    });
                    return true;
                }
                if subtree_contains(child, focused) {
                    let found = pointer_path(child, focused, out);
                    if found {
                        out.push(PointerLevel {
                            group_id: id.clone(),
                            axis: *axis,
                            children: children.iter().map(|c| c.id().clone()).collect(),
                            shares: shares.clone(),
                            child_index: index,
                        });
                        return true;
                    }
                    return false;
                }
            }
            false
        }
    }
}

/// Direct-child projected extent along `axis` for one child of the target
/// group: bounding box of its descendant accepted leaves.
fn pointer_child_extent(
    tree: &Node,
    child: &NodeId,
    axis: Axis,
    geometry: &[DesiredGeometry],
) -> Option<i64> {
    let mut leaves = Vec::new();
    collect_pointer_leaves(tree, child, &mut leaves);
    if leaves.is_empty() {
        return None;
    }
    let mut positions: Vec<(i32, i32)> = Vec::new();
    for leaf in &leaves {
        let entry = geometry.iter().find(|g| &g.leaf == leaf)?;
        positions.push(match axis {
            Axis::Horizontal => (entry.rect.x, entry.rect.w),
            Axis::Vertical => (entry.rect.y, entry.rect.h),
        });
        if entry.rect.w <= 0 || entry.rect.h <= 0 {
            return None;
        }
    }
    let min = positions.iter().map(|(o, _)| i64::from(*o)).min()?;
    let max = positions
        .iter()
        .map(|(o, e)| i64::from(*o) + i64::from(*e))
        .max()?;
    Some(max - min)
}

fn collect_pointer_leaves(node: &Node, target: &NodeId, out: &mut Vec<NodeId>) {
    if node.id() == target {
        collect_leaves(node).into_iter().for_each(|id| out.push(id));
        return;
    }
    if let Node::Group { children, .. } = node {
        for child in children {
            if subtree_contains(child, target) || child.id() == target {
                collect_pointer_leaves(child, target, out);
            }
        }
    }
}

/// Group origin along `axis` from accepted descendant leaf bounds.
fn pointer_group_origin(
    tree: &Node,
    group: &NodeId,
    axis: Axis,
    geometry: &[DesiredGeometry],
) -> Option<i64> {
    let mut leaves = Vec::new();
    collect_pointer_group_leaves(tree, group, &mut leaves);
    if leaves.is_empty() {
        return None;
    }
    let mut min: Option<i64> = None;
    for leaf in &leaves {
        let entry = geometry.iter().find(|g| &g.leaf == leaf)?;
        let origin = match axis {
            Axis::Horizontal => i64::from(entry.rect.x),
            Axis::Vertical => i64::from(entry.rect.y),
        };
        min = Some(min.map_or(origin, |m: i64| m.min(origin)));
    }
    min
}

fn collect_pointer_group_leaves(node: &Node, group: &NodeId, out: &mut Vec<NodeId>) {
    if node.id() == group {
        for leaf in collect_leaves(node) {
            out.push(leaf);
        }
        return;
    }
    if let Node::Group { children, .. } = node {
        for child in children {
            if subtree_contains(child, group) || child.id() == group {
                collect_pointer_group_leaves(child, group, out);
            }
        }
    }
}

/// COSMIC pixel-share derivation outcome shared by keyboard and pointer
/// resize. `None` from the drivers means malformed/unrepresentable (caller
/// maps to `MalformedTopology`); `Unchanged` means no feasible boundary or a
/// no-op proposing the current boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PixelDerived {
    Unchanged,
    Planned {
        target: PointerTarget,
        new_shares: Vec<u64>,
    },
}

/// Exact pixel-projectable normalization for a clamped left-child size.
///
/// The projector allocates `floor(D * share / total) + 1` to every non-last
/// child with `D = avail - n` and `avail` the pixel sum. For the left child
/// at `lo` (always non-last) the desired size `clamped_left` needs
/// `floor(D * a / total') = clamped_left - 1` with `total' = K * old_total`
/// and `a + b = K * old_pair_total`. Non-pair shares scale by the same `K`
/// (exact ratio preservation); only the adjacent pair is redistributed.
/// `total' >= D` guarantees an integer `a`, so `K = ceil(D / old_total)`
/// always works. The smallest feasible scale wins (`1`, then the guaranteed
/// factor); no project share-step normalization lives on the COSMIC path. `None` means unrepresentable at any scale.
fn pixel_shares_for_clamped(
    shares: &[u64],
    lo: usize,
    clamped_left: i64,
    distributable: i64,
    old_total: u64,
    old_pair: u64,
) -> Option<Vec<u64>> {
    if distributable <= 0 || old_total == 0 || old_pair == 0 || clamped_left <= 0 {
        return None;
    }
    let distributable_u = u128::from(distributable as u64);
    let old_total_u = u128::from(old_total);
    let required_k = distributable_u
        .div_ceil(old_total_u)
        .min(u128::from(u64::MAX)) as u64;
    let mut candidates = [1u64, required_k];
    candidates.sort_unstable();
    let left_u = u128::from(clamped_left as u64);
    let q = left_u - 1;
    for scale in candidates.into_iter().filter(|k| *k >= 1) {
        if scale == 0 {
            continue;
        }
        let scaled_total = shares
            .iter()
            .try_fold(0u64, |acc, s| acc.checked_add(s.checked_mul(scale)?))?;
        let scaled_pair = old_pair.checked_mul(scale)?;
        if scaled_total == 0 || scaled_pair == 0 {
            continue;
        }
        let mut scaled_ok = true;
        for (index, share) in shares.iter().enumerate() {
            if index == lo || index == lo + 1 {
                continue;
            }
            if share.checked_mul(scale).is_none() {
                scaled_ok = false;
                break;
            }
        }
        if !scaled_ok {
            continue;
        }
        let total_prime = u128::from(scaled_total);
        let pair_prime = u128::from(scaled_pair);
        // `floor(D * a / total') = q` <=> `a in [q*total'/D, ((q+1)*total' - 1)/D]`.
        let lower = (q * total_prime).div_ceil(distributable_u);
        let upper = ((q + 1) * total_prime - 1) / distributable_u;
        if lower > upper {
            continue;
        }
        let lower = lower.max(1);
        let upper = upper.min(pair_prime - 1);
        if lower > upper {
            continue;
        }
        let left_new_u64: u64 = lower.try_into().ok()?;
        let right_new_u64 = scaled_pair.checked_sub(left_new_u64)?;
        if right_new_u64 < 1 {
            continue;
        }
        let scaled_lo = shares[lo].checked_mul(scale)?;
        if left_new_u64 == scaled_lo {
            continue;
        }
        let mut new_shares = Vec::with_capacity(shares.len());
        for (index, share) in shares.iter().enumerate() {
            let value = if index == lo {
                left_new_u64
            } else if index == lo + 1 {
                right_new_u64
            } else {
                share.checked_mul(scale)?
            };
            if value == 0 {
                return None;
            }
            new_shares.push(value);
        }
        return Some(new_shares);
    }
    None
}

/// Derive COSMIC keyboard pixel shares from a repeat-step move.
///
/// Walks matching-axis ancestors nearest outward; the first ancestor whose
/// pair region admits the source pair minimum and whose COSMIC-clamped move
/// changes the boundary wins. Source `tiling/mod.rs` 2576-2600: `direction`
/// (`ResizeDirection`) selects shrink/grow (`Inwards` shrinks the focused
/// node, `Outwards` grows it), `edges` (the cardinal edge) selects the
/// neighbor side, and only the shrink side is clamped one-sided to the axis
/// child minimum via [`crate::cosmic_v1::clamp_keyboard_shrink_pair`] (the
/// grow side takes exactly the amount actually removed). `None` means
/// malformed/unrepresentable; `Unchanged` means no feasible boundary or a
/// clamped no-op at every candidate level.
fn derive_keyboard_pixel_shares(
    tree: &Node,
    focused_leaf: &NodeId,
    edge: Direction,
    mode: ResizeMode,
    step_px: i32,
    _domain: &OutputDomain,
    geometry: &[DesiredGeometry],
) -> Option<PixelDerived> {
    if focused_leaf.0.is_empty() || step_px <= 0 {
        return None;
    }
    let wanted = Axis::for_direction(edge);
    let step: i32 = match edge {
        Direction::Right | Direction::Down => 1,
        Direction::Left | Direction::Up => -1,
    };
    let mut levels = Vec::new();
    if !pointer_path(tree, focused_leaf, &mut levels) {
        return Some(PixelDerived::Unchanged);
    }
    let mut feasible_exhausted = false;
    for level in &levels {
        if level.axis != wanted {
            continue;
        }
        let neighbor = level.child_index as i32 + step;
        if neighbor < 0 || (neighbor as usize) >= level.children.len() {
            continue;
        }
        let neighbor_index = neighbor as usize;
        let focused_index = level.child_index;
        if level.shares.len() != level.children.len()
            || focused_index >= level.shares.len()
            || neighbor_index >= level.shares.len()
            || level.shares.contains(&0)
        {
            return None;
        }
        let lo = focused_index.min(neighbor_index);
        if focused_index.abs_diff(neighbor_index) != 1 {
            return None;
        }
        let mut sizes: Vec<i64> = Vec::with_capacity(level.children.len());
        for child in &level.children {
            sizes.push(pointer_child_extent(tree, child, wanted, geometry)?);
            if sizes.last().is_some_and(|s| *s <= 0) {
                return None;
            }
        }
        let pair_sum = sizes[focused_index].checked_add(sizes[neighbor_index])?;
        if !crate::cosmic_v1::pair_admits_resize(pair_sum, pair_sum, wanted) {
            // Source no-op pair on direct sums sizes[i] + sizes[i+1]:
            // skip outward, never plan through it.
            feasible_exhausted = true;
            continue;
        }
        let focused_size = sizes[focused_index];
        let neighbor_size = sizes[neighbor_index];
        let (shrink, grow) = if mode == ResizeMode::Inwards {
            (focused_size, neighbor_size)
        } else {
            (neighbor_size, focused_size)
        };
        let Some((new_shrink, new_grow)) =
            crate::cosmic_v1::clamp_keyboard_shrink_pair(shrink, grow, i64::from(step_px), wanted)
        else {
            feasible_exhausted = true;
            continue;
        };
        if new_shrink == shrink && new_grow == grow {
            feasible_exhausted = true;
            continue;
        }
        let focused_is_left = focused_index == lo;
        let clamped_left = if focused_is_left {
            if mode == ResizeMode::Inwards {
                new_shrink
            } else {
                new_grow
            }
        } else if mode == ResizeMode::Inwards {
            new_grow
        } else {
            new_shrink
        };
        let current_left = sizes[lo];
        if clamped_left == current_left {
            feasible_exhausted = true;
            continue;
        }
        let mut avail_total: i64 = 0;
        for size in &sizes {
            avail_total = avail_total.checked_add(*size)?;
        }
        let distributable = avail_total.checked_sub(sizes.len() as i64)?;
        let mut old_total: u64 = 0;
        for share in &level.shares {
            old_total = old_total.checked_add(*share)?;
        }
        let old_pair = level.shares[focused_index].checked_add(level.shares[neighbor_index])?;
        let Some(new_shares) = pixel_shares_for_clamped(
            &level.shares,
            lo,
            clamped_left,
            distributable,
            old_total,
            old_pair,
        ) else {
            feasible_exhausted = true;
            continue;
        };
        return Some(PixelDerived::Planned {
            target: PointerTarget {
                group_id: level.group_id.clone(),
                focused_index,
                neighbor_index,
                focused_child: level.children[focused_index].clone(),
                neighbor_child: level.children[neighbor_index].clone(),
                old_shares: level.shares.clone(),
            },
            new_shares,
        });
    }
    if feasible_exhausted {
        return Some(PixelDerived::Unchanged);
    }
    Some(PixelDerived::Unchanged)
}

/// Derive pointer shares from the normalized boundary coordinate.
///
/// Walks matching-axis ancestors nearest outward; the first ancestor whose
/// pair region admits two minimum segments wins. For every valid/clamped
/// boundary inside that pair region, positive shares are derived such that
/// the existing projector returns exactly the proposed shared boundary.
/// Only the selected adjacent share ratio changes, plus an exact
/// ratio-preserving normalization (`new = K * old` for non-pair shares and
/// `new_pair_total = K * old_pair_total`) when representation precision
/// requires it. `None` means malformed/unrepresentable (caller maps to
/// `MalformedTopology`); `Unchanged` means no feasible boundary or a
/// no-op proposing the current boundary.
fn derive_pointer_shares(
    tree: &Node,
    focused_leaf: &NodeId,
    direction: Direction,
    proposed_boundary: i32,
    domain: &OutputDomain,
    geometry: &[DesiredGeometry],
) -> Option<PointerDerived> {
    if focused_leaf.0.is_empty() {
        return None;
    }
    let wanted = Axis::for_direction(direction);
    let step: i32 = match direction {
        Direction::Right | Direction::Down => 1,
        Direction::Left | Direction::Up => -1,
    };
    let mut levels = Vec::new();
    if !pointer_path(tree, focused_leaf, &mut levels) {
        return Some(PointerDerived::Unchanged);
    }
    // `pointer_path` pushes nearest first (post-order unwind is not used;
    // levels are pushed innermost first by construction above).
    let mut feasible_exhausted = false;
    for level in &levels {
        if level.axis != wanted {
            continue;
        }
        let neighbor = level.child_index as i32 + step;
        if neighbor < 0 || (neighbor as usize) >= level.children.len() {
            continue;
        }
        let neighbor_index = neighbor as usize;
        let focused_index = level.child_index;
        if level.shares.len() != level.children.len()
            || focused_index >= level.shares.len()
            || neighbor_index >= level.shares.len()
            || level.shares.contains(&0)
        {
            return None;
        }
        let lo = focused_index.min(neighbor_index);
        // Adjacent by construction (direct neighbor).
        if focused_index.abs_diff(neighbor_index) != 1 {
            return None;
        }
        // Current adjacent pixel sizes from accepted projection.
        let mut sizes: Vec<i64> = Vec::with_capacity(level.children.len());
        for child in &level.children {
            sizes.push(pointer_child_extent(tree, child, wanted, geometry)?);
            if sizes.last() == Some(&0) || sizes.last().is_some_and(|s| *s <= 0) {
                return None;
            }
        }
        let pair_avail = sizes[focused_index].checked_add(sizes[neighbor_index])?;
        // COSMIC pair gate on direct sums sizes[i] + sizes[i+1] (never union
        // including gap): source no-op pairs refuse outward, never planned.
        if !crate::cosmic_v1::pair_admits_resize(pair_avail, pair_avail, wanted) {
            feasible_exhausted = true;
            continue;
        }
        let group_origin = pointer_group_origin(tree, &level.group_id, wanted, geometry)?;
        let gap = i64::from(domain.gap);
        let mut prefix: i64 = 0;
        for size in sizes.iter().take(lo) {
            prefix = prefix.checked_add(*size)?.checked_add(gap)?;
        }
        let pair_start = group_origin.checked_add(prefix)?;
        // Desired left-child size from the proposed boundary treated as the
        // left child's end edge; the right child takes the remainder.
        // Clamping is two-sided per the COSMIC child minima.
        let left_desired = i64::from(proposed_boundary).checked_sub(pair_start)?;
        let clamped_left =
            match crate::cosmic_v1::clamp_pair_split(pair_avail, left_desired, wanted) {
                Some((first, _)) => first,
                None => {
                    feasible_exhausted = true;
                    continue;
                }
            };
        if clamped_left == sizes[lo] {
            // Proposing the current boundary at this level: noop here, try
            // outward before refusing.
            feasible_exhausted = true;
            continue;
        }
        // Exact pixel-projectable normalization shared with keyboard resize
        // (no project share-step on the COSMIC path).
        let mut avail_total: i64 = 0;
        for size in &sizes {
            avail_total = avail_total.checked_add(*size)?;
        }
        let distributable = avail_total.checked_sub(sizes.len() as i64)?;
        let mut old_total: u64 = 0;
        for share in &level.shares {
            old_total = old_total.checked_add(*share)?;
        }
        let old_pair = level.shares[focused_index].checked_add(level.shares[neighbor_index])?;
        let Some(new_shares) = pixel_shares_for_clamped(
            &level.shares,
            lo,
            clamped_left,
            distributable,
            old_total,
            old_pair,
        ) else {
            feasible_exhausted = true;
            continue;
        };
        let effective_boundary = i32::try_from(pair_start.checked_add(clamped_left)?).ok()?;
        let focused_is_left = focused_index == lo;
        let focused_grows = if focused_is_left {
            clamped_left > sizes[lo]
        } else {
            clamped_left < sizes[lo]
        };
        let mode = if focused_grows {
            ResizeMode::Outwards
        } else {
            ResizeMode::Inwards
        };
        let target = PointerTarget {
            group_id: level.group_id.clone(),
            focused_index,
            neighbor_index,
            focused_child: level.children[focused_index].clone(),
            neighbor_child: level.children[neighbor_index].clone(),
            old_shares: level.shares.clone(),
        };
        return Some(PointerDerived::Planned {
            target,
            new_shares,
            effective_boundary,
            mode,
        });
    }
    if feasible_exhausted {
        return Some(PointerDerived::Unchanged);
    }
    Some(PointerDerived::Unchanged)
}

/// Minimum-size projectability on the desired geometry: the two resized
/// adjacent children each keep at least the COSMIC axis child minimum
/// ([`crate::cosmic_v1::child_min_for_axis`]) when they are direct leaves,
/// and every desired leaf stays positive. Subgroup children were already
/// clamped pre-share, so only direct-leaf spans are rechecked here.
fn pointer_minimum_holds(
    geometry: &[DesiredGeometry],
    target: &PointerTarget,
    domain: &DomainKey,
    axis: Axis,
) -> bool {
    use std::collections::BTreeMap;
    let mut by_leaf: BTreeMap<&NodeId, &DesiredGeometry> = BTreeMap::new();
    for entry in geometry {
        if entry.output != domain.output || entry.workspace != domain.workspace {
            continue;
        }
        if entry.rect.w <= 0 || entry.rect.h <= 0 {
            return false;
        }
        by_leaf.insert(&entry.leaf, entry);
    }
    let min = crate::cosmic_v1::child_min_for_axis(axis);
    for child in [&target.focused_child, &target.neighbor_child] {
        if let Some(entry) = by_leaf.get(child) {
            let span = match axis {
                Axis::Horizontal => i64::from(entry.rect.w),
                Axis::Vertical => i64::from(entry.rect.h),
            };
            if span < min {
                return false;
            }
        }
    }
    true
}

/// Keyboard one-sided minimum: only the shrink side (focused on Inwards,
/// neighbor on Outwards) keeps the COSMIC child minimum when it is a direct
/// leaf; the grow side takes exactly the removed amount even below minimum.
/// Subgroup children were clamped pre-share, so only direct-leaf spans are
/// rechecked here. Positivity is enforced by geometry coverage.
fn keyboard_minimum_holds(
    geometry: &[DesiredGeometry],
    target: &PointerTarget,
    domain: &DomainKey,
    axis: Axis,
    mode: ResizeMode,
) -> bool {
    use std::collections::BTreeMap;
    let mut by_leaf: BTreeMap<&NodeId, &DesiredGeometry> = BTreeMap::new();
    for entry in geometry {
        if entry.output != domain.output || entry.workspace != domain.workspace {
            continue;
        }
        if entry.rect.w <= 0 || entry.rect.h <= 0 {
            return false;
        }
        by_leaf.insert(&entry.leaf, entry);
    }
    let min = crate::cosmic_v1::child_min_for_axis(axis);
    let shrink_child = if mode == ResizeMode::Inwards {
        &target.focused_child
    } else {
        &target.neighbor_child
    };
    if let Some(entry) = by_leaf.get(shrink_child) {
        let span = match axis {
            Axis::Horizontal => i64::from(entry.rect.w),
            Axis::Vertical => i64::from(entry.rect.h),
        };
        if span < min {
            return false;
        }
    }
    true
}

/// Exact projected boundary of the target pair's left child after integer
/// projection: the maximum end edge over descendant desired leaves of the
/// left child (`x + w` horizontal, `y + h` vertical). This is the absolute
/// domain-space coordinate the native-driven source edge and the adjacent
/// neighbour edge must show for post-observation to bind. `None` when the
/// left child or any descendant leaf is missing from the geometry.
fn pointer_projected_boundary(
    geometry: &[DesiredGeometry],
    tree: &Node,
    target: &PointerTarget,
    axis: Axis,
) -> Option<i32> {
    use std::collections::BTreeMap;
    let left_child = if target.focused_index < target.neighbor_index {
        &target.focused_child
    } else {
        &target.neighbor_child
    };
    let left_node = find_node_by_id(tree, left_child)?;
    let leaves = collect_leaves(left_node);
    if leaves.is_empty() {
        return None;
    }
    let mut by_leaf: BTreeMap<&NodeId, &DesiredGeometry> = BTreeMap::new();
    for entry in geometry {
        by_leaf.insert(&entry.leaf, entry);
    }
    let mut end: Option<i64> = None;
    for leaf in &leaves {
        let entry = by_leaf.get(leaf)?;
        let leaf_end = match axis {
            Axis::Horizontal => i64::from(entry.rect.x) + i64::from(entry.rect.w),
            Axis::Vertical => i64::from(entry.rect.y) + i64::from(entry.rect.h),
        };
        end = Some(end.map_or(leaf_end, |m: i64| m.max(leaf_end)));
    }
    let value = end?;
    i32::try_from(value).ok()
}

fn find_node_by_id<'a>(node: &'a Node, id: &NodeId) -> Option<&'a Node> {
    if node.id() == id {
        return Some(node);
    }
    match node {
        Node::Leaf { .. } => None,
        Node::Group { children, .. } => {
            for child in children {
                if let Some(found) = find_node_by_id(child, id) {
                    return Some(found);
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
            shares: crate::cosmic_v1::new_group_shares().to_vec(),
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
        // No eligible focus in this domain (deterministic project fallback
        // for focus only, not source COSMIC parity): wrap the entire existing
        // root old/new under a new binary group carrying the admission axis
        // and [`crate::cosmic_v1::new_group_shares`].
        let group_id = generate_group_id(window, base_revision, existing_ids);
        existing_ids.insert(group_id.clone());
        return Some(Node::Group {
            id: group_id,
            axis: orientation,
            children: vec![tree, new_leaf],
            shares: crate::cosmic_v1::new_group_shares().to_vec(),
        });
    };
    // Automatic admission always wraps the focused target leaf in an ordered
    // binary group old/new (source `TilingLayout::new_group` 2898-2936 via
    // `map_to_tree` 548-617): the wrapper takes the old leaf slot with the
    // admission axis and [`crate::cosmic_v1::new_group_shares`]. Same-axis
    // N-ary parent append never applies here; N-ary groups remain for
    // movement/drag representation only.
    let group_id = generate_group_id(window, base_revision, existing_ids);
    existing_ids.insert(group_id.clone());
    nest_focused_with_new(tree, focused, new_leaf, group_id, orientation)
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
            let original_len = children.len();
            let original_shares = shares.clone();
            let mut new_children = Vec::with_capacity(children.len());
            let mut removed_index: Option<usize> = None;
            for (index, child) in children.into_iter().enumerate() {
                if removed_index.is_none()
                    && child.id() == leaf
                    && matches!(child, Node::Leaf { .. })
                {
                    removed_index = Some(index);
                    continue;
                }
                match remove_node(child, leaf) {
                    Some(updated) => {
                        // If the child subtree changed shape but kept its id,
                        // keep the slot share; emptied subtrees drop below.
                        // Detect change by comparing ids? The recursive call
                        // returns an updated node only when the leaf was
                        // inside; unchanged subtrees return an equal node.
                        // We track removal only when a slot disappears.
                        new_children.push(updated);
                    }
                    None => {
                        // Subtree emptied: drop this slot entirely.
                        if removed_index.is_none() {
                            removed_index = Some(index);
                        } else {
                            // More than one slot vanished: fail closed.
                            return None;
                        }
                    }
                }
            }
            // No removal in this subtree: return unchanged group.
            let Some(removed) = removed_index else {
                // Rebuild to check: if lengths match, nothing was removed.
                // We consumed children; reconstruct from new_children only when
                // no removal happened (lengths equal). Since we pushed every
                // child, lengths equal means no-op.
                if new_children.len() != original_len {
                    return None;
                }
                return Some(Node::Group {
                    id,
                    axis,
                    children: new_children,
                    shares: original_shares,
                });
            };
            let _ = removed;
            match new_children.len() {
                0 => None,
                1 => Some(new_children.into_iter().next().expect("one child")),
                _ => {
                    let new_shares =
                        crate::cosmic_v1::proportional_removal_shares(&original_shares, removed)?;
                    // Defensive: helper length must match survivors.
                    if new_shares.len() != new_children.len() {
                        return None;
                    }
                    Some(Node::Group {
                        id,
                        axis,
                        children: new_children,
                        shares: new_shares,
                    })
                }
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
    fn orientation_follows_cosmic_admission_axis() {
        // Source map_to_tree wide => source Vertical splits width => portable
        // Horizontal splits width (geometry.rs); tall/tie => portable Vertical.
        assert_eq!(
            orientation_from_bounds(&Rect {
                x: 0,
                y: 0,
                w: 100,
                h: 50
            }),
            Axis::Horizontal
        );
        assert_eq!(
            orientation_from_bounds(&Rect {
                x: 0,
                y: 0,
                w: 100,
                h: 100
            }),
            Axis::Vertical
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

    // ---- drag placement slice ----

    use crate::contract::{
        AckOutcome, AdapterAck, DragCapabilities, DragPostObservation, DragSide,
        LifecyclePostObservation,
    };
    use crate::ids::CorrelationId;

    fn domain_two() -> OutputDomain {
        OutputDomain {
            id: OutputId("out-2".to_owned()),
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

    fn corr(value: &str) -> CorrelationId {
        CorrelationId::parse(value).unwrap_or_else(|| panic!("valid correlation {value}"))
    }

    fn obs_windows(session: &Session) -> Vec<ObservedWindow> {
        let mut windows: Vec<ObservedWindow> = session
            .snapshot()
            .windows
            .iter()
            .map(|link| ObservedWindow {
                window: link.window.clone(),
                output: link.output.clone(),
                workspace: link.workspace.clone(),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        windows.extend(session.exception_observed());
        windows
    }

    fn obs_for(session: &Session) -> SessionObservation {
        SessionObservation {
            observation: Observation::new(
                owner(),
                generation(),
                session.accepted_revision(),
                1000 + session.accepted_revision(),
            ),
            windows: obs_windows(session),
        }
    }

    /// Admit helper: `horizontal` names the desired portable split axis. The
    /// target geometry selects it through the source rule
    /// ([`crate::cosmic_v1::admission_axis`]: wide targets split portable
    /// Horizontal), so a horizontal split needs a wide target and vice versa.
    fn admit(session: &mut Session, window: &str, horizontal: bool) {
        let rev = session.accepted_revision();
        let window_id = WindowId(window.to_owned());
        let mut windows = obs_windows(session);
        windows.push(ObservedWindow {
            window: window_id.clone(),
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        let bounds = if horizontal {
            Rect {
                x: 0,
                y: 0,
                w: 100,
                h: 50,
            }
        } else {
            Rect {
                x: 0,
                y: 0,
                w: 50,
                h: 100,
            }
        };
        let command = SessionCommand::Admit {
            window: window_id,
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            exceptions: ExceptionFlags::none(),
            exception_behavior: None,
            placement_bounds: bounds,
        };
        let observation = SessionObservation {
            observation: Observation::new(owner(), generation(), rev, 100 + rev),
            windows,
        };
        let correlation = corr(&format!("corr-admit-{window}"));
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
                owner(),
                generation(),
                rev,
                AckOutcome::Accepted,
            ))
            .expect("admit ack");
        session
            .verify_lifecycle(&LifecyclePostObservation::new(
                Observation::new(owner(), generation(), rev, 200 + rev),
                correlation,
                true,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            ))
            .expect("admit verify");
    }

    fn admit_exception(session: &mut Session, window: &str) {
        let rev = session.accepted_revision();
        let window_id = WindowId(window.to_owned());
        let mut windows = obs_windows(session);
        windows.push(ObservedWindow {
            window: window_id.clone(),
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            floating: true,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        let command = SessionCommand::Admit {
            window: window_id,
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            exceptions: ExceptionFlags {
                floating: true,
                fullscreen: false,
                maximized: false,
                sticky: false,
            },
            exception_behavior: Some(ExceptionBehavior::Defer),
            placement_bounds: Rect {
                x: 0,
                y: 0,
                w: 100,
                h: 50,
            },
        };
        let observation = SessionObservation {
            observation: Observation::new(owner(), generation(), rev, 100 + rev),
            windows,
        };
        let correlation = corr(&format!("corr-admit-{window}"));
        session
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
                owner(),
                generation(),
                rev,
                AckOutcome::Accepted,
            ))
            .expect("admit ack");
        session
            .verify_lifecycle(&LifecyclePostObservation::new(
                Observation::new(owner(), generation(), rev, 200 + rev),
                correlation,
                true,
                vec![
                    crate::contract::LifecyclePrecondition::WindowObserved,
                    crate::contract::LifecyclePrecondition::DesiredTopologyValid,
                    crate::contract::LifecyclePrecondition::AdapterMustVerifyPostconditions,
                ],
                crate::contract::LifecycleOperation::AdmitDeferred {
                    window: WindowId(window.to_owned()),
                    output: OutputId("out-1".to_owned()),
                    workspace: WorkspaceId("ws-1".to_owned()),
                },
            ))
            .expect("admit verify");
    }

    /// Two tiled windows: root `H[leaf-win-1 (0-60), leaf-win-2 (60-120)]`,
    /// focus `win-2`.
    fn session_two() -> Session {
        let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("new");
        admit(&mut session, "win-1", true);
        admit(&mut session, "win-2", true);
        session
    }

    /// Three tiled windows: root `H[1 (0-40), 2 (40-80), 3 (80-120)]`, focus
    /// `win-3`.
    fn session_three() -> Session {
        let mut session = session_two();
        admit(&mut session, "win-3", true);
        session
    }

    /// Nested: root `H[1 (0-60 x full), V[2 (y0-40), 3 (y40-80)]]`, focus
    /// `win-3`.
    fn session_nested() -> Session {
        let mut session = session_two();
        admit(&mut session, "win-3", false);
        session
    }

    /// Deep: root `H[1, V[2 (y0-26), 3 (y26-52), 4 (y52-80)]]`, focus `win-4`.
    fn session_deep() -> Session {
        let mut session = session_nested();
        admit(&mut session, "win-4", false);
        session
    }

    fn domain_key() -> DomainKey {
        DomainKey {
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
        }
    }

    fn leaf(name: &str) -> NodeId {
        NodeId(name.to_owned())
    }

    fn leaves_of(session: &Session) -> Vec<NodeId> {
        let key = domain_key();
        match session
            .snapshot()
            .domains
            .into_iter()
            .find(|d| d.output == key.output && d.workspace == key.workspace)
            .and_then(|d| d.tree)
        {
            Some(tree) => collect_leaves(&tree),
            None => Vec::new(),
        }
    }

    fn begin_focused(session: &mut Session, window: &str) -> DragCapture {
        let before = session.snapshot();
        let capture = session
            .begin_drag(&WindowId(window.to_owned()), &obs_for(session))
            .expect("begin");
        // Begin mutates no authoritative topology and stages no pending.
        assert_eq!(session.snapshot(), before);
        assert!(!session.has_pending());
        assert!(!session.has_pending_desired());
        assert!(session.has_drag());
        capture
    }

    fn drop_planned(session: &mut Session, x: i32, y: i32, correlation: &str) -> SessionDragPlan {
        let before = session.snapshot();
        match session
            .drop_drag(
                x,
                y,
                &obs_for(session),
                &corr(correlation),
                &DragCapabilities::full(),
            )
            .expect("drop")
        {
            DragRelease::Planned(plan) => {
                // Drop stages pending but commits no topology.
                assert_eq!(session.snapshot(), before);
                assert!(session.has_pending());
                assert!(!session.has_drag());
                *plan
            }
            DragRelease::SnapBack(_) => panic!("expected a drag plan at ({x}, {y})"),
        }
    }

    fn commit_drag(session: &mut Session, plan: &SessionDragPlan, correlation: &str) {
        let rev = plan.dispatch.base_revision;
        let correlation = corr(correlation);
        assert_eq!(plan.dispatch.correlation_id, correlation);
        session
            .acknowledge(&AdapterAck::new(
                correlation.clone(),
                owner(),
                generation(),
                rev,
                AckOutcome::Accepted,
            ))
            .expect("ack");
        let commit = session
            .verify_drag(&DragPostObservation::new(
                Observation::new(owner(), generation(), rev, 4242),
                correlation,
                true,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            ))
            .expect("verify");
        assert_eq!(commit.revision, rev + 1);
        assert_eq!(session.accepted_revision(), rev + 1);
        assert_eq!(session.snapshot(), plan.desired_snapshot);
        assert!(!session.has_pending());
    }

    /// Exactly-once leaves/windows, valid shares, positive projected areas.
    fn assert_tree_invariants(session: &Session) {
        let snapshot = session.snapshot();
        let mut leaf_to_window = BTreeMap::new();
        for link in &snapshot.windows {
            assert!(
                leaf_to_window
                    .insert(link.leaf.clone(), link.window.clone())
                    .is_none(),
                "leaf bound twice"
            );
        }
        for view in &snapshot.domains {
            let Some(tree) = view.tree.as_ref() else {
                continue;
            };
            let leaves = collect_leaves(tree);
            let mut seen = BTreeSet::new();
            for leaf in &leaves {
                assert!(seen.insert(leaf.clone()), "leaf twice in tree");
                assert!(
                    leaf_to_window.contains_key(leaf),
                    "leaf without exactly one window"
                );
            }
            assert_valid_shares(tree);
            let domain = session
                .domains()
                .iter()
                .find(|d| d.id == view.output && d.workspace == view.workspace)
                .expect("known domain");
            let projected =
                crate::geometry::project(tree, domain.bounds, domain.gap).expect("projectable");
            assert_eq!(projected.len(), leaves.len());
            for leaf in &projected {
                assert!(leaf.rect.w > 0 && leaf.rect.h > 0, "positive area");
            }
        }
        assert_eq!(
            leaf_to_window.len(),
            snapshot.windows.len(),
            "every window on exactly one leaf"
        );
    }

    fn assert_valid_shares(node: &Node) {
        match node {
            Node::Leaf { id } => assert!(!id.0.is_empty()),
            Node::Group {
                id,
                children,
                shares,
                ..
            } => {
                assert!(!id.0.is_empty());
                assert!(children.len() >= 2);
                assert_eq!(shares.len(), children.len());
                assert!(!shares.contains(&0));
                for child in children {
                    assert_valid_shares(child);
                }
            }
        }
    }

    fn contained(inner: &Rect, outer: &Rect) -> bool {
        inner.x >= outer.x
            && inner.y >= outer.y
            && inner.x + inner.w <= outer.x + outer.w
            && inner.y + inner.h <= outer.y + outer.h
    }

    fn intersects(a: &Rect, b: &Rect) -> bool {
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    }

    #[test]
    fn drag_sides_map_to_axis_and_order() {
        // Two-wide: removing win-2 collapses the root, so a left drop onto
        // leaf-win-1 wraps the root target (still Horizontal, before).
        let mut session = session_two();
        let capture = begin_focused(&mut session, "win-2");
        assert_eq!(capture.source_rect.w, 60);
        let left = session.preview_drag(5, 40).expect("left preview");
        assert_eq!(left.target_leaf, leaf("leaf-win-1"));
        assert_eq!(left.side, DragSide::Left);
        assert_eq!(left.axis, Axis::Horizontal);
        assert!(left.before);
        assert!(left.wrap);
        session.cancel_drag();
        // Nested three: leaf-win-1 (0-60) right edge zone inserts after.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let right = session.preview_drag(55, 40).expect("right preview");
        assert_eq!(right.target_leaf, leaf("leaf-win-1"));
        assert_eq!(right.side, DragSide::Right);
        assert_eq!(right.axis, Axis::Horizontal);
        assert!(!right.before);
        assert!(!right.wrap);
        session.cancel_drag();
        // Vertical nested: leaf-win-2 bottom edge zone orders
        // after inside the surviving V parent (no wrap).
        let mut session = session_deep();
        begin_focused(&mut session, "win-4");
        let top = session.preview_drag(90, 5).expect("top preview");
        assert_eq!(top.target_leaf, leaf("leaf-win-2"));
        assert_eq!(top.side, DragSide::Top);
        assert_eq!(top.axis, Axis::Vertical);
        assert!(top.before);
        assert!(!top.wrap);
        let bottom = session.preview_drag(90, 35).expect("bottom preview");
        assert_eq!(bottom.target_leaf, leaf("leaf-win-2"));
        assert_eq!(bottom.side, DragSide::Bottom);
        assert_eq!(bottom.axis, Axis::Vertical);
        assert!(!bottom.before);
        assert!(!bottom.wrap);
    }

    #[test]
    fn drag_same_axis_nary_reorder() {
        // H[1,2,3] focus win-3 left onto leaf-win-1 -> H[3,1,2].
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let preview = session.preview_drag(5, 40).expect("preview");
        assert!(!preview.wrap);
        assert_eq!(preview.insertion_index, 0);
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        assert_eq!(plan.dispatch.operation.target_leaf, leaf("leaf-win-1"));
        assert_eq!(plan.dispatch.operation.side, DragSide::Left);
        assert!(!plan.dispatch.operation.wrap);
        assert_eq!(plan.dispatch.operation.insertion_index, 0);
        commit_drag(&mut session, &plan, "corr-drag-1");
        assert_eq!(
            leaves_of(&session),
            vec![leaf("leaf-win-3"), leaf("leaf-win-1"), leaf("leaf-win-2")]
        );
        // Focus preserved on the moved window.
        assert_eq!(
            session.focus(),
            (Some(domain_key()), Some(leaf("leaf-win-3")))
        );
        assert_tree_invariants(&session);
    }

    #[test]
    fn drag_perpendicular_wraps_only_target_subtree() {
        // H[1,2,3] focus win-3 top onto leaf-win-1: remove 3 -> H[1,2], then
        // wrap leaf-win-1 in a V[3,1] split; leaf-win-2 untouched.
        let mut session = session_three();
        assert_eq!(leaves_of(&session).len(), 3);
        begin_focused(&mut session, "win-3");
        // Middle column (x in [13,27)) top third: perpendicular Top wrap.
        let preview = session.preview_drag(20, 5).expect("preview");
        assert!(preview.wrap);
        assert_eq!(preview.axis, Axis::Vertical);
        assert!(preview.before);
        let plan = drop_planned(&mut session, 20, 5, "corr-drag-1");
        let operation = &plan.dispatch.operation;
        assert!(operation.wrap);
        let new_group = operation.new_group.clone().expect("fresh group");
        assert_ne!(new_group, leaf("leaf-win-1"));
        // Wrapper inherits the target share slot: root stays [1,1].
        let root = plan
            .desired_snapshot
            .domains
            .clone()
            .into_iter()
            .find(|d| d.output.0 == "out-1")
            .and_then(|d| d.tree)
            .expect("desired tree");
        match &root {
            Node::Group {
                axis: Axis::Horizontal,
                children,
                shares,
                ..
            } => {
                assert_eq!(shares, &vec![1, 1]);
                assert_eq!(children.len(), 2);
                assert_eq!(
                    children[1],
                    Node::Leaf {
                        id: leaf("leaf-win-2")
                    }
                );
                match &children[0] {
                    Node::Group {
                        id,
                        axis: Axis::Vertical,
                        children,
                        shares,
                    } => {
                        assert_eq!(id, &new_group);
                        assert_eq!(shares, &vec![1, 1]);
                        assert_eq!(
                            children,
                            &vec![
                                Node::Leaf {
                                    id: leaf("leaf-win-3")
                                },
                                Node::Leaf {
                                    id: leaf("leaf-win-1")
                                },
                            ]
                        );
                    }
                    other => panic!("expected V wrapper, got {other:?}"),
                }
            }
            other => panic!("expected H root, got {other:?}"),
        }
        commit_drag(&mut session, &plan, "corr-drag-1");
        assert_eq!(
            session.focus(),
            (Some(domain_key()), Some(leaf("leaf-win-3")))
        );
        assert_tree_invariants(&session);
    }

    #[test]
    fn drag_deep_nesting_collapse_and_wrap() {
        // H[1, V[2,3,4]] focus win-4 left onto leaf-win-2 (60-80, y0-26):
        // remove 4 -> V[2,3], wrap leaf-win-2 in H[4,2] at V index 0.
        let mut session = session_deep();
        begin_focused(&mut session, "win-4");
        let preview = session.preview_drag(65, 13).expect("preview");
        assert!(preview.wrap);
        assert_eq!(preview.target_leaf, leaf("leaf-win-2"));
        assert_eq!(preview.axis, Axis::Horizontal);
        assert!(preview.before);
        let plan = drop_planned(&mut session, 65, 13, "corr-drag-1");
        commit_drag(&mut session, &plan, "corr-drag-1");
        let root = session
            .snapshot()
            .domains
            .into_iter()
            .find(|d| d.output.0 == "out-1")
            .and_then(|d| d.tree)
            .expect("tree");
        match root {
            Node::Group { children, .. } => {
                assert_eq!(children.len(), 2);
                assert_eq!(
                    children[0],
                    Node::Leaf {
                        id: leaf("leaf-win-1")
                    }
                );
                match &children[1] {
                    Node::Group {
                        children, shares, ..
                    } => {
                        assert_eq!(shares, &vec![1, 1]);
                        assert_eq!(children.len(), 2);
                        // Unaffected leaf-win-3 keeps its slot and share.
                        assert_eq!(
                            children[1],
                            Node::Leaf {
                                id: leaf("leaf-win-3")
                            }
                        );
                        match &children[0] {
                            Node::Group {
                                children, shares, ..
                            } => {
                                assert_eq!(shares, &vec![1, 1]);
                                assert_eq!(
                                    children,
                                    &vec![
                                        Node::Leaf {
                                            id: leaf("leaf-win-4")
                                        },
                                        Node::Leaf {
                                            id: leaf("leaf-win-2")
                                        },
                                    ]
                                );
                            }
                            other => panic!("expected H wrapper, got {other:?}"),
                        }
                    }
                    other => panic!("expected V inner, got {other:?}"),
                }
            }
            other => panic!("expected H root, got {other:?}"),
        }
        assert_tree_invariants(&session);
    }

    #[test]
    fn drag_source_collapse_promotes_sibling() {
        // H[1,2] focus win-2 top onto leaf-win-1: remove 2 collapses the root
        // to leaf-win-1, then the root target wraps in V[2,1].
        let mut session = session_two();
        begin_focused(&mut session, "win-2");
        let plan = drop_planned(&mut session, 30, 5, "corr-drag-1");
        assert!(plan.dispatch.operation.wrap);
        commit_drag(&mut session, &plan, "corr-drag-1");
        let root = session
            .snapshot()
            .domains
            .into_iter()
            .find(|d| d.output.0 == "out-1")
            .and_then(|d| d.tree)
            .expect("tree");
        assert_eq!(
            root,
            Node::Group {
                id: plan.dispatch.operation.new_group.clone().expect("group"),
                axis: Axis::Vertical,
                children: vec![
                    Node::Leaf {
                        id: leaf("leaf-win-2")
                    },
                    Node::Leaf {
                        id: leaf("leaf-win-1")
                    },
                ],
                shares: vec![1, 1],
            }
        );
        assert_tree_invariants(&session);
    }

    #[test]
    fn drag_preview_drop_structural_and_geometry_agreement() {
        let mut session = session_three();
        let capture = begin_focused(&mut session, "win-3");
        let preview = session.preview_drag(5, 40).expect("preview");
        // Preview exposes the accepted source rect for the snap-back path.
        assert_eq!(preview.source_rect, capture.source_rect);
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        let operation = &plan.dispatch.operation;
        assert_eq!(preview.target_leaf, operation.target_leaf);
        assert_eq!(preview.target_window, operation.target_window);
        assert_eq!(preview.side, operation.side);
        assert_eq!(preview.axis, operation.axis);
        assert_eq!(preview.before, operation.before);
        assert_eq!(preview.wrap, operation.wrap);
        assert_eq!(preview.target_group, operation.target_group);
        assert_eq!(preview.insertion_index, operation.insertion_index);
        // Complete geometry: every tiled window in the domain, positive,
        // contained, disjoint, domain-scoped.
        let windows = plan
            .desired_snapshot
            .windows
            .iter()
            .filter(|l| l.output.0 == "out-1")
            .count();
        assert_eq!(plan.desired_geometry.len(), windows);
        assert_eq!(windows, 3);
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        };
        for (index, entry) in plan.desired_geometry.iter().enumerate() {
            assert_eq!(entry.output.0, "out-1");
            assert_eq!(entry.workspace.0, "ws-1");
            assert!(entry.rect.w > 0 && entry.rect.h > 0);
            assert!(contained(&entry.rect, &bounds), "escapes work area");
            for other in plan.desired_geometry.iter().skip(index + 1) {
                assert!(!intersects(&entry.rect, &other.rect), "overlap");
            }
        }
        commit_drag(&mut session, &plan, "corr-drag-1");
        assert_tree_invariants(&session);
    }

    #[test]
    fn drag_begin_refusals_fail_closed() {
        // Unknown window.
        let mut session = session_two();
        let before = session.snapshot();
        assert_eq!(
            session.begin_drag(&WindowId("win-9".to_owned()), &obs_for(&session)),
            Err(ProposeError::Refused(RefusalKind::UnknownWindow))
        );
        // Non-focused tiled window.
        assert_eq!(
            session.begin_drag(&WindowId("win-1".to_owned()), &obs_for(&session)),
            Err(ProposeError::Refused(RefusalKind::FocusMismatch))
        );
        // Malformed id.
        assert_eq!(
            session.begin_drag(&WindowId(String::new()), &obs_for(&session)),
            Err(ProposeError::Refused(RefusalKind::MalformedInput))
        );
        // Active drag blocks a second begin.
        begin_focused(&mut session, "win-2");
        assert_eq!(
            session.begin_drag(&WindowId("win-2".to_owned()), &obs_for(&session)),
            Err(ProposeError::PendingExists)
        );
        session.cancel_drag();
        // Reconciler pending blocks begin.
        let rev = session.accepted_revision();
        let mut windows = obs_windows(&session);
        windows.push(ObservedWindow {
            window: WindowId("win-3".to_owned()),
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        session
            .propose(
                &SessionCommand::Admit {
                    window: WindowId("win-3".to_owned()),
                    output: OutputId("out-1".to_owned()),
                    workspace: WorkspaceId("ws-1".to_owned()),
                    exceptions: ExceptionFlags::none(),
                    exception_behavior: None,
                    placement_bounds: Rect {
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                },
                &SessionObservation {
                    observation: Observation::new(owner(), generation(), rev, 1),
                    windows,
                },
                &corr("corr-pending"),
                &LifecycleCapabilities::full(),
            )
            .expect("pending admit");
        assert_eq!(
            session.begin_drag(&WindowId("win-2".to_owned()), &obs_for(&session)),
            Err(ProposeError::PendingExists)
        );
        assert_eq!(session.snapshot(), before);
        assert!(!session.has_drag());
    }

    #[test]
    fn drag_begin_refuses_exception_window() {
        let mut session = session_two();
        admit_exception(&mut session, "win-x");
        assert_eq!(
            session.begin_drag(&WindowId("win-x".to_owned()), &obs_for(&session)),
            Err(ProposeError::Refused(RefusalKind::NotTiled))
        );
        assert!(!session.has_drag());
    }

    #[test]
    fn drag_preview_refusals_fail_closed() {
        let mut session = session_two();
        // No active drag.
        assert_eq!(
            session.preview_drag(10, 10),
            Err(ProposeError::Refused(RefusalKind::MalformedInput))
        );
        let before = session.snapshot();
        begin_focused(&mut session, "win-2");
        // Self drop carries no structural meaning.
        assert_eq!(
            session.preview_drag(90, 40),
            Err(ProposeError::Refused(RefusalKind::Unchanged))
        );
        // Target center is the source stack fact with no portable topology:
        // preview fails closed as explicit unsupported stack behavior.
        assert_eq!(
            session.preview_drag(30, 40),
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
        );
        // Outside the work area is cross-domain.
        assert_eq!(
            session.preview_drag(200, 40),
            Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch))
        );
        assert_eq!(
            session.preview_drag(-1, 40),
            Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch))
        );
        // Refusals stage nothing and mutate nothing.
        assert_eq!(session.snapshot(), before);
        assert!(!session.has_pending());
        assert!(session.has_drag());
    }

    #[test]
    fn drag_noop_insert_refuses_unchanged() {
        // (75, 40) is source-classified Center on leaf-win-2 (middle thirds):
        // portable topology has no stacks, so preview and release fail closed
        // as explicit unsupported stack behavior with no plan.
        let mut session = session_three();
        let before = session.snapshot();
        begin_focused(&mut session, "win-3");
        assert_eq!(
            session.preview_drag(75, 40),
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
        );
        // Preview stages nothing and keeps the transient drag.
        assert_eq!(session.snapshot(), before);
        assert!(!session.has_pending());
        assert!(!session.has_pending_desired());
        assert!(session.has_drag());
        assert_eq!(
            session.drop_drag(
                75,
                40,
                &obs_for(&session),
                &corr("corr-drag-1"),
                &DragCapabilities::full(),
            ),
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
        );
        // Center refusal plans no topology and stages no pending.
        assert_eq!(session.snapshot(), before);
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert!(!session.has_pending_desired());
    }

    #[test]
    fn drag_cancel_and_invalid_release_snap_back() {
        let mut session = session_two();
        assert_eq!(session.cancel_drag(), None);
        let capture = begin_focused(&mut session, "win-2");
        let snap = session.cancel_drag().expect("snap back");
        assert_eq!(snap.domain, capture.domain);
        assert_eq!(snap.source_leaf, capture.source_leaf);
        assert_eq!(snap.source_window, capture.source_window);
        assert_eq!(snap.source_rect, capture.source_rect);
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(
            leaves_of(&session),
            vec![leaf("leaf-win-1"), leaf("leaf-win-2")]
        );
        // Invalid self releases snap back with no reconciler use.
        begin_focused(&mut session, "win-2");
        match session
            .drop_drag(
                90,
                40,
                &obs_for(&session),
                &corr("corr-drag-1"),
                &DragCapabilities::full(),
            )
            .expect("self release")
        {
            DragRelease::SnapBack(snap) => assert_eq!(snap.source_rect, capture.source_rect),
            DragRelease::Planned(_) => panic!("self must snap back"),
        }
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        // Center (source stack fact, portable topology excludes stacks) fails
        // closed as explicit unsupported stack behavior with no DragPlan and
        // no topology/focus commit, even with full capabilities.
        begin_focused(&mut session, "win-2");
        assert_eq!(
            session.drop_drag(
                30,
                40,
                &obs_for(&session),
                &corr("corr-drag-2"),
                &DragCapabilities::full(),
            ),
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
        );
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(
            leaves_of(&session),
            vec![leaf("leaf-win-1"), leaf("leaf-win-2")]
        );
        // Center refusal이에 clears the transient drag; a second center
        // release without a fresh capture is malformed.
        assert_eq!(
            session.drop_drag(
                30,
                40,
                &obs_for(&session),
                &corr("corr-drag-3"),
                &DragCapabilities::full(),
            ),
            Err(ProposeError::Refused(RefusalKind::MalformedInput))
        );
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(
            leaves_of(&session),
            vec![leaf("leaf-win-1"), leaf("leaf-win-2")]
        );
    }

    #[test]
    fn drag_drop_stale_capability_and_pending_refusals() {
        // Stale observation diverges through the shared slot.
        let mut session = session_two();
        begin_focused(&mut session, "win-2");
        let mut stale = obs_for(&session);
        stale.observation = Observation::new(owner(), generation(), 9, 9);
        assert_eq!(
            session.drop_drag(
                10,
                5,
                &stale,
                &corr("corr-drag-1"),
                &DragCapabilities::full()
            ),
            Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
        );
        assert_eq!(
            session.status().state,
            crate::reconcile::StateKind::Divergent
        );
        assert!(!session.has_drag());
        // Missing capability snaps back and clears the capture.
        let mut session = session_two();
        let capture = begin_focused(&mut session, "win-2");
        let before = session.snapshot();
        let revision = session.accepted_revision();
        match session
            .drop_drag(
                10,
                5,
                &obs_for(&session),
                &corr("corr-drag-1"),
                &DragCapabilities::none(),
            )
            .expect("unsupported capability snaps back")
        {
            DragRelease::SnapBack(snap) => {
                assert_eq!(snap.source_rect, capture.source_rect);
            }
            DragRelease::Planned(_) => panic!("unsupported capability must snap back"),
        }
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(session.snapshot(), before);
        assert_eq!(session.accepted_revision(), revision);
        // Lifecycle proposals are blocked while a transient drag is active so
        // they cannot stale the capture.
        let mut session = session_two();
        begin_focused(&mut session, "win-2");
        let rev = session.accepted_revision();
        let mut windows = obs_windows(&session);
        windows.push(ObservedWindow {
            window: WindowId("win-3".to_owned()),
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        assert_eq!(
            session.propose(
                &SessionCommand::Admit {
                    window: WindowId("win-3".to_owned()),
                    output: OutputId("out-1".to_owned()),
                    workspace: WorkspaceId("ws-1".to_owned()),
                    exceptions: ExceptionFlags::none(),
                    exception_behavior: None,
                    placement_bounds: Rect {
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                },
                &SessionObservation {
                    observation: Observation::new(owner(), generation(), rev, 1),
                    windows,
                },
                &corr("corr-pending"),
                &LifecycleCapabilities::full(),
            ),
            Err(ProposeError::PendingExists)
        );
        assert!(session.has_drag());
        assert!(!session.has_pending());
    }

    #[test]
    fn drag_ack_verify_commit_and_divergence() {
        // Happy path.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        commit_drag(&mut session, &plan, "corr-drag-1");
        assert_eq!(
            leaves_of(&session),
            vec![leaf("leaf-win-3"), leaf("leaf-win-1"), leaf("leaf-win-2")]
        );
        // Refused capability ack diverges.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        assert_eq!(
            session.acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                plan.dispatch.base_revision,
                AckOutcome::RefusedCapability,
            )),
            Err(crate::reconcile::AckError::Diverged(
                DivergenceKind::CapabilityRefused
            ))
        );
        assert!(!session.has_pending_desired());
        // Partial ack diverges.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        assert_eq!(
            session.acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                plan.dispatch.base_revision,
                AckOutcome::PartialApplication,
            )),
            Err(crate::reconcile::AckError::Diverged(
                DivergenceKind::PartialApplication
            ))
        );
        // Mismatched verified operation diverges without commit.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        let base = plan.dispatch.base_revision;
        session
            .acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                base,
                AckOutcome::Accepted,
            ))
            .expect("ack");
        let mut bad_operation = plan.dispatch.operation.clone();
        bad_operation.insertion_index += 1;
        assert_eq!(
            session.verify_drag(&DragPostObservation::new(
                Observation::new(owner(), generation(), base, 9),
                corr("corr-drag-1"),
                true,
                plan.dispatch.preconditions.clone(),
                bad_operation,
            )),
            Err(crate::reconcile::VerifyError::Diverged(
                DivergenceKind::PostconditionMismatch
            ))
        );
        assert_eq!(
            leaves_of(&session),
            vec![leaf("leaf-win-1"), leaf("leaf-win-2"), leaf("leaf-win-3")]
        );
        // Unverified diverges without commit.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        let base = plan.dispatch.base_revision;
        session
            .acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                base,
                AckOutcome::Accepted,
            ))
            .expect("ack");
        assert_eq!(
            session.verify_drag(&DragPostObservation::new(
                Observation::new(owner(), generation(), base, 9),
                corr("corr-drag-1"),
                false,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            )),
            Err(crate::reconcile::VerifyError::Diverged(
                DivergenceKind::PostconditionUnverified
            ))
        );
        // Cross-kind verify while drag pending diverges.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        let base = plan.dispatch.base_revision;
        session
            .acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                base,
                AckOutcome::Accepted,
            ))
            .expect("ack");
        assert_eq!(
            session.verify_lifecycle(&LifecyclePostObservation::new(
                Observation::new(owner(), generation(), base, 9),
                corr("corr-drag-1"),
                true,
                Vec::new(),
                crate::contract::LifecycleOperation::RemoveDeferred {
                    window: WindowId("win-3".to_owned()),
                    output: OutputId("out-1".to_owned()),
                    workspace: WorkspaceId("ws-1".to_owned()),
                },
            )),
            Err(crate::reconcile::VerifyError::Diverged(
                DivergenceKind::PostconditionMismatch
            ))
        );
    }

    #[test]
    fn drag_deterministic_replay() {
        let replay = || {
            let mut session = session_three();
            begin_focused(&mut session, "win-3");
            let preview = session.preview_drag(5, 40).expect("preview");
            let release = session
                .drop_drag(
                    5,
                    40,
                    &obs_for(&session),
                    &corr("corr-drag-1"),
                    &DragCapabilities::full(),
                )
                .expect("drop");
            (preview, release)
        };
        let (first_preview, first_release) = replay();
        let (second_preview, second_release) = replay();
        assert_eq!(first_preview, second_preview);
        assert_eq!(first_release, second_release);
    }

    #[test]
    fn drag_bounded_invariant_loop() {
        let mut session =
            Session::new(owner(), generation(), 0, 7, vec![domain(), domain_two()]).expect("new");
        admit(&mut session, "win-1", true);
        admit(&mut session, "win-2", true);
        admit(&mut session, "win-3", false);
        let before = session.snapshot();
        let capture = begin_focused(&mut session, "win-3");
        let mut ok = 0u32;
        let mut refused = 0u32;
        for x in (0..120).step_by(10) {
            for y in (0..80).step_by(10) {
                match session.preview_drag(x, y) {
                    Ok(preview) => {
                        ok += 1;
                        assert_eq!(preview.domain, capture.domain);
                        assert_eq!(preview.source_leaf, capture.source_leaf);
                        assert_ne!(preview.target_leaf, capture.source_leaf);
                        assert!(preview.target_rect.w > 0 && preview.target_rect.h > 0);
                    }
                    Err(ProposeError::Refused(_)) => refused += 1,
                    Err(ProposeError::Diverged(reason)) => {
                        panic!("preview must not diverge: {reason:?}")
                    }
                    Err(ProposeError::PendingExists) => panic!("preview holds no slot"),
                }
                // No mutation before commit: exactly-once leaves/windows,
                // valid trees/shares, positive areas, domain isolation.
                assert_eq!(session.snapshot(), before);
                assert!(!session.has_pending());
                assert!(!session.has_pending_desired());
                assert_tree_invariants(&session);
                let isolated = session
                    .snapshot()
                    .domains
                    .into_iter()
                    .find(|d| d.output.0 == "out-2")
                    .expect("second domain");
                assert!(isolated.tree.is_none(), "domain isolation");
            }
        }
        assert!(ok > 0, "loop must hit valid edges and stack centers");
        assert!(refused > 0, "loop must hit self/gap/out-of-area");
        session.cancel_drag();
        assert_eq!(session.snapshot(), before);
    }

    #[test]
    fn drag_blocks_all_proposals_while_active() {
        use crate::contract::{FocusCapabilities, ResizeCapabilities};
        use crate::directional::{Capabilities, Direction};
        let mut session = session_three();
        let before = session.snapshot();
        begin_focused(&mut session, "win-3");
        let obs = obs_for(&session);
        // Lifecycle.
        let mut windows = obs_windows(&session);
        windows.push(ObservedWindow {
            window: WindowId("win-9".to_owned()),
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        assert_eq!(
            session.propose(
                &SessionCommand::Admit {
                    window: WindowId("win-9".to_owned()),
                    output: OutputId("out-1".to_owned()),
                    workspace: WorkspaceId("ws-1".to_owned()),
                    exceptions: ExceptionFlags::none(),
                    exception_behavior: None,
                    placement_bounds: Rect {
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50
                    },
                },
                &SessionObservation {
                    observation: Observation::new(
                        owner(),
                        generation(),
                        session.accepted_revision(),
                        1
                    ),
                    windows,
                },
                &corr("corr-block-1"),
                &LifecycleCapabilities::full(),
            ),
            Err(ProposeError::PendingExists)
        );
        // Move.
        assert_eq!(
            session.propose_move(
                &domain_key(),
                &WindowId("win-3".to_owned()),
                Direction::Left,
                &obs,
                &corr("corr-block-2"),
                &Capabilities::full(),
            ),
            Err(ProposeError::PendingExists)
        );
        // Focus.
        assert_eq!(
            session.propose_focus(
                &domain_key(),
                &WindowId("win-3".to_owned()),
                Direction::Left,
                &obs,
                &corr("corr-block-3"),
                &FocusCapabilities::full(),
            ),
            Err(ProposeError::PendingExists)
        );
        // Resize.
        assert_eq!(
            session.propose_resize(
                &domain_key(),
                &WindowId("win-3".to_owned()),
                Direction::Left,
                crate::contract::ResizeMode::Outwards,
                0,
                &obs,
                &corr("corr-block-4"),
                &ResizeCapabilities::full(),
            ),
            Err(ProposeError::PendingExists)
        );
        assert!(session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(session.snapshot(), before);
        session.cancel_drag();
    }

    #[test]
    fn drag_transient_cleared_on_terminal_paths() {
        // Adapter loss clears the transient drag together with pending desired.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        assert!(session.has_drag());
        session.note_adapter_loss();
        assert!(!session.has_drag());
        assert!(!session.has_pending_desired());
        assert_eq!(
            session.status().state,
            crate::reconcile::StateKind::Divergent
        );
        // Acknowledgement divergence clears pending desired (drag already
        // cleared by a successful drop).
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        assert!(!session.has_drag());
        assert!(session.has_pending());
        assert_eq!(
            session.acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                plan.dispatch.base_revision,
                AckOutcome::RefusedCapability,
            )),
            Err(crate::reconcile::AckError::Diverged(
                DivergenceKind::CapabilityRefused
            ))
        );
        assert!(!session.has_drag());
        assert!(!session.has_pending_desired());
        // Wrong-kind verification diverges fail-closed and clears staging.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        let base = plan.dispatch.base_revision;
        session
            .acknowledge(&AdapterAck::new(
                corr("corr-drag-1"),
                owner(),
                generation(),
                base,
                AckOutcome::Accepted,
            ))
            .expect("ack");
        assert_eq!(
            session.verify_lifecycle(&LifecyclePostObservation::new(
                Observation::new(owner(), generation(), base, 9),
                corr("corr-drag-1"),
                true,
                Vec::new(),
                crate::contract::LifecycleOperation::RemoveDeferred {
                    window: WindowId("win-3".to_owned()),
                    output: OutputId("out-1".to_owned()),
                    workspace: WorkspaceId("ws-1".to_owned()),
                },
            )),
            Err(crate::reconcile::VerifyError::Diverged(
                DivergenceKind::PostconditionMismatch
            ))
        );
        assert!(!session.has_drag());
        assert!(!session.has_pending_desired());
    }

    #[test]
    fn drag_preview_validates_full_capture_and_drop_snaps_back_on_stale() {
        // Focus drift stales the capture: preview refuses, drop snaps back.
        let mut session = session_three();
        let preview_ok = {
            begin_focused(&mut session, "win-3");
            session.preview_drag(5, 40).expect("preview")
        };
        assert!(preview_ok.proposed_rect.w > 0);
        session.focused_leaf = Some(leaf("leaf-win-1"));
        assert_eq!(
            session.preview_drag(5, 40),
            Err(ProposeError::Refused(RefusalKind::MalformedTopology))
        );
        match session
            .drop_drag(
                5,
                40,
                &obs_for(&session),
                &corr("corr-drag-1"),
                &DragCapabilities::full(),
            )
            .expect("stale capture snaps back")
        {
            DragRelease::SnapBack(_) => {}
            DragRelease::Planned(_) => panic!("stale must snap back"),
        }
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        // Generation drift stales the capture the same way.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        session.preview_drag(5, 40).expect("preview");
        session.drag.as_mut().expect("drag").generation =
            crate::ids::GenerationId::parse("gen-2").expect("valid");
        assert_eq!(
            session.preview_drag(5, 40),
            Err(ProposeError::Refused(RefusalKind::MalformedTopology))
        );
        match session
            .drop_drag(
                5,
                40,
                &obs_for(&session),
                &corr("corr-drag-2"),
                &DragCapabilities::full(),
            )
            .expect("stale generation snaps back")
        {
            DragRelease::SnapBack(_) => {}
            DragRelease::Planned(_) => panic!("stale must snap back"),
        }
        assert!(!session.has_drag());
        // Revision drift stales the capture the same way.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        session.drag.as_mut().expect("drag").revision += 100;
        assert_eq!(
            session.preview_drag(5, 40),
            Err(ProposeError::Refused(RefusalKind::MalformedTopology))
        );
        // Exception-set drift stales the capture.
        let mut session = session_three();
        begin_focused(&mut session, "win-3");
        session.exceptions.insert(
            WindowId("win-x".to_owned()),
            ExceptionRecord {
                window: WindowId("win-x".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-1".to_owned()),
                flags: ExceptionFlags::none(),
            },
        );
        assert_eq!(
            session.preview_drag(5, 40),
            Err(ProposeError::Refused(RefusalKind::MalformedTopology))
        );
        session.cancel_drag();
    }

    #[test]
    fn drag_preview_proposed_rect_matches_final_geometry() {
        let mut session = session_three();
        let capture = begin_focused(&mut session, "win-3");
        let preview = session.preview_drag(5, 40).expect("preview");
        // The proposed rect is the projected desired source rect, not a claim
        // that the target current rect alone is the preview.
        assert!(preview.proposed_rect.w > 0 && preview.proposed_rect.h > 0);
        assert!(contained(&preview.proposed_rect, &capture.work_area));
        let plan = drop_planned(&mut session, 5, 40, "corr-drag-1");
        let Some(final_rect) = plan
            .desired_geometry
            .iter()
            .find(|g| g.leaf == capture.source_leaf)
            .map(|g| g.rect)
        else {
            panic!("final geometry must cover the source");
        };
        assert_eq!(preview.proposed_rect, final_rect);
        assert_eq!(preview.target_leaf, plan.dispatch.operation.target_leaf);
        assert_eq!(preview.wrap, plan.dispatch.operation.wrap);
        assert_eq!(
            preview.insertion_index,
            plan.dispatch.operation.insertion_index
        );
        commit_drag(&mut session, &plan, "corr-drag-1");
    }

    #[test]
    fn drag_cosmic_window_zones_stack_center_and_edge_by_half_distance() {
        // COSMIC window zones via cosmic_v1: rounded thirds stack; other
        // locations select horizontal only on strict less (ties vertical).
        // Outside the rect yields None.
        let normal = Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 90,
        };
        assert_eq!(drag_edge_for(&normal, 60, 45), Some(DragSide::Center));
        assert_eq!(drag_edge_for(&normal, 5, 45), Some(DragSide::Left));
        assert_eq!(drag_edge_for(&normal, 115, 45), Some(DragSide::Right));
        assert_eq!(drag_edge_for(&normal, 60, 4), Some(DragSide::Top));
        assert_eq!(drag_edge_for(&normal, 60, 86), Some(DragSide::Bottom));
        assert_eq!(drag_edge_for(&normal, 200, 45), None);
        // Rounded thirds: 1px width has third 0 so the full width is middle;
        // 2px has third 1 with an empty middle, so edges win (ties vertical).
        let narrow = Rect {
            x: 10,
            y: 10,
            w: 1,
            h: 10,
        };
        assert_eq!(drag_edge_for(&narrow, 10, 15), Some(DragSide::Center));
        let tiny = Rect {
            x: 0,
            y: 0,
            w: 2,
            h: 2,
        };
        assert_eq!(drag_edge_for(&tiny, 0, 0), Some(DragSide::Top));
        assert_eq!(drag_edge_for(&tiny, 1, 1), Some(DragSide::Top));
        // Degenerate rects classify to nothing.
        let flat = Rect {
            x: 0,
            y: 0,
            w: 0,
            h: 10,
        };
        assert_eq!(drag_edge_for(&flat, 0, 5), None);
    }

    #[test]
    fn drag_flag_failures_refuse_consistently() {
        // Flagged source observation at begin refuses without staging.
        let mut session = session_two();
        let before = session.snapshot();
        let mut flagged = obs_for(&session);
        for entry in flagged.windows.iter_mut() {
            if entry.window.0 == "win-2" {
                entry.floating = true;
            }
        }
        assert!(matches!(
            session.begin_drag(&WindowId("win-2".to_owned()), &flagged),
            Err(ProposeError::Refused(_))
        ));
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(session.snapshot(), before);
        // Flagged observation at drop snaps back without diverging and clears
        // the capture.
        let mut session = session_two();
        let capture = begin_focused(&mut session, "win-2");
        let before = session.snapshot();
        let revision = session.accepted_revision();
        let mut flagged_drop = obs_for(&session);
        for entry in flagged_drop.windows.iter_mut() {
            if entry.window.0 == "win-2" {
                entry.floating = true;
            }
        }
        match session
            .drop_drag(
                10,
                5,
                &flagged_drop,
                &corr("corr-drag-1"),
                &DragCapabilities::full(),
            )
            .expect("flagged observation snaps back")
        {
            DragRelease::SnapBack(snap) => {
                assert_eq!(snap.source_rect, capture.source_rect);
            }
            DragRelease::Planned(_) => panic!("flagged observation must snap back"),
        }
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(session.snapshot(), before);
        assert_eq!(session.accepted_revision(), revision);
    }

    #[test]
    fn drag_malformed_observation_snaps_back() {
        let mut session = session_two();
        let capture = begin_focused(&mut session, "win-2");
        let before = session.snapshot();
        let revision = session.accepted_revision();
        let mut malformed = obs_for(&session);
        malformed.windows[0].window = WindowId(String::new());
        match session
            .drop_drag(
                10,
                5,
                &malformed,
                &corr("corr-drag-malformed"),
                &DragCapabilities::full(),
            )
            .expect("malformed observation snaps back")
        {
            DragRelease::SnapBack(snap) => {
                assert_eq!(snap.source_rect, capture.source_rect);
                assert_eq!(snap.source_leaf, capture.source_leaf);
                assert_eq!(snap.source_window, capture.source_window);
            }
            DragRelease::Planned(_) => panic!("malformed observation must snap back"),
        }
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(session.snapshot(), before);
        assert_eq!(session.accepted_revision(), revision);
    }

    #[test]
    fn drag_unsupported_capability_snaps_back() {
        let mut session = session_two();
        let capture = begin_focused(&mut session, "win-2");
        let before = session.snapshot();
        let revision = session.accepted_revision();
        match session
            .drop_drag(
                10,
                5,
                &obs_for(&session),
                &corr("corr-drag-nocap"),
                &DragCapabilities::none(),
            )
            .expect("unsupported capability snaps back")
        {
            DragRelease::SnapBack(snap) => {
                assert_eq!(snap.source_rect, capture.source_rect);
                assert_eq!(snap.source_leaf, capture.source_leaf);
                assert_eq!(snap.source_window, capture.source_window);
            }
            DragRelease::Planned(_) => panic!("unsupported capability must snap back"),
        }
        assert!(!session.has_drag());
        assert!(!session.has_pending());
        assert_eq!(session.snapshot(), before);
        assert_eq!(session.accepted_revision(), revision);
    }

    fn gap_domain() -> OutputDomain {
        OutputDomain {
            id: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 800,
                h: 600,
            },
            gap: 8,
            adjacent: BTreeMap::new(),
        }
    }

    fn gap_session_two() -> Session {
        let mut session =
            Session::new(owner(), generation(), 0, 7, vec![gap_domain()]).expect("new");
        admit(&mut session, "win-1", true);
        admit(&mut session, "win-2", true);
        session
    }

    fn gap_session_nested() -> Session {
        // Root H[win-1, V[win-2, win-3]] with gaps; focus win-1 for an
        // outside-group source. Admit win-3 vertical to nest under win-2.
        let mut session =
            Session::new(owner(), generation(), 0, 7, vec![gap_domain()]).expect("new");
        admit(&mut session, "win-1", true);
        admit(&mut session, "win-2", true);
        // Focus is win-2; admit win-3 tall to nest V[win-2, win-3].
        admit(&mut session, "win-3", false);
        // Refocus to win-1 as the outside source via focus moves.
        let key = domain_key();
        // Focus win-1 by moving focus left twice (deterministic project
        // fallback may vary; instead drive focus through movement commits).
        // Simpler: directly set authoritative focus in-test (same module).
        let leaf_win1 = session
            .windows
            .iter()
            .find(|(_, l)| l.window == WindowId("win-1".to_owned()))
            .map(|(_, l)| l.leaf.clone())
            .expect("win-1 leaf");
        session.focused_domain = Some(key);
        session.focused_leaf = Some(leaf_win1);
        session
    }

    fn leaf_rects_of(session: &Session) -> Vec<(NodeId, Rect)> {
        let key = domain_key();
        let tree = session
            .snapshot()
            .domains
            .into_iter()
            .find(|d| d.output == key.output && d.workspace == key.workspace)
            .and_then(|d| d.tree)
            .expect("tree");
        let domain = gap_domain();
        crate::geometry::project(&tree, domain.bounds, domain.gap)
            .expect("project")
            .into_iter()
            .map(|l| (l.leaf, l.rect))
            .collect()
    }

    fn inner_v_layout(session: &Session) -> (GroupLayout, BTreeMap<NodeId, Rect>) {
        let key = domain_key();
        let tree = session
            .snapshot()
            .domains
            .into_iter()
            .find(|d| d.output == key.output && d.workspace == key.workspace)
            .and_then(|d| d.tree)
            .expect("tree");
        let domain = gap_domain();
        let projected =
            crate::geometry::project(&tree, domain.bounds, domain.gap).expect("project");
        let mut leaf_map = BTreeMap::new();
        for l in &projected {
            leaf_map.insert(l.leaf.clone(), l.rect);
        }
        let layouts = drag_group_layouts(&tree, &leaf_map);
        let inner = layouts
            .iter()
            .find(|l| l.axis == Axis::Vertical)
            .expect("inner V group");
        // Clone minimal data (GroupLayout is private; return via tuple of owned values).
        (
            GroupLayout {
                id: inner.id.clone(),
                axis: inner.axis,
                rect: inner.rect,
                child_starts: inner.child_starts.clone(),
            },
            leaf_map,
        )
    }

    #[test]
    fn drag_group_interior_predecessor_agreement_and_invariants() {
        // Nested H[win-1, V[win-2, win-3]] with source win-1 outside the inner
        // V group: inner horizontal gap row at mid-height, away from edge
        // strips, is GroupInterior with source predecessor + min(len, idx+1).
        let mut session = gap_session_nested();
        assert_eq!(leaves_of(&session).len(), 3);
        let before_focus = session.focus();
        let (inner, leaf_map) = inner_v_layout(&session);
        let cx = inner.rect.x + inner.rect.w / 2;
        let mut gy_opt = None;
        for y in inner.rect.y..inner.rect.y + inner.rect.h {
            if !leaf_map.values().any(|r| contains_point(r, cx, y)) {
                // Outside 32px top/bottom strips => interior.
                if y - inner.rect.y >= 32 && inner.rect.y + inner.rect.h - y > 32 {
                    gy_opt = Some(y);
                    break;
                }
            }
        }
        let gy = gy_opt.expect("inner interior gap point");
        let gx = cx;
        let _capture = begin_focused(&mut session, "win-1");
        let preview = session
            .preview_drag(gx, gy)
            .expect("group interior preview");
        assert_eq!(preview.axis, Axis::Vertical);
        assert!(!preview.wrap);
        assert_eq!(preview.target_leaf, inner.id);
        // Predecessor from ordered child starts plus min(len, idx+1).
        let predecessor =
            crate::cosmic_v1::insertion_index_for_offset(&inner.child_starts, i64::from(gy));
        // Post-removal inner len stays 2 (source outside), so slot is min(2, pred+1).
        assert_eq!(preview.insertion_index, 2.min(predecessor + 1));
        let plan = drop_planned(&mut session, gx, gy, "corr-group-interior");
        assert_eq!(preview.target_leaf, plan.dispatch.operation.target_leaf);
        assert_eq!(preview.target_group, plan.dispatch.operation.target_group);
        assert_eq!(
            preview.insertion_index,
            plan.dispatch.operation.insertion_index
        );
        assert_eq!(preview.wrap, plan.dispatch.operation.wrap);
        assert_eq!(
            (
                Some(plan.desired_focus_domain.clone()),
                Some(plan.desired_focus_leaf.clone())
            ),
            before_focus
        );
        for domain in &plan.desired_snapshot.domains {
            if let Some(tree) = &domain.tree {
                let mut seen = BTreeSet::new();
                assert!(validate_node_shares(tree, &mut seen));
            }
        }
        assert!(geometry_covers_affected(
            &plan.desired_geometry,
            &session.windows,
            std::slice::from_ref(&domain_key()),
        ));
        commit_drag(&mut session, &plan, "corr-group-interior");
        assert_eq!(session.focus(), before_focus);
    }

    #[test]
    fn drag_group_edge_perpendicular_wraps_and_sticky_prior() {
        // Inner V group: left-strip (32px) gap-row point is GroupEdge Left
        // (axis Horizontal, perpendicular to inner Vertical) and wraps.
        let mut session = gap_session_nested();
        let (inner, leaf_map) = inner_v_layout(&session);
        let cx = inner.rect.x + inner.rect.w / 2;
        let mut gy_opt = None;
        for y in inner.rect.y..inner.rect.y + inner.rect.h {
            if !leaf_map.values().any(|r| contains_point(r, cx, y)) {
                gy_opt = Some(y);
                break;
            }
        }
        let gy = gy_opt.expect("inner gap row");
        let gx = inner.rect.x + 5;
        assert!(
            !leaf_map.values().any(|r| contains_point(r, gx, gy)),
            "left-strip gap point must be group-only"
        );
        let _capture = begin_focused(&mut session, "win-1");
        let preview = session.preview_drag(gx, gy).expect("group edge preview");
        assert_eq!(preview.side, DragSide::Left);
        assert_eq!(preview.axis, Axis::Horizontal);
        assert!(preview.wrap);
        assert_eq!(preview.target_leaf, inner.id);
        // Sticky prior: the same gap row 50px right of the left edge is
        // outside the normal 32px strip but the prior is a different edge
        // now (Left), so a top-strip check is not applicable; instead verify
        // the prior persists by re-hitting the same edge further along the row.
        let sticky = session
            .preview_drag(gx, gy + 2)
            .expect("sticky edge preview");
        assert_eq!(sticky.side, DragSide::Left);
        assert_eq!(sticky.target_leaf, preview.target_leaf);
        let plan = drop_planned(&mut session, gx, gy + 2, "corr-group-edge");
        assert_eq!(sticky.target_leaf, plan.dispatch.operation.target_leaf);
        assert_eq!(sticky.wrap, plan.dispatch.operation.wrap);
        assert_eq!(
            sticky.insertion_index,
            plan.dispatch.operation.insertion_index
        );
        commit_drag(&mut session, &plan, "corr-group-edge");
    }

    #[test]
    fn drag_group_edge_same_axis_nary_first_last_placement() {
        // Direct placement: N-ary H group [a,b,c], mover outside. Left inserts
        // first, Right inserts last, via proportional shares.
        let group = Node::Group {
            id: NodeId("g".to_owned()),
            axis: Axis::Horizontal,
            children: vec![
                Node::Leaf {
                    id: NodeId("a".to_owned()),
                },
                Node::Leaf {
                    id: NodeId("b".to_owned()),
                },
                Node::Leaf {
                    id: NodeId("c".to_owned()),
                },
            ],
            shares: vec![1, 1, 1],
        };
        let tree = Node::Group {
            id: NodeId("root".to_owned()),
            axis: Axis::Vertical,
            children: vec![
                group,
                Node::Leaf {
                    id: NodeId("m".to_owned()),
                },
            ],
            shares: vec![1, 1],
        };
        let left = apply_group_edge_placement(
            &tree,
            &NodeId("m".to_owned()),
            &NodeId("g".to_owned()),
            DragSide::Left,
            9,
        )
        .expect("left placement");
        assert!(!left.wrap);
        assert_eq!(left.target_group, NodeId("g".to_owned()));
        assert_eq!(left.insertion_index, 0);
        assert!(left.new_group.is_none());
        let right = apply_group_edge_placement(
            &tree,
            &NodeId("m".to_owned()),
            &NodeId("g".to_owned()),
            DragSide::Right,
            9,
        )
        .expect("right placement");
        assert!(!right.wrap);
        assert_eq!(right.target_group, NodeId("g".to_owned()));
        assert_eq!(right.insertion_index, 3);
        // Perpendicular Top wraps the whole group.
        let top = apply_group_edge_placement(
            &tree,
            &NodeId("m".to_owned()),
            &NodeId("g".to_owned()),
            DragSide::Top,
            9,
        )
        .expect("top placement");
        assert!(top.wrap);
        assert!(top.new_group.is_some());
        // Interior predecessor 0 gives min(3,1)=1 after removing an outside
        // mover (len stays 3).
        let interior = apply_group_interior_placement(
            &tree,
            &NodeId("m".to_owned()),
            &NodeId("g".to_owned()),
            0,
            9,
        )
        .expect("interior placement");
        assert!(!interior.wrap);
        assert_eq!(interior.target_group, NodeId("g".to_owned()));
        assert_eq!(interior.insertion_index, 1);
    }

    #[test]
    fn drag_group_stale_capture_rejects_and_center_unsupported() {
        let mut session = gap_session_two();
        let _capture = begin_focused(&mut session, "win-2");
        // Stale focus drift fails closed: preview refuses, drop snaps back.
        session.focused_leaf = Some(NodeId("leaf-win-1".to_owned()));
        assert_eq!(
            session.preview_drag(400, 300),
            Err(ProposeError::Refused(RefusalKind::MalformedTopology))
        );
        match session
            .drop_drag(
                400,
                300,
                &obs_for(&session),
                &corr("corr-stale"),
                &DragCapabilities::full(),
            )
            .expect("stale snaps back")
        {
            DragRelease::SnapBack(_) => {}
            DragRelease::Planned(_) => panic!("stale must snap back"),
        }
        assert!(!session.has_drag());
        // Fresh capture: window center is explicit unsupported with no plan.
        let mut session = gap_session_two();
        let _capture = begin_focused(&mut session, "win-2");
        let rects = leaf_rects_of(&session);
        let (_, first) = rects.first().expect("leaf");
        let cx = first.x + first.w / 2;
        let cy = first.y + first.h / 2;
        // Center of win-1 (non-source) names the stack fact.
        assert_eq!(
            session.preview_drag(cx, cy),
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
        );
        assert!(!session.has_pending());
        assert!(session.has_drag());
        session.cancel_drag();
    }

    #[test]
    fn drag_failed_center_preview_clears_group_edge_stickiness() {
        let mut session = gap_session_nested();
        let before = session.snapshot();
        let revision = session.accepted_revision();
        let (inner, leaf_map) = inner_v_layout(&session);
        let cx = inner.rect.x + inner.rect.w / 2;
        let mut gy_opt = None;
        for y in inner.rect.y..inner.rect.y + inner.rect.h {
            if !leaf_map.values().any(|r| contains_point(r, cx, y))
                && y - inner.rect.y >= 32
                && inner.rect.y + inner.rect.h - y > 32
            {
                gy_opt = Some(y);
                break;
            }
        }
        let gy = gy_opt.expect("inner interior gap point");
        let gx = inner.rect.x + 5;
        assert!(
            !leaf_map.values().any(|r| contains_point(r, gx, gy)),
            "left-strip gap point must be group-only"
        );
        let _capture = begin_focused(&mut session, "win-1");
        let edge = session.preview_drag(gx, gy).expect("group edge preview");
        assert_eq!(edge.side, DragSide::Left);
        assert_eq!(edge.target_leaf, inner.id);
        let rects = leaf_rects_of(&session);
        let source_leaf = session
            .windows
            .iter()
            .find(|(_, l)| l.window == WindowId("win-1".to_owned()))
            .map(|(_, l)| l.leaf.clone())
            .expect("win-1 leaf");
        let (_, target_rect) = rects
            .iter()
            .find(|(id, _)| *id != source_leaf)
            .expect("non-source leaf");
        let center_x = target_rect.x + target_rect.w / 2;
        let center_y = target_rect.y + target_rect.h / 2;
        assert_eq!(
            session.preview_drag(center_x, center_y),
            Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
        );
        let sticky_x = inner.rect.x + 50;
        assert!(
            contains_point(&inner.rect, sticky_x, gy),
            "sticky probe must stay inside the group"
        );
        assert!(
            !leaf_map.values().any(|r| contains_point(r, sticky_x, gy)),
            "sticky probe must be group-only"
        );
        assert_eq!(
            crate::cosmic_v1::classify_group_point(
                &inner.rect,
                &inner.id,
                sticky_x,
                gy,
                Some(&crate::cosmic_v1::PriorGroupEdge {
                    group: inner.id.clone(),
                    edge: DragSide::Left,
                }),
            ),
            Some(DragSide::Left)
        );
        assert_ne!(
            crate::cosmic_v1::classify_group_point(&inner.rect, &inner.id, sticky_x, gy, None),
            Some(DragSide::Left)
        );
        match session.preview_drag(sticky_x, gy) {
            Ok(preview) => assert_ne!(
                preview.side,
                DragSide::Left,
                "cleared prior must not resolve via sticky 80"
            ),
            Err(ProposeError::Refused(_)) => {}
            Err(other) => panic!("unexpected preview result: {other:?}"),
        }
        assert_eq!(session.snapshot(), before);
        assert!(!session.has_pending());
        assert!(!session.has_pending_desired());
        assert!(session.has_drag());
        assert_eq!(session.accepted_revision(), revision);
        session.cancel_drag();
    }
}
