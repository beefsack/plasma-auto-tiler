use tiler_core::directional::WindowId;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_windows::tiling::{
    CaptureOptions, FrameInsets, GestureIntent, INNER_GAP, OUTER_GAP, ObservedTarget,
    ObservedTargetRef, ReadbackOutcome, RefusedTracker, SkipReason, StatelessVerdict, TokenMap,
    WindowFacts, allow_match, allowlist_digest, build_reconcile_event, classify, classify_gesture,
    fingerprint, inspect_stateless_verdict, is_borderless_fullscreen, parse_allowlist,
    parse_capture_args, parse_children_args, parse_inspect_args, parse_tile_args,
    parse_tile_proof_args, readback_outcome, tick_summary_signature, tiling_domain_bounds,
    verify_proof_argv_consistency,
};

fn rect(x: i32, y: i32, w: i32, h: i32) -> Rect {
    Rect { x, y, w, h }
}

fn eligible_facts() -> WindowFacts {
    WindowFacts {
        visible: true,
        minimized: false,
        maximized: false,
        cloaked: false,
        elevated: false,
        shell: false,
        tool_window: false,
        owned: false,
        captionless_fullscreen: false,
        terminal_ancestor: false,
        no_activate: false,
        dialog: false,
    }
}

#[test]
fn frame_insets_round_trip() {
    let outer = rect(100, 100, 800, 600);
    let visible = rect(108, 108, 784, 584);
    let insets = FrameInsets::measure(outer, visible);
    assert_eq!(
        insets,
        FrameInsets {
            left: 8,
            top: 8,
            right: 8,
            bottom: 8
        }
    );
    assert_eq!(insets.visible_to_outer(visible), Some(outer));
}

#[test]
fn frame_conversion_overflow_fails_closed() {
    let insets = FrameInsets {
        left: 8,
        top: 8,
        right: 8,
        bottom: 8,
    };
    // Width overflows when insets are added.
    assert_eq!(insets.visible_to_outer(rect(0, 0, i32::MAX, 10)), None);
    // Origin underflows when insets are subtracted.
    assert_eq!(insets.visible_to_outer(rect(i32::MIN, 0, 10, 10)), None);
    // Non-positive extents after mapping are refused.
    assert_eq!(
        FrameInsets::default().visible_to_outer(rect(5, 5, 0, 0)),
        None
    );
}

#[test]
fn frame_measure_saturates_dwm_rounding() {
    // Visible slightly larger than outer (rounding): saturates, never panics.
    let insets = FrameInsets::measure(rect(100, 100, 800, 600), rect(99, 99, 802, 602));
    assert_eq!(insets.left, 0);
    assert_eq!(insets.top, 0);
}

#[test]
fn fingerprint_stable_and_order_independent() {
    let a = vec![
        ("w1".to_owned(), rect(0, 0, 100, 100)),
        ("w2".to_owned(), rect(100, 0, 100, 100)),
    ];
    let b = vec![
        ("w2".to_owned(), rect(100, 0, 100, 100)),
        ("w1".to_owned(), rect(0, 0, 100, 100)),
    ];
    assert_eq!(fingerprint(&a), fingerprint(&b));
    let c = vec![("w1".to_owned(), rect(0, 0, 100, 100))];
    assert_ne!(fingerprint(&a), fingerprint(&c));
}

#[test]
fn tokens_stable_per_identity_not_hwnd() {
    let mut map = TokenMap::default();
    let first = map.token_for(1234, "creation-a");
    assert_eq!(map.token_for(1234, "creation-a"), first);
    assert_ne!(map.token_for(5678, "creation-a"), first);
    // Recycled HWND with a new process creation never inherits the token.
    let recycled = map.token_for(1234, "creation-b");
    assert_ne!(recycled, first);
    assert!(!first.contains("1234"), "no raw HWND in token");
    map.retain(&[
        ObservedTargetRef {
            hwnd: 1234,
            creation: "creation-b",
        },
        ObservedTargetRef {
            hwnd: 5678,
            creation: "creation-a",
        },
    ]);
    // The stale (hwnd, creation-a) entry is gone: it re-mints.
    assert_ne!(map.token_for(1234, "creation-a"), first);
}

