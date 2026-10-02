use tiler_core::boundary::{CoreCommand, CoreReply};
use tiler_core::directional::{Direction, WindowId};
use tiler_core::engine::Engine;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::size_hints::WindowSizeHints;
use tiler_windows::snapkey::{
    Classified, INTENT_QUEUE_CAP, KeyboardConfig, MARKED_DIAG_CAP, MOD_DIAG_CAP, MarkedDiagBuf,
    MarkedKeyDiag, ModDiagBuf, ModSource, ModTrafficDiag, OriginVerdict, QueuedSnapEvent,
    SnapClassify, SnapEdge, SnapIntent, SnapOp, SnapOrigin, SnapQueue, VK_0, VK_CONTROL, VK_DOWN,
    VK_H, VK_J, VK_K, VK_L, VK_LEFT, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MASK, VK_MENU, VK_RIGHT,
    VK_RWIN, VK_SHIFT, VK_UP, WorkspaceOp, classify_and_queue, direction_name, is_proof_mod_vk,
    is_win_vk, marked_diag_evidence, mod_diag_evidence, resolve_origin, stamp_mask_result,
    win_up_mask_reserve,
};
use tiler_windows::tiling::{ReconcileInput, build_reconcile_event, fingerprint, parse_tile_args};

fn takeover() -> KeyboardConfig {
    KeyboardConfig {
        takeover: true,
        allow_win_l: false,
    }
}

fn origin_of(hwnd: u64, token: &str) -> SnapOrigin {
    SnapOrigin {
        hwnd,
        token: token.to_owned(),
        pid: 1000 + hwnd as u32,
        creation: format!("creation-{hwnd}"),
    }
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| (*s).to_owned()).collect()
}

fn win_down(m: &mut SnapClassify, win: u32) {
    assert_eq!(SnapClassify::push(m, win, false, true, false), None);
}

/// Test helper: the unified classifier returns `Classified`; directional
/// tests unwrap the snap half. Digits use `push_workspace` below.
fn push_snap(
    m: &mut SnapClassify,
    vk: u32,
    is_up: bool,
    fg: bool,
    inj: bool,
) -> Option<SnapIntent> {
    match SnapClassify::push(m, vk, is_up, fg, inj)? {
        Classified::Snap(intent) => Some(intent),
        Classified::Workspace(_) => panic!("expected directional chord"),
    }
}

fn push_workspace(
    m: &mut SnapClassify,
    vk: u32,
    is_up: bool,
    fg: bool,
    inj: bool,
) -> Option<tiler_windows::snapkey::WorkspaceIntent> {
    match SnapClassify::push(m, vk, is_up, fg, inj)? {
        Classified::Workspace(intent) => Some(intent),
        Classified::Snap(_) => panic!("expected workspace digit"),
    }
}

// Letter and arrow aliases share one catalog: unshifted focuses, Shift moves.
#[test]
fn exact_catalog_maps_all_sixteen_chords() {
    let cases: &[(u32, Direction)] = &[
        (VK_H, Direction::Left),
        (VK_J, Direction::Down),
        (VK_K, Direction::Up),
        (VK_LEFT, Direction::Left),
        (VK_DOWN, Direction::Down),
        (VK_UP, Direction::Up),
        (VK_RIGHT, Direction::Right),
    ];
    for (vk, direction) in cases {
        // Focus: Win+key.
        let mut m = SnapClassify::new(takeover());
        win_down(&mut m, VK_LWIN);
        let focus = push_snap(&mut m, *vk, false, true, false).expect("focus down");
        assert_eq!(focus.op, SnapOp::Focus);
        assert_eq!(focus.direction, *direction);
        assert_eq!(focus.edge, SnapEdge::Down);
        assert!(focus.consumed && focus.announce);
        let up = push_snap(&mut m, *vk, true, true, false).expect("focus up");
        assert_eq!(
            (up.op, up.edge, up.consumed),
            (SnapOp::Focus, SnapEdge::Up, true)
        );
        // Move: Win+Shift+key.
        let mut m = SnapClassify::new(takeover());
        win_down(&mut m, VK_RWIN);
        push_snap(&mut m, VK_SHIFT, false, true, false);
        let mv = push_snap(&mut m, *vk, false, true, false).expect("move down");
        assert_eq!(mv.op, SnapOp::Move);
        assert_eq!(mv.direction, *direction);
        assert!(mv.consumed && mv.announce);
        // Releasing Shift before the key-up keeps the down-time op.
        push_snap(&mut m, VK_SHIFT, true, true, false);
        let up = push_snap(&mut m, *vk, true, true, false).expect("move up");
        assert_eq!((up.op, up.consumed), (SnapOp::Move, true));
    }
}

