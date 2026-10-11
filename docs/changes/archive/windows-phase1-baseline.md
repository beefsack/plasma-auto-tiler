# Windows Phase 1 baseline and route

- Goal: settle native setup records, prove current stable portable gates, add
  Windows CI, report read-only displays and propose the Phase 1 recovery/input route.
- Scope: docs and one Windows CI job; no product code, installs, configuration
  changes or live experiments. Preserve backlog edits.
- Acceptance: user decisions recorded; stable version and build/test/fmt/clippy
  plus whitespace evidence; unchanged Linux jobs; display table awaiting user
  confirmation; concise route/options with explicit future authorization boundaries.
- Units (fresh, sequential): native gate investigation;
  setup documentation; Windows CI; read-only displays; route investigation.
- Verification: inspect each diff and command evidence; final whitespace/status
  review. Applicable Linux/hosted checks are deferred until the user pushes.
- Decisions: pre-1.0 latest stable on Windows; Linux/CI Rust from regularly
  bumped nixpkgs pin; revisit at 1.0. No devenv edits.
- Evidence: installed stable
  rustc/cargo 1.98.1, MSVC x64, matches official stable channel dated 2026-09-03;
  no override, no toolchain file. Build/test (569 tests)/fmt/strict clippy passed.
- Docs: settled Rust/setup/dual-boot/Sandbox facts; Windows CI adds explicit
  portable package gates with pwsh/latest stable, Linux jobs unchanged.
- Read-only displays queried; baseline is report-only pending user acceptance.

## Proposed next route (not approved or implemented)

- Add one `tiler-windows` crate with a normal per-user/session owner binary and
  standalone `stop`/`restore` invocations, plus a disposable test-window binary.
  Direct core integration comes later; protocol is external IPC only.
- A PowerShell `windows.justfile` builds before stopping the exact old owner,
  verifies restoration/exit, launches only under approved live scope, checks
  ready and prints logs; trace is bounded lifecycle/action summaries, no raw input.
  Keep independent restore accessible by mouse/out-of-hook entry point.
- Product-candidate: owner identity, stop/restore, minimal private same-user
  control and visibility ledger. Throwaway: owned-window harness and Win+Arrow
  registration/hook comparison. No watchdog/autostart/restart loops.
- Recommend a standalone invocation of the same executable over a separate
  helper. Recommend public hide/reveal for the first owned-window probe;
  compare RegisterHotKey and WH_KEYBOARD_LL before choosing input implementation.
- Recovery proposal: durable write-ahead visibility preimage/intent per owner;
  include user/session/executable/process-start and a per-window lifetime token
  surviving the manager's exit. HWND+PID+process-start alone cannot fence HWND
  reuse within the same surviving app. Initially the owned harness supplies
  a unique queryable lifetime tag; untaggable/ambiguous windows block expansion.
- Use a user-private LocalAppData ledger, atomic replacement and explicit flush
  before actuation. Serialize owner/restore access per user/session; reject
  incompatible or corrupt records without writes. Test each persistence/crash
  boundary offline before relying on native recovery.
- Persist before hide; after crashes reconcile intent with tag/visibility,
  skip already-visible windows and restore only verified tagged hidden windows
  without activation. Read back before clearing recovery entries/tags; preserve
  failed or ambiguous residue. Live-owner restore first needs verified stop.
- Proof order: offline ledger/crash-boundary and identity tests; separately
  authorized Sandbox launch/clean startup and medium-integrity verification;
  non-hook/non-hide graceful and exact-identity kill; owned hide/reveal and
  separately authorized forced loss, then physical repeat; finally separately
  approved short physical Win+Arrow sessions with all directions/down/up/repeat,
  Snap/Start suppression, disable/exit reversal and manual game-disable bypass.
- Sandbox evidence covers guest runtime/recovery only. Games, protected/elevated
  apps, secure desktop, overlays/workspaces and Win+L policy are separate later
  scopes. Win+L policy remains Sandbox-only; no host writes.
- Review: independent fresh review found no high/critical issues;
  tightened persistence/exclusion wording and labeled the fresh-clone example.
  The pre-existing backlog edit is preserved.
- Outcome: this assignment's docs/CI/native baseline/proposal work is complete;
  implementation and live proof remain unapproved. All changes stay unstaged.
- Deferred: existing Linux Rust/KWin/shell CI and hosted Windows execution after
  user push. check-portable/native CTest/nix flake check are not required by
  these docs and additive Windows-job changes, and are not existing CI steps.
- Next action: confirm report-only display baseline and
  review this route; then authorize the bounded offline Windows scaffold and
  ledger/identity unit. No live launch is included. Backlog handover: advance
  Windows Phase 1 to proposal review; retain recurring Rust-tracking P1.