#[test]
fn eligibility_exclusions() {
    assert!(classify(&eligible_facts(), false).is_ok());
    let mut facts = eligible_facts();
    facts.minimized = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::Minimized));
    let mut facts = eligible_facts();
    facts.maximized = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::Maximized));
    let mut facts = eligible_facts();
    facts.cloaked = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::Cloaked));
    let mut facts = eligible_facts();
    facts.elevated = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::Elevated));
    let mut facts = eligible_facts();
    facts.owned = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::OwnedDialog));
    let mut facts = eligible_facts();
    facts.captionless_fullscreen = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::Fullscreen));
    let mut facts = eligible_facts();
    facts.no_activate = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::NoActivate));
    let mut facts = eligible_facts();
    facts.dialog = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::Dialog));
    // Owned generic dialogs keep the owned-dialog reason.
    let mut facts = eligible_facts();
    facts.owned = true;
    facts.dialog = true;
    assert_eq!(classify(&facts, false), Err(SkipReason::OwnedDialog));
}

#[test]
fn terminal_included_normally_excluded_in_test() {
    let mut facts = eligible_facts();
    facts.terminal_ancestor = true;
    assert!(classify(&facts, false).is_ok());
    assert_eq!(classify(&facts, true), Err(SkipReason::Terminal));
}

#[test]
fn allowlist_exact_match_and_rejections() {
    let entry = tiler_windows::tiling::AllowEntry {
        hwnd: 99,
        pid: 7,
        process_creation: "000000000000abcd".to_owned(),
        exe_path: "C:\\apps\\Helper.EXE".to_owned(),
        user_sid: "sid-1".to_owned(),
        session_id: 1,
        tag: "18da5b07aae82240".to_owned(),
    };
    let observed = ObservedTarget {
        hwnd: 99,
        pid: 7,
        process_creation: "000000000000abcd".to_owned(),
        exe_path: "c:/apps/helper.exe".to_owned(),
        user_sid: "sid-1".to_owned(),
        session_id: 1,
        terminal_ancestor: false,
        tag: "18da5b07aae82240".to_owned(),
    };
    assert!(allow_match(&entry, &observed));
    let changed = ObservedTarget {
        process_creation: "ffffffffffffffff".to_owned(),
        ..observed.clone()
    };
    assert!(!allow_match(&entry, &changed), "pid reuse must not match");
    // Recycled HWND in the same process carries a fresh tag and never matches.
    let retagged = ObservedTarget {
        tag: "ffffffffffffffff".to_owned(),
        ..observed.clone()
    };
    assert!(!allow_match(&entry, &retagged), "tag reuse must not match");
    let untagged = ObservedTarget {
        tag: String::new(),
        ..observed.clone()
    };
    assert!(!allow_match(&entry, &untagged), "empty tag must not match");
}

#[test]
fn allowlist_malformed_and_empty_refused() {
    assert!(parse_allowlist("not json").is_err());
    assert!(parse_allowlist("{\"windows\": []}").is_err());
    assert!(parse_allowlist("{\"windows\": [{\"hwnd\": 0}]}").is_err());
    let ok = parse_allowlist(
        "{\"windows\": [{\"hwnd\": 9, \"pid\": 3, \"process_creation\": \"a\", \"exe_path\": \"e\", \"user_sid\": \"s\", \"session_id\": 1, \"tag\": \"t1\"}]}",
    )
    .expect("valid");
    assert_eq!(ok.len(), 1);
    // Missing tag is malformed: never fall back to normal.
    assert!(parse_allowlist(
        "{\"windows\": [{\"hwnd\": 9, \"pid\": 3, \"process_creation\": \"a\", \"exe_path\": \"e\", \"user_sid\": \"s\", \"session_id\": 1}]}",
    )
    .is_err());
    assert!(parse_allowlist(
        "{\"windows\": [{\"hwnd\": 9, \"pid\": 3, \"process_creation\": \"a\", \"exe_path\": \"e\", \"user_sid\": \"s\", \"session_id\": 1, \"tag\": \"\"}]}",
    )
    .is_err());
}

#[test]
fn allowlist_rejects_duplicates_and_empty_fields() {
    let dup = "{\"windows\": [\
        {\"hwnd\": 9, \"pid\": 3, \"process_creation\": \"a\", \"exe_path\": \"e\", \"user_sid\": \"s\", \"session_id\": 1, \"tag\": \"t1\"},\
        {\"hwnd\": 9, \"pid\": 4, \"process_creation\": \"b\", \"exe_path\": \"e\", \"user_sid\": \"s\", \"session_id\": 1, \"tag\": \"t2\"}]}";
    assert!(parse_allowlist(dup).is_err());
    let empty = "{\"windows\": [\
        {\"hwnd\": 9, \"pid\": 3, \"process_creation\": \"\", \"exe_path\": \"e\", \"user_sid\": \"s\", \"session_id\": 1, \"tag\": \"t1\"}]}";
    assert!(parse_allowlist(empty).is_err());
}