#[test]
fn win_lshift_arrow_right_classifies_move() {
    // Live regression anchor: a marked Win+Shift+Right stream reached the
    // owner as consumed focus/right (run 20261002-024604-32652, tick 15).
    // The classifier half of that path must resolve LSHIFT-held RIGHT to
    // Move; callback delivery is covered by proof-keys diagnostics.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_LSHIFT, false, true, false);
    assert!(m.tracked_modifiers().2, "lshift down must track shift");
    assert!(m.win_held(), "win must track held across shift");
    let down = push_snap(&mut m, VK_RIGHT, false, true, false).expect("move down");
    assert_eq!((down.op, down.direction), (SnapOp::Move, Direction::Right));
    assert!(down.consumed && down.announce);
    push_snap(&mut m, VK_LSHIFT, true, true, false);
    assert!(!m.tracked_modifiers().2, "lshift up must clear shift");
}

#[test]
fn marked_diag_buf_bounds_evict_oldest_and_counts_loss() {
    let mut buf = MarkedDiagBuf::new();
    assert!(buf.is_empty());
    let rec = |vk: u32| MarkedKeyDiag {
        vk,
        scan: 0x2A,
        is_up: false,
        win: true,
        shift_before: false,
        shift_after: true,
        ctrl: false,
        alt: false,
        async_shift: false,
        guard_disagree: false,
        consumed: false,
    };
    for vk in 0..(MARKED_DIAG_CAP as u32 + 5) {
        buf.push(rec(vk));
    }
    assert_eq!(buf.len(), MARKED_DIAG_CAP);
    assert_eq!(buf.dropped, 5);
    let drained = buf.drain();
    assert_eq!(drained.len(), MARKED_DIAG_CAP);
    assert_eq!(drained[0].vk, 5, "oldest records evict first");
    assert!(buf.is_empty());
    assert_eq!(buf.dropped, 5, "drain keeps the loss count");
}

#[test]
fn marked_diag_evidence_is_key_identity_only() {
    let diag = MarkedKeyDiag {
        vk: VK_LSHIFT,
        scan: 0x2A,
        is_up: false,
        win: true,
        shift_before: false,
        shift_after: true,
        ctrl: false,
        alt: false,
        async_shift: true,
        guard_disagree: false,
        consumed: false,
    };
    let ev = marked_diag_evidence(&diag);
    assert_eq!(ev["vk"], serde_json::Value::from(VK_LSHIFT));
    assert_eq!(ev["scan"], serde_json::Value::from(0x2Au32));
    assert_eq!(ev["edge"], serde_json::Value::from("down"));
    assert_eq!(ev["shift_before"], serde_json::Value::from(false));
    assert_eq!(ev["shift_after"], serde_json::Value::from(true));
    assert_eq!(ev["async_shift"], serde_json::Value::from(true));
    let text = ev.to_string();
    for banned in [
        "hwnd",
        "pid",
        "process_creation",
        "user_sid",
        "exe_path",
        "title",
        "token",
    ] {
        assert!(
            !text.contains(&format!("\"{banned}\"")),
            "diag evidence must never carry {banned}"
        );
    }
}

#[test]
fn proof_mod_vk_covers_only_win_and_modifier_families() {
    use tiler_windows::snapkey::{VK_LCONTROL, VK_RCONTROL, VK_RMENU, VK_RSHIFT};
    for vk in [
        VK_LWIN,
        VK_RWIN,
        VK_SHIFT,
        VK_LSHIFT,
        VK_RSHIFT,
        VK_CONTROL,
        VK_LCONTROL,
        VK_RCONTROL,
        VK_MENU,
        VK_LMENU,
        VK_RMENU,
    ] {
        assert!(is_proof_mod_vk(vk), "modifier {vk} must be recordable");
    }
    for vk in [
        VK_H, VK_J, VK_K, VK_L, VK_LEFT, VK_DOWN, VK_UP, VK_RIGHT, VK_MASK, 65, 90, 27,
    ] {
        assert!(!is_proof_mod_vk(vk), "non-modifier {vk} must never record");
    }
}

#[test]
fn mod_diag_buf_bounds_evict_oldest_and_counts_loss() {
    let mut buf = ModDiagBuf::new();
    assert!(buf.is_empty());
    let rec = |vk: u32| ModTrafficDiag {
        vk,
        scan: 0x2A,
        is_up: false,
        source: ModSource::Physical,
        win_before: true,
        win_after: true,
        shift_before: false,
        shift_after: true,
        ctrl: false,
        alt: false,
    };
    for vk in 0..(MOD_DIAG_CAP as u32 + 5) {
        buf.push(rec(vk));
    }
    assert_eq!(buf.len(), MOD_DIAG_CAP);
    assert_eq!(buf.dropped, 5);
    let drained = buf.drain();
    assert_eq!(drained.len(), MOD_DIAG_CAP);
    assert_eq!(drained[0].vk, 5, "oldest records evict first");
    assert!(buf.is_empty());
    assert_eq!(buf.dropped, 5, "drain keeps the loss count");
}

