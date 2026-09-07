//! Static tests for the POC3 raw xdg-shell diagnostic client.
//! No compositor, no live KWin/Wayland. Pure CLI/state/buffer/diagnostic.

use plasma_auto_tiler::poc3_diag::{
    BufferDecision, CliError, ConfigureAction, DiagBufferTracker, DiagEvent, DiagLifecycle,
    MAX_CONFIG_STATES, MAX_DIAG_EVENT_BYTES, MAX_LIVE_BUFFERS, MAX_MANIFEST_BYTES, buffer_bytes,
    draw_slot, format_event, parse_args, parse_manifest_text, slot_desc,
};

fn clean(_: &str) -> Option<String> {
    None
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(ToString::to_string).collect()
}

fn explicit(slot: &str) -> Vec<String> {
    argv(&[
        "poc3-diagnostic-client",
        "--runtime",
        "/tmp/poc3-wd/runtime",
        "--socket",
        "nested-poc3",
        "--slot",
        slot,
        "--diag",
        "/tmp/poc3-wd/diag.log",
    ])
}

#[test]
fn cli_accepts_explicit_valid_target() {
    let cfg = parse_args(&explicit("2"), 1000, &clean).expect("valid");
    assert_eq!(cfg.slot, 2);
    assert_eq!(cfg.socket_name, "nested-poc3");
}

#[test]
fn cli_rejects_missing_and_unknown() {
    assert_eq!(
        parse_args(&argv(&["bin"]), 1000, &clean).unwrap_err(),
        CliError::MissingArg
    );
    assert_eq!(
        parse_args(&argv(&["bin", "--bogus", "x"]), 1000, &clean).unwrap_err(),
        CliError::UnknownArg
    );
    // Manifest route without file content cannot complete here; binary reads
    // the bounded file. Pure parse_args reports missing-arg for route marker.
    assert_eq!(
        parse_args(
            &argv(&["bin", "--manifest", "/tmp/poc3-wd/manifest"]),
            1000,
            &clean
        )
        .unwrap_err(),
        CliError::MissingArg
    );
    // Mixing routes is refused.
    let mixed = argv(&["bin", "--manifest", "/tmp/poc3-wd/manifest", "--slot", "1"]);
    assert_eq!(
        parse_args(&mixed, 1000, &clean).unwrap_err(),
        CliError::MixedRoute
    );
}

#[test]
fn cli_refuses_host_default_and_ambient() {
    // Ambient env forces refusal even for an otherwise-valid target.
    let ambient = |key: &str| match key {
        "XDG_RUNTIME_DIR" => Some("/run/user/1000".to_owned()),
        _ => None,
    };
    assert_eq!(
        parse_args(&explicit("1"), 1000, &ambient).unwrap_err(),
        CliError::AmbientTarget
    );
    let host = |key: &str| match key {
        "WAYLAND_DISPLAY" => Some("wayland-0".to_owned()),
        _ => None,
    };
    assert_eq!(
        parse_args(&explicit("1"), 1000, &host).unwrap_err(),
        CliError::AmbientTarget
    );
    // Host runtimes refused with redacted fixed errors.
    for runtime in ["/", "/tmp", "/run", "/run/user", "/run/user/1000"] {
        let args = argv(&[
            "bin",
            "--runtime",
            runtime,
            "--socket",
            "nested-poc3",
            "--slot",
            "1",
            "--diag",
            "/tmp/poc3-wd/diag.log",
        ]);
        let err = parse_args(&args, 1000, &clean).unwrap_err();
        assert_eq!(err, CliError::HostTarget, "runtime {runtime}");
        assert!(!err.to_string().contains(runtime));
    }
    // Default socket names refused: all canonical wayland-<decimal>.
    for socket in ["wayland-0", "wayland-1", "wayland-2", "wayland-10"] {
        let args = argv(&[
            "bin",
            "--runtime",
            "/tmp/poc3-wd/runtime",
            "--socket",
            socket,
            "--slot",
            "1",
            "--diag",
            "/tmp/poc3-wd/diag.log",
        ]);
        assert_eq!(
            parse_args(&args, 1000, &clean).unwrap_err(),
            CliError::DefaultTarget,
            "socket {socket}"
        );
    }
    // Non-default private nested names remain accepted.
    for socket in ["nested-poc3", "nested-0", "wayland-private", "wayland-0a"] {
        let args = argv(&[
            "bin",
            "--runtime",
            "/tmp/poc3-wd/runtime",
            "--socket",
            socket,
            "--slot",
            "1",
            "--diag",
            "/tmp/poc3-wd/diag.log",
        ]);
        assert!(
            parse_args(&args, 1000, &clean).is_ok(),
            "socket {socket} accepted"
        );
    }
}

