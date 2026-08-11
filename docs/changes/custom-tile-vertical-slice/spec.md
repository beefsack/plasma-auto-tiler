# Specification: Custom Tile Vertical Slice

Ownership and approval:
- Owner: Lead (`lead-openai`)
- Change class: Standard.
- Status: Approved by the user on 2026-08-10.
- Artifact map: [plan](plan.md), [state](state.md), and [log](log.md).
- Dependency: accepted structural KWin source/composition evidence from the active [integrated-plasma-structural-feasibility change](../integrated-plasma-structural-feasibility/). Its unsafe live harness and nested-KWin path remain blocked and are not this change's runtime path.

## Intent and Desired Outcome

Deliver one narrow Custom Tile vertical slice for the current workspace and
output only. The KWin component is authored production TypeScript and KWin
executes only the generated bundled JavaScript artifact.

The slice demonstrates deterministic topology and hit-test behavior plus the
smallest guarded KWin integration needed for the following journeys:

- Keyboard insertion places the next eligible window to the right of the
  focused occupied leaf.
- Pointer drag over a different occupied leaf resolves four directional
  regions; the central 50% is a no-op, and a diagonal tie resolves horizontally.
- Cancellation restores the origin association and geometry without mutating
  the target.
- A successful drag retains the now-empty origin leaf.
- Ordinary placement fills a retained empty leaf without restructuring it.

## Scope and Constraints

In scope:

- A strict TypeScript-only authored KWin component and reproducible generated
  JavaScript bundle.
- Pure deterministic topology and pointer hit-test logic independent of KWin
  and Qt, with executable vectors and tests.
- Narrow, runtime-guarded KWin/Qt adapter boundaries for the specified current
  workspace/output behavior.
- A separately authorized, minimal runtime smoke after static and unit evidence
  is accepted.
- Directional focus uses `Meta+H`, `Meta+J`, and `Meta+K`; directional
  move-to-empty uses `Meta+Shift+H/J/K/L`. The requested arrow vocabulary is
  excluded when another active KGlobalAccel owner holds it. Focus-right retains
  its safe `Meta+Alt+Ctrl+L` fallback while active Session Management owns
  `Meta+L`.
- Active-window detach uses `plasma-auto-tiler-detach` on `Meta+Shift+Space`.
  It is inert unless the active eligible window is assigned to a non-layout
  Custom Tile, then performs one guarded `window.tile = null` compatibility
  write with an immediately revalidated association. It does not claim rollback
  or live runtime acceptance.

Constraints:

- Before implementation, search for suitable high-quality upstream or official
  KWin and KDE TypeScript types. Use them when suitable. A narrow local subset
  is permitted only when the search records that suitable upstream types do not
  exist; pin every local declaration to its source provenance.
- Strict controls prohibit `any`, unchecked casts, non-null assertions, and
  manual edits to generated JavaScript. KWin and Qt boundary values require
  runtime guards.
- Node, TypeScript, and build/test tools are development-only and must not be
  runtime product dependencies.
- A `devenv.nix` toolchain change requires the user to restart the session
  before new tools are assumed available.
- Current-workspace/output state is scoped by session-local exact `Output`
  object identity plus virtual-desktop ID. Pending state must clear when the
  output is removed, replaced, or leaves scope. That identity survives neither
  restart nor hotplug; KWin retains persistent topology. Stable multi-output
  identity remains deferred.

Non-goals:

- No runtime smoke, installation, enablement, or live session action in this
  planning package.
- No panel, indicator, settings UI, animation, broad layout support, native
  plugin, Rust bridge or daemon, release packaging, full multi-output or
  hotplug support, second persistence model, or broad performance work.
- No reuse, launch, or unblocking of the feasibility change's unsafe live
  harness or nested-KWin path.
- No edit to `docs/decisions.md`, the technical report, or the paused
  sustained-workload-validation change.

## Acceptance Criteria

- [ ] The TypeScript toolchain and type provenance meet the strict controls,
      and generated JavaScript is reproducible rather than manually authored.
- [ ] Pure topology and hit-test logic has executable deterministic tests for
      every specified journey, including central no-op and horizontal tie
      precedence.
- [ ] The adapter applies only to the current workspace and output and guards
      all KWin/Qt boundary values at runtime.
- [ ] Static and unit review finds no prohibited TypeScript escape hatches,
      generated-artifact edits, or unguarded boundary assumptions.
- [ ] The manual launcher reports successful startup only after the fixed
      shortcut-registration and handler-readiness diagnostics confirm an
      enabled controller; this is not shortcut callback or broader runtime
      capability acceptance.
- [ ] The detach action uses the pinned KWin writable `Window.tile` contract,
      rejects every unsafe association before its single write, and has focused
      static tests for registration, guards, write failures, and postcondition.
- [ ] No runtime smoke occurs without separate fresh authorization; any future
      smoke remains limited to this slice and does not unpark the feasibility
      change's blocked live path.
