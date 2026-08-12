# Log: Dogfood Install Packaging

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-12

- Role / unit: Lead / planning / amendment-01
- Result: User-approved specification amended before implementation.
- Files / commit: `docs/changes/dogfood-install-packaging/spec.md`, `docs/changes/dogfood-install-packaging/plan.md`, `docs/changes/dogfood-install-packaging/log.md`
- Verification: Governing decision records host Plasma tools, runtime detection, and hermetic injected test tools; `devenv.nix` is excluded.
- Notes: No live KWin, D-Bus, installation, or configuration action occurred.

## 2026-08-12

- Role / unit: Lead / unit-01 / attempt-01
- Result: Accepted after implementation and isolated prevalidation review.
- Files / commit: `scripts/dogfood-install.sh`
- Verification: `bash -n scripts/dogfood-install.sh` passed; Worker reports injected temporary-root checks covering build/copy, exact uninstall, enable/disable command construction, read-only status, and missing-tool errors.
- Notes: The interface has no host mutation in its verification path and does not modify `devenv.nix`.

## 2026-08-12

- Role / unit: Lead / unit-02 / attempt-01
- Result: Accepted after isolated shell-test review.
- Files / commit: `scripts/dogfood-install.test.sh`
- Verification: `bash -n scripts/dogfood-install.test.sh` and `bash scripts/dogfood-install.test.sh` passed with 108 assertions; all KWin tools are injected fake executables and every root is under `mktemp`.
- Notes: Tests cover successful and failed install paths, exact uninstall scope, enable/disable/reconfigure construction, read-only status, strict parsing, and all missing-tool errors.

## 2026-08-12

- Role / unit: Worker / unit-03 / attempt-01
- Result: Documentation checkpoint completed and recorded pending Lead acceptance: README corrected to match the script, metadata, and controller registrations; plan acceptance-evidence map rewritten with reproducible commands and pending placeholders; backlog entry added.
- Files / commit: `README.md`, `docs/changes/dogfood-install-packaging/plan.md`, `docs/backlog.md`
- Verification: Shortcut identifiers and sequences cross-checked against all 27 `registerShortcut` calls in `kwin/src/controller.ts:629-790`; every shown command, the plugin id, and the install destination checked against `scripts/dogfood-install.sh`; plugin id and config key checked against `kwin/metadata.json`; prerequisite wording checked against `devenv.nix` and the script's `require_tool` paths; session-effect wording checked against `engageCurrentScope` usage in `kwin/src/controller.ts:825,2161`.
- Notes: No live KWin, D-Bus, installation, or configuration action occurred. The typecheck, build, JavaScript, and shell-test baseline commands in the acceptance-evidence map remain unrun, with result placeholders recorded.

## 2026-08-12

- Role / unit: Worker / unit-03 / attempt-02
- Result: Full static verification set run with all results passing; plan records actual results and marks unit-03 complete.
- Files / commit: `docs/changes/dogfood-install-packaging/plan.md`
- Verification: `bash scripts/dogfood-install.test.sh` 108 passes, 0 failures; `npm --prefix kwin run typecheck` exit 0 with both `tsconfig.json` and `tsconfig.test.json`; `npm --prefix kwin run build` exit 0 generating a 154.5kb `contents/code/main.js` in 9ms; `npm --prefix kwin test` exit 0 with 430 tests across 49 suites (430 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo) and its included start-test run 248 passes, 0 failures; `bash scripts/start-test.test.sh` 248 passes, 0 failures.
- Notes: All five commands ran with no live session mutation; Git status was byte-identical before and after; `contents/code/main.js` regenerated identically and remains gitignored. No archive or completion approval is claimed.
