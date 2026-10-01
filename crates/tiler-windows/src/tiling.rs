//! Tiling-only Windows runtime over the retained portable Engine.
//!
//! Portable policy lives here and compiles everywhere; native enumeration,
//! actuation, and the event loop live in [`crate::tiling_sys`] (`cfg(windows)`
//! only). The Engine is the layout authority: this crate builds complete
//! `Reconcile` observations, applies `CoreReply` geometry verbatim, and never
//! adopts observed rectangles into retained state.

use std::collections::HashMap;
use std::path::PathBuf;

use tiler_core::boundary::{CoreCommand, CoreEvent};
use tiler_core::directional::{OutputId, WindowId, WorkspaceId};
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::seed::EngineWindow;
use tiler_core::session::{DomainKey, OutputDomain};

/// Shipped KDE parity: inner gap 8, outer gap 8 (`kwin/src/domain-gap.ts`).
pub const INNER_GAP: i32 = 8;
/// Shipped KDE parity: outer gap 8.
pub const OUTER_GAP: i32 = 8;
/// Single-display tiling-only output identity.
pub const OUTPUT_ID: &str = "display-0";
/// Implicit current workspace for the tiling-only slice.
pub const WORKSPACE_ID: &str = "workspace-0";
/// Stable Engine owner token for this adapter.
pub const OWNER_ID: &str = "tiler-windows";

/// Adapter-side domain bounds: the protocol layer owns the outer inset
/// (`tiler-protocol` applies `inset_bounds(carried, outer_gap)`), and this
/// adapter constructs `CoreEvent` directly, so inset here. `None` when the
/// work area cannot carry the margin: the caller skips the tick with retained
/// Engine state rather than tiling an un-inset domain.
#[must_use]
pub fn tiling_domain_bounds(work: Rect) -> Option<Rect> {
    tiler_core::geometry::inset_bounds(work, OUTER_GAP).ok()
}

/// Measured per-app frame: outer `GetWindowRect` minus visible
/// `DWMWA_EXTENDED_FRAME_BOUNDS`, in physical pixels. All fields non-negative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FrameInsets {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl FrameInsets {
    /// Measure from one outer/visible pair; negative deltas saturate to zero
    /// (DWM rounding) rather than failing the tick.
    #[must_use]
    pub fn measure(outer: Rect, visible: Rect) -> Self {
        Self {
            left: visible.x.saturating_sub(outer.x).max(0),
            top: visible.y.saturating_sub(outer.y).max(0),
            right: (outer.x as i64 + outer.w as i64 - visible.x as i64 - visible.w as i64)
                .clamp(0, i64::from(i32::MAX)) as i32,
            bottom: (outer.y as i64 + outer.h as i64 - visible.y as i64 - visible.h as i64)
                .clamp(0, i64::from(i32::MAX)) as i32,
        }
    }

    /// Map an Engine visible rectangle back to the outer rectangle for
    /// `SetWindowPos`. `None` on arithmetic overflow: the caller skips the
    /// write for this tick instead of clamping geometry.
    #[must_use]
    pub fn visible_to_outer(self, visible: Rect) -> Option<Rect> {
        let x = visible.x.checked_sub(self.left)?;
        let y = visible.y.checked_sub(self.top)?;
        let w = visible.w.checked_add(self.left)?.checked_add(self.right)?;
        let h = visible.h.checked_add(self.top)?.checked_add(self.bottom)?;
        if w <= 0 || h <= 0 {
            return None;
        }
        Some(Rect { x, y, w, h })
    }
}

/// Stable opaque per-run window tokens (`w1`, `w2`, ...). Keyed by
/// `(HWND, process creation)` so a recycled HWND never inherits its
/// predecessor's token, even within the same tick. HWND values never enter
/// logs; tokens are the only window naming in production output.
#[derive(Debug, Default)]
pub struct TokenMap {
    next: u64,
    by_window: HashMap<(u64, String), String>,
}

impl TokenMap {
    #[must_use]
    pub fn token_for(&mut self, hwnd: u64, process_creation: &str) -> String {
        let key = (hwnd, process_creation.to_owned());
        if let Some(token) = self.by_window.get(&key) {
            return token.clone();
        }
        self.next += 1;
        let token = format!("w{}", self.next);
        self.by_window.insert(key, token.clone());
        token
    }

    /// Forget entries for windows no longer enumerated so the map stays
    /// bounded. Identity is `(hwnd, creation)` pairs, never HWND alone.
    pub fn retain(&mut self, live: &[ObservedTargetRef<'_>]) {
        self.by_window.retain(|(hwnd, creation), _| {
            live.iter()
                .any(|t| t.hwnd == *hwnd && t.creation == creation)
        });
    }
}

/// Borrowed identity reference for [`TokenMap::retain`].
pub struct ObservedTargetRef<'a> {
    pub hwnd: u64,
    pub creation: &'a str,
}

