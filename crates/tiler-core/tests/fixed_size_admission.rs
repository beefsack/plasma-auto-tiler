//! Q2 fixed-size float admission rows (D1-D8, authorized batch).
//!
//! Real `Session`/`Engine` fixtures (no flag mocks): the shared
//! `is_fixed_size` predicate floats newly admitted fixed windows as
//! membership-only automatic exceptions, honors explicit user tile wins
//! (retained set, command origin, or observed suppress signal) for the
//! same live client, bypasses born fullscreen, floats born maximized
//! without a reserved tile, retiles automatic (never intentional) floats,
//! and emits bounded diagnostics without identifiers. Failed proposals
//! and divergences stage nothing; the opt-out path keeps original
//! refusals byte-identical.

use std::collections::BTreeMap;
use tiler_core::boundary::{CoreCommand, CoreEvent, CoreReply};
use tiler_core::contract::{AckOutcome, AdapterAck, LifecycleCapabilities, Observation};
use tiler_core::directional::{Node, OutputId, WindowId, WorkspaceId};
use tiler_core::engine::Engine;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::seed::EngineWindow;
use tiler_core::session::{
    DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError, RefusalKind, Session,
    SessionCommand, SessionObservation,
};
use tiler_core::size_hints::WindowSizeHints;

fn owner() -> OwnerId {
    OwnerId::parse("owner-1").expect("valid")
}
fn generation() -> GenerationId {
    GenerationId::parse("gen-1").expect("valid")
}
fn correlation(value: &str) -> CorrelationId {
    CorrelationId::parse(value).unwrap_or_else(|| panic!("valid correlation {value}"))
}
fn domain() -> OutputDomain {
    OutputDomain {
        id: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        bounds: Rect {
            x: 0,
            y: 0,
            w: 1200,
            h: 800,
        },
        gap: 0,
        adjacent: BTreeMap::new(),
    }
}
fn key() -> DomainKey {
    DomainKey {
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
    }
}
fn fixed_hints() -> WindowSizeHints {
    WindowSizeHints {
        min_w: Some(640),
        min_h: Some(480),
        max_w: Some(640),
        max_h: Some(480),
    }
}
#[allow(clippy::too_many_arguments)]
fn obs(
    window: &str,
    floating: bool,
    fullscreen: bool,
    maximized: bool,
    sticky: bool,
    fixed_auto: bool,
    fixed_suppress: bool,
    hints: WindowSizeHints,
) -> ObservedWindow {
    ObservedWindow {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        floating,
        fullscreen,
        maximized,
        sticky,
        fixed_auto,
        fixed_suppress,
        hints,
    }
}
fn plain(window: &str) -> ObservedWindow {
    obs(
        window,
        false,
        false,
        false,
        false,
        false,
        false,
        WindowSizeHints::none(),
    )
}
fn fixed(window: &str) -> ObservedWindow {
    obs(
        window,
        false,
        false,
        false,
        false,
        false,
        false,
        fixed_hints(),
    )
}
fn observation(base: u64, windows: Vec<ObservedWindow>) -> SessionObservation {
    SessionObservation {
        observation: Observation::new(owner(), generation(), base, 100 + base),
        windows,
    }
}
fn fixed_session() -> Session {
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    session.set_fixed_size_admission(true);
    session
}
fn admit_plain(session: &mut Session, window: &str, corr: &str) {
    admit_with(session, window, corr, false, WindowSizeHints::none());
}
fn admit_with(
    session: &mut Session,
    window: &str,
    corr: &str,
    suppress: bool,
    hints: WindowSizeHints,
) {
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    let mut admitted = plain(window);
    admitted.hints = hints;
    windows.push(admitted);
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let base = session.accepted_revision();
    let plan = session
        .propose(
            &SessionCommand::Admit {
                window: WindowId(window.to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-1".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 120,
                    h: 80,
                },
                suppress_fixed_float: suppress,
            },
            &observation(base, windows),
            &correlation(corr),
            &LifecycleCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("seed admit {window}: {e:?}"));
    session
        .acknowledge(&AdapterAck::new(
            correlation(corr),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("seed ack");
    session
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 200 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("seed verify");
}
fn tiled_ids(session: &Session) -> Vec<String> {
    let mut ids: Vec<String> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect();
    ids.sort();
    ids
}
fn tree_leaf_count(session: &Session) -> usize {
    fn collect(node: &Node, out: &mut usize) {
        match node {
            Node::Leaf { .. } => *out += 1,
            Node::Group { children, .. } => {
                for child in children {
                    collect(child, out);
                }
            }
        }
    }
    let view = session
        .snapshot()
        .domains
        .into_iter()
        .find(|d| d.output.0 == "out-1")
        .expect("domain");
    match view.tree {
        None => 0,
        Some(tree) => {
            let mut count = 0;
            collect(&tree, &mut count);
            count
        }
    }
}

#[test]
fn fixed_brand_new_floats_without_tile_focus_or_geometry() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let focus_before = session.focus();
    let base = session.accepted_revision();
    let result = session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("converge");
    assert_eq!(result.flags_adopted, 1, "fixed admission adopts flags");
    assert_eq!(result.admitted, 0, "fixed admission takes no tiled slot");
    assert_eq!(result.removed, 0);
    assert!(
        session.is_exception(&WindowId("win-f".to_owned())),
        "fixed is exception"
    );
    assert!(
        session.is_automatic_fixed_float(&WindowId("win-f".to_owned())),
        "automatic marker"
    );
    assert_eq!(
        tiled_ids(&session),
        vec!["win-a".to_owned()],
        "tree excludes fixed"
    );
    assert_eq!(tree_leaf_count(&session), 1, "no leaf reserved for fixed");
    assert_eq!(
        session.focus(),
        focus_before,
        "admission never refocuses to fixed"
    );
}

#[test]
fn nonfixed_hint_variants_tile() {
    let variants: Vec<(&str, WindowSizeHints)> = vec![
        (
            "missing-max",
            WindowSizeHints {
                min_w: Some(640),
                min_h: Some(480),
                max_w: None,
                max_h: None,
            },
        ),
        (
            "missing-min",
            WindowSizeHints {
                min_w: None,
                min_h: None,
                max_w: Some(640),
                max_h: Some(480),
            },
        ),
        (
            "one-axis",
            WindowSizeHints {
                min_w: Some(640),
                min_h: Some(100),
                max_w: Some(640),
                max_h: Some(480),
            },
        ),
        (
            "unequal",
            WindowSizeHints {
                min_w: Some(640),
                min_h: Some(480),
                max_w: Some(800),
                max_h: Some(600),
            },
        ),
        (
            "full-zero",
            WindowSizeHints {
                min_w: Some(0),
                min_h: Some(0),
                max_w: Some(0),
                max_h: Some(0),
            },
        ),
        ("unset", WindowSizeHints::none()),
        (
            "negative",
            WindowSizeHints {
                min_w: Some(-1),
                min_h: Some(480),
                max_w: Some(-1),
                max_h: Some(480),
            },
        ),
        (
            "sentinel",
            WindowSizeHints {
                min_w: Some(640),
                min_h: Some(480),
                max_w: Some(i32::MAX),
                max_h: Some(i32::MAX),
            },
        ),
        (
            "out-of-range",
            WindowSizeHints {
                min_w: Some(16385),
                min_h: Some(16385),
                max_w: Some(16385),
                max_h: Some(16385),
            },
        ),
    ];
    for (name, hints) in variants {
        let mut session = fixed_session();
        let base = session.accepted_revision();
        let result = session
            .converge_observation(
                &observation(
                    base,
                    vec![obs(
                        "win-v", false, false, false, false, false, false, hints,
                    )],
                ),
                None,
            )
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_eq!(result.admitted, 1, "{name} tiles");
        assert!(
            !session.is_exception(&WindowId("win-v".to_owned())),
            "{name} not exception"
        );
        assert!(
            !session.is_automatic_fixed_float(&WindowId("win-v".to_owned())),
            "{name} not automatic"
        );
        assert_eq!(
            tiled_ids(&session),
            vec!["win-v".to_owned()],
            "{name} in tree"
        );
    }
}

#[test]
fn partial_zero_vectors_float() {
    for (name, hints) in [
        (
            "w-zero",
            WindowSizeHints {
                min_w: Some(0),
                min_h: Some(480),
                max_w: Some(0),
                max_h: Some(480),
            },
        ),
        (
            "h-zero",
            WindowSizeHints {
                min_w: Some(640),
                min_h: Some(0),
                max_w: Some(640),
                max_h: Some(0),
            },
        ),
    ] {
        let mut session = fixed_session();
        let base = session.accepted_revision();
        session
            .converge_observation(
                &observation(
                    base,
                    vec![obs(
                        "win-p", false, false, false, false, false, false, hints,
                    )],
                ),
                None,
            )
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert!(
            session.is_automatic_fixed_float(&WindowId("win-p".to_owned())),
            "{name} floats"
        );
        assert_eq!(
            tiled_ids(&session),
            Vec::<String>::new(),
            "{name} takes no slot"
        );
    }
}

#[test]
fn hint_transitions_never_reclassify_either_direction() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    // Tiled window becomes fixed: stays tiled (D2).
    let base = session.accepted_revision();
    let result = session
        .converge_observation(&observation(base, vec![fixed("win-a")]), None)
        .expect("hint change converges");
    assert_eq!(
        (result.removed, result.admitted, result.flags_adopted),
        (0, 0, 0),
        "no change"
    );
    assert_eq!(tiled_ids(&session), vec!["win-a".to_owned()]);
    assert!(!session.is_automatic_fixed_float(&WindowId("win-a".to_owned())));
    // Automatic float loses fixed hints: stays floating (D2).
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("admit fixed");
    assert!(session.is_automatic_fixed_float(&WindowId("win-f".to_owned())));
    let base = session.accepted_revision();
    let result = session
        .converge_observation(
            &observation(
                base,
                vec![
                    plain("win-a"),
                    obs(
                        "win-f",
                        true,
                        false,
                        false,
                        false,
                        false,
                        false,
                        WindowSizeHints::none(),
                    ),
                ],
            ),
            None,
        )
        .expect("hint loss converges");
    assert_eq!(
        (result.removed, result.admitted, result.flags_adopted),
        (0, 0, 0),
        "identity kept"
    );
    assert!(
        session.is_exception(&WindowId("win-f".to_owned())),
        "still floating"
    );
    assert!(
        session.is_automatic_fixed_float(&WindowId("win-f".to_owned())),
        "still automatic"
    );
}

