//! Throwaway Win+Arrow hook spike (not product input).
//!
//! Hook-only run: installs once with no focus-gated start, stays installed for
//! a fixed 60s even if the helper loses focus, then uninstalls for a ~20s
//! release check. Deleted or rewritten when the spike is done.

use serde::Serialize;
use std::collections::VecDeque;

/// Fixed installed window: focus changes never uninstall early.
pub const HOOK_ENABLED_SECONDS: u64 = 60;
/// Post-uninstall window: one release check, then DONE.
pub const RELEASE_CHECK_SECONDS: u64 = 20;
pub const SPIKE_LEDGER_SECONDS: u64 = 150;
pub const SPIKE_HARD_SECONDS: u64 = 140;
/// Bounded preallocated callback event queue. Saturation fails closed
/// (pass-through) with an explicit loss counter, so omissions can never
/// masquerade as successful suppression.
pub const EVENT_QUEUE_CAP: usize = 512;
pub const NUDGE_PX: i32 = 48;

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
/// Unassigned VK used as the Start-menu mask key, per the documented
/// `A_MenuMaskKey` guidance (unassigned `vkE8` preferred over the Ctrl
/// default to avoid modifier side effects). Never a real modifier: the OS
/// sees a keystroke while Win is held, so a consumed chord no longer looks
/// like a naked Win tap, and no modifier state is perturbed.
pub const VK_MASK: u32 = 0xE8;

pub const FOCUS_NOTE: &str =
    "helper must be physically foreground for action; background chords pass through";

pub const CHORD_NAMES: [&str; 4] = ["left", "right", "up", "down"];
pub const CHORD_VKS: [u32; 4] = [VK_LEFT, VK_RIGHT, VK_UP, VK_DOWN];
pub const CHORD_OFFSETS: [(i32, i32); 4] =
    [(-NUDGE_PX, 0), (NUDGE_PX, 0), (0, -NUDGE_PX), (0, NUDGE_PX)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum Arrow {
    Left = 0,
    Right = 1,
    Up = 2,
    Down = 3,
}

impl Arrow {
    #[must_use]
    pub fn all() -> [Arrow; 4] {
        [Arrow::Left, Arrow::Right, Arrow::Up, Arrow::Down]
    }

    #[must_use]
    pub fn vk(self) -> u32 {
        CHORD_VKS[self as usize]
    }

    #[must_use]
    pub fn offset(self) -> (i32, i32) {
        CHORD_OFFSETS[self as usize]
    }

    #[must_use]
    pub fn name(self) -> &'static str {
        CHORD_NAMES[self as usize]
    }

    #[must_use]
    pub fn from_vk(vk: u32) -> Option<Arrow> {
        CHORD_VKS
            .iter()
            .position(|v| *v == vk)
            .map(|i| Arrow::all()[i])
    }
}

#[must_use]
pub fn is_win_vk(vk: u32) -> bool {
    vk == VK_LWIN || vk == VK_RWIN
}

fn arrow_index(arrow: Arrow) -> usize {
    arrow as usize
}

/// Which key edge an approved Win+Arrow event represents. Repeats are held-key
/// auto-repeats; only downs act on geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    Down,
    Up,
    Repeat,
}

/// Classifier outcome for one approved Win+Arrow key event. `None` means the
/// input is unrelated (bare arrows, other keys, injected, extra modifiers) and
/// is never logged. `consumed == false` means an approved chord that passes
/// through untouched (background, disabled, or saturated queue); it is logged
/// but never swallowed. `announce == true` (consumed downs/repeats) requests a
/// geometry action with a foreground recheck outside the callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChordEvent {
    pub arrow: Arrow,
    pub edge: Edge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ChordCounts {
    pub down: u32,
    pub up: u32,
    pub repeat: u32,
    pub consumed: u32,
    pub acted: u32,
    pub passed: u32,
}

/// Pure Win+Arrow chord classifier shared by the hook callback and tests.
///
/// Tracks both Win keys plus Ctrl/Alt/Shift families. Arrow downs with any
/// extra modifier pass through untracked (no arrow_down set), so their paired
/// key-up also passes and never steals an unrelated event.
///
/// Every Win+Arrow down/repeat/up is tracked and reported, foreground or
/// background: background chords pass through logged as passed.
/// `arrow_consumed` records the origin of the current hold: only a hold that
/// started in the foreground (while enabled) can consume, so a
/// background-origin sequence never consumes or acts just because it turns
/// foreground mid-hold, and its paired key-up is never stolen. Foreground
/// transitions never disable the machine: the hook stays installed throughout.
/// `mask_pending` arms the Start-menu mask when a consumed chord lands in the
/// current Win hold; `mask_trigger` remembers the arming arrow for evidence.
/// `hold_masked` records that the E8 pair already went out for this hold, so
/// the second Win-up of an L/R pair does not re-mask unless a naked Win
/// auto-repeat re-arms the trigger first. Mask counters stay zero unless a
/// mask is reserved, attempted, or skipped.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct HookClassify {
    win_l: bool,
    win_r: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
    arrow_down: [bool; 4],
    arrow_consumed: [bool; 4],
    pub enabled: bool,
    pub chords: [ChordCounts; 4],
    mask_pending: bool,
    mask_trigger: Option<Arrow>,
    hold_masked: bool,
    pub mask_attempted: u32,
    pub mask_ok: u32,
    pub mask_failed: u32,
    pub mask_skipped: u32,
}

