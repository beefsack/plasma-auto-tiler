//! Static POC3 persistent direct-enrollment evidence contract (no live I/O).
//!
//! Pins the exact per-slot diagnostic evidence (PID-ordered slot/app_id/
//! color/marker distinctness) and the private planner D-Bus expectations that
//! the generated adapter bundle must embed. No compositor, D-Bus, or process
//! access: pure constants and contract identity only.

use plasma_auto_tiler::planner_service::{ADVISORY_METHOD, INTERFACE, METHOD, OBJECT, SERVICE};
use plasma_auto_tiler::poc3_diag::slot_desc;

#[test]
fn persistent_slots_are_exactly_three_distinct_bound_identities() {
    let mut titles = std::collections::BTreeSet::new();
    let mut app_ids = std::collections::BTreeSet::new();
    let mut colors = std::collections::BTreeSet::new();
    let mut markers = std::collections::BTreeSet::new();
    for slot in 1..=3u8 {
        let desc = slot_desc(slot).expect("slot 1..=3 exists");
        assert_eq!(desc.slot, slot);
        assert!(titles.insert(desc.title), "titles distinct");
        assert!(app_ids.insert(desc.app_id), "app_ids distinct");
        assert!(colors.insert(desc.argb), "colors distinct");
        assert!(markers.insert(desc.marker), "markers distinct");
    }
    assert!(slot_desc(0).is_none());
    assert!(slot_desc(4).is_none());
}

#[test]
fn persistent_slot_evidence_matches_kwin_adapter_allowlist() {
    let d1 = slot_desc(1).unwrap();
    let d2 = slot_desc(2).unwrap();
    let d3 = slot_desc(3).unwrap();
    assert_eq!(d1.app_id, "org.plasma-auto-tiler.poc3-diag-1");
    assert_eq!(d2.app_id, "org.plasma-auto-tiler.poc3-diag-2");
    assert_eq!(d3.app_id, "org.plasma-auto-tiler.poc3-diag-3");
    assert_eq!(d1.title, "poc3-diag-1");
    assert_eq!(d2.title, "poc3-diag-2");
    assert_eq!(d3.title, "poc3-diag-3");
    assert_eq!(format!("{:08x}", d1.argb), "ffc02020");
    assert_eq!(format!("{:08x}", d2.argb), "ff20a020");
    assert_eq!(format!("{:08x}", d3.argb), "ff2040c0");
}

#[test]
fn planner_contract_replaces_poc3_with_read_only_advisory_method() {
    assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
    assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
    assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
    assert_eq!(ADVISORY_METHOD, "DescribeAdvisoryPlan");
    assert_eq!(METHOD, "EvaluateMove");
    assert_ne!(METHOD, ADVISORY_METHOD);
}