#[test]
fn mod_diag_evidence_is_modifier_identity_only() {
    let diag = ModTrafficDiag {
        vk: VK_LSHIFT,
        scan: 0x2A,
        is_up: true,
        source: ModSource::InjectedFiltered,
        win_before: true,
        win_after: true,
        shift_before: true,
        shift_after: false,
        ctrl: false,
        alt: false,
    };
    let ev = mod_diag_evidence(&diag);
    assert_eq!(ev["vk"], serde_json::Value::from(VK_LSHIFT));
    assert_eq!(ev["scan"], serde_json::Value::from(0x2Au32));
    assert_eq!(ev["edge"], serde_json::Value::from("up"));
    assert_eq!(ev["source"], serde_json::Value::from("injected-filtered"));
    assert_eq!(ev["shift_before"], serde_json::Value::from(true));
    assert_eq!(ev["shift_after"], serde_json::Value::from(false));
    assert_eq!(
        ModSource::Physical.as_str(),
        "physical",
        "physical source must serialize distinctly"
    );
    let text = ev.to_string();
    for banned in [
        "hwnd",
        "pid",
        "process_creation",
        "user_sid",
        "exe_path",
        "title",
        "token",
    ] {
        assert!(
            !text.contains(&format!("\"{banned}\"")),
            "mod evidence must never carry {banned}"
        );
    }
}

#[test]
fn stray_shift_up_between_shift_down_and_chord_flips_move_to_focus() {
    // Mechanism anchor for the live move blocker: the classifier resolves
    // the op from its own tracked Shift at chord-down time. A Shift-up that
    // reaches the callback between the marked Shift-down and the chord-down
    // (e.g. unmarked/physical traffic the old proof-keys buffer could not
    // see) clears tracked Shift, so Win+Shift+Right classifies focus/right.
    // This test pins the mechanism; the live proof-mods buffer now captures
    // whether such traffic actually occurs.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_LSHIFT, false, true, false);
    assert!(m.tracked_modifiers().2);
    // Stray Shift-up from any source clears tracked Shift.
    push_snap(&mut m, VK_LSHIFT, true, true, false);
    assert!(!m.tracked_modifiers().2);
    let down = push_snap(&mut m, VK_RIGHT, false, true, false).expect("chord down");
    assert_eq!((down.op, down.direction), (SnapOp::Focus, Direction::Right));
}

#[test]
fn both_win_keys_count() {
    for win in [VK_LWIN, VK_RWIN] {
        let mut m = SnapClassify::new(takeover());
        win_down(&mut m, win);
        let down = push_snap(&mut m, VK_J, false, true, false).expect("down");
        assert_eq!(down.direction, Direction::Down);
        assert!(is_win_vk(win));
    }
    assert!(!is_win_vk(VK_LEFT));
}

#[test]
fn unshifted_win_l_needs_explicit_opt_in() {
    // Default: unshifted Win+L passes through untracked, paired up too.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    assert_eq!(push_snap(&mut m, VK_L, false, true, false), None);
    assert_eq!(push_snap(&mut m, VK_L, true, true, false), None);
    assert_eq!((m.counts[3].down, m.counts[3].up), (0, 0));
    // Opt-in: Win+L focuses right like the catalog says.
    let mut m = SnapClassify::new(KeyboardConfig {
        takeover: true,
        allow_win_l: true,
    });
    win_down(&mut m, VK_LWIN);
    let down = push_snap(&mut m, VK_L, false, true, false).expect("win+l down");
    assert_eq!((down.op, down.direction), (SnapOp::Focus, Direction::Right));
    // Win+Shift+L stays approved without the opt-in.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_LSHIFT, false, true, false);
    let mv = push_snap(&mut m, VK_L, false, true, false).expect("win+shift+l down");
    assert_eq!((mv.op, mv.direction), (SnapOp::Move, Direction::Right));
}

#[test]
fn extra_modifiers_and_injected_pass_untracked() {
    for mod_vk in [VK_CONTROL, VK_MENU, VK_LMENU] {
        let mut m = SnapClassify::new(takeover());
        win_down(&mut m, VK_LWIN);
        push_snap(&mut m, mod_vk, false, true, false);
        assert_eq!(push_snap(&mut m, VK_H, false, true, false), None);
        assert_eq!(push_snap(&mut m, VK_H, true, true, false), None);
        assert_eq!(
            (m.counts[0].down, m.counts[0].up, m.counts[0].consumed),
            (0, 0, 0)
        );
        push_snap(&mut m, mod_vk, true, true, false);
    }
    // Injected chords never classify, never arm the mask.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    win_down(&mut m, VK_LWIN);
    assert_eq!(push_snap(&mut m, VK_H, false, true, true), None);
    assert!(!win_up_mask_reserve(
        &mut m,
        &mut q,
        VK_LWIN,
        true,
        std::time::Instant::now()
    ));
    assert!(q.is_empty());
    // Unrelated keys and bare arrows (no Win) pass untracked.
    let mut m = SnapClassify::new(takeover());
    assert_eq!(push_snap(&mut m, 65, false, true, false), None);
    assert_eq!(push_snap(&mut m, VK_LEFT, false, true, false), None);
    assert_eq!(push_snap(&mut m, VK_LEFT, true, true, false), None);
}

