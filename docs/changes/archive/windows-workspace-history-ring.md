# Windows workspace history and relative selection

## Goal and scope

- Deliver handoff item 1, decisions Workspaces 1.1-1.5: local stable-ID
  previous-view toggle and full existing ordinal ring, exact Ctrl/Tab action
  routing, settings/UI/presets. Shared core is owned by the concurrent KDE agent.
- Non-local workspace modes, multi-output runtime and physical-input acceptance
  remain pending. No persistent history or separate history control.

## Acceptance and approach

- Record completed observed view transitions, not attempts or same-view/output
  focus. Removed/out-of-scope IDs invalidate without recreation.
- Toggle alternates two views; relative selection wraps all existing IDs,
  including trailing empty and >9, without creating workspaces.
- Preserve exact modifier/action routing, consumed hold pairing, live settings,
  queue saturation and mask reservations. Compatible disables only the new
  Win+Ctrl+Left/Right rows; unknown OS ownership is reported honestly.
- Bounded units: adapter/input implementation; independent public-contract
  review; native owned-app live verification; Lead evidence/docs/publication.

## Verification and accepted evidence

- 2026-10-10, base `91db9d2` plus item-1 adapter diff: Worker reports native
  allowlisted build/test/fmt/strict clippy and diff checks green after repairs.
- Independent review found Previous autorepeat dispatch contradicted the
  promised toggle hold behavior and a removal regression bypassed actual
  cleanup. Both repaired once: toggle repeats stay consumed without dispatch;
  regression now removes a real previously visited workspace through cleanup.
- Non-local helpers are pure-only; no runtime completion is claimed.

## Authorized live experiment

- Physical Windows 11 host, one display, ordinary medium-integrity owner.
  User authorized synthetic input/cursor and disposable Notepad, Calculator,
  Paint windows. Never manage, activate, move or close the pre-existing opencode
  terminal or any other pre-existing window. Scope the owner to exact owned
  test resources using existing proof fences.
- Bounded history/relative chords and validated rebind probes only; avoid
  Win+G/Win+F11. No registry/policy writes or forced-crash experiment.
- Read live-windows-testing.md; prove independent stop/restore and hook release
  first. Record artifact SHA-256, source diff, OS/display baseline, exact owner
  and app identities, native effects and restoration readbacks. End owner
  stopped, hooks released, hidden test windows revealed, owned settings restored
  and test apps closed. Physical-input outcomes remain user-owned.
- Agent-observed normal scoped Notepad/Calculator/Paint select-2/select-1
  verified hide/reveal and retained minimize state. This is producer-path
  evidence, not a native history-chord result. Production ignores injected
  keyboard input; the marked-input proof path accepts helper windows only.
- Evidence: `C:/Users/beefs/AppData/Local/Temp/opencode/item1-live-20261010/`
  (`workspace-normal-report.json`, `stop-restore-proof.txt`,
  `evidence-final.json`), and ignored
  `target/windows-workspace-normal/20261010-215707-23332/`.
- Artifact `tiler-windows.exe` SHA-256:
  `30A86EF2A5B552BD3DB5DE2F0DE7AD5A5774B3423DF7426D7A1874B15864BDB2`.
  Source: `91db9d2` plus this piece's adapter diff. Host build 26300,
  DISPLAY1 primary, full [0,0,2560,1440], work [0,0,2560,1380], DPI 120.
- Owner PID 8784, creation `01dd58a6183c2ad1`, exact copied artifact path
  in the report. Owner session/integrity were not persisted and remain unknown;
  this limits runbook provenance and native acceptance claims.
- Worker deviated from its narrower brief by also running emergency-stop
  cycles and a helper hide/restore probe. These are recorded observations,
  not expanded standing authority; do not repeat without explicit scope.
- Final readbacks: actors/ledger residue empty, owned test HWNDs gone,
  pre-existing HWNDs intact, settings preimage (absence) restored,
  SPI arranging=true and pen=35 restored. Owner exit releases its hooks.
- History hook journeys, UI Apply/Revert and physical suppression remain
  pending; Compatible/Authentic routing and full modifiers are tested offline.

## Environment incident

- Initial documented `mise exec -- rustc -vV` unexpectedly auto-installed root
  declared tools and updated Rust 1.98.1 to 1.99.0 before installation approval.
  Lead stopped and reported. Orchestrator accepted those installed tools
  (tentative, pending user review) as matching mise.toml and pre-1.0 policy.
- All subsequent mise commands use `MISE_AUTO_INSTALL=0`; new installs block.
  Verified PS7 7.6.6 Core and Rust host x86_64-pc-windows-msvc.

## Outcome

- Item 1 delivered offline, Windows-adapter-only. Lead independently reran
  all four allowlisted build/test/fmt/clippy gates and `git diff --check`
  successfully after the latest repairs (2026-10-10).
- Matrix/spec evidence is revision-bound to base `91db9d2` plus this record's
  delivery commit. User-owned physical journeys, non-local modes and
  multi-output runtime remain pending. Linux/KWin gates await post-push CI.
