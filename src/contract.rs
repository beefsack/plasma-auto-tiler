//! Production transport-independent adapter contract.
//!
//! Portable boundary: bounded opaque ids, immutable normalized observations,
//! transport-neutral dispatch payloads, adapter acknowledgements, and typed
//! divergence. No platform, process, IPC, geometry, or native execution
//! imports; only [`crate::directional`] semantic types.
//!
//! Sealed/versioned policy note: the planning policy itself stays frozen as
//! POC1 evidence in [`crate::directional`] and [`crate::planner_contract`];
//! those modules are conformance evidence and are not re-abstracted here.
//! [`CONTRACT_VERSION`] pins this adapter envelope; [`POLICY_VERSION`] pins
//! the POC1 policy it carries plans from.
//!
//! Error discipline: validators return `bool` and reconciler errors carry
//! only typed [`DivergenceKind`] variants with fixed redacted messages. Input
//! ids are never echoed and no unbounded allocations are made from adapter
//! input (all id lengths are bounded; precondition vectors are capped).

use crate::directional::{
    Capability, Direction, MoveIntent, MoveOperation, NodeId, OutputId, Precondition, Rule,
    WindowId, WorkspaceId,
};
use crate::ids::{CorrelationId, GenerationId, OwnerId};

/// Adapter envelope version.
pub const CONTRACT_VERSION: u32 = 1;
/// Sealed POC1 planning policy version carried by plans.
pub const POLICY_VERSION: u32 = 1;
/// Portable session lifecycle policy version (`cosmic_v1`).
///
/// The session lifecycle foundation in [`crate::session`] is versioned
/// `cosmic_v1`. Placement fallback inside the session (append after the last
/// root child or nest when there is no eligible focus) is project-selected
/// and makes no source COSMIC parity claim. Frozen R1-R4 movement
/// APIs/fixtures are unaffected; this binds lifecycle plans/dispatch only.
pub const LIFECYCLE_POLICY_VERSION: u32 = 1;
/// Opaque correlation token bound (shared with [`crate::ids`]).
pub use crate::ids::MAX_CORRELATION_LEN;
/// Opaque generation bound (shared with [`crate::ids`]).
pub use crate::ids::MAX_GENERATION_LEN;
/// Opaque owner token bound (shared with [`crate::ids`]).
pub use crate::ids::MAX_OWNER_LEN;
pub use crate::ids::{is_correlation_id, is_generation_id, is_owner_id};
/// Revision bound (inclusive), shared with planner/POC3 bounds.
pub const MAX_REVISION: u64 = 1_000_000;
/// Precondition vector cap (directional plans carry at most a handful).
pub const MAX_PRECONDITIONS: usize = 8;

/// Revision validity.
#[must_use]
pub const fn is_revision(value: u64) -> bool {
    value <= MAX_REVISION
}

/// Immutable normalized adapter observation.
///
/// `fingerprint` is an opaque adapter-computed hash of the normalized
/// snapshot (transport-neutral `u64`, never interpreted here). The reconciler
/// binds proposals to `owner`/`generation`/`revision` and requires a fresh
/// re-observation at the same base revision after acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub revision: u64,
    pub fingerprint: u64,
}

impl Observation {
    /// Typed construction (ids already validated by [`OwnerId::parse`]).
    #[must_use]
    pub fn new(owner: OwnerId, generation: GenerationId, revision: u64, fingerprint: u64) -> Self {
        Self {
            owner,
            generation,
            revision,
            fingerprint,
        }
    }

    /// Narrow string boundary: parses session ids, checks the revision bound.
    #[must_use]
    pub fn from_strings(
        owner: &str,
        generation: &str,
        revision: u64,
        fingerprint: u64,
    ) -> Option<Self> {
        if !is_revision(revision) {
            return None;
        }
        Some(Self {
            owner: OwnerId::parse(owner)?,
            generation: GenerationId::parse(generation)?,
            revision,
            fingerprint,
        })
    }

    /// Validity without echoing input.
    #[must_use]
    pub fn validate(&self) -> bool {
        is_owner_id(self.owner.as_str())
            && is_generation_id(self.generation.as_str())
            && is_revision(self.revision)
    }
}

