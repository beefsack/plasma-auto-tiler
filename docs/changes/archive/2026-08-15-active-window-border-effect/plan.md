# Active Window Border Effect Plan

## Execution Level

Expanded. A user-requested consequential reassessment requires durable
rendering-option research and a later implementation-route decision.

## Approach

The accepted implementation is the explicitly experimental standalone OpenGL
route, capability-gated to a clean unsupported-renderer no-op, with exactly one
effect-owned direct-value `KWin::OutlinedBorderItem` and exactly one scene
attachment. Static acceptance is complete after the independent review and
final native and repository verification. Grouped windows remain parked on a
separate compositor-owned KWin core support track; they must not share this
border carrier.

## Dependencies

- The native toolchain dependency restart is complete.
- User-run live mutation and live acceptance remain required after static
  evidence is accepted.
- Grouped/tabbed windows remain parked for compositor-owned KWin core support
  and a user-run multi-window Custom Tile stability proof. The proof is
  necessary but insufficient; no group gestures, bindings, header carrier,
  interaction semantics, or implementation is selected.
- Deterministic core KPackage packaging follows static-border acceptance as a
  separate change. Native metadata validation is static/build-time;
  `kpackagetool6` does not validate the native `.so` plugin.
- Rejected `unit-02` attempts and their retained diff are not to be reverted or
  modified. `unit-02/attempt-03` is a fresh correction/implementation attempt,
  not a continuation of a rejected attempt.

## Research Evaluation Criteria

Each research unit evaluates only evidence it can establish and records
uncertainty. The synthesis compares public and supported APIs; KWin 6.7.3 host
support and likely forward compatibility; OpenGL, Vulkan, and QPainter behavior;
Wayland, XWayland, SSD, and CSD coverage; normal scene chaining and direct
scanout limitations; ownership and resource safety; custom shader, texture, and
input requirements; external dependency maturity, security, maintenance, and
license; ABI and distro packaging; build and testability; C++ surface area;
active upstream use; and migration path.

Cross-feature research additionally compares historical and current KWin
tabbing/group surfaces; KDecoration and effect/Qt Quick carrier boundaries;
controller-to-carrier communication; Wayland, XWayland, SSD, and CSD coverage;
input, focus, stacking, and lifecycle; mature reference compositor practice;
dependencies, licenses, maintenance, ABI, packaging, and upstream direction.

## Work Units

### unit-01 - Native Plugin Skeleton

- Status: accepted on 2026-08-15.
- Add the smallest native CMake target, `KWin::Effect` subclass, plugin factory,
  and native metadata definition.
- Keep the effect disabled by default and compile it with strict warnings as
  errors.
- Evidence: configured and clean build output establishes public KWin linkage,
  generated meta-object handling, factory metadata inclusion, and warning-free
  compilation.
- Accepted evidence: the native module built cleanly against KWin 6.7.3 with
  `KWin::kwin`, generated plugin meta-object support, embedded factory metadata,
  and `EnabledByDefault: false`; compile commands included `-Wall -Wextra
  -Werror`. New C++ files passed deterministic clang-format and focused
  clang-tidy, and `git diff --check` passed.
- Dependency: approved specification and installed native KWin toolchain.

### unit-02 - Bordered Painting And Eligibility

- Status: accepted on 2026-08-15 after authorized direct-Lead production
  exception `unit-02/attempt-04`, independent review, and final static
  verification.
- Preserve normal scene painting on OpenGL only. Capability-gate unsupported
  renderers to a clean no-op and use exactly one effect-owned direct-value
  `KWin::OutlinedBorderItem` with automatic lifetime and exactly one safe scene
  attachment for an eligible active window to show its thin fixed-style
  rectangular frame.
- Request repaint on activation and relevant geometry/state changes. Suppress
  painting for absent, deleted, minimized, and fullscreen active windows.
- Evidence: focused eligibility tests where applicable, plus static source and
  installed-public-API inspection proving normal-paint chaining, the sole
  direct-value attachment, capability/no-op behavior, safe detach and automatic
  lifetime, and repaint hooks. No heap allocation, smart ownership, raw owning
  pointer, `new`/`delete`, external dependency, or group carrier is permitted.
- Dependency: accepted `unit-01`.

### research-01 - Upstream KWin Rendering Options

- Status: accepted on 2026-08-15.
- Research current, publicly supported KWin and built-in options without
  assuming viability: built-in or upstream KWin capability, KDecoration,
  public effect and scene-item routes, Qt Quick only where genuinely supported,
  and renderer-specific effect routes.
- Establish API support, renderer and window-system coverage, lifecycle and
  scanout behavior, ownership requirements, compatibility, testability, and
  migration implications against the research evaluation criteria.
