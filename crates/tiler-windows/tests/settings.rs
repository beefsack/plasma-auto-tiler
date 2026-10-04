use std::path::PathBuf;
use tiler_windows::settings::{
    BindingSetting, BindingState, LoadOutcome, PollOutcome, Preset, Settings, build_disabled,
    load_from_dir, parse_chord, poll_for_change, save_to_dir,
};
use tiler_windows::snapkey::{ChordDisable, ChordRemap, Classified, KeyboardConfig, SnapClassify};
use tiler_windows::tiling::{
    CliOverrides, TileOptions, apply_cli_overrides, parse_tile_args_from,
    parse_tile_args_from_with_overrides, tile_options_defaults,
};

static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

struct Temp {
    path: PathBuf,
}

impl Temp {
    fn new(name: &str) -> Self {
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "tiler-settings-{name}-{}-{t}-{n}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("temp dir");
        Self { path }
    }

    fn file(&self) -> PathBuf {
        self.path.join("settings.json")
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| s.to_string()).collect()
}

fn takeover() -> KeyboardConfig {
    KeyboardConfig {
        takeover: true,
        allow_win_l: false,
    }
}

const VK_LWIN: u32 = 91;
const VK_SHIFT: u32 = 16;
const VK_H: u32 = 0x48;
const VK_U: u32 = 0x55;
const VK_G: u32 = 0x47;
const VK_Q: u32 = 0x51;