/// Transport-neutral dispatch payload emitted on a successful proposal.
/// Native execution is outside the reconciler; the adapter actuates from this.
/// `operation` carries the full semantic plan operation (structural ids only,
/// no geometry or native handles); `rule`/`required_capability`/`preconditions`
/// are the bound execution preconditions derived from it. `intent` is the
/// complete originating semantic intent copied from the source plan so a future
/// adapter can interpret the payload without retaining caller-side state.
/// `owner`/`generation`/`correlation_id`/`base_revision` form the
/// self-describing identity binding for the dispatched plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dispatch {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub required_capability: Capability,
    pub preconditions: Vec<Precondition>,
    pub rule: Rule,
    pub operation: MoveOperation,
    pub intent: MoveIntent,
}

/// Bounded adapter acknowledgement outcome. No free-form error detail: a
/// non-accepted outcome maps to a typed divergence without echo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AckOutcome {
    Accepted,
    RefusedCapability,
    PartialApplication,
    AdapterLost,
}

/// Explicit adapter acknowledgement of a dispatched plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterAck {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub outcome: AckOutcome,
}

impl AdapterAck {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        correlation_id: CorrelationId,
        owner: OwnerId,
        generation: GenerationId,
        base_revision: u64,
        outcome: AckOutcome,
    ) -> Self {
        Self {
            correlation_id,
            owner,
            generation,
            base_revision,
            outcome,
        }
    }

    /// Narrow string boundary: parses session ids without echo.
    #[must_use]
    pub fn from_strings(
        correlation_id: &str,
        owner: &str,
        generation: &str,
        base_revision: u64,
        outcome: AckOutcome,
    ) -> Option<Self> {
        if !is_revision(base_revision) {
            return None;
        }
        Some(Self {
            correlation_id: CorrelationId::parse(correlation_id)?,
            owner: OwnerId::parse(owner)?,
            generation: GenerationId::parse(generation)?,
            base_revision,
            outcome,
        })
    }

    /// Validity without echoing input.
    #[must_use]
    pub fn validate(&self) -> bool {
        is_correlation_id(self.correlation_id.as_str())
            && is_owner_id(self.owner.as_str())
            && is_generation_id(self.generation.as_str())
            && is_revision(self.base_revision)
    }
}

/// Fresh post-observation plus explicit native verification flag. The adapter
/// sets `verified` only after natively verifying plan postconditions, and
/// reports the exact verified precondition vector in `verified_preconditions`
/// plus the exact verified operation in `verified_operation`. The reconciler
/// binds the vector exactly to the dispatched preconditions (capped by
/// [`MAX_PRECONDITIONS`]) and the operation exactly to the dispatched
/// semantic operation; any mismatch diverges as
/// [`DivergenceKind::PostconditionMismatch`] with no commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostObservation {
    pub observation: Observation,
    pub correlation_id: CorrelationId,
    pub verified: bool,
    pub verified_preconditions: Vec<Precondition>,
    pub verified_operation: MoveOperation,
}

impl PostObservation {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        observation: Observation,
        correlation_id: CorrelationId,
        verified: bool,
        verified_preconditions: Vec<Precondition>,
        verified_operation: MoveOperation,
    ) -> Self {
        Self {
            observation,
            correlation_id,
            verified,
            verified_preconditions,
            verified_operation,
        }
    }

    /// Validity without echoing input (observation plus correlation shape and
    /// bounded precondition vector).
    #[must_use]
    pub fn validate(&self) -> bool {
        self.observation.validate()
            && is_correlation_id(self.correlation_id.as_str())
            && self.verified_preconditions.len() <= MAX_PRECONDITIONS
    }
}

/// Typed fail-closed divergence reasons. Fixed redacted messages only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DivergenceKind {
    StaleRevision,
    OwnerMismatch,
    GenerationMismatch,
    CorrelationMismatch,
    CapabilityRefused,
    PartialApplication,
    AdapterLost,
    PostconditionUnverified,
    PostconditionMismatch,
    RevisionExhausted,
}

