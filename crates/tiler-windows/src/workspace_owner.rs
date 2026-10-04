//! Portable workspace-owner policy: output context, select/send resolution,
//! Engine observation assembly, and follow verification.
//!
//! Native effects (hide/reveal/focus/monitor identity) live in
//! `tiling_sys` (`cfg(windows)` only). This module owns no HWNDs, no window
//! properties, and no logs: pure resolution plus `CoreEvent` construction for
//! the retained `Engine` `SendToWorkspace` route.

use std::collections::{BTreeMap, BTreeSet};

use tiler_core::boundary::{CoreCommand, CoreEvent};
use tiler_core::directional::{OutputId, WindowId, WorkspaceId};
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::seed::EngineWindow;
use tiler_core::session::{DomainKey, OutputDomain};

use crate::snapkey::SnapOp;
use crate::workspace::{ManagedWorkspaces, WindowKey, verify_send_follow};

/// Resolve which output a digit chord acts on: the cached active output when
/// it still exists, else the foreground monitor, else the pointer monitor,
/// else output ordering. Never invents a key.
#[must_use]
pub fn output_context(
    spaces: &ManagedWorkspaces,
    cached: Option<&str>,
    foreground: Option<&str>,
    pointer: Option<&str>,
) -> Option<String> {
    if let Some(key) = cached
        && spaces.output_keys().iter().any(|k| k == key)
    {
        return Some(key.to_owned());
    }
    if let Some(key) = foreground
        && spaces.output_keys().iter().any(|k| k == key)
    {
        return Some(key.to_owned());
    }
    if let Some(key) = pointer
        && spaces.output_keys().iter().any(|k| k == key)
    {
        return Some(key.to_owned());
    }
    spaces.output_keys().into_iter().next()
}

/// One Engine window row: token, last-known rectangle, fresh
/// application-declared minimum-size hint, and the slotless floating
/// exception flag (intentional float or born-held fullscreen: the window
/// rides Engine membership with no tile slot so siblings keep the tile area).
/// Hidden snapshots ride the same rows so convergence never drops retained
/// membership; hidden rows carry a fresh hint like visible rows (fresh
/// observation only, never a stored floor) while retained rows carry none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerRow {
    pub token: String,
    pub rect: Rect,
    pub hints: tiler_core::size_hints::WindowSizeHints,
    pub floating: bool,
}

/// Build the source/target domain pair plus window rows for one Engine
/// `SendToWorkspace` request. Rows already include hidden snapshots for both
/// domains; the caller supplies them. Returns `None` when either workspace id
/// is unknown on the output.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn build_send_event(
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    revision: u64,
    fingerprint: u64,
    source_domain: (OutputDomain, DomainKey),
    target_domain: (OutputDomain, DomainKey),
    source_rows: &[OwnerRow],
    target_rows: &[OwnerRow],
    mover_token: &str,
    outer_gap: i32,
) -> Option<CoreEvent> {
    if mover_token.is_empty() {
        return None;
    }
    let (domain, domain_key) = source_domain;
    let (target_domain_value, target_key) = target_domain;
    let windows: Vec<EngineWindow> = source_rows
        .iter()
        .map(|row| EngineWindow {
            window: WindowId(row.token.clone()),
            output: domain_key.output.clone(),
            workspace: domain_key.workspace.clone(),
            rect: row.rect,
            floating: row.floating,
            fit_excluded: false,
            hints: row.hints,
        })
        .collect();
    let target_windows: Vec<EngineWindow> = target_rows
        .iter()
        .map(|row| EngineWindow {
            window: WindowId(row.token.clone()),
            output: target_key.output.clone(),
            workspace: target_key.workspace.clone(),
            rect: row.rect,
            floating: row.floating,
            fit_excluded: false,
            hints: row.hints,
        })
        .collect();
    Some(CoreEvent {
        owner: owner.clone(),
        generation: generation.clone(),
        correlation: correlation.clone(),
        revision,
        fingerprint,
        domain,
        domain_key,
        outer_gap,
        focused_window: WindowId(mover_token.to_owned()),
        windows,
        directional: None,
        directional_target_outer_gap: None,
        target_domain: Some((target_domain_value, target_key)),
        target_windows,
        command: CoreCommand::SendToWorkspace {
            window: mover_token.to_owned(),
            target_output: String::new(),
            target_workspace: String::new(),
        },
    })
}

/// Fill the command target from the resolved domain key. Split from
/// [`build_send_event`] so tests assert the target binding explicitly.
pub fn stamp_send_target(event: &mut CoreEvent, target: &DomainKey) {
    if let CoreCommand::SendToWorkspace {
        target_output,
        target_workspace,
        ..
    } = &mut event.command
    {
        *target_output = target.output.0.clone();
        *target_workspace = target.workspace.0.clone();
    }
}

/// Verify the project-owned membership transfer after the planned Engine
/// mutation: the mover is absent from the source set and present in the
/// target set. No-op and foreign transfers never follow.
#[must_use]
pub fn verify_membership_transfer(
    mover: &WindowKey,
    source_members: &BTreeSet<WindowKey>,
    target_members: &BTreeSet<WindowKey>,
) -> bool {
    verify_send_follow(mover, source_members, target_members)
}

/// Planned send route across one workspace boundary. Tiled-to-tiled sends
/// run the shared two-domain Engine plan; any boundary touching a floating
/// workspace transfers project native membership instead (no two-domain
/// plan, no floating-side geometry) and reflows only the tiled side.
/// Eligibility derives from the actual source workspace mode, never from the
/// mover's per-window float flag alone: a mover leaving a floating source is
/// a native-boundary send even when it carries a slotless float exception.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendRoute {
    Engine,
    Native,
}

#[must_use]
pub const fn send_route(source_tiled: bool, target_tiled: bool) -> SendRoute {
    if source_tiled && target_tiled {
        SendRoute::Engine
    } else {
        SendRoute::Native
    }
}

/// Directional refusal on a floating workspace (KDE plan-adapter parity:
/// `focus-refused-workspace-floating` plus `move-refused-workspace-floating`).
/// Both focus and move refuse: a floating workspace runs no tile layout, so
/// directional navigation has no topology to move through or focus within.
/// `None` when the workspace is tiled.
#[must_use]
pub const fn directional_workspace_refusal(op: SnapOp, tiled: bool) -> Option<&'static str> {
    if tiled {
        return None;
    }
    Some(match op {
        SnapOp::Focus => "focus-refused-workspace-floating",
        SnapOp::Move => "move-refused-workspace-floating",
    })
}

/// Engine tokens that must ride floating through the runtime intent even when
/// the Engine session carries no exception: a session freshly released by a
/// workspace-mode toggle, or a boundary-send adoption the target session has
/// never seen. Keyed by exact window lifetime, so a recycled HWND never
/// inherits and dead lifetimes prune with membership. Sticky and
/// born-fullscreen members keep their own lanes and never enter here.
#[must_use]
pub fn float_carry_tokens(
    members: &BTreeSet<WindowKey>,
    token_of: &BTreeMap<WindowKey, String>,
    intent: &BTreeSet<WindowKey>,
) -> BTreeSet<String> {
    members
        .iter()
        .filter(|key| intent.contains(*key))
        .filter_map(|key| token_of.get(key))
        .cloned()
        .collect()
}

/// Focus-before-geometry gate for a verified workspace transition: establish
/// the appropriate target focus before geometry only when the transition
/// verified and no fullscreen/elevated foreground arrived. A real fullscreen
/// or elevated arrival must never be stolen from just to defeat the geometry
/// veto; skipping focus there lets the write path veto honestly.
#[must_use]
pub const fn focus_before_geometry(
    transition_verified: bool,
    fullscreen_foreground: bool,
    elevated_foreground: bool,
) -> bool {
    transition_verified && !fullscreen_foreground && !elevated_foreground
}

/// Privacy-safe foreground veto reason. Bounded vocabulary only: no titles,
/// paths, HWNDs, PIDs, or content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForegroundVetoReason {
    /// No covering window (null foreground, captioned, or small borderless).
    None,
    /// Captioned foreground: never borderless fullscreen by construction.
    Captioned,
    /// Valid foreground handle that is not visible: invisible windows cannot
    /// be covering.
    Nonvisible,
    /// Exact desktop shell handle (`GetShellWindow`/`GetDesktopWindow`): the
    /// desktop, not a fullscreen application.
    Desktop,
    /// Visible captionless foreground whose frame covers a monitor.
    Fullscreen,
    /// Valid visible foreground that the compositor reports cloaked
    /// (`DWMWA_CLOAKED`): invisible to the compositor, so never a covering
    /// fullscreen even when its frame spans a monitor.
    Cloaked,
    /// Captionless monitor-covering foreground verified as a managed member
    /// or a born-held tracked window: it rides a retained overlay slot with
    /// no geometry writes, so it never suspends the workspace. Unverified
    /// fullscreen still reports `Fullscreen` and suspends.
    ManagedOverlay,
    /// Visible foreground whose frame could not be read: fail closed.
    Unreadable,
    /// Non-null foreground handle that fails validity: fail closed.
    Invalid,
}

impl ForegroundVetoReason {
    /// Stable log token for the bounded action summary.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Captioned => "captioned",
            Self::Nonvisible => "nonvisible",
            Self::Desktop => "desktop",
            Self::Fullscreen => "fullscreen",
            Self::Cloaked => "cloaked",
            Self::ManagedOverlay => "managed-overlay",
            Self::Unreadable => "unreadable",
            Self::Invalid => "invalid",
        }
    }
}

/// Portable foreground facts for the veto classifier. The native caller owns
/// all reads; this struct carries only booleans plus the already-computed
/// covering predicate, never handles, paths, or titles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ForegroundFacts {
    /// Foreground handle passed native validity (`IsWindow`, non-null).
    pub valid: bool,
    /// Exact desktop shell identity (`GetShellWindow`/`GetDesktopWindow`).
    pub is_desktop: bool,
    /// Fresh `IsWindowVisible` read on the valid handle.
    pub visible: bool,
    /// Caption bit (`WS_CAPTION`) from the live style.
    pub captioned: bool,
    /// DWM extended-frame-bounds read succeeded.
    pub dwm_readable: bool,
    /// DWM cloak-attribute (`DWMWA_CLOAKED`) read succeeded. Failure fails
    /// closed like an unreadable frame: an unknown cloak state never clears
    /// a covering frame.
    pub cloak_readable: bool,
    /// DWM reports the foreground cloaked (invisible to the compositor).
    pub cloaked: bool,
    /// Captionless frame covers a monitor full rect (portable predicate).
    pub covers_monitor: bool,
}

/// Veto decision plus reason. `block == true` preserves the existing gate:
/// visible real fullscreen, visible unreadable, and invalid foregrounds veto;
/// everything else (including valid non-visible and exact desktop) does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ForegroundVeto {
    pub block: bool,
    pub reason: ForegroundVetoReason,
}

/// Portable fact-based foreground veto policy, used by the actual native path.
/// Order matters: validity first (fail closed), then exact desktop identity
/// (classifier correctness, not an intent exception), then fresh visibility
/// (invisible cannot cover), then readability (visible unknown stays blocked),
/// then cloak (cloaked is invisible to the compositor, unreadable cloak
/// stays blocked), then caption, then covering geometry.
#[must_use]
pub const fn classify_foreground(facts: ForegroundFacts) -> ForegroundVeto {
    if !facts.valid {
        return ForegroundVeto {
            block: true,
            reason: ForegroundVetoReason::Invalid,
        };
    }
    if facts.is_desktop {
        return ForegroundVeto {
            block: false,
            reason: ForegroundVetoReason::Desktop,
        };
    }
    if !facts.visible {
        return ForegroundVeto {
            block: false,
            reason: ForegroundVetoReason::Nonvisible,
        };
    }
    if !facts.dwm_readable {
        return ForegroundVeto {
            block: true,
            reason: ForegroundVetoReason::Unreadable,
        };
    }
    if !facts.cloak_readable {
        return ForegroundVeto {
            block: true,
            reason: ForegroundVetoReason::Unreadable,
        };
    }
    if facts.cloaked {
        return ForegroundVeto {
            block: false,
            reason: ForegroundVetoReason::Cloaked,
        };
    }
    if facts.captioned {
        return ForegroundVeto {
            block: false,
            reason: ForegroundVetoReason::Captioned,
        };
    }
    if facts.covers_monitor {
        return ForegroundVeto {
            block: true,
            reason: ForegroundVetoReason::Fullscreen,
        };
    }
    ForegroundVeto {
        block: false,
        reason: ForegroundVetoReason::None,
    }
}

/// One planned geometry write extracted from an Engine reply: the portable
/// shape the native write path consumes. Workspace identity stays with the
/// caller; scoping rides the domain writable set, never a workspace-id
/// partition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedWrite {
    pub window: WindowId,
    pub rect: Rect,
    pub overconstrained: bool,
    pub client_clamped: bool,
}

