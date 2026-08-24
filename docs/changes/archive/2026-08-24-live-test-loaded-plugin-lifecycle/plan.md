# Live-Test Loaded Plugin Lifecycle Plan

## Approved Scope

Implement only the specification's `scripts/live-test.sh` lifecycle ordering
and `scripts/live-test.test.sh` clean-reboot regression. Native-effect work,
COSMIC directional movement, `Meta+L`, helper-script changes, and unrelated
backlog entries are excluded.

## Startup VCS Policy

- `agent_commits=yes`
- `agent_pushes=yes`
- `staging_owner=Lead`
- `user_commit_required=no`
- `candidate_preservation=none; no rejected candidate is currently authorized`
- `cleanup_owner=Lead for future approved change-owned candidate evidence; no
  cleanup is authorized at startup`

## Units

| Stable ID | Dependency | Scope | Classification | Progress | Attempts | Corrections | Reviews | Breaker |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `unit-01` | Approval | Superseded permanently by the changed-kind reset after its test-only characterization and sole correction could not produce the permanent green oracle. | Test characterization | Frozen: changed-kind reset | 1 | 1 | 0 | 1 |
| `unit-02` | `unit-01` | Superseded before start by the atomic replacement. | Static implementation | Replaced before start | 0 | 0 | 0 | 0 |
| `unit-01r-atomic-regression-lifecycle` | Approval | In `scripts/live-test.sh` and `scripts/live-test.test.sh`, atomically implement the exact-plugin disable-before-post-disable-status lifecycle and its six-check permanent regression oracle, including residual-loaded fail-closed coverage. | Static implementation | Accepted | 1 | 1 | 0 | 0 |
| `unit-03` | `unit-01r-atomic-regression-lifecycle` | Run focused and broad static verification, including source-scope and diff checks. | Static verification | Accepted | 1 | 0 | 0 | 0 |
| `unit-04` | `unit-03` | First user-run G08 attempt using the accepted source. | User-run live acceptance | Failed: delayed post-disable unload | 1 | 0 | 0 | 0 |
| `unit-05-delayed-unload-ownership-gate` | `unit-03` | Add bounded post-disable readiness polling and deterministic delayed-unload coverage in `scripts/live-test.sh` and `scripts/live-test.test.sh`. | Static implementation | Accepted | 1 | 1 | 0 | 0 |
| `unit-06-delayed-unload-static-verification` | `unit-05-delayed-unload-ownership-gate` | Rerun G03-G07 against the delayed-unload change. | Static verification | Accepted | 1 | 0 | 0 | 0 |
| `unit-07-user-run-delayed-unload-retry` | `unit-06-delayed-unload-static-verification` | One fresh user-run G08 retry after static acceptance. | User-run live acceptance | Accepted | 1 | 0 | 0 | 0 |

## Gates And Baselines

| Gate ID | Tier | Literal canonical command or observation | Current baseline | Expected acceptance |
| --- | --- | --- | --- | --- |
| `G01` | Checkpoint | `bash -n scripts/live-test.sh` | Last passed exit 0. | Exit 0 after `unit-05-delayed-unload-ownership-gate`. |
| `G02` | Focused | `bash scripts/live-test.test.sh` | 205 passes, 0 failures. | 207 passes and 0 failures. The permanent oracle also proves two delayed loaded observations before exact not-loaded ownership and nonce start; residual loaded state still fails closed. |
| `G03` | Broad | `npm --prefix kwin run typecheck` | Passed in failed-run full preflight. | Exit 0. |
| `G04` | Broad | `npm --prefix kwin run build` | Passed in failed-run full preflight; bundle reported 349.0 kB. | Exit 0; record resulting bundle size/hash without requiring an unchanged bundle. |
| `G05` | Broad | `npm --prefix kwin test` | 990 Node tests and 255 `start-test` shell checks passed in failed-run full preflight. | No failures; record current counts. |
| `G06` | Broad | `bash scripts/dogfood-install.test.sh` | 347 passes, 0 failures in the active static record. | No failures; record current count. |
| `G07` | Final static | `git diff --check` | Clean before implementation. | Exit 0. |
| `G08` | Final live | User runs `bash scripts/live-test.sh run` once after `G01`-`G07` pass. | First attempt failed at `/run/user/1000/plasma-auto-tiler-live/live-20260824T191740-3929` before nonce start because immediate post-disable status remained loaded. | Evidence shows bounded polling reaches exact not-loaded before nonce start, or retains timeout evidence and fails closed; verified enable-state restoration remains required. |

