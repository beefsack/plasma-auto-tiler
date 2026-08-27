# COSMIC Controller-Path Directional Movement State

- Current major unit / attempt: `unit-02-controller-adapter` / parked after `attempt-01` at `/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811/worktree`. Unit 01 is historically accepted after one pre-review correction, one independent review, one finding-fix correction, and confirmation; its fixture files remain untracked and uncommitted, and current promotion freshness is unmet
- Completed units: baseline reconciliation accepted; `unit-01-cosmic-local-fixture` accepted
- Blockers: Unit 01's current promotion lacks fresh G-04 passing evidence because the canonical output contract omitted package-relative paths and tray environment; its sole reset is consumed, so no second review, correction, or reset is authorized. G-02-04 is corrected for future use to `node --test "$ATTEMPT/output/g02-04/tests"/*.test.js`, but no rerun is authorized. Unit 02 remains parked pending a user decision whether locked legacy directional behavior is product-required and a later separately approved controller capability boundary. No capability prerequisite, fallback, dual routing, locked-test change, or product-semantic decision is approved. Unit 03 depends on Unit 02; Unit 04 and G-07 through G-09 remain separately blocked on their recorded dependencies and approvals.
- Next dispatch: none. Preserve the unaccepted/ineligible isolated attempt and all protected artifacts. Do not use candidate or old temporary source/evidence, alter fixture ownership or pointer paths, perform host/live work, stage, commit, push, or archive.
- Process disposition: a prior planning Worker opened excluded pure-model material. Its pure-model content is discarded; no successor counter is consumed.
- VCS policy: no agent commit, push, or staging; user commit required at final completion; Lead / processed-beef process retains the candidate audit/reference material and its completed source cleanup.

## Candidate Audit/Reference Material

- Container: `docs/changes/2026-08-25-cosmic-controller-path-directional-movement/unit-01-candidate.patch`
- SHA-256: `dbe28416517a1966ddf3d8a18e3a01700b83ab3c6bd6d183d4c8988d4c15a434`
- Contained paths: modified `kwin/tests/controller-fixtures.ts`; created `kwin/tests/controller-cosmic-directional-movement.test.ts` from `/dev/null`
- Reason: retain unaccepted historical audit/reference material after its consumed finding-fix breaker and the approved changed-kind reset.
- Omission incident: the original manifest treated the test as repository baseline, but scoped VCS status proved it was an untracked Unit 01-created path. Its absence from the container explained pointer-resize R-02's seven errors.
- Owner: Lead / processed-beef process
- Retention: byte-for-byte through this change; never read, applied, copied, altered, relabeled, or used as acceptance evidence.
- Cleanup disposition: source cleanup completed after combined-container verification: `kwin/tests/controller-fixtures.ts` is at `HEAD`; the untracked test is deleted; the audit/reference material remains retained and recoverable.
- Recovery verification: `git apply --numstat` reports exactly the two listed paths (361 additions/3 deletions and 266 additions/0 deletions). In a disposable `HEAD` worktree at `6466c99`, the fixture was clean, the test absent, and `git apply --check` accepted this container. Pointer R-02 may retry its preservation check.

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews | Breaker |
|---|---:|---:|---:|---:|---:|
| `unit-01-fixture-corpus` | 1 | 1 | 1 | 1 | 1 (parked) |
| `unit-01-cosmic-local-fixture` | 1 | 1 | 1 | 1 | 0 (historically accepted; current untracked/uncommitted promotion lacks fresh G-04 evidence) |
| `unit-02-controller-adapter` | 1 | 0 | 0 | 0 | 0 (paused scope/gate decision) |
| `unit-03-static-integration` | 0 | 0 | 0 | 0 | 0 |
| `unit-04-host-protocol` | 0 | 0 | 0 | 0 | 0 |
| `unit-05-host-checkpoint` | 0 | 0 | 0 | 0 | 0 |

| Implementation dispatches | Dispatch-invalids | Pre-review corrections | Finding-fix corrections | Independent reviews | Changed-kind resets | Broad gate runs | Worker tool-call proxy | Lead tool-call proxy | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | 1 | 2 | 2 | 2 | 1 | 5 | 4 + Unit 01 Workers unreported + Unit 02 attempt-01 unreported | 122 | 2 + G-02-01/G-02-02/G-02-03 canonical gates advanced | 0 |