impl DivergenceKind {
    /// Stable kind string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StaleRevision => "stale-revision",
            Self::OwnerMismatch => "owner-mismatch",
            Self::GenerationMismatch => "generation-mismatch",
            Self::CorrelationMismatch => "correlation-mismatch",
            Self::CapabilityRefused => "capability-refused",
            Self::PartialApplication => "partial-application",
            Self::AdapterLost => "adapter-lost",
            Self::PostconditionUnverified => "postcondition-unverified",
            Self::PostconditionMismatch => "postcondition-mismatch",
            Self::RevisionExhausted => "revision-exhausted",
        }
    }

    /// Fixed redacted message; never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::StaleRevision => "observation revision does not match verified state",
            Self::OwnerMismatch => "owner token does not pin verified state",
            Self::GenerationMismatch => "generation does not match verified state",
            Self::CorrelationMismatch => "correlation does not match the pending plan",
            Self::CapabilityRefused => "adapter cannot realize the required capability",
            Self::PartialApplication => "adapter reported partial application",
            Self::AdapterLost => "adapter contact was lost",
            Self::PostconditionUnverified => "adapter did not verify postconditions",
            Self::PostconditionMismatch => "plan postconditions do not bind the pending plan",
            Self::RevisionExhausted => "revision bound reached",
        }
    }
}

/// Adapter-facing lifecycle capability required to realize one lifecycle
/// operation. Separate from [`Capability`] movement capabilities so the frozen
/// R1-R4 movement surface stays unchanged; lifecycle admission and removal
/// each gate on their own explicit capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LifecycleCapability {
    AdmitTiled,
    RemoveTiled,
}

impl LifecycleCapability {
    /// Stable kind string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AdmitTiled => "admit-tiled",
            Self::RemoveTiled => "remove-tiled",
        }
    }
}

/// Adapter-declared lifecycle capabilities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleCapabilities {
    pub admit_tiled: bool,
    pub remove_tiled: bool,
}

impl LifecycleCapabilities {
    /// All lifecycle capabilities declared.
    #[must_use]
    pub const fn full() -> Self {
        Self {
            admit_tiled: true,
            remove_tiled: true,
        }
    }

    /// None declared.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            admit_tiled: false,
            remove_tiled: false,
        }
    }

    /// Whether `capability` is declared.
    #[must_use]
    pub const fn supports(&self, capability: LifecycleCapability) -> bool {
        match capability {
            LifecycleCapability::AdmitTiled => self.admit_tiled,
            LifecycleCapability::RemoveTiled => self.remove_tiled,
        }
    }
}

/// Explicit preconditions the adapter must hold/verify to realize a lifecycle
/// plan. `AdapterMustVerifyPostconditions` is present on every lifecycle plan,
/// mirroring movement plans: realization is never assumed atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LifecyclePrecondition {
    WindowObserved,
    DesiredTopologyValid,
    AdapterMustVerifyPostconditions,
}

/// Semantic lifecycle intent: admit a window into an output/workspace domain
/// or remove a window from the session. Structural resolution (leaf identity,
/// deferred exception handling) lives in [`LifecycleOperation`]; the intent
/// records the originating request so a plan can be interpreted without
/// retaining caller-side state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleIntent {
    Admit {
        window: WindowId,
        output: OutputId,
        workspace: WorkspaceId,
    },
    Remove {
        window: WindowId,
    },
}

/// Structural lifecycle operation with fully resolved portable identities.
/// Tiled variants name the affected leaf; deferred variants track an observed
/// exception window with no topology effect. No geometry or native handles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleOperation {
    Admit {
        window: WindowId,
        leaf: NodeId,
        output: OutputId,
        workspace: WorkspaceId,
    },
    AdmitDeferred {
        window: WindowId,
        output: OutputId,
        workspace: WorkspaceId,
    },
    Remove {
        window: WindowId,
        leaf: NodeId,
        output: OutputId,
        workspace: WorkspaceId,
    },
    RemoveDeferred {
        window: WindowId,
        output: OutputId,
        workspace: WorkspaceId,
    },
}

impl LifecycleOperation {
    /// Adapter-facing capability required before emission.
    #[must_use]
    pub const fn required_capability(&self) -> LifecycleCapability {
        match self {
            Self::Admit { .. } | Self::AdmitDeferred { .. } => LifecycleCapability::AdmitTiled,
            Self::Remove { .. } | Self::RemoveDeferred { .. } => LifecycleCapability::RemoveTiled,
        }
    }

