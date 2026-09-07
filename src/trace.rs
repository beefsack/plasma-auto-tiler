//! Stage 3 portable observation-trace envelope (V1) + deterministic offline replay.
//!
//! V1 JSON envelope: `v`, bounded `meta` (including `policy_version`),
//! session-scoped opaque `owner`/`generation`, an `initial_observation`, a
//! bounded ordered `events` list, and an assertion-only `expected` terminal.
//! Replay derives every dispatch from the production planner
//! ([`crate::directional::plan_move_with_capabilities`]) and feeds it to the
//! production [`crate::reconcile::Reconciler`]; trace `plan` assertions are
//! compared to that real dispatch and `expected` is only compared after
//! execution, never consulted to drive behavior.
//!
//! Event vocabulary (`type` tag):
//! - `request`: requested semantic dispatch (structural snapshot + intent +
//!   adapter capabilities + correlation + dispatch-time observation, distinct
//!   from the envelope initial observation).
//! - `plan`: emitted plan assertion (correlation, rule, capability, operation,
//!   preconditions, base revision). Compared exactly to the derived dispatch;
//!   mismatch is a replay error, never execution input.
//! - `ack`: adapter acknowledgement/outcome (correlation, base revision,
//!   outcome). Session owner/generation bind implicitly; duplicate accepted
//!   acks are absorbed, mismatched correlation diverges in the reconciler.
//! - `verify`: post-observation verification (correlation, observation,
//!   verified flag, adapter-reported `verified_preconditions` and
//!   `verified_operation`). Reported preconditions/operation bind honestly from
//!   the observed adapter report and are compared only by the reconciler, so
//!   adapter verification mismatch diverges as `PostconditionMismatch`.
//! - `adapter-loss`: explicit adapter-loss signal, terminal.
//!
//! Ordering (replay-time, stable `out-of-order` errors): first event must be
//! `request`; each `request` needs exactly one following `plan` before any
//! `ack`; `ack` needs a pending plan; `verify` needs a pending acknowledged
//! plan; at most one pending plan (a second `request` while pending is an
//! order error); after divergence only idempotent `adapter-loss` is tolerated.
//! Monotonic revisions and exact ack/verify correlation are enforced by the
//! production reconciler (stale/correlation divergences are terminal trace
//! outcomes, not replay errors).
//!
//! Boundary: structural [`crate::directional`] snapshot/intent/operation
//! types and [`crate::contract`] observation/ack types only. No captions,
//! titles, app ids, paths, user data, native handles, timestamps, PIDs,
//! service identities, geometry, or platform types exist in this schema;
//! `deny_unknown_fields` makes them unrepresentable (any such field is a
//! decode error). No timestamps are stored, so equality-critical data carries
//! no runtime clock values. All failures are stable redacted kind/message
//! pairs that never echo input.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::contract::{AckOutcome, DivergenceKind, Observation, POLICY_VERSION};
use crate::directional::{
    Axis, Capabilities, Capability, CrossOutputTarget, Direction, EscapeContinuation, FocusedSide,
    Insertion, MoveIntent, MoveOperation, MoveOutcome, Node, NodeId, Output, OutputId,
    Precondition, Rule, Snapshot, WindowId, WindowLink, WorkspaceId, plan_move_with_capabilities,
};
use crate::planner_contract::{
    MAX_CHILDREN, MAX_DEPTH, MAX_ID_LEN, MAX_NODES_TOTAL, MAX_OUTPUTS, MAX_WINDOWS,
};
use crate::reconcile::{Commit, Reconciler, StateKind};

/// Trace envelope version (only accepted `v`).
pub const TRACE_VERSION: u32 = 1;
/// Whole-input byte bound.
pub const MAX_TRACE_BYTES: usize = 64 * 1024;
/// Ordered event-list bound. Large enough for duplicate/out-of-order
/// acknowledgement sequences, small enough to stay bounded.
pub const MAX_TRACE_EVENTS: usize = 16;
/// Output adjacency bound (one entry per direction).
const MAX_ADJACENT: usize = 4;

const MSG_OVERSIZED: &str = "trace exceeds size bound";
const MSG_MALFORMED: &str = "trace is malformed";
const MSG_UNKNOWN_FIELD: &str = "trace contains an unknown field";
const MSG_UNKNOWN_VALUE: &str = "trace contains an unknown value";
const MSG_VERSION: &str = "unsupported trace version";
const MSG_POLICY: &str = "unsupported policy version";
const MSG_ID: &str = "opaque id is invalid";
const MSG_BOUND: &str = "trace topology exceeds size bound";
const MSG_ENVELOPE: &str = "trace envelope is incoherent";
const MSG_ORDER: &str = "trace events are out of order";
const MSG_PLAN: &str = "emitted plan does not match the derived dispatch";

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Stable reconciler terminal state vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalState {
    Verified,
    PendingUnacked,
    PendingAcked,
    Divergent,
}

impl TerminalState {
    /// Stable string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::PendingUnacked => "pending-unacked",
            Self::PendingAcked => "pending-acked",
            Self::Divergent => "divergent",
        }
    }

    fn from_state(state: StateKind) -> Self {
        match state {
            StateKind::Verified => Self::Verified,
            StateKind::PendingUnacked => Self::PendingUnacked,
            StateKind::PendingAcked => Self::PendingAcked,
            StateKind::Divergent => Self::Divergent,
        }
    }
}

/// Stable diagnostic class vocabulary: `none` or a [`crate::contract`]
/// divergence kind string. Never echoes input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticClass {
    None,
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

impl DiagnosticClass {
    /// Stable string (mirrors `DivergenceKind::as_str`, plus `none`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
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

    fn from_divergence(value: Option<DivergenceKind>) -> Self {
        match value {
            None => Self::None,
            Some(DivergenceKind::StaleRevision) => Self::StaleRevision,
            Some(DivergenceKind::OwnerMismatch) => Self::OwnerMismatch,
            Some(DivergenceKind::GenerationMismatch) => Self::GenerationMismatch,
            Some(DivergenceKind::CorrelationMismatch) => Self::CorrelationMismatch,
            Some(DivergenceKind::CapabilityRefused) => Self::CapabilityRefused,
            Some(DivergenceKind::PartialApplication) => Self::PartialApplication,
            Some(DivergenceKind::AdapterLost) => Self::AdapterLost,
            Some(DivergenceKind::PostconditionUnverified) => Self::PostconditionUnverified,
            Some(DivergenceKind::PostconditionMismatch) => Self::PostconditionMismatch,
            Some(DivergenceKind::RevisionExhausted) => Self::RevisionExhausted,
        }
    }
}

/// Emitted plan assertion carried by a `plan` event (compared, never executed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanAssertion {
    pub correlation_id: String,
    pub rule: Rule,
    pub capability: Capability,
    pub base_revision: u64,
    pub preconditions: Vec<Precondition>,
    pub operation: MoveOperation,
}

