//! Stage 2 reconciler contract invariants.
//!
//! Focused invariant-style checks over the real public API
//! (`Reconciler`, `contract` types, `directional` plans). Ordinary
//! happy-path and single-fault paths are already covered by unit tests and
//! `tests/reconcile_harness.rs`; these tests assert cross-cutting invariants:
//! determinism, non-advancing error paths, at-most-one pending, commit
//! gating, terminal divergence immutability, bounded redacted errors, and
//! portable-module import prohibition.

use plasma_auto_tiler::contract::{
    AckOutcome, AdapterAck, DivergenceKind, MAX_CORRELATION_LEN, MAX_GENERATION_LEN, MAX_OWNER_LEN,
    MAX_PRECONDITIONS, MAX_REVISION, Observation, PostObservation,
};
use plasma_auto_tiler::directional::{
    Capabilities, Capability, Direction, MoveIntent, MoveOperation, NodeId, OutputId, Precondition,
    Rule,
};
use plasma_auto_tiler::reconcile::{
    AckApplied, AckError, ProposeError, Reconciler, StateKind, VerifyError,
};

fn intent() -> MoveIntent {
    MoveIntent {
        source_output: OutputId("out-1".to_owned()),
        focused_leaf: NodeId("leaf-1".to_owned()),
        focused_window: WindowId("win-1".to_owned()),
        direction: Direction::Right,
    }
}

use plasma_auto_tiler::directional::WindowId;

fn test_plan() -> plasma_auto_tiler::directional::MovePlan {
    let operation = MoveOperation::SwapNeighbor {
        rule: Rule::R2a,
        container: NodeId("root".to_owned()),
        neighbor: NodeId("leaf-2".to_owned()),
    };
    let preconditions = operation.preconditions();
    plasma_auto_tiler::directional::MovePlan {
        intent: intent(),
        rule: Rule::R2a,
        operation,
        required_capability: Capability::SwapNeighbor,
        preconditions,
    }
}

fn seed() -> Reconciler {
    Reconciler::new("owner-1", "gen-1", 0, 11).expect("valid seed")
}

fn observation(revision: u64) -> Observation {
    Observation {
        owner: "owner-1".to_owned(),
        generation: "gen-1".to_owned(),
        revision,
        fingerprint: 11,
    }
}

fn ack(correlation: &str, base: u64, outcome: AckOutcome) -> AdapterAck {
    AdapterAck {
        correlation_id: correlation.to_owned(),
        owner: "owner-1".to_owned(),
        generation: "gen-1".to_owned(),
        base_revision: base,
        outcome,
    }
}

fn post(correlation: &str, revision: u64, verified: bool) -> PostObservation {
    PostObservation {
        observation: Observation {
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            revision,
            fingerprint: 22,
        },
        correlation_id: correlation.to_owned(),
        verified,
        verified_preconditions: test_plan().preconditions.clone(),
        verified_operation: test_plan().operation.clone(),
    }
}

fn post_with_operation(
    correlation: &str,
    revision: u64,
    verified: bool,
    operation: MoveOperation,
) -> PostObservation {
    PostObservation {
        observation: Observation {
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            revision,
            fingerprint: 22,
        },
        correlation_id: correlation.to_owned(),
        verified,
        verified_preconditions: test_plan().preconditions.clone(),
        verified_operation: operation,
    }
}

fn full_cycle() -> (
    plasma_auto_tiler::contract::Dispatch,
    plasma_auto_tiler::reconcile::Commit,
    plasma_auto_tiler::reconcile::StatusView,
) {
    let mut r = seed();
    let plan = test_plan();
    let dispatch = r
        .propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    let commit = r.verify(&post("corr-1", 0, true)).expect("verify");
    let status = r.status();
    (dispatch, commit, status)
}

#[test]
fn repeated_identical_runs_are_deterministically_equal() {
    let (dispatch_a, commit_a, status_a) = full_cycle();
    let (dispatch_b, commit_b, status_b) = full_cycle();

    assert_eq!(dispatch_a, dispatch_b);
    assert_eq!(commit_a, commit_b);
    assert_eq!(status_a, status_b);
    assert_eq!(commit_a.revision, 1);
    assert_eq!(status_a.state, StateKind::Verified);
    assert_eq!(status_a.revision, 1);
    assert!(!status_a.pending);
    assert_eq!(status_a.divergence, None);
}

