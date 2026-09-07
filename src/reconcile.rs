//! Deterministic transport-independent reconciler.
//!
//! Portable state machine over [`crate::contract`] observations and already
//! computed [`crate::directional::MovePlan`]s. No platform, process, IPC,
//! geometry, or native execution imports.
//!
//! State transitions:
//! - `Verified --propose--> PendingUnacked --acknowledge--> PendingAcked
//!   --verify--> Verified(base + 1)`.
//! - Any stale/mismatched/partial/capability-refusal/adapter-loss/unverified
//!   or mismatch condition records a typed [`DivergenceKind`] and enters
//!   terminal `Divergent`: no further dispatch or mutation.
//!
//! Duplicate/out-of-order semantics (simple, documented in type names):
//! - `ProposeRejected::PendingExists`: second proposal while pending is
//!   rejected without divergence and without state change.
//! - `AckApplied::DuplicateDiscarded`: an identical accepted acknowledgement
//!   replayed while already acknowledged is discarded without advancement.
//! - Any acknowledgement with no pending plan is `AckRejected::NoPending`
//!   (discarded, no divergence, no advancement).
//! - Verification before acknowledgement is
//!   `VerifyRejected::NotAcknowledged` (rejected, no divergence).
//! - A second verification after a commit finds no pending plan
//!   (`VerifyRejected::NoPending`); the revision advanced exactly once.
//! - Any acknowledgement/verification binding mismatch (owner, generation,
//!   base revision, correlation) diverges fail-closed.
//! - Non-accepted acknowledgement outcomes (refused/partial/lost) diverge
//!   fail-closed; arbitrary adapter detail is never stored or echoed.

use crate::contract::{
    AdapterAck, Dispatch, DivergenceKind, MAX_PRECONDITIONS, Observation, PostObservation,
    is_correlation_id, is_generation_id, is_owner_id, is_revision,
};
use crate::directional::{Capabilities, MovePlan, Precondition};

/// Visible reconciler state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateKind {
    Verified,
    PendingUnacked,
    PendingAcked,
    Divergent,
}

/// Redacted status view: state, revision, pending flag, divergence. Carries
/// no opaque ids and no adapter detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusView {
    pub state: StateKind,
    pub revision: u64,
    pub pending: bool,
    pub divergence: Option<DivergenceKind>,
}

/// Successful commit receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Commit {
    pub revision: u64,
    pub fingerprint: u64,
}

/// Acknowledgement application outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AckApplied {
    /// First matching accepted acknowledgement; pending is now acked.
    Accepted,
    /// Identical accepted acknowledgement replay; discarded, no advancement.
    DuplicateDiscarded,
}

/// Non-divergent-capable proposal failure. `Diverged` is terminal and records
/// [`DivergenceKind`] inside the reconciler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposeError {
    /// At most one pending plan: rejected without divergence or mutation.
    PendingExists,
    /// Fail-closed divergence; no further dispatch or mutation.
    Diverged(DivergenceKind),
}

impl ProposeError {
    /// Stable kind string, never echoes input.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::PendingExists => "pending-exists",
            Self::Diverged(reason) => reason.as_str(),
        }
    }

    /// Fixed redacted message, never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::PendingExists => "complete the pending plan before proposing",
            Self::Diverged(reason) => reason.message(),
        }
    }
}

/// Acknowledgement failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AckError {
    /// No pending plan: discarded without divergence or advancement.
    NoPending,
    /// Fail-closed divergence.
    Diverged(DivergenceKind),
}

impl AckError {
    /// Stable kind string, never echoes input.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::NoPending => "no-pending",
            Self::Diverged(reason) => reason.as_str(),
        }
    }

    /// Fixed redacted message, never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::NoPending => "no dispatched plan awaits acknowledgement",
            Self::Diverged(reason) => reason.message(),
        }
    }
}

/// Verification failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    /// No pending plan: rejected without divergence.
    NoPending,
    /// Pending plan not yet acknowledged: rejected without divergence.
    NotAcknowledged,
    /// Fail-closed divergence.
    Diverged(DivergenceKind),
}