#[test]
fn store_roundtrip_bumps_revision_and_leaves_no_pending() {
    let temp = Temp::new("roundtrip");
    let mut settings = Settings::default();
    save_to_dir(&temp.path, &mut settings).expect("save");
    assert_eq!(settings.revision, 1, "first save starts at revision 1");
    let LoadOutcome::Loaded(back) = load_from_dir(&temp.path) else {
        panic!("reloads");
    };
    assert_eq!(back, settings);
    save_to_dir(&temp.path, &mut settings).expect("resave");
    assert_eq!(settings.revision, 2);
    let entries: Vec<String> = std::fs::read_dir(&temp.path)
        .expect("read dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, vec!["settings.json".to_owned()]);
}

#[test]
fn malformed_file_reports_and_poll_keeps_last_good_without_rewrite() {
    let temp = Temp::new("malformed");
    let mut settings = Settings::default();
    save_to_dir(&temp.path, &mut settings).expect("save");
    std::fs::write(temp.file(), b"{not json").expect("corrupt");
    assert!(matches!(load_from_dir(&temp.path), LoadOutcome::Invalid(_)));
    // Live poll keeps last-good with a degraded status; bytes untouched.
    let live = tiler_windows::settings::LiveSettings::fresh(settings, None);
    let outcome = poll_for_change(&temp.path, &live);
    let PollOutcome::InvalidKept(reason) = outcome else {
        panic!("keeps last-good, got {outcome:?}");
    };
    assert!(reason.contains("malformed"), "{reason}");
    assert_eq!(std::fs::read(temp.file()).expect("bytes"), b"{not json");
    assert_eq!(live.status, "saved:1");
}

#[test]
fn oversize_and_version_gate_refuse() {
    let temp = Temp::new("bounds");
    let big = vec![b'x'; 70_000];
    std::fs::write(temp.file(), &big).expect("write");
    assert!(matches!(
        load_from_dir(&temp.path),
        LoadOutcome::Invalid(tiler_windows::settings::SettingsError::TooLarge)
    ));
    let settings = Settings {
        v: 2,
        ..Settings::default()
    };
    let text = serde_json::to_string(&settings).expect("json");
    std::fs::write(temp.file(), text).expect("write");
    assert!(matches!(
        load_from_dir(&temp.path),
        LoadOutcome::Invalid(tiler_windows::settings::SettingsError::UnsupportedVersion)
    ));
}

#[test]
fn save_rejects_invalid_without_touching_good_file() {
    let temp = Temp::new("save-guard");
    let mut settings = Settings::default();
    save_to_dir(&temp.path, &mut settings).expect("save");
    let good_bytes = std::fs::read(temp.file()).expect("bytes");
    settings.core.inner_gap = 65;
    assert!(save_to_dir(&temp.path, &mut settings).is_err());
    assert_eq!(std::fs::read(temp.file()).expect("bytes"), good_bytes);
    // Invalid on-disk content also blocks save (no blind overwrite).
    std::fs::write(temp.file(), b"[]").expect("corrupt");
    let mut fresh = Settings::default();
    assert!(save_to_dir(&temp.path, &mut fresh).is_err());
}

#[test]
fn cli_explicit_switches_override_saved_values() {
    let mut settings = Settings::default();
    settings.core.inner_gap = 4;
    settings.core.outer_gap = 12;
    settings.core.border.enabled = false;
    settings.core.keyboard.takeover = false;
    let base = tiler_windows::settings::tile_options_from_settings(&settings);
    assert_eq!(base.inner_gap, 4);
    assert_eq!(base.outer_gap, 12);
    assert!(!base.border.enabled);
    assert!(base.no_keyboard_snap_takeover);
    // Saved values flow through untouched when no switch is given.
    let parsed = parse_tile_args_from(&strings(&["--user-start"]), &base).expect("parsed");
    assert_eq!(parsed.inner_gap, 4);
    assert_eq!(parsed.outer_gap, 12);
    assert!(!parsed.border.enabled);
    assert!(parsed.no_keyboard_snap_takeover);
    // Explicit switches override exactly their lane.
    let parsed = parse_tile_args_from(
        &strings(&[
            "--user-start",
            "--inner-gap",
            "10",
            "--active-border-width",
            "5",
            "--allow-win-l",
        ]),
        &base,
    )
    .expect("parsed");
    assert_eq!(parsed.inner_gap, 10);
    assert_eq!(parsed.outer_gap, 12);
    assert_eq!(parsed.border.style.width, 5.0);
    assert!(!parsed.border.enabled);
    assert!(parsed.allow_win_l);
    // The user-start fence never comes from saved settings.
    assert!(parse_tile_args_from(&strings(&[]), &base).is_err());
    // Gap range still refuses.
    assert!(parse_tile_args_from(&strings(&["--user-start", "--outer-gap", "65"]), &base).is_err());
    // Compiled-in defaults are untouched by the settings base.
    let defaults: TileOptions = tile_options_defaults();
    assert_eq!((defaults.inner_gap, defaults.outer_gap), (8, 8));
}

#[test]
fn cli_overrides_stay_authoritative_across_unrelated_file_apply() {
    // Startup: file says gaps 4/12 with takeover on; CLI pins inner gap 10
    // and the keyboard off switch.
    let mut settings = Settings::default();
    settings.core.inner_gap = 4;
    settings.core.outer_gap = 12;
    let base = tiler_windows::settings::tile_options_from_settings(&settings);
    let (options, cli) = parse_tile_args_from_with_overrides(
        &strings(&[
            "--user-start",
            "--inner-gap",
            "10",
            "--no-keyboard-snap-takeover",
        ]),
        &base,
    )
    .expect("parsed");
    assert_eq!(options.inner_gap, 10);
    assert!(options.no_keyboard_snap_takeover);
    assert_eq!(
        cli,
        CliOverrides {
            inner_gap: Some(10),
            no_keyboard_snap_takeover: Some(true),
            ..CliOverrides::default()
        }
    );
    // Unrelated file apply: gaps back to 8/8, takeover back on, border 5.
    settings.core.inner_gap = 8;
    settings.core.outer_gap = 8;
    settings.core.border.width = 5.0;
    let mut rebased = tiler_windows::settings::tile_options_from_settings(&settings);
    apply_cli_overrides(&mut rebased, &cli);
    assert_eq!(rebased.inner_gap, 10, "CLI gap stays authoritative");
    assert_eq!(rebased.outer_gap, 8, "unrelated file lane applies");
    assert!(
        rebased.no_keyboard_snap_takeover,
        "CLI off switch stays authoritative"
    );
    assert_eq!(
        rebased.border.style.width, 5.0,
        "unrelated file lane applies"
    );
}

#[test]
fn rebind_routes_single_arm_and_old_default_passes_through() {
    // focus-left rebound Win+H -> Win+U: unshifted Win+U focuses left, the
    // shifted chord on the same key passes through (no unintended move),
    // and the rebound-away Win+H passes through too.
    let mut settings = Settings::default();
    settings.bindings.insert(
        "focus-left".to_owned(),
        BindingSetting {
            state: BindingState::Rebind,
            chord: Some("Win+U".to_owned()),
        },
    );
    tiler_windows::settings::validate_settings(&settings).expect("valid");
    let remap = tiler_windows::settings::build_remap(&settings);
    assert_eq!(
        remap,
        vec![ChordRemap {
            from_vk: VK_U,
            from_shift: false,
            to_vk: VK_H
        },]
    );
    let disabled = build_disabled(&settings);
    assert_eq!(
        disabled,
        vec![ChordDisable {
            vk: VK_H,
            shift: false
        }]
    );
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(remap);
    machine.set_disabled(disabled);
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("down");
    let Classified::Snap(intent) = down else {
        panic!("rebound U classifies as the directional arm");
    };
    assert!(intent.consumed && intent.announce);
    assert_eq!(intent.direction, tiler_core::directional::Direction::Left);
    assert_eq!(intent.op, tiler_windows::snapkey::SnapOp::Focus);
    let up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("up");
    assert!(up.consumed() && !up.announce());
    // Shifted Win+U is not the rebound: passes through untracked.
    let mut shifted = SnapClassify::new(takeover());
    shifted.set_remap(vec![ChordRemap {
        from_vk: VK_U,
        from_shift: false,
        to_vk: VK_H,
    }]);
    shifted.set_disabled(vec![ChordDisable {
        vk: VK_H,
        shift: false,
    }]);
    SnapClassify::push(&mut shifted, VK_LWIN, false, true, false);
    SnapClassify::push(&mut shifted, VK_SHIFT, false, true, false);
    assert_eq!(
        SnapClassify::push(&mut shifted, VK_U, false, true, false),
        None,
        "shifted rebound chord passes through: single-arm routing"
    );
    SnapClassify::push(&mut shifted, VK_SHIFT, true, true, false);
    // The rebound-away Win+H passes through on the same machine.
    assert_eq!(
        SnapClassify::push(&mut shifted, VK_H, false, true, false),
        None,
        "rebound-away default passes through"
    );
    assert_eq!(
        SnapClassify::push(&mut shifted, VK_H, true, true, false),
        None,
        "rebound-away pair leaves no hold"
    );
}

#[test]
fn focus_right_safe_rebind_needs_no_win_l_opt_in() {
    // focus-right rebound onto Win+U: the physical chord is not the OS lock
    // chord, so it routes without `allow_win_l`, while physical Win+L still
    // passes through.
    let mut settings = Settings::default();
    settings.bindings.insert(
        "focus-right".to_owned(),
        BindingSetting {
            state: BindingState::Rebind,
            chord: Some("Win+U".to_owned()),
        },
    );
    tiler_windows::settings::validate_settings(&settings).expect("valid");
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(tiler_windows::settings::build_remap(&settings));
    machine.set_disabled(build_disabled(&settings));
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("down");
    let Classified::Snap(intent) = down else {
        panic!("safe rebound routes to focus-right");
    };
    assert!(intent.consumed && intent.announce);
    assert_eq!(intent.direction, tiler_core::directional::Direction::Right);
    assert_eq!(intent.op, tiler_windows::snapkey::SnapOp::Focus);
    let up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("up");
    assert!(up.consumed());
    // Physical Win+L stays gated without opt-in on the same machine.
    assert_eq!(
        SnapClassify::push(&mut machine, 0x4C, false, true, false),
        None,
        "physical Win+L still passes through without opt-in"
    );
}

#[test]
fn takeover_off_preserves_consumed_release_and_mask() {
    let mut machine = SnapClassify::new(takeover());
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_H, false, true, false).expect("down");
    assert!(down.consumed());
    // Live disable: the owner publishes the policy (no hold clearing) and
    // drains the queue (here: the queue drain is owner-side; the classifier
    // half must still swallow the consumed pair and keep the Start mask, so
    // no orphan key-up reaches the OS and no naked Win tap opens Start).
    machine.set_enabled(false);
    let up = SnapClassify::push(&mut machine, VK_H, true, true, false).expect("up");
    assert!(
        up.consumed() && !up.announce(),
        "paired key-up rides the stored consumed verdict"
    );
    // A fresh chord while off passes through with its pair, never consuming.
    let mut off = SnapClassify::new(KeyboardConfig::disabled());
    SnapClassify::push(&mut off, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut off, VK_H, false, true, false).expect("down");
    assert!(!down.consumed() && !down.announce());
    let up = SnapClassify::push(&mut off, VK_H, true, true, false).expect("up");
    assert!(!up.consumed());
}