#[test]
fn floating_fixed_without_origin_signal_stays_intentional() {
    // Known floating intent is never inferred automatic from hints
    // alone: without the adapter's explicit fixed_auto origin the
    // window floats as an intentional exception.
    let mut session = fixed_session();
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![obs(
                    "win-f",
                    true,
                    false,
                    false,
                    false,
                    false,
                    false,
                    fixed_hints(),
                )],
            ),
            None,
        )
        .expect("converge");
    let id = WindowId("win-f".to_owned());
    assert!(session.is_exception(&id), "floating membership");
    assert!(!session.is_automatic_fixed_float(&id), "no inferred origin");
    // Re-tiled without a suppress signal re-admits plainly (D2): no
    // override is inferred from hints either.
    let base = session.accepted_revision();
    session
        .converge_observation(&observation(base, vec![fixed("win-f")]), None)
        .expect("retile");
    assert!(!session.is_exception(&id), "tiled again");
    assert!(
        !session.has_fixed_tile_override(&id),
        "no inferred override"
    );
}

#[test]
fn fixed_auto_signal_marks_automatic() {
    let mut session = fixed_session();
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![obs(
                    "win-f",
                    true,
                    false,
                    false,
                    false,
                    true,
                    false,
                    fixed_hints(),
                )],
            ),
            None,
        )
        .expect("converge");
    let id = WindowId("win-f".to_owned());
    assert!(session.is_exception(&id));
    assert!(
        session.is_automatic_fixed_float(&id),
        "explicit origin honored"
    );
}