#[test]
fn dispatch_binds_complete_semantic_payload() {
    let mut r = seed();
    let plan = test_plan();
    let dispatch = r
        .propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    assert_eq!(dispatch.intent, plan.intent);
    assert_eq!(dispatch.operation, plan.operation);
    assert_eq!(dispatch.required_capability, plan.required_capability);
    assert_eq!(dispatch.preconditions, plan.preconditions);
    assert_eq!(dispatch.base_revision, 0);
    assert_eq!(dispatch.correlation_id, "corr-1");
    assert_eq!(dispatch.owner, "owner-1");
    assert_eq!(dispatch.generation, "gen-1");
    assert!(
        dispatch
            .preconditions
            .contains(&Precondition::AdapterMustVerifyPostconditions)
    );
    assert!(dispatch.preconditions.len() <= MAX_PRECONDITIONS);
}

#[test]
fn at_most_one_pending_without_divergence_or_loss() {
    let mut r = seed();
    let plan = test_plan();
    r.propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("first");
    let before = r.status();
    assert_eq!(before.state, StateKind::PendingUnacked);
    assert!(before.pending);

    // Second proposal, even with otherwise-valid input, is rejected without
    // divergence and without replacing the pending plan.
    assert_eq!(
        r.propose(&plan, &observation(0), "corr-2", &Capabilities::full()),
        Err(ProposeError::PendingExists)
    );
    assert_eq!(r.status(), before);
    assert_eq!(r.divergence(), None);

    // The original pending plan is still committable exactly once.
    assert_eq!(
        r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted)),
        Ok(AckApplied::Accepted)
    );
    let commit = r.verify(&post("corr-1", 0, true)).expect("commit first");
    assert_eq!(commit.revision, 1);
    assert_eq!(r.verified_revision(), 1);
}

#[test]
fn nondivergent_error_paths_never_advance_state() {
    // Ack with no pending: discarded, no divergence, still usable.
    let mut r = seed();
    assert_eq!(
        r.acknowledge(&ack("corr-9", 0, AckOutcome::Accepted)),
        Err(AckError::NoPending)
    );
    assert_eq!(r.status().state, StateKind::Verified);
    assert_eq!(r.verified_revision(), 0);
    assert_eq!(r.divergence(), None);
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("usable after NoPending");

    // Early verify before ack: rejected, no divergence, revision frozen.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    assert_eq!(
        r.verify(&post("corr-1", 0, true)),
        Err(VerifyError::NotAcknowledged)
    );
    assert_eq!(r.status().state, StateKind::PendingUnacked);
    assert_eq!(r.verified_revision(), 0);
    assert_eq!(r.divergence(), None);

    // Duplicate identical accepted ack: discarded, no advancement to commit.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    assert_eq!(
        r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted)),
        Ok(AckApplied::Accepted)
    );
    assert_eq!(
        r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted)),
        Ok(AckApplied::DuplicateDiscarded)
    );
    assert_eq!(r.status().state, StateKind::PendingAcked);
    assert_eq!(r.verified_revision(), 0);

    // Second propose while pending is PendingExists, not divergence, even
    // with garbage follow-up input.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    let before = r.status();
    assert_eq!(
        r.propose(
            &test_plan(),
            &observation(7),
            "bad corr id",
            &Capabilities::none()
        ),
        Err(ProposeError::PendingExists)
    );
    assert_eq!(r.status(), before);
    assert_eq!(r.divergence(), None);
}

