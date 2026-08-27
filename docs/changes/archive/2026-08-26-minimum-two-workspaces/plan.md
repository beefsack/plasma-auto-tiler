# Plan: Minimum Two Workspaces

Ownership and approval:
- Owner: Lead
- Status: Completed 2026-08-26; Orchestrator alignment approval granted and
  autonomous-mode result approval delegated

## Technical Approach

Make the smallest workspace-state cleanup predicate change needed to require a
fresh global desktop count above two before removal. Add a regression-first
shared-workspaces test reproducing exactly two eligible empty invisible desktops
and retain existing mode and invariant coverage. Existing accepted shared
workspace fixtures suffice because the requested scenario is a state variation,
not a new fixture/harness contract; unit-01 must stop if that proves false.

Evidence scope and authorization:
- Source snapshot: `6466c99dd497779d8499e0fef41cc5618593bff2`, 2026-08-26T12:46:02Z; approved source/test scope only.
- Output correspondence: recorded in this plan and `log.md` after each gate.
- Post-latest-change freshness: verified 2026-08-26 13:13 UTC against the
  reconstructed isolated snapshot and the unchanged current scoped patch.
- Read authorization: user packet, approved source/test scope, this change.
- Mutate authorization: user packet, this change artifacts plus approved source/test scope; no deletion.
- Warning baseline: informational only; warnings never mask a nonzero command or failed assertion.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Gate ID and literal canonical command (static or live) | Expected baseline |
|---|---|---|---|---|---|
| unit-01 | Regression-first fixed-floor implementation using existing fixtures | - | `kwin/src/controller.ts`, `kwin/tests/controller-shared-workspaces.test.ts`; `controller-workspace-state.ts` not required | `gate.focused`: focused bundled Node test from `/tmp/opencode`; `gate.typecheck`: `npm --prefix kwin run typecheck` | Both exit 0; focused test proves exact two-empty switch |
| unit-02 | Final integration verification and independent destructive-policy review | unit-01 source work complete; typecheck gap recorded | unit-01 diff and evidence; review writes no source | `gate.full`: `npm --prefix kwin test` | Current result baseline recorded; one frozen finding set |

Dependency graph: `unit-01 -> unit-02`. No new fixture/harness contract is expected; the existing shared-workspace fixtures are the accepted dependency. If unit-01 discovers a contract need, it stops before production integration and the Lead escalates for an approved graph change.

## Work-Kind Ledger

| Work kind | Scope | Read authorization | Mutate authorization | Evidence |
|---|---|---|---|---|
| mutate | Change artifacts | User packet | User packet; no deletion | Initial artifact creation |
| mutate | unit-01 approved source/test paths | User packet | User packet; no deletion | Pending worker result |
| read/review | unit-01 diff and gates | User packet | None | Pending |

## Scoped Candidate Inventory

- Scope: only the change artifacts and unit-01 approved source/test paths.

| Candidate | Classification (`tracked` or `untracked`) | Evidence / disposition |
|---|---|---|
| `docs/changes/archive/2026-08-26-minimum-two-workspaces/` | untracked | Lead-owned archived artifacts |
| `kwin/src/controller-workspace-state.ts` | tracked | Not required by reproduced removal path |
| `kwin/tests/controller-shared-workspaces.test.ts` | tracked | Approved candidate |
| `kwin/src/controller.ts` | tracked | Required: focused failure identifies `removeOwnedEmptyDesktop` as the global-count removal guard |
| Current dirty and untracked paths outside scope | mixed | Protected; no touch |

## Progress

- [x] unit-01 accepted: finding-fix correction and frozen-finding confirmation
  completed; the isolated focused gate passes 34/34.
- [x] unit-02 accepted: isolated `gate.typecheck` and exactly one fresh isolated
  `gate.full` both pass using the verified repository-managed dependency tree.

## Attempt Accounting

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews |
|---|---:|---:|---:|---:|
| unit-01 | 2 | 0 | 1 | 1 |
| unit-02 | 0 | 0 | 0 | 1 |

### Change-Wide Ledger

| Implementation dispatches | Dispatch-invalids | Pre-review corrections | Finding-fix corrections | Verification/harness repairs | Independent reviews | Changed-kind resets | Broad gate runs | Worker tool-call proxy | Lead tool-call proxy | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 0 | 0 | 1 | 0 | 1 | 0 | 2 | 114 | 100 | 4 | 0 |

## Fixture/Harness Contract

