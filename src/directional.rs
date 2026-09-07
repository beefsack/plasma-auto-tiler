//! Pure, platform-neutral directional movement engine.
//!
//! Structural analogue of the authoritative TypeScript sources:
//! - `directional-movement-planner.ts` (rules R1-R4, validation,
//!   planning algorithm),
//! - `cosmic-move-adapter.ts` (tree-relative focus climb/descend,
//!   proportional fraction sizing helpers only).
//!
//! Boundary rules: no platform imports, concepts, or identity; no native
//! actuation, mutation, batching, recovery, IPC, persistence, UI, FFI, or
//! platform adapters. The engine takes an immutable [`Snapshot`] by shared
//! reference, emits a deterministic owned [`MoveOutcome`], and holds no state.
//! Native realization is never assumed atomic: every emitted plan carries its
//! [`Precondition`]s (including [`Precondition::AdapterMustVerifyPostconditions`])
//! and its [`Capability`], and [`plan_move_with_capabilities`] refuses an
//! unsupported operation before any plan is emitted.
//!
//! Intentional omissions (per bounded brief): no pixel placement or geometry
//! type (fraction sizing helpers need none), no actuation/mutation layer, no
//! persistence/IPC/FFI. Cyclic graphs are impossible by construction: [`Node`]
//! is an owned tree, so a cycle cannot be represented. The TypeScript
//! object-identity cycle/share rejection therefore maps to the strictly
//! stronger global duplicate-[`NodeId`] rejection documented on
//! [`Snapshot`]; no flat graph decoder is provided because cycle input cannot
//! otherwise be constructed.

use std::collections::{BTreeMap, HashMap, HashSet};

/// Movement direction. Analogue of `Direction` in the TypeScript logic source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

/// Split axis of an N-ary group. Analogue of `CosmicAxis`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Axis {
    Horizontal,
    Vertical,
}

impl Axis {
    /// Axis a direction moves along. Source: `axisFor` in the TS planner.
    #[must_use]
    pub fn for_direction(direction: Direction) -> Self {
        match direction {
            Direction::Left | Direction::Right => Axis::Horizontal,
            Direction::Up | Direction::Down => Axis::Vertical,
        }
    }
}

/// Step along the axis. Source: `stepFor` in the TS planner.
fn step_for(direction: Direction) -> i32 {
    match direction {
        Direction::Right | Direction::Down => 1,
        Direction::Left | Direction::Up => -1,
    }
}

/// Opaque platform-neutral output identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct OutputId(pub String);

/// Opaque platform-neutral workspace identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WorkspaceId(pub String);

/// Opaque platform-neutral tree-node identity (leaves and groups share one
/// namespace, as in the TS source where `ids` covers both kinds).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(pub String);

/// Opaque platform-neutral window identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WindowId(pub String);

impl From<&str> for OutputId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl From<&str> for WorkspaceId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl From<&str> for NodeId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl From<&str> for WindowId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

/// Ordered N-ary tree node. Analogue of `CosmicNode` / `CosmicLeaf` / `CosmicGroup`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    Leaf {
        id: NodeId,
    },
    Group {
        id: NodeId,
        axis: Axis,
        children: Vec<Node>,
    },
}

impl Node {
    /// Node identity.
    #[must_use]
    pub fn id(&self) -> &NodeId {
        match self {
            Node::Leaf { id } | Node::Group { id, .. } => id,
        }
    }
}

/// Platform-neutral output topology. Analogue of `CosmicOutputTopology`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    pub id: OutputId,
    pub workspace: WorkspaceId,
    pub tree: Option<Node>,
    pub adjacent: BTreeMap<Direction, OutputId>,
}

/// Platform-neutral window association: window `window` occupies leaf `leaf`
/// on output `output` within `workspace`. There is no platform-native identity
/// here;
/// the adapter maps native handles to these opaque ids before calling the
/// engine. Every leaf must have exactly one link and every link must be
/// reciprocal (see [`Snapshot`] validation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowLink {
    pub window: WindowId,
    pub leaf: NodeId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
}