/// Deterministic FNV-1a 64-bit fingerprint over sorted `(token, rect)` pairs.
#[must_use]
pub fn fingerprint(windows: &[(String, Rect)]) -> u64 {
    let mut sorted: Vec<(&String, &Rect)> = windows.iter().map(|(t, r)| (t, r)).collect();
    sorted.sort_by(|a, b| a.0.cmp(b.0));
    let mut hash: u64 = 0xcbf29ce484222325;
    for (token, rect) in sorted {
        for byte in token.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        for word in [rect.x, rect.y, rect.w, rect.h] {
            for byte in word.to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
    }
    hash
}

/// Pre-queried native facts for one top-level window. All fields are plain
/// observed state; policy in [`classify`] decides eligibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowFacts {
    pub visible: bool,
    pub minimized: bool,
    pub maximized: bool,
    pub cloaked: bool,
    pub elevated: bool,
    pub shell: bool,
    pub tool_window: bool,
    pub owned: bool,
    pub captionless_fullscreen: bool,
    pub terminal_ancestor: bool,
    pub no_activate: bool,
    /// Generic Win32 dialog class (`#32770`) without an owner window.
    /// Owned dialogs are reported as `OwnedDialog` instead.
    pub dialog: bool,
}

/// Closed skip vocabulary for ineligible windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    Hidden,
    Minimized,
    Maximized,
    Cloaked,
    Elevated,
    Shell,
    Tool,
    OwnedDialog,
    /// Unowned generic dialog (`#32770`): never a tile target.
    Dialog,
    Fullscreen,
    Terminal,
    NoActivate,
    Unreadable,
    /// Frozen-allowlist identity stopped matching (vanished HWND, recycled
    /// HWND/PID, or foreign process): a true unknown, never a counted skip.
    /// Produced only by the stateless inspection verdict, never by `classify`.
    IdentityChanged,
}

impl SkipReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Hidden => "hidden",
            Self::Minimized => "minimized",
            Self::Maximized => "maximized",
            Self::Cloaked => "cloaked",
            Self::Elevated => "elevated",
            Self::Shell => "shell",
            Self::Tool => "tool",
            Self::OwnedDialog => "owned-dialog",
            Self::Dialog => "dialog",
            Self::Fullscreen => "fullscreen",
            Self::Terminal => "terminal",
            Self::NoActivate => "no-activate",
            Self::Unreadable => "unreadable",
            Self::IdentityChanged => "identity-changed",
        }
    }
}

/// Eligibility gate. Normal user tiling includes Terminal targets; test mode
/// always excludes the Terminal tree. Dimensions alone never classify
/// fullscreen: `captionless_fullscreen` requires a captionless style covering
/// the monitor.
pub fn classify(facts: &WindowFacts, test_mode: bool) -> Result<(), SkipReason> {
    if !facts.visible {
        return Err(SkipReason::Hidden);
    }
    if facts.minimized {
        return Err(SkipReason::Minimized);
    }
    if facts.maximized {
        return Err(SkipReason::Maximized);
    }
    if facts.cloaked {
        return Err(SkipReason::Cloaked);
    }
    if facts.elevated {
        return Err(SkipReason::Elevated);
    }
    if facts.shell {
        return Err(SkipReason::Shell);
    }
    if facts.tool_window {
        return Err(SkipReason::Tool);
    }
    if facts.owned {
        return Err(SkipReason::OwnedDialog);
    }
    if facts.dialog {
        return Err(SkipReason::Dialog);
    }
    if facts.captionless_fullscreen {
        return Err(SkipReason::Fullscreen);
    }
    if facts.no_activate {
        return Err(SkipReason::NoActivate);
    }
    if test_mode && facts.terminal_ancestor {
        return Err(SkipReason::Terminal);
    }
    Ok(())
}

/// Stateless pre-frame verdict for one allowlisted entry: frozen-identity
/// matching plus window state, available before (and without) any frame
/// query. This is the production decision path for the inspection report
/// when geometry is absent: legitimately hidden (passive) or minimized exact
/// helpers keep full identity match with an accurate skip, while a
/// non-matching identity is a true unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatelessVerdict {
    /// Terminal for this pass: report identity state with this skip and
    /// perform no geometry read and no actuation.
    Report {
        identity_match: bool,
        eligible: bool,
        skip: SkipReason,
    },
    /// Identity matched a visible, non-minimized window: frame queries and
    /// `classify` are still required.
    NeedsGeometry,
}

/// Map `(identity_match, visible, minimized)` to the inspection verdict.
/// Mismatch beats visibility (a foreign window at a frozen HWND is unknown
/// even when visible); hidden beats minimized; minimized needs no frame.
#[must_use]
pub const fn inspect_stateless_verdict(
    identity_match: bool,
    visible: bool,
    minimized: bool,
) -> StatelessVerdict {
    if !identity_match {
        return StatelessVerdict::Report {
            identity_match: false,
            eligible: false,
            skip: SkipReason::IdentityChanged,
        };
    }
    if !visible {
        return StatelessVerdict::Report {
            identity_match: true,
            eligible: false,
            skip: SkipReason::Hidden,
        };
    }
    if minimized {
        return StatelessVerdict::Report {
            identity_match: true,
            eligible: false,
            skip: SkipReason::Minimized,
        };
    }
    StatelessVerdict::NeedsGeometry
}

/// Portable observed target identity for frozen-allowlist matching.
/// `tag` is the owned-helper lifetime token (`PlasmaAutoTilerLifetime`
/// property): nonempty for owned helpers, required in every allowlist entry
/// so a recycled HWND in the same process never matches its predecessor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedTarget {
    pub hwnd: u64,
    pub pid: u32,
    pub process_creation: String,
    pub exe_path: String,
    pub user_sid: String,
    pub session_id: u32,
    pub terminal_ancestor: bool,
    pub tag: String,
}

