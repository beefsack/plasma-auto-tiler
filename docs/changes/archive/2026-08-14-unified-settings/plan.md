# Plan: Unified Settings

## Approach

Add the KConfigXT schema and generic scripted-KCM package, then make the
controller read and validate the three schema keys at startup. Wire only the
new default-preset value into automatic takeover and retain existing startup
seams for workspace mode and shortcut profile. The rejected package correction
is limited to the verified generic scripted-KCM metadata convention, its
required standard UI, KConfigXT enum entries, and directly affected tests.

## Work Units

| ID | Work | Status | Verification |
|---|---|---|---|
| unified-settings-01 | Implement the schema, metadata, startup reads, validation fallback, focused tests, generated bundle, and static evidence. | rejected | Rejected implementation remains unaccepted; no completion verification is recorded. |
| unified-settings-kcm-correction-02 | Correct the generic scripted-KCM metadata convention, required minimal bound UI, KConfigXT enum entries, and directly affected tests. | superseded | The convention was accepted by the Orchestrator in `unified-settings-kcm-convention-03`; implementation continues as `unified-settings-kcm-implementation-04`. |
| unified-settings-kcm-implementation-04 | Apply the accepted generic scripted-KCM metadata, KConfigXT enum schema, conventional bound UI, and directly affected static/package tests. | rejected | Attempt `unified-settings-kcm-implementation-04/attempt-01` made the scoped diff but exceeded the hard 20-call cap with 29 calls. Its reported focused results are unaccepted. |
| unified-settings-reconcile-05 | Independently reconcile the actual scoped diff and execute fresh static verification. | accepted | Attempt `unified-settings-reconcile-05/attempt-01` returned in-cap at 19 calls with all required checks passing. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| KConfigXT schema and generic KCM package | Verify the exact metadata identifier, `contents/ui/config.ui` `kcfg_` bindings, and KConfigXT enum schema through focused static evidence and tests. |
| Defaults unchanged | Focused parser/startup tests for `dwindle`, `per-output-local`, and `cosmic`. |
| Valid values read | Focused controller tests for each valid preset, workspace mode, and profile. |
| Deterministic fallback | Focused controller tests for missing and invalid values. |
| Generated output and static baseline | `npm --prefix kwin run typecheck`, build, full test, relevant package/install checks, and `git diff --check`. |

## Final Outcome

- Static acceptance is complete: the generic KCM identifier and required paths,
  KConfigXT enum values/defaults, `kcfg_` UI bindings, startup fallback
  behavior, generated bundle, typecheck, full KWin tests, package/install test,
  and `git diff --check` all passed under the fresh reconciliation attempt.

## Pending User Decisions

- None for this bounded surface. Dynamic-workspace on/off/pinning and shortcut
  remapping remain explicitly out of scope.

## Residual Risks

- Generic scripted-KCM rendering and KWin reload behavior remain an explicit
  live-environment risk; this change has static verification only.