## Checkpoints And Stop Conditions

- `unit-01` and `unit-02` are frozen historical evidence. Their failing test
  state is not accepted or committable.
- `unit-01r-atomic-regression-lifecycle` runs `G01` and `G02` as one green
  atomic patch. Its six counted permanent-oracle checks are: successful enabled
  auto-loaded path; disable before post-disable `start-test status` before nonce
  start; verified restoration output; restored enabled state; and a residual
  loaded-after-disable case that exits nonzero without nonce start. Any fixture
  surprise, failed gate, different acceptance mechanism, or inability to prove
  the exact order parks the reset unit. Its one same-scope pre-review correction
  was used and accepted.
- `unit-03` is the final static gate. Any failure, tracked scope expansion,
  changed ownership invariant, or test-count loss stops before live work.
- `unit-04` failed before nonce start. Its evidence is retained at
  `/run/user/1000/plasma-auto-tiler-live/live-20260824T191740-3929`; it neither
  proves nonce start nor consumes an implementation correction or reset.
- `unit-05-delayed-unload-ownership-gate` polls direct `start-test status` at
  most 30 times with 100 ms delay after exact-plugin disable, accepting only an
  exact `loaded: not-loaded` line. Malformed output, command failure, or timeout
  fails closed without start. It retains samples in `post-disable-status.txt`
  and records poll count plus `ready|timeout` in the manifest. Restoration
  verifies enabled state only; it has no symmetric loaded-state wait.
- `unit-06-delayed-unload-static-verification` reruns G03-G07 after unit-05.
- `unit-07` is user-run only and has one fresh G08 authorization. It runs only
  after unit-06 acceptance; any failure retains evidence and is not retried
  automatically.
- Independent review is required only if the implementation expands beyond the
  two approved files or changes the ownership/restoration contract.

## Acceptance-Evidence Map

| Acceptance criterion | Evidence |
| --- | --- |
| Enabled auto-loaded plugin is disabled before ownership gate. | Accepted `G02` order oracle: disable before post-disable status before nonce start. |
| Residual loaded controller fails closed. | Accepted `G02` residual oracle: disable, later status, nonzero gate rejection, no start. |
| Disabled-but-loaded refusal remains unchanged. | Existing `scripts/live-test.test.sh` loaded-state test passed in accepted `G02`. |
| Restoration is exact and run-owned. | Accepted `G02` restoration output and enabled-state assertions. |
| Static correctness. | Accepted: G01 exit 0; G02 207/0; G03 exit 0; G04 357349-byte bundle, SHA-256 `b90f9b23f9e2e290f7b581acaef9743a4ff48c320e895f7a06fa7de005d074dc`; G05 990 Node and 255 shell checks, 0 failures; G06 347/0; G07 exit 0. |
| Host behavior. | Accepted G08 evidence: `/run/user/1000/plasma-auto-tiler-live/live-20260824T194911-41198/manifest.txt` records poll count 2, ready, nonce start, owned stop, and verified restore. |

## Change-Wide Telemetry

- Implementation dispatches: 3
- `dispatch-invalid`: 1 (pre-source unit-01 scope mismatch; no attempt)
- Pre-review corrections: 3
- Finding-fix corrections: 0
- Independent reviews: 0
- Changed-kind resets: 1 (approved atomic regression-plus-lifecycle reset)
- Broad-gate runs: 2
- Acceptance criteria moved: 6
- No-progress streak: 0

## Final Outcome

- G01-G08 are accepted. The user approved the runner lifecycle result, and no
  acceptance gap or blocker remains for this change.
- The user-observed drag-gap defect is the first follow-up: a visible gap
  directly below the top-right window after the final drag/drop. It does not
  diagnose or block this runner change.
- The COSMIC successor path is second: the user directed a way forward for
  critical COSMIC emulated movement. COSMIC implementation remains parked and
  unchanged in this transaction.
- The move/group overlay rendered live and is a later improvement follow-up.