    /// Explicit preconditions for realization (always terminated by
    /// [`LifecyclePrecondition::AdapterMustVerifyPostconditions`]).
    #[must_use]
    pub fn preconditions(&self) -> Vec<LifecyclePrecondition> {
        vec![
            LifecyclePrecondition::WindowObserved,
            LifecyclePrecondition::DesiredTopologyValid,
            LifecyclePrecondition::AdapterMustVerifyPostconditions,
        ]
    }

    /// Affected window, if any.
    #[must_use]
    pub fn window(&self) -> &WindowId {
        match self {
            Self::Admit { window, .. }
            | Self::AdmitDeferred { window, .. }
            | Self::Remove { window, .. }
            | Self::RemoveDeferred { window, .. } => window,
        }
    }
}

/// Deterministic lifecycle plan with explicit capability and preconditions.
/// Self-contained: `intent` records the originating semantic intent.
/// `policy_version` binds the plan to [`LIFECYCLE_POLICY_VERSION`]
/// (`cosmic_v1` lifecycle policy); the reconciler rejects any other version
/// without affecting frozen R1-R4 movement plans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecyclePlan {
    pub intent: LifecycleIntent,
    pub operation: LifecycleOperation,
    pub required_capability: LifecycleCapability,
    pub preconditions: Vec<LifecyclePrecondition>,
    pub policy_version: u32,
}

impl LifecyclePlan {
    /// Construct from an intent and a resolved operation, deriving capability
    /// and preconditions deterministically.
    #[must_use]
    pub fn for_operation(intent: LifecycleIntent, operation: LifecycleOperation) -> Self {
        let required_capability = operation.required_capability();
        let preconditions = operation.preconditions();
        Self {
            intent,
            operation,
            required_capability,
            preconditions,
            policy_version: LIFECYCLE_POLICY_VERSION,
        }
    }

    /// Validity of the portable lifecycle policy binding.
    #[must_use]
    pub const fn valid_policy(&self) -> bool {
        self.policy_version == LIFECYCLE_POLICY_VERSION
    }
}

/// Transport-neutral lifecycle dispatch payload emitted on a successful
/// lifecycle proposal. Mirrors [`Dispatch`] identity binding
/// (owner/generation/correlation/base revision) plus the complete semantic
/// lifecycle plan. Desired topology/focus/geometry are carried by the session
/// layer (`crate::session`) so this envelope stays geometry-free like
/// [`Dispatch`]; native execution stays outside the reconciler.
/// `policy_version` echoes the plan binding ([`LIFECYCLE_POLICY_VERSION`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleDispatch {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub required_capability: LifecycleCapability,
    pub preconditions: Vec<LifecyclePrecondition>,
    pub intent: LifecycleIntent,
    pub operation: LifecycleOperation,
    pub policy_version: u32,
}

/// Fresh post-observation plus explicit native verification flag for a pending
/// lifecycle plan. Binds exactly like [`PostObservation`]: the reported
/// `verified_preconditions` must equal the dispatched preconditions (capped by
/// [`MAX_PRECONDITIONS`]) and `verified_operation` must equal the dispatched
/// lifecycle operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecyclePostObservation {
    pub observation: Observation,
    pub correlation_id: CorrelationId,
    pub verified: bool,
    pub verified_preconditions: Vec<LifecyclePrecondition>,
    pub verified_operation: LifecycleOperation,
}

impl LifecyclePostObservation {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        observation: Observation,
        correlation_id: CorrelationId,
        verified: bool,
        verified_preconditions: Vec<LifecyclePrecondition>,
        verified_operation: LifecycleOperation,
    ) -> Self {
        Self {
            observation,
            correlation_id,
            verified,
            verified_preconditions,
            verified_operation,
        }
    }

    /// Validity without echoing input (observation plus correlation shape and
    /// bounded precondition vector).
    #[must_use]
    pub fn validate(&self) -> bool {
        self.observation.validate()
            && is_correlation_id(self.correlation_id.as_str())
            && self.verified_preconditions.len() <= MAX_PRECONDITIONS
    }
}

/// Adapter-facing focus capability required to realize a focus plan.
/// Separate from movement [`Capability`] and lifecycle [`LifecycleCapability`]
/// so frozen R1-R4 movement types are never misused for focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FocusCapability {
    DirectionalFocus,
}

impl FocusCapability {
    /// Stable kind string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DirectionalFocus => "directional-focus",
        }
    }
}

