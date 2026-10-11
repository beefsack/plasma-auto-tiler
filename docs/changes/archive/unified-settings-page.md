# Unified Settings Page

## Goal

One settings page from tray Settings, with active border, shortcut overrides,
tiling gaps, and workspace mode together. User decision 2026-09-28, option B:
merge for UX, superseding the recorded split.

## Scope and acceptance

- Retain existing `kwinrc` groups, keys, values, defaults, shortcut button
  behavior, live border reconfigure, gap save -> KWin reconfigure -> controller
  reread -> retained `update-gaps`, and startup-only workspace mode with a
  session-restart note.
- Border persists when the effect is disabled; script settings work without
  the effect. No live KWin testing in this change.
- Verify native build/CTest, KWin tests/typecheck, Rust workspace tests/fmt/
  strict clippy, shell suites and staging; provide production/test line deltas
  and a concise test system `just dev` live-check table.
- Update durable settings decision and obsolete tray target references after
  implementation. Leave `devenv.nix`, `docs/backlog.md`, and the architecture
  review untouched.

## Approach and bounded units

1. Resolve the user-visible Configure-entry routing decision below (resolved).
2. Consolidate the two native KCM pages and save paths without changing
   settings semantics, then align discovery, staging, and behavior tests with
   the selected routing.
3. Update documentation and run offline verification; archive this note after
   evidence is accepted (complete).

## Decision

Decision applying the user's 2026-09-28 option B: retain tray
Settings, KWin Scripts Configure and Desktop Effects Configure, all opening the
same unified page. Keep both installed KCM IDs, namespaces and staging outputs;
use one shared page implementation and two thin plugin factories.

## Outcome and evidence

- Both existing KCM plugin factories subclass the shared page; the tray retains
  its existing effect-KCM target. The two old `.ui` files are removed. No
  controller, shortcut reconciler, kwinrc schema or staging output changed.
- `just build-native-effect` stages all three existing `.so` outputs. Host-
  matched native CTest: 29/29, including combined effect-failure/script-save
  coverage. KWin `npm run typecheck` and `npm test`: 799/799.
- `cargo test --workspace`, `cargo fmt --all -- --check`, and
  `cargo clippy --workspace --all-targets -- -D warnings`: pass. Shell suites:
  dogfood-install 572/0, dev-loop-split 380/0, dev-native-effect 163/0,
  nix-host-kwin-build 93/0, build-kpackage pass. `nix flake show` and
  `nix build path:<checkout>#checks.x86_64-linux.native-effect --no-link`
  passed with the new fileset. Independent review found no concrete defect.
- Live behavior of the combined page and gap pickup is not claimed. The
  combined page is taller than the old individual pages; small-dialog
  scrolling/visibility needs user observation.

## Test-system live check (user-owned)

| Step (`just dev`) | Expected | Red flag |
| --- | --- | --- |
| Open tray Settings, KWin Scripts Configure and Desktop Effects Configure | Each shows border, Shortcuts, gap controls, workspace mode and restart note | Missing group, missing Configure action, clipped/inaccessible controls |
| With two existing tiled windows, change **inner gap** and Save; then change **outer gap** and Save | Windows re-space after each Save without session restart; `[kwin] omnitiler:plan:config-reloaded stage=re-read-queued innerGap=<n> outerGap=<n> applied-unconfirmed`, followed by `[kwin] omnitiler:plan:cmd=<id> kind=update-gaps ... outcome=applied` on a successful retained flight | No re-read line, no `update-gaps`, rejection/failure terminal, or unchanged spacing |
| Change border color/theme/width/radius/window gap and Save, including with effect disabled | Settings persist without effect; when enabled, visible border changes live | Save blocked by effect absence, lost values, or border requires session restart |
| Use Apply Shortcuts, Force Apply/Cancel preview as applicable, and Revert | Existing confirmation, explicit writes and status behavior; ordinary Settings Save leaves shortcuts alone | Silent shortcut mutation, Force without preview, Cancel writes |
| Change workspace mode and Save | Restart note persists; `[kwin] omnitiler:plan:config-reloaded stage=restart-required keys=workspaceMode` when KWin observes the config change; runtime mode remains unchanged | Runtime mode changes without restart, note absent |

KCM `omnitiler.script-config` logs belong to the settings process, not
the `[kwin]` `just dev` stream; a queued reconfigure is not proof of applied
geometry. The physical spacing check is required.