/// Portable Engine-reply extraction used by the actual native write path.
/// Returns `None` for non-plan replies so callers serialize null with reason
/// instead of zeros. Both-domain `SendWorkspace` plans carry source reflow
/// and target placement together; the domain writable set scopes each pass.
#[must_use]
pub fn planned_writes(reply: &tiler_core::boundary::CoreReply) -> Option<Vec<PlannedWrite>> {
    fn map(geometry: &[tiler_core::session::DesiredGeometry]) -> Vec<PlannedWrite> {
        geometry
            .iter()
            .map(|g| PlannedWrite {
                window: g.window.clone(),
                rect: g.rect,
                overconstrained: g.overconstrained,
                client_clamped: g.client_clamped,
            })
            .collect()
    }
    use tiler_core::boundary::CoreReply as R;
    match reply {
        R::Projection(plan) => Some(map(&plan.geometry)),
        R::Tiled(plan) => Some(map(&plan.geometry)),
        R::Resize(plan) => Some(map(&plan.geometry)),
        R::MoveDirectional(plan) => Some(map(&plan.geometry)),
        R::FocusDirectional(plan) => Some(map(&plan.geometry)),
        R::SendWorkspace(plan) => Some(map(&plan.geometry)),
        _ => None,
    }
}

/// Portable writable-token subset: non-hidden members whose Engine token is
/// present in the fresh eligible observation. Retained members without a
/// fresh frame and hidden members never take geometry writes; hidden
/// workspace geometry waits for reveal. Scope and identity revalidation stay
/// with the native caller; this pins the hidden/retained exclusion.
#[must_use]
pub fn writable_subset(
    members: &BTreeSet<WindowKey>,
    is_hidden: impl Fn(&WindowKey) -> bool,
    token_of: &BTreeMap<WindowKey, String>,
    fresh_tokens: &std::collections::HashSet<String>,
) -> std::collections::HashSet<String> {
    members
        .iter()
        .filter(|k| !is_hidden(k))
        .filter_map(|k| token_of.get(k))
        .filter(|t| fresh_tokens.contains(*t))
        .cloned()
        .collect()
}

/// Hidden snapshot rectangle for one member: intentional floats ride the live
/// float snapshot with the tiled allocation as fallback; every other member
/// (including born holds, which never seed a float snapshot) rides the tiled
/// allocation with the float snapshot as fallback. `None` only when both are
/// missing, so row assembly drops nothing it could keep.
#[must_use]
pub const fn hidden_snapshot_rect(
    is_float: bool,
    float_rect: Option<Rect>,
    member_rect: Option<Rect>,
) -> Option<Rect> {
    if is_float {
        match float_rect {
            Some(rect) => Some(rect),
            None => member_rect,
        }
    } else {
        match member_rect {
            Some(rect) => Some(rect),
            None => float_rect,
        }
    }
}

/// Pure owner dispatch gate for one workspace digit, shared by the native
/// loop and offline tests. `takeover` is the `--no-keyboard-snap-takeover`
/// switch (off disables all product interception); `suspended` covers
/// fullscreen suspension, managed gestures, and gesture settle; `send`
/// requires a managed focused member while select also serves empty
/// workspaces and unmanaged foreground.
#[must_use]
pub const fn dispatch_decision(
    takeover: bool,
    suspended: bool,
    send: bool,
    managed_focus: bool,
) -> Option<&'static str> {
    if !takeover {
        return Some("takeover-off");
    }
    if suspended {
        return Some("suspended");
    }
    if send && !managed_focus {
        return Some("unmanaged");
    }
    None
}

/// Membership snapshot helper: group tokens by domain for observation
/// assembly without touching native state.
#[must_use]
pub fn rows_for(
    members: &BTreeMap<String, OwnerRow>,
    workspace_members: &BTreeSet<WindowKey>,
    token_of: &BTreeMap<WindowKey, String>,
) -> Vec<OwnerRow> {
    let mut rows = Vec::new();
    for member in workspace_members {
        if let Some(token) = token_of.get(member)
            && let Some(row) = members.get(token)
        {
            rows.push(row.clone());
        }
    }
    rows.sort_by(|a, b| a.token.cmp(&b.token));
    rows
}

/// One member's portable view for domain-row assembly: stable session key,
/// Engine token, best-known rectangle (fresh visible read, fresh retained
/// frame, or hidden snapshot), fresh minimum-size hint (eligible visible
/// reads plus verified hidden snapshots; retained rows carry no hint), and
/// the slotless floating exception flag (intentional float or born-held
/// fullscreen, never a native write).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberView {
    pub key: WindowKey,
    pub token: String,
    pub rect: Rect,
    pub hints: tiler_core::size_hints::WindowSizeHints,
    pub floating: bool,
}

/// Assemble complete Engine observation rows for one workspace domain from
/// the union of eligible visible views, retained-occupancy views
/// (minimized/maximized/fullscreen with last-known frames), and hidden
/// snapshots. Sorted by token for deterministic fingerprints; hidden Engine
/// membership survives because every retained member rides a row.
///
/// Returns `None` when any member lacks a view (unknown snapshot): the
/// caller must defer every Engine handle path with retained state instead of
/// presenting a falsely complete observation that would drop membership.
#[must_use]
pub fn domain_rows(
    workspace_members: &BTreeSet<WindowKey>,
    views: &[MemberView],
) -> Option<Vec<OwnerRow>> {
    let mut rows = Vec::new();
    for member in workspace_members {
        let view = views.iter().find(|v| v.key == *member)?;
        rows.push(OwnerRow {
            token: view.token.clone(),
            rect: view.rect,
            hints: view.hints,
            floating: view.floating,
        });
    }
    rows.sort_by(|a, b| a.token.cmp(&b.token));
    Some(rows)
}

/// Same-HWND reuse set: known member keys sharing the fresh window's HWND
/// with a different full identity. The fresh enumeration read is
/// authoritative: a HWND hosts exactly one process, so any other key for the
/// number is a destroyed window whose number the OS recycled while visible.
/// Live hidden claims are excluded: they own their HWND through the ledger
/// and audit path (retire with identity-safe reveal), never this repair.
#[must_use]
pub fn reused_hwnd_stale(
    known: &[WindowKey],
    hidden_claimed: &BTreeSet<WindowKey>,
    fresh: &WindowKey,
) -> Vec<WindowKey> {
    known
        .iter()
        .filter(|k| k.hwnd == fresh.hwnd && *k != fresh && !hidden_claimed.contains(*k))
        .cloned()
        .collect()
}

/// Visible-membership lifetime decision: the live member tag must equal the
/// tag stored at admission. A same-process HWND reuse starts without our
/// window-lifetime property (absent) or with a stale tag, so it fails closed
/// exactly where HWND/PID/creation all still agree. An empty stored tag
/// never matches: untracked windows are never trusted, only stamped.
#[must_use]
pub fn visible_lifetime_ok(stored: &str, live: Option<&str>) -> bool {
    !stored.is_empty() && live.is_some_and(|tag| tag == stored)
}

/// Recycled-HWND guard: the live window matches the stored member only when
/// HWND, PID, and process creation all agree. A same-process HWND reuse keeps
/// all three, so this guard alone never sees it: the visible-membership
/// lifetime property must also agree (see [`visible_lifetime_ok`]).
#[must_use]
pub fn member_matches(
    stored: &WindowKey,
    live_hwnd: u64,
    live_pid: u32,
    live_creation: &str,
) -> bool {
    stored.hwnd == live_hwnd && stored.pid == live_pid && stored.creation.as_str() == live_creation
}

