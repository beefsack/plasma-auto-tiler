//! Session world state: durable domain, window-membership, focus-MRU, and
//! exception types plus world-oriented [`super::Session`] accessors.
//!
//! Responsibility: own the authoritative world (logical domains, tiled
//! membership links, domain-scoped focus with MRU stacks/last-active,
//! deferred exceptions and retained float geometry) and read-only world
//! queries/validation. Operation families (lifecycle, move, focus, resize,
//! drag, float, workspace) and near-layout fit stay outside this module and
//! call back through these accessors.

use std::collections::{BTreeMap, BTreeSet};

use crate::contract::Observation;
use crate::directional::{
    Direction, Node, NodeId, OutputId, Snapshot, WindowId, WindowLink, WorkspaceId,
};
use crate::geometry::Rect;

/// Logical output domain: separate output/workspace scope with explicit
/// portable bounds and gap for the deterministic projector, plus configured
/// logical output adjacency for R4 planning. Adjacency maps a
/// portable [`Direction`] to a neighboring [`OutputId`]; the target domain is
/// the adjacent output's currently selected logical workspace (its domain
/// workspace, which may differ from the source workspace). Targets resolve as
/// `(target_output, target_workspace)` domain keys and are validated strictly
/// reciprocal/known/non-self at [`super::Session::new`]. No platform enums or native
/// data appear here.
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

/// One adapter-observed window with explicit exception flags plus the
/// ephemeral client size hints (AR12). Hints are advisory per-observation
/// inputs: they shape projection and clamp acceptance but never participate
/// in identity, membership, or pre/post-image matching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedWindow {
    pub window: WindowId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub floating: bool,
    pub fullscreen: bool,
    pub maximized: bool,
    pub sticky: bool,
    pub hints: crate::size_hints::WindowSizeHints,
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

/// Stored exception record for a deferred window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExceptionRecord {
    pub window: WindowId,
    pub output: OutputId,
    pub workspace: WorkspaceId,
    pub flags: ExceptionFlags,
    /// Session-local floating placement. Never participates in tree geometry
    /// or fresh admission.
    pub floating_geometry: Option<Rect>,
}

impl super::Session {
    /// Logical domains in deterministic construction order.
    #[must_use]
    pub fn domains(&self) -> &[OutputDomain] {
        &self.domains
    }

    /// Update one retained domain's projected work area without changing its
    /// topology, shares, membership, focus, or accepted revision.
    pub fn reproject_domain(&mut self, key: &DomainKey, bounds: Rect) {
        if let Some(domain) = self.domains.iter_mut().find(|domain| &domain.key() == key) {
            domain.bounds = bounds;
        }
    }

    /// Deliberate gap-update reprojection for one retained domain: adopt new
    /// projected work-area bounds plus a new inner gap while preserving
    /// topology, shares, membership, focus, exceptions, and accepted revision.
    /// Atomic: any validation failure leaves state exactly as before (`false`,
    /// no mutation). Refuses an out-of-range gap, invalid bounds,
    /// divergence, pending/drag residue, or an unknown domain. Outer-gap
    /// state lives in the Planner map, not here.
    pub fn update_domain_gaps(&mut self, key: &DomainKey, bounds: Rect, gap: i32) -> bool {
        if !(0..=64).contains(&gap) {
            return false;
        }
        if bounds.w <= 0 || bounds.h <= 0 {
            return false;
        }
        if self.reconciler.divergence().is_some() {
            return false;
        }
        if self.has_pending() || self.has_pending_desired() {
            return false;
        }
        if self.drag.is_some() {
            return false;
        }
        let index = match self.domains.iter().position(|d| &d.key() == key) {
            Some(index) => index,
            None => return false,
        };
        let backup = self.clone();
        self.domains[index].bounds = bounds;
        self.domains[index].gap = gap;
        if self.validate_current_topology() {
            return true;
        }
        *self = backup;
        false
    }

