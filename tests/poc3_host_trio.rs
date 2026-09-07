//! Hermetic host trio tests: scope, terminal exclusion, process identity.
//! No compositor, D-Bus, Wayland, or live processes.

use plasma_auto_tiler::poc3_diag::parse_host_args;
use plasma_auto_tiler::poc3_diag::slot_desc;
use plasma_auto_tiler::poc3_diag_supervisor::parse_host_supervisor_args;
use plasma_auto_tiler::poc3_host_trio::{
    HOST_CLIENT_BIN_NAME, HOST_SCOPE_ALIAS, HOST_SUP_BIN_NAME, HOST_TRIO_SCHEMA, HostTargetClass,
    SUPERVISOR_FALLBACK_ROLE, SupervisorFallbackLive, SupervisorFallbackRecord,
    TrioClientFallbackLive, TrioClientFallbackRecord, classify_host_target, host_expected_app_id,
    is_complete_host_receipt, is_project_diag_app_id, is_terminal_app_id,
    supervisor_exe_fallback_accept, validate_host_scope,
};
use std::collections::BTreeMap;

fn clean(_: &str) -> Option<String> {
    None
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(ToString::to_string).collect()
}

fn host_supervisor_argv() -> Vec<String> {
    argv(&[
        "poc3-diag-supervisor",
        "--host",
        "--runtime",
        "/run/user/1000",
        "--socket",
        "wayland-0",
        "--client-bin",
        "/tmp/w/poc3-diagnostic-client",
        "--client-sha256",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "--client-dev",
        "1",
        "--client-ino",
        "2",
        "--workdir",
        "/tmp/w/pilot",
    ])
}

fn host_client_argv() -> Vec<String> {
    argv(&[
        "poc3-diagnostic-client",
        "--host",
        "--runtime",
        "/run/user/1000",
        "--socket",
        "wayland-0",
        "--slot",
        "2",
        "--diag",
        "/tmp/w/host-2.diag.log",
    ])
}

fn receipt() -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("schema_version".into(), HOST_TRIO_SCHEMA.into());
    m.insert("kwin_owner".into(), ":1.10".into());
    m.insert("kwin_pid".into(), "4242".into());
    m.insert("kwin_start_tick".into(), "424200".into());
    m.insert("kwin_exe".into(), "/nix/store/x/bin/kwin_wayland".into());
    m.insert("scope_workspace".into(), "ws-1".into());
    m.insert("scope_output".into(), "out-1".into());
    m.insert("scope_alias".into(), HOST_SCOPE_ALIAS.into());
    m.insert("supervisor_pid".into(), "5000".into());
    m.insert("supervisor_start_tick".into(), "500000".into());
    m.insert(
        "supervisor_exe".into(),
        "/tmp/w/poc3-diag-supervisor".into(),
    );
    m.insert(
        "supervisor_bin".into(),
        "/tmp/w/poc3-diag-supervisor".into(),
    );
    m.insert(
        "supervisor_bin_canonical".into(),
        "/tmp/w/poc3-diag-supervisor".into(),
    );
    m.insert(
        "supervisor_bin_sha256".into(),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
    );
    m.insert(
        "supervisor_diag_path".into(),
        "/tmp/w/diag-supervisor.log".into(),
    );
    for slot in 1..=3u8 {
        m.insert(
            format!("client_{slot}_pid"),
            (6000 + slot as u32).to_string(),
        );
        m.insert(
            format!("client_{slot}_start_tick"),
            (600000 + slot as u32).to_string(),
        );
        m.insert(
            format!("client_{slot}_exe"),
            "/tmp/w/poc3-diagnostic-client".into(),
        );
        m.insert(
            format!("client_{slot}_bin"),
            "/tmp/w/poc3-diagnostic-client".into(),
        );
        m.insert(
            format!("client_{slot}_bin_sha256"),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
        );
        m.insert(
            format!("client_{slot}_app_id"),
            host_expected_app_id(slot).unwrap().to_owned(),
        );
        m.insert(format!("client_{slot}_slot"), slot.to_string());
    }
    m
}

