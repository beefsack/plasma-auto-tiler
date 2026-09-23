//! Portable world-level engine: owns per-domain sessions without merging them.
//!
//! Adapter-normalized integer geometry only; no transport, JSON, platform, or
//! process imports. Each logical `(OutputId, WorkspaceId)` domain keeps its
//! own independent [`Session`] (independent revisions, fingerprints,
//! divergence isolation, pending slot, node identity, and outer-gap handling).
//! The engine never merges sessions across domains and never alters
//! fence/binding/transaction ordering: it only owns the world map, the outer
//! gap map, and the owner/generation binding plus the shared
//! propose/commit helpers (`take_usable_session`, `store_committed`).
//!
//! JSON reply fences, correlation echoes, revision checks, pending/pair
//! transaction payloads, and ack/verify/status/cancel dispatch stay in the
//! protocol layer until a typed request/reply boundary exists. A full
//! `handle(event) -> plan/reply` entry point is therefore intentionally out of
//! scope here; this module is the typed world-orchestration slice that such an
//! entry point will later dispatch through.

use std::collections::BTreeMap;

use crate::ids::{GenerationId, OwnerId};
use crate::session::{DomainKey, MAX_DOMAINS, OutputDomain, Session};

/// Portable world engine: per-domain sessions plus binding state.
#[derive(Debug, Clone, Default)]
pub struct Engine {
    sessions: BTreeMap<DomainKey, Session>,
    outer_gaps: BTreeMap<DomainKey, i32>,
    owner: Option<OwnerId>,
    generation: Option<GenerationId>,
}

fn session_domain_matches(session: &Session, domain: &OutputDomain) -> bool {
    session
        .domains()
        .iter()
        .find(|d| d.id == domain.id && d.workspace == domain.workspace)
        .is_some_and(|d| {
            d.bounds == domain.bounds && d.gap == domain.gap && d.adjacent == domain.adjacent
        })
}

fn session_usable(session: &Session) -> bool {
    session.divergence().is_none() && !session.has_pending()
}

/// A committed session with no tiled members and no deferred exceptions holds
/// no topology and must not consume a domain slot.
fn committed_session_is_empty(session: &Session) -> bool {
    session.snapshot().windows.is_empty() && session.exception_count() == 0
}

impl Engine {
    /// Empty retained engine.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of retained domains (bounded by [`MAX_DOMAINS`]).
    #[must_use]
    pub fn retained_domains(&self) -> usize {
        self.sessions.len()
    }

    /// Retained owner binding, if any.
    #[must_use]
    pub fn owner(&self) -> Option<&OwnerId> {
        self.owner.as_ref()
    }

    /// Retained generation binding, if any.
    #[must_use]
    pub fn generation(&self) -> Option<&GenerationId> {
        self.generation.as_ref()
    }

    /// Binding sync: on owner/generation change (adapter restart) discard the
    /// world map and gap map, then rebind. Ordering matches the protocol
    /// boundary exactly; ack/verify/status/cancel dispatch before this call
    /// so a pending session is never discarded or rebound mid-flight.
    pub fn sync_binding(&mut self, owner: &OwnerId, generation: &GenerationId) {
        let owner_changed = self
            .owner
            .as_ref()
            .is_none_or(|o| o.as_str() != owner.as_str());
        let generation_changed = self
            .generation
            .as_ref()
            .is_none_or(|g| g.as_str() != generation.as_str());
        if owner_changed || generation_changed {
            self.sessions.clear();
            self.outer_gaps.clear();
            self.owner = Some(owner.clone());
            self.generation = Some(generation.clone());
        }
    }

    /// Borrow a retained session.
    #[must_use]
    pub fn session(&self, key: &DomainKey) -> Option<&Session> {
        self.sessions.get(key)
    }

    /// Mutably borrow a retained session.
    #[must_use]
    pub fn session_mut(&mut self, key: &DomainKey) -> Option<&mut Session> {
        self.sessions.get_mut(key)
    }

    /// Whether a domain slot exists (including empty/stale slots owned by the
    /// normal seeding path).
    #[must_use]
    pub fn contains(&self, key: &DomainKey) -> bool {
        self.sessions.contains_key(key)
    }

    /// Borrowed ordered domain keys for relocation scans.
    pub fn keys(&self) -> impl Iterator<Item = &DomainKey> {
        self.sessions.keys()
    }

    /// Number of slots including stale ones (relocation capacity check).
    #[must_use]
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Whether no domain slot is retained.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// Ordered retained domain keys.
    #[must_use]
    pub fn domain_keys(&self) -> Vec<DomainKey> {
        self.sessions.keys().cloned().collect()
    }

    /// Retained outer gap for a domain, if any.
    #[must_use]
    pub fn outer_gap(&self, key: &DomainKey) -> Option<i32> {
        self.outer_gaps.get(key).copied()
    }

    /// Borrowed outer-gap entry for protocol fence comparisons.
    #[must_use]
    pub fn outer_gap_ref(&self, key: &DomainKey) -> Option<&i32> {
        self.outer_gaps.get(key)
    }

    /// Remove a domain slot and its outer gap.
    pub fn remove(&mut self, key: &DomainKey) {
        self.sessions.remove(key);
        self.outer_gaps.remove(key);
    }

