//! Static tests for the resident diagnostic supervisor staging mechanism.
//! No compositor, no live KWin/Wayland/D-Bus. Pure CLI/path/readiness plus
//! bounded binary arg validation (binary exits before any spawn on bad input).

use plasma_auto_tiler::poc3_diag::parse_host_args;
use plasma_auto_tiler::poc3_diag::slot_desc;
use plasma_auto_tiler::poc3_diag_supervisor::{
    EXPECTED_CLIENT_ARGC, EXPECTED_HOST_CLIENT_ARGC, SupEvent, all_ready, client_argv,
    client_diag_path, client_stderr_path, diag_contains_first_map, fds_to_close, format_sup_event,
    host_client_argv, host_client_diag_path, host_client_stderr_path, is_complete_supervisor_group,
    parse_pidfile, parse_supervisor_args, should_preserve_fd, supervisor_diag_path,
    supervisor_manifest_keys, supervisor_pidfile_path, supervisor_ready_path,
};
use std::collections::BTreeMap;

fn clean(_: &str) -> Option<String> {
    None
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(ToString::to_string).collect()
}

fn valid() -> Vec<String> {
    argv(&[
        "poc3-diag-supervisor",
        "--runtime",
        "/tmp/poc3-wd/runtime",
        "--socket",
        "nested-poc3",
        "--client-bin",
        "/tmp/poc3-wd/poc3-diagnostic-client",
        "--client-sha256",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "--client-dev",
        "1",
        "--client-ino",
        "2",
        "--workdir",
        "/tmp/poc3-wd",
    ])
}

#[test]
fn three_distinct_windows_and_records() {
    let (a, b, c) = (
        slot_desc(1).expect("1"),
        slot_desc(2).expect("2"),
        slot_desc(3).expect("3"),
    );
    assert!(a.title != b.title && b.title != c.title);
    assert!(a.app_id != b.app_id && b.app_id != c.app_id);
    assert!(a.argb != b.argb && b.argb != c.argb);
    let d1 = client_diag_path("/tmp/w", 1).expect("d1");
    let d2 = client_diag_path("/tmp/w", 2).expect("d2");
    let d3 = client_diag_path("/tmp/w", 3).expect("d3");
    assert!(d1 != d2 && d2 != d3);
    let v1 = client_argv("BIN", "/tmp/w/runtime", "nested-0", 1, &d1).expect("v1");
    let v2 = client_argv("BIN", "/tmp/w/runtime", "nested-0", 2, &d2).expect("v2");
    let v3 = client_argv("BIN", "/tmp/w/runtime", "nested-0", 3, &d3).expect("v3");
    assert_eq!(v1.len(), EXPECTED_CLIENT_ARGC);
    assert!(v1 != v2 && v2 != v3);
    assert!(v1.contains(&"1".to_owned()));
    assert!(v2.contains(&"2".to_owned()));
}

