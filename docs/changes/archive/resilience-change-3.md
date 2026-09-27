# Resilience change 3 - native endpoints (R/S)

## Goal and scope

- User decision option 2 (2026-09-26): retry group-highlight and drag-oracle D-Bus registration on already received activation/reconfigure events, without a timer or polling. Recover the press spy on those events when input was absent at construction.
- Touch only `kwin/native-effect/` and scoped documentation lines; preserve uncommitted change 3a. Repair the pre-existing `shortcutreconciler_test.cpp` build errors in the test only. No live KWin testing, dependency change, commit, or push.

## Acceptance and approach

- One small idempotent registration path per endpoint, shared by constructor and existing event hooks; never publish an endpoint until both name and object have registered. On partial failure, undo only this attempt's registrations, report the partial outcome, and retry on later events. No repeated registration while healthy, double installation, or resource leak.
- Emit bounded redacted failure and recovery transition logs once per unavailable/recovered phase for each endpoint and the press spy. On group recovery, normal group status/visibility and future updates resume.
- Keep native behavior tests lean if the harness permits without a large effect fixture. Build with `just build-native-effect`; build and run all native CTests in the host-matched builder; `kwin` `npm test` sanity check.

## Bounded units

1. Repair shortcut test compilation only; stop on discovered production defect.
2. Implement R/S endpoint and press-spy recovery in native effect, review partial-registration behavior.
3. Integrate verification and scoped documentation, archive this note when green.

## Evidence and outcome

- Unit 1: existing shortcut test failed under `-Werror=missing-field-initializers` on incomplete `WriteRecord` initializers and `KConfig check` shadowed the `CHECK` helper. Test-only complete initializers and variable rename; the host-matched shortcut test reports `all checks passed`. No production defect found.
- Unit 2: one shared registration helper rolls back only name/object acquired on a failed attempt; constructor, activation (including non-OpenGL), and reconfigure ensure each missing endpoint and late press spy. Fixed-token endpoint failure reports service/object confirmation; initial success/recovery is logged once. Group status/visibility gate admits later updates. Native harness is FFI-only without a KWin effect/input/D-Bus fixture, so there is no small effect-level behavior test.
- Host-matched production `just build-native-effect` built and staged all three plugins. Test build with `BUILD_TESTING=ON` in the same KWin derivation dev shell built all native targets; full CTest 29/29 passed, zero failures (1.76s). KWin `npm test` 758/758 passed; `git diff --check` clean.
- R/S offline statuses, user decision attribution, fixed log forms, and backlog status updated in their existing docs. No live KWin/Plasma test; actual transient bus/input recovery and group outline after recovery remain for an authorized live check after delivering the rebuilt effect in a fresh Plasma session.
