//! Production transport-independent adapter contract.
//!
//! Portable boundary: bounded opaque ids, immutable normalized observations,
//! transport-neutral dispatch payloads, adapter acknowledgements, and typed
//! divergence. No platform, process, IPC, geometry, or native execution
//! imports; only [`crate::directional`] semantic types.
//!
//! Sealed/versioned policy note: the planning policy itself stays frozen as
//! POC1 evidence in [`crate::directional`] and [`crate::planner_contract`];
//! those modules are conformance evidence and are not re-abstracted here.
//! [`CONTRACT_VERSION`] pins this adapter envelope; [`POLICY_VERSION`] pins
//! the POC1 policy it carries plans from.
//!
//! Error discipline: validators return `bool` and reconciler errors carry
//! only typed [`DivergenceKind`] variants with fixed redacted messages. Input
//! ids are never echoed and no unbounded allocations are made from adapter
//! input (all id lengths are bounded; precondition vectors are capped).

use crate::directional::{Capability, MoveIntent, MoveOperation, Precondition, Rule};
use crate::ids::{CorrelationId, GenerationId, OwnerId};

/// Adapter envelope version.
pub const CONTRACT_VERSION: u32 = 1;
/// Sealed POC1 planning policy version carried by plans.
pub const POLICY_VERSION: u32 = 1;
/// Opaque correlation token bound (shared with [`crate::ids`]).
pub use crate::ids::MAX_CORRELATION_LEN;
/// Opaque generation bound (shared with [`crate::ids`]).
pub use crate::ids::MAX_GENERATION_LEN;
/// Opaque owner token bound (shared with [`crate::ids`]).
pub use crate::ids::MAX_OWNER_LEN;
pub use crate::ids::{is_correlation_id, is_generation_id, is_owner_id};
/// Revision bound (inclusive), shared with planner/POC3 bounds.
pub const MAX_REVISION: u64 = 1_000_000;
/// Precondition vector cap (directional plans carry at most a handful).
pub const MAX_PRECONDITIONS: usize = 8;

/// Revision validity.
#[must_use]
pub const fn is_revision(value: u64) -> bool {
    value <= MAX_REVISION
}

/// Immutable normalized adapter observation.
///
/// `fingerprint` is an opaque adapter-computed hash of the normalized
/// snapshot (transport-neutral `u64`, never interpreted here). The reconciler
/// binds proposals to `owner`/`generation`/`revision` and requires a fresh
/// re-observation at the same base revision after acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub revision: u64,
    pub fingerprint: u64,
}

impl Observation {
    /// Typed construction (ids already validated by [`OwnerId::parse`]).
    #[must_use]
    pub fn new(owner: OwnerId, generation: GenerationId, revision: u64, fingerprint: u64) -> Self {
        Self {
            owner,
            generation,
            revision,
            fingerprint,
        }
    }

    /// Narrow string boundary: parses session ids, checks the revision bound.
    #[must_use]
    pub fn from_strings(
        owner: &str,
        generation: &str,
        revision: u64,
        fingerprint: u64,
    ) -> Option<Self> {
        if !is_revision(revision) {
            return None;
        }
        Some(Self {
            owner: OwnerId::parse(owner)?,
            generation: GenerationId::parse(generation)?,
            revision,
            fingerprint,
        })
    }

    /// Validity without echoing input.
    #[must_use]
    pub fn validate(&self) -> bool {
        is_owner_id(self.owner.as_str())
            && is_generation_id(self.generation.as_str())
            && is_revision(self.revision)
    }
}

/// Transport-neutral dispatch payload emitted on a successful proposal.
/// Native execution is outside the reconciler; the adapter actuates from this.
/// `operation` carries the full semantic plan operation (structural ids only,
/// no geometry or native handles); `rule`/`required_capability`/`preconditions`
/// are the bound execution preconditions derived from it. `intent` is the
/// complete originating semantic intent copied from the source plan so a future
/// adapter can interpret the payload without retaining caller-side state.
/// `owner`/`generation`/`correlation_id`/`base_revision` form the
/// self-describing identity binding for the dispatched plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dispatch {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub required_capability: Capability,
    pub preconditions: Vec<Precondition>,
    pub rule: Rule,
    pub operation: MoveOperation,
    pub intent: MoveIntent,
}

/// Bounded adapter acknowledgement outcome. No free-form error detail: a
/// non-accepted outcome maps to a typed divergence without echo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AckOutcome {
    Accepted,
    RefusedCapability,
    PartialApplication,
    AdapterLost,
}

/// Explicit adapter acknowledgement of a dispatched plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterAck {
    pub correlation_id: CorrelationId,
    pub owner: OwnerId,
    pub generation: GenerationId,
    pub base_revision: u64,
    pub outcome: AckOutcome,
}