/// Immutable engine input snapshot.
///
/// Validation (fail-closed [`Rejection`], never partial) detects:
/// - empty output set; empty/duplicate output, workspace, node, or window ids;
/// - groups with fewer than two children;
/// - duplicate [`NodeId`]s anywhere in the snapshot. This global uniqueness is
///   an intentional engine snapshot invariant, not a mechanical validation
///   translation: opaque global ids plus [`WindowLink`] require an unambiguous
///   logical topology, so any shared topology can only reappear as a
///   duplicated id, which is rejected. Cyclic graphs need no decoder because
///   they are impossible by construction with the owned [`Node`] tree;
/// - unknown, self, or empty output adjacency targets;
/// - missing source output;
/// - missing, stale (leaf/output/workspace mismatch), or nonreciprocal
///   (leaf without a link, link without a leaf, duplicated window or leaf)
///   window associations, including empty [`WindowLink`] workspace values
///   rejected before output workspace comparison.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub outputs: Vec<Output>,
    pub windows: Vec<WindowLink>,
}

/// Directional move intent against a [`Snapshot`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoveIntent {
    pub source_output: OutputId,
    pub focused_leaf: NodeId,
    pub focused_window: WindowId,
    pub direction: Direction,
}

/// Structural rule. Analogue of `CosmicMoveRule`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Rule {
    R1,
    R2a,
    R2b,
    R2c,
    R3,
    R4,
}

/// Adapter-facing native capability required to realize one operation.
/// `InsertChild`, `SplitGroupChild`, `WrapSiblings`, `ReparentLeaf`, and
/// `CrossOutputTransfer` model structural operations an adapter may not
/// declare; the engine refuses them before plan emission unless declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    SwapNeighbor,
    WrapPerpendicular,
    WrapSiblings,
    InsertChild,
    SplitGroupChild,
    ReparentLeaf,
    CrossOutputTransfer,
}

/// Explicit preconditions the adapter must hold/verify to realize a plan.
/// `AdapterMustVerifyPostconditions` is present on every plan: the engine
/// never assumes native realization is atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Precondition {
    FocusedLeafOccupiedByFocusedWindow,
    NeighborLeafOccupied,
    ContainerIsDirectParent,
    TargetGroupMembership,
    ParentGroupMembership,
    SourceRootMembershipAndAdjacentSameWorkspaceOutput,
    AdapterMustVerifyPostconditions,
}

/// Structural operation. Structural analogue of `CosmicMoveOperation`
/// (`containerId` rendered as `container` with Rust-idiomatic field names).
/// This POC promises no JSON wire compatibility with the TypeScript source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MoveOperation {
    WrapPerpendicular {
        rule: Rule,
        container: NodeId,
        axis: Axis,
    },
    SwapNeighbor {
        rule: Rule,
        container: NodeId,
        neighbor: NodeId,
    },
    InsertIntoGroup {
        rule: Rule,
        container: NodeId,
        target_group: NodeId,
        insertion_index: usize,
        insertion: Insertion,
    },
    SplitGroupChild {
        rule: Rule,
        container: NodeId,
        target_group: NodeId,
        target_child: NodeId,
        target_child_index: usize,
        focused_side: FocusedSide,
        axis: Axis,
    },
    WrapNeighbor {
        rule: Rule,
        container: NodeId,
        neighbor: NodeId,
        focused_before_neighbor: bool,
        axis: Axis,
    },
    EscapeParent {
        rule: Rule,
        container: NodeId,
        parent: NodeId,
        container_child_index: usize,
        parent_insertion_index: Option<usize>,
        continuation: EscapeContinuation,
    },
    CrossOutput {
        rule: Rule,
        target_output: OutputId,
        source_root_child_index: usize,
        target: CrossOutputTarget,
    },
}

/// R2b insertion placement. Analogue of `insertion: "midpoint" | "near-edge"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Insertion {
    Midpoint,
    NearEdge,
}

/// R2b split placement of the focused leaf. Analogue of `focusedSide`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FocusedSide {
    First,
    Second,
}

/// R3 continuation. Analogue of `continuation: "none" | "R1"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EscapeContinuation {
    None,
    R1,
}

/// R4 target occupancy. Analogue of `target: "empty" | "occupied"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CrossOutputTarget {
    Empty,
    Occupied,
}

