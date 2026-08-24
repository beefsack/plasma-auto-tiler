# Plan: Deferred Window Interaction Handlers

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator under autonomous mode
- Commit/push: allowed only after accepted units and no open blocker; Lead owns staging

Semantic sections - Technical Approach, Work Units, Pending User Decisions -
are approved by the Orchestrator. Record-keeping sections are Lead-owned.

## Technical Approach

Use the existing deferred-recovery fixture boundary to demonstrate the missing
interaction-handler attachment after desktop settlement. Make the smallest
generic controller change that gives deferred-eligible additions the same
handler setup as immediate additions. Do not change the explicitly unsupported
interactive-resize path or inspect application identity.

The user-run Steam journey is acceptance evidence for generic move/placement,
not a condition for creating a Steam-specific path.

## Gate Evidence Map

| ID | Literal command | Current baseline | Expected post-change result |
|---|---|---|---|
| G-01 | `cd kwin && ./node_modules/.bin/esbuild "tests/controller-deferred-recovery-and-fullscreen.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile=/tmp/opencode/deferred-window-focused-baseline.cjs && node --test --test-name-pattern='^TileController deferred invariant recovery$' /tmp/opencode/deferred-window-focused-baseline.cjs` | 14 tests, 1 suite, 14 pass, 0 fail | 15 tests, 1 suite, 15 pass, 0 fail |
| G-02 | `npm --prefix kwin run typecheck` | pass, no numeric count | pass |
| G-03 | `bash scripts/build-kpackage.test.sh` | pass, no numeric count | pass |
| G-04 | `bash scripts/start-test.test.sh` | 255 pass, 0 fail | 255 pass, 0 fail |
| G-05 | `bash scripts/live-test.test.sh` | 207 pass, 0 fail | 207 pass, 0 fail |
| G-06 | `npm --prefix kwin test` | 993 tests, 95 suites, 993 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo | 994 tests, 95 suites, 994 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo |
| G-07 | `npm --prefix kwin run build` | committed `kwin/contents/code/main.js`: 362621 bytes, SHA-256 `eadec463b6872778466df6672322c2382441eed78efc8ddc394a59a9b2f17f58` | exit 0; deterministic source-corresponding `main.js` with resulting size/SHA-256 recorded; no unrelated generated drift |
| L-01 | `bash scripts/live-test.sh run` | not run: user unavailable and live host mutation prohibited | user-run pass with Steam add, move, placement, tile, geometry, and cleanup evidence |

`G-07` is the canonical build gate. Its only allowed generated output is
`kwin/contents/code/main.js`; the accepted commit must include that resulting
bundle. Record its resulting size and SHA-256, and reject unrelated generated
drift. `G-06` remains the approved broad test gate and its execution must
account for this same canonical output.

## Work Units

| ID | Objective | Depends on | Scope | Verification |
|---|---|---|---|---|
| unit-01 | Add one regression for a window added with unsettled desktops that becomes eligible through deferred reevaluation, then make the smallest generic fix so its interaction handlers exist before move signals. | - | Deferred add/reevaluation controller path and closest deferred-recovery fixture only. | `G-01`, `G-02` |
| unit-02 | Run the risk-tier static integration checkpoint and inspect the resulting diff/evidence. | unit-01 | Static integration only; canonical `kwin/contents/code/main.js` output only; no host mutation. | `G-03`, `G-04`, `G-05`, `G-06`, `G-07` |
| unit-03 | Run the Steam move/placement journey and record acceptance evidence. | unit-02 | User-authorized live KWin/Plasma session only; no Steam branch. | `L-01` |

## Live Gate Contract

`L-01` is parked. It requires all of the following before dispatch:

- Explicit user authorization for the window journey and Custom Tile structural
  operations.
- Required tools: `npm`, `busctl`, `jq`, `journalctl`, and `pgrep`.
- Exactly one identifiable Wayland KWin process.
- A fresh `journalctl --user` cursor before loading and a nonce-owned live
  evidence/lock directory.
- The script's static preflight completion before plugin registration.

Cleanup must stop only the directly loaded script, restore plugin enablement
only when this run changed it, retain evidence, and remove the lock only after
nonce verification. `SIGKILL` is prohibited because it leaves manual residual
recovery work.

## Progress

- [x] unit-01 - accepted
- [x] unit-02 - accepted
- [ ] unit-03 - parked: generic pointer interactive resize is baseline; Steam
  live troubleshooting follows resize and remains user-run

## Attempt Accounting

- Change-wide implementation dispatches: 1
- Change-wide pre-review corrections: 0
- Change-wide finding-fix corrections: 0
- Change-wide independent reviews: 0
- Change-wide broad-gate runs: 1
- Change-wide no-progress streak: 0
- unit-01: attempt-01 accepted; 1 attempt
- unit-02: attempt-01 accepted; 1 attempt
- unit-03: 0 attempts

## Pending User Decisions

- Resolved: generic pointer interactive resize is baseline product scope; pointer
  tiled resize adjusts shared split boundaries or ratios and reflows neighbors.
- User-run Steam move/placement troubleshooting remains parked until after
  resize and user-run live work; no Steam-specific branch is selected.

## Acceptance-Criterion Evidence

| Acceptance criterion | Required evidence | Status |
|---|---|---|
| Deferred eligibility attaches handlers before move signals | `attaches interaction handlers when deferred desktop eligibility settles`; `G-01`: 15 tests, 1 suite, 15 pass, 0 fail | met |
| Generic behavior preserves existing boundaries | `kwin/src/controller.ts` deferred callback attaches through existing `interactiveDrag.attach`; `G-02` passed | met |
| Static integration remains sound | `G-03` passed; `G-04` 255 pass/0 fail; `G-05` 207 pass/0 fail; `G-06` 994 tests, 95 suites, 994 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo; `G-07` passed with `main.js` 362668 bytes, SHA-256 `8d547fe268cf3ed4ebc1345675a36b2d906318d6f4a501cdaba9f5b2ef6a4780`; generated scope limited to `main.js` | met |
| Steam move/placement works in a live session | User evidence from `L-01` | parked |

## Residual Risks

- Static fixtures cannot prove live KWin signal delivery or Steam's add-time
  desktop settlement.
- Generic pointer interactive resize is now baseline scope; its live behavior
  still requires user-run evidence and does not alter the generic deferred
  handler boundary.

## Final Outcome

- Static deferred-handler units are accepted; the Steam live unit remains parked
  behind the baseline resize work and user-run live availability.