#[test]
fn mid_hold_remap_removal_pins_pairing_and_swallows() {
    // Win+U rebound to H, removed mid-hold: the repeat stays swallowed
    // without dispatching, the pair still closes consumed, and a fresh
    // press afterwards passes through (no orphan slot, no leaked up).
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(vec![ChordRemap {
        from_vk: VK_U,
        from_shift: false,
        to_vk: VK_H,
    }]);
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("down");
    assert!(down.consumed() && down.announce());
    assert!(machine.key_is_down(VK_U));
    machine.set_remap(Vec::new());
    // Pinned repeat: swallowed, never re-dispatched under the new tables.
    let repeat = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("repeat");
    assert!(repeat.consumed() && !repeat.announce());
    // Pinned pair closes consumed even though the mapping is gone.
    let up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("up");
    assert!(up.consumed() && !up.announce());
    assert!(!machine.key_is_down(VK_U));
    // Fresh press under the new tables passes through untracked.
    assert_eq!(
        SnapClassify::push(&mut machine, VK_U, false, true, false),
        None
    );
    assert_eq!(
        SnapClassify::push(&mut machine, VK_U, true, true, false),
        None
    );
}

#[test]
fn mid_hold_disable_gates_repeat_dispatch_but_keeps_pair() {
    // Consumed Win+H, default disabled mid-hold: the repeat stays swallowed
    // without dispatching (no stale action), the pair still closes consumed.
    let mut machine = SnapClassify::new(takeover());
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_H, false, true, false).expect("down");
    assert!(down.consumed() && down.announce());
    machine.set_disabled(vec![ChordDisable {
        vk: VK_H,
        shift: false,
    }]);
    let repeat = SnapClassify::push(&mut machine, VK_H, false, true, false).expect("repeat");
    assert!(repeat.consumed() && !repeat.announce());
    let up = SnapClassify::push(&mut machine, VK_H, true, true, false).expect("up");
    assert!(up.consumed() && !up.announce());
    // Fresh press under the new tables passes through untracked.
    assert_eq!(
        SnapClassify::push(&mut machine, VK_H, false, true, false),
        None
    );
}

