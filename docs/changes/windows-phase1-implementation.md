# Windows Phase 1 implementation

- Goal: native owner/stop/restore and owned-window recovery, followed by physical
  Win+Arrow evidence before Engine-driven geometry.
- Milestone 1: `f767de8`, native ledger model/storage, Windows and Linux CI green.
- Milestone 2: non-hooking lifecycle, standalone restore, exact-owner emergency
  stop, owned tagged test window and native development/proof loop.
- Baseline: Windows 11 Pro x64 build 26200; one M27Q, `\\.\DISPLAY1`,
  2560x1440 at 170 Hz, 125%, origin 0,0. Multi-monitor evidence belongs to the
  other Windows PC; historical KDE display facts remain unchanged.
- Acceptance: four-package Windows build/test, fmt-all, strict clippy and
  whitespace; independent reveal/readbacks after graceful and forced owner loss;
  verified actor exit and no committed ledger or stop request at the end.
- Input, hooks, overlays, ordinary-app management and host-setting changes are
  outside milestone 2. Clean runtime and guest-only Win+L remain Phase 4 work.

## Implementation and simplification

- `native.rs`: one held-process open/liveness path for identity, integrity,
  waiting and exact-handle termination; KnownFolder session storage and Terminal
  ancestry. Identity is PID, creation time, executable, SID and session.
- `lifecycle.rs`: bounded run/ready/stop/emergency-stop/restore; commit before
  hide; recheck process and HWND lifetime tag before actuation and after reveal.
  Stop commands exit only the owner; independent restore retains recovery after
  either graceful or forced loss.
- `test_window.rs`: disposable ordinary tagged HWND, atomic receipt, inspect
  and exact-window graceful close. Owner and helper require medium integrity
  and exclude Windows Terminal and its descendants.
- `windows-dev.ps1`/`windows.justfile`: copied payloads under `target/windows-dev`
  avoid running-image build locks. Explorer desktop broker uses
  `ShellWindows.FindWindowSW(...).Document.Application.ShellExecute`.
  Plain `Shell.Application.ShellExecute` is caller-context and cannot supply
  the required launch ancestry.
- Simplification: removed duplicate process-open code, unused PID accessor,
  custom helper painting and a marginal executable-name comparison test;
  consolidated snapshot/error mapping, repeated owner-stop/ledger checks,
  run-result JSON/logging and always-true restore outcome plumbing.
- Independent review accepted the recovery contract. Corrections retained typed
  snapshot refusals, canonical reveal identity checks, independent owner-death
  checks in hide journeys and full process identity in proof reveal readbacks.
- Kept class/parent/owner/topmost eligibility checks, held handles, lifetime tags
  and Terminal ancestry: they bind writes to the expected disposable window.
  `Win32_Graphics_Gdi` remains required by `WNDCLASSW`/`RegisterClassW` even with
  custom painting removed. Remaining tests cover identity, bounds and recovery.
- Lifecycle owner remains a bounded poll loop without a message loop.
  Recovery state: `%LOCALAPPDATA%/plasma-auto-tiler/session-<id>`.

## Verification after simplification

- 2026-10-01: PS7 Core 7.6.6, stable rustc/cargo 1.98.1,
  `x86_64-pc-windows-msvc`.
- `cargo +stable build --locked` and `test --locked` for `tiler-core`,
  `tiler-protocol`, `tiler-kwin-effect-ffi`, `tiler-windows`: pass, 587 tests.
- `cargo fmt --all -- --check`, four-package clippy `--all-targets -- -D warnings`
  and `git diff --check`: pass. PowerShell parse and all four Just recipe dry-runs
  pass; new implementation files checked for trailing whitespace, LF and no BOM.
- Linux workspace tests/clippy and portable checks remain deferred to CI.
  Linux service, KWin consumers, shell/Nix and live KDE checks were not run here.

## Physical owned-window recovery evidence

- Earlier proof: PASS, 2026-09-30 23:44 +10, source `f767de8` plus milestone 2
  working tree. Report: `target/windows-proof/20260930-234429-13472/report.json`.
  No-hide graceful/forced exit then one helper hidden/restored after each kind
  of owner loss; independent reveal preserved process/tag/rectangle. Exact helper
  close passed; no actors, ledger or stop request remained.
- Earlier non-hiding launch failed at readiness because plain Shell.Application
  launched in the Terminal tree. No hide occurred. Causal repair to Explorer's
  desktop broker passed dev/trace/stop and the owned-window proof above.
