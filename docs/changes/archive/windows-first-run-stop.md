# Windows first-run prompt stop cancellation

## Goal and acceptance

- A graceful stop while the first-run preset prompt is pending dismisses it,
  publishes no preset/settings file, and reaches ordinary owner teardown.
- Preserve owner-lease-before-UI ordering and atomic create-if-absent publication.
- Cover cancellation and publication races with offline regression tests.

## Scope and plan

- Windows owner/prompt adapter and focused offline tests only.
- Implementation supplies source/test evidence; review, native gates,
  outcome records, and publication of the accepted fix.
- No live tests, owner launches, window/hook probes, or dependency installs.

## Verification

- Native build/test/fmt/strict clippy for the four Windows-allowlisted crates;
  whitespace check and post-push CI.
- Pending user check: start without settings, leave the prompt open, request
  graceful stop, verify prompt dismissal, no settings publication, hook release
  and session-setting restoration.

## Outcome and evidence (2026-10-11)

- Offline-delivered; live check pending. Blocking `MessageBoxW` prevented the
  owner thread from observing stop. Replaced it with an exact owned native
  Authentic/Compatible dialog and a 50 ms stop-aware message pump. Cancellation
  synchronously destroys that owned window; stop wins a pending choice before
  the write-capable outcome branch. Existing graceful teardown remains in use.
- Eight regression tests drive the real outcome/publication path: cancellation
  for both choices, dismissal, both presets, mid-prompt file appearance,
  publication race loss, and concurrent single-winner publication. Portable
  decision tests cover pre-stop and file-present prompt suppression.
- Rejected initial approach: title-based dismissal of a threaded Yes/No message
  box could address unrelated UI and did not guarantee dismissal. Replaced
  before acceptance. Independent review verified ownership, lease ordering,
  publication and teardown; font/quit cleanup findings were repaired.
- Native four-crate locked offline build/tests/fmt/clippy (`-D warnings`) and
  `git diff --check` passed. Eight existing window-creating tests deliberately
  skipped: four `native_topmost_hide` cases and four restart-adoption cases
  (`sticky_markers_readopt_through_real_tileloop_twice`,
  `float_marker_readopts_through_real_tileloop`,
  `mixed_markers_readopt_through_real_tileloop_in_any_order`,
  `marker_install_remove_roundtrip_on_owned_window`). No live actions ran.
- Windows-only publication regression file is platform-gated because its real
  owner outcome path is Windows-only. CI passed for delivery `94fa4ef`
  ([run](https://github.com/beefsack/OmniTiler/actions/runs/38104575289)).
- User live check: preserve existing settings, arrange an absent settings file,
  start `tile --user-start --trace`, leave the dialog unclicked, and request
  `just --justfile windows.justfile stop` from a second shell. Verify dismissal,
  no settings file, stopped owner, hook release, hidden-window reveal and owned
  session-setting restoration. Check each preset separately still publishes
  correctly; restore the user's prior settings afterward.
