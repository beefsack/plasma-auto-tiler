# Dev Tray Settings Launch

## Goal and acceptance

- `just dev` builds a worktree tray with an absolute `kcmshell6` path when present; when absent, Settings is unavailable and logged without blocking builds.
- Settings launch outcomes are bounded, redacted tray route diagnostics; unavailable has a behavior regression test.
- Confirm whether the KCM module is discoverable in the current dev-native setup without live Plasma mutation.

## Scope and approach

- Limit code to the dev build recipe, tray launch diagnostics, and affected tests. Do not change the native install lifecycle without a user decision.
- Correct the justfile launcher export and dev-loop shell fixture; verify missing-path evaluation, Cargo env rebuild tracking and integration.
- Verify workspace tests, fmt, strict clippy, affected shell suites on a private bus where needed, and `git diff --check`.

## Outcome

- Confirmed: `tray.rs:27` bakes the launcher, but before this change only the
  Nix package supplied it. One top-level optional justfile export now passes
  the absolute host path to all dev builds, or empty when unavailable. No
  build refusal: the tray stays usable and Settings logs unavailable.
- Settings emits fixed redacted outcomes (launched, already-open, unavailable,
  spawn-failed, check-failed); a direct test exercises the unavailable branch.
- The staged KCM is at the expected `kwin/effects/configs/` path; the current
  shell's `QT_PLUGIN_PATH` and dev-native env script include its stage. Actual
  opening remains a user live check.
- `just --evaluate` returns empty without kcmshell6 and an absolute path with
  it; the dev-loop suite verifies cargo receives both values (380/0). Cargo
  `-vv` reported the environment variable changed and rebuilt the crate in
  both directions. Workspace tests, fmt, strict clippy, `just --fmt --check`,
  the earlier private-bus tray suite (29 + 16), and `git diff --check` pass.