#[test]
fn slot_bounds_are_exact() {
    assert!(slot_desc(1).is_some());
    assert!(slot_desc(3).is_some());
    assert!(slot_desc(0).is_none());
    assert!(slot_desc(4).is_none());
    for bad in ["0", "4", "abc", ""] {
        let args = argv(&[
            "bin",
            "--runtime",
            "/tmp/poc3-wd/runtime",
            "--socket",
            "nested-poc3",
            "--slot",
            bad,
            "--diag",
            "/tmp/poc3-wd/diag.log",
        ]);
        assert_eq!(
            parse_args(&args, 1000, &clean).unwrap_err(),
            CliError::BadSlot,
            "slot {bad:?}"
        );
    }
    // Slots are distinct in title/app_id/color/marker.
    let (a, b, c) = (
        slot_desc(1).expect("1"),
        slot_desc(2).expect("2"),
        slot_desc(3).expect("3"),
    );
    assert!(a.title != b.title && b.title != c.title);
    assert!(a.app_id != b.app_id && b.app_id != c.app_id);
    assert!(a.argb != b.argb && b.argb != c.argb);
    assert!(a.marker != b.marker && b.marker != c.marker);
}

#[test]
fn redaction_and_bounds_hold() {
    let secret = "super-secret-runtime-value";
    let text = format_event(1, &DiagEvent::Connect { slot: 1 }).expect("event");
    assert!(!text.contains(secret));
    let err = CliError::HostTarget.to_string();
    assert!(!err.contains(secret));
    assert!(
        format_event(1, &DiagEvent::Connect { slot: 1 })
            .expect("e")
            .len()
            <= MAX_DIAG_EVENT_BYTES
    );
    assert!(format_event(1_000_000, &DiagEvent::Close).is_none());
    assert!(format_event(1, &DiagEvent::Exit { reason: "bogus" }).is_none());
}

#[test]
fn buffer_sizing_overflow_is_refused() {
    assert!(buffer_bytes(320, 240).is_ok());
    assert!(buffer_bytes(0, 240).is_err());
    assert!(buffer_bytes(-1, 240).is_err());
    assert!(buffer_bytes(5000, 5000).is_err());
    assert!(buffer_bytes(i32::MAX, 2).is_err());
    // Draw validates length and slot.
    let mut good = vec![0u8; 16 * 16 * 4];
    draw_slot(16, 16, 1, &mut good).expect("draw");
    assert!(good.iter().any(|b| *b != 0));
    let mut short = vec![0u8; 10];
    assert!(draw_slot(16, 16, 1, &mut short).is_err());
    let mut good2 = vec![0u8; 16 * 16 * 4];
    assert!(draw_slot(16, 16, 9, &mut good2).is_err());
    // Distinct slots paint distinct buffers.
    let mut one = vec![0u8; 32 * 32 * 4];
    let mut two = vec![0u8; 32 * 32 * 4];
    draw_slot(32, 32, 1, &mut one).expect("1");
    draw_slot(32, 32, 2, &mut two).expect("2");
    assert_ne!(one, two);
}

#[test]
fn event_transitions_cover_lifecycle() {
    let mut life = DiagLifecycle::new();
    // Configure-before-map is refused.
    assert_eq!(life.on_first_map().unwrap_err(), "configure-before-map");
    // First configure maps.
    assert_eq!(
        life.on_configure(10, 200, 100, 1).expect("configure"),
        ConfigureAction::AckAndMap { serial: 10 }
    );
    // Duplicate serial dedups without a second map.
    assert_eq!(
        life.on_configure(10, 200, 100, 1).expect("dup"),
        ConfigureAction::DuplicateAck { serial: 10 }
    );
    assert_eq!(life.configure_count(), 1);
    let (w, h) = life.on_first_map().expect("map");
    assert_eq!((w, h), (200, 100));
    // Second distinct configure also acks-and-commits (resize path).
    assert_eq!(
        life.on_configure(11, 200, 100, 1).expect("second"),
        ConfigureAction::AckAndMap { serial: 11 }
    );
    assert_eq!(life.on_first_map().expect("repeat commit"), (200, 100));
    // Close terminates.
    life.on_close().expect("close");
    assert!(life.is_closed());
    assert!(life.on_close().is_err());
    assert!(life.on_configure(12, 10, 10, 0).is_err());
}