    /// Portable output relocation for one retained domain: move the domain
    /// key from `source` to `target` (same workspace, different output)
    /// preserving topology, shares, focus, exceptions, float geometry, and
    /// accepted revision. Updates domain bounds/gap plus every window link
    /// and exception homed on the source. Atomic: any validation failure
    /// leaves revision, gap, tree/shares, windows, exceptions, and focus
    /// exactly as before (`false`, no mutation). Refuses on workspace
    /// mismatch, same output, unknown source, existing target,
    /// pending/drag/divergence residue, or invalid bounds/gap. Exception
    /// classes (`flags`, `floating_geometry`) are never altered, only the
    /// homing output id.
    pub fn relocate_domain(
        &mut self,
        source: &DomainKey,
        target: &DomainKey,
        bounds: Rect,
        gap: i32,
    ) -> bool {
        if source == target {
            return false;
        }
        if source.workspace != target.workspace {
            return false;
        }
        if source.output == target.output {
            return false;
        }
        if bounds.w <= 0 || bounds.h <= 0 {
            return false;
        }
        if gap < 0 || gap > 64 {
            return false;
        }
        if self.reconciler.divergence().is_some() {
            return false;
        }
        if self.has_pending() || self.has_pending_desired() {
            return false;
        }
        if self.drag.is_some() {
            return false;
        }
        if self.trees.contains_key(target) {
            return false;
        }
        if self.domains.iter().find(|d| &d.key() == target).is_some() {
            return false;
        }
        let source_index = match self.domains.iter().position(|d| &d.key() == source) {
            Some(index) => index,
            None => return false,
        };
        if !self.validate_current_topology() {
            return false;
        }
        if !self.trees.contains_key(source) {
            return false;
        }
        // Atomic mutation with rollback: snapshot every mutated field so the
        // trailing topology validation (or any unexpected failure) restores
        // the exact prior revision, gap, tree/shares, windows, exceptions,
        // and focus instead of leaving partial state.
        let backup = self.clone();
        let tree = match self.trees.remove(source) {
            Some(tree) => tree,
            None => return false,
        };
        // Update domain identity/bounds/gap in place, preserving order.
        self.domains[source_index].id = target.output.clone();
        self.domains[source_index].bounds = bounds;
        self.domains[source_index].gap = gap;
        self.trees.insert(target.clone(), tree);
        for link in self.windows.values_mut() {
            if link.output == source.output && link.workspace == source.workspace {
                link.output = target.output.clone();
            }
        }
        for record in self.exceptions.values_mut() {
            if record.output == source.output && record.workspace == source.workspace {
                record.output = target.output.clone();
            }
        }
        if self.focused_domain.as_ref() == Some(source) {
            self.focused_domain = Some(target.clone());
        }
        if let Some(stack) = self.focus_stack.remove(source) {
            self.focus_stack.insert(target.clone(), stack);
        }
        if let Some(active) = self.last_active.remove(source) {
            self.last_active.insert(target.clone(), active);
        }
        // Pending desired mirrors committed state when present; relocation
        // already refused pending, so no pendingDesired update is needed.
        if self.validate_current_topology() {
            return true;
        }
        *self = backup;
        false
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

    /// Synchronize retained focus from an ordinary activation of a known
    /// tiled window in an existing domain.
    ///
    /// Only updates the focused domain/leaf; topology, membership, revision,
    /// and pending state are untouched. Fails closed (`false`, no mutation)
    /// on divergence, pending/drag residue, unknown domains, malformed
    /// topology, or unknown/exception/cross-domain windows. Callers must
    /// still run the full directional proposal so ownership, observation
    /// completeness, and capability validation apply unchanged.
    pub fn sync_focus_from_window(&mut self, domain: &DomainKey, window: &WindowId) -> bool {
        if self.reconciler.divergence().is_some() {
            return false;
        }
        if self.has_pending() || self.drag.is_some() {
            return false;
        }
        if self.domains.iter().find(|d| &d.key() == domain).is_none() {
            return false;
        }
        if !self.validate_current_topology() {
            return false;
        }
        let Some(link) = self.windows.get(window) else {
            return false;
        };
        if link.output != domain.output || link.workspace != domain.workspace {
            return false;
        }
        let Some(tree) = self.trees.get(domain).cloned().flatten() else {
            return false;
        };
        if !super::collect_leaves(&tree).contains(&link.leaf) {
            return false;
        }
        self.focused_domain = Some(domain.clone());
        self.focused_leaf = Some(link.leaf.clone());
        self.focus_stack = self.updated_focus_stack(
            &self.focused_domain,
            &self.focused_leaf,
            &self.trees,
            &self.windows,
        );
        true
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

    /// Retained intentional-float geometry, if this session owns that state.
    #[must_use]
    pub fn floating_geometry(&self, window: &WindowId) -> Option<Rect> {
        self.exceptions
            .get(window)
            .and_then(|record| record.floating_geometry)
    }

    /// Durable retained intentional-float geometry that survives unfloat. A
    /// window keeps its last floating placement here while tiled, so the next
    /// float can select it instead of recomputing the centered fallback.
    #[must_use]
    pub fn retained_float_geometry(&self, window: &WindowId) -> Option<Rect> {
        self.retained_float_geometry.get(window).copied()
    }

    /// The intentional-float rectangle staged by the pending plan, if any.
    /// Non-empty only for a tiled-to-float transition; unfloat clears the
    /// exception so this returns `None`.
    #[must_use]
    pub fn pending_float_geometry(&self, window: &WindowId) -> Option<Rect> {
        self.pending_desired
            .as_ref()
            .and_then(|desired| desired.exceptions.get(window))
            .and_then(|record| record.floating_geometry)
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
                // Exceptions are never projected: hints stay empty.
                hints: crate::size_hints::WindowSizeHints::none(),
            })
            .collect()
    }