impl VerifyError {
    /// Stable kind string, never echoes input.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::NoPending => "no-pending",
            Self::NotAcknowledged => "not-acknowledged",
            Self::Diverged(reason) => reason.as_str(),
        }
    }

    /// Fixed redacted message, never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::NoPending => "no dispatched plan awaits verification",
            Self::NotAcknowledged => "acknowledge the dispatched plan first",
            Self::Diverged(reason) => reason.message(),
        }
    }
}

/// Construction failure (pre-state, never divergence).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewError {
    InvalidOwner,
    InvalidGeneration,
    RevisionOutOfBounds,
}

impl NewError {
    /// Stable kind string.
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::InvalidOwner => "owner-invalid",
            Self::InvalidGeneration => "generation-invalid",
            Self::RevisionOutOfBounds => "revision-out-of-bounds",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Pending {
    correlation_id: String,
    base_revision: u64,
    acked: bool,
    preconditions: Vec<Precondition>,
    operation: crate::directional::MoveOperation,
}

/// Deterministic reconciler: at most one pending plan bound exactly to
/// owner/generation/base revision/correlation plus plan preconditions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reconciler {
    owner: String,
    generation: String,
    verified_revision: u64,
    verified_fingerprint: u64,
    pending: Option<Pending>,
    diverged: Option<DivergenceKind>,
}

impl Reconciler {
    /// Pin stable owner/generation metadata and seed the verified revision.
    pub fn new(
        owner: &str,
        generation: &str,
        initial_revision: u64,
        initial_fingerprint: u64,
    ) -> Result<Self, NewError> {
        if !crate::contract::is_owner_id(owner) {
            return Err(NewError::InvalidOwner);
        }
        if !crate::contract::is_generation_id(generation) {
            return Err(NewError::InvalidGeneration);
        }
        if !crate::contract::is_revision(initial_revision) {
            return Err(NewError::RevisionOutOfBounds);
        }
        Ok(Self {
            owner: owner.to_owned(),
            generation: generation.to_owned(),
            verified_revision: initial_revision,
            verified_fingerprint: initial_fingerprint,
            pending: None,
            diverged: None,
        })
    }

    /// Current verified revision.
    #[must_use]
    pub const fn verified_revision(&self) -> u64 {
        self.verified_revision
    }

    /// Recorded divergence, if fail-closed.
    #[must_use]
    pub const fn divergence(&self) -> Option<DivergenceKind> {
        self.diverged
    }

    /// Redacted status view.
    #[must_use]
    pub fn status(&self) -> StatusView {
        let state = if self.diverged.is_some() {
            StateKind::Divergent
        } else if let Some(pending) = &self.pending {
            if pending.acked {
                StateKind::PendingAcked
            } else {
                StateKind::PendingUnacked
            }
        } else {
            StateKind::Verified
        };
        StatusView {
            state,
            revision: self.verified_revision,
            pending: self.pending.is_some(),
            divergence: self.diverged,
        }
    }

    fn diverge(&mut self, reason: DivergenceKind) -> DivergenceKind {
        self.diverged = Some(reason);
        self.pending = None;
        reason
    }