/// Validated ordered trace event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceEvent {
    Request {
        correlation_id: String,
        observation: Observation,
        snapshot: Snapshot,
        intent: MoveIntent,
        capabilities: Capabilities,
    },
    Plan(PlanAssertion),
    Ack {
        correlation_id: String,
        base_revision: u64,
        outcome: AckOutcome,
    },
    Verify {
        correlation_id: String,
        observation: Observation,
        verified: bool,
        verified_preconditions: Vec<Precondition>,
        verified_operation: MoveOperation,
    },
    AdapterLoss,
}

/// Expected terminal outcome (assertion label only, never executed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpectedOutcome {
    pub terminal_state: TerminalState,
    pub diagnostic: DiagnosticClass,
}

/// Validated portable trace (V1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trace {
    pub owner: String,
    pub generation: String,
    pub initial_observation: Observation,
    pub events: Vec<TraceEvent>,
    pub expected: ExpectedOutcome,
}

/// Deterministic replay outcome: production reconciler status plus the last
/// commit, if any. Carries no timestamps and never echoes trace input beyond
/// the redacted status vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayOutcome {
    pub state: TerminalState,
    pub diagnostic: DiagnosticClass,
    pub revision: u64,
    pub commit: Option<Commit>,
}

impl ReplayOutcome {
    /// Compare against the assertion-only `expected` after execution.
    #[must_use]
    pub const fn matches_expected(self, expected: ExpectedOutcome) -> bool {
        self.state as u8 == expected.terminal_state as u8
            && self.diagnostic as u8 == expected.diagnostic as u8
    }
}

/// Fixed redacted decode failure. Never echoes input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceParseError {
    Oversized,
    Malformed,
    UnknownField,
    UnknownValue,
    UnsupportedVersion,
    UnsupportedPolicy,
    InvalidId,
    BoundExceeded,
    EnvelopeMismatch,
}

impl TraceParseError {
    /// Stable kind string.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::Oversized => "oversized",
            Self::Malformed => "malformed",
            Self::UnknownField => "unknown-field",
            Self::UnknownValue => "unknown-value",
            Self::UnsupportedVersion => "unsupported-version",
            Self::UnsupportedPolicy => "unsupported-policy",
            Self::InvalidId => "invalid-id",
            Self::BoundExceeded => "bound-exceeded",
            Self::EnvelopeMismatch => "envelope-mismatch",
        }
    }

    /// Fixed redacted message.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::Oversized => MSG_OVERSIZED,
            Self::Malformed => MSG_MALFORMED,
            Self::UnknownField => MSG_UNKNOWN_FIELD,
            Self::UnknownValue => MSG_UNKNOWN_VALUE,
            Self::UnsupportedVersion => MSG_VERSION,
            Self::UnsupportedPolicy => MSG_POLICY,
            Self::InvalidId => MSG_ID,
            Self::BoundExceeded => MSG_BOUND,
            Self::EnvelopeMismatch => MSG_ENVELOPE,
        }
    }
}

/// Fixed redacted replay failure. Never echoes input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayError {
    OutOfOrder,
    PlanMismatch,
}

impl ReplayError {
    /// Stable kind string.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::OutOfOrder => "out-of-order",
            Self::PlanMismatch => "plan-mismatch",
        }
    }

    /// Fixed redacted message.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::OutOfOrder => MSG_ORDER,
            Self::PlanMismatch => MSG_PLAN,
        }
    }
}

/// Combined parse-or-replay failure for [`replay_trace_json`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayFailure {
    Parse(TraceParseError),
    Exec(ReplayError),
}

impl ReplayFailure {
    /// Stable kind string.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::Parse(error) => error.kind(),
            Self::Exec(error) => error.kind(),
        }
    }

    /// Fixed redacted message.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::Parse(error) => error.message(),
            Self::Exec(error) => error.message(),
        }
    }
}

impl From<TraceParseError> for ReplayFailure {
    fn from(error: TraceParseError) -> Self {
        Self::Parse(error)
    }
}

impl From<ReplayError> for ReplayFailure {
    fn from(error: ReplayError) -> Self {
        Self::Exec(error)
    }
}