/// One frozen allowlist entry, captured at test start. `tag` is required:
/// empty tags are malformed and refused before any lease or write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowEntry {
    pub hwnd: u64,
    pub pid: u32,
    pub process_creation: String,
    pub exe_path: String,
    pub user_sid: String,
    pub session_id: u32,
    pub tag: String,
}

/// Parse a test-mode allowlist receipt. Malformed, empty, duplicate-HWND,
/// empty-identity, or empty-tag input is an error; the caller must never fall
/// back to normal tiling on a bad allowlist.
pub fn parse_allowlist(json: &str) -> Result<Vec<AllowEntry>, String> {
    #[derive(serde::Deserialize)]
    struct Receipt {
        windows: Vec<AllowEntryJson>,
    }
    #[derive(serde::Deserialize)]
    struct AllowEntryJson {
        hwnd: u64,
        pid: u32,
        process_creation: String,
        exe_path: String,
        user_sid: String,
        session_id: u32,
        #[serde(default)]
        tag: String,
    }
    let receipt: Receipt =
        serde_json::from_str(json).map_err(|_| "refuse: malformed allowlist".to_owned())?;
    if receipt.windows.is_empty() {
        return Err("refuse: empty allowlist".to_owned());
    }
    if receipt.windows.iter().any(|w| {
        w.hwnd == 0
            || w.pid == 0
            || w.process_creation.is_empty()
            || w.exe_path.is_empty()
            || w.user_sid.is_empty()
            || w.tag.is_empty()
    }) {
        return Err("refuse: malformed allowlist".to_owned());
    }
    let mut seen = std::collections::HashSet::new();
    for window in &receipt.windows {
        if !seen.insert(window.hwnd) {
            return Err("refuse: duplicate allowlist hwnd".to_owned());
        }
    }
    Ok(receipt
        .windows
        .into_iter()
        .map(|w| AllowEntry {
            hwnd: w.hwnd,
            pid: w.pid,
            process_creation: w.process_creation,
            exe_path: w.exe_path,
            user_sid: w.user_sid,
            session_id: w.session_id,
            tag: w.tag,
        })
        .collect())
}

/// Deterministic FNV-1a 64-bit digest over the frozen allowlist in HWND order.
/// Binds hwnd/pid/creation/exe/sid/session/tag; empty input digests as zero.
#[must_use]
pub fn allowlist_digest(entries: &[AllowEntry]) -> String {
    let mut sorted: Vec<&AllowEntry> = entries.iter().collect();
    sorted.sort_by_key(|e| e.hwnd);
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut mix = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    };
    for e in sorted {
        mix(&e.hwnd.to_le_bytes());
        mix(&e.pid.to_le_bytes());
        mix(e.process_creation.as_bytes());
        mix(e
            .exe_path
            .to_ascii_lowercase()
            .replace('/', "\\")
            .as_bytes());
        mix(e.user_sid.as_bytes());
        mix(&e.session_id.to_le_bytes());
        mix(e.tag.as_bytes());
    }
    format!("{hash:016x}")
}

/// Exact frozen-identity match: HWND plus full process identity plus the
/// owned-helper lifetime tag. Exe paths compare slash/case-insensitively like
/// the owner checks. A recycled HWND in the same process carries a fresh tag
/// and never matches.
#[must_use]
pub fn allow_match(entry: &AllowEntry, observed: &ObservedTarget) -> bool {
    entry.hwnd == observed.hwnd
        && entry.pid == observed.pid
        && entry.process_creation == observed.process_creation
        && crate::lifecycle::exe_paths_equal(&entry.exe_path, &observed.exe_path)
        && entry.user_sid == observed.user_sid
        && entry.session_id == observed.session_id
        && entry.tag == observed.tag
        && !entry.tag.is_empty()
}

/// Per-window write memory with two narrow lanes and no learned policy:
///
/// - `clamp`: a successful write whose readback still mismatches (the app
///   holds its own size). The identical intent is skipped until the desired
///   rectangle or the native observation genuinely changes.
/// - `transient`: a failed setter API call. Retried with bounded backoff
///   (500ms doubling, capped at 5s); any intent/observation change re-arms
///   immediately, so transient failures always recover.
#[derive(Debug, Default)]
pub struct RefusedTracker {
    clamp: HashMap<String, (Rect, Rect)>,
    transient: HashMap<String, TransientEntry>,
}

/// Backoff base for transient setter failures.
pub const TRANSIENT_BASE_MS: u64 = 500;
/// Backoff cap for transient setter failures.
pub const TRANSIENT_MAX_MS: u64 = 5000;

#[derive(Debug, Clone)]
struct TransientEntry {
    desired: Rect,
    observed: Rect,
    failures: u32,
    last: std::time::Instant,
}

impl RefusedTracker {
    /// `true` when this exact `(desired, observed)` pair is currently
    /// suppressed: an identical app-clamp refusal, or a transient failure
    /// still inside its backoff window.
    #[must_use]
    pub fn should_skip(
        &self,
        token: &str,
        desired: &Rect,
        observed: &Rect,
        now: std::time::Instant,
    ) -> bool {
        if self
            .clamp
            .get(token)
            .is_some_and(|(d, o)| d == desired && o == observed)
        {
            return true;
        }
        if let Some(entry) = self.transient.get(token)
            && entry.desired == *desired
            && entry.observed == *observed
        {
            let shift = entry.failures.min(4);
            let backoff = (TRANSIENT_BASE_MS << shift).min(TRANSIENT_MAX_MS);
            if now.duration_since(entry.last).as_millis() < u128::from(backoff) {
                return true;
            }
        }
        false
    }

