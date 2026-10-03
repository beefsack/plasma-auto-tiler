//! Product keyboard takeover: Win+H/J/K/L and Win+arrows for focus/move.
//!
//! Portable classifier and bounded intent queue; the low-level hook itself
//! lives in [`sys`] (`cfg(windows)` only) and mirrors the accepted
//! `winarrow` spike techniques (origin pairing, both Win keys, preheld
//! modifiers, saturation fail-closed, vkE8 Start-menu mask at Win-up) without
//! modifying the spike.
//!
//! Exact KDE catalog (`kwin/src/plan-adapter-entry.ts`): unshifted Win+key is
//! focus, Win+Shift+key is move, over letters H/J/K/L plus arrow aliases.
//! Unshifted Win+L additionally requires explicit opt-in (`allow_win_l`);
//! Win+Shift+L stays approved. Any Ctrl/Alt, injected input, or unrelated key
//! passes through untracked and never enters the queue or logs.
//!
//! The callback never touches the Engine, geometry, or logs: it classifies one
//! key event, pushes one bounded record, and (Win-up only, with no hook-state
//! borrow held) sends the vkE8 mask pair. The owner drains intents against a
//! fresh complete observation through the retained Engine.

use tiler_core::directional::Direction;

/// Snapshot of the product keyboard policy for one owner run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyboardConfig {
    /// Master takeover switch (CLI `--no-keyboard-snap-takeover` clears it).
    /// Default on; when off the hook is never installed.
    pub takeover: bool,
    /// Explicit opt-in for unshifted Win+L (CLI `--allow-win-l`).
    /// Default off; Win+Shift+L is unaffected.
    pub allow_win_l: bool,
}

impl KeyboardConfig {
    #[must_use]
    pub const fn disabled() -> Self {
        Self {
            takeover: false,
            allow_win_l: false,
        }
    }
}

pub const VK_G: u32 = 0x47;
pub const VK_H: u32 = 0x48;
pub const VK_J: u32 = 0x4A;
pub const VK_K: u32 = 0x4B;
pub const VK_L: u32 = 0x4C;
pub const VK_LEFT: u32 = 37;
pub const VK_UP: u32 = 38;
pub const VK_RIGHT: u32 = 39;
pub const VK_DOWN: u32 = 40;
pub const VK_LWIN: u32 = 91;
pub const VK_RWIN: u32 = 92;
pub const VK_M: u32 = 0x4D;
pub const VK_F11: u32 = 0x7A;
pub const VK_SHIFT: u32 = 16;
pub const VK_CONTROL: u32 = 17;
pub const VK_MENU: u32 = 18;
pub const VK_LSHIFT: u32 = 160;
pub const VK_RSHIFT: u32 = 161;
pub const VK_LCONTROL: u32 = 162;
pub const VK_RCONTROL: u32 = 163;
pub const VK_LMENU: u32 = 164;
pub const VK_RMENU: u32 = 165;
/// Unassigned VK for the Start-menu mask pair, same technique as the spike:
// the OS sees a keystroke while Win is held, so a consumed chord no longer
// looks like a naked Win tap, and no modifier state is perturbed.
pub const VK_MASK: u32 = 0xE8;

/// Fixed test-only injection marker for the `shortcut-proof` command
/// (`dwExtraInfo` on the synthetic `SendInput` records). ASCII "TLRPROOF":
/// recognizable in a debugger, never a real input tag. Product `tile`
/// installs with no marker and filters ALL `LLKHF_INJECTED`; only
/// `shortcut-proof` (frozen allowlist, owned helpers) accepts exactly this
/// value, and the owner recheck still gates every intent against fresh
/// observation. Never add marker acceptance to the product path.
pub const SHORTCUT_PROOF_MARKER: u64 = 0x544C52_50524F4F46;

/// Portable test-only injection decision: true only for the exact fixed
/// marker. Product passes `None` (never accepts); `shortcut-proof` passes
/// `Some(SHORTCUT_PROOF_MARKER)` and the caller additionally requires the
/// event's `dwExtraInfo` to equal the marker. Any other value passes through.
#[must_use]
pub const fn accept_proof_injected(extra_info: u64, proof: Option<u64>) -> bool {
    match proof {
        Some(marker) => marker == SHORTCUT_PROOF_MARKER && extra_info == SHORTCUT_PROOF_MARKER,
        None => false,
    }
}

/// Bounded callback intent queue. Saturation fails closed (pass-through) with
/// an explicit loss counter, so omissions can never masquerade as suppression.
pub const INTENT_QUEUE_CAP: usize = 512;
/// Maximum intents dispatched per owner iteration; the remainder stays queued
/// for the next iteration so an auto-repeat hold cannot starve the tick.
pub const MAX_DISPATCH_PER_TICK: usize = 8;

/// Which Engine route a chord takes. Core owns the semantics; this is only
/// the focus/move selector (unshifted vs Shift).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapOp {
    Focus,
    Move,
}

impl SnapOp {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::Move => "move",
        }
    }
}

/// Which key edge an approved chord represents. Repeats are held-key
/// auto-repeats; only downs and repeats dispatch, ups just close the pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapEdge {
    Down,
    Up,
    Repeat,
}

impl SnapEdge {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Down => "down",
            Self::Up => "up",
            Self::Repeat => "repeat",
        }
    }
}

/// Wire direction token shared with the Engine parser (`left`/`right`/
/// `up`/`down`). Single source for classifier evidence and dispatch.
#[must_use]
pub const fn direction_name(direction: Direction) -> &'static str {
    match direction {
        Direction::Left => "left",
        Direction::Right => "right",
        Direction::Up => "up",
        Direction::Down => "down",
    }
}

/// Classifier outcome for one approved catalog key event. `None` means the
/// input is unrelated, injected, extra-modified, or Win+L-gated: it passes
/// through untracked and is never logged. `consumed == false` means an
/// approved chord that passes through (takeover or the shortcut gate off)
/// and never dispatches; saturation drops only the queued evidence while
/// still swallowing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnapIntent {
    pub op: SnapOp,
    pub direction: Direction,
    pub edge: SnapEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

/// Catalog key index: 0-3 letters H/J/K/L, 4-7 arrows Left/Down/Up/Right.
pub(crate) fn catalog_index(vk: u32) -> Option<usize> {
    match vk {
        VK_H => Some(0),
        VK_J => Some(1),
        VK_K => Some(2),
        VK_L => Some(3),
        VK_LEFT => Some(4),
        VK_DOWN => Some(5),
        VK_UP => Some(6),
        VK_RIGHT => Some(7),
        _ => None,
    }
}

/// Digit virtual keys share the physical key with US shifted symbols:
/// no separate virtual key exists, Shift only flips select into send.
pub const VK_0: u32 = 0x30;
pub const VK_9: u32 = 0x39;

#[must_use]
pub const fn is_digit_vk(vk: u32) -> bool {
    vk >= VK_0 && vk <= VK_9
}

/// True for any chord key the single classifier owns: directional catalog
/// plus workspace digits plus the maximize, fullscreen, float, and sticky
/// toggles. Modifiers, Win keys, and ordinary keys are not chord keys.
#[must_use]
pub fn is_chord_vk(vk: u32) -> bool {
    catalog_index(vk).is_some()
        || is_digit_vk(vk)
        || is_maximize_vk(vk)
        || is_fullscreen_vk(vk)
        || is_float_vk(vk)
}

/// True only for the maximize-toggle chord key (Win+M, KDE Meta+M parity).
/// Shift/Ctrl/Alt select the directional/workspace arms instead: Win+Shift+M
/// and any Ctrl/Alt combination pass through untracked.
#[must_use]
pub const fn is_maximize_vk(vk: u32) -> bool {
    vk == VK_M
}

/// True only for the fullscreen-toggle chord key (Win+F11, KDE Meta+F11
/// parity). Like maximize, any Shift/Ctrl/Alt combination passes through
/// untracked: there is no shifted fullscreen arm.
#[must_use]
pub const fn is_fullscreen_vk(vk: u32) -> bool {
    vk == VK_F11
}

/// True only for the float-toggle chord key (Win+G, KDE Meta+G parity).
/// Unshifted G floats; shifted G is the sticky arm (see [`is_sticky_vk`]).
/// Any Ctrl/Alt combination passes through untracked.
#[must_use]
pub const fn is_float_vk(vk: u32) -> bool {
    vk == VK_G
}

/// True only for the sticky-toggle chord key (Win+Shift+G, KDE Meta+Shift+G
/// parity). Shares the G virtual key with float: Shift selects sticky,
/// unshifted selects float. Any Ctrl/Alt combination passes through
/// untracked.
#[must_use]
pub const fn is_sticky_vk(vk: u32) -> bool {
    vk == VK_G
}

/// Direction for a catalog index. Letters and arrows are exact aliases.
fn index_direction(idx: usize) -> Direction {
    match idx {
        0 | 4 => Direction::Left,
        1 | 5 => Direction::Down,
        2 | 6 => Direction::Up,
        _ => Direction::Right,
    }
}

/// True only for the letter L slot (unshifted Win+L is the OS lock chord).
fn is_letter_l(idx: usize) -> bool {
    idx == 3
}

/// Whether a live modifier/Win combination still matches a pinned directional
/// op: no extra modifiers, Win still held, Shift still selecting the pinned
/// op, and the Win+L opt-in still satisfied. Consumed-hold repeats stay
/// swallowed regardless; only this decides the repeat `announce` (dispatch).
fn snap_repeat_live(shift: bool, ctrl: bool, alt: bool, win: bool, op: SnapOp) -> bool {
    !ctrl && !alt && win && (shift == (op == SnapOp::Move))
}

/// Win+L opt-in fence for a pinned directional op: an unshifted (focus) L
/// without opt-in never dispatches, so a Shift+L move hold whose Shift is
/// released mid-hold swallows its repeats without dispatching.
fn snap_op_admits(idx: usize, op: SnapOp, allow_win_l: bool) -> bool {
    !(op == SnapOp::Focus && is_letter_l(idx) && !allow_win_l)
}

/// Whether a live modifier/Win combination still matches a pinned workspace
/// op: no extra modifiers, Win still held, Shift still selecting the pinned
/// op. Same swallow-but-don't-dispatch contract as [`snap_repeat_live`].
fn digit_repeat_live(shift: bool, ctrl: bool, alt: bool, win: bool, op: WorkspaceOp) -> bool {
    !ctrl && !alt && win && (shift == (op == WorkspaceOp::Send))
}

#[must_use]
pub fn is_win_vk(vk: u32) -> bool {
    vk == VK_LWIN || vk == VK_RWIN
}

fn is_modifier_vk(vk: u32) -> bool {
    matches!(
        vk,
        VK_SHIFT
            | VK_CONTROL
            | VK_MENU
            | VK_LSHIFT
            | VK_RSHIFT
            | VK_LCONTROL
            | VK_RCONTROL
            | VK_LMENU
            | VK_RMENU
    )
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SnapCounts {
    pub down: u32,
    pub up: u32,
    pub repeat: u32,
    pub consumed: u32,
    pub passed: u32,
}

/// Workspace digit op: unshifted selects an existing workspace, Shift sends
/// the focused tiled window. Single definition for hook dispatch and the
/// portable session policy (re-exported through `workspace::DigitOp`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceOp {
    Select,
    Send,
}

impl WorkspaceOp {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Send => "send",
        }
    }
}

/// Classifier outcome for one workspace digit event. Edges reuse the snap
/// vocabulary: only downs and repeats dispatch, ups close the pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkspaceIntent {
    pub op: WorkspaceOp,
    pub index: u8,
    pub edge: SnapEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

/// Classifier outcome for one maximize-toggle event (Win+M, KDE Meta+M
/// parity). The toggle carries no direction: only downs and repeats
/// dispatch, ups close the pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaximizeIntent {
    pub edge: SnapEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

/// Classifier outcome for one fullscreen-toggle event (Win+F11, KDE
/// Meta+F11 parity). The toggle carries no direction: only downs and repeats
/// dispatch, ups close the pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FullscreenIntent {
    pub edge: SnapEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

/// Classifier outcome for one float-toggle event (Win+G, KDE Meta+G
/// parity). The toggle carries no direction: only the down dispatches, ups
/// close the pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloatIntent {
    pub edge: SnapEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

/// Classifier outcome for one sticky-toggle event (Win+Shift+G, KDE
/// Meta+Shift+G parity). Same edge contract as float: only the down
/// dispatches, ups close the pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StickyIntent {
    pub edge: SnapEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