#[test]
fn readiness_requires_all_first_maps() {
    assert!(!all_ready([false, false, false]));
    assert!(!all_ready([true, true, false]));
    assert!(all_ready([true, true, true]));
    assert!(diag_contains_first_map(r#"{"seq":1,"event":"first-map"}"#));
    assert!(!diag_contains_first_map(r#"{"seq":1,"event":"configure"}"#));
    assert!(!diag_contains_first_map(""));
}

#[test]
fn early_slot_failure_and_supervisor_loss_are_terminal_kinds() {
    assert!(format_sup_event(1, &SupEvent::ProtocolError { kind: "early-exit" }).is_some());
    assert!(format_sup_event(1, &SupEvent::ProtocolError { kind: "timeout" }).is_some());
    assert!(
        format_sup_event(
            1,
            &SupEvent::Exit {
                reason: "protocol-error"
            }
        )
        .is_some()
    );
    assert!(format_sup_event(1, &SupEvent::Exit { reason: "bogus" }).is_none());
    // Supervisor loss is observed by the stager as missing ready/pid-file;
    // the pid-file parser rejects anything but three distinct PIDs.
    assert_eq!(
        parse_pidfile("slot-1=10\nslot-2=20\nslot-3=30\n"),
        Some([10, 20, 30])
    );
    assert_eq!(parse_pidfile("slot-1=10\nslot-2=20\n"), None);
}

#[test]
fn pid_reuse_is_rejected_by_distinct_pidfile() {
    assert_eq!(parse_pidfile("slot-1=99\nslot-2=99\nslot-3=100\n"), None);
    assert_eq!(parse_pidfile("slot-1=0\nslot-2=20\nslot-3=30\n"), None);
}

#[test]
fn inherited_fd_closure_preserves_only_standard_descriptors() {
    assert!(should_preserve_fd(0) && should_preserve_fd(1) && should_preserve_fd(2));
    assert!(!should_preserve_fd(3) && !should_preserve_fd(9));
    assert_eq!(fds_to_close(&[0, 1, 2, 3, 4, 9]), vec![3, 4, 9]);
    assert!(fds_to_close(&[0, 1, 2]).is_empty());
}

#[test]
fn manifest_tampering_fails_completeness() {
    let mut m = BTreeMap::new();
    assert!(!is_complete_supervisor_group(&m));
    for k in supervisor_manifest_keys() {
        m.insert(k.to_owned(), "v".to_owned());
    }
    assert!(is_complete_supervisor_group(&m));
    m.insert("diag_supervisor_pid".to_owned(), String::new());
    assert!(!is_complete_supervisor_group(&m));
}

#[test]
fn supervisor_owned_paths_are_bounded_direct_children() {
    assert_eq!(supervisor_diag_path("/tmp/w"), "/tmp/w/diag-supervisor.log");
    assert_eq!(supervisor_ready_path("/tmp/w"), "/tmp/w/diag-trio.ready");
    assert_eq!(supervisor_pidfile_path("/tmp/w"), "/tmp/w/diag-trio.pids");
}

#[test]
fn supervisor_cli_rejects_bad_targets() {
    assert!(parse_supervisor_args(&valid(), 1000, &clean).is_ok());
    let mut host = valid();
    host[2] = "/run/user/1000".to_owned();
    assert!(parse_supervisor_args(&host, 1000, &clean).is_err());
    let mut def = valid();
    def[4] = "wayland-0".to_owned();
    assert!(parse_supervisor_args(&def, 1000, &clean).is_err());
    let ambient = |k: &str| match k {
        "WAYLAND_DISPLAY" => Some("wayland-0".to_owned()),
        _ => None,
    };
    assert!(parse_supervisor_args(&valid(), 1000, &ambient).is_err());
}

#[test]
fn unbound_direct_spawn_without_identity_is_rejected() {
    use plasma_auto_tiler::poc3_diag_supervisor::SupCliError;
    let unbound = argv(&[
        "poc3-diag-supervisor",
        "--runtime",
        "/tmp/poc3-wd/runtime",
        "--socket",
        "nested-poc3",
        "--client-bin",
        "/tmp/poc3-wd/poc3-diagnostic-client",
        "--workdir",
        "/tmp/poc3-wd",
    ]);
    assert_eq!(
        parse_supervisor_args(&unbound, 1000, &clean).unwrap_err(),
        SupCliError::MissingArg
    );
}

#[test]
fn nested_client_argv_and_paths_are_unchanged() {
    for slot in 1..=3u8 {
        let diag = client_diag_path("/tmp/w", slot).expect("diag");
        assert_eq!(diag, format!("/tmp/w/manual-{slot}.diag.log"));
        let stderr = client_stderr_path("/tmp/w", slot).expect("stderr");
        assert_eq!(stderr, format!("/tmp/w/manual-{slot}.stderr"));
        let v = client_argv("BIN", "/tmp/w/runtime", "nested-0", slot, &diag).expect("argv");
        assert_eq!(v.len(), EXPECTED_CLIENT_ARGC);
        assert!(!v.iter().any(|a| a == "--host"));
    }
    assert!(client_diag_path("/tmp/w", 0).is_none());
    assert!(client_diag_path("/tmp/w", 4).is_none());
    assert!(client_stderr_path("/tmp/w", 0).is_none());
    assert!(client_argv("BIN", "/tmp/w/runtime", "nested-0", 9, "/tmp/w/d").is_none());
}

#[test]
fn host_client_argv_carries_exactly_one_host_and_host_paths() {
    for slot in 1..=3u8 {
        let diag = host_client_diag_path("/tmp/w", slot).expect("diag");
        assert_eq!(diag, format!("/tmp/w/host-{slot}.diag.log"));
        let stderr = host_client_stderr_path("/tmp/w", slot).expect("stderr");
        assert_eq!(stderr, format!("/tmp/w/host-{slot}.stderr"));
        let v = host_client_argv("BIN", "/run/user/1000", "wayland-0", slot, &diag).expect("argv");
        assert_eq!(v.len(), EXPECTED_HOST_CLIENT_ARGC);
        assert_eq!(v.iter().filter(|a| a.as_str() == "--host").count(), 1);
        assert!(v.contains(&"/run/user/1000".to_owned()));
        assert!(v.contains(&"wayland-0".to_owned()));
        assert!(v.contains(&slot.to_string()));
        assert!(v.contains(&diag));
        let cfg = parse_host_args(&v, 1000, &clean).expect("host parse");
        assert_eq!(cfg.slot, slot);
        assert_eq!(cfg.diag_path, diag);
    }
    assert!(host_client_diag_path("/tmp/w", 0).is_none());
    assert!(host_client_diag_path("/tmp/w", 4).is_none());
    assert!(host_client_stderr_path("/tmp/w", 0).is_none());
    assert!(host_client_argv("BIN", "/run/user/1000", "wayland-0", 9, "/tmp/w/d").is_none());
    // Nested argv never gains the host flag.
    let nested = client_argv(
        "BIN",
        "/tmp/w/runtime",
        "nested-0",
        1,
        "/tmp/w/manual-1.diag.log",
    )
    .expect("nested");
    assert_eq!(nested.len(), EXPECTED_CLIENT_ARGC);
    assert!(!nested.iter().any(|a| a == "--host"));
}

#[test]
fn enumeration_fd_is_never_a_close_target() {
    use plasma_auto_tiler::poc3_diag_supervisor::is_proc_fd_enumeration_target;
    assert!(is_proc_fd_enumeration_target("/proc/self/fd", 42));
    assert!(is_proc_fd_enumeration_target("/proc/42/fd", 42));
    assert!(!is_proc_fd_enumeration_target("/dev/null", 42));
}