#[test]
fn allowlist_digest_stable_and_bound() {
    let a = tiler_windows::tiling::AllowEntry {
        hwnd: 9,
        pid: 3,
        process_creation: "a".to_owned(),
        exe_path: "C:\\apps\\Helper.EXE".to_owned(),
        user_sid: "s".to_owned(),
        session_id: 1,
        tag: "t1".to_owned(),
    };
    let b = tiler_windows::tiling::AllowEntry {
        hwnd: 10,
        pid: 4,
        process_creation: "b".to_owned(),
        exe_path: "e".to_owned(),
        user_sid: "s".to_owned(),
        session_id: 1,
        tag: "t2".to_owned(),
    };
    // Order-independent: frozen set digest, not file order.
    assert_eq!(
        allowlist_digest(&[a.clone(), b.clone()]),
        allowlist_digest(&[b.clone(), a.clone()])
    );
    // Any identity or tag change changes the digest.
    let changed = tiler_windows::tiling::AllowEntry {
        tag: "t9".to_owned(),
        ..a.clone()
    };
    assert_ne!(
        allowlist_digest(&[a.clone(), b.clone()]),
        allowlist_digest(&[changed, b.clone()])
    );
    assert_eq!(allowlist_digest(&[]).len(), 16);
}

#[test]
fn refused_tracker_clamp_and_transient_lanes() {
    use std::time::{Duration, Instant};
    let mut tracker = RefusedTracker::default();
    let desired = rect(0, 0, 800, 600);
    let observed = rect(0, 0, 700, 600);
    let now = Instant::now();
    assert!(!tracker.should_skip("w1", &desired, &observed, now));
    // App-held size after a successful write: suppressed while identical.
    tracker.note_clamp("w1", &desired, &observed);
    assert!(tracker.should_skip("w1", &desired, &observed, now));
    // Genuine native change re-arms.
    assert!(!tracker.should_skip("w1", &desired, &rect(0, 0, 710, 600), now));
    // Exact application clears.
    tracker.note_clamp("w1", &desired, &desired);
    assert!(!tracker.should_skip("w1", &desired, &observed, now));
    // Transient setter failure: suppressed inside backoff, recovered after.
    tracker.note_transient("w2", &desired, &observed, now);
    assert!(tracker.should_skip("w2", &desired, &observed, now));
    assert!(!tracker.should_skip("w2", &desired, &observed, now + Duration::from_secs(30)));
    // New intent re-arms immediately even inside backoff.
    assert!(!tracker.should_skip("w2", &rect(0, 0, 900, 600), &observed, now));
    // Transient backoff is bounded and never a permanent disable: repeated
    // failures cap at 5s and any observation change re-arms.
    tracker.note_transient("w3", &desired, &observed, now);
    for _ in 0..10 {
        tracker.note_transient("w3", &desired, &observed, now);
    }
    assert!(tracker.should_skip("w3", &desired, &observed, now + Duration::from_secs(4)));
    assert!(!tracker.should_skip("w3", &desired, &observed, now + Duration::from_secs(6)));
    assert!(!tracker.should_skip("w3", &desired, &rect(0, 0, 701, 600), now));
    // Clamp lane never captures a failed setter: Pending leaves lanes alone.
    tracker.note_match("w4");
    assert!(!tracker.should_skip("w4", &desired, &observed, now));
}

#[test]
fn gesture_true_move_same_size() {
    let before = rect(0, 0, 800, 600);
    let after = rect(100, 100, 800, 600);
    assert_eq!(
        classify_gesture(&before, &after, Some((150, 150))),
        Some(GestureIntent::MoveDrop { x: 150, y: 150 })
    );
    assert_eq!(classify_gesture(&before, &after, None), None);
    assert_eq!(classify_gesture(&before, &before, Some((1, 1))), None);
}

#[test]
fn gesture_left_resize_not_move() {
    // Origin changed with size: left-edge resize, never a move.
    let before = rect(100, 100, 800, 600);
    assert_eq!(
        classify_gesture(&before, &rect(60, 100, 840, 600), Some((0, 0))),
        Some(GestureIntent::PointerResize {
            direction: "left",
            boundary: 60,
            direction2: None,
            boundary2: None,
        })
    );
}

#[test]
fn gesture_up_resize_not_move() {
    let before = rect(100, 100, 800, 600);
    assert_eq!(
        classify_gesture(&before, &rect(100, 40, 800, 660), Some((0, 0))),
        Some(GestureIntent::PointerResize {
            direction: "up",
            boundary: 40,
            direction2: None,
            boundary2: None,
        })
    );
}