    /// Propose an already-computed plan against a normalized observation.
    ///
    /// Binds exactly to owner/generation/base revision/correlation plus the
    /// plan's preconditions and declared capabilities; emits a
    /// transport-neutral [`Dispatch`]. Native execution stays outside.
    pub fn propose(
        &mut self,
        plan: &MovePlan,
        observation: &Observation,
        correlation_id: &str,
        capabilities: &Capabilities,
    ) -> Result<Dispatch, ProposeError> {
        if let Some(reason) = self.diverged {
            return Err(ProposeError::Diverged(reason));
        }
        if self.pending.is_some() {
            return Err(ProposeError::PendingExists);
        }
        if !is_correlation_id(correlation_id) {
            let reason = self.diverge(DivergenceKind::CorrelationMismatch);
            return Err(ProposeError::Diverged(reason));
        }
        if !observation.validate() || observation.owner != self.owner {
            // Validate shape first so malformed ids still fail closed as a
            // typed mismatch without echoing which field carried input.
            let reason = if observation.owner != self.owner {
                self.diverge(DivergenceKind::OwnerMismatch)
            } else if !crate::contract::is_generation_id(&observation.generation) {
                self.diverge(DivergenceKind::GenerationMismatch)
            } else {
                self.diverge(DivergenceKind::StaleRevision)
            };
            return Err(ProposeError::Diverged(reason));
        }
        if observation.generation != self.generation {
            let reason = self.diverge(DivergenceKind::GenerationMismatch);
            return Err(ProposeError::Diverged(reason));
        }
        if observation.revision != self.verified_revision {
            let reason = self.diverge(DivergenceKind::StaleRevision);
            return Err(ProposeError::Diverged(reason));
        }
        if self.verified_revision >= crate::contract::MAX_REVISION {
            let reason = self.diverge(DivergenceKind::RevisionExhausted);
            return Err(ProposeError::Diverged(reason));
        }
        // Reject internally inconsistent hand-built plans before dispatch.
        // The plan must exactly match its own semantic operation via the
        // existing directional derivation; any divergence fails closed.
        if plan.rule != plan.operation.rule() {
            let reason = self.diverge(DivergenceKind::PostconditionMismatch);
            return Err(ProposeError::Diverged(reason));
        }
        if plan.required_capability != plan.operation.required_capability() {
            let reason = self.diverge(DivergenceKind::CapabilityRefused);
            return Err(ProposeError::Diverged(reason));
        }
        if plan.preconditions != plan.operation.preconditions() {
            let reason = self.diverge(DivergenceKind::PostconditionMismatch);
            return Err(ProposeError::Diverged(reason));
        }
        if !capabilities.supports(plan.operation.required_capability()) {
            let reason = self.diverge(DivergenceKind::CapabilityRefused);
            return Err(ProposeError::Diverged(reason));
        }
        if plan.preconditions.len() > MAX_PRECONDITIONS
            || !plan
                .preconditions
                .contains(&Precondition::AdapterMustVerifyPostconditions)
        {
            let reason = self.diverge(DivergenceKind::PostconditionMismatch);
            return Err(ProposeError::Diverged(reason));
        }
        // Bound the cloned precondition vector (trusted planner input, but
        // still capped so dispatch stays bounded).
        let mut preconditions = Vec::with_capacity(plan.preconditions.len());
        preconditions.extend_from_slice(&plan.preconditions);
        let dispatch = Dispatch {
            correlation_id: correlation_id.to_owned(),
            owner: self.owner.clone(),
            generation: self.generation.clone(),
            base_revision: self.verified_revision,
            required_capability: plan.required_capability,
            preconditions: preconditions.clone(),
            rule: plan.rule,
            operation: plan.operation.clone(),
            intent: plan.intent.clone(),
        };
        self.pending = Some(Pending {
            correlation_id: correlation_id.to_owned(),
            base_revision: self.verified_revision,
            acked: false,
            preconditions,
            operation: plan.operation.clone(),
        });
        Ok(dispatch)
    }