impl MoveOperation {
    /// Rule of this operation.
    #[must_use]
    pub fn rule(&self) -> Rule {
        match self {
            MoveOperation::WrapPerpendicular { rule, .. }
            | MoveOperation::SwapNeighbor { rule, .. }
            | MoveOperation::InsertIntoGroup { rule, .. }
            | MoveOperation::SplitGroupChild { rule, .. }
            | MoveOperation::WrapNeighbor { rule, .. }
            | MoveOperation::EscapeParent { rule, .. }
            | MoveOperation::CrossOutput { rule, .. } => *rule,
        }
    }

    /// Adapter-facing capability required before emission.
    #[must_use]
    pub fn required_capability(&self) -> Capability {
        match self {
            MoveOperation::WrapPerpendicular { .. } => Capability::WrapPerpendicular,
            MoveOperation::SwapNeighbor { .. } => Capability::SwapNeighbor,
            MoveOperation::InsertIntoGroup { .. } => Capability::InsertChild,
            MoveOperation::SplitGroupChild { .. } => Capability::SplitGroupChild,
            MoveOperation::WrapNeighbor { .. } => Capability::WrapSiblings,
            MoveOperation::EscapeParent { .. } => Capability::ReparentLeaf,
            MoveOperation::CrossOutput { .. } => Capability::CrossOutputTransfer,
        }
    }

    /// Explicit preconditions for realization (always terminated by
    /// [`Precondition::AdapterMustVerifyPostconditions`]).
    #[must_use]
    pub fn preconditions(&self) -> Vec<Precondition> {
        let mut preconditions = match self {
            MoveOperation::WrapPerpendicular { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::ContainerIsDirectParent,
            ],
            MoveOperation::SwapNeighbor { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::NeighborLeafOccupied,
                Precondition::ContainerIsDirectParent,
            ],
            MoveOperation::InsertIntoGroup { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::ContainerIsDirectParent,
                Precondition::TargetGroupMembership,
            ],
            MoveOperation::SplitGroupChild { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::NeighborLeafOccupied,
                Precondition::ContainerIsDirectParent,
                Precondition::TargetGroupMembership,
            ],
            MoveOperation::WrapNeighbor { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::NeighborLeafOccupied,
                Precondition::ContainerIsDirectParent,
            ],
            MoveOperation::EscapeParent { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::ContainerIsDirectParent,
                Precondition::ParentGroupMembership,
            ],
            MoveOperation::CrossOutput { .. } => vec![
                Precondition::FocusedLeafOccupiedByFocusedWindow,
                Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput,
            ],
        };
        preconditions.push(Precondition::AdapterMustVerifyPostconditions);
        preconditions
    }
}

/// Adapter-declared capabilities. See [`Capability`]. Adapters supply explicit
/// generic capabilities; the engine defines no platform-specific preset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capabilities {
    pub swap_neighbor: bool,
    pub wrap_perpendicular: bool,
    pub wrap_siblings: bool,
    pub insert_child: bool,
    pub split_group_child: bool,
    pub reparent_leaf: bool,
    pub cross_output_transfer: bool,
}

impl Capabilities {
    /// All capabilities declared (tests, future adapters).
    #[must_use]
    pub fn full() -> Self {
        Self {
            swap_neighbor: true,
            wrap_perpendicular: true,
            wrap_siblings: true,
            insert_child: true,
            split_group_child: true,
            reparent_leaf: true,
            cross_output_transfer: true,
        }
    }

    /// None declared.
    #[must_use]
    pub fn none() -> Self {
        Self {
            swap_neighbor: false,
            wrap_perpendicular: false,
            wrap_siblings: false,
            insert_child: false,
            split_group_child: false,
            reparent_leaf: false,
            cross_output_transfer: false,
        }
    }

    /// Whether `capability` is declared.
    #[must_use]
    pub fn supports(&self, capability: Capability) -> bool {
        match capability {
            Capability::SwapNeighbor => self.swap_neighbor,
            Capability::WrapPerpendicular => self.wrap_perpendicular,
            Capability::WrapSiblings => self.wrap_siblings,
            Capability::InsertChild => self.insert_child,
            Capability::SplitGroupChild => self.split_group_child,
            Capability::ReparentLeaf => self.reparent_leaf,
            Capability::CrossOutputTransfer => self.cross_output_transfer,
        }
    }
}