#[test]
fn mismatched_bound_identifiers_while_pending_diverge_without_commit() {
    // Ack owner mismatch while pending diverges.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    let mut bad = ack("corr-1", 0, AckOutcome::Accepted);
    bad.owner = "owner-2".to_owned();
    assert_eq!(
        r.acknowledge(&bad),
        Err(AckError::Diverged(DivergenceKind::OwnerMismatch))
    );
    assert_eq!(r.status().state, StateKind::Divergent);
    assert_eq!(r.verified_revision(), 0);

    // Ack generation mismatch while pending diverges.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    let mut bad = ack("corr-1", 0, AckOutcome::Accepted);
    bad.generation = "gen-2".to_owned();
    assert_eq!(
        r.acknowledge(&bad),
        Err(AckError::Diverged(DivergenceKind::GenerationMismatch))
    );
    assert_eq!(r.verified_revision(), 0);

    // Ack correlation mismatch while pending diverges.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    assert_eq!(
        r.acknowledge(&ack("corr-2", 0, AckOutcome::Accepted)),
        Err(AckError::Diverged(DivergenceKind::CorrelationMismatch))
    );
    assert_eq!(r.verified_revision(), 0);

    // Ack base-revision mismatch while pending diverges as correlation.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    assert_eq!(
        r.acknowledge(&ack("corr-1", 7, AckOutcome::Accepted)),
        Err(AckError::Diverged(DivergenceKind::CorrelationMismatch))
    );
    assert_eq!(r.verified_revision(), 0);

    // Verify correlation mismatch after ack diverges without commit.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    assert_eq!(
        r.verify(&post("corr-2", 0, true)),
        Err(VerifyError::Diverged(DivergenceKind::CorrelationMismatch))
    );
    assert_eq!(r.verified_revision(), 0);
    assert_eq!(r.status().state, StateKind::Divergent);
}

#[test]
fn no_commit_before_accepted_ack_plus_matching_post() {
    // Verify with no pending commits nothing.
    let mut r = seed();
    assert_eq!(
        r.verify(&post("corr-1", 0, true)),
        Err(VerifyError::NoPending)
    );
    assert_eq!(r.verified_revision(), 0);

    // Early verify (unacked) commits nothing.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    assert_eq!(
        r.verify(&post("corr-1", 0, true)),
        Err(VerifyError::NotAcknowledged)
    );
    assert_eq!(r.verified_revision(), 0);
    assert_eq!(r.status().state, StateKind::PendingUnacked);

    // Duplicate ack alone commits nothing; still needs matching post.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("duplicate");
    assert_eq!(r.verified_revision(), 0);
    assert_eq!(r.status().state, StateKind::PendingAcked);

    // Only accepted ack plus exact matching verified post advances by one.
    let commit = r.verify(&post("corr-1", 0, true)).expect("commit");
    assert_eq!(commit.revision, 1);
    assert_eq!(r.verified_revision(), 1);
    assert_eq!(r.status().state, StateKind::Verified);
}

#[test]
fn postcondition_binding_is_exact_and_bounded() {
    // Truncated verified vector diverges without commit.
    let mut r = seed();
    let plan = test_plan();
    r.propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    let mut truncated = plan.preconditions.clone();
    truncated.pop();
    let bad = PostObservation {
        observation: Observation {
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            revision: 0,
            fingerprint: 22,
        },
        correlation_id: "corr-1".to_owned(),
        verified: true,
        verified_preconditions: truncated,
        verified_operation: plan.operation.clone(),
    };
    assert_eq!(
        r.verify(&bad),
        Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
    );
    assert_eq!(r.verified_revision(), 0);

    // Overlong verified vector diverges without commit.
    let mut r = seed();
    r.propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    let overlong = vec![Precondition::AdapterMustVerifyPostconditions; MAX_PRECONDITIONS + 1];
    let bad = PostObservation {
        observation: Observation {
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            revision: 0,
            fingerprint: 22,
        },
        correlation_id: "corr-1".to_owned(),
        verified: true,
        verified_preconditions: overlong,
        verified_operation: plan.operation.clone(),
    };
    assert_eq!(
        r.verify(&bad),
        Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
    );
    assert_eq!(r.verified_revision(), 0);

    // Unverified flag diverges without commit even with exact vector.
    let mut r = seed();
    r.propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    assert_eq!(
        r.verify(&post("corr-1", 0, false)),
        Err(VerifyError::Diverged(
            DivergenceKind::PostconditionUnverified
        ))
    );
    assert_eq!(r.verified_revision(), 0);
}