    pub(super) fn snapshot_for(
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

    pub(super) fn domain_for(
        &self,
        output: &OutputId,
        workspace: &WorkspaceId,
    ) -> Option<&OutputDomain> {
        self.domains
            .iter()
            .find(|d| &d.id == output && &d.workspace == workspace)
    }

    pub(super) fn all_node_ids(&self) -> BTreeSet<NodeId> {
        let mut ids = BTreeSet::new();
        for tree in self.trees.values().flatten() {
            super::collect_node_ids(tree, &mut ids);
        }
        ids
    }

    pub(super) fn validate_current_topology(&self) -> bool {
        super::validate_topology(
            &self.domains,
            &self.trees,
            &self.windows,
            &self.exceptions,
            &self.focused_domain,
            &self.focused_leaf,
        )
    }

    pub(super) fn eligible_focus_in(&self, key: &DomainKey) -> Option<NodeId> {
        if self.focused_domain.as_ref() != Some(key) {
            return None;
        }
        let focused = self.focused_leaf.clone()?;
        let tree = self.trees.get(key).cloned().flatten()?;
        if super::collect_leaves(&tree).contains(&focused) {
            let link_holds = self.windows.values().any(|l| {
                l.leaf == focused && l.output == key.output && l.workspace == key.workspace
            });
            if link_holds {
                return Some(focused);
            }
        }
        None
    }

    pub(super) fn focus_resolves(
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
        if !super::collect_leaves(&tree).contains(leaf) {
            return false;
        }
        windows.values().any(|l| {
            &l.leaf == leaf && l.output == domain.output && l.workspace == domain.workspace
        })
    }

    pub(super) fn focused_window_for(&self, leaf: &NodeId, key: &DomainKey) -> Option<WindowId> {
        self.windows
            .values()
            .find(|l| &l.leaf == leaf && l.output == key.output && l.workspace == key.workspace)
            .map(|l| l.window.clone())
    }

    pub(super) fn remembered_leaf(&self, target: &DomainKey) -> Option<NodeId> {
        let leaf = self.last_active.get(target)?.clone();
        let tree = self.trees.get(target).cloned().flatten()?;
        if !super::collect_leaves(&tree).contains(&leaf) {
            return None;
        }
        self.windows
            .values()
            .any(|l| l.leaf == leaf && l.output == target.output && l.workspace == target.workspace)
            .then_some(leaf)
    }

    pub(super) fn focus_stack_fallback(
        &self,
        domain: &DomainKey,
        trees: &BTreeMap<DomainKey, Option<Node>>,
        windows: &BTreeMap<WindowId, WindowLink>,
    ) -> Option<NodeId> {
        self.focus_stack.get(domain)?.iter().rev().find_map(|leaf| {
            self.focus_resolves(&Some(domain.clone()), &Some(leaf.clone()), trees, windows)
                .then(|| leaf.clone())
        })
    }

    pub(super) fn updated_focus_stack(
        &self,
        focus_domain: &Option<DomainKey>,
        focus_leaf: &Option<NodeId>,
        trees: &BTreeMap<DomainKey, Option<Node>>,
        windows: &BTreeMap<WindowId, WindowLink>,
    ) -> BTreeMap<DomainKey, Vec<NodeId>> {
        let mut next = self.focus_stack.clone();
        next.retain(|domain, leaves| {
            leaves.retain(|leaf| {
                self.focus_resolves(&Some(domain.clone()), &Some(leaf.clone()), trees, windows)
            });
            !leaves.is_empty()
        });
        if let (Some(domain), Some(leaf)) = (focus_domain, focus_leaf) {
            let leaves = next.entry(domain.clone()).or_default();
            leaves.retain(|known| known != leaf);
            leaves.push(leaf.clone());
        }
        next
    }

    pub(super) fn updated_last_active(
        &self,
        focus_domain: &Option<DomainKey>,
        focus_leaf: &Option<NodeId>,
        trees: &BTreeMap<DomainKey, Option<Node>>,
        windows: &BTreeMap<WindowId, WindowLink>,
    ) -> BTreeMap<DomainKey, NodeId> {
        let mut next = self.last_active.clone();
        if let (Some(d), Some(l)) = (focus_domain, focus_leaf)
            && let Some(tree) = trees.get(d).cloned().flatten()
            && super::collect_leaves(&tree).contains(l)
            && windows
                .values()
                .any(|w| &w.leaf == l && w.output == d.output && w.workspace == d.workspace)
        {
            next.insert(d.clone(), l.clone());
        }
        next
    }
}
