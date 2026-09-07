//! POC3 offline host-pilot precomputed intents.
//!
//! Rust-authoritative versioned export for exactly three offline actions:
//! start (`H[A,V[B,C]]` focused `A`), focus right (`A` to `B`, topology and
//! shares preserved), and structural down swap of focused `B`
//! (`H[A,V[C,B]]`, focus stays `B`). Every transition is derived by driving
//! the verified [`crate::poc3::Poc3Engine`] (no duplicated movement policy).
//! No live action, no KWin/D-Bus, no TypeScript policy.

use serde::{Deserialize, Serialize};

use crate::directional::Direction;
use crate::poc3::{
    CleanupModel, CompletionResult, DispatchOutcome, EnrolledWindow, IntentView, Poc3Engine, Rect,
    SharesView, StartParams,
};

/// Fixture schema identifier.
pub const HOST_PILOT_SCHEMA: &str = "poc3-host-pilot-v1";
/// Fixture version.
pub const HOST_PILOT_VERSION: u32 = 1;
/// Byte-locked length of the checked-in pretty fixture JSON.
pub const HOST_PILOT_FIXTURE_LEN: usize = 4690;
/// Byte-locked SHA-256 of the checked-in pretty fixture JSON.
pub const HOST_PILOT_FIXTURE_SHA256: &str =
    "b7e7b865800e0f085610cf04a637a070d8ec01f7dde5c0bec13f508480a07257";
/// Canonical owner pin for the offline sequence.
pub const HOST_PILOT_OWNER: &str = "owner-1";
/// Canonical generation pin for the offline sequence.
pub const HOST_PILOT_GENERATION: &str = "gen-1";
/// Canonical scope alias for the offline sequence.
pub const HOST_PILOT_SCOPE: &str = "scope-1";
/// Canonical usable rectangle for the offline sequence.
pub const HOST_PILOT_USABLE: Rect = Rect {
    x: 0,
    y: 0,
    w: 900,
    h: 600,
};
/// Canonical gap for the offline sequence.
pub const HOST_PILOT_GAP: i32 = 8;
/// Canonical enrolled window order: `H[A,V[B,C]]`.
pub const HOST_PILOT_WINDOWS: [&str; 3] = ["A", "B", "C"];

/// Owned operation identity (converted from the engine view).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotOperation {
    pub kind: String,
    pub rule: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub neighbor: Option<String>,
}

/// Owned shares view parallel to the tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotShares {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shares: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<PilotShares>,
}

fn owned_shares(view: &SharesView) -> PilotShares {
    PilotShares {
        window: view.window.clone(),
        axis: view.axis.map(str::to_owned),
        shares: view.shares.clone(),
        children: view.children.iter().map(owned_shares).collect(),
    }
}

/// Owned desired geometry DTO (mirrors engine `DesiredWindow`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotDesired {
    pub id: String,
    pub rect: RectDto,
}

/// One precomputed offline step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotStep {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    pub base_revision: u64,
    pub next_revision: u64,
    pub operation: PilotOperation,
    pub preconditions: Vec<String>,
    pub topology: String,
    pub shares: PilotShares,
    pub focus: String,
    pub desired: Vec<PilotDesired>,
}

fn owned_step(action: &str, direction: Option<&str>, intent: &IntentView) -> PilotStep {
    PilotStep {
        action: action.to_owned(),
        direction: direction.map(str::to_owned),
        base_revision: intent.base_revision,
        next_revision: intent.next_revision,
        operation: PilotOperation {
            kind: intent.operation.kind.to_owned(),
            rule: intent.operation.rule.to_owned(),
            target: intent.operation.target.clone(),
            neighbor: intent.operation.neighbor.clone(),
        },
        preconditions: intent
            .preconditions
            .iter()
            .map(|s| (*s).to_owned())
            .collect(),
        topology: intent.topology.clone(),
        shares: owned_shares(&intent.shares),
        focus: intent.focus.clone(),
        desired: intent
            .desired
            .iter()
            .map(|w| PilotDesired {
                id: w.id.clone(),
                rect: RectDto {
                    x: w.rect.x,
                    y: w.rect.y,
                    w: w.rect.w,
                    h: w.rect.h,
                },
            })
            .collect(),
    }
}

/// Final verified state after completing all three intents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotFinal {
    pub revision: u64,
    pub topology: String,
    pub focus: String,
}

/// Versioned precomputed fixture for the exact offline host-pilot sequence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostPilotFixture {
    pub schema: String,
    pub v: u32,
    pub engine: String,
    pub owner: String,
    pub generation: String,
    pub scope: String,
    pub usable: RectDto,
    pub gap: i32,
    pub windows: Vec<String>,
    pub steps: Vec<PilotStep>,
    pub final_state: PilotFinal,
}

/// Owned usable rectangle DTO (mirrors [`Rect`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RectDto {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

fn enrolled(id: &str) -> EnrolledWindow {
    EnrolledWindow {
        id: id.to_owned(),
        scope: HOST_PILOT_SCOPE.to_owned(),
        rollback: format!("rollback-{id}"),
    }
}