#[test]
fn keep_equivalent_rebind_routes_natively() {
    // focus-left rebound onto its own Win+H: valid, no tables, native focus.
    let mut settings = Settings::default();
    settings.bindings.insert(
        "focus-left".to_owned(),
        BindingSetting {
            state: BindingState::Rebind,
            chord: Some("Win+H".to_owned()),
        },
    );
    tiler_windows::settings::validate_settings(&settings).expect("valid");
    assert!(tiler_windows::settings::build_remap(&settings).is_empty());
    assert!(build_disabled(&settings).is_empty());
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(tiler_windows::settings::build_remap(&settings));
    machine.set_disabled(build_disabled(&settings));
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_H, false, true, false).expect("down");
    let Classified::Snap(intent) = down else {
        panic!("native focus-left still routes");
    };
    assert!(intent.consumed && intent.announce);
    assert_eq!(intent.op, tiler_windows::snapkey::SnapOp::Focus);
}

#[test]
fn remap_up_survives_mid_hold_shift_flip() {
    // Sticky rebound onto Win+Shift+Q: a Shift release before key-up must
    // still close the pair instead of orphaning a stuck hold. Single-polarity:
    // the custom chord matches the sticky (shifted) arm.
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(vec![ChordRemap {
        from_vk: VK_Q,
        from_shift: true,
        to_vk: VK_G,
    }]);
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    SnapClassify::push(&mut machine, VK_SHIFT, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_Q, false, true, false).expect("down");
    let Classified::Sticky(intent) = down else {
        panic!("rebound Q classifies sticky");
    };
    assert!(intent.consumed && intent.announce);
    SnapClassify::push(&mut machine, VK_SHIFT, true, true, false);
    let up = SnapClassify::push(&mut machine, VK_Q, true, true, false).expect("up");
    assert!(up.consumed() && !up.announce());
    assert_eq!(
        SnapClassify::push(&mut machine, VK_Q, true, true, false),
        None,
        "hold closed: no orphan"
    );
}

