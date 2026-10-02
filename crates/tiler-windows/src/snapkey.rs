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
/// approved chord that passes through (takeover off, background, or saturated)
/// and never dispatches.
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
/// plus workspace digits. Modifiers, Win keys, and ordinary keys are not
/// chord keys.
#[must_use]
pub fn is_chord_vk(vk: u32) -> bool {
    catalog_index(vk).is_some() || is_digit_vk(vk)
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

/// Unified classifier outcome: exactly one of directional or workspace.
/// One machine, one modifier/mask authority; digits share Win/Shift/Ctrl/Alt
/// tracking, origin pairing, saturation, and the E8 mask with H/J/K/L/arrows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classified {
    Snap(SnapIntent),
    Workspace(WorkspaceIntent),
}

impl Classified {
    #[must_use]
    pub const fn consumed(self) -> bool {
        match self {
            Self::Snap(intent) => intent.consumed,
            Self::Workspace(intent) => intent.consumed,
        }
    }

    #[must_use]
    pub const fn announce(self) -> bool {
        match self {
            Self::Snap(intent) => intent.announce,
            Self::Workspace(intent) => intent.announce,
        }
    }
}

/// Which chord armed the Start-menu mask. Digits arm it exactly like
/// directional chords: any consumed chord in the Win hold needs the E8 pair
/// at Win-up, or the OS opens Start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaskTrigger {
    Snap { op: SnapOp, direction: Direction },
    Workspace { op: WorkspaceOp, index: u8 },
}