#[test]
fn gesture_corner_prefers_larger_edge() {
    // Both left and right moved: the larger delta wins (right here).
    let before = rect(100, 100, 800, 600);
    assert_eq!(
        classify_gesture(&before, &rect(90, 100, 900, 600), Some((0, 0))),
        Some(GestureIntent::PointerResize {
            direction: "right",
            boundary: 990,
            direction2: None,
            boundary2: None,
        })
    );
}

#[test]
fn gesture_queued_settle_from_stable_pre() {
    // START+END inside one poll interval: the stable pre-gesture rectangle
    // (not a mid-gesture frame) still classifies the settle.
    let stable = rect(0, 0, 800, 600);
    let post = rect(0, 0, 950, 600);
    assert_eq!(
        classify_gesture(&stable, &post, Some((0, 0))),
        Some(GestureIntent::PointerResize {
            direction: "right",
            boundary: 950,
            direction2: None,
            boundary2: None,
        })
    );
}

#[test]
fn gesture_resize_edges() {
    let before = rect(0, 0, 800, 600);
    // Right edge dragged out.
    assert_eq!(
        classify_gesture(&before, &rect(0, 0, 900, 600), Some((0, 0))),
        Some(GestureIntent::PointerResize {
            direction: "right",
            boundary: 900,
            direction2: None,
            boundary2: None,
        })
    );
    // Corner drag routes both axes, horizontal first.
    assert_eq!(
        classify_gesture(&before, &rect(0, 0, 900, 700), Some((0, 0))),
        Some(GestureIntent::PointerResize {
            direction: "right",
            boundary: 900,
            direction2: Some("down"),
            boundary2: Some(700),
        })
    );
}

#[test]
fn readback_outcome_never_clamps_without_write() {
    let desired = rect(0, 0, 800, 600);
    // Exact readback always matches, with or without a write behind it.
    assert_eq!(
        readback_outcome(true, &desired, &desired),
        ReadbackOutcome::Match
    );
    assert_eq!(
        readback_outcome(false, &desired, &desired),
        ReadbackOutcome::Match
    );
    // A mismatch after a successful write is an app-held size.
    assert_eq!(
        readback_outcome(true, &desired, &rect(0, 0, 700, 600)),
        ReadbackOutcome::Clamp
    );
    // A mismatch with no write (failed or skipped setter) stays pending:
    // transient backoff and later re-reads keep working instead of being
    // pinned as a permanent clamp.
    assert_eq!(
        readback_outcome(false, &desired, &rect(0, 0, 700, 600)),
        ReadbackOutcome::Pending
    );
}

#[test]
fn children_args_require_explicit_hwnd() {
    assert!(parse_children_args(&[]).is_err());
    let options = parse_children_args(&strings(&[
        "--hwnd", "123", "--hwnd", "0xAB", "--hwnd", "123",
    ]))
    .expect("parsed");
    assert_eq!(options.hwnds, vec![123, 0xAB]);
    assert!(parse_children_args(&strings(&["--bogus"])).is_err());
}

#[test]
fn inspect_args_require_allowlist() {
    assert!(parse_inspect_args(&[]).is_err());
    assert!(parse_inspect_args(&strings(&["--preimages", "p.json"])).is_err());
    let options = parse_inspect_args(&strings(&["--allowlist", "a.json"])).expect("parsed");
    assert_eq!(options.allowlist, std::path::PathBuf::from("a.json"));
}

#[test]
fn tile_args_require_explicit_user_start() {
    // No silent normal runs: agents never invoke this path.
    assert!(parse_tile_args(&[]).is_err());
    assert!(parse_tile_args(&strings(&["--trace"])).is_err());
    let options = parse_tile_args(&strings(&["--user-start"])).expect("user start");
    assert_eq!(options.seconds, None);
    assert!(!options.trace);
    assert!(options.user_start);
    let options =
        parse_tile_args(&strings(&["--user-start", "--seconds", "60", "--trace"])).expect("parsed");
    assert_eq!(options.seconds, Some(60));
    assert!(options.trace);
    // Allowlist never rides the normal path: proof uses tile-proof so lost
    // arguments cannot fall back to tiling the whole desktop.
    assert!(parse_tile_args(&strings(&["--user-start", "--allowlist", "a.json"])).is_err());
    assert!(parse_tile_args(&["--seconds".to_owned(), "0".to_owned()]).is_err());
    assert!(parse_tile_args(&["--bogus".to_owned()]).is_err());
}