impl HookClassify {
    #[must_use]
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            ..Self::default()
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn note_acted(&mut self, arrow: Arrow) {
        self.chords[arrow_index(arrow)].acted += 1;
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
    /// arrow when the caller must send the E8 pair before passing this
    /// Win-up through. The Win-up itself always passes. Hold flags clear
    /// once both Wins are up, so a plain Win tap never masks. `installed`
    /// is false on the test-only `push` path, which updates state only.
    fn win_up_needs_mask(&mut self, vk: u32, installed: bool) -> Option<Arrow> {
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
    ) -> Option<ChordEvent> {
        if injected {
            return None;
        }
        if vk == VK_LWIN {
            if is_up {
                let _ = self.win_up_needs_mask(vk, false);
            } else {
                self.note_win_down(vk);
            }
            return None;
        }
        if vk == VK_RWIN {
            if is_up {
                let _ = self.win_up_needs_mask(vk, false);
            } else {
                self.note_win_down(vk);
            }
            return None;
        }
        if matches!(
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
        ) {
            let held = !is_up;
            match vk {
                VK_CONTROL | VK_LCONTROL | VK_RCONTROL => self.ctrl = held,
                VK_MENU | VK_LMENU | VK_RMENU => self.alt = held,
                _ => self.shift = held,
            }
            // Physical modifiers pass through, so the OS sees them while Win
            // is held and the Start trigger is already disguised.
            self.mask_pending = false;
            return None;
        }
        let Some(arrow) = Arrow::from_vk(vk) else {
            // Ordinary keys pass through and disguise Win at the OS level.
            self.mask_pending = false;
            return None;
        };
        let idx = arrow_index(arrow);
        if is_up {
            if !self.arrow_down[idx] {
                return None;
            }
            self.arrow_down[idx] = false;
            let origin = self.arrow_consumed[idx];
            self.arrow_consumed[idx] = false;
            self.chords[idx].up += 1;
            if self.enabled && foreground && origin {
                self.chords[idx].consumed += 1;
                Some(ChordEvent {
                    arrow,
                    edge: Edge::Up,
                    foreground,
                    consumed: true,
                    announce: false,
                })
            } else {
                self.chords[idx].passed += 1;
                // Passed ups reach the OS, which disguises Win by itself.
                // Consumed ups are swallowed above and keep pending armed.
                self.mask_pending = false;
                Some(ChordEvent {
                    arrow,
                    edge: Edge::Up,
                    foreground,
                    consumed: false,
                    announce: false,
                })
            }
        } else {
            if self.ctrl || self.alt || self.shift || !(self.win_l || self.win_r) {
                // Untracked arrows pass through, so the OS sees Win modify
                // something and the pending mask is redundant.
                self.mask_pending = false;
                return None;
            }
            if self.arrow_down[idx] {
                self.chords[idx].repeat += 1;
                // A background-origin hold never consumes mid-hold, even if it
                // turns foreground; a foreground-origin hold passes while
                // background and resumes consuming on return.
                if self.enabled && foreground && self.arrow_consumed[idx] {
                    self.chords[idx].consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(arrow);
                    Some(ChordEvent {
                        arrow,
                        edge: Edge::Repeat,
                        foreground,
                        consumed: true,
                        announce: true,
                    })
                } else {
                    self.chords[idx].passed += 1;
                    self.mask_pending = false;
                    Some(ChordEvent {
                        arrow,
                        edge: Edge::Repeat,
                        foreground,
                        consumed: false,
                        announce: false,
                    })
                }
            } else {
                self.arrow_down[idx] = true;
                let origin = self.enabled && foreground;
                self.arrow_consumed[idx] = origin;
                self.chords[idx].down += 1;
                if origin {
                    self.chords[idx].consumed += 1;
                    self.mask_pending = true;
                    self.mask_trigger = Some(arrow);
                    Some(ChordEvent {
                        arrow,
                        edge: Edge::Down,
                        foreground,
                        consumed: true,
                        announce: true,
                    })
                } else {
                    self.chords[idx].passed += 1;
                    self.mask_pending = false;
                    Some(ChordEvent {
                        arrow,
                        edge: Edge::Down,
                        foreground,
                        consumed: false,
                        announce: false,
                    })
                }
            }
        }
    }
}

/// One approved chord captured by the callback. `tick` is `Instant::now()` read
/// in the callback (cheap, monotonic); the wall-clock stamp is derived outside
/// the callback from anchors taken at install.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueuedChord {
    pub arrow: Arrow,
    pub edge: Edge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
    pub tick: std::time::Instant,
}

/// One Start-menu mask reservation. `trigger` is the arrow of the arming
/// consumed chord (never a physical Win VK or any other key); `tick` is the
/// Win-up instant the pair is sent for. `inserted` is the SendInput
/// accepted-event count (0..=2) and `release_sent` reports the single bounded
/// E8-up attempt after a partial insert. Both are stamped after the send, so
/// a short write can never be logged as success.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueuedMask {
    pub trigger: Arrow,
    pub tick: std::time::Instant,
    pub inserted: u8,
    pub release_sent: bool,
}

/// One bounded queue record: either an approved chord or a mask attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueuedEvent {
    Chord(QueuedChord),
    Mask(QueuedMask),
}

/// Bounded preallocated FIFO from the callback to the message loop.
/// `push` refuses past capacity so the callback fails closed; use
/// `record_drop` + pass-through on saturation.
#[derive(Debug)]
pub struct EventQueue {
    inner: VecDeque<QueuedEvent>,
    pub dropped: u32,
}