fn start_params() -> StartParams {
    StartParams {
        owner: HOST_PILOT_OWNER.to_owned(),
        generation: HOST_PILOT_GENERATION.to_owned(),
        scope: HOST_PILOT_SCOPE.to_owned(),
        usable: HOST_PILOT_USABLE,
        gap: HOST_PILOT_GAP,
        windows: HOST_PILOT_WINDOWS.iter().map(|id| enrolled(id)).collect(),
        session_rollback: "session-rollback".to_owned(),
        untiled_asserted: true,
        disposable: true,
        restore_capable: true,
        cleanup: CleanupModel::CloseDisposable,
    }
}

fn complete_applied(engine: &mut Poc3Engine, revision: u64) {
    engine
        .complete(
            HOST_PILOT_OWNER,
            HOST_PILOT_GENERATION,
            revision,
            CompletionResult::Applied,
            None,
        )
        .expect("canonical offline completion applies");
}

/// Drive the verified engine through start, focus-right, and move-down,
/// returning the versioned fixture with the three planned intents.
#[must_use]
pub fn host_pilot_fixture() -> HostPilotFixture {
    let mut engine = Poc3Engine::new();
    let start = engine.start(start_params()).expect("canonical start plans");
    let step_start = owned_step("start", None, &start);
    complete_applied(&mut engine, 0);

    let DispatchOutcome::Planned(focus) = engine
        .dispatch_focus(HOST_PILOT_OWNER, HOST_PILOT_GENERATION, 1, Direction::Right)
        .expect("canonical focus-right dispatches")
    else {
        panic!("canonical focus-right must plan, not noop");
    };
    let step_focus = owned_step("focus", Some("right"), &focus);
    complete_applied(&mut engine, 1);

    let DispatchOutcome::Planned(moved) = engine
        .dispatch_move(HOST_PILOT_OWNER, HOST_PILOT_GENERATION, 2, Direction::Down)
        .expect("canonical move-down dispatches")
    else {
        panic!("canonical move-down must plan, not noop");
    };
    let step_move = owned_step("move", Some("down"), &moved);
    complete_applied(&mut engine, 2);

    let status = engine.status();
    let final_state = PilotFinal {
        revision: status.revision,
        topology: status.topology.expect("final topology is known"),
        focus: status.focus.expect("final focus is known"),
    };

    HostPilotFixture {
        schema: HOST_PILOT_SCHEMA.to_owned(),
        v: HOST_PILOT_VERSION,
        engine: "poc3".to_owned(),
        owner: HOST_PILOT_OWNER.to_owned(),
        generation: HOST_PILOT_GENERATION.to_owned(),
        scope: HOST_PILOT_SCOPE.to_owned(),
        usable: RectDto {
            x: HOST_PILOT_USABLE.x,
            y: HOST_PILOT_USABLE.y,
            w: HOST_PILOT_USABLE.w,
            h: HOST_PILOT_USABLE.h,
        },
        gap: HOST_PILOT_GAP,
        windows: HOST_PILOT_WINDOWS.iter().map(|s| (*s).to_owned()).collect(),
        steps: vec![step_start, step_focus, step_move],
        final_state,
    }
}

/// Canonical pretty JSON bytes for the checked-in fixture (trailing newline).
#[must_use]
pub fn host_pilot_fixture_json() -> String {
    let mut text = serde_json::to_string_pretty(&host_pilot_fixture()).expect("fixture serializes");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_sequence_matches_expected_triples() {
        let fixture = host_pilot_fixture();
        assert_eq!(fixture.schema, HOST_PILOT_SCHEMA);
        assert_eq!(fixture.v, HOST_PILOT_VERSION);
        assert_eq!(fixture.steps.len(), 3);

        let start = &fixture.steps[0];
        assert_eq!(start.action, "start");
        assert_eq!((start.base_revision, start.next_revision), (0, 1));
        assert_eq!(start.operation.kind, "init");
        assert_eq!(start.operation.rule, "INIT");
        assert_eq!(start.topology, "H[A,V[B,C]]");
        assert_eq!(start.focus, "A");

        let focus = &fixture.steps[1];
        assert_eq!(focus.action, "focus");
        assert_eq!(focus.direction.as_deref(), Some("right"));
        assert_eq!((focus.base_revision, focus.next_revision), (1, 2));
        assert_eq!(focus.operation.kind, "focus");
        assert_eq!(focus.operation.rule, "FOCUS");
        assert_eq!(focus.topology, "H[A,V[B,C]]");
        assert_eq!(focus.focus, "B");

        let moved = &fixture.steps[2];
        assert_eq!(moved.action, "move");
        assert_eq!(moved.direction.as_deref(), Some("down"));
        assert_eq!((moved.base_revision, moved.next_revision), (2, 3));
        assert_eq!(moved.operation.kind, "swap");
        assert_eq!(moved.operation.rule, "R2a");
        assert_eq!(moved.topology, "H[A,V[C,B]]");
        assert_eq!(moved.focus, "B");

        assert_eq!(fixture.final_state.revision, 3);
        assert_eq!(fixture.final_state.topology, "H[A,V[C,B]]");
        assert_eq!(fixture.final_state.focus, "B");
    }
}