/// Deterministic movement plan with explicit capability and preconditions.
/// Self-contained: `intent` records the originating typed [`MoveIntent`] so a
/// plan can be interpreted without retaining the caller-side intent value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MovePlan {
    pub intent: MoveIntent,
    pub rule: Rule,
    pub operation: MoveOperation,
    pub required_capability: Capability,
    pub preconditions: Vec<Precondition>,
}

impl MovePlan {
    fn for_operation(intent: &MoveIntent, operation: MoveOperation) -> Self {
        let required_capability = operation.required_capability();
        let preconditions = operation.preconditions();
        Self {
            intent: (*intent).clone(),
            rule: operation.rule(),
            operation,
            required_capability,
            preconditions,
        }
    }
}

/// No-op reason. Analogue of `CosmicNoopReason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NoopReason {
    Boundary,
    NoAdjacentOutput,
    SingleRootLeaf,
}

/// Rejection kind. Analogue of `CosmicRejectionKind` plus `UnsupportedTopology`
/// for capability refusal before plan emission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RejectionKind {
    MalformedTopology,
    UnsupportedTopology,
    FocusedLeafNotFound,
}

/// Fail-closed rejection with a diagnostic message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection {
    pub kind: RejectionKind,
    pub message: String,
}

/// Engine outcome. Analogue of `CosmicMoveOutcome`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MoveOutcome {
    Planned(MovePlan),
    Noop { reason: NoopReason },
    Rejected { reason: Rejection },
}

fn rejected(kind: RejectionKind, message: impl Into<String>) -> MoveOutcome {
    MoveOutcome::Rejected {
        reason: Rejection {
            kind,
            message: message.into(),
        },
    }
}

/// Deterministic tree-relative focus plan. Analogue of `planCosmicFocus` /
/// `CosmicFocusPlan` in `cosmic-move-adapter.ts`; `route` names the
/// deterministic group-to-leaf descent so callers can verify the path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusPlan {
    Focused { leaf: NodeId, route: Vec<NodeId> },
    Edge,
}

// ---- validation ----

struct PathLevel<'a> {
    group_id: NodeId,
    axis: Axis,
    child_index: usize,
    children: &'a [Node],
}

fn find_path<'a>(node: &'a Node, focused: &NodeId, path: &mut Vec<PathLevel<'a>>) -> bool {
    match node {
        Node::Leaf { id } => id == focused,
        Node::Group { id, axis, children } => {
            for (index, child) in children.iter().enumerate() {
                if find_path(child, focused, path) {
                    path.push(PathLevel {
                        group_id: id.clone(),
                        axis: *axis,
                        child_index: index,
                        children: children.as_slice(),
                    });
                    return true;
                }
            }
            false
        }
    }
}

/// Root-to-leaf path (outermost first). `None` when the leaf is absent.
fn path_to<'a>(node: &'a Node, focused: &NodeId) -> Option<Vec<PathLevel<'a>>> {
    let mut reversed = Vec::new();
    if find_path(node, focused, &mut reversed) {
        reversed.reverse();
        Some(reversed)
    } else {
        None
    }
}

fn validate_node(
    node: &Node,
    ids: &mut HashSet<NodeId>,
    leaf_outputs: &mut HashMap<NodeId, usize>,
    output_index: usize,
    leaf_is_leaf: &mut HashMap<NodeId, bool>,
) -> Result<(), String> {
    if node.id().0.is_empty() {
        return Err("node identities must be non-empty".to_string());
    }
    if !ids.insert(node.id().clone()) {
        return Err(
            "node identities must be unique; shared or cyclic topology is unsupported".to_string(),
        );
    }
    match node {
        Node::Leaf { id } => {
            leaf_outputs.insert(id.clone(), output_index);
            leaf_is_leaf.insert(id.clone(), true);
            Ok(())
        }
        Node::Group { children, .. } => {
            leaf_is_leaf.insert(node.id().clone(), false);
            if children.len() < 2 {
                return Err("groups must have at least two children".to_string());
            }
            for child in children {
                validate_node(child, ids, leaf_outputs, output_index, leaf_is_leaf)?;
            }
            Ok(())
        }
    }
}

struct Validated<'a> {
    source: &'a Output,
}