    /// Direct insert used only by pair-relocation paths that already validated
    /// on a clone and manage capacity explicitly. Normal commits must use
    /// [`Engine::store_committed`].
    pub fn insert_raw(&mut self, key: DomainKey, session: Session, outer_gap: i32) {
        self.outer_gaps.insert(key.clone(), outer_gap);
        self.sessions.insert(key, session);
    }

    /// Restore a session without an outer-gap entry (exact legacy restore
    /// when the source had no gap recorded).
    pub fn insert_session_only(&mut self, key: DomainKey, session: Session) {
        self.sessions.insert(key, session);
    }

    /// Remove only the outer-gap entry (pair-relocation source teardown).
    pub fn remove_outer_gap(&mut self, key: &DomainKey) {
        self.outer_gaps.remove(key);
    }

    /// Record an outer-gap change without touching the session (update-gaps
    /// commit path after `Session::update_domain_gaps` succeeds).
    pub fn set_outer_gap(&mut self, key: DomainKey, outer_gap: i32) {
        self.outer_gaps.insert(key, outer_gap);
    }

    /// Take a usable session clone for the propose/commit path: the slot must
    /// exist, be divergence/pending free, match the observed domain exactly,
    /// and hold topology. Unusable or empty slots are retired lazily without
    /// proposing so a later admission can reuse the slot.
    pub fn take_usable_session(
        &mut self,
        domain_key: &DomainKey,
        domain: &OutputDomain,
    ) -> Option<Session> {
        let session = self.sessions.get(domain_key)?;
        if !session_usable(session) || !session_domain_matches(session, domain) {
            self.sessions.remove(domain_key);
            self.outer_gaps.remove(domain_key);
            return None;
        }
        if committed_session_is_empty(session) {
            self.sessions.remove(domain_key);
            self.outer_gaps.remove(domain_key);
            return None;
        }
        Some(session.clone())
    }

    /// Store a committed session: empty results retire the slot, capacity
    /// misses never evict unrelated domains, otherwise the slot and outer gap
    /// are recorded.
    pub fn store_committed(&mut self, domain_key: DomainKey, session: Session, outer_gap: i32) {
        if committed_session_is_empty(&session) {
            self.sessions.remove(&domain_key);
            self.outer_gaps.remove(&domain_key);
            return;
        }
        if self.sessions.len() >= MAX_DOMAINS && !self.sessions.contains_key(&domain_key) {
            return;
        }
        self.outer_gaps.insert(domain_key.clone(), outer_gap);
        self.sessions.insert(domain_key, session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directional::{OutputId, WorkspaceId};
    use crate::geometry::Rect;
    use std::collections::BTreeMap;

    fn domain(output: &str, workspace: &str) -> OutputDomain {
        OutputDomain {
            id: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 800,
                h: 600,
            },
            gap: 0,
            adjacent: BTreeMap::new(),
        }
    }

    fn new_session(owner: &OwnerId, gen_id: &GenerationId, domain: OutputDomain) -> Session {
        Session::new(
            OwnerId::parse(owner.as_str()).expect("valid"),
            GenerationId::parse(gen_id.as_str()).expect("valid"),
            0,
            7,
            vec![domain],
        )
        .expect("session")
    }

    #[test]
    fn binding_change_clears_world() {
        let mut engine = Engine::new();
        let owner_a = OwnerId::parse("owner-a").expect("valid");
        let owner_b = OwnerId::parse("owner-b").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner_a, &gen_id);
        assert_eq!(engine.owner().expect("bound").as_str(), "owner-a");
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner_a, &gen_id, d);
        engine.insert_raw(key.clone(), session, 0);
        assert_eq!(engine.retained_domains(), 1);
        engine.sync_binding(&owner_a, &gen_id);
        assert_eq!(engine.retained_domains(), 1);
        engine.sync_binding(&owner_b, &gen_id);
        assert_eq!(engine.retained_domains(), 0);
        assert_eq!(engine.outer_gap(&key), None);
    }

    #[test]
    fn empty_commits_retire_and_capacity_never_evicts() {
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner, &gen_id, d);
        engine.store_committed(key.clone(), session.clone(), 4);
        assert_eq!(engine.retained_domains(), 0);
        assert_eq!(engine.outer_gap(&key), None);
        for i in 0..MAX_DOMAINS {
            let d = domain(&format!("out-{i}"), "ws");
            let key = d.key();
            let session = new_session(&owner, &gen_id, d);
            engine.insert_raw(key, session, 0);
        }
        assert_eq!(engine.retained_domains(), MAX_DOMAINS);
        let extra_domain = domain("out-extra", "ws");
        let extra_key = extra_domain.key();
        let extra = new_session(&owner, &gen_id, extra_domain);
        engine.store_committed(extra_key.clone(), extra, 0);
        assert!(!engine.contains(&extra_key));
        assert_eq!(engine.retained_domains(), MAX_DOMAINS);
    }

    #[test]
    fn take_usable_retires_mismatch_without_proposing() {
        let mut engine = Engine::new();
        let owner = OwnerId::parse("owner-a").expect("valid");
        let gen_id = GenerationId::parse("gen-1").expect("valid");
        engine.sync_binding(&owner, &gen_id);
        let d = domain("out", "ws");
        let key = d.key();
        let session = new_session(&owner, &gen_id, d.clone());
        engine.insert_raw(key.clone(), session, 0);
        assert!(engine.take_usable_session(&key, &d).is_none());
        assert!(!engine.contains(&key));
    }
}
