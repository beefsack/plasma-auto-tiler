//! Stage 3 checked-in trace fixture lock.
//!
//! Locks the exact checked-in repository bytes of the eight
//! `test-fixtures/trace-v1-*.json` fixtures (explicit length + SHA-256 digest
//! constants, POC1 fixture-lock style) and locks their semantic replay
//! output: each fixture is replayed through `trace::replay_trace_json`,
//! asserted against hard-coded state/diagnostic/revision values that are
//! independent of the fixture `expected` block, and only then checked for
//! agreement with that `expected` block. Any semantic fixture change requires
//! an intentional plan/terminal assertion and lock-constant update here.
//!
//! Scope: this locks checked-in repository fixture bytes and semantic replay
//! output only. It does not assert anything about arbitrary serde
//! serialization ordering or cross-platform byte portability.

use plasma_auto_tiler::trace::{
    DiagnosticClass, TerminalState, parse_trace_json, replay_trace_json,
};
use sha2::{Digest, Sha256};

struct FixtureCase {
    name: &'static str,
    bytes: &'static str,
    len: usize,
    sha256: &'static str,
    state: TerminalState,
    diagnostic: DiagnosticClass,
    revision: u64,
    commit_revision: Option<u64>,
}

fn sha256_hex(bytes: &str) -> String {
    let digest = Sha256::digest(bytes.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

const SUCCESS_NESTED_NARY: &str =
    include_str!("../test-fixtures/trace-v1-success-nested-nary.json");
const SUCCESS_NESTED_NARY_LEN: usize = 3593;
const SUCCESS_NESTED_NARY_SHA256: &str =
    "3e9e269b930d18e471b8551fb98d08f993ed6499fd3eec34f1a6bbbb2e5f26a0";

const STALE_OBSERVATION: &str = include_str!("../test-fixtures/trace-v1-stale-observation.json");
const STALE_OBSERVATION_LEN: usize = 2111;
const STALE_OBSERVATION_SHA256: &str =
    "71690277f97c013dbdb14873f4852cc08225140c97855b6f6b4fd3d6408fc0b9";

const PARTIAL_APPLY: &str = include_str!("../test-fixtures/trace-v1-partial-apply.json");
const PARTIAL_APPLY_LEN: usize = 2249;
const PARTIAL_APPLY_SHA256: &str =
    "6bb6e073b346a30bd26afa7e6b436423b27e222bae9c7eaadfd1af8ade6dfd98";

const CAPABILITY_REFUSAL: &str = include_str!("../test-fixtures/trace-v1-capability-refusal.json");
const CAPABILITY_REFUSAL_LEN: usize = 2247;
const CAPABILITY_REFUSAL_SHA256: &str =
    "04e7fff14a2103d4efb4fa4b42fe6684e93f5f9b3a0940e1615746918edd788b";

const DUPLICATE_ACK: &str = include_str!("../test-fixtures/trace-v1-duplicate-ack.json");
const DUPLICATE_ACK_LEN: usize = 2937;
const DUPLICATE_ACK_SHA256: &str =
    "99c40180fa5e0fb51b76a2c88f0e2e0c1ab606b82122bf6e4a55c7a951b27bd8";

const WRONG_ACK: &str = include_str!("../test-fixtures/trace-v1-wrong-ack.json");
const WRONG_ACK_LEN: usize = 2239;
const WRONG_ACK_SHA256: &str = "51be78a5a513383c1b6ee5371cf0d3cf4c6f2ee0118dd57860c02fb297ec3566";

const ADAPTER_LOSS: &str = include_str!("../test-fixtures/trace-v1-adapter-loss.json");
const ADAPTER_LOSS_LEN: usize = 2151;
const ADAPTER_LOSS_SHA256: &str =
    "0b671a7613f1045917ea3f3783196a558c02668bdd82b71f49562706d8b20d8e";

const POSTCONDITION_MISMATCH: &str =
    include_str!("../test-fixtures/trace-v1-postcondition-mismatch.json");
const POSTCONDITION_MISMATCH_LEN: usize = 2800;
const POSTCONDITION_MISMATCH_SHA256: &str =
    "c6092ad161ecb6ff6ecd11e0097dfa10f4139c548ebb3a179a419fdedbda427d";

#[test]
fn checked_in_trace_fixtures_replay_to_locked_outcomes() {
    let cases = [
        FixtureCase {
            name: "success nested N-ary convergence",
            bytes: SUCCESS_NESTED_NARY,
            len: SUCCESS_NESTED_NARY_LEN,
            sha256: SUCCESS_NESTED_NARY_SHA256,
            state: TerminalState::Verified,
            diagnostic: DiagnosticClass::None,
            revision: 1,
            commit_revision: Some(1),
        },
        FixtureCase {
            name: "stale observation",
            bytes: STALE_OBSERVATION,
            len: STALE_OBSERVATION_LEN,
            sha256: STALE_OBSERVATION_SHA256,
            state: TerminalState::Divergent,
            diagnostic: DiagnosticClass::StaleRevision,
            revision: 0,
            commit_revision: None,
        },
        FixtureCase {
            name: "partial application",
            bytes: PARTIAL_APPLY,
            len: PARTIAL_APPLY_LEN,
            sha256: PARTIAL_APPLY_SHA256,
            state: TerminalState::Divergent,
            diagnostic: DiagnosticClass::PartialApplication,
            revision: 0,
            commit_revision: None,
        },
        FixtureCase {
            name: "capability refusal",
            bytes: CAPABILITY_REFUSAL,
            len: CAPABILITY_REFUSAL_LEN,
            sha256: CAPABILITY_REFUSAL_SHA256,
            state: TerminalState::Divergent,
            diagnostic: DiagnosticClass::CapabilityRefused,
            revision: 0,
            commit_revision: None,
        },
        FixtureCase {
            name: "duplicate accepted ack",
            bytes: DUPLICATE_ACK,
            len: DUPLICATE_ACK_LEN,
            sha256: DUPLICATE_ACK_SHA256,
            state: TerminalState::Verified,
            diagnostic: DiagnosticClass::None,
            revision: 1,
            commit_revision: Some(1),
        },
        FixtureCase {
            name: "wrong/out-of-order correlation ack",
            bytes: WRONG_ACK,
            len: WRONG_ACK_LEN,
            sha256: WRONG_ACK_SHA256,
            state: TerminalState::Divergent,
            diagnostic: DiagnosticClass::CorrelationMismatch,
            revision: 0,
            commit_revision: None,
        },
        FixtureCase {
            name: "adapter loss",
            bytes: ADAPTER_LOSS,
            len: ADAPTER_LOSS_LEN,
            sha256: ADAPTER_LOSS_SHA256,
            state: TerminalState::Divergent,
            diagnostic: DiagnosticClass::AdapterLost,
            revision: 0,
            commit_revision: None,
        },
        FixtureCase {
            name: "postcondition mismatch",
            bytes: POSTCONDITION_MISMATCH,
            len: POSTCONDITION_MISMATCH_LEN,
            sha256: POSTCONDITION_MISMATCH_SHA256,
            state: TerminalState::Divergent,
            diagnostic: DiagnosticClass::PostconditionMismatch,
            revision: 0,
            commit_revision: None,
        },
    ];
    assert_eq!(cases.len(), 8, "all eight trace fixtures must be locked");
    for case in &cases {
        assert_eq!(case.bytes.len(), case.len, "byte lock: {}", case.name);
        assert_eq!(
            sha256_hex(case.bytes),
            case.sha256,
            "sha256 lock: {}",
            case.name
        );
        let outcome = replay_trace_json(case.bytes)
            .unwrap_or_else(|error| panic!("{} replays: {}", case.name, error.kind()));
        assert_eq!(outcome.state, case.state, "state: {}", case.name);
        assert_eq!(
            outcome.diagnostic, case.diagnostic,
            "diagnostic: {}",
            case.name
        );
        assert_eq!(outcome.revision, case.revision, "revision: {}", case.name);
        assert_eq!(
            outcome.commit.map(|commit| commit.revision),
            case.commit_revision,
            "commit: {}",
            case.name
        );
        let parsed = parse_trace_json(case.bytes).expect("fixture parses");
        assert_eq!(
            parsed.expected.terminal_state, case.state,
            "fixture expected state agrees: {}",
            case.name
        );
        assert_eq!(
            parsed.expected.diagnostic, case.diagnostic,
            "fixture expected diagnostic agrees: {}",
            case.name
        );
        assert!(
            outcome.matches_expected(parsed.expected),
            "replay agrees with fixture expected block: {}",
            case.name
        );
    }
}
