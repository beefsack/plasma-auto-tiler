# Terminal Succession Handover: plasma-auto-tiler

Status: terminal handover for a fresh Orchestrator. All prior Lead and Worker
sessions are terminal; do not resume them. This handover supersedes older
session instructions and historical verification figures.

## Process and Protection

| Role | Configured agent | Context |
|---|---|---:|
| Orchestrator | top-level session | 150000 |
| Lead | `lead-openai` | 150000 |
| Worker | `worker` | 150000 |

- Exactly one subagent may be active across the hierarchy. Approximately 20
  Orchestrator dispatches is a terminal succession boundary.
- Do not push or amend commits. Stage explicit paths only.
- `test-output` is user-provided untracked evidence. Leave it untouched and
  uncommitted.
- `Project Technical Report and Implementation Plan.md` is protected untracked
  user content. Leave it untouched and uncommitted.
- `docs/principles.md` and `docs/decisions.md` are absent by design. Do not
  create governance artifacts.
- No live KWin/Plasma mutation occurred in this package. Before any future live
  work, read `docs/live-kwin-testing.md`; it does not grant mutation authority.

## Current Repository Evidence

- Baseline before this handover commit: `eb3adb5af5bb669eb66ee46846e15d87fc0a56ed`
  (`Add guarded Custom Tile reset foundation`).
- Static verification at that baseline passed: `npm run typecheck`, `npm run
  build`, and `npm run test` from `kwin/`.
- The full test command reported 393 passing tests in 47 suites and 202 passing
  lifecycle checks, with zero failures.
- Ignored generated `kwin/contents/code/main.js` SHA-256 after that build:
  `7855a7f8c415b6b6ee578b5c783c32784fce42e4b7a44fd6938447e1e389057f`.
  Never edit generated JavaScript manually.
- Authored production code is strict TypeScript; the generated ES2017 IIFE is
  the KWin payload. Toolchain dependencies remain managed by `devenv.nix` and
  `kwin/package.json`; do not install dependencies ad hoc.

## Accepted Product Direction and Capabilities

- The user explicitly approved automatic product ownership of managed
  workspace/output topology and chose ratio-free `dwindle` as the default.
  For scopes managed by this enabled plugin, this supersedes the old parked
  question of whether authored layouts may be replaced. Do not list that
  product choice as pending.
- The current project catalog has 27 atomic actions: insertion, focus, move,
  focused-leaf columns/rows/balanced-grid/dwindle presets, detach, attach, and
  scope fill. It includes direct `Meta+Arrow` focus aliases and
  `Meta+Shift+Arrow` move aliases, as well as the H/J/K/L variants.
- `822db26` (`Fix adjacent tile focus selection`) accepts the source correction
  that touching facing edges are zero-distance directional neighbors; overlap
  and diagonal-only candidates remain rejected. It is not live callback proof.
- `dd3a9e3` (`Add project arrow shortcut aliases`) is accepted. The user
  explicitly authorized clearing only Krohnkite's eight conflicting direct
  Meta-arrow and Meta+Shift-arrow sequences. Those sequences were cleared
  exactly; nonconflicting Krohnkite settings were preserved, and Krohnkite
  remains disabled and unloaded.
- The plugin's guarded shortcut catalog registers all 27 actions atomically.
  Persisted KGlobalAccel records do not prove loaded callbacks.
- Static capabilities include guarded focus/move-to-empty, focused-leaf preset
  application, selected-overlay tracking and assignment-only reflow, guarded
  attach/detach, scope fill, and `dwindle`. None establishes live structural or
  callback behavior.

## Reset Boundary

- `eb3adb5` is source-safe only; it does not wire automatic lifecycle ownership.
- Pinned KWin `CustomTile.remove()` is void, can mutate promotion and occupancy,
  and uses `deleteLater`. The reset code guards unmanagement before removal,
  preserves the original root identity, and requires a fresh decoded smaller
  root after each remove.
- Live QJSEngine invocation, removal/promotion behavior, root identity, and
  fresh-root decoding remain unaccepted. Do not infer them from static tests.

## Accepted Live Boundary

- Accepted live evidence is limited to registration/readiness and matching
  shortcut records. The plugin is unloaded after that evidence.
- Focus edge-touch behavior, direct-arrow callback delivery, reset,
  automatic ownership, structural presets, and attach/detach runtime behavior
  remain unaccepted.
- Do not revive the prior large supervisor harness. Do not treat persisted
  records, historical diagnostics, or static results as callback evidence.

## Exact Next Package

1. Obtain a scope that is explicitly owned or isolateable, then perform one
   bounded live contract validation of `CustomTile.remove()` removal/promotion,
   original-root identity, and fresh decoding, with exact preflight, cleanup,
   and stop conditions.
2. A current persistent user scope must not be structurally reset autonomously
   merely to prove that contract. Automatic product behavior approval is not
   destructive-test ownership or isolation authorization.
3. Only if that contract is accepted, wire session-local startup/add/remove
   managed-scope `dwindle` ownership, intentional detach exclusions, and valid
   selected-overlay precedence. Keep the work bounded and do not revive the old
   large supervisor harness.

## Parked Items

- Live reset validation is parked pending an explicitly owned/isolateable scope
  and its specific mutation authorization; it is not authorized on a persistent
  user scope by the product decision alone.
- Manual drag split and Esc-cancellation journeys remain untested pending a
  future interactive session.
- Dynamic-workspace lifecycle outside the accepted managed-scope direction,
  multi-output hotplug identity, persistence, ratios, broader layout modes,
  effects, packaging, and performance claims remain outside the current slice.