/// Adapter-declared focus capabilities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusCapabilities {
    pub directional_focus: bool,
}

impl FocusCapabilities {
    /// All focus capabilities declared.
    #[must_use]
    pub const fn full() -> Self {
        Self {
            directional_focus: true,
        }
    }

    /// None declared.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            directional_focus: false,
        }
    }

    /// Whether `capability` is declared.
    #[must_use]
    pub const fn supports(&self, capability: FocusCapability) -> bool {
        match capability {
            FocusCapability::DirectionalFocus => self.directional_focus,
        }
    }
}

/// Explicit preconditions the adapter must hold/verify to realize a focus
/// plan. `AdapterMustVerifyPostconditions` is present on every focus plan,
/// mirroring movement/lifecycle plans: realization is never assumed atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FocusPrecondition {
    FocusedLeafOccupiedByFocusedWindow,
    TargetLeafOccupied,
    FocusTargetsSameDomain,
    AdapterMustVerifyPostconditions,
}

/// Semantic focus intent: directional navigation from the focused leaf in one
/// exact logical domain. Records the originating request so a plan can be
/// interpreted without retaining caller-side state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusIntent {
    pub domain_output: OutputId,
    pub domain_workspace: WorkspaceId,
    pub focused_leaf: NodeId,
    pub focused_window: WindowId,
    pub direction: Direction,
}

/// Structural focus operation with fully resolved portable identities.
/// Names the exact logical domain, the source and target leaves/windows, the
/// intentional direction, and the deterministic tree-relative `route` from the
/// directional planner (group-to-leaf descent, outermost first including the
/// target leaf). No geometry or native handles; desired topology is unmodified
/// and carried by the session layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusOperation {
    pub domain_output: OutputId,
    pub domain_workspace: WorkspaceId,
    pub from_leaf: NodeId,
    pub to_leaf: NodeId,
    pub from_window: WindowId,
    pub to_window: WindowId,
    pub direction: Direction,
    pub route: Vec<NodeId>,
}

impl FocusOperation {
    /// Adapter-facing capability required before emission.
    #[must_use]
    pub const fn required_capability(&self) -> FocusCapability {
        FocusCapability::DirectionalFocus
    }

    /// Explicit preconditions for realization (always terminated by
    /// [`FocusPrecondition::AdapterMustVerifyPostconditions`]).
    #[must_use]
    pub fn preconditions(&self) -> Vec<FocusPrecondition> {
        vec![
            FocusPrecondition::FocusedLeafOccupiedByFocusedWindow,
            FocusPrecondition::TargetLeafOccupied,
            FocusPrecondition::FocusTargetsSameDomain,
            FocusPrecondition::AdapterMustVerifyPostconditions,
        ]
    }
}

/// Deterministic focus plan with explicit capability and preconditions.
/// Self-contained: `intent` records the originating semantic intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusPlanContract {
    pub intent: FocusIntent,
    pub operation: FocusOperation,
    pub required_capability: FocusCapability,
    pub preconditions: Vec<FocusPrecondition>,
}

impl FocusPlanContract {
    /// Construct from an intent and a resolved operation, deriving capability
    /// and preconditions deterministically.
    #[must_use]
    pub fn for_operation(intent: FocusIntent, operation: FocusOperation) -> Self {
        let required_capability = operation.required_capability();
        let preconditions = operation.preconditions();
        Self {
            intent,
            operation,
            required_capability,
            preconditions,
        }
    }
}

/// Transport-neutral focus dispatch payload emitted on a successful focus
/// proposal. Mirrors [`Dispatch`] identity binding
/// (owner/generation/correlation/base revision) plus the complete semantic
/// focus plan. Desired topology/focus/geometry are carried by the session
/// layer so this envelope stays geometry-free like [`Dispatch`]; native
/// execution stays outside the reconciler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusDispatch {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub required_capability: FocusCapability,
    pub preconditions: Vec<FocusPrecondition>,
    pub intent: FocusIntent,
    pub operation: FocusOperation,
}

/// Fresh post-observation plus explicit native verification flag for a pending
/// focus plan. Binds exactly like [`PostObservation`]: the reported
/// `verified_preconditions` must equal the dispatched preconditions (capped by
/// [`MAX_PRECONDITIONS`]) and `verified_operation` must equal the dispatched
/// focus operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusPostObservation {
    pub observation: Observation,
    pub correlation_id: CorrelationId,
    pub verified: bool,
    pub verified_preconditions: Vec<FocusPrecondition>,
    pub verified_operation: FocusOperation,
}