#[allow(clippy::result_large_err)]
fn validate_snapshot<'a>(
    snapshot: &'a Snapshot,
    intent: &MoveIntent,
) -> Result<Validated<'a>, MoveOutcome> {
    if snapshot.outputs.is_empty() {
        return Err(rejected(
            RejectionKind::MalformedTopology,
            "at least one output topology is required",
        ));
    }
    if intent.source_output.0.is_empty()
        || intent.focused_leaf.0.is_empty()
        || intent.focused_window.0.is_empty()
    {
        return Err(rejected(
            RejectionKind::MalformedTopology,
            "directional movement intent is malformed",
        ));
    }
    let mut seen_outputs = HashSet::new();
    for output in &snapshot.outputs {
        if output.id.0.is_empty() || !seen_outputs.insert(output.id.clone()) {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "output identities must be non-empty and unique",
            ));
        }
        if output.workspace.0.is_empty() {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "output scope must be present",
            ));
        }
    }
    let by_id: HashMap<&OutputId, &Output> = snapshot
        .outputs
        .iter()
        .map(|output| (&output.id, output))
        .collect();
    for output in &snapshot.outputs {
        for target in output.adjacent.values() {
            if target.0.is_empty() || target == &output.id || !by_id.contains_key(target) {
                return Err(rejected(
                    RejectionKind::MalformedTopology,
                    "output adjacency references an unknown, empty, or self output",
                ));
            }
        }
    }
    let Some(source) = by_id.get(&intent.source_output) else {
        return Err(rejected(
            RejectionKind::MalformedTopology,
            "source output is not present",
        ));
    };
    let source_index = snapshot
        .outputs
        .iter()
        .position(|output| output.id == intent.source_output)
        .unwrap_or(0);

    let mut ids = HashSet::new();
    let mut leaf_output = HashMap::new();
    let mut leaf_is_leaf = HashMap::new();
    for (index, output) in snapshot.outputs.iter().enumerate() {
        if let Some(tree) = &output.tree
            && let Err(message) =
                validate_node(tree, &mut ids, &mut leaf_output, index, &mut leaf_is_leaf)
        {
            return Err(rejected(RejectionKind::MalformedTopology, message));
        }
    }

    // Window associations: unique windows/leaves, reciprocal leaf links scoped
    // to the link output and workspace.
    let mut seen_windows = HashSet::new();
    let mut linked_leaves = HashSet::new();
    for link in &snapshot.windows {
        if link.window.0.is_empty() || link.leaf.0.is_empty() || link.output.0.is_empty() {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window associations must be non-empty",
            ));
        }
        if link.workspace.0.is_empty() {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window association workspace must be non-empty",
            ));
        }
        if !seen_windows.insert(link.window.clone()) {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window associations must reference each window at most once",
            ));
        }
        if !linked_leaves.insert(link.leaf.clone()) {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window associations must reference each leaf at most once",
            ));
        }
        let Some(link_output_index) = snapshot
            .outputs
            .iter()
            .position(|output| output.id == link.output)
        else {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window association references an unknown output",
            ));
        };
        match leaf_output.get(&link.leaf) {
            Some(actual) if *actual == link_output_index => {}
            _ => {
                return Err(rejected(
                    RejectionKind::MalformedTopology,
                    "window association is stale or nonreciprocal: leaf link mismatch",
                ));
            }
        }
        if leaf_is_leaf.get(&link.leaf) != Some(&true) {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window association targets a non-leaf node",
            ));
        }
        if snapshot.outputs[link_output_index].workspace != link.workspace {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "window association workspace does not match the output scope",
            ));
        }
    }
    for leaf in leaf_output.keys() {
        if leaf_is_leaf.get(leaf) == Some(&true) && !linked_leaves.contains(leaf) {
            return Err(rejected(
                RejectionKind::MalformedTopology,
                "every leaf requires exactly one window association",
            ));
        }
    }
    if !snapshot
        .windows
        .iter()
        .any(|link| link.window == intent.focused_window && link.leaf == intent.focused_leaf)
    {
        // Distinguish a focused leaf that does not exist at all (TS parity:
        // `focused-leaf-not-found`) from a stale/nonreciprocal association.
        if leaf_output.get(&intent.focused_leaf) != Some(&source_index) {
            return Err(rejected(
                RejectionKind::FocusedLeafNotFound,
                "focused leaf is not present in the source topology",
            ));
        }
        return Err(rejected(
            RejectionKind::MalformedTopology,
            "focused window association is missing, stale, or nonreciprocal",
        ));
    }

    Ok(Validated { source })
}