impl EventQueue {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: VecDeque::with_capacity(EVENT_QUEUE_CAP),
            dropped: 0,
        }
    }

    #[must_use]
    pub fn is_full(&self) -> bool {
        self.inner.len() >= EVENT_QUEUE_CAP
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
    pub fn push(&mut self, ev: QueuedEvent) -> bool {
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

    pub fn pop_front(&mut self) -> Option<QueuedEvent> {
        self.inner.pop_front()
    }

    /// Newest record, for stamping a mask result right after its send. Safe
    /// because reserve, send, and stamp run synchronously on the hook thread
    /// with no drain interleaving; reentrant injected events never touch the
    /// queue.
    pub fn back_mut(&mut self) -> Option<&mut QueuedEvent> {
        self.inner.back_mut()
    }
}

impl Default for EventQueue {
    fn default() -> Self {
        Self::new()
    }
}

/// Saturation-aware gate shared by the hook callback and tests. Bookkeeping
/// always advances (modifiers, holds, pair origins), but while the queue is
/// full nothing consumes: the approved chord is counted as a loss and passed
/// through so omissions cannot masquerade as suppression. Injected and
/// unrelated inputs never touch the queue or the loss counter. Returns
/// whether the callback must swallow the key event.
pub fn classify_and_queue(
    machine: &mut HookClassify,
    queue: &mut EventQueue,
    vk: u32,
    is_up: bool,
    foreground: bool,
    injected: bool,
    tick: std::time::Instant,
) -> Option<bool> {
    let saturated = queue.is_full();
    let saved = machine.enabled;
    if saturated {
        machine.set_enabled(false);
    }
    let ev = machine.push(vk, is_up, foreground, injected);
    machine.set_enabled(saved);
    let ev = ev?;
    if saturated {
        queue.record_drop();
        return Some(false);
    }
    let queued = queue.push(QueuedEvent::Chord(QueuedChord {
        arrow: ev.arrow,
        edge: ev.edge,
        foreground: ev.foreground,
        consumed: ev.consumed,
        announce: ev.announce,
        tick,
    }));
    if queued {
        Some(ev.consumed)
    } else {
        queue.record_drop();
        Some(false)
    }
}

/// Win-up mask reservation shared by the hook callback and tests. Reserves
/// queue evidence BEFORE any SendInput: when full nothing is injected and
/// the skip is counted, so a send is never unlogged. Returns true when the
/// caller must send the E8 pair. The Win-up itself always passes through.
pub fn win_up_mask_reserve(
    machine: &mut HookClassify,
    queue: &mut EventQueue,
    vk: u32,
    installed: bool,
    tick: std::time::Instant,
) -> bool {
    let Some(trigger) = machine.win_up_needs_mask(vk, installed) else {
        return false;
    };
    if queue.push(QueuedEvent::Mask(QueuedMask {
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
    machine: &mut HookClassify,
    queue: &mut EventQueue,
    inserted: u8,
    release_sent: bool,
) {
    if inserted == 2 && !release_sent {
        machine.mask_ok += 1;
    } else {
        machine.mask_failed += 1;
    }
    if let Some(QueuedEvent::Mask(slot)) = queue.back_mut() {
        slot.inserted = inserted;
        slot.release_sent = release_sent;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum MethodState {
    #[serde(rename = "enabled")]
    Enabled,
    #[serde(rename = "release-check")]
    ReleaseCheck,
    #[serde(rename = "done")]
    Done,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChordReport {
    pub chord: &'static str,
    pub down: u32,
    pub up: u32,
    pub repeat: u32,
    pub delivered: u32,
    pub consumed: u32,
    pub acted: u32,
    pub passed: u32,
    pub skipped: u32,
    pub last_requested: Option<[i32; 4]>,
    pub last_observed: Option<[i32; 4]>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MethodReport {
    pub method: &'static str,
    pub state: MethodState,
    pub hook_installed: Option<bool>,
    pub hook_error: Option<u32>,
    pub queue_dropped: u32,
    pub events_logged: u64,
    pub events_path: Option<String>,
    pub chords: [ChordReport; 4],
    pub mask_attempted: u32,
    pub mask_ok: u32,
    pub mask_failed: u32,
    pub mask_skipped: u32,
    pub release_ok: bool,
    pub release_error: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RestoreReport {
    pub ok: Option<bool>,
    pub error: Option<String>,
    pub readback: Option<[i32; 4]>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpikeReport {
    pub schema: u32,
    pub owner: crate::model::ProcessIdentity,
    pub helper: crate::test_window::WindowSnapshot,
    pub focus_note: &'static str,
    pub method: MethodReport,
    pub restore: RestoreReport,
    pub exit: String,
    pub exit_error: Option<String>,
}

fn blank_chords() -> [ChordReport; 4] {
    Arrow::all().map(|a| ChordReport {
        chord: a.name(),
        down: 0,
        up: 0,
        repeat: 0,
        delivered: 0,
        consumed: 0,
        acted: 0,
        passed: 0,
        skipped: 0,
        last_requested: None,
        last_observed: None,
    })
}

#[must_use]
pub fn new_hook_method() -> MethodReport {
    MethodReport {
        method: "hook",
        state: MethodState::Enabled,
        hook_installed: None,
        hook_error: None,
        queue_dropped: 0,
        events_logged: 0,
        events_path: None,
        chords: blank_chords(),
        mask_attempted: 0,
        mask_ok: 0,
        mask_failed: 0,
        mask_skipped: 0,
        release_ok: false,
        release_error: None,
        note: String::new(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpikeRunOptions {
    pub helper_hwnd: u64,
    pub report: std::path::PathBuf,
}

pub fn parse_spike_run_args(args: &[String]) -> Result<SpikeRunOptions, String> {
    let usage = "usage: run --helper-hwnd HWND --report PATH";
    let mut helper_hwnd: Option<u64> = None;
    let mut report: Option<std::path::PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--helper-hwnd" => {
                i += 1;
                let v = args.get(i).ok_or(usage)?;
                helper_hwnd = Some(crate::test_window::parse_hwnd(v).ok_or(usage)?);
                i += 1;
            }
            "--report" => {
                i += 1;
                let v = args.get(i).ok_or(usage)?;
                report = Some(std::path::PathBuf::from(v));
                i += 1;
            }
            _ => return Err(usage.to_owned()),
        }
    }
    Ok(SpikeRunOptions {
        helper_hwnd: helper_hwnd.ok_or(usage)?,
        report: report.ok_or(usage)?,
    })
}

/// Sibling per-event log for a spike report. Lives in the machine-bound run
/// dir next to the report; the script expects it there.
#[must_use]
pub fn events_path_for(report: &std::path::Path) -> Option<std::path::PathBuf> {
    report.parent().map(|p| p.join("events.jsonl"))
}

#[cfg(windows)]
pub mod sys {
    use super::{
        Edge, HOOK_ENABLED_SECONDS, MethodReport, MethodState, RELEASE_CHECK_SECONDS,
        RestoreReport, SPIKE_HARD_SECONDS, SPIKE_LEDGER_SECONDS, SpikeReport, arrow_index,
        events_path_for, new_hook_method, parse_spike_run_args,
    };
    use crate::model::ProcessIdentity;
    use crate::native::HeldProcess;
    use crate::test_window::WindowSnapshot;
    use std::cell::RefCell;
    use std::fs::File;
    use std::io::Write as _;
    use std::path::Path;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
        VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    type DynError = Box<dyn std::error::Error>;
    type Result<T> = std::result::Result<T, DynError>;

    fn err(msg: impl Into<String>) -> DynError {
        Box::new(std::io::Error::other(msg.into()))
    }

    const TICK_MS: u32 = 100;

    struct HookState {
        helper_hwnd: u64,
        helper_pid: u32,
        helper_tag: u64,
        machine: super::HookClassify,
        queue: super::EventQueue,
    }

    thread_local! {
        static HOOK: RefCell<Option<HookState>> = const { RefCell::new(None) };
    }

    fn hook_foreground(st: &HookState) -> bool {
        if unsafe { GetForegroundWindow() } as usize as u64 != st.helper_hwnd {
            return false;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(st.helper_hwnd as isize as HWND, &mut pid) };
        if pid != st.helper_pid {
            return false;
        }
        let v = unsafe {
            GetPropW(
                st.helper_hwnd as isize as HWND,
                windows_sys::w!("PlasmaAutoTilerLifetime"),
            )
        };
        if v.is_null() {
            return false;
        }
        v as usize as u64 == st.helper_tag
    }

    /// Minimal callback: modifier/chord bookkeeping plus one bounded queue
    /// push. No logging, waits, file I/O, or geometry work here. Consumed
    /// chords are swallowed; approved-but-passing chords are queued for the
    /// log and passed through to the system. A physical Win-up that closes a
    /// hold with a consumed chord sends the E8 mask pair first (with no HOOK
    /// borrow held); the Win-up itself always passes through.
    unsafe extern "system" fn llproc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code as u32 == HC_ACTION {
            let kb = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
            let vk = kb.vkCode;
            let flags = kb.flags;
            let injected = flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED) != 0;
            // Own-injection guard BEFORE any HOOK borrow: the SendInput pair
            // below reenters this callback on the same thread, and
            // re-borrowing the RefCell would panic. Injected events always
            // pass through untouched.
            if injected {
                return unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) };
            }
            let is_up = flags & LLKHF_UP != 0;
            if is_up && super::is_win_vk(vk) {
                let tick = Instant::now();
                let fire = HOOK.with(|h| {
                    let mut h = h.borrow_mut();
                    let st = h.as_mut()?;
                    let installed = st.machine.enabled;
                    Some(super::win_up_mask_reserve(
                        &mut st.machine,
                        &mut st.queue,
                        vk,
                        installed,
                        tick,
                    ))
                });
                if fire == Some(true) {
                    let sent = send_mask_pair();
                    HOOK.with(|h| {
                        if let Some(st) = h.borrow_mut().as_mut() {
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
            // Modifiers may already be held when the hook starts.
            if !is_up
                && super::Arrow::from_vk(vk).is_some()
                && [VK_CONTROL, VK_MENU, VK_SHIFT]
                    .iter()
                    .any(|key| unsafe { GetAsyncKeyState(i32::from(*key)) } < 0)
            {
                return unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) };
            }
            let consume = HOOK.with(|h| {
                let mut h = h.borrow_mut();
                let st = h.as_mut()?;
                let fg = hook_foreground(st);
                let tick = Instant::now();
                super::classify_and_queue(
                    &mut st.machine,
                    &mut st.queue,
                    vk,
                    is_up,
                    fg,
                    injected,
                    tick,
                )
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

    /// Sends the E8 down/up pair: two keyboard INPUT records with the
    /// unassigned VK and no scancode masquerading as a Ctrl modifier. Must be
    /// called with no HOOK borrow held (see llproc). Returns the
    /// accepted-event count plus whether the bounded partial-release ran.
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

    /// Per-event log writer. All filesystem serialization happens on the
    /// message-loop thread; the callback only fills the bounded queue.
    /// Schema per line: chord lines carry arrow/edge/foreground/disposition/
    /// acted/result; mask lines carry the arming trigger arrow plus the
    /// inserted count, release flag, and result (never raw Win VKs or other
    /// keys); focus lines carry foreground only; phase lines carry the
    /// phase name + foreground; drop lines carry the loss count. No HWNDs,
    /// titles, or unrelated key data. Timestamps: the callback captures an
    /// `Instant` tick; `mono_ms` is elapsed since the install anchor and
    /// `wall` is wall-clock anchored at install (no clock reads in the
    /// callback beyond the cheap monotonic tick).
    struct EventLog {
        file: File,
        wall_start_ms: u64,
        tick_start: Instant,
        seq: u64,
    }

    impl EventLog {
        fn create(path: &Path) -> std::result::Result<Self, String> {
            if path.exists() {
                return Err("refuse: events log preexists".to_owned());
            }
            let tick_start = Instant::now();
            let wall_start_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .map_err(|e| format!("error: wall clock {e}"))?;
            let file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|e| format!("error: events create: {e}"))?;
            Ok(Self {
                file,
                wall_start_ms,
                tick_start,
                seq: 0,
            })
        }

        fn stamp(&self, tick: Instant) -> (String, u64) {
            let mono = tick.saturating_duration_since(self.tick_start).as_millis() as u64;
            let wall = self.wall_start_ms.saturating_add(mono);
            (format!("{}.{:03}Z", wall / 1000, wall % 1000), mono)
        }

        fn stamp_now(&self) -> (String, u64) {
            self.stamp(Instant::now())
        }

        fn emit(&mut self, value: serde_json::Value) -> std::result::Result<(), String> {
            let mut line =
                serde_json::to_string(&value).map_err(|e| format!("error: events json {e}"))?;
            line.push('\n');
            self.file
                .write_all(line.as_bytes())
                .map_err(|e| format!("error: events write: {e}"))?;
            self.seq += 1;
            Ok(())
        }

        fn flush(&mut self) -> std::result::Result<(), String> {
            self.file
                .flush()
                .map_err(|e| format!("error: events flush: {e}"))
        }

        fn phase(
            &mut self,
            name: &'static str,
            foreground: bool,
        ) -> std::result::Result<(), String> {
            let (wall, mono) = self.stamp_now();
            self.emit(serde_json::json!({
                "seq": self.seq, "wall": wall, "mono_ms": mono,
                "kind": "phase", "phase": name, "foreground": foreground,
            }))
        }

        fn focus(&mut self, foreground: bool) -> std::result::Result<(), String> {
            let (wall, mono) = self.stamp_now();
            self.emit(serde_json::json!({
                "seq": self.seq, "wall": wall, "mono_ms": mono,
                "kind": "focus", "foreground": foreground,
            }))
        }

        fn drop(&mut self, lost: u32) -> std::result::Result<(), String> {
            let (wall, mono) = self.stamp_now();
            self.emit(serde_json::json!({
                "seq": self.seq, "wall": wall, "mono_ms": mono,
                "kind": "drop", "lost": lost,
            }))
        }

        fn chord(
            &mut self,
            ev: super::QueuedChord,
            acted: bool,
            result: &str,
        ) -> std::result::Result<(), String> {
            let (wall, mono) = self.stamp(ev.tick);
            let disposition = if ev.consumed { "consumed" } else { "passed" };
            let edge = match ev.edge {
                Edge::Down => "down",
                Edge::Up => "up",
                Edge::Repeat => "repeat",
            };
            self.emit(serde_json::json!({
                "seq": self.seq, "wall": wall, "mono_ms": mono,
                "kind": "chord", "arrow": ev.arrow.name(), "edge": edge,
                "foreground": ev.foreground, "disposition": disposition,
                "acted": acted, "result": result,
            }))
        }

        fn mask(&mut self, ev: super::QueuedMask, result: &str) -> std::result::Result<(), String> {
            let (wall, mono) = self.stamp(ev.tick);
            self.emit(serde_json::json!({
                "seq": self.seq, "wall": wall, "mono_ms": mono,
                "kind": "mask", "trigger": ev.trigger.name(),
                "inserted": ev.inserted, "release_sent": ev.release_sent,
                "result": result,
            }))
        }
    }

    fn snapshot_owned(
        hwnd: u64,
        helper_exe: &str,
        sid: &str,
        session: u32,
    ) -> std::result::Result<WindowSnapshot, String> {
        crate::test_window::sys::query_owned(hwnd, helper_exe, sid, session)
            .map_err(|e| e.to_string())
    }

    fn baseline_matches(base: &WindowSnapshot, snap: &WindowSnapshot) -> bool {
        snap.hwnd == base.hwnd && snap.process == base.process && snap.tag == base.tag
    }

    fn hold_helper(
        pid: u32,
        expected: &ProcessIdentity,
    ) -> std::result::Result<HeldProcess, String> {
        let held = HeldProcess::open(pid).map_err(|e| format!("refuse: helper open {e}"))?;
        let live = held
            .identity()
            .map_err(|e| format!("refuse: helper identity {e}"))?;
        if live != *expected || !held.is_alive() {
            return Err("refuse: helper identity changed".to_owned());
        }
        Ok(held)
    }

    fn foreground_exact(base: &WindowSnapshot) -> bool {
        (unsafe { GetForegroundWindow() }) as usize as u64 == base.hwnd
    }

    /// Best-effort status title on the verified helper only; skips silently on
    /// any identity mismatch. Outside the callback, at most once per second.
    /// Never logs title text.
    fn set_helper_title(base: &WindowSnapshot, helper_exe: &str, text: &str) {
        let Ok(snap) = snapshot_owned(
            base.hwnd,
            helper_exe,
            &base.process.user_sid,
            base.process.session_id,
        ) else {
            return;
        };
        if !baseline_matches(base, &snap) {
            return;
        }
        let Ok(held) = hold_helper(snap.process.pid, &base.process) else {
            return;
        };
        if !held.is_alive() {
            return;
        }
        let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
        unsafe {
            SetWindowTextW(base.hwnd as isize as HWND, wide.as_ptr());
        }
    }

    /// Single owned-geometry writer for nudge and final restore.
    /// Pre-queries + holds identity, optionally restores normal state,
    /// moves without activation, then verifies exact rect + identity + tag.
    fn set_owned_rect(
        base: &WindowSnapshot,
        helper_exe: &str,
        want: [i32; 4],
        restoring: bool,
    ) -> std::result::Result<[i32; 4], String> {
        let pre = snapshot_owned(
            base.hwnd,
            helper_exe,
            &base.process.user_sid,
            base.process.session_id,
        )?;
        if !baseline_matches(base, &pre) {
            return Err("refuse: helper identity changed".to_owned());
        }
        let held = hold_helper(pre.process.pid, &base.process)?;
        let raw = base.hwnd as isize as HWND;
        if restoring && (unsafe { IsIconic(raw) } != 0 || unsafe { IsZoomed(raw) } != 0) {
            unsafe { ShowWindow(raw, SW_SHOWNOACTIVATE) };
            if unsafe { IsIconic(raw) } != 0 || unsafe { IsZoomed(raw) } != 0 {
                return Err("refuse: helper still minimized/maximized".to_owned());
            }
        }
        let ok = unsafe {
            SetWindowPos(
                raw,
                std::ptr::null_mut(),
                want[0],
                want[1],
                want[2] - want[0],
                want[3] - want[1],
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        };
        if ok == 0 {
            return Err(format!("error: SetWindowPos win32-{}", unsafe {
                GetLastError()
            }));
        }
        if !held.is_alive() {
            return Err("refuse: helper exited during move".to_owned());
        }
        let back = snapshot_owned(
            base.hwnd,
            helper_exe,
            &base.process.user_sid,
            base.process.session_id,
        )?;
        if !baseline_matches(base, &back) {
            return Err("refuse: helper identity changed".to_owned());
        }
        let got = [back.left, back.top, back.right, back.bottom];
        if got != want {
            return Err(format!("refuse: readback {got:?} != requested {want:?}"));
        }
        Ok(got)
    }

    fn nudge(
        base: &WindowSnapshot,
        helper_exe: &str,
        arrow: super::Arrow,
    ) -> std::result::Result<([i32; 4], [i32; 4]), String> {
        let w = base.right - base.left;
        let h = base.bottom - base.top;
        let (dx, dy) = arrow.offset();
        let want = [
            base.left + dx,
            base.top + dy,
            base.left + dx + w,
            base.top + dy + h,
        ];
        let got = set_owned_rect(base, helper_exe, want, false)?;
        Ok((want, got))
    }

    fn write_report(path: &Path, report: &SpikeReport) -> std::result::Result<(), String> {
        use std::os::windows::ffi::OsStrExt;
        let json = serde_json::to_string(report).map_err(|e| format!("error: report json {e}"))?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("error: report write: {e}"))?;
        let from_w: Vec<u16> = tmp.as_os_str().encode_wide().chain([0]).collect();
        let to_w: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        let ok = unsafe {
            MoveFileExW(
                from_w.as_ptr(),
                to_w.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if ok == 0 {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("error: report replace win32-{}", unsafe {
                GetLastError()
            }));
        }
        Ok(())
    }

    fn build_report(
        owner: &ProcessIdentity,
        helper: &WindowSnapshot,
        method: &MethodReport,
        restore: &RestoreReport,
        exit: &str,
        exit_error: &Option<String>,
    ) -> SpikeReport {
        SpikeReport {
            schema: 3,
            owner: owner.clone(),
            helper: helper.clone(),
            focus_note: super::FOCUS_NOTE,
            method: method.clone(),
            restore: restore.clone(),
            exit: exit.to_owned(),
            exit_error: exit_error.clone(),
        }
    }

    fn stop_requested(dir: &Path, owner_creation: &str) -> std::result::Result<bool, String> {
        match std::fs::read_to_string(dir.join(crate::lifecycle::STOP_REQUEST_FILE)) {
            Ok(text) => Ok(crate::lifecycle::stop_request_matches(
                &text,
                owner_creation,
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(format!("error: stop read: {e}")),
        }
    }

    fn pull_hook_counts(method: &mut MethodReport) {
        let Some((counts, dropped, mask)) = HOOK.with(|h| {
            h.borrow().as_ref().map(|s| {
                (
                    s.machine.chords,
                    s.queue.dropped,
                    (
                        s.machine.mask_attempted,
                        s.machine.mask_ok,
                        s.machine.mask_failed,
                        s.machine.mask_skipped,
                    ),
                )
            })
        }) else {
            return;
        };
        for (i, c) in counts.iter().enumerate() {
            let r = &mut method.chords[i];
            r.down = c.down;
            r.up = c.up;
            r.repeat = c.repeat;
            // Truthful hook delivery: chord downs plus repeats; key-ups stay
            // in `up` only. `skipped` is owned by the drain (foreground lost
            // between consume and act) and is never overwritten here.
            r.delivered = c.down.saturating_add(c.repeat);
            r.consumed = c.consumed;
            r.acted = c.acted;
            r.passed = c.passed;
        }
        if dropped > method.queue_dropped {
            method.queue_dropped = dropped;
        }
        method.mask_attempted = mask.0;
        method.mask_ok = mask.1;
        method.mask_failed = mask.2;
        method.mask_skipped = mask.3;
    }

    fn release_now(
        hook: &mut HHOOK,
        live: &mut bool,
        method: &mut MethodReport,
    ) -> std::result::Result<(), String> {
        if !*live {
            return Ok(());
        }
        *live = false;
        HOOK.with(|h| {
            if let Some(s) = h.borrow_mut().as_mut() {
                s.machine.set_enabled(false);
            }
        });
        pull_hook_counts(method);
        if unsafe { UnhookWindowsHookEx(*hook) } == 0 {
            let e = format!("win32-{}", unsafe { GetLastError() });
            method.release_ok = false;
            method.release_error = Some(e.clone());
            return Err(e);
        }
        *hook = std::ptr::null_mut();
        HOOK.with(|h| *h.borrow_mut() = None);
        method.release_ok = true;
        method.release_error = None;
        Ok(())
    }

    /// Drain the bounded queue on the message-loop thread: act on consumed
    /// downs with a foreground recheck, then serialize every approved event to
    /// the log. Saturation losses are emitted explicitly as drop lines.
    fn drain_queue(
        base: &WindowSnapshot,
        helper_exe: &str,
        method: &mut MethodReport,
        log: &mut EventLog,
    ) -> std::result::Result<(), String> {
        let dropped = HOOK.with(|h| h.borrow().as_ref().map(|s| s.queue.dropped).unwrap_or(0));
        if dropped > method.queue_dropped {
            log.drop(dropped - method.queue_dropped)?;
            method.queue_dropped = dropped;
            method.events_logged += 1;
        }
        loop {
            let ev = HOOK.with(|h| h.borrow_mut().as_mut().and_then(|s| s.queue.pop_front()));
            let Some(ev) = ev else { break };
            match ev {
                super::QueuedEvent::Mask(m) => {
                    let result = if m.inserted == 2 && !m.release_sent {
                        "mask-ok".to_owned()
                    } else {
                        format!("mask-failed-{}", m.inserted)
                    };
                    log.mask(m, &result)?;
                    method.events_logged += 1;
                }
                super::QueuedEvent::Chord(ch) => {
                    let idx = arrow_index(ch.arrow);
                    let (acted, result) = if ch.consumed && ch.announce {
                        if !foreground_exact(base) {
                            method.chords[idx].skipped += 1;
                            (false, "recheck-background".to_owned())
                        } else {
                            match nudge(base, helper_exe, ch.arrow) {
                                Ok((want, got)) => {
                                    HOOK.with(|h| {
                                        if let Some(s) = h.borrow_mut().as_mut() {
                                            s.machine.note_acted(ch.arrow);
                                        }
                                    });
                                    method.chords[idx].last_requested = Some(want);
                                    method.chords[idx].last_observed = Some(got);
                                    (true, "nudge-ok".to_owned())
                                }
                                Err(e) => {
                                    let detail = format!("action-error: {e}");
                                    log.chord(ch, false, &detail)?;
                                    method.events_logged += 1;
                                    pull_hook_counts(method);
                                    log.flush()?;
                                    return Err(e);
                                }
                            }
                        }
                    } else if ch.consumed {
                        (false, "consumed-up".to_owned())
                    } else {
                        (false, "passed".to_owned())
                    };
                    log.chord(ch, acted, &result)?;
                    method.events_logged += 1;
                }
            }
        }
        pull_hook_counts(method);
        log.flush()
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Phase {
        Enabled,
        ReleaseCheck,
    }

    fn is_helper_gone(e: &str) -> bool {
        e.contains("helper exited")
            || e.contains("helper pid")
            || e.contains("helper identity changed")
            || e.contains("helper open")
            || e.contains("helper identity")
    }

    fn spike_body(
        dir: &Path,
        me: &ProcessIdentity,
        helper_hwnd: u64,
        report: &Path,
    ) -> Result<bool> {
        let helper_exe =
            crate::test_window::sys::sibling_helper_exe().map_err(|e| err(e.to_string()))?;
        let base = snapshot_owned(helper_hwnd, &helper_exe, &me.user_sid, me.session_id)
            .map_err(|e| err(format!("refuse: helper {e}")))?;
        if !base.visible {
            return Err(err("refuse: helper not visible"));
        }
        let raw = base.hwnd as isize as HWND;
        if unsafe { IsIconic(raw) } != 0 {
            return Err(err("refuse: helper minimized"));
        }
        if unsafe { IsZoomed(raw) } != 0 {
            return Err(err("refuse: helper maximized"));
        }
        if report.exists() {
            return Err(err("refuse: report preexists"));
        }
        let Some(parent) = report.parent() else {
            return Err(err("error: report no parent"));
        };
        if !parent.is_dir() {
            return Err(err("error: report parent missing"));
        }
        let events_path = events_path_for(report).ok_or_else(|| err("error: report no parent"))?;
        let helper_hold = hold_helper(base.process.pid, &base.process).map_err(err)?;
        let mut method = new_hook_method();
        method.events_path = Some(events_path.to_string_lossy().into_owned());
        let mut restore = RestoreReport::default();
        let mut exit = "started".to_owned();
        let mut exit_error: Option<String> = None;
        let mut stopped = false;

        let snap = |m: &MethodReport, r: &RestoreReport, e: &str, ee: &Option<String>| {
            write_report(report, &build_report(me, &base, m, r, e, ee))
        };
        snap(&method, &restore, &exit, &exit_error).map_err(err)?;

        // Prime the thread queue so the loop can run, then a single 100ms
        // thread timer for stop/deadline/drain checks plus a 1s sub-tick for
        // the status title and focus-change evidence.
        let mut prime: MSG = unsafe { std::mem::zeroed() };
        unsafe { PeekMessageW(&mut prime, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };
        let timer_id = unsafe { SetTimer(std::ptr::null_mut(), 0, TICK_MS, None) };
        if timer_id == 0 {
            return Err(err("error: SetTimer failed"));
        }

        // Install once with no focus gate. Timing-only fallback when the tag
        // is bad or the install fails; the report says so honestly.
        let mut hook: HHOOK = std::ptr::null_mut();
        let mut live = false;
        let mut released = false;
        let tag_num = u64::from_str_radix(base.tag.trim(), 16).unwrap_or(0);
        if tag_num == 0 {
            method.hook_installed = Some(false);
            method.note.push_str("bad helper tag; timing only. ");
            method.release_ok = true;
            released = true;
        } else {
            let hmod = unsafe { GetModuleHandleW(std::ptr::null()) };
            HOOK.with(|h| {
                *h.borrow_mut() = Some(HookState {
                    helper_hwnd: base.hwnd,
                    helper_pid: base.process.pid,
                    helper_tag: tag_num,
                    machine: super::HookClassify::new(true),
                    queue: super::EventQueue::new(),
                });
            });
            let h = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(llproc), hmod, 0) };
            if h.is_null() {
                let code = unsafe { GetLastError() };
                method.hook_installed = Some(false);
                method.hook_error = Some(code);
                method
                    .note
                    .push_str(&format!("hook install failed win32-{code}. "));
                method.release_ok = true;
                released = true;
                HOOK.with(|h| *h.borrow_mut() = None);
            } else {
                hook = h;
                live = true;
                method.hook_installed = Some(true);
                method.note.push_str("hook installed. ");
            }
        }
        let mut log = EventLog::create(&events_path).map_err(|e| {
            if live && !released {
                let mut m = method.clone();
                let mut h = hook;
                let mut l = live;
                let _ = release_now(&mut h, &mut l, &mut m);
            }
            unsafe { KillTimer(std::ptr::null_mut(), timer_id) };
            HOOK.with(|h| *h.borrow_mut() = None);
            err(e)
        })?;
        method.state = MethodState::Enabled;
        let fg0 = foreground_exact(&base);
        // Honest phase: the fallback never installs, so it must not claim
        // hook-on. The countdown title is live-only.
        let available = live;
        log.phase(
            if available {
                "hook-on"
            } else {
                "hook-unavailable"
            },
            fg0,
        )
        .map_err(|e| {
            if live && !released {
                let mut m = method.clone();
                let mut h = hook;
                let mut l = live;
                let _ = release_now(&mut h, &mut l, &mut m);
            }
            unsafe { KillTimer(std::ptr::null_mut(), timer_id) };
            HOOK.with(|h| *h.borrow_mut() = None);
            err(e)
        })?;
        method.events_logged += 1;
        if available {
            set_helper_title(
                &base,
                &helper_exe,
                &format!("HOOK ON {HOOK_ENABLED_SECONDS}s - tap Win+Up/Left/Right/Down"),
            );
        } else {
            set_helper_title(&base, &helper_exe, "HOOK UNAVAILABLE - leave keys alone");
        }
        snap(&method, &restore, &exit, &exit_error).map_err(|e| {
            if live && !released {
                let mut m = method.clone();
                let mut h = hook;
                let mut l = live;
                let _ = release_now(&mut h, &mut l, &mut m);
            }
            unsafe { KillTimer(std::ptr::null_mut(), timer_id) };
            HOOK.with(|h| *h.borrow_mut() = None);
            err(e)
        })?;

        // Fixed 60s installed (focus changes never uninstall) then one ~20s
        // release check with the hook removed.
        let hard = Instant::now() + Duration::from_secs(SPIKE_HARD_SECONDS);
        let mut phase = Phase::Enabled;
        let mut ends_at = Instant::now() + Duration::from_secs(HOOK_ENABLED_SECONDS);
        let mut last_fg = Some(fg0);
        let mut last_tick = Instant::now();
        let loop_out: std::result::Result<bool, String> = (|| {
            let mut msg: MSG = unsafe { std::mem::zeroed() };
            loop {
                let r = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
                if r == 0 {
                    exit = "interrupted".to_owned();
                    break;
                }
                if r == -1 {
                    return Err("error: message loop".to_owned());
                }
                if msg.message != WM_TIMER {
                    continue;
                }
                if stop_requested(dir, &me.process_creation)? {
                    stopped = true;
                    exit = "stop-request".to_owned();
                    break;
                }
                if Instant::now() >= hard {
                    exit = "interrupted".to_owned();
                    break;
                }
                if !helper_hold.is_alive() {
                    return Err("refuse: helper exited".to_owned());
                }
                match snapshot_owned(base.hwnd, &helper_exe, &me.user_sid, me.session_id) {
                    Ok(s) if baseline_matches(&base, &s) => {}
                    Ok(_) => {
                        return Err("refuse: helper identity changed".to_owned());
                    }
                    Err(e) => return Err(e),
                }
                drain_queue(&base, &helper_exe, &mut method, &mut log)?;
                if last_tick.elapsed() >= Duration::from_secs(1) {
                    last_tick = Instant::now();
                    let fg = foreground_exact(&base);
                    if last_fg != Some(fg) {
                        log.focus(fg)?;
                        method.events_logged += 1;
                        last_fg = Some(fg);
                    }
                    if phase == Phase::Enabled && available {
                        let remain = ends_at.saturating_duration_since(Instant::now()).as_secs();
                        set_helper_title(
                            &base,
                            &helper_exe,
                            &format!("HOOK ON {remain}s - tap Win+Up/Left/Right/Down"),
                        );
                    }
                }
                if Instant::now() >= ends_at {
                    match phase {
                        Phase::Enabled => {
                            if !released {
                                if let Err(e) = release_now(&mut hook, &mut live, &mut method) {
                                    exit = "release-failed".to_owned();
                                    return Err(format!("error: release {e}"));
                                }
                                released = true;
                            }
                            drain_queue(&base, &helper_exe, &mut method, &mut log)?;
                            let fg = foreground_exact(&base);
                            // A hook that never installed has nothing to release;
                            // keep the neutral title instead of claiming HOOK OFF.
                            if available {
                                log.phase("hook-off", fg)?;
                                set_helper_title(
                                    &base,
                                    &helper_exe,
                                    "HOOK OFF - tap Win+Left once",
                                );
                            } else {
                                log.phase("still-unavailable", fg)?;
                                set_helper_title(
                                    &base,
                                    &helper_exe,
                                    "HOOK UNAVAILABLE - leave keys alone",
                                );
                            }
                            method.events_logged += 1;
                            phase = Phase::ReleaseCheck;
                            method.state = MethodState::ReleaseCheck;
                            ends_at = Instant::now() + Duration::from_secs(RELEASE_CHECK_SECONDS);
                            snap(&method, &restore, &exit, &exit_error)?;
                        }
                        Phase::ReleaseCheck => {
                            method.state = MethodState::Done;
                            set_helper_title(&base, &helper_exe, "DONE");
                            let fg = foreground_exact(&base);
                            log.phase("done", fg)?;
                            method.events_logged += 1;
                            if exit == "started" {
                                exit = if stopped {
                                    "stop-request".to_owned()
                                } else {
                                    "completed".to_owned()
                                };
                            }
                            break;
                        }
                    }
                }
            }
            Ok(stopped)
        })();

        let loop_err: Option<String> = match loop_out {
            Ok(s) => {
                stopped = s;
                None
            }
            Err(e) => Some(e),
        };

        // Cleanup always runs once: single release, exact restore, final report.
        // Release failures are never overwritten; cleanup failures combine
        // with the loop error instead of console-only logging.
        if !released && live {
            if let Err(e) = release_now(&mut hook, &mut live, &mut method) {
                if exit_error.is_none() {
                    exit_error = Some(format!("error: release {e}"));
                } else {
                    let prev = exit_error.take().unwrap_or_default();
                    exit_error = Some(format!("{prev} ; release {e}"));
                }
                if exit == "started" {
                    exit = "release-failed".to_owned();
                }
            }
            released = true;
        }
        pull_hook_counts(&mut method);
        if method.state != MethodState::Done {
            method.state = MethodState::Done;
        }
        // Final DONE title precedes the exact restore so the cue is visible
        // until the helper closes.
        set_helper_title(&base, &helper_exe, "DONE");
        match set_owned_rect(
            &base,
            &helper_exe,
            [base.left, base.top, base.right, base.bottom],
            true,
        ) {
            Ok(rect) => {
                restore.ok = Some(true);
                restore.readback = Some(rect);
            }
            Err(e) => {
                restore.ok = Some(false);
                restore.error = Some(e.clone());
                if exit_error.is_none() {
                    exit_error = Some(format!("error: restore {e}"));
                } else {
                    let prev = exit_error.take().unwrap_or_default();
                    exit_error = Some(format!("{prev} ; restore {e}"));
                }
                if exit == "started" || exit == "completed" {
                    exit = "restore-refused".to_owned();
                }
            }
        }
        if exit == "started" {
            exit = if stopped {
                "stop-request".to_owned()
            } else {
                "completed".to_owned()
            };
        }
        if exit_error.is_none() {
            exit_error = loop_err.clone();
            if let Some(e) = loop_err.clone()
                && exit == "started"
                && is_helper_gone(&e)
            {
                exit = "helper-exited".to_owned();
            }
        } else if let Some(loop_e) = loop_err.clone() {
            // Preserve both: loop error plus cleanup detail is already merged
            // above for release/restore; if loop error is distinct, combine.
            let prev = exit_error.take().unwrap_or_default();
            if !prev.contains(&loop_e) {
                exit_error = Some(format!("{prev} ; {loop_e}"));
            } else {
                exit_error = Some(prev);
            }
            if exit == "started" && is_helper_gone(&loop_e) {
                exit = "helper-exited".to_owned();
            }
        }
        let _ = log.flush();
        unsafe { KillTimer(std::ptr::null_mut(), timer_id) };
        HOOK.with(|h| *h.borrow_mut() = None);
        let _ = released;
        if let Err(e) = write_report(
            report,
            &build_report(me, &base, &method, &restore, &exit, &exit_error),
        ) {
            return Err(err(e));
        }
        if let Some(e) = exit_error {
            // Release errors are retained; never overwritten by a generic error.
            return Err(err(format!("error: spike {e}")));
        }
        Ok(stopped)
    }

    pub fn run_spike(helper_hwnd: u64, report: &Path) -> Result<String> {
        let report = report.to_owned();
        crate::lifecycle::sys::run_with_callback(
            SPIKE_LEDGER_SECONDS,
            false,
            None,
            move |dir, me| spike_body(dir, me, helper_hwnd, &report),
        )
    }

    pub fn parse_and_run(args: &[String]) -> std::result::Result<String, (i32, String)> {
        let opts = parse_spike_run_args(args).map_err(|m| (2, m))?;
        run_spike(opts.helper_hwnd, &opts.report).map_err(|e| (1, e.to_string()))
    }
}
