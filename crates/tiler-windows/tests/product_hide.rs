use tiler_windows::model::{
    LEDGER_SCHEMA_VERSION, ProcessIdentity, RecoveryLedger, WindowClaimKind, WindowIdentity,
    generate_claim_tag, parse_ledger, valid_claim_tag, validate_ledger, watcher_may_restore,
};
use tiler_windows::product_hide::{
    ProductTeardown, committed_has_same_claim, parse_watcher_ready, product_claim,
    render_watcher_ready, shell_class_excluded, teardown_keep_ledger, watcher_ready_filename,
};

fn owner() -> ProcessIdentity {
    ProcessIdentity {
        pid: 100,
        process_creation: "0123456789abcdef".to_owned(),
        user_sid: "S-owner".to_owned(),
        session_id: 1,
        exe_path: "C:\\tools\\tiler-windows.exe".to_owned(),
    }
}

fn product_window() -> WindowIdentity {
    WindowIdentity {
        hwnd: 0xBEEF,
        process: ProcessIdentity {
            pid: 200,
            process_creation: "c-200".to_owned(),
            user_sid: "S-owner".to_owned(),
            session_id: 1,
            exe_path: "C:\\apps\\notepad.exe".to_owned(),
        },
        tag: "0123456789abcde1".to_owned(),
        kind: WindowClaimKind::Product,
    }
}

#[test]
fn nonce_format_and_generator() {
    assert!(valid_claim_tag("0123456789abcdef"));
    assert!(!valid_claim_tag(""));
    assert!(!valid_claim_tag("0000000000000000"));
    assert!(!valid_claim_tag("ABCDEF0123456789"));
    assert!(!valid_claim_tag("short"));
    for _ in 0..32 {
        let tag = generate_claim_tag(1234);
        assert!(valid_claim_tag(&tag), "generated {tag}");
    }
    let a = generate_claim_tag(42);
    let b = generate_claim_tag(42);
    assert_ne!(a, b, "per-hide nonces must differ");
}

#[test]
fn shell_exclusion_in_use() {
    assert!(shell_class_excluded("Shell_TrayWnd"));
    assert!(shell_class_excluded("Progman"));
    assert!(!shell_class_excluded("Notepad"));
}

#[test]
fn teardown_residue_rule() {
    use ProductTeardown::{AlreadyVisible, Retired, Revealed, Uncertain};
    assert!(!teardown_keep_ledger(&[]));
    assert!(!teardown_keep_ledger(&[Revealed, AlreadyVisible, Retired]));
    assert!(teardown_keep_ledger(&[Revealed, Uncertain]));
    assert!(teardown_keep_ledger(&[Uncertain]));
}

#[test]
fn watcher_binding_and_ready_format() {
    let captured = owner();
    assert!(watcher_may_restore(&captured, &captured));
    let mut replaced = captured.clone();
    replaced.process_creation = "ffffffffffffffff".to_owned();
    assert!(!watcher_may_restore(&captured, &replaced));
    let mut other_exe = captured.clone();
    other_exe.exe_path = "C:\\tools\\other.exe".to_owned();
    assert!(!watcher_may_restore(&captured, &other_exe));
    assert_eq!(watcher_ready_filename("abc"), "watcher-abc.ready");
    let rendered = render_watcher_ready("owner-hex", 4242, "watcher-hex");
    let parsed = parse_watcher_ready(&rendered).expect("roundtrip");
    assert_eq!(
        parsed,
        ("owner-hex".to_owned(), 4242, "watcher-hex".to_owned())
    );
    assert!(parse_watcher_ready("").is_none());
    assert!(parse_watcher_ready("only-owner\n").is_none());
    assert!(parse_watcher_ready("o\n0\nw\n").is_none());
    assert!(parse_watcher_ready("o\nnot-a-pid\nw\n").is_none());
    assert!(parse_watcher_ready("o\n12\n\n").is_none());
}

