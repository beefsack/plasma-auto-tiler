# Plan: Integrated Plasma Structural Feasibility

Ownership and approval:
- Owner: Lead
- Status: Approved by the user on 2026-08-10.
- Dependency: archived [integrated-tiling-workspace-value verdict](../archive/2026-08-10-integrated-tiling-workspace-value/findings.md), section 11.

## Cross-Change Coordination

The unsafe live harness and nested-KWin path remain blocked. The approved
[custom-tile-vertical-slice](../custom-tile-vertical-slice/) now owns useful
runtime discovery for its narrow production slice through a separately
authorized smoke only. That ownership does not authorize, reuse, or unpark this
change's live path, and it does not complete this change's unit-05 verdict.

## Technical Approach

Prove feasibility in the smallest safe order: classify KWin 6.7.3's required
surfaces before investigating composition, define an exact reversible proof
before requesting authorization, then use the authorized proof to issue the
scoped verdict. The gate fails fast when a mandatory surface has no supported
or bounded version-coupled route.

## Work Units

| ID | Status | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|---|
| unit-01 | Accepted 2026-08-10 | Built the source-only KWin 6.7.3 API-surface matrix for every mandatory workflow surface. The supported scripting/QML path is insufficient for the full workflow; all capabilities retain a bounded version-coupled route, so unit-02 may assess composition. | archived audit verdict | `research/kwin-api-surface.md` | No | Source citations identify the exact surface, binding reachability, support status, version boundary, lifecycle uncertainty, and workflow consequence for every mandatory surface. |
| unit-02 | Accepted 2026-08-10 | Defined the source-only package composition and supported/version-coupled boundary for the feasible unit-01 path, including installation, enablement, configuration, and compatibility responsibilities. | unit-01 | `research/package-composition.md` | No | Pinned KWin source and official KWin packaging documentation establish a coherent one-`KWin/Script` proof carrier, its version-coupled boundary, state ownership, optional-indicator boundary, and lifecycle uncertainties. |
| unit-03 | Accepted 2026-08-10 | Wrote the minimal reversible proof protocol and exact user authorization request for the combined workflow, including the source/API-supported sentinel-only shortcut route. | unit-01, unit-02 | `research/proof-protocol.md` | No | The request enumerates actions, user state, duration, reversal, targeted shortcut cleanup, and KWin responsiveness verification. |
| unit-04 | Blocked 2026-08-10: nested-KWin spike does not meet the smoke threshold; `attempt-01` FAILED (runtime evidence inadmissible) | Source-only inspection established promising nested and virtual backends but not the required fully isolated runtime/socket, D-Bus/service, and deterministic-teardown composition. Continue without nested-environment infrastructure. | unit-03, completed nested-environment feasibility spike | `research/nested-kwin-feasibility.md`; prior `proof/`, `results/` preserved | No | The durable matrix cites exact KWin flags, source paths, and installed command presence; it blocks a smoke recommendation until the missing isolation and service facts are established. |
| unit-05 | Planned | Evaluate representative responsiveness from an authorized proof and apply the outcome rule to issue the decisive feasibility verdict. The separately authorized custom-tile-vertical-slice smoke may provide useful discovery for its own slice, but does not unpark this change's blocked live path or satisfy this unit. | unit-04 | `findings.md` | No | The verdict maps every acceptance criterion to evidence, stays target-workflow scoped, and does not broaden benchmarks or alter sustained-workload thresholds. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Parked Live Harness and Nested-KWin Prerequisite

`unit-04/attempt-01` failed at its manual T2 checkpoint and is unsuccessful.
Its runtime evidence under `results/` is inadmissible to acceptance,
responsiveness, cleanup, or any feasibility verdict, and those files are
preserved untouched.

The staged live harness in `research/proof-protocol.md` and `proof/` is unsafe
to invest in further at this time. It is parked, not deleted or reclassified as
evidence. `unit-04/attempt-02` is not authorized or executed.

The user-approved replacement prerequisite is a single source-only,
non-launching nested-KWin feasibility spike. It must establish whether a child
KWin can be isolated from the parent session, run scripts and test clients, use
two outputs, and teardown deterministically with already-installed dependencies.
If the result is anything less than obvious and isolated, implementation
continues without a nested-environment smoke launch.

## Fail-Fast Gate

- Unit-01 stops this change as infeasible/unjustified when any mandatory surface
  is unavailable through both documented supported scripting/QML and bounded
  version-coupled native routes. Units 02 through 05 do not start.
- Unit-02 stops this change as infeasible/unjustified when its feasible surface
  path cannot form a coherent, bounded install/enable/configure composition.
- Unit-03 does not authorize or execute a proof. It prepares the exact request.
- Unit-04 cannot resume live work unless the nested-KWin spike recommends a
  smoke launch and the user freshly authorizes that exact smoke scope. Lack of
  authorization leaves the change gated, not proven.

## Live Authorization Checkpoint

Before unit-04, the Lead must present the unit-03 protocol and request fresh
user authorization. The request must state the exact KWin/session interaction,
scripts, windows, duration, configuration or package state, expected output,
reversal sequence, cleanup, and responsiveness check. No live interaction is
permitted before that authorization.

## Progress

- [x] unit-01 KWin API-surface matrix
- [x] unit-02 Package composition boundary
- [x] unit-03 Reversible proof protocol and authorization request
- [x] unit-04 Nested-KWin source-only feasibility prerequisite blocked a smoke
       launch; live harness remains parked (attempt-01 failed and inadmissible;
       attempt-02 unexecuted)
- [ ] unit-05 Responsiveness and decisive verdict

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Every mandatory surface classified | Accepted unit-01 `research/kwin-api-surface.md` |
| Mandatory unsupported surfaces stop the gate | Accepted unit-01 matrix: no capability lacks every route; scripting-only proof is stopped and unit-02 may assess the bounded version-coupled path |
| Coherent bounded package composition | Accepted unit-02 `research/package-composition.md` |
| Exact reversible protocol before live work | Accepted unit-03 `research/proof-protocol.md`; staged execution revision in the same file |
| Fresh authorization and verified cleanup | `research/nested-kwin-feasibility.md` establishes whether a separately authorized isolated smoke is justified; no proof completion claimed until a later authorized unit-04 path supplies cleanup evidence |
| Scoped decisive outcome without sustained-workload changes | unit-05 `findings.md` |

## Residual Risks

- Supported scripting/QML does not expose a stable route for the full workflow;
  the accepted unit-01 matrix confines the continuing path to version-coupled
  integration.
- A feasible path may be version-coupled and therefore carry explicit KWin
  compatibility and maintenance risk.
- The parked live harness may remain unsafe or nontrivial. A nested smoke is
  considered only if the replacement source-only spike establishes an obvious,
  isolated path with deterministic teardown.
- This gate can establish structural feasibility only. It cannot establish broad
  feature parity, sustained performance, or a native-vs-JS decision.

## Completion Status

- Outcome: pending. No proof completion is claimed.
- Current unit: unit-04 is blocked. The nested-KWin prerequisite did not make
  an isolated, deterministic smoke path obvious. `attempt-01` failed and its
  runtime evidence is inadmissible; `attempt-02` is unexecuted and parked with
  the unsafe live harness.
- Next action: proceed without nested-KWin infrastructure. No smoke launch is
  recommended or authorized.