impl AdapterAck {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        correlation_id: CorrelationId,
        owner: OwnerId,
        generation: GenerationId,
        base_revision: u64,
        outcome: AckOutcome,
    ) -> Self {
        Self {
            correlation_id,
            owner,
            generation,
            base_revision,
            outcome,
        }
    }

    /// Narrow string boundary: parses session ids without echo.
    #[must_use]
    pub fn from_strings(
        correlation_id: &str,
        owner: &str,
        generation: &str,
        base_revision: u64,
        outcome: AckOutcome,
    ) -> Option<Self> {
        if !is_revision(base_revision) {
            return None;
        }
        Some(Self {
            correlation_id: CorrelationId::parse(correlation_id)?,
            owner: OwnerId::parse(owner)?,
            generation: GenerationId::parse(generation)?,
            base_revision,
            outcome,
        })
    }

    /// Validity without echoing input.
    #[must_use]
    pub fn validate(&self) -> bool {
        is_correlation_id(self.correlation_id.as_str())
            && is_owner_id(self.owner.as_str())
            && is_generation_id(self.generation.as_str())
            && is_revision(self.base_revision)
    }
}

/// Fresh post-observation plus explicit native verification flag. The adapter
/// sets `verified` only after natively verifying plan postconditions, and
/// reports the exact verified precondition vector in `verified_preconditions`
/// plus the exact verified operation in `verified_operation`. The reconciler
/// binds the vector exactly to the dispatched preconditions (capped by
/// [`MAX_PRECONDITIONS`]) and the operation exactly to the dispatched
/// semantic operation; any mismatch diverges as
/// [`DivergenceKind::PostconditionMismatch`] with no commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostObservation {
    pub observation: Observation,
    pub correlation_id: CorrelationId,
    pub verified: bool,
    pub verified_preconditions: Vec<Precondition>,
    pub verified_operation: MoveOperation,
}

impl PostObservation {
    /// Typed construction (ids already validated by `ids` parsers).
    #[must_use]
    pub fn new(
        observation: Observation,
        correlation_id: CorrelationId,
        verified: bool,
        verified_preconditions: Vec<Precondition>,
        verified_operation: MoveOperation,
    ) -> Self {
        Self {
            observation,
            correlation_id,
            verified,
            verified_preconditions,
            verified_operation,
        }
    }

    /// Validity without echoing input (observation plus correlation shape and
    /// bounded precondition vector).
    #[must_use]
    pub fn validate(&self) -> bool {
        self.observation.validate()
            && is_correlation_id(self.correlation_id.as_str())
            && self.verified_preconditions.len() <= MAX_PRECONDITIONS
    }
}

/// Typed fail-closed divergence reasons. Fixed redacted messages only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DivergenceKind {
    StaleRevision,
    OwnerMismatch,
    GenerationMismatch,
    CorrelationMismatch,
    CapabilityRefused,
    PartialApplication,
    AdapterLost,
    PostconditionUnverified,
    PostconditionMismatch,
    RevisionExhausted,
}

impl DivergenceKind {
    /// Stable kind string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StaleRevision => "stale-revision",
            Self::OwnerMismatch => "owner-mismatch",
            Self::GenerationMismatch => "generation-mismatch",
            Self::CorrelationMismatch => "correlation-mismatch",
            Self::CapabilityRefused => "capability-refused",
            Self::PartialApplication => "partial-application",
            Self::AdapterLost => "adapter-lost",
            Self::PostconditionUnverified => "postcondition-unverified",
            Self::PostconditionMismatch => "postcondition-mismatch",
            Self::RevisionExhausted => "revision-exhausted",
        }
    }

    /// Fixed redacted message; never echoes input.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::StaleRevision => "observation revision does not match verified state",
            Self::OwnerMismatch => "owner token does not pin verified state",
            Self::GenerationMismatch => "generation does not match verified state",
            Self::CorrelationMismatch => "correlation does not match the pending plan",
            Self::CapabilityRefused => "adapter cannot realize the required capability",
            Self::PartialApplication => "adapter reported partial application",
            Self::AdapterLost => "adapter contact was lost",
            Self::PostconditionUnverified => "adapter did not verify postconditions",
            Self::PostconditionMismatch => "plan postconditions do not bind the pending plan",
            Self::RevisionExhausted => "revision bound reached",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_bounds_reject_without_echo() {
        assert!(is_owner_id("owner-1"));
        assert!(!is_owner_id(""));
        assert!(!is_owner_id("bad id"));
        assert!(!is_owner_id(&"x".repeat(MAX_OWNER_LEN + 1)));
        assert!(is_generation_id("gen-1"));
        assert!(!is_generation_id("GEN-1"));
        assert!(!is_generation_id(""));
        assert!(is_correlation_id("corr-1"));
        assert!(!is_correlation_id(""));
        assert!(is_revision(MAX_REVISION));
        assert!(!is_revision(MAX_REVISION + 1));
    }

    #[test]
    fn observation_validation_is_typed() {
        let good = Observation::from_strings("owner-1", "gen-1", 0, 7).expect("valid");
        assert!(good.validate());
        assert!(Observation::from_strings("bad owner", "gen-1", 0, 7).is_none());
        assert!(Observation::from_strings("owner-1", "gen-1", MAX_REVISION + 1, 7).is_none());
        assert!(
            AdapterAck::from_strings(
                "corr-1",
                "owner-1",
                "gen-1",
                MAX_REVISION + 1,
                AckOutcome::Accepted,
            )
            .is_none()
        );
        assert!(OwnerId::parse("bad owner").is_none());
    }

    #[test]
    fn divergence_messages_are_fixed() {
        assert_eq!(
            DivergenceKind::StaleRevision.message(),
            "observation revision does not match verified state"
        );
        assert!(!DivergenceKind::OwnerMismatch.message().contains("owner-1"));
    }
}