#[test]
fn close_and_protocol_error_are_terminal() {
    let mut life = DiagLifecycle::new();
    life.on_configure(1, 64, 64, 0).expect("configure");
    life.on_protocol_error("protocol-error").expect("record");
    assert!(life.on_first_map().is_err());
    assert!(life.on_close().is_err());
    assert!(life.on_configure(2, 64, 64, 0).is_err());
    assert!(life.on_protocol_error("protocol-error").is_err());
}

#[test]
fn raw_states_and_terminal_first_wins() {
    use plasma_auto_tiler::poc3_diag::MAX_CONFIG_STATES;
    // Raw state count is rejected, never clamped.
    let mut life = DiagLifecycle::new();
    assert!(life.on_configure(1, 80, 60, MAX_CONFIG_STATES + 1).is_err());
    assert_eq!(life.configure_count(), 0);
    // Raw 0x0 configures; fallback applies to buffer sizing.
    assert_eq!(
        life.on_configure(2, 0, 0, 0).expect("raw zero"),
        ConfigureAction::AckAndMap { serial: 2 }
    );
    // Close wins: protocol-error afterwards must fail.
    life.on_close().expect("close");
    assert!(life.on_protocol_error("protocol-error").is_err());
    assert!(life.on_configure(3, 10, 10, 0).is_err());
}

/// Model strict order: toplevel size -> surface configure -> lifecycle
/// accept -> ack -> attach+commit via tracker. Each valid distinct configure
/// must ack-and-commit.
fn commit_flow(
    life: &mut DiagLifecycle,
    tracker: &mut DiagBufferTracker,
    serial: u32,
    width: i32,
    height: i32,
) -> (u32, i32, i32, BufferDecision) {
    let action = life.on_configure(serial, width, height, 0).expect("valid");
    let ConfigureAction::AckAndMap { serial: acked } = action else {
        panic!("distinct configure must AckAndMap");
    };
    assert_eq!(acked, serial);
    let (w, h) = life.on_first_map().expect("commit size");
    let decision = tracker.request(w, h).expect("buffer");
    (acked, w, h, decision)
}

#[test]
fn initial_configure_commits_requested_size() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    let (_, w, h, decision) = commit_flow(&mut life, &mut tracker, 1, 640, 480);
    assert_eq!((w, h), (640, 480));
    assert!(matches!(decision, BufferDecision::Allocate { .. }));
    assert_eq!(tracker.total_count(), 1);
    assert_eq!(tracker.retained_unreleased_count(), 0);
}

#[test]
fn zero_dimensions_fall_back_to_320x240() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    let (_, w, h, decision) = commit_flow(&mut life, &mut tracker, 1, 0, 0);
    assert_eq!((w, h), (320, 240));
    assert!(matches!(decision, BufferDecision::Allocate { .. }));
}

#[test]
fn resize_and_repeated_resize_retain_replaced_buffers() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    let (_, _, _, first) = commit_flow(&mut life, &mut tracker, 1, 320, 240);
    let first_id = match first {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { id } => id,
    };
    // Resize to a new size allocates and retains the replaced buffer.
    let (_, w, h, second) = commit_flow(&mut life, &mut tracker, 2, 640, 480);
    assert_eq!((w, h), (640, 480));
    let second_id = match second {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { .. } => panic!("different size must allocate"),
    };
    assert_ne!(first_id, second_id);
    assert_eq!(tracker.total_count(), 2);
    assert_eq!(tracker.retained_unreleased_count(), 1);
    assert_eq!(tracker.is_released(first_id), Some(false));
    // Repeated resize to a third size retains both prior unreleased buffers.
    let (_, w, h, third) = commit_flow(&mut life, &mut tracker, 3, 800, 600);
    assert_eq!((w, h), (800, 600));
    assert!(matches!(third, BufferDecision::Allocate { .. }));
    assert_eq!(tracker.total_count(), 3);
    assert_eq!(tracker.retained_unreleased_count(), 2);
    // Same-size repeat while unreleased must allocate a separate retained
    // buffer, never reattach the in-use buffer.
    let (_, w, h, fourth) = commit_flow(&mut life, &mut tracker, 4, 800, 600);
    assert_eq!((w, h), (800, 600));
    assert!(matches!(fourth, BufferDecision::Allocate { .. }));
    assert_eq!(tracker.total_count(), 4);
    assert_eq!(tracker.retained_unreleased_count(), 3);
    // At the bound a further distinct unreleased size refuses without commit.
    assert_eq!(tracker.request(1024, 768).unwrap_err(), "buffer-overflow");
    assert_eq!(tracker.total_count(), 4);
}