#[test]
fn suppress_signal_tiles_and_records_override() {
    // The adapter-retained tile win crosses admission: a suppressed
    // fixed window tiles and the win stages into the retained set, so
    // later unsuppressed observations keep it tiled.
    let mut session = fixed_session();
    let base = session.accepted_revision();
    let result = session
        .converge_observation(
            &observation(
                base,
                vec![obs(
                    "win-f",
                    false,
                    false,
                    false,
                    false,
                    false,
                    true,
                    fixed_hints(),
                )],
            ),
            None,
        )
        .expect("converge");
    assert_eq!(result.admitted, 1, "suppressed tiles");
    let id = WindowId("win-f".to_owned());
    assert!(!session.is_exception(&id));
    assert!(
        session.has_fixed_tile_override(&id),
        "win mirrored into retained set"
    );
    let base = session.accepted_revision();
    let result = session
        .converge_observation(&observation(base, vec![fixed("win-f")]), None)
        .expect("resync");
    assert_eq!(
        (result.removed, result.admitted, result.flags_adopted),
        (0, 0, 0)
    );
    assert_eq!(tiled_ids(&session), vec!["win-f".to_owned()], "stays tiled");
}

fn unfloat_committed(session: &mut Session, window: &str, corr: &str) {
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    // The unfloat target rides floating until the toggle commits.
    for entry in windows.iter_mut() {
        if entry.window.0 == window {
            entry.floating = true;
        }
    }
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let plan = session
        .propose(
            &SessionCommand::ToggleFloat {
                window: WindowId(window.to_owned()),
                float_geometry: None,
            },
            &observation(base, windows),
            &correlation(corr),
            &LifecycleCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("unfloat {window}: {e:?}"));
    session
        .acknowledge(&AdapterAck::new(
            correlation(corr),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("unfloat ack");
    session
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 200 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("unfloat verify");
}

#[test]
fn explicit_unfloat_wins_across_hide_show() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("admit fixed");
    unfloat_committed(&mut session, "win-f", "c-u");
    let id = WindowId("win-f".to_owned());
    assert!(session.has_fixed_tile_override(&id), "override recorded");
    assert!(!session.is_automatic_fixed_float(&id), "automatic cleared");
    assert_eq!(tiled_ids(&session).len(), 2, "win-f tiled");
    // Hide/show and hint churn keep the explicit tile (D3, D2).
    for round in 0..2 {
        let base = session.accepted_revision();
        let hints = if round == 0 {
            fixed_hints()
        } else {
            WindowSizeHints::none()
        };
        let shown = obs("win-f", false, false, false, false, false, false, hints);
        let result = session
            .converge_observation(&observation(base, vec![plain("win-a"), shown]), None)
            .expect("resync");
        assert_eq!(
            (result.removed, result.admitted, result.flags_adopted),
            (0, 0, 0),
            "no re-float"
        );
        assert!(!session.is_exception(&id), "stays tiled");
    }
    assert!(
        session.has_fixed_tile_override(&id),
        "override survives re-observation"
    );
}

#[test]
fn removal_clears_override_and_replacement_reclassifies() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("admit fixed");
    unfloat_committed(&mut session, "win-f", "c-u");
    let id = WindowId("win-f".to_owned());
    assert!(session.has_fixed_tile_override(&id));
    // Removal drops bookkeeping (D3 fence).
    let base = session.accepted_revision();
    let result = session
        .converge_observation(&observation(base, vec![plain("win-a")]), None)
        .expect("remove");
    assert_eq!(result.removed, 1);
    assert!(
        !session.has_fixed_tile_override(&id),
        "override cleared on removal"
    );
    assert!(!session.is_automatic_fixed_float(&id));
    // A replaced native reference with the same id classifies again.
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("re-admit");
    assert!(
        session.is_automatic_fixed_float(&id),
        "new client floats again"
    );
}

#[test]
fn fixed_maximized_floats_without_tile_nonfixed_maxima_unchanged() {
    let mut session = fixed_session();
    let base = session.accepted_revision();
    // Fixed born maximized: floating base under the native overlay (D4).
    session
        .converge_observation(
            &observation(
                base,
                vec![obs(
                    "win-m",
                    false,
                    false,
                    true,
                    false,
                    false,
                    false,
                    fixed_hints(),
                )],
            ),
            None,
        )
        .expect("max fixed converges");
    assert!(
        session.is_exception(&WindowId("win-m".to_owned())),
        "max fixed floats"
    );
    assert!(session.is_automatic_fixed_float(&WindowId("win-m".to_owned())));
    assert_eq!(
        tree_leaf_count(&session),
        0,
        "no tile reserved under maximize"
    );
    // Nonfixed born maxima tile exactly as before (Q3 unchanged). The
    // maximize overlay itself stays native-only: core membership rides
    // the floating flag, so the retained exception observes floating.
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![
                    obs(
                        "win-m",
                        true,
                        false,
                        false,
                        false,
                        false,
                        false,
                        fixed_hints(),
                    ),
                    obs(
                        "win-n",
                        false,
                        false,
                        true,
                        false,
                        false,
                        false,
                        WindowSizeHints::none(),
                    ),
                ],
            ),
            None,
        )
        .expect("nonfixed max converges");
    assert_eq!(
        tiled_ids(&session),
        vec!["win-n".to_owned()],
        "nonfixed max tiles"
    );
}