#[test]
fn host_scope_binds_exactly_one_workspace_and_output() {
    assert!(validate_host_scope("ws-1", "out-1"));
    assert!(!validate_host_scope("", "out-1"));
    assert!(!validate_host_scope("ws-1", ""));
    assert!(!validate_host_scope("nested-0", "out-1"));
    assert_eq!(HOST_SCOPE_ALIAS, "scope-1");
    assert_eq!(HOST_TRIO_SCHEMA, "poc3-host-trio-v1");
}

#[test]
fn terminal_windows_never_enroll() {
    for t in [
        "org.kde.konsole",
        "konsole",
        "xterm",
        "Alacritty",
        "foot",
        "kitty",
    ] {
        assert!(is_terminal_app_id(t), "{t}");
        assert!(!is_project_diag_app_id(t), "{t}");
    }
    for slot in 1..=3u8 {
        let app = host_expected_app_id(slot).expect("slot");
        assert!(!is_terminal_app_id(app));
        assert!(is_project_diag_app_id(app));
        assert_eq!(slot_desc(slot).expect("desc").app_id, app);
    }
    let mut bad = receipt();
    bad.insert("client_2_app_id".into(), "org.kde.konsole".into());
    assert!(!is_complete_host_receipt(&bad, &[]));
}

#[test]
fn wrong_scope_and_identity_refused() {
    assert!(is_complete_host_receipt(&receipt(), &[]));
    let mut bad = receipt();
    bad.insert("scope_workspace".into(), "nested-0".into());
    assert!(!is_complete_host_receipt(&bad, &[]));
    let mut bad = receipt();
    bad.insert("client_2_pid".into(), "6001".into());
    assert!(!is_complete_host_receipt(&bad, &[]));
    let mut bad = receipt();
    bad.insert("client_1_pid".into(), "5000".into());
    assert!(!is_complete_host_receipt(&bad, &[]));
    assert!(!is_complete_host_receipt(&receipt(), &[6001]));
    assert!(!is_complete_host_receipt(&receipt(), &[5000]));
}

#[test]
fn host_target_classification() {
    assert_eq!(
        classify_host_target("/run/user/1000", "wayland-0", 1000),
        HostTargetClass::Host
    );
    assert_eq!(
        classify_host_target("/tmp/w/runtime", "nested-kwin-spike", 1000),
        HostTargetClass::Nested
    );
    assert_eq!(
        classify_host_target("", "wayland-0", 1000),
        HostTargetClass::Incorrect
    );
}

#[test]
fn host_supervisor_and_client_parsers_require_host_scope() {
    assert!(parse_host_supervisor_args(&host_supervisor_argv(), 1000, &clean).is_ok());
    let mut nested = host_supervisor_argv();
    nested[4] = "/tmp/w/runtime".to_owned();
    assert!(parse_host_supervisor_args(&nested, 1000, &clean).is_err());
    let mut nested_sock = host_supervisor_argv();
    nested_sock[6] = "nested-kwin-spike".to_owned();
    assert!(parse_host_supervisor_args(&nested_sock, 1000, &clean).is_err());
    let ambient = |k: &str| match k {
        "WAYLAND_DISPLAY" => Some("wayland-0".to_owned()),
        _ => None,
    };
    assert!(parse_host_supervisor_args(&host_supervisor_argv(), 1000, &ambient).is_err());
    assert!(parse_host_args(&host_client_argv(), 1000, &clean).is_ok());
    let mut bad_slot = host_client_argv();
    bad_slot[8] = "9".to_owned();
    assert!(parse_host_args(&bad_slot, 1000, &clean).is_err());
}

fn fallback_sup_record() -> SupervisorFallbackRecord {
    SupervisorFallbackRecord {
        role: SUPERVISOR_FALLBACK_ROLE.to_owned(),
        pid: 5000,
        start_tick: 500_000,
        exe_canonical: format!("/tmp/w/{HOST_SUP_BIN_NAME}"),
        bin_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_owned(),
        bin_dev: 1,
        bin_ino: 2,
        boot_id: "12345678-1234-1234-1234-123456789abc".to_owned(),
        ppid: 100,
        service: None,
        cwd: "/tmp/w/pilot".to_owned(),
        runtime_dir: "/run/user/1000/plasma-auto-tiler-host-pilot".to_owned(),
        uid: 1000,
    }
}