#[test]
fn divergent_state_is_terminal_and_immutable() {
    let mut r = seed();
    assert_eq!(
        r.propose(
            &test_plan(),
            &observation(7),
            "corr-1",
            &Capabilities::full()
        ),
        Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
    );
    assert_eq!(r.status().state, StateKind::Divergent);
    assert!(!r.status().pending);
    assert_eq!(r.status().divergence, Some(DivergenceKind::StaleRevision));
    let frozen_revision = r.verified_revision();
    let frozen_status = r.status();

    // Every further mutation attempt reports the original divergence and
    // changes nothing: no dispatch, no ack advancement, no commit.
    assert_eq!(
        r.propose(
            &test_plan(),
            &observation(0),
            "corr-2",
            &Capabilities::full()
        ),
        Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
    );
    assert_eq!(
        r.acknowledge(&ack("corr-2", 0, AckOutcome::Accepted)),
        Err(AckError::Diverged(DivergenceKind::StaleRevision))
    );
    assert_eq!(
        r.verify(&post("corr-2", 0, true)),
        Err(VerifyError::Diverged(DivergenceKind::StaleRevision))
    );
    // Adapter-loss signal is idempotent once diverged.
    assert_eq!(r.note_adapter_loss(), DivergenceKind::StaleRevision);
    assert_eq!(r.status(), frozen_status);
    assert_eq!(r.verified_revision(), frozen_revision);
    assert_eq!(r.divergence(), Some(DivergenceKind::StaleRevision));
}

#[test]
fn oversized_and_malformed_inputs_are_bounded_and_redacted() {
    let secret = "SECRET-XYZ-9";
    let oversized_owner = "x".repeat(MAX_OWNER_LEN + 1);
    let oversized_generation = "g".repeat(MAX_GENERATION_LEN + 1);
    let oversized_correlation = "c".repeat(MAX_CORRELATION_LEN + 1);

    // Oversized correlation at propose diverges typed without echo.
    let mut r = seed();
    let err = r
        .propose(
            &test_plan(),
            &observation(0),
            &format!("{oversized_correlation}-{secret}"),
            &Capabilities::full(),
        )
        .expect_err("oversized correlation must diverge");
    assert_eq!(
        err,
        ProposeError::Diverged(DivergenceKind::CorrelationMismatch)
    );
    assert_eq!(err.kind(), "correlation-mismatch");
    assert!(!err.kind().contains(secret));
    assert!(!err.message().contains(secret));
    assert!(!format!("{err:?}").contains(secret));

    // Oversized owner in observation diverges as owner mismatch, redacted.
    let mut r = seed();
    let mut bad_obs = observation(0);
    bad_obs.owner = format!("{oversized_owner}-{secret}");
    let err = r
        .propose(&test_plan(), &bad_obs, "corr-1", &Capabilities::full())
        .expect_err("oversized owner must diverge");
    assert_eq!(err, ProposeError::Diverged(DivergenceKind::OwnerMismatch));
    assert!(!err.message().contains(secret));
    assert!(!format!("{err:?}").contains(secret));

    // Oversized generation in observation diverges as generation mismatch.
    let mut r = seed();
    let mut bad_obs = observation(0);
    bad_obs.generation = format!("{oversized_generation}-{secret}");
    let err = r
        .propose(&test_plan(), &bad_obs, "corr-1", &Capabilities::full())
        .expect_err("oversized generation must diverge");
    assert_eq!(
        err,
        ProposeError::Diverged(DivergenceKind::GenerationMismatch)
    );
    assert!(!err.message().contains(secret));

    // Malformed ack shape while pending diverges as correlation mismatch.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    let mut bad_ack = ack("corr-1", 0, AckOutcome::Accepted);
    bad_ack.correlation_id = format!("bad corr {secret}");
    let err = r
        .acknowledge(&bad_ack)
        .expect_err("malformed ack must diverge");
    assert_eq!(err, AckError::Diverged(DivergenceKind::CorrelationMismatch));
    assert_eq!(err.kind(), "correlation-mismatch");
    assert!(!err.message().contains(secret));

    // Malformed correlation with no pending is discarded (NoPending), not
    // divergence, and never echoes.
    let mut r = seed();
    let mut bad_ack = ack("corr-9", 0, AckOutcome::Accepted);
    bad_ack.correlation_id = format!("bad corr {secret}");
    let err = r.acknowledge(&bad_ack).expect_err("no pending");
    assert_eq!(err, AckError::NoPending);
    assert_eq!(err.kind(), "no-pending");
    assert!(!err.message().contains(secret));
    assert_eq!(r.divergence(), None);

    // Out-of-bounds revision at construction is a fixed pre-state error.
    let err =
        Reconciler::new("owner-1", "gen-1", MAX_REVISION + 1, 11).expect_err("revision bound");
    assert_eq!(err.kind(), "revision-out-of-bounds");

    // Status views carry no opaque ids.
    let r = seed();
    assert!(!format!("{:?}", r.status()).contains("owner-1"));
}