// ---- strict DTOs (serde only; every struct denies unknown fields) ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DirectionDto {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AxisDto {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum RuleDto {
    R1,
    R2a,
    R2b,
    R2c,
    R3,
    R4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum CapabilityDto {
    SwapNeighbor,
    WrapPerpendicular,
    WrapSiblings,
    InsertChild,
    SplitGroupChild,
    ReparentLeaf,
    CrossOutputTransfer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PreconditionDto {
    FocusedLeafOccupiedByFocusedWindow,
    NeighborLeafOccupied,
    ContainerIsDirectParent,
    TargetGroupMembership,
    ParentGroupMembership,
    SourceRootMembershipAndAdjacentSameWorkspaceOutput,
    AdapterMustVerifyPostconditions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum InsertionDto {
    Midpoint,
    NearEdge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum FocusedSideDto {
    First,
    Second,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum ContinuationDto {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "R1")]
    R1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CrossTargetDto {
    Empty,
    Occupied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OutcomeDto {
    Accepted,
    RefusedCapability,
    PartialApplication,
    AdapterLost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum TerminalDto {
    Verified,
    PendingUnacked,
    PendingAcked,
    Divergent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum DiagnosticDto {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "stale-revision")]
    StaleRevision,
    #[serde(rename = "owner-mismatch")]
    OwnerMismatch,
    #[serde(rename = "generation-mismatch")]
    GenerationMismatch,
    #[serde(rename = "correlation-mismatch")]
    CorrelationMismatch,
    #[serde(rename = "capability-refused")]
    CapabilityRefused,
    #[serde(rename = "partial-application")]
    PartialApplication,
    #[serde(rename = "adapter-lost")]
    AdapterLost,
    #[serde(rename = "postcondition-unverified")]
    PostconditionUnverified,
    #[serde(rename = "postcondition-mismatch")]
    PostconditionMismatch,
    #[serde(rename = "revision-exhausted")]
    RevisionExhausted,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum NodeDto {
    Leaf {
        id: String,
    },
    Group {
        id: String,
        axis: AxisDto,
        children: Vec<NodeDto>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct OutputDto {
    id: String,
    workspace: String,
    #[serde(default)]
    tree: Option<NodeDto>,
    #[serde(default)]
    adjacent: BTreeMap<DirectionDto, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WindowLinkDto {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotDto {
    outputs: Vec<OutputDto>,
    #[serde(default)]
    windows: Vec<WindowLinkDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct IntentDto {
    source_output: String,
    focused_leaf: String,
    focused_window: String,
    direction: DirectionDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilitiesDto {
    swap_neighbor: bool,
    wrap_perpendicular: bool,
    wrap_siblings: bool,
    insert_child: bool,
    split_group_child: bool,
    reparent_leaf: bool,
    cross_output_transfer: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservationDto {
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum OperationDto {
    WrapPerpendicular {
        rule: RuleDto,
        container: String,
        axis: AxisDto,
    },
    SwapNeighbor {
        rule: RuleDto,
        container: String,
        neighbor: String,
    },
    InsertIntoGroup {
        rule: RuleDto,
        container: String,
        target_group: String,
        insertion_index: usize,
        insertion: InsertionDto,
    },
    SplitGroupChild {
        rule: RuleDto,
        container: String,
        target_group: String,
        target_child: String,
        target_child_index: usize,
        focused_side: FocusedSideDto,
        axis: AxisDto,
    },
    WrapNeighbor {
        rule: RuleDto,
        container: String,
        neighbor: String,
        focused_before_neighbor: bool,
        axis: AxisDto,
    },
    EscapeParent {
        rule: RuleDto,
        container: String,
        parent: String,
        container_child_index: usize,
        #[serde(default)]
        parent_insertion_index: Option<usize>,
        continuation: ContinuationDto,
    },
    CrossOutput {
        rule: RuleDto,
        target_output: String,
        source_root_child_index: usize,
        target: CrossTargetDto,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum EventDto {
    Request {
        correlation_id: String,
        observation: ObservationDto,
        snapshot: SnapshotDto,
        intent: IntentDto,
        capabilities: CapabilitiesDto,
    },
    Plan {
        correlation_id: String,
        rule: RuleDto,
        capability: CapabilityDto,
        base_revision: u64,
        preconditions: Vec<PreconditionDto>,
        operation: OperationDto,
    },
    Ack {
        correlation_id: String,
        base_revision: u64,
        outcome: OutcomeDto,
    },
    Verify {
        correlation_id: String,
        observation: ObservationDto,
        verified: bool,
        verified_preconditions: Vec<PreconditionDto>,
        verified_operation: OperationDto,
    },
    AdapterLoss,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct MetaDto {
    policy_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExpectedDto {
    terminal_state: TerminalDto,
    diagnostic: DiagnosticDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TraceDto {
    v: u32,
    meta: MetaDto,
    owner: String,
    generation: String,
    initial_observation: ObservationDto,
    events: Vec<EventDto>,
    expected: ExpectedDto,
}

// ---- conversion (shape/bounds only; no cross-field execution semantics) ----

fn convert_direction(value: DirectionDto) -> Direction {
    match value {
        DirectionDto::Left => Direction::Left,
        DirectionDto::Right => Direction::Right,
        DirectionDto::Up => Direction::Up,
        DirectionDto::Down => Direction::Down,
    }
}

fn convert_axis(value: AxisDto) -> Axis {
    match value {
        AxisDto::Horizontal => Axis::Horizontal,
        AxisDto::Vertical => Axis::Vertical,
    }
}

fn convert_rule(value: RuleDto) -> Rule {
    match value {
        RuleDto::R1 => Rule::R1,
        RuleDto::R2a => Rule::R2a,
        RuleDto::R2b => Rule::R2b,
        RuleDto::R2c => Rule::R2c,
        RuleDto::R3 => Rule::R3,
        RuleDto::R4 => Rule::R4,
    }
}

fn convert_capability(value: CapabilityDto) -> Capability {
    match value {
        CapabilityDto::SwapNeighbor => Capability::SwapNeighbor,
        CapabilityDto::WrapPerpendicular => Capability::WrapPerpendicular,
        CapabilityDto::WrapSiblings => Capability::WrapSiblings,
        CapabilityDto::InsertChild => Capability::InsertChild,
        CapabilityDto::SplitGroupChild => Capability::SplitGroupChild,
        CapabilityDto::ReparentLeaf => Capability::ReparentLeaf,
        CapabilityDto::CrossOutputTransfer => Capability::CrossOutputTransfer,
    }
}

fn convert_precondition(value: PreconditionDto) -> Precondition {
    match value {
        PreconditionDto::FocusedLeafOccupiedByFocusedWindow => {
            Precondition::FocusedLeafOccupiedByFocusedWindow
        }
        PreconditionDto::NeighborLeafOccupied => Precondition::NeighborLeafOccupied,
        PreconditionDto::ContainerIsDirectParent => Precondition::ContainerIsDirectParent,
        PreconditionDto::TargetGroupMembership => Precondition::TargetGroupMembership,
        PreconditionDto::ParentGroupMembership => Precondition::ParentGroupMembership,
        PreconditionDto::SourceRootMembershipAndAdjacentSameWorkspaceOutput => {
            Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput
        }
        PreconditionDto::AdapterMustVerifyPostconditions => {
            Precondition::AdapterMustVerifyPostconditions
        }
    }
}

fn convert_node(dto: &NodeDto, depth: usize, total: &mut usize) -> Result<Node, TraceParseError> {
    if depth > MAX_DEPTH {
        return Err(TraceParseError::BoundExceeded);
    }
    *total = total.checked_add(1).ok_or(TraceParseError::BoundExceeded)?;
    if *total > MAX_NODES_TOTAL {
        return Err(TraceParseError::BoundExceeded);
    }
    match dto {
        NodeDto::Leaf { id } => {
            if !is_opaque_id(id) {
                return Err(TraceParseError::InvalidId);
            }
            Ok(Node::Leaf {
                id: NodeId(id.clone()),
            })
        }
        NodeDto::Group { id, axis, children } => {
            if !is_opaque_id(id) {
                return Err(TraceParseError::InvalidId);
            }
            if children.len() > MAX_CHILDREN {
                return Err(TraceParseError::BoundExceeded);
            }
            let mut converted = Vec::with_capacity(children.len());
            for child in children {
                converted.push(convert_node(child, depth + 1, total)?);
            }
            Ok(Node::Group {
                id: NodeId(id.clone()),
                axis: convert_axis(*axis),
                children: converted,
            })
        }
    }
}

fn convert_snapshot(dto: &SnapshotDto) -> Result<Snapshot, TraceParseError> {
    if dto.outputs.is_empty() || dto.outputs.len() > MAX_OUTPUTS {
        return Err(TraceParseError::BoundExceeded);
    }
    if dto.windows.len() > MAX_WINDOWS {
        return Err(TraceParseError::BoundExceeded);
    }
    let mut outputs = Vec::with_capacity(dto.outputs.len());
    let mut total_nodes = 0usize;
    for output in &dto.outputs {
        if !is_opaque_id(&output.id) || !is_opaque_id(&output.workspace) {
            return Err(TraceParseError::InvalidId);
        }
        if output.adjacent.len() > MAX_ADJACENT {
            return Err(TraceParseError::BoundExceeded);
        }
        let mut adjacent = BTreeMap::new();
        for (direction, target) in &output.adjacent {
            if !is_opaque_id(target) {
                return Err(TraceParseError::InvalidId);
            }
            adjacent.insert(convert_direction(*direction), OutputId(target.clone()));
        }
        let tree = match &output.tree {
            Some(tree) => Some(convert_node(tree, 0, &mut total_nodes)?),
            None => None,
        };
        outputs.push(Output {
            id: OutputId(output.id.clone()),
            workspace: WorkspaceId(output.workspace.clone()),
            tree,
            adjacent,
        });
    }
    let mut windows = Vec::with_capacity(dto.windows.len());
    for link in &dto.windows {
        if !is_opaque_id(&link.window)
            || !is_opaque_id(&link.leaf)
            || !is_opaque_id(&link.output)
            || !is_opaque_id(&link.workspace)
        {
            return Err(TraceParseError::InvalidId);
        }
        windows.push(WindowLink {
            window: WindowId(link.window.clone()),
            leaf: NodeId(link.leaf.clone()),
            output: OutputId(link.output.clone()),
            workspace: WorkspaceId(link.workspace.clone()),
        });
    }
    Ok(Snapshot { outputs, windows })
}

fn convert_intent(dto: &IntentDto) -> Result<MoveIntent, TraceParseError> {
    if !is_opaque_id(&dto.source_output)
        || !is_opaque_id(&dto.focused_leaf)
        || !is_opaque_id(&dto.focused_window)
    {
        return Err(TraceParseError::InvalidId);
    }
    Ok(MoveIntent {
        source_output: OutputId(dto.source_output.clone()),
        focused_leaf: NodeId(dto.focused_leaf.clone()),
        focused_window: WindowId(dto.focused_window.clone()),
        direction: convert_direction(dto.direction),
    })
}

fn convert_capabilities(dto: &CapabilitiesDto) -> Capabilities {
    Capabilities {
        swap_neighbor: dto.swap_neighbor,
        wrap_perpendicular: dto.wrap_perpendicular,
        wrap_siblings: dto.wrap_siblings,
        insert_child: dto.insert_child,
        split_group_child: dto.split_group_child,
        reparent_leaf: dto.reparent_leaf,
        cross_output_transfer: dto.cross_output_transfer,
    }
}

fn convert_observation(dto: &ObservationDto) -> Result<Observation, TraceParseError> {
    let observation = Observation {
        owner: dto.owner.clone(),
        generation: dto.generation.clone(),
        revision: dto.revision,
        fingerprint: dto.fingerprint,
    };
    if !observation.validate() {
        return Err(TraceParseError::InvalidId);
    }
    Ok(observation)
}

fn check_index(value: usize) -> Result<usize, TraceParseError> {
    if value > MAX_NODES_TOTAL {
        return Err(TraceParseError::BoundExceeded);
    }
    Ok(value)
}

fn check_id(value: &str) -> Result<NodeId, TraceParseError> {
    if !is_opaque_id(value) {
        return Err(TraceParseError::InvalidId);
    }
    Ok(NodeId(value.to_owned()))
}

fn check_correlation(value: &str) -> Result<String, TraceParseError> {
    if !crate::contract::is_correlation_id(value) {
        return Err(TraceParseError::InvalidId);
    }
    Ok(value.to_owned())
}

fn check_revision(value: u64) -> Result<u64, TraceParseError> {
    if !crate::contract::is_revision(value) {
        return Err(TraceParseError::InvalidId);
    }
    Ok(value)
}

fn convert_operation(dto: &OperationDto) -> Result<MoveOperation, TraceParseError> {
    match dto {
        OperationDto::WrapPerpendicular {
            rule,
            container,
            axis,
        } => Ok(MoveOperation::WrapPerpendicular {
            rule: convert_rule(*rule),
            container: check_id(container)?,
            axis: convert_axis(*axis),
        }),
        OperationDto::SwapNeighbor {
            rule,
            container,
            neighbor,
        } => Ok(MoveOperation::SwapNeighbor {
            rule: convert_rule(*rule),
            container: check_id(container)?,
            neighbor: check_id(neighbor)?,
        }),
        OperationDto::InsertIntoGroup {
            rule,
            container,
            target_group,
            insertion_index,
            insertion,
        } => Ok(MoveOperation::InsertIntoGroup {
            rule: convert_rule(*rule),
            container: check_id(container)?,
            target_group: check_id(target_group)?,
            insertion_index: check_index(*insertion_index)?,
            insertion: match insertion {
                InsertionDto::Midpoint => Insertion::Midpoint,
                InsertionDto::NearEdge => Insertion::NearEdge,
            },
        }),
        OperationDto::SplitGroupChild {
            rule,
            container,
            target_group,
            target_child,
            target_child_index,
            focused_side,
            axis,
        } => Ok(MoveOperation::SplitGroupChild {
            rule: convert_rule(*rule),
            container: check_id(container)?,
            target_group: check_id(target_group)?,
            target_child: check_id(target_child)?,
            target_child_index: check_index(*target_child_index)?,
            focused_side: match focused_side {
                FocusedSideDto::First => FocusedSide::First,
                FocusedSideDto::Second => FocusedSide::Second,
            },
            axis: convert_axis(*axis),
        }),
        OperationDto::WrapNeighbor {
            rule,
            container,
            neighbor,
            focused_before_neighbor,
            axis,
        } => Ok(MoveOperation::WrapNeighbor {
            rule: convert_rule(*rule),
            container: check_id(container)?,
            neighbor: check_id(neighbor)?,
            focused_before_neighbor: *focused_before_neighbor,
            axis: convert_axis(*axis),
        }),
        OperationDto::EscapeParent {
            rule,
            container,
            parent,
            container_child_index,
            parent_insertion_index,
            continuation,
        } => {
            let parent_insertion_index = match parent_insertion_index {
                Some(index) => Some(check_index(*index)?),
                None => None,
            };
            Ok(MoveOperation::EscapeParent {
                rule: convert_rule(*rule),
                container: check_id(container)?,
                parent: check_id(parent)?,
                container_child_index: check_index(*container_child_index)?,
                parent_insertion_index,
                continuation: match continuation {
                    ContinuationDto::None => EscapeContinuation::None,
                    ContinuationDto::R1 => EscapeContinuation::R1,
                },
            })
        }
        OperationDto::CrossOutput {
            rule,
            target_output,
            source_root_child_index,
            target,
        } => {
            if !is_opaque_id(target_output) {
                return Err(TraceParseError::InvalidId);
            }
            Ok(MoveOperation::CrossOutput {
                rule: convert_rule(*rule),
                target_output: OutputId(target_output.clone()),
                source_root_child_index: check_index(*source_root_child_index)?,
                target: match target {
                    CrossTargetDto::Empty => CrossOutputTarget::Empty,
                    CrossTargetDto::Occupied => CrossOutputTarget::Occupied,
                },
            })
        }
    }
}

fn convert_event(dto: &EventDto) -> Result<TraceEvent, TraceParseError> {
    match dto {
        EventDto::Request {
            correlation_id,
            observation,
            snapshot,
            intent,
            capabilities,
        } => Ok(TraceEvent::Request {
            correlation_id: check_correlation(correlation_id)?,
            observation: convert_observation(observation)?,
            snapshot: convert_snapshot(snapshot)?,
            intent: convert_intent(intent)?,
            capabilities: convert_capabilities(capabilities),
        }),
        EventDto::Plan {
            correlation_id,
            rule,
            capability,
            base_revision,
            preconditions,
            operation,
        } => {
            if preconditions.len() > crate::contract::MAX_PRECONDITIONS {
                return Err(TraceParseError::BoundExceeded);
            }
            Ok(TraceEvent::Plan(PlanAssertion {
                correlation_id: check_correlation(correlation_id)?,
                rule: convert_rule(*rule),
                capability: convert_capability(*capability),
                base_revision: check_revision(*base_revision)?,
                preconditions: preconditions
                    .iter()
                    .map(|item| convert_precondition(*item))
                    .collect(),
                operation: convert_operation(operation)?,
            }))
        }
        EventDto::Ack {
            correlation_id,
            base_revision,
            outcome,
        } => Ok(TraceEvent::Ack {
            correlation_id: check_correlation(correlation_id)?,
            base_revision: check_revision(*base_revision)?,
            outcome: match outcome {
                OutcomeDto::Accepted => AckOutcome::Accepted,
                OutcomeDto::RefusedCapability => AckOutcome::RefusedCapability,
                OutcomeDto::PartialApplication => AckOutcome::PartialApplication,
                OutcomeDto::AdapterLost => AckOutcome::AdapterLost,
            },
        }),
        EventDto::Verify {
            correlation_id,
            observation,
            verified,
            verified_preconditions,
            verified_operation,
        } => {
            if verified_preconditions.len() > crate::contract::MAX_PRECONDITIONS {
                return Err(TraceParseError::BoundExceeded);
            }
            Ok(TraceEvent::Verify {
                correlation_id: check_correlation(correlation_id)?,
                observation: convert_observation(observation)?,
                verified: *verified,
                verified_preconditions: verified_preconditions
                    .iter()
                    .map(|item| convert_precondition(*item))
                    .collect(),
                verified_operation: convert_operation(verified_operation)?,
            })
        }
        EventDto::AdapterLoss => Ok(TraceEvent::AdapterLoss),
    }
}

fn convert_expected(dto: &ExpectedDto) -> ExpectedOutcome {
    ExpectedOutcome {
        terminal_state: match dto.terminal_state {
            TerminalDto::Verified => TerminalState::Verified,
            TerminalDto::PendingUnacked => TerminalState::PendingUnacked,
            TerminalDto::PendingAcked => TerminalState::PendingAcked,
            TerminalDto::Divergent => TerminalState::Divergent,
        },
        diagnostic: match dto.diagnostic {
            DiagnosticDto::None => DiagnosticClass::None,
            DiagnosticDto::StaleRevision => DiagnosticClass::StaleRevision,
            DiagnosticDto::OwnerMismatch => DiagnosticClass::OwnerMismatch,
            DiagnosticDto::GenerationMismatch => DiagnosticClass::GenerationMismatch,
            DiagnosticDto::CorrelationMismatch => DiagnosticClass::CorrelationMismatch,
            DiagnosticDto::CapabilityRefused => DiagnosticClass::CapabilityRefused,
            DiagnosticDto::PartialApplication => DiagnosticClass::PartialApplication,
            DiagnosticDto::AdapterLost => DiagnosticClass::AdapterLost,
            DiagnosticDto::PostconditionUnverified => DiagnosticClass::PostconditionUnverified,
            DiagnosticDto::PostconditionMismatch => DiagnosticClass::PostconditionMismatch,
            DiagnosticDto::RevisionExhausted => DiagnosticClass::RevisionExhausted,
        },
    }
}

fn classify_serde_error(error: &serde_json::Error) -> TraceParseError {
    let text = error.to_string();
    if text.contains("unknown field") {
        TraceParseError::UnknownField
    } else if text.contains("unknown variant") {
        TraceParseError::UnknownValue
    } else {
        TraceParseError::Malformed
    }
}

/// Strict bounded V1 trace decode. Fixed redacted errors, never echoes input.
#[must_use = "decode errors are redacted values, not panics"]
pub fn parse_trace_json(input: &str) -> Result<Trace, TraceParseError> {
    if input.len() > MAX_TRACE_BYTES {
        return Err(TraceParseError::Oversized);
    }
    let dto: TraceDto = match serde_json::from_str(input) {
        Ok(dto) => dto,
        Err(error) => return Err(classify_serde_error(&error)),
    };
    if dto.v != TRACE_VERSION {
        return Err(TraceParseError::UnsupportedVersion);
    }
    if dto.meta.policy_version != POLICY_VERSION {
        return Err(TraceParseError::UnsupportedPolicy);
    }
    if !crate::contract::is_owner_id(&dto.owner)
        || !crate::contract::is_generation_id(&dto.generation)
    {
        return Err(TraceParseError::InvalidId);
    }
    if dto.events.is_empty() || dto.events.len() > MAX_TRACE_EVENTS {
        return Err(if dto.events.is_empty() {
            TraceParseError::Malformed
        } else {
            TraceParseError::BoundExceeded
        });
    }
    let mut events = Vec::with_capacity(dto.events.len());
    for event in &dto.events {
        events.push(convert_event(event)?);
    }
    let initial_observation = convert_observation(&dto.initial_observation)?;
    if initial_observation.owner != dto.owner || initial_observation.generation != dto.generation {
        return Err(TraceParseError::EnvelopeMismatch);
    }
    Ok(Trace {
        owner: dto.owner.clone(),
        generation: dto.generation.clone(),
        initial_observation,
        events,
        expected: convert_expected(&dto.expected),
    })
}

struct StagedRequest {
    correlation_id: String,
    observation: Observation,
    plan: crate::directional::MovePlan,
    capabilities: Capabilities,
}

/// Deterministic offline replay: derives each dispatch from the production
/// planner and executes it on the production reconciler. The request's
/// dispatch-time observation (distinct from the envelope initial observation)
/// is the observation proposed to the reconciler, so a stale observation
/// before dispatch diverges there. The verify event's adapter-reported
/// `verified_preconditions`/`verified_operation` construct the real
/// `PostObservation` with no backfill from the dispatch; comparison is only by
/// the reconciler. Trace `plan`
/// assertions are compared exactly to the derived dispatch; `expected` is
/// never read here (compare with [`ReplayOutcome::matches_expected`] after).
pub fn replay_trace(trace: &Trace) -> Result<ReplayOutcome, ReplayError> {
    let mut reconciler = Reconciler::new(
        &trace.owner,
        &trace.generation,
        trace.initial_observation.revision,
        trace.initial_observation.fingerprint,
    )
    .map_err(|_| ReplayError::OutOfOrder)?;
    let mut current = trace.initial_observation.clone();
    let mut staged: Option<StagedRequest> = None;
    let mut pending: Option<crate::contract::Dispatch> = None;
    let mut acked = false;
    let mut commit: Option<Commit> = None;

    for event in &trace.events {
        if reconciler.divergence().is_some() {
            // Terminal: only idempotent adapter-loss is tolerated afterwards.
            if matches!(event, TraceEvent::AdapterLoss) {
                reconciler.note_adapter_loss();
                continue;
            }
            return Err(ReplayError::OutOfOrder);
        }
        match event {
            TraceEvent::Request {
                correlation_id,
                observation,
                snapshot,
                intent,
                capabilities,
            } => {
                if staged.is_some() || pending.is_some() {
                    return Err(ReplayError::OutOfOrder);
                }
                let MoveOutcome::Planned(plan) =
                    plan_move_with_capabilities(snapshot, intent, capabilities)
                else {
                    return Err(ReplayError::PlanMismatch);
                };
                staged = Some(StagedRequest {
                    correlation_id: correlation_id.clone(),
                    observation: observation.clone(),
                    plan,
                    capabilities: capabilities.clone(),
                });
            }
            TraceEvent::Plan(assertion) => {
                let Some(request) = staged.take() else {
                    return Err(ReplayError::OutOfOrder);
                };
                if assertion.correlation_id != request.correlation_id
                    || assertion.base_revision != current.revision
                    || assertion.rule != request.plan.rule
                    || assertion.capability != request.plan.required_capability
                    || assertion.preconditions != request.plan.preconditions
                    || assertion.operation != request.plan.operation
                {
                    return Err(ReplayError::PlanMismatch);
                }
                match reconciler.propose(
                    &request.plan,
                    &request.observation,
                    &request.correlation_id,
                    &request.capabilities,
                ) {
                    Ok(dispatch) => {
                        pending = Some(dispatch);
                        acked = false;
                    }
                    Err(crate::reconcile::ProposeError::PendingExists) => {
                        return Err(ReplayError::OutOfOrder);
                    }
                    Err(crate::reconcile::ProposeError::Diverged(_)) => {
                        // Terminal divergence recorded inside the reconciler;
                        // the outcome is compared to `expected` afterwards.
                    }
                }
            }
            TraceEvent::Ack {
                correlation_id,
                base_revision,
                outcome,
            } => {
                if pending.is_none() {
                    return Err(ReplayError::OutOfOrder);
                }
                let ack = crate::contract::AdapterAck {
                    correlation_id: correlation_id.clone(),
                    owner: trace.owner.clone(),
                    generation: trace.generation.clone(),
                    base_revision: *base_revision,
                    outcome: *outcome,
                };
                match reconciler.acknowledge(&ack) {
                    Ok(_) => acked = true,
                    Err(crate::reconcile::AckError::NoPending) => {
                        return Err(ReplayError::OutOfOrder);
                    }
                    Err(crate::reconcile::AckError::Diverged(_)) => {
                        pending = None;
                    }
                }
            }
            TraceEvent::Verify {
                correlation_id,
                observation,
                verified,
                verified_preconditions,
                verified_operation,
            } => {
                if pending.is_none() {
                    return Err(ReplayError::OutOfOrder);
                };
                if !acked {
                    return Err(ReplayError::OutOfOrder);
                }
                let post = crate::contract::PostObservation {
                    observation: observation.clone(),
                    correlation_id: correlation_id.clone(),
                    verified: *verified,
                    verified_preconditions: verified_preconditions.clone(),
                    verified_operation: verified_operation.clone(),
                };
                match reconciler.verify(&post) {
                    Ok(receipt) => {
                        commit = Some(receipt);
                        pending = None;
                        acked = false;
                        current = Observation {
                            owner: trace.owner.clone(),
                            generation: trace.generation.clone(),
                            revision: receipt.revision,
                            fingerprint: receipt.fingerprint,
                        };
                    }
                    Err(crate::reconcile::VerifyError::NoPending)
                    | Err(crate::reconcile::VerifyError::NotAcknowledged) => {
                        return Err(ReplayError::OutOfOrder);
                    }
                    Err(crate::reconcile::VerifyError::Diverged(_)) => {
                        pending = None;
                    }
                }
            }
            TraceEvent::AdapterLoss => {
                reconciler.note_adapter_loss();
                staged = None;
                pending = None;
            }
        }
    }
    if staged.is_some() {
        return Err(ReplayError::OutOfOrder);
    }
    let status = reconciler.status();
    Ok(ReplayOutcome {
        state: TerminalState::from_state(status.state),
        diagnostic: DiagnosticClass::from_divergence(status.divergence),
        revision: status.revision,
        commit,
    })
}

/// Parse and replay in one step. Fixed redacted failures, never echoes input.
pub fn replay_trace_json(input: &str) -> Result<ReplayOutcome, ReplayFailure> {
    let trace = parse_trace_json(input).map_err(ReplayFailure::Parse)?;
    replay_trace(&trace).map_err(ReplayFailure::Exec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn snapshot() -> Value {
        json!({
            "outputs": [{
                "id": "source",
                "workspace": "workspace-1",
                "tree": {
                    "kind": "group",
                    "id": "root",
                    "axis": "horizontal",
                    "children": [
                        {"kind": "leaf", "id": "A"},
                        {"kind": "leaf", "id": "B"}
                    ]
                },
                "adjacent": {}
            }],
            "windows": [
                {"window": "w-A", "leaf": "A", "output": "source", "workspace": "workspace-1"},
                {"window": "w-B", "leaf": "B", "output": "source", "workspace": "workspace-1"}
            ]
        })
    }

    fn intent() -> Value {
        json!({
            "source_output": "source",
            "focused_leaf": "A",
            "focused_window": "w-A",
            "direction": "right"
        })
    }

    fn capabilities() -> Value {
        json!({
            "swap_neighbor": true,
            "wrap_perpendicular": true,
            "wrap_siblings": true,
            "insert_child": true,
            "split_group_child": true,
            "reparent_leaf": true,
            "cross_output_transfer": true
        })
    }

    fn plan_event() -> Value {
        json!({
            "type": "plan",
            "correlation_id": "corr-1",
            "rule": "R2a",
            "capability": "swap-neighbor",
            "base_revision": 0,
            "preconditions": [
                "focused-leaf-occupied-by-focused-window",
                "neighbor-leaf-occupied",
                "container-is-direct-parent",
                "adapter-must-verify-postconditions"
            ],
            "operation": {
                "kind": "swap-neighbor",
                "rule": "R2a",
                "container": "root",
                "neighbor": "B"
            }
        })
    }

    fn request_event() -> Value {
        json!({
            "type": "request",
            "correlation_id": "corr-1",
            "observation": {
                "owner": "owner-1",
                "generation": "gen-1",
                "revision": 0,
                "fingerprint": 7
            },
            "snapshot": snapshot(),
            "intent": intent(),
            "capabilities": capabilities()
        })
    }

    fn ack_event(correlation: &str, outcome: &str) -> Value {
        json!({
            "type": "ack",
            "correlation_id": correlation,
            "base_revision": 0,
            "outcome": outcome
        })
    }

    fn verify_event(correlation: &str, verified: bool) -> Value {
        json!({
            "type": "verify",
            "correlation_id": correlation,
            "observation": {
                "owner": "owner-1",
                "generation": "gen-1",
                "revision": 0,
                "fingerprint": 22
            },
            "verified": verified,
            "verified_preconditions": [
                "focused-leaf-occupied-by-focused-window",
                "neighbor-leaf-occupied",
                "container-is-direct-parent",
                "adapter-must-verify-postconditions"
            ],
            "verified_operation": {
                "kind": "swap-neighbor",
                "rule": "R2a",
                "container": "root",
                "neighbor": "B"
            }
        })
    }

    fn valid_trace(events: Vec<Value>, expected: Value) -> Value {
        json!({
            "v": 1,
            "meta": {"policy_version": 1},
            "owner": "owner-1",
            "generation": "gen-1",
            "initial_observation": {
                "owner": "owner-1",
                "generation": "gen-1",
                "revision": 0,
                "fingerprint": 7
            },
            "events": events,
            "expected": expected
        })
    }

    fn success_events() -> Vec<Value> {
        vec![
            request_event(),
            plan_event(),
            ack_event("corr-1", "accepted"),
            verify_event("corr-1", true),
        ]
    }

    fn replay(value: &Value) -> Result<ReplayOutcome, ReplayFailure> {
        replay_trace_json(&value.to_string())
    }

    #[test]
    fn success_replays_to_verified_and_ignores_expected() {
        let expected = json!({"terminal_state": "verified", "diagnostic": "none"});
        let trace = valid_trace(success_events(), expected);
        let outcome = replay(&trace).expect("success replays");
        assert_eq!(outcome.state, TerminalState::Verified);
        assert_eq!(outcome.diagnostic, DiagnosticClass::None);
        assert_eq!(outcome.revision, 1);
        assert_eq!(outcome.commit.map(|c| c.revision), Some(1));
        let parsed = parse_trace_json(&trace.to_string()).expect("parses");
        assert!(outcome.matches_expected(parsed.expected));
        // `expected` never drives behavior: a contradictory assertion label
        // replays to the identical outcome.
        let forged = valid_trace(
            success_events(),
            json!({"terminal_state": "divergent", "diagnostic": "stale-revision"}),
        );
        assert_eq!(replay(&forged), Ok(outcome));
        // Deterministic with no timestamps.
        assert_eq!(replay(&trace), Ok(outcome));
        let debug = format!("{outcome:?}");
        assert!(!debug.contains("timestamp"));
    }

    #[test]
    fn refused_ack_diverges_terminal() {
        let trace = valid_trace(
            vec![
                request_event(),
                plan_event(),
                ack_event("corr-1", "refused-capability"),
            ],
            json!({"terminal_state": "divergent", "diagnostic": "capability-refused"}),
        );
        let outcome = replay(&trace).expect("refusal replays to divergence");
        assert_eq!(outcome.state, TerminalState::Divergent);
        assert_eq!(outcome.diagnostic, DiagnosticClass::CapabilityRefused);
        assert_eq!(outcome.revision, 0);
        assert_eq!(outcome.commit, None);
        let parsed = parse_trace_json(&trace.to_string()).expect("parses");
        assert!(outcome.matches_expected(parsed.expected));
    }

    #[test]
    fn out_of_order_ack_diverges_on_correlation() {
        let trace = valid_trace(
            vec![
                request_event(),
                plan_event(),
                ack_event("corr-2", "accepted"),
            ],
            json!({"terminal_state": "divergent", "diagnostic": "correlation-mismatch"}),
        );
        let outcome = replay(&trace).expect("wrong-correlation ack replays");
        assert_eq!(outcome.state, TerminalState::Divergent);
        assert_eq!(outcome.diagnostic, DiagnosticClass::CorrelationMismatch);
        let parsed = parse_trace_json(&trace.to_string()).expect("parses");
        assert!(outcome.matches_expected(parsed.expected));
    }

    #[test]
    fn duplicate_ack_is_absorbed_before_verify() {
        let trace = valid_trace(
            vec![
                request_event(),
                plan_event(),
                ack_event("corr-1", "accepted"),
                ack_event("corr-1", "accepted"),
                verify_event("corr-1", true),
            ],
            json!({"terminal_state": "verified", "diagnostic": "none"}),
        );
        let outcome = replay(&trace).expect("duplicate ack replays");
        assert_eq!(outcome.state, TerminalState::Verified);
        assert_eq!(outcome.revision, 1);
    }

    #[test]
    fn adapter_loss_is_terminal() {
        let trace = valid_trace(
            vec![
                request_event(),
                plan_event(),
                json!({"type": "adapter-loss"}),
            ],
            json!({"terminal_state": "divergent", "diagnostic": "adapter-lost"}),
        );
        let outcome = replay(&trace).expect("loss replays");
        assert_eq!(outcome.state, TerminalState::Divergent);
        assert_eq!(outcome.diagnostic, DiagnosticClass::AdapterLost);
    }

    #[test]
    fn verify_before_ack_is_out_of_order() {
        let trace = valid_trace(
            vec![request_event(), plan_event(), verify_event("corr-1", true)],
            json!({"terminal_state": "divergent", "diagnostic": "none"}),
        );
        let error = replay(&trace).expect_err("verify before ack must fail");
        assert_eq!(error, ReplayFailure::Exec(ReplayError::OutOfOrder));
        assert_eq!(error.kind(), "out-of-order");
        assert!(!error.message().contains("corr-1"));
    }

    #[test]
    fn second_request_while_pending_is_out_of_order() {
        let mut second = request_event();
        second["correlation_id"] = json!("corr-2");
        let trace = valid_trace(
            vec![request_event(), plan_event(), second],
            json!({"terminal_state": "divergent", "diagnostic": "none"}),
        );
        assert_eq!(
            replay(&trace),
            Err(ReplayFailure::Exec(ReplayError::OutOfOrder))
        );
    }

    #[test]
    fn ack_without_request_is_out_of_order() {
        let trace = valid_trace(
            vec![ack_event("corr-9", "accepted")],
            json!({"terminal_state": "divergent", "diagnostic": "none"}),
        );
        assert_eq!(
            replay(&trace),
            Err(ReplayFailure::Exec(ReplayError::OutOfOrder))
        );
    }

    #[test]
    fn plan_mismatch_is_rejected_without_echo() {
        let mut plan = plan_event();
        plan["operation"]["neighbor"] = json!("SECRET-NEIGHBOR");
        let trace = valid_trace(
            vec![request_event(), plan],
            json!({"terminal_state": "divergent", "diagnostic": "none"}),
        );
        let error = replay(&trace).expect_err("mismatched plan must fail");
        assert_eq!(error, ReplayFailure::Exec(ReplayError::PlanMismatch));
        assert_eq!(error.kind(), "plan-mismatch");
        assert!(!error.message().contains("SECRET-NEIGHBOR"));
    }

    #[test]
    fn unknown_fields_rejected_without_echo() {
        let mut trace = valid_trace(
            success_events(),
            json!({"terminal_state": "verified", "diagnostic": "none"}),
        );
        trace["intent"] = json!("boom-SECRET-1");
        let error = parse_trace_json(&trace.to_string()).expect_err("must fail");
        assert_eq!(error, TraceParseError::UnknownField);
        assert!(!error.message().contains("SECRET"));
    }

    #[test]
    fn sensitive_fields_are_unrepresentable() {
        for field in [
            "caption",
            "title",
            "app_id",
            "executable_path",
            "path",
            "user_data",
            "native_handle",
            "timestamp",
            "pid",
            "geometry",
            "platform",
            "service",
        ] {
            let mut trace = valid_trace(
                success_events(),
                json!({"terminal_state": "verified", "diagnostic": "none"}),
            );
            trace[field] = json!("x");
            assert_eq!(
                parse_trace_json(&trace.to_string()),
                Err(TraceParseError::UnknownField),
                "{field} must be unrepresentable"
            );
            let mut trace = valid_trace(
                success_events(),
                json!({"terminal_state": "verified", "diagnostic": "none"}),
            );
            trace["events"][0][field] = json!("x");
            assert_eq!(
                parse_trace_json(&trace.to_string()),
                Err(TraceParseError::UnknownField),
                "event {field} must be unrepresentable"
            );
        }
    }

    #[test]
    fn version_policy_and_bounds_enforced() {
        let mut trace = valid_trace(
            success_events(),
            json!({"terminal_state": "verified", "diagnostic": "none"}),
        );
        trace["v"] = json!(2);
        assert_eq!(
            parse_trace_json(&trace.to_string()),
            Err(TraceParseError::UnsupportedVersion)
        );
        let mut trace = valid_trace(
            success_events(),
            json!({"terminal_state": "verified", "diagnostic": "none"}),
        );
        trace["meta"]["policy_version"] = json!(2);
        assert_eq!(
            parse_trace_json(&trace.to_string()),
            Err(TraceParseError::UnsupportedPolicy)
        );
        let big = "x".repeat(MAX_TRACE_BYTES + 1);
        assert_eq!(parse_trace_json(&big), Err(TraceParseError::Oversized));
        let events: Vec<Value> = (0..MAX_TRACE_EVENTS + 1)
            .map(|_| json!({"type": "adapter-loss"}))
            .collect();
        let trace = valid_trace(
            events,
            json!({"terminal_state": "divergent", "diagnostic": "adapter-lost"}),
        );
        assert_eq!(
            parse_trace_json(&trace.to_string()),
            Err(TraceParseError::BoundExceeded)
        );
        let trace = valid_trace(
            vec![],
            json!({"terminal_state": "verified", "diagnostic": "none"}),
        );
        assert_eq!(
            parse_trace_json(&trace.to_string()),
            Err(TraceParseError::Malformed)
        );
    }

    #[test]
    fn unknown_enum_values_rejected() {
        let mut trace = valid_trace(
            success_events(),
            json!({"terminal_state": "verified", "diagnostic": "none"}),
        );
        trace["events"][1]["rule"] = json!("R9");
        assert_eq!(
            parse_trace_json(&trace.to_string()),
            Err(TraceParseError::UnknownValue)
        );
    }

    #[test]
    fn pending_terminal_states_replay() {
        let unacked = valid_trace(
            vec![request_event(), plan_event()],
            json!({"terminal_state": "pending-unacked", "diagnostic": "none"}),
        );
        let outcome = replay(&unacked).expect("pending-unacked replays");
        assert_eq!(outcome.state, TerminalState::PendingUnacked);
        assert_eq!(outcome.diagnostic, DiagnosticClass::None);
        let acked = valid_trace(
            vec![
                request_event(),
                plan_event(),
                ack_event("corr-1", "accepted"),
            ],
            json!({"terminal_state": "pending-acked", "diagnostic": "none"}),
        );
        let outcome = replay(&acked).expect("pending-acked replays");
        assert_eq!(outcome.state, TerminalState::PendingAcked);
    }

    #[test]
    fn initial_observation_session_binding_is_parse_time_coherence() {
        let expected = json!({"terminal_state": "verified", "diagnostic": "none"});
        let mut owner_mismatch = valid_trace(success_events(), expected.clone());
        owner_mismatch["initial_observation"]["owner"] = json!("owner-2");
        let error = parse_trace_json(&owner_mismatch.to_string()).expect_err("owner must bind");
        assert_eq!(error, TraceParseError::EnvelopeMismatch);
        assert_eq!(error.kind(), "envelope-mismatch");
        assert_eq!(error.message(), "trace envelope is incoherent");
        assert!(!error.message().contains("owner-2"));
        assert_eq!(
            replay(&owner_mismatch),
            Err(ReplayFailure::Parse(TraceParseError::EnvelopeMismatch))
        );

        let mut generation_mismatch = valid_trace(success_events(), expected);
        generation_mismatch["initial_observation"]["generation"] = json!("gen-2");
        let error =
            parse_trace_json(&generation_mismatch.to_string()).expect_err("generation must bind");
        assert_eq!(error, TraceParseError::EnvelopeMismatch);
        assert_eq!(error.kind(), "envelope-mismatch");
        assert!(!error.message().contains("gen-2"));
    }

    #[test]
    fn escape_parent_insertion_absent_and_null_normalize_to_none() {
        fn escape_plan(insertion: Option<Value>) -> Value {
            let mut operation = json!({
                "kind": "escape-parent",
                "rule": "R3",
                "container": "root",
                "parent": "target",
                "container_child_index": 0,
                "continuation": "none"
            });
            if let Some(value) = insertion {
                operation["parent_insertion_index"] = value;
            }
            json!({
                "type": "plan",
                "correlation_id": "corr-1",
                "rule": "R3",
                "capability": "reparent-leaf",
                "base_revision": 0,
                "preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "container-is-direct-parent",
                    "parent-group-membership",
                    "adapter-must-verify-postconditions"
                ],
                "operation": operation
            })
        }
        let expected = json!({"terminal_state": "divergent", "diagnostic": "none"});
        let missing = valid_trace(vec![request_event(), escape_plan(None)], expected.clone());
        let null = valid_trace(
            vec![request_event(), escape_plan(Some(Value::Null))],
            expected,
        );
        let parsed_missing = parse_trace_json(&missing.to_string()).expect("absent parses");
        let parsed_null = parse_trace_json(&null.to_string()).expect("null parses");
        assert_eq!(parsed_missing, parsed_null);
        let Some(TraceEvent::Plan(assertion)) = parsed_missing.events.get(1) else {
            panic!("second event is the escape plan");
        };
        assert!(
            matches!(
                assertion.operation,
                MoveOperation::EscapeParent {
                    parent_insertion_index: None,
                    ..
                }
            ),
            "absent and null normalize to None"
        );
        // Bounds still enforced for an explicit index.
        let bound = valid_trace(
            vec![
                request_event(),
                escape_plan(Some(json!(MAX_NODES_TOTAL + 1))),
            ],
            json!({"terminal_state": "divergent", "diagnostic": "none"}),
        );
        assert_eq!(
            parse_trace_json(&bound.to_string()),
            Err(TraceParseError::BoundExceeded)
        );
    }
}
