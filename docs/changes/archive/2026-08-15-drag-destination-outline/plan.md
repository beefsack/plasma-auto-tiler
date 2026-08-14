# Drag Destination Outline Plan

## Approach

Keep the feature disabled by default. First expose the setting through the
existing KConfigXT and KCM conventions. Later units use the existing
cursor-derived target selection and minimum preflight to request only a plain
rectangle for valid non-origin leaves. Controller state suppresses identical
requests and clears the rectangle on every invalidation and terminal path.

## Work Units

| Unit | Scope | Evidence | Status |
| --- | --- | --- | --- |
| config | Add `dropOutlinePreview` to the existing KConfigXT schema and KCM UI; parse startup missing/false/true values with default false; add focused configuration tests. Do not wire drag or outline APIs. | Focused parser/schema/UI tests and typecheck. | Accepted by aggregate static verification. |
| boundary | Reuse existing cursor-derived target selection and minimum preflight to identify valid, in-scope, non-origin, adequately sized target leaves. | Focused stepped-controller tests. | Accepted by aggregate static verification. |
| controller-lifecycle | Request and clear a plain outline rectangle through the existing supported API, suppress identical requests, and cover every drag terminal/invalidation/disable path without structural step mutation. | Focused controller tests and typecheck. | Accepted: the same-scope review correction hides a shown outline in the fullscreen and maximized early-finish guards without clearing drag state. |
| static-verification | Inspect the aggregate change and run only the declared focused static checks. | Reproducible focused test/typecheck results. | Accepted: focused controller bundle (498 passing), typecheck, and diff check passed; root `npm --prefix kwin test` passed 775/775 tests and `bash scripts/start-test.test.sh` passed 271/271 assertions. |

## Acceptance Evidence Map

| Criterion | Evidence |
| --- | --- |
| Disabled default and UI/schema representation | `config` focused parser, schema, and UI tests show missing/false/true behavior with default false. |
| Candidate validity | Focused stepped-controller tests cover unresolved, out-of-scope, origin, topology-invalid, undersized, and accepted leaves. |
| Lifecycle clearing and deduplication | Focused stepped-controller tests cover valid display, invalid-step clearing, identical requests, successful and refused finishes, fullscreen and maximized early finishes, invalidation/removal, stale replacement, disable cleanup, and terminal idempotence. |
| No drag-step mutation or rich preview | Controller tests and source inspection show no structural mutation, QML, rich preview, or resulting-split preview. |
| Static validation | `static-verification` records focused test/typecheck commands and results. |

## Risks

- KWin outline API behavior, XWayland behavior, and drag-event cadence are
  live-only and remain unaccepted.
- The configuration unit must not imply that an outline API or runtime behavior
  has been wired.

## Pending User Decisions

- None.

## Final Outcome

- Accepted for static evidence. The live KWin/Plasma, XWayland, and drag-event
  cadence acceptance gate remains unrun and unaccepted by scope.