#[test]
fn zero_retains_latest_positive_and_fallback_is_initial_only() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    // Initial 0x0 falls back to 320x240.
    let (_, w, h, _) = commit_flow(&mut life, &mut tracker, 1, 0, 0);
    assert_eq!((w, h), (320, 240));
    // Positive configure then later 0x0 retains the prior content size.
    let (_, w, h, _) = commit_flow(&mut life, &mut tracker, 2, 640, 480);
    assert_eq!((w, h), (640, 480));
    let (_, w, h, _) = commit_flow(&mut life, &mut tracker, 3, 0, 0);
    assert_eq!((w, h), (640, 480));
    // Partial zero also retains the full prior size.
    let (_, w, h, _) = commit_flow(&mut life, &mut tracker, 4, 640, 0);
    assert_eq!((w, h), (640, 480));
    assert_eq!(life.content_size(), Some((640, 480)));
}

#[test]
fn invalid_dimensions_do_not_overwrite_retained_size() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    commit_flow(&mut life, &mut tracker, 1, 640, 480);
    let before = tracker.total_count();
    assert_eq!(
        life.on_configure(2, -1, 240, 0).unwrap_err(),
        "buffer-dimensions"
    );
    assert_eq!(
        life.on_configure(3, 5000, 5000, 0).unwrap_err(),
        "buffer-dimensions"
    );
    assert_eq!(
        life.on_configure(4, 100, 100, MAX_CONFIG_STATES + 1)
            .unwrap_err(),
        "too-many-states"
    );
    assert_eq!(life.on_configure(0, 100, 100, 0).unwrap_err(), "bad-serial");
    assert_eq!(tracker.total_count(), before);
    assert_eq!(life.content_size(), Some((640, 480)));
    // Later valid configure still succeeds at a new size.
    let (_, w, h, _) = commit_flow(&mut life, &mut tracker, 5, 800, 600);
    assert_eq!((w, h), (800, 600));
}

#[test]
fn surface_without_new_toplevel_retains_last_request() {
    let mut life = DiagLifecycle::new();
    life.on_configure(1, 640, 480, 0).expect("valid");
    // Model the live client: after each surface configure the pending size
    // resets to the last requested size, so a repeat without fresh toplevel
    // data reuses it instead of 0x0.
    let retained = life.content_size().expect("retained");
    assert_eq!(retained, (640, 480));
    let action = life
        .on_configure(2, retained.0, retained.1, 0)
        .expect("repeat");
    assert_eq!(action, ConfigureAction::AckAndMap { serial: 2 });
    assert_eq!(life.on_first_map().expect("size"), (640, 480));
}

#[test]
fn same_size_repeat_allocates_until_release() {
    let mut tracker = DiagBufferTracker::new();
    let first = tracker.request(320, 240).expect("first");
    let first_id = match first {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { .. } => panic!("first must allocate"),
    };
    // Same size while unreleased allocates a separate buffer.
    let second = tracker.request(320, 240).expect("second");
    let second_id = match second {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { .. } => panic!("unreleased repeat must allocate"),
    };
    assert_ne!(first_id, second_id);
    assert_eq!(tracker.total_count(), 2);
    // After release, a compatible request may reuse the released buffer.
    assert!(tracker.on_release(first_id));
    assert_eq!(
        tracker.request(320, 240).expect("reuse"),
        BufferDecision::Reuse { id: first_id }
    );
}

#[test]
fn retained_limit_refuses_without_commit_with_bounded_kind() {
    let mut tracker = DiagBufferTracker::new();
    let first = tracker.request(320, 240).expect("fill");
    let first_id = match first {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { .. } => panic!("first must allocate"),
    };
    for (w, h) in [(640, 480), (800, 600), (1024, 768)] {
        tracker.request(w, h).expect("fill");
    }
    assert_eq!(tracker.total_count(), MAX_LIVE_BUFFERS);
    // One more distinct size refuses with the bounded kind, no state change.
    assert_eq!(tracker.request(200, 100).unwrap_err(), "buffer-overflow");
    assert_eq!(tracker.total_count(), MAX_LIVE_BUFFERS);
    // Old stores are kept through release and destroyed only at cleanup:
    // every held id is known exactly once.
    let mut ids = tracker.all_ids();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), tracker.total_count());
    // Releasing the first size lets a compatible request reuse it.
    assert!(tracker.on_release(first_id));
    assert_eq!(
        tracker.request(320, 240).expect("reuse"),
        BufferDecision::Reuse { id: first_id }
    );
    assert_eq!(tracker.total_count(), MAX_LIVE_BUFFERS);
}