#[test]
fn origin_pairing_repeats_and_background() {
    // Win released before the key-up still pairs by origin.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_H, false, true, false);
    push_snap(&mut m, VK_LWIN, true, true, false);
    let up = push_snap(&mut m, VK_H, true, true, false).expect("paired up");
    assert!(up.consumed);
    // Repeats consume while foreground, pass while background.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_K, false, true, false);
    let rep = push_snap(&mut m, VK_K, false, true, false).expect("repeat");
    assert_eq!(
        (rep.edge, rep.consumed, rep.announce),
        (SnapEdge::Repeat, true, true)
    );
    let bg = push_snap(&mut m, VK_K, false, false, false).expect("logged");
    assert_eq!((bg.edge, bg.consumed), (SnapEdge::Repeat, false));
    // Background-origin holds never consume mid-hold.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_J, false, false, false);
    let rep = push_snap(&mut m, VK_J, false, true, false).expect("logged");
    assert!(!rep.consumed);
    let up = push_snap(&mut m, VK_J, true, true, false).expect("logged");
    assert!(!up.consumed);
    assert_eq!(push_snap(&mut m, VK_J, true, true, false), None);
}

#[test]
fn takeover_off_passes_but_logs() {
    let mut m = SnapClassify::new(KeyboardConfig {
        takeover: false,
        allow_win_l: false,
    });
    win_down(&mut m, VK_LWIN);
    let down = push_snap(&mut m, VK_H, false, true, false).expect("logged");
    assert!(!down.consumed && !down.announce);
    let up = push_snap(&mut m, VK_H, true, true, false).expect("logged");
    assert!(!up.consumed);
    assert_eq!((m.counts[0].down, m.counts[0].passed), (1, 2));
}

#[test]
fn saturated_queue_passes_without_consuming() {
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    push_snap(&mut m, VK_LWIN, false, true, false);
    let tick = std::time::Instant::now();
    let origin = Some(origin_of(11, "w1"));
    assert_eq!(
        classify_and_queue(
            &mut m,
            &mut q,
            VK_H,
            false,
            origin.clone(),
            false,
            tick,
            true
        ),
        Some(true)
    );
    // The queued record carries the chord-time origin for the owner recheck.
    match q.pop_front().expect("intent") {
        QueuedSnapEvent::Intent(queued) => assert_eq!(queued.origin, origin),
        QueuedSnapEvent::Workspace(_) | QueuedSnapEvent::Mask(_) => panic!("expected intent"),
    }
    while q.len() < INTENT_QUEUE_CAP {
        assert!(q.push(QueuedSnapEvent::Intent(
            tiler_windows::snapkey::QueuedIntent {
                op: SnapOp::Focus,
                direction: Direction::Left,
                edge: SnapEdge::Down,
                origin: None,
                consumed: true,
                announce: true,
                tick,
            }
        )));
    }
    assert!(q.is_full());
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_H, true, origin, false, tick, true),
        Some(false)
    );
    assert_eq!(q.dropped, 1);
    assert!(m.enabled, "saturation must not latch the machine off");
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_H, false, None, true, tick, true),
        None
    );
    assert_eq!(q.dropped, 1, "injected input never counts loss");
}

#[test]
fn saturated_queue_preserves_earlier_consumed_mask() {
    // A consumed chord arms the Start-menu mask; a later saturated chord
    // passes through (disguising Win by itself) but must not disarm the
    // earlier mask. A redundant E8 pair is safe, a naked Win Start is not.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    push_snap(&mut m, VK_LWIN, false, true, false);
    let tick = std::time::Instant::now();
    let origin = Some(origin_of(11, "w1"));
    assert_eq!(
        classify_and_queue(
            &mut m,
            &mut q,
            VK_H,
            false,
            origin.clone(),
            false,
            tick,
            true
        ),
        Some(true)
    );
    while q.len() < INTENT_QUEUE_CAP {
        assert!(q.push(QueuedSnapEvent::Intent(
            tiler_windows::snapkey::QueuedIntent {
                op: SnapOp::Focus,
                direction: Direction::Left,
                edge: SnapEdge::Down,
                origin: None,
                consumed: true,
                announce: true,
                tick,
            }
        )));
    }
    assert!(q.is_full());
    // Saturated approved chord passes without consuming, counted as loss.
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_J, false, origin, false, tick, true),
        Some(false)
    );
    assert_eq!(q.dropped, 1);
    // The earlier consumed chord's mask is still armed for Win-up: free one
    // slot (the owner drains bounded batches) and the next Win-up still
    // fires instead of a naked Win Start. Without the saturation
    // preservation the mask would already be disarmed here.
    q.pop_front();
    assert!(win_up_mask_reserve(&mut m, &mut q, VK_LWIN, true, tick));
}