- Durable output: contribute cited findings to
  `docs/changes/active-window-border-effect/research/rendering-options.md`.
- Dependency: accepted `unit-01`; independent of paused `unit-02`.
- Accepted evidence: cited KWin 6.7.3 headers/source and v6.7.4 comparison
  establish that `OutlinedBorderItem` is OpenGL-only and that its inspected
  effect attachment/lifetime route is not supported by a public factory. The
  decoration owner uses `std::unique_ptr`, which conflicts with the current
  no-manual-lifetime constraint. The research records this as an evidence gap,
  not an implementation-route decision.

### research-02 - Ecosystem Reuse Options

- Status: accepted on 2026-08-15.
- Research mature third-party effects, dependencies, and reusable libraries
  that could simplify the border implementation, without assuming any is
  acceptable.
- Establish active upstream use, maintenance and security posture, license,
  ABI and distro-packaging impact, supported API boundary, renderer and window
  coverage, C++ surface, build and testability, and migration path against the
  research evaluation criteria.
- Durable output: contribute cited findings to
  `docs/changes/active-window-border-effect/research/rendering-options.md`.
- Dependency: accepted `unit-01`; independent of paused `unit-02`.
- Accepted evidence: the cited candidate repositories and KWin API establish
  that the viable-looking native example is GPL shader-based, ABI-coupled, and
  rebuild-sensitive; other candidates are decoration or QML mechanisms, or
  import a larger patched/shader stack. No candidate satisfies the existing
  no-custom-shader, no-manual-ownership native-effect constraints.

### research-03 - Rendering-Option Synthesis And Recommendation

- Status: accepted on 2026-08-15.
- Compare the evidence from `research-01` and `research-02` against the
  product and governance criteria, identify unsupported or high-risk options,
  and recommend a route or a bounded decision question for the user.
- Do not implement or modify retained source. Do not treat a recommendation as
  user approval.
- Durable output: finalize the comparison and recommendation in
  `docs/changes/active-window-border-effect/research/rendering-options.md`.
- Dependency: accepted `research-01` and `research-02`.
- Accepted evidence: the cited synthesis compares all available product routes.
  It recommends deferring implementation for an upstream supported,
  backend-portable per-window border/attachment API. Its only fallback is an
  explicitly user-approved OpenGL-only experimental native route after exact
  specification/governance changes, lifetime evidence, and capability gating;
   no external dependency is recommended.

### research-04a - Authoritative KWin Grouped/Tabbed Landscape

- Status: accepted on 2026-08-15.
- Establish authoritative current and historical evidence for KWin core
  tabbing/group APIs, public and internal boundaries, KDecoration, effect and
  Qt Quick scene carriers, controller-to-carrier communication, renderer and
  backend constraints, and upstream direction. Evaluate Wayland, XWayland,
  SSD, CSD, input, focus, stacking, lifecycle, ABI, and packaging.
- Record capability boundaries and uncertainty without selecting a group
  gesture, binding, header carrier, interaction model, or implementation.
- Durable output: create and populate
  `docs/changes/active-window-border-effect/research/grouped-window-options.md`.
- Dependency: accepted `research-03`; independent of paused `unit-02` but does
  not satisfy the active-border delivery or user-run multi-window Custom Tile
  stability prerequisite for grouped-window design or implementation.
- Evidence: cited authoritative KWin/KDecoration/Qt sources, clearly scoped
  current and historical implementation evidence, and an explicit distinction
  between supported extension APIs, internal implementation, and unproven
  behavior.
- Accepted evidence: KWin v6.7.3 source and authoritative KDE history establish
  that KDE 4 `TabGroup` was disabled and removed in 2019, with CSD prevalence
  the stated reason not to revive it. Current X11 ICCCM `Group` and transient
  relations are not tab containers; no public group lifecycle, shared-geometry,
  per-window hit-test, or controller-to-effect carrier API was found. The
  evidence separately records native-effect, scene, Qt Quick, and decoration
  boundaries and preserves the required user-run Custom Tile proof.

### research-04b - Grouped/Tabbed Ecosystem And Reference Architectures

- Status: accepted on 2026-08-15.
- Research mature ecosystem implementations and reference-compositor
  architectures and dependencies. Establish their native grouping models and
  what those models imply for KWin, including licenses, maintenance,
  supply-chain and reuse suitability, ABI, packaging, and upstream direction.
- Record capability boundaries and uncertainty without selecting a group
  gesture, binding, header carrier, interaction model, dependency, or
  implementation.
- Durable output: extend
  `docs/changes/active-window-border-effect/research/grouped-window-options.md`.
