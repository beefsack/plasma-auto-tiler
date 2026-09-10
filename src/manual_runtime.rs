//! Shared manual runtime: one authoritative [`Session`] for focus/movement/resize.
//!
//! Migration order before lifecycle: focus, movement, and resize transact
//! over a single owned portable [`crate::session::Session`] (single pending
//! reconciler slot), instead of the three separate planner-owned sessions.
//! Deterministic production three-window seed projects A left, B
//! upper-right, C lower-right from real supplied work-area bounds/gap plus
//! real supplied per-window geometry.
//!
//! Scope establishment input surface (the only surface production adapters
//! may source): one eligible three-window observation (exactly three
//! distinct opaque windows in a single `(output, workspace)` domain) plus the
//! real native work-area `bounds`/`gap` and the three real observed window
//! `Rect`s. No Legacy fallback, no add/remove/new-window tiling beyond the
//! seed, and no advisory/POC exact-three facilities are borrowed.
//!
//! Source evidence (`pop-os/cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`):
//! admission axis via [`crate::cosmic_v1::admission_axis_for_rect`] (wide
//! targets split portable [`Axis::Horizontal`], tall/tie split
//! [`Axis::Vertical`]) and new groups via [`crate::cosmic_v1::new_group_shares`]
//! (`[1, 1]`). The seed admits A, then B with B's real supplied geometry
//! (must be wide), then C with C's real supplied geometry (must be tall),
//! yielding root horizontal `[A, [B, C]]`. Supplied geometry decides the
//! outcome: a non-wide B or non-tall C fails closed instead of tiling.
//!
//! Contract preservation: Rust owns normalized domains, intent,
//! capabilities, preconditions, revision binding, and reconciliation; KWin
//! owns observation, native mapping, revalidation, native writes, and
//! post-observation. Fail-closed observation completeness, single pending,
//! acknowledgement-before-verify, and terminal divergence are inherited from
//! [`Session`] unchanged. No Legacy fallback and no new-window tiling or
//! add/remove lifecycle beyond the deterministic three-window seed.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::contract::{
    AckOutcome, AdapterAck, FocusCapabilities, FocusOperation, FocusPostObservation,
    FocusPrecondition, LifecycleCapabilities, LifecyclePostObservation, Observation,
    PostObservation, ResizeCapabilities, ResizeMode, ResizeOperation, ResizePostObservation,
    ResizePrecondition,
};
use crate::cosmic_v1;
use crate::directional::{
    Axis, Capabilities, Capability, CrossOutputTarget, Direction, EscapeContinuation, FocusedSide,
    Insertion, MoveOperation, Node, NodeId, OutputId, Precondition, Rule, WindowId, WorkspaceId,
};
use crate::focus_service::focus_fingerprint;
use crate::geometry::{Rect, project};
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::session::{
    DesiredGeometry, DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError,
    Session, SessionCommand, SessionObservation, SessionResizePlan,
};
#[cfg(test)]
use crate::session::{SessionFocusPlan, SessionMovePlan};

/// Wide axis-intent placement is never synthesized: the B admit carries B's
/// real supplied observed geometry (must be wide) and the C admit carries
/// C's real supplied observed geometry (must be tall). Fixed synthetic
/// rectangles are rejected by construction (no constants exist).
/// Seed failure (pre-state, never divergence). Fixed messages, no echo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeedError {
    InvalidDomain,
    InvalidWindow,
    SeedFailed,
}

impl SeedError {
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::InvalidDomain => "domain-invalid",
            Self::InvalidWindow => "window-invalid",
            Self::SeedFailed => "seed-failed",
        }
    }

    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::InvalidDomain => "supplied work-area bounds or gap is invalid",
            Self::InvalidWindow => "supplied trio window identities are invalid",
            Self::SeedFailed => "trio seed transaction was refused",
        }
    }
}

/// Projected trio geometry: A left, B upper-right, C lower-right.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrioProjection {
    pub rect_a: Rect,
    pub rect_b: Rect,
    pub rect_c: Rect,
    pub bounds: Rect,
    pub gap: i32,
}

/// One shared authoritative runtime [`Session`] for focus/movement/resize.
#[derive(Debug)]
pub struct ManualRuntime {
    session: Session,
    domain: DomainKey,
    window_a: WindowId,
    window_b: WindowId,
    window_c: WindowId,
}

impl ManualRuntime {
    /// Deterministic production three-window seed over the scope
    /// establishment surface production adapters source: eligible
    /// three-window observation (exactly `window_a`/`window_b`/`window_c`,
    /// distinct, single domain) plus real supplied work-area `bounds`/`gap`
    /// and the three real supplied observed window geometries
    /// (`rect_a`/`rect_b`/`rect_c`, each contained in `bounds`).
    ///
    /// Windows admit A (with `rect_a`), then B (with `rect_b`, must be wide
    /// so [`crate::cosmic_v1::admission_axis_for_rect`] selects portable
    /// Horizontal), then C (with `rect_c`, must be tall so the same rule
    /// selects portable Vertical); focus ends on C. No add/remove lifecycle
    /// beyond this seed. Supplied geometry decides the outcome: any
    /// non-conforming axis intent fails closed with [`SeedError::SeedFailed`].
    #[allow(clippy::too_many_arguments)]
    pub fn seed_three_window(
        owner: OwnerId,
        generation: GenerationId,
        output: OutputId,
        workspace: WorkspaceId,
        bounds: Rect,
        gap: i32,
        window_a: WindowId,
        rect_a: Rect,
        window_b: WindowId,
        rect_b: Rect,
        window_c: WindowId,
        rect_c: Rect,
    ) -> Result<Self, SeedError> {
        if window_a.0.is_empty()
            || window_b.0.is_empty()
            || window_c.0.is_empty()
            || window_a == window_b
            || window_a == window_c
            || window_b == window_c
            || output.0.is_empty()
            || workspace.0.is_empty()
        {
            return Err(SeedError::InvalidWindow);
        }
        // Work-area validity binds first so malformed bounds/gap report
        // the domain (never masked by geometry checks below).
        let domain = OutputDomain {
            id: output.clone(),
            workspace: workspace.clone(),
            bounds,
            gap,
            adjacent: std::collections::BTreeMap::new(),
        };
        if !domain.validate() {
            return Err(SeedError::InvalidDomain);
        }
        // Source-evidenced axis intents derived from the real supplied
        // geometry (never synthetic): wide B must select Horizontal and tall
        // C must select Vertical through the shared COSMIC admission rule.
        if cosmic_v1::admission_axis_for_rect(&rect_b) != Axis::Horizontal
            || cosmic_v1::admission_axis_for_rect(&rect_c) != Axis::Vertical
            || cosmic_v1::new_group_shares() != [1, 1]
        {
            return Err(SeedError::SeedFailed);
        }
        for rect in [rect_a, rect_b, rect_c] {
            if !valid_seed_rect(rect) || !rect_contained_in(rect, bounds) {
                return Err(SeedError::SeedFailed);
            }
        }
        let mut session = Session::new(
            owner.clone(),
            generation.clone(),
            0,
            0,
            vec![domain.clone()],
        )
        .map_err(|_| SeedError::InvalidDomain)?;
        Self::admit_one(
            &mut session,
            &owner,
            &generation,
            &window_a,
            &output,
            &workspace,
            rect_a,
            "manual-seed-a",
        )?;
        Self::admit_one(
            &mut session,
            &owner,
            &generation,
            &window_b,
            &output,
            &workspace,
            rect_b,
            "manual-seed-b",
        )?;
        Self::admit_one(
            &mut session,
            &owner,
            &generation,
            &window_c,
            &output,
            &workspace,
            rect_c,
            "manual-seed-c",
        )?;
        let runtime = Self {
            session,
            domain: DomainKey { output, workspace },
            window_a,
            window_b,
            window_c,
        };
        // Fail closed when the deterministic order did not bind A/B/C.
        if runtime.trio_projection().is_none() {
            return Err(SeedError::SeedFailed);
        }
        Ok(runtime)
    }

    #[allow(clippy::too_many_arguments)]
    fn admit_one(
        session: &mut Session,
        owner: &OwnerId,
        generation: &GenerationId,
        window: &WindowId,
        output: &OutputId,
        workspace: &WorkspaceId,
        placement: Rect,
        correlation_text: &str,
    ) -> Result<(), SeedError> {
        let base = session.accepted_revision();
        let mut windows = observed_for(session);
        windows.push(ObservedWindow {
            window: window.clone(),
            output: output.clone(),
            workspace: workspace.clone(),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
        let correlation = CorrelationId::parse(correlation_text).ok_or(SeedError::SeedFailed)?;
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                base,
                base.wrapping_add(1000),
            ),
            windows,
        };
        let command = SessionCommand::Admit {
            window: window.clone(),
            output: output.clone(),
            workspace: workspace.clone(),
            exceptions: ExceptionFlags::none(),
            exception_behavior: None,
            placement_bounds: placement,
        };
        let plan = session
            .propose(
                &command,
                &observation,
                &correlation,
                &LifecycleCapabilities::full(),
            )
            .map_err(|_| SeedError::SeedFailed)?;
        session
            .acknowledge(&AdapterAck::new(
                correlation.clone(),
                owner.clone(),
                generation.clone(),
                base,
                AckOutcome::Accepted,
            ))
            .map_err(|_| SeedError::SeedFailed)?;
        session
            .verify_lifecycle(&LifecyclePostObservation::new(
                Observation::new(owner.clone(), generation.clone(), base, base),
                correlation,
                true,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            ))
            .map_err(|_| SeedError::SeedFailed)?;
        Ok(())
    }

    /// Borrow the shared authoritative session.
    #[cfg(test)]
    #[must_use]
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// Shared domain key.
    #[must_use]
    pub fn domain(&self) -> &DomainKey {
        &self.domain
    }

    /// Trio window identities in A/B/C order.
    #[must_use]
    pub fn trio_windows(&self) -> [&WindowId; 3] {
        [&self.window_a, &self.window_b, &self.window_c]
    }

    /// Accepted revision mirror.
    #[must_use]
    pub fn accepted_revision(&self) -> u64 {
        self.session.accepted_revision()
    }

    /// Complete normalized observation over the known window set at the
    /// current accepted revision (fail-closed completeness for proposals).
    #[cfg(test)]
    #[must_use]
    pub fn observation(
        &self,
        owner: &OwnerId,
        generation: &GenerationId,
        fingerprint: u64,
    ) -> SessionObservation {
        SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                self.session.accepted_revision(),
                fingerprint,
            ),
            windows: observed_for(&self.session),
        }
    }

    /// Current focus of the shared session.
    #[cfg(test)]
    #[must_use]
    pub fn focus(&self) -> (Option<DomainKey>, Option<NodeId>) {
        self.session.focus()
    }

    /// Deterministic projection of A left, B upper-right, C lower-right.
    /// Returns `None` when topology, links, or projection do not bind exactly.
    #[must_use]
    pub fn trio_projection(&self) -> Option<TrioProjection> {
        let snapshot = self.session.snapshot();
        let view = snapshot
            .domains
            .iter()
            .find(|d| d.output == self.domain.output && d.workspace == self.domain.workspace)?;
        let tree = view.tree.clone()?;
        // Expected shape: root Horizontal [leaf-A, inner Vertical [leaf-B, leaf-C]]
        // with source-evidenced `[1, 1]` shares at both levels.
        let (leaf_a, inner, root_shares) = match &tree {
            Node::Group {
                axis: Axis::Horizontal,
                children,
                shares,
                ..
            } if children.len() == 2 => (children[0].clone(), children[1].clone(), shares.clone()),
            _ => return None,
        };
        if root_shares != cosmic_v1::new_group_shares().to_vec() {
            return None;
        }
        let (leaf_b, leaf_c, inner_shares) = match &inner {
            Node::Group {
                axis: Axis::Vertical,
                children,
                shares,
                ..
            } if children.len() == 2 => (children[0].clone(), children[1].clone(), shares.clone()),
            _ => return None,
        };
        if inner_shares != cosmic_v1::new_group_shares().to_vec() {
            return None;
        }
        let leaf_id = |node: &Node| match node {
            Node::Leaf { id } => Some(id.clone()),
            Node::Group { .. } => None,
        };
        let id_a = leaf_id(&leaf_a)?;
        let id_b = leaf_id(&leaf_b)?;
        let id_c = leaf_id(&leaf_c)?;
        let window_for = |leaf: &NodeId| {
            snapshot
                .windows
                .iter()
                .find(|l| {
                    &l.leaf == leaf
                        && l.output == self.domain.output
                        && l.workspace == self.domain.workspace
                })
                .map(|l| l.window.clone())
        };
        if window_for(&id_a)? != self.window_a
            || window_for(&id_b)? != self.window_b
            || window_for(&id_c)? != self.window_c
        {
            return None;
        }
        let domain_view = self
            .session
            .domains()
            .iter()
            .find(|d| d.key() == self.domain)?;
        let projected = project(&tree, domain_view.bounds, domain_view.gap).ok()?;
        if projected.len() != 3 {
            return None;
        }
        let rect_for = |leaf: &NodeId| projected.iter().find(|p| &p.leaf == leaf).map(|p| p.rect);
        let rect_a = rect_for(&id_a)?;
        let rect_b = rect_for(&id_b)?;
        let rect_c = rect_for(&id_c)?;
        // A left of B/C, full-height left column; B above C in the right column.
        if !(rect_a.x < rect_b.x
            && rect_a.x < rect_c.x
            && rect_b.x == rect_c.x
            && rect_b.w == rect_c.w
            && rect_b.y < rect_c.y
            && rect_a.y == domain_view.bounds.y
            && rect_a.h == domain_view.bounds.h)
        {
            return None;
        }
        Some(TrioProjection {
            rect_a,
            rect_b,
            rect_c,
            bounds: domain_view.bounds,
            gap: domain_view.gap,
        })
    }

    /// Focus transaction over the shared session.
    #[cfg(test)]
    pub fn propose_focus(
        &mut self,
        window: &WindowId,
        direction: Direction,
        observation: &SessionObservation,
        correlation: &CorrelationId,
        capabilities: &FocusCapabilities,
    ) -> Result<SessionFocusPlan, ProposeError> {
        self.session.propose_focus(
            &self.domain,
            window,
            direction,
            observation,
            correlation,
            capabilities,
        )
    }

    /// Movement transaction over the same shared session.
    #[cfg(test)]
    pub fn propose_move(
        &mut self,
        window: &WindowId,
        direction: Direction,
        observation: &SessionObservation,
        correlation: &CorrelationId,
        capabilities: &crate::directional::Capabilities,
    ) -> Result<SessionMovePlan, ProposeError> {
        self.session.propose_move(
            &self.domain,
            window,
            direction,
            observation,
            correlation,
            capabilities,
        )
    }

    /// Keyboard resize transaction over the same shared session.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub fn propose_resize(
        &mut self,
        window: &WindowId,
        direction: Direction,
        mode: crate::contract::ResizeMode,
        press_index: u32,
        observation: &SessionObservation,
        correlation: &CorrelationId,
        capabilities: &ResizeCapabilities,
    ) -> Result<SessionResizePlan, ProposeError> {
        self.session.propose_resize(
            &self.domain,
            window,
            direction,
            mode,
            press_index,
            observation,
            correlation,
            capabilities,
        )
    }

    /// Pointer resize transaction over the same shared session.
    #[cfg(test)]
    pub fn propose_pointer_resize(
        &mut self,
        window: &WindowId,
        direction: Direction,
        proposed_boundary: i32,
        observation: &SessionObservation,
        correlation: &CorrelationId,
        capabilities: &ResizeCapabilities,
    ) -> Result<SessionResizePlan, ProposeError> {
        self.session.propose_pointer_resize(
            &self.domain,
            window,
            direction,
            proposed_boundary,
            observation,
            correlation,
            capabilities,
        )
    }

    /// Shared acknowledgement for focus/movement/resize pending plans.
    #[cfg(test)]
    pub fn acknowledge(
        &mut self,
        ack: &AdapterAck,
    ) -> Result<crate::reconcile::AckApplied, crate::reconcile::AckError> {
        self.session.acknowledge(ack)
    }

    /// Commit a pending focus plan after acknowledgement.
    #[cfg(test)]
    pub fn verify_focus(
        &mut self,
        post: &FocusPostObservation,
    ) -> Result<crate::reconcile::Commit, crate::reconcile::VerifyError> {
        self.session.verify_focus(post)
    }

    /// Commit a pending movement plan after acknowledgement.
    #[cfg(test)]
    pub fn verify_move(
        &mut self,
        post: &PostObservation,
    ) -> Result<crate::reconcile::Commit, crate::reconcile::VerifyError> {
        self.session.verify_move(post)
    }

    /// Commit a pending resize plan (keyboard or pointer) after acknowledgement.
    #[cfg(test)]
    pub fn verify_resize(
        &mut self,
        post: &ResizePostObservation,
    ) -> Result<crate::reconcile::Commit, crate::reconcile::VerifyError> {
        self.session.verify_resize(post)
    }
}

fn valid_seed_rect(rect: Rect) -> bool {
    rect.w > 0
        && rect.h > 0
        && rect.x.checked_add(rect.w).is_some()
        && rect.y.checked_add(rect.h).is_some()
}

fn rect_contained_in(inner: Rect, outer: Rect) -> bool {
    let inner_right = i64::from(inner.x) + i64::from(inner.w);
    let inner_bottom = i64::from(inner.y) + i64::from(inner.h);
    let outer_right = i64::from(outer.x) + i64::from(outer.w);
    let outer_bottom = i64::from(outer.y) + i64::from(outer.h);
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner_right <= outer_right
        && inner_bottom <= outer_bottom
}

fn observed_for(session: &Session) -> Vec<ObservedWindow> {
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| ObservedWindow {
            window: l.window.clone(),
            output: l.output.clone(),
            workspace: l.workspace.clone(),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        })
        .collect();
    windows.extend(session.exception_observed());
    windows
}

// ---- Shared exact-three D-Bus transaction layer ----
//
// One authoritative [`Session`] (owned by one [`ManualRuntime`]) across the
// packaged Rust-mode focus, movement, keyboard resize, and pointer resize
// D-Bus routes. This is the actual Planner path for the exact-three scope:
// the endpoint holds one [`ManualTrioService`] instead of three separate
// planner-owned sessions.
//
// Wire compatibility: every route keeps its established JSON action protocol
// (`request` / `request-pointer` / `acknowledge` / `verify` / `note-loss`,
// `v == 1`), the same field names, the same deterministic fingerprint
// binding, and the same reply vocabulary (`planned` / `noop` /
// `acknowledged` / `committed` / `rejected` / `diverged` with the same
// preconditions, operations, desired geometry/focus, and revision bindings).
// Capability, owner/generation/revision, precondition, single-pending, and
// loss contracts are preserved; the [`Session`] enforces observation
// completeness, single pending, acknowledgement-before-verify, and terminal
// divergence unchanged.
//
// Seeding replaces the unreachable programmatic bootstrap: only a strict
// resize-route request (keyboard `request` or pointer `request-pointer`,
// the only wire shapes carrying real work-area bounds/gap plus contained
// per-window rects) seeds the trio when unseeded. Sorted window ids bind
// A/B/C with their carried rects through [`ManualRuntime::seed_three_window`]
// (B wide, C tall, deterministic COSMIC `H[A,V[B,C]]`); anything else fails
// closed without seeding. Focus and movement carry no geometry and reject
// while unseeded. Single-shot: no reseed, no add/remove lifecycle beyond the
// seed, no Legacy fallback.

/// Exact trio membership: the shared session only ever holds three windows.
pub const TRIO_WINDOWS: usize = 3;
/// Bounded JSON request cap per route (mirrors the service bounds).
pub const TRIO_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded JSON reply cap per route (mirrors the service bounds).
pub const TRIO_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound (mirrors the service bounds).
pub const TRIO_MAX_ID_LEN: usize = 128;
/// Seen-correlation bound for the one shared single-use set.
pub const TRIO_MAX_SEEN: usize = 2048;
/// Revision bound (inclusive, shared with the contract).
pub const TRIO_MAX_REVISION: u64 = 1_000_000;
/// Route vector bound for focus verify (mirrors the focus service).
pub const TRIO_MAX_ROUTE: usize = 64;
/// Geometry entry bound for movement/resize verify (mirrors the services).
pub const TRIO_MAX_GEOMETRY: usize = 64;
/// Share vector bound for resize operation parsing (mirrors the service).
pub const TRIO_MAX_SHARES: usize = 64;
/// Bounded coordinate extent for carried work-area/window geometry.
const TRIO_GEOMETRY_BOUND: i32 = 16384;
/// Bounded gap extent for carried work-area geometry.
const TRIO_GEOMETRY_MAX_GAP: i32 = 64;