No new contract unit is planned. The exact two-empty scenario is covered by the
existing shared-workspace fixture boundary. Unit-01 must verify this before
changing production behavior; a missing capability is a stop-and-escalate
condition, not a production workaround.

## Startup VCS Policy

- Agent commits: no
- Agent pushes: no
- Staging owner: user
- User commit required: yes
- Candidate preservation container: none; no rejected-work preservation authorized
- Preservation manifest: n/a
- Cleanup owner: user

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate ID | Literal canonical command or observation | Expected baseline | Source snapshot | Output correspondence | Fresh after latest change | Warning baseline | Evidence |
|---|---|---|---|---|---|---|---|---|
| Exactly two eligible empty invisible desktops are retained | `gate.focused` | `npm --prefix kwin exec -- esbuild kwin/tests/controller-shared-workspaces.test.ts --bundle --platform=node --format=cjs --target=es2020 --outfile=/tmp/opencode/minimum-two-workspaces-isolated-focused.test.js`; `node --test /tmp/opencode/minimum-two-workspaces-isolated-focused.test.js` | Both exit 0; exact switch assertion passes | Isolated detached checkout at `6466c99dd497779d8499e0fef41cc5618593bff2` plus only complete scoped `controller.ts` and shared-workspace-test diff | `/tmp/opencode/minimum-two-workspaces-isolated-focused.test.js` | Yes | Informational only | Both exit 0; 34 focused tests pass, including the exact-two switch regression |
| More than two desktops clean up without crossing two | `gate.focused` | Focused bundled Node test written only under `/tmp/opencode` | Exit 0 and floor assertion passes | Isolated detached checkout at `6466c99dd497779d8499e0fef41cc5618593bff2` plus only complete scoped diff | `/tmp/opencode/minimum-two-workspaces-isolated-focused.test.js` | Yes | Informational only | Exit 0; global-unique five-desktop regression removes three eligible desktops and retains exactly two |
| Preserved workspace invariants remain passing | `gate.typecheck` | `npm --prefix kwin run typecheck` | Exit 0 | `/tmp/opencode/minimum-two-workspaces-verify-20260826T1315Z`: detached `6466c99dd497779d8499e0fef41cc5618593bff2` plus the byte-identical two-file scoped patch; `kwin/node_modules` is a temporary symlink to the verified repository-managed tree | `/tmp/opencode/minimum-two-workspaces-verify-20260826T1315Z-typecheck.log` | Yes | Informational only | Exit 0. The reused tree resolves the unchanged locked `@types/node@26.2.0`, `esbuild@0.28.2`, and `typescript@7.0.2`. |
| Full integration suite passes | `gate.full` | `npm --prefix kwin test` | Exit 0 | `/tmp/opencode/minimum-two-workspaces-verify-20260826T1315Z`: detached `6466c99dd497779d8499e0fef41cc5618593bff2` plus the byte-identical two-file scoped patch; `kwin/node_modules` is a temporary symlink to the verified repository-managed tree | `/tmp/opencode/minimum-two-workspaces-verify-20260826T1315Z-full.log` | Yes | Informational only | Exactly one fresh isolated run exited 0: 996 tests passed, 0 failed; the test-generated `kwin/contents/code/main.js` difference exists only in the temporary snapshot. |
| Destructive policy has one independent review | `gate.review` | Frozen-finding confirmation limited to the recorded finding | Frozen High finding closed | Isolated-scope diff from `6466c99dd497779d8499e0fef41cc5618593bff2` | Lead confirmation after `unit-01/finding-fix-01` | Yes | Informational only | Closed: global-unique removal rereads current desktops and refuses removal at the floor of two; targeted five-desktop regression proves the prior multi-removal failure and post-fix floor. |

## Frozen Review Finding Set

- Closed High - `kwin/src/controller.ts:4932,4976-4990`: `global-unique` cleanup passed a stale desktop snapshot into an unguarded removal primitive, so two global desktops could be reduced to one. `unit-01/finding-fix-01` now rereads the live list and refuses removal at two; Lead confirmation checked this finding only. No second independent review was performed.

## Residual Risks

- Static tests cannot demonstrate live KWin behavior; live work is prohibited.
- The acceptance evidence excludes all protected dirty-main paths. Historical
  pointer/drag failures remain unrelated observations rather than baselines.

## Final Outcome

- unit-01 and unit-02 are accepted. All acceptance criteria are met on fresh
  isolated evidence: focused 34/34, typecheck exit 0, and full suite 996 passed,
  0 failed. The frozen High review finding is closed. Orchestrator alignment
  approval and delegated autonomous result approval complete the change.
