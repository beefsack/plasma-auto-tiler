# 0.1 triage batch 1: KDE/shared offline verification

## Goal and scope

- Prove approved D05 / REQ-INS-05: admission while an ordinary float is
  focused uses prior tiled focus B as the ordinary long-edge anchor.
- Prove D07 / REQ-CLOSE-02: close then reopen receives fresh admission,
  without introducing restore policy.
- Add discriminating shared fixtures and KDE adapter coverage; update reference
  outcomes, durable decisions and the requested backlog status.
- Native live acceptance is pending and user-owned. No live testing, unrelated
  triage implementation, or Windows-specific behavior changes.

## Acceptance and approach

- Verify R-INS-05 on the existing shared Engine convergence route and the KDE
  PlanAdapter wire boundary. Admission policy remains unchanged.
- R-INS-05 must distinguish insertion beside B from root wrapping; R-CLOSE-02
  must distinguish fresh admission from restoring the closed slot.
- Preserve portable Windows compatibility and existing admission behavior.
- Run workspace tests, strict clippy/fmt, portable checks and Windows portable
  allowlist, KWin JS tests/typecheck/bundle, and native CTest if native code changes.

## Work units

1. Investigate and verify shared/KDE behavior, fixtures and spec
   reference cells; report exact commands, counts and material discoveries.
2. Inspect evidence and diff, update project records and archive this note.

## Coordination and decisions

- Started from clean `fa6983a`; initial `git pull --rebase` was up to date.
- User approved D05 and D07 on 2026-10-10; product decisions require a stop and report.
- 2026-10-11: D05 verification-only for simplicity: the
  approved behavior already holds via the Engine path. Revert the candidate
  remembered-tile fallback and its dependent seed/admission fixtures.

## Evidence and outcome

- Source tracing and the pre-fix probe show retained float-focus admission
  already anchors at B: Engine
  forwards native F to convergence (`engine.rs:695-714`), but Session admission
  starts with retained tiled focus B (`session/world.rs:1058-1080`). Float
  focus does not clear that tiled focus. The backlog's production-gap premise
  is not reproduced.
- The discarded repair changed direct Session propose/seed admission with
  off-domain/unset focus and valid tiled history, rather than the requested
  production float-focus journey. All production source edits and the two
  dependent fixtures were reverted after that decision.
- Independent review rejected the original off-domain-only fixture as proof
  of float-focus behavior and caught an incorrect Horizontal axis assertion.
  Corrected fixtures use B's tall 60x80 target (Vertical) and add actual native
  F convergence characterization. Review also identified an unsupported
  survivor-ratio claim; that leg is now TBD. Unneeded convergence fallback
  changes were removed rather than broadening close/open semantics.
- Three shared fixtures now prove retained float-focus long-edge geometry
  (`H[A,V[B,C]]` in a 120x80 domain, exact A/B/C frames), genuine multi-leaf
  no-anchor root-wrap, and D07 close/refocus/fresh-reopen without old-slot
  restoration. The mocked KDE PlanAdapter fixture proves F/C wire routing.
  Native observation, activation and ratio acceptance remain user-owned live
  checks; no policy or adapter production changes are shipped.
- Final gates: Rust workspace 1327 passed; explicit CI Windows
  portable package allowlist on Linux 1175 passed; KWin 1308 passed across 188
  suites. Workspace/allowlist strict clippy, fmt, portable dependency/leak
  check, allowlist build, KWin typecheck/bundle and diff whitespace pass.
  Logs: `d05-cargo-test.log`,
  `d05r-win-test.log`, `d05-kwin-test.log`.
- No native source changed; no live testing. Existing stashes remain untouched.
  Offline scope is complete; pending native acceptance stays in the backlog.