- Re-proof procedure: one physical-desktop invocation of the existing proof,
  bounded to five minutes; no-hide graceful and exact-owner forced exit first,
  then the one Explorer-launched owned helper, with 600-second helper lifetime
  and 120-second hide-owner runs. Independent restore after each owner loss;
  read back identity/tag/visibility/rectangle, close the exact helper and verify
  actor exit plus absent ledger/request. No Terminal-tree window is a target.
- Re-proof: PASS, once on 2026-10-01 08:36:26-08:36:59 +10, physical Windows
  build 26200, source `f767de8` plus the simplified milestone 2 working tree.
  `just --justfile windows.justfile proof` exited 0. Report and helper receipt:
  `target/windows-proof/20261001-083638-9232/{report,window}.json`.
- Actual SHA-256 (payloads under `target/windows-dev`):
  - Owner: `0A351F46163F28401C200FBB839A5E3F5E091830FD5A8DDA398EFA109D18BD95`
  - Helper: `69C09F7DD03DC2BDFEF22344F01DCFAACB231F3075D93AB0E38EF20041B34522`
  - Script: `17CAE731204DA5E4CF445C05FC51FD02C41AF359319CC23940B3F7EE7BFBC68C`
  - Justfile: `59DC899AF950C21D28A80465B661F54816237DD84620A79A980DB942F898DBB1`
  - Report: `5623F09456DBC5AE3AAF896E3B36A31438D862CC45F9091E57E35BB9BC82AD83`
  - Receipt: `10B570B41505EF81E5B13659748BB11B34AB26E9CC6642F8ED6151AB44398A24`
- Medium RID 8192, same SID ending -1002, session 1. Preflight had no project
  actors/ledger/request. Display query: one primary DISPLAY1, 2560x1440 at 169 Hz,
  logical bounds 2048x1152 and work area 2048x1104, consistent with the accepted
  baseline; no independent fresh scale readback claimed.
- No-hide owners: graceful 19668 (`01dd512c285b84a6`), forced 14572
  (`01dd512c28b0b155`); exact owners exited, independent restore cleaned zero
  windows. Hide owners: graceful 33132 (`01dd512c29348e96`), forced 18228
  (`01dd512c2991e756`); independent identity/liveness checks confirmed exit.
- Helper: 21068 (`01dd512c28fcaa69`), HWND 722736, tag `18da3a34b7a8ec88`,
  rectangle (200,200)-(840,680). Hidden after both owner exits; each standalone
  restore returned `restored:true`, `windows:1`, `ledger_cleaned:true` and read
  back visible with identical full process identity, tag and rectangle.
- Exact helper close and exit passed. Final checks: all five exact actor
  identities absent, zero project actors, `ready:false`, ledger.json and
  stop.request absent; only intentional run.log/ledger.lock and ignored proof
  artifacts remain. Lead independently re-read report/receipt and rechecked
  absent project actors/ledger/request. No restoration ambiguity or unowned
  target observed; Terminal-tree windows were never targeted.
- All five actors passed the script's Explorer-parent assertion. Parent PID/name
  is not persisted in the report, so parentage evidence is the live assertion,
  not an independent post-hoc readback.
- Native machine readbacks do not substitute for user visual/input acceptance.

## Earlier Sandbox preflight (closed)

- 2026-09-30: read-only identity payload in a guest with networking/clipboard
  disabled and exact read-only payload mapping. Provisioning then black surface;
  guest execution/integrity remained unknown. One scoped WM_CLOSE required a
  user-dismissed confirmation. Sandbox subsequently closed with no actors left.
- No host tiler/window mutation occurred. No capture/input fallback or retry.
  Preflight artifacts were removed; retained SHA-256:
  - Static-CRT binary: `35C772E11F6071879C0CB202B7CE9B268DA32D61B68D7C27DC8F3739C978DEEA`
  - Sandbox config: `6D9C816635EF431C91C4FFEF16F50BB74F90922666CDC4942A266397BBF78C54`
  - Guest script: `494D7C9196DE8E9684A90D5A8C1AACEB133C8F0DFF87F1F796653C6D4C5A8AE2`
  - Sandbox launcher: `7BB5667331572C8A725A3A799AE7DED2912648B4F6EB7380FB51864C804C3E36`
- Debug payloads import VCRUNTIME140/UCRT; static-CRT release imported OS DLLs
  only. This supports, but does not prove, clean runtime closure.

## Remaining Phase 1 evidence

- User visual confirmation of owned-window restoration.
- Physical Win+Arrow comparison: `RegisterHotKey` versus `WH_KEYBOARD_LL`, all
  directions, key-down/up/repeat, Snap/Start suppression and disable/exit reversal;
  no physical input evidence exists yet. No input spike is implemented here.
- Later game-disable, session/display transitions and second-PC geometry/DPI;
  clean-runtime evidence in Phase 4.
