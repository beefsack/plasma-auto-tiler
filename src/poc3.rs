//! POC3: in-memory single-output logical tiling session for exactly three windows.
//!
//! Platform-neutral domain. No KWin types, names, or native concepts appear
//! here: windows are opaque ids, scopes are opaque aliases, and rollback
//! metadata is an opaque adapter-only envelope the engine stores and returns
//! without interpreting. Native realization (tiling, focus, restoration,
//! window closure) is entirely adapter-side; the engine only plans logical
//! state and emits transactional intents that are explicitly non-atomic.
//!
//! Relationship to POC1/POC2: focus navigation reuses the POC1 tree-relative
//! COSMIC climb/descend concept via [`crate::directional::plan_focus`], and
//! structural moves reuse the R2a-swap / R3-reparent planning concepts with
//! the POC1 proportional-share helpers mirrored as exact integer weights.
//! POC3 deliberately does NOT require native Custom Tile capabilities: its
//! only capabilities are adapter-asserted eligibility (`untiled_asserted`),
//! project-owned disposability (`disposable`), and restoration support
//! (`restore_capable`).
//!
//! Transaction model: dispatching an intent (start/focus/move) never mutates
//! verified state. The adapter actuates, verifies natively, then reports via
//! [`Poc3Engine::complete`]. Only `complete` with `applied` advances the
//! revision; `complete` with `divergent` records divergence and fails closed.
//! Dispatch is never completion.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::directional::{Axis, Direction, FocusPlan, Node, NodeId, plan_focus};

/// Exact enrolled window count: fixed max 3 and exactly 3 on start.
pub const POC3_WINDOW_COUNT: usize = 3;
/// Fixed configurable gap bound (inclusive).
pub const POC3_MAX_GAP: i32 = 64;
/// Revision bound; completions past it are refused fail-closed.
pub const POC3_MAX_REVISION: u64 = 1_000_000;
/// Usable-rectangle side bounds (inclusive).
pub const POC3_MIN_SIDE: i32 = 1;
pub const POC3_MAX_SIDE: i32 = 16_384;
/// Usable-rectangle origin bounds (inclusive).
pub const POC3_MIN_ORIGIN: i32 = -16_384;
pub const POC3_MAX_ORIGIN: i32 = 16_384;

/// Logical pixel rectangle. Coordinates are adapter-supplied; the engine only
/// subdivides them deterministically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Desired geometry for one enrolled window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DesiredWindow {
    pub id: String,
    pub rect: Rect,
}

/// Ordered N-ary split/group tree. Leaves are enrolled window ids; groups
/// carry one positive integer weight per child (nested shares).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tree {
    Leaf {
        window: String,
    },
    Group {
        axis: Axis,
        children: Vec<Tree>,
        shares: Vec<u64>,
    },
}

/// One enrolled window: opaque id, opaque native scope alias, and an opaque
/// adapter-only rollback envelope (never interpreted by the engine).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrolledWindow {
    pub id: String,
    pub scope: String,
    pub rollback: String,
}

/// User-selected cleanup model for the session. Only the literal
/// `close-disposable` closure-only model is supported: closure may happen
/// only on explicit `stop` for a started session with this model. The engine
/// stores the selection as an adapter-supplied assertion; it is not native
/// proof of disposability (eligibility remains adapter-asserted per intent).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupModel {
    CloseDisposable,
}

impl CleanupModel {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CloseDisposable => "close-disposable",
        }
    }

    #[must_use]
    pub fn parse(literal: &str) -> Option<Self> {
        match literal {
            "close-disposable" => Some(Self::CloseDisposable),
            _ => None,
        }
    }
}

/// Validated start parameters (validation of opacity/bounds happens in the
/// contract layer; the engine enforces structural invariants).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartParams {
    pub owner: String,
    pub generation: String,
    pub scope: String,
    pub usable: Rect,
    pub gap: i32,
    pub windows: Vec<EnrolledWindow>,
    pub session_rollback: String,
    pub untiled_asserted: bool,
    pub disposable: bool,
    pub restore_capable: bool,
    pub cleanup: CleanupModel,
}

/// Adapter-reported actuation result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionResult {
    Applied,
    Divergent,
}

/// Fixed divergent reasons for fail-closed recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DivergentReason {
    GeometryMismatch,
    WindowMissing,
    FocusUnverified,
    PartialApplication,
}

impl DivergentReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::GeometryMismatch => "geometry-mismatch",
            Self::WindowMissing => "window-missing",
            Self::FocusUnverified => "focus-unverified",
            Self::PartialApplication => "partial-application",
        }
    }
}

/// Fixed engine failures. The contract layer maps these to redacted
/// fixed-string replies that never echo input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Poc3Error {
    SessionActive,
    NoSession,
    Diverged,
    PendingExists,
    NoPending,
    StaleRevision,
    OwnerMismatch,
    GenerationMismatch,
    WindowCount,
    DuplicateId,
    ScopeMismatch,
    Eligibility,
    GeometryBounds,
    GapBounds,
    RevisionExhausted,
}