#[test]
fn rebound_collision_shifted_native_never_repeats_owner() {
    // focus-left rebound Win+U (canonical H) with native shifted
    // Win+Shift+H (move-left) kept: Win, U down (consumed focus), Shift,
    // H down is swallowed as a safe consumed refusal (inheriting the live
    // owner's shape, never dispatched), never U's repeat. Both paired ups
    // stay consumed with no stuck slot.
    use tiler_windows::snapkey::{SnapEdge, SnapOp};
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(vec![ChordRemap {
        from_vk: VK_U,
        from_shift: false,
        to_vk: VK_H,
    }]);
    machine.set_disabled(vec![ChordDisable {
        vk: VK_H,
        shift: false,
    }]);
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("U down");
    let Classified::Snap(focus) = down else {
        panic!("rebound U classifies directional");
    };
    assert_eq!((focus.op, focus.edge), (SnapOp::Focus, SnapEdge::Down));
    assert!(focus.consumed && focus.announce);
    SnapClassify::push(&mut machine, VK_SHIFT, false, true, false);
    let hit = SnapClassify::push(&mut machine, VK_H, false, true, false).expect("H down");
    let Classified::Snap(refused) = hit else {
        panic!("colliding H classifies directional");
    };
    // Never U's repeat: a fresh safe refusal down, consumed and never
    // dispatched. Old shared-slot code returned U's Focus repeat.
    assert_eq!(
        refused.edge,
        SnapEdge::Down,
        "colliding H is a fresh down, not U's repeat"
    );
    assert!(refused.consumed && !refused.announce);
    let h_up = SnapClassify::push(&mut machine, VK_H, true, true, false).expect("H up");
    assert!(h_up.consumed() && !h_up.announce());
    let u_up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("U up");
    assert!(u_up.consumed() && !u_up.announce());
    assert!(!machine.key_is_down(VK_U));
    assert!(!machine.key_is_down(VK_H));
    assert_eq!(
        SnapClassify::push(&mut machine, VK_H, true, true, false),
        None,
        "no stuck slot: extra up passes"
    );
    assert_eq!(
        SnapClassify::push(&mut machine, VK_U, true, true, false),
        None,
        "no stuck slot: extra up passes"
    );
}

