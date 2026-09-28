# Learned size limits - phase 2 (2026-09-28)

## Goal and boundary

When a tiled client repeatedly holds a size different from a completed geometry request without an explanatory native hint, learn an effective per-window tested size limit and reproject feasible sibling space. Keep retained topology/shares distinct from observed geometry. Events and next commands only; KWin script and Rust tiling only. No position or step inference, interactive/mode learning, polling, native-hint redistribution change, or setter replay.

## Acceptance

- Settled repeatable Ghostty-class shortfall gives feasible neighbours the spare extent without repeated writes; changed client-held size expires learning and reprojects.
- Hint-clamped and infeasible/overconstrained paths retain their existing behavior; transient or interactive geometry never teaches a limit.
- Pure observations do not mutate shares/revision. Normal-level correlated learned/expired/reprojected route diagnostics; per-rect detail trace-only.
- Rust workspace tests, fmt check, strict clippy; KWin tests and typecheck; affected script tests; `git diff --check`.

## Approach and units

1. Inspect geometry attempt completion and comparator/reply lifecycle to establish settled evidence without a new timer/count; fix minimal wire representation for learned limits separately from native hints. Preserve interim fallback for unexplained drift.
2. Add portable learned-limit projection and protocol carrying, using retained shares and existing minimum policy; learned upper caps alone redistribute, native maxima do not.
3. Wire KWin lifecycle learning/expiry, no-fight disposition, diagnostics and behavior tests; verify integrations and archive.

## Evidence and outcome

- Baseline: branch `main` ahead 6; only pre-existing `devenv.nix` modified (untouched). Existing projector redistributes native minimums but deliberately never native maximums; a learned cap therefore needs a distinct redistribution input. Existing three-strike acceptance remains fallback for unexplained differences until a lifecycle-safe replacement is proved.
- First green point: `size_hints.rs` adds a separate optional learned-cap projection input. Feasible caps give surplus to siblings after existing native-minimum allocation; native maximums remain acceptance-only. Projector tests cover first/last child, nested groups, native max, infeasible min conflict; targeted Rust tests (18), fmt and library clippy pass. Next: carry caps as optional per-request advisory data into retained reconcile without changing `EngineWindow` or retained shares.
- Second green point: optional top-level `learned_max_sizes` (id -> `{w,h}`, zero means absent axis) is decoded into per-request advisory caps. Rust retained `reconcile` applies them without changing topology/revision; all other operations retain native-hint behavior. Protocol behavior test verifies a 1092 -> 1036 height cap transfers 56 px to its neighbour, native max does not, and infeasible caps fall back. Full Rust workspace tests, fmt and strict workspace/all-target Clippy pass.
- Adapter candidate (not accepted): one ref/scope-pinned map records observations after two independent successful eligible writes; KWin behavior tests cover promotion, held-size and hint expiry, hint clamps, position drift, interactive/pointer and pending frames. Full KWin `npm test` passes 805/805 (797 baseline); typecheck and `git diff --check` pass. No affected `scripts/*.test.sh`. No live KWin tests.

## Blocker - stop and handover

- Two adapter approaches exceeded the simplicity constraint: first tied promotion to the old three-strike counter and added 524 lines; second used independent completed-flight evidence but subsequent fixes grew it to +521/-4 lines in `kwin/src/plan-adapter.ts`. Independent review found serious gaps despite passing tests: infeasible/ignored caps can be repeatedly promoted and rewritten (no reply feedback), normal learned/expired logs use `correlation=none` rather than correlated `route-diag`, and cap state can survive changed allocation with unchanged domain scope. Send-time revalidation and native clamp tolerance also need resolution. Do not treat offline tests as acceptance of this candidate.
- Scope now: Rust production about +257 lines (projector/protocol/engine/boundary), KWin production +517 net; tests about +980 lines including 553-line untracked KWin fixture. Existing interim acceptance accounting is still present because unexplained and infeasible no-fight behavior has not been replaced. No changes to `docs/decisions.md` yet; existing decision remains authoritative. User's `devenv.nix` edit is untouched.
- Exact next action: Orchestrator/user decide whether to authorize a revised lean adapter approach with explicit infeasible-cap feedback and correlated transitions, or set this phase aside; do not archive this incomplete note. Live acceptance after any completed implementation: laptop - Ghostty 56 px and p13 36 px shortfalls, self-resize, neighbour resize, maximize/unmaximize and delayed event after signal-less change; multi-output PC - hidden domain, sticky/multi-home, output/work-area change, R4/send terminal and unreadable domain. Confirm client frames, logs, no loop and full area where feasible under `docs/live-kwin-testing.md` before claiming live acceptance.