impl Poc3Error {
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::SessionActive => "session-active",
            Self::NoSession => "no-session",
            Self::Diverged => "divergent-fail-closed",
            Self::PendingExists => "pending-intent-exists",
            Self::NoPending => "no-pending-intent",
            Self::StaleRevision => "stale-revision",
            Self::OwnerMismatch => "owner-mismatch",
            Self::GenerationMismatch => "generation-mismatch",
            Self::WindowCount => "window-count",
            Self::DuplicateId => "duplicate-id",
            Self::ScopeMismatch => "scope-mismatch",
            Self::Eligibility => "eligibility-unasserted",
            Self::GeometryBounds => "geometry-bounds",
            Self::GapBounds => "gap-bounds",
            Self::RevisionExhausted => "revision-exhausted",
        }
    }

    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::SessionActive => "a tiling session is already active",
            Self::NoSession => "no tiling session is active",
            Self::Diverged => "session recorded divergence and is fail-closed",
            Self::PendingExists => "complete or stop the pending intent first",
            Self::NoPending => "no dispatched intent awaits completion",
            Self::StaleRevision => "revision does not match the current session revision",
            Self::OwnerMismatch => "owner token does not pin the active session",
            Self::GenerationMismatch => "generation does not match the active session",
            Self::WindowCount => "session requires exactly three enrolled windows",
            Self::DuplicateId => "enrolled window ids must be unique",
            Self::ScopeMismatch => "all scope aliases must match the session scope",
            Self::Eligibility => "adapter must assert untiled eligibility and disposable windows",
            Self::GeometryBounds => "usable geometry is out of bounds",
            Self::GapBounds => "gap is out of bounds",
            Self::RevisionExhausted => "revision bound reached; stop the session",
        }
    }
}

/// Structural operation description (reply-facing). `rule` names the POC1
/// concept reused (`R2a` swap, `R3` reparent); it is an analogy for adapter
/// verification, not a native capability requirement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OperationDesc {
    pub kind: &'static str,
    pub rule: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub neighbor: Option<String>,
}

/// Adapter capability echo carried by every intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CapabilityEcho {
    pub untiled_asserted: bool,
    pub disposable: bool,
    pub restore_capable: bool,
}

/// Rollback requirement envelope description. The engine never carries the
/// envelope contents in intents; it only instructs retention.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RollbackRequirement {
    pub retain_envelopes: bool,
    pub note: &'static str,
}

/// Nested share view parallel to the tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SharesView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<&'static str>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shares: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<SharesView>,
}

/// Versioned transactional intent/batch. Explicitly non-atomic: the adapter
/// must actuate, verify postconditions natively, retain its rollback
/// envelopes, and report via `complete`. Dispatch is never completion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IntentView {
    pub base_revision: u64,
    pub next_revision: u64,
    pub atomic: bool,
    pub adapter_verification_required: bool,
    pub preconditions: Vec<&'static str>,
    pub capabilities: CapabilityEcho,
    pub cleanup_model: &'static str,
    pub operation: OperationDesc,
    pub topology: String,
    pub shares: SharesView,
    pub focus: String,
    pub desired: Vec<DesiredWindow>,
    pub rollback_required: RollbackRequirement,
}

/// Noop outcome view (edge navigation): current state, no pending intent, no
/// completion required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoopView {
    pub reason: &'static str,
    pub revision: u64,
    pub topology: String,
    pub focus: String,
    pub desired: Vec<DesiredWindow>,
}

/// Focus/move dispatch outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchOutcome {
    Planned(Box<IntentView>),
    Noop(NoopView),
}

/// Completion report view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompletionView {
    pub result: &'static str,
    pub revision: u64,
    pub divergent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub desired: Vec<DesiredWindow>,
}

/// Redacted bounded status. Never carries rollback envelope contents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatusView {
    pub state: &'static str,
    pub revision: u64,
    pub pending: bool,
    pub divergent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_model: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub divergence_reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enrolled: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology: Option<String>,
}