#[test]
fn suppressed_rebound_away_up_never_steals_owner_pair() {
    // First U consumed down, suppressed rebound-away H down passes, H up
    // must PASS untracked without closing U's slot; U up still consumed.
    // Old unpinned-up fallback mapped H up to canonical H and stole U's hold.
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(vec![ChordRemap {
        from_vk: VK_U,
        from_shift: false,
        to_vk: VK_H,
    }]);
    machine.set_disabled(vec![ChordDisable {
        vk: VK_H,
        shift: false,
    }]);
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("U down");
    assert!(down.consumed());
    assert_eq!(
        SnapClassify::push(&mut machine, VK_H, false, true, false),
        None,
        "rebound-away H down passes suppressed"
    );
    assert_eq!(
        SnapClassify::push(&mut machine, VK_H, true, true, false),
        None,
        "unrelated H up passes without stealing U's slot"
    );
    assert!(
        machine.key_is_down(VK_U),
        "U hold survives the foreign H tap"
    );
    let u_up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("U up");
    assert!(u_up.consumed() && !u_up.announce());
    assert!(!machine.key_is_down(VK_U));
}

#[test]
fn same_physical_rebound_pins_across_shift_flip() {
    // Same physical U rebound to H: Shift flip mid-hold keeps the pinned
    // Focus op, repeats stay swallowed without dispatching, pair closes
    // consumed. Per-binding single-polarity holds: shifted U never routes.
    use tiler_windows::snapkey::{SnapEdge, SnapOp};
    let mut machine = SnapClassify::new(takeover());
    machine.set_remap(vec![ChordRemap {
        from_vk: VK_U,
        from_shift: false,
        to_vk: VK_H,
    }]);
    machine.set_disabled(vec![ChordDisable {
        vk: VK_H,
        shift: false,
    }]);
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("U down");
    let Classified::Snap(focus) = down else {
        panic!("rebound U classifies directional");
    };
    assert_eq!(focus.op, SnapOp::Focus);
    SnapClassify::push(&mut machine, VK_SHIFT, false, true, false);
    let repeat = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("U repeat");
    let Classified::Snap(rep) = repeat else {
        panic!("pinned U repeat classifies directional");
    };
    assert_eq!((rep.op, rep.edge), (SnapOp::Focus, SnapEdge::Repeat));
    assert!(rep.consumed && !rep.announce);
    SnapClassify::push(&mut machine, VK_SHIFT, true, true, false);
    let up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("U up");
    assert!(up.consumed() && !up.announce());
    assert!(!machine.key_is_down(VK_U));
}