    /// Exact application clears both lanes.
    pub fn note_match(&mut self, token: &str) {
        self.clamp.remove(token);
        self.transient.remove(token);
    }

    /// Successful write, readback still mismatches: app-held size.
    pub fn note_clamp(&mut self, token: &str, desired: &Rect, observed: &Rect) {
        if desired == observed {
            self.note_match(token);
        } else {
            self.clamp.insert(token.to_owned(), (*desired, *observed));
        }
    }

    /// Failed setter API call: bounded-backoff lane.
    pub fn note_transient(
        &mut self,
        token: &str,
        desired: &Rect,
        observed: &Rect,
        now: std::time::Instant,
    ) {
        let failures = self
            .transient
            .get(token)
            .filter(|entry| entry.desired == *desired && entry.observed == *observed)
            .map_or(0, |entry| entry.failures.saturating_add(1));
        self.transient.insert(
            token.to_owned(),
            TransientEntry {
                desired: *desired,
                observed: *observed,
                failures,
                last: now,
            },
        );
    }

    /// Forget tokens for windows no longer managed.
    pub fn retain(&mut self, live_tokens: &[&str]) {
        self.clamp
            .retain(|token, _| live_tokens.contains(&token.as_str()));
        self.transient
            .retain(|token, _| live_tokens.contains(&token.as_str()));
    }
}

/// Post-write readback decision for one desired entry. Only a window that
/// was actually written this tick may enter the app-clamp lane; a mismatch
/// with no write behind it stays pending so transient backoff and re-reads
/// keep working instead of being pinned as a permanent clamp.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadbackOutcome {
    Match,
    Clamp,
    Pending,
}

/// Decide the tracker update for one `(desired, readback)` pair.
/// `wrote_this_tick` must be true only when this tick's setter succeeded
/// for the token; a failed or skipped setter is never a clamp.
#[must_use]
pub const fn readback_outcome(
    wrote_this_tick: bool,
    desired: &Rect,
    readback: &Rect,
) -> ReadbackOutcome {
    if desired.x == readback.x
        && desired.y == readback.y
        && desired.w == readback.w
        && desired.h == readback.h
    {
        ReadbackOutcome::Match
    } else if wrote_this_tick {
        ReadbackOutcome::Clamp
    } else {
        ReadbackOutcome::Pending
    }
}

/// One settled manual gesture, derived from pre/post-gesture rectangles plus
/// the settle-time cursor position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GestureIntent {
    /// Position changed: re-place at the cursor drop point (KDE drag-drop).
    MoveDrop { x: i32, y: i32 },
    /// Size changed: pointer-resize the grabbed edges (KDE pointer-resize).
    /// Horizontal axis first, matching the KDE dual-axis route.
    PointerResize {
        direction: &'static str,
        boundary: i32,
        direction2: Option<&'static str>,
        boundary2: Option<i32>,
    },
}
/// Derive the settle intent from the stable pre-gesture rectangle and the
/// post-gesture rectangle plus the settle-time cursor position.
///
/// Same size at a new origin is a true move (KDE drag-drop). Any size change
/// makes it a resize: a changed origin means the left/top edge moved, never
/// a move. Edges derive per axis from before/post; when both edges of one
/// axis moved, the larger-magnitude edge wins (ties go to the origin edge).
/// `None` when nothing changed, the cursor is missing for a move, or a
/// boundary overflows `i32`.
#[must_use]
pub fn classify_gesture(
    before: &Rect,
    after: &Rect,
    cursor: Option<(i32, i32)>,
) -> Option<GestureIntent> {
    let pos_changed = before.x != after.x || before.y != after.y;
    let size_changed = before.w != after.w || before.h != after.h;
    if !pos_changed && !size_changed {
        return None;
    }
    if !size_changed {
        let (x, y) = cursor?;
        return Some(GestureIntent::MoveDrop { x, y });
    }
    let before_right = i64::from(before.x) + i64::from(before.w);
    let after_right = i64::from(after.x) + i64::from(after.w);
    let before_bottom = i64::from(before.y) + i64::from(before.h);
    let after_bottom = i64::from(after.y) + i64::from(after.h);
    let horizontal = pick_edge(
        before.x,
        after.x,
        before_right,
        after_right,
        "left",
        "right",
    )?;
    let vertical = pick_edge(before.y, after.y, before_bottom, after_bottom, "up", "down")?;
    match (horizontal, vertical) {
        (None, None) => None,
        (Some((direction, boundary)), None) => Some(GestureIntent::PointerResize {
            direction,
            boundary,
            direction2: None,
            boundary2: None,
        }),
        (None, Some((direction, boundary))) => Some(GestureIntent::PointerResize {
            direction,
            boundary,
            direction2: None,
            boundary2: None,
        }),
        (Some((direction, boundary)), Some((direction2, boundary2))) => {
            Some(GestureIntent::PointerResize {
                direction,
                boundary,
                direction2: Some(direction2),
                boundary2: Some(boundary2),
            })
        }
    }
}