/// Adapter cleanup directive. `ids` is always exactly the originally enrolled
/// set; closure is only ever requested for identified enrolled windows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CleanupView {
    pub action: &'static str,
    pub ids: Vec<String>,
    pub revision: u64,
    pub abandoned_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub envelopes: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_envelope: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Session {
    owner: String,
    generation: String,
    scope: String,
    usable: Rect,
    gap: i32,
    tree: Tree,
    focus: String,
    enrolled: Vec<EnrolledWindow>,
    session_rollback: String,
    capabilities: CapabilityEcho,
    cleanup: CleanupModel,
    revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Pending {
    base_revision: u64,
    tree: Tree,
    focus: String,
    operation: OperationDesc,
    preconditions: Vec<&'static str>,
}

/// In-memory single-session engine. Starts disabled with no session; all
/// state lives in this process memory only.
#[derive(Debug, Default)]
pub struct Poc3Engine {
    session: Option<Session>,
    pending: Option<Pending>,
    diverged: bool,
    divergence_reason: Option<DivergentReason>,
}

impl Poc3Engine {
    #[must_use]
    pub fn new() -> Self {
        Self {
            session: None,
            pending: None,
            diverged: false,
            divergence_reason: None,
        }
    }

    /// Start/enroll snapshot: exactly 3 opaque ids with one shared scope
    /// alias, adapter-asserted eligibility, usable geometry, and fixed gap.
    /// Installs deterministic `H[A,V[B,C]]` layout at revision 0 with a
    /// pending init intent the adapter must actuate and complete.
    pub fn start(&mut self, params: StartParams) -> Result<IntentView, Poc3Error> {
        if self.session.is_some() {
            return Err(Poc3Error::SessionActive);
        }
        if params.windows.len() != POC3_WINDOW_COUNT {
            return Err(Poc3Error::WindowCount);
        }
        let mut ids: Vec<&str> = params.windows.iter().map(|w| w.id.as_str()).collect();
        ids.sort_unstable();
        for pair in ids.windows(2) {
            if pair[0] == pair[1] {
                return Err(Poc3Error::DuplicateId);
            }
        }
        if params.windows.iter().any(|w| w.scope != params.scope) {
            return Err(Poc3Error::ScopeMismatch);
        }
        if !params.untiled_asserted || !params.disposable {
            return Err(Poc3Error::Eligibility);
        }
        if !rect_in_bounds(params.usable) {
            return Err(Poc3Error::GeometryBounds);
        }
        if !(0..=POC3_MAX_GAP).contains(&params.gap) {
            return Err(Poc3Error::GapBounds);
        }
        let (a, b, c) = (
            params.windows[0].id.clone(),
            params.windows[1].id.clone(),
            params.windows[2].id.clone(),
        );
        let tree = Tree::Group {
            axis: Axis::Horizontal,
            children: vec![
                Tree::Leaf { window: a.clone() },
                Tree::Group {
                    axis: Axis::Vertical,
                    children: vec![
                        Tree::Leaf { window: b.clone() },
                        Tree::Leaf { window: c.clone() },
                    ],
                    shares: vec![1, 1],
                },
            ],
            shares: vec![1, 1],
        };
        let capabilities = CapabilityEcho {
            untiled_asserted: true,
            disposable: true,
            restore_capable: params.restore_capable,
        };
        let session = Session {
            owner: params.owner,
            generation: params.generation,
            scope: params.scope,
            usable: params.usable,
            gap: params.gap,
            tree: tree.clone(),
            focus: a.clone(),
            enrolled: params.windows,
            session_rollback: params.session_rollback,
            capabilities,
            cleanup: params.cleanup,
            revision: 0,
        };
        self.session = Some(session);
        self.diverged = false;
        self.divergence_reason = None;
        self.pending = Some(Pending {
            base_revision: 0,
            tree,
            focus: a,
            operation: OperationDesc {
                kind: "init",
                rule: "INIT",
                target: None,
                neighbor: None,
            },
            preconditions: vec![
                "session-owner-pinned",
                "revision-match",
                "adapter-asserted-eligibility",
                "adapter-must-verify-postconditions",
            ],
        });
        Ok(self
            .intent_view()
            .expect("pending intent was just installed"))
    }

    /// COSMIC directional focus navigation (tree-relative climb/descend via
    /// the POC1 focus planner). Plans only; verified state is untouched.
    pub fn dispatch_focus(
        &mut self,
        owner: &str,
        generation: &str,
        expected_revision: u64,
        direction: Direction,
    ) -> Result<DispatchOutcome, Poc3Error> {
        let session = self.checked_session(owner, generation, expected_revision)?;
        let target = focus_neighbor(&session.tree, &session.focus, direction);
        match target {
            None => Ok(DispatchOutcome::Noop(self.noop_view("edge"))),
            Some(leaf) => {
                let pending = Pending {
                    base_revision: session.revision,
                    tree: session.tree.clone(),
                    focus: leaf.clone(),
                    operation: OperationDesc {
                        kind: "focus",
                        rule: "FOCUS",
                        target: Some(leaf),
                        neighbor: None,
                    },
                    preconditions: vec![
                        "session-active",
                        "owner-pinned",
                        "revision-match",
                        "focus-target-occupied",
                        "adapter-must-verify-postconditions",
                    ],
                };
                self.pending = Some(pending);
                Ok(DispatchOutcome::Planned(Box::new(
                    self.intent_view()
                        .expect("pending intent was just installed"),
                )))
            }
        }
    }

    /// Directional structural move: same-group neighbor swap (R2a concept) or
    /// cross-group reparent with singleton collapse (R3 concept). Plans only.
    pub fn dispatch_move(
        &mut self,
        owner: &str,
        generation: &str,
        expected_revision: u64,
        direction: Direction,
    ) -> Result<DispatchOutcome, Poc3Error> {
        let session = self.checked_session(owner, generation, expected_revision)?;
        let target = focus_neighbor(&session.tree, &session.focus, direction);
        let Some(target) = target else {
            return Ok(DispatchOutcome::Noop(self.noop_view("edge")));
        };
        if target == session.focus {
            return Ok(DispatchOutcome::Noop(self.noop_view("edge")));
        }
        let Some((tree, operation)) = apply_move(&session.tree, &session.focus, &target, direction)
        else {
            return Ok(DispatchOutcome::Noop(self.noop_view("edge")));
        };
        let focus = session.focus.clone();
        let pending = Pending {
            base_revision: session.revision,
            tree,
            focus,
            operation,
            preconditions: vec![
                "session-active",
                "owner-pinned",
                "revision-match",
                "move-membership-verified",
                "adapter-must-verify-postconditions",
            ],
        };
        self.pending = Some(pending);
        Ok(DispatchOutcome::Planned(Box::new(
            self.intent_view()
                .expect("pending intent was just installed"),
        )))
    }

    /// Actuation report. `applied` installs the pending desired state and
    /// advances the revision; `divergent` records divergence and fails closed.
    pub fn complete(
        &mut self,
        owner: &str,
        generation: &str,
        expected_revision: u64,
        result: CompletionResult,
        reason: Option<DivergentReason>,
    ) -> Result<CompletionView, Poc3Error> {
        if self.diverged {
            return Err(Poc3Error::Diverged);
        }
        let session = self.active_session(owner, generation, expected_revision)?;
        let pending = self.pending.clone().ok_or(Poc3Error::NoPending)?;
        if pending.base_revision != session.revision {
            return Err(Poc3Error::StaleRevision);
        }
        if session.revision >= POC3_MAX_REVISION {
            return Err(Poc3Error::RevisionExhausted);
        }
        match result {
            CompletionResult::Applied => {
                let session = self.session.as_mut().expect("session is active");
                session.tree = pending.tree;
                session.focus = pending.focus;
                session.revision = pending.base_revision + 1;
                self.pending = None;
                let session = self.session.as_ref().expect("session is active");
                Ok(CompletionView {
                    result: "applied",
                    revision: session.revision,
                    divergent: false,
                    focus: Some(session.focus.clone()),
                    topology: Some(topology_string(&session.tree)),
                    desired: desired_rects(&session.tree, session.usable, session.gap),
                })
            }
            CompletionResult::Divergent => {
                self.pending = None;
                self.diverged = true;
                self.divergence_reason = reason;
                let revision = self.session.as_ref().expect("session is active").revision;
                Ok(CompletionView {
                    result: "diverged-recorded",
                    revision,
                    divergent: true,
                    focus: None,
                    topology: None,
                    desired: Vec::new(),
                })
            }
        }
    }

    /// Redacted bounded status. Always available, including when disabled or
    /// divergent. Never carries rollback envelope contents.
    #[must_use]
    pub fn status(&self) -> StatusView {
        match &self.session {
            None => StatusView {
                state: "disabled",
                revision: 0,
                pending: false,
                divergent: false,
                cleanup_model: None,
                divergence_reason: None,
                focus: None,
                enrolled: Vec::new(),
                topology: None,
            },
            Some(session) => StatusView {
                state: if self.diverged { "divergent" } else { "active" },
                revision: session.revision,
                pending: self.pending.is_some(),
                divergent: self.diverged,
                cleanup_model: Some(session.cleanup.as_str()),
                divergence_reason: self.divergence_reason.map(DivergentReason::as_str),
                focus: Some(session.focus.clone()),
                enrolled: session.enrolled.iter().map(|w| w.id.clone()).collect(),
                topology: Some(topology_string(&session.tree)),
            },
        }
    }

    /// Stop the session with an adapter cleanup directive for exactly the
    /// originally enrolled ids. Restore passes the opaque envelopes back for
    /// exact geometry/focus restoration only when the adapter declared
    /// restore capability at start and confirms it here; otherwise a
    /// project-owned disposable-window closure directive is issued. Never
    /// names unidentified windows.
    ///
    /// A pending engine intent is never silently erased: stopping while an
    /// intent awaits completion returns the explicit `abandoned-pending-close`
    /// cleanup state (closure-only even when restore is confirmed) with
    /// `abandoned_pending` set, so the adapter is forced onto the closure
    /// route and no false verified state survives.
    pub fn stop(
        &mut self,
        owner: &str,
        generation: &str,
        expected_revision: u64,
        confirm_restore: bool,
    ) -> Result<CleanupView, Poc3Error> {
        let session = self.active_session(owner, generation, expected_revision)?;
        let ids: Vec<String> = session.enrolled.iter().map(|w| w.id.clone()).collect();
        let revision = session.revision;
        let abandoned = self.pending.is_some();
        let view = if abandoned {
            CleanupView {
                action: "abandoned-pending-close",
                ids,
                revision,
                abandoned_pending: true,
                envelopes: None,
                session_envelope: None,
            }
        } else if session.capabilities.restore_capable && confirm_restore {
            CleanupView {
                action: "restore-enrolled",
                ids,
                revision,
                abandoned_pending: false,
                envelopes: Some(
                    session
                        .enrolled
                        .iter()
                        .map(|w| (w.id.clone(), w.rollback.clone()))
                        .collect(),
                ),
                session_envelope: Some(session.session_rollback.clone()),
            }
        } else {
            CleanupView {
                action: "close-disposable",
                ids,
                revision,
                abandoned_pending: false,
                envelopes: None,
                session_envelope: None,
            }
        };
        self.session = None;
        self.pending = None;
        self.diverged = false;
        self.divergence_reason = None;
        Ok(view)
    }

    fn active_session(
        &self,
        owner: &str,
        generation: &str,
        expected_revision: u64,
    ) -> Result<&Session, Poc3Error> {
        let Some(session) = &self.session else {
            return Err(Poc3Error::NoSession);
        };
        if session.owner != owner {
            return Err(Poc3Error::OwnerMismatch);
        }
        if session.generation != generation {
            return Err(Poc3Error::GenerationMismatch);
        }
        if session.revision != expected_revision {
            return Err(Poc3Error::StaleRevision);
        }
        Ok(session)
    }

    fn checked_session(
        &mut self,
        owner: &str,
        generation: &str,
        expected_revision: u64,
    ) -> Result<Session, Poc3Error> {
        let session = self
            .active_session(owner, generation, expected_revision)?
            .clone();
        if self.diverged {
            return Err(Poc3Error::Diverged);
        }
        if self.pending.is_some() {
            return Err(Poc3Error::PendingExists);
        }
        Ok(session)
    }

    fn intent_view(&self) -> Option<IntentView> {
        let session = self.session.as_ref()?;
        let pending = self.pending.as_ref()?;
        Some(IntentView {
            base_revision: pending.base_revision,
            next_revision: pending.base_revision + 1,
            atomic: false,
            adapter_verification_required: true,
            preconditions: pending.preconditions.clone(),
            capabilities: session.capabilities,
            cleanup_model: session.cleanup.as_str(),
            operation: pending.operation.clone(),
            topology: topology_string(&pending.tree),
            shares: shares_view(&pending.tree),
            focus: pending.focus.clone(),
            desired: desired_rects(&pending.tree, session.usable, session.gap),
            rollback_required: RollbackRequirement {
                retain_envelopes: true,
                note: "rollback envelopes are adapter-only opaque bytes; the engine never interprets them",
            },
        })
    }

    fn noop_view(&self, reason: &'static str) -> NoopView {
        let session = self.session.as_ref().expect("session is active");
        NoopView {
            reason,
            revision: session.revision,
            topology: topology_string(&session.tree),
            focus: session.focus.clone(),
            desired: desired_rects(&session.tree, session.usable, session.gap),
        }
    }
}

fn rect_in_bounds(rect: Rect) -> bool {
    (POC3_MIN_ORIGIN..=POC3_MAX_ORIGIN).contains(&rect.x)
        && (POC3_MIN_ORIGIN..=POC3_MAX_ORIGIN).contains(&rect.y)
        && (POC3_MIN_SIDE..=POC3_MAX_SIDE).contains(&rect.w)
        && (POC3_MIN_SIDE..=POC3_MAX_SIDE).contains(&rect.h)
}

/// Deterministic canonical subdivision: children split the usable extent
/// along the group axis proportionally to integer shares with a fixed gap;
/// the last child takes the integer remainder. Output is sorted by window id.
#[must_use]
pub fn desired_rects(tree: &Tree, usable: Rect, gap: i32) -> Vec<DesiredWindow> {
    let mut out = Vec::new();
    layout_into(tree, usable, gap, &mut out);
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn layout_into(node: &Tree, rect: Rect, gap: i32, out: &mut Vec<DesiredWindow>) {
    match node {
        Tree::Leaf { window } => out.push(DesiredWindow {
            id: window.clone(),
            rect,
        }),
        Tree::Group {
            axis,
            children,
            shares,
        } => {
            let n = children.len();
            let total: u64 = shares.iter().sum();
            if n == 0 || total == 0 {
                return;
            }
            match axis {
                Axis::Horizontal => {
                    let avail = rect
                        .w
                        .saturating_sub(gap.saturating_mul(n as i32 - 1))
                        .max(0);
                    let mut x = rect.x;
                    let mut used = 0i32;
                    for (index, child) in children.iter().enumerate() {
                        let width = if index + 1 == n {
                            avail - used
                        } else {
                            (i64::from(avail) * shares[index] as i64 / total as i64) as i32
                        };
                        used += width;
                        layout_into(
                            child,
                            Rect {
                                x,
                                y: rect.y,
                                w: width.max(0),
                                h: rect.h,
                            },
                            gap,
                            out,
                        );
                        x += width + gap;
                    }
                }
                Axis::Vertical => {
                    let avail = rect
                        .h
                        .saturating_sub(gap.saturating_mul(n as i32 - 1))
                        .max(0);
                    let mut y = rect.y;
                    let mut used = 0i32;
                    for (index, child) in children.iter().enumerate() {
                        let height = if index + 1 == n {
                            avail - used
                        } else {
                            (i64::from(avail) * shares[index] as i64 / total as i64) as i32
                        };
                        used += height;
                        layout_into(
                            child,
                            Rect {
                                x: rect.x,
                                y,
                                w: rect.w,
                                h: height.max(0),
                            },
                            gap,
                            out,
                        );
                        y += height + gap;
                    }
                }
            }
        }
    }
}

/// Canonical topology rendering, e.g. `H[w-1,V[w-2,w-3]]`.
#[must_use]
pub fn topology_string(tree: &Tree) -> String {
    match tree {
        Tree::Leaf { window } => window.clone(),
        Tree::Group {
            axis,
            children,
            shares: _,
        } => {
            let head = match axis {
                Axis::Horizontal => "H",
                Axis::Vertical => "V",
            };
            let inner: Vec<String> = children.iter().map(topology_string).collect();
            format!("{head}[{}]", inner.join(","))
        }
    }
}

#[must_use]
pub fn shares_view(tree: &Tree) -> SharesView {
    match tree {
        Tree::Leaf { window } => SharesView {
            window: Some(window.clone()),
            axis: None,
            shares: Vec::new(),
            children: Vec::new(),
        },
        Tree::Group {
            axis,
            children,
            shares,
        } => SharesView {
            window: None,
            axis: Some(match axis {
                Axis::Horizontal => "horizontal",
                Axis::Vertical => "vertical",
            }),
            shares: shares.clone(),
            children: children.iter().map(shares_view).collect(),
        },
    }
}

fn to_planner_node(tree: &Tree, groups: &mut usize) -> Node {
    match tree {
        Tree::Leaf { window } => Node::Leaf {
            id: NodeId(window.clone()),
        },
        Tree::Group {
            axis,
            children,
            shares: _,
        } => {
            let id = NodeId(format!("g{}", *groups));
            *groups += 1;
            // The directional planner never interprets shares; bridge with
            // deterministic equal u64 weights to preserve existing behavior.
            let shares = vec![1u64; children.len()];
            Node::Group {
                id,
                axis: *axis,
                children: children
                    .iter()
                    .map(|c| to_planner_node(c, groups))
                    .collect(),
                shares,
            }
        }
    }
}

/// COSMIC tree-relative directional neighbor: climb matching-axis ancestors
/// until a sibling exists in `direction`, then descend (same-axis edge child,
/// perpendicular first child). Reuses the POC1 focus planner.
#[must_use]
pub fn focus_neighbor(tree: &Tree, focused: &str, direction: Direction) -> Option<String> {
    if focused.is_empty() {
        return None;
    }
    let node = to_planner_node(tree, &mut 0usize);
    match plan_focus(&node, &NodeId(focused.to_owned()), direction)? {
        FocusPlan::Focused { leaf, route: _ } if leaf.0 != focused => Some(leaf.0),
        _ => None,
    }
}

fn find_path(tree: &Tree, window: &str) -> Option<Vec<usize>> {
    match tree {
        Tree::Leaf { window: id } => {
            if id == window {
                Some(Vec::new())
            } else {
                None
            }
        }
        Tree::Group { children, .. } => {
            for (index, child) in children.iter().enumerate() {
                if let Some(mut path) = find_path(child, window) {
                    path.push(index);
                    return Some(path);
                }
            }
            None
        }
    }
}

/// Representative structural transition for a directional move toward
/// `target`: same-parent neighbor swap (R2a concept), otherwise detach plus
/// adjacent insert with singleton-group collapse (R3 concept). Returns `None`
/// when no structural transition applies.
#[must_use]
pub fn apply_move(
    tree: &Tree,
    focused: &str,
    target: &str,
    direction: Direction,
) -> Option<(Tree, OperationDesc)> {
    let focus_path = find_path(tree, focused)?;
    let target_path = find_path(tree, target)?;
    if focus_path.is_empty() || target_path.is_empty() {
        return None;
    }
    let focus_parent = &focus_path[1..];
    let target_parent = &target_path[1..];
    if focus_parent == target_parent {
        let mut next = tree.clone();
        let (parent_path, leaf_index, other_index) = (focus_parent, focus_path[0], target_path[0]);
        let parent = node_at_mut(&mut next, parent_path)?;
        if let Tree::Group { children, .. } = parent {
            if leaf_index >= children.len() || other_index >= children.len() {
                return None;
            }
            children.swap(leaf_index, other_index);
        } else {
            return None;
        }
        return Some((
            next,
            OperationDesc {
                kind: "swap",
                rule: "R2a",
                target: Some(target.to_owned()),
                neighbor: Some(focused.to_owned()),
            },
        ));
    }
    // Cross-group reparent: detach the focused leaf, collapse a singleton
    // parent, and insert adjacent to the target leaf.
    let mut next = tree.clone();
    remove_child_at(&mut next, &focus_path)?;
    collapse_singletons(&mut next);
    let target_path = find_path(&next, target)?;
    let step: i32 = match direction {
        Direction::Right | Direction::Down => 1,
        Direction::Left | Direction::Up => -1,
    };
    let insert_at = if target_path.is_empty() {
        0
    } else {
        let base = target_path[0] as i32 + if step == 1 { 1 } else { 0 };
        base.max(0) as usize
    };
    let parent_path = target_path[1..].to_vec();
    if target_path.is_empty() {
        // Degenerate single-leaf remainder: wrap both in a directional group.
        let remainder = next;
        next = Tree::Group {
            axis: Axis::for_direction(direction),
            children: if step == 1 {
                vec![
                    remainder,
                    Tree::Leaf {
                        window: focused.to_owned(),
                    },
                ]
            } else {
                vec![
                    Tree::Leaf {
                        window: focused.to_owned(),
                    },
                    remainder,
                ]
            },
            shares: vec![1, 1],
        };
    } else {
        let parent = node_at_mut(&mut next, &parent_path)?;
        if let Tree::Group {
            children, shares, ..
        } = parent
        {
            let index = insert_at.min(children.len());
            children.insert(
                index,
                Tree::Leaf {
                    window: focused.to_owned(),
                },
            );
            shares.insert(index, 1);
        } else {
            return None;
        }
    }
    Some((
        next,
        OperationDesc {
            kind: "reparent",
            rule: "R3",
            target: Some(target.to_owned()),
            neighbor: None,
        },
    ))
}

fn node_at_mut<'a>(tree: &'a mut Tree, path: &[usize]) -> Option<&'a mut Tree> {
    let mut current = tree;
    for index in path.iter().rev() {
        match current {
            Tree::Group { children, .. } => current = children.get_mut(*index)?,
            Tree::Leaf { .. } => return None,
        }
    }
    Some(current)
}