#[test]
fn born_fullscreen_bypasses_and_exits_tiled() {
    let mut session = fixed_session();
    let base = session.accepted_revision();
    // Born fullscreen fixed bypasses the classifier (D5).
    let result = session
        .converge_observation(
            &observation(
                base,
                vec![obs(
                    "win-s",
                    false,
                    true,
                    false,
                    false,
                    false,
                    false,
                    fixed_hints(),
                )],
            ),
            None,
        )
        .expect("born FS converges");
    assert_eq!(result.admitted, 1, "born FS takes a tiled slot");
    assert!(
        !session.is_exception(&WindowId("win-s".to_owned())),
        "not floated"
    );
    assert!(
        !session.is_automatic_fixed_float(&WindowId("win-s".to_owned())),
        "no marker"
    );
    // Exiting fullscreen tiles on the tiled workspace (D5).
    let base = session.accepted_revision();
    let result = session
        .converge_observation(&observation(base, vec![fixed("win-s")]), None)
        .expect("FS exit converges");
    assert_eq!(
        (result.removed, result.admitted, result.flags_adopted),
        (0, 0, 0)
    );
    assert_eq!(
        tiled_ids(&session),
        vec!["win-s".to_owned()],
        "tiled on exit"
    );
}

#[test]
fn floating_fullscreen_cycle_restores_floating() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("admit fixed");
    let id = WindowId("win-f".to_owned());
    // A formerly fixed-floating client entering fullscreen keeps floating.
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![
                    plain("win-a"),
                    obs(
                        "win-f",
                        true,
                        true,
                        false,
                        false,
                        false,
                        false,
                        fixed_hints(),
                    ),
                ],
            ),
            None,
        )
        .expect("enter FS");
    assert!(session.is_exception(&id), "floating through FS");
    // Exiting restores floating (D5).
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![
                    plain("win-a"),
                    obs(
                        "win-f",
                        true,
                        false,
                        false,
                        false,
                        false,
                        false,
                        fixed_hints(),
                    ),
                ],
            ),
            None,
        )
        .expect("exit FS");
    assert!(session.is_exception(&id), "restores floating");
    assert!(session.is_automatic_fixed_float(&id), "automatic kept");
}

fn float_intentional(session: &mut Session, window: &str, corr: &str) {
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let plan = session
        .propose(
            &SessionCommand::ToggleFloat {
                window: WindowId(window.to_owned()),
                float_geometry: Some(Rect {
                    x: 10,
                    y: 10,
                    w: 100,
                    h: 80,
                }),
            },
            &observation(base, windows),
            &correlation(corr),
            &LifecycleCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("float {window}: {e:?}"));
    session
        .acknowledge(&AdapterAck::new(
            correlation(corr),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("float ack");
    session
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 200 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("float verify");
}

#[test]
fn workspace_retile_takes_automatic_keeps_intentional() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    admit_plain(&mut session, "win-g", "c-g");
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), plain("win-g"), fixed("win-f")]),
            None,
        )
        .expect("admit fixed");
    float_intentional(&mut session, "win-g", "c-f");
    let auto = WindowId("win-f".to_owned());
    let manual = WindowId("win-g".to_owned());
    assert!(session.is_automatic_fixed_float(&auto));
    assert!(
        !session.is_automatic_fixed_float(&manual),
        "intentional never automatic"
    );
    // Enabling workspace tiling retiles the automatic float (D6) while the
    // intentional float keeps its membership.
    let base = session.accepted_revision();
    let result = session
        .converge_observation(
            &observation(
                base,
                vec![
                    plain("win-a"),
                    obs(
                        "win-g",
                        true,
                        false,
                        false,
                        false,
                        false,
                        false,
                        WindowSizeHints::none(),
                    ),
                    fixed("win-f"),
                ],
            ),
            None,
        )
        .expect("retile");
    assert!(result.flags_adopted >= 1, "retile adopted");
    assert!(!session.is_exception(&auto), "automatic retiled");
    assert!(
        session.has_fixed_tile_override(&auto),
        "retile records tile win"
    );
    assert!(session.is_exception(&manual), "intentional keeps floating");
    assert!(
        !session.has_fixed_tile_override(&manual),
        "intentional untouched"
    );
    assert_eq!(
        tiled_ids(&session),
        vec!["win-a".to_owned(), "win-f".to_owned()],
        "retiled joins tree"
    );
}

#[test]
fn suppress_signal_records_override_on_retile() {
    // An intentional float re-tiled with the adapter's suppress signal
    // (sticky-off-to-tile) records the win; without the signal the
    // re-admit stays plain.
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    admit_plain(&mut session, "win-g", "c-g");
    float_intentional(&mut session, "win-g", "c-f");
    let manual = WindowId("win-g".to_owned());
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![
                    plain("win-a"),
                    obs(
                        "win-g",
                        false,
                        false,
                        false,
                        false,
                        false,
                        true,
                        WindowSizeHints::none(),
                    ),
                ],
            ),
            None,
        )
        .expect("retile with signal");
    assert!(!session.is_exception(&manual));
    assert!(session.has_fixed_tile_override(&manual), "signal recorded");
}

#[test]
fn sticky_adopts_automatic_as_intentional() {
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("admit fixed");
    let id = WindowId("win-f".to_owned());
    assert!(session.is_automatic_fixed_float(&id));
    let base = session.accepted_revision();
    session
        .converge_observation(
            &observation(
                base,
                vec![
                    plain("win-a"),
                    obs(
                        "win-f",
                        true,
                        false,
                        false,
                        true,
                        false,
                        false,
                        fixed_hints(),
                    ),
                ],
            ),
            None,
        )
        .expect("sticky on");
    assert!(session.is_exception(&id), "stays floating");
    assert!(
        !session.is_automatic_fixed_float(&id),
        "sticky is intentional now"
    );
}

