//! Byte-locked offline host-pilot fixture.
//!
//! The checked-in `test-fixtures/poc3-host-pilot-v1.json` is the
//! Rust-authoritative export of exactly three offline actions derived from
//! the verified `poc3::Poc3Engine` (no duplicated policy): start
//! `H[A,V[B,C]]` focused `A`, focus right to `B` preserving
//! topology/shares, and structural down swap to `H[A,V[C,B]]` with focus
//! `B`. This test byte-locks the fixture and checks the exact expected
//! transition triples against a fresh engine-derived value.

use plasma_auto_tiler::poc3_host_pilot::{
    HOST_PILOT_FIXTURE_LEN, HOST_PILOT_FIXTURE_SHA256, HOST_PILOT_SCHEMA, HOST_PILOT_VERSION,
    HostPilotFixture, host_pilot_fixture,
};
use sha2::{Digest, Sha256};

const FIXTURE: &str = include_str!("../test-fixtures/poc3-host-pilot-v1.json");
const FIXTURE_LEN: usize = HOST_PILOT_FIXTURE_LEN;
const FIXTURE_SHA256: &str = HOST_PILOT_FIXTURE_SHA256;

fn sha256_hex(bytes: &str) -> String {
    let digest = Sha256::digest(bytes.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

fn rect_of(fixture: &HostPilotFixture, step: usize, id: &str) -> (i32, i32, i32, i32) {
    let found = fixture.steps[step]
        .desired
        .iter()
        .find(|w| w.id == id)
        .unwrap_or_else(|| panic!("step {step} desires {id}"));
    (found.rect.x, found.rect.y, found.rect.w, found.rect.h)
}

#[test]
fn host_pilot_fixture_bytes_are_locked() {
    assert_eq!(FIXTURE.len(), FIXTURE_LEN, "byte lock");
    assert_eq!(sha256_hex(FIXTURE), FIXTURE_SHA256, "sha256 lock");
}

#[test]
fn host_pilot_fixture_matches_engine_derived_triples() {
    let expected = host_pilot_fixture();
    let parsed: HostPilotFixture =
        serde_json::from_str(FIXTURE).expect("fixture parses as HostPilotFixture");
    assert_eq!(parsed, expected, "fixture equals fresh engine export");

    assert_eq!(parsed.schema, HOST_PILOT_SCHEMA);
    assert_eq!(parsed.v, HOST_PILOT_VERSION);
    assert_eq!(parsed.engine, "poc3");
    assert_eq!(parsed.scope, "scope-1");
    assert_eq!(parsed.windows, vec!["A", "B", "C"]);
    assert_eq!(parsed.steps.len(), 3);

    let start = &parsed.steps[0];
    assert_eq!(start.action, "start");
    assert_eq!((start.base_revision, start.next_revision), (0, 1));
    assert_eq!(start.operation.kind, "init");
    assert_eq!(start.operation.rule, "INIT");
    assert_eq!(start.operation.target, None);
    assert_eq!(start.operation.neighbor, None);
    assert_eq!(
        start.preconditions,
        vec![
            "session-owner-pinned",
            "revision-match",
            "adapter-asserted-eligibility",
            "adapter-must-verify-postconditions",
        ]
    );
    assert_eq!(start.topology, "H[A,V[B,C]]");
    assert_eq!(start.focus, "A");
    assert_eq!(rect_of(&parsed, 0, "A"), (0, 0, 446, 600));
    assert_eq!(rect_of(&parsed, 0, "B"), (454, 0, 446, 296));
    assert_eq!(rect_of(&parsed, 0, "C"), (454, 304, 446, 296));

    let focus = &parsed.steps[1];
    assert_eq!(focus.action, "focus");
    assert_eq!(focus.direction.as_deref(), Some("right"));
    assert_eq!((focus.base_revision, focus.next_revision), (1, 2));
    assert_eq!(focus.operation.kind, "focus");
    assert_eq!(focus.operation.rule, "FOCUS");
    assert_eq!(focus.operation.target.as_deref(), Some("B"));
    assert_eq!(focus.operation.neighbor, None);
    assert_eq!(
        focus.preconditions,
        vec![
            "session-active",
            "owner-pinned",
            "revision-match",
            "focus-target-occupied",
            "adapter-must-verify-postconditions",
        ]
    );
    assert_eq!(focus.topology, "H[A,V[B,C]]");
    assert_eq!(focus.shares, start.shares, "focus preserves shares");
    assert_eq!(focus.focus, "B");
    assert_eq!(focus.desired, start.desired, "focus preserves geometry");

    let moved = &parsed.steps[2];
    assert_eq!(moved.action, "move");
    assert_eq!(moved.direction.as_deref(), Some("down"));
    assert_eq!((moved.base_revision, moved.next_revision), (2, 3));
    assert_eq!(moved.operation.kind, "swap");
    assert_eq!(moved.operation.rule, "R2a");
    assert_eq!(moved.operation.target.as_deref(), Some("C"));
    assert_eq!(moved.operation.neighbor.as_deref(), Some("B"));
    assert_eq!(
        moved.preconditions,
        vec![
            "session-active",
            "owner-pinned",
            "revision-match",
            "move-membership-verified",
            "adapter-must-verify-postconditions",
        ]
    );
    assert_eq!(moved.topology, "H[A,V[C,B]]");
    assert_eq!(moved.focus, "B");
    assert_ne!(moved.topology, focus.topology, "move visibly restructures");
    assert_eq!(rect_of(&parsed, 2, "A"), (0, 0, 446, 600));
    assert_eq!(rect_of(&parsed, 2, "C"), (454, 0, 446, 296));
    assert_eq!(rect_of(&parsed, 2, "B"), (454, 304, 446, 296));

    assert_eq!(parsed.final_state.revision, 3);
    assert_eq!(parsed.final_state.topology, "H[A,V[C,B]]");
    assert_eq!(parsed.final_state.focus, "B");
}