    /// Record an explicit adapter acknowledgement. Requires an exact binding
    /// match; non-accepted outcomes diverge fail-closed. Malformed shapes
    /// classify to their own typed kind (owner/generation/revision/
    /// correlation) without echo.
    pub fn acknowledge(&mut self, ack: &AdapterAck) -> Result<AckApplied, AckError> {
        if let Some(reason) = self.diverged {
            return Err(AckError::Diverged(reason));
        }
        let Some(pending) = self.pending.as_mut() else {
            return Err(AckError::NoPending);
        };
        if !is_correlation_id(&ack.correlation_id) {
            let reason = self.diverge(DivergenceKind::CorrelationMismatch);
            return Err(AckError::Diverged(reason));
        }
        if !is_owner_id(&ack.owner) {
            let reason = self.diverge(DivergenceKind::OwnerMismatch);
            return Err(AckError::Diverged(reason));
        }
        if !is_generation_id(&ack.generation) {
            let reason = self.diverge(DivergenceKind::GenerationMismatch);
            return Err(AckError::Diverged(reason));
        }
        if !is_revision(ack.base_revision) {
            let reason = self.diverge(DivergenceKind::StaleRevision);
            return Err(AckError::Diverged(reason));
        }
        if ack.owner != self.owner {
            let reason = self.diverge(DivergenceKind::OwnerMismatch);
            return Err(AckError::Diverged(reason));
        }
        if ack.generation != self.generation {
            let reason = self.diverge(DivergenceKind::GenerationMismatch);
            return Err(AckError::Diverged(reason));
        }
        if ack.correlation_id != pending.correlation_id
            || ack.base_revision != pending.base_revision
        {
            let reason = self.diverge(DivergenceKind::CorrelationMismatch);
            return Err(AckError::Diverged(reason));
        }
        match ack.outcome {
            crate::contract::AckOutcome::Accepted => {
                if pending.acked {
                    Ok(AckApplied::DuplicateDiscarded)
                } else {
                    pending.acked = true;
                    Ok(AckApplied::Accepted)
                }
            }
            crate::contract::AckOutcome::RefusedCapability => {
                let reason = self.diverge(DivergenceKind::CapabilityRefused);
                Err(AckError::Diverged(reason))
            }
            crate::contract::AckOutcome::PartialApplication => {
                let reason = self.diverge(DivergenceKind::PartialApplication);
                Err(AckError::Diverged(reason))
            }
            crate::contract::AckOutcome::AdapterLost => {
                let reason = self.diverge(DivergenceKind::AdapterLost);
                Err(AckError::Diverged(reason))
            }
        }
    }