fn fallback_sup_live() -> SupervisorFallbackLive {
    SupervisorFallbackLive {
        role: SUPERVISOR_FALLBACK_ROLE.to_owned(),
        pid: 5000,
        start_tick: 500_000,
        exe_readable: false,
        boot_id: "12345678-1234-1234-1234-123456789abc".to_owned(),
        ppid: 100,
        service: None,
        cwd: "/tmp/w/pilot".to_owned(),
        runtime_dir: "/run/user/1000/plasma-auto-tiler-host-pilot".to_owned(),
        uid: 1000,
        zombie: false,
    }
}

fn fallback_client_record(slot: u8) -> TrioClientFallbackRecord {
    TrioClientFallbackRecord {
        pid: 6000 + u32::from(slot),
        start_tick: 600_000 + u64::from(slot),
        exe_canonical: format!("/tmp/w/{HOST_CLIENT_BIN_NAME}"),
        bin_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_owned(),
        bin_dev: 1,
        bin_ino: 10 + u64::from(slot),
        app_id: host_expected_app_id(slot).unwrap().to_owned(),
        slot,
        ppid: 5000,
        uid: 1000,
    }
}

fn fallback_client_live(slot: u8) -> TrioClientFallbackLive {
    let rec = fallback_client_record(slot);
    TrioClientFallbackLive {
        pid: rec.pid,
        start_tick: rec.start_tick,
        exe_canonical: rec.exe_canonical.clone(),
        bin_sha256: rec.bin_sha256.clone(),
        bin_dev: rec.bin_dev,
        bin_ino: rec.bin_ino,
        app_id: rec.app_id.clone(),
        slot: rec.slot,
        ppid: rec.ppid,
        uid: rec.uid,
        exe_readable: true,
        zombie: false,
    }
}

fn fallback_accept() -> bool {
    let sup_rec = fallback_sup_record();
    let sup_live = fallback_sup_live();
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let l2 = fallback_client_live(2);
    let l3 = fallback_client_live(3);
    supervisor_exe_fallback_accept(&sup_rec, &sup_live, [&r1, &r2, &r3], [&l1, &l2, &l3])
}

#[test]
fn supervisor_fallback_accepts_valid_unreadable_with_exact_trio() {
    assert!(fallback_accept());
}

#[test]
fn supervisor_fallback_rejects_readable_disagreement() {
    let sup_rec = fallback_sup_record();
    let mut sup_live = fallback_sup_live();
    sup_live.exe_readable = true;
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let l2 = fallback_client_live(2);
    let l3 = fallback_client_live(3);
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &l3]
    ));
}

#[test]
fn supervisor_fallback_rejects_tick_parent_cwd_runtime_drift() {
    // Tick drift.
    let sup_rec = fallback_sup_record();
    let mut live = fallback_sup_live();
    live.start_tick = 500_001;
    let r = [
        fallback_client_record(1),
        fallback_client_record(2),
        fallback_client_record(3),
    ];
    let l = [
        fallback_client_live(1),
        fallback_client_live(2),
        fallback_client_live(3),
    ];
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &live,
        [&r[0], &r[1], &r[2]],
        [&l[0], &l[1], &l[2]]
    ));
    // Parent drift with no service cover.
    let mut live = fallback_sup_live();
    live.ppid = 999;
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &live,
        [&r[0], &r[1], &r[2]],
        [&l[0], &l[1], &l[2]]
    ));
    // Service cover accepts when parent drifts but the recorded service binds.
    let mut rec_svc = fallback_sup_record();
    rec_svc.service = Some("plasma-pilot-sup.scope".to_owned());
    let mut live_svc = fallback_sup_live();
    live_svc.ppid = 999;
    live_svc.service = Some("plasma-pilot-sup.scope".to_owned());
    assert!(supervisor_exe_fallback_accept(
        &rec_svc,
        &live_svc,
        [&r[0], &r[1], &r[2]],
        [&l[0], &l[1], &l[2]]
    ));
    // Cwd drift.
    let mut live = fallback_sup_live();
    live.cwd = "/tmp/w/other".to_owned();
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &live,
        [&r[0], &r[1], &r[2]],
        [&l[0], &l[1], &l[2]]
    ));
    // Runtime namespace drift.
    let mut live = fallback_sup_live();
    live.runtime_dir = "/run/user/1000/other".to_owned();
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &live,
        [&r[0], &r[1], &r[2]],
        [&l[0], &l[1], &l[2]]
    ));
    // Boot ID drift.
    let mut live = fallback_sup_live();
    live.boot_id = "aaaaaaaa-1234-1234-1234-123456789abc".to_owned();
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &live,
        [&r[0], &r[1], &r[2]],
        [&l[0], &l[1], &l[2]]
    ));
}

