use tiler_core::directional::WindowId;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_windows::tiling::{
    CaptureOptions, FrameInsets, GestureIntent, INNER_GAP, OUTER_GAP, ObservedTarget,
    ObservedTargetRef, ReadbackOutcome, RefusedTracker, ScopeHostChild, SkipReason,
    StatelessVerdict, TokenMap, WindowFacts, WorkspaceRequest, allow_match, allowlist_digest,
    build_reconcile_event, build_reconcile_event_for, classify, classify_gesture, fingerprint,
    hosted_child_allows, inspect_stateless_verdict, is_borderless_fullscreen, min_hints_from_outer,
    normalize_min_track, parse_allowlist, parse_capture_args, parse_children_args,
    parse_hide_proof_args, parse_inspect_args, parse_scope_host_child, parse_tile_args,
    parse_tile_proof_args, parse_workspace_proof_args, parse_workspace_request,
    parse_workspace_select_args, readback_outcome, render_workspace_request, scope_allows,
    scope_exe_basename, tick_summary_signature, tiling_domain_bounds,
    verify_hide_proof_argv_consistency, verify_proof_argv_consistency,
    verify_workspace_proof_argv_consistency, verify_workspace_select_argv_consistency,
    visible_min_from_outer,
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
    assert!(classify(&eligible_facts()).is_ok());
    let mut facts = eligible_facts();
    facts.minimized = true;
    assert_eq!(classify(&facts), Err(SkipReason::Minimized));
    let mut facts = eligible_facts();
    facts.maximized = true;
    assert_eq!(classify(&facts), Err(SkipReason::Maximized));
    let mut facts = eligible_facts();
    facts.cloaked = true;
    assert_eq!(classify(&facts), Err(SkipReason::Cloaked));
    let mut facts = eligible_facts();
    facts.elevated = true;
    assert_eq!(classify(&facts), Err(SkipReason::Elevated));
    let mut facts = eligible_facts();
    facts.owned = true;
    assert_eq!(classify(&facts), Err(SkipReason::OwnedDialog));
    let mut facts = eligible_facts();
    facts.captionless_fullscreen = true;
    assert_eq!(classify(&facts), Err(SkipReason::Fullscreen));
    let mut facts = eligible_facts();
    facts.no_activate = true;
    assert_eq!(classify(&facts), Err(SkipReason::NoActivate));
    let mut facts = eligible_facts();
    facts.dialog = true;
    assert_eq!(classify(&facts), Err(SkipReason::Dialog));
    // Owned generic dialogs keep the owned-dialog reason.
    let mut facts = eligible_facts();
    facts.owned = true;
    facts.dialog = true;
    assert_eq!(classify(&facts), Err(SkipReason::OwnedDialog));
}

#[test]
fn no_terminal_skip_reason() {
    // Terminal windows are ordinary tile targets: eligibility carries no
    // ancestry gate, and the closed skip vocabulary has no terminal variant.
    assert!(classify(&eligible_facts()).is_ok());
    for reason in [
        SkipReason::Hidden,
        SkipReason::Minimized,
        SkipReason::Maximized,
        SkipReason::Cloaked,
        SkipReason::Elevated,
        SkipReason::Shell,
        SkipReason::Tool,
        SkipReason::OwnedDialog,
        SkipReason::Dialog,
        SkipReason::Fullscreen,
        SkipReason::NoActivate,
        SkipReason::Unreadable,
        SkipReason::IdentityChanged,
    ] {
        assert_ne!(reason.as_str(), "terminal");
    }
}

#[test]
fn scope_filter_defaults_open_and_fences_exes() {
    let empty: Vec<String> = Vec::new();
    assert!(scope_allows(&empty, "C:\\Windows\\System32\\notepad.exe"));
    assert!(scope_allows(&empty, "WindowsTerminal.exe"));
    let scope = vec![
        "notepad.exe".to_owned(),
        "ApplicationFrameHost.exe".to_owned(),
        "mspaint.exe".to_owned(),
    ];
    assert!(scope_allows(&scope, "C:\\Windows\\System32\\NOTEPAD.EXE"));
    assert!(scope_allows(&scope, "C:/Windows/System32/mspaint.exe"));
    assert!(scope_allows(&scope, "applicationframehost.exe"));
    // Host-level scope alone cannot distinguish hosted apps (Calculator vs
    // any other Store app): the exact-target runtime fence is the
    // `--scope-host-child` pair below, enforced per tick at observation and
    // fresh at every hide admission.
    assert!(!scope_allows(
        &scope,
        "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal.exe"
    ));
    assert!(!scope_allows(&scope, "firefox.exe"));
    assert_eq!(scope_exe_basename("C:\\a\\NOTEPAD.EXE"), "notepad.exe");
    assert_eq!(scope_exe_basename("mspaint.exe"), "mspaint.exe");
}