const TRIO_MSG_OVERSIZED: &str = "request exceeds size bound";
const TRIO_MSG_MALFORMED: &str = "request is malformed";
const TRIO_MSG_UNKNOWN_FIELD: &str = "request contains an unknown field";
const TRIO_MSG_UNKNOWN_VALUE: &str = "request contains an unknown value";
const TRIO_MSG_VERSION: &str = "unsupported contract version";
const TRIO_MSG_CORRELATION: &str = "correlation id is invalid";
const TRIO_MSG_OWNER: &str = "owner is invalid";
const TRIO_MSG_GENERATION: &str = "generation is invalid";
const TRIO_MSG_REVISION: &str = "revision is invalid";
const TRIO_MSG_OPAQUE_ID: &str = "opaque id is invalid";
const TRIO_MSG_DIRECTION: &str = "direction is invalid";
const TRIO_MSG_OBSERVATION: &str = "observation does not cover the known window set";
const TRIO_MSG_CAPABILITY: &str = "operation needs an undeclared capability";
const TRIO_MSG_SESSION_FULL: &str = "trio session correlation bound was reached";

/// Closed branch-specific diagnostic detail for a session refusal kind.
/// Shared across focus/movement/resize routes for semantically identical
/// session-layer refusals; distinct from the pre-session validation details.
fn trio_refusal_detail(kind: crate::session::RefusalKind) -> &'static str {
    use crate::session::RefusalKind as R;
    match kind {
        R::DuplicateWindow => "refused-duplicate-window",
        R::UnknownWindow => "refused-unknown-window",
        R::UnknownDomain => "refused-unknown-domain",
        R::FocusMismatch => "refused-focus-mismatch",
        R::NotTiled => "refused-not-tiled",
        R::PlannerNoop => "refused-planner-noop",
        R::PlannerRejected => "refused-planner-rejected",
        R::UnsupportedCapability => "refused-unsupported-capability",
        R::CrossDomainMismatch => "refused-cross-domain-mismatch",
        R::MalformedInput => "refused-malformed-input",
        R::MalformedTopology => "refused-malformed-topology",
        R::PartialObservation => "refused-partial-observation",
        R::ExceptionBehaviorUnselected => "refused-exception-behavior-unselected",
        R::Unchanged => "refused-unchanged",
    }
}

fn trio_is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= TRIO_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn trio_valid_correlation_echo(value: &serde_json::Value) -> String {
    value
        .get("correlation_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| CorrelationId::parse(id).is_some())
        .unwrap_or_default()
        .to_owned()
}

fn trio_classify_parse_error(error: &serde_json::Error) -> (&'static str, &'static str) {
    let text = error.to_string();
    if text.contains("unknown field") {
        ("unknown-field", TRIO_MSG_UNKNOWN_FIELD)
    } else if text.contains("unknown variant") {
        ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
    } else {
        ("request-malformed", TRIO_MSG_MALFORMED)
    }
}

fn trio_parse_direction(value: &str) -> Option<Direction> {
    match value {
        "left" => Some(Direction::Left),
        "right" => Some(Direction::Right),
        "up" => Some(Direction::Up),
        "down" => Some(Direction::Down),
        _ => None,
    }
}

fn trio_direction_str(value: Direction) -> &'static str {
    match value {
        Direction::Left => "left",
        Direction::Right => "right",
        Direction::Up => "up",
        Direction::Down => "down",
    }
}

fn trio_valid_carried_rect(x: i32, y: i32, w: i32, h: i32) -> bool {
    w > 0
        && h > 0
        && (-TRIO_GEOMETRY_BOUND..=TRIO_GEOMETRY_BOUND).contains(&x)
        && (-TRIO_GEOMETRY_BOUND..=TRIO_GEOMETRY_BOUND).contains(&y)
        && w <= TRIO_GEOMETRY_BOUND
        && h <= TRIO_GEOMETRY_BOUND
        && (i64::from(x) + i64::from(w) <= i64::from(i32::MAX))
        && (i64::from(y) + i64::from(h) <= i64::from(i32::MAX))
}

// ---- focus wire (mirrors the focus service shapes) ----