/// Pure product chord classifier. Tracks both Win keys plus the Shift family
/// (chord selector) and Ctrl/Alt families (extra modifiers force
/// pass-through). Per-key down state carries the origin of the hold: only a
/// hold that started consumed (takeover on, foreground managed) can consume,
/// so a background-origin sequence never consumes mid-hold and its paired
/// key-up is never stolen. The op is fixed at down time from the Shift state,
/// so releasing Shift before the key-up cannot flip focus into move (or
/// select into send).
///
/// `mask_pending` arms the Start-menu mask when a consumed chord lands in the
/// current Win hold. Unlike the spike, Shift transitions never disarm the
/// mask: Shift is a chord participant here, and the physical Shift press
/// already reaches the OS. Ordinary keys and Ctrl/Alt transitions do disarm.
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
    pub enabled: bool,
    /// Cached session gate published by the owner (takeover plus active,
    /// non-fullscreen, non-elevated, non-gesture). Distinct from the managed
    /// origin: selects require this gate, sends additionally require a
    /// managed origin. Defaults on so pure classifier tests keep working;
    /// the hook path sets it per event from the cached publish.
    pub gate_active: bool,
    pub allow_win_l: bool,
    pub counts: [SnapCounts; 8],
    pub digit_counts: [SnapCounts; 10],
    mask_pending: bool,
    mask_trigger: Option<MaskTrigger>,
    hold_masked: bool,
    pub mask_attempted: u32,
    pub mask_ok: u32,
    pub mask_failed: u32,
    pub mask_skipped: u32,
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
            enabled: config.takeover,
            gate_active: true,
            allow_win_l: config.allow_win_l,
            counts: [SnapCounts::default(); 8],
            digit_counts: [SnapCounts::default(); 10],
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
    /// `(ctrl, alt, shift)`. A physically held modifier the classifier never
    /// saw (held before install, or injected past the callback guard) forces
    /// pass-through so a preheld Shift cannot flip a focus chord into move.
    pub fn tracked_modifiers(&self) -> (bool, bool, bool) {
        (self.ctrl, self.alt, self.shift)
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
                    // Extra-modifier traffic reaches the OS and disguises Win
                    // by itself; a pending mask is redundant.
                    self.mask_pending = false;
                }
                VK_MENU | VK_LMENU | VK_RMENU => {
                    self.alt = held;
                    self.mask_pending = false;
                }
                _ => {
                    self.shift = held;
                    // Shift participates in move chords: it passes through
                    // physically but never disarms a pending mask.
                }
            }
            return None;
        }
        if is_digit_vk(vk) {
            return self.push_digit(vk, is_up, foreground);
        }
        let Some(idx) = catalog_index(vk) else {
            // Ordinary keys reach the OS and disguise Win by themselves.
            self.mask_pending = false;
            return None;
        };
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
            if self.enabled && self.gate_active && foreground && origin {
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
                // Passed ups reach the OS, which disguises Win by itself.
                self.mask_pending = false;
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
            if self.ctrl || self.alt || !(self.win_l || self.win_r) {
                // Untracked chords pass through, so the OS sees Win modify
                // something and the pending mask is redundant.
                self.mask_pending = false;
                return None;
            }
            let op = if self.shift {
                SnapOp::Move
            } else {
                SnapOp::Focus
            };
            // Unshifted Win+L is the OS lock chord: without explicit opt-in it
            // passes through untracked, so its paired key-up also passes.
            if op == SnapOp::Focus && is_letter_l(idx) && !self.allow_win_l {
                self.mask_pending = false;
                return None;
            }
            if self.key_down[idx] {
                self.counts[idx].repeat += 1;
                let op = self.key_op[idx].unwrap_or(op);
                if self.enabled && self.gate_active && foreground && self.key_origin[idx] {
                    self.counts[idx].consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(MaskTrigger::Snap { op, direction });
                    Some(Classified::Snap(SnapIntent {
                        op,
                        direction,
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: true,
                        announce: true,
                    }))
                } else {
                    self.counts[idx].passed += 1;
                    self.mask_pending = false;
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
                self.key_down[idx] = true;
                let origin = self.enabled && self.gate_active && foreground;
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
                    self.mask_pending = false;
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

    /// Digit half of the unified classifier: same Win/Ctrl/Alt/origin/mask
    /// contract as the directional catalog. Shift flips select into send and
    /// is fixed at down time; the op rides the paired key-up. Select consumes
    /// on the cached session gate alone (empty workspaces and unmanaged
    /// foreground) with no managed origin; send additionally requires a
    /// managed origin. Fullscreen and elevated gating stays with the owner
    /// dispatch as well, never only here.
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
            let origin_held = origin && (foreground || op == WorkspaceOp::Select);
            if self.enabled && self.gate_active && origin_held {
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
                self.mask_pending = false;
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
            if self.ctrl || self.alt || !(self.win_l || self.win_r) {
                self.mask_pending = false;
                return None;
            }
            let op = if self.shift {
                WorkspaceOp::Send
            } else {
                WorkspaceOp::Select
            };
            if self.digit_down[slot] {
                self.digit_counts[slot].repeat += 1;
                let op = self.digit_op[slot].unwrap_or(op);
                // Select repeats ride the down-time origin like the down
                // itself: global selects (origin bound without a managed
                // foreground) keep consuming while the cached gate holds;
                // send repeats keep the live managed-foreground gate.
                let origin_held =
                    self.digit_origin[slot] && (foreground || op == WorkspaceOp::Select);
                if self.enabled && self.gate_active && origin_held {
                    self.digit_counts[slot].consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(MaskTrigger::Workspace {
                        op,
                        index: slot as u8,
                    });
                    Some(Classified::Workspace(WorkspaceIntent {
                        op,
                        index: slot as u8,
                        edge: SnapEdge::Repeat,
                        foreground,
                        consumed: true,
                        announce: true,
                    }))
                } else {
                    self.digit_counts[slot].passed += 1;
                    self.mask_pending = false;
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
                self.digit_down[slot] = true;
                // Global select: unshifted digits consume on the cached
                // session gate alone (empty workspaces and unmanaged
                // foreground), with the origin bound for mask/queue
                // bookkeeping but no managed foreground required. Send keeps
                // the managed-origin gate; the owner still rechecks identity
                // before anything moves.
                let origin =
                    self.enabled && self.gate_active && (foreground || op == WorkspaceOp::Select);
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
                    self.mask_pending = false;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueuedSnapEvent {
    Intent(QueuedIntent),
    Workspace(QueuedWorkspaceIntent),
    Mask(QueuedMask),
}

/// Bounded preallocated FIFO from the callback to the owner. `push` refuses
/// past capacity so the callback fails closed; the caller records the loss and
/// passes the key through.
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

/// Saturation-aware gate shared by the hook callback and tests. Bookkeeping
/// always advances, but while the queue is full nothing consumes: the approved
/// chord is counted as a loss and passed through. Injected and unrelated
/// inputs never touch the queue or the loss counter. `origin` is the
/// callback-bound managed identity (`None` when background/inactive or
/// unmanaged); `gate_active` is the cached session gate (takeover plus active,
/// non-fullscreen, non-elevated, non-gesture) published by the owner.
/// Selects require the gate, sends additionally require an origin. Returns
/// whether the callback must swallow the key event.
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
    let saturated = queue.is_full();
    let saved = machine.enabled;
    let saved_gate = machine.gate_active;
    // Preserve an earlier consumed chord's Start-menu mask across saturation:
    // the saturated event passes through (disguising Win by itself), but a
    // redundant E8 pair is safe while a naked Win Start is not. The failing
    // push below disarms via its passed path, so restore the armed state.
    let saved_pending = machine.mask_pending;
    let saved_trigger = machine.mask_trigger;
    machine.set_gate_active(saved_gate && gate_active);
    if saturated {
        machine.set_enabled(false);
    }
    let ev = machine.push(vk, is_up, origin.is_some(), injected);
    machine.set_enabled(saved);
    machine.set_gate_active(saved_gate);
    let ev = ev?;
    if saturated {
        if saved_pending {
            machine.mask_pending = true;
            if machine.mask_trigger.is_none() {
                machine.mask_trigger = saved_trigger;
            }
        }
        queue.record_drop();
        return Some(false);
    }
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
    };
    if queue.push(event) {
        Some(consumed)
    } else {
        queue.record_drop();
        Some(false)
    }
}

/// Win-up mask reservation shared by the hook callback and tests. Reserves
/// queue evidence BEFORE any SendInput: when full nothing is injected and the
/// skip is counted, so a send is never unlogged. Returns true when the caller
/// must send the E8 pair. The Win-up itself always passes through.
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
    if queue.push(QueuedSnapEvent::Mask(QueuedMask {
        trigger,
        tick,
        inserted: 0,
        release_sent: false,
    })) {
        machine.mask_attempted += 1;
        true
    } else {
        // No room: count the skip and restore the hold so a later Win-up in
        // the same hold can retry. Nothing was injected.
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

#[cfg(windows)]
pub mod sys {
    use super::{
        KeyboardConfig, MarkedDiagBuf, MarkedKeyDiag, ModDiagBuf, QueuedMask, QueuedSnapEvent,
        SnapClassify, SnapOrigin, SnapQueue,
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
                    // Proof-only: record marker-rejected injected MODIFIER
                    // traffic (modifiers only, bounded, no state change) so
                    // live runs can tell hook-chain/OS echoes apart from
                    // classifier state. The product path (no marker) records
                    // nothing and still passes through untouched.
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
            // this is the sole condition that records a diagnostic.
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
                    // Proof-only: a non-injected Win-up classifies as physical
                    // below (via the reserve) while recording nothing
                    // elsewhere; capture its before/after here so the actual
                    // callback Win sequence stays complete. Marked Win-ups
                    // stay exclusively in the marked buffer above.
                    let win_before = if !marked && st.proof_marker.is_some() {
                        Some(st.machine.win_held())
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
                    let sent = send_mask_pair();
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
            // disagrees with the tracked state, pass through untouched so a
            // preheld Shift cannot flip a focus chord into move (or vice
            // versa) and preheld Ctrl/Alt cannot be swallowed. Tracked state
            // that agrees classifies normally below, so Win+Shift+L still
            // consumes once Shift itself was seen go down.
            //
            // The guard and the classification share one borrow so a marked
            // catalog down records its async sample, tracked state, and final
            // consume verdict in a single diagnostic. Behavior is unchanged:
            // disagreement passes through without classifying.
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
                    guard_disagree = (async_ctrl && !ctrl)
                        || (async_alt && !alt)
                        || (async_shift && !shift && !st.machine.key_is_down(vk));
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
                        return None;
                    }
                }
                let (ctrl_b, alt_b, shift_b) = st.machine.tracked_modifiers();
                let win_b = st.machine.win_held();
                // Cached session gate (no syscalls beyond the single
                // foreground read inside `callback_origin`): selects require
                // it, sends additionally require the managed origin.
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