#[test]
fn origin_continuation_survives_across_bounded_drains() {
    // The owner persists one verified own-focus advance across bounded
    // drains (MAX_DISPATCH_PER_TICK): a stale second-batch chord for A
    // continues from the verified advance B, while an external focus move
    // rejects and clears the chain.
    let fresh = vec![origin_of(11, "w1"), origin_of(22, "w2")];
    // Batch 1: chord for A with stable foreground dispatches; the owner
    // verifies actuation to B and records the advance.
    let mut advance: Option<SnapOrigin> = None;
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(11), &fresh, advance.as_ref()),
        OriginVerdict::Dispatch {
            token: "w1".to_owned(),
            continued: false,
        }
    );
    advance = Some(origin_of(22, "w2"));
    // Batch 2 (next drain, same burst): stale chord for A with foreground
    // now exactly at the verified advance B continues from B.
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(22), &fresh, advance.as_ref()),
        OriginVerdict::Dispatch {
            token: "w2".to_owned(),
            continued: true,
        }
    );
    // External focus to an unrelated window rejects and clears.
    let fresh_external = vec![origin_of(11, "w1"), origin_of(99, "w9")];
    assert_eq!(
        resolve_origin(
            &origin_of(11, "w1"),
            Some(99),
            &fresh_external,
            advance.as_ref()
        ),
        OriginVerdict::Reject("foreground-changed")
    );
    advance = None;
    assert!(advance.is_none(), "external focus clears the chain");
}

#[test]
fn mask_key_is_unassigned_e8_and_fires_once() {
    assert_eq!(VK_MASK, 0xE8);
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    win_down(&mut m, VK_LWIN);
    // Plain Win tap never masks.
    assert!(!win_up_mask_reserve(
        &mut m,
        &mut q,
        VK_LWIN,
        true,
        std::time::Instant::now()
    ));
    assert!(q.is_empty());
    // Consumed hold fires exactly once at Win-up.
    win_down(&mut m, VK_LWIN);
    let tick = std::time::Instant::now();
    let origin = Some(origin_of(11, "w1"));
    assert_eq!(
        classify_and_queue(
            &mut m,
            &mut q,
            VK_H,
            false,
            origin.clone(),
            false,
            tick,
            true
        ),
        Some(true)
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_H, true, origin, false, tick, true),
        Some(true)
    );
    assert!(win_up_mask_reserve(&mut m, &mut q, VK_LWIN, true, tick));
    assert_eq!(m.mask_attempted, 1);
    stamp_mask_result(&mut m, &mut q, 2, false);
    assert_eq!((m.mask_ok, m.mask_failed), (1, 0));
    stamp_mask_result(&mut m, &mut q, 0, false);
    assert_eq!((m.mask_ok, m.mask_failed), (1, 1));
}

// A chord consumed for A dispatches on A while the foreground still matches.
#[test]
fn origin_verdict_dispatches_on_stable_foreground() {
    let fresh = vec![origin_of(11, "w1"), origin_of(22, "w2")];
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(11), &fresh, None),
        OriginVerdict::Dispatch {
            token: "w1".to_owned(),
            continued: false,
        }
    );
}

// External focus change: a chord for A never silently acts on unrelated B.
#[test]
fn origin_verdict_rejects_external_focus_change() {
    let fresh = vec![origin_of(11, "w1"), origin_of(22, "w2")];
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(22), &fresh, None),
        OriginVerdict::Reject("foreground-changed")
    );
    // ... even when the origin window is still managed.
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(99), &fresh, None),
        OriginVerdict::Reject("foreground-changed")
    );
}

// Owner-caused advance: a prior verified actuation to B in the same batch
// lets the next intent continue from B, preserving rapid repeated navigation.
#[test]
fn origin_verdict_continues_verified_owner_advance() {
    let fresh = vec![origin_of(11, "w1"), origin_of(22, "w2")];
    assert_eq!(
        resolve_origin(
            &origin_of(11, "w1"),
            Some(22),
            &fresh,
            Some(&origin_of(22, "w2")),
        ),
        OriginVerdict::Dispatch {
            token: "w2".to_owned(),
            continued: true,
        }
    );
    // A stale advance (actuation went to C, foreground is B) never authorizes.
    assert_eq!(
        resolve_origin(
            &origin_of(11, "w1"),
            Some(22),
            &fresh,
            Some(&origin_of(33, "w3")),
        ),
        OriginVerdict::Reject("foreground-changed")
    );
}

// Vanished origin: closed or unmanaged since chord time.
#[test]
fn origin_verdict_rejects_vanished_origin() {
    let fresh = vec![origin_of(22, "w2")];
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(22), &fresh, None),
        OriginVerdict::Reject("origin-vanished")
    );
}