#[test]
fn explicit_admit_floats_fixed_as_deferred_without_geometry() {
    // The explicit SessionCommand::Admit route classifies too: no tile,
    // no geometry, focus kept. The suppress origin instead tiles with
    // its win staged transactionally.
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let focus_before = session.focus();
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    windows.push(fixed("win-f"));
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let plan = session
        .propose(
            &SessionCommand::Admit {
                window: WindowId("win-f".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-1".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 120,
                    h: 80,
                },
                suppress_fixed_float: false,
            },
            &observation(base, windows),
            &correlation("c-admit-fixed"),
            &LifecycleCapabilities::full(),
        )
        .expect("fixed admit proposes");
    assert!(
        plan.desired_geometry.is_empty(),
        "membership only, no geometry (D8)"
    );
    assert_eq!(plan.desired_focus_domain, focus_before.0, "focus untouched");
    assert_eq!(plan.desired_focus_leaf, focus_before.1, "focus untouched");
    session
        .acknowledge(&AdapterAck::new(
            correlation("c-admit-fixed"),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    session
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 201),
            correlation("c-admit-fixed"),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("verify");
    assert!(session.is_exception(&WindowId("win-f".to_owned())));
    assert!(session.is_automatic_fixed_float(&WindowId("win-f".to_owned())));
}

#[test]
fn failed_propose_stages_nothing() {
    // A refused fixed admission stages no plan and no markers: the
    // committed sets are exactly untouched.
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    windows.push(fixed("win-f"));
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let error = session
        .propose(
            &SessionCommand::Admit {
                window: WindowId("win-f".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-1".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                // Degenerate bounds refuse before anything stages.
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 0,
                },
                suppress_fixed_float: false,
            },
            &observation(base, windows),
            &correlation("c-fail"),
            &LifecycleCapabilities::full(),
        )
        .expect_err("degenerate bounds refuse");
    assert_eq!(error, ProposeError::Refused(RefusalKind::MalformedInput));
    assert!(!session.has_pending(), "no pending staged");
    assert!(!session.has_pending_desired(), "no desired staged");
    assert!(!session.is_exception(&WindowId("win-f".to_owned())));
    assert!(!session.is_automatic_fixed_float(&WindowId("win-f".to_owned())));
    assert!(!session.has_fixed_tile_override(&WindowId("win-f".to_owned())));
}

#[test]
fn divergence_after_propose_discards_staged_markers() {
    // A divergence between propose and verify clears the staged plan
    // including its fixed-size markers: the committed sets never see
    // the failed admission.
    let mut session = fixed_session();
    admit_plain(&mut session, "win-a", "c-a");
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    windows.push(fixed("win-f"));
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    session
        .propose(
            &SessionCommand::Admit {
                window: WindowId("win-f".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-1".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 120,
                    h: 80,
                },
                suppress_fixed_float: false,
            },
            &observation(base, windows),
            &correlation("c-div"),
            &LifecycleCapabilities::full(),
        )
        .expect("fixed admit proposes");
    assert!(session.has_pending(), "plan pending");
    session.note_adapter_loss();
    assert!(!session.has_pending(), "pending discarded");
    assert!(!session.has_pending_desired(), "desired discarded");
    assert!(
        !session.is_automatic_fixed_float(&WindowId("win-f".to_owned())),
        "no leaked marker"
    );
    assert!(!session.has_fixed_tile_override(&WindowId("win-f".to_owned())));
    assert_eq!(
        tiled_ids(&session),
        vec!["win-a".to_owned()],
        "topology untouched"
    );
}

#[test]
fn optout_keeps_original_refusals_and_tiles_fixed() {
    // With the opt-in off, legacy behavior is byte-identical: fixed
    // hints tile (no classifier), overlay admissions refuse as
    // partial-observation, and unfloat bindings compare exact flags.
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    assert!(!session.fixed_size_admission(), "opt-in defaults off");
    admit_plain(&mut session, "win-a", "c-a");
    // Fixed hints tile without the opt-in.
    let base = session.accepted_revision();
    let result = session
        .converge_observation(
            &observation(base, vec![plain("win-a"), fixed("win-f")]),
            None,
        )
        .expect("converge");
    assert_eq!(result.admitted, 1, "opt-out tiles fixed");
    assert!(!session.is_automatic_fixed_float(&WindowId("win-f".to_owned())));
    assert!(!session.has_fixed_tile_override(&WindowId("win-f".to_owned())));
    // Overlay admission refuses exactly as before.
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    windows.push(obs(
        "win-o",
        false,
        true,
        false,
        false,
        false,
        false,
        fixed_hints(),
    ));
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let error = session
        .propose(
            &SessionCommand::Admit {
                window: WindowId("win-o".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-1".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 120,
                    h: 80,
                },
                suppress_fixed_float: false,
            },
            &observation(base, windows),
            &correlation("c-opt"),
            &LifecycleCapabilities::full(),
        )
        .expect_err("overlay admit refuses");
    assert_eq!(
        error,
        ProposeError::Refused(RefusalKind::PartialObservation)
    );
}

#[test]
fn optout_unfloat_keeps_exact_flag_binding() {
    // Without the opt-in, an unfloat whose observed flags drift from the
    // record (sticky overlay) refuses exactly as before.
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    admit_plain(&mut session, "win-a", "c-a");
    float_intentional(&mut session, "win-a", "c-f");
    let base = session.accepted_revision();
    let mut windows: Vec<ObservedWindow> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| plain(&l.window.0))
        .collect();
    windows.extend(session.exception_observed());
    for entry in windows.iter_mut() {
        if entry.window.0 == "win-a" {
            entry.sticky = true;
        }
    }
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let error = session
        .propose(
            &SessionCommand::ToggleFloat {
                window: WindowId("win-a".to_owned()),
                float_geometry: None,
            },
            &observation(base, windows),
            &correlation("c-opt-u"),
            &LifecycleCapabilities::full(),
        )
        .expect_err("drifted flags refuse");
    assert_eq!(
        error,
        ProposeError::Refused(RefusalKind::PartialObservation)
    );
    assert!(!session.has_pending(), "no pending staged");
}