#[test]
fn tile_proof_args_require_allowlist() {
    // Missing allowlist refuses before any lease; never normal mode.
    assert!(parse_tile_proof_args(&[]).is_err());
    assert!(parse_tile_proof_args(&strings(&["--trace"])).is_err());
    assert!(parse_tile_proof_args(&strings(&["--allowlist", ""])).is_err());
    let options = parse_tile_proof_args(&strings(&["--allowlist", "a.json"])).expect("proof");
    assert_eq!(options.allowlist, std::path::PathBuf::from("a.json"));
    assert_eq!(options.seconds, None);
    let options = parse_tile_proof_args(&strings(&[
        "--allowlist",
        "a.json",
        "--seconds",
        "60",
        "--trace",
    ]))
    .expect("parsed");
    assert_eq!(options.seconds, Some(60));
    assert!(options.trace);
    assert!(parse_tile_proof_args(&strings(&["--allowlist", "a.json", "--bogus"])).is_err());
}

#[test]
fn proof_argv_consistency_evidences_every_flag() {
    // Full delivery: allowlist path with spaces survives as one argv element,
    // seconds and trace evidenced alongside.
    let raw = strings(&[
        "--allowlist",
        "C:\\my dir\\a.json",
        "--seconds",
        "300",
        "--trace",
    ]);
    let parsed = parse_tile_proof_args(&raw).expect("parsed");
    assert!(verify_proof_argv_consistency(&raw, &parsed).is_ok());
    // Untimed no-write form: absent seconds on both sides is consistent.
    let raw = strings(&["--allowlist", "a.json", "--trace"]);
    let parsed = parse_tile_proof_args(&raw).expect("parsed");
    assert!(verify_proof_argv_consistency(&raw, &parsed).is_ok());
    // Dropped trace flag on either side is an impossible error.
    let parsed_no_trace =
        parse_tile_proof_args(&strings(&["--allowlist", "a.json"])).expect("parsed");
    assert!(verify_proof_argv_consistency(&raw, &parsed_no_trace).is_err());
    // Dropped deadline on either side is an impossible error.
    let raw_full = strings(&["--allowlist", "a.json", "--seconds", "300", "--trace"]);
    assert!(verify_proof_argv_consistency(&raw_full, &parsed).is_err());
    // Swapped path is an impossible error, never a silent retarget.
    let raw_other = strings(&["--allowlist", "b.json", "--trace"]);
    assert!(verify_proof_argv_consistency(&raw_other, &parsed).is_err());
    // Unknown flags never verify.
    let raw_bogus = strings(&["--allowlist", "a.json", "--bogus"]);
    assert!(verify_proof_argv_consistency(&raw_bogus, &parsed).is_err());
    // Missing allowlist never verifies.
    assert!(verify_proof_argv_consistency(&strings(&["--trace"]), &parsed).is_err());
}

#[allow(clippy::too_many_arguments)]
fn ev(
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    revision: u64,
    fp: u64,
    bounds: Rect,
    windows: &[(WindowId, Rect)],
    focused: Option<&WindowId>,
) -> tiler_core::boundary::CoreEvent {
    build_reconcile_event(&tiler_windows::tiling::ReconcileInput {
        owner,
        generation,
        correlation,
        revision,
        fingerprint: fp,
        domain_bounds: bounds,
        windows,
        focused,
    })
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn domain_bounds_inset_outer_gap() {
    assert_eq!(
        tiling_domain_bounds(rect(0, 0, 1600, 900)),
        Some(rect(8, 8, 1584, 884))
    );
    assert_eq!(tiling_domain_bounds(rect(0, 0, 10, 10)), None);
}

#[test]
fn capture_args_require_explicit_hwnd() {
    assert!(parse_capture_args(&[]).is_err());
    assert!(parse_capture_args(&strings(&["--out", "r.json"])).is_err());
    assert!(parse_capture_args(&strings(&["--hwnd", "9"])).is_err());
    let options = parse_capture_args(&strings(&[
        "--out", "r.json", "--hwnd", "123", "--hwnd", "0xAB", "--hwnd", "123",
    ]))
    .expect("parsed");
    assert_eq!(options.hwnds, vec![123, 0xAB]);
    let _: CaptureOptions = options;
}

#[test]
fn reconcile_event_carries_gaps_and_hints() {
    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let correlation = CorrelationId::parse("tick-1").expect("valid");
    let event = ev(
        &owner,
        &generation,
        &correlation,
        0,
        42,
        rect(0, 0, 2560, 1360),
        &[(WindowId("w1".to_owned()), rect(0, 0, 1272, 1344))],
        None,
    );
    assert_eq!(event.domain.gap, INNER_GAP);
    assert_eq!(event.outer_gap, OUTER_GAP);
    assert_eq!(event.windows.len(), 1);
    assert!(event.windows[0].hints.is_empty());
    assert!(event.focused_window.0.is_empty());
}

#[test]
fn engine_admits_then_removes_windows() {
    use tiler_core::boundary::CoreReply;
    use tiler_core::engine::Engine;

    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let mut engine = Engine::new();
    engine.sync_binding(&owner, &generation);

    // Two windows admitted through fresh reconcile.
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-1").expect("valid"),
        0,
        1,
        rect(0, 0, 1600, 900),
        &[
            (WindowId("w1".to_owned()), rect(0, 0, 800, 884)),
            (WindowId("w2".to_owned()), rect(800, 0, 800, 884)),
        ],
        None,
    );
    let reply = engine.handle(&event);
    let base = match &reply {
        CoreReply::Tiled(plan) => {
            assert!(!plan.geometry.is_empty());
            plan.base_revision
        }
        CoreReply::Projection(plan) => plan.base_revision,
        other => panic!("unexpected reply: {other:?}"),
    };

    // Retained reconcile at the committed revision projects geometry.
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-2").expect("valid"),
        base,
        2,
        rect(0, 0, 1600, 900),
        &[
            (WindowId("w1".to_owned()), rect(0, 0, 800, 884)),
            (WindowId("w2".to_owned()), rect(800, 0, 800, 884)),
        ],
        None,
    );
    match engine.handle(&event) {
        CoreReply::Projection(plan) => assert_eq!(plan.geometry.len(), 2),
        other => panic!("unexpected reply: {other:?}"),
    }

    // Close one window: convergence removes it, projection covers the survivor.
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-3").expect("valid"),
        base,
        3,
        rect(0, 0, 1600, 900),
        &[(WindowId("w1".to_owned()), rect(0, 0, 800, 884))],
        None,
    );
    match engine.handle(&event) {
        CoreReply::Projection(plan) => {
            assert!(plan.geometry.iter().all(|g| g.window.0 == "w1"));
        }
        other => panic!("unexpected reply: {other:?}"),
    }
}