// Identity reuse: the same HWND with a recycled process never matches the
// chord origin, and a recycled advance never authorizes continuation.
#[test]
fn origin_verdict_rejects_recycled_hwnd_identity() {
    let recycled = SnapOrigin {
        hwnd: 11,
        token: "w9".to_owned(),
        pid: 4242,
        creation: "creation-other".to_owned(),
    };
    let fresh = vec![recycled, origin_of(22, "w2")];
    assert_eq!(
        resolve_origin(&origin_of(11, "w1"), Some(11), &fresh, None),
        OriginVerdict::Reject("origin-vanished")
    );
    // A stale advance recorded before the recycle no longer matches the
    // recycled HWND's new token/pid/creation triple.
    assert_eq!(
        resolve_origin(
            &origin_of(22, "w2"),
            Some(11),
            &fresh,
            Some(&origin_of(11, "w1")),
        ),
        OriginVerdict::Reject("foreground-changed")
    );
}

#[test]
fn direction_names_match_engine_wire() {
    assert_eq!(direction_name(Direction::Left), "left");
    assert_eq!(direction_name(Direction::Right), "right");
    assert_eq!(direction_name(Direction::Up), "up");
    assert_eq!(direction_name(Direction::Down), "down");
    assert_eq!(SnapOp::Focus.as_str(), "focus");
    assert_eq!(SnapOp::Move.as_str(), "move");
}

#[test]
fn tile_args_keyboard_defaults_and_flags() {
    let base = parse_tile_args(&strings(&["--user-start"])).expect("parsed");
    assert!(base.user_start && !base.trace);
    assert!(!base.no_keyboard_snap_takeover, "takeover defaults on");
    assert!(!base.allow_win_l, "win+l defaults gated");
    let off = parse_tile_args(&strings(&["--user-start", "--no-keyboard-snap-takeover"]))
        .expect("parsed");
    assert!(off.no_keyboard_snap_takeover);
    let l = parse_tile_args(&strings(&["--user-start", "--allow-win-l"])).expect("parsed");
    assert!(l.allow_win_l);
    assert!(parse_tile_args(&strings(&["--user-start", "--allowlist", "a.json"])).is_err());
    assert!(parse_tile_args(&strings(&["--no-keyboard-snap-takeover"])).is_err());
    // Proof parser takes no keyboard flags: the proof contract is unchanged.
    assert!(
        tiler_windows::tiling::parse_tile_proof_args(&strings(&[
            "--allowlist",
            "a.json",
            "--allow-win-l"
        ]))
        .is_err()
    );
}

fn engine_harness(
    windows: &[(WindowId, Rect)],
    focused: &WindowId,
) -> (Engine, tiler_core::boundary::CoreEvent) {
    let mut engine = Engine::new();
    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("gen-1").expect("valid");
    engine.sync_binding(&owner, &generation);
    let pairs: Vec<(String, Rect)> = windows.iter().map(|(w, r)| (w.0.clone(), *r)).collect();
    let hinted: Vec<(WindowId, Rect, WindowSizeHints)> = windows
        .iter()
        .map(|(w, r)| (w.clone(), *r, WindowSizeHints::none()))
        .collect();
    let event = build_reconcile_event(&ReconcileInput {
        owner: &owner,
        generation: &generation,
        correlation: &CorrelationId::parse("snap-test").expect("valid"),
        revision: 0,
        fingerprint: fingerprint(&pairs),
        domain_bounds: Rect {
            x: 0,
            y: 0,
            w: 1600,
            h: 900,
        },
        windows: &hinted,
        focused: Some(focused),
    });
    (engine, event)
}

fn rect(x: i32, y: i32, w: i32, h: i32) -> Rect {
    Rect { x, y, w, h }
}

#[test]
fn engine_focus_moves_through_nested_topology() {
    let w1 = WindowId("w1".to_owned());
    let w2 = WindowId("w2".to_owned());
    let w3 = WindowId("w3".to_owned());
    let observed = vec![
        (w1.clone(), rect(8, 8, 500, 884)),
        (w2.clone(), rect(516, 8, 500, 884)),
        (w3.clone(), rect(1024, 8, 568, 884)),
    ];
    let (mut engine, seed) = engine_harness(&observed, &w1);
    let reply = engine.handle(&seed);
    assert!(
        matches!(reply, CoreReply::Projection(_) | CoreReply::Tiled(_)),
        "seed must converge, got {reply:?}"
    );
    // Focus right from w1 lands on its neighbor with full geometry.
    let mut focus = seed.clone();
    focus.command = CoreCommand::Focus {
        window: w1.0.clone(),
        direction: "right".to_owned(),
        cross_output_transfer: false,
    };
    assert_eq!(focus.command.op(), "focus");
    let reply = engine.handle(&focus);
    match reply {
        CoreReply::FocusDirectional(plan) => {
            assert_eq!(plan.to_window, w2);
            assert_eq!(plan.geometry.len(), 3);
        }
        other => panic!("focus must plan directionally, got {other:?}"),
    }
    // Move uses the move route with full desired geometry. The moved window
    // is the focused one, mirroring the owner drain.
    let mut mv = seed.clone();
    mv.focused_window = w2.clone();
    mv.command = CoreCommand::Move {
        window: w2.0.clone(),
        direction: "right".to_owned(),
        cross_output_transfer: false,
    };
    assert_eq!(mv.command.op(), "move");
    let reply = engine.handle(&mv);
    match reply {
        CoreReply::MoveDirectional(plan) => {
            assert_eq!(plan.geometry.len(), 3);
        }
        other => panic!("move must plan directionally, got {other:?}"),
    }
}