#[test]
fn fixed_size_reason_vocabulary() {
    use tiler_core::size_hints::{fixed_size_reason, is_fixed_size};
    assert!(is_fixed_size(fixed_hints()));
    assert_eq!(fixed_size_reason(fixed_hints()), "fixed-equal");
    assert_eq!(
        fixed_size_reason(WindowSizeHints::none()),
        "not-fixed-missing"
    );
    assert_eq!(
        fixed_size_reason(WindowSizeHints {
            min_w: Some(-1),
            min_h: None,
            max_w: Some(-1),
            max_h: None
        }),
        "not-fixed-negative"
    );
    assert_eq!(
        fixed_size_reason(WindowSizeHints {
            min_w: Some(1),
            min_h: Some(1),
            max_w: Some(i32::MAX),
            max_h: Some(i32::MAX)
        }),
        "not-fixed-sentinel"
    );
    assert_eq!(
        fixed_size_reason(WindowSizeHints {
            min_w: Some(16385),
            min_h: Some(16385),
            max_w: Some(16385),
            max_h: Some(16385)
        }),
        "not-fixed-out-of-range"
    );
    assert_eq!(
        fixed_size_reason(WindowSizeHints {
            min_w: Some(0),
            min_h: Some(0),
            max_w: Some(0),
            max_h: Some(0)
        }),
        "not-fixed-zero"
    );
    assert_eq!(
        fixed_size_reason(WindowSizeHints {
            min_w: Some(1),
            min_h: Some(1),
            max_w: Some(2),
            max_h: Some(2)
        }),
        "not-fixed-unequal"
    );
}

fn carried(
    window: &str,
    floating: bool,
    fullscreen: bool,
    sticky: bool,
    fixed_auto: bool,
    fixed_suppress: bool,
    hints: WindowSizeHints,
) -> EngineWindow {
    EngineWindow {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        rect: Rect {
            x: 0,
            y: 0,
            w: 200,
            h: 200,
        },
        floating,
        fit_excluded: floating || fullscreen,
        fullscreen,
        sticky,
        fixed_auto,
        fixed_suppress,
        hints,
    }
}
fn plain_carried(window: &str) -> EngineWindow {
    carried(
        window,
        false,
        false,
        false,
        false,
        false,
        WindowSizeHints::none(),
    )
}
fn fixed_carried(window: &str) -> EngineWindow {
    carried(window, false, false, false, false, false, fixed_hints())
}
fn reconcile_event(base: u64, focused: &str, windows: Vec<EngineWindow>, corr: &str) -> CoreEvent {
    CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: correlation(corr),
        revision: base,
        fingerprint: 999,
        domain: domain(),
        domain_key: key(),
        outer_gap: 0,
        focused_window: WindowId(focused.to_owned()),
        windows,
        directional: None,
        directional_target_outer_gap: None,
        target_domain: None,
        target_windows: vec![],
        command: CoreCommand::Reconcile,
    }
}

#[test]
fn engine_fresh_fixed_reports_bounded_diagnostic() {
    // Opt-in engine: fresh foreground+hidden-style adoption classifies (D7).
    let mut engine = Engine::new();
    engine.sync_binding(&owner(), &generation());
    engine.set_fixed_size_admission(true);
    let event = reconcile_event(
        0,
        "win-a",
        vec![plain_carried("win-a"), fixed_carried("win-f")],
        "fixed-eng-1",
    );
    match engine.handle(&event) {
        CoreReply::Tiled(plan) => {
            let ids: Vec<&str> = plan.geometry.iter().map(|g| g.window.0.as_str()).collect();
            assert!(ids.contains(&"win-a"), "sibling tiles {ids:?}");
            assert!(
                !ids.contains(&"win-f"),
                "fixed takes no geometry (D8) {ids:?}"
            );
        }
        CoreReply::Projection(_) => {}
        other => panic!("fresh fixed must plan, got {other:?}"),
    }
    let session = engine.session(&key()).expect("session retained");
    assert!(session.is_automatic_fixed_float(&WindowId("win-f".to_owned())));
    let report = engine
        .last_fixed_admission()
        .expect("fixed report recorded");
    assert_eq!(report.correlation.as_str(), "fixed-eng-1", "correlated");
    assert_eq!(report.reason, "fixed-equal");
    assert_eq!(report.admitted, 1);
    assert_eq!(report.evaluated, 1);
    // A suppressed re-observation after domain release tiles without
    // reclassifying: the adapter-retained win crosses sessions.
    let mut engine2 = Engine::new();
    engine2.sync_binding(&owner(), &generation());
    engine2.set_fixed_size_admission(true);
    let event = reconcile_event(
        0,
        "win-f",
        vec![carried(
            "win-f",
            false,
            false,
            false,
            false,
            true,
            fixed_hints(),
        )],
        "fixed-eng-3",
    );
    match engine2.handle(&event) {
        CoreReply::Tiled(plan) => {
            let ids: Vec<&str> = plan.geometry.iter().map(|g| g.window.0.as_str()).collect();
            assert!(ids.contains(&"win-f"), "suppressed tiles {ids:?}");
        }
        other => panic!("suppressed must tile, got {other:?}"),
    }
    assert!(
        engine2.last_fixed_admission().is_none(),
        "suppression logs no admission"
    );
    // Windows default (opt-in off) keeps exact current behavior: fixed tiles.
    let mut plain_engine = Engine::new();
    plain_engine.sync_binding(&owner(), &generation());
    let event = reconcile_event(
        0,
        "win-a",
        vec![plain_carried("win-a"), fixed_carried("win-f")],
        "fixed-eng-2",
    );
    match plain_engine.handle(&event) {
        CoreReply::Tiled(plan) => {
            let ids: Vec<&str> = plan.geometry.iter().map(|g| g.window.0.as_str()).collect();
            assert!(ids.contains(&"win-f"), "opt-out tiles fixed {ids:?}");
        }
        other => panic!("opt-out must tile, got {other:?}"),
    }
    assert!(
        plain_engine.last_fixed_admission().is_none(),
        "no report when off"
    );
}