#[test]
fn buffer_release_enables_safe_reuse_without_destroying_in_use() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    let (_, _, _, first) = commit_flow(&mut life, &mut tracker, 1, 320, 240);
    let first_id = match first {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { id } => id,
    };
    let (_, _, _, second) = commit_flow(&mut life, &mut tracker, 2, 640, 480);
    let second_id = match second {
        BufferDecision::Allocate { id, .. } => id,
        BufferDecision::Reuse { .. } => panic!("must allocate"),
    };
    // Compositor releases the replaced first buffer.
    assert!(tracker.on_release(first_id));
    assert_eq!(tracker.is_released(first_id), Some(true));
    // Resizing back to the first size reuses the released buffer.
    let (_, w, h, third) = commit_flow(&mut life, &mut tracker, 3, 320, 240);
    assert_eq!((w, h), (320, 240));
    assert_eq!(third, BufferDecision::Reuse { id: first_id });
    assert_eq!(tracker.total_count(), 2);
    // The replaced second buffer is still retained unreleased.
    assert_eq!(tracker.is_released(second_id), Some(false));
    assert_eq!(tracker.retained_unreleased_count(), 1);
    // Unknown release ids never claim success.
    assert!(!tracker.on_release(999_999));
    // Duplicate serials dedup and must not allocate or change current.
    assert_eq!(
        life.on_configure(3, 320, 240, 0).expect("dup"),
        ConfigureAction::DuplicateAck { serial: 3 }
    );
    assert_eq!(tracker.total_count(), 2);
}

#[test]
fn invalid_sizes_reject_without_commit() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    commit_flow(&mut life, &mut tracker, 1, 320, 240);
    let before = tracker.total_count();
    // Negative, excessive, and overflow sizes never ack and never allocate.
    assert!(life.on_configure(2, -1, 240, 0).is_err());
    assert!(life.on_configure(3, 5000, 5000, 0).is_err());
    assert!(life.on_configure(4, i32::MAX, 2, 0).is_err());
    assert!(tracker.request(-1, 240).is_err());
    assert!(tracker.request(5000, 5000).is_err());
    assert!(tracker.request(i32::MAX, 2).is_err());
    assert_eq!(tracker.total_count(), before);
    // Max bound still commits.
    let (_, w, h, decision) = commit_flow(&mut life, &mut tracker, 5, 2048, 2048);
    assert_eq!((w, h), (2048, 2048));
    assert!(matches!(decision, BufferDecision::Allocate { .. }));
}

#[test]
fn close_is_terminal_for_configures() {
    let mut life = DiagLifecycle::new();
    let mut tracker = DiagBufferTracker::new();
    commit_flow(&mut life, &mut tracker, 1, 320, 240);
    life.on_close().expect("close");
    assert!(life.is_closed());
    assert!(life.on_configure(2, 640, 480, 0).is_err());
    assert!(life.on_first_map().is_err());
    // Cleanup model: every held id is known for destruction at termination.
    assert_eq!(tracker.all_ids().len(), tracker.total_count());
}

#[test]
fn manifest_route_is_bounded_and_validated() {
    let text =
        "runtime=/tmp/poc3-wd/runtime\nsocket=nested-poc3\nslot=3\ndiag=/tmp/poc3-wd/diag.log\n";
    let cfg = parse_manifest_text(text, 1000, &clean).expect("manifest");
    assert_eq!(cfg.slot, 3);
    let big = "x".repeat(MAX_MANIFEST_BYTES + 1);
    assert_eq!(
        parse_manifest_text(&big, 1000, &clean).unwrap_err(),
        CliError::ManifestTooLarge
    );
    assert!(parse_manifest_text("runtime=/tmp/poc3-wd/runtime\n", 1000, &clean).is_err());
    let dup = "runtime=/tmp/poc3-wd/runtime\nruntime=/tmp/poc3-wd/runtime\nsocket=nested-poc3\nslot=1\ndiag=/tmp/poc3-wd/diag.log\n";
    assert!(parse_manifest_text(dup, 1000, &clean).is_err());
    let host = "runtime=/run/user/1000\nsocket=nested-poc3\nslot=1\ndiag=/tmp/poc3-wd/diag.log\n";
    assert_eq!(
        parse_manifest_text(host, 1000, &clean).unwrap_err(),
        CliError::HostTarget
    );
}