    /// Commit after acknowledgement given a matching fresh post-observation
    /// with explicit native verification. The reported
    /// `verified_preconditions` must bind exactly to the dispatched
    /// preconditions (capped by [`MAX_PRECONDITIONS`]) and the reported
    /// `verified_operation` must bind exactly to the dispatched semantic
    /// operation; any mismatch diverges
    /// as [`DivergenceKind::PostconditionMismatch`] with no commit. Advances
    /// verified state by exactly one revision.
    pub fn verify(&mut self, post: &PostObservation) -> Result<Commit, VerifyError> {
        if let Some(reason) = self.diverged {
            return Err(VerifyError::Diverged(reason));
        }
        let Some(pending) = self.pending.clone() else {
            return Err(VerifyError::NoPending);
        };
        if !pending.acked {
            return Err(VerifyError::NotAcknowledged);
        }
        // Cap the adapter-reported vector before shape validation so an
        // overlong report maps to PostconditionMismatch, not a correlation
        // shape error.
        if post.verified_preconditions.len() > MAX_PRECONDITIONS {
            let reason = self.diverge(DivergenceKind::PostconditionMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if !is_correlation_id(&post.correlation_id) {
            let reason = self.diverge(DivergenceKind::CorrelationMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if !is_owner_id(&post.observation.owner) {
            let reason = self.diverge(DivergenceKind::OwnerMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if !is_generation_id(&post.observation.generation) {
            let reason = self.diverge(DivergenceKind::GenerationMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if !is_revision(post.observation.revision) {
            let reason = self.diverge(DivergenceKind::StaleRevision);
            return Err(VerifyError::Diverged(reason));
        }
        if post.correlation_id != pending.correlation_id {
            let reason = self.diverge(DivergenceKind::CorrelationMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if post.observation.owner != self.owner {
            let reason = self.diverge(DivergenceKind::OwnerMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if post.observation.generation != self.generation {
            let reason = self.diverge(DivergenceKind::GenerationMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if post.observation.revision != pending.base_revision {
            let reason = self.diverge(DivergenceKind::StaleRevision);
            return Err(VerifyError::Diverged(reason));
        }
        if !post.verified {
            let reason = self.diverge(DivergenceKind::PostconditionUnverified);
            return Err(VerifyError::Diverged(reason));
        }
        if post.verified_preconditions != pending.preconditions {
            let reason = self.diverge(DivergenceKind::PostconditionMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if post.verified_operation != pending.operation {
            let reason = self.diverge(DivergenceKind::PostconditionMismatch);
            return Err(VerifyError::Diverged(reason));
        }
        if pending.base_revision >= crate::contract::MAX_REVISION {
            let reason = self.diverge(DivergenceKind::RevisionExhausted);
            return Err(VerifyError::Diverged(reason));
        }
        self.verified_revision = pending.base_revision + 1;
        self.verified_fingerprint = post.observation.fingerprint;
        self.pending = None;
        Ok(Commit {
            revision: self.verified_revision,
            fingerprint: self.verified_fingerprint,
        })
    }

    /// Explicit adapter-loss signal: enters typed fail-closed divergence with
    /// no further dispatch or mutation.
    pub fn note_adapter_loss(&mut self) -> DivergenceKind {
        if let Some(reason) = self.diverged {
            return reason;
        }
        self.diverge(DivergenceKind::AdapterLost)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{AckOutcome, Observation};
    use crate::directional::{
        Capabilities, Capability, Direction, MoveIntent, MoveOperation, NodeId, OutputId,
        Precondition, Rule, WindowId,
    };

    fn intent() -> MoveIntent {
        MoveIntent {
            source_output: OutputId("out-1".to_owned()),
            focused_leaf: NodeId("leaf-1".to_owned()),
            focused_window: WindowId("win-1".to_owned()),
            direction: Direction::Right,
        }
    }

    fn plan() -> MovePlan {
        let operation = MoveOperation::SwapNeighbor {
            rule: Rule::R2a,
            container: NodeId("root".to_owned()),
            neighbor: NodeId("leaf-2".to_owned()),
        };
        let preconditions = operation.preconditions();
        MovePlan {
            intent: intent(),
            rule: Rule::R2a,
            operation,
            required_capability: Capability::SwapNeighbor,
            preconditions,
        }
    }

    fn observation(revision: u64) -> Observation {
        Observation {
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            revision,
            fingerprint: 11,
        }
    }

    fn reconciler() -> Reconciler {
        Reconciler::new("owner-1", "gen-1", 0, 11).expect("valid seed")
    }

    fn ack_for(correlation: &str, base: u64, outcome: AckOutcome) -> AdapterAck {
        AdapterAck {
            correlation_id: correlation.to_owned(),
            owner: "owner-1".to_owned(),
            generation: "gen-1".to_owned(),
            base_revision: base,
            outcome,
        }
    }

    fn post_for(correlation: &str, revision: u64, verified: bool) -> PostObservation {
        PostObservation {
            observation: Observation {
                owner: "owner-1".to_owned(),
                generation: "gen-1".to_owned(),
                revision,
                fingerprint: 22,
            },
            correlation_id: correlation.to_owned(),
            verified,
            verified_preconditions: plan().preconditions.clone(),
            verified_operation: plan().operation.clone(),
        }
    }

    fn post_with_preconditions(
        correlation: &str,
        revision: u64,
        verified: bool,
        verified_preconditions: Vec<Precondition>,
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
            verified_preconditions,
            verified_operation: plan().operation.clone(),
        }
    }

    fn post_with_operation(
        correlation: &str,
        revision: u64,
        verified: bool,
        verified_operation: MoveOperation,
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
            verified_preconditions: plan().preconditions.clone(),
            verified_operation,
        }
    }

    #[test]
    fn happy_path_commits_exactly_one_revision() {
        let mut r = reconciler();
        let source = plan();
        let dispatch = r
            .propose(&source, &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        assert_eq!(dispatch.base_revision, 0);
        assert_eq!(dispatch.correlation_id, "corr-1");
        assert_eq!(dispatch.owner, "owner-1");
        assert_eq!(dispatch.generation, "gen-1");
        assert_eq!(dispatch.preconditions, source.preconditions);
        assert_eq!(dispatch.intent, source.intent);
        assert_eq!(dispatch.operation, source.operation);
        assert_eq!(r.status().state, StateKind::PendingUnacked);
        assert_eq!(
            r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted)),
            Ok(AckApplied::Accepted)
        );
        assert_eq!(r.status().state, StateKind::PendingAcked);
        let commit = r.verify(&post_for("corr-1", 0, true)).expect("verify");
        assert_eq!(commit.revision, 1);
        assert_eq!(r.verified_revision(), 1);
        assert_eq!(r.status().state, StateKind::Verified);
        // Duplicate verify after commit cannot advance again.
        assert_eq!(
            r.verify(&post_for("corr-1", 0, true)),
            Err(VerifyError::NoPending)
        );
        assert_eq!(r.verified_revision(), 1);
    }

    #[test]
    fn at_most_one_pending_plan() {
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("first");
        assert_eq!(
            r.propose(&plan(), &observation(0), "corr-2", &Capabilities::full()),
            Err(ProposeError::PendingExists)
        );
        // Still pending, not diverged; acknowledgement still works.
        assert_eq!(r.status().state, StateKind::PendingUnacked);
        assert_eq!(
            r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted)),
            Ok(AckApplied::Accepted)
        );
    }

    #[test]
    fn stale_observation_diverges_and_fail_closes() {
        let mut r = reconciler();
        assert_eq!(
            r.propose(&plan(), &observation(7), "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
        // No further dispatch or mutation.
        assert_eq!(
            r.propose(&plan(), &observation(0), "corr-2", &Capabilities::full()),
            Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
        );
        assert_eq!(
            r.acknowledge(&ack_for("corr-2", 0, AckOutcome::Accepted)),
            Err(AckError::Diverged(DivergenceKind::StaleRevision))
        );
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn owner_and_generation_mismatch_diverge() {
        let mut r = reconciler();
        let mut bad = observation(0);
        bad.owner = "owner-2".to_owned();
        assert_eq!(
            r.propose(&plan(), &bad, "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(DivergenceKind::OwnerMismatch))
        );
        let mut r = reconciler();
        let mut bad = observation(0);
        bad.generation = "gen-2".to_owned();
        assert_eq!(
            r.propose(&plan(), &bad, "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(DivergenceKind::GenerationMismatch))
        );
    }

    #[test]
    fn capability_refusal_diverges() {
        let mut r = reconciler();
        assert_eq!(
            r.propose(&plan(), &observation(0), "corr-1", &Capabilities::none()),
            Err(ProposeError::Diverged(DivergenceKind::CapabilityRefused))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
    }

    #[test]
    fn plan_without_verify_postcondition_diverges() {
        let mut r = reconciler();
        let mut bad = plan();
        bad.preconditions = vec![Precondition::FocusedLeafOccupiedByFocusedWindow];
        assert_eq!(
            r.propose(&bad, &observation(0), "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(
                DivergenceKind::PostconditionMismatch
            ))
        );
    }

    #[test]
    fn ack_without_pending_is_discarded_without_divergence() {
        let mut r = reconciler();
        assert_eq!(
            r.acknowledge(&ack_for("corr-9", 0, AckOutcome::Accepted)),
            Err(AckError::NoPending)
        );
        assert_eq!(r.status().state, StateKind::Verified);
        // Still usable.
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("usable after discard");
    }

    #[test]
    fn duplicate_ack_is_discarded_without_advancement() {
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        assert_eq!(
            r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted)),
            Ok(AckApplied::Accepted)
        );
        assert_eq!(
            r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted)),
            Ok(AckApplied::DuplicateDiscarded)
        );
        assert_eq!(r.status().state, StateKind::PendingAcked);
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn out_of_order_ack_diverges() {
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        assert_eq!(
            r.acknowledge(&ack_for("corr-2", 0, AckOutcome::Accepted)),
            Err(AckError::Diverged(DivergenceKind::CorrelationMismatch))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
    }

    #[test]
    fn refused_partial_lost_acks_diverge_without_echo() {
        for (outcome, kind) in [
            (
                AckOutcome::RefusedCapability,
                DivergenceKind::CapabilityRefused,
            ),
            (
                AckOutcome::PartialApplication,
                DivergenceKind::PartialApplication,
            ),
            (AckOutcome::AdapterLost, DivergenceKind::AdapterLost),
        ] {
            let mut r = reconciler();
            r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
                .expect("propose");
            assert_eq!(
                r.acknowledge(&ack_for("corr-1", 0, outcome)),
                Err(AckError::Diverged(kind))
            );
            assert!(!format!("{:?}", r.status()).contains("SECRET"));
        }
    }

    #[test]
    fn verify_before_ack_is_rejected_without_divergence() {
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        assert_eq!(
            r.verify(&post_for("corr-1", 0, true)),
            Err(VerifyError::NotAcknowledged)
        );
        assert_eq!(r.status().state, StateKind::PendingUnacked);
    }

    #[test]
    fn unverified_or_stale_post_diverges() {
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
            .expect("ack");
        assert_eq!(
            r.verify(&post_for("corr-1", 0, false)),
            Err(VerifyError::Diverged(
                DivergenceKind::PostconditionUnverified
            ))
        );
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
            .expect("ack");
        assert_eq!(
            r.verify(&post_for("corr-1", 9, true)),
            Err(VerifyError::Diverged(DivergenceKind::StaleRevision))
        );
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
            .expect("ack");
        assert_eq!(
            r.verify(&post_for("corr-2", 0, true)),
            Err(VerifyError::Diverged(DivergenceKind::CorrelationMismatch))
        );
    }

    #[test]
    fn adapter_loss_is_terminal() {
        let mut r = reconciler();
        assert_eq!(r.note_adapter_loss(), DivergenceKind::AdapterLost);
        assert_eq!(r.status().state, StateKind::Divergent);
        assert_eq!(
            r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(DivergenceKind::AdapterLost))
        );
    }

    #[test]
    fn invalid_ids_never_echo_and_diverge_typed() {
        let mut r = reconciler();
        let err = r
            .propose(
                &plan(),
                &observation(0),
                "bad corr id SECRET",
                &Capabilities::full(),
            )
            .expect_err("bad correlation must fail");
        assert_eq!(
            err,
            ProposeError::Diverged(DivergenceKind::CorrelationMismatch)
        );
        assert_eq!(err.kind(), "correlation-mismatch");
        assert!(!err.message().contains("SECRET"));
    }

    #[test]
    fn mismatched_verified_preconditions_diverge_without_commit() {
        let mut r = reconciler();
        let source = plan();
        let dispatch = r
            .propose(&source, &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        assert_eq!(dispatch.preconditions, source.preconditions);
        assert_eq!(dispatch.intent, source.intent);
        r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
            .expect("ack");
        let mut mismatched = source.preconditions.clone();
        mismatched.pop();
        assert_eq!(
            r.verify(&post_with_preconditions("corr-1", 0, true, mismatched)),
            Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
        assert_eq!(
            r.status().divergence,
            Some(DivergenceKind::PostconditionMismatch)
        );
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn overlong_verified_preconditions_diverge_without_commit() {
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
            .expect("ack");
        let overlong = vec![Precondition::AdapterMustVerifyPostconditions; MAX_PRECONDITIONS + 1];
        assert_eq!(
            r.verify(&post_with_preconditions("corr-1", 0, true, overlong)),
            Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn dispatch_carries_complete_semantic_plan_payload() {
        let mut r = reconciler();
        let source = plan();
        let dispatch = r
            .propose(&source, &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        assert_eq!(dispatch.intent, source.intent);
        assert_eq!(dispatch.operation, source.operation);
        assert_eq!(dispatch.rule, source.rule);
        assert_eq!(dispatch.required_capability, source.required_capability);
        assert_eq!(dispatch.preconditions, source.preconditions);
        assert_eq!(dispatch.correlation_id, "corr-1");
        assert_eq!(dispatch.owner, "owner-1");
        assert_eq!(dispatch.generation, "gen-1");
        assert_eq!(dispatch.base_revision, 0);
    }

    #[test]
    fn errors_are_redacted_and_bounded() {
        assert_eq!(ProposeError::PendingExists.kind(), "pending-exists");
        assert!(!ProposeError::PendingExists.message().contains("corr"));
        assert_eq!(AckError::NoPending.kind(), "no-pending");
        assert_eq!(VerifyError::NotAcknowledged.kind(), "not-acknowledged");
    }

    #[test]
    fn inconsistent_rule_diverges_without_dispatch() {
        let mut r = reconciler();
        let mut bad = plan();
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
    }

    #[test]
    fn inconsistent_capability_diverges_without_dispatch() {
        let mut r = reconciler();
        let mut bad = plan();
        bad.required_capability = Capability::WrapPerpendicular;
        assert_eq!(
            r.propose(&bad, &observation(0), "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(DivergenceKind::CapabilityRefused))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
        assert!(!r.status().pending);
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn inconsistent_preconditions_diverge_without_dispatch() {
        let mut r = reconciler();
        let mut bad = plan();
        let mut preconditions = bad.operation.preconditions();
        preconditions.pop();
        bad.preconditions = preconditions;
        assert_eq!(
            r.propose(&bad, &observation(0), "corr-1", &Capabilities::full()),
            Err(ProposeError::Diverged(
                DivergenceKind::PostconditionMismatch
            ))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
        assert!(!r.status().pending);
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn mismatched_verified_operation_diverges_without_commit() {
        let mut r = reconciler();
        let source = plan();
        r.propose(&source, &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
            .expect("ack");
        let other = MoveOperation::WrapPerpendicular {
            rule: Rule::R1,
            container: NodeId("root".to_owned()),
            axis: crate::directional::Axis::Horizontal,
        };
        assert_eq!(
            r.verify(&post_with_operation("corr-1", 0, true, other)),
            Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
        );
        assert_eq!(r.status().state, StateKind::Divergent);
        assert_eq!(r.verified_revision(), 0);
    }

    #[test]
    fn malformed_ack_shapes_classify_typed() {
        // Malformed owner shape while pending diverges as owner mismatch.
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        let mut bad = ack_for("corr-1", 0, AckOutcome::Accepted);
        bad.owner = "bad owner".to_owned();
        assert_eq!(
            r.acknowledge(&bad),
            Err(AckError::Diverged(DivergenceKind::OwnerMismatch))
        );

        // Malformed generation shape diverges as generation mismatch.
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        let mut bad = ack_for("corr-1", 0, AckOutcome::Accepted);
        bad.generation = "GEN-1".to_owned();
        assert_eq!(
            r.acknowledge(&bad),
            Err(AckError::Diverged(DivergenceKind::GenerationMismatch))
        );

        // Out-of-bounds revision shape diverges as stale revision.
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        let bad = ack_for(
            "corr-1",
            crate::contract::MAX_REVISION + 1,
            AckOutcome::Accepted,
        );
        assert_eq!(
            r.acknowledge(&bad),
            Err(AckError::Diverged(DivergenceKind::StaleRevision))
        );

        // Malformed correlation shape still diverges as correlation mismatch.
        let mut r = reconciler();
        r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
            .expect("propose");
        let mut bad = ack_for("corr-1", 0, AckOutcome::Accepted);
        bad.correlation_id = "bad corr".to_owned();
        assert_eq!(
            r.acknowledge(&bad),
            Err(AckError::Diverged(DivergenceKind::CorrelationMismatch))
        );
    }

    #[test]
    fn malformed_verify_shapes_classify_typed() {
        fn acked(r: &mut Reconciler) {
            r.propose(&plan(), &observation(0), "corr-1", &Capabilities::full())
                .expect("propose");
            r.acknowledge(&ack_for("corr-1", 0, AckOutcome::Accepted))
                .expect("ack");
        }
        // Malformed correlation shape.
        let mut r = reconciler();
        acked(&mut r);
        let bad = post_for("bad corr", 0, true);
        assert_eq!(
            r.verify(&bad),
            Err(VerifyError::Diverged(DivergenceKind::CorrelationMismatch))
        );
        // Malformed owner shape.
        let mut r = reconciler();
        acked(&mut r);
        let mut bad = post_for("corr-1", 0, true);
        bad.observation.owner = "bad owner".to_owned();
        assert_eq!(
            r.verify(&bad),
            Err(VerifyError::Diverged(DivergenceKind::OwnerMismatch))
        );
        // Malformed generation shape.
        let mut r = reconciler();
        acked(&mut r);
        let mut bad = post_for("corr-1", 0, true);
        bad.observation.generation = "GEN-1".to_owned();
        assert_eq!(
            r.verify(&bad),
            Err(VerifyError::Diverged(DivergenceKind::GenerationMismatch))
        );
        // Out-of-bounds revision shape.
        let mut r = reconciler();
        acked(&mut r);
        let bad = post_for("corr-1", crate::contract::MAX_REVISION + 1, true);
        assert_eq!(
            r.verify(&bad),
            Err(VerifyError::Diverged(DivergenceKind::StaleRevision))
        );
    }
}