#[test]
fn engine_manual_geometry_never_adopted() {
    use tiler_core::boundary::CoreReply;
    use tiler_core::engine::Engine;

    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let mut engine = Engine::new();
    engine.sync_binding(&owner, &generation);
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-1").expect("valid"),
        0,
        1,
        rect(0, 0, 1600, 900),
        &[
            (WindowId("w1".to_owned()), rect(0, 0, 800, 884)),
            (WindowId("w2".to_owned()), rect(800, 0, 800, 884)),
        ],
        None,
    );
    let base = match engine.handle(&event) {
        CoreReply::Tiled(plan) => plan.base_revision,
        CoreReply::Projection(plan) => plan.base_revision,
        other => panic!("unexpected reply: {other:?}"),
    };
    // User drags w1 elsewhere without a drag-drop op: retained reconcile
    // reprojects from topology (snap-back), proving the gesture route is
    // required to honor manual moves.
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-2").expect("valid"),
        base,
        2,
        rect(0, 0, 1600, 900),
        &[
            (WindowId("w1".to_owned()), rect(400, 200, 800, 600)),
            (WindowId("w2".to_owned()), rect(800, 0, 800, 884)),
        ],
        None,
    );
    match engine.handle(&event) {
        CoreReply::Projection(plan) => {
            let w1 = plan
                .geometry
                .iter()
                .find(|g| g.window.0 == "w1")
                .expect("w1 projected");
            assert_ne!(w1.rect, rect(400, 200, 800, 600));
        }
        other => panic!("unexpected reply: {other:?}"),
    }
}

#[test]
fn engine_projects_visible_margins_and_inner_gap() {
    use tiler_core::boundary::CoreReply;
    use tiler_core::engine::Engine;

    // Full rcWork in, inset domain out: 8px visible margin on every side plus
    // the 8px inner gap between tiles. Desired rects are visible-frame rects
    // the adapter converts to outer rects per app; the invisible border may
    // land outside rcWork and that is correct.
    let work = rect(0, 0, 1600, 900);
    let domain = tiling_domain_bounds(work).expect("inset");
    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let mut engine = Engine::new();
    engine.sync_binding(&owner, &generation);
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-1").expect("valid"),
        0,
        1,
        domain,
        &[
            (WindowId("w1".to_owned()), rect(0, 0, 800, 884)),
            (WindowId("w2".to_owned()), rect(800, 0, 800, 884)),
        ],
        None,
    );
    let geometry = match engine.handle(&event) {
        CoreReply::Tiled(plan) => plan.geometry,
        CoreReply::Projection(plan) => plan.geometry,
        other => panic!("unexpected reply: {other:?}"),
    };
    assert_eq!(geometry.len(), 2);
    let mut by_x = geometry.clone();
    by_x.sort_by_key(|g| g.rect.x);
    let (left, right) = (&by_x[0], &by_x[1]);
    assert_eq!((left.rect.x, left.rect.y), (8, 8));
    assert_eq!((left.rect.w, left.rect.h), (788, 884));
    assert_eq!((right.rect.x, right.rect.w), (8 + 788 + INNER_GAP, 788));
    assert!(!left.overconstrained && !left.client_clamped);
}