#[test]
fn product_claim_builder_sets_kind() {
    let claim = product_claim(0x1234, owner(), "0123456789abcde2".to_owned());
    assert_eq!(claim.kind, WindowClaimKind::Product);
    assert_eq!(claim.hwnd, 0x1234);
}

#[test]
fn orphan_cleanup_retains_only_same_hwnd_tag_claim() {
    let claim = product_window();
    // Same HWND+tag product claim retains: never cleanup.
    assert!(committed_has_same_claim(
        std::slice::from_ref(&claim),
        claim.hwnd,
        &claim.tag
    ));
    // Different tag does not retain.
    assert!(!committed_has_same_claim(
        std::slice::from_ref(&claim),
        claim.hwnd,
        "0123456789abcde9"
    ));
    // Different HWND does not retain.
    assert!(!committed_has_same_claim(
        std::slice::from_ref(&claim),
        0x1234,
        &claim.tag
    ));
    // Same HWND+tag but helper kind does not retain a product orphan.
    let mut helper = claim.clone();
    helper.kind = WindowClaimKind::Helper;
    assert!(!committed_has_same_claim(
        std::slice::from_ref(&helper),
        helper.hwnd,
        &helper.tag
    ));
    // Empty ledger never retains.
    assert!(!committed_has_same_claim(&[], claim.hwnd, &claim.tag));
}

#[test]
fn v3_roundtrip_and_older_refusal() {
    let ledger = RecoveryLedger {
        v: LEDGER_SCHEMA_VERSION,
        owner: owner(),
        windows: vec![product_window()],
        mouse_snap: None,
    };
    assert_eq!(LEDGER_SCHEMA_VERSION, 3);
    validate_ledger(&ledger).expect("v3 product ledger validates");
    let json = serde_json::to_string(&ledger).expect("json");
    assert_eq!(parse_ledger(&json).expect("parse"), ledger);
    // Empty v3 product tag cannot bind HWND reuse.
    let mut bad = ledger.clone();
    bad.windows[0].tag.clear();
    assert!(validate_ledger(&bad).is_err());
    // v2 carrying a product claim is version confusion.
    let mut confused = ledger.clone();
    confused.v = 2;
    assert!(validate_ledger(&confused).is_err());
    // v2 helper-only fixtures without `kind` still parse as helper.
    let legacy = serde_json::json!({
        "v": 2,
        "owner": owner(),
        "windows": [{"hwnd": 1, "process": {
            "pid": 200, "process_creation": "c-200", "user_sid": "S-owner",
            "session_id": 1, "exe_path": "C:\\apps\\a.exe"},
            "tag": "0123456789abcde3"}],
        "mouse_snap": null,
    });
    let parsed = parse_ledger(&legacy.to_string()).expect("legacy v2 parses");
    assert_eq!(parsed.windows[0].kind, WindowClaimKind::Helper);
}

#[test]
fn v3_product_tag_format_enforced() {
    // Non-hex, uppercase, zero, short, and empty product tags never commit.
    for bad_tag in [
        "tag-1",
        "ABCDEF0123456789",
        "0000000000000000",
        "",
        "short",
        "0123456789abcdeg",
    ] {
        let mut window = product_window();
        window.tag = bad_tag.to_owned();
        let ledger = RecoveryLedger {
            v: LEDGER_SCHEMA_VERSION,
            owner: owner(),
            windows: vec![window],
            mouse_snap: None,
        };
        assert!(
            validate_ledger(&ledger).is_err(),
            "product tag must be rejected: {bad_tag:?}"
        );
    }
    // Helper claims keep the nonempty rule on v3.
    let mut helper = product_window();
    helper.kind = WindowClaimKind::Helper;
    helper.tag = "tag-1".to_owned();
    let ledger = RecoveryLedger {
        v: LEDGER_SCHEMA_VERSION,
        owner: owner(),
        windows: vec![helper],
        mouse_snap: None,
    };
    validate_ledger(&ledger).expect("helper nonempty tag still valid on v3");
}