fn dom_pair(output: &str, workspace: &str) -> OutputDomain {
    OutputDomain {
        id: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        bounds: Rect {
            x: 0,
            y: 0,
            w: 1200,
            h: 800,
        },
        gap: 0,
        adjacent: BTreeMap::new(),
    }
}

fn obs_homed(
    window: &str,
    floating: bool,
    fixed_suppress: bool,
    hints: WindowSizeHints,
    output: &str,
    workspace: &str,
) -> ObservedWindow {
    ObservedWindow {
        window: WindowId(window.to_owned()),
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        floating,
        fullscreen: false,
        maximized: false,
        sticky: false,
        fixed_auto: false,
        fixed_suppress,
        hints,
    }
}

fn observation_fp(base: u64, fingerprint: u64, windows: Vec<ObservedWindow>) -> SessionObservation {
    SessionObservation {
        observation: Observation::new(owner(), generation(), base, fingerprint),
        windows,
    }
}

fn fixed_session_at(output: &str, workspace: &str) -> Session {
    let mut session = Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![dom_pair(output, workspace)],
    )
    .expect("session");
    session.set_fixed_size_admission(true);
    session
}

/// Full pair/send/split metadata roundtrip for one suppressed tile win
/// plus one automatic float (D3, actual send fixture API).
///
/// Source holds win-keep (plain tile), win-auto (automatic fixed float),
/// and win-sup (fixed, explicitly untilled with a retained override);
/// target holds win-t. Pairing unions the marks, the workspace send
/// carries the suppressed mover, and the split partitions every mark
/// with membership. A refused automatic send stages nothing.
#[test]
fn pair_send_split_preserves_automatic_and_override() {
    let dom_a = dom_pair("out-1", "ws-a");
    let dom_b = dom_pair("out-1", "ws-b");
    let mut source = fixed_session_at("out-1", "ws-a");
    // Plain tile first so later fixed admissions never steal focus.
    let base = source.accepted_revision();
    let plan = source
        .propose(
            &SessionCommand::Admit {
                window: WindowId("win-keep".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-a".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 120,
                    h: 80,
                },
                suppress_fixed_float: false,
            },
            &observation_fp(
                base,
                300,
                vec![obs_homed(
                    "win-keep",
                    false,
                    false,
                    WindowSizeHints::none(),
                    "out-1",
                    "ws-a",
                )],
            ),
            &correlation("pair-keep"),
            &LifecycleCapabilities::full(),
        )
        .expect("admit win-keep");
    source
        .acknowledge(&AdapterAck::new(
            correlation("pair-keep"),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    source
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 301),
            correlation("pair-keep"),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("verify");
    // Both fixed windows admit as automatic floats in one convergence.
    let base = source.accepted_revision();
    let result = source
        .converge_observation(
            &observation_fp(
                base,
                302,
                vec![
                    obs_homed(
                        "win-keep",
                        false,
                        false,
                        WindowSizeHints::none(),
                        "out-1",
                        "ws-a",
                    ),
                    obs_homed("win-auto", false, false, fixed_hints(), "out-1", "ws-a"),
                    obs_homed("win-sup", false, false, fixed_hints(), "out-1", "ws-a"),
                ],
            ),
            None,
        )
        .expect("converge fixed pair");
    assert_eq!(result.flags_adopted, 2, "both fixed float");
    let auto = WindowId("win-auto".to_owned());
    let sup = WindowId("win-sup".to_owned());
    assert!(source.is_automatic_fixed_float(&auto));
    assert!(source.is_automatic_fixed_float(&sup));
    // Explicit unfloat records the suppress override for win-sup only.
    let base = source.accepted_revision();
    let plan = source
        .propose(
            &SessionCommand::ToggleFloat {
                window: sup.clone(),
                float_geometry: None,
            },
            &observation_fp(
                base,
                303,
                vec![
                    obs_homed(
                        "win-keep",
                        false,
                        false,
                        WindowSizeHints::none(),
                        "out-1",
                        "ws-a",
                    ),
                    obs_homed(
                        "win-auto",
                        true,
                        false,
                        WindowSizeHints::none(),
                        "out-1",
                        "ws-a",
                    ),
                    obs_homed(
                        "win-sup",
                        true,
                        false,
                        WindowSizeHints::none(),
                        "out-1",
                        "ws-a",
                    ),
                ],
            ),
            &correlation("pair-unfloat"),
            &LifecycleCapabilities::full(),
        )
        .expect("unfloat win-sup");
    source
        .acknowledge(&AdapterAck::new(
            correlation("pair-unfloat"),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    source
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 304),
            correlation("pair-unfloat"),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("verify");
    assert!(source.has_fixed_tile_override(&sup), "override recorded");
    assert!(!source.is_automatic_fixed_float(&sup), "automatic cleared");
    assert!(
        source.is_automatic_fixed_float(&auto),
        "sibling stays automatic"
    );
    assert!(
        source.sync_focus_from_window(
            &DomainKey {
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-a".to_owned()),
            },
            &sup,
        ),
        "mover focused for the send"
    );
    let mut target = fixed_session_at("out-1", "ws-b");
    let base = target.accepted_revision();
    let plan = target
        .propose(
            &SessionCommand::Admit {
                window: WindowId("win-t".to_owned()),
                output: OutputId("out-1".to_owned()),
                workspace: WorkspaceId("ws-b".to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: Rect {
                    x: 0,
                    y: 0,
                    w: 120,
                    h: 80,
                },
                suppress_fixed_float: false,
            },
            &observation_fp(
                base,
                310,
                vec![obs_homed(
                    "win-t",
                    false,
                    false,
                    WindowSizeHints::none(),
                    "out-1",
                    "ws-b",
                )],
            ),
            &correlation("pair-t"),
            &LifecycleCapabilities::full(),
        )
        .expect("admit win-t");
    target
        .acknowledge(&AdapterAck::new(
            correlation("pair-t"),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    target
        .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 311),
            correlation("pair-t"),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("verify");
    // Roundtrip with no mover: pairing then splitting preserves every
    // mark on its homed side.
    let pair = Session::paired_from_canonical_for_send(
        &source,
        Some(&target),
        vec![dom_a.clone(), dom_b.clone()],
    )
    .expect("pair");
    assert!(
        pair.is_automatic_fixed_float(&auto),
        "pair unions automatic"
    );
    assert!(pair.has_fixed_tile_override(&sup), "pair unions override");
    let (source_rt, target_rt) = pair.split_canonical_pair().expect("split");
    let target_rt = target_rt.expect("target retained");
    assert!(
        source_rt.is_automatic_fixed_float(&auto),
        "automatic stays sourced"
    );
    assert!(
        source_rt.has_fixed_tile_override(&sup),
        "override stays sourced"
    );
    assert!(
        !target_rt.is_automatic_fixed_float(&auto) && !target_rt.has_fixed_tile_override(&sup),
        "target gains no foreign marks"
    );
    // An automatic float is no send mover: the refusal stages nothing.
    let mut pair = Session::paired_from_canonical_for_send(
        &source,
        Some(&target),
        vec![dom_a.clone(), dom_b.clone()],
    )
    .expect("pair for refusal");
    let base = pair.accepted_revision();
    let mut observed: Vec<ObservedWindow> = pair
        .snapshot()
        .windows
        .iter()
        .map(|l| {
            obs_homed(
                &l.window.0,
                false,
                l.window == sup,
                if l.window == sup {
                    fixed_hints()
                } else {
                    WindowSizeHints::none()
                },
                &l.output.0,
                &l.workspace.0,
            )
        })
        .collect();
    observed.extend(pair.exception_observed());
    match pair.propose(
        &SessionCommand::MoveToWorkspace {
            window: auto.clone(),
            target_output: OutputId("out-1".to_owned()),
            target_workspace: WorkspaceId("ws-b".to_owned()),
            follow: true,
        },
        &observation_fp(base, 320, observed),
        &correlation("pair-refuse-auto"),
        &LifecycleCapabilities::full(),
    ) {
        Err(ProposeError::Refused(RefusalKind::NotTiled)) => {}
        other => panic!("automatic send must refuse NotTiled, got {other:?}"),
    }
    assert!(
        pair.is_automatic_fixed_float(&auto),
        "refusal keeps automatic"
    );
    // The suppressed tile win sends: the mover lands tiled on the target
    // with its override, while the automatic sibling never moves.
    let base = pair.accepted_revision();
    let mut observed: Vec<ObservedWindow> = pair
        .snapshot()
        .windows
        .iter()
        .map(|l| {
            obs_homed(
                &l.window.0,
                false,
                l.window == sup,
                if l.window == sup {
                    fixed_hints()
                } else {
                    WindowSizeHints::none()
                },
                &l.output.0,
                &l.workspace.0,
            )
        })
        .collect();
    observed.extend(pair.exception_observed());
    let plan = pair
        .propose(
            &SessionCommand::MoveToWorkspace {
                window: sup.clone(),
                target_output: OutputId("out-1".to_owned()),
                target_workspace: WorkspaceId("ws-b".to_owned()),
                follow: true,
            },
            &observation_fp(base, 321, observed),
            &correlation("pair-send"),
            &LifecycleCapabilities::full(),
        )
        .expect("suppressed send proposes");
    assert!(
        plan.desired_geometry
            .iter()
            .any(|g| g.window == sup && g.workspace.0 == "ws-b"),
        "mover desired on target"
    );
    pair.acknowledge(&AdapterAck::new(
        correlation("pair-send"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    pair.verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
        Observation::new(owner(), generation(), base, 322),
        correlation("pair-send"),
        true,
        plan.dispatch.preconditions.clone(),
        plan.dispatch.operation.clone(),
    ))
    .expect("verify");
    let (source_after, target_after) = pair.split_canonical_pair().expect("split");
    let target_after = target_after.expect("target retained");
    assert!(
        source_after.is_automatic_fixed_float(&auto),
        "automatic never moves"
    );
    assert!(
        !source_after.has_fixed_tile_override(&sup),
        "override travels with the mover, never duplicates"
    );
    assert!(
        target_after.has_fixed_tile_override(&sup),
        "target keeps the tile win"
    );
    assert!(
        !target_after.is_automatic_fixed_float(&sup),
        "moved tile is not automatic"
    );
    let sup_link = target_after
        .snapshot()
        .windows
        .into_iter()
        .find(|l| l.window == sup)
        .expect("mover tiled on target");
    assert_eq!(sup_link.workspace.0, "ws-b", "mover homed on target");
    assert!(
        target_after
            .snapshot()
            .windows
            .iter()
            .any(|l| l.window.0 == "win-t"),
        "target survivor undisturbed"
    );
}