#[test]
fn engine_pointer_resize_returns_resize_plan() {
    use tiler_core::boundary::{CoreCommand, CoreReply};
    use tiler_core::engine::Engine;

    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let mut engine = Engine::new();
    engine.sync_binding(&owner, &generation);
    let domain = tiling_domain_bounds(rect(0, 0, 1600, 900)).expect("inset");
    let event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-1").expect("valid"),
        0,
        1,
        domain,
        &[
            (WindowId("w1".to_owned()), rect(8, 8, 788, 884)),
            (WindowId("w2".to_owned()), rect(804, 8, 788, 884)),
        ],
        None,
    );
    let base = match engine.handle(&event) {
        CoreReply::Tiled(plan) => plan.base_revision,
        CoreReply::Projection(plan) => plan.base_revision,
        other => panic!("unexpected reply: {other:?}"),
    };
    let w1 = WindowId("w1".to_owned());
    let mut event = ev(
        &owner,
        &generation,
        &CorrelationId::parse("tick-2").expect("valid"),
        base,
        2,
        domain,
        &[
            (WindowId("w1".to_owned()), rect(8, 8, 788, 884)),
            (WindowId("w2".to_owned()), rect(804, 8, 788, 884)),
        ],
        Some(&w1),
    );
    event.command = CoreCommand::PointerResize {
        // w1 holds the right leaf (see margin test): its left edge borders
        // w2, so "left" moves the shared boundary. A "right" resize on the
        // rightmost leaf has no neighbor and correctly refuses `Unchanged`.
        window: "w1".to_owned(),
        direction: "left".to_owned(),
        boundary: 700,
        direction2: None,
        boundary2: None,
    };
    match engine.handle(&event) {
        CoreReply::Resize(plan) => assert!(!plan.geometry.is_empty()),
        other => panic!("unexpected reply: {other:?}"),
    }
}

#[test]
fn borderless_fullscreen_needs_captionless_whole_monitor() {
    let full = rect(0, 0, 2560, 1440);
    let work = rect(0, 0, 2560, 1380);
    assert!(is_borderless_fullscreen(
        true,
        rect(0, 0, 2560, 1440),
        &[full]
    ));
    assert!(is_borderless_fullscreen(
        true,
        rect(-2560, 0, 2560, 1440),
        &[rect(-2560, 0, 2560, 1440)]
    ));
    assert!(!is_borderless_fullscreen(true, work, &[full]));
    assert!(!is_borderless_fullscreen(false, full, &[full]));
    assert!(!is_borderless_fullscreen(
        true,
        rect(200, 200, 640, 480),
        &[full]
    ));
    assert!(is_borderless_fullscreen(
        true,
        rect(2560, 0, 1920, 1080),
        &[full, rect(2560, 0, 1920, 1080)]
    ));
    assert!(!is_borderless_fullscreen(
        true,
        rect(2560, 0, 800, 600),
        &[full, rect(2560, 0, 1920, 1080)]
    ));
}

#[test]
fn tokens_keep_skipped_identities_stable() {
    let mut map = TokenMap::default();
    let eligible = map.token_for(1, "c1");
    let skipped = map.token_for(2, "c2");
    map.retain(&[
        ObservedTargetRef {
            hwnd: 1,
            creation: "c1",
        },
        ObservedTargetRef {
            hwnd: 2,
            creation: "c2",
        },
    ]);
    assert_eq!(map.token_for(1, "c1"), eligible);
    assert_eq!(map.token_for(2, "c2"), skipped);
}

#[test]
fn tick_summary_stable_noop_without_tick() {
    let skips = vec![
        ("w9".to_owned(), "refused-intent".to_owned()),
        ("w1".to_owned(), "cloaked".to_owned()),
    ];
    let a = tick_summary_signature(5, 0, &skips, 1, "reconcile", 7);
    let b = tick_summary_signature(5, 0, &skips, 1, "reconcile", 7);
    assert_eq!(a, b, "identical observations must dedupe across ticks");
    let changed = tick_summary_signature(5, 1, &skips, 1, "reconcile", 7);
    assert_ne!(a, changed);
}