fn remove_child_at(tree: &mut Tree, path: &[usize]) -> Option<Tree> {
    if path.is_empty() {
        return None;
    }
    let parent = node_at_mut(tree, &path[1..])?;
    if let Tree::Group {
        children, shares, ..
    } = parent
    {
        if path[0] >= children.len() {
            return None;
        }
        shares.remove(path[0]);
        Some(children.remove(path[0]))
    } else {
        None
    }
}

fn collapse_singletons(tree: &mut Tree) {
    match tree {
        Tree::Leaf { .. } => {}
        Tree::Group { children, .. } => {
            for child in children.iter_mut() {
                collapse_singletons(child);
            }
            if children.len() == 1
                && let Some(only) = children.pop()
            {
                *tree = only;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enrolled(id: &str) -> EnrolledWindow {
        EnrolledWindow {
            id: id.to_owned(),
            scope: "scope-1".to_owned(),
            rollback: format!("rollback-{id}"),
        }
    }

    fn start_params() -> StartParams {
        StartParams {
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            scope: "scope-1".to_owned(),
            usable: Rect {
                x: 0,
                y: 0,
                w: 900,
                h: 600,
            },
            gap: 8,
            windows: vec![enrolled("w-1"), enrolled("w-2"), enrolled("w-3")],
            session_rollback: "session-rollback".to_owned(),
            untiled_asserted: true,
            disposable: true,
            restore_capable: true,
            cleanup: CleanupModel::CloseDisposable,
        }
    }

    fn started() -> Poc3Engine {
        let mut engine = Poc3Engine::new();
        engine.start(start_params()).expect("start succeeds");
        engine
    }

    fn rect_of(desired: &[DesiredWindow], id: &str) -> Rect {
        desired
            .iter()
            .find(|w| w.id == id)
            .expect("window is desired")
            .rect
    }

    #[test]
    fn fresh_engine_has_no_session() {
        let engine = Poc3Engine::new();
        let status = engine.status();
        assert_eq!(status.state, "disabled");
        assert_eq!(status.revision, 0);
        assert!(!status.pending);
        assert!(status.enrolled.is_empty());
    }

    #[test]
    fn start_installs_canonical_layout_with_gap() {
        let mut engine = Poc3Engine::new();
        let intent = engine.start(start_params()).expect("start succeeds");
        assert_eq!(intent.base_revision, 0);
        assert_eq!(intent.next_revision, 1);
        assert!(!intent.atomic);
        assert!(intent.adapter_verification_required);
        assert_eq!(intent.topology, "H[w-1,V[w-2,w-3]]");
        assert_eq!(intent.focus, "w-1");
        assert_eq!(
            intent.desired.len(),
            POC3_WINDOW_COUNT,
            "full desired geometry for all enrolled windows"
        );
        assert_eq!(
            rect_of(&intent.desired, "w-1"),
            Rect {
                x: 0,
                y: 0,
                w: 446,
                h: 600
            }
        );
        assert_eq!(
            rect_of(&intent.desired, "w-2"),
            Rect {
                x: 454,
                y: 0,
                w: 446,
                h: 296
            }
        );
        assert_eq!(
            rect_of(&intent.desired, "w-3"),
            Rect {
                x: 454,
                y: 304,
                w: 446,
                h: 296
            }
        );
        assert!(
            intent
                .preconditions
                .contains(&"adapter-must-verify-postconditions"),
            "non-atomicity is explicit"
        );
    }

    #[test]
    fn start_exposes_nested_shares() {
        let mut engine = Poc3Engine::new();
        let intent = engine.start(start_params()).expect("start succeeds");
        assert_eq!(intent.shares.axis, Some("horizontal"));
        assert_eq!(intent.shares.shares, vec![1, 1]);
        assert_eq!(intent.shares.children.len(), 2);
        assert_eq!(intent.shares.children[1].axis, Some("vertical"));
        assert_eq!(intent.shares.children[1].shares, vec![1, 1]);
    }

    #[test]
    fn start_requires_exactly_three_unique_same_scope_windows() {
        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.windows.pop();
        assert_eq!(engine.start(params), Err(Poc3Error::WindowCount));

        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.windows.push(enrolled("w-4"));
        assert_eq!(engine.start(params), Err(Poc3Error::WindowCount));

        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.windows[2] = enrolled("w-2");
        assert_eq!(engine.start(params), Err(Poc3Error::DuplicateId));

        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.windows[2].scope = "scope-2".to_owned();
        assert_eq!(engine.start(params), Err(Poc3Error::ScopeMismatch));

        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.untiled_asserted = false;
        assert_eq!(engine.start(params), Err(Poc3Error::Eligibility));

        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.disposable = false;
        assert_eq!(engine.start(params), Err(Poc3Error::Eligibility));

        let mut engine = Poc3Engine::new();
        let params = start_params();
        engine.start(params.clone()).expect("first start succeeds");
        assert_eq!(engine.start(params), Err(Poc3Error::SessionActive));
    }

    #[test]
    fn cosmic_focus_navigation_moves_through_nested_groups() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completion succeeds");
        let DispatchOutcome::Planned(intent) = engine
            .dispatch_focus("owner-1", "gen-1", 1, Direction::Right)
            .expect("focus dispatches")
        else {
            panic!("expected planned focus");
        };
        assert_eq!(intent.focus, "w-2");
        assert_eq!(intent.operation.kind, "focus");
        // Dispatch is not completion: verified state is unchanged.
        assert_eq!(engine.status().revision, 1);
        assert_eq!(engine.status().focus.as_deref(), Some("w-1"));
        engine
            .complete("owner-1", "gen-1", 1, CompletionResult::Applied, None)
            .expect("focus completion succeeds");
        assert_eq!(engine.status().focus.as_deref(), Some("w-2"));
        assert_eq!(engine.status().revision, 2);

        let DispatchOutcome::Planned(intent) = engine
            .dispatch_focus("owner-1", "gen-1", 2, Direction::Down)
            .expect("focus dispatches")
        else {
            panic!("expected planned focus");
        };
        assert_eq!(intent.focus, "w-3");
    }

    #[test]
    fn same_group_move_swaps_topology_and_geometry() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        // Focus w-2 first.
        let DispatchOutcome::Planned(_) = engine
            .dispatch_focus("owner-1", "gen-1", 1, Direction::Right)
            .expect("focus dispatches")
        else {
            panic!("expected planned focus");
        };
        engine
            .complete("owner-1", "gen-1", 1, CompletionResult::Applied, None)
            .expect("focus completes");
        let before = engine.status().topology.expect("topology is known");
        assert_eq!(before, "H[w-1,V[w-2,w-3]]");
        let DispatchOutcome::Planned(intent) = engine
            .dispatch_move("owner-1", "gen-1", 2, Direction::Down)
            .expect("move dispatches")
        else {
            panic!("expected planned move");
        };
        assert_eq!(intent.operation.kind, "swap");
        assert_eq!(intent.operation.rule, "R2a");
        assert_eq!(intent.topology, "H[w-1,V[w-3,w-2]]");
        assert_ne!(intent.topology, before);
        assert_eq!(
            rect_of(&intent.desired, "w-2"),
            Rect {
                x: 454,
                y: 304,
                w: 446,
                h: 296
            },
            "moved window takes the neighbor geometry"
        );
        engine
            .complete("owner-1", "gen-1", 2, CompletionResult::Applied, None)
            .expect("move completes");
        assert_eq!(
            engine.status().topology.as_deref(),
            Some("H[w-1,V[w-3,w-2]]")
        );
        assert_eq!(engine.status().revision, 3);
    }

    #[test]
    fn cross_group_move_restructures_tree() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        let DispatchOutcome::Planned(intent) = engine
            .dispatch_move("owner-1", "gen-1", 1, Direction::Right)
            .expect("move dispatches")
        else {
            panic!("expected planned move");
        };
        assert_eq!(intent.operation.kind, "reparent");
        assert_eq!(intent.operation.rule, "R3");
        assert_eq!(intent.topology, "V[w-2,w-1,w-3]");
        assert_eq!(intent.desired.len(), 3);
        // All three windows still have non-degenerate geometry.
        for window in &intent.desired {
            assert!(window.rect.w > 0 && window.rect.h > 0);
        }
    }

    #[test]
    fn edge_move_is_noop_without_pending() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        let DispatchOutcome::Noop(noop) = engine
            .dispatch_move("owner-1", "gen-1", 1, Direction::Left)
            .expect("edge move dispatches")
        else {
            panic!("expected noop at the edge");
        };
        assert_eq!(noop.reason, "edge");
        assert_eq!(noop.revision, 1);
        assert!(!engine.status().pending);
        assert_eq!(
            engine.complete("owner-1", "gen-1", 1, CompletionResult::Applied, None),
            Err(Poc3Error::NoPending),
            "noop needs no completion round-trip"
        );
    }

    #[test]
    fn stale_revision_rejects_before_intent() {
        let mut engine = started();
        assert_eq!(
            engine.dispatch_focus("owner-1", "gen-1", 99, Direction::Right),
            Err(Poc3Error::StaleRevision)
        );
        assert_eq!(
            engine.complete("owner-1", "gen-1", 99, CompletionResult::Applied, None),
            Err(Poc3Error::StaleRevision)
        );
        assert_eq!(
            engine.stop("owner-1", "gen-1", 99, true),
            Err(Poc3Error::StaleRevision)
        );
        assert_eq!(
            engine.dispatch_focus("wrong-owner", "gen-1", 0, Direction::Right),
            Err(Poc3Error::OwnerMismatch)
        );
        assert_eq!(
            engine.dispatch_focus("owner-1", "gen-9", 0, Direction::Right),
            Err(Poc3Error::GenerationMismatch)
        );
    }

    #[test]
    fn pending_intent_blocks_further_dispatch() {
        let engine = started();
        assert!(engine.status().pending);
        let mut engine = engine;
        assert_eq!(
            engine.dispatch_focus("owner-1", "gen-1", 0, Direction::Right),
            Err(Poc3Error::PendingExists)
        );
    }

    #[test]
    fn divergent_completion_fails_closed() {
        let mut engine = started();
        let view = engine
            .complete(
                "owner-1",
                "gen-1",
                0,
                CompletionResult::Divergent,
                Some(DivergentReason::PartialApplication),
            )
            .expect("divergence is recorded");
        assert_eq!(view.result, "diverged-recorded");
        assert!(view.divergent);
        assert!(
            view.desired.is_empty(),
            "no geometry is implied after divergence"
        );
        assert_eq!(engine.status().state, "divergent");
        assert_eq!(
            engine.dispatch_focus("owner-1", "gen-1", 0, Direction::Right),
            Err(Poc3Error::Diverged)
        );
        assert_eq!(
            engine.complete("owner-1", "gen-1", 0, CompletionResult::Applied, None),
            Err(Poc3Error::Diverged)
        );
        // Stop for cleanup still works while divergent.
        let cleanup = engine
            .stop("owner-1", "gen-1", 0, false)
            .expect("stop works while divergent");
        assert_eq!(cleanup.action, "close-disposable");
        assert_eq!(engine.status().state, "disabled");
    }

    #[test]
    fn stop_restore_returns_only_enrolled_ids_with_envelopes() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        let cleanup = engine
            .stop("owner-1", "gen-1", 1, true)
            .expect("stop succeeds");
        assert_eq!(cleanup.action, "restore-enrolled");
        assert_eq!(cleanup.ids, vec!["w-1", "w-2", "w-3"]);
        let envelopes = cleanup.envelopes.expect("restore carries envelopes");
        assert_eq!(
            envelopes.get("w-1").map(String::as_str),
            Some("rollback-w-1")
        );
        assert_eq!(envelopes.len(), 3);
        assert_eq!(
            cleanup.session_envelope.as_deref(),
            Some("session-rollback")
        );
        assert_eq!(engine.status().state, "disabled");
    }

    #[test]
    fn stop_without_restore_confirms_closure_of_enrolled_ids_only() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        let cleanup = engine
            .stop("owner-1", "gen-1", 1, false)
            .expect("stop succeeds");
        assert_eq!(cleanup.action, "close-disposable");
        assert_eq!(cleanup.ids, vec!["w-1", "w-2", "w-3"]);
        assert!(cleanup.envelopes.is_none());
    }

    #[test]
    fn stop_without_restore_capability_never_restores() {
        let mut engine = Poc3Engine::new();
        let mut params = start_params();
        params.restore_capable = false;
        engine.start(params).expect("start succeeds");
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        let cleanup = engine
            .stop("owner-1", "gen-1", 1, true)
            .expect("stop succeeds");
        assert_eq!(cleanup.action, "close-disposable");
        assert!(!cleanup.abandoned_pending);
        assert_eq!(cleanup.ids.len(), POC3_WINDOW_COUNT);
    }

    #[test]
    fn start_carries_cleanup_model_into_intent_and_status() {
        let mut engine = Poc3Engine::new();
        let intent = engine.start(start_params()).expect("start succeeds");
        assert_eq!(intent.cleanup_model, "close-disposable");
        assert_eq!(
            CleanupModel::parse("close-disposable"),
            Some(CleanupModel::CloseDisposable)
        );
        assert_eq!(CleanupModel::parse("restore"), None);
        assert_eq!(CleanupModel::parse(""), None);
        let status = engine.status();
        assert_eq!(status.cleanup_model, Some("close-disposable"));
        assert_eq!(status.revision, 0);
        assert!(status.pending);
        let fresh = Poc3Engine::new().status();
        assert_eq!(fresh.cleanup_model, None);
    }

    #[test]
    fn stop_while_pending_returns_abandoned_close_only() {
        let mut engine = started();
        assert!(engine.status().pending);
        // Restore confirmation cannot win while an intent is pending: the
        // cleanup state forces the closure-only route and records it.
        let cleanup = engine
            .stop("owner-1", "gen-1", 0, true)
            .expect("stop succeeds while pending");
        assert_eq!(cleanup.action, "abandoned-pending-close");
        assert!(cleanup.abandoned_pending);
        assert_eq!(cleanup.ids, vec!["w-1", "w-2", "w-3"]);
        assert!(cleanup.envelopes.is_none());
        assert!(cleanup.session_envelope.is_none());
        assert_eq!(engine.status().state, "disabled");
        assert!(!engine.status().pending);
    }

    #[test]
    fn stop_without_pending_is_not_abandoned() {
        let mut engine = started();
        engine
            .complete("owner-1", "gen-1", 0, CompletionResult::Applied, None)
            .expect("init completes");
        let cleanup = engine
            .stop("owner-1", "gen-1", 1, false)
            .expect("stop succeeds");
        assert_eq!(cleanup.action, "close-disposable");
        assert!(!cleanup.abandoned_pending);
    }
}