#[test]
fn three_colliders_pair_in_any_release_order_across_remap_change() {
    // Arbitrary bare-API mapping: two rebound physicals plus the native key
    // share one canonical. Owner plus both colliders each close consumed in
    // any release order with no stuck slot and no OS leak, even when the
    // mapping vanishes mid-hold (colliders ride their cached verdict, the
    // owner rides its pin).
    const VK_I: u32 = 0x49;
    let tables = || {
        (
            vec![
                ChordRemap {
                    from_vk: VK_U,
                    from_shift: false,
                    to_vk: VK_H,
                },
                ChordRemap {
                    from_vk: VK_I,
                    from_shift: false,
                    to_vk: VK_H,
                },
            ],
            vec![ChordDisable {
                vk: VK_H,
                shift: false,
            }],
        )
    };
    for owner_first in [false, true] {
        let mut machine = SnapClassify::new(takeover());
        let (remap, disabled) = tables();
        machine.set_remap(remap);
        machine.set_disabled(disabled);
        SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
        let down = SnapClassify::push(&mut machine, VK_U, false, true, false).expect("U down");
        assert!(down.consumed() && down.announce());
        // Native H routes only shifted here (unshifted H is suppressed);
        // rebound I routes only unshifted (single-polarity entries).
        SnapClassify::push(&mut machine, VK_SHIFT, false, true, false);
        let h = SnapClassify::push(&mut machine, VK_H, false, true, false).expect("H collider");
        assert!(h.consumed() && !h.announce());
        SnapClassify::push(&mut machine, VK_SHIFT, true, true, false);
        let i = SnapClassify::push(&mut machine, VK_I, false, true, false).expect("I collider");
        assert!(i.consumed() && !i.announce());
        assert!(machine.key_is_down(VK_U));
        assert!(machine.key_is_down(VK_H));
        assert!(machine.key_is_down(VK_I));
        // Mapping vanishes mid-hold: pairs must still close consumed.
        machine.set_remap(Vec::new());
        if owner_first {
            let up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("U up");
            assert!(up.consumed() && !up.announce());
        }
        let up = SnapClassify::push(&mut machine, VK_I, true, true, false).expect("I up");
        assert!(up.consumed() && !up.announce());
        let up = SnapClassify::push(&mut machine, VK_H, true, true, false).expect("H up");
        assert!(up.consumed() && !up.announce());
        if !owner_first {
            let up = SnapClassify::push(&mut machine, VK_U, true, true, false).expect("U up");
            assert!(up.consumed() && !up.announce());
        }
        assert!(!machine.key_is_down(VK_U));
        assert!(!machine.key_is_down(VK_H));
        assert!(!machine.key_is_down(VK_I));
        assert_eq!(
            SnapClassify::push(&mut machine, VK_U, true, true, false),
            None,
            "no leak: extra U up passes"
        );
    }
}

#[test]
fn compatible_preset_disables_os_conflicting_rows() {
    let mut settings = Settings::default();
    let changed = tiler_windows::settings::apply_preset(&mut settings, Preset::Compatible);
    // Every OS-conflicting row: 8 focus + 4 move-arrow + 3 toggles + 20
    // workspace digits.
    assert_eq!(changed.len(), 35);
    assert!(changed.contains(&"toggle-float"));
    assert!(changed.contains(&"toggle-fullscreen"));
    assert!(changed.contains(&"focus-left"));
    assert!(changed.contains(&"focus-left-arrow"));
    assert!(changed.contains(&"move-left-arrow"));
    assert!(changed.contains(&"workspace-select-1"));
    let effective = tiler_windows::settings::effective_bindings(&settings);
    assert_eq!(effective.len(), 48);
    for row in &effective {
        if tiler_windows::settings::compatible_disabled_ids().contains(&row.id) {
            assert!(!row.active, "{}", row.id);
            assert!(!row.effective, "{}", row.id);
        }
    }
    // Conflict-free letter moves plus sticky stay active.
    for id in [
        "move-left",
        "move-down",
        "move-up",
        "move-right",
        "toggle-sticky",
    ] {
        let row = effective.iter().find(|row| row.id == id).expect("row");
        assert!(row.active && row.effective, "{id}");
    }
    // Conflict text discloses the incomplete containment honestly.
    let catalog = tiler_windows::settings::binding_catalog();
    let float = catalog
        .iter()
        .find(|def| def.id == "toggle-float")
        .expect("row");
    let conflict = float.conflict.expect("conflict text");
    assert!(conflict.contains("cannot fully contain"), "{conflict}");
    // Per-chord conflicts name their OS owner.
    let focus_left = catalog
        .iter()
        .find(|def| def.id == "focus-left")
        .expect("row");
    assert!(
        focus_left.conflict.is_some_and(|c| c.contains("Voice")),
        "{:?}",
        focus_left.conflict
    );
    // Win+L keeps its explicit opt-in gate: focus-right is disabled by the
    // preset, and the classifier still passes physical Win+L through without
    // opt-in.
    let focus_right = effective
        .iter()
        .find(|row| row.id == "focus-right")
        .expect("row");
    assert!(!focus_right.active);
    let mut machine = SnapClassify::new(takeover());
    SnapClassify::push(&mut machine, VK_LWIN, false, true, false);
    assert_eq!(
        SnapClassify::push(&mut machine, 0x4C, false, true, false),
        None,
        "unshifted Win+L passes through without opt-in"
    );
    // Authentic restores every binding while preserving the opt-in.
    settings.core.keyboard.allow_win_l = true;
    tiler_windows::settings::apply_preset(&mut settings, Preset::Authentic);
    assert!(settings.bindings.is_empty());
    assert!(settings.core.keyboard.allow_win_l);
    assert!(parse_chord("Win+L").is_ok());
}