#[test]
fn hosted_child_fence_needs_live_matching_child() {
    let pairs = vec![ScopeHostChild {
        host: "ApplicationFrameHost.exe".to_owned(),
        child: "CalculatorApp.exe".to_owned(),
    }];
    let calc = vec!["C:\\Program Files\\WindowsApps\\CalculatorApp.exe".to_owned()];
    let other = vec!["C:\\Program Files\\WindowsApps\\OtherApp.exe".to_owned()];
    // Empty pairs: no constraint anywhere.
    assert!(hosted_child_allows("ApplicationFrameHost.exe", &[], &[]));
    // Unlisted top-level executables are unconstrained by the pairs.
    assert!(hosted_child_allows("notepad.exe", &[], &pairs));
    assert!(hosted_child_allows("notepad.exe", &other, &pairs));
    // Listed host with a live matching hosted child passes (case-insensitive).
    assert!(hosted_child_allows(
        "applicationframehost.exe",
        &calc,
        &pairs
    ));
    // Listed host with only a non-matching hosted app fails closed, even
    // though the top-level executable itself is scope-listed.
    assert!(!hosted_child_allows(
        "ApplicationFrameHost.exe",
        &other,
        &pairs
    ));
    // Listed host with no hosted children at all fails closed: a bare host
    // frame shows no app and manages nothing.
    assert!(!hosted_child_allows(
        "ApplicationFrameHost.exe",
        &[],
        &pairs
    ));
    // Unreadable children contribute nothing: no match, no pass.
    assert!(!hosted_child_allows(
        "ApplicationFrameHost.exe",
        &["unknown".to_owned()],
        &pairs
    ));
    // Extra non-matching siblings do not veto a live match (one top-level
    // window is one app frame).
    let mixed = vec![
        "C:\\Program Files\\WindowsApps\\OtherApp.exe".to_owned(),
        "C:\\Program Files\\WindowsApps\\CalculatorApp.exe".to_owned(),
    ];
    assert!(hosted_child_allows(
        "ApplicationFrameHost.exe",
        &mixed,
        &pairs
    ));
    // Pairs constrain only their own host: a second pair neither widens nor
    // narrows the first, and unlisted hosts stay unconstrained.
    let pairs = vec![
        ScopeHostChild {
            host: "ApplicationFrameHost.exe".to_owned(),
            child: "CalculatorApp.exe".to_owned(),
        },
        ScopeHostChild {
            host: "OtherHost.exe".to_owned(),
            child: "OtherChild.exe".to_owned(),
        },
    ];
    assert!(hosted_child_allows(
        "ApplicationFrameHost.exe",
        &calc,
        &pairs
    ));
    assert!(!hosted_child_allows(
        "ApplicationFrameHost.exe",
        &other,
        &pairs
    ));
    assert!(hosted_child_allows(
        "OtherHost.exe",
        &["OtherChild.exe".to_owned()],
        &pairs
    ));
    assert!(!hosted_child_allows("OtherHost.exe", &calc, &pairs));
    assert!(hosted_child_allows("notepad.exe", &[], &pairs));
}

#[test]
fn scope_host_child_parses_pairs_and_refuses_malformed() {
    let pair = parse_scope_host_child("ApplicationFrameHost.exe=CalculatorApp.exe").expect("pair");
    assert_eq!(pair.host, "ApplicationFrameHost.exe");
    assert_eq!(pair.child, "CalculatorApp.exe");
    for bad in [
        "",
        "=",
        "=Child.exe",
        "Host.exe=",
        "Host.exe=A=B",
        "  ",
        "Host.exe = ",
    ] {
        assert!(
            parse_scope_host_child(bad).is_err(),
            "refuses {bad:?}, never a widened scope"
        );
    }
}