/// Unified classifier outcome: exactly one of directional, workspace,
/// maximize, fullscreen, or float. One machine, one modifier/mask authority;
/// maximize, fullscreen, and float share Win/Shift/Ctrl/Alt tracking, origin
/// pairing, saturation, and the E8 mask with H/J/K/L/arrows and digits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classified {
    Snap(SnapIntent),
    Workspace(WorkspaceIntent),
    Maximize(MaximizeIntent),
    Fullscreen(FullscreenIntent),
    Float(FloatIntent),
    Sticky(StickyIntent),
}

impl Classified {
    #[must_use]
    pub const fn consumed(self) -> bool {
        match self {
            Self::Snap(intent) => intent.consumed,
            Self::Workspace(intent) => intent.consumed,
            Self::Maximize(intent) => intent.consumed,
            Self::Fullscreen(intent) => intent.consumed,
            Self::Float(intent) => intent.consumed,
            Self::Sticky(intent) => intent.consumed,
        }
    }

    #[must_use]
    pub const fn announce(self) -> bool {
        match self {
            Self::Snap(intent) => intent.announce,
            Self::Workspace(intent) => intent.announce,
            Self::Maximize(intent) => intent.announce,
            Self::Fullscreen(intent) => intent.announce,
            Self::Float(intent) => intent.announce,
            Self::Sticky(intent) => intent.announce,
        }
    }
}

/// Which chord armed the Start-menu mask. Digits, maximize, fullscreen, and
/// float arm it exactly like directional chords: any consumed chord in the Win
/// hold needs the E8 pair at Win-up, or the OS opens Start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaskTrigger {
    Snap { op: SnapOp, direction: Direction },
    Workspace { op: WorkspaceOp, index: u8 },
    Maximize,
    Fullscreen,
    Float,
    Sticky,
}

/// Pure product chord classifier. Tracks both Win keys plus the Shift family
/// (chord selector) and Ctrl/Alt families (extra modifiers force
/// pass-through). Per-key down state carries the verdict of the hold: only a
/// hold that started consumed (takeover on with the shortcut gate active) can
/// consume, so a gate-off-origin sequence never consumes mid-hold and its
/// paired key-up is never stolen. Fresh downs consume iff `enabled` (takeover)
/// and the shortcut gate (`gate_active` plus the callback-passed gate) both
/// hold; consumed-hold repeats/ups ride the stored down verdict across later
/// gate transitions, and new chords while the gate is off pass through.
/// Unmanaged/unadmitted/shell foreground, fullscreen suspension, gesture, and
/// elevated foreground still consume while the gate holds (the owner rechecks
/// fresh identity/scope/elevation/fullscreen/gesture before any action, and
/// never manipulates protected windows). The op is fixed at down time from
/// the Shift state, so releasing Shift before the key-up cannot flip focus
/// into move (or select into send): repeats of a consumed hold stay swallowed
/// until the matching up, but only announce (dispatch) while the live
/// modifier/Win combination still matches the pinned op, so a bare-key
/// repeat after Win-up never re-dispatches.
///
/// `mask_pending` arms the Start-menu mask when a consumed chord lands in the
/// current Win hold. Unlike the spike, no passing transition disarms the
/// mask: a redundant E8 pair is safe while a naked Win Start is not, so a
/// consumed hold keeps its mask across foreground/gate changes, extra
/// modifiers, and ordinary keys until Win-up fires once per hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapClassify {
    win_l: bool,
    win_r: bool,
    shift: bool,
    ctrl: bool,
    alt: bool,
    key_down: [bool; 8],
    key_origin: [bool; 8],
    key_op: [Option<SnapOp>; 8],
    digit_down: [bool; 10],
    digit_origin: [bool; 10],
    digit_op: [Option<WorkspaceOp>; 10],
    maximize_down: bool,
    maximize_origin: bool,
    fullscreen_down: bool,
    fullscreen_origin: bool,
    float_down: bool,
    float_origin: bool,
    sticky_down: bool,
    sticky_origin: bool,
    pub enabled: bool,
    /// Shortcut-handling gate published by the owner (takeover plus the
    /// eventual pause source, e.g. Xbox detection). Fresh downs consume iff
    /// `enabled && gate_active` (combined with the callback-passed gate in
    /// [`classify_and_queue`]); consumed-hold repeats/ups ride the stored
    /// down verdict across later gate transitions. Defaults on so pure
    /// classifier tests keep working; the hook path sets it per event from
    /// the cached publish.
    pub gate_active: bool,
    pub allow_win_l: bool,
    pub counts: [SnapCounts; 8],
    pub digit_counts: [SnapCounts; 10],
    pub max_counts: SnapCounts,
    pub fullscreen_counts: SnapCounts,
    pub float_counts: SnapCounts,
    pub sticky_counts: SnapCounts,
    mask_pending: bool,
    mask_trigger: Option<MaskTrigger>,
    hold_masked: bool,
    pub mask_attempted: u32,
    pub mask_ok: u32,
    pub mask_failed: u32,
    pub mask_skipped: u32,
}

/// G-key arm selector: float (Win+G, KDE Meta+G) or sticky (Win+Shift+G,
/// KDE Meta+Shift+G). The op fixes at down time; repeats ride the armed hold
/// regardless of later Shift.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GArm {
    Float,
    Sticky,
}