#[test]
fn retained_update_gaps_preserves_topology() {
    use tiler_core::boundary::{CoreCommand, CoreReply};
    use tiler_core::directional::{OutputId, WindowId, WorkspaceId};
    use tiler_core::geometry::Rect;
    use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
    use tiler_core::session::{DomainKey, OutputDomain};

    fn rect() -> Rect {
        Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        }
    }
    let mut engine = tiler_core::engine::Engine::new();
    let owner = OwnerId::parse("tiler-windows").expect("owner");
    let generation = GenerationId::parse("aa").expect("generation");
    engine.sync_binding(&owner, &generation);
    let key = DomainKey {
        output: OutputId("mon-a".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
    };
    let domain = OutputDomain {
        id: OutputId("mon-a".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        bounds: rect(),
        gap: 8,
        adjacent: std::collections::BTreeMap::new(),
    };
    let rows = vec![
        (
            WindowId("w1".to_owned()),
            rect(),
            tiler_core::size_hints::WindowSizeHints::none(),
            false,
        ),
        (
            WindowId("w2".to_owned()),
            rect(),
            tiler_core::size_hints::WindowSizeHints::none(),
            false,
        ),
    ];
    let fingerprint = tiler_windows::tiling::fingerprint(
        &rows
            .iter()
            .map(|(t, r, _, _)| (t.0.clone(), *r))
            .collect::<Vec<_>>(),
    );
    let correlation = CorrelationId::parse("seed").expect("correlation");
    let mut seed = tiler_windows::tiling::build_reconcile_event_for_floating(
        &owner,
        &generation,
        &correlation,
        0,
        fingerprint,
        &domain,
        &key,
        8,
        &rows,
        Some(&WindowId("w1".to_owned())),
    );
    assert!(seed.command == CoreCommand::Reconcile);
    let reply = engine.handle(&seed);
    assert!(
        matches!(reply, CoreReply::Projection(_) | CoreReply::Tiled(_)),
        "seed converges, got {reply:?}"
    );
    let tree_before = format!(
        "{:?}",
        engine.session(&key).expect("session").snapshot().domains
    );
    // Plain reconcile with drifted gaps refuses instead of adopting.
    seed.command = CoreCommand::Reconcile;
    seed.domain.gap = 4;
    seed.outer_gap = 12;
    let reply = engine.handle(&seed);
    let CoreReply::Rejected { kind, .. } = reply else {
        panic!("gap drift must refuse, got {reply:?}");
    };
    assert_eq!(kind, "domain-mismatch");
    // The retained update-gaps path adopts without destroying topology.
    assert!(!tiler_windows::settings::retained_gaps_match(
        &engine, &key, 4, 12
    ));
    seed.command = CoreCommand::UpdateGaps;
    let reply = engine.handle(&seed);
    assert!(
        matches!(reply, CoreReply::Projection(_)),
        "update-gaps adopts, got {reply:?}"
    );
    let tree_after = format!(
        "{:?}",
        engine.session(&key).expect("session").snapshot().domains
    );
    assert_eq!(tree_before, tree_after, "topology survives the gap update");
    assert!(tiler_windows::settings::retained_gaps_match(
        &engine, &key, 4, 12
    ));
    assert_eq!(engine.outer_gap(&key), Some(12));
}