#[test]
fn supervisor_fallback_rejects_missing_or_wrong_client() {
    let sup_rec = fallback_sup_record();
    let sup_live = fallback_sup_live();
    // Wrong app_id (terminal leakage).
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let mut l2 = fallback_client_live(2);
    l2.app_id = "org.kde.konsole".to_owned();
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &l3_fallback_client_live_3()]
    ));
    // Unreadable client.
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let mut l2 = fallback_client_live(2);
    l2.exe_readable = false;
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &fallback_client_live(3)]
    ));
    // Client exe mismatch.
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let mut l2 = fallback_client_live(2);
    l2.exe_canonical = "/tmp/w/konsole".to_owned();
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &fallback_client_live(3)]
    ));
    // Client parent drift (not a supervisor child).
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let mut l2 = fallback_client_live(2);
    l2.ppid = 999;
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &fallback_client_live(3)]
    ));
}

fn l3_fallback_client_live_3() -> TrioClientFallbackLive {
    fallback_client_live(3)
}

#[test]
fn supervisor_fallback_rejects_zombie() {
    let sup_rec = fallback_sup_record();
    let mut sup_live = fallback_sup_live();
    sup_live.zombie = true;
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let l2 = fallback_client_live(2);
    let l3 = fallback_client_live(3);
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &l3]
    ));
    // Zombie client also fails closed.
    let sup_live = fallback_sup_live();
    let mut l2 = fallback_client_live(2);
    l2.zombie = true;
    assert!(!supervisor_exe_fallback_accept(
        &sup_rec,
        &sup_live,
        [&r1, &r2, &r3],
        [&l1, &l2, &l3]
    ));
}

#[test]
fn supervisor_fallback_rejects_scope_leakage() {
    let sup_rec = fallback_sup_record();
    let sup_live = fallback_sup_live();
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let l2 = fallback_client_live(2);
    let l3 = fallback_client_live(3);
    for role in ["kwin", "planner", "client", "production", ""] {
        let mut rec = sup_rec.clone();
        rec.role = role.to_owned();
        assert!(
            !supervisor_exe_fallback_accept(&rec, &sup_live, [&r1, &r2, &r3], [&l1, &l2, &l3]),
            "record role {role} must not enter fallback"
        );
        let mut live = sup_live.clone();
        live.role = role.to_owned();
        assert!(
            !supervisor_exe_fallback_accept(&sup_rec, &live, [&r1, &r2, &r3], [&l1, &l2, &l3]),
            "live role {role} must not enter fallback"
        );
    }
}

#[test]
fn supervisor_fallback_rejects_missing_supervisor_dev() {
    let sup_live = fallback_sup_live();
    let r1 = fallback_client_record(1);
    let r2 = fallback_client_record(2);
    let r3 = fallback_client_record(3);
    let l1 = fallback_client_live(1);
    let l2 = fallback_client_live(2);
    let l3 = fallback_client_live(3);
    let mut rec = fallback_sup_record();
    rec.bin_dev = 0;
    assert!(
        !supervisor_exe_fallback_accept(&rec, &sup_live, [&r1, &r2, &r3], [&l1, &l2, &l3]),
        "supervisor bin_dev 0 must fail closed"
    );
}