/// Pick one axis edge from origin/edge deltas. `None` when neither moved;
/// the larger-magnitude delta wins when both moved, ties to the origin edge.
fn pick_edge(
    before_origin: i32,
    after_origin: i32,
    before_far: i64,
    after_far: i64,
    origin_name: &'static str,
    far_name: &'static str,
) -> Option<Option<(&'static str, i32)>> {
    let origin_moved = before_origin != after_origin;
    let far_moved = before_far != after_far;
    if !origin_moved && !far_moved {
        return Some(None);
    }
    if origin_moved
        && (!far_moved
            || (after_origin as i64 - before_origin as i64).abs() >= (after_far - before_far).abs())
    {
        return Some(Some((origin_name, after_origin)));
    }
    if far_moved {
        return Some(Some((far_name, after_far.try_into().ok()?)));
    }
    Some(Some((origin_name, after_origin)))
}
/// Complete observation inputs for one single-domain `Reconcile` tick.
pub struct ReconcileInput<'a> {
    pub owner: &'a OwnerId,
    pub generation: &'a GenerationId,
    pub correlation: &'a CorrelationId,
    pub revision: u64,
    pub fingerprint: u64,
    pub domain_bounds: Rect,
    pub windows: &'a [(WindowId, Rect)],
    pub focused: Option<&'a WindowId>,
}

/// Build the single-domain `Reconcile` event for one tick. Rectangles are the
/// current visible observations; `revision` is the last Engine-accepted
/// revision for the domain.
#[must_use]
pub fn build_reconcile_event(input: &ReconcileInput<'_>) -> CoreEvent {
    let domain = OutputDomain {
        id: OutputId(OUTPUT_ID.to_owned()),
        workspace: WorkspaceId(WORKSPACE_ID.to_owned()),
        bounds: input.domain_bounds,
        gap: INNER_GAP,
        adjacent: std::collections::BTreeMap::new(),
    };
    let domain_key = DomainKey {
        output: OutputId(OUTPUT_ID.to_owned()),
        workspace: WorkspaceId(WORKSPACE_ID.to_owned()),
    };
    CoreEvent {
        owner: input.owner.clone(),
        generation: input.generation.clone(),
        correlation: input.correlation.clone(),
        revision: input.revision,
        fingerprint: input.fingerprint,
        domain: domain.clone(),
        domain_key,
        outer_gap: OUTER_GAP,
        focused_window: input.focused.cloned().unwrap_or(WindowId(String::new())),
        windows: input
            .windows
            .iter()
            .map(|(window, rect)| EngineWindow {
                window: window.clone(),
                output: OutputId(OUTPUT_ID.to_owned()),
                workspace: WorkspaceId(WORKSPACE_ID.to_owned()),
                rect: *rect,
                floating: false,
                fit_excluded: false,
                hints: tiler_core::size_hints::WindowSizeHints::none(),
            })
            .collect(),
        directional: None,
        directional_target_outer_gap: None,
        target_domain: None,
        target_windows: Vec::new(),
        command: CoreCommand::Reconcile,
    }
}

/// CLI options for the read-only `capture` command: an explicit target list
/// only. There is no implicit all-window capture; every receipt window must
/// be named with a repeated `--hwnd`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureOptions {
    pub out: PathBuf,
    pub hwnds: Vec<u64>,
}

/// Parse `capture --out PATH --hwnd HWND [--hwnd HWND ...]`. At least one
/// `--hwnd` is required; zero targets is a refusal, never an all-window
/// capture.
pub fn parse_capture_args(args: &[String]) -> Result<CaptureOptions, String> {
    let usage = "usage: capture --out PATH --hwnd HWND [--hwnd HWND ...]";
    let mut out: Option<PathBuf> = None;
    let mut hwnds: Vec<u64> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                out = Some(PathBuf::from(value));
                i += 1;
            }
            "--hwnd" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                let hwnd = crate::test_window::parse_hwnd(value).ok_or_else(|| usage.to_owned())?;
                if !hwnds.contains(&hwnd) {
                    hwnds.push(hwnd);
                }
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(out) = out else {
        return Err(usage.to_owned());
    };
    if hwnds.is_empty() {
        return Err("refuse: capture requires at least one --hwnd".to_owned());
    }
    Ok(CaptureOptions { out, hwnds })
}

/// CLI options for the normal `tile` command (user dogfood only).
/// `seconds: None` runs until an exact-owner stop request. Normal tiling
/// includes Terminal targets and requires explicit `--user-start`: agents
/// never run this path. `--allowlist` is refused here; proof uses
/// `tile-proof` so lost arguments can never fall back to normal mode.
///
/// Keyboard takeover defaults ON (Win+H/J/K/L and Win+arrows focus, Shift
/// variants move, per the KDE catalog): `--no-keyboard-snap-takeover` turns it
/// visibly off. Unshifted Win+L stays gated behind `--allow-win-l` (default
/// off); Win+Shift+L is approved without it.
///
/// Session-only mouse-Snap prevention (`SPI_SETWINARRANGING FALSE` while
/// product tiling is active) defaults ON as well:
/// `--no-mouse-snap-prevention` turns it visibly off. The exact preimage is
/// persisted before the first setter with readback, and restored
/// conditionally on stop (or independent restore after a crash) only while
/// the live value is still ours.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileOptions {
    pub seconds: Option<u64>,
    pub trace: bool,
    pub user_start: bool,
    pub no_keyboard_snap_takeover: bool,
    pub allow_win_l: bool,
    pub no_mouse_snap_prevention: bool,
}