#[test]
fn tile_args_accept_scope_host_child_with_dedup() {
    let args = [
        "--user-start",
        "--scope-exe",
        "ApplicationFrameHost.exe",
        "--scope-host-child",
        "ApplicationFrameHost.exe=CalculatorApp.exe",
        "--scope-host-child",
        "applicationframehost.exe=calculatorapp.exe",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect::<Vec<_>>();
    let options = parse_tile_args(&args).expect("tile args");
    assert_eq!(options.scope_hosts.len(), 1);
    assert_eq!(options.scope_hosts[0].host, "ApplicationFrameHost.exe");
    assert_eq!(options.scope_hosts[0].child, "CalculatorApp.exe");
    // Malformed pair refuses the whole run, never a silent normal run.
    let bad = [
        "--user-start",
        "--scope-host-child",
        "ApplicationFrameHost.exe",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect::<Vec<_>>();
    assert!(parse_tile_args(&bad).is_err());
    // Default stays unconstrained: no pairs without the explicit flag.
    let plain = ["--user-start".to_owned()];
    assert!(
        parse_tile_args(&plain)
            .expect("plain")
            .scope_hosts
            .is_empty()
    );
}

#[test]
fn token_reissue_breaks_engine_identity_after_reuse() {
    // Same-process HWND reuse keeps (HWND, creation): the stable token would
    // inherit the previous generation's Engine identity. Reissue mints a
    // fresh token for the new generation; later ticks resolve it stably.
    let mut tokens = TokenMap::default();
    let first = tokens.token_for(0x1234, "creation-1");
    assert_eq!(tokens.token_for(0x1234, "creation-1"), first);
    let second = tokens.reissue(0x1234, "creation-1");
    assert_ne!(second, first);
    assert_eq!(tokens.token_for(0x1234, "creation-1"), second);
    // Unrelated windows keep their own stable tokens.
    let other = tokens.token_for(0x5678, "creation-1");
    assert_ne!(other, first);
    assert_ne!(other, second);
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
    assert!(options.scope_exes.is_empty(), "no default scope filter");
    let options =
        parse_tile_args(&strings(&["--user-start", "--seconds", "60", "--trace"])).expect("parsed");
    assert_eq!(options.seconds, Some(60));
    assert!(options.trace);
    assert!(options.scope_exes.is_empty());
    // Allowlist never rides the normal path: proof uses tile-proof so lost
    // arguments cannot fall back to tiling the whole desktop.
    assert!(parse_tile_args(&strings(&["--user-start", "--allowlist", "a.json"])).is_err());
    assert!(parse_tile_args(&["--seconds".to_owned(), "0".to_owned()]).is_err());
    assert!(parse_tile_args(&["--bogus".to_owned()]).is_err());
}

#[test]
fn tile_args_scope_exe_is_explicit_opt_in() {
    let options = parse_tile_args(&strings(&[
        "--user-start",
        "--scope-exe",
        "notepad.exe",
        "--scope-exe",
        "ApplicationFrameHost.exe",
        "--scope-exe",
        "mspaint.exe",
    ]))
    .expect("scoped");
    assert_eq!(options.scope_exes.len(), 3);
    assert!(scope_allows(
        &options.scope_exes,
        "C:\\Windows\\System32\\notepad.exe"
    ));
    assert!(!scope_allows(&options.scope_exes, "firefox.exe"));
    // Case-insensitive dedupe: same basename twice stores once.
    let options = parse_tile_args(&strings(&[
        "--user-start",
        "--scope-exe",
        "notepad.exe",
        "--scope-exe",
        "NOTEPAD.EXE",
    ]))
    .expect("scoped");
    assert_eq!(options.scope_exes.len(), 1);
    // Empty scope value refuses, never a wildcard.
    assert!(parse_tile_args(&strings(&["--user-start", "--scope-exe", " "])).is_err());
    assert!(parse_tile_args(&strings(&["--user-start", "--scope-exe"])).is_err());
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

#[test]
fn hide_proof_args_require_allowlist() {
    assert!(parse_hide_proof_args(&[]).is_err());
    assert!(parse_hide_proof_args(&strings(&["--trace"])).is_err());
    assert!(parse_hide_proof_args(&strings(&["--allowlist", ""])).is_err());
    let options = parse_hide_proof_args(&strings(&["--allowlist", "a.json"])).expect("proof");
    assert_eq!(options.allowlist, std::path::PathBuf::from("a.json"));
    assert_eq!(options.seconds, None);
    assert!(!options.trace);
    let options = parse_hide_proof_args(&strings(&[
        "--allowlist",
        "a.json",
        "--seconds",
        "60",
        "--trace",
    ]))
    .expect("parsed");
    assert_eq!(options.seconds, Some(60));
    assert!(options.trace);
    assert!(parse_hide_proof_args(&strings(&["--allowlist", "a.json", "--bogus"])).is_err());
    // Never falls back: unknown flags and bad seconds refuse.
    assert!(parse_hide_proof_args(&strings(&["--allowlist", "a.json", "--seconds", "0"])).is_err());
}

#[test]
fn hide_proof_argv_consistency_evidences_every_flag() {
    let raw = strings(&[
        "--allowlist",
        "C:\\my dir\\a.json",
        "--seconds",
        "300",
        "--trace",
    ]);
    let parsed = parse_hide_proof_args(&raw).expect("parsed");
    assert!(verify_hide_proof_argv_consistency(&raw, &parsed).is_ok());
    let raw = strings(&["--allowlist", "a.json", "--trace"]);
    let parsed = parse_hide_proof_args(&raw).expect("parsed");
    assert!(verify_hide_proof_argv_consistency(&raw, &parsed).is_ok());
    let parsed_no_trace =
        parse_hide_proof_args(&strings(&["--allowlist", "a.json"])).expect("parsed");
    assert!(verify_hide_proof_argv_consistency(&raw, &parsed_no_trace).is_err());
    let raw_full = strings(&["--allowlist", "a.json", "--seconds", "300", "--trace"]);
    assert!(verify_hide_proof_argv_consistency(&raw_full, &parsed).is_err());
    let raw_other = strings(&["--allowlist", "b.json", "--trace"]);
    assert!(verify_hide_proof_argv_consistency(&raw_other, &parsed).is_err());
    let raw_bogus = strings(&["--allowlist", "a.json", "--bogus"]);
    assert!(verify_hide_proof_argv_consistency(&raw_bogus, &parsed).is_err());
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
    let hinted: Vec<(WindowId, Rect, tiler_core::size_hints::WindowSizeHints)> = windows
        .iter()
        .map(|(w, r)| {
            (
                w.clone(),
                *r,
                tiler_core::size_hints::WindowSizeHints::none(),
            )
        })
        .collect();
    build_reconcile_event(&tiler_windows::tiling::ReconcileInput {
        owner,
        generation,
        correlation,
        revision,
        fingerprint: fp,
        domain_bounds: bounds,
        windows: &hinted,
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
fn per_workspace_reconcile_binds_domain_key() {
    // Unified per-(output, workspace) routing: the event carries the exact
    // domain key, bounds, gap, and rows (visible plus retained snapshots),
    // and independent domains keep separate sessions with no shared layout.
    use tiler_core::directional::{OutputId, WorkspaceId};
    use tiler_core::session::{DomainKey, OutputDomain};
    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let correlation = CorrelationId::parse("tick-1").expect("valid");
    let key = DomainKey {
        output: OutputId("mon-a".to_owned()),
        workspace: WorkspaceId("ws-2".to_owned()),
    };
    let domain = OutputDomain {
        id: OutputId("mon-a".to_owned()),
        workspace: WorkspaceId("ws-2".to_owned()),
        bounds: rect(0, 0, 1904, 1032),
        gap: INNER_GAP,
        adjacent: std::collections::BTreeMap::new(),
    };
    let windows = vec![(
        WindowId("w1".to_owned()),
        rect(8, 8, 800, 600),
        tiler_core::size_hints::WindowSizeHints::none(),
    )];
    let event = build_reconcile_event_for(
        &owner,
        &generation,
        &correlation,
        7,
        42,
        &domain,
        &key,
        OUTER_GAP,
        &windows,
        Some(&WindowId("w1".to_owned())),
    );
    assert_eq!(event.domain_key, key);
    assert_eq!(event.domain, domain);
    assert_eq!(event.revision, 7);
    assert_eq!(event.outer_gap, OUTER_GAP);
    assert_eq!(event.windows.len(), 1);
    assert_eq!(event.windows[0].output.0, "mon-a");
    assert_eq!(event.windows[0].workspace.0, "ws-2");
    assert!(event.target_domain.is_none());
}

#[test]
fn workspace_proof_parses_without_widening_product() {
    let args: Vec<String> = ["--allowlist", "a.json"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let ok = parse_workspace_proof_args(&args).expect("parsed");
    assert_eq!(ok.allowlist.to_str().expect("path"), "a.json");
    let raw = args.clone();
    assert!(verify_workspace_proof_argv_consistency(&raw, &ok).is_ok());
    // Product tile still refuses allowlists: no fallback into normal mode.
    let tile: Vec<String> = ["--user-start", "--allowlist", "a.json"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    assert!(parse_tile_args(&tile).is_err());
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

#[test]
fn workspace_select_cli_parses_single_digit_only() {
    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).to_owned()).collect()
    }
    let ok = parse_workspace_select_args(&strings(&["--select", "2"])).expect("parsed");
    assert_eq!(ok.index, 2);
    assert!(verify_workspace_select_argv_consistency(&strings(&["--select", "2"]), &ok).is_ok());
    assert!(parse_workspace_select_args(&[]).is_err());
    assert!(parse_workspace_select_args(&strings(&["--select"])).is_err());
    assert!(parse_workspace_select_args(&strings(&["--select", "10"])).is_err());
    assert!(parse_workspace_select_args(&strings(&["--select", "2", "--select", "1"])).is_err());
    assert!(parse_workspace_select_args(&strings(&["--send", "2"])).is_err());
    let ok0 = parse_workspace_select_args(&strings(&["--select", "0"])).expect("zero");
    assert_eq!(ok0.index, 0);
    let ok9 = parse_workspace_select_args(&strings(&["--select", "9"])).expect("nine");
    assert_eq!(ok9.index, 9);
    assert!(verify_workspace_select_argv_consistency(&strings(&["--select", "1"]), &ok).is_err());
}

#[test]
fn workspace_request_roundtrip_and_refusals() {
    let request = WorkspaceRequest {
        v: 1,
        creation: "abc123".to_owned(),
        pid: 4242,
        exe_path: "C:\\bin\\tiler-windows.exe".to_owned(),
        user_sid: "S-1-5-21-1".to_owned(),
        session_id: 1,
        index: 2,
        correlation: "cli-4242-ab12".to_owned(),
    };
    let body = render_workspace_request(&request);
    assert!(body.contains("abc123") && body.contains("cli-4242-ab12"));
    assert!(!body.contains("hwnd"));
    let parsed = parse_workspace_request(&body).expect("roundtrip");
    assert_eq!(parsed, request);
    let mut bad_version = request.clone();
    bad_version.v = 2;
    assert!(parse_workspace_request(&render_workspace_request(&bad_version)).is_err());
    let mut bad_index = request.clone();
    bad_index.index = 10;
    assert!(parse_workspace_request(&render_workspace_request(&bad_index)).is_err());
    let mut bad_corr = request.clone();
    bad_corr.correlation = "bad corr".to_owned();
    assert!(parse_workspace_request(&render_workspace_request(&bad_corr)).is_err());
    let mut bad_owner = request.clone();
    bad_owner.creation = String::new();
    assert!(parse_workspace_request(&render_workspace_request(&bad_owner)).is_err());
    assert!(parse_workspace_request("not json").is_err());
}

#[test]
fn default_seeded_track_converts_but_zero_query_stays_unknown() {
    // A correctly seeded system-default track (positive, in-bound) converts
    // 1:1 with zero insets: an app that leaves the seeded default untouched
    // reports a usable hint, never a fabricated absence. A zero return (query
    // failure) stays unknown: the native path ignores the struct entirely.
    let zero = FrameInsets {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    assert_eq!(visible_min_from_outer(160, 40, zero), Some((160, 40)));
    assert_eq!(normalize_min_track(160, 40), Some((160, 40)));
    assert_eq!(visible_min_from_outer(0, 0, zero), None);
    assert!(min_hints_from_outer(0, 0, zero).is_empty());
}

#[test]
fn min_track_normalization_rejects_invalid() {
    // Valid outer track sizes pass through untouched.
    assert_eq!(normalize_min_track(880, 625), Some((880, 625)));
    assert_eq!(normalize_min_track(1, 1), Some((1, 1)));
    assert_eq!(normalize_min_track(16384, 16384), Some((16384, 16384)));
    // Zero, negative, and absurd values mean no usable minimum: unknown, not
    // a zero floor.
    assert_eq!(normalize_min_track(0, 625), None);
    assert_eq!(normalize_min_track(880, 0), None);
    assert_eq!(normalize_min_track(-8, 625), None);
    assert_eq!(normalize_min_track(880, -8), None);
    assert_eq!(normalize_min_track(16385, 625), None);
    assert_eq!(normalize_min_track(880, i32::MAX), None);
}

#[test]
fn visible_min_conversion_matches_known_apps() {
    // Paint: outer minimum 880x625 with an 8/4/8/4 frame converts to visible
    // 864x617 physical pixels.
    let paint = FrameInsets {
        left: 8,
        top: 4,
        right: 8,
        bottom: 4,
    };
    assert_eq!(visible_min_from_outer(880, 625, paint), Some((864, 617)));
    let hints = min_hints_from_outer(880, 625, paint);
    assert_eq!(hints.min_w, Some(864));
    assert_eq!(hints.min_h, Some(617));
    assert_eq!(hints.max_w, None);
    assert_eq!(hints.max_h, None);
    // Notepad: outer minimum 415x253 with a 7/3/7/4 frame converts to visible
    // 401x246 physical pixels.
    let notepad = FrameInsets {
        left: 7,
        top: 3,
        right: 7,
        bottom: 4,
    };
    assert_eq!(visible_min_from_outer(415, 253, notepad), Some((401, 246)));
    let hints = min_hints_from_outer(415, 253, notepad);
    assert_eq!(hints.min_w, Some(401));
    assert_eq!(hints.min_h, Some(246));
}

#[test]
fn visible_min_unknown_when_invalid_or_swallowed_by_frame() {
    let insets = FrameInsets {
        left: 8,
        top: 4,
        right: 8,
        bottom: 4,
    };
    // Invalid track sizes carry no hint.
    assert_eq!(visible_min_from_outer(0, 625, insets), None);
    assert!(min_hints_from_outer(0, 625, insets).is_empty());
    // A minimum that vanishes inside its own frame carries no usable visible
    // constraint: unknown, never a zero or negative floor.
    assert_eq!(visible_min_from_outer(16, 8, insets), None);
    assert_eq!(visible_min_from_outer(10, 4, insets), None);
    assert!(min_hints_from_outer(16, 8, insets).is_empty());
}

#[test]
fn reconcile_builder_carries_per_window_hints() {
    use tiler_core::directional::{OutputId, WorkspaceId};
    use tiler_core::session::{DomainKey, OutputDomain};
    let owner = OwnerId::parse("tiler-windows").expect("valid");
    let generation = GenerationId::parse("abcdef0123456789").expect("valid");
    let correlation = CorrelationId::parse("tick-1").expect("valid");
    let key = DomainKey {
        output: OutputId("mon-a".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
    };
    let domain = OutputDomain {
        id: OutputId("mon-a".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        bounds: rect(0, 0, 1600, 900),
        gap: INNER_GAP,
        adjacent: std::collections::BTreeMap::new(),
    };
    let hinted = tiler_core::size_hints::WindowSizeHints {
        min_w: Some(864),
        min_h: Some(617),
        max_w: None,
        max_h: None,
    };
    let windows = vec![
        (WindowId("w1".to_owned()), rect(0, 0, 800, 884), hinted),
        (
            WindowId("w2".to_owned()),
            rect(800, 0, 800, 884),
            tiler_core::size_hints::WindowSizeHints::none(),
        ),
    ];
    let event = build_reconcile_event_for(
        &owner,
        &generation,
        &correlation,
        0,
        2,
        &domain,
        &key,
        OUTER_GAP,
        &windows,
        None,
    );
    assert_eq!(event.windows.len(), 2);
    assert_eq!(event.windows[0].hints, hinted);
    assert!(event.windows[1].hints.is_empty());
}