#[test]
fn typed_error_kinds_and_messages_are_fixed() {
    assert_eq!(ProposeError::PendingExists.kind(), "pending-exists");
    assert_eq!(
        ProposeError::PendingExists.message(),
        "complete the pending plan before proposing"
    );
    assert_eq!(AckError::NoPending.kind(), "no-pending");
    assert_eq!(
        AckError::NoPending.message(),
        "no dispatched plan awaits acknowledgement"
    );
    assert_eq!(VerifyError::NoPending.kind(), "no-pending");
    assert_eq!(VerifyError::NotAcknowledged.kind(), "not-acknowledged");
    assert_eq!(
        VerifyError::NotAcknowledged.message(),
        "acknowledge the dispatched plan first"
    );
    // Diverged kinds delegate exactly to the underlying DivergenceKind.
    assert_eq!(
        ProposeError::Diverged(DivergenceKind::StaleRevision).kind(),
        DivergenceKind::StaleRevision.as_str()
    );
    assert_eq!(
        ProposeError::Diverged(DivergenceKind::StaleRevision).message(),
        DivergenceKind::StaleRevision.message()
    );
    assert_eq!(
        AckError::Diverged(DivergenceKind::CorrelationMismatch).kind(),
        "correlation-mismatch"
    );
    assert_eq!(
        VerifyError::Diverged(DivergenceKind::PostconditionMismatch).kind(),
        "postcondition-mismatch"
    );
    // Fixed redacted messages never echo input.
    for kind in [
        DivergenceKind::StaleRevision,
        DivergenceKind::OwnerMismatch,
        DivergenceKind::GenerationMismatch,
        DivergenceKind::CorrelationMismatch,
        DivergenceKind::CapabilityRefused,
        DivergenceKind::PartialApplication,
        DivergenceKind::AdapterLost,
        DivergenceKind::PostconditionUnverified,
        DivergenceKind::PostconditionMismatch,
        DivergenceKind::RevisionExhausted,
    ] {
        assert!(!kind.as_str().contains("owner-1"));
        assert!(!kind.message().contains("owner-1"));
        assert!(!kind.message().contains("corr-1"));
    }
}

#[test]
fn inconsistent_hand_built_plans_diverge_without_dispatch() {
    // Rule mismatch diverges as postcondition mismatch.
    let mut r = seed();
    let mut bad = test_plan();
    bad.rule = Rule::R1;
    assert_eq!(
        r.propose(&bad, &observation(0), "corr-1", &Capabilities::full()),
        Err(ProposeError::Diverged(
            DivergenceKind::PostconditionMismatch
        ))
    );
    assert_eq!(r.status().state, StateKind::Divergent);
    assert!(!r.status().pending);
    assert_eq!(r.verified_revision(), 0);

    // Capability mismatch diverges as capability refused.
    let mut r = seed();
    let mut bad = test_plan();
    bad.required_capability = Capability::WrapPerpendicular;
    assert_eq!(
        r.propose(&bad, &observation(0), "corr-1", &Capabilities::full()),
        Err(ProposeError::Diverged(DivergenceKind::CapabilityRefused))
    );
    assert_eq!(r.verified_revision(), 0);

    // Preconditions mismatch diverges as postcondition mismatch.
    let mut r = seed();
    let mut bad = test_plan();
    bad.preconditions.pop();
    assert_eq!(
        r.propose(&bad, &observation(0), "corr-1", &Capabilities::full()),
        Err(ProposeError::Diverged(
            DivergenceKind::PostconditionMismatch
        ))
    );
    assert_eq!(r.verified_revision(), 0);
}

#[test]
fn dispatch_carries_owner_generation_identity_binding() {
    let mut r = seed();
    let plan = test_plan();
    let dispatch = r
        .propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    assert_eq!(dispatch.correlation_id, "corr-1");
    assert_eq!(dispatch.owner, "owner-1");
    assert_eq!(dispatch.generation, "gen-1");
    assert_eq!(dispatch.base_revision, 0);
}

#[test]
fn verified_operation_mismatch_diverges_without_commit() {
    let mut r = seed();
    let plan = test_plan();
    r.propose(&plan, &observation(0), "corr-1", &Capabilities::full())
        .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    let other = MoveOperation::WrapPerpendicular {
        rule: Rule::R1,
        container: NodeId("root".to_owned()),
        axis: plasma_auto_tiler::directional::Axis::Horizontal,
    };
    assert_eq!(
        r.verify(&post_with_operation("corr-1", 0, true, other)),
        Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
    );
    assert_eq!(r.status().state, StateKind::Divergent);
    assert_eq!(r.verified_revision(), 0);
}