/// Parse `tile --user-start [--seconds N] [--trace] [--no-keyboard-snap-takeover] [--allow-win-l] [--no-mouse-snap-prevention]`.
/// Missing `--user-start` or any `--allowlist` is a refusal, never a silent
/// normal run.
pub fn parse_tile_args(args: &[String]) -> Result<TileOptions, String> {
    let usage = "usage: tile --user-start [--seconds N] [--trace] [--no-keyboard-snap-takeover] [--allow-win-l] [--no-mouse-snap-prevention]";
    let mut seconds: Option<u64> = None;
    let mut trace = false;
    let mut user_start = false;
    let mut no_keyboard_snap_takeover = false;
    let mut allow_win_l = false;
    let mut no_mouse_snap_prevention = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--user-start" => {
                user_start = true;
                i += 1;
            }
            "--no-keyboard-snap-takeover" => {
                no_keyboard_snap_takeover = true;
                i += 1;
            }
            "--allow-win-l" => {
                allow_win_l = true;
                i += 1;
            }
            "--no-mouse-snap-prevention" => {
                no_mouse_snap_prevention = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                let parsed: u64 = value.parse().map_err(|_| usage.to_owned())?;
                if parsed == 0 || parsed > crate::lifecycle::MAX_RUN_SECONDS {
                    return Err(format!(
                        "refuse: seconds must be 1..={}",
                        crate::lifecycle::MAX_RUN_SECONDS
                    ));
                }
                seconds = Some(parsed);
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    if !user_start {
        return Err("refuse: tile requires explicit --user-start".to_owned());
    }
    Ok(TileOptions {
        seconds,
        trace,
        user_start,
        no_keyboard_snap_takeover,
        allow_win_l,
        no_mouse_snap_prevention,
    })
}

/// CLI options for the proof-only `tile-proof` command (owned helpers only).
/// `--allowlist PATH` is required and nonempty; missing/empty/malformed input
/// refuses before any lease or write and never falls back to normal mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileProofOptions {
    pub seconds: Option<u64>,
    pub trace: bool,
    pub allowlist: PathBuf,
}

/// Parse `tile-proof --allowlist PATH [--seconds N] [--trace]`.
pub fn parse_tile_proof_args(args: &[String]) -> Result<TileProofOptions, String> {
    let usage = "usage: tile-proof --allowlist PATH [--seconds N] [--trace]";
    let mut seconds: Option<u64> = None;
    let mut trace = false;
    let mut allowlist: Option<PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                let parsed: u64 = value.parse().map_err(|_| usage.to_owned())?;
                if parsed == 0 || parsed > crate::lifecycle::MAX_RUN_SECONDS {
                    return Err(format!(
                        "refuse: seconds must be 1..={}",
                        crate::lifecycle::MAX_RUN_SECONDS
                    ));
                }
                seconds = Some(parsed);
                i += 1;
            }
            "--allowlist" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                if value.trim().is_empty() {
                    return Err("refuse: empty allowlist".to_owned());
                }
                allowlist = Some(PathBuf::from(value));
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err("refuse: tile-proof requires --allowlist".to_owned());
    };
    Ok(TileProofOptions {
        seconds,
        trace,
        allowlist,
    })
}

/// CLI options for the proof-only `hide-proof` command (owned helpers only,
/// product nonce mechanism). Requires a nonempty valid `--allowlist`; the
/// owner verifies every frozen entry as an owned helper BEFORE touching the
/// ordinary product nonce APIs, and never falls back to normal mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HideProofOptions {
    pub seconds: Option<u64>,
    pub trace: bool,
    pub allowlist: PathBuf,
}

/// Parse `hide-proof --allowlist PATH [--seconds N] [--trace]`.
pub fn parse_hide_proof_args(args: &[String]) -> Result<HideProofOptions, String> {
    let usage = "usage: hide-proof --allowlist PATH [--seconds N] [--trace]";
    let mut seconds: Option<u64> = None;
    let mut trace = false;
    let mut allowlist: Option<PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                let parsed: u64 = value.parse().map_err(|_| usage.to_owned())?;
                if parsed == 0 || parsed > crate::lifecycle::MAX_RUN_SECONDS {
                    return Err(format!(
                        "refuse: seconds must be 1..={}",
                        crate::lifecycle::MAX_RUN_SECONDS
                    ));
                }
                seconds = Some(parsed);
                i += 1;
            }
            "--allowlist" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                if value.trim().is_empty() {
                    return Err("refuse: empty allowlist".to_owned());
                }
                allowlist = Some(PathBuf::from(value));
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err("refuse: hide-proof requires --allowlist".to_owned());
    };
    Ok(HideProofOptions {
        seconds,
        trace,
        allowlist,
    })
}