fn trio_focus_precondition_token(value: &str) -> Option<crate::contract::FocusPrecondition> {
    use crate::contract::FocusPrecondition as P;
    match value {
        "focused-leaf-occupied-by-focused-window" => Some(P::FocusedLeafOccupiedByFocusedWindow),
        "target-leaf-occupied" => Some(P::TargetLeafOccupied),
        "focus-targets-same-domain" => Some(P::FocusTargetsSameDomain),
        "adapter-must-verify-postconditions" => Some(P::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

fn trio_focus_precondition_str(value: &crate::contract::FocusPrecondition) -> &'static str {
    use crate::contract::FocusPrecondition as P;
    match value {
        P::FocusedLeafOccupiedByFocusedWindow => "focused-leaf-occupied-by-focused-window",
        P::TargetLeafOccupied => "target-leaf-occupied",
        P::FocusTargetsSameDomain => "focus-targets-same-domain",
        P::AdapterMustVerifyPostconditions => "adapter-must-verify-postconditions",
    }
}

const TRIO_FOCUS_PRECONDITIONS: &[&str] = &[
    "focused-leaf-occupied-by-focused-window",
    "target-leaf-occupied",
    "focus-targets-same-domain",
    "adapter-must-verify-postconditions",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioFocusDomainDto {
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioFocusObservedDto {
    window: String,
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioFocusCapabilitiesDto {
    directional_focus: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioFocusRequestDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    domain: TrioFocusDomainDto,
    focused_window: String,
    direction: String,
    windows: Vec<TrioFocusObservedDto>,
    capabilities: TrioFocusCapabilitiesDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioAckDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    base_revision: u64,
    outcome: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioFocusOperationDto {
    domain_output: String,
    domain_workspace: String,
    from_leaf: String,
    to_leaf: String,
    from_window: String,
    to_window: String,
    direction: String,
    route: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioFocusVerifyDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    verified: bool,
    verified_preconditions: Vec<String>,
    verified_operation: TrioFocusOperationDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioLossDto {
    v: u32,
    action: String,
}

#[derive(Debug, Clone, Serialize)]
struct TrioFocusOperationReply {
    domain_output: String,
    domain_workspace: String,
    from_leaf: String,
    to_leaf: String,
    from_window: String,
    to_window: String,
    direction: String,
    route: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct TrioFocusReply {
    v: u32,
    correlation_id: String,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    capability: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<TrioFocusOperationReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to_window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'static str>,
}

fn trio_serialize_focus(reply: &TrioFocusReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= TRIO_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\",\"detail\":\"reply-overflow\"}"
            .to_owned(),
    }
}

fn trio_focus_rejected(
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
    detail: &'static str,
) -> String {
    trio_serialize_focus(&TrioFocusReply {
        v: 1,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        to_window: None,
        detail: Some(detail),
    })
}

fn trio_focus_diverged(
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
) -> String {
    trio_serialize_focus(&TrioFocusReply {
        v: 1,
        correlation_id,
        outcome: "diverged",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        to_window: None,
        detail: None,
    })
}

// ---- movement wire (mirrors the movement service shapes) ----

fn trio_move_rule_str(value: Rule) -> &'static str {
    match value {
        Rule::R1 => "R1",
        Rule::R2a => "R2a",
        Rule::R2b => "R2b",
        Rule::R2c => "R2c",
        Rule::R3 => "R3",
        Rule::R4 => "R4",
    }
}

fn trio_move_parse_rule(value: &str) -> Option<Rule> {
    match value {
        "R1" => Some(Rule::R1),
        "R2a" => Some(Rule::R2a),
        "R2b" => Some(Rule::R2b),
        "R2c" => Some(Rule::R2c),
        "R3" => Some(Rule::R3),
        "R4" => Some(Rule::R4),
        _ => None,
    }
}

fn trio_move_capability_str(value: Capability) -> &'static str {
    match value {
        Capability::SwapNeighbor => "swap-neighbor",
        Capability::WrapPerpendicular => "wrap-perpendicular",
        Capability::WrapSiblings => "wrap-siblings",
        Capability::InsertChild => "insert-child",
        Capability::SplitGroupChild => "split-group-child",
        Capability::ReparentLeaf => "reparent-leaf",
        Capability::CrossOutputTransfer => "cross-output-transfer",
    }
}

fn trio_move_precondition_str(value: Precondition) -> &'static str {
    match value {
        Precondition::FocusedLeafOccupiedByFocusedWindow => {
            "focused-leaf-occupied-by-focused-window"
        }
        Precondition::NeighborLeafOccupied => "neighbor-leaf-occupied",
        Precondition::ContainerIsDirectParent => "container-is-direct-parent",
        Precondition::TargetGroupMembership => "target-group-membership",
        Precondition::ParentGroupMembership => "parent-group-membership",
        Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput => {
            "source-root-membership-and-adjacent-same-workspace-output"
        }
        Precondition::AdapterMustVerifyPostconditions => "adapter-must-verify-postconditions",
    }
}

fn trio_move_parse_precondition(value: &str) -> Option<Precondition> {
    match value {
        "focused-leaf-occupied-by-focused-window" => {
            Some(Precondition::FocusedLeafOccupiedByFocusedWindow)
        }
        "neighbor-leaf-occupied" => Some(Precondition::NeighborLeafOccupied),
        "container-is-direct-parent" => Some(Precondition::ContainerIsDirectParent),
        "target-group-membership" => Some(Precondition::TargetGroupMembership),
        "parent-group-membership" => Some(Precondition::ParentGroupMembership),
        "source-root-membership-and-adjacent-same-workspace-output" => {
            Some(Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput)
        }
        "adapter-must-verify-postconditions" => Some(Precondition::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

fn trio_move_parse_axis(value: &str) -> Option<Axis> {
    match value {
        "horizontal" => Some(Axis::Horizontal),
        "vertical" => Some(Axis::Vertical),
        _ => None,
    }
}

fn trio_move_axis_str(value: Axis) -> &'static str {
    match value {
        Axis::Horizontal => "horizontal",
        Axis::Vertical => "vertical",
    }
}

fn trio_move_get_str(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    obj.get(key)?.as_str().map(ToOwned::to_owned)
}

fn trio_move_get_usize(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<usize> {
    obj.get(key)?.as_u64()?.try_into().ok()
}

fn trio_move_get_bool(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<bool> {
    obj.get(key)?.as_bool()
}

fn trio_move_operation_to_value(op: &MoveOperation) -> serde_json::Value {
    match op {
        MoveOperation::WrapPerpendicular {
            rule,
            container,
            axis,
        } => serde_json::json!({
            "kind": "WrapPerpendicular",
            "rule": trio_move_rule_str(*rule),
            "container": container.0,
            "axis": trio_move_axis_str(*axis),
        }),
        MoveOperation::SwapNeighbor {
            rule,
            container,
            neighbor,
        } => serde_json::json!({
            "kind": "SwapNeighbor",
            "rule": trio_move_rule_str(*rule),
            "container": container.0,
            "neighbor": neighbor.0,
        }),
        MoveOperation::InsertIntoGroup {
            rule,
            container,
            target_group,
            insertion_index,
            insertion,
        } => serde_json::json!({
            "kind": "InsertIntoGroup",
            "rule": trio_move_rule_str(*rule),
            "container": container.0,
            "target_group": target_group.0,
            "insertion_index": insertion_index,
            "insertion": match insertion {
                Insertion::Midpoint => "midpoint",
                Insertion::NearEdge => "near-edge",
            },
        }),
        MoveOperation::SplitGroupChild {
            rule,
            container,
            target_group,
            target_child,
            target_child_index,
            focused_side,
            axis,
        } => serde_json::json!({
            "kind": "SplitGroupChild",
            "rule": trio_move_rule_str(*rule),
            "container": container.0,
            "target_group": target_group.0,
            "target_child": target_child.0,
            "target_child_index": target_child_index,
            "focused_side": match focused_side {
                FocusedSide::First => "first",
                FocusedSide::Second => "second",
            },
            "axis": trio_move_axis_str(*axis),
        }),
        MoveOperation::WrapNeighbor {
            rule,
            container,
            neighbor,
            focused_before_neighbor,
            axis,
        } => serde_json::json!({
            "kind": "WrapNeighbor",
            "rule": trio_move_rule_str(*rule),
            "container": container.0,
            "neighbor": neighbor.0,
            "focused_before_neighbor": focused_before_neighbor,
            "axis": trio_move_axis_str(*axis),
        }),
        MoveOperation::EscapeParent {
            rule,
            container,
            parent,
            container_child_index,
            parent_insertion_index,
            continuation,
        } => serde_json::json!({
            "kind": "EscapeParent",
            "rule": trio_move_rule_str(*rule),
            "container": container.0,
            "parent": parent.0,
            "container_child_index": container_child_index,
            "parent_insertion_index": parent_insertion_index,
            "continuation": match continuation {
                EscapeContinuation::None => "none",
                EscapeContinuation::R1 => "R1",
            },
        }),
        MoveOperation::CrossOutput {
            rule,
            target_output,
            source_root_child_index,
            target,
        } => serde_json::json!({
            "kind": "CrossOutput",
            "rule": trio_move_rule_str(*rule),
            "target_output": target_output.0,
            "source_root_child_index": source_root_child_index,
            "target": match target {
                CrossOutputTarget::Empty => "empty",
                CrossOutputTarget::Occupied => "occupied",
            },
        }),
    }
}

fn trio_move_parse_operation(value: &serde_json::Value) -> Option<MoveOperation> {
    let obj = value.as_object()?;
    let kind = obj.get("kind")?.as_str()?;
    let rule = trio_move_parse_rule(obj.get("rule")?.as_str()?)?;
    let opaque = |key: &str| -> Option<String> {
        let v = trio_move_get_str(obj, key)?;
        if trio_is_opaque_id(&v) { Some(v) } else { None }
    };
    let keys: std::collections::BTreeSet<&str> = obj.keys().map(String::as_str).collect();
    let exact = |want: &[&str]| -> bool {
        keys.len() == want.len() && want.iter().all(|k| keys.contains(k))
    };
    match kind {
        "WrapPerpendicular" => {
            if !exact(&["kind", "rule", "container", "axis"]) {
                return None;
            }
            Some(MoveOperation::WrapPerpendicular {
                rule,
                container: NodeId(opaque("container")?),
                axis: trio_move_parse_axis(obj.get("axis")?.as_str()?)?,
            })
        }
        "SwapNeighbor" => {
            if !exact(&["kind", "rule", "container", "neighbor"]) {
                return None;
            }
            Some(MoveOperation::SwapNeighbor {
                rule,
                container: NodeId(opaque("container")?),
                neighbor: NodeId(opaque("neighbor")?),
            })
        }
        "InsertIntoGroup" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "target_group",
                "insertion_index",
                "insertion",
            ]) {
                return None;
            }
            let insertion = match obj.get("insertion")?.as_str()? {
                "midpoint" => Insertion::Midpoint,
                "near-edge" => Insertion::NearEdge,
                _ => return None,
            };
            Some(MoveOperation::InsertIntoGroup {
                rule,
                container: NodeId(opaque("container")?),
                target_group: NodeId(opaque("target_group")?),
                insertion_index: trio_move_get_usize(obj, "insertion_index")?,
                insertion,
            })
        }
        "SplitGroupChild" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "target_group",
                "target_child",
                "target_child_index",
                "focused_side",
                "axis",
            ]) {
                return None;
            }
            let focused_side = match obj.get("focused_side")?.as_str()? {
                "first" => FocusedSide::First,
                "second" => FocusedSide::Second,
                _ => return None,
            };
            Some(MoveOperation::SplitGroupChild {
                rule,
                container: NodeId(opaque("container")?),
                target_group: NodeId(opaque("target_group")?),
                target_child: NodeId(opaque("target_child")?),
                target_child_index: trio_move_get_usize(obj, "target_child_index")?,
                focused_side,
                axis: trio_move_parse_axis(obj.get("axis")?.as_str()?)?,
            })
        }
        "WrapNeighbor" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "neighbor",
                "focused_before_neighbor",
                "axis",
            ]) {
                return None;
            }
            Some(MoveOperation::WrapNeighbor {
                rule,
                container: NodeId(opaque("container")?),
                neighbor: NodeId(opaque("neighbor")?),
                focused_before_neighbor: trio_move_get_bool(obj, "focused_before_neighbor")?,
                axis: trio_move_parse_axis(obj.get("axis")?.as_str()?)?,
            })
        }
        "EscapeParent" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "parent",
                "container_child_index",
                "parent_insertion_index",
                "continuation",
            ]) {
                return None;
            }
            let parent_insertion_index = match obj.get("parent_insertion_index")? {
                serde_json::Value::Null => None,
                serde_json::Value::Number(n) => Some(n.as_u64()?.try_into().ok()?),
                _ => return None,
            };
            let continuation = match obj.get("continuation")?.as_str()? {
                "none" => EscapeContinuation::None,
                "R1" => EscapeContinuation::R1,
                _ => return None,
            };
            Some(MoveOperation::EscapeParent {
                rule,
                container: NodeId(opaque("container")?),
                parent: NodeId(opaque("parent")?),
                container_child_index: trio_move_get_usize(obj, "container_child_index")?,
                parent_insertion_index,
                continuation,
            })
        }
        "CrossOutput" => {
            if !exact(&[
                "kind",
                "rule",
                "target_output",
                "source_root_child_index",
                "target",
            ]) {
                return None;
            }
            let target = match obj.get("target")?.as_str()? {
                "empty" => CrossOutputTarget::Empty,
                "occupied" => CrossOutputTarget::Occupied,
                _ => return None,
            };
            Some(MoveOperation::CrossOutput {
                rule,
                target_output: OutputId(opaque("target_output")?),
                source_root_child_index: trio_move_get_usize(obj, "source_root_child_index")?,
                target,
            })
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveDomainDto {
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveObservedDto {
    window: String,
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveCapabilitiesDto {
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
struct TrioMoveSeedBoundsDto {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveSeedDomainDto {
    output: String,
    workspace: String,
    bounds: TrioMoveSeedBoundsDto,
    gap: i32,
    #[serde(default)]
    adjacent: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveRequestDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    domain: TrioMoveDomainDto,
    focused_window: String,
    direction: String,
    windows: Vec<TrioMoveObservedDto>,
    capabilities: TrioMoveCapabilitiesDto,
    #[serde(default)]
    domains: Option<Vec<TrioMoveSeedDomainDto>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveGeometryDto {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
    rect: TrioResizeRectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveFocusDto {
    domain_output: String,
    domain_workspace: String,
    leaf: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioMoveVerifyDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    verified: bool,
    verified_preconditions: Vec<String>,
    verified_operation: serde_json::Value,
    verified_geometry: Vec<TrioMoveGeometryDto>,
    verified_focus: TrioMoveFocusDto,
}

#[derive(Debug, Clone, Serialize)]
struct TrioGeometryReply {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
    rect: TrioResizeRectDto,
}

#[derive(Debug, Clone, Serialize)]
struct TrioFocusBodyReply {
    domain_output: String,
    domain_workspace: String,
    leaf: String,
}

#[derive(Debug, Clone, Serialize)]
struct TrioMoveReply {
    v: u32,
    correlation_id: String,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    capability: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rule: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_geometry: Option<Vec<TrioGeometryReply>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_focus: Option<TrioFocusBodyReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'static str>,
}

fn trio_serialize_move(reply: &TrioMoveReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= TRIO_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\",\"detail\":\"reply-overflow\"}"
            .to_owned(),
    }
}

fn trio_move_rejected(
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
    detail: &'static str,
) -> String {
    trio_serialize_move(&TrioMoveReply {
        v: 1,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        rule: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
        detail: Some(detail),
    })
}

fn trio_move_diverged(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    trio_serialize_move(&TrioMoveReply {
        v: 1,
        correlation_id,
        outcome: "diverged",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        rule: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
        detail: None,
    })
}

fn trio_move_geometry_reply(g: &DesiredGeometry) -> TrioGeometryReply {
    TrioGeometryReply {
        window: g.window.0.clone(),
        leaf: g.leaf.0.clone(),
        output: g.output.0.clone(),
        workspace: g.workspace.0.clone(),
        rect: TrioResizeRectDto {
            x: g.rect.x,
            y: g.rect.y,
            w: g.rect.w,
            h: g.rect.h,
        },
    }
}

// ---- resize wire (mirrors the resize service shapes) ----

fn trio_resize_precondition_token(value: &str) -> Option<ResizePrecondition> {
    use crate::contract::ResizePrecondition as P;
    match value {
        "focused-leaf-occupied-by-focused-window" => Some(P::FocusedLeafOccupiedByFocusedWindow),
        "target-boundary-valid" => Some(P::TargetBoundaryValid),
        "resize-targets-same-domain" => Some(P::ResizeTargetsSameDomain),
        "adapter-must-verify-postconditions" => Some(P::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

fn trio_resize_precondition_str(value: &ResizePrecondition) -> &'static str {
    use crate::contract::ResizePrecondition as P;
    match value {
        P::FocusedLeafOccupiedByFocusedWindow => "focused-leaf-occupied-by-focused-window",
        P::TargetBoundaryValid => "target-boundary-valid",
        P::ResizeTargetsSameDomain => "resize-targets-same-domain",
        P::AdapterMustVerifyPostconditions => "adapter-must-verify-postconditions",
    }
}

const TRIO_RESIZE_PRECONDITIONS: &[&str] = &[
    "focused-leaf-occupied-by-focused-window",
    "target-boundary-valid",
    "resize-targets-same-domain",
    "adapter-must-verify-postconditions",
];

fn trio_resize_parse_mode(value: &str) -> Option<ResizeMode> {
    match value {
        "inwards" => Some(ResizeMode::Inwards),
        "outwards" => Some(ResizeMode::Outwards),
        _ => None,
    }
}

fn trio_resize_operation_to_value(op: &ResizeOperation) -> serde_json::Value {
    serde_json::json!({
        "kind": "ResizeSplitShare",
        "domain_output": op.domain_output.0,
        "domain_workspace": op.domain_workspace.0,
        "focused_leaf": op.focused_leaf.0,
        "focused_window": op.focused_window.0,
        "direction": trio_direction_str(op.direction),
        "mode": op.mode.as_str(),
        "target_group": op.target_group.0,
        "focused_child": op.focused_child.0,
        "neighbor_child": op.neighbor_child.0,
        "focused_index": op.focused_index,
        "neighbor_index": op.neighbor_index,
        "old_shares": op.old_shares,
        "new_shares": op.new_shares,
    })
}

fn trio_resize_parse_shares(value: &serde_json::Value) -> Option<Vec<u64>> {
    let items = value.as_array()?;
    if items.len() < 2 || items.len() > TRIO_MAX_SHARES {
        return None;
    }
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let share = item.as_u64()?;
        if share == 0 {
            return None;
        }
        out.push(share);
    }
    Some(out)
}

fn trio_resize_get_usize(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<usize> {
    obj.get(key)?.as_u64()?.try_into().ok()
}

fn trio_resize_parse_operation(value: &serde_json::Value) -> Option<ResizeOperation> {
    let obj = value.as_object()?;
    let keys: std::collections::BTreeSet<&str> = obj.keys().map(String::as_str).collect();
    let want: &[&str] = &[
        "kind",
        "domain_output",
        "domain_workspace",
        "focused_leaf",
        "focused_window",
        "direction",
        "mode",
        "target_group",
        "focused_child",
        "neighbor_child",
        "focused_index",
        "neighbor_index",
        "old_shares",
        "new_shares",
    ];
    if keys.len() != want.len() || !want.iter().all(|k| keys.contains(k)) {
        return None;
    }
    if obj.get("kind")?.as_str()? != "ResizeSplitShare" {
        return None;
    }
    let opaque = |key: &str| -> Option<String> {
        let v = obj.get(key)?.as_str()?;
        if trio_is_opaque_id(v) {
            Some(v.to_owned())
        } else {
            None
        }
    };
    let old_shares = trio_resize_parse_shares(obj.get("old_shares")?)?;
    let new_shares = trio_resize_parse_shares(obj.get("new_shares")?)?;
    if old_shares.len() != new_shares.len() || old_shares == new_shares {
        return None;
    }
    Some(ResizeOperation {
        domain_output: OutputId(opaque("domain_output")?),
        domain_workspace: WorkspaceId(opaque("domain_workspace")?),
        focused_leaf: NodeId(opaque("focused_leaf")?),
        focused_window: WindowId(opaque("focused_window")?),
        direction: trio_parse_direction(obj.get("direction")?.as_str()?)?,
        mode: trio_resize_parse_mode(obj.get("mode")?.as_str()?)?,
        target_group: NodeId(opaque("target_group")?),
        focused_child: NodeId(opaque("focused_child")?),
        neighbor_child: NodeId(opaque("neighbor_child")?),
        focused_index: trio_resize_get_usize(obj, "focused_index")?,
        neighbor_index: trio_resize_get_usize(obj, "neighbor_index")?,
        old_shares,
        new_shares,
    })
    .filter(|op| {
        op.focused_child != op.neighbor_child
            && op.focused_index != op.neighbor_index
            && op.focused_index < op.old_shares.len()
            && op.neighbor_index < op.old_shares.len()
    })
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeRectDto {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeDomainDto {
    output: String,
    workspace: String,
    bounds: TrioResizeRectDto,
    gap: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeObservedDto {
    window: String,
    output: String,
    workspace: String,
    rect: TrioResizeRectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeCapabilitiesDto {
    keyboard_resize: bool,
    pointer_resize: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeRequestDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    domain: TrioResizeDomainDto,
    focused_window: String,
    direction: String,
    mode: String,
    press_index: u32,
    windows: Vec<TrioResizeObservedDto>,
    capabilities: TrioResizeCapabilitiesDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizePointerRequestDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    domain: TrioResizeDomainDto,
    focused_window: String,
    direction: String,
    proposed_boundary: i32,
    windows: Vec<TrioResizeObservedDto>,
    capabilities: TrioResizeCapabilitiesDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeGeometryDto {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
    rect: TrioResizeRectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeFocusDto {
    domain_output: String,
    domain_workspace: String,
    leaf: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrioResizeVerifyDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    verified: bool,
    verified_preconditions: Vec<String>,
    verified_operation: serde_json::Value,
    verified_geometry: Vec<TrioResizeGeometryDto>,
    verified_focus: TrioResizeFocusDto,
}

#[derive(Debug, Clone, Serialize)]
struct TrioResizeReply {
    v: u32,
    correlation_id: String,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    capability: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_geometry: Option<Vec<TrioGeometryReply>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_focus: Option<TrioFocusBodyReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'static str>,
}

fn trio_serialize_resize(reply: &TrioResizeReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= TRIO_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\",\"detail\":\"reply-overflow\"}"
            .to_owned(),
    }
}

fn trio_resize_rejected(
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
    detail: &'static str,
) -> String {
    trio_serialize_resize(&TrioResizeReply {
        v: 1,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
        detail: Some(detail),
    })
}

fn trio_resize_diverged(
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
) -> String {
    trio_serialize_resize(&TrioResizeReply {
        v: 1,
        correlation_id,
        outcome: "diverged",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
        detail: None,
    })
}

// ---- shared trio service ----

/// Which keyboard/pointer route created the active resize pending plan.
/// Shared `acknowledge`/`verify`/`note-loss` bind only to the pending cycle
/// created through the same route; cross-route calls are rejected without
/// mutating the session or clearing the foreign pending.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrioResizeOrigin {
    Keyboard,
    Pointer,
}

/// One shared pending plan across all four routes (the [`Session`] itself
/// enforces single pending; this mirror binds verify reports strictly before
/// delegating, exactly like the former per-route services).
#[derive(Debug, Clone)]
enum TrioPending {
    Focus {
        correlation: String,
        operation: FocusOperation,
        preconditions: Vec<FocusPrecondition>,
    },
    Move {
        correlation: String,
        operation: MoveOperation,
        preconditions: Vec<Precondition>,
        geometry: Vec<DesiredGeometry>,
        focus_domain: DomainKey,
        focus_leaf: NodeId,
    },
    Resize {
        origin: TrioResizeOrigin,
        correlation: String,
        operation: ResizeOperation,
        preconditions: Vec<ResizePrecondition>,
        geometry: Vec<DesiredGeometry>,
        focus_domain: DomainKey,
        focus_leaf: NodeId,
    },
}

/// One authoritative exact-three transaction service over a shared
/// [`ManualRuntime`] session for the packaged D-Bus focus, movement,
/// keyboard resize, and pointer resize routes.
#[derive(Debug)]
pub struct ManualTrioService {
    runtime: Option<ManualRuntime>,
    seen: HashSet<String>,
    pending: Option<TrioPending>,
}

impl Default for ManualTrioService {
    fn default() -> Self {
        Self::new()
    }
}

impl ManualTrioService {
    /// Fresh unseeded service. Only a strict resize-route request seeds the
    /// shared trio; focus and movement reject until then.
    #[must_use]
    pub fn new() -> Self {
        Self {
            runtime: None,
            seen: HashSet::new(),
            pending: None,
        }
    }

    /// Whether the shared trio scope is established.
    #[must_use]
    pub fn is_established(&self) -> bool {
        self.runtime.is_some()
    }

    /// Accepted revision mirror (0 while unseeded).
    #[must_use]
    pub fn accepted_revision(&self) -> u64 {
        self.runtime
            .as_ref()
            .map_or(0, |runtime| runtime.accepted_revision())
    }

    fn claim_correlation(&mut self, correlation_id: &str) -> bool {
        if self.seen.contains(correlation_id) {
            return false;
        }
        if self.seen.len() >= TRIO_MAX_SEEN {
            return false;
        }
        self.seen.insert(correlation_id.to_owned());
        true
    }

    fn session_mut(&mut self) -> Option<&mut Session> {
        self.runtime.as_mut().map(|runtime| &mut runtime.session)
    }

    /// Fail-closed terminal divergence for seen-set exhaustion.
    fn diverged_exhausted_move(&mut self, correlation_id: String) -> String {
        if let Some(session) = self.session_mut() {
            let _ = session.note_adapter_loss();
        }
        self.pending = None;
        trio_move_diverged(correlation_id, "session-full", TRIO_MSG_SESSION_FULL)
    }

    fn diverged_exhausted_focus(&mut self, correlation_id: String) -> String {
        if let Some(session) = self.session_mut() {
            let _ = session.note_adapter_loss();
        }
        self.pending = None;
        trio_focus_diverged(correlation_id, "session-full", TRIO_MSG_SESSION_FULL)
    }

    fn diverged_exhausted_resize(&mut self, correlation_id: String) -> String {
        if let Some(session) = self.session_mut() {
            let _ = session.note_adapter_loss();
        }
        self.pending = None;
        trio_resize_diverged(correlation_id, "session-full", TRIO_MSG_SESSION_FULL)
    }

    /// Seed the shared trio from a strict resize-route request carrying real
    /// work-area bounds/gap plus contained per-window rects. Sorted window
    /// ids bind A/B/C with their carried rects; B must be wide and C tall
    /// through the COSMIC admission rule with a bound `H[A,V[B,C]]`
    /// projection. Single-shot: refuses when already seeded.
    #[allow(clippy::too_many_arguments)]
    fn ensure_seeded_from_resize(
        &mut self,
        owner: &OwnerId,
        generation: &GenerationId,
        output: &str,
        workspace: &str,
        bounds: Rect,
        gap: i32,
        windows: &[TrioResizeObservedDto],
        revision: u64,
    ) -> Result<(), ()> {
        if self.runtime.is_some() {
            return Ok(());
        }
        if revision != TRIO_WINDOWS as u64 || windows.len() != TRIO_WINDOWS {
            return Err(());
        }
        let mut ids: Vec<String> = windows.iter().map(|w| w.window.clone()).collect();
        ids.sort();
        ids.dedup();
        if ids.len() != TRIO_WINDOWS {
            return Err(());
        }
        let rect_for = |id: &str| -> Option<Rect> {
            windows.iter().find(|w| w.window == id).map(|w| Rect {
                x: w.rect.x,
                y: w.rect.y,
                w: w.rect.w,
                h: w.rect.h,
            })
        };
        let rect_a = rect_for(&ids[0]).ok_or(())?;
        let rect_b = rect_for(&ids[1]).ok_or(())?;
        let rect_c = rect_for(&ids[2]).ok_or(())?;
        let runtime = ManualRuntime::seed_three_window(
            owner.clone(),
            generation.clone(),
            OutputId(output.to_owned()),
            WorkspaceId(workspace.to_owned()),
            bounds,
            gap,
            WindowId(ids[0].clone()),
            rect_a,
            WindowId(ids[1].clone()),
            rect_b,
            WindowId(ids[2].clone()),
            rect_c,
        )
        .map_err(|_| ())?;
        if runtime.trio_projection().is_none() {
            return Err(());
        }
        self.runtime = Some(runtime);
        Ok(())
    }

    /// Seeded trio membership in sorted order (A/B/C binding).
    fn seeded_members(&self) -> Vec<String> {
        self.runtime.as_ref().map_or(Vec::new(), |runtime| {
            let [a, b, c] = runtime.trio_windows();
            let mut ids = vec![a.0.clone(), b.0.clone(), c.0.clone()];
            ids.sort();
            ids
        })
    }

    fn check_trio_membership(
        &self,
        domain_output: &str,
        domain_workspace: &str,
        windows: &[(String, String, String)],
        focused: &str,
    ) -> bool {
        if windows.len() != TRIO_WINDOWS {
            return false;
        }
        let mut ids: Vec<String> = windows.iter().map(|w| w.0.clone()).collect();
        ids.sort();
        if ids != self.seeded_members() {
            return false;
        }
        let runtime = match self.runtime.as_ref() {
            Some(runtime) => runtime,
            None => return false,
        };
        if runtime.domain().output.0 != domain_output
            || runtime.domain().workspace.0 != domain_workspace
        {
            return false;
        }
        for (id, output, workspace) in windows {
            if output != domain_output || workspace != domain_workspace {
                return false;
            }
            if !trio_is_opaque_id(id) {
                return false;
            }
        }
        windows.iter().any(|w| w.0 == focused)
    }

    fn focus_expected_fingerprint(
        domain_output: &str,
        domain_workspace: &str,
        focused: &str,
        windows: &[TrioFocusObservedDto],
    ) -> u64 {
        let mut ids: Vec<String> = windows.iter().map(|w| w.window.clone()).collect();
        ids.sort();
        focus_fingerprint(domain_output, domain_workspace, focused, &ids)
    }

    /// Strict JSON-only focus transaction over the shared trio session.
    /// Always returns a bounded reply. Rejects while unseeded: focus carries
    /// no geometry and can never seed the trio.
    pub fn evaluate_focus_json(&mut self, request_json: &str) -> String {
        if request_json.len() > TRIO_MAX_REQUEST_BYTES {
            return trio_focus_rejected(
                String::new(),
                "oversized",
                TRIO_MSG_OVERSIZED,
                "oversized-request",
            );
        }
        let raw: serde_json::Value = match serde_json::from_str(request_json) {
            Ok(raw) => raw,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_focus_rejected(String::new(), kind, message, kind);
            }
        };
        let action = raw
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        match action {
            "request" => self.evaluate_focus_request(&raw),
            "acknowledge" => self.evaluate_trio_ack(&raw, TrioAckRoute::Focus),
            "verify" => self.evaluate_focus_verify(&raw),
            "note-loss" => self.evaluate_trio_loss(&raw, TrioAckRoute::Focus),
            _ => {
                let (kind, message) = if action.is_empty() {
                    ("request-malformed", TRIO_MSG_MALFORMED)
                } else {
                    ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
                };
                trio_focus_rejected(trio_valid_correlation_echo(&raw), kind, message, kind)
            }
        }
    }

    fn evaluate_focus_request(&mut self, raw: &serde_json::Value) -> String {
        let request: TrioFocusRequestDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_focus_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "request" {
            let (kind, message) = if request.v != 1 {
                ("unsupported-version", TRIO_MSG_VERSION)
            } else {
                ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
            };
            return trio_focus_rejected(request.correlation_id.clone(), kind, message, kind);
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_focus_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if !trio_is_opaque_id(&request.domain.output)
            || !trio_is_opaque_id(&request.domain.workspace)
            || !trio_is_opaque_id(&request.focused_window)
        {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OPAQUE_ID,
                "root-id-invalid",
            );
        }
        let Some(direction) = trio_parse_direction(&request.direction) else {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                TRIO_MSG_DIRECTION,
                "direction-invalid",
            );
        };
        if request.windows.len() != TRIO_WINDOWS {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "window-count-mismatch",
            );
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.windows {
                if !trio_is_opaque_id(&entry.window)
                    || !trio_is_opaque_id(&entry.output)
                    || !trio_is_opaque_id(&entry.workspace)
                {
                    return trio_focus_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "observed-id-invalid",
                    );
                }
                if !seen.insert(entry.window.clone()) {
                    return trio_focus_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "duplicate-window",
                    );
                }
            }
        }
        if !request.capabilities.directional_focus {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "unsupported-capability",
                TRIO_MSG_CAPABILITY,
                "unsupported-capability",
            );
        }
        let expected = Self::focus_expected_fingerprint(
            &request.domain.output,
            &request.domain.workspace,
            &request.focused_window,
            &request.windows,
        );
        if request.fingerprint != expected {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "fingerprint-mismatch",
            );
        }
        if !self.claim_correlation(&request.correlation_id) {
            if self.seen.contains(&request.correlation_id) {
                return trio_focus_diverged(
                    request.correlation_id.clone(),
                    "correlation-mismatch",
                    "correlation does not match the pending plan",
                );
            }
            return self.diverged_exhausted_focus(request.correlation_id.clone());
        }
        if self.runtime.is_none() {
            // Focus carries no work-area geometry and can never seed the
            // trio: fail closed without session state.
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "unseeded-trio",
            );
        }
        let flat: Vec<(String, String, String)> = request
            .windows
            .iter()
            .map(|w| (w.window.clone(), w.output.clone(), w.workspace.clone()))
            .collect();
        if !self.check_trio_membership(
            &request.domain.output,
            &request.domain.workspace,
            &flat,
            &request.focused_window,
        ) {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "membership-mismatch",
            );
        }
        let owner = OwnerId::parse(&request.owner).expect("validated");
        let generation = GenerationId::parse(&request.generation).expect("validated");
        let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
        let domain = DomainKey {
            output: OutputId(request.domain.output.clone()),
            workspace: WorkspaceId(request.domain.workspace.clone()),
        };
        let window = WindowId(request.focused_window.clone());
        let observed: Vec<ObservedWindow> = request
            .windows
            .iter()
            .map(|entry| ObservedWindow {
                window: WindowId(entry.window.clone()),
                output: OutputId(entry.output.clone()),
                workspace: WorkspaceId(entry.workspace.clone()),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        let session = self.session_mut().expect("seeded");
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                request.revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        let caps = FocusCapabilities {
            directional_focus: request.capabilities.directional_focus,
        };
        match session.propose_focus(
            &domain,
            &window,
            direction,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                self.pending = Some(TrioPending::Focus {
                    correlation: request.correlation_id.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                });
                trio_serialize_focus(&TrioFocusReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "planned",
                    kind: None,
                    message: None,
                    base_revision: Some(plan.dispatch.base_revision),
                    revision: None,
                    capability: Some("directional-focus"),
                    preconditions: Some(
                        plan.dispatch
                            .preconditions
                            .iter()
                            .map(trio_focus_precondition_str)
                            .collect(),
                    ),
                    operation: Some(TrioFocusOperationReply {
                        domain_output: plan.dispatch.operation.domain_output.0.clone(),
                        domain_workspace: plan.dispatch.operation.domain_workspace.0.clone(),
                        from_leaf: plan.dispatch.operation.from_leaf.0.clone(),
                        to_leaf: plan.dispatch.operation.to_leaf.0.clone(),
                        from_window: plan.dispatch.operation.from_window.0.clone(),
                        to_window: plan.dispatch.operation.to_window.0.clone(),
                        direction: request.direction.clone(),
                        route: plan
                            .dispatch
                            .operation
                            .route
                            .iter()
                            .map(|id| id.0.clone())
                            .collect(),
                    }),
                    to_window: Some(plan.dispatch.operation.to_window.0.clone()),
                    detail: None,
                })
            }
            Err(ProposeError::PendingExists) => trio_focus_diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => {
                self.pending = None;
                trio_focus_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "unchanged" {
                    let revision = self.accepted_revision();
                    trio_serialize_focus(&TrioFocusReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        to_window: None,
                        detail: None,
                    })
                } else {
                    trio_focus_rejected(
                        request.correlation_id.clone(),
                        kind.as_str(),
                        kind.message(),
                        trio_refusal_detail(kind),
                    )
                }
            }
        }
    }

    fn focus_terminal_verify_diverge(&mut self, correlation_id: String) -> String {
        self.pending = None;
        if let Some(session) = self.session_mut() {
            let _ = session.note_adapter_loss();
        }
        trio_focus_diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn focus_mismatched_verify_diverge(
        &mut self,
        owner: OwnerId,
        generation: GenerationId,
        correlation: CorrelationId,
        revision: u64,
        fingerprint: u64,
        preconditions: Vec<FocusPrecondition>,
        operation: FocusOperation,
    ) -> String {
        let correlation_id = correlation.as_str().to_owned();
        let post = FocusPostObservation::new(
            Observation::new(owner, generation, revision, fingerprint),
            correlation,
            false,
            preconditions,
            operation,
        );
        if let Some(session) = self.session_mut() {
            let _ = session.verify_focus(&post);
            if session.divergence().is_none() {
                let _ = session.note_adapter_loss();
            }
        }
        self.pending = None;
        trio_focus_diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    fn evaluate_focus_verify(&mut self, raw: &serde_json::Value) -> String {
        let request: TrioFocusVerifyDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_focus_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "verify" {
            return trio_focus_rejected(
                trio_valid_correlation_echo(raw),
                "unsupported-version",
                TRIO_MSG_VERSION,
                "unsupported-version",
            );
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_focus_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if request.verified_preconditions.len() != TRIO_FOCUS_PRECONDITIONS.len()
            || request
                .verified_preconditions
                .iter()
                .zip(TRIO_FOCUS_PRECONDITIONS.iter())
                .any(|(got, want)| got != want)
            || request.verified_operation.route.is_empty()
            || request.verified_operation.route.len() > TRIO_MAX_ROUTE
        {
            return self.focus_terminal_verify_diverge(request.correlation_id.clone());
        }
        let mut preconditions = Vec::with_capacity(request.verified_preconditions.len());
        for token in &request.verified_preconditions {
            let Some(pre) = trio_focus_precondition_token(token) else {
                return self.focus_terminal_verify_diverge(request.correlation_id.clone());
            };
            if preconditions.contains(&pre) {
                return self.focus_terminal_verify_diverge(request.correlation_id.clone());
            }
            preconditions.push(pre);
        }
        let Some(direction) = trio_parse_direction(&request.verified_operation.direction) else {
            return self.focus_terminal_verify_diverge(request.correlation_id.clone());
        };
        for id in [
            &request.verified_operation.domain_output,
            &request.verified_operation.domain_workspace,
            &request.verified_operation.from_leaf,
            &request.verified_operation.to_leaf,
            &request.verified_operation.from_window,
            &request.verified_operation.to_window,
        ] {
            if !trio_is_opaque_id(id) {
                return self.focus_terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        for id in &request.verified_operation.route {
            if !trio_is_opaque_id(id) {
                return self.focus_terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        let Some(correlation) = CorrelationId::parse(&request.correlation_id) else {
            return trio_focus_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        };
        let Some(owner) = OwnerId::parse(&request.owner) else {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        };
        let Some(generation) = GenerationId::parse(&request.generation) else {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        };
        let operation = FocusOperation {
            domain_output: OutputId(request.verified_operation.domain_output.clone()),
            domain_workspace: WorkspaceId(request.verified_operation.domain_workspace.clone()),
            from_leaf: NodeId(request.verified_operation.from_leaf.clone()),
            to_leaf: NodeId(request.verified_operation.to_leaf.clone()),
            from_window: WindowId(request.verified_operation.from_window.clone()),
            to_window: WindowId(request.verified_operation.to_window.clone()),
            direction,
            route: request
                .verified_operation
                .route
                .iter()
                .map(|id| NodeId(id.clone()))
                .collect(),
        };
        // Shared pending mirror: focus plans bind here exactly like
        // movement/resize. A foreign Move/Resize pending or a mismatched
        // Focus binding diverges through the session without weakening
        // Session/Reconciler fencing. No mirror (None) falls through to the
        // session below, which remains authoritative.
        if let Some(pending) = self.pending.clone() {
            let TrioPending::Focus {
                correlation: pending_correlation,
                operation: pending_operation,
                preconditions: pending_preconditions,
            } = pending
            else {
                return self.focus_mismatched_verify_diverge(
                    owner,
                    generation,
                    correlation,
                    request.revision,
                    request.fingerprint,
                    preconditions,
                    operation,
                );
            };
            if pending_correlation != request.correlation_id
                || preconditions != pending_preconditions
                || operation != pending_operation
            {
                return self.focus_mismatched_verify_diverge(
                    owner,
                    generation,
                    correlation,
                    request.revision,
                    request.fingerprint,
                    preconditions,
                    operation,
                );
            }
        }
        if let Some(runtime) = self.runtime.as_ref() {
            let mut known: Vec<String> = runtime
                .session
                .snapshot()
                .windows
                .iter()
                .map(|l| l.window.0.clone())
                .collect();
            known.extend(
                runtime
                    .session
                    .exception_observed()
                    .iter()
                    .map(|w| w.window.0.clone()),
            );
            known.sort();
            known.dedup();
            let expected_post = focus_fingerprint(
                &request.verified_operation.domain_output,
                &request.verified_operation.domain_workspace,
                &request.verified_operation.to_window,
                &known,
            );
            if request.fingerprint != expected_post {
                let post = FocusPostObservation::new(
                    Observation::new(
                        owner.clone(),
                        generation.clone(),
                        request.revision,
                        request.fingerprint,
                    ),
                    correlation.clone(),
                    false,
                    preconditions.clone(),
                    operation.clone(),
                );
                if let Some(session) = self.session_mut() {
                    let _ = session.verify_focus(&post);
                }
                self.pending = None;
                return trio_focus_diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
        }
        let post = FocusPostObservation::new(
            Observation::new(owner, generation, request.revision, request.fingerprint),
            correlation,
            request.verified,
            preconditions,
            operation,
        );
        let Some(session) = self.session_mut() else {
            return trio_focus_rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits verification",
                "no-pending",
            );
        };
        match session.verify_focus(&post) {
            Ok(commit) => {
                self.pending = None;
                trio_serialize_focus(&TrioFocusReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "committed",
                    kind: None,
                    message: None,
                    base_revision: None,
                    revision: Some(commit.revision),
                    capability: None,
                    preconditions: None,
                    operation: None,
                    to_window: None,
                    detail: None,
                })
            }
            Err(crate::reconcile::VerifyError::NoPending) => trio_focus_rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits verification",
                "no-pending",
            ),
            Err(crate::reconcile::VerifyError::NotAcknowledged) => trio_focus_rejected(
                request.correlation_id.clone(),
                "not-acknowledged",
                "plan awaits acknowledgement before verification",
                "not-acknowledged",
            ),
            Err(crate::reconcile::VerifyError::Diverged(reason)) => {
                self.pending = None;
                trio_focus_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
        }
    }
}

/// D-Bus route of a shared acknowledge/loss call, for keyboard/pointer
/// action fencing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrioAckRoute {
    Focus,
    Movement,
    ResizeKeyboard,
    ResizePointer,
}

impl ManualTrioService {
    /// Shared acknowledgement for focus/movement/resize pending plans.
    /// Keyboard and pointer resize cycles are action-fenced: a shared call
    /// through one resize route never touches a pending plan owned by the
    /// other (rejected without mutation, preserving the foreign cycle).
    /// Every other mismatch delegates to the session, which diverges
    /// fail-closed exactly like the former per-route services.
    fn evaluate_trio_ack(&mut self, raw: &serde_json::Value, route: TrioAckRoute) -> String {
        let request: TrioAckDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return match route {
                    TrioAckRoute::Focus => {
                        trio_focus_rejected(trio_valid_correlation_echo(raw), kind, message, kind)
                    }
                    TrioAckRoute::Movement => {
                        trio_move_rejected(trio_valid_correlation_echo(raw), kind, message, kind)
                    }
                    TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                        trio_resize_rejected(trio_valid_correlation_echo(raw), kind, message, kind)
                    }
                };
            }
        };
        let version_ok = request.v == 1 && request.action == "acknowledge";
        if !version_ok {
            let echo = trio_valid_correlation_echo(raw);
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    echo,
                    "unsupported-version",
                    TRIO_MSG_VERSION,
                    "unsupported-version",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    echo,
                    "unsupported-version",
                    TRIO_MSG_VERSION,
                    "unsupported-version",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    echo,
                    "unsupported-version",
                    TRIO_MSG_VERSION,
                    "unsupported-version",
                ),
            };
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            let empty = String::new();
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    empty,
                    "correlation-invalid",
                    TRIO_MSG_CORRELATION,
                    "correlation-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    empty,
                    "correlation-invalid",
                    TRIO_MSG_CORRELATION,
                    "correlation-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    empty,
                    "correlation-invalid",
                    TRIO_MSG_CORRELATION,
                    "correlation-invalid",
                ),
            };
        }
        if OwnerId::parse(&request.owner).is_none() {
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "owner-invalid",
                    TRIO_MSG_OWNER,
                    "owner-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "owner-invalid",
                    TRIO_MSG_OWNER,
                    "owner-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "owner-invalid",
                    TRIO_MSG_OWNER,
                    "owner-invalid",
                ),
            };
        }
        if GenerationId::parse(&request.generation).is_none() {
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "generation-invalid",
                    TRIO_MSG_GENERATION,
                    "generation-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "generation-invalid",
                    TRIO_MSG_GENERATION,
                    "generation-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "generation-invalid",
                    TRIO_MSG_GENERATION,
                    "generation-invalid",
                ),
            };
        }
        if request.base_revision > TRIO_MAX_REVISION {
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "revision-invalid",
                    TRIO_MSG_REVISION,
                    "revision-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "revision-invalid",
                    TRIO_MSG_REVISION,
                    "revision-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "revision-invalid",
                    TRIO_MSG_REVISION,
                    "revision-invalid",
                ),
            };
        }
        let outcome = match request.outcome.as_str() {
            "accepted" => AckOutcome::Accepted,
            "refused-capability" => AckOutcome::RefusedCapability,
            "partial-application" => AckOutcome::PartialApplication,
            "adapter-lost" => AckOutcome::AdapterLost,
            _ => {
                return match route {
                    TrioAckRoute::Focus => trio_focus_rejected(
                        request.correlation_id.clone(),
                        "unknown-value",
                        TRIO_MSG_UNKNOWN_VALUE,
                        "unknown-value",
                    ),
                    TrioAckRoute::Movement => trio_move_rejected(
                        request.correlation_id.clone(),
                        "unknown-value",
                        TRIO_MSG_UNKNOWN_VALUE,
                        "unknown-value",
                    ),
                    TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                        trio_resize_rejected(
                            request.correlation_id.clone(),
                            "unknown-value",
                            TRIO_MSG_UNKNOWN_VALUE,
                            "unknown-value",
                        )
                    }
                };
            }
        };
        // Keyboard/pointer fencing before any session contact.
        if let (
            Some(TrioPending::Resize { origin, .. }),
            TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer,
        ) = (&self.pending, route)
        {
            let wanted = match route {
                TrioAckRoute::ResizeKeyboard => TrioResizeOrigin::Keyboard,
                _ => TrioResizeOrigin::Pointer,
            };
            if *origin != wanted {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "cross-route-pending-fenced",
                );
            }
        }
        let Some(correlation) = CorrelationId::parse(&request.correlation_id) else {
            let empty = String::new();
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    empty,
                    "correlation-invalid",
                    TRIO_MSG_CORRELATION,
                    "correlation-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    empty,
                    "correlation-invalid",
                    TRIO_MSG_CORRELATION,
                    "correlation-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    empty,
                    "correlation-invalid",
                    TRIO_MSG_CORRELATION,
                    "correlation-invalid",
                ),
            };
        };
        let Some(owner) = OwnerId::parse(&request.owner) else {
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "owner-invalid",
                    TRIO_MSG_OWNER,
                    "owner-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "owner-invalid",
                    TRIO_MSG_OWNER,
                    "owner-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "owner-invalid",
                    TRIO_MSG_OWNER,
                    "owner-invalid",
                ),
            };
        };
        let Some(generation) = GenerationId::parse(&request.generation) else {
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "generation-invalid",
                    TRIO_MSG_GENERATION,
                    "generation-invalid",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "generation-invalid",
                    TRIO_MSG_GENERATION,
                    "generation-invalid",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "generation-invalid",
                    TRIO_MSG_GENERATION,
                    "generation-invalid",
                ),
            };
        };
        let ack = AdapterAck::new(
            correlation,
            owner,
            generation,
            request.base_revision,
            outcome,
        );
        let Some(session) = self.session_mut() else {
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "no-pending",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "no-pending",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "no-pending",
                ),
            };
        };
        match session.acknowledge(&ack) {
            Ok(_) => match route {
                TrioAckRoute::Focus => trio_serialize_focus(&TrioFocusReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "acknowledged",
                    kind: None,
                    message: None,
                    base_revision: Some(request.base_revision),
                    revision: None,
                    capability: None,
                    preconditions: None,
                    operation: None,
                    to_window: None,
                    detail: None,
                }),
                TrioAckRoute::Movement => trio_serialize_move(&TrioMoveReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "acknowledged",
                    kind: None,
                    message: None,
                    base_revision: Some(request.base_revision),
                    revision: None,
                    capability: None,
                    rule: None,
                    preconditions: None,
                    operation: None,
                    desired_geometry: None,
                    desired_focus: None,
                    detail: None,
                }),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                    trio_serialize_resize(&TrioResizeReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "acknowledged",
                        kind: None,
                        message: None,
                        base_revision: Some(request.base_revision),
                        revision: None,
                        capability: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
                        detail: None,
                    })
                }
            },
            Err(crate::reconcile::AckError::NoPending) => match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "no-pending",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "no-pending",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits acknowledgement",
                    "no-pending",
                ),
            },
            Err(crate::reconcile::AckError::Diverged(reason)) => {
                self.pending = None;
                match route {
                    TrioAckRoute::Focus => trio_focus_diverged(
                        request.correlation_id.clone(),
                        reason.as_str(),
                        reason.message(),
                    ),
                    TrioAckRoute::Movement => trio_move_diverged(
                        request.correlation_id.clone(),
                        reason.as_str(),
                        reason.message(),
                    ),
                    TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                        trio_resize_diverged(
                            request.correlation_id.clone(),
                            reason.as_str(),
                            reason.message(),
                        )
                    }
                }
            }
        }
    }

    /// Shared explicit adapter-loss signal. Always diverges terminally,
    /// except cross-route resize loss which is fenced without mutation and
    /// loss before any seed.
    fn evaluate_trio_loss(&mut self, raw: &serde_json::Value, route: TrioAckRoute) -> String {
        let request: TrioLossDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return match route {
                    TrioAckRoute::Focus => {
                        trio_focus_rejected(trio_valid_correlation_echo(raw), kind, message, kind)
                    }
                    TrioAckRoute::Movement => {
                        trio_move_rejected(trio_valid_correlation_echo(raw), kind, message, kind)
                    }
                    TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                        trio_resize_rejected(trio_valid_correlation_echo(raw), kind, message, kind)
                    }
                };
            }
        };
        if request.v != 1 || request.action != "note-loss" {
            let echo = trio_valid_correlation_echo(raw);
            return match route {
                TrioAckRoute::Focus => trio_focus_rejected(
                    echo,
                    "unsupported-version",
                    TRIO_MSG_VERSION,
                    "unsupported-version",
                ),
                TrioAckRoute::Movement => trio_move_rejected(
                    echo,
                    "unsupported-version",
                    TRIO_MSG_VERSION,
                    "unsupported-version",
                ),
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => trio_resize_rejected(
                    echo,
                    "unsupported-version",
                    TRIO_MSG_VERSION,
                    "unsupported-version",
                ),
            };
        }
        // Cross-route resize loss never touches the foreign pending cycle.
        if let (
            Some(TrioPending::Resize { origin, .. }),
            TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer,
        ) = (&self.pending, route)
        {
            let wanted = match route {
                TrioAckRoute::ResizeKeyboard => TrioResizeOrigin::Keyboard,
                _ => TrioResizeOrigin::Pointer,
            };
            if *origin != wanted {
                return trio_resize_rejected(
                    String::new(),
                    "no-pending",
                    "no pending plan awaits loss",
                    "cross-route-pending-fenced",
                );
            }
        }
        let Some(session) = self.session_mut() else {
            return match route {
                TrioAckRoute::Focus => {
                    trio_focus_diverged(String::new(), "adapter-lost", "adapter reported loss")
                }
                TrioAckRoute::Movement => {
                    trio_move_diverged(String::new(), "adapter-lost", "adapter reported loss")
                }
                TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                    trio_resize_diverged(String::new(), "adapter-lost", "adapter reported loss")
                }
            };
        };
        let reason = session.note_adapter_loss();
        self.pending = None;
        match route {
            TrioAckRoute::Focus => {
                trio_focus_diverged(String::new(), reason.as_str(), reason.message())
            }
            TrioAckRoute::Movement => {
                trio_move_diverged(String::new(), reason.as_str(), reason.message())
            }
            TrioAckRoute::ResizeKeyboard | TrioAckRoute::ResizePointer => {
                trio_resize_diverged(String::new(), reason.as_str(), reason.message())
            }
        }
    }

    /// Strict JSON-only movement transaction over the shared trio session.
    /// Always returns a bounded reply. Rejects while unseeded: movement
    /// carries no per-window geometry and can never seed the trio.
    pub fn evaluate_movement_json(&mut self, request_json: &str) -> String {
        if request_json.len() > TRIO_MAX_REQUEST_BYTES {
            return trio_move_rejected(
                String::new(),
                "oversized",
                TRIO_MSG_OVERSIZED,
                "oversized-request",
            );
        }
        let raw: serde_json::Value = match serde_json::from_str(request_json) {
            Ok(raw) => raw,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_move_rejected(String::new(), kind, message, kind);
            }
        };
        let action = raw
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        match action {
            "request" => self.evaluate_movement_request(&raw),
            "acknowledge" => self.evaluate_trio_ack(&raw, TrioAckRoute::Movement),
            "verify" => self.evaluate_movement_verify(&raw),
            "note-loss" => self.evaluate_trio_loss(&raw, TrioAckRoute::Movement),
            _ => {
                let (kind, message) = if action.is_empty() {
                    ("request-malformed", TRIO_MSG_MALFORMED)
                } else {
                    ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
                };
                trio_move_rejected(trio_valid_correlation_echo(&raw), kind, message, kind)
            }
        }
    }

    fn evaluate_movement_request(&mut self, raw: &serde_json::Value) -> String {
        let request: TrioMoveRequestDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_move_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "request" {
            let (kind, message) = if request.v != 1 {
                ("unsupported-version", TRIO_MSG_VERSION)
            } else {
                ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
            };
            return trio_move_rejected(request.correlation_id.clone(), kind, message, kind);
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_move_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if !trio_is_opaque_id(&request.domain.output)
            || !trio_is_opaque_id(&request.domain.workspace)
            || !trio_is_opaque_id(&request.focused_window)
        {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OPAQUE_ID,
                "root-id-invalid",
            );
        }
        let Some(direction) = trio_parse_direction(&request.direction) else {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                TRIO_MSG_DIRECTION,
                "direction-invalid",
            );
        };
        if request.windows.len() != TRIO_WINDOWS {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "window-count-mismatch",
            );
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.windows {
                if !trio_is_opaque_id(&entry.window)
                    || !trio_is_opaque_id(&entry.output)
                    || !trio_is_opaque_id(&entry.workspace)
                {
                    return trio_move_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "observed-id-invalid",
                    );
                }
                if !seen.insert(entry.window.clone()) {
                    return trio_move_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "duplicate-window",
                    );
                }
            }
        }
        let mut sorted: Vec<String> = request.windows.iter().map(|w| w.window.clone()).collect();
        sorted.sort();
        let expected = focus_fingerprint(
            &request.domain.output,
            &request.domain.workspace,
            &request.focused_window,
            &sorted,
        );
        if request.fingerprint != expected {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "fingerprint-mismatch",
            );
        }
        if !request.windows.iter().any(|w| {
            w.window == request.focused_window
                && w.output == request.domain.output
                && w.workspace == request.domain.workspace
        }) {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "focused-observation-mismatch",
            );
        }
        if !self.claim_correlation(&request.correlation_id) {
            if self.seen.contains(&request.correlation_id) {
                return trio_move_diverged(
                    request.correlation_id.clone(),
                    "correlation-mismatch",
                    "correlation does not match the pending plan",
                );
            }
            return self.diverged_exhausted_move(request.correlation_id.clone());
        }
        if self.runtime.is_none() {
            // Movement carries no per-window geometry and can never seed the
            // trio: fail closed without session state.
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "unseeded-trio",
            );
        }
        let flat: Vec<(String, String, String)> = request
            .windows
            .iter()
            .map(|w| (w.window.clone(), w.output.clone(), w.workspace.clone()))
            .collect();
        if !self.check_trio_membership(
            &request.domain.output,
            &request.domain.workspace,
            &flat,
            &request.focused_window,
        ) {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "membership-mismatch",
            );
        }
        // The trio scope is exactly one domain: a carried domains vector must
        // describe exactly the owned trio domain (bounds, gap, adjacency).
        if let Some(seeds) = &request.domains
            && !self.move_seed_domains_match(seeds)
        {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "movement-domain-mismatch",
            );
        }
        let owner = OwnerId::parse(&request.owner).expect("validated");
        let generation = GenerationId::parse(&request.generation).expect("validated");
        let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
        let domain = DomainKey {
            output: OutputId(request.domain.output.clone()),
            workspace: WorkspaceId(request.domain.workspace.clone()),
        };
        let window = WindowId(request.focused_window.clone());
        let observed: Vec<ObservedWindow> = request
            .windows
            .iter()
            .map(|entry| ObservedWindow {
                window: WindowId(entry.window.clone()),
                output: OutputId(entry.output.clone()),
                workspace: WorkspaceId(entry.workspace.clone()),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        let caps = Capabilities {
            swap_neighbor: request.capabilities.swap_neighbor,
            wrap_perpendicular: request.capabilities.wrap_perpendicular,
            wrap_siblings: request.capabilities.wrap_siblings,
            insert_child: request.capabilities.insert_child,
            split_group_child: request.capabilities.split_group_child,
            reparent_leaf: request.capabilities.reparent_leaf,
            cross_output_transfer: request.capabilities.cross_output_transfer,
        };
        let session = self.session_mut().expect("seeded");
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                request.revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        match session.propose_move(
            &domain,
            &window,
            direction,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                let rule = trio_move_rule_str(plan.dispatch.rule);
                let capability = trio_move_capability_str(plan.dispatch.required_capability);
                let preconditions: Vec<&'static str> = plan
                    .dispatch
                    .preconditions
                    .iter()
                    .map(|p| trio_move_precondition_str(*p))
                    .collect();
                let operation = trio_move_operation_to_value(&plan.dispatch.operation);
                let desired_geometry: Vec<TrioGeometryReply> = plan
                    .desired_geometry
                    .iter()
                    .map(trio_move_geometry_reply)
                    .collect();
                let desired_focus = TrioFocusBodyReply {
                    domain_output: plan.desired_focus_domain.output.0.clone(),
                    domain_workspace: plan.desired_focus_domain.workspace.0.clone(),
                    leaf: plan.desired_focus_leaf.0.clone(),
                };
                self.pending = Some(TrioPending::Move {
                    correlation: request.correlation_id.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                    geometry: plan.desired_geometry.clone(),
                    focus_domain: plan.desired_focus_domain.clone(),
                    focus_leaf: plan.desired_focus_leaf.clone(),
                });
                trio_serialize_move(&TrioMoveReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "planned",
                    kind: None,
                    message: None,
                    base_revision: Some(plan.dispatch.base_revision),
                    revision: None,
                    capability: Some(capability),
                    rule: Some(rule),
                    preconditions: Some(preconditions),
                    operation: Some(operation),
                    desired_geometry: Some(desired_geometry),
                    desired_focus: Some(desired_focus),
                    detail: None,
                })
            }
            Err(ProposeError::PendingExists) => trio_move_diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => {
                self.pending = None;
                trio_move_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "planner-noop" {
                    let revision = self.accepted_revision();
                    trio_serialize_move(&TrioMoveReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        rule: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
                        detail: None,
                    })
                } else {
                    trio_move_rejected(
                        request.correlation_id.clone(),
                        kind.as_str(),
                        kind.message(),
                        trio_refusal_detail(kind),
                    )
                }
            }
        }
    }

    /// A carried movement domains vector matches only when it describes
    /// exactly the one owned trio domain (bounds, gap, reciprocal
    /// adjacency). Anything else is a cross-domain mismatch for this scope.
    fn move_seed_domains_match(&self, seeds: &[TrioMoveSeedDomainDto]) -> bool {
        let runtime = match self.runtime.as_ref() {
            Some(runtime) => runtime,
            None => return false,
        };
        if seeds.len() != 1 {
            return false;
        }
        let seed = &seeds[0];
        if !trio_is_opaque_id(&seed.output) || !trio_is_opaque_id(&seed.workspace) {
            return false;
        }
        let bounds = Rect {
            x: seed.bounds.x,
            y: seed.bounds.y,
            w: seed.bounds.w,
            h: seed.bounds.h,
        };
        if !trio_valid_carried_rect(bounds.x, bounds.y, bounds.w, bounds.h) {
            return false;
        }
        if seed.gap < 0 || seed.gap > TRIO_GEOMETRY_MAX_GAP {
            return false;
        }
        let mut adjacent = std::collections::BTreeMap::new();
        for (dir_text, target_text) in &seed.adjacent {
            let Some(direction) = trio_parse_direction(dir_text) else {
                return false;
            };
            if !trio_is_opaque_id(target_text) {
                return false;
            }
            if adjacent
                .insert(direction, OutputId(target_text.clone()))
                .is_some()
            {
                return false;
            }
        }
        let domain = OutputDomain {
            id: OutputId(seed.output.clone()),
            workspace: WorkspaceId(seed.workspace.clone()),
            bounds,
            gap: seed.gap,
            adjacent,
        };
        if !domain.validate() {
            return false;
        }
        runtime.session.domains().len() == 1 && runtime.session.domains()[0] == domain
    }

    fn move_terminal_verify_diverge(&mut self, correlation_id: String) -> String {
        self.pending = None;
        if let Some(session) = self.session_mut() {
            let _ = session.note_adapter_loss();
        }
        trio_move_diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn move_mismatched_verify_diverge(
        &mut self,
        owner: OwnerId,
        generation: GenerationId,
        correlation: CorrelationId,
        revision: u64,
        fingerprint: u64,
        preconditions: Vec<Precondition>,
        operation: MoveOperation,
    ) -> String {
        let correlation_id = correlation.as_str().to_owned();
        let post = PostObservation::new(
            Observation::new(owner, generation, revision, fingerprint),
            correlation,
            false,
            preconditions,
            operation,
        );
        if let Some(session) = self.session_mut() {
            let _ = session.verify_move(&post);
            if session.divergence().is_none() {
                let _ = session.note_adapter_loss();
            }
        }
        self.pending = None;
        trio_move_diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    fn evaluate_movement_verify(&mut self, raw: &serde_json::Value) -> String {
        let request: TrioMoveVerifyDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_move_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "verify" {
            return trio_move_rejected(
                trio_valid_correlation_echo(raw),
                "unsupported-version",
                TRIO_MSG_VERSION,
                "unsupported-version",
            );
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_move_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if request.verified_geometry.is_empty()
            || request.verified_geometry.len() > TRIO_MAX_GEOMETRY
        {
            return self.move_terminal_verify_diverge(request.correlation_id.clone());
        }
        for id in [
            &request.verified_focus.domain_output,
            &request.verified_focus.domain_workspace,
            &request.verified_focus.leaf,
        ] {
            if !trio_is_opaque_id(id) {
                return self.move_terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        for entry in &request.verified_geometry {
            if !trio_is_opaque_id(&entry.window)
                || !trio_is_opaque_id(&entry.leaf)
                || !trio_is_opaque_id(&entry.output)
                || !trio_is_opaque_id(&entry.workspace)
                || entry.rect.w <= 0
                || entry.rect.h <= 0
            {
                return self.move_terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.verified_geometry {
                if !seen.insert(entry.window.clone()) {
                    return self.move_terminal_verify_diverge(request.correlation_id.clone());
                }
            }
        }
        let Some(operation) = trio_move_parse_operation(&request.verified_operation) else {
            return self.move_terminal_verify_diverge(request.correlation_id.clone());
        };
        let mut preconditions = Vec::with_capacity(request.verified_preconditions.len());
        for token in &request.verified_preconditions {
            let Some(pre) = trio_move_parse_precondition(token) else {
                return self.move_terminal_verify_diverge(request.correlation_id.clone());
            };
            if preconditions.contains(&pre) {
                return self.move_terminal_verify_diverge(request.correlation_id.clone());
            }
            preconditions.push(pre);
        }
        let Some(correlation) = CorrelationId::parse(&request.correlation_id) else {
            return trio_move_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        };
        let Some(owner) = OwnerId::parse(&request.owner) else {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        };
        let Some(generation) = GenerationId::parse(&request.generation) else {
            return trio_move_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        };
        let Some(pending) = self.pending.clone() else {
            if self.runtime.is_none() {
                return trio_move_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits verification",
                    "no-pending",
                );
            }
            let post = PostObservation::new(
                Observation::new(owner, generation, request.revision, request.fingerprint),
                correlation,
                request.verified,
                preconditions,
                operation,
            );
            let session = self.session_mut().expect("seeded");
            return match session.verify_move(&post) {
                Ok(commit) => {
                    self.pending = None;
                    trio_serialize_move(&TrioMoveReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "committed",
                        kind: None,
                        message: None,
                        base_revision: None,
                        revision: Some(commit.revision),
                        capability: None,
                        rule: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
                        detail: None,
                    })
                }
                Err(crate::reconcile::VerifyError::NoPending) => trio_move_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits verification",
                    "no-pending",
                ),
                Err(crate::reconcile::VerifyError::NotAcknowledged) => trio_move_rejected(
                    request.correlation_id.clone(),
                    "not-acknowledged",
                    "plan awaits acknowledgement before verification",
                    "not-acknowledged",
                ),
                Err(crate::reconcile::VerifyError::Diverged(reason)) => {
                    self.pending = None;
                    trio_move_diverged(
                        request.correlation_id.clone(),
                        reason.as_str(),
                        reason.message(),
                    )
                }
            };
        };
        let TrioPending::Move {
            correlation: pending_correlation,
            operation: pending_operation,
            preconditions: pending_preconditions,
            geometry: pending_geometry,
            focus_domain: pending_focus_domain,
            focus_leaf: pending_focus_leaf,
        } = pending
        else {
            return self.move_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        };
        if pending_correlation != request.correlation_id
            || preconditions != pending_preconditions
            || operation != pending_operation
        {
            return self.move_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        }
        if request.verified_geometry.len() != pending_geometry.len() {
            return self.move_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        }
        {
            let mut want: Vec<(String, String, String, String, Rect)> = pending_geometry
                .iter()
                .map(|g| {
                    (
                        g.window.0.clone(),
                        g.leaf.0.clone(),
                        g.output.0.clone(),
                        g.workspace.0.clone(),
                        g.rect,
                    )
                })
                .collect();
            want.sort_by(|a, b| {
                (&a.0, &a.1, &a.2, &a.3, a.4.x, a.4.y, a.4.w, a.4.h)
                    .cmp(&(&b.0, &b.1, &b.2, &b.3, b.4.x, b.4.y, b.4.w, b.4.h))
            });
            let mut got: Vec<(String, String, String, String, Rect)> = request
                .verified_geometry
                .iter()
                .map(|g| {
                    (
                        g.window.clone(),
                        g.leaf.clone(),
                        g.output.clone(),
                        g.workspace.clone(),
                        Rect {
                            x: g.rect.x,
                            y: g.rect.y,
                            w: g.rect.w,
                            h: g.rect.h,
                        },
                    )
                })
                .collect();
            got.sort_by(|a, b| {
                (&a.0, &a.1, &a.2, &a.3, a.4.x, a.4.y, a.4.w, a.4.h)
                    .cmp(&(&b.0, &b.1, &b.2, &b.3, b.4.x, b.4.y, b.4.w, b.4.h))
            });
            if want != got {
                return self.move_mismatched_verify_diverge(
                    owner,
                    generation,
                    correlation,
                    request.revision,
                    request.fingerprint,
                    preconditions,
                    operation,
                );
            }
        }
        if request.verified_focus.domain_output != pending_focus_domain.output.0
            || request.verified_focus.domain_workspace != pending_focus_domain.workspace.0
            || request.verified_focus.leaf != pending_focus_leaf.0
        {
            return self.move_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        }
        if let Some(runtime) = self.runtime.as_ref() {
            for entry in &request.verified_geometry {
                let key = DomainKey {
                    output: OutputId(entry.output.clone()),
                    workspace: WorkspaceId(entry.workspace.clone()),
                };
                let contained = runtime
                    .session
                    .domains()
                    .iter()
                    .find(|d| d.key() == key)
                    .is_some_and(|d| {
                        rect_contained_in(
                            Rect {
                                x: entry.rect.x,
                                y: entry.rect.y,
                                w: entry.rect.w,
                                h: entry.rect.h,
                            },
                            d.bounds,
                        )
                    });
                if !contained {
                    return self.move_mismatched_verify_diverge(
                        owner,
                        generation,
                        correlation,
                        request.revision,
                        request.fingerprint,
                        preconditions,
                        operation,
                    );
                }
            }
        }
        let post = PostObservation::new(
            Observation::new(owner, generation, request.revision, request.fingerprint),
            correlation,
            request.verified,
            preconditions,
            operation,
        );
        let session = self.session_mut().expect("seeded");
        match session.verify_move(&post) {
            Ok(commit) => {
                self.pending = None;
                trio_serialize_move(&TrioMoveReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "committed",
                    kind: None,
                    message: None,
                    base_revision: None,
                    revision: Some(commit.revision),
                    capability: None,
                    rule: None,
                    preconditions: None,
                    operation: None,
                    desired_geometry: None,
                    desired_focus: None,
                    detail: None,
                })
            }
            Err(crate::reconcile::VerifyError::NoPending) => trio_move_rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits verification",
                "no-pending",
            ),
            Err(crate::reconcile::VerifyError::NotAcknowledged) => trio_move_rejected(
                request.correlation_id.clone(),
                "not-acknowledged",
                "plan awaits acknowledgement before verification",
                "not-acknowledged",
            ),
            Err(crate::reconcile::VerifyError::Diverged(reason)) => {
                self.pending = None;
                trio_move_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
        }
    }

    /// Strict JSON-only keyboard resize transaction over the shared trio
    /// session. Action-fenced: keyboard `request` plus shared
    /// acknowledge/verify/loss only; `request-pointer` is rejected without
    /// mutation and pointer-owned pending is never touched.
    pub fn evaluate_keyboard_json(&mut self, request_json: &str) -> String {
        if request_json.len() > TRIO_MAX_REQUEST_BYTES {
            return trio_resize_rejected(
                String::new(),
                "oversized",
                TRIO_MSG_OVERSIZED,
                "oversized-request",
            );
        }
        let raw: serde_json::Value = match serde_json::from_str(request_json) {
            Ok(raw) => raw,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_resize_rejected(String::new(), kind, message, kind);
            }
        };
        let action = raw
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        match action {
            "request" => self.evaluate_resize_request(&raw),
            "request-pointer" => trio_resize_rejected(
                trio_valid_correlation_echo(&raw),
                "unknown-value",
                TRIO_MSG_UNKNOWN_VALUE,
                "cross-route-action-fenced",
            ),
            "acknowledge" => {
                if self.resize_pending_is(TrioResizeOrigin::Pointer) {
                    return trio_resize_rejected(
                        trio_valid_correlation_echo(&raw),
                        "no-pending",
                        "no pending plan awaits acknowledgement",
                        "cross-route-pending-fenced",
                    );
                }
                self.evaluate_trio_ack(&raw, TrioAckRoute::ResizeKeyboard)
            }
            "verify" => {
                if self.resize_pending_is(TrioResizeOrigin::Pointer) {
                    return trio_resize_rejected(
                        trio_valid_correlation_echo(&raw),
                        "no-pending",
                        "no pending plan awaits verification",
                        "cross-route-pending-fenced",
                    );
                }
                self.evaluate_resize_verify(&raw, TrioResizeOrigin::Keyboard)
            }
            "note-loss" => {
                if self.resize_pending_is(TrioResizeOrigin::Pointer) {
                    return trio_resize_rejected(
                        String::new(),
                        "no-pending",
                        "no pending plan awaits loss",
                        "cross-route-pending-fenced",
                    );
                }
                self.evaluate_trio_loss(&raw, TrioAckRoute::ResizeKeyboard)
            }
            _ => {
                let (kind, message) = if action.is_empty() {
                    ("request-malformed", TRIO_MSG_MALFORMED)
                } else {
                    ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
                };
                trio_resize_rejected(trio_valid_correlation_echo(&raw), kind, message, kind)
            }
        }
    }

    /// Strict JSON-only pointer resize transaction over the shared trio
    /// session. Action-fenced: `request-pointer` plus same-cycle shared
    /// acknowledge/verify/loss only; keyboard `request` is rejected without
    /// mutation and keyboard-owned pending is never touched.
    pub fn evaluate_pointer_json(&mut self, request_json: &str) -> String {
        if request_json.len() > TRIO_MAX_REQUEST_BYTES {
            return trio_resize_rejected(
                String::new(),
                "oversized",
                TRIO_MSG_OVERSIZED,
                "oversized-request",
            );
        }
        let raw: serde_json::Value = match serde_json::from_str(request_json) {
            Ok(raw) => raw,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_resize_rejected(String::new(), kind, message, kind);
            }
        };
        let action = raw
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        match action {
            "request-pointer" => self.evaluate_pointer_request(&raw),
            "request" => trio_resize_rejected(
                trio_valid_correlation_echo(&raw),
                "unknown-value",
                TRIO_MSG_UNKNOWN_VALUE,
                "cross-route-action-fenced",
            ),
            "acknowledge" => {
                if self.resize_pending_is(TrioResizeOrigin::Keyboard) {
                    return trio_resize_rejected(
                        trio_valid_correlation_echo(&raw),
                        "no-pending",
                        "no pending plan awaits acknowledgement",
                        "cross-route-pending-fenced",
                    );
                }
                self.evaluate_trio_ack(&raw, TrioAckRoute::ResizePointer)
            }
            "verify" => {
                if self.resize_pending_is(TrioResizeOrigin::Keyboard) {
                    return trio_resize_rejected(
                        trio_valid_correlation_echo(&raw),
                        "no-pending",
                        "no pending plan awaits verification",
                        "cross-route-pending-fenced",
                    );
                }
                self.evaluate_resize_verify(&raw, TrioResizeOrigin::Pointer)
            }
            "note-loss" => {
                if self.resize_pending_is(TrioResizeOrigin::Keyboard) {
                    return trio_resize_rejected(
                        String::new(),
                        "no-pending",
                        "no pending plan awaits loss",
                        "cross-route-pending-fenced",
                    );
                }
                self.evaluate_trio_loss(&raw, TrioAckRoute::ResizePointer)
            }
            _ => {
                let (kind, message) = if action.is_empty() {
                    ("request-malformed", TRIO_MSG_MALFORMED)
                } else {
                    ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
                };
                trio_resize_rejected(trio_valid_correlation_echo(&raw), kind, message, kind)
            }
        }
    }

    fn resize_pending_is(&self, origin: TrioResizeOrigin) -> bool {
        matches!(
            &self.pending,
            Some(TrioPending::Resize {
                origin: held,
                ..
            }) if *held == origin
        )
    }

    fn resize_expected_fingerprint(
        domain_output: &str,
        domain_workspace: &str,
        focused: &str,
        windows: &[TrioResizeObservedDto],
    ) -> u64 {
        let mut ids: Vec<String> = windows.iter().map(|w| w.window.clone()).collect();
        ids.sort();
        focus_fingerprint(domain_output, domain_workspace, focused, &ids)
    }

    fn resize_carried_bounds(domain: &TrioResizeDomainDto) -> Option<Rect> {
        let bounds = Rect {
            x: domain.bounds.x,
            y: domain.bounds.y,
            w: domain.bounds.w,
            h: domain.bounds.h,
        };
        if !trio_valid_carried_rect(bounds.x, bounds.y, bounds.w, bounds.h) {
            return None;
        }
        if domain.gap < 0 || domain.gap > TRIO_GEOMETRY_MAX_GAP {
            return None;
        }
        Some(bounds)
    }

    fn evaluate_resize_request(&mut self, raw: &serde_json::Value) -> String {
        let request: TrioResizeRequestDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_resize_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "request" {
            let (kind, message) = if request.v != 1 {
                ("unsupported-version", TRIO_MSG_VERSION)
            } else {
                ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
            };
            return trio_resize_rejected(request.correlation_id.clone(), kind, message, kind);
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_resize_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if !trio_is_opaque_id(&request.domain.output)
            || !trio_is_opaque_id(&request.domain.workspace)
            || !trio_is_opaque_id(&request.focused_window)
        {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OPAQUE_ID,
                "root-id-invalid",
            );
        }
        let Some(direction) = trio_parse_direction(&request.direction) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                TRIO_MSG_DIRECTION,
                "direction-invalid",
            );
        };
        if request.windows.len() != TRIO_WINDOWS {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "window-count-mismatch",
            );
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.windows {
                if !trio_is_opaque_id(&entry.window)
                    || !trio_is_opaque_id(&entry.output)
                    || !trio_is_opaque_id(&entry.workspace)
                {
                    return trio_resize_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "observed-id-invalid",
                    );
                }
                if !seen.insert(entry.window.clone()) {
                    return trio_resize_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "duplicate-window",
                    );
                }
            }
        }
        if !request.capabilities.keyboard_resize {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "unsupported-capability",
                TRIO_MSG_CAPABILITY,
                "unsupported-capability",
            );
        }
        let Some(carried_bounds) = Self::resize_carried_bounds(&request.domain) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "carried-bounds-invalid",
            );
        };
        for entry in &request.windows {
            if !trio_valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    TRIO_MSG_OBSERVATION,
                    "carried-rect-invalid",
                );
            }
            if !rect_contained_in(
                Rect {
                    x: entry.rect.x,
                    y: entry.rect.y,
                    w: entry.rect.w,
                    h: entry.rect.h,
                },
                carried_bounds,
            ) {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    TRIO_MSG_OBSERVATION,
                    "rect-containment-mismatch",
                );
            }
        }
        let expected = Self::resize_expected_fingerprint(
            &request.domain.output,
            &request.domain.workspace,
            &request.focused_window,
            &request.windows,
        );
        if request.fingerprint != expected {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "fingerprint-mismatch",
            );
        }
        for entry in &request.windows {
            if entry.output != request.domain.output || entry.workspace != request.domain.workspace
            {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "cross-domain-mismatch",
                    TRIO_MSG_OBSERVATION,
                    "cross-domain-observation",
                );
            }
        }
        if !request
            .windows
            .iter()
            .any(|w| w.window == request.focused_window)
        {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "focused-observation-mismatch",
            );
        }
        if !self.claim_correlation(&request.correlation_id) {
            if self.seen.contains(&request.correlation_id) {
                return trio_resize_diverged(
                    request.correlation_id.clone(),
                    "correlation-mismatch",
                    "correlation does not match the pending plan",
                );
            }
            return self.diverged_exhausted_resize(request.correlation_id.clone());
        }
        let owner = OwnerId::parse(&request.owner).expect("validated");
        let generation = GenerationId::parse(&request.generation).expect("validated");
        let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
        if self.runtime.is_none()
            && self
                .ensure_seeded_from_resize(
                    &owner,
                    &generation,
                    &request.domain.output,
                    &request.domain.workspace,
                    carried_bounds,
                    request.domain.gap,
                    &request.windows,
                    request.revision,
                )
                .is_err()
        {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "seed-failed",
            );
        }
        if !self.resize_seeded_matches(
            &request.domain.output,
            &request.domain.workspace,
            carried_bounds,
            request.domain.gap,
            &request.windows,
        ) {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "seeded-membership-mismatch",
            );
        }
        let domain = DomainKey {
            output: OutputId(request.domain.output.clone()),
            workspace: WorkspaceId(request.domain.workspace.clone()),
        };
        let window = WindowId(request.focused_window.clone());
        let observed: Vec<ObservedWindow> = request
            .windows
            .iter()
            .map(|entry| ObservedWindow {
                window: WindowId(entry.window.clone()),
                output: OutputId(entry.output.clone()),
                workspace: WorkspaceId(entry.workspace.clone()),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        let session = self.session_mut().expect("seeded");
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                request.revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        let caps = ResizeCapabilities {
            keyboard_resize: request.capabilities.keyboard_resize,
            pointer_resize: request.capabilities.pointer_resize,
        };
        let Some(mode) = trio_resize_parse_mode(&request.mode) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                TRIO_MSG_DIRECTION,
                "resize-mode-invalid",
            );
        };
        match session.propose_resize(
            &domain,
            &window,
            direction,
            mode,
            request.press_index,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                self.pending = Some(TrioPending::Resize {
                    origin: TrioResizeOrigin::Keyboard,
                    correlation: request.correlation_id.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                    geometry: plan.desired_geometry.clone(),
                    focus_domain: plan.desired_focus_domain.clone(),
                    focus_leaf: plan.desired_focus_leaf.clone(),
                });
                self.resize_planned_reply(&request.correlation_id, "keyboard-resize", &plan)
            }
            Err(ProposeError::PendingExists) => trio_resize_diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => {
                self.pending = None;
                trio_resize_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "unchanged" {
                    let revision = self.accepted_revision();
                    trio_serialize_resize(&TrioResizeReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
                        detail: None,
                    })
                } else {
                    trio_resize_rejected(
                        request.correlation_id.clone(),
                        kind.as_str(),
                        kind.message(),
                        trio_refusal_detail(kind),
                    )
                }
            }
        }
    }

    /// Seeded work-area/domain/membership binding for resize-route requests:
    /// the carried bounds/gap must equal the owned trio domain and the
    /// observed set must equal the trio membership.
    fn resize_seeded_matches(
        &self,
        output: &str,
        workspace: &str,
        bounds: Rect,
        gap: i32,
        windows: &[TrioResizeObservedDto],
    ) -> bool {
        let runtime = match self.runtime.as_ref() {
            Some(runtime) => runtime,
            None => return false,
        };
        if runtime.domain().output.0 != output || runtime.domain().workspace.0 != workspace {
            return false;
        }
        let key = DomainKey {
            output: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
        };
        let bounds_ok = runtime
            .session
            .domains()
            .iter()
            .find(|d| d.key() == key)
            .is_some_and(|d| d.bounds == bounds && d.gap == gap);
        if !bounds_ok {
            return false;
        }
        let mut current: Vec<String> = windows.iter().map(|w| w.window.clone()).collect();
        current.sort();
        current == self.seeded_members()
    }

    fn resize_planned_reply(
        &self,
        correlation_id: &str,
        capability: &'static str,
        plan: &SessionResizePlan,
    ) -> String {
        let preconditions: Vec<&'static str> = plan
            .dispatch
            .preconditions
            .iter()
            .map(trio_resize_precondition_str)
            .collect();
        let operation = trio_resize_operation_to_value(&plan.dispatch.operation);
        let desired_geometry: Vec<TrioGeometryReply> = plan
            .desired_geometry
            .iter()
            .map(trio_move_geometry_reply)
            .collect();
        let desired_focus = TrioFocusBodyReply {
            domain_output: plan.desired_focus_domain.output.0.clone(),
            domain_workspace: plan.desired_focus_domain.workspace.0.clone(),
            leaf: plan.desired_focus_leaf.0.clone(),
        };
        trio_serialize_resize(&TrioResizeReply {
            v: 1,
            correlation_id: correlation_id.to_owned(),
            outcome: "planned",
            kind: None,
            message: None,
            base_revision: Some(plan.dispatch.base_revision),
            revision: None,
            capability: Some(capability),
            preconditions: Some(preconditions),
            operation: Some(operation),
            desired_geometry: Some(desired_geometry),
            desired_focus: Some(desired_focus),
            detail: None,
        })
    }

    fn evaluate_pointer_request(&mut self, raw: &serde_json::Value) -> String {
        let request: TrioResizePointerRequestDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_resize_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "request-pointer" {
            let (kind, message) = if request.v != 1 {
                ("unsupported-version", TRIO_MSG_VERSION)
            } else {
                ("unknown-value", TRIO_MSG_UNKNOWN_VALUE)
            };
            return trio_resize_rejected(request.correlation_id.clone(), kind, message, kind);
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_resize_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if !trio_is_opaque_id(&request.domain.output)
            || !trio_is_opaque_id(&request.domain.workspace)
            || !trio_is_opaque_id(&request.focused_window)
        {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OPAQUE_ID,
                "root-id-invalid",
            );
        }
        let Some(direction) = trio_parse_direction(&request.direction) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                TRIO_MSG_DIRECTION,
                "direction-invalid",
            );
        };
        if request.windows.len() != TRIO_WINDOWS {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "window-count-mismatch",
            );
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.windows {
                if !trio_is_opaque_id(&entry.window)
                    || !trio_is_opaque_id(&entry.output)
                    || !trio_is_opaque_id(&entry.workspace)
                {
                    return trio_resize_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "observed-id-invalid",
                    );
                }
                if !seen.insert(entry.window.clone()) {
                    return trio_resize_rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        TRIO_MSG_OPAQUE_ID,
                        "duplicate-window",
                    );
                }
            }
        }
        if !request.capabilities.pointer_resize {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "unsupported-capability",
                TRIO_MSG_CAPABILITY,
                "unsupported-capability",
            );
        }
        let Some(carried_bounds) = Self::resize_carried_bounds(&request.domain) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "carried-bounds-invalid",
            );
        };
        for entry in &request.windows {
            if !trio_valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    TRIO_MSG_OBSERVATION,
                    "carried-rect-invalid",
                );
            }
            if !rect_contained_in(
                Rect {
                    x: entry.rect.x,
                    y: entry.rect.y,
                    w: entry.rect.w,
                    h: entry.rect.h,
                },
                carried_bounds,
            ) {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    TRIO_MSG_OBSERVATION,
                    "rect-containment-mismatch",
                );
            }
        }
        let expected = Self::resize_expected_fingerprint(
            &request.domain.output,
            &request.domain.workspace,
            &request.focused_window,
            &request.windows,
        );
        if request.fingerprint != expected {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "fingerprint-mismatch",
            );
        }
        for entry in &request.windows {
            if entry.output != request.domain.output || entry.workspace != request.domain.workspace
            {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "cross-domain-mismatch",
                    TRIO_MSG_OBSERVATION,
                    "cross-domain-observation",
                );
            }
        }
        if !request
            .windows
            .iter()
            .any(|w| w.window == request.focused_window)
        {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "focused-observation-mismatch",
            );
        }
        if !self.claim_correlation(&request.correlation_id) {
            if self.seen.contains(&request.correlation_id) {
                return trio_resize_diverged(
                    request.correlation_id.clone(),
                    "correlation-mismatch",
                    "correlation does not match the pending plan",
                );
            }
            return self.diverged_exhausted_resize(request.correlation_id.clone());
        }
        let owner = OwnerId::parse(&request.owner).expect("validated");
        let generation = GenerationId::parse(&request.generation).expect("validated");
        let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
        if self.runtime.is_none()
            && self
                .ensure_seeded_from_resize(
                    &owner,
                    &generation,
                    &request.domain.output,
                    &request.domain.workspace,
                    carried_bounds,
                    request.domain.gap,
                    &request.windows,
                    request.revision,
                )
                .is_err()
        {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "seed-failed",
            );
        }
        if !self.resize_seeded_matches(
            &request.domain.output,
            &request.domain.workspace,
            carried_bounds,
            request.domain.gap,
            &request.windows,
        ) {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                TRIO_MSG_OBSERVATION,
                "seeded-membership-mismatch",
            );
        }
        let domain = DomainKey {
            output: OutputId(request.domain.output.clone()),
            workspace: WorkspaceId(request.domain.workspace.clone()),
        };
        let window = WindowId(request.focused_window.clone());
        let observed: Vec<ObservedWindow> = request
            .windows
            .iter()
            .map(|entry| ObservedWindow {
                window: WindowId(entry.window.clone()),
                output: OutputId(entry.output.clone()),
                workspace: WorkspaceId(entry.workspace.clone()),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        let session = self.session_mut().expect("seeded");
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                request.revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        let caps = ResizeCapabilities {
            keyboard_resize: request.capabilities.keyboard_resize,
            pointer_resize: request.capabilities.pointer_resize,
        };
        match session.propose_pointer_resize(
            &domain,
            &window,
            direction,
            request.proposed_boundary,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                self.pending = Some(TrioPending::Resize {
                    origin: TrioResizeOrigin::Pointer,
                    correlation: request.correlation_id.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                    geometry: plan.desired_geometry.clone(),
                    focus_domain: plan.desired_focus_domain.clone(),
                    focus_leaf: plan.desired_focus_leaf.clone(),
                });
                self.resize_planned_reply(&request.correlation_id, "pointer-resize", &plan)
            }
            Err(ProposeError::PendingExists) => trio_resize_diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => {
                self.pending = None;
                trio_resize_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "unchanged" {
                    let revision = self.accepted_revision();
                    trio_serialize_resize(&TrioResizeReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
                        detail: None,
                    })
                } else {
                    trio_resize_rejected(
                        request.correlation_id.clone(),
                        kind.as_str(),
                        kind.message(),
                        trio_refusal_detail(kind),
                    )
                }
            }
        }
    }

    fn resize_terminal_verify_diverge(&mut self, correlation_id: String) -> String {
        self.pending = None;
        if let Some(session) = self.session_mut() {
            let _ = session.note_adapter_loss();
        }
        trio_resize_diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn resize_mismatched_verify_diverge(
        &mut self,
        owner: OwnerId,
        generation: GenerationId,
        correlation: CorrelationId,
        revision: u64,
        fingerprint: u64,
        preconditions: Vec<ResizePrecondition>,
        operation: ResizeOperation,
    ) -> String {
        let correlation_id = correlation.as_str().to_owned();
        let post = ResizePostObservation::new(
            Observation::new(owner, generation, revision, fingerprint),
            correlation,
            false,
            preconditions,
            operation,
        );
        if let Some(session) = self.session_mut() {
            let _ = session.verify_resize(&post);
            if session.divergence().is_none() {
                let _ = session.note_adapter_loss();
            }
        }
        self.pending = None;
        trio_resize_diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    fn evaluate_resize_verify(
        &mut self,
        raw: &serde_json::Value,
        origin: TrioResizeOrigin,
    ) -> String {
        let request: TrioResizeVerifyDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = trio_classify_parse_error(&error);
                return trio_resize_rejected(trio_valid_correlation_echo(raw), kind, message, kind);
            }
        };
        if request.v != 1 || request.action != "verify" {
            return trio_resize_rejected(
                trio_valid_correlation_echo(raw),
                "unsupported-version",
                TRIO_MSG_VERSION,
                "unsupported-version",
            );
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return trio_resize_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        }
        if OwnerId::parse(&request.owner).is_none() {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        }
        if GenerationId::parse(&request.generation).is_none() {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        }
        if request.revision > TRIO_MAX_REVISION {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                TRIO_MSG_REVISION,
                "revision-invalid",
            );
        }
        if request.verified_geometry.is_empty()
            || request.verified_geometry.len() > TRIO_MAX_GEOMETRY
        {
            return self.resize_terminal_verify_diverge(request.correlation_id.clone());
        }
        for id in [
            &request.verified_focus.domain_output,
            &request.verified_focus.domain_workspace,
            &request.verified_focus.leaf,
        ] {
            if !trio_is_opaque_id(id) {
                return self.resize_terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        for entry in &request.verified_geometry {
            if !trio_is_opaque_id(&entry.window)
                || !trio_is_opaque_id(&entry.leaf)
                || !trio_is_opaque_id(&entry.output)
                || !trio_is_opaque_id(&entry.workspace)
                || entry.rect.w <= 0
                || entry.rect.h <= 0
            {
                return self.resize_terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.verified_geometry {
                if !seen.insert(entry.window.clone()) {
                    return self.resize_terminal_verify_diverge(request.correlation_id.clone());
                }
            }
        }
        let Some(operation) = trio_resize_parse_operation(&request.verified_operation) else {
            return self.resize_terminal_verify_diverge(request.correlation_id.clone());
        };
        let mut preconditions = Vec::with_capacity(request.verified_preconditions.len());
        for token in &request.verified_preconditions {
            let Some(pre) = trio_resize_precondition_token(token) else {
                return self.resize_terminal_verify_diverge(request.correlation_id.clone());
            };
            if preconditions.contains(&pre) {
                return self.resize_terminal_verify_diverge(request.correlation_id.clone());
            }
            preconditions.push(pre);
        }
        if preconditions.len() != TRIO_RESIZE_PRECONDITIONS.len()
            || preconditions
                .iter()
                .map(trio_resize_precondition_str)
                .zip(TRIO_RESIZE_PRECONDITIONS.iter())
                .any(|(got, want)| got != *want)
        {
            return self.resize_terminal_verify_diverge(request.correlation_id.clone());
        }
        let Some(correlation) = CorrelationId::parse(&request.correlation_id) else {
            return trio_resize_rejected(
                String::new(),
                "correlation-invalid",
                TRIO_MSG_CORRELATION,
                "correlation-invalid",
            );
        };
        let Some(owner) = OwnerId::parse(&request.owner) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "owner-invalid",
                TRIO_MSG_OWNER,
                "owner-invalid",
            );
        };
        let Some(generation) = GenerationId::parse(&request.generation) else {
            return trio_resize_rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                TRIO_MSG_GENERATION,
                "generation-invalid",
            );
        };
        let Some(TrioPending::Resize {
            origin: pending_origin,
            correlation: pending_correlation,
            operation: pending_operation,
            preconditions: pending_preconditions,
            geometry: pending_geometry,
            focus_domain: pending_focus_domain,
            focus_leaf: pending_focus_leaf,
        }) = self.pending.clone()
        else {
            if self.runtime.is_none() {
                return trio_resize_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits verification",
                    "no-pending",
                );
            }
            let post = ResizePostObservation::new(
                Observation::new(owner, generation, request.revision, request.fingerprint),
                correlation,
                request.verified,
                preconditions,
                operation,
            );
            let session = self.session_mut().expect("seeded");
            return match session.verify_resize(&post) {
                Ok(commit) => {
                    self.pending = None;
                    trio_serialize_resize(&TrioResizeReply {
                        v: 1,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "committed",
                        kind: None,
                        message: None,
                        base_revision: None,
                        revision: Some(commit.revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
                        detail: None,
                    })
                }
                Err(crate::reconcile::VerifyError::NoPending) => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits verification",
                    "no-pending",
                ),
                Err(crate::reconcile::VerifyError::NotAcknowledged) => trio_resize_rejected(
                    request.correlation_id.clone(),
                    "not-acknowledged",
                    "plan awaits acknowledgement before verification",
                    "not-acknowledged",
                ),
                Err(crate::reconcile::VerifyError::Diverged(reason)) => {
                    self.pending = None;
                    trio_resize_diverged(
                        request.correlation_id.clone(),
                        reason.as_str(),
                        reason.message(),
                    )
                }
            };
        };
        if pending_origin != origin
            || pending_correlation != request.correlation_id
            || preconditions != pending_preconditions
            || operation != pending_operation
        {
            return self.resize_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        }
        if request.verified_geometry.len() != pending_geometry.len() {
            return self.resize_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        }
        {
            let mut want: Vec<(String, String, String, String, Rect)> = pending_geometry
                .iter()
                .map(|g| {
                    (
                        g.window.0.clone(),
                        g.leaf.0.clone(),
                        g.output.0.clone(),
                        g.workspace.0.clone(),
                        g.rect,
                    )
                })
                .collect();
            want.sort_by(|a, b| {
                (&a.0, &a.1, &a.2, &a.3, a.4.x, a.4.y, a.4.w, a.4.h)
                    .cmp(&(&b.0, &b.1, &b.2, &b.3, b.4.x, b.4.y, b.4.w, b.4.h))
            });
            let mut got: Vec<(String, String, String, String, Rect)> = request
                .verified_geometry
                .iter()
                .map(|g| {
                    (
                        g.window.clone(),
                        g.leaf.clone(),
                        g.output.clone(),
                        g.workspace.clone(),
                        Rect {
                            x: g.rect.x,
                            y: g.rect.y,
                            w: g.rect.w,
                            h: g.rect.h,
                        },
                    )
                })
                .collect();
            got.sort_by(|a, b| {
                (&a.0, &a.1, &a.2, &a.3, a.4.x, a.4.y, a.4.w, a.4.h)
                    .cmp(&(&b.0, &b.1, &b.2, &b.3, b.4.x, b.4.y, b.4.w, b.4.h))
            });
            if want != got {
                return self.resize_mismatched_verify_diverge(
                    owner,
                    generation,
                    correlation,
                    request.revision,
                    request.fingerprint,
                    preconditions,
                    operation,
                );
            }
        }
        if request.verified_focus.domain_output != pending_focus_domain.output.0
            || request.verified_focus.domain_workspace != pending_focus_domain.workspace.0
            || request.verified_focus.leaf != pending_focus_leaf.0
        {
            return self.resize_mismatched_verify_diverge(
                owner,
                generation,
                correlation,
                request.revision,
                request.fingerprint,
                preconditions,
                operation,
            );
        }
        if let Some(runtime) = self.runtime.as_ref() {
            for entry in &request.verified_geometry {
                let key = DomainKey {
                    output: OutputId(entry.output.clone()),
                    workspace: WorkspaceId(entry.workspace.clone()),
                };
                let contained = runtime
                    .session
                    .domains()
                    .iter()
                    .find(|d| d.key() == key)
                    .is_some_and(|d| {
                        rect_contained_in(
                            Rect {
                                x: entry.rect.x,
                                y: entry.rect.y,
                                w: entry.rect.w,
                                h: entry.rect.h,
                            },
                            d.bounds,
                        )
                    });
                if !contained {
                    return self.resize_mismatched_verify_diverge(
                        owner,
                        generation,
                        correlation,
                        request.revision,
                        request.fingerprint,
                        preconditions,
                        operation,
                    );
                }
            }
        }
        let post = ResizePostObservation::new(
            Observation::new(owner, generation, request.revision, request.fingerprint),
            correlation,
            request.verified,
            preconditions,
            operation,
        );
        let session = self.session_mut().expect("seeded");
        match session.verify_resize(&post) {
            Ok(commit) => {
                self.pending = None;
                trio_serialize_resize(&TrioResizeReply {
                    v: 1,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "committed",
                    kind: None,
                    message: None,
                    base_revision: None,
                    revision: Some(commit.revision),
                    capability: None,
                    preconditions: None,
                    operation: None,
                    desired_geometry: None,
                    desired_focus: None,
                    detail: None,
                })
            }
            Err(crate::reconcile::VerifyError::NoPending) => trio_resize_rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits verification",
                "no-pending",
            ),
            Err(crate::reconcile::VerifyError::NotAcknowledged) => trio_resize_rejected(
                request.correlation_id.clone(),
                "not-acknowledged",
                "plan awaits acknowledgement before verification",
                "not-acknowledged",
            ),
            Err(crate::reconcile::VerifyError::Diverged(reason)) => {
                self.pending = None;
                trio_resize_diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{ResizeCapabilities, ResizeMode};
    use crate::directional::{Capabilities, Rule};

    fn owner() -> OwnerId {
        OwnerId::parse("owner-1").expect("valid")
    }

    fn generation() -> GenerationId {
        GenerationId::parse("gen-1").expect("valid")
    }

    fn corr(value: &str) -> CorrelationId {
        CorrelationId::parse(value).unwrap_or_else(|| panic!("valid {value}"))
    }

    fn bounds() -> Rect {
        Rect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        }
    }

    fn rect_a() -> Rect {
        Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        }
    }

    fn rect_b_wide() -> Rect {
        Rect {
            x: 100,
            y: 100,
            w: 640,
            h: 400,
        }
    }

    fn rect_c_tall() -> Rect {
        Rect {
            x: 200,
            y: 200,
            w: 400,
            h: 640,
        }
    }

    fn seed() -> ManualRuntime {
        ManualRuntime::seed_three_window(
            owner(),
            generation(),
            OutputId::from("out-1"),
            WorkspaceId::from("ws-1"),
            bounds(),
            8,
            WindowId::from("win-a"),
            rect_a(),
            WindowId::from("win-b"),
            rect_b_wide(),
            WindowId::from("win-c"),
            rect_c_tall(),
        )
        .expect("seed trio")
    }

    fn focused_window(runtime: &ManualRuntime) -> WindowId {
        let (domain, leaf) = runtime.focus();
        let domain = domain.expect("focus domain");
        let leaf = leaf.expect("focus leaf");
        assert_eq!(domain, *runtime.domain());
        runtime
            .session()
            .snapshot()
            .windows
            .iter()
            .find(|l| l.leaf == leaf)
            .expect("link")
            .window
            .clone()
    }

    #[test]
    fn trio_seed_projects_a_left_b_upper_c_lower() {
        let runtime = seed();
        assert_eq!(runtime.accepted_revision(), 3);
        let projection = runtime.trio_projection().expect("trio binds");
        assert_eq!(
            projection.bounds,
            Rect {
                x: 0,
                y: 0,
                w: 1920,
                h: 1080
            }
        );
        assert_eq!(projection.gap, 8);
        // A owns the full-height left column.
        assert_eq!(projection.rect_a.y, 0);
        assert_eq!(projection.rect_a.h, 1080);
        // Right column shares x/w; B sits above C.
        assert_eq!(projection.rect_b.x, projection.rect_c.x);
        assert_eq!(projection.rect_b.w, projection.rect_c.w);
        assert!(projection.rect_b.y < projection.rect_c.y);
        assert!(projection.rect_a.x < projection.rect_b.x);
        // Exact root gap between columns; exact inner gap between rows.
        assert_eq!(
            projection.rect_b.x,
            projection.rect_a.x + projection.rect_a.w + 8
        );
        assert_eq!(
            projection.rect_c.y,
            projection.rect_b.y + projection.rect_b.h + 8
        );
        // Contained, non-overlapping, deterministic.
        for rect in [projection.rect_a, projection.rect_b, projection.rect_c] {
            assert!(rect.x >= 0 && rect.y >= 0);
            assert!(rect.x + rect.w <= 1920);
            assert!(rect.y + rect.h <= 1080);
        }
        let again = runtime.trio_projection().expect("deterministic");
        assert_eq!(projection, again);
    }

    #[test]
    fn trio_seed_rejects_bad_work_area_and_windows() {
        // Zero work area fails closed.
        assert_eq!(
            ManualRuntime::seed_three_window(
                owner(),
                generation(),
                OutputId::from("out-1"),
                WorkspaceId::from("ws-1"),
                Rect {
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 1080
                },
                0,
                WindowId::from("win-a"),
                rect_a(),
                WindowId::from("win-b"),
                rect_b_wide(),
                WindowId::from("win-c"),
                rect_c_tall(),
            )
            .expect_err("bad bounds"),
            SeedError::InvalidDomain
        );
        // Duplicate windows fail closed.
        assert_eq!(
            ManualRuntime::seed_three_window(
                owner(),
                generation(),
                OutputId::from("out-1"),
                WorkspaceId::from("ws-1"),
                bounds(),
                8,
                WindowId::from("win-a"),
                rect_a(),
                WindowId::from("win-a"),
                rect_b_wide(),
                WindowId::from("win-c"),
                rect_c_tall(),
            )
            .expect_err("duplicate"),
            SeedError::InvalidWindow
        );
    }

    #[test]
    fn trio_seed_geometry_decides_axis_outcome() {
        // Supplied geometry decides the seed: a tall B cannot select the
        // wide Horizontal intent, so the same bounds/gap fail closed.
        let tall_b = Rect {
            x: 100,
            y: 100,
            w: 400,
            h: 640,
        };
        assert_eq!(
            ManualRuntime::seed_three_window(
                owner(),
                generation(),
                OutputId::from("out-1"),
                WorkspaceId::from("ws-1"),
                bounds(),
                8,
                WindowId::from("win-a"),
                rect_a(),
                WindowId::from("win-b"),
                tall_b,
                WindowId::from("win-c"),
                rect_c_tall(),
            )
            .expect_err("tall B refuses"),
            SeedError::SeedFailed
        );
        // A wide C cannot select the tall Vertical intent either.
        let wide_c = Rect {
            x: 200,
            y: 200,
            w: 640,
            h: 400,
        };
        assert_eq!(
            ManualRuntime::seed_three_window(
                owner(),
                generation(),
                OutputId::from("out-1"),
                WorkspaceId::from("ws-1"),
                bounds(),
                8,
                WindowId::from("win-a"),
                rect_a(),
                WindowId::from("win-b"),
                rect_b_wide(),
                WindowId::from("win-c"),
                wide_c,
            )
            .expect_err("wide C refuses"),
            SeedError::SeedFailed
        );
        // Geometry outside the work area fails closed without tiling.
        let outside = Rect {
            x: 1900,
            y: 1000,
            w: 640,
            h: 400,
        };
        assert_eq!(
            ManualRuntime::seed_three_window(
                owner(),
                generation(),
                OutputId::from("out-1"),
                WorkspaceId::from("ws-1"),
                bounds(),
                8,
                WindowId::from("win-a"),
                rect_a(),
                WindowId::from("win-b"),
                outside,
                WindowId::from("win-c"),
                rect_c_tall(),
            )
            .expect_err("outside refuses"),
            SeedError::SeedFailed
        );
    }

    #[test]
    fn trio_seed_bounds_gap_decide_projection() {
        let runtime = seed();
        let first = runtime.trio_projection().expect("trio binds");
        assert_eq!(first.bounds, bounds());
        assert_eq!(first.gap, 8);
        // Same windows and axis-eligible geometry under a different real
        // work area project to that work area with its gap.
        let narrow = Rect {
            x: 0,
            y: 0,
            w: 1600,
            h: 900,
        };
        let small_b = Rect {
            x: 100,
            y: 100,
            w: 640,
            h: 400,
        };
        let small_c = Rect {
            x: 200,
            y: 100,
            w: 400,
            h: 640,
        };
        let small_a = Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        };
        let other = ManualRuntime::seed_three_window(
            owner(),
            generation(),
            OutputId::from("out-1"),
            WorkspaceId::from("ws-1"),
            narrow,
            0,
            WindowId::from("win-a"),
            small_a,
            WindowId::from("win-b"),
            small_b,
            WindowId::from("win-c"),
            small_c,
        )
        .expect("narrow seed");
        let second = other.trio_projection().expect("narrow binds");
        assert_eq!(second.bounds, narrow);
        assert_eq!(second.gap, 0);
        // Bounds/gap decide the outcome: identical topology projects
        // differently, with exact gap contracts on both seeds.
        assert_ne!(first, second);
        assert_eq!(first.rect_b.x, first.rect_a.x + first.rect_a.w + 8);
        assert_eq!(second.rect_b.x, second.rect_a.x + second.rect_a.w);
        assert_eq!(first.rect_c.y, first.rect_b.y + first.rect_b.h + 8);
        assert_eq!(second.rect_c.y, second.rect_b.y + second.rect_b.h);
    }

    fn ack_accepted(runtime: &mut ManualRuntime, correlation: &CorrelationId, base: u64) {
        runtime
            .acknowledge(&AdapterAck::new(
                correlation.clone(),
                owner(),
                generation(),
                base,
                AckOutcome::Accepted,
            ))
            .expect("acknowledge");
    }

    #[test]
    fn shared_session_sequential_focus_move_resize_pointer() {
        let mut runtime = seed();
        // Seed focuses C; every step below transacts over the same shared
        // authoritative session with production adapter contracts
        // (capabilities, ack-before-verify, exact revision binding).
        assert_eq!(focused_window(&runtime).0, "win-c");
        let start_revision = runtime.accepted_revision();
        assert_eq!(start_revision, 3);

        // Focus: C up reaches B in the right vertical column (pinned).
        let focus_corr = corr("manual-focus-1");
        let focus_base = runtime.accepted_revision();
        let focus_obs = runtime.observation(&owner(), &generation(), 5000 + focus_base);
        let focus_plan = runtime
            .propose_focus(
                &WindowId::from("win-c"),
                Direction::Up,
                &focus_obs,
                &focus_corr,
                &FocusCapabilities::full(),
            )
            .expect("focus plans");
        assert_eq!(focus_plan.dispatch.operation.to_window.0, "win-b");
        ack_accepted(&mut runtime, &focus_corr, focus_base);
        let focus_commit = runtime
            .verify_focus(&FocusPostObservation::new(
                Observation::new(owner(), generation(), focus_base, 6000 + focus_base),
                focus_corr.clone(),
                true,
                focus_plan.dispatch.preconditions.clone(),
                focus_plan.dispatch.operation.clone(),
            ))
            .expect("focus commits");
        assert_eq!(focus_commit.revision, focus_base + 1);
        assert_eq!(focused_window(&runtime).0, "win-b");
        assert!(!runtime.session().has_pending());
        assert!(runtime.session().divergence().is_none());

        // Movement: focused B down swaps with C (pinned R2a) over the same
        // shared session; the mover stays focused.
        let move_corr = corr("manual-move-1");
        let move_base = runtime.accepted_revision();
        assert_eq!(move_base, start_revision + 1);
        let move_obs = runtime.observation(&owner(), &generation(), 5100 + move_base);
        let move_plan = runtime
            .propose_move(
                &WindowId::from("win-b"),
                Direction::Down,
                &move_obs,
                &move_corr,
                &Capabilities::full(),
            )
            .expect("B down swaps with C");
        assert_eq!(move_plan.dispatch.rule, Rule::R2a);
        ack_accepted(&mut runtime, &move_corr, move_base);
        let move_commit = runtime
            .verify_move(&PostObservation::new(
                Observation::new(owner(), generation(), move_base, 6100 + move_base),
                move_corr.clone(),
                true,
                move_plan.dispatch.preconditions.clone(),
                move_plan.dispatch.operation.clone(),
            ))
            .expect("move commits");
        assert_eq!(move_commit.revision, move_base + 1);
        assert_eq!(focused_window(&runtime).0, "win-b");
        assert!(!runtime.session().has_pending());
        assert!(runtime.session().divergence().is_none());

        // Keyboard resize: focused B up against C, inwards, initial press
        // (pinned production keyboard contract: keyboard-only capability).
        let focus_before_resize = focused_window(&runtime);
        assert_eq!(focus_before_resize.0, "win-b");
        let resize_corr = corr("manual-resize-k1");
        let resize_base = runtime.accepted_revision();
        let resize_obs = runtime.observation(&owner(), &generation(), 5200 + resize_base);
        let keyboard_caps = ResizeCapabilities {
            keyboard_resize: true,
            pointer_resize: false,
        };
        let resize_plan = runtime
            .propose_resize(
                &focus_before_resize,
                Direction::Up,
                ResizeMode::Inwards,
                0,
                &resize_obs,
                &resize_corr,
                &keyboard_caps,
            )
            .expect("keyboard resize plans");
        assert_eq!(resize_plan.dispatch.operation.direction, Direction::Up);
        assert_eq!(resize_plan.dispatch.operation.mode, ResizeMode::Inwards);
        ack_accepted(&mut runtime, &resize_corr, resize_base);
        let resize_commit = runtime
            .verify_resize(&ResizePostObservation::new(
                Observation::new(owner(), generation(), resize_base, 6200 + resize_base),
                resize_corr.clone(),
                true,
                resize_plan.dispatch.preconditions.clone(),
                resize_plan.dispatch.operation.clone(),
            ))
            .expect("keyboard resize commits");
        assert_eq!(resize_commit.revision, resize_base + 1);
        assert_eq!(focused_window(&runtime), focus_before_resize);
        assert!(!runtime.session().has_pending());
        assert!(runtime.session().divergence().is_none());

        // Pointer resize: focused B up with a deterministic exact boundary
        // derived from the current accepted projection (pinned production
        // pointer contract: pointer-only capability). Success and commit
        // are mandatory.
        let focus_before_pointer = focused_window(&runtime);
        assert_eq!(focus_before_pointer.0, "win-b");
        let pointer_base = runtime.accepted_revision();
        let boundary = pointer_boundary_for(&runtime, &focus_before_pointer);
        let pointer_corr = corr("manual-resize-p1");
        let pointer_obs = runtime.observation(&owner(), &generation(), 5300 + pointer_base);
        let pointer_caps = ResizeCapabilities {
            keyboard_resize: false,
            pointer_resize: true,
        };
        let pointer_plan = runtime
            .propose_pointer_resize(
                &focus_before_pointer,
                Direction::Up,
                boundary,
                &pointer_obs,
                &pointer_corr,
                &pointer_caps,
            )
            .expect("pointer resize plans");
        assert_eq!(pointer_plan.dispatch.operation.direction, Direction::Up);
        ack_accepted(&mut runtime, &pointer_corr, pointer_base);
        let pointer_commit = runtime
            .verify_resize(&ResizePostObservation::new(
                Observation::new(owner(), generation(), pointer_base, 6300 + pointer_base),
                pointer_corr.clone(),
                true,
                pointer_plan.dispatch.preconditions.clone(),
                pointer_plan.dispatch.operation.clone(),
            ))
            .expect("pointer resize commits");
        assert_eq!(pointer_commit.revision, pointer_base + 1);
        assert_eq!(focused_window(&runtime), focus_before_pointer);
        assert!(!runtime.session().has_pending());
        assert!(runtime.session().divergence().is_none());
        assert_eq!(runtime.accepted_revision(), start_revision + 4);
    }

    /// Deterministic exact pointer boundary for the focused window: the
    /// current shared edge of its vertical pair shifted by a fixed +24px.
    /// Derived from the accepted projection (never guessed), so the plan is
    /// pinned and the commit is mandatory.
    fn pointer_boundary_for(runtime: &ManualRuntime, focused: &WindowId) -> i32 {
        use std::collections::BTreeMap;
        let snapshot = runtime.session().snapshot();
        let domain_view = runtime
            .session()
            .domains()
            .iter()
            .find(|d| d.key() == *runtime.domain())
            .expect("domain");
        let view = snapshot
            .domains
            .iter()
            .find(|d| {
                d.output == runtime.domain().output && d.workspace == runtime.domain().workspace
            })
            .expect("view");
        let tree = view.tree.clone().expect("tree");
        let projected = project(&tree, domain_view.bounds, domain_view.gap).expect("projectable");
        let mut by_window: BTreeMap<&str, Rect> = BTreeMap::new();
        for entry in &projected {
            if let Some(link) = snapshot.windows.iter().find(|l| l.leaf == entry.leaf) {
                by_window.insert(link.window.0.as_str(), entry.rect);
            }
        }
        // Post-swap the inner vertical pair is [C (top), B (bottom)] with B
        // focused; the shared edge moves Up against C.
        assert_eq!(focused.0, "win-b");
        let rect_c = *by_window.get("win-c").expect("C rect");
        rect_c.y + rect_c.h + 24
    }
}