#[test]
fn malformed_identifier_shapes_classify_typed() {
    // Malformed ack owner shape diverges as owner mismatch.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    let mut bad = ack("corr-1", 0, AckOutcome::Accepted);
    bad.owner = "bad owner".to_owned();
    assert_eq!(
        r.acknowledge(&bad),
        Err(AckError::Diverged(DivergenceKind::OwnerMismatch))
    );

    // Malformed ack generation shape diverges as generation mismatch.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    let mut bad = ack("corr-1", 0, AckOutcome::Accepted);
    bad.generation = "GEN-1".to_owned();
    assert_eq!(
        r.acknowledge(&bad),
        Err(AckError::Diverged(DivergenceKind::GenerationMismatch))
    );

    // Out-of-bounds ack revision shape diverges as stale revision.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    assert_eq!(
        r.acknowledge(&ack("corr-1", MAX_REVISION + 1, AckOutcome::Accepted)),
        Err(AckError::Diverged(DivergenceKind::StaleRevision))
    );

    // Malformed verify owner shape diverges as owner mismatch.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    let mut bad = post("corr-1", 0, true);
    bad.observation.owner = "bad owner".to_owned();
    assert_eq!(
        r.verify(&bad),
        Err(VerifyError::Diverged(DivergenceKind::OwnerMismatch))
    );

    // Malformed verify generation shape diverges as generation mismatch.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    let mut bad = post("corr-1", 0, true);
    bad.observation.generation = "GEN-1".to_owned();
    assert_eq!(
        r.verify(&bad),
        Err(VerifyError::Diverged(DivergenceKind::GenerationMismatch))
    );

    // Out-of-bounds verify revision shape diverges as stale revision.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    assert_eq!(
        r.verify(&post("corr-1", MAX_REVISION + 1, true)),
        Err(VerifyError::Diverged(DivergenceKind::StaleRevision))
    );

    // Malformed verify correlation shape diverges as correlation mismatch.
    let mut r = seed();
    r.propose(
        &test_plan(),
        &observation(0),
        "corr-1",
        &Capabilities::full(),
    )
    .expect("propose");
    r.acknowledge(&ack("corr-1", 0, AckOutcome::Accepted))
        .expect("ack");
    assert_eq!(
        r.verify(&post("bad corr", 0, true)),
        Err(VerifyError::Diverged(DivergenceKind::CorrelationMismatch))
    );
}

#[test]
fn portable_modules_prohibit_platform_imports() {
    // Compile-time inclusion: inspects the production sources without
    // touching host state, processes, or workdirs at test runtime.
    const CONTRACT: &str = include_str!("../src/contract.rs");
    const RECONCILE: &str = include_str!("../src/reconcile.rs");
    // Only `use`/`extern crate`/`mod` lines are import surface; comments
    // legitimately mention platform/process/IPC/geometry, so those words
    // alone must not count. Match import lines containing platform tokens.
    const BANNED: &[&str] = &[
        "zbus",
        "rustix",
        "dbus",
        "tokio",
        "async-std",
        "smol",
        "wayland",
        "x11",
        "kwin",
        "libc",
        "nix",
        "socket",
        "ipc",
        "process",
        "platform",
        "std::process",
        "std::net",
        "std::os",
        "std::fs",
        "std::env",
        "std::thread",
        "ffi",
    ];
    for (name, source) in [("contract.rs", CONTRACT), ("reconcile.rs", RECONCILE)] {
        for raw_line in source.lines() {
            let line = raw_line.trim().to_ascii_lowercase();
            if !(line.starts_with("use ")
                || line.starts_with("extern crate")
                || line.starts_with("mod "))
            {
                continue;
            }
            for token in BANNED {
                assert!(
                    !line.contains(token),
                    "{name} import line {raw_line:?} contains banned {token:?}"
                );
            }
        }
        // Both modules must remain transport-independent adapter boundaries.
        assert!(
            source.contains("transport-independent") || source.contains("transport-neutral"),
            "{name} should document its transport-independent boundary"
        );
    }
}