impl FocusPostObservation {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        observation: Observation,
        correlation_id: CorrelationId,
        verified: bool,
        verified_preconditions: Vec<FocusPrecondition>,
        verified_operation: FocusOperation,
    ) -> Self {
        Self {
            observation,
            correlation_id,
            verified,
            verified_preconditions,
            verified_operation,
        }
    }

    /// Validity without echoing input (observation plus correlation shape and
    /// bounded precondition vector).
    #[must_use]
    pub fn validate(&self) -> bool {
        self.observation.validate()
            && is_correlation_id(self.correlation_id.as_str())
            && self.verified_preconditions.len() <= MAX_PRECONDITIONS
    }
}

/// Adapter-facing resize capability required to realize a keyboard split-share
/// resize plan. Separate from movement [`Capability`], lifecycle
/// [`LifecycleCapability`], and focus [`FocusCapability`] so frozen movement
/// behavior is never misused for resize.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResizeCapability {
    KeyboardResize,
}

impl ResizeCapability {
    /// Stable kind string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::KeyboardResize => "keyboard-resize",
        }
    }
}

/// Adapter-declared resize capabilities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizeCapabilities {
    pub keyboard_resize: bool,
}

impl ResizeCapabilities {
    /// All resize capabilities declared.
    #[must_use]
    pub const fn full() -> Self {
        Self {
            keyboard_resize: true,
        }
    }

    /// None declared.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            keyboard_resize: false,
        }
    }

    /// Whether `capability` is declared.
    #[must_use]
    pub const fn supports(&self, capability: ResizeCapability) -> bool {
        match capability {
            ResizeCapability::KeyboardResize => self.keyboard_resize,
        }
    }
}

/// Explicit preconditions the adapter must hold/verify to realize a resize
/// plan. `AdapterMustVerifyPostconditions` is present on every resize plan,
/// mirroring movement/lifecycle/focus plans: realization is never assumed
/// atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResizePrecondition {
    FocusedLeafOccupiedByFocusedWindow,
    TargetBoundaryValid,
    ResizeTargetsSameDomain,
    AdapterMustVerifyPostconditions,
}

/// Semantic resize intent: keyboard split-share resize from the focused leaf
/// in one exact logical domain toward `direction`. Records the originating
/// request so a plan can be interpreted without retaining caller-side state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizeIntent {
    pub domain_output: OutputId,
    pub domain_workspace: WorkspaceId,
    pub focused_leaf: NodeId,
    pub focused_window: WindowId,
    pub direction: Direction,
}

/// Structural resize operation with fully resolved portable identities.
///
/// Names the exact logical domain, the focused leaf/window, the intentional
/// direction, the stable target split (`target_group`) plus the selected
/// adjacent pair (`focused_child`/`neighbor_child` with their group indices),
/// and the full selected-group share vectors before (`old_shares`) and after
/// (`new_shares`). Only the two selected shares change (plus an exact x16
/// ratio-preserving normalization of the whole group when the pair total is
/// not divisible by 16); topology/order/descendants are unchanged. No geometry
/// or native handles; desired topology/geometry are carried by the session
/// layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizeOperation {
    pub domain_output: OutputId,
    pub domain_workspace: WorkspaceId,
    pub focused_leaf: NodeId,
    pub focused_window: WindowId,
    pub direction: Direction,
    pub target_group: NodeId,
    pub focused_child: NodeId,
    pub neighbor_child: NodeId,
    pub focused_index: usize,
    pub neighbor_index: usize,
    pub old_shares: Vec<u64>,
    pub new_shares: Vec<u64>,
}

impl ResizeOperation {
    /// Adapter-facing capability required before emission.
    #[must_use]
    pub const fn required_capability(&self) -> ResizeCapability {
        ResizeCapability::KeyboardResize
    }

    /// Explicit preconditions for realization (always terminated by
    /// [`ResizePrecondition::AdapterMustVerifyPostconditions`]).
    #[must_use]
    pub fn preconditions(&self) -> Vec<ResizePrecondition> {
        vec![
            ResizePrecondition::FocusedLeafOccupiedByFocusedWindow,
            ResizePrecondition::TargetBoundaryValid,
            ResizePrecondition::ResizeTargetsSameDomain,
            ResizePrecondition::AdapterMustVerifyPostconditions,
        ]
    }
}

