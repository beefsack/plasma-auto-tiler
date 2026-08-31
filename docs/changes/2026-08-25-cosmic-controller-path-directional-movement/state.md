# COSMIC Controller-Path Directional Movement State

- Current major unit / attempt: `unit-01-cosmic-local-fixture` / promotion refresh parked after fresh G-01 at `/tmp/opencode/cosmic-unit-01-promotion-85a3403-20260830/worktree`. Unit 01 is historically accepted after one pre-review correction, one independent review, one finding-fix correction, and confirmation; its fixture files remain untracked and uncommitted, and current promotion is unaccepted.
- Completed units: baseline reconciliation accepted; `unit-01-cosmic-local-fixture` accepted
- Blockers: The one authorized promotion refresh stopped at G-01: `npm --prefix "$WORKTREE/kwin" run typecheck` exited 127 because `tsc` was not found in the fresh isolated worktree. G-02 through G-04 and mandatory independent review did not run. No G-04 package-relative-path or tray-environment correction was reached. No retry, correction, reset, promotion, review, or Unit 02 work is authorized. Unit 03 depends on Unit 02; Unit 04 and G-07 through G-09 remain separately blocked on their recorded dependencies and approvals.
- Next dispatch: none. Preserve `/tmp/opencode/cosmic-unit-01-promotion-85a3403-20260830`, its two untracked fixture inputs, and all protected artifacts. Do not use candidate or old temporary source/evidence, alter fixture ownership or pointer paths, perform host/live work, stage the candidate or protected artifacts, or archive. The separately authorized records-only retirement commit and non-force push remain allowed.
- Process disposition: a prior planning Worker opened excluded pure-model material. Its pure-model content is discarded; no successor counter is consumed.
- VCS policy: the user authorized a scoped records-only commit and non-force push for the candidate retirement after identity verification and independent record review. The candidate itself must not be staged or committed.

## Candidate Audit/Reference Material

- Container: `docs/changes/2026-08-25-cosmic-controller-path-directional-movement/unit-01-candidate.patch`
- SHA-256: `dbe28416517a1966ddf3d8a18e3a01700b83ab3c6bd6d183d4c8988d4c15a434`
- Contained paths: modified `kwin/tests/controller-fixtures.ts`; created `kwin/tests/controller-cosmic-directional-movement.test.ts` from `/dev/null`
- Reason: retain unaccepted historical audit/reference material after its consumed finding-fix breaker and the approved changed-kind reset.
- Omission incident: the original manifest treated the test as repository baseline, but scoped VCS status proved it was an untracked Unit 01-created path. Its absence from the container explained pointer-resize R-02's seven errors.
- Owner: Lead / processed-beef process
- Retirement: explicitly user-authorized on 2026-09-01. Before deletion, the exact recorded path was verified as a regular file and its SHA-256 exactly matched `dbe28416517a1966ddf3d8a18e3a01700b83ab3c6bd6d183d4c8988d4c15a434`; no content inspection occurred.
- Disposition: retired and deleted after independent record review. It remains non-authoritative and unaccepted, with no acceptance or evidence impact; it was never read, applied, copied, staged, committed, altered, relabeled, or used as evidence.
- Cleanup disposition: candidate-only deletion has no source cleanup, ownership, fixture, pointer, or other-path effect. The prior source cleanup remains unchanged.
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