/// Verify the raw received argv against the parsed `hide-proof` options.
/// Every delivery flag must be evidenced; any inconsistency refuses before
/// any lease or write, never falls back.
pub fn verify_hide_proof_argv_consistency(
    raw: &[String],
    parsed: &HideProofOptions,
) -> Result<(), String> {
    let usage = "usage: hide-proof --allowlist PATH [--seconds N] [--trace]";
    let mut allowlist: Option<&str> = None;
    let mut seconds: Option<&str> = None;
    let mut trace = false;
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                seconds = Some(raw.get(i).ok_or_else(|| usage.to_owned())?.as_str());
                i += 1;
            }
            "--allowlist" => {
                i += 1;
                allowlist = Some(raw.get(i).ok_or_else(|| usage.to_owned())?.as_str());
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err("refuse: hide-proof requires --allowlist".to_owned());
    };
    if parsed.allowlist.as_path() != std::path::Path::new(allowlist) {
        return Err("error: argv/parsed allowlist mismatch (impossible)".to_owned());
    }
    if parsed.trace != trace {
        return Err("error: argv/parsed trace mismatch (impossible)".to_owned());
    }
    match (parsed.seconds, seconds) {
        (None, None) => {}
        (Some(want), Some(got)) => {
            let got: u64 = got.parse().map_err(|_| usage.to_owned())?;
            if want != got {
                return Err("error: argv/parsed seconds mismatch (impossible)".to_owned());
            }
        }
        _ => return Err("error: argv/parsed seconds mismatch (impossible)".to_owned()),
    }
    Ok(())
}

/// CLI options for the proof-only `shortcut-proof` command (owned helpers
/// only, automated synthetic-input verification). Requires a nonempty valid
/// `--allowlist` at parse and at native start; missing/empty/malformed input
/// refuses before any lease or write and never falls back to normal mode.
///
/// Differences from `tile-proof`: the owner installs the same low-level hook
/// with test-only acceptance of exactly
/// [`crate::snapkey::SHORTCUT_PROOF_MARKER`] in `dwExtraInfo` (product `tile`
/// keeps filtering ALL injected), and keyboard takeover stays ON so marked
/// Win+H/J/K/L/arrows (Shift variants move) dispatch through the retained
/// Engine with fresh observation plus native readback. Unshifted Win+L is
/// NOT offered here (always gated off): live runs must never send Win+L, and
/// the gating is asserted by portable tests. Mouse-Snap prevention defaults
/// ON like product (visible `--no-mouse-snap-prevention` off switch) so the
/// same session-only preimage/restore routines run under the proof geometry
/// gate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortcutProofOptions {
    pub seconds: Option<u64>,
    pub trace: bool,
    pub allowlist: PathBuf,
    pub no_mouse_snap_prevention: bool,
}

/// Parse `shortcut-proof --allowlist PATH [--seconds N] [--trace]
/// [--no-mouse-snap-prevention]`. Any keyboard flag (`--allow-win-l`,
/// `--no-keyboard-snap-takeover`), `--user-start`, or unknown flag is a
/// refusal, never a silent normal run.
pub fn parse_shortcut_proof_args(args: &[String]) -> Result<ShortcutProofOptions, String> {
    let usage = "usage: shortcut-proof --allowlist PATH [--seconds N] [--trace] [--no-mouse-snap-prevention]";
    let mut seconds: Option<u64> = None;
    let mut trace = false;
    let mut allowlist: Option<PathBuf> = None;
    let mut no_mouse_snap_prevention = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--no-mouse-snap-prevention" => {
                no_mouse_snap_prevention = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                let parsed: u64 = value.parse().map_err(|_| usage.to_owned())?;
                if parsed == 0 || parsed > crate::lifecycle::MAX_RUN_SECONDS {
                    return Err(format!(
                        "refuse: seconds must be 1..={}",
                        crate::lifecycle::MAX_RUN_SECONDS
                    ));
                }
                seconds = Some(parsed);
                i += 1;
            }
            "--allowlist" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                if value.trim().is_empty() {
                    return Err("refuse: empty allowlist".to_owned());
                }
                allowlist = Some(PathBuf::from(value));
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err("refuse: shortcut-proof requires --allowlist".to_owned());
    };
    Ok(ShortcutProofOptions {
        seconds,
        trace,
        allowlist,
        no_mouse_snap_prevention,
    })
}