#[cfg(test)]
mod trio_service_tests {
    use super::*;

    fn fp(focused: &str) -> u64 {
        focus_fingerprint(
            "out-1",
            "ws-1",
            focused,
            &["win-a".to_owned(), "win-b".to_owned(), "win-c".to_owned()],
        )
    }

    fn windows_json(
        rect_b: (i32, i32, i32, i32),
        rect_c: (i32, i32, i32, i32),
    ) -> serde_json::Value {
        serde_json::json!([
            {"window": "win-a", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 0, "y": 0, "w": 800, "h": 600}},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": rect_b.0, "y": rect_b.1, "w": rect_b.2, "h": rect_b.3}},
            {"window": "win-c", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": rect_c.0, "y": rect_c.1, "w": rect_c.2, "h": rect_c.3}}
        ])
    }

    fn keyboard_request(
        correlation: &str,
        focused: &str,
        revision: u64,
        windows: serde_json::Value,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "request", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080}, "gap": 8},
            "focused_window": focused, "direction": "up", "mode": "inwards",
            "press_index": 0, "windows": windows,
            "capabilities": {"keyboard_resize": true, "pointer_resize": false}
        })
        .to_string()
    }

    fn pointer_request(correlation: &str, boundary: i32, revision: u64) -> String {
        serde_json::json!({
            "v": 1, "action": "request-pointer", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": fp("win-c"),
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080}, "gap": 8},
            "focused_window": "win-c", "direction": "up",
            "proposed_boundary": boundary, "windows": windows_json((100, 100, 640, 400), (200, 200, 400, 640)),
            "capabilities": {"keyboard_resize": false, "pointer_resize": true}
        })
        .to_string()
    }

    fn reply_of(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("reply is JSON")
    }

    fn eligible_windows() -> serde_json::Value {
        windows_json((100, 100, 640, 400), (200, 200, 400, 640))
    }

    fn plain_windows() -> serde_json::Value {
        serde_json::json!([
            {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1"},
            {"window": "win-c", "output": "out-1", "workspace": "ws-1"}
        ])
    }

    fn focus_request(correlation: &str, focused: &str, revision: u64) -> String {
        serde_json::json!({
            "v": 1, "action": "request", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1"},
            "focused_window": focused, "direction": "up",
            "windows": plain_windows(),
            "capabilities": {"directional_focus": true}
        })
        .to_string()
    }

    fn movement_request(
        correlation: &str,
        focused: &str,
        direction: &str,
        revision: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "request", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1"},
            "focused_window": focused, "direction": direction,
            "windows": plain_windows(),
            "capabilities": {
                "swap_neighbor": true, "wrap_perpendicular": true, "wrap_siblings": true,
                "insert_child": true, "split_group_child": true, "reparent_leaf": true,
                "cross_output_transfer": true
            }
        })
        .to_string()
    }

    fn ack(correlation: &str, base: u64) -> String {
        serde_json::json!({
            "v": 1, "action": "acknowledge", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1",
            "base_revision": base, "outcome": "accepted"
        })
        .to_string()
    }

    fn resize_verify_from_plan(
        plan: &serde_json::Value,
        correlation: &str,
        focused: &str,
        base: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": base,
            "fingerprint": fp(focused), "verified": true,
            "verified_preconditions": plan["preconditions"],
            "verified_operation": plan["operation"],
            "verified_geometry": plan["desired_geometry"],
            "verified_focus": plan["desired_focus"]
        })
        .to_string()
    }

    fn focus_verify_from_plan(
        plan: &serde_json::Value,
        correlation: &str,
        to_window: &str,
        base: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": base,
            "fingerprint": fp(to_window), "verified": true,
            "verified_preconditions": plan["preconditions"],
            "verified_operation": plan["operation"]
        })
        .to_string()
    }

    #[test]
    fn pointer_route_seeds_trio_and_plans() {
        let mut service = ManualTrioService::new();
        assert!(!service.is_established());
        // Fresh [1,1] projection puts the B/C shared edge at y=544; moving
        // it up to 520 from C is a deterministic in-span pointer intent.
        let reply = reply_of(&service.evaluate_pointer_json(&pointer_request("trio-pw-1", 520, 3)));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 3);
        assert_eq!(reply["capability"], "pointer-resize");
        assert!(service.is_established());
        assert_eq!(service.accepted_revision(), 3);
    }

    #[test]
    fn routes_reject_foreign_actions_without_mutation() {
        let mut service = ManualTrioService::new();
        // request-pointer through the keyboard route is rejected and seeds
        // nothing; request through the pointer route is rejected the same.
        let foreign_keyboard = serde_json::json!({
            "v": 1, "action": "request-pointer", "correlation_id": "trio-x-1",
            "owner": "owner-1", "generation": "gen-1", "revision": 3,
            "fingerprint": fp("win-c"),
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080}, "gap": 8},
            "focused_window": "win-c", "direction": "up", "proposed_boundary": 520,
            "windows": eligible_windows(),
            "capabilities": {"keyboard_resize": false, "pointer_resize": true}
        })
        .to_string();
        let reply = reply_of(&service.evaluate_keyboard_json(&foreign_keyboard));
        assert_eq!(reply["outcome"], "rejected");
        assert!(!service.is_established());
        let foreign_pointer = serde_json::json!({
            "v": 1, "action": "request", "correlation_id": "trio-x-2",
            "owner": "owner-1", "generation": "gen-1", "revision": 3,
            "fingerprint": fp("win-c"),
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080}, "gap": 8},
            "focused_window": "win-c", "direction": "up", "mode": "inwards",
            "press_index": 0, "windows": eligible_windows(),
            "capabilities": {"keyboard_resize": true, "pointer_resize": false}
        })
        .to_string();
        let reply = reply_of(&service.evaluate_pointer_json(&foreign_pointer));
        assert_eq!(reply["outcome"], "rejected");
        assert!(!service.is_established());
    }

    #[test]
    fn duplicate_correlation_diverges_without_session_harm() {
        let mut service = ManualTrioService::new();
        let first = keyboard_request("trio-dup-1", "win-c", 3, eligible_windows());
        let reply = reply_of(&service.evaluate_keyboard_json(&first));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        // Same correlation again diverges; the pending plan and the session
        // revision survive untouched.
        let reply = reply_of(&service.evaluate_keyboard_json(&first));
        assert_eq!(reply["outcome"], "diverged");
        assert_eq!(reply["kind"], "correlation-mismatch");
        assert!(service.is_established());
        assert_eq!(service.accepted_revision(), 3);
    }

    #[test]
    fn ineligible_seed_geometry_fails_closed_without_seeding() {
        let mut service = ManualTrioService::new();
        // Sorted-B tall cannot select the wide Horizontal intent: the same
        // bounds/gap fail closed and seed nothing.
        let tall_b = windows_json((100, 100, 400, 640), (200, 200, 400, 640));
        let reply = reply_of(&service.evaluate_keyboard_json(&keyboard_request(
            "trio-bad-1",
            "win-c",
            3,
            tall_b,
        )));
        assert_eq!(reply["outcome"], "rejected");
        assert!(!service.is_established());
        // Two windows can never be the exact-three scope.
        let two = serde_json::json!([
            {"window": "win-a", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 0, "y": 0, "w": 800, "h": 600}},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 100, "y": 100, "w": 640, "h": 400}}
        ]);
        let reply = reply_of(&service.evaluate_keyboard_json(&keyboard_request(
            "trio-bad-2",
            "win-b",
            2,
            two,
        )));
        assert_eq!(reply["outcome"], "rejected");
        assert!(!service.is_established());
        assert_eq!(service.accepted_revision(), 0);
    }

    #[test]
    fn focus_pending_mirrors_and_cross_route_verify_diverges() {
        let mut service = ManualTrioService::new();
        // Seed through the public keyboard contract and commit to rev 4.
        let seed_plan = reply_of(&service.evaluate_keyboard_json(&keyboard_request(
            "trio-fm-seed",
            "win-c",
            3,
            eligible_windows(),
        )));
        assert_eq!(seed_plan["outcome"], "planned", "{seed_plan}");
        assert_eq!(seed_plan["base_revision"], 3);
        let reply = reply_of(&service.evaluate_keyboard_json(&ack("trio-fm-seed", 3)));
        assert_eq!(reply["outcome"], "acknowledged", "{reply}");
        let reply = reply_of(&service.evaluate_keyboard_json(&resize_verify_from_plan(
            &seed_plan,
            "trio-fm-seed",
            "win-c",
            3,
        )));
        assert_eq!(reply["outcome"], "committed", "{reply}");
        assert_eq!(reply["revision"], 4);
        assert_eq!(service.accepted_revision(), 4);

        // Focus C up pins B (pending Focus, unacked) over the shared session.
        let focus_plan =
            reply_of(&service.evaluate_focus_json(&focus_request("trio-fm-f1", "win-c", 4)));
        assert_eq!(focus_plan["outcome"], "planned", "{focus_plan}");
        assert_eq!(focus_plan["base_revision"], 4);
        let reply = reply_of(&service.evaluate_focus_json(&ack("trio-fm-f1", 4)));
        assert_eq!(reply["outcome"], "acknowledged", "{reply}");
        let focus_to = focus_plan["to_window"].as_str().unwrap_or("win-b");
        let reply = reply_of(&service.evaluate_focus_json(&focus_verify_from_plan(
            &focus_plan,
            "trio-fm-f1",
            focus_to,
            4,
        )));
        assert_eq!(reply["outcome"], "committed", "{reply}");
        assert_eq!(reply["revision"], 5);
        assert_eq!(service.accepted_revision(), 5);

        // Movement B down swaps with C (pending Move, unacked) over the same
        // shared session.
        let move_plan = reply_of(&service.evaluate_movement_json(&movement_request(
            "trio-fm-m1",
            "win-b",
            "down",
            5,
        )));
        assert_eq!(move_plan["outcome"], "planned", "{move_plan}");

        // Cross-route interleaving: a focus verify for a foreign correlation
        // while the Move plan is pending must diverge (mirror-enforced)
        // rather than report not-acknowledged, and must leave the session
        // terminally diverged. Without the Focus mirror this returned
        // rejected/not-acknowledged with the session intact.
        let foreign_focus = serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": "trio-fm-x1",
            "owner": "owner-1", "generation": "gen-1", "revision": 5,
            "fingerprint": fp("win-b"), "verified": true,
            "verified_preconditions": [
                "focused-leaf-occupied-by-focused-window",
                "target-leaf-occupied",
                "focus-targets-same-domain",
                "adapter-must-verify-postconditions"
            ],
            "verified_operation": {
                "domain_output": "out-1", "domain_workspace": "ws-1",
                "from_leaf": "leaf-a", "to_leaf": "leaf-b",
                "from_window": "win-c", "to_window": "win-b",
                "direction": "up", "route": ["leaf-a", "leaf-b"]
            }
        })
        .to_string();
        let foreign = reply_of(&service.evaluate_focus_json(&foreign_focus));
        assert_eq!(foreign["outcome"], "diverged", "{foreign}");
        assert_eq!(foreign["kind"], "postcondition-mismatch");

        // Terminal: the Move cycle can no longer commit.
        let late_move_verify = serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": "trio-fm-m1",
            "owner": "owner-1", "generation": "gen-1", "revision": 5,
            "fingerprint": fp("win-b"), "verified": true,
            "verified_preconditions": move_plan["preconditions"],
            "verified_operation": move_plan["operation"],
            "verified_geometry": move_plan["desired_geometry"],
            "verified_focus": move_plan["desired_focus"]
        })
        .to_string();
        let late = reply_of(&service.evaluate_movement_json(&late_move_verify));
        assert_eq!(late["outcome"], "diverged", "{late}");
    }

    fn assert_rejected_detail(
        route: crate::route_diag::Route,
        reply_text: &str,
        expected: &str,
    ) -> serde_json::Value {
        let reply: serde_json::Value = serde_json::from_str(reply_text).expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["detail"], expected, "{reply}");
        assert!(
            reply_text.len() <= TRIO_MAX_REPLY_BYTES,
            "rejected reply exceeds cap"
        );
        let route_line = crate::route_diag::describe_reply(route, reply_text);
        assert!(route_line.contains("result=rejected"), "{route_line}");
        assert!(
            route_line.ends_with(&format!(":detail={expected}")),
            "{route_line}"
        );
        let session = crate::route_diag::session_line_for_reply(reply_text)
            .expect("rejected yields a session line");
        assert!(session.contains("result=rejected"), "{session}");
        assert!(
            session.ends_with(&format!(":detail={expected}")),
            "{session}"
        );
        reply
    }

    fn fp_for(focused: &str, ids: &[&str]) -> u64 {
        let owned: Vec<String> = ids.iter().map(|s| (*s).to_owned()).collect();
        crate::focus_service::focus_fingerprint("out-1", "ws-1", focused, &owned)
    }

    fn seed_and_commit(service: &mut ManualTrioService) {
        let plan = reply_of(&service.evaluate_keyboard_json(&keyboard_request(
            "trio-seed-cm",
            "win-c",
            3,
            eligible_windows(),
        )));
        assert_eq!(plan["outcome"], "planned", "{plan}");
        let reply = reply_of(&service.evaluate_keyboard_json(&ack("trio-seed-cm", 3)));
        assert_eq!(reply["outcome"], "acknowledged", "{reply}");
        let reply = reply_of(&service.evaluate_keyboard_json(&resize_verify_from_plan(
            &plan,
            "trio-seed-cm",
            "win-c",
            3,
        )));
        assert_eq!(reply["outcome"], "committed", "{reply}");
        assert_eq!(service.accepted_revision(), 4);
    }

    #[test]
    fn focus_two_window_request_carries_count_mismatch_detail() {
        let mut service = ManualTrioService::new();
        let two = serde_json::json!([
            {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1"}
        ]);
        let request = serde_json::json!({
            "v": 1, "action": "request", "correlation_id": "trio-2w-1",
            "owner": "owner-1", "generation": "gen-1", "revision": 2,
            "fingerprint": fp_for("win-b", &["win-a", "win-b"]),
            "domain": {"output": "out-1", "workspace": "ws-1"},
            "focused_window": "win-b", "direction": "up",
            "windows": two,
            "capabilities": {"directional_focus": true}
        })
        .to_string();
        let reply_text = service.evaluate_focus_json(&request);
        assert_rejected_detail(
            crate::route_diag::Route::Focus,
            &reply_text,
            "window-count-mismatch",
        );
        assert!(!service.is_established());
    }

    #[test]
    fn rejection_details_are_branch_specific_across_routes() {
        // Focus root vs observed vs duplicate vs fingerprint vs unseeded.
        {
            let mut service = ManualTrioService::new();
            let bad_root = serde_json::json!({
                "v": 1, "action": "request", "correlation_id": "trio-br-1",
                "owner": "owner-1", "generation": "gen-1", "revision": 3,
                "fingerprint": fp("win-c"),
                "domain": {"output": "", "workspace": "ws-1"},
                "focused_window": "win-c", "direction": "up",
                "windows": plain_windows(),
                "capabilities": {"directional_focus": true}
            })
            .to_string();
            assert_rejected_detail(
                crate::route_diag::Route::Focus,
                &service.evaluate_focus_json(&bad_root),
                "root-id-invalid",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let bad_observed = serde_json::json!({
                "v": 1, "action": "request", "correlation_id": "trio-br-2",
                "owner": "owner-1", "generation": "gen-1", "revision": 3,
                "fingerprint": fp("win-c"),
                "domain": {"output": "out-1", "workspace": "ws-1"},
                "focused_window": "win-c", "direction": "up",
                "windows": [
                    {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
                    {"window": "bad id!!", "output": "out-1", "workspace": "ws-1"},
                    {"window": "win-c", "output": "out-1", "workspace": "ws-1"}
                ],
                "capabilities": {"directional_focus": true}
            })
            .to_string();
            assert_rejected_detail(
                crate::route_diag::Route::Focus,
                &service.evaluate_focus_json(&bad_observed),
                "observed-id-invalid",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let dupe = serde_json::json!({
                "v": 1, "action": "request", "correlation_id": "trio-br-3",
                "owner": "owner-1", "generation": "gen-1", "revision": 3,
                "fingerprint": fp("win-c"),
                "domain": {"output": "out-1", "workspace": "ws-1"},
                "focused_window": "win-c", "direction": "up",
                "windows": [
                    {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
                    {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
                    {"window": "win-c", "output": "out-1", "workspace": "ws-1"}
                ],
                "capabilities": {"directional_focus": true}
            })
            .to_string();
            assert_rejected_detail(
                crate::route_diag::Route::Focus,
                &service.evaluate_focus_json(&dupe),
                "duplicate-window",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let mut bad_fp =
                serde_json::from_str::<serde_json::Value>(&focus_request("trio-br-4", "win-c", 3))
                    .expect("valid");
            bad_fp["fingerprint"] = serde_json::json!(0);
            assert_rejected_detail(
                crate::route_diag::Route::Focus,
                &service.evaluate_focus_json(&bad_fp.to_string()),
                "fingerprint-mismatch",
            );
        }
        {
            // Unseeded trio: fully valid focus request on a fresh service.
            let mut service = ManualTrioService::new();
            assert_rejected_detail(
                crate::route_diag::Route::Focus,
                &service.evaluate_focus_json(&focus_request("trio-br-5", "win-c", 3)),
                "unseeded-trio",
            );
        }
        {
            // Membership mismatch on a seeded service (unknown win-x with a
            // matching fingerprint so the fingerprint gate passes).
            let mut service = ManualTrioService::new();
            seed_and_commit(&mut service);
            let request = serde_json::json!({
                "v": 1, "action": "request", "correlation_id": "trio-br-6",
                "owner": "owner-1", "generation": "gen-1", "revision": 4,
                "fingerprint": fp_for("win-c", &["win-a", "win-b", "win-x"]),
                "domain": {"output": "out-1", "workspace": "ws-1"},
                "focused_window": "win-c", "direction": "up",
                "windows": [
                    {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
                    {"window": "win-b", "output": "out-1", "workspace": "ws-1"},
                    {"window": "win-x", "output": "out-1", "workspace": "ws-1"}
                ],
                "capabilities": {"directional_focus": true}
            })
            .to_string();
            assert_rejected_detail(
                crate::route_diag::Route::Focus,
                &service.evaluate_focus_json(&request),
                "membership-mismatch",
            );
        }
        // Movement focused-observation vs domain mismatch.
        {
            let mut service = ManualTrioService::new();
            seed_and_commit(&mut service);
            let request = serde_json::json!({
                "v": 1, "action": "request", "correlation_id": "trio-br-7",
                "owner": "owner-1", "generation": "gen-1", "revision": 4,
                "fingerprint": fp_for("win-x", &["win-a", "win-b", "win-c"]),
                "domain": {"output": "out-1", "workspace": "ws-1"},
                "focused_window": "win-x", "direction": "down",
                "windows": plain_windows(),
                "capabilities": {
                    "swap_neighbor": true, "wrap_perpendicular": true, "wrap_siblings": true,
                    "insert_child": true, "split_group_child": true, "reparent_leaf": true,
                    "cross_output_transfer": true
                }
            })
            .to_string();
            assert_rejected_detail(
                crate::route_diag::Route::Movement,
                &service.evaluate_movement_json(&request),
                "focused-observation-mismatch",
            );
        }
        {
            let mut service = ManualTrioService::new();
            seed_and_commit(&mut service);
            let mut request = serde_json::from_str::<serde_json::Value>(&movement_request(
                "trio-br-8",
                "win-b",
                "down",
                4,
            ))
            .expect("valid");
            request["domains"] = serde_json::json!([{
                "output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1600, "h": 900}, "gap": 8,
                "adjacent": {}
            }]);
            assert_rejected_detail(
                crate::route_diag::Route::Movement,
                &service.evaluate_movement_json(&request.to_string()),
                "movement-domain-mismatch",
            );
        }
        // Resize carried bounds/rect/containment/cross-domain/seed/seeded/mode.
        {
            let mut service = ManualTrioService::new();
            let mut request = serde_json::from_str::<serde_json::Value>(&keyboard_request(
                "trio-br-9",
                "win-c",
                3,
                eligible_windows(),
            ))
            .expect("valid");
            request["domain"]["gap"] = serde_json::json!(999);
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&request.to_string()),
                "carried-bounds-invalid",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let bad_rect = windows_json((100, 100, 0, 400), (200, 200, 400, 640));
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&keyboard_request(
                    "trio-br-10",
                    "win-c",
                    3,
                    bad_rect,
                )),
                "carried-rect-invalid",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let outside = windows_json((1900, 1000, 100, 40), (200, 200, 400, 640));
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&keyboard_request(
                    "trio-br-11",
                    "win-c",
                    3,
                    outside,
                )),
                "rect-containment-mismatch",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let mut request = serde_json::from_str::<serde_json::Value>(&keyboard_request(
                "trio-br-12",
                "win-c",
                3,
                eligible_windows(),
            ))
            .expect("valid");
            request["windows"][0]["output"] = serde_json::json!("out-2");
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&request.to_string()),
                "cross-domain-observation",
            );
        }
        {
            // Seed failure: sorted-B tall cannot select wide Horizontal.
            let mut service = ManualTrioService::new();
            let tall_b = windows_json((100, 100, 400, 640), (200, 200, 400, 640));
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&keyboard_request(
                    "trio-br-13",
                    "win-c",
                    3,
                    tall_b,
                )),
                "seed-failed",
            );
            assert!(!service.is_established());
        }
        {
            // Seeded membership: same windows under a different work area.
            let mut service = ManualTrioService::new();
            seed_and_commit(&mut service);
            let mut request = serde_json::from_str::<serde_json::Value>(&keyboard_request(
                "trio-br-14",
                "win-c",
                4,
                eligible_windows(),
            ))
            .expect("valid");
            request["domain"]["bounds"] = serde_json::json!({"x": 0, "y": 0, "w": 1600, "h": 900});
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&request.to_string()),
                "seeded-membership-mismatch",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let mut request = serde_json::from_str::<serde_json::Value>(&keyboard_request(
                "trio-br-15",
                "win-c",
                3,
                eligible_windows(),
            ))
            .expect("valid");
            request["mode"] = serde_json::json!("sideways");
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&request.to_string()),
                "resize-mode-invalid",
            );
        }
        // Pointer route carries its own bounds detail; keyboard/pointer
        // foreign actions are fenced.
        {
            let mut service = ManualTrioService::new();
            let mut request =
                serde_json::from_str::<serde_json::Value>(&pointer_request("trio-br-16", 520, 3))
                    .expect("valid");
            request["domain"]["gap"] = serde_json::json!(999);
            assert_rejected_detail(
                crate::route_diag::Route::Pointer,
                &service.evaluate_pointer_json(&request.to_string()),
                "carried-bounds-invalid",
            );
        }
        {
            let mut service = ManualTrioService::new();
            let foreign = pointer_request("trio-br-17", 520, 3);
            assert_rejected_detail(
                crate::route_diag::Route::Resize,
                &service.evaluate_keyboard_json(&foreign),
                "cross-route-action-fenced",
            );
            assert!(!service.is_established());
        }
        {
            // Cross-route pending fencing: keyboard owns the pending plan, so
            // a pointer acknowledge is fenced without mutation.
            let mut service = ManualTrioService::new();
            let plan = reply_of(&service.evaluate_keyboard_json(&keyboard_request(
                "trio-br-18",
                "win-c",
                3,
                eligible_windows(),
            )));
            assert_eq!(plan["outcome"], "planned", "{plan}");
            assert_rejected_detail(
                crate::route_diag::Route::Pointer,
                &service.evaluate_pointer_json(&ack("trio-br-18", 3)),
                "cross-route-pending-fenced",
            );
            assert!(service.is_established());
        }
        // Session-layer refusal surfaces its own detail (movement with no
        // capabilities cannot plan).
        {
            let mut service = ManualTrioService::new();
            seed_and_commit(&mut service);
            let request = serde_json::json!({
                "v": 1, "action": "request", "correlation_id": "trio-br-19",
                "owner": "owner-1", "generation": "gen-1", "revision": 4,
                "fingerprint": fp("win-c"),
                "domain": {"output": "out-1", "workspace": "ws-1"},
                "focused_window": "win-c", "direction": "up",
                "windows": plain_windows(),
                "capabilities": {
                    "swap_neighbor": false, "wrap_perpendicular": false, "wrap_siblings": false,
                    "insert_child": false, "split_group_child": false, "reparent_leaf": false,
                    "cross_output_transfer": false
                }
            })
            .to_string();
            assert_rejected_detail(
                crate::route_diag::Route::Movement,
                &service.evaluate_movement_json(&request),
                "refused-unsupported-capability",
            );
        }
        // Oversized envelope carries its bounded detail on every route.
        {
            let big = "x".repeat(TRIO_MAX_REQUEST_BYTES + 1);
            for (route, text) in [
                (
                    crate::route_diag::Route::Focus,
                    ManualTrioService::new().evaluate_focus_json(&big),
                ),
                (
                    crate::route_diag::Route::Movement,
                    ManualTrioService::new().evaluate_movement_json(&big),
                ),
                (
                    crate::route_diag::Route::Resize,
                    ManualTrioService::new().evaluate_keyboard_json(&big),
                ),
                (
                    crate::route_diag::Route::Pointer,
                    ManualTrioService::new().evaluate_pointer_json(&big),
                ),
            ] {
                assert_rejected_detail(route, &text, "oversized-request");
            }
        }
    }
}