- Dependency: accepted `research-03`; independent of paused `unit-02` but does
  not satisfy the active-border delivery or user-run multi-window Custom Tile
  stability prerequisite for grouped-window design or implementation.
- Evidence: cited mature ecosystem and reference-compositor sources, explicit
  license, maintenance, supply-chain, reuse, ABI, and packaging assessment, and
  a bounded KWin implication for each native grouping model.
- Accepted evidence: mature reference compositors make grouping a
  compositor-owned layout/scene container with lifecycle, focus, visibility,
  and input control; KWin scripts only co-manage geometry. No examined external
  UI, protocol, decoration, or script dependency supplies KWin group ownership
  or a tab-header input carrier.

### research-05 - Joint Border And Grouped-Window Synthesis

- Status: accepted on 2026-08-15.
- Compare shared versus separate border and group rendering carriers. Identify
  coupling risks, sequencing, capability gates, dependency strategy, upstream
  contribution path, prototype fallback, and the exact later user decisions.
- Preserve the user-run multi-window Custom Tile stability prerequisite and do
  not select group gestures, shortcuts, bindings, header carrier, controls, or
  interaction semantics.
- Durable output: extend
  `docs/changes/active-window-border-effect/research/rendering-options.md` with
  the joint synthesis and cross-feature implications, and cross-reference the
  detailed grouped evidence.
- Dependency: accepted `research-04a`, accepted `research-04b`, and accepted
  `research-03`.
- Evidence: cited comparison of independently established carrier and lifecycle
  capabilities, explicit gates, and a bounded list of future user decisions.
- Accepted evidence: the cited joint synthesis rejects a shared carrier because
  a non-interactive border cannot reduce the missing compositor-owned group
  lifecycle, input, focus, and hit-test work. It recommends two separate
  upstream tracks with implementation deferred; the sole bounded fallback is an
  independently approved OpenGL-only experimental border while groups remain
  parked. The Custom Tile proof remains necessary, not sufficient, for future
   grouped-window work; no dependency is recommended.

### Research Completion Checkpoint

- Status: `research-01` through `research-05` are complete and accepted on
  2026-08-15, with `research-04a` and `research-04b` completing the scoped
  grouped-window landscape.
- Result: the user selected the Experimental border only fallback. The research
  evidence remains retained and is not rewritten; it establishes the OpenGL
  capability/no-op and automatic-lifetime risks that `unit-02/attempt-03` must
  address.

### Independent Review Gate

- Status: accepted on 2026-08-15. The independent review found no required
  source correction: the direct-value lifetime and teardown route, OpenGL
  no-op gate, single attachment, normal paint chaining, eligibility/repaint
  handling, metadata, and CMake constraints match the approved experimental
  scope. It recorded the public-API-boundary caveat already covered by the sole
  approved scene exception and the existing live-only risks. The review Worker
  exceeded its assigned 20-call cap; this process exception is recorded and
  does not replace the required static-verification evidence.
- After `unit-02/attempt-04`, dispatch one independent review of the
  implementation diff and its static evidence before final verification.
- The review returns concrete evidenced findings only. One bounded same-scope
  correction pass is permitted before `unit-03`.
- Trigger: native KWin ABI, lifecycle, and painting behavior are subtle beyond
  what focused pure tests alone establish.

### unit-03a - Focused Static Seams

- Status: accepted on 2026-08-15. It follows the accepted independent review
  gate; that review does not accept the implementation.
- Add focused pure eligibility/geometry tests where practical, validate native
  metadata and factory wiring, and retain only the smallest testable production
  seam without speculative abstraction.
- Remove the reviewed unused Qt6 Widgets requirement only if actual target
  evidence confirms it is unused.
- Evidence: focused test outcomes, metadata/factory validation, and target
  linkage evidence for any Qt6 Widgets removal.
- Accepted evidence: the production-consumed pure `ActiveBorderState` seam
  covers eligible frame geometry and absent, deleted, minimized, and fullscreen
  windows. Native CTest metadata/factory validation passed without
  `kpackagetool6`; CMake import evidence retained Qt6 Widgets because
  `KWin::kwin` requires `Qt6::Widgets`. Native configure/build, CTest,
  deterministic format, and `git diff --check` passed.
- Dependency: accepted independent review gate.

### unit-03b - Final Static Verification

- Status: accepted on 2026-08-15 after direct Lead host-unknown reconciliation.
  The prior `unit-03b` attempt remains host-unknown and non-evidence.
- Native-only verification: use Nix-resolved clang-tidy, deterministic format,
  two clean warnings-as-errors builds, and CTest for both builds; verify native
  metadata, factory, and output; compare SHA-256 values and bytes; and run the
  native diff-check.
- Evidence: recorded reproducible native command outcomes map each native final
  static acceptance criterion to its check.