#[test]
fn digit_chords_select_and_send_on_same_vk() {
    // US symbols share the digit VK: Shift flips select into send.
    for index in [0u8, 1, 5, 9] {
        let vk = VK_0 + u32::from(index);
        let mut m = SnapClassify::new(takeover());
        win_down(&mut m, VK_LWIN);
        let select = push_workspace(&mut m, vk, false, true, false).expect("select down");
        assert_eq!((select.op, select.index), (WorkspaceOp::Select, index));
        assert!(select.consumed && select.announce);
        let mut m = SnapClassify::new(takeover());
        win_down(&mut m, VK_RWIN);
        push_snap(&mut m, tiler_windows::snapkey::VK_SHIFT, false, true, false);
        let send = push_workspace(&mut m, vk, false, true, false).expect("send down");
        assert_eq!((send.op, send.index), (WorkspaceOp::Send, index));
        assert!(send.consumed && send.announce);
    }
}

#[test]
fn digit_chords_share_modifier_mask_and_origin_authority() {
    // One machine: Ctrl/Alt or missing Win refuse, injected never classifies,
    // the op fixes at down time, and a consumed digit arms the E8 mask.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_CONTROL, false, true, false);
    assert_eq!(push_workspace(&mut m, VK_0 + 1, false, true, false), None);
    push_snap(&mut m, VK_CONTROL, true, true, false);
    assert_eq!(push_workspace(&mut m, VK_0 + 2, true, true, false), None);
    assert_eq!(push_workspace(&mut m, VK_0 + 3, false, true, true), None);
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_LSHIFT, false, true, false);
    let down = push_workspace(&mut m, VK_0 + 3, false, true, false).expect("send down");
    assert_eq!(down.op, WorkspaceOp::Send);
    push_snap(&mut m, VK_LSHIFT, true, true, false);
    let up = push_workspace(&mut m, VK_0 + 3, true, true, false).expect("send up");
    assert_eq!((up.op, up.consumed), (WorkspaceOp::Send, true));
    assert_eq!(up.edge, SnapEdge::Up);
    // Unmanaged/empty foreground: select consumes globally (takeover alone,
    // no managed origin), while send keeps the managed-origin gate and its
    // key-up passes.
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    let down = push_workspace(&mut m, VK_0 + 4, false, false, false).expect("global select down");
    assert_eq!(down.op, WorkspaceOp::Select);
    assert!(down.consumed && down.announce);
    let repeat =
        push_workspace(&mut m, VK_0 + 4, false, false, false).expect("global select repeat");
    assert!(repeat.consumed && repeat.announce);
    let mut m = SnapClassify::new(takeover());
    win_down(&mut m, VK_LWIN);
    push_snap(&mut m, VK_SHIFT, false, true, false);
    let down = push_workspace(&mut m, VK_0 + 4, false, false, false).expect("bg send down");
    assert_eq!(down.op, WorkspaceOp::Send);
    assert!(!down.consumed);
    let repeat = push_workspace(&mut m, VK_0 + 4, false, true, false).expect("repeat");
    assert!(!repeat.consumed);
    // Takeover off passes everything through without consuming.
    let mut m = SnapClassify::new(KeyboardConfig::disabled());
    win_down(&mut m, VK_LWIN);
    let down = push_workspace(&mut m, VK_0 + 5, false, true, false).expect("off down");
    assert!(!down.consumed);
}

#[test]
fn global_select_consumes_without_managed_origin() {
    // Empty-trailing return path: Win+1 from unmanaged foreground consumes
    // with no origin; Shift+1 from the same foreground still passes through.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    let tick = std::time::Instant::now();
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_LWIN, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_0 + 1, false, None, false, tick, true),
        Some(true)
    );
    match q.pop_front().expect("workspace intent") {
        QueuedSnapEvent::Workspace(intent) => {
            assert_eq!((intent.op, intent.index), (WorkspaceOp::Select, 1));
            assert!(intent.consumed && intent.announce);
            assert!(intent.origin.is_none());
        }
        _ => panic!("expected workspace intent"),
    }
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_LWIN, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_SHIFT, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_0 + 1, false, None, false, tick, true),
        Some(false)
    );
}