/// Verify the raw received argv against the parsed `shortcut-proof` options.
/// Same shape as the `tile-proof` check plus the mouse-prevention flag: every
/// delivery flag must be evidenced with argv elements as separate strings.
pub fn verify_shortcut_proof_argv_consistency(
    raw: &[String],
    parsed: &ShortcutProofOptions,
) -> Result<(), String> {
    let usage = "usage: shortcut-proof --allowlist PATH [--seconds N] [--trace] [--no-mouse-snap-prevention]";
    let mut allowlist: Option<&str> = None;
    let mut seconds: Option<&str> = None;
    let mut trace = false;
    let mut no_mouse = false;
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--no-mouse-snap-prevention" => {
                no_mouse = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                seconds = Some(raw.get(i).ok_or_else(|| usage.to_owned())?.as_str());
                i += 1;
            }
            "--allowlist" => {
                i += 1;
                allowlist = Some(raw.get(i).ok_or_else(|| usage.to_owned())?.as_str());
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err("refuse: shortcut-proof requires --allowlist".to_owned());
    };
    if parsed.allowlist.as_path() != std::path::Path::new(allowlist) {
        return Err("error: argv/parsed allowlist mismatch (impossible)".to_owned());
    }
    if parsed.trace != trace {
        return Err("error: argv/parsed trace mismatch (impossible)".to_owned());
    }
    if parsed.no_mouse_snap_prevention != no_mouse {
        return Err("error: argv/parsed mouse mismatch (impossible)".to_owned());
    }
    match (parsed.seconds, seconds) {
        (None, None) => {}
        (Some(want), Some(got)) => {
            let got: u64 = got.parse().map_err(|_| usage.to_owned())?;
            if want != got {
                return Err("error: argv/parsed seconds mismatch (impossible)".to_owned());
            }
        }
        _ => return Err("error: argv/parsed seconds mismatch (impossible)".to_owned()),
    }
    Ok(())
}
/// Verify the raw received argv against the parsed `tile-proof` options.
/// Every delivery flag must be evidenced: `--allowlist` present with the exact
/// path (argv elements stay separate strings so spaces survive without
/// quoting), `--trace` presence matching, `--seconds` value matching, and no
/// unknown flags. Any parsed/raw inconsistency is an impossible error: refuse
/// before any lease or write, never fall back.
pub fn verify_proof_argv_consistency(
    raw: &[String],
    parsed: &TileProofOptions,
) -> Result<(), String> {
    let usage = "usage: tile-proof --allowlist PATH [--seconds N] [--trace]";
    let mut allowlist: Option<&str> = None;
    let mut seconds: Option<&str> = None;
    let mut trace = false;
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                seconds = Some(raw.get(i).ok_or_else(|| usage.to_owned())?.as_str());
                i += 1;
            }
            "--allowlist" => {
                i += 1;
                allowlist = Some(raw.get(i).ok_or_else(|| usage.to_owned())?.as_str());
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err("refuse: tile-proof requires --allowlist".to_owned());
    };
    if parsed.allowlist.as_path() != std::path::Path::new(allowlist) {
        return Err("error: argv/parsed allowlist mismatch (impossible)".to_owned());
    }
    if parsed.trace != trace {
        return Err("error: argv/parsed trace mismatch (impossible)".to_owned());
    }
    match (parsed.seconds, seconds) {
        (None, None) => {}
        (Some(want), Some(got)) => {
            let got: u64 = got.parse().map_err(|_| usage.to_owned())?;
            if want != got {
                return Err("error: argv/parsed seconds mismatch (impossible)".to_owned());
            }
        }
        _ => return Err("error: argv/parsed seconds mismatch (impossible)".to_owned()),
    }
    Ok(())
}

/// CLI options for the read-only `children` command: explicit top-level
/// targets whose child windows are reported with verified process identity.
/// Never reads titles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildrenOptions {
    pub hwnds: Vec<u64>,
}

/// Parse `children --hwnd HWND [--hwnd HWND ...]`. At least one `--hwnd`
/// is required; zero targets is a refusal, never an all-window enumeration.
pub fn parse_children_args(args: &[String]) -> Result<ChildrenOptions, String> {
    let usage = "usage: children --hwnd HWND [--hwnd HWND ...]";
    let mut hwnds: Vec<u64> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--hwnd" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                let hwnd = crate::test_window::parse_hwnd(value).ok_or_else(|| usage.to_owned())?;
                if !hwnds.contains(&hwnd) {
                    hwnds.push(hwnd);
                }
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    if hwnds.is_empty() {
        return Err("refuse: children requires at least one --hwnd".to_owned());
    }
    Ok(ChildrenOptions { hwnds })
}

/// CLI options for the read-only `inspect` command: one frozen allowlist.
/// Reports fresh identity, rectangles, and eligibility per entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectOptions {
    pub allowlist: PathBuf,
}

/// Parse `inspect --allowlist PATH`.
pub fn parse_inspect_args(args: &[String]) -> Result<InspectOptions, String> {
    let usage = "usage: inspect --allowlist PATH";
    let mut allowlist: Option<PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--allowlist" => {
                i += 1;
                let value = args.get(i).ok_or_else(|| usage.to_owned())?;
                allowlist = Some(PathBuf::from(value));
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    let Some(allowlist) = allowlist else {
        return Err(usage.to_owned());
    };
    Ok(InspectOptions { allowlist })
}

/// Central portable borderless-fullscreen predicate: a captionless window
/// whose visible frame completely contains any monitor's full bounds
/// (`rcMonitor`, not `rcWork`). Dimensions alone never classify: captioned
/// windows are never fullscreen, and small borderless windows stay eligible.
/// Negative coordinates are handled by exact containment, not size checks.
#[must_use]
pub fn is_borderless_fullscreen(captionless: bool, visible: Rect, monitor_fulls: &[Rect]) -> bool {
    if !captionless {
        return false;
    }
    monitor_fulls
        .iter()
        .any(|full| tiler_core::bounds::rect_contained(*full, visible))
}

/// Stable tick-summary signature for log dedupe. Carries no tick: an
/// identical observation (window count, applied writes, sorted skip reasons,
/// mismatches, op, Engine revision) stays quiet no matter how many ticks pass.
/// Bounded: the caller passes already-sorted skip pairs; no arbitrary caps.
#[must_use]
pub fn tick_summary_signature(
    windows: usize,
    applied: usize,
    sorted_skipped: &[(String, String)],
    mismatched: usize,
    op: &str,
    revision: u64,
) -> String {
    let skips = sorted_skipped
        .iter()
        .map(|(t, r)| format!("{t}={r}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("{windows}|{applied}|{skips}|{revision}|{mismatched}|{op}")
}
