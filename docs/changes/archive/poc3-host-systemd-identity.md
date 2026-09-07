# POC3 Host Systemd Identity

## Goal

Allow the POC3 host-pilot identity pin to fail closed when same-UID
`/proc/<kwin-pid>/exe` is unreadable, using the explicitly authorized compound
KWin/systemd identity.

## Scope

- One canonical shell helper shared by host baseline, suspend/resume, and host
  pilot lifecycle delegates.
- Record and compare D-Bus owner/PID, `/proc` start tick, boot ID, exact KWin
  user-systemd unit/MainPID state, and immutable Nix-store executable
  hash/device/inode.
- Preserve readable `/proc/exe` as an agreeing identity signal.
- Add focused hermetic shell tests and make one read-only baseline attempt.

## Non-Goals

- No production suspend, client/planner/adapter launch, geometry/focus write,
  cleanup, resume, host configuration change, commit, or push.
- No general service discovery, PATH executable authority, or unit-text-only
  executable authority.

## Acceptance

- Every future mutating stage revalidates the full compound identity and
  refuses owner/PID/tick/boot/unit/MainPID/ExecStart/store-identity drift.
- Systemd `ExecStart` parsing rejects injection and ambiguity, including
  multiple commands and mutable/non-store paths.
- Baseline, suspend/resume, and pilot receipts carry the same identity shape.
- The one permitted host command is `poc3-host-pilot.sh baseline`.

## Approach

1. Inspect only `plasma-kwin_wayland.service` read-only properties.
2. Implement the smallest shared systemd-backed fallback helper.
3. Wire existing host lifecycle scripts without adding automation.
4. Add focused synthetic coverage, run static checks, and independently review.
5. Run exactly one read-only host baseline and stop for the user checkpoint.

## Evidence

- Read-only unit inspection found `Id=plasma-kwin_wayland.service`,
  `Type=dbus`, `BusName=org.kde.KWinWrapper`, active/running state, and matching
  unit MainPID, D-Bus owner PID, and `/proc` PID. `ExecStart` points to a
  Nix-store wrapper. `SourcePath` is empty and `FragmentPath` is the current
  system profile link, so neither is executable authority.
- The explicitly authorized fallback compounds the D-Bus KWin unique owner/PID,
  `/proc` tick and boot ID, `plasma-kwin_wayland.service`
  Type=dbus/BusName=org.kde.KWinWrapper state/MainPID, and Nix-store ExecStart
  identity only when /proc exe is unreadable; readable `/proc/exe` must agree.
- The single `bash scripts/poc3-host-pilot.sh baseline` attempt failed closed,
  without a receipt, with:
  `error: unit MainPID 3568829 does not match KWin PID 3568836`
  `error: KWin PID 3568836 executable identity is unreadable and systemd fallback failed`
  This establishes an unresolved mismatch: the `org.kde.KWin` D-Bus owner PID
  does not equal the service MainPID. No suspension, client/planner/adapter
  launch, geometry/focus, cleanup, resume, or host state mutation occurred.
  Future action requires user participation at this first checkpoint.
- The authorized ancestor check observed stable `org.kde.KWin` owner `:1.9`,
  PID `3568836`, and tick `13991576` on boot
  `2e63db46-c4ae-4552-a899-fb864e3cbbc6`. It is the direct child of service
  MainPID `3568829` at tick `13991575`, whose immutable Nix-store wrapper
  identity agrees with `ExecStart`; however, the owner reports cgroup `/`
  while the MainPID reports the unit control group. The required same-unit
  containment is therefore unproven.
- The direct-parent fallback slice is complete and supersedes the prior
  unimplemented status. Authorized scope: direct D-Bus owner PPid exactly
  equals `plasma-kwin_wayland.service` MainPID, no deeper/arbitrary
  descendants; owner cgroup `/` is accepted only in direct-parent host-pilot
  mode and explicitly does not prove same-unit containment; owner readable
  exe mismatch fails closed.
- Static evidence before the live checkpoint: direct-parent 35/0,
  identity-compound 24/0, identity 49/0, baseline 75/0, suspend 102/0, pilot
  115/0, trio 86/0, planner 83/0, command 79/0; aggregate 648/0, 16 syntax;
  diff check passed.
- The sole `bash scripts/poc3-host-pilot.sh baseline` ran exactly once,
  failed, and captured no baseline. Raw errors:
  `error: unit MainPID 3568829 does not match KWin PID 3568836` then
  `scripts/poc3-host-kwin-identity.sh: line 135: rest: unbound variable`.
  Exact exit code was unavailable. No retry, suspend/resume, clients,
  planner, adapter, geometry/focus, cleanup, configuration, or host mutation
  occurred.
- Suspend is not ready. The earliest next checkpoint requires user direction
  because the single baseline is spent and the `rest` nounset failure is a
  code defect requiring a separate authorized correction and a new baseline
  authorization.
- The authorized surgical correction split the store hash parsing into two
  `local` declarations, preventing `rest` from expanding while unbound under
  `set -u`. Focused direct-parent coverage now exercises valid runtime parsing
  under `set -u` and rejects malformed store inputs; independent review found
  no permissive fallback or malformed-input masking. Static checks passed:
  direct-parent 43/0, identity-compound 24/0, identity 49/0, baseline 75/0,
  suspend 102/0, pilot 115/0, syntax, and `git diff --check`.
- The exactly one authorized retry, `bash scripts/poc3-host-pilot.sh baseline`,
  failed closed before any later stage. Raw errors:
  `error: unit MainPID 3568829 does not match KWin PID 3568836`;
  `error: unit MainPID executable identity disagrees with the canonical store identity`;
  `error: KWin PID 3568836 executable identity is unreadable and systemd fallback failed`.
- Suspend remains not ready. The earliest checkpoint is user direction on the
  MainPID executable-identity disagreement; the authorized baseline retry is
  consumed, and no suspend, client, planner, adapter, or later pilot stage ran.
