# Plan: KWin Version Alignment

Ownership and approval:
- Owner: Lead
- Status: Completed

## Technical Approach

Use the evaluated `pkgs.kdePackages.kwin` package and its `.dev` output as the
single development-environment ownership point. Reset unit-02 by selecting the
project's existing rolling `nixpkgs` input with `devenv update nixpkgs`, limited
to the approved parent and child lock fields that evaluate KWin 6.7.4. Export
the evaluated CMake directory and use it as the dogfood script default, with
`DOGFOOD_KWIN_DEV_CMAKE_DIR` retaining test-only precedence.

## Work Units

| ID | Objective | Depends on | Scope | Gates |
|---|---|---|---|---|
| unit-01 | Create/reconcile artifacts; implement evaluated KWin package ownership and focused tests only if necessary; run only gates valid before restart. | - | `devenv.nix`, `scripts/dogfood-install.sh`, focused tests if necessary, this change's artifacts, existing one-line backlog entry only if needed | G-STATIC |
| unit-02 | Changed-kind `reset-01`: in attempt-02, select and statically prove the evaluated project KWin 6.7.4 lock; after acceptance and a user restart, run the existing environment and dogfood gates. | unit-01, blocked attempt-01, approved reset; user restart after lock acceptance | `devenv.lock` only: the approved parent/child `locked.{lastModified,narHash,rev}` fields; append-only change record-keeping | G-LOCK-UPDATE, G-LOCK-EVAL, G-HOST, G-TEST, G-ENV, G-BUILD, G-RELOAD, G-LIVE |

## Evidence Map

| Gate | Type | Literal command or observation | Expected baseline | Status |
|---|---|---|---|---|
| G-HOST | live read-only | `qdbus org.kde.KWin /KWin org.kde.KWin.supportInformation` | KWin 6.7.4 | Passed after restart: KWin 6.7.4 |
| G-STATIC | static | `rg -n '6\.7\.3|builtins\.storePath' devenv.nix scripts/dogfood-install.sh` | No matches, command exits 1 | Accepted in unit-01 |
| G-LOCK-UPDATE | static dependency mutation | `devenv update nixpkgs` | Only `nodes.nixpkgs.locked.{lastModified,narHash,rev}` changes to `1787002832`, `sha256-DGkHh88/7YLVGZ7HzSVN4YmUmR+wGKudIp6H9UsUNT0=`, `ee3d58d53cfcddfc0ae6fc7f04f4fe2a0c7cf0ed`; only `nodes.nixpkgs-src.locked.{lastModified,narHash,rev}` changes to `1786858016`, `sha256-Vczr2zxD0orq6N2QQe5uqOGF7TRDcQJRRuAcsdHr4kg=`, `54ba4bcec4043e72a4006d825e0d7aff5562008f`; originals and node set unchanged | Passed in reset-01/attempt-02 |
| G-LOCK-EVAL | static pre-restart | `devenv eval --refresh-eval-cache packages` | Relevant paths are `kwin-6.7.4` and `kwin-6.7.4-dev`; no package realization | Passed in reset-01/attempt-02: relevant runtime and dev paths were 6.7.4 |
| G-TEST | static after restart | `devenv shell --impure -- bash scripts/dogfood-install.test.sh` | At least 281/281 passing | Passed after restart: 347/347; known temporary-root `find` and devenv executable-versus-lock warnings are benign |
| G-ENV | static after restart | `devenv shell --impure -- bash -c 'readlink -f "$(command -v kwin_wayland)"; printf "%s\n" "$PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR"'` | 6.7.4 runtime and `kwin-6.7.4-dev/lib/cmake/KWin` | Passed after restart: both paths resolve to 6.7.4 |
| G-BUILD | live after restart | `devenv shell --impure -- bash scripts/dogfood-install.sh effect-install` | Successful 6.7.4 build/stage | Passed after restart: built and staged against 6.7.4 |
| G-RELOAD | live after restart | `devenv shell --impure -- bash scripts/dogfood-install.sh effect-reload` | Loaded message | Passed after restart: `plasma-auto-tiler-active-border` loaded |
| G-LIVE | live read-only after restart | `bash scripts/dogfood-install.sh effect-status` | Discovery yes and loaded yes | Passed after restart and Lead read-only reconciliation: discovery yes; loaded yes; session-delivery diagnostic inconclusive because `/proc/2352/environ` is unreadable |

## Startup Policy

- `agent_commits=false`
- `agent_pushes=false`
- `staging_owner=Lead at final completion`
- `user_commit_required=true`
- `candidate_preservation=none`
- `cleanup_owner=Lead`

## Progress

- [x] unit-01 - implementation and pre-restart static gate
- [x] unit-02 - reset-01/attempt-02 lock selection and post-restart gates accepted

## Attempt Accounting

- unit-01: implementation dispatches 1; dispatch-invalid 0; pre-review corrections 0; finding-fix corrections 0; independent reviews 0; accepted after Lead diff and G-STATIC inspection.
- unit-02: implementation dispatches 2; dispatch-invalid 0; pre-review corrections 0; finding-fix corrections 0; independent reviews 0; reset-01/attempt-02 accepted after exact G-LOCK-UPDATE and G-LOCK-EVAL; all post-restart gates accepted.
- Change-wide: implementation dispatches 3; dispatch-invalid 0; pre-review corrections 0; finding-fix corrections 0; independent reviews 0; changed-kind resets 1; broad-gate runs 3; acceptance criteria moved 5; no-progress streak 1; Lead tool-call proxy 50; Worker tool-call proxy unavailable from host telemetry. The post-restart gate-only verification did not consume an implementation-attempt, correction, or reset budget.

## Review Disposition

- No independent-review trigger applies: the accepted source/lock work has one failed implementation attempt rather than two, the gate-only Worker did not cross scope or omit required evidence, and the standing-authorized reversible host mutations had focused successful evidence. No review dispatch is required.

## Final Outcome

- Orchestrator alignment approval and user result approval are recorded. The user
  reported `Pass - border visible`, completing visual active-border acceptance.

## Residual Risks

- G-LIVE's session-delivery diagnostic is inconclusive because `/proc/2352/environ`
  is unreadable, while its required discovery and loaded baselines pass. The
  user nevertheless confirmed visible border rendering.
- G-TEST's benign diagnostics do not authorize a general lock refresh.
- `docs/changes/host-dogfooding/spec.md` has a historical approval-status
  discrepancy: its header says "Pending user approval" while its plan/log
  record accepted work. This correction does not alter that historical scope.

## Pending User Decisions

- None.