#[test]
fn readback_coverage_match_clamp_pending() {
    assert_eq!(
        readback_outcome(true, &rect(0, 0, 800, 600), &rect(0, 0, 800, 600)),
        ReadbackOutcome::Match
    );
    assert_eq!(
        readback_outcome(false, &rect(0, 0, 800, 600), &rect(0, 0, 800, 600)),
        ReadbackOutcome::Match
    );
    assert_eq!(
        readback_outcome(true, &rect(0, 0, 800, 600), &rect(0, 0, 700, 600)),
        ReadbackOutcome::Clamp
    );
    assert_eq!(
        readback_outcome(false, &rect(0, 0, 800, 600), &rect(0, 0, 700, 600)),
        ReadbackOutcome::Pending
    );
    assert_eq!(
        readback_outcome(true, &rect(8, 8, 788, 884), &rect(8, 8, 787, 884)),
        ReadbackOutcome::Clamp
    );
}

#[test]
fn stateless_verdict_keeps_identity_without_frames() {
    use StatelessVerdict::{NeedsGeometry, Report};
    // Non-matching identity is a true unknown even when visible: never a
    // counted skip, never eligible.
    assert_eq!(
        inspect_stateless_verdict(false, true, false),
        Report {
            identity_match: false,
            eligible: false,
            skip: SkipReason::IdentityChanged,
        }
    );
    assert_eq!(SkipReason::IdentityChanged.as_str(), "identity-changed");
    // Hidden exact helper (passive, pre-admission): identity match stands.
    assert_eq!(
        inspect_stateless_verdict(true, false, false),
        Report {
            identity_match: true,
            eligible: false,
            skip: SkipReason::Hidden,
        }
    );
    // Minimized exact helper: state skip with no frame read and no actuation.
    assert_eq!(
        inspect_stateless_verdict(true, true, true),
        Report {
            identity_match: true,
            eligible: false,
            skip: SkipReason::Minimized,
        }
    );
    // Visible, non-minimized match still needs geometry and `classify`.
    assert_eq!(inspect_stateless_verdict(true, true, false), NeedsGeometry);
    // Mismatch beats visibility: a foreign window at a frozen HWND is
    // unknown, and hidden beats minimized.
    assert_eq!(
        inspect_stateless_verdict(false, false, false),
        Report {
            identity_match: false,
            eligible: false,
            skip: SkipReason::IdentityChanged,
        }
    );
    assert_eq!(
        inspect_stateless_verdict(true, false, true),
        Report {
            identity_match: true,
            eligible: false,
            skip: SkipReason::Hidden,
        }
    );
}

#[test]
fn retain_keeps_known_identities_across_reconcile_passes() {
    // Production reconcile scenario: one eligible window, one minimized
    // helper (identity known, no frame), and one frame-unreadable window
    // (identity known) must all keep stable tokens across passes, while an
    // unidentified window and a closed window must not.
    let mut map = TokenMap::default();
    let eligible = map.token_for(11, "creation-eligible");
    let minimized = map.token_for(22, "creation-minimized");
    let unreadable_frameless = map.token_for(33, "creation-frameless");
    // Pass 1 retains every resolved identity, including the frameless ones.
    map.retain(&[
        ObservedTargetRef {
            hwnd: 11,
            creation: "creation-eligible",
        },
        ObservedTargetRef {
            hwnd: 22,
            creation: "creation-minimized",
        },
        ObservedTargetRef {
            hwnd: 33,
            creation: "creation-frameless",
        },
    ]);
    // Pass 2 with the same enumerated set: no token churn.
    map.retain(&[
        ObservedTargetRef {
            hwnd: 11,
            creation: "creation-eligible",
        },
        ObservedTargetRef {
            hwnd: 22,
            creation: "creation-minimized",
        },
        ObservedTargetRef {
            hwnd: 33,
            creation: "creation-frameless",
        },
    ]);
    assert_eq!(map.token_for(11, "creation-eligible"), eligible);
    assert_eq!(map.token_for(22, "creation-minimized"), minimized);
    assert_eq!(
        map.token_for(33, "creation-frameless"),
        unreadable_frameless
    );
    // Fresh unsorted ids still sort deterministically for summaries.
    let mut summary = vec![
        ("w9".to_owned(), "refused-intent".to_owned()),
        ("w1".to_owned(), "minimized".to_owned()),
    ];
    summary.sort();
    let signature = tick_summary_signature(3, 0, &summary, 0, "reconcile", 7);
    assert!(signature.contains("w1=minimized,w9=refused-intent"));
    // Closed windows drop: a re-minted token differs from the stale one.
    map.retain(&[ObservedTargetRef {
        hwnd: 11,
        creation: "creation-eligible",
    }]);
    assert_ne!(map.token_for(22, "creation-minimized"), minimized);
    assert_eq!(map.token_for(11, "creation-eligible"), eligible);
}