/// Portable domain value for one `(output, workspace)` pair.
#[must_use]
pub fn workspace_domain(
    output: &str,
    workspace: &str,
    bounds: Rect,
    gap: i32,
) -> (OutputDomain, DomainKey) {
    let key = DomainKey {
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
    };
    let domain = OutputDomain {
        id: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        bounds,
        gap,
        adjacent: BTreeMap::new(),
    };
    (domain, key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::ManagedWorkspaces;

    fn rect(x: i32, y: i32) -> Rect {
        Rect {
            x,
            y,
            w: 800,
            h: 600,
        }
    }

    fn key(hwnd: u64) -> WindowKey {
        WindowKey {
            hwnd,
            pid: 1000 + hwnd as u32,
            creation: format!("c{hwnd:016x}"),
        }
    }

    fn seed_two_tiled(
        engine: &mut tiler_core::engine::Engine,
        owner: &OwnerId,
        generation: &GenerationId,
        domain: &(OutputDomain, DomainKey),
        bounds: Rect,
    ) {
        let correlation = CorrelationId::parse("seed").expect("correlation");
        let event = crate::tiling::build_reconcile_event_for(
            owner,
            generation,
            &correlation,
            0,
            2,
            &domain.0,
            &domain.1,
            8,
            &[
                (
                    WindowId("w1".to_owned()),
                    bounds,
                    tiler_core::size_hints::WindowSizeHints::none(),
                ),
                (
                    WindowId("w2".to_owned()),
                    bounds,
                    tiler_core::size_hints::WindowSizeHints::none(),
                ),
            ],
            Some(&WindowId("w1".to_owned())),
        );
        let reply = engine.handle(&event);
        assert!(
            matches!(
                reply,
                tiler_core::boundary::CoreReply::Projection(_)
                    | tiler_core::boundary::CoreReply::Tiled(_)
            ),
            "seed must converge, got {reply:?}"
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn float_event(
        owner: &OwnerId,
        generation: &GenerationId,
        correlation: &str,
        revision: u64,
        domain: &(OutputDomain, DomainKey),
        rows: &[(WindowId, Rect, bool)],
        focused: &str,
        window: &str,
        float_rect: Option<Rect>,
    ) -> tiler_core::boundary::CoreEvent {
        use tiler_core::boundary::CoreCommand;
        let correlation = CorrelationId::parse(correlation).expect("correlation");
        let fp = crate::tiling::fingerprint(
            &rows
                .iter()
                .map(|(token, rect, _)| (token.0.clone(), *rect))
                .collect::<Vec<_>>(),
        );
        let carried: Vec<(
            WindowId,
            Rect,
            tiler_core::size_hints::WindowSizeHints,
            bool,
        )> = rows
            .iter()
            .map(|(token, rect, floating)| {
                (
                    token.clone(),
                    *rect,
                    tiler_core::size_hints::WindowSizeHints::none(),
                    *floating,
                )
            })
            .collect();
        let mut event = crate::tiling::build_reconcile_event_for_floating(
            owner,
            generation,
            &correlation,
            revision,
            fp,
            &domain.0,
            &domain.1,
            8,
            &carried,
            Some(&WindowId(focused.to_owned())),
        );
        event.command = CoreCommand::ToggleFloat {
            window: window.to_owned(),
            float_rect,
        };
        event
    }

    fn revision_of(engine: &tiler_core::engine::Engine, domain: &(OutputDomain, DomainKey)) -> u64 {
        engine
            .session(&domain.1)
            .map(|s| s.accepted_revision())
            .unwrap_or(0)
    }

    #[test]
    fn toggle_float_first_float_centers_sixty_percent() {
        // Tiled-to-float with no rect selects the centered 60% work-area
        // fallback (KDE parity): the reply carries the placement for native
        // actuation while sibling reflow excludes the floated window.
        use tiler_core::boundary::CoreReply;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let domain = workspace_domain("mon-a", "ws-1", bounds, 8);
        seed_two_tiled(&mut engine, &owner, &generation, &domain, bounds);
        let event = float_event(
            &owner,
            &generation,
            "float-1",
            revision_of(&engine, &domain),
            &domain,
            &[
                (WindowId("w1".to_owned()), bounds, false),
                (WindowId("w2".to_owned()), bounds, false),
            ],
            "w1",
            "w1",
            None,
        );
        let reply = engine.handle(&event);
        let CoreReply::Tiled(plan) = reply else {
            panic!("float commits, got {reply:?}");
        };
        // Centered 60% of the 800x600 domain: 480x360 at (160, 120).
        let centered = Rect {
            x: 160,
            y: 120,
            w: 480,
            h: 360,
        };
        assert_eq!(plan.float_rect, Some(centered));
        assert!(
            !plan.geometry.iter().any(|g| g.window.0 == "w1"),
            "floated window leaves the tree"
        );
        assert!(
            plan.geometry.iter().any(|g| g.window.0 == "w2"),
            "sibling reflows"
        );
    }

    #[test]
    fn toggle_float_retains_moved_frame() {
        // Unfloat carries the live frame rect so a user moved/resized float is
        // retained: floating again with no rect reuses the moved frame, never
        // the centered fallback.
        use tiler_core::boundary::CoreReply;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let domain = workspace_domain("mon-a", "ws-1", bounds, 8);
        seed_two_tiled(&mut engine, &owner, &generation, &domain, bounds);
        let float = |engine: &tiler_core::engine::Engine,
                     rows: &[(WindowId, Rect, bool)],
                     correlation: &str,
                     window: &str,
                     float_rect: Option<Rect>| {
            float_event(
                &owner,
                &generation,
                correlation,
                revision_of(engine, &domain),
                &domain,
                rows,
                window,
                window,
                float_rect,
            )
        };
        let moved = Rect {
            x: 210,
            y: 150,
            w: 480,
            h: 360,
        };
        let reply = engine.handle(&float(
            &engine,
            &[
                (WindowId("w1".to_owned()), bounds, false),
                (WindowId("w2".to_owned()), bounds, false),
            ],
            "float-1",
            "w1",
            None,
        ));
        assert!(
            matches!(reply, CoreReply::Tiled(_)),
            "float commits, got {reply:?}"
        );
        let reply = engine.handle(&float(
            &engine,
            &[
                (WindowId("w1".to_owned()), moved, true),
                (WindowId("w2".to_owned()), bounds, false),
            ],
            "float-2",
            "w1",
            Some(moved),
        ));
        let CoreReply::Tiled(plan) = reply else {
            panic!("unfloat commits, got {reply:?}");
        };
        assert_eq!(plan.float_rect, None, "unfloat stages no float rect");
        assert!(
            plan.geometry.iter().any(|g| g.window.0 == "w2"),
            "sibling survives readmission"
        );
        let reply = engine.handle(&float(
            &engine,
            &[
                (
                    WindowId("w1".to_owned()),
                    plan.geometry
                        .iter()
                        .find(|g| g.window.0 == "w1")
                        .expect("admission places the mover")
                        .rect,
                    false,
                ),
                (WindowId("w2".to_owned()), bounds, false),
            ],
            "float-3",
            "w1",
            None,
        ));
        let CoreReply::Tiled(plan) = reply else {
            panic!("refloat commits, got {reply:?}");
        };
        assert_eq!(plan.float_rect, Some(moved));
    }

    #[test]
    fn hidden_snapshot_rect_prefers_live_float_then_tiled() {
        // Intentional floats ride the live float snapshot; every other member
        // (including born holds, which never seed a float snapshot) rides the
        // tiled allocation. Each lane falls back to the other snapshot so a
        // hidden member is never dropped while either exists.
        use super::hidden_snapshot_rect;
        let float_rect = Some(Rect {
            x: 1,
            y: 2,
            w: 3,
            h: 4,
        });
        let member_rect = Some(Rect {
            x: 5,
            y: 6,
            w: 7,
            h: 8,
        });
        assert_eq!(
            hidden_snapshot_rect(true, float_rect, member_rect),
            float_rect
        );
        assert_eq!(hidden_snapshot_rect(true, None, member_rect), member_rect);
        assert_eq!(
            hidden_snapshot_rect(false, float_rect, member_rect),
            member_rect
        );
        assert_eq!(hidden_snapshot_rect(false, float_rect, None), float_rect);
        assert_eq!(hidden_snapshot_rect(true, None, None), None);
        assert_eq!(hidden_snapshot_rect(false, None, None), None);
    }

    #[test]
    fn unfloat_matches_fresh_admission_topology() {
        // H[w1 V[w2 w3]] floats w3 to H[w1 w2]; unfloating w3 must equal a
        // fresh admission of a new window into H[w1 w2]: same tree topology
        // and same admitted geometry, never the old slot or domain bounds.
        use tiler_core::boundary::CoreReply;
        use tiler_core::directional::{Axis, Node};
        fn wide() -> Rect {
            Rect {
                x: 0,
                y: 0,
                w: 120,
                h: 80,
            }
        }
        fn tall() -> Rect {
            Rect {
                x: 0,
                y: 0,
                w: 80,
                h: 120,
            }
        }
        fn same_topology(left: &Node, right: &Node) -> bool {
            match (left, right) {
                (Node::Leaf { id: l }, Node::Leaf { id: r }) => l == r,
                (
                    Node::Group {
                        axis: l_axis,
                        children: l_children,
                        shares: l_shares,
                        ..
                    },
                    Node::Group {
                        axis: r_axis,
                        children: r_children,
                        shares: r_shares,
                        ..
                    },
                ) => {
                    l_axis == r_axis
                        && l_shares == r_shares
                        && l_children.len() == r_children.len()
                        && l_children
                            .iter()
                            .zip(r_children.iter())
                            .all(|(l, r)| same_topology(l, r))
                }
                _ => false,
            }
        }
        fn tree_of(
            engine: &tiler_core::engine::Engine,
            domain: &(OutputDomain, DomainKey),
        ) -> Node {
            engine
                .session(&domain.1)
                .expect("session")
                .snapshot()
                .domains
                .into_iter()
                .next()
                .expect("domain")
                .tree
                .expect("tree")
        }
        fn assert_nested_h_v(tree: &Node) {
            match tree {
                Node::Group { axis, children, .. } => {
                    assert_eq!(*axis, Axis::Horizontal);
                    assert_eq!(children.len(), 2);
                    assert_eq!(children[0].id().0, "leaf-w1");
                    match &children[1] {
                        Node::Group { axis, children, .. } => {
                            assert_eq!(*axis, Axis::Vertical);
                            assert_eq!(children.len(), 2);
                            assert_eq!(children[0].id().0, "leaf-w2");
                            assert_eq!(children[1].id().0, "leaf-w3");
                        }
                        other => panic!("expected inner V[w2 w3], got {other:?}"),
                    }
                }
                other => panic!("expected root H[w1 V[w2 w3]], got {other:?}"),
            }
        }
        fn reconcile(
            engine: &mut tiler_core::engine::Engine,
            owner: &OwnerId,
            generation: &GenerationId,
            domain: &(OutputDomain, DomainKey),
            correlation: &str,
            rows: &[(WindowId, Rect)],
            focused: &str,
        ) -> CoreReply {
            let correlation = CorrelationId::parse(correlation).expect("correlation");
            let carried: Vec<(
                WindowId,
                Rect,
                tiler_core::size_hints::WindowSizeHints,
                bool,
            )> = rows
                .iter()
                .map(|(token, rect)| {
                    (
                        token.clone(),
                        *rect,
                        tiler_core::size_hints::WindowSizeHints::none(),
                        false,
                    )
                })
                .collect();
            let fp = crate::tiling::fingerprint(
                &rows
                    .iter()
                    .map(|(token, rect)| (token.0.clone(), *rect))
                    .collect::<Vec<_>>(),
            );
            let event = crate::tiling::build_reconcile_event_for_floating(
                owner,
                generation,
                &correlation,
                revision_of(engine, domain),
                fp,
                &domain.0,
                &domain.1,
                0,
                &carried,
                Some(&WindowId(focused.to_owned())),
            );
            engine.handle(&event)
        }
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        };
        let domain = workspace_domain("mon-a", "ws-1", bounds, 0);
        let w1 = WindowId("w1".to_owned());
        let w2 = WindowId("w2".to_owned());
        let w3 = WindowId("w3".to_owned());
        // Engine A: seed H[w1 V[w2 w3]], float w3, unfloat with the live frame.
        let mut engine_a = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine_a.sync_binding(&owner, &generation);
        for (correlation, rows, focused) in [
            ("seed-1", vec![(w1.clone(), wide())], "w1"),
            (
                "seed-2",
                vec![(w1.clone(), wide()), (w2.clone(), wide())],
                "w2",
            ),
            (
                "seed-3",
                vec![
                    (w1.clone(), wide()),
                    (w2.clone(), wide()),
                    (w3.clone(), tall()),
                ],
                "w3",
            ),
        ] {
            let reply = reconcile(
                &mut engine_a,
                &owner,
                &generation,
                &domain,
                correlation,
                &rows,
                focused,
            );
            assert!(
                matches!(
                    reply,
                    CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
                ),
                "seed {correlation} converges, got {reply:?}"
            );
        }
        assert_nested_h_v(&tree_of(&engine_a, &domain));
        let reply = engine_a.handle(&float_event(
            &owner,
            &generation,
            "float-a",
            revision_of(&engine_a, &domain),
            &domain,
            &[
                (w1.clone(), wide(), false),
                (w2.clone(), wide(), false),
                (w3.clone(), tall(), false),
            ],
            "w3",
            "w3",
            None,
        ));
        let CoreReply::Tiled(float_plan) = reply else {
            panic!("float commits, got {reply:?}");
        };
        let live = float_plan.float_rect.expect("float places");
        let reply = engine_a.handle(&float_event(
            &owner,
            &generation,
            "unfloat-a",
            revision_of(&engine_a, &domain),
            &domain,
            &[
                (w1.clone(), wide(), false),
                (w2.clone(), wide(), false),
                (w3.clone(), live, true),
            ],
            "w3",
            "w3",
            Some(live),
        ));
        let CoreReply::Tiled(unfloat_plan) = reply else {
            panic!("unfloat commits, got {reply:?}");
        };
        let admitted_a = unfloat_plan
            .geometry
            .iter()
            .find(|g| g.window.0 == "w3")
            .expect("admission places w3")
            .rect;
        let tree_a = tree_of(&engine_a, &domain);
        assert_nested_h_v(&tree_a);
        // Engine B: seed H[w1 w2], then freshly admit w3 with the same frame.
        let mut engine_b = tiler_core::engine::Engine::new();
        engine_b.sync_binding(&owner, &generation);
        for (correlation, rows, focused) in [
            ("seed-1", vec![(w1.clone(), wide())], "w1"),
            (
                "seed-2",
                vec![(w1.clone(), wide()), (w2.clone(), wide())],
                "w2",
            ),
        ] {
            let reply = reconcile(
                &mut engine_b,
                &owner,
                &generation,
                &domain,
                correlation,
                &rows,
                focused,
            );
            assert!(
                matches!(
                    reply,
                    CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
                ),
                "seed {correlation} converges, got {reply:?}"
            );
        }
        let reply = reconcile(
            &mut engine_b,
            &owner,
            &generation,
            &domain,
            "admit-b",
            &[
                (w1.clone(), wide()),
                (w2.clone(), wide()),
                (w3.clone(), live),
            ],
            "w3",
        );
        assert!(
            matches!(
                reply,
                CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
            ),
            "fresh admission converges, got {reply:?}"
        );
        let tree_b = tree_of(&engine_b, &domain);
        assert!(
            same_topology(&tree_a, &tree_b),
            "unfloat reuses the fresh admission axis: {tree_a:?} vs {tree_b:?}"
        );
        // Admitted geometry matches the same fresh admission: compare via the
        // converged session projection rather than the old slot.
        let geometry_b: Vec<(String, Rect)> = match reply {
            CoreReply::Projection(plan) => plan
                .geometry
                .iter()
                .map(|g| (g.window.0.clone(), g.rect))
                .collect(),
            CoreReply::Tiled(plan) => plan
                .geometry
                .iter()
                .map(|g| (g.window.0.clone(), g.rect))
                .collect(),
            CoreReply::SendWorkspace(plan) => plan
                .geometry
                .iter()
                .map(|g| (g.window.0.clone(), g.rect))
                .collect(),
            other => panic!("fresh admission converges, got {other:?}"),
        };
        let admitted_b = geometry_b
            .iter()
            .find(|(token, _)| token == "w3")
            .expect("fresh admission places w3")
            .1;
        assert_eq!(admitted_a, admitted_b, "unfloat places like a new window");
    }

    #[test]
    fn output_context_prefers_cached_then_foreground_then_order() {
        let mut spaces = ManagedWorkspaces::new();
        spaces.ensure_output("mon-a");
        spaces.ensure_output("mon-b");
        assert_eq!(
            output_context(&spaces, Some("mon-b"), Some("mon-a"), Some("mon-a")).as_deref(),
            Some("mon-b")
        );
        assert_eq!(
            output_context(&spaces, Some("gone"), Some("mon-a"), Some("mon-b")).as_deref(),
            Some("mon-a")
        );
        assert_eq!(
            output_context(&spaces, Some("gone"), None, Some("mon-b")).as_deref(),
            Some("mon-b")
        );
        assert_eq!(
            output_context(&spaces, None, None, None).as_deref(),
            Some("mon-a")
        );
        let empty = ManagedWorkspaces::new();
        assert_eq!(output_context(&empty, None, None, None), None);
    }

    #[test]
    fn send_event_binds_target_and_focused_mover() {
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        let source_rows = vec![OwnerRow {
            token: "w1".to_owned(),
            rect: bounds,
            hints: tiler_core::size_hints::WindowSizeHints::none(),
            floating: false,
        }];
        let target_rows = vec![OwnerRow {
            token: "w2".to_owned(),
            rect: bounds,
            hints: tiler_core::size_hints::WindowSizeHints::none(),
            floating: false,
        }];
        let mut event = build_send_event(
            &owner,
            &generation,
            &correlation,
            0,
            1,
            source,
            target.clone(),
            &source_rows,
            &target_rows,
            "w1",
            8,
        )
        .expect("event");
        stamp_send_target(&mut event, &target.1);
        match &event.command {
            CoreCommand::SendToWorkspace {
                window,
                target_output,
                target_workspace,
            } => {
                assert_eq!(window, "w1");
                assert_eq!(target_output, "mon-a");
                assert_eq!(target_workspace, "ws-2");
            }
            _ => panic!("expected send-to-workspace"),
        }
        assert_eq!(event.focused_window.0, "w1");
        assert_eq!(event.windows.len(), 1);
        assert_eq!(event.target_windows.len(), 1);
        assert!(event.target_domain.is_some());
    }

    #[test]
    fn membership_transfer_rejects_noop_and_foreign() {
        let mover = key(7);
        let other = key(8);
        let source: BTreeSet<WindowKey> = [other.clone()].into_iter().collect();
        let target: BTreeSet<WindowKey> = [mover.clone(), other.clone()].into_iter().collect();
        assert!(verify_membership_transfer(&mover, &source, &target));
        let source: BTreeSet<WindowKey> = [mover.clone()].into_iter().collect();
        assert!(!verify_membership_transfer(&mover, &source, &target));
        assert!(!verify_membership_transfer(
            &mover,
            &BTreeSet::new(),
            &BTreeSet::new()
        ));
    }

    #[test]
    fn send_route_splits_engine_from_native_boundary() {
        use super::{SendRoute, send_route};
        // Tiled-to-tiled keeps the shared two-domain Engine plan.
        assert_eq!(send_route(true, true), SendRoute::Engine);
        // Any floating boundary transfers native membership instead: no
        // two-domain plan, no floating-side geometry, tiled side reflows.
        assert_eq!(send_route(false, true), SendRoute::Native);
        assert_eq!(send_route(true, false), SendRoute::Native);
        assert_eq!(send_route(false, false), SendRoute::Native);
    }

    #[test]
    fn directional_refuses_both_focus_and_move_on_floating() {
        // KDE plan-adapter parity: a floating workspace runs no tile layout,
        // so directional focus refuses exactly like directional move, with
        // the matching workspace-floating vocabulary. Tiled workspaces pass.
        use super::directional_workspace_refusal;
        use crate::snapkey::SnapOp;
        assert_eq!(
            directional_workspace_refusal(SnapOp::Focus, false),
            Some("focus-refused-workspace-floating")
        );
        assert_eq!(
            directional_workspace_refusal(SnapOp::Move, false),
            Some("move-refused-workspace-floating")
        );
        assert_eq!(directional_workspace_refusal(SnapOp::Focus, true), None);
        assert_eq!(directional_workspace_refusal(SnapOp::Move, true), None);
    }

    #[test]
    fn float_carry_survives_a_fresh_engine_session() {
        // After a workspace-mode release the Engine session carries no
        // exception, and a boundary-send target session has never seen the
        // mover: the lifetime-keyed intent still rides the token floating,
        // while tiled members and recycled lifetimes stay out.
        use super::float_carry_tokens;
        use std::collections::{BTreeMap, BTreeSet};
        let floated = key(11);
        let tiled = key(12);
        let members: BTreeSet<WindowKey> = [floated.clone(), tiled.clone()].into_iter().collect();
        let mut token_of: BTreeMap<WindowKey, String> = BTreeMap::new();
        token_of.insert(floated.clone(), "w-float".to_owned());
        token_of.insert(tiled.clone(), "w-tiled".to_owned());
        let intent: BTreeSet<WindowKey> = [floated.clone()].into_iter().collect();
        // Empty Engine set (fresh after release): intent still carries.
        let carried = float_carry_tokens(&members, &token_of, &intent);
        assert_eq!(carried, ["w-float".to_owned()].into_iter().collect());
        // A recycled HWND (same number, fresh lifetime) never inherits.
        let recycled = WindowKey {
            hwnd: 11,
            pid: 9000,
            creation: "c000000000009000".to_owned(),
        };
        let members: BTreeSet<WindowKey> = [recycled.clone(), tiled.clone()].into_iter().collect();
        let mut token_of: BTreeMap<WindowKey, String> = BTreeMap::new();
        token_of.insert(recycled, "w-new".to_owned());
        token_of.insert(tiled, "w-tiled".to_owned());
        assert!(float_carry_tokens(&members, &token_of, &intent).is_empty());
        // Actual Engine sequence: per-window float, release the exact domain,
        // then a fresh reconcile carrying the intent. The floated window stays
        // a slotless exception with no geometry target; the sibling reflows.
        use tiler_core::boundary::{CoreCommand, CoreReply};
        use tiler_core::directional::WindowId;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let domain = workspace_domain("mon-a", "ws-1", bounds, 8);
        seed_two_tiled(&mut engine, &owner, &generation, &domain, bounds);
        let float = engine.handle(&float_event(
            &owner,
            &generation,
            "float-carry-1",
            revision_of(&engine, &domain),
            &domain,
            &[
                (WindowId("w1".to_owned()), bounds, false),
                (WindowId("w2".to_owned()), bounds, false),
            ],
            "w1",
            "w1",
            None,
        ));
        let CoreReply::Tiled(float_plan) = float else {
            panic!("float commits, got {float:?}");
        };
        assert!(
            !float_plan.geometry.iter().any(|g| g.window.0 == "w1"),
            "floated window leaves the tree"
        );
        assert!(
            engine
                .session(&domain.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
            "floated window rides as an exception"
        );
        let mut release = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &CorrelationId::parse("float-carry-release").expect("correlation"),
            revision_of(&engine, &domain),
            2,
            &domain.0,
            &domain.1,
            8,
            &[
                (
                    WindowId("w1".to_owned()),
                    bounds,
                    tiler_core::size_hints::WindowSizeHints::none(),
                ),
                (
                    WindowId("w2".to_owned()),
                    bounds,
                    tiler_core::size_hints::WindowSizeHints::none(),
                ),
            ],
            Some(&WindowId("w2".to_owned())),
        );
        release.command = CoreCommand::ReleaseDomain;
        match engine.handle(&release) {
            CoreReply::Released => {}
            other => panic!("release drops the exact domain, got {other:?}"),
        }
        assert!(!engine.contains(&domain.1));
        // The intent outlives the released session: the fresh observation
        // still carries the floated token while the tiled sibling stays out.
        let carry_keys: BTreeSet<WindowKey> = [key(11), key(12)].into_iter().collect();
        let carry_tokens: BTreeMap<WindowKey, String> =
            [(key(11), "w1".to_owned()), (key(12), "w2".to_owned())]
                .into_iter()
                .collect();
        let carry_intent: BTreeSet<WindowKey> = [key(11)].into_iter().collect();
        let carried = float_carry_tokens(&carry_keys, &carry_tokens, &carry_intent);
        assert_eq!(carried, ["w1".to_owned()].into_iter().collect());
        let carried_rows: Vec<(
            WindowId,
            Rect,
            tiler_core::size_hints::WindowSizeHints,
            bool,
        )> = ["w1", "w2"]
            .iter()
            .map(|token| {
                (
                    WindowId((*token).to_owned()),
                    bounds,
                    tiler_core::size_hints::WindowSizeHints::none(),
                    carried.contains(*token),
                )
            })
            .collect();
        let fp = crate::tiling::fingerprint(
            &carried_rows
                .iter()
                .map(|(token, rect, _, _)| (token.0.clone(), *rect))
                .collect::<Vec<_>>(),
        );
        let fresh = crate::tiling::build_reconcile_event_for_floating(
            &owner,
            &generation,
            &CorrelationId::parse("float-carry-fresh").expect("correlation"),
            0,
            fp,
            &domain.0,
            &domain.1,
            8,
            &carried_rows,
            Some(&WindowId("w2".to_owned())),
        );
        match engine.handle(&fresh) {
            CoreReply::Tiled(plan) => {
                assert!(
                    !plan.geometry.iter().any(|g| g.window.0 == "w1"),
                    "carried float takes no geometry target"
                );
                assert!(
                    plan.geometry.iter().any(|g| g.window.0 == "w2"),
                    "sibling reflows around the exception"
                );
            }
            CoreReply::Projection(plan) => {
                assert!(
                    !plan.geometry.iter().any(|g| g.window.0 == "w1"),
                    "carried float takes no geometry target"
                );
                assert!(
                    plan.geometry.iter().any(|g| g.window.0 == "w2"),
                    "sibling reflows around the exception"
                );
            }
            CoreReply::SendWorkspace(plan) => {
                assert!(
                    !plan.geometry.iter().any(|g| g.window.0 == "w1"),
                    "carried float takes no geometry target"
                );
                assert!(
                    plan.geometry.iter().any(|g| g.window.0 == "w2"),
                    "sibling reflows around the exception"
                );
            }
            other => panic!("fresh reconcile converges, got {other:?}"),
        }
        assert!(
            engine
                .session(&domain.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
            "exception survives the release through the carried intent"
        );
    }

    #[test]
    fn native_boundary_source_reconcile_drops_mover_and_reflows_survivor() {
        // Native-boundary sends transfer membership with no Engine plan and no
        // floating-side geometry: the runtime source phase is a complete
        // reconcile carrying only the survivors. The shared Engine must drop
        // the mover and reflow the survivor, never retain the stale member.
        use tiler_core::boundary::CoreReply;
        use tiler_core::directional::WindowId;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        seed_two_tiled(&mut engine, &owner, &generation, &source, bounds);
        // Native transfer of w1 out: no send plan, source membership is now
        // exactly the survivor.
        let correlation = CorrelationId::parse("native-source-1").expect("correlation");
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            revision_of(&engine, &source),
            1,
            &source.0,
            &source.1,
            8,
            &[(
                WindowId("w2".to_owned()),
                bounds,
                tiler_core::size_hints::WindowSizeHints::none(),
            )],
            Some(&WindowId("w2".to_owned())),
        );
        match engine.handle(&event) {
            CoreReply::Tiled(plan) => {
                assert!(
                    !plan.geometry.iter().any(|g| g.window.0 == "w1"),
                    "dropped mover takes no source geometry"
                );
                let survivor = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w2")
                    .expect("survivor reflows");
                assert_eq!(survivor.workspace.0, "ws-1");
                assert!(
                    survivor.rect.w > 0 && survivor.rect.h > 0,
                    "survivor reflows, got {:?}",
                    survivor.rect
                );
            }
            CoreReply::Projection(plan) => {
                assert!(
                    !plan.geometry.iter().any(|g| g.window.0 == "w1"),
                    "dropped mover takes no source geometry"
                );
                let survivor = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w2")
                    .expect("survivor reflows");
                assert_eq!(survivor.workspace.0, "ws-1");
                assert!(
                    survivor.rect.w > 0 && survivor.rect.h > 0,
                    "survivor reflows, got {:?}",
                    survivor.rect
                );
            }
            CoreReply::SendWorkspace(plan) => {
                assert!(
                    !plan.geometry.iter().any(|g| g.window.0 == "w1"),
                    "dropped mover takes no source geometry"
                );
                assert!(
                    plan.geometry.iter().any(|g| g.window.0 == "w2"),
                    "survivor reflows"
                );
            }
            other => panic!("source survivor converges, got {other:?}"),
        }
    }

    #[test]
    fn dispatch_gate_covers_off_suspended_unmanaged() {
        use super::dispatch_decision;
        assert_eq!(
            dispatch_decision(false, false, false, false),
            Some("takeover-off")
        );
        assert_eq!(
            dispatch_decision(true, true, false, false),
            Some("suspended")
        );
        assert_eq!(
            dispatch_decision(true, false, true, false),
            Some("unmanaged")
        );
        // Select serves empty workspaces and unmanaged foreground.
        assert_eq!(dispatch_decision(true, false, false, false), None);
        // Send with a managed focus dispatches.
        assert_eq!(dispatch_decision(true, false, true, true), None);
    }

    #[test]
    fn domain_rows_union_visible_retained_hidden() {
        use super::{MemberView, domain_rows, member_matches};
        let a = key(1);
        let b = key(2);
        let c = key(3);
        let members: BTreeSet<WindowKey> = [a.clone(), b.clone(), c.clone()].into_iter().collect();
        // Visible, retained-minimized (last-known frame), hidden snapshot.
        let views = vec![
            MemberView {
                key: a.clone(),
                token: "w1".to_owned(),
                rect: rect(0, 0),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating: false,
            },
            MemberView {
                key: b.clone(),
                token: "w2".to_owned(),
                rect: rect(100, 100),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating: false,
            },
            MemberView {
                key: c.clone(),
                token: "w3".to_owned(),
                rect: rect(200, 200),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating: false,
            },
        ];
        let rows = domain_rows(&members, &views).expect("complete rows");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].token, "w1");
        // A member without any view defers instead of a falsely complete
        // observation: the caller retains Engine state with no layout loss.
        assert_eq!(domain_rows(&members, &views[..2]), None);
        // Recycled HWND (same hwnd, fresh creation) never matches.
        assert!(member_matches(&a, 1, 1001, "c0000000000000001"));
        assert!(!member_matches(&a, 1, 1001, "c0000000000000002"));
        assert!(!member_matches(&a, 1, 9999, "c0000000000000001"));
        assert!(!member_matches(&a, 9, 1001, "c0000000000000001"));
    }

    #[test]
    fn domain_rows_and_send_carry_born_floating_only() {
        // Slotless born holds ride the Engine as floating exceptions while
        // the tiled member stays tiled; the flag is an Engine observation,
        // never a native write, and send carries it into both domains.
        use super::{MemberView, build_send_event, domain_rows};
        let born = key(11);
        let tiled = key(12);
        let members: BTreeSet<WindowKey> = [born.clone(), tiled.clone()].into_iter().collect();
        let views = vec![
            MemberView {
                key: born.clone(),
                token: "w-born".to_owned(),
                rect: rect(0, 0),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating: true,
            },
            MemberView {
                key: tiled.clone(),
                token: "w-tiled".to_owned(),
                rect: rect(100, 100),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating: false,
            },
        ];
        let rows = domain_rows(&members, &views).expect("complete rows");
        assert!(
            rows.iter()
                .find(|r| r.token == "w-born")
                .expect("born")
                .floating
        );
        assert!(
            !rows
                .iter()
                .find(|r| r.token == "w-tiled")
                .expect("tiled")
                .floating
        );
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        let event = build_send_event(
            &owner,
            &generation,
            &correlation,
            0,
            3,
            source,
            target,
            &rows,
            &[],
            "w-tiled",
            8,
        )
        .expect("event");
        assert!(
            event
                .windows
                .iter()
                .find(|w| w.window.0 == "w-born")
                .expect("born")
                .floating
        );
        assert!(
            !event
                .windows
                .iter()
                .find(|w| w.window.0 == "w-tiled")
                .expect("tiled")
                .floating
        );
    }

    #[test]
    fn reused_hwnd_repair_drops_only_unclaimed_stale() {
        use super::reused_hwnd_stale;
        use std::collections::BTreeSet;
        let stale = key(1);
        // Same HWND, fresh process: new key plus an unrelated member.
        let fresh = WindowKey {
            hwnd: 1,
            pid: 9000,
            creation: "c000000000009000".to_owned(),
        };
        let other = key(2);
        let known = vec![stale.clone(), fresh.clone(), other.clone()];
        // No claims: exactly the stale key drops.
        assert_eq!(
            reused_hwnd_stale(&known, &BTreeSet::new(), &fresh),
            vec![stale.clone()]
        );
        // A live hidden claim for the stale key owns its HWND through the
        // ledger/audit path: never dropped here.
        let claimed: BTreeSet<WindowKey> = [stale.clone()].into_iter().collect();
        assert!(reused_hwnd_stale(&known, &claimed, &fresh).is_empty());
        // An unknown HWND repairs nothing.
        let unknown = WindowKey {
            hwnd: 99,
            pid: 9000,
            creation: "c000000000009000".to_owned(),
        };
        assert!(reused_hwnd_stale(&known, &BTreeSet::new(), &unknown).is_empty());
    }

    #[test]
    fn visible_lifetime_needs_exact_stored_tag() {
        use super::visible_lifetime_ok;
        // Exact match is the only pass: same-process reuse starts without the
        // property (absent) or with the previous generation's tag.
        assert!(visible_lifetime_ok("abc123", Some("abc123")));
        assert!(!visible_lifetime_ok("abc123", Some("abc124")));
        assert!(!visible_lifetime_ok("abc123", None));
        // An untracked window (no stored tag) is never trusted, only stamped.
        assert!(!visible_lifetime_ok("", Some("abc123")));
        assert!(!visible_lifetime_ok("", None));
    }

    #[test]
    fn same_process_reuse_invisible_to_key_guards_but_not_to_tag() {
        use super::{member_matches, reused_hwnd_stale, visible_lifetime_ok};
        use std::collections::BTreeSet;
        // Destroy plus same-process recreate: HWND, PID, and creation all
        // still agree, so every (hwnd, pid, creation) guard passes and the
        // cross-process repair sees no stale key. Only the visible lifetime
        // tag distinguishes the new generation.
        let previous = key(1);
        assert!(member_matches(&previous, 1, 1001, "c0000000000000001"));
        let known = vec![previous.clone()];
        assert!(reused_hwnd_stale(&known, &BTreeSet::new(), &previous).is_empty());
        // Previous generation's tag stored; the fresh window carries none, so
        // no write, hide, focus, or Engine row is authorized for it.
        assert!(!visible_lifetime_ok("9f2c41aa07bd33e0", None));
        assert!(!visible_lifetime_ok(
            "9f2c41aa07bd33e0",
            Some("9f2c41aa07bd33e1")
        ));
        assert!(visible_lifetime_ok(
            "9f2c41aa07bd33e0",
            Some("9f2c41aa07bd33e0")
        ));
    }

    #[test]
    fn unified_domain_reuses_session_across_ticks() {
        // Same member, same domain, two ticks: one retained session, no
        // reseed, revision advances monotonically.
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let (domain, key) = workspace_domain("mon-a", "ws-1", bounds, 8);
        for tick in 1..=2u64 {
            let correlation = CorrelationId::parse(&format!("tick-{tick}")).expect("correlation");
            let revision = engine
                .session(&key)
                .map(|s| s.accepted_revision())
                .unwrap_or(0);
            let event = crate::tiling::build_reconcile_event_for(
                &owner,
                &generation,
                &correlation,
                revision,
                tick,
                &domain,
                &key,
                8,
                &[(
                    tiler_core::directional::WindowId("w1".to_owned()),
                    bounds,
                    tiler_core::size_hints::WindowSizeHints::none(),
                )],
                None,
            );
            let _ = engine.handle(&event);
        }
        assert_eq!(engine.len(), 1);
    }

    #[test]
    fn engine_topology_reuses_both_domains() {
        // Both source and target rows (including hidden snapshots) reach the
        // Engine; the planned mutation is topology reuse, never remove/reseed.
        use tiler_core::boundary::CoreReply;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        // Real converge first: source holds two windows, target holds none.
        for (key, rows) in [
            (&source.1, vec![("w1", bounds), ("w2", bounds)]),
            (&target.1, vec![]),
        ] {
            let domain = if key.workspace.0 == "ws-1" {
                &source.0
            } else {
                &target.0
            };
            let correlation = CorrelationId::parse("seed").expect("correlation");
            let event = crate::tiling::build_reconcile_event_for(
                &owner,
                &generation,
                &correlation,
                0,
                rows.len() as u64,
                domain,
                key,
                8,
                &rows
                    .iter()
                    .map(|(t, r)| {
                        (
                            tiler_core::directional::WindowId((*t).to_owned()),
                            *r,
                            tiler_core::size_hints::WindowSizeHints::none(),
                        )
                    })
                    .collect::<Vec<_>>(),
                None,
            );
            let _ = engine.handle(&event);
        }
        let revision = engine
            .session(&source.1)
            .map(|s| s.accepted_revision())
            .unwrap_or(0);
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let mut event = build_send_event(
            &owner,
            &generation,
            &correlation,
            revision,
            42,
            source.clone(),
            target.clone(),
            &[
                OwnerRow {
                    token: "w1".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
                    floating: false,
                },
                OwnerRow {
                    token: "w2".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
                    floating: false,
                },
            ],
            &[],
            "w1",
            8,
        )
        .expect("event");
        stamp_send_target(&mut event, &target.1);
        // Typed success: the Engine moved the tile with desired geometry,
        // and both domain sessions exist after the send.
        let reply = engine.handle(&event);
        let CoreReply::SendWorkspace(plan) = reply else {
            panic!("expected SendWorkspace, got {reply:?}");
        };
        assert!(!plan.geometry.is_empty(), "send carries geometry");
        assert!(
            matches!(
                plan.operation,
                tiler_core::contract::LifecycleOperation::MoveTiled { .. }
            ),
            "send is a tiled move, got {:?}",
            plan.operation
        );
        assert!(engine.session(&source.1).is_some(), "source retained");
        assert!(engine.session(&target.1).is_some(), "target retained");
        // Retained-tree roundtrip with a window left behind: the source still
        // converges its remaining window and the target converges the mover.
        for (key, domain, rows) in [
            (&source.1, &event.domain, vec![("w2", bounds)]),
            (
                &target.1,
                event
                    .target_domain
                    .as_ref()
                    .map(|(d, _)| d)
                    .expect("target"),
                vec![("w1", bounds)],
            ),
        ] {
            let correlation = CorrelationId::parse("roundtrip").expect("correlation");
            let event = crate::tiling::build_reconcile_event_for(
                &owner,
                &generation,
                &correlation,
                engine
                    .session(key)
                    .map(|s| s.accepted_revision())
                    .unwrap_or(0),
                rows.len() as u64,
                domain,
                key,
                engine.outer_gap(key).unwrap_or(8),
                &rows
                    .iter()
                    .map(|(t, r)| {
                        (
                            tiler_core::directional::WindowId((*t).to_owned()),
                            *r,
                            tiler_core::size_hints::WindowSizeHints::none(),
                        )
                    })
                    .collect::<Vec<_>>(),
                None,
            );
            let reply = engine.handle(&event);
            assert!(
                matches!(
                    reply,
                    CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
                ),
                "roundtrip converges, got {reply:?}"
            );
        }
    }

    #[test]
    fn send_to_empty_then_product_reconcile_with_fixed_gap() {
        // Send to an empty workspace, then reconcile both sides with the
        // same carried outer gap: the destination must place the mover and
        // the source must reflow its survivor, never `domain-mismatch`.
        use tiler_core::boundary::CoreReply;
        use tiler_core::geometry::Rect;
        fn contains(bounds: Rect, r: Rect) -> bool {
            r.w > 0
                && r.h > 0
                && r.x >= bounds.x
                && r.y >= bounds.y
                && r.x + r.w <= bounds.x + bounds.w
                && r.y + r.h <= bounds.y + bounds.h
        }
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        for (key, rows) in [
            (&source.1, vec![("w1", bounds), ("w2", bounds)]),
            (&target.1, vec![]),
        ] {
            let domain = if key.workspace.0 == "ws-1" {
                &source.0
            } else {
                &target.0
            };
            let correlation = CorrelationId::parse("seed").expect("correlation");
            let event = crate::tiling::build_reconcile_event_for(
                &owner,
                &generation,
                &correlation,
                0,
                rows.len() as u64,
                domain,
                key,
                8,
                &rows
                    .iter()
                    .map(|(t, r)| {
                        (
                            tiler_core::directional::WindowId((*t).to_owned()),
                            *r,
                            tiler_core::size_hints::WindowSizeHints::none(),
                        )
                    })
                    .collect::<Vec<_>>(),
                None,
            );
            let _ = engine.handle(&event);
        }
        let revision = engine
            .session(&source.1)
            .map(|s| s.accepted_revision())
            .unwrap_or(0);
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let mut event = build_send_event(
            &owner,
            &generation,
            &correlation,
            revision,
            42,
            source.clone(),
            target.clone(),
            &[
                OwnerRow {
                    token: "w1".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
                    floating: false,
                },
                OwnerRow {
                    token: "w2".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
                    floating: false,
                },
            ],
            &[],
            "w1",
            8,
        )
        .expect("event");
        stamp_send_target(&mut event, &target.1);
        let reply = engine.handle(&event);
        let CoreReply::SendWorkspace(plan) = reply else {
            panic!("send commits, got {reply:?}");
        };
        assert!(
            matches!(
                plan.operation,
                tiler_core::contract::LifecycleOperation::MoveTiled { .. }
            ),
            "send is a tiled move, got {:?}",
            plan.operation
        );
        let mover = plan
            .geometry
            .iter()
            .find(|g| g.window.0 == "w1")
            .expect("send places mover");
        assert_eq!(mover.workspace.0, "ws-2");
        assert!(contains(bounds, mover.rect), "mover inside target");
        assert_eq!(
            engine.outer_gap(&target.1),
            Some(8),
            "new destination inherits carried gap"
        );
        // Destination follow-up with the same carried gap places the mover.
        let correlation = CorrelationId::parse("tick-2").expect("correlation");
        let (target_domain, target_key) = target.clone();
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&target_key)
                .map(|s| s.accepted_revision())
                .unwrap_or(0),
            1,
            &target_domain,
            &target_key,
            8,
            &[(
                tiler_core::directional::WindowId("w1".to_owned()),
                bounds,
                tiler_core::size_hints::WindowSizeHints::none(),
            )],
            None,
        );
        match engine.handle(&event) {
            CoreReply::Tiled(plan) => {
                let placed = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w1")
                    .expect("destination places mover");
                assert_eq!(placed.workspace.0, "ws-2");
                assert!(contains(bounds, placed.rect), "mover inside target");
            }
            CoreReply::Projection(plan) => {
                let placed = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w1")
                    .expect("destination places mover");
                assert_eq!(placed.workspace.0, "ws-2");
                assert!(contains(bounds, placed.rect), "mover inside target");
            }
            CoreReply::SendWorkspace(plan) => {
                let placed = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w1")
                    .expect("destination places mover");
                assert_eq!(placed.workspace.0, "ws-2");
                assert!(contains(bounds, placed.rect), "mover inside target");
            }
            reply => panic!("destination converges, got {reply:?}"),
        }
        // Source survivor reflows with the same carried gap.
        let correlation = CorrelationId::parse("tick-3").expect("correlation");
        let (source_domain, source_key) = source.clone();
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&source_key)
                .map(|s| s.accepted_revision())
                .unwrap_or(0),
            1,
            &source_domain,
            &source_key,
            8,
            &[(
                tiler_core::directional::WindowId("w2".to_owned()),
                bounds,
                tiler_core::size_hints::WindowSizeHints::none(),
            )],
            None,
        );
        match engine.handle(&event) {
            CoreReply::Tiled(plan) => {
                let survivor = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w2")
                    .expect("source reflows survivor");
                assert_eq!(survivor.workspace.0, "ws-1");
                assert!(contains(bounds, survivor.rect), "survivor inside source");
            }
            CoreReply::Projection(plan) => {
                let survivor = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w2")
                    .expect("source reflows survivor");
                assert_eq!(survivor.workspace.0, "ws-1");
                assert!(contains(bounds, survivor.rect), "survivor inside source");
            }
            CoreReply::SendWorkspace(plan) => {
                let survivor = plan
                    .geometry
                    .iter()
                    .find(|g| g.window.0 == "w2")
                    .expect("source reflows survivor");
                assert_eq!(survivor.workspace.0, "ws-1");
                assert!(contains(bounds, survivor.rect), "survivor inside source");
            }
            reply => panic!("source converges, got {reply:?}"),
        }
    }

    #[test]
    fn send_plan_scopes_source_reflow_through_writable_subset() {
        // Both-domain send regression through the actual native seams: one
        // Engine `SendWorkspace` plan carries source survivor reflow plus
        // target mover placement together (`planned_writes`, the extraction
        // the native write path consumes), and the domain writable set
        // (`writable_subset`, which the native `writable_tokens` delegates to)
        // scopes the pre-hide source pass to the survivor only.
        use tiler_core::boundary::CoreReply;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        for (key, rows) in [
            (&source.1, vec![("w1", bounds), ("w2", bounds)]),
            (&target.1, vec![]),
        ] {
            let domain = if key.workspace.0 == "ws-1" {
                &source.0
            } else {
                &target.0
            };
            let correlation = CorrelationId::parse("seed").expect("correlation");
            let event = crate::tiling::build_reconcile_event_for(
                &owner,
                &generation,
                &correlation,
                0,
                rows.len() as u64,
                domain,
                key,
                8,
                &rows
                    .iter()
                    .map(|(t, r)| {
                        (
                            tiler_core::directional::WindowId((*t).to_owned()),
                            *r,
                            tiler_core::size_hints::WindowSizeHints::none(),
                        )
                    })
                    .collect::<Vec<_>>(),
                None,
            );
            let _ = engine.handle(&event);
        }
        let revision = engine
            .session(&source.1)
            .map(|s| s.accepted_revision())
            .unwrap_or(0);
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let mut event = build_send_event(
            &owner,
            &generation,
            &correlation,
            revision,
            42,
            source.clone(),
            target.clone(),
            &[
                OwnerRow {
                    token: "w1".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
                    floating: false,
                },
                OwnerRow {
                    token: "w2".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
                    floating: false,
                },
            ],
            &[],
            "w1",
            8,
        )
        .expect("event");
        stamp_send_target(&mut event, &target.1);
        let reply = engine.handle(&event);
        let CoreReply::SendWorkspace(plan) = &reply else {
            panic!("send commits");
        };
        // Native extraction seam: the single plan covers both domains.
        let writes = super::planned_writes(&reply).expect("plan extracts");
        assert_eq!(writes.len(), plan.geometry.len(), "nothing dropped");
        assert!(writes.iter().any(|w| w.window.0 == "w1"), "mover placed");
        assert!(
            writes.iter().any(|w| w.window.0 == "w2"),
            "survivor reflowed"
        );
        // Domain eligibility seam: after the membership transfer the source
        // domain holds only the survivor, so the pre-hide source pass writes
        // exactly the survivor while the moved token is no longer writable
        // there. Hidden members never take writes.
        let mover = key(1);
        let survivor = key(2);
        let hidden = key(3);
        let members: BTreeSet<WindowKey> = [mover.clone(), survivor.clone(), hidden.clone()]
            .into_iter()
            .collect();
        let token_of: std::collections::BTreeMap<WindowKey, String> = [
            (mover.clone(), "w1".to_owned()),
            (survivor.clone(), "w2".to_owned()),
            (hidden.clone(), "w3".to_owned()),
        ]
        .into_iter()
        .collect();
        let hidden_set: BTreeSet<WindowKey> = [hidden.clone()].into_iter().collect();
        // Fresh observation holds survivor plus mover (still visible pre-hide
        // in this portable model); the source pass scopes by membership, so
        // model the post-transfer source membership explicitly.
        let source_members: BTreeSet<WindowKey> =
            [survivor.clone(), hidden.clone()].into_iter().collect();
        let fresh: std::collections::HashSet<String> =
            ["w1".to_owned(), "w2".to_owned()].into_iter().collect();
        let writable = super::writable_subset(
            &source_members,
            |k| hidden_set.contains(k),
            &token_of,
            &fresh,
        );
        assert!(writable.contains("w2"), "survivor stays writable");
        assert!(
            !writable.contains("w1"),
            "moved token not writable in source"
        );
        assert!(!writable.contains("w3"), "hidden rows never writable");
        let _ = members;
        // Non-plan replies extract to `None` so callers serialize null with
        // reason instead of zeros.
        let released = tiler_core::boundary::CoreReply::Released;
        assert!(super::planned_writes(&released).is_none());
    }

    #[test]
    fn non_plan_replies_extract_to_none() {
        use tiler_core::boundary::{CoreReply, NoGroupReason};
        use tiler_core::contract::DivergenceKind;
        for reply in [
            CoreReply::Released,
            CoreReply::Rejected {
                kind: "empty",
                message: "empty domain",
            },
            CoreReply::Diverged(DivergenceKind::StaleRevision),
            CoreReply::SnapshotInvalid {
                message: "stale",
                detail: "stale snapshot",
            },
            CoreReply::NoGroup {
                base_revision: None,
                reason: NoGroupReason::NoSession,
            },
        ] {
            assert!(super::planned_writes(&reply).is_none(), "{reply:?}");
        }
    }

    #[test]
    fn focus_before_geometry_gate_blocks_real_fullscreen_and_elevated() {
        use super::focus_before_geometry;
        // Verified transition with a clean foreground focuses before geometry.
        assert!(focus_before_geometry(true, false, false));
        // A real fullscreen or elevated arrival must never be stolen from.
        assert!(!focus_before_geometry(true, true, false));
        assert!(!focus_before_geometry(true, false, true));
        assert!(!focus_before_geometry(true, true, true));
        // An unverified transition never focuses first, even when clean.
        assert!(!focus_before_geometry(false, false, false));
    }

    #[test]
    fn writable_subset_never_includes_hidden_or_stale() {
        use super::writable_subset;
        use std::collections::BTreeMap;
        use std::collections::BTreeSet;
        let a = key(1);
        let b = key(2);
        let c = key(3);
        let members: BTreeSet<WindowKey> = [a.clone(), b.clone(), c.clone()].into_iter().collect();
        let token_of: BTreeMap<WindowKey, String> = [
            (a.clone(), "w1".to_owned()),
            (b.clone(), "w2".to_owned()),
            (c.clone(), "w3".to_owned()),
        ]
        .into_iter()
        .collect();
        // b is hidden; c has no fresh frame (retained without observation).
        let hidden: BTreeSet<WindowKey> = [b.clone()].into_iter().collect();
        let fresh: std::collections::HashSet<String> =
            ["w1".to_owned(), "w2".to_owned()].into_iter().collect();
        let writable = writable_subset(&members, |k| hidden.contains(k), &token_of, &fresh);
        assert!(
            writable.contains("w1"),
            "visible fresh member stays writable"
        );
        assert!(!writable.contains("w2"), "hidden rows never writable");
        assert!(!writable.contains("w3"), "retained rows never writable");
    }

    #[test]
    fn foreground_classifier_keeps_gates_but_fixes_desktop_and_hidden() {
        use super::{ForegroundFacts, ForegroundVetoReason, classify_foreground};
        let facts = |valid: bool,
                     is_desktop: bool,
                     visible: bool,
                     captioned: bool,
                     dwm_readable: bool,
                     cloak_readable: bool,
                     cloaked: bool,
                     covers_monitor: bool| {
            classify_foreground(ForegroundFacts {
                valid,
                is_desktop,
                visible,
                captioned,
                dwm_readable,
                cloak_readable,
                cloaked,
                covers_monitor,
            })
        };
        // Visible real fullscreen still vetoes.
        let v = facts(true, false, true, false, true, true, false, true);
        assert!(v.block && v.reason == ForegroundVetoReason::Fullscreen);
        // Visible unreadable foreground stays blocked (fail closed).
        let v = facts(true, false, true, false, false, true, false, false);
        assert!(v.block && v.reason == ForegroundVetoReason::Unreadable);
        // Unreadable cloak state stays blocked (fail closed): an unknown
        // cloak never clears a covering frame.
        let v = facts(true, false, true, false, true, false, false, true);
        assert!(v.block && v.reason == ForegroundVetoReason::Unreadable);
        // Cloaked captionless monitor cover never vetoes: invisible to the
        // compositor, so it cannot be a covering fullscreen.
        let v = facts(true, false, true, false, true, true, true, true);
        assert!(!v.block && v.reason == ForegroundVetoReason::Cloaked);
        // Cloaked small frame never vetoes either.
        let v = facts(true, false, true, false, true, true, true, false);
        assert!(!v.block && v.reason == ForegroundVetoReason::Cloaked);
        // Invalid handle fails closed.
        let v = facts(false, false, false, false, false, false, false, false);
        assert!(v.block && v.reason == ForegroundVetoReason::Invalid);
        // Exact desktop shell handle never vetoes, even when covering.
        let v = facts(true, true, true, false, true, true, false, true);
        assert!(!v.block && v.reason == ForegroundVetoReason::Desktop);
        // Valid non-visible foreground never vetoes: invisible cannot cover.
        let v = facts(true, false, false, false, true, true, false, true);
        assert!(!v.block && v.reason == ForegroundVetoReason::Nonvisible);
        // Captioned foreground never vetoes.
        let v = facts(true, false, true, true, true, true, false, false);
        assert!(!v.block && v.reason == ForegroundVetoReason::Captioned);
        // Small visible borderless window never vetoes.
        let v = facts(true, false, true, false, true, true, false, false);
        assert!(!v.block && v.reason == ForegroundVetoReason::None);
    }

    #[test]
    fn managed_overlay_reason_is_opaque_and_distinct() {
        // The managed-overlay bypass (verified member or born-held track)
        // carries its own bounded token, never the raw fullscreen one, so
        // lifecycle logs stay distinguishable. The classifier itself never
        // produces it: only the native managed check may.
        use super::ForegroundVetoReason;
        assert_eq!(
            ForegroundVetoReason::ManagedOverlay.as_str(),
            "managed-overlay"
        );
        assert_ne!(
            ForegroundVetoReason::ManagedOverlay,
            ForegroundVetoReason::Fullscreen
        );
    }

    #[test]
    fn domain_rows_propagates_hints_and_send_carries_them() {
        use super::{MemberView, build_send_event, domain_rows, stamp_send_target};
        use tiler_core::boundary::CoreReply;
        use tiler_core::size_hints::WindowSizeHints;
        let a = key(1);
        let b = key(2);
        let members: BTreeSet<WindowKey> = [a.clone(), b.clone()].into_iter().collect();
        let hinted = WindowSizeHints {
            min_w: Some(500),
            min_h: None,
            max_w: None,
            max_h: None,
        };
        let views = vec![
            MemberView {
                key: a.clone(),
                token: "w1".to_owned(),
                rect: rect(0, 0),
                hints: hinted,
                floating: false,
            },
            MemberView {
                key: b.clone(),
                token: "w2".to_owned(),
                rect: rect(100, 100),
                hints: WindowSizeHints::none(),
                floating: false,
            },
        ];
        let rows = domain_rows(&members, &views).expect("complete rows");
        assert_eq!(rows[0].hints, hinted);
        assert!(rows[1].hints.is_empty());
        // The destination domain carries its own fresh hints (a hidden
        // snapshot row included): the send path must not drop them.
        let c = key(3);
        let target_members: BTreeSet<WindowKey> = [c.clone()].into_iter().collect();
        let target_views = vec![MemberView {
            key: c.clone(),
            token: "w3".to_owned(),
            rect: rect(200, 200),
            hints: hinted,
            floating: false,
        }];
        let target_rows = domain_rows(&target_members, &target_views).expect("target rows");
        assert_eq!(target_rows[0].hints, hinted);
        // The send path carries the same rows into both Engine domains.
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        let mut engine = tiler_core::engine::Engine::new();
        engine.sync_binding(&owner, &generation);
        for (key, domain, rows) in [
            (&source.1, &source.0, vec![("w1", bounds), ("w2", bounds)]),
            (&target.1, &target.0, vec![("w3", bounds)]),
        ] {
            let seed_correlation = CorrelationId::parse("seed").expect("correlation");
            let event = crate::tiling::build_reconcile_event_for(
                &owner,
                &generation,
                &seed_correlation,
                0,
                rows.len() as u64,
                domain,
                key,
                8,
                &rows
                    .iter()
                    .map(|(t, r)| {
                        (
                            tiler_core::directional::WindowId((*t).to_owned()),
                            *r,
                            WindowSizeHints::none(),
                        )
                    })
                    .collect::<Vec<_>>(),
                None,
            );
            let _ = engine.handle(&event);
        }
        let mut event = build_send_event(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&source.1)
                .map(|s| s.accepted_revision())
                .unwrap_or(0),
            3,
            source,
            target.clone(),
            &rows,
            &target_rows,
            "w1",
            8,
        )
        .expect("event");
        stamp_send_target(&mut event, &target.1);
        assert_eq!(event.windows.len(), 2);
        assert_eq!(event.windows[0].hints, hinted);
        assert!(event.windows[1].hints.is_empty());
        assert_eq!(event.target_windows.len(), 1);
        assert_eq!(event.target_windows[0].hints, hinted);
        let CoreReply::SendWorkspace(_) = engine.handle(&event) else {
            panic!("hinted send commits through the real Engine");
        };
    }

    #[test]
    fn hint_only_change_reprojects_without_topology_change() {
        // Same rectangles and fingerprint, only a fresh minimum hint on w2:
        // the Engine still projects, and the deficit comes from w1's slack.
        use tiler_core::boundary::CoreReply;
        use tiler_core::geometry::Rect;
        use tiler_core::size_hints::WindowSizeHints;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        };
        let (domain, key) = workspace_domain("mon-a", "ws-1", bounds, 8);
        let plain = || {
            vec![
                (
                    tiler_core::directional::WindowId("w1".to_owned()),
                    bounds,
                    WindowSizeHints::none(),
                ),
                (
                    tiler_core::directional::WindowId("w2".to_owned()),
                    bounds,
                    WindowSizeHints::none(),
                ),
            ]
        };
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let seed = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            0,
            2,
            &domain,
            &key,
            8,
            &plain(),
            None,
        );
        let base = match engine.handle(&seed) {
            CoreReply::Tiled(plan) => plan.base_revision,
            CoreReply::Projection(plan) => plan.base_revision,
            reply => panic!("seed converges, got {reply:?}"),
        };
        // Hint-only second observation: identical rectangles, one fresh hint.
        let hinted = WindowSizeHints {
            min_w: Some(500),
            min_h: None,
            max_w: None,
            max_h: None,
        };
        let correlation = CorrelationId::parse("tick-2").expect("correlation");
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&key)
                .map(|s| s.accepted_revision())
                .unwrap_or(base),
            2,
            &domain,
            &key,
            8,
            &[
                (
                    tiler_core::directional::WindowId("w1".to_owned()),
                    bounds,
                    WindowSizeHints::none(),
                ),
                (
                    tiler_core::directional::WindowId("w2".to_owned()),
                    bounds,
                    hinted,
                ),
            ],
            None,
        );
        let reply = engine.handle(&event);
        let CoreReply::Projection(plan) = reply else {
            panic!("hint-only change projects, got {reply:?}");
        };
        assert!(plan.geometry.iter().all(|g| !g.overconstrained));
        let widths: std::collections::BTreeMap<&str, i32> = plan
            .geometry
            .iter()
            .map(|g| (g.window.0.as_str(), g.rect.w))
            .collect();
        // 800 extent, 8 inner gap: 792 shared; w2 keeps 500, w1 yields slack.
        assert_eq!(widths["w2"], 500);
        assert_eq!(widths["w1"], 792 - 500);
    }

    #[test]
    fn infeasible_hints_keep_proportional_and_flag_overconstrained() {
        // Minimums exceeding the extent keep the proportional allocation and
        // flag every violating window: shared projection never reasserts, and
        // the Windows native write path places writable overconstrained
        // windows at the tile origin clamped to the known minimum (KDE keeps
        // its existing skip).
        use tiler_core::boundary::CoreReply;
        use tiler_core::geometry::Rect;
        use tiler_core::size_hints::WindowSizeHints;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        };
        let (domain, key) = workspace_domain("mon-a", "ws-1", bounds, 8);
        let hinted = WindowSizeHints {
            min_w: Some(500),
            min_h: None,
            max_w: None,
            max_h: None,
        };
        let rows = vec![
            (
                tiler_core::directional::WindowId("w1".to_owned()),
                bounds,
                hinted,
            ),
            (
                tiler_core::directional::WindowId("w2".to_owned()),
                bounds,
                hinted,
            ),
        ];
        let correlation = CorrelationId::parse("tick-1").expect("correlation");
        let seed = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            0,
            2,
            &domain,
            &key,
            8,
            &rows,
            None,
        );
        let _ = engine.handle(&seed);
        let correlation = CorrelationId::parse("tick-2").expect("correlation");
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&key)
                .map(|s| s.accepted_revision())
                .unwrap_or(0),
            2,
            &domain,
            &key,
            8,
            &rows,
            None,
        );
        let reply = engine.handle(&event);
        let widths: Vec<i32>;
        let flags: Vec<bool>;
        match reply {
            CoreReply::Projection(plan) => {
                widths = plan.geometry.iter().map(|g| g.rect.w).collect();
                flags = plan.geometry.iter().map(|g| g.overconstrained).collect();
                assert_eq!(plan.geometry.len(), 2);
            }
            CoreReply::Tiled(plan) => {
                widths = plan.geometry.iter().map(|g| g.rect.w).collect();
                flags = plan.geometry.iter().map(|g| g.overconstrained).collect();
                assert_eq!(plan.geometry.len(), 2);
            }
            reply => panic!("infeasible hints still project, got {reply:?}"),
        }
        assert!(
            flags.iter().all(|f| *f),
            "both windows flag overconstrained"
        );
        // Proportional fallback: identical to the no-hint allocation.
        let correlation = CorrelationId::parse("tick-3").expect("correlation");
        let plain: Vec<(tiler_core::directional::WindowId, Rect, WindowSizeHints)> = rows
            .iter()
            .map(|(w, r, _)| (w.clone(), *r, WindowSizeHints::none()))
            .collect();
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&key)
                .map(|s| s.accepted_revision())
                .unwrap_or(0),
            2,
            &domain,
            &key,
            8,
            &plain,
            None,
        );
        let reply = engine.handle(&event);
        let plain_widths: Vec<i32> = match reply {
            CoreReply::Projection(plan) => plan.geometry.iter().map(|g| g.rect.w).collect(),
            CoreReply::Tiled(plan) => plan.geometry.iter().map(|g| g.rect.w).collect(),
            reply => panic!("plain projects, got {reply:?}"),
        };
        assert_eq!(widths, plain_widths, "infeasible keeps proportional sizes");
        // The native extraction preserves the flags the write path skips on:
        // rebuild the infeasible plan through the same builder and check the
        // seam carries every overconstrained flag.
        let correlation = CorrelationId::parse("tick-4").expect("correlation");
        let event = crate::tiling::build_reconcile_event_for(
            &owner,
            &generation,
            &correlation,
            engine
                .session(&key)
                .map(|s| s.accepted_revision())
                .unwrap_or(0),
            2,
            &domain,
            &key,
            8,
            &rows,
            None,
        );
        let reply = engine.handle(&event);
        let plan = match reply {
            CoreReply::Projection(plan) => plan,
            reply => panic!("infeasible re-projects, got {reply:?}"),
        };
        let writes = super::planned_writes(&tiler_core::boundary::CoreReply::Projection(plan))
            .expect("plan extracts");
        assert!(writes.iter().all(|w| w.overconstrained));
    }

    #[test]
    fn sticky_toggle_refusals_match_float_overlays_with_sticky_vocabulary() {
        // Fullscreen wins, then maximize; normal proceeds. Sticky uses its
        // own outcome strings so logs distinguish the arm.
        assert_eq!(
            crate::tiling::sticky_toggle_refusal(true, false),
            Some("sticky-refused-fullscreen")
        );
        assert_eq!(
            crate::tiling::sticky_toggle_refusal(false, true),
            Some("sticky-refused-maximize")
        );
        assert_eq!(
            crate::tiling::sticky_toggle_refusal(true, true),
            Some("sticky-refused-fullscreen")
        );
        assert_eq!(crate::tiling::sticky_toggle_refusal(false, false), None);
        assert_eq!(
            crate::tiling::sticky_directional_refusal(true, false),
            Some("focus-refused-sticky")
        );
        assert_eq!(
            crate::tiling::sticky_directional_refusal(true, true),
            Some("move-refused-sticky")
        );
        assert_eq!(
            crate::tiling::sticky_directional_refusal(false, false),
            None
        );
        assert_eq!(crate::tiling::sticky_directional_refusal(false, true), None);
    }

    #[test]
    fn sticky_marker_values_round_trip_and_reject_unknown() {
        // 1 = prior tiled, 2 = prior float; zero/unknown fail closed.
        assert_eq!(crate::tiling::sticky_marker_value(false), 1);
        assert_eq!(crate::tiling::sticky_marker_value(true), 2);
        assert_eq!(crate::tiling::parse_sticky_marker(1), Some(false));
        assert_eq!(crate::tiling::parse_sticky_marker(2), Some(true));
        assert_eq!(crate::tiling::parse_sticky_marker(0), None);
        assert_eq!(crate::tiling::parse_sticky_marker(3), None);
        assert_eq!(crate::tiling::parse_sticky_marker(u64::MAX), None);
    }

    #[test]
    fn sticky_float_rehome_keeps_no_duplicate_across_domains() {
        // Backing-domain removal plus current-domain admit as tiled via two
        // reconciles: the mover leaves the source set, joins the target set,
        // and no stale duplicate remains. Mirrors the native cross-domain
        // sticky-off path without native calls.
        use tiler_core::boundary::CoreReply;
        let mut engine = tiler_core::engine::Engine::new();
        let owner = OwnerId::parse("tiler-windows").expect("owner");
        let generation = GenerationId::parse("aa").expect("generation");
        engine.sync_binding(&owner, &generation);
        let bounds = rect(0, 0);
        let source = workspace_domain("mon-a", "ws-1", bounds, 8);
        let target = workspace_domain("mon-a", "ws-2", bounds, 8);
        seed_two_tiled(&mut engine, &owner, &generation, &source, bounds);
        // Float w1 in the source (sticky-on tiled half), then rehome: source
        // without w1 converges removal, target with w1 as tiled admits.
        let float = float_event(
            &owner,
            &generation,
            "float-1",
            revision_of(&engine, &source),
            &source,
            &[
                (WindowId("w1".to_owned()), bounds, false),
                (WindowId("w2".to_owned()), bounds, false),
            ],
            "w1",
            "w1",
            None,
        );
        let reply = engine.handle(&float);
        assert!(matches!(reply, CoreReply::Tiled(_)), "float commits");
        let revision = |engine: &tiler_core::engine::Engine, domain: &(OutputDomain, DomainKey)| {
            revision_of(engine, domain)
        };
        let reconcile = |engine: &mut tiler_core::engine::Engine,
                         domain: &(OutputDomain, DomainKey),
                         correlation: &str,
                         rows: &[(WindowId, Rect, bool)]| {
            let correlation = CorrelationId::parse(correlation).expect("correlation");
            let carried: Vec<(
                WindowId,
                Rect,
                tiler_core::size_hints::WindowSizeHints,
                bool,
            )> = rows
                .iter()
                .map(|(token, rect, floating)| {
                    (
                        token.clone(),
                        *rect,
                        tiler_core::size_hints::WindowSizeHints::none(),
                        *floating,
                    )
                })
                .collect();
            let fp = crate::tiling::fingerprint(
                &rows
                    .iter()
                    .map(|(token, rect, _)| (token.0.clone(), *rect))
                    .collect::<Vec<_>>(),
            );
            let event = crate::tiling::build_reconcile_event_for_floating(
                &owner,
                &generation,
                &correlation,
                revision(engine, domain),
                fp,
                &domain.0,
                &domain.1,
                8,
                &carried,
                None,
            );
            engine.handle(&event)
        };
        // Source without the floated window: exception drops, sibling keeps
        // the tile area with no duplication.
        let reply = reconcile(
            &mut engine,
            &source,
            "prune-old",
            &[(WindowId("w2".to_owned()), bounds, false)],
        );
        assert!(
            matches!(
                reply,
                CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
            ),
            "old removal converges, got {reply:?}"
        );
        assert!(
            !engine
                .session(&source.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
            "old exception gone"
        );
        // Current admits w1 as tiled: same topology as a fresh admission,
        // no stale retained duplicate in the source. The target plan carries
        // w1 as a tile (not an exception), so the first Win+G after the move
        // tiles rather than re-floating.
        let reply = reconcile(
            &mut engine,
            &target,
            "admit-current",
            &[(WindowId("w1".to_owned()), bounds, false)],
        );
        let tiled_windows: Vec<WindowId> = match reply {
            CoreReply::Tiled(plan) => plan.geometry.iter().map(|g| g.window.clone()).collect(),
            CoreReply::Projection(plan) => plan.geometry.iter().map(|g| g.window.clone()).collect(),
            CoreReply::SendWorkspace(plan) => {
                plan.geometry.iter().map(|g| g.window.clone()).collect()
            }
            reply => panic!("current admit converges, got {reply:?}"),
        };
        assert!(
            tiled_windows.contains(&WindowId("w1".to_owned())),
            "target tiles w1, got {tiled_windows:?}"
        );
        assert!(
            !engine
                .session(&target.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
            "w1 rides tiled in target"
        );
        assert!(
            !engine
                .session(&source.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
            "no stale duplicate in old"
        );
    }

    #[test]
    fn sticky_pruned_backing_rehomes_to_current_without_duplicate() {
        // Sticky-only backing workspace prunes while the sticky membership
        // dangles, then sticky-off rehomes to current: the old domain drops
        // the mover with no duplicate and current tiles (prior tiled) or
        // keeps the live frame as a normal float (prior float). Ties the
        // production pure seams: `plan_cleanup_excluding` /
        // `workspace_members` (missing returns empty) plus `domain_rows`
        // and the floating reconcile builder, for both prior origins.
        use tiler_core::boundary::CoreReply;
        let bounds = rect(0, 0);
        let live_frame = Rect {
            x: 10,
            y: 20,
            w: 400,
            h: 300,
        };
        // Workspace seam: sticky-only intermediate prunes, membership dangles.
        let mut spaces = ManagedWorkspaces::new();
        spaces.ensure_output("mon-a");
        let current = spaces.active_id("mon-a").expect("active");
        let backing = spaces.resolve_send("mon-a", 2).expect("second");
        let filler = key(43);
        assert!(spaces.assign(filler.clone(), "mon-a", &backing, false));
        let (third, _) = spaces.select_trailing("mon-a").expect("trailing");
        assert!(spaces.assign(filler.clone(), "mon-a", &third, false));
        let mover = key(41);
        assert!(spaces.assign(mover.clone(), "mon-a", &backing, false));
        let sibling = key(42);
        assert!(spaces.assign(sibling.clone(), "mon-a", &current, false));
        assert!(spaces.activate("mon-a", &current));
        let sticky: BTreeSet<WindowKey> = [mover.clone()].into_iter().collect();
        let (removed, append) =
            spaces.plan_cleanup_excluding("mon-a", std::slice::from_ref(&current), &[], &sticky);
        assert_eq!(removed, vec![backing.clone()], "sticky-only prunes");
        spaces.apply_cleanup("mon-a", &removed, append);
        assert_eq!(
            spaces.member_loc(&mover).map(|l| l.workspace.clone()),
            Some(backing.clone()),
            "membership dangles on the pruned id"
        );
        assert!(
            spaces.workspace_members("mon-a", &backing).is_empty(),
            "pruned members read back empty"
        );
        // Engine seam per prior origin: old domain without the mover, current
        // with the mover explicit (mirrors the native rehome construct).
        for prior in [false, true] {
            let floating = prior;
            let mut engine = tiler_core::engine::Engine::new();
            let owner = OwnerId::parse("tiler-windows").expect("owner");
            let generation = GenerationId::parse("aa").expect("generation");
            engine.sync_binding(&owner, &generation);
            let source = workspace_domain("mon-a", &backing, bounds, 8);
            let target = workspace_domain("mon-a", &current, bounds, 8);
            // Sticky-on: tiled mover floats in the backing domain.
            let seed = float_event(
                &owner,
                &generation,
                "sticky-on",
                revision_of(&engine, &source),
                &source,
                &[(WindowId("w1".to_owned()), bounds, false)],
                "w1",
                "w1",
                None,
            );
            let reply = engine.handle(&seed);
            assert!(
                matches!(reply, CoreReply::Tiled(_)),
                "prior {prior}: sticky-on floats, got {reply:?}"
            );
            // Old domain rows via the production seam: pruned members read
            // empty, so the removal observation carries no mover.
            let old_members = spaces.workspace_members("mon-a", &backing);
            assert!(old_members.is_empty(), "prior {prior}: backing pruned");
            let old_rows = domain_rows(&old_members, &[]).expect("prior {prior}: pruned rows");
            assert!(old_rows.is_empty(), "prior {prior}: old rows empty");
            let old_fp = crate::tiling::fingerprint(&[]);
            let correlation = CorrelationId::parse("prune-old").expect("correlation");
            let old_event = crate::tiling::build_reconcile_event_for_floating(
                &owner,
                &generation,
                &correlation,
                revision_of(&engine, &source),
                old_fp,
                &source.0,
                &source.1,
                8,
                &[],
                None,
            );
            let reply = engine.handle(&old_event);
            assert!(
                matches!(
                    reply,
                    CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
                ),
                "prior {prior}: old removal converges, got {reply:?}"
            );
            assert!(
                !engine
                    .session(&source.1)
                    .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
                "prior {prior}: old exception gone"
            );
            // Current rows via the production seam: existing sibling rows
            // plus the mover explicit with the live frame, floating by
            // origin (prior float stays float, prior tiled tiles).
            let cur_members = spaces.workspace_members("mon-a", &current);
            assert!(
                cur_members.contains(&sibling),
                "prior {prior}: sibling stays current"
            );
            let cur_views = vec![MemberView {
                key: sibling.clone(),
                token: "w2".to_owned(),
                rect: bounds,
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating: false,
            }];
            let mut cur_rows =
                domain_rows(&cur_members, &cur_views).expect("prior {prior}: base rows");
            cur_rows.push(OwnerRow {
                token: "w1".to_owned(),
                rect: live_frame,
                hints: tiler_core::size_hints::WindowSizeHints::none(),
                floating,
            });
            assert!(
                cur_rows
                    .iter()
                    .any(|r| r.token == "w1" && r.rect == live_frame),
                "prior {prior}: explicit current row carries the live frame"
            );
            let cur_windows: Vec<(
                WindowId,
                Rect,
                tiler_core::size_hints::WindowSizeHints,
                bool,
            )> = cur_rows
                .iter()
                .map(|r| (WindowId(r.token.clone()), r.rect, r.hints, r.floating))
                .collect();
            let cur_fp = crate::tiling::fingerprint(
                &cur_rows
                    .iter()
                    .map(|r| (r.token.clone(), r.rect))
                    .collect::<Vec<_>>(),
            );
            let correlation = CorrelationId::parse("admit-current").expect("correlation");
            let cur_event = crate::tiling::build_reconcile_event_for_floating(
                &owner,
                &generation,
                &correlation,
                revision_of(&engine, &target),
                cur_fp,
                &target.0,
                &target.1,
                8,
                &cur_windows,
                None,
            );
            let reply = engine.handle(&cur_event);
            assert!(
                matches!(
                    reply,
                    CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
                ),
                "prior {prior}: current admit converges, got {reply:?}"
            );
            let cur_float = engine
                .session(&target.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned())));
            assert_eq!(
                cur_float, prior,
                "prior {prior}: current float follows origin"
            );
            if !prior {
                let tiled: Vec<WindowId> = match reply {
                    CoreReply::Tiled(plan) => {
                        plan.geometry.iter().map(|g| g.window.clone()).collect()
                    }
                    CoreReply::Projection(plan) => {
                        plan.geometry.iter().map(|g| g.window.clone()).collect()
                    }
                    CoreReply::SendWorkspace(plan) => {
                        plan.geometry.iter().map(|g| g.window.clone()).collect()
                    }
                    reply => panic!("prior {prior}: current tiles, got {reply:?}"),
                };
                assert!(
                    tiled.contains(&WindowId("w1".to_owned())),
                    "prior {prior}: target tiles w1, got {tiled:?}"
                );
            }
            assert!(
                !engine
                    .session(&source.1)
                    .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
                "prior {prior}: no stale duplicate in old"
            );
        }
    }

    #[test]
    fn sticky_adopt_consumes_both_markers_as_normal_float_then_tiles() {
        // Restart adoption consumes either marker value into the same normal
        // float (Engine exception, no sticky entry): the pre-restart origin
        // never survives, and the next ordinary Win+G unfloats to tiled.
        // Mirrors the native adoption preamble through the production builders.
        use tiler_core::boundary::CoreReply;
        for prior in [false, true] {
            let value = crate::tiling::sticky_marker_value(prior);
            assert_eq!(
                crate::tiling::parse_sticky_marker(value),
                Some(prior),
                "marker round-trips"
            );
            let mut engine = tiler_core::engine::Engine::new();
            let owner = OwnerId::parse("tiler-windows").expect("owner");
            let generation = GenerationId::parse("aa").expect("generation");
            engine.sync_binding(&owner, &generation);
            let bounds = rect(0, 0);
            let domain = workspace_domain("mon-a", "ws-1", bounds, 8);
            let correlation = CorrelationId::parse("adopt").expect("correlation");
            let carried = vec![(
                WindowId("w1".to_owned()),
                bounds,
                tiler_core::size_hints::WindowSizeHints::none(),
                true,
            )];
            let fp = crate::tiling::fingerprint(&[("w1".to_owned(), bounds)]);
            let adopt = crate::tiling::build_reconcile_event_for_floating(
                &owner,
                &generation,
                &correlation,
                revision_of(&engine, &domain),
                fp,
                &domain.0,
                &domain.1,
                8,
                &carried,
                None,
            );
            let reply = engine.handle(&adopt);
            assert!(
                matches!(
                    reply,
                    CoreReply::Projection(_) | CoreReply::Tiled(_) | CoreReply::SendWorkspace(_)
                ),
                "prior {prior}: adoption converges, got {reply:?}"
            );
            let candidate_float = engine
                .session(&domain.1)
                .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned())));
            assert!(candidate_float, "prior {prior}: adopted window floats");
            // Consumption verdict (inlined native gate): verified candidate
            // plus cleared marker commits a normal float; anything else keeps
            // the marker for later recovery.
            let marker = Some(prior);
            let cleared = true;
            assert!(
                marker.is_some() && candidate_float && cleared,
                "prior {prior}: both markers consume identically"
            );
            // Next ordinary Win+G: ToggleFloat unfloat with the live frame
            // tiles the normal float (no sticky vocabulary involved).
            let unfloat = float_event(
                &owner,
                &generation,
                "first-toggle",
                revision_of(&engine, &domain),
                &domain,
                &[(WindowId("w1".to_owned()), bounds, true)],
                "w1",
                "w1",
                Some(bounds),
            );
            let reply = engine.handle(&unfloat);
            assert!(
                matches!(reply, CoreReply::Tiled(_)),
                "prior {prior}: first toggle tiles, got {reply:?}"
            );
            assert!(
                !engine
                    .session(&domain.1)
                    .is_some_and(|s| s.is_exception(&WindowId("w1".to_owned()))),
                "prior {prior}: exception cleared by first toggle"
            );
        }
    }

    #[test]
    fn hidden_float_rows_stay_floating_until_reveal() {
        // Hidden intentional floats ride the live float snapshot with the
        // tiled allocation as fallback, so convergence never drops retained
        // hidden membership. Sticky rides the same slotless float lane.
        use super::{MemberView, domain_rows, hidden_snapshot_rect};
        let float_rect = Some(Rect {
            x: 10,
            y: 20,
            w: 400,
            h: 300,
        });
        let tiled_rect = Some(Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        });
        assert_eq!(
            hidden_snapshot_rect(true, float_rect, tiled_rect),
            float_rect
        );
        assert_eq!(hidden_snapshot_rect(true, None, tiled_rect), tiled_rect);
        let member = key(21);
        let members: BTreeSet<WindowKey> = [member.clone()].into_iter().collect();
        let float_frame = Rect {
            x: 10,
            y: 20,
            w: 400,
            h: 300,
        };
        let views = vec![MemberView {
            key: member,
            token: "w-float".to_owned(),
            rect: float_frame,
            hints: tiler_core::size_hints::WindowSizeHints::none(),
            floating: true,
        }];
        let rows = domain_rows(&members, &views).expect("hidden float rows");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].floating, "hidden float stays floating");
    }
}