// ---- movement planning (mechanical translation of planLocalMove) ----

fn plan_local(intent: &MoveIntent, source: &Output, path: &[PathLevel<'_>]) -> MoveOutcome {
    if path.is_empty() {
        return MoveOutcome::Noop {
            reason: NoopReason::SingleRootLeaf,
        };
    }
    let direction_axis = Axis::for_direction(intent.direction);
    let step = step_for(intent.direction);
    // Mechanical note: the TS source loops from the deepest level outward,
    // but every branch returns on the first (deepest) iteration, so the loop
    // never advances. The engine resolves the deepest level directly with
    // identical semantics.
    let level = path.len() - 1;
    let ancestor = &path[level];
    if ancestor.axis != direction_axis {
        return MoveOutcome::Planned(MovePlan::for_operation(
            intent,
            MoveOperation::WrapPerpendicular {
                rule: Rule::R1,
                container: ancestor.group_id.clone(),
                axis: direction_axis,
            },
        ));
    }
    let neighbor_index = ancestor.child_index as i32 + step;
    let neighbor = if neighbor_index >= 0 {
        ancestor.children.get(neighbor_index as usize)
    } else {
        None
    };
    if let Some(neighbor) = neighbor {
        if ancestor.children.len() == 2 {
            match neighbor {
                Node::Leaf { id } => {
                    return MoveOutcome::Planned(MovePlan::for_operation(
                        intent,
                        MoveOperation::SwapNeighbor {
                            rule: Rule::R2a,
                            container: ancestor.group_id.clone(),
                            neighbor: id.clone(),
                        },
                    ));
                }
                Node::Group { id, axis, children } => {
                    if *axis == ancestor.axis {
                        let insertion_index = if ancestor.child_index < neighbor_index as usize {
                            0
                        } else {
                            children.len()
                        };
                        return MoveOutcome::Planned(MovePlan::for_operation(
                            intent,
                            MoveOperation::InsertIntoGroup {
                                rule: Rule::R2b,
                                container: ancestor.group_id.clone(),
                                target_group: id.clone(),
                                insertion_index,
                                insertion: Insertion::NearEdge,
                            },
                        ));
                    }
                    let target_child_index = children.len() / 2;
                    if children.len() % 2 == 0 {
                        return MoveOutcome::Planned(MovePlan::for_operation(
                            intent,
                            MoveOperation::InsertIntoGroup {
                                rule: Rule::R2b,
                                container: ancestor.group_id.clone(),
                                target_group: id.clone(),
                                insertion_index: target_child_index,
                                insertion: Insertion::Midpoint,
                            },
                        ));
                    }
                    let Some(target_child) = children.get(target_child_index) else {
                        return MoveOutcome::Noop {
                            reason: NoopReason::Boundary,
                        };
                    };
                    return MoveOutcome::Planned(MovePlan::for_operation(
                        intent,
                        MoveOperation::SplitGroupChild {
                            rule: Rule::R2b,
                            container: ancestor.group_id.clone(),
                            target_group: id.clone(),
                            target_child: target_child.id().clone(),
                            target_child_index,
                            focused_side: if step == -1 {
                                FocusedSide::First
                            } else {
                                FocusedSide::Second
                            },
                            axis: direction_axis,
                        },
                    ));
                }
            }
        }
        return MoveOutcome::Planned(MovePlan::for_operation(
            intent,
            MoveOperation::WrapNeighbor {
                rule: Rule::R2c,
                container: ancestor.group_id.clone(),
                neighbor: neighbor.id().clone(),
                focused_before_neighbor: ancestor.child_index < neighbor_index as usize,
                axis: ancestor.axis,
            },
        ));
    }
    if level == 0 {
        if !source.adjacent.contains_key(&intent.direction) {
            return MoveOutcome::Noop {
                reason: NoopReason::NoAdjacentOutput,
            };
        }
        return MoveOutcome::Noop {
            reason: NoopReason::Boundary,
        };
    }
    let Some(parent) = path.get(level - 1) else {
        return MoveOutcome::Noop {
            reason: NoopReason::Boundary,
        };
    };
    let parent_insertion_index = parent.child_index + usize::from(step == 1);
    let same_axis = parent.axis == ancestor.axis;
    MoveOutcome::Planned(MovePlan::for_operation(
        intent,
        MoveOperation::EscapeParent {
            rule: Rule::R3,
            container: ancestor.group_id.clone(),
            parent: parent.group_id.clone(),
            container_child_index: parent.child_index,
            parent_insertion_index: same_axis.then_some(parent_insertion_index),
            continuation: if same_axis {
                EscapeContinuation::None
            } else {
                EscapeContinuation::R1
            },
        },
    ))
}

/// Deterministic directional move plan for `intent` against `snapshot`.
///
/// The snapshot is borrowed and never mutated; all errors leave the input
/// observably unchanged. Full capabilities are assumed; use
/// [`plan_move_with_capabilities`] for adapter-facing gating.
#[must_use]
pub fn plan_move(snapshot: &Snapshot, intent: &MoveIntent) -> MoveOutcome {
    plan_move_with_capabilities(snapshot, intent, &Capabilities::full())
}

/// [`plan_move`] gated by adapter-declared [`Capabilities`]: an operation
/// whose [`Capability`] is not declared is refused as
/// [`RejectionKind::UnsupportedTopology`] before any plan is emitted.
#[must_use]
pub fn plan_move_with_capabilities(
    snapshot: &Snapshot,
    intent: &MoveIntent,
    capabilities: &Capabilities,
) -> MoveOutcome {
    let validated = match validate_snapshot(snapshot, intent) {
        Ok(validated) => validated,
        Err(outcome) => return outcome,
    };
    let Some(tree) = &validated.source.tree else {
        return MoveOutcome::Noop {
            reason: NoopReason::Boundary,
        };
    };
    let Some(path) = path_to(tree, &intent.focused_leaf) else {
        return rejected(
            RejectionKind::FocusedLeafNotFound,
            "focused leaf is not present in the source topology",
        );
    };
    let local = plan_local(intent, validated.source, &path);
    let boundary_exhausted = matches!(
        local,
        MoveOutcome::Noop {
            reason: NoopReason::Boundary,
        }
    );
    if !boundary_exhausted {
        return gate(local, capabilities);
    }
    if path.len() != 1 || !matches!(tree, Node::Group { .. }) {
        return gate(local, capabilities);
    }
    let Some(target_id) = validated.source.adjacent.get(&intent.direction) else {
        return MoveOutcome::Noop {
            reason: NoopReason::NoAdjacentOutput,
        };
    };
    let Some(target) = snapshot
        .outputs
        .iter()
        .find(|output| &output.id == target_id)
    else {
        return MoveOutcome::Noop {
            reason: NoopReason::NoAdjacentOutput,
        };
    };
    if target.workspace != validated.source.workspace {
        return MoveOutcome::Noop {
            reason: NoopReason::NoAdjacentOutput,
        };
    }
    let source_root_child_index = path[0].child_index;
    let outcome = MoveOutcome::Planned(MovePlan::for_operation(
        intent,
        MoveOperation::CrossOutput {
            rule: Rule::R4,
            target_output: target.id.clone(),
            source_root_child_index,
            target: if target.tree.is_none() {
                CrossOutputTarget::Empty
            } else {
                CrossOutputTarget::Occupied
            },
        },
    ));
    gate(outcome, capabilities)
}

fn gate(outcome: MoveOutcome, capabilities: &Capabilities) -> MoveOutcome {
    match outcome {
        MoveOutcome::Planned(plan) if !capabilities.supports(plan.required_capability) => rejected(
            RejectionKind::UnsupportedTopology,
            format!(
                "adapter does not declare required capability {:?}; refusing before plan emission",
                plan.required_capability
            ),
        ),
        other => other,
    }
}

// ---- tree-relative focus (analogue of planCosmicFocus) ----

fn check_focus_node(node: &Node, seen: &mut HashSet<NodeId>) -> bool {
    if node.id().0.is_empty() || !seen.insert(node.id().clone()) {
        return false;
    }
    match node {
        Node::Leaf { .. } => true,
        Node::Group { children, .. } => {
            if children.len() < 2 {
                return false;
            }
            children.iter().all(|child| check_focus_node(child, seen))
        }
    }
}

fn descend_focus_target(mut current: &Node, direction: Direction) -> Option<FocusPlan> {
    let mut route = vec![current.id().clone()];
    loop {
        match current {
            Node::Leaf { id } => {
                return Some(FocusPlan::Focused {
                    leaf: id.clone(),
                    route,
                });
            }
            Node::Group { axis, children, .. } => {
                if children.is_empty() {
                    return None;
                }
                let child = if *axis == Axis::for_direction(direction) {
                    if step_for(direction) == 1 {
                        children.first()
                    } else {
                        children.last()
                    }
                } else {
                    // Deterministic adaptation: without compositor geometry,
                    // descend perpendicular groups to their first child
                    // deterministically (never claimed as upstream
                    // geometric-nearest parity).
                    children.first()
                };
                current = child?;
                route.push(current.id().clone());
            }
        }
    }
}

/// Tree-relative directional focus: climb ancestors until a matching-axis
/// sibling exists in direction `direction`, then descend (same-axis edge
/// child; perpendicular first child). Exhausted edges report [`FocusPlan::Edge`].
/// Fail-closed (`None`) on malformed, duplicate, single-child, or missing-leaf
/// topology. Analogue of `planCosmicFocus`.
#[must_use]
pub fn plan_focus(tree: &Node, focused_leaf: &NodeId, direction: Direction) -> Option<FocusPlan> {
    if focused_leaf.0.is_empty() {
        return None;
    }
    if !check_focus_node(tree, &mut HashSet::new()) {
        return None;
    }
    let path = path_to(tree, focused_leaf)?;
    if path.is_empty() {
        return Some(FocusPlan::Edge);
    }
    let wanted = Axis::for_direction(direction);
    let step = step_for(direction);
    for ancestor in path.iter().rev() {
        if ancestor.axis != wanted {
            continue;
        }
        let sibling_index = ancestor.child_index as i32 + step;
        let sibling = if sibling_index >= 0 {
            ancestor.children.get(sibling_index as usize)
        } else {
            None
        };
        let Some(sibling) = sibling else { continue };
        return descend_focus_target(sibling, direction);
    }
    Some(FocusPlan::Edge)
}

// ---- proportional fraction sizing (analogue of cosmic-move-adapter.ts) ----

fn valid_shares(existing: &[f64]) -> bool {
    !existing.is_empty()
        && existing
            .iter()
            .all(|share| *share > 0.0 && share.is_finite())
        && existing.iter().sum::<f64>() > 0.0
}

/// Entrant takes an equal share; survivors scale proportionally preserving
/// ratios. Source: `cosmicInsertShares` (upstream `Data::add_window`).
/// Fail-closed (`None`) on malformed input.
#[must_use]
pub fn insert_shares(existing: &[f64], index: usize) -> Option<Vec<f64>> {
    if !valid_shares(existing) || index > existing.len() {
        return None;
    }
    let total: f64 = existing.iter().sum();
    let count = existing.len() + 1;
    let entrant = total / count as f64;
    let remainder = total - entrant;
    let scaled: Vec<f64> = existing
        .iter()
        .map(|share| (share / total) * remainder)
        .collect();
    let mut result = Vec::with_capacity(count);
    result.extend_from_slice(&scaled[..index]);
    result.push(entrant);
    result.extend_from_slice(&scaled[index..]);
    Some(result)
}

/// Removed share redistributes proportionally. Source: `cosmicRemoveShares`
/// (upstream `Data::remove_window`). Fail-closed (`None`) on malformed input.
#[must_use]
pub fn remove_shares(existing: &[f64], index: usize) -> Option<Vec<f64>> {
    if existing.len() < 2 || index >= existing.len() || !valid_shares(existing) {
        return None;
    }
    let removed = existing[index];
    let remaining: Vec<f64> = existing
        .iter()
        .enumerate()
        .filter(|(position, _)| *position != index)
        .map(|(_, share)| *share)
        .collect();
    let remaining_sum: f64 = remaining.iter().sum();
    if remaining_sum <= 0.0 {
        return None;
    }
    Some(
        remaining
            .iter()
            .map(|share| share + (share / remaining_sum) * removed)
            .collect(),
    )
}

/// Half-half new-group shares. Source: `cosmicHalfSplit` (upstream
/// `Data::new_group`).
#[must_use]
pub const fn half_split() -> [f64; 2] {
    [0.5, 0.5]
}

#[cfg(test)]
mod tests;