impl SnapClassify {
    #[must_use]
    pub fn new(config: KeyboardConfig) -> Self {
        Self {
            win_l: false,
            win_r: false,
            shift: false,
            ctrl: false,
            alt: false,
            key_down: [false; 8],
            key_origin: [false; 8],
            key_op: [None; 8],
            digit_down: [false; 10],
            digit_origin: [false; 10],
            digit_op: [None; 10],
            maximize_down: false,
            maximize_origin: false,
            fullscreen_down: false,
            fullscreen_origin: false,
            float_down: false,
            float_origin: false,
            sticky_down: false,
            sticky_origin: false,
            enabled: config.takeover,
            gate_active: true,
            allow_win_l: config.allow_win_l,
            counts: [SnapCounts::default(); 8],
            digit_counts: [SnapCounts::default(); 10],
            max_counts: SnapCounts::default(),
            fullscreen_counts: SnapCounts::default(),
            float_counts: SnapCounts::default(),
            sticky_counts: SnapCounts::default(),
            mask_pending: false,
            mask_trigger: None,
            hold_masked: false,
            mask_attempted: 0,
            mask_ok: 0,
            mask_failed: 0,
            mask_skipped: 0,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn set_gate_active(&mut self, gate_active: bool) {
        self.gate_active = gate_active;
    }

    /// Tracked modifier state for the callback's preheld check
    /// `(ctrl, alt, shift)`. A physically held Ctrl/Alt the classifier never
    /// saw (held before install, or injected past the callback guard) forces
    /// pass-through to preserve unowned chords. Supported Shift binds from
    /// the official async sample instead (see `sync_shift_from_async`), so a
    /// preheld Shift correctly selects move/sticky/send rather than leaking.
    pub fn tracked_modifiers(&self) -> (bool, bool, bool) {
        (self.ctrl, self.alt, self.shift)
    }

    /// Bind supported Shift from the official async sample for a fresh chord
    /// down. Preheld Shift (held before install) still selects move/sticky/
    /// send; a missed Shift-up still resolves to focus. Holds already down
    /// keep their down-time op via stored origin, so syncing here never flips
    /// an armed hold.
    #[cfg(any(windows, test))]
    pub(crate) fn sync_shift_from_async(&mut self, async_shift: bool) {
        self.shift = async_shift;
    }

    /// Whether either Win key is currently held (tracked state).
    pub fn win_held(&self) -> bool {
        self.win_l || self.win_r
    }

    /// Whether a catalog key currently holds a down without its up.
    pub fn key_is_down(&self, vk: u32) -> bool {
        if let Some(idx) = catalog_index(vk) {
            return self.key_down[idx];
        }
        if is_digit_vk(vk) {
            return self.digit_down[(vk - VK_0) as usize];
        }
        if is_maximize_vk(vk) {
            return self.maximize_down;
        }
        if is_fullscreen_vk(vk) {
            return self.fullscreen_down;
        }
        if is_float_vk(vk) {
            return self.float_down || self.sticky_down;
        }
        if is_sticky_vk(vk) {
            return self.float_down || self.sticky_down;
        }
        false
    }

    fn note_win_down(&mut self, vk: u32) {
        let already = if vk == VK_LWIN {
            self.win_l
        } else {
            self.win_r
        };
        if already && self.hold_masked {
            // Naked Win auto-repeat after our mask re-arms the Start trigger.
            self.hold_masked = false;
            self.mask_pending = true;
        }
        if vk == VK_LWIN {
            self.win_l = true;
        } else {
            self.win_r = true;
        }
    }

    /// Physical Win-up bookkeeping + mask-fire decision. Returns the arming
    /// chord when the caller must send the E8 pair before passing this Win-up
    /// through. The Win-up itself always passes. `installed` is false on the
    /// state-only path, which updates bookkeeping without arming a send.
    fn win_up_needs_mask(&mut self, vk: u32, installed: bool) -> Option<MaskTrigger> {
        if vk == VK_LWIN {
            self.win_l = false;
        } else {
            self.win_r = false;
        }
        let trigger = if installed && self.mask_pending && !self.hold_masked {
            self.mask_trigger
        } else {
            None
        };
        if trigger.is_some() {
            self.mask_pending = false;
            self.hold_masked = true;
        }
        if !(self.win_l || self.win_r) {
            self.mask_pending = false;
            self.hold_masked = false;
            self.mask_trigger = None;
        }
        trigger
    }

    pub fn push(
        &mut self,
        vk: u32,
        is_up: bool,
        foreground: bool,
        injected: bool,
    ) -> Option<Classified> {
        if injected {
            return None;
        }
        if is_win_vk(vk) {
            if is_up {
                let _ = self.win_up_needs_mask(vk, false);
            } else {
                self.note_win_down(vk);
            }
            return None;
        }
        if is_modifier_vk(vk) {
            let held = !is_up;
            match vk {
                VK_CONTROL | VK_LCONTROL | VK_RCONTROL => {
                    self.ctrl = held;
                }
                VK_MENU | VK_LMENU | VK_RMENU => {
                    self.alt = held;
                }
                _ => {
                    self.shift = held;
                }
            }
            return None;
        }
        if is_digit_vk(vk) {
            return self.push_digit(vk, is_up, foreground);
        }
        if is_maximize_vk(vk) {
            return self.push_maximize(is_up, foreground);
        }
        if is_fullscreen_vk(vk) {
            return self.push_fullscreen(is_up, foreground);
        }
        if is_float_vk(vk) || is_sticky_vk(vk) {
            return self.push_g(is_up, foreground);
        }
        let idx = catalog_index(vk)?;
        let direction = index_direction(idx);
        if is_up {
            if !self.key_down[idx] {
                return None;
            }
            self.key_down[idx] = false;
            let origin = self.key_origin[idx];
            self.key_origin[idx] = false;
            let op = self.key_op[idx].unwrap_or(SnapOp::Focus);
            self.key_op[idx] = None;
            self.counts[idx].up += 1;
            if origin {
                self.counts[idx].consumed += 1;
                Some(Classified::Snap(SnapIntent {
                    op,
                    direction,
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: true,
                    announce: false,
                }))
            } else {
                self.counts[idx].passed += 1;
                Some(Classified::Snap(SnapIntent {
                    op,
                    direction,
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: false,
                    announce: false,
                }))
            }
        } else {
            // Armed-hold repeats classify BEFORE the fresh-chord guard: a
            // consumed hold stays swallowed until its matching up even when
            // Ctrl/Alt arrive mid-hold, Win is released early, or Shift
            // flips. Only the dispatch (`announce`) needs the live
            // combination to still match the pinned op.
            if self.key_down[idx] {
                self.counts[idx].repeat += 1;
                let op = self.key_op[idx].unwrap_or(SnapOp::Focus);
                if self.key_origin[idx] {
                    let live = self.enabled
                        && self.gate_active
                        && snap_repeat_live(
                            self.shift,
                            self.ctrl,
                            self.alt,
                            self.win_l || self.win_r,
                            op,
                        )
                        && snap_op_admits(idx, op, self.allow_win_l);
                    self.counts[idx].consumed += 1;
                    // Only a Win-held repeat rearms the Start-menu mask: a
                    // bare repeat after Win-up stays swallowed but must not
                    // create a new mask obligation, or a later naked Win tap
                    // would mask Start incorrectly.
                    if self.win_l || self.win_r {
                        self.mask_pending = true;
                        self.mask_trigger = Some(MaskTrigger::Snap { op, direction });
                    }
                    Some(Classified::Snap(SnapIntent {
                        op,
                        direction,
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: true,
                        announce: live,
                    }))
                } else {
                    self.counts[idx].passed += 1;
                    Some(Classified::Snap(SnapIntent {
                        op,
                        direction,
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            } else {
                if self.ctrl || self.alt || !(self.win_l || self.win_r) {
                    return None;
                }
                let op = if self.shift {
                    SnapOp::Move
                } else {
                    SnapOp::Focus
                };
                // Unshifted Win+L is the OS lock chord: without explicit opt-in it
                // passes through untracked, so its paired key-up also passes.
                // Established opt-in exception: an ordinary LL hook cannot
                // reliably intercept it; left unchanged.
                if op == SnapOp::Focus && is_letter_l(idx) && !self.allow_win_l {
                    return None;
                }
                self.key_down[idx] = true;
                let origin = self.enabled && self.gate_active;
                self.key_origin[idx] = origin;
                self.key_op[idx] = Some(op);
                self.counts[idx].down += 1;
                if origin {
                    self.counts[idx].consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(MaskTrigger::Snap { op, direction });
                    Some(Classified::Snap(SnapIntent {
                        op,
                        direction,
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: true,
                        announce: true,
                    }))
                } else {
                    self.counts[idx].passed += 1;
                    Some(Classified::Snap(SnapIntent {
                        op,
                        direction,
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            }
        }
    }

    /// Digit half of the unified classifier: same Win/Ctrl/Alt/armed-hold/
    /// gate/mask contract as the directional catalog. Shift flips select into
    /// send and is fixed at down time; the op rides the paired key-up.
    /// Consumed-hold repeats stay swallowed until the matching up but only
    /// announce while the live combination still matches the pinned op. Fresh
    /// downs consume iff takeover is on with the shortcut gate active; the
    /// owner rechecks fresh identity/scope/elevation/fullscreen/gesture
    /// before any action (send without a live managed origin settles as
    /// unmanaged, never acts on protected windows).
    fn push_digit(&mut self, vk: u32, is_up: bool, foreground: bool) -> Option<Classified> {
        let slot = (vk - VK_0) as usize;
        if is_up {
            if !self.digit_down[slot] {
                return None;
            }
            self.digit_down[slot] = false;
            let origin = self.digit_origin[slot];
            self.digit_origin[slot] = false;
            let op = self.digit_op[slot].unwrap_or(WorkspaceOp::Select);
            self.digit_op[slot] = None;
            self.digit_counts[slot].up += 1;
            if origin {
                self.digit_counts[slot].consumed += 1;
                Some(Classified::Workspace(WorkspaceIntent {
                    op,
                    index: slot as u8,
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: true,
                    announce: false,
                }))
            } else {
                self.digit_counts[slot].passed += 1;
                Some(Classified::Workspace(WorkspaceIntent {
                    op,
                    index: slot as u8,
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: false,
                    announce: false,
                }))
            }
        } else {
            // Armed-hold repeats classify before the fresh-chord guard, same
            // contract as the directional catalog: consumed holds stay
            // swallowed across mid-hold modifier/Win/Shift transitions (only
            // `announce` follows the live combination), passed holds stay
            // passed.
            if self.digit_down[slot] {
                self.digit_counts[slot].repeat += 1;
                let op = self.digit_op[slot].unwrap_or(WorkspaceOp::Select);
                if self.digit_origin[slot] {
                    let live = self.enabled
                        && self.gate_active
                        && digit_repeat_live(
                            self.shift,
                            self.ctrl,
                            self.alt,
                            self.win_l || self.win_r,
                            op,
                        );
                    self.digit_counts[slot].consumed += 1;
                    // Win-held repeats only rearm the mask; bare repeats
                    // after Win-up stay swallowed without a new obligation.
                    if self.win_l || self.win_r {
                        self.mask_pending = true;
                        self.mask_trigger = Some(MaskTrigger::Workspace {
                            op,
                            index: slot as u8,
                        });
                    }
                    Some(Classified::Workspace(WorkspaceIntent {
                        op,
                        index: slot as u8,
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: true,
                        announce: live,
                    }))
                } else {
                    self.digit_counts[slot].passed += 1;
                    Some(Classified::Workspace(WorkspaceIntent {
                        op,
                        index: slot as u8,
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            } else {
                if self.ctrl || self.alt || !(self.win_l || self.win_r) {
                    return None;
                }
                let op = if self.shift {
                    WorkspaceOp::Send
                } else {
                    WorkspaceOp::Select
                };
                self.digit_down[slot] = true;
                let origin = self.enabled && self.gate_active;
                self.digit_origin[slot] = origin;
                self.digit_op[slot] = Some(op);
                self.digit_counts[slot].down += 1;
                if origin {
                    self.digit_counts[slot].consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(MaskTrigger::Workspace {
                        op,
                        index: slot as u8,
                    });
                    Some(Classified::Workspace(WorkspaceIntent {
                        op,
                        index: slot as u8,
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: true,
                        announce: true,
                    }))
                } else {
                    self.digit_counts[slot].passed += 1;
                    Some(Classified::Workspace(WorkspaceIntent {
                        op,
                        index: slot as u8,
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            }
        }
    }

    /// Maximize-toggle half of the unified classifier (Win+M, KDE Meta+M
    /// parity): same Win/Ctrl/Alt/armed-hold/gate/mask contract as the
    /// directional catalog. Shift selects the directional move arm instead,
    /// so any held Shift (or Ctrl/Alt, or missing Win) passes a fresh M
    /// through untracked and the paired key-up also passes. A consumed hold
    /// stays swallowed across later Shift/Ctrl/Alt/Win transitions until its
    /// matching up. Only the down dispatches: KDE shortcuts are
    /// discrete per press, so held repeats are swallowed (mask stays armed)
    /// instead of re-toggling. Ups close the pair. Fresh downs consume iff
    /// takeover is on with the shortcut gate active; the owner rechecks fresh
    /// identity/scope/elevation/fullscreen/gesture before any action.
    fn push_maximize(&mut self, is_up: bool, foreground: bool) -> Option<Classified> {
        if is_up {
            if !self.maximize_down {
                return None;
            }
            self.maximize_down = false;
            let origin = self.maximize_origin;
            self.maximize_origin = false;
            self.max_counts.up += 1;
            if origin {
                self.max_counts.consumed += 1;
                Some(Classified::Maximize(MaximizeIntent {
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: true,
                    announce: false,
                }))
            } else {
                self.max_counts.passed += 1;
                Some(Classified::Maximize(MaximizeIntent {
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: false,
                    announce: false,
                }))
            }
        } else {
            // Armed-hold repeats classify before the fresh-chord guard: a
            // consumed M hold stays swallowed across later Shift/Ctrl/Alt/Win
            // transitions (never re-dispatched), a passed hold stays passed.
            if self.maximize_down {
                self.max_counts.repeat += 1;
                if self.maximize_origin {
                    // Held repeat: swallowed, never re-dispatched. A Win-held
                    // hold continues to disguise Win, so the mask stays
                    // armed; a bare repeat after Win-up must not create a new
                    // mask obligation.
                    self.max_counts.consumed += 1;
                    if self.win_l || self.win_r {
                        self.mask_pending = true;
                        self.mask_trigger = Some(MaskTrigger::Maximize);
                    }
                    Some(Classified::Maximize(MaximizeIntent {
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: true,
                        announce: false,
                    }))
                } else {
                    self.max_counts.passed += 1;
                    Some(Classified::Maximize(MaximizeIntent {
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            } else {
                if self.ctrl || self.alt || self.shift || !(self.win_l || self.win_r) {
                    return None;
                }
                self.maximize_down = true;
                let origin = self.enabled && self.gate_active;
                self.maximize_origin = origin;
                self.max_counts.down += 1;
                if origin {
                    self.max_counts.consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(MaskTrigger::Maximize);
                    Some(Classified::Maximize(MaximizeIntent {
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: true,
                        announce: true,
                    }))
                } else {
                    self.max_counts.passed += 1;
                    Some(Classified::Maximize(MaximizeIntent {
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            }
        }
    }

    /// Fullscreen-toggle half of the unified classifier (Win+F11, KDE Meta+F11
    /// parity): same Win/Ctrl/Alt/armed-hold/gate/mask contract as the
    /// maximize arm. Any held Shift (or Ctrl/Alt, or missing Win) passes a
    /// fresh F11 through untracked and the paired key-up also passes. A
    /// consumed hold stays swallowed across later transitions until its
    /// matching up. Only the down dispatches:
    /// held repeats are swallowed (mask stays armed) instead of re-toggling.
    /// Ups close the pair. Fresh downs consume iff takeover is on with the
    /// shortcut gate active; the owner rechecks fresh identity/scope/
    /// elevation/fullscreen/gesture before any action.
    fn push_fullscreen(&mut self, is_up: bool, foreground: bool) -> Option<Classified> {
        if is_up {
            if !self.fullscreen_down {
                return None;
            }
            self.fullscreen_down = false;
            let origin = self.fullscreen_origin;
            self.fullscreen_origin = false;
            self.fullscreen_counts.up += 1;
            if origin {
                self.fullscreen_counts.consumed += 1;
                Some(Classified::Fullscreen(FullscreenIntent {
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: true,
                    announce: false,
                }))
            } else {
                self.fullscreen_counts.passed += 1;
                Some(Classified::Fullscreen(FullscreenIntent {
                    edge: SnapEdge::Up,
                    foreground,
                    consumed: false,
                    announce: false,
                }))
            }
        } else {
            // Armed-hold repeats classify before the fresh-chord guard, same
            // contract as maximize: consumed holds stay swallowed, passed
            // holds stay passed.
            if self.fullscreen_down {
                self.fullscreen_counts.repeat += 1;
                if self.fullscreen_origin {
                    // Held repeat: swallowed, never re-dispatched. A Win-held
                    // hold continues to disguise Win, so the mask stays
                    // armed; a bare repeat after Win-up must not create a new
                    // mask obligation.
                    self.fullscreen_counts.consumed += 1;
                    if self.win_l || self.win_r {
                        self.mask_pending = true;
                        self.mask_trigger = Some(MaskTrigger::Fullscreen);
                    }
                    Some(Classified::Fullscreen(FullscreenIntent {
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: true,
                        announce: false,
                    }))
                } else {
                    self.fullscreen_counts.passed += 1;
                    Some(Classified::Fullscreen(FullscreenIntent {
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            } else {
                if self.ctrl || self.alt || self.shift || !(self.win_l || self.win_r) {
                    return None;
                }
                self.fullscreen_down = true;
                let origin = self.enabled && self.gate_active;
                self.fullscreen_origin = origin;
                self.fullscreen_counts.down += 1;
                if origin {
                    self.fullscreen_counts.consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(MaskTrigger::Fullscreen);
                    Some(Classified::Fullscreen(FullscreenIntent {
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: true,
                        announce: true,
                    }))
                } else {
                    self.fullscreen_counts.passed += 1;
                    Some(Classified::Fullscreen(FullscreenIntent {
                        edge: SnapEdge::Down,
                        foreground,
                        consumed: false,
                        announce: false,
                    }))
                }
            }
        }
    }

    /// Shared G-key dispatcher (Win+G float, Win+Shift+G sticky, KDE
    /// Meta+G / Meta+Shift+G parity). The op is fixed at down time from the
    /// Shift state, so releasing Shift before the key-up cannot flip float
    /// into sticky (or vice versa); repeats ride the armed hold regardless of
    /// later Shift. Ctrl/Alt or a missing Win passes through untracked.
    /// Ups close whichever hold is armed; untracked ups return `None`.
    fn push_g(&mut self, is_up: bool, foreground: bool) -> Option<Classified> {
        if is_up {
            if self.float_down {
                return self.push_g_arm(GArm::Float, is_up, foreground);
            }
            if self.sticky_down {
                return self.push_g_arm(GArm::Sticky, is_up, foreground);
            }
            return None;
        }
        if self.float_down {
            return self.push_g_arm(GArm::Float, is_up, foreground);
        }
        if self.sticky_down {
            return self.push_g_arm(GArm::Sticky, is_up, foreground);
        }
        if self.shift {
            return self.push_g_arm(GArm::Sticky, is_up, foreground);
        }
        self.push_g_arm(GArm::Float, is_up, foreground)
    }

    /// Shared G-key arm (float and sticky halves): same Win/Ctrl/Alt/
    /// armed-hold/gate/mask contract as the maximize arm. A fresh down routes
    /// by Shift; held repeats ride the armed hold regardless of later Shift.
    /// Only the down dispatches: held repeats are swallowed (mask stays
    /// armed) instead of re-toggling. Ups close the pair. Fresh downs consume
    /// iff takeover is on with the shortcut gate active; the owner rechecks
    /// fresh identity/scope/elevation/fullscreen/gesture before any action.
    fn push_g_arm(&mut self, arm: GArm, is_up: bool, foreground: bool) -> Option<Classified> {
        let sticky = arm == GArm::Sticky;
        let shift = self.shift;
        let trigger = if sticky {
            MaskTrigger::Sticky
        } else {
            MaskTrigger::Float
        };
        let (down, origin, counts) = if sticky {
            (
                &mut self.sticky_down,
                &mut self.sticky_origin,
                &mut self.sticky_counts,
            )
        } else {
            (
                &mut self.float_down,
                &mut self.float_origin,
                &mut self.float_counts,
            )
        };
        let intent = |edge: SnapEdge, consumed: bool, announce: bool| {
            if sticky {
                Classified::Sticky(StickyIntent {
                    edge,
                    foreground,
                    consumed,
                    announce,
                })
            } else {
                Classified::Float(FloatIntent {
                    edge,
                    foreground,
                    consumed,
                    announce,
                })
            }
        };
        if is_up {
            if !*down {
                return None;
            }
            *down = false;
            let had_origin = *origin;
            *origin = false;
            counts.up += 1;
            if had_origin {
                counts.consumed += 1;
                Some(intent(SnapEdge::Up, true, false))
            } else {
                counts.passed += 1;
                Some(intent(SnapEdge::Up, false, false))
            }
        } else {
            // Armed-hold repeats classify before the fresh-chord guard: a
            // consumed G hold stays swallowed across later Ctrl/Alt/Win/Shift
            // transitions (never flipping arms), a passed hold stays passed.
            if *down {
                counts.repeat += 1;
                if *origin {
                    // Held repeat: swallowed, never re-dispatched. A Win-held
                    // hold continues to disguise Win, so the mask stays
                    // armed; a bare repeat after Win-up must not create a new
                    // mask obligation. Shift is op-fixed at down time: a
                    // later Shift never flips this repeat into the other arm.
                    counts.consumed += 1;
                    if self.win_l || self.win_r {
                        self.mask_pending = true;
                        self.mask_trigger = Some(trigger);
                    }
                    Some(intent(SnapEdge::Repeat, true, false))
                } else {
                    counts.passed += 1;
                    Some(intent(SnapEdge::Repeat, false, false))
                }
            } else {
                if self.ctrl || self.alt || !(self.win_l || self.win_r) {
                    return None;
                }
                if shift != sticky {
                    // The other arm owns this Shift state: the dispatcher
                    // routes fresh downs there, never here.
                    return None;
                }
                *down = true;
                let has_origin = self.enabled && self.gate_active;
                *origin = has_origin;
                counts.down += 1;
                if has_origin {
                    counts.consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(trigger);
                    Some(intent(SnapEdge::Down, true, true))
                } else {
                    counts.passed += 1;
                    Some(intent(SnapEdge::Down, false, false))
                }
            }
        }
    }
}

#[cfg(test)]
mod shift_sync_tests {
    use super::{KeyboardConfig, SnapOp, VK_LWIN};

    fn enabled() -> KeyboardConfig {
        KeyboardConfig {
            takeover: true,
            allow_win_l: true,
        }
    }

    #[test]
    fn preheld_shift_selects_move_on_fresh_down() {
        // Preheld Shift (held before install, tracked state clear) binds from
        // the async sample so the fresh down resolves move, not focus.
        let mut m = super::SnapClassify::new(enabled());
        super::SnapClassify::push(&mut m, VK_LWIN, false, true, false);
        assert!(!m.tracked_modifiers().2);
        m.sync_shift_from_async(true);
        let down = super::SnapClassify::push(&mut m, super::VK_H, false, true, false)
            .and_then(|ev| match ev {
                super::Classified::Snap(intent) => Some(intent),
                _ => None,
            })
            .expect("fresh down");
        assert_eq!(down.op, SnapOp::Move);
        assert!(down.consumed);
    }

    #[test]
    fn missed_shift_up_resolves_focus_on_fresh_down() {
        // Missed Shift-up (tracked held, physical released) syncs back so a
        // fresh down resolves focus, not a stale move.
        let mut m = super::SnapClassify::new(enabled());
        super::SnapClassify::push(&mut m, VK_LWIN, false, true, false);
        super::SnapClassify::push(&mut m, super::VK_SHIFT, false, true, false);
        assert!(m.tracked_modifiers().2);
        m.sync_shift_from_async(false);
        let down = super::SnapClassify::push(&mut m, super::VK_H, false, true, false)
            .and_then(|ev| match ev {
                super::Classified::Snap(intent) => Some(intent),
                _ => None,
            })
            .expect("fresh down");
        assert_eq!(down.op, SnapOp::Focus);
    }

    #[test]
    fn armed_hold_keeps_down_time_op_across_sync() {
        // Syncing Shift mid-hold never flips the armed op: repeats and the
        // paired up ride the pinned down-time op.
        let mut m = super::SnapClassify::new(enabled());
        super::SnapClassify::push(&mut m, VK_LWIN, false, true, false);
        let down = super::SnapClassify::push(&mut m, super::VK_H, false, true, false)
            .and_then(|ev| match ev {
                super::Classified::Snap(intent) => Some(intent),
                _ => None,
            })
            .expect("fresh down");
        assert_eq!(down.op, SnapOp::Focus);
        m.sync_shift_from_async(true);
        let repeat = super::SnapClassify::push(&mut m, super::VK_H, false, true, false)
            .and_then(|ev| match ev {
                super::Classified::Snap(intent) => Some(intent),
                _ => None,
            })
            .expect("repeat");
        assert_eq!(repeat.op, SnapOp::Focus);
        assert!(repeat.consumed);
        assert!(
            !repeat.announce,
            "shift-flipped repeat swallows without dispatch"
        );
        let up = super::SnapClassify::push(&mut m, super::VK_H, true, true, false)
            .and_then(|ev| match ev {
                super::Classified::Snap(intent) => Some(intent),
                _ => None,
            })
            .expect("paired up");
        assert_eq!(up.op, SnapOp::Focus);
        assert!(up.consumed);
    }
}

/// One Start-menu mask reservation: the arming chord plus the Win-up instant
/// and the SendInput result stamped after the send, so a short write can never
/// be logged as success.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueuedMask {
    pub trigger: MaskTrigger,
    pub tick: std::time::Instant,
    pub inserted: u8,
    pub release_sent: bool,
}

/// Managed-window origin bound at chord time. `hwnd`/`pid`/`creation` are the
/// process-lifetime evidence the owner rechecks against fresh observation (a
/// recycled HWND never matches); only `token` may enter logs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapOrigin {
    pub hwnd: u64,
    pub token: String,
    pub pid: u32,
    pub creation: String,
}

/// Owner-side verdict for one queued intent against fresh observation.
/// `Dispatch` carries the verified token to act from; `continued` marks an
/// explicitly verified owner-caused focus advance (a prior actuation in the
/// same batch), the only case where the dispatch window may differ from the
/// chord origin. `Reject` carries the settled outcome: `origin-vanished` when
/// the origin HWND/identity is gone or recycled, `foreground-changed` when an
/// external focus move must never be silently retargeted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OriginVerdict {
    Dispatch { token: String, continued: bool },
    Reject(&'static str),
}

fn triple_matches(window: &SnapOrigin, hwnd: u64, token: &str, pid: u32, creation: &str) -> bool {
    window.hwnd == hwnd && window.token == token && window.pid == pid && window.creation == creation
}

/// Bind a chord origin to fresh observation. Pure over the owner's completed
/// observation plus the fresh foreground HWND: no native calls, no Engine.
#[must_use]
pub fn resolve_origin(
    origin: &SnapOrigin,
    foreground_hwnd: Option<u64>,
    fresh: &[SnapOrigin],
    owned_advance: Option<&SnapOrigin>,
) -> OriginVerdict {
    let origin_live = fresh
        .iter()
        .any(|w| triple_matches(w, origin.hwnd, &origin.token, origin.pid, &origin.creation));
    if !origin_live {
        return OriginVerdict::Reject("origin-vanished");
    }
    if foreground_hwnd == Some(origin.hwnd) {
        return OriginVerdict::Dispatch {
            token: origin.token.clone(),
            continued: false,
        };
    }
    if let Some(advance) = owned_advance
        && let Some(fg) = foreground_hwnd
        && let Some(window) = fresh
            .iter()
            .find(|w| triple_matches(w, fg, &advance.token, advance.pid, &advance.creation))
    {
        return OriginVerdict::Dispatch {
            token: window.token.clone(),
            continued: true,
        };
    }
    OriginVerdict::Reject("foreground-changed")
}

/// One approved chord captured by the callback. `origin` is the managed
/// identity bound at chord time (`None` means background/inactive at chord
/// time); `tick` is `Instant::now()` read in the callback (cheap,
/// monotonic); wall-clock anchoring happens outside the callback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedIntent {
    pub op: SnapOp,
    pub direction: Direction,
    pub edge: SnapEdge,
    pub origin: Option<SnapOrigin>,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

/// One approved workspace chord captured by the callback. `origin` is the
/// managed identity bound at chord time (`None` means background/inactive or
/// unmanaged foreground at chord time); select dispatches without an origin
/// while send requires one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedWorkspaceIntent {
    pub op: WorkspaceOp,
    pub index: u8,
    pub edge: SnapEdge,
    pub origin: Option<SnapOrigin>,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

/// One approved maximize chord captured by the callback. `origin` is the
/// managed identity bound at chord time (`None` means background/inactive or
/// unmanaged foreground at chord time); without an origin the toggle never
/// dispatches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedMaximizeIntent {
    pub edge: SnapEdge,
    pub origin: Option<SnapOrigin>,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

/// One approved fullscreen chord captured by the callback. `origin` is the
/// managed identity bound at chord time (`None` means background/inactive or
/// unmanaged foreground at chord time); without an origin the toggle never
/// dispatches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedFullscreenIntent {
    pub edge: SnapEdge,
    pub origin: Option<SnapOrigin>,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

/// One approved float chord captured by the callback. `origin` is the
/// managed identity bound at chord time (`None` means background/inactive or
/// unmanaged foreground at chord time); without an origin the toggle never
/// dispatches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedFloatIntent {
    pub edge: SnapEdge,
    pub origin: Option<SnapOrigin>,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

/// One approved sticky chord captured by the callback. Same origin contract
/// as float; without an origin the toggle never dispatches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedStickyIntent {
    pub edge: SnapEdge,
    pub origin: Option<SnapOrigin>,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueuedSnapEvent {
    Intent(QueuedIntent),
    Workspace(QueuedWorkspaceIntent),
    Maximize(QueuedMaximizeIntent),
    Fullscreen(QueuedFullscreenIntent),
    Float(QueuedFloatIntent),
    Sticky(QueuedStickyIntent),
    Mask(QueuedMask),
}

/// Bounded preallocated FIFO from the callback to the owner. `push` refuses
/// past capacity and counts the loss; the classifier's suppression verdict
/// remains authoritative even when action evidence cannot be queued.
#[derive(Debug)]
pub struct SnapQueue {
    inner: std::collections::VecDeque<QueuedSnapEvent>,
    pub dropped: u32,
}

impl SnapQueue {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: std::collections::VecDeque::with_capacity(INTENT_QUEUE_CAP),
            dropped: 0,
        }
    }

    #[must_use]
    pub fn is_full(&self) -> bool {
        self.inner.len() >= INTENT_QUEUE_CAP
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Returns false (and counts the loss) when full.
    pub fn push(&mut self, ev: QueuedSnapEvent) -> bool {
        if self.is_full() {
            self.dropped += 1;
            return false;
        }
        self.inner.push_back(ev);
        true
    }

    pub fn record_drop(&mut self) {
        self.dropped += 1;
    }

    pub fn pop_front(&mut self) -> Option<QueuedSnapEvent> {
        self.inner.pop_front()
    }

    /// Newest record, for stamping a mask result right after its send. Safe
    /// because reserve, send, and stamp run synchronously on the hook thread
    /// with no drain interleaving; reentrant injected events never touch the
    /// queue.
    pub fn back_mut(&mut self) -> Option<&mut QueuedSnapEvent> {
        self.inner.back_mut()
    }
}

impl Default for SnapQueue {
    fn default() -> Self {
        Self::new()
    }
}

/// Saturation-aware gate shared by the hook callback and tests. Classifier
/// suppression/pairing/mask semantics always advance; when full only the
/// queued action/trace evidence is dropped (bounded `dropped` counter) while
/// the callback verdict still swallows owned chords. Injected and unrelated
/// inputs never touch the queue or the loss counter. `origin` is the
/// callback-bound managed identity (`None` when background/inactive or
/// unmanaged); `gate_active` is the callback-passed shortcut-handling gate
/// (owner-published, takeover-based until documented Xbox detection exists).
/// Fresh downs consume iff the machine is enabled and both the machine gate
/// and the passed gate hold; consumed-hold repeats/ups ride the stored down
/// verdict across later gate transitions, while new chords while the gate is
/// off pass through with their pair. The mask survives across the paired
/// sequence. Action safety stays with the owner's fresh per-intent rechecks.
/// Returns whether the callback must swallow the key event.
#[allow(clippy::too_many_arguments)]
pub fn classify_and_queue(
    machine: &mut SnapClassify,
    queue: &mut SnapQueue,
    vk: u32,
    is_up: bool,
    origin: Option<SnapOrigin>,
    injected: bool,
    tick: std::time::Instant,
    gate_active: bool,
) -> Option<bool> {
    // The passed gate joins the machine gate for this event only: either off
    // keeps fresh downs passing, while armed holds keep their down verdict via
    // the stored origin and the field restores afterwards.
    let saved_gate = machine.gate_active;
    machine.set_gate_active(saved_gate && gate_active);
    let ev = machine.push(vk, is_up, origin.is_some(), injected);
    machine.set_gate_active(saved_gate);
    let ev = ev?;
    let consumed = ev.consumed();
    let event = match ev {
        Classified::Snap(intent) => QueuedSnapEvent::Intent(QueuedIntent {
            op: intent.op,
            direction: intent.direction,
            edge: intent.edge,
            origin,
            consumed: intent.consumed,
            announce: intent.announce,
            tick,
        }),
        Classified::Workspace(intent) => QueuedSnapEvent::Workspace(QueuedWorkspaceIntent {
            op: intent.op,
            index: intent.index,
            edge: intent.edge,
            origin,
            consumed: intent.consumed,
            announce: intent.announce,
            tick,
        }),
        Classified::Maximize(intent) => QueuedSnapEvent::Maximize(QueuedMaximizeIntent {
            edge: intent.edge,
            origin,
            consumed: intent.consumed,
            announce: intent.announce,
            tick,
        }),
        Classified::Fullscreen(intent) => QueuedSnapEvent::Fullscreen(QueuedFullscreenIntent {
            edge: intent.edge,
            origin,
            consumed: intent.consumed,
            announce: intent.announce,
            tick,
        }),
        Classified::Float(intent) => QueuedSnapEvent::Float(QueuedFloatIntent {
            edge: intent.edge,
            origin,
            consumed: intent.consumed,
            announce: intent.announce,
            tick,
        }),
        Classified::Sticky(intent) => QueuedSnapEvent::Sticky(QueuedStickyIntent {
            edge: intent.edge,
            origin,
            consumed: intent.consumed,
            announce: intent.announce,
            tick,
        }),
    };
    if queue.is_full() {
        queue.record_drop();
        return Some(consumed);
    }
    if queue.push(event) {
        Some(consumed)
    } else {
        queue.record_drop();
        Some(consumed)
    }
}

/// Win-up mask reservation shared by the hook callback and tests. Reserves
/// queue evidence BEFORE any SendInput and returns true when the caller must
/// send the E8 pair. When full only the oldest queued action/trace evidence
/// is dropped (bounded `dropped`) to make room for the necessary mask, so a
/// necessary mask is never skipped; send-result counters still reflect the
/// actual SendInput outcome via [`stamp_mask_result`]. The Win-up itself
/// always passes through.
pub fn win_up_mask_reserve(
    machine: &mut SnapClassify,
    queue: &mut SnapQueue,
    vk: u32,
    installed: bool,
    tick: std::time::Instant,
) -> bool {
    let Some(trigger) = machine.win_up_needs_mask(vk, installed) else {
        return false;
    };
    if queue.is_full() {
        // Graceful saturation: drop oldest action/trace evidence (bounded,
        // no alloc/log, callback stays prompt) to reserve the necessary
        // mask. The dropped action is counted; the mask send still runs and
        // its actual result is stamped.
        if queue.pop_front().is_some() {
            queue.record_drop();
        }
    }
    if queue.push(QueuedSnapEvent::Mask(QueuedMask {
        trigger,
        tick,
        inserted: 0,
        release_sent: false,
    })) {
        machine.mask_attempted += 1;
        true
    } else {
        // Still no room (defensive): count the skip and restore the hold so
        // a later Win-up in the same hold can retry. Nothing was injected.
        machine.mask_skipped += 1;
        if machine.win_l || machine.win_r {
            machine.hold_masked = false;
            machine.mask_pending = true;
            machine.mask_trigger = Some(trigger);
        }
        false
    }
}

/// Records a completed mask send into the reserved slot. `inserted` is the
/// SendInput accepted-event count (0..=2); `release_sent` reports the single
/// bounded E8-up attempt after a partial insert. Only a clean pair counts
/// as success.
pub fn stamp_mask_result(
    machine: &mut SnapClassify,
    queue: &mut SnapQueue,
    inserted: u8,
    release_sent: bool,
) {
    if inserted == 2 && !release_sent {
        machine.mask_ok += 1;
    } else {
        machine.mask_failed += 1;
    }
    if let Some(QueuedSnapEvent::Mask(slot)) = queue.back_mut() {
        slot.inserted = inserted;
        slot.release_sent = release_sent;
    }
}

/// Proof-only callback diagnostic: one accepted MARKED synthetic event as the
/// LL callback actually saw it (`vk`/`scan` from `KBDLLHOOKSTRUCT`), plus the
/// classifier modifier state before/after and, for catalog key downs, the
/// async-modifier sample and the preheld-guard verdict that gated the event.
///
/// Recorded only in `shortcut-proof` (the only mode whose hook state carries
/// a marker), only for events carrying exactly `SHORTCUT_PROOF_MARKER`, and
/// written only to the proof audit, never to production logs. Real (unmarked)
/// keystrokes are never recorded, so this cannot become raw keystroke
/// logging. Bounded at [`MARKED_DIAG_CAP`] with an explicit drop counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarkedKeyDiag {
    /// `vkCode` as delivered to the callback.
    pub vk: u32,
    /// `scanCode` as delivered to the callback.
    pub scan: u32,
    /// `LLKHF_UP` was set.
    pub is_up: bool,
    /// Either Win key tracked held before this event.
    pub win: bool,
    /// Tracked Shift before this event.
    pub shift_before: bool,
    /// Tracked Shift after this event.
    pub shift_after: bool,
    /// Tracked Ctrl/Alt before this event.
    pub ctrl: bool,
    /// Tracked Alt before this event.
    pub alt: bool,
    /// `GetAsyncKeyState(VK_SHIFT)` at a catalog key down; always false for
    /// non-catalog events (no async sample is taken there).
    pub async_shift: bool,
    /// The preheld guard passed this catalog down through (`true`) instead
    /// of classifying it; always false for non-catalog events.
    pub guard_disagree: bool,
    /// `classify_and_queue` returned `Some(true)` for this event (catalog
    /// downs that passed the guard get this stamped after classification).
    pub consumed: bool,
}

/// Bound on proof-only callback diagnostics per hook lifetime.
pub const MARKED_DIAG_CAP: usize = 64;

/// Bounded FIFO for proof-only callback diagnostics. Past capacity the oldest
/// record is evicted and the loss is counted, so the callback fails closed
/// and omissions can never masquerade as delivery.
#[derive(Debug, Default)]
pub struct MarkedDiagBuf {
    inner: std::collections::VecDeque<MarkedKeyDiag>,
    pub dropped: u32,
}

impl MarkedDiagBuf {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: std::collections::VecDeque::with_capacity(MARKED_DIAG_CAP),
            dropped: 0,
        }
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn push(&mut self, diag: MarkedKeyDiag) {
        if self.inner.len() >= MARKED_DIAG_CAP {
            self.inner.pop_front();
            self.dropped += 1;
        }
        self.inner.push_back(diag);
    }

    pub fn drain(&mut self) -> Vec<MarkedKeyDiag> {
        self.inner.drain(..).collect()
    }

    #[cfg(windows)]
    fn back_mut(&mut self) -> Option<&mut MarkedKeyDiag> {
        self.inner.back_mut()
    }
}

/// Proof-audit evidence for one marked callback event. Carries the synthetic
/// test chord's key identity and classifier/guard state only: no HWNDs, PIDs,
/// tokens, titles, or any native identity.
#[must_use]
pub fn marked_diag_evidence(diag: &MarkedKeyDiag) -> serde_json::Value {
    serde_json::json!({
        "vk": diag.vk,
        "scan": diag.scan,
        "edge": if diag.is_up { "up" } else { "down" },
        "win": diag.win,
        "shift_before": diag.shift_before,
        "shift_after": diag.shift_after,
        "ctrl": diag.ctrl,
        "alt": diag.alt,
        "async_shift": diag.async_shift,
        "guard_disagree": diag.guard_disagree,
        "consumed": diag.consumed,
    })
}

/// Proof-only source of a NON-marked modifier callback event. Marked
/// (accepted synthetic) events stay exclusively in [`MarkedKeyDiag`]; this
/// covers the complement both live runs need to distinguish actual delivery
/// from classifier state: marker-rejected injected modifiers (passed through,
/// classifier untouched) and non-injected modifiers (classified as physical,
/// may move tracked state while recording nothing elsewhere).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModSource {
    /// Injected but marker-rejected: passed through, classifier untouched.
    InjectedFiltered,
    /// Non-injected: classified as physical; may move tracked modifier state.
    Physical,
}

impl ModSource {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InjectedFiltered => "injected-filtered",
            Self::Physical => "physical",
        }
    }
}

/// Proof-only callback diagnostic for one non-marked MODIFIER event
/// ([`is_proof_mod_vk`]). No catalog keys, no ordinary keys, no content:
/// modifiers carry no typed text. Recorded only in `shortcut-proof` (the only
/// mode whose hook state carries a marker); the product path records nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModTrafficDiag {
    /// `vkCode` as delivered to the callback.
    pub vk: u32,
    /// `scanCode` as delivered to the callback.
    pub scan: u32,
    /// `LLKHF_UP` was set.
    pub is_up: bool,
    /// How the callback sourced this event.
    pub source: ModSource,
    /// Either Win key tracked held before/after this event.
    pub win_before: bool,
    /// Either Win key tracked held after this event.
    pub win_after: bool,
    /// Tracked Shift before this event.
    pub shift_before: bool,
    /// Tracked Shift after this event.
    pub shift_after: bool,
    /// Tracked Ctrl before this event.
    pub ctrl: bool,
    /// Tracked Alt before this event.
    pub alt: bool,
}

/// True for Win keys plus the Shift/Ctrl/Alt families: the only VKs the
/// proof-only modifier-traffic buffer may record. Everything else (catalog
/// keys, E8 mask, ordinary keys) is never recorded there.
#[must_use]
pub fn is_proof_mod_vk(vk: u32) -> bool {
    is_win_vk(vk) || is_modifier_vk(vk)
}

/// Bound on proof-only modifier-traffic diagnostics per hook lifetime.
pub const MOD_DIAG_CAP: usize = 64;

/// Bounded FIFO for proof-only modifier-traffic diagnostics. Past capacity
/// the oldest record is evicted and the loss is counted, so the callback
/// fails closed and omissions can never masquerade as delivery.
#[derive(Debug, Default)]
pub struct ModDiagBuf {
    inner: std::collections::VecDeque<ModTrafficDiag>,
    pub dropped: u32,
}

impl ModDiagBuf {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: std::collections::VecDeque::with_capacity(MOD_DIAG_CAP),
            dropped: 0,
        }
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn push(&mut self, diag: ModTrafficDiag) {
        if self.inner.len() >= MOD_DIAG_CAP {
            self.inner.pop_front();
            self.dropped += 1;
        }
        self.inner.push_back(diag);
    }

    pub fn drain(&mut self) -> Vec<ModTrafficDiag> {
        self.inner.drain(..).collect()
    }
}

/// Proof-audit evidence for one non-marked modifier callback event. Carries
/// key identity (modifiers only) and tracked before/after state: no HWNDs,
/// PIDs, tokens, titles, or any native identity.
#[must_use]
pub fn mod_diag_evidence(diag: &ModTrafficDiag) -> serde_json::Value {
    serde_json::json!({
        "vk": diag.vk,
        "scan": diag.scan,
        "edge": if diag.is_up { "up" } else { "down" },
        "source": diag.source.as_str(),
        "win_before": diag.win_before,
        "win_after": diag.win_after,
        "shift_before": diag.shift_before,
        "shift_after": diag.shift_after,
        "ctrl": diag.ctrl,
        "alt": diag.alt,
    })
}

/// Where one callback event came from, for the trace-only callback summary.
/// `Physical` is a non-injected event; `ProofMarked` is an injected event
/// carrying exactly [`SHORTCUT_PROOF_MARKER`] (only possible in
/// `shortcut-proof`); `InjectedFiltered` passed through untouched by the
/// product injection filter (including the untagged own E8 reentry).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallbackSource {
    Physical,
    ProofMarked,
    InjectedFiltered,
}

impl CallbackSource {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Physical => "physical",
            Self::ProofMarked => "proof-marked",
            Self::InjectedFiltered => "injected-filtered",
        }
    }
}

/// Why the callback produced its verdict, for the trace-only summary.
/// `ModifierGuard` is the preheld Ctrl/Alt pass-through; `WinUpPass` is a
/// Win-up (always passes, mask handled separately); `Unclassified` never
/// touched the queue (extra modifiers, Win+L gate, non-catalog, or gate-off
/// fresh chords); `Consumed`/`Passed` mirror `classify_and_queue`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallbackReason {
    InjectedFiltered,
    ModifierGuard,
    Unclassified,
    Consumed,
    Passed,
    WinUpPass,
}

impl CallbackReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InjectedFiltered => "injected-filtered",
            Self::ModifierGuard => "modifier-guard",
            Self::Unclassified => "unclassified",
            Self::Consumed => "consumed",
            Self::Passed => "passed",
            Self::WinUpPass => "win-up-pass",
        }
    }
}

/// Trace-only callback summary for one hook event. `vk`/`scan` are recorded
/// ONLY for the closed vocabulary below (never typed content, HWNDs, PIDs,
/// tokens, or titles): Win keys, the Shift/Ctrl/Alt families, the unassigned
/// E8 mask, and catalog chord keys with Win held/armed or proof-marked.
/// `duration_us` is the local callback elapsed before passing onward
/// (classification/reserve only, excluding any mask `SendInput` plus the
/// downstream hook chain, whose latency is not ours: mask send latency is
/// reported separately via the hook mask-send aggregate, and time spent in
/// hooks below ours is never observable here).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CallbackDiag {
    pub vk: u32,
    pub scan: u32,
    pub is_up: bool,
    pub source: CallbackSource,
    pub reason: CallbackReason,
    pub win_before: bool,
    pub win_after: bool,
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    /// The preheld Ctrl/Alt guard fired for this fresh chord down.
    pub guard_disagree: bool,
    /// A catalog chord observed without tracked Win (preheld Win before
    /// install, or a bare repeat after Win-up on an armed hold).
    pub win_untracked: bool,
    /// `classify_and_queue` returned `Some(true)`.
    pub consumed: bool,
    /// Local callback microseconds before passing onward.
    pub duration_us: u32,
}

/// Bound on trace-only callback summaries per hook lifetime.
pub const CALLBACK_DIAG_CAP: usize = 128;

/// Bounded FIFO for trace-only callback summaries. Past capacity the oldest
/// record is evicted and the loss is counted; privacy-denied chord candidates
/// bump `filtered` without recording any key identity. The owner drains this
/// trace-only (never production logs without `--trace`).
#[derive(Debug, Default)]
pub struct CallbackDiagBuf {
    inner: std::collections::VecDeque<CallbackDiag>,
    pub dropped: u32,
    pub filtered: u32,
}

impl CallbackDiagBuf {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: std::collections::VecDeque::with_capacity(CALLBACK_DIAG_CAP),
            dropped: 0,
            filtered: 0,
        }
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn push(&mut self, diag: CallbackDiag) {
        if self.inner.len() >= CALLBACK_DIAG_CAP {
            self.inner.pop_front();
            self.dropped = self.dropped.saturating_add(1);
        }
        self.inner.push_back(diag);
    }

    /// Privacy skip: a chord candidate denied by [`callback_diag_allows`]
    /// (catalog key without Win/armed/marked). No key identity is recorded.
    pub fn note_filtered(&mut self) {
        self.filtered = self.filtered.saturating_add(1);
    }

    pub fn drain(&mut self) -> Vec<CallbackDiag> {
        self.inner.drain(..).collect()
    }
}

/// True for VKs the trace-only callback buffer may ever record: Win keys plus
/// the Shift/Ctrl/Alt families (closed modifier vocabulary, no content), the
/// unassigned E8 mask, and catalog chord keys. Ordinary keys are never
/// candidates: they skip the buffer entirely without a borrow.
#[must_use]
pub fn is_callback_diag_candidate(vk: u32) -> bool {
    is_proof_mod_vk(vk) || vk == VK_MASK || is_chord_vk(vk)
}

/// Privacy gate for a candidate VK: modifiers/Win/E8 are always safe closed
/// vocabulary; catalog chord keys only with Win held, an armed hold
/// (repeat/up riding the down verdict), or a proof-marked chord. Typed
/// letters without Win are never recorded: letter catalog keys without any
/// of these conditions return false, and ordinary keys never reach here.
#[must_use]
pub fn callback_diag_allows(vk: u32, win_before: bool, key_armed: bool, marked: bool) -> bool {
    if is_proof_mod_vk(vk) || vk == VK_MASK {
        return true;
    }
    if is_chord_vk(vk) {
        return marked || win_before || key_armed;
    }
    false
}

/// A catalog chord observed without tracked Win is relevant on either path
/// (preheld Win before install, or a bare repeat after Win-up on an armed
/// hold): proof-marking never supplies the missing Win edge.
#[must_use]
pub fn callback_win_untracked(vk: u32, win_before: bool) -> bool {
    is_chord_vk(vk) && !win_before
}

/// Owner-log evidence for one trace-only callback summary. Closed key
/// vocabulary plus tracked state and local timing only: no HWNDs, PIDs,
/// tokens, titles, or any native identity.
#[must_use]
pub fn callback_diag_evidence(diag: &CallbackDiag) -> serde_json::Value {
    serde_json::json!({
        "vk": diag.vk,
        "scan": diag.scan,
        "edge": if diag.is_up { "up" } else { "down" },
        "source": diag.source.as_str(),
        "reason": diag.reason.as_str(),
        "win_before": diag.win_before,
        "win_after": diag.win_after,
        "shift": diag.shift,
        "ctrl": diag.ctrl,
        "alt": diag.alt,
        "guard_disagree": diag.guard_disagree,
        "win_untracked": diag.win_untracked,
        "consumed": diag.consumed,
        "duration_us": diag.duration_us,
    })
}

#[cfg(windows)]
pub mod sys {
    use super::{
        CallbackDiag, CallbackDiagBuf, CallbackReason, CallbackSource, KeyboardConfig,
        MarkedDiagBuf, MarkedKeyDiag, ModDiagBuf, QueuedMask, QueuedSnapEvent, SnapClassify,
        SnapOrigin, SnapQueue,
    };
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::time::Instant;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
        VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    struct SnapHookState {
        machine: SnapClassify,
        queue: SnapQueue,
        /// Cached managed origins from the owner's last observation plus the
        /// tiling-active gate. The owner republishes every iteration; the
        /// callback only reads one entry. Owner recheck stays exact.
        origins: HashMap<u64, SnapOrigin>,
        active: bool,
        /// Test-only injection marker. `None` on the product path (filter ALL
        /// injected); `Some(SHORTCUT_PROOF_MARKER)` on the `shortcut-proof`
        /// path (accept exactly the fixed marker, still origin-gated).
        proof_marker: Option<u64>,
        /// Proof-only callback diagnostics for accepted marked events. Always
        /// empty on the product path (no marker, no accepted injected
        /// events, nothing recorded).
        diag: MarkedDiagBuf,
        /// Proof-only callback diagnostics for NON-marked modifier events
        /// (injected-filtered plus physical, modifiers only). Always empty
        /// on the product path. Complements `diag` so live runs see the
        /// actual callback modifier sequence, not just accepted synthetic.
        mod_diag: ModDiagBuf,
        /// Trace-only callback summary for product and proof paths (closed
        /// vocabulary only, see [`super::CallbackDiag`]). Drained trace-only
        /// by the owner; never a synchronous log here.
        cb_diag: CallbackDiagBuf,
        /// Trace-only collection switch for `cb_diag` plus the mask-send
        /// aggregate below. False until the owner enables it right after
        /// install from `--trace`: with no trace the hook skips the timing
        /// read and all callback filter/push work, so a default run pays
        /// one cheap flag read per event. Proof `diag`/`mod_diag` are
        /// unaffected (proof-only audit path, always collected).
        cb_diag_enabled: bool,
        /// Trace-only mask-send aggregate: saturating count of `SendInput`
        /// mask pairs plus the max observed send microseconds. Timed with no
        /// SNAP borrow held, outside `duration_us`; drained trace-only by
        /// the owner alongside `cb_diag`.
        mask_sends: u32,
        mask_send_max_us: u32,
    }

    thread_local! {
        static SNAP: RefCell<Option<SnapHookState>> = const { RefCell::new(None) };
    }

    /// Owner publish: cached origin map for the callback. Cheap clone of the
    /// last observation's managed set; exactness stays with the owner's
    /// per-intent recheck against fresh observation.
    pub fn publish_gate(origins: &HashMap<u64, SnapOrigin>, active: bool) {
        SNAP.with(|s| {
            if let Some(st) = s.borrow_mut().as_mut() {
                st.origins = origins.clone();
                st.active = active;
            }
        });
    }

    /// Owner drain: take up to `limit` queued records, oldest first. The
    /// remainder stays queued for the next iteration so an auto-repeat hold
    /// cannot starve the tick. `limit` is always at least one.
    pub fn drain_up_to(limit: usize) -> Vec<QueuedSnapEvent> {
        SNAP.with(|s| {
            let mut out = Vec::new();
            if let Some(st) = s.borrow_mut().as_mut() {
                let take = limit.max(1);
                while out.len() < take {
                    match st.queue.pop_front() {
                        Some(ev) => out.push(ev),
                        None => break,
                    }
                }
            }
            out
        })
    }

    pub fn queue_dropped() -> u32 {
        SNAP.with(|s| s.borrow().as_ref().map(|st| st.queue.dropped).unwrap_or(0))
    }

    /// Bind the chord-time origin: the managed identity under the foreground
    /// window right now, or `None` when inactive or the foreground is not
    /// managed. One `GetForegroundWindow` plus one map lookup; no enumeration,
    /// no identity probes. The owner rechecks the triple against fresh
    /// observation before anything dispatches.
    fn callback_origin(st: &SnapHookState) -> Option<SnapOrigin> {
        if !st.active {
            return None;
        }
        let foreground = unsafe { GetForegroundWindow() } as usize as u64;
        st.origins.get(&foreground).cloned()
    }

    /// Minimal callback: classification plus one bounded queue push. No
    /// Engine, geometry, or log I/O here. A physical Win-up that closes a
    /// hold with a consumed chord sends the E8 mask pair first (with no SNAP
    /// borrow held); the Win-up itself always passes through.
    ///
    /// Proof-only diagnostics: accepted marked events (shortcut-proof only)
    /// record one bounded [`super::MarkedKeyDiag`] each, so live runs can
    /// distinguish actual callback modifier delivery from classifier state.
    /// Unmarked input is never recorded.
    unsafe extern "system" fn llproc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code as u32 == HC_ACTION {
            let kb = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
            let vk = kb.vkCode;
            let scan = kb.scanCode;
            let flags = kb.flags;
            // Trace-only collection switch: one cheap flag read per event.
            // With no trace the hook skips the timing read and all callback
            // filter/push work below (proof `diag`/`mod_diag` are separate
            // and unaffected).
            let diag_on = SNAP.with(|s| s.borrow().as_ref().is_some_and(|st| st.cb_diag_enabled));
            // Local callback start: `duration_us` below covers our own
            // classification/reserve work before passing onward, never the
            // downstream hook chain (nor any mask `SendInput`, which runs
            // with no borrow held after the reserve and is timed
            // separately in the mask-send aggregate).
            let started: Option<Instant> = diag_on.then(Instant::now);
            let injected = flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED) != 0;
            // Own-injection guard BEFORE any SNAP borrow: the SendInput pair
            // below reenters this callback on the same thread, and
            // re-borrowing the RefCell would panic. Product filters ALL
            // injected; shortcut-proof accepts exactly the fixed marker
            // (mask pair uses dwExtraInfo 0, so it still passes through).
            // Accepted marked events fall through as physical; everything
            // else passes through untouched.
            if injected {
                let extra = kb.dwExtraInfo as u64;
                let accepted = SNAP.with(|s| {
                    s.borrow()
                        .as_ref()
                        .is_some_and(|st| super::accept_proof_injected(extra, st.proof_marker))
                });
                if !accepted {
                    // Trace-only: record marker-rejected injected traffic for
                    // the closed vocabulary (modifiers/Win, E8, catalog
                    // chords with Win/armed), bounded with no state change,
                    // so live runs can tell hook-chain/OS echoes (including
                    // the untagged own E8 reentry) apart from classifier
                    // state. Ordinary keys skip without a borrow and leave no
                    // record. The borrow ends before `CallNextHookEx` below.
                    // Skipped entirely unless trace collection is enabled.
                    if diag_on && super::is_callback_diag_candidate(vk) {
                        SNAP.with(|s| {
                            let mut borrow = s.borrow_mut();
                            let Some(st) = borrow.as_mut() else {
                                return;
                            };
                            if !st.cb_diag_enabled {
                                return;
                            };
                            let win_before = st.machine.win_held();
                            let armed = st.machine.key_is_down(vk);
                            if !super::callback_diag_allows(vk, win_before, armed, false) {
                                st.cb_diag.note_filtered();
                                return;
                            }
                            let (ctrl, alt, shift) = st.machine.tracked_modifiers();
                            let elapsed = started
                                .as_ref()
                                .map(|t| t.elapsed().as_micros().min(u128::from(u32::MAX)) as u32)
                                .unwrap_or(0);
                            st.cb_diag.push(CallbackDiag {
                                vk,
                                scan,
                                is_up: flags & LLKHF_UP != 0,
                                source: CallbackSource::InjectedFiltered,
                                reason: CallbackReason::InjectedFiltered,
                                win_before,
                                win_after: win_before,
                                shift,
                                ctrl,
                                alt,
                                guard_disagree: false,
                                win_untracked: super::callback_win_untracked(vk, win_before),
                                consumed: false,
                                duration_us: elapsed,
                            });
                        });
                    }
                    // Proof-only: record marker-rejected injected MODIFIER
                    // traffic (modifiers only, bounded, no state change) so
                    // live runs can tell hook-chain/OS echoes apart from
                    // classifier state. The product path (no marker) records
                    // nothing there and still passes through untouched.
                    if super::is_proof_mod_vk(vk) {
                        SNAP.with(|s| {
                            let mut borrow = s.borrow_mut();
                            let Some(st) = borrow.as_mut() else {
                                return;
                            };
                            if st.proof_marker.is_none() {
                                return;
                            }
                            let (ctrl, alt, shift) = st.machine.tracked_modifiers();
                            let win = st.machine.win_held();
                            st.mod_diag.push(super::ModTrafficDiag {
                                vk,
                                scan,
                                is_up: flags & LLKHF_UP != 0,
                                source: super::ModSource::InjectedFiltered,
                                win_before: win,
                                win_after: win,
                                shift_before: shift,
                                shift_after: shift,
                                ctrl,
                                alt,
                            });
                        });
                    }
                    return unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) };
                }
            }
            // Reaching here with `injected` true means the fixed proof marker
            // was accepted above, which is only possible in shortcut-proof:
            // this is the sole condition that records a proof diagnostic.
            // The trace-only callback summary below records closed-vocabulary
            // events on both paths.
            let marked = injected;
            let is_up = flags & LLKHF_UP != 0;
            if is_up && super::is_win_vk(vk) {
                let tick = Instant::now();
                let fire = SNAP.with(|s| {
                    let mut s = s.borrow_mut();
                    let st = s.as_mut()?;
                    if marked {
                        let (ctrl, alt, shift) = st.machine.tracked_modifiers();
                        st.diag.push(MarkedKeyDiag {
                            vk,
                            scan,
                            is_up: true,
                            win: st.machine.win_held(),
                            shift_before: shift,
                            shift_after: shift,
                            ctrl,
                            alt,
                            async_shift: false,
                            guard_disagree: false,
                            consumed: false,
                        });
                    }
                    let installed = st.machine.enabled;
                    // Trace-only Win-up summary (closed Win vocabulary, always
                    // safe): Win-ups always pass; the mask reserve runs in
                    // the same borrow, and the borrow ends before any
                    // `SendInput`/`CallNextHookEx`. Duration excludes the mask
                    // send (timed separately in the mask-send aggregate) plus
                    // the downstream chain.
                    let cb_win_before = st.machine.win_held();
                    // Proof-only: a non-injected Win-up classifies as physical
                    // below (via the reserve) while recording nothing
                    // elsewhere; capture its before/after here so the actual
                    // callback Win sequence stays complete. Marked Win-ups
                    // stay exclusively in the marked buffer above.
                    let win_before = if !marked && st.proof_marker.is_some() {
                        Some(cb_win_before)
                    } else {
                        None
                    };
                    let fire = Some(super::win_up_mask_reserve(
                        &mut st.machine,
                        &mut st.queue,
                        vk,
                        installed,
                        tick,
                    ));
                    {
                        if st.cb_diag_enabled {
                            let (ctrl, alt, shift) = st.machine.tracked_modifiers();
                            let elapsed = started
                                .as_ref()
                                .map(|t| t.elapsed().as_micros().min(u128::from(u32::MAX)) as u32)
                                .unwrap_or(0);
                            st.cb_diag.push(CallbackDiag {
                                vk,
                                scan,
                                is_up: true,
                                source: if marked {
                                    CallbackSource::ProofMarked
                                } else {
                                    CallbackSource::Physical
                                },
                                reason: CallbackReason::WinUpPass,
                                win_before: cb_win_before,
                                win_after: st.machine.win_held(),
                                shift,
                                ctrl,
                                alt,
                                guard_disagree: false,
                                win_untracked: false,
                                consumed: false,
                                duration_us: elapsed,
                            });
                        }
                    }
                    if let Some(before) = win_before {
                        let (ctrl, alt, shift) = st.machine.tracked_modifiers();
                        st.mod_diag.push(super::ModTrafficDiag {
                            vk,
                            scan,
                            is_up: true,
                            source: super::ModSource::Physical,
                            win_before: before,
                            win_after: st.machine.win_held(),
                            shift_before: shift,
                            shift_after: shift,
                            ctrl,
                            alt,
                        });
                    }
                    fire
                });
                if fire == Some(true) {
                    // Mask `SendInput` runs with no borrow held; time it as
                    // separate trace evidence (trace-only, bounded
                    // aggregate), never inside `duration_us`.
                    let send_started: Option<Instant> = diag_on.then(Instant::now);
                    let sent = send_mask_pair();
                    if let Some(t0) = send_started.as_ref() {
                        let send_us = t0.elapsed().as_micros().min(u128::from(u32::MAX)) as u32;
                        SNAP.with(|s| {
                            if let Some(st) = s.borrow_mut().as_mut() {
                                st.mask_sends = st.mask_sends.saturating_add(1);
                                st.mask_send_max_us = st.mask_send_max_us.max(send_us);
                            }
                        });
                    }
                    SNAP.with(|s| {
                        if let Some(st) = s.borrow_mut().as_mut() {
                            super::stamp_mask_result(
                                &mut st.machine,
                                &mut st.queue,
                                sent.inserted,
                                sent.release_sent,
                            );
                        }
                    });
                }
                return unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) };
            }
            // Modifiers may already be held when the hook starts, or arrive
            // injected past the callback guard: when the physical async state
            // disagrees on Ctrl/Alt for a FRESH chord down, pass through
            // untouched so preheld unowned modifiers cannot be swallowed.
            // Armed-hold repeats skip the guard (paired-held check first) so
            // a consumed sequence stays swallowed until its matching up.
            // Supported Shift binds from the official async sample instead,
            // so a preheld Shift correctly selects move/sticky/send (fresh
            // downs only; armed holds keep their down-time op via stored
            // origin).
            //
            // The guard and the classification share one borrow so a marked
            // catalog down records its async sample, tracked state, and final
            // consume verdict in a single diagnostic.
            let consume = SNAP.with(|s| {
                let mut s = s.borrow_mut();
                let st = s.as_mut()?;
                let mut async_shift = false;
                let mut guard_disagree = false;
                if !is_up && super::is_chord_vk(vk) {
                    let (ctrl, alt, shift) = st.machine.tracked_modifiers();
                    let async_down = |key: i32| unsafe { GetAsyncKeyState(key) } < 0;
                    let async_ctrl = async_down(VK_CONTROL as i32);
                    let async_alt = async_down(VK_MENU as i32);
                    async_shift = async_down(VK_SHIFT as i32);
                    let paired_held = st.machine.key_is_down(vk);
                    guard_disagree = ((async_ctrl && !ctrl) || (async_alt && !alt)) && !paired_held;
                    if !guard_disagree && !paired_held && async_shift != shift {
                        st.machine.sync_shift_from_async(async_shift);
                    }
                    if marked {
                        st.diag.push(MarkedKeyDiag {
                            vk,
                            scan,
                            is_up: false,
                            win: st.machine.win_held(),
                            shift_before: shift,
                            shift_after: shift,
                            ctrl,
                            alt,
                            async_shift,
                            guard_disagree,
                            consumed: false,
                        });
                    }
                    if guard_disagree {
                        // Trace-only preheld-guard evidence (chord VKs are
                        // candidates; the privacy gate still applies so a
                        // guard without Win/armed/marked counts filtered).
                        // Skipped unless trace collection is enabled.
                        if st.cb_diag_enabled {
                            let win_g = st.machine.win_held();
                            let armed_g = st.machine.key_is_down(vk);
                            if super::callback_diag_allows(vk, win_g, armed_g, marked) {
                                let elapsed = started
                                    .as_ref()
                                    .map(|t| {
                                        t.elapsed().as_micros().min(u128::from(u32::MAX)) as u32
                                    })
                                    .unwrap_or(0);
                                st.cb_diag.push(CallbackDiag {
                                    vk,
                                    scan,
                                    is_up: false,
                                    source: if marked {
                                        CallbackSource::ProofMarked
                                    } else {
                                        CallbackSource::Physical
                                    },
                                    reason: CallbackReason::ModifierGuard,
                                    win_before: win_g,
                                    win_after: win_g,
                                    shift,
                                    ctrl,
                                    alt,
                                    guard_disagree: true,
                                    win_untracked: super::callback_win_untracked(vk, win_g),
                                    consumed: false,
                                    duration_us: elapsed,
                                });
                            } else {
                                st.cb_diag.note_filtered();
                            }
                        }
                        return None;
                    }
                }
                let (ctrl_b, alt_b, shift_b) = st.machine.tracked_modifiers();
                let win_b = st.machine.win_held();
                // Armed-hold bit BEFORE `classify_and_queue` below: the
                // classifier clears the hold on chord-up, so reading after
                // would lose a physical chord-up riding an armed hold whose
                // Win-up already ran (diagnostic must still record it).
                let armed_before = st.machine.key_is_down(vk);
                // Shortcut-handling gate (no syscalls beyond the single
                // foreground read inside `callback_origin`): fresh downs
                // consume iff enabled with the gate active; consumed-hold
                // pairs ride the stored down verdict. Suspended/fullscreen/
                // gesture/elevated/unmanaged never enter this gate (takeover
                // publication only); the owner rechecks those fresh per
                // intent.
                let gate = st.active;
                let fg = callback_origin(st);
                let tick = Instant::now();
                // Reaching here with `injected` true means the fixed proof
                // marker was accepted above: classify as physical. All other
                // injected events returned early and never touch the queue.
                let out = super::classify_and_queue(
                    &mut st.machine,
                    &mut st.queue,
                    vk,
                    is_up,
                    fg,
                    false,
                    tick,
                    gate,
                );
                if marked {
                    let (_, _, shift_a) = st.machine.tracked_modifiers();
                    if !is_up && super::is_chord_vk(vk) {
                        // The guard record just pushed is the newest record:
                        // stamp the consume verdict onto it (same borrow, no
                        // interleaving; classify_and_queue cannot push diag).
                        if let Some(last) = st.diag.back_mut() {
                            last.consumed = out == Some(true);
                            last.shift_after = shift_a;
                        }
                    } else {
                        st.diag.push(MarkedKeyDiag {
                            vk,
                            scan,
                            is_up,
                            win: win_b,
                            shift_before: shift_b,
                            shift_after: shift_a,
                            ctrl: ctrl_b,
                            alt: alt_b,
                            async_shift,
                            guard_disagree,
                            consumed: out == Some(true),
                        });
                    }
                }
                // Proof-only: a non-injected (physical) modifier reaches here
                // with `marked == false`, classifies above (may move tracked
                // state), and records nothing elsewhere. Capture its
                // before/after so live runs see the actual callback modifier
                // sequence. Non-modifier physical input is never recorded:
                // modifiers carry no content. No async sample is taken here
                // and the verdict below never selects focus/move from it.
                if !marked && st.proof_marker.is_some() && super::is_proof_mod_vk(vk) {
                    let (_, _, shift_a) = st.machine.tracked_modifiers();
                    st.mod_diag.push(super::ModTrafficDiag {
                        vk,
                        scan,
                        is_up,
                        source: super::ModSource::Physical,
                        win_before: win_b,
                        win_after: st.machine.win_held(),
                        shift_before: shift_b,
                        shift_after: shift_a,
                        ctrl: ctrl_b,
                        alt: alt_b,
                    });
                }
                // Trace-only callback summary for the closed vocabulary
                // (product and proof paths). Ordinary keys skip without a
                // record; chord keys without Win/armed/marked count
                // filtered (Win-not-tracked ambiguity volume without
                // content). Same borrow, ends before `CallNextHookEx`.
                // Skipped entirely unless trace collection is enabled.
                // `guard_disagree` is always false here (the guard returns
                // early above), so the reason mirrors `classify_and_queue`
                // only. `armed_before`/`win_b` are pre-classification so a
                // chord-up after an early Win-up stays diagnostic.
                if diag_on && st.cb_diag_enabled && super::is_callback_diag_candidate(vk) {
                    if !super::callback_diag_allows(vk, win_b, armed_before, marked) {
                        st.cb_diag.note_filtered();
                    } else {
                        let (_, _, shift_a) = st.machine.tracked_modifiers();
                        let reason = if out.is_none() {
                            CallbackReason::Unclassified
                        } else if out == Some(true) {
                            CallbackReason::Consumed
                        } else {
                            CallbackReason::Passed
                        };
                        let elapsed = started
                            .as_ref()
                            .map(|t| t.elapsed().as_micros().min(u128::from(u32::MAX)) as u32)
                            .unwrap_or(0);
                        st.cb_diag.push(CallbackDiag {
                            vk,
                            scan,
                            is_up,
                            source: if marked {
                                CallbackSource::ProofMarked
                            } else {
                                CallbackSource::Physical
                            },
                            reason,
                            win_before: win_b,
                            win_after: st.machine.win_held(),
                            shift: shift_a,
                            ctrl: ctrl_b,
                            alt: alt_b,
                            guard_disagree: false,
                            win_untracked: super::callback_win_untracked(vk, win_b),
                            consumed: out == Some(true),
                            duration_us: elapsed,
                        });
                    }
                }
                out
            });
            if consume == Some(true) {
                return 1;
            }
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
    }

    struct MaskSend {
        inserted: u8,
        release_sent: bool,
    }

    /// Sends the E8 down/up pair. Must be called with no SNAP borrow held
    /// (see llproc). Returns the accepted-event count plus whether the bounded
    /// partial-release ran. Accepted exception to the no-native-I/O callback
    /// rule: the pair must ride the same Win hold at Win-up time.
    fn send_mask_pair() -> MaskSend {
        unsafe {
            let mut pair: [INPUT; 2] = std::mem::zeroed();
            pair[0].r#type = INPUT_KEYBOARD;
            pair[0].Anonymous.ki = KEYBDINPUT {
                wVk: super::VK_MASK as u16,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };
            pair[1].r#type = INPUT_KEYBOARD;
            pair[1].Anonymous.ki = KEYBDINPUT {
                wVk: super::VK_MASK as u16,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };
            let size = std::mem::size_of::<INPUT>() as i32;
            let inserted = SendInput(2, pair.as_ptr(), size);
            if inserted == 1 {
                // Partial pair: the E8 down reached the system without its
                // up. One bounded E8-up release, nothing else repaired.
                let release = SendInput(1, pair.as_ptr().add(1), size);
                MaskSend {
                    inserted: 1,
                    release_sent: release == 1,
                }
            } else {
                MaskSend {
                    inserted: inserted as u8,
                    release_sent: false,
                }
            }
        }
    }

    /// Mask evidence line for the owner log: arming chord plus SendInput
    /// result. No raw keys, no HWNDs.
    pub fn mask_evidence(mask: &QueuedMask) -> serde_json::Value {
        let result = if mask.inserted == 2 && !mask.release_sent {
            "mask-ok"
        } else {
            "mask-failed"
        };
        let mut value = match mask.trigger {
            super::MaskTrigger::Snap { op, direction } => serde_json::json!({
                "trigger_op": op.as_str(),
                "trigger_direction": super::direction_name(direction),
            }),
            super::MaskTrigger::Workspace { op, index } => serde_json::json!({
                "trigger_op": op.as_str(),
                "trigger_index": index,
            }),
            super::MaskTrigger::Maximize => serde_json::json!({
                "trigger_op": "maximize",
            }),
            super::MaskTrigger::Fullscreen => serde_json::json!({
                "trigger_op": "fullscreen",
            }),
            super::MaskTrigger::Float => serde_json::json!({
                "trigger_op": "float",
            }),
            super::MaskTrigger::Sticky => serde_json::json!({
                "trigger_op": "sticky",
            }),
        };
        value["inserted"] = serde_json::Value::from(mask.inserted);
        value["release_sent"] = serde_json::Value::from(mask.release_sent);
        value["result"] = serde_json::Value::from(result);
        value
    }

    /// Install the low-level hook on the calling thread. The caller must pump
    /// messages so the callback runs. Fails closed: install failure is an
    /// error, never a silent run without the visible takeover.
    pub fn install(config: KeyboardConfig) -> std::result::Result<HHOOK, String> {
        SNAP.with(|s| {
            *s.borrow_mut() = Some(SnapHookState {
                machine: SnapClassify::new(config),
                queue: SnapQueue::new(),
                origins: HashMap::new(),
                active: false,
                proof_marker: None,
                diag: MarkedDiagBuf::new(),
                mod_diag: ModDiagBuf::new(),
                cb_diag: CallbackDiagBuf::new(),
                cb_diag_enabled: false,
                mask_sends: 0,
                mask_send_max_us: 0,
            });
        });
        let hmod = unsafe { GetModuleHandleW(std::ptr::null()) };
        let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(llproc), hmod, 0) };
        if hook.is_null() {
            SNAP.with(|s| *s.borrow_mut() = None);
            return Err("error: SetWindowsHookExW(WH_KEYBOARD_LL) failed".to_owned());
        }
        Ok(hook)
    }

    /// Test-only install for `shortcut-proof`: identical callback, dispatcher,
    /// and mask routines, but synthetic input carrying exactly
    /// [`super::SHORTCUT_PROOF_MARKER`] in `dwExtraInfo` classifies as
    /// physical (still origin-gated by the owner recheck). All other injected
    /// input passes through. Never used by product `tile`.
    pub fn install_proof(config: KeyboardConfig) -> std::result::Result<HHOOK, String> {
        SNAP.with(|s| {
            *s.borrow_mut() = Some(SnapHookState {
                machine: SnapClassify::new(config),
                queue: SnapQueue::new(),
                origins: HashMap::new(),
                active: false,
                proof_marker: Some(super::SHORTCUT_PROOF_MARKER),
                diag: MarkedDiagBuf::new(),
                mod_diag: ModDiagBuf::new(),
                cb_diag: CallbackDiagBuf::new(),
                cb_diag_enabled: false,
                mask_sends: 0,
                mask_send_max_us: 0,
            });
        });
        let hmod = unsafe { GetModuleHandleW(std::ptr::null()) };
        let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(llproc), hmod, 0) };
        if hook.is_null() {
            SNAP.with(|s| *s.borrow_mut() = None);
            return Err("error: SetWindowsHookExW(WH_KEYBOARD_LL) failed".to_owned());
        }
        Ok(hook)
    }

    /// Owner drain: take all pending proof-only callback diagnostics, oldest
    /// first. Empty on the product path (nothing is ever recorded there).
    pub fn drain_marked_diag() -> Vec<super::MarkedKeyDiag> {
        SNAP.with(|s| {
            s.borrow_mut()
                .as_mut()
                .map(|st| st.diag.drain())
                .unwrap_or_default()
        })
    }

    /// Cumulative proof-diagnostic evictions (zero on the product path).
    pub fn marked_diag_dropped() -> u32 {
        SNAP.with(|s| s.borrow().as_ref().map(|st| st.diag.dropped).unwrap_or(0))
    }

    /// Owner drain: take all pending proof-only modifier-traffic
    /// diagnostics, oldest first. Empty on the product path (nothing is ever
    /// recorded there).
    pub fn drain_mod_diag() -> Vec<super::ModTrafficDiag> {
        SNAP.with(|s| {
            s.borrow_mut()
                .as_mut()
                .map(|st| st.mod_diag.drain())
                .unwrap_or_default()
        })
    }

    /// Cumulative modifier-traffic evictions (zero on the product path).
    pub fn mod_diag_dropped() -> u32 {
        SNAP.with(|s| {
            s.borrow()
                .as_ref()
                .map(|st| st.mod_diag.dropped)
                .unwrap_or(0)
        })
    }

    /// Owner drain: take all pending trace-only callback summaries, oldest
    /// first. Bounded at [`super::CALLBACK_DIAG_CAP`]; the owner logs these
    /// trace-only.
    pub fn drain_callback_diag() -> Vec<super::CallbackDiag> {
        SNAP.with(|s| {
            s.borrow_mut()
                .as_mut()
                .map(|st| st.cb_diag.drain())
                .unwrap_or_default()
        })
    }

    /// Cumulative callback-summary evictions.
    pub fn callback_diag_dropped() -> u32 {
        SNAP.with(|s| {
            s.borrow()
                .as_ref()
                .map(|st| st.cb_diag.dropped)
                .unwrap_or(0)
        })
    }

    /// Cumulative privacy-denied chord candidates (never recorded).
    pub fn callback_diag_filtered() -> u32 {
        SNAP.with(|s| {
            s.borrow()
                .as_ref()
                .map(|st| st.cb_diag.filtered)
                .unwrap_or(0)
        })
    }

    /// Owner switch for trace-only callback collection (`cb_diag` plus the
    /// mask-send aggregate). Applied immediately after install from the
    /// owner's `--trace` flag; the hook collects nothing until enabled.
    /// Proof `diag`/`mod_diag` are unaffected. Narrow setter (not an
    /// install signature change) so the portable product surface is
    /// untouched.
    pub fn set_callback_diag_enabled(enabled: bool) {
        SNAP.with(|s| {
            if let Some(st) = s.borrow_mut().as_mut() {
                st.cb_diag_enabled = enabled;
            }
        });
    }

    /// Trace-only mask-send aggregate: `(sends, max_send_us)`. Sends counts
    /// `SendInput` mask pairs (saturating); `max_send_us` is the max observed
    /// send microseconds with no borrow held. Zero unless trace collection
    /// is enabled.
    pub fn mask_send_stats() -> (u32, u32) {
        SNAP.with(|s| {
            s.borrow()
                .as_ref()
                .map(|st| (st.mask_sends, st.mask_send_max_us))
                .unwrap_or((0, 0))
        })
    }

    /// Uninstall and drop hook state. Returns the actual unhook result:
    /// process exit releases the hook in any case, but success is never
    /// fabricated here. The Win-up itself always passed through, so no stuck
    /// keys are possible; a partial E8 pair resolves to one bounded release
    /// attempt at send time.
    pub fn uninstall(hook: &mut HHOOK) -> bool {
        SNAP.with(|s| {
            if let Some(st) = s.borrow_mut().as_mut() {
                st.machine.set_enabled(false);
            }
        });
        let ok = unsafe { UnhookWindowsHookEx(*hook) } != 0;
        *hook = std::ptr::null_mut();
        SNAP.with(|s| *s.borrow_mut() = None);
        ok
    }
}
