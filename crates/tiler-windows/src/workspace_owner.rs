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

/// One Engine window row: token, last-known rectangle, and fresh
/// application-declared minimum-size hint. Hidden snapshots ride the same
/// rows so convergence never drops retained membership; hidden rows carry a
/// fresh hint like visible rows (fresh observation only, never a stored
/// floor) while retained rows carry none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerRow {
    pub token: String,
    pub rect: Rect,
    pub hints: tiler_core::size_hints::WindowSizeHints,
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
            floating: false,
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
            floating: false,
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
/// then caption, then covering geometry.
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
/// frame, or hidden snapshot), and fresh minimum-size hint (eligible visible
/// reads plus verified hidden snapshots; retained rows carry no hint).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberView {
    pub key: WindowKey,
    pub token: String,
    pub rect: Rect,
    pub hints: tiler_core::size_hints::WindowSizeHints,
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
        }];
        let target_rows = vec![OwnerRow {
            token: "w2".to_owned(),
            rect: bounds,
            hints: tiler_core::size_hints::WindowSizeHints::none(),
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
            },
            MemberView {
                key: b.clone(),
                token: "w2".to_owned(),
                rect: rect(100, 100),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
            },
            MemberView {
                key: c.clone(),
                token: "w3".to_owned(),
                rect: rect(200, 200),
                hints: tiler_core::size_hints::WindowSizeHints::none(),
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
                },
                OwnerRow {
                    token: "w2".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
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
                },
                OwnerRow {
                    token: "w2".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
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
                },
                OwnerRow {
                    token: "w2".to_owned(),
                    rect: bounds,
                    hints: tiler_core::size_hints::WindowSizeHints::none(),
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
                     covers_monitor: bool| {
            classify_foreground(ForegroundFacts {
                valid,
                is_desktop,
                visible,
                captioned,
                dwm_readable,
                covers_monitor,
            })
        };
        // Visible real fullscreen still vetoes.
        let v = facts(true, false, true, false, true, true);
        assert!(v.block && v.reason == ForegroundVetoReason::Fullscreen);
        // Visible unreadable foreground stays blocked (fail closed).
        let v = facts(true, false, true, false, false, false);
        assert!(v.block && v.reason == ForegroundVetoReason::Unreadable);
        // Invalid handle fails closed.
        let v = facts(false, false, false, false, false, false);
        assert!(v.block && v.reason == ForegroundVetoReason::Invalid);
        // Exact desktop shell handle never vetoes, even when covering.
        let v = facts(true, true, true, false, true, true);
        assert!(!v.block && v.reason == ForegroundVetoReason::Desktop);
        // Valid non-visible foreground never vetoes: invisible cannot cover.
        let v = facts(true, false, false, false, true, true);
        assert!(!v.block && v.reason == ForegroundVetoReason::Nonvisible);
        // Captioned foreground never vetoes.
        let v = facts(true, false, true, true, true, false);
        assert!(!v.block && v.reason == ForegroundVetoReason::Captioned);
        // Small visible borderless window never vetoes.
        let v = facts(true, false, true, false, true, false);
        assert!(!v.block && v.reason == ForegroundVetoReason::None);
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
            },
            MemberView {
                key: b.clone(),
                token: "w2".to_owned(),
                rect: rect(100, 100),
                hints: WindowSizeHints::none(),
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
        // flag every violating window: the native write path skips those
        // entries (existing `overconstrained` skip), preserving the
        // refused-tracker and KDE-infeasible behavior.
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
}