#[test]
fn digit_mask_roundtrip_and_queue_saturation() {
    use tiler_windows::snapkey::{MaskTrigger, QueuedWorkspaceIntent};
    // A consumed digit reserves the mask at Win-up and stamps the result.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    let tick = std::time::Instant::now();
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_LWIN, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(
            &mut m,
            &mut q,
            VK_0 + 1,
            false,
            Some(origin_of(7, "w7")),
            false,
            tick,
            true
        ),
        Some(true)
    );
    assert!(win_up_mask_reserve(&mut m, &mut q, VK_LWIN, true, tick));
    match q.pop_front().expect("workspace intent") {
        QueuedSnapEvent::Workspace(QueuedWorkspaceIntent { op, index, .. }) => {
            assert_eq!((op, index), (WorkspaceOp::Select, 1));
        }
        _ => panic!("expected workspace intent"),
    }
    match q.pop_front().expect("mask") {
        QueuedSnapEvent::Mask(mask) => match mask.trigger {
            MaskTrigger::Workspace { op, index } => {
                assert_eq!((op, index), (WorkspaceOp::Select, 1));
            }
            _ => panic!("expected workspace mask trigger"),
        },
        _ => panic!("expected mask"),
    }
    // Saturation fails closed: the digit passes through and counts loss.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    push_snap(&mut m, VK_LWIN, false, true, false);
    while q.len() < INTENT_QUEUE_CAP {
        let _ = q.push(QueuedSnapEvent::Mask(tiler_windows::snapkey::QueuedMask {
            trigger: MaskTrigger::Workspace {
                op: WorkspaceOp::Select,
                index: 1,
            },
            tick,
            inserted: 0,
            release_sent: false,
        }));
    }
    assert!(q.is_full());
    assert_eq!(
        classify_and_queue(
            &mut m,
            &mut q,
            VK_0 + 2,
            false,
            Some(origin_of(8, "w8")),
            false,
            tick,
            true
        ),
        Some(false)
    );
    assert!(q.dropped >= 1);
}

#[test]
fn engine_edge_focus_is_a_no_op_rejection() {
    let w1 = WindowId("w1".to_owned());
    let w2 = WindowId("w2".to_owned());
    let observed = vec![
        (w1.clone(), rect(8, 8, 788, 884)),
        (w2.clone(), rect(804, 8, 788, 884)),
    ];
    let (mut engine, seed) = engine_harness(&observed, &w1);
    let seed_reply = engine.handle(&seed);
    assert!(
        matches!(seed_reply, CoreReply::Projection(_) | CoreReply::Tiled(_)),
        "seed must converge, got {seed_reply:?}"
    );
    // Focus left off the left edge: no neighbor, no actuation.
    let mut edge = seed.clone();
    edge.command = CoreCommand::Focus {
        window: w1.0.clone(),
        direction: "left".to_owned(),
        cross_output_transfer: false,
    };
    let reply = engine.handle(&edge);
    assert!(
        matches!(reply, CoreReply::Rejected { .. }),
        "edge focus must refuse without geometry, got {reply:?}"
    );
}

#[test]
fn inactive_global_select_passes_through() {
    // Cached session gate off (suspended/fullscreen/elevated): an unshifted
    // Win+digit passes through without consuming, never swallowed.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    let tick = std::time::Instant::now();
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_LWIN, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_0 + 2, false, None, false, tick, false),
        Some(false)
    );
    match q.pop_front().expect("workspace intent") {
        QueuedSnapEvent::Workspace(intent) => {
            assert_eq!((intent.op, intent.index), (WorkspaceOp::Select, 2));
            assert!(!intent.consumed);
        }
        _ => panic!("expected workspace intent"),
    }
}

#[test]
fn active_unmanaged_select_consumes_without_origin() {
    // Cached session gate on with no managed origin (unmanaged foreground):
    // select still consumes globally, while send keeps the origin gate.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    let tick = std::time::Instant::now();
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_LWIN, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_0 + 3, false, None, false, tick, true),
        Some(true)
    );
    match q.pop_front().expect("workspace intent") {
        QueuedSnapEvent::Workspace(intent) => {
            assert_eq!((intent.op, intent.index), (WorkspaceOp::Select, 3));
            assert!(intent.consumed && intent.announce);
            assert!(intent.origin.is_none());
        }
        _ => panic!("expected workspace intent"),
    }
    // Same gate, same unmanaged foreground: send still passes through.
    let mut m = SnapClassify::new(takeover());
    let mut q = SnapQueue::new();
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_LWIN, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_SHIFT, false, None, false, tick, true),
        None
    );
    assert_eq!(
        classify_and_queue(&mut m, &mut q, VK_0 + 3, false, None, false, tick, true),
        Some(false)
    );
}