/// Deterministic resize plan with explicit capability and preconditions.
/// Self-contained: `intent` records the originating semantic intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizePlan {
    pub intent: ResizeIntent,
    pub operation: ResizeOperation,
    pub required_capability: ResizeCapability,
    pub preconditions: Vec<ResizePrecondition>,
}

impl ResizePlan {
    /// Construct from an intent and a resolved operation, deriving capability
    /// and preconditions deterministically.
    #[must_use]
    pub fn for_operation(intent: ResizeIntent, operation: ResizeOperation) -> Self {
        let required_capability = operation.required_capability();
        let preconditions = operation.preconditions();
        Self {
            intent,
            operation,
            required_capability,
            preconditions,
        }
    }
}

/// Transport-neutral resize dispatch payload emitted on a successful resize
/// proposal. Mirrors [`Dispatch`] identity binding
/// (owner/generation/correlation/base revision) plus the complete semantic
/// resize plan. Desired topology/focus/geometry are carried by the session
/// layer so this envelope stays geometry-free like [`Dispatch`]; native
/// execution stays outside the reconciler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizeDispatch {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub required_capability: ResizeCapability,
    pub preconditions: Vec<ResizePrecondition>,
    pub intent: ResizeIntent,
    pub operation: ResizeOperation,
}

/// Fresh post-observation plus explicit native verification flag for a pending
/// resize plan. Binds exactly like [`PostObservation`]: the reported
/// `verified_preconditions` must equal the dispatched preconditions (capped by
/// [`MAX_PRECONDITIONS`]) and `verified_operation` must equal the dispatched
/// resize operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizePostObservation {
    pub observation: Observation,
    pub correlation_id: CorrelationId,
    pub verified: bool,
    pub verified_preconditions: Vec<ResizePrecondition>,
    pub verified_operation: ResizeOperation,
}

impl ResizePostObservation {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        observation: Observation,
        correlation_id: CorrelationId,
        verified: bool,
        verified_preconditions: Vec<ResizePrecondition>,
        verified_operation: ResizeOperation,
    ) -> Self {
        Self {
            observation,
            correlation_id,
            verified,
            verified_preconditions,
            verified_operation,
        }
    }

    /// Validity without echoing input (observation plus correlation shape and
    /// bounded precondition vector).
    #[must_use]
    pub fn validate(&self) -> bool {
        self.observation.validate()
            && is_correlation_id(self.correlation_id.as_str())
            && self.verified_preconditions.len() <= MAX_PRECONDITIONS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_bounds_reject_without_echo() {
        assert!(is_owner_id("owner-1"));
        assert!(!is_owner_id(""));
        assert!(!is_owner_id("bad id"));
        assert!(!is_owner_id(&"x".repeat(MAX_OWNER_LEN + 1)));
        assert!(is_generation_id("gen-1"));
        assert!(!is_generation_id("GEN-1"));
        assert!(!is_generation_id(""));
        assert!(is_correlation_id("corr-1"));
        assert!(!is_correlation_id(""));
        assert!(is_revision(MAX_REVISION));
        assert!(!is_revision(MAX_REVISION + 1));
    }

    #[test]
    fn observation_validation_is_typed() {
        let good = Observation::from_strings("owner-1", "gen-1", 0, 7).expect("valid");
        assert!(good.validate());
        assert!(Observation::from_strings("bad owner", "gen-1", 0, 7).is_none());
        assert!(Observation::from_strings("owner-1", "gen-1", MAX_REVISION + 1, 7).is_none());
        assert!(
            AdapterAck::from_strings(
                "corr-1",
                "owner-1",
                "gen-1",
                MAX_REVISION + 1,
                AckOutcome::Accepted,
            )
            .is_none()
        );
        assert!(OwnerId::parse("bad owner").is_none());
    }

    #[test]
    fn divergence_messages_are_fixed() {
        assert_eq!(
            DivergenceKind::StaleRevision.message(),
            "observation revision does not match verified state"
        );
        assert!(!DivergenceKind::OwnerMismatch.message().contains("owner-1"));
    }
}
