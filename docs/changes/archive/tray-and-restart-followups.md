# Tray and restart follow-ups

## Goal and scope

Deliver the user's 2026-09-28 decisions: a healthy authenticated tray snapshot reports Active; Home Manager runs the tray as a graphical-session systemd user service with restart on failure instead of XDG autostart; verify KWin 6.7.5 window IDs and retained Planner behavior for all-new IDs, fixing only if worse than fresh adoption. Keep the fixed `plan-1` generation and retained topology. No live session mutation, new supervisor, or readiness-bound status.

## Acceptance and approach

- Update the production publisher and affected tests for Active while preserving stale/missing NeedsAttention.
- Replace tray autostart delivery with one graphical-session-bound user unit; verify duplicate-name and shutdown semantics, dev ownership, docs, and affected shell/Nix tests.
- Establish KWin ID semantics from 6.7.5 source and compare all-new-ID complete observation with fresh startup adoption; change Engine only if clearly worse.
- Promote all three decisions to `docs/decisions.md`; verify KWin tests and typecheck, affected shell tests, Nix module evaluation/build where feasible, Rust checks if Rust changes.

## Units

1. Tray user-service delivery and affected shell/docs coverage.
2. Tray publisher status and tests.
3. KWin restart ID and Planner behavior investigation; narrow fix only if warranted.
4. Integrate evidence, decisions, and archive.

## Outcome and evidence

- Tray delivery: graphical-session-bound Home Manager systemd user service replaces XDG autostart; `Restart=on-failure` leaves duplicate-name exit 0 alone. Existing `just dev` preserves a foreign tray owner. Native journald submission and its tests were removed: the user unit journals inherited stderr, while dev and on-demand runs retain visible or captured stderr without duplicate packaged records. Module-boundary Nix evaluation and build succeeded; private-bus tray-05b fixture passed (29 + 16 self-test checks). Name/connection loss exits nonzero, while systemd's target stop job prevents a restart at logout. Live login, failure restart, and logout behavior remain to check.
- Tray status: production KWin publisher now sends `enabled=true`; authenticated current snapshot projects Active, missing/stale remains NeedsAttention (`tray.rs:243-256`). Shipped-bundle smoke expectation updated.
- KWin 6.7.5 `src/window.cpp:60-63` assigns `QUuid::createUuid()` on construction; `src/window.h:313` and `src/effect/effectwindow.cpp:296` expose that internal ID. A surviving Planner with fixed `plan-1` retains a domain, but zero shared IDs formerly admitted in window-ID order, swapping observed left/right placement versus fresh spatial/strip-fit adoption. The Engine now retires a disjoint, nonempty domain before the existing fresh reconcile path; shared IDs preserve topology. Empty observations keep their revision/retirement route, and mismatched owner/generation keeps its rejection. Targeted disjoint/shared-ID tests pass. An earlier gap-fence guard and test were removed in the trim: fresh adoption uses the observed gaps. After the trim, Rust workspace tests, fmt check, clippy, module-boundary Nix build, and private-bus tray-05b suite all pass.
- KWin `npm test` (790) and `npm run typecheck` pass. All three 2026-09-28 user decisions were promoted to `docs/decisions.md`.

## Live acceptance remaining

- Test system: after Home Manager activation and a fresh graphical login, verify exactly one tray name/SNI, Active with an authenticated KWin snapshot, NeedsAttention after snapshot loss, restart after a tray process failure, a second invocation's clean exit, and clean stop on logout without a restart loop. Run `just dev` while the packaged tray owns the name and confirm it leaves that owner untouched.
- Multi-output test system: restart KWin while Planner survives, verify all-new IDs fresh-adopt per output without left/right swaps or unwanted changes to other domains, and check surviving shared-ID domain topology under script reload; verify tray owner/status across the restart.