- Accepted evidence: two fresh Ninja builds in `/tmp/opencode` with
  `BUILD_TESTING=ON`, compile commands, warnings as errors, and the resolved
  wrapped Nix `clang-tidy` passed without findings. Both CTest registrations
  resolved and passed `appstreamtest`, `native-effect-logic`, and
  `native-effect-metadata-factory-validation`. Deterministic format and
  path-specific whitespace checks passed. Both exact plugin outputs at
  `bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so` were 52736
  bytes with SHA-256
  `62a788559de3563638dab4a40ede6fd7677bea76ff2ea2e2ce8eebd5f4084857`.
- Dependency: accepted `unit-03a`.
- Completion: native-only verification completes only after accepted
  `unit-03b`.

### unit-03c - Repository Non-Live Baseline

- Status: accepted on 2026-08-15. The verification Worker exceeded its assigned
  hard 20-call cap (37 calls); this process exception is recorded separately and
  does not change the unchanged-scope command evidence.
- Establish the existing repository non-live baseline: typecheck, declared JS
  build and reproduction, Node tests, start-test shell, live-runner fake-tool,
  dogfood installer, final diff/check, and feasibility metrics. Do not run live
  mutation or live acceptance.
- Evidence: recorded reproducible command outcomes and feasibility metrics map
  each repository baseline criterion to its check.
- Dependency: accepted `unit-03b`.
- Completion: static verification and this change complete only after accepted
  `unit-03c`. User-run live acceptance remains separate and the effect remains
  disabled by default.
- Accepted evidence: `npm run typecheck`, declared `npm run build`, `npm test`,
  `bash scripts/start-test.test.sh`, `bash scripts/live-test.test.sh` with fake
  tools only, and `bash scripts/dogfood-install.test.sh` all passed. The bundle
  was reproduced by the declared build with the same 355498-byte SHA-256 before
  and after: `7d422cfec258edb2682d41c6abd0e5055c1ad562d28418689aa8bfff437fb4ba`.
  Node reported 805 passing tests in 76 suites; the start-test, fake-tool, and
  dogfood suites reported 271, 195, and 156 passes respectively. Final staged
  and unstaged diff checks passed; no tracked bundle change resulted.

## Acceptance Evidence Map

| Criterion | Static Evidence | Later User-Run Evidence |
| --- | --- | --- |
| Experimental disabled OpenGL plugin, factory, metadata, no dependency | Accepted CMake/build and metadata/factory evidence | User may load the disabled effect |
| Capability/no-op, normal painting, and thin rectangular frame | Accepted source/public-API inspection and independent review | Confirm OpenGL border, normal scene behavior, and unsupported-renderer no-op |
| Direct-value lifetime, safe detach, repaint, and ineligible-window suppression | Accepted eligibility tests, source inspection, and independent review | Activate, resize, minimize, fullscreen, and close windows |
| Native quality and reproducibility | Wrapped clang-tidy zero findings; two Werror builds; CTest 3/3; deterministic format and diff checks; byte-identical 52736-byte plugins with SHA-256 `62a788559de3563638dab4a40ede6fd7677bea76ff2ea2e2ce8eebd5f4084857` | Not applicable |
| Repository non-live baseline | Accepted typecheck, byte-identical bundle SHA-256 `7d422cfec258edb2682d41c6abd0e5055c1ad562d28418689aa8bfff437fb4ba`, Node 805/805 in 76 suites, start-test 271, fake live-runner 195, dogfood 156, and diff checks | Not applicable |
| Approved rendering route | Accepted cited comparison in `research/rendering-options.md` and `research/grouped-window-options.md` | User approval recorded; live acceptance remains user-run |

## Final Outcome

Static acceptance is complete. The experimental plugin is disabled by default,
OpenGL-only, and has no dependency or grouped-window integration. User-run live
acceptance remains pending and was not performed by an agent.

## Pending User Decisions

None. Grouped/tabbed-window decisions remain unselected and parked for
compositor-owned KWin core support plus the necessary-but-insufficient user-run
multi-window Custom Tile stability proof.

## Residual Risks

- Native KWin plugins have ABI rebuild risk across KWin/Plasma updates.
- The experimental border renders only on OpenGL; unsupported renderers must
  remain a clean no-op and require later user-run confirmation.
- Static checks cannot prove live compositor behavior; that acceptance is
  explicitly user-run.
- The direct-value item and its single attachment/detachment path remain subject
  to live compositor lifecycle confirmation despite accepted static evidence and
  independent review.
- Grouped windows remain out of scope: the separate carrier avoids coupling
  border rendering to missing compositor-owned lifecycle, focus, input, and
  hit-test support.
