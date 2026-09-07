//! Focused offline inverse of the verified POC3 engine swap policy.
//!
//! From verified `H[A,V[C,B]]` focused `B`, `Move Up` must produce
//! `H[A,V[B,C]]` with `B` upper/right, `C` lower/right, `B` still focused, via
//! an `R2a` swap; then `Move Down` must return `H[A,V[C,B]]` with `B` focused.
//! No KWin, D-Bus, fixture, or script involvement.

use plasma_auto_tiler::directional::Direction;
use plasma_auto_tiler::poc3::{
    CleanupModel, CompletionResult, DesiredWindow, DispatchOutcome, EnrolledWindow, Poc3Engine,
    Rect, StartParams,
};

fn enrolled(id: &str) -> EnrolledWindow {
    EnrolledWindow {
        id: id.to_owned(),
        scope: "scope-1".to_owned(),
        rollback: format!("rollback-{id}"),
    }
}

fn start_params() -> StartParams {
    StartParams {
        owner: "owner-1".to_owned(),
        generation: "gen-1".to_owned(),
        scope: "scope-1".to_owned(),
        usable: Rect {
            x: 0,
            y: 0,
            w: 900,
            h: 600,
        },
        gap: 8,
        windows: vec![enrolled("A"), enrolled("B"), enrolled("C")],
        session_rollback: "session-rollback".to_owned(),
        untiled_asserted: true,
        disposable: true,
        restore_capable: true,
        cleanup: CleanupModel::CloseDisposable,
    }
}

fn rect_of(desired: &[DesiredWindow], id: &str) -> Rect {
    desired
        .iter()
        .find(|w| w.id == id)
        .expect("window is desired")
        .rect
}

fn complete(engine: &mut Poc3Engine, revision: u64) {
    engine
        .complete(
            "owner-1",
            "gen-1",
            revision,
            CompletionResult::Applied,
            None,
        )
        .expect("verified completion applies");
}

#[test]
fn swapped_state_move_up_inverts_then_move_down_restores() {
    let mut engine = Poc3Engine::new();
    engine.start(start_params()).expect("start plans");
    complete(&mut engine, 0);

    let DispatchOutcome::Planned(_) = engine
        .dispatch_focus("owner-1", "gen-1", 1, Direction::Right)
        .expect("focus-right dispatches")
    else {
        panic!("focus-right must plan");
    };
    complete(&mut engine, 1);

    let DispatchOutcome::Planned(_) = engine
        .dispatch_move("owner-1", "gen-1", 2, Direction::Down)
        .expect("move-down dispatches")
    else {
        panic!("move-down must plan");
    };
    complete(&mut engine, 2);
    assert_eq!(
        engine.status().topology.as_deref(),
        Some("H[A,V[C,B]]"),
        "setup reaches swapped state"
    );
    assert_eq!(engine.status().focus.as_deref(), Some("B"));

    let DispatchOutcome::Planned(up) = engine
        .dispatch_move("owner-1", "gen-1", 3, Direction::Up)
        .expect("move-up dispatches")
    else {
        panic!("move-up must plan");
    };
    assert_eq!(up.operation.kind, "swap");
    assert_eq!(up.operation.rule, "R2a");
    assert_eq!(up.topology, "H[A,V[B,C]]");
    assert_eq!(up.focus, "B");
    assert_eq!(
        rect_of(&up.desired, "B"),
        Rect {
            x: 454,
            y: 0,
            w: 446,
            h: 296
        },
        "B is upper/right after up"
    );
    assert_eq!(
        rect_of(&up.desired, "C"),
        Rect {
            x: 454,
            y: 304,
            w: 446,
            h: 296
        },
        "C is lower/right after up"
    );
    complete(&mut engine, 3);
    assert_eq!(engine.status().topology.as_deref(), Some("H[A,V[B,C]]"));
    assert_eq!(engine.status().focus.as_deref(), Some("B"));

    let DispatchOutcome::Planned(down) = engine
        .dispatch_move("owner-1", "gen-1", 4, Direction::Down)
        .expect("move-down dispatches")
    else {
        panic!("move-down must plan");
    };
    assert_eq!(down.operation.kind, "swap");
    assert_eq!(down.operation.rule, "R2a");
    assert_eq!(down.topology, "H[A,V[C,B]]");
    assert_eq!(down.focus, "B");
    complete(&mut engine, 4);
    assert_eq!(engine.status().topology.as_deref(), Some("H[A,V[C,B]]"));
    assert_eq!(engine.status().focus.as_deref(), Some("B"));
    assert_eq!(engine.status().revision, 5);
}
