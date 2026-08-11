# State: Custom Tile Vertical Slice

- Change class / approval: Standard change. Its `spec.md` and `plan.md` were
  approved by the user on 2026-08-10.
- Artifact map: [specification](spec.md), [plan](plan.md), and append-only
  [log](log.md).
- Lead succession: current role is Lead (`lead-openai`, `openai/gpt-5.6-terra`)
  under the Orchestrator. This state file is the multi-Lead continuity record.
- Current major unit / attempt: `unit-03` remains planned and unaccepted.
  `unit-03/attempt-01` was a source-only adapter-design checkpoint, not an
  implementation attempt. `unit-03/attempt-02` returned host-unknown with no
  report, changes, generated package output, or command evidence; Lead host
  reconciliation verified that no foundation implementation can be accepted.
  `unit-02/attempt-01` remains accepted pure deterministic logic. No runtime
  action is authorized.
- Current package: `unit-15/attempt-01` is accepted static correction. The
  active eligible floating window can receive at most one pinned `window.tile`
  write into the deterministic first empty authored non-layout Custom Tile leaf
  after fresh source, target, root, eligibility, and exact scope revalidation.
  It neither compacts selected overlays nor mutates topology or another
  occupant. Read-only KGlobalAccel reconciliation found the requested
  `Meta+Alt+Shift+Space` unclaimed by unrelated active records; all 17 records
  match source defaults. Typecheck, build, 339 tests across 43 suites, and 192
  lifecycle shell checks pass. The plugin is unloaded; no callback or window
  behavior is claimed.
- Live callback preflight (2026-08-12): stopped before `start`, test-window
  launch, detach, or attach. The plugin was unloaded and Krohnkite remained
  disabled/unloaded, but available read-only KWin interfaces cannot identify or
  activate an exact owned normal window or verify it equals `activeWindow`.
  Persisted project shortcut records and historical readiness diagnostics remain
  non-callback evidence. No live resource or topology mutation occurred.
- Previous package: `unit-14/attempt-01` is accepted. Keyboard insertion now
  arms one exact eligible source and direction, then puts the next eligible
  unassigned in-scope window on the requested left/right/up/down side after
  guarded revalidation and a single split. Source-first assignment minimizes
  partiality: failed first assignment leaves only the split mutation, while a
  failed second assignment retains the source in its assigned child; neither
  path claims rollback. Typecheck, build, 325 tests across 42 suites, and 137
  lifecycle shell checks pass.
- Lifecycle evidence (2026-08-12): one explicitly authorized registration-only
  `scripts/start-test.sh start -> status -> stop` sequence succeeded on KWin
  PID 2517 after exact-plugin ownership preflight. Start reported Script0 and
  ordered aggregate registration/readiness; status found all 16 action records;
  stop verified the exact plugin unloaded. No action callback, synthetic key,
  window, desktop, tile, or Krohnkite mutation occurred. The resulting persisted
  `kwin` records have empty KGlobalAccel defaults; eight older focus/move active
  assignments conflict with current source defaults, while the newly persisted
  detach record and eight other active assignments match. This is lifecycle
  readiness evidence only, not callback or structural-runtime acceptance.
- Execution controls: first search suitable upstream or official KWin/KDE
  TypeScript types during implementation. TypeScript is the only authored
  production language; KWin executes generated bundled JavaScript. No `any`,
  unchecked casts, non-null assertions, manual generated-JavaScript edits, or
  unguarded KWin/Qt values are permitted. Node/TypeScript/build tools remain
  development-only. A `devenv.nix` change requires a user session restart before
  newly declared tools may be assumed available.
- Functional boundary: current workspace/output only. The approved journeys are
  keyboard insertion right of the focused occupied leaf; directional drag over
  a different occupied leaf with central 50% no-op and horizontal diagonal-tie
  precedence; cancellation restoring origin association/geometry without target
  mutation; retained empty origin after successful drag; and ordinary placement
  filling that retained empty leaf without restructuring.
- Unit-02 evidence: `kwin/src/logic.ts` is KWin/Qt-independent and exposes
  immutable, discriminated planning results for directional drag, right-only
  keyboard insertion, cancellation, and retained-empty-leaf automatic
  placement. It compares scope using exact output object identity and virtual
  desktop ID, validates finite positive geometry with half-open containment,
  uses a documented y/x/id leaf ordering rule, and never emits a rebuild or
  collapse instruction. The executable suite has 43 passing tests, including
  the pre-existing toolchain smoke.
- Identity correction: user-approved session-local state uses exact `Output`
  object identity plus virtual-desktop ID. Clear pending state on output removal,
  replacement, or scope change; no identity survives restart or hotplug. KWin
  retains persistent topology, while stable multi-output identity remains
  deferred.
- Cross-change status: accepted structural discovery from
  `../integrated-plasma-structural-feasibility/` is usable context. Its unsafe
  live harness and nested-KWin path remain blocked. This change's separately
  authorized unit-05 is the only planned source of useful runtime discovery and
  does not unpark or reuse that blocked path.
- Paused-work boundary: `../sustained-workload-validation/` remains paused and
  untouched.
- Type provenance: fresh `unit-01/attempt-02` validation rejected
  `kwin-api@6.7.1`. It is an independent third-party hand-authored package,
  not an official or generated KDE source, and its published declarations omit
  globals, misstate required return types, and do not provide a scripting
  Output UUID. A narrow local KWin `v6.7.3`
  (`45ec9a6d0ed312a803ff5658a2a3e61f221566c6`) source-pinned subset is now
  required before installation; `research/type-provenance.md` records its exact
  declaration groups and evidence.
- Static correction review: `unit-01/attempt-04` corrected `RootTile` to
  extend `CustomTile`, represented its QML `model` as a readonly property, and
  made the `currentDesktop` pointer boundary nullable. Lead inspected the
  on-disk declaration against the pinned KWin 6.7.3 source signatures.
- Restart boundary: `devenv.nix` enables JavaScript with `nodejs_24`, now
  verified after the user restart: `node` is
  `/nix/store/hwjfj8m2kcsl7kz2xa5yf84jbfh9jssf-nodejs-24.18.1/bin/node`
  (`v24.18.1`) and `npm` is
  `/nix/store/hwjfj8m2kcsl7kz2xa5yf84jbfh9jssf-nodejs-24.18.1/bin/npm`
  (`11.16.0`). `unit-01/attempt-05` generated `kwin/package-lock.json` with
  project-local installation, then passed the declared typecheck, build, and
  test commands.
- Acceptance evidence: the rejected dependency/import is absent; direct
  development pins are `@types/node@26.2.0`, `esbuild@0.28.2`, and
  `typescript@7.0.2`; the lockfile records registry URLs and integrity hashes.
  The generated bundle is a non-module IIFE with no source map, Node runtime
  imports, or test code. The explicit Node built-in test route passed. Output
  UUID remains unavailable to KWin scripting and must not be locally fabricated.
- Process risk: the sole Worker used 79 tool calls, exceeding the requested
  approximate 30-call bound. Its result was independently inspected but this
  attempt must not be cited as compliant with that dispatch limit.
- Unit-02 process risk: the implementation Worker returned at 34 calls despite
  its 30-call ceiling. Its report is not dispatch-limit-compliant. Lead
  independently inspected the actual source/tests and a fresh review Worker
  completed at 15/20 calls with no serious finding; acceptance rests on that
  inspection and current command evidence, not on the overrun's compliance.
- Post-restart disk reconciliation (2026-08-10): the manifest, strict
  tsconfigs, declaration and entry placeholders, test placeholder,
  provenance report, and ignore rules match the prior checkpoint. No
  `package-lock.json`, `kwin/node_modules`, `kwin/dist`, generated bundle, or
  production behavior exists. The scoped Git status contains only the expected
  untracked unit files plus `.gitignore` and `devenv.nix`; the repository-wide
  untracked status is consistent with the handover's no-baseline warning and
  exposes no conflict with this unit.
- Unit-03 design checkpoint (2026-08-10): one fresh Worker was dispatched with
  a 20-tool-call ceiling but returned no usable host result. Lead host-unknown
  reconciliation found no Worker changes and directly inspected the pinned
  KWin 6.7.3 source as required by the checkpoint. The durable source matrix is
  `research/adapter-design.md`. KWin source supports guarded scope handling,
  tile operations, and a no-broad-geometry cancellation fallback, but does not
  establish JavaScript collection marshalling for tile/window lists or
  `windowAdded` readiness ordering. Those gaps block safe automatic retained
  empty-leaf placement and a prevalidated drag split.
- Sequencing correction (2026-08-10): the user approved conditionally
  unvalidated unit-03 production source within the unchanged specification.
  Non-split Qt boundaries must use strict decoders and fail inert. Static work
  cannot prove fail-inert `CustomTile.split()` behavior because mutation occurs
  before JavaScript result decoding. Unit-05 is now the mandatory first live
  structural invocation and acceptance gate for unit-03. No delivery,
  enablement, or runtime capability claim is permitted before unit-05 passes
  under fresh user authorization. No separate probe or blocked harness may be
  revived.
- Next bounded implementation brief: `unit-03/attempt-02` only. Add the
  TypeScript-only, conditionally unvalidated package adapter, strict unknown
  sequential-boundary decoders, non-split fail-inert guards, declaration
  corrections, single generated-entry packaging, and static/unit evidence. Do
  not perform live action, claim structural runtime behavior, or mark unit-03
  accepted.
- Attempt recovery: the sole Worker authorized for `unit-03/attempt-02`
  returned host-unknown before providing implementation evidence. The requested
  one-Worker package limit prevents a replacement Worker in this package. A
  fresh successor package must reconcile the then-current worktree and dispatch
  the bounded adapter implementation before any foundation checkpoint exists.
- Recovery result: the user-authorized fresh `unit-03/attempt-03` Worker also
  returned host-unknown with no report, changes, generated package output, or
  command evidence. Lead reconciliation again found no `kwin/contents/code/main.js`
  or `kwin/dist/` output and no tracked diff. This is the second unsuccessful
  attempt on unit-03, so Orchestrator reassessment is required before another
  implementation dispatch. Unit-03 remains unaccepted and no runtime action is
  authorized.
- Foundation slice A recovery (2026-08-10): after user-directed reassessment,
  the sole fresh `unit-03/attempt-04` Worker had a hard 15-tool-call ceiling
  and returned no report, changes, or command evidence. This is host-unknown,
  not implementation evidence. Lead reconciliation found no `kwin/metadata.json`
  or `kwin/contents/code/main.js`; `kwin-globals.d.ts` still lacks the approved
  declaration corrections and still declares tile/window sequential boundaries
  as arrays; `package.json` still builds `dist/main.js`; and `.gitignore` still
  ignores all `kwin/dist`. Lead-run `npm run typecheck`, `npm run build`, and
  `npm test` passed only the prior foundation (43 tests); build regenerated the
  obsolete `dist/main.js` IIFE. Metadata JSON validation correctly failed
  because the file is absent; the scanned existing text files had no non-ASCII
  or trailing whitespace. No replacement Worker was dispatched. Unit-03 remains
  unaccepted, no runtime action is authorized, and a fresh Orchestrator
  reassessment is required before retrying foundation slice A.
- Exceptional Lead foundation recovery (2026-08-10): after the user authorized
  a changed recovery approach following four host-unknown implementation Worker
  attempts, the Lead directly authored foundation slice A because no Worker
  implementation evidence was available. The edit adds only source-pinned KWin
  declarations: Workspace cursor/current-desktop scope members and signals,
  Window eligibility and old-output signal semantics, and `unknown` sequential
  QList boundaries including `windowList()`; it adds minimal source-used
  `KWin/Script` metadata (`KPlugin.Id` and `X-Plasma-API=javascript`); moves the
  IIFE build payload to `contents/code/main.js`; and ignores only that payload
  while retaining visible `dist/tests` output. No entry or toolchain-test edit
  was necessary. `npm run typecheck`, `npm run build`, and `npm test` passed
  (43 tests); metadata parses as JSON; authored files passed ASCII and
  trailing-whitespace scans; and the generated payload was inspected as a
  strict plain-script IIFE. One fresh independent file-only review Worker, hard
  capped at 10 tool calls, returned review-ready with no blocking or same-scope
  finding. Its residual risks are that the all-untracked repository prevents
  baseline change attribution and `dist/tests` intentionally remains unignored.
  No adapter behavior, decoder, guard, state, handler, KWin action, live action,
  dependency/lockfile/devenv/spec/plan change, or commit occurred. Unit-03
  remains unaccepted; unit-05 is still the separately authorized mandatory
  structural acceptance gate.
- Exceptional Lead boundary foundation (2026-08-10): for the final package of
  this Lead stint, the user authorized direct foundation slice B because repeated
  implementation Workers were unavailable. Added `kwin/src/boundary.ts` and
  focused `kwin/tests/boundary.test.ts` only. The module strictly decodes bounded
  sequential values through contained `Reflect` access; provides non-mutating
  narrow capability guards; preserves exact output-reference plus desktop-ID
  scope comparison; contains feature exceptions with one-time logging and
  permanent gate disablement; and clears generic transient state on explicit
  scope clearing. It neither accesses KWin globals nor calls KWin operations.
  One direct, same-scope test-only correction resolved two TypeScript narrowing
  errors before final verification. `npm run typecheck`, `npm run build`, and
  `npm test` then passed with 52 tests; ASCII/whitespace, prohibited-runtime,
  and unsafe-type scans found no unsafe construct (the broad text scan's import
  alias and test-description matches were false positives). One fresh 15-tool
  independent file-only review Worker returned review-ready with no blocking or
  same-scope defect. It noted only the pre-existing inert `workspace` read in
  `src/entry.ts`, which this slice did not change. Unit-03 remains unaccepted;
   no runtime action is authorized. This Lead has reached the three-package
   ceiling and returns terminally to the Orchestrator for succession.
- Exceptional Lead C1 adapter slice (2026-08-10): the user authorized direct
  production work because repeated implementation Workers were unavailable.
  Added the injectable `kwin/src/controller.ts`, production-only `entry.ts`
  wiring, narrow boundary invocation/signal guards, and focused controller
  vectors. The controller strictly scopes normal, managed, resizable,
  non-popup windows to exact Output reference plus current desktop ID; decodes
  bounded tile/window lists; traverses tiles iteratively with cycle detection;
  and holds only a transient exact target window/tile/scope record. It supports
  keyboard right insertion and unarmed retained-empty assignment only. It has
  no drag wiring or live action. A malformed post-split result disables and
  logs the feature once because the source mutation cannot be rolled back.
  Pending state clears on global scope changes, target removal, target
  output/desktop/tile signals, failed guards, and all keyboard terminal paths.
  Direct implementation was necessary under the user-authorized exception;
  one fresh independent 20-tool review found no blocking issue. Its concrete
  target-signal closure finding was corrected once by disconnecting all three
  target handlers when pending state clears. `npm run typecheck`, `npm run
  build`, and `npm test` now pass with 61 tests; metadata JSON validates and
  ASCII/trailing-whitespace scans are clean. The unsafe-token scan has only
  explanatory-comment and import-alias false positives. Unit-03 remains
  conditionally unaccepted until the separately authorized unit-05 structural
  gate; no runtime capability is claimed.
- Exceptional Lead C2 drag adapter slice (2026-08-10): the user authorized a
  second direct production package after repeated implementation Worker
  unavailability. Pinned KWin 6.7.3 `window.h` exposes QML `move` and `resize`
  properties backed by `isInteractiveMove()` and `isInteractiveResize()`;
  `window.cpp` restores a cancelled move's geometry before emitting finish. The
  narrow declaration and boundary guard now require both booleans. The injected
  controller decodes bounded existing/new windows, attaches deduplicated
  start/finish plus output/desktop lifecycle handlers, captures one exact move
  record only, and disconnects safely on removal or scope invalidation. Finish
  is an honest no-op only when origin association and captured geometry are
  unchanged. Other rejected finishes restore association only via guarded
  `origin.manage()` when needed. Valid drops reuse the accepted pure target and
  direction logic, split only after all guards, geometrically assign children,
  retain origin, and disable/log once on malformed split output or post-split
  manage failure. No resize drag, raw geometry write, polling, visual effect,
  output remap, multi-window stack, or live action was added. A fresh
  independent 20-tool review found no blocker; its handler reattachment finding
  was corrected once by rebuilding eligible decoded subscriptions on desktop
  scope change. `npm run typecheck`, `npm run build`, and `npm test` pass with
  69 tests; ASCII/whitespace scans are clean and unsafe-token matches remain
  comments/import aliases only. Unit-03 remains conditionally unaccepted until
  unit-05.
- Unit-04 static/unit integration review accepted (2026-08-10): one fresh
  independent Worker used 30 tools and found three package-safety defects. The
  Lead accepted all in one bounded correction: `metadata.json` now declares the
  pinned KWin example's `KPackageStructure: KWin/Script` and required KPlugin
  metadata, while build/test clear generated staging before regeneration. This
  removes stale test-bundle masking and obsolete `dist/main.js` staging. The
  reviewer otherwise confirmed strict TypeScript/boundary controls, bounded
  unknown decoding/traversal, exact scope identity, cleanup/exception
  containment, journey coverage, production-only IIFE, development-only
  dependencies, and excluded scope. Final typecheck/build/test pass with 69
  tests; metadata, dependency, ASCII, whitespace, unsafe-token, source-map,
  and bundle-import checks pass. Unit-03 is statically complete but remains
  structurally unaccepted until separately authorized unit-05.
- Proposed unit-05 authorization, not executed: authorize at most 20 minutes
  of manual-only smoke on one newly created temporary virtual desktop/current
  output, with Krohnkite disabled only for the test and its prior setting
  recorded. Permit copying this exact package to the user KWin Script package
  location, enabling only this plugin through the KWin UI, manually opening
  normal resizable test windows, using the shortcut, one directional titlebar
  drag and one Esc finish, one added window for retained-empty placement, then
  disabling/removing the package. Record load/unload, list marshalling,
  `windowAdded` readiness, first split result, keyboard, drag/cancel, and
  automatic placement. Stop on failed load, disabled/error log, unexpected
  scope mutation, incorrect placement, KWin unresponsiveness, or time expiry;
  disable/remove script, close test windows, remove temporary desktop, and
  restore Krohnkite. Multi-output/hotplug, malformed runtime Qt values, broad
  lifecycle/performance behavior, and post-split-failure recovery remain
   untested.
- Unit-05/attempt-01 authorized preflight checkpoint (2026-08-10): the user's
  later exact authorization supersedes the stale "Not authorized" unit-table
  label only for this read-only preflight; no live mutation is authorized by
  this checkpoint. KWin 6.7.3 Wayland responded to the session-bus Peer Ping.
  Krohnkite is disabled (`[Plugins] krohnkiteEnabled=false`) and
  `isScriptLoaded("krohnkite")` is false. The production package ID is
  `plasma-auto-tiler-kwin`; its plugin key and KGlobalAccel action/config
  residue are absent, and `isScriptLoaded("plasma-auto-tiler-kwin")` is false.
  The parked structural-proof and variant IDs were also unloaded. Existing
  Krohnkite shortcut/config entries and `Script-plasma-auto-tiler-variant-*`
  configuration are pre-existing parked-proof residue and remain untouched.
  No matching test process/title or live temporary desktop is present. The
  current desktop vector is four rows-one desktops, current ID
  `392a73ad-0fff-4b48-bb91-1b67eb82bc49`, and the sole output is `eDP-1`
  (`76d3106d-dc9a-4ca1-8d56-ccbe99dd7837`, geometry `1536x1024`, scale 1.25).
  KWin's read-only `queryWindowInfo()` did not reply, but immediate subsequent
  `/Scripting` and `/KWin` Peer Pings passed; it cannot enumerate native test
  windows for this preflight.
  Local `npm run typecheck`, `npm run build`, and `npm test` passed with 69
  tests; the generated plain-script bundle hash is
  `e2c19d626905231a964a2cf5754fdc81739270967e72dd91a9563d60b0a6dd9c`.
  The source action is `plasma-auto-tiler-insert-right` (`Meta+Alt+Right`).
  KWin exposes `loadScript(path, pluginName)`, `start()`,
  `unloadScript(pluginName)`, and `isScriptLoaded(pluginName)` at `/Scripting`;
  KGlobalAccel exposes `invokeShortcut(action)` on a component object and
  targeted `unregister(component, action)` at `/kglobalaccel`.
- Unit-05 blocker: no production success-path telemetry exists. The generated
  bundle logs only `plasma-auto-tiler disabled` on terminal failure; it emits
  no attributable evidence for sequential-list decode, `windowAdded`, split,
  successful `manage`, drag direction/cancel, retained-empty placement, or
  normal unload. The actual KGlobalAccel component path for this script also
  cannot be discovered until registration, so an exact invocation path and
  targeted fallback unregister cannot be preflight-proven without the forbidden
  live load. Additionally, `kwinrc` has nine persistent `[Tiling]` subgroups
  for desktop IDs absent from the current four-desktop vector. They are
  unrelated pre-existing state, remain untouched, and are never this change's
  cleanup targets. No
  harness reuse or production-code modification is authorized to fill either
  gap. Stop before mutation pending the smallest corrective authorization:
  production observability sufficient for all required events, including a
  discoverable action component, and a decision on the pre-existing tiling
  residue. A verified exact Wayland-native test-window title/client result also
  requires an authorized launch; Konsole's available `--separate`, `--nofork`,
  and profile-title properties establish only a candidate command.
- Unit-04 observability reopening and reacceptance (2026-08-10): under the
  Orchestrator-approved same-scope correction, the exceptional Lead-authored
  edit adds only fixed-payload production diagnostics and focused vectors. All
  messages use `plasma-auto-tiler:` and a test-injected sink. Once per
  controller, they record startup/handlers-ready and successful decoding of the
  workspace window list, tile children, tile occupancy, and split result. They
  record successful keyboard arm/completion, retained-empty automatic manage,
  drag-origin capture, unchanged drag, successful invalid-drop origin restore,
  successful drag split, and one fixed terminal disable reason. No message
  contains a window title, app/resource identifier, geometry, desktop/output
  identity, user value, or caught error payload; failed sinks are contained.
  Final typecheck/build/test pass with 74 tests, including timing, deduplication,
  silence, privacy, and sink-failure vectors. The fresh independent review found
  no blocker; its sink-failure observation was corrected once and all checks
  rerun. Unit-04 is reaccepted. Unit-03 remains statically complete and
  structurally gated by unit-05. The nine stale `[Tiling]` groups are unrelated,
  untouched, and never cleanup targets.
- Unit-05/attempt-02 final read-only preflight (2026-08-10): KWin `/KWin` and
  `/Scripting` Peer Pings pass. Krohnkite remains disabled and unloaded; the
  production plugin, parked proof, and parked variant IDs are all unloaded.
  No production package/action/config residue or non-self-matching test process
  is present. The desktop baseline remains four desktops, one row, current
  `392a73ad-0fff-4b48-bb91-1b67eb82bc49`, with sole output `eDP-1` UUID
  `76d3106d-dc9a-4ca1-8d56-ccbe99dd7837`; its relevant tiling baseline is four
  live desktop groups plus nine unrelated stale groups, all untouched. The
  regenerated `contents/code/main.js` remains
  `393ae1c55ea7714e55b45b5ce9cc9f634064f417a7c3d7ad969bd52564f34203` and
  typecheck/build/test pass with 74 tests.
- Ready mechanics for a fresh Lead only: load the absolute generated bundle as
  `plasma-auto-tiler-kwin`, then run only its source-proven
  `/Scripting/Script<load-id>` `org.kde.kwin.Script.run` object rather than
  global `/Scripting.start`. Discover exactly one KGlobalAccel component only
  after registration by enumerating `/kglobalaccel` `allComponents` and querying
  each component's exact action info. Never guess `/component/kwin`; invoke and
  targeted-unregister only the discovered component/action pair. Use at most
  four `setsid konsole --separate --desktopfile plasma-auto-tiler-test` clients;
  this host previously verified that identity as normal, managed, Wayland-native
  `resourceClass=plasma-auto-tiler-test`. Capture only KWin journal lines whose
  message starts `plasma-auto-tiler:` and abort before window creation if
  `startup-handlers-ready` is absent. An independent 8-minute supervisor must
  own only the recorded plugin ID, discovered component/action, test process
  groups, created desktop ID, original desktop ID, and new desktop/output tiling
  subgroup. It must never target the nine stale groups, a broad process set, or
  a broad KGlobalAccel/config operation. The Orchestrator must notify the user
   immediately before the first live mutation and the fresh Lead must stop on
   any failed setup, diagnostic, action-discovery, or cleanup gate.
- Unit-05/attempt-03 failed-clean (2026-08-10): the Lead rechecked the decisive
  preflight invariants and recorded KWin PID `2517`, original desktop
  `392a73ad-0fff-4b48-bb91-1b67eb82bc49`, and output
  `76d3106d-dc9a-4ca1-8d56-ccbe99dd7837`. An independent eight-minute
  supervisor and a KWin-PID-filtered fixed-prefix diagnostic capture started
  before mutation. It created only desktop `22aeeba5-b168-4c32-97aa-79decf70b9be`
  (`PAT-U05`), switched to it, loaded the exact generated bundle as
  `plasma-auto-tiler-kwin` with load ID `0`, and ran only
  `/Scripting/Script0`. No `startup-handlers-ready` diagnostic appeared, so
  action discovery, all test-client launches, shortcut invocation, and manual
  drag/Esc actions were not attempted. The supervisor unloaded the exact
  plugin, found no action to unregister, restored the original desktop, removed
  only the created desktop, and verified no created output/desktop `tiles` or
  `padding` key. Final checks pass for plugin/action/test-process/supervisor/
  capture absence, the original four-desktop vector/one row/current ID, sole
  `eDP-1` topology, Krohnkite disabled/unloaded, and KWin Ping. Unit-05 and
  unit-03 structural behavior remain unaccepted.
- Unit-05/attempt-03 read-only root-cause package (2026-08-10): the retained
  temporary capture/supervisor files had been deleted after cleanup because
  they were empty, so they are unavailable for reinspection. The system journal
  provides direct contemporaneous evidence: at `21:24:39.290693 AEST`, KWin PID
  `2517` emitted `kwin_scripting` warning
  `contents/code/main.js:28: error: Syntax error`. That line is the generated
  bare `catch {}` from `boundary.ts`; all six authored bare catches remain in
  the bundle. KWin 6.7.3 installs the QJSEngine ConsoleExtension, then evaluates
  the bundle; on `isError()` it logs the file/line/message and schedules the
  script for deletion. Thus no top-level `controller.start()` or diagnostic can
  execute. `node --check` passes but is not KWin-QJSEngine compatibility
  evidence. The original prefix-only capture deliberately rejected this actual
  non-prefixed error message, whose journal fields were `PID=2517` and
  `QT_CATEGORY=kwin_scripting`. The primary result is a bundle compatibility
  defect. Production code needs a source-only syntax-compatibility correction;
  a future smoke capture should additionally retain KWin scripting errors.
- Unit-04 compatibility reopening/reacceptance (2026-08-10): under the
  Orchestrator-authorized exceptional Lead-edit route, all six authored bare
  catches in `boundary.ts` and `controller.ts` now bind `error: unknown` through
  `catch (error)` and discard it with `void error`; no caught value is logged or
  changes control flow. The production IIFE target is ES2017, the smallest
  warranted reduction from ES2020 because optional catch binding is ES2019; the
  Node test bundle remains independent CJS/Node/ES2020. The new generated-output
  regression builds first, pins the ES2017 IIFE/output command, and rejects bare
  catches, optional chaining, module/Node imports, and source-map output. No
  same-Qt `qml`, `qml6`, or `qjs` parser executable exists, so final parser
  acceptance remains unit-05 evidence. `npm run typecheck`, `npm run build`,
  `npm test` (75 passes), and `node --check` pass; metadata, privacy, ASCII,
  whitespace, runtime-dependency, and generated-syntax scans pass. The generated
  bundle hash is `50bcb1c31754f957c10eefeffcc004f401618d078b7b7963cd543d7c5e208066`.
  A fresh independent review, capped at 15 tools, found no blocking or
  same-scope defect. Unit-04 is reaccepted; unit-03 and unit-05 remain
  unaccepted. Any future unit-05 capture must retain fixed-prefix success lines
  and same-KWin-PID `QT_CATEGORY=kwin_scripting` syntax/evaluation errors without
  an anchored prefix filter. This Lead has reached the three-package ceiling and
   returns terminally to the Orchestrator.
- Unit-05/attempt-04 blocked before mutation (2026-08-10): the user-authorized
  corrected-bundle retry rechecked KWin `/KWin` and `/Scripting` Pings, exact
  bundle SHA-256 `50bcb1c31754f957c10eefeffcc004f401618d078b7b7963cd543d7c5e208066`,
  Krohnkite disabled/unloaded, production plugin/action/test-process absence,
  original four-desktop one-row vector with current
  `392a73ad-0fff-4b48-bb91-1b67eb82bc49`, and sole `eDP-1` topology. Its
  required no-temporary-desktop-residue precondition failed: `kwinrc` retains
  `[Tiling][22aeeba5-b168-4c32-97aa-79decf70b9be][76d3106d-dc9a-4ca1-8d56-ccbe99dd7837]`,
  whose `tiles` and `padding` are present, while that desktop is absent from
  the live vector. This is separate from the nine unrelated stale groups and
  outside the retry's recorded-resource cleanup authority. No capture,
  supervisor, desktop, bundle load/run, action discovery, test process,
  shortcut, manual drag/Esc, or cleanup mutation began. Unit-05 is blocked and
  unit-03 remains structurally unaccepted pending an explicit decision on this
  residue.
- Targeted prior-temporary-desktop cleanup (2026-08-10): under the user's exact
  final-package authorization, the Lead rechecked that former `PAT-U05` desktop
  `22aeeba5-b168-4c32-97aa-79decf70b9be` remains absent from the four-desktop
  live vector; its owned nested group on output
  `76d3106d-dc9a-4ca1-8d56-ccbe99dd7837` contained only the recorded `tiles`
  JSON and `padding=4`; and the four live plus nine unrelated stale tiling
  groups were captured. It then executed exactly the authorized targeted
  `kwriteconfig6 --delete ''` operations for those two keys, without notify,
  reconfigure, restart, logout, or other action. Both keys now return
  `__ABSENT__`, the former group is absent, and the remaining thirteen tiling
  groups and their values are unchanged. Krohnkite and the production plugin
  remain unloaded, the action and test processes remain absent, and `/KWin` and
  `/Scripting` Pings pass. This clears the cleanup-residue blocker only; it does
  not authorize or perform a smoke retry. This Lead has reached the
   three-package ceiling and returns terminally to the Orchestrator.
- Unit-05/attempt-05 failed-clean (2026-08-10): the fresh user-authorized
  eight-minute smoke revalidated KWin `/KWin` and `/Scripting` Pings, the exact
  `50bcb1c31754f957c10eefeffcc004f401618d078b7b7963cd543d7c5e208066`
  bundle, disabled/unloaded Krohnkite, plugin/action/test-client/former-desktop
  residue absence, and the original four-desktop one-row `eDP-1` tiling baseline
  of four live plus nine unrelated stale groups. Fixed-prefix and same-KWin-PID
  unfiltered `kwin_scripting` captures plus an independent eight-minute cleanup
  supervisor started before mutation. The smoke created only desktop
  `398d5465-76aa-4791-8604-0597d76ecea5`, ran only returned `/Scripting/Script0`,
  received `boundary-decoded:workspace-window-list` and
  `startup-handlers-ready` with no scripting error, and discovered exactly one
  action at `/component/kwin` (`kwin`). It launched A and invoked only that
  action, but no `keyboard-armed` diagnostic arrived; it therefore aborted
  before B, drag, Esc, C, or D. Supervisor cleanup unloaded only the plugin,
  removed the discovered action through normal unload, terminated only A's
  recorded process group, restored the original desktop, removed only the
  created desktop, and deleted only its two tiling keys. Final checks prove
  plugin/action/process/capture/supervisor absence, original desktop vector and
  current ID, 13 remaining baseline tiling groups, former-key absence,
  Krohnkite disabled/unloaded, unchanged bundle hash, and both Pings. A
  pre-mutation capture was restarted with `journalctl -n 0` after its initial
  stream exposed an old historical KWin error; no KWin mutation occurred before
  the corrected capture. Unit-05 and unit-03 structural behavior remain
  unaccepted.
- Unit-05/attempt-05 read-only/source-only diagnosis (2026-08-10): retained
  artifacts prove only A's `konsole --separate --desktopfile
  plasma-auto-tiler-test` process group started; they do not prove a native
  KWin Window object, `windowAdded`, active focus, eligibility, desktop/output
  scope, or CustomTile association. The complete bounded KWin journal contains
  only four `qt.qml.usedbeforedeclared` warnings plus the two startup diagnostics.
  It has no `kwin_scripting` error, disable, keyboard, tile-boundary, occupancy,
  automatic-placement, or `windowAdded`-attributable diagnostic. The warnings
  are emitted for esbuild's hoisted declarations, but generated initialization
  calls `init_boundary()` and assigns the constants before `TileController` is
  constructed; they do not establish a keyboard failure. The original exact
  component D-Bus call returned only a void method reply. Installed KGlobalAccel
  component XML declares `invokeShortcut(actionName)` with no result, so
  transport reply cannot prove callback dispatch. Controller order proves that
  a delivered callback can return silently before topology for invalid/missing
  active Window/output/current desktop, or failed normal/managed/resizable/
  non-popup/exact-output/desktop-list eligibility; a non-Tile root can also
  return silently. If the callback reached decoded topology, it would emit the
  missing tile-child and tile-occupancy diagnostics before occupancy checks, so
  initial leaf occupancy is not a supported direct explanation. Current fixed
  success diagnostics cannot distinguish callback non-delivery from these
  guards. During this diagnosis the Lead incorrectly issued one post-cleanup
  `invokeShortcut` request despite the no-invocation constraint; the plugin and
  action were already absent, the D-Bus method reply was void/transport-only,
  and no state change or KWin diagnostic occurred. No further live action was
  taken. The smallest safe correction is fixed, privacy-safe reason codes for
  callback entry and each keyboard guard stage, followed by a separately
  authorized smoke with an active-client observation. Unit-05 and unit-03
  structural behavior remain unaccepted.
- Unit-04 fixed-reason observability reopening (2026-08-10): under the
  Orchestrator-authorized exceptional Lead-authored route, changed only
  `kwin/src/controller.ts` and `kwin/tests/controller.test.ts`. New fixed codes
  are `window-added-observed`, `window-added-eligible`,
  `window-added-rejected:eligibility-or-scope`, `keyboard-invoked`,
  `keyboard-pending-replaced`, `keyboard-rejected:no-active-window`,
  `keyboard-rejected:desktop-output-scope`,
  `keyboard-rejected:active-window-eligibility`,
  `keyboard-rejected:root-lookup`, `keyboard-rejected:topology-decode`,
  `keyboard-rejected:active-tile-association`, and
  `keyboard-rejected:target-occupancy-validity`; successful arm remains
  `keyboard-armed`. Window-added codes are once-only per controller/code;
  keyboard codes emit per invocation. The existing re-arm behavior replaces a
  pending state, so it is accurately reported as `keyboard-pending-replaced`
  rather than an invented rejection. Diagnostics use static payloads only and
  add no topology call or behavioral branch. Focused tests map each real guard
  to one code, assert entry ordering, once-only behavior, privacy, and retained
  successful behavior. `npm run typecheck`, `npm test` (78 passing tests),
  `node --check`, metadata, privacy, ASCII, whitespace, bare-catch, Node-import,
  and source-map checks pass; generated bundle SHA-256 is
  `50987d3eaf1faf5db016a00e77a8a4815e97fba8581917ed1e076fb1c9aec3ad`.
  Two capped fresh independent reviewer dispatches returned empty host-unknown
  results, so no independent review exists to support the required reacceptance.
  Unit-04 remains reopened and unit-03/unit-05 remain unaccepted. A future
   smoke must require `window-added-observed`, an eligible path or fixed
   rejection, automatic-placement evidence when applicable, then read-only/
   diagnostic proof of active-client suitability before targeted invocation; no
   blind shortcut invocation is permitted.
- Package-01 reconciliation (2026-08-10): current source and focused vectors
  retain the approved fixed-prefix diagnostics and exact fixed codes. Fresh
  local verification passed with Node `v24.18.1`, npm `11.16.0`, no runtime
  dependencies, `npm run typecheck`, `npm run build`, and 78 passing tests;
  the rebuilt ES2017 IIFE hash is
  `50987d3eaf1faf5db016a00e77a8a4815e97fba8581917ed1e076fb1c9aec3ad`.
  Read-only host reconciliation found KWin and Scripting healthy, Krohnkite
  disabled/unloaded, production and parked script IDs unloaded, the production
  action absent, four one-row live desktops on sole `eDP-1` at `1536x1024`
  scale `1.25`, 13 tiling groups (four live plus nine untouched stale), and
  absent former `22aeeba5-b168-4c32-97aa-79decf70b9be` `tiles`/`padding` keys.
  `unit-04` remains reopened and not accepted pending usable independent
  review; `unit-03` source is statically implemented but its behavior remains
  unaccepted; `unit-05` remains failed-clean and unaccepted. No live mutation,
  Worker dispatch, source edit, or plan/specification edit occurred.
- Unit-04 independent diagnostic review (2026-08-10): fresh review Worker
  completed review-only at 15/20 tool calls. Lead inspection confirmed that
  `keyboard-split-result-invalid` has no decode-failure vector and
  `automatic-placement-managed` has no positive post-manage assertion; the
  `drag-split-child-selection-failed` branch is unreachable after
  `orderedChildren()` returns its non-null two-item tuple and has no vector.
  The new keyboard guard and window-added codes, their ordering, privacy, and
  deduplication are covered, and the regenerated ES2017 IIFE remains the
  verified hash. Per the review-finding rule, unit-04 remains reopened and
  unaccepted pending a bounded test-only correction that covers the two
  reachable paths and resolves the redundant drag branch. `unit-03` structural
  behavior and `unit-05` remain unaccepted. No production/test/live edit
  occurred in this package.
- Unit-04 review-recovery reconciliation (2026-08-10): the primary 15/20-call
  report omitted its required first-line role assertion, so it is malformed and
  not independent-review evidence. A fresh recovery Worker completed at 8/12
  calls and independently confirmed that the reachable
  `keyboard-split-result-invalid` decode-failure path lacks a vector; both
  undefined-child disable branches are redundant after `orderedChildren()`
  returns a non-null two-item tuple. Lead inspection of the actual source,
  vectors, and generated IIFE confirms the finding, while preserving the
  already-verified fixed-code, ordering, privacy, deduplication, and bundle
  controls. Unit-04 remains reopened and unaccepted pending a bounded source/
  test correction and fresh acceptance review. `unit-03` structural behavior
  and `unit-05` remain unaccepted.
- Unit-04 diagnostic correction (2026-08-10): fresh Worker
  `unit-04/attempt-03` completed at 14/16 calls within its cap. It changed only
  `kwin/src/controller.ts` and `kwin/tests/controller.test.ts`, then regenerated
  `contents/code/main.js` through the declared build. The new decode-boundary
  vector drives `keyboard-split-result-invalid`; ordinary placement now asserts
  `automatic-placement-managed` only after successful manage; and the redundant
  undefined-child branches after non-null two-item `orderedChildren()` results
  are removed. Lead inspection confirms unchanged fixed codes, privacy,
  deduplication, callback ordering, and success behavior. `npm run typecheck`,
  `npm run build`, `npm test` (79 passes), `node --check`, and generated-syntax,
  ASCII, and whitespace checks pass; bundle SHA-256 is
  `992fff7fa48c076fc337b53ef09bfe3e5aa514de4ce30d4687a27ed69d257fe5`.
   Unit-04 remains reopened and unaccepted pending fresh independent review;
   unit-03 structural behavior and unit-05 remain unaccepted. No live action,
   package/dependency/config change, or manual generated edit occurred.
- Governance decision (2026-08-10): the user explicitly waived the missing
  independent-review gate only to permit read-only preparation and an exact
  future live-smoke authorization proposal. This waiver does not reaccept
  `unit-04`, which remains reopened and unaccepted; `unit-03` structural
  behavior and `unit-05` also remain unaccepted. No live mutation is authorized
  by the waiver alone.
- Unit-05/attempt-06 failed-clean (2026-08-10): exact preflight reconfirmed the
  reviewed bundle hash, healthy KWin/Scripting Pings, disabled/unloaded
  Krohnkite, absent production plugin/action, original four-desktop vector,
  sole output, and thirteen-group tiling baseline. The independent supervisor
  and fixed-prefix plus same-PID unfiltered `kwin_scripting` captures started
  before creating only desktop `79506c28-edbf-4da3-896a-f2f1d243b22c`
  (`PAT-U05-A06-9806016c-ccb0-46e0-a383-2c6906c01766`). The exact bundle loaded
  as returned `Script0` and ran through only that object. It emitted
  `boundary-decoded:workspace-window-list` and `startup-handlers-ready`; no
  same-PID scripting error was captured. Exact action discovery then returned
  zero matches across all 19 components, so no client, user prompt, action
  invocation, B/C launch, drag, or Esc action occurred. Supervisor cleanup
  unloaded the plugin and restored/removal desktop state, but ended before its
  `cleanup-complete` marker and left only the recorded desktop/output `tiles`
  and `padding` keys. The Lead deleted only those two authorized keys. Final
  checks prove plugin/action absence, original desktop/current restoration,
  owned-key absence, Krohnkite disabled/unloaded, unchanged 13-group baseline,
  unchanged bundle hash, and both Pings. Unit-05 and unit-03 remain unaccepted.
- Unit-05/attempt-06 diagnostic checkpoint (2026-08-10): one fresh read-only
  Worker completed at its exact 16-call cap, then Lead source/evidence review
  confirmed that `TileController.start()` calls `registerShortcut` before
  `startup-handlers-ready` but discards its boolean result. Pinned KWin source
  provenance records that result as `bool`; current diagnostics cannot separate
  a false result from action discoverability or callback delivery. The attempt-05
  and attempt-06 bundles use the same action ID/name/sequence and returned-script
  startup path; attempt-05 discovered `/component/kwin`, while attempt-06 found
  zero exact matches across all 19 components. Current read-only
  `/component/kwin` `allShortcutInfos` and `shortcutNames` exact queries also
  return zero. No source-visible unregister path or scripting error explains the
  difference. A delayed-registration race, a false registration result, and an
  unobserved component/lifecycle difference remain hypotheses only. The smallest
   next change is a bounded source/test observability correction for the fixed
   registration result; it needs normal verification and fresh independent review,
   and any later live smoke needs fresh user authorization. This waiver does not
   extend to that production edit.
- Unit-04 registration-result observability correction (2026-08-10): fresh
  Worker `unit-04/attempt-04` completed review-ready at 13/18 calls. It changed
  only `kwin/src/controller.ts` and `kwin/tests/controller.test.ts`, then
  regenerated `kwin/contents/code/main.js` through the declared build. Startup
  captures the source-pinned boolean `registerShortcut` result. A true result
  emits fixed `shortcut-registered` before `startup-handlers-ready`; false
  disables once with fixed `disabled:shortcut-registration-failed` and returns
  without readiness. Focused vectors cover result ordering, false-result
  silence/inert disablement, fixed prefix/privacy, and throwing diagnostic sinks.
  Lead inspection and fresh `npm run typecheck`, `npm run build`, `npm test` (83
  passes), `node --check`, ES2017/bare-catch/optional-chaining/ESM/Node-import/
  source-map, ASCII, and whitespace checks pass. The rebuilt bundle SHA-256 is
  `4345d4cd35b30f796ebb164aa9f440061e05a25efcb46ac03b03e1f09c1c8044`.
  `unit-04` remains reopened and unaccepted pending fresh independent review;
  `unit-03` structural behavior and `unit-05` remain unaccepted. No live action,
  dependency/configuration change, or manual generated edit occurred.
- Unit-04 independent review package (2026-08-10): primary fresh reviewer
  `unit-04/attempt-05` returned a truncated report and omitted its required role
  assertion, so it is unusable and non-resumable. After Lead artifact
  reconciliation, fresh recovery reviewer `unit-04/attempt-06` completed at
  6/10 calls but cited nonexistent controller APIs and an ESM build contradicted
  by the actual IIFE package configuration; it is also unusable. Current source
  inspection confirms registration follows existing handler attachment, captures
  the boolean at `controller.ts:300-308`, emits success at `310` before readiness
  at `311`, and false disables/returns. Current focused tests and bundle strings
  match the prior evidence; SHA-256 remains
  `4345d4cd35b30f796ebb164aa9f440061e05a25efcb46ac03b03e1f09c1c8044`.
  Per review-recovery protocol, `unit-04` remains reopened and unaccepted. No
  source/generated/config/live action occurred in this review-only package;
  `unit-03` structural behavior and `unit-05` remain unaccepted.
- Unit-05/attempt-07 automated registration/discovery smoke (2026-08-10): exact
  preflight passed for bundle SHA-256
  `4345d4cd35b30f796ebb164aa9f440061e05a25efcb46ac03b03e1f09c1c8044`, KWin
  and Scripting Pings, Krohnkite disabled/unloaded, known production/test IDs
  unloaded, 19 components with zero exact action matches, four-desktop/sole
  `eDP-1` vector, absent former group, and unchanged 13-group `kwinrc` snapshot
  `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`.
  The inspected 120-second supervisor was started with two same-PID captures,
  but its process did not detach from the command runner. This is a supervisor
  surprise, so the run aborted before `loadScript`, returned-object `run`, any
  registration diagnostic, or t+0/t+1/t+5 action discovery. Its exact-owned
  cleanup completed, captures and supervisor terminated, and the nonce runtime
  directory was removed. Final plugin/action absence, Pings, Krohnkite,
  desktop/output vector, former-group absence, and byte-identical 13-group
  snapshot passed. No client, desktop, shortcut, tiling/config, install, global
  start, reconfigure, restart, or logout action occurred. `unit-04`, `unit-03`,
  and `unit-05` remain unaccepted.
- Unit-04 registration-result review reacceptance (2026-08-11): fresh independent
  review Worker `unit-04/attempt-07` (`ses_014072d4bffetSXuWKPjjfoHbx`) returned
  `review-ready` at its hard 10-call cap, with the required role assertion, no
  edits, and no live action. It found no defects. Lead inspection of
  `controller.ts:264-311`, `controller.test.ts:874-921`,
  `kwin-globals.d.ts:15-23`, and generated `main.js:563-627` confirms boolean
  registration handling, success-before-readiness ordering, false-result
  disable-and-return inertness under the approved pre-registration-handler
  allowance, fixed private payloads, contained sink failures, focused vector
  fidelity, and ES2017 IIFE alignment. The retained verification evidence is 83
  passing tests and bundle SHA-256
  `4345d4cd35b30f796ebb164aa9f440061e05a25efcb46ac03b03e1f09c1c8044`.
  `unit-04` is accepted. `unit-03` remains structurally unaccepted and
  `unit-05` remains failed-clean and unaccepted. No source, test, generated,
  dependency, configuration, or live mutation occurred in this package.
- Unit-05 supervisor-detachment proof package (2026-08-11): sole fresh Worker
  `ses_014024d48ffe2nst3Hp4rGn6qh` reported `review-ready` at 9/12 calls, but
  omitted the required first-line role assertion. Its claimed transient
  `systemd-run --user` marker/timing proof is therefore unusable and cannot
  establish a launch method. Lead independently confirmed only that the user
  manager is `running`, `systemd-run` is systemd 261, and the reported exact
  `pat-detach-1786370730-39455.service` is `not-found`/`inactive`/`dead` with
  `MainPID=0`; its exact `/run/user/1000/pat-detach-1786370730-39455` path is
  absent. No residue is present for that claimed nonce, but detached launch,
  marker timing, and <=180-second cleanup enforcement are unproven. Live-smoke
  automation is parked pending one fresh compliant proof package. No repository
  source/test/configuration, KWin, D-Bus, KGlobalAccel, client, desktop, tiling,
  or configuration mutation occurred.
- Unit-05 final supervisor-proof package (2026-08-11): sole fresh Worker
  `ses_013ff5e11ffe56bWwS3hh06gcn` returned an empty host result. It has no
  required role assertion, status, call count, nonce, command, marker, unit, or
  timing evidence and is `host-unknown`, not proof. Lead found no user-systemd
  units matching `plasma-auto-tiler-supervisor-proof-*.service` and no runtime
  directories matching `$XDG_RUNTIME_DIR/plasma-auto-tiler-supervisor-proof-*`.
  Without a nonce, an exact process/path reconciliation is impossible; no
  detached execution, marker completion, cleanup trigger, or terminal deadline
  is established. Live-smoke automation remains parked. No repository,
  KWin/KGlobalAccel/script/D-Bus/client/desktop/configuration/tiling action
  occurred. This terminal Lead returns to the Orchestrator.
- Unit-05 supervisor proof retry (2026-08-11): the sole fresh Worker
  `ses_01258c55effeg5sxcCNbvkdj4c` used 9/15 calls but returned a malformed
  checkpoint report: its first returned line was `Status: checkpoint`, not the
  required Worker role assertion. It reported `systemd-run --user` launch of
  `pat-cleanup-supervisor-1786398599-20522-14772.service`; Lead independently
  inspected the exact system journal, which records user-manager EXEC failure
  `203/EXEC` for the exact `/tmp/opencode/pat-cleanup-supervisor-1786398599-20522-14772.sh`
  path. The exact runtime directory was empty, so `started`, `cleanup-started`,
  and `complete` markers do not exist; PID 54430 was absent. The manager remains
  `running` with `systemd-run` 261. Lead removed only the exact empty runtime
  directory and temporary script, then verified the exact unit is
  `not-found/inactive/dead` with `MainPID=0` and no matching process remains.
  No detached proof exists. No KWin, D-Bus, KGlobalAccel, client, desktop,
  tiling, or configuration action occurred. Live-smoke automation remains
  parked; no registration/discovery smoke is proposed from this failed proof.
- Unit-05 runtime-directory supervisor proof (2026-08-11): fresh Worker
  `ses_012556428ffeKEz6fGT37xn0pA` supplied the required role assertion and
  returned at 10/15 calls, but its own report records a noncompliant initial
  launch followed by repeat launches. Lead independently inspected the exact
  unit journal and confirmed three starts of
  `plasma-auto-tiler-supervisor-1786398818459529336.service` at 07:53:45,
  07:54:12, and 07:54:22, exceeding the authorization for one transient
  process. The first run emitted ordered journal markers, but its stdout was not
  redirected to the owned path; the later owned-file evidence was removed before
  Lead inspection. The exact runtime path, collected unit, and exact shell
  process are absent after Worker cleanup. No supervisor proof is accepted and
  live-smoke automation remains parked. No KWin, D-Bus, KGlobalAccel, client,
  desktop, configuration, or tiling action occurred.
- Terminal supervisor-proof safety reconciliation (2026-08-11): package 3
  directly rechecked only nonce `1786398818459529336`, unit
  `plasma-auto-tiler-supervisor-1786398818459529336.service`, runtime directory
  `/run/user/1000/plasma-auto-tiler-supervisor-proof-1786398818459529336`, and
  its `supervisor.sh`. The unit is `not-found/inactive/dead` with `MainPID=0`;
  the exact shell process and both paths are absent. No cleanup action was
  needed or performed. The prior exact journal evidence remains three launches,
  so no proof is accepted. State/log evidence confirms no KWin, D-Bus,
   KGlobalAccel, client, desktop, configuration, or tiling action. This Lead is
   terminal and must not be resumed.
- Unit-05 direct supervisor-proof attempt aborted before launch (2026-08-11):
  the exceptional user-authorized Lead-direct proof inspected the user manager
  and command interface before preparing any script. That preflight invoked
  `systemd-run --version` and `systemd-run --help`, so the strict boundary of
  exactly one total `systemd-run` invocation cannot be met truthfully. No
  nonce, runtime directory, temporary script, transient unit, launch timing,
  marker, process, cleanup action, KWin/D-Bus/KGlobalAccel/client/desktop,
   configuration, or tiling action exists. No registration/discovery baseline or
   smoke proposal is produced from this failed proof.
- Unit-05 Lead-direct supervisor proof and read-only reconciliation (2026-08-11):
  user authorization was consumed by exactly one transient launch: nonce
  `1786399438288375019`, unit
  `plasma-auto-tiler-supervisor-1786399438288375019.service`, runtime directory
  `/run/user/1000/plasma-auto-tiler-supervisor-proof-1786399438288375019`, and
  script `<runtime-directory>/supervisor.sh`. The sole invocation was
  `systemd-run --user --unit=<exact-unit> --collect /bin/sh <exact-script>`; it
  returned with the named unit and invocation ID
  `2f0194835f5a4de8898c9c69b02e5348`. The caller timestamp bracket was
  13.311198540 seconds (the tool interface does not expose a narrower subprocess
  return duration). Owned markers prove ordered completion: `started`
  08:04:47.057193121, `cleanup-started` 08:04:49.062191590, and `complete`
  08:04:49.063191589 +1000. Exact journal inspection records the `/bin/sh`
  start; exact `systemctl --user show` before and after removal reports
  `not-found/inactive/dead`, `MainPID=0`, `Result=success`, and
  `ExecMainStatus=0`. Lead removed only the exact runtime directory, then
  verified that it and its script are absent and no exact script process remains.
  Read-only KWin reconciliation found both Peer Pings healthy; Krohnkite,
  production, and structural-proof scripts unloaded; four one-row desktops with
  current `392a73ad-0fff-4b48-bb91-1b67eb82bc49`; sole `eDP-1` output; and the
  unchanged 13-group `kwinrc` hash
  `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`.
  The current bundle hash is instead
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`, and one
  exact `plasma-auto-tiler-insert-right` action already exists at
  `/component/kwin` (`uniqueName=kwin`), contrary to the required zero-match
  preflight. The future smoke therefore remains unexecuted and must stop before
  load if that exact action remains. No KWin, D-Bus, KGlobalAccel, client,
   desktop, configuration, or tiling mutation occurred; baseline access was
   read-only.
- Unit-05 package-02 exact action provenance checkpoint (2026-08-11): read-only
  KGlobalAccel evidence establishes one persistent
  `plasma-auto-tiler-insert-right` record in active `/component/kwin`
  (`uniqueName=kwin`) at fixed t+0/t+1/t+5 enumeration across 19 components.
  Its exact `KGlobalShortcutInfo` tuple identifies the action and label,
  component `kwin`/`KWin`, context `default`/`Default Context`, active key
  `Meta+Alt+Right`, and no default key; exact `kglobalshortcutsrc` metadata is
  `Meta+Alt+Right,none,Insert next window right of focused leaf`. The known
  project, structural-proof, variant, and Krohnkite scripts are all unloaded.
  `allShortcutInfos(s)` and `shortcutNames(s)` take a context name, not an action
  ID: querying them with the action correctly returned zero, while `default`
  returns the exact record. This corrects the prior zero-match probe method.
  Local/official KGlobalAccel component semantics show persisted config entries
  are loaded into the component, so the evidence establishes an active component
  record backed by exact persisted metadata, not a live project callback. It
  cannot determine when the record was written or attribute it to a particular
  attempt: attempt-05 registered then proved removal without unregister, and
  attempt-06 later proved zero exact records. The current record therefore may be
  revived attempt residue or another KWin-component persistence path. Zero-action
  preflight cannot be restored read-only. The sole safe mutation proposal is a
  fresh-preconditioned `org.kde.KGlobalAccel.unregister("kwin",
  "plasma-auto-tiler-insert-right")`; it must verify only the exact tuple/config
  key before mutation, make no retry, then prove exact action/key absence across
  t+0/t+1/t+5, project scripts unloaded, healthy Pings, and unchanged desktop,
  output, Krohnkite, tiling, and non-exact config fingerprints. No mutation was
  performed.
- Unit-05 package-03 targeted exact-action cleanup (2026-08-11): immediately
  before mutation, the exact default-context tuple and exact `[kwin]` config key
  matched package-02 evidence; all known project/Krohnkite scripts were unloaded;
  both Pings passed; and the desktop/output, 13-group tiling, Krohnkite, `kwinrc`,
  and non-exact `kglobalshortcutsrc` fingerprints were recorded. The sole mutation
  was one `org.kde.KGlobalAccel.unregister("kwin",
  "plasma-auto-tiler-insert-right")`, which returned `true`; no retry, broad
  cleanup, invocation, script lifecycle action, config write, reconfigure, restart,
  client, desktop, or tiling action occurred. Corrected default-context
  `allShortcutInfos` and `shortcutNames` enumeration across all 19 components
  found zero exact matches at fixed t+0/t+1/t+5; the exact config key is absent.
  Known scripts remain unloaded and Pings remain healthy. Invariants are unchanged:
  non-exact `kglobalshortcutsrc`
  `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556`,
  `kwinrc` `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`,
  13 tiling groups, desktop/output fingerprint
  `3efb7936a0985a76ab0850940e254fed7ec6e748fa94e77dbff470a96b486edf`, and
  Krohnkite `false`. Unit-03 structural behavior and unit-05 remain unaccepted.
  Fresh-Lead registration-smoke brief: first reconcile the current bundle hash
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422` against
  accepted static evidence; then take this exact clean baseline, run one bounded
  120-second detached supervisor with a <=180-second terminal bound and same-PID
  diagnostic captures, load the bundle only through returned `Script0`, require
  `shortcut-registered` then `startup-handlers-ready`, and discover the exact
  action at t+0/t+1/t+5 by enumerating components with no-argument or `default`
  context `allShortcutInfos`/`shortcutNames` and retaining only exact matches.
  It must require exactly one match before any later authorized work, perform no
  invocation/client/desktop action in that registration/discovery smoke, unload
  only its plugin, and preserve this baseline exactly after cleanup.
- Unit-05/attempt-08 automated registration/discovery smoke failed at the
  discovery-checkpoint gate (2026-08-11): preflight passed for bundle SHA-256
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`, KWin and
  Scripting Pings, Krohnkite disabled/unloaded, all known project IDs unloaded,
  absent project `kglobalshortcutsrc` keys, four-desktop/one-row/sole `eDP-1`
  vector (current `392a73ad-0fff-4b48-bb91-1b67eb82bc49`), absent former group
  `22aeeba5-b168-4c32-97aa-79decf70b9be`, unchanged non-exact
  `kglobalshortcutsrc` `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556`
  and `kwinrc` `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`,
  13-group tiling fingerprint `113d91c92373af93162e007c61bcbb45d31a0fb9b5406bb614888ce9b3f4dba0`,
  and KWin PID 2517. Nonce `3512d98437434266af5baacc452eccf6`; runtime directory
  `/run/user/1000/plasma-auto-tiler-u05-a08-3512d98437434266af5baacc452eccf6`;
  plugin ID `plasma-auto-tiler-u05a08-3512d98437434266af5baacc452eccf6`; unit
  `plasma-auto-tiler-supervisor-u05a08-3512d98437434266af5baacc452eccf6.service`.
  Exactly one launch,
  `systemd-run --user --unit=<unit> --collect --setenv=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus /bin/sh <runtime-dir>/supervisor.sh <runtime-dir> <plugin-id> 58476 58477`,
  invocation ID `ca7ac11fd004443799466a324d6ec344`, returned in about 8 ms.
  Detached proof before load: unit `loaded/active/running` with MainPID 58523
  (PPID 2289, the user systemd manager, not the caller); markers `ready`
  22:29:21.837 and `started` 22:29:21.839. Two same-PID (2517) captures,
  PIDs 58476 and 58477: fixed-prefix `^plasma-auto-tiler:` and unfiltered
  `QT_CATEGORY=kwin_scripting`, both `journalctl -f -n 0`.
- Load/run and registration evidence: `loadScript` returned load ID `0`; only
  `/Scripting/Script0` `org.kde.kwin.Script.run` ran (no global start).
  Fixed-prefix diagnostics in exact order within 1 s: `boundary-decoded:
  workspace-window-list`, `shortcut-registered`, `startup-handlers-ready`;
  the unfiltered `kwin_scripting` capture stayed empty. Raw multi-method
  queries (kwin component no-arg and `default`-context `allShortcutInfos` and
  `shortcutNames`) found exactly one record each for all five source action
  IDs with source-consistent labels and `Meta+Alt+*` shortcuts; kwin tuple
  count rose 213 to 218 and returned to 213 after cleanup.
- Discovery-checkpoint failure: the corrected all-component enumeration was not
  captured at t+0/t+1/t+5 before the 120-second bound because the initial
  discovery helper's busctl parser tokenized multi-word strings by whitespace
  (invalid for `a(ssssssaiai)`), and diagnosing it exceeded the window. The
  supervisor bound fired at 22:31:21.845 and ran its idempotent exact cleanup:
  unloaded only the attempt plugin (true), unregistered exactly once each of
  the five actions (all true), and wrote `cleanup-started` and `complete`
  (22:31:21.869). Its capture `kill` did not terminate the wrapper PIDs, so the
  foreground issued direct `kill -KILL` of exact capture PIDs
  58476/58477/58479/58480/58481. No retry occurred. Result: failed at the
  discovery-checkpoint gate; registration and readiness evidence passed.
- Postflight (corrected all-component/default-context enumeration) at
  t+0/t+1/t+5 found zero exact matches across all 19 components at each
  checkpoint; project config keys absent; known project and Krohnkite scripts
  unloaded; Pings healthy; Krohnkite `false`; desktop/output vector and KWin
  PID 2517 unchanged; former group absent; non-exact `kglobalshortcutsrc`
  `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556` and
  `kwinrc` `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`
  unchanged; 13-group tiling fingerprint unchanged; bundle hash unchanged;
  owned unit `inactive/dead` MainPID 0; no owned process, capture, or runtime
  directory remains. No invocation, client, desktop, KPackage, config write,
  reconfigure/restart/logout, or `cleanUp` occurred. Unit-03 structural
   behavior and unit-05 remain unaccepted.
- Unit-05/attempt-09 collector prevalidation (2026-08-11): read-only
  KGlobalAccel validation established the next smoke's exact collector contract
  without creating a runtime path or process. `allComponents` on
  `/kglobalaccel` is `ao` with JSON envelope `{type:"ao",data:[[paths...]]}`.
  For every returned `/component/*` path, read `uniqueName` and `friendlyName`,
  then call `allShortcutInfos("default")`; it is
  `a(ssssssaiai)` with `{type:"a(ssssssaiai)",data:[[records...]]}`. Each
  record must have exactly eight fields: shortcut/action ID, action label,
  component unique name, component friendly name, context unique name, context
  friendly name, active integer shortcut sequence, and default integer shortcut
  sequence. The parser requires every field's type, the exact signature and
  envelope shape, `default` context, and tuple component identity equal to the
  separately read component properties; unknown or malformed envelopes abort
  rather than yielding zero. Its malformed-seven-field, valid-eight-field,
  empty-envelope, and unknown-type vectors produced `false,true,false,false`.
  Fixed read-only t+0/t+1/t+5 collection returned 19 components, 19
  schema-valid components, and 322 records each time, with project counts
  `0,0,0,0,0` for insert-right, focus-left, focus-down, focus-up, and
  focus-right. The exact `[kwin]` keys are all absent. No mutable D-Bus method,
  script, shortcut, client, desktop, config, tiling, supervisor, capture, or
  runtime-path action occurred. Both Pings pass; KWin PID 2517 and the exact
  `kglobalshortcutsrc` and `kwinrc` baseline hashes remain unchanged.
- Unit-05/attempt-09 smoke aborted before script load (2026-08-11): preflight
  reconfirmed the reviewed bundle SHA-256, Pings, KWin PID 2517, Krohnkite and
  known project scripts unloaded, four-desktop/one-row/sole `eDP-1` vector,
  absent former group, 13-group tiling and non-project-shortcut fingerprints,
  absent five project config keys, and the validated collector's 19
  schema-valid components, 322 records, and `0,0,0,0,0` project counts. Nonce
  `a09-1786401865506279814`; plugin
  `plasma-auto-tiler-u05a09-1786401865506279814`; runtime directory
  `/run/user/1000/plasma-auto-tiler-u05-a09-1786401865506279814`; unit
  `plasma-auto-tiler-supervisor-u05a09-1786401865506279814.service`; one
  `systemd-run --user` launch, invocation `1dff8524af354a358a4c6d15e35ba080`.
  Its ready/start markers and active unit MainPID 61519 proved detachment, but
  the two started capture PIDs were absent before load because the foreground
  command runner timed out. This is a pre-load ownership surprise: no bundle
  load/run, diagnostic, evaluation-error evidence, registration, invocation,
  client, desktop, or tiling/config action occurred. Foreground signalled the
  exact unit's main process; its `cleanup-started` and `complete` markers were
  retained here before runtime removal and the collected unit became
  not-found/inactive/dead with MainPID 0 and success. Scope defect: although no
  attempt action registered, the supervisor's unconditional fallback issued its
  five targeted unregister requests. The postflight validated collector at
  t+0/t+1/t+5 found 19 schema-valid components, 322 records, and `0,0,0,0,0`
  project counts; all exact keys remain absent and all recorded baselines remain
   unchanged. The defect and failed pre-load capture gate leave unit-05 and
   unit-03 unaccepted.
- Unit-05/attempt-10 failed-clean before load (2026-08-11): nonce
  `1786402424434092660`, plugin
  `plasma-auto-tiler-u05a10-1786402424434092660`, and unit
  `plasma-auto-tiler-supervisor-u05a10-1786402424434092660.service` passed the
  corrected preflight: bundle hash, both Pings, KWin PID 2517, Krohnkite and all
  known scripts unloaded, five absent project keys, four-desktop/one-row/eDP-1
  state, former-group absence, 13-group tiling fingerprint, and non-project
  shortcut fingerprint. The validated collector returned 19 schema-valid
  components, 322 records, and project counts `0,0,0,0,0`. One detached
  `systemd-run` supervisor reached ready/start and was active/running with
  MainPID 63993. It had an absent `plugin-loaded` marker and an empty `actions`
  manifest, and it started no journal follower or other capture process. The
  foreground gate returned before a journal cursor or script load/run, so no
  diagnostics, scripting error, registration, discovery, invocation, client,
  desktop, tiling, or configuration action exists. Exact cleanup-request caused
  cleanup-started/complete; the collected unit is not-found/inactive/dead with
  MainPID 0. Empty ownership made unload and unregister counts zero. Postflight
  collector t+0/t+1/t+5 remained 19/322 with `0,0,0,0,0`, all five keys absent,
  scripts unloaded, Pings and KWin PID unchanged, and bundle/config/desktop/
  output/former-group/tiling/non-project-shortcut fingerprints unchanged. The
  nonce runtime directory was removed. No retry occurred; unit-05 and unit-03
  remain unaccepted.
- Unit-05/attempt-10 foreground-gate diagnosis (2026-08-11): the exact retained
  foreground check used `test "$(rg -c 'journalctl -f|capture' supervisor.sh ||
  true)" = 0`. For the intended no-match supervisor file, `rg -c` exits 1 and
  writes an empty string, rather than writing `0`; the test therefore exits 1.
  Synthetic ready/started markers reproduced the exact false failure in 9 ms
  under a five-second bound. This establishes a foreground parser/check defect,
  not a command-runner timeout, marker, quoting, path, or supervisor-detachment
  failure. The narrow replacement is `rg -q` with an explicit accepted status 1
  for no match and failure on any other status. Read-only journal validation with
  current KWin PID 2517 established a global system cursor of the form
  `s=<non-whitespace>` and a five-second `journalctl --system --quiet --no-pager
  --after-cursor=<cursor> _PID=2517` read that exited 0 with zero stdout/stderr
  bytes. `--quiet` is required because its absence emits `-- No entries --` even
  with no matching records. One exact synthetic runtime directory was removed;
  no KWin, script, KGlobalAccel, client, desktop, configuration, tiling, or
  systemd-run mutation occurred. Unit-05 and unit-03 remain unaccepted.
- Unit-05/attempt-11 failed-clean before run (2026-08-11): nonce
  `1786403129263732494`, plugin
  `plasma-auto-tiler-u05a11-1786403129263732494`, and unit
  `plasma-auto-tiler-supervisor-u05a11-1786403129263732494.service` passed the
  full prior preflight, including bundle hash, Pings, KWin PID 2517, unloaded
  scripts, five absent keys, collector 19/322/`0,0,0,0,0` with no unknown project
  record, desktop/output/former-group/13-group, and non-project-shortcut
  fingerprints. One detached supervisor reached ready/start and active/running
  MainPID 66218; the corrected `rg -q` absence gate accepted status 1. A global
  journal cursor was acquired before `loadScript`, but the foreground's exact
  load-ID JSON response was held only in command substitution and is unavailable
  after its parser rejected it. Read-only `isScriptLoaded` established that the
  exact plugin had loaded, while its action manifest remained empty and no
  after-load/run journal read or ScriptN run occurred. Foreground recovery then
  atomically recorded that verified exact plugin ownership and unloaded only it;
  it issued zero unregister calls. Postflight t+0/t+1/t+5 collector readings are
  19/322/`0,0,0,0,0` with no unknown project action; all five keys are absent,
  scripts/Pings/PID/Krohnkite/bundle/desktop/output/former-group/13-group/non-
   project shortcut fingerprints are unchanged, and the collected unit is
   not-found/inactive/dead MainPID 0. Unit-05 and unit-03 remain unaccepted.
- Unit-05/attempt-12 parser-contract validation (2026-08-11): read-only
  `busctl --user introspect org.kde.KWin /Scripting org.kde.kwin.Scripting`
  confirms both `loadScript(s)` and `loadScript(ss)` return one signed D-Bus
  integer (`i`). The previous attempt's raw response was not retained and is
  not inferred. On this host, a read-only analogous `i` response from
  `org.kde.KWin.currentDesktop()` with `busctl --json=short` was exactly
  `{"type":"i","data":[1]}`; the only accepted future load envelope is
  exactly `{"type":"i","data":[<one integer>]}` with a value from 0 through
  2147483647. A temporary fail-closed local `jq` parser accepted `0`, `37`, and
  `2147483647`, and rejected wrong/missing type or data, scalar/empty/multiple
  data, string, negative, out-of-range, fractional, extra-key, and malformed
  JSON vectors. It emits exactly the safe nonnegative ID on success and no
  value otherwise. The temporary parser and vectors were removed.
- Attempt-12 capture contract: before parsing, write the raw `loadScript`
  stdout to an attempt-owned runtime file through a same-directory temporary
  file followed by `mv`; separately retain its SHA-256, exact byte count,
  parser exit status, parsed JSON type, and data cardinality through postflight.
  Only parser success permits constructing `/Scripting/Script<ID>`; then require
  `busctl --user introspect org.kde.KWin /Scripting/Script<ID>
  org.kde.kwin.Script` to succeed before any object method. Parser or object
  failure stops before run and never guesses `Script0`. Current `/Scripting`
  has no `Script*` child; both Peer Pings pass. `kglobalshortcutsrc`
  `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556` and
  `kwinrc` `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`
  remain unchanged. No mutable D-Bus method, script lifecycle action, systemd
  unit, client, desktop, tiling, or configuration operation occurred.
- Live-testing guide checkpoint (2026-08-11): `../../live-kwin-testing.md` is
  now the authoritative operational guide for any future KWin/Plasma test. It
  reconciles the established nonce-owned supervisor, collector, and durable
  load-ID parser contracts with the still-unaccepted registration discovery and
  structural journeys. It grants no mutation authorization and changes no
  unit acceptance.
- Unit-05/attempt-12 registration/discovery smoke stopped at the readiness
  diagnostic gate (2026-08-11). Fresh nonce
  `163b40bb668e45ec9fe920652ec92da7`, plugin
  `plasma-auto-tiler-u05a12-163b40bb668e45ec9fe920652ec92da7`, and one
  `plasma-auto-tiler-supervisor-u05a12-163b40bb668e45ec9fe920652ec92da7.service`
  invocation passed the full preflight: bundle
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`, both
  Pings, PID 2517, disabled/unloaded Krohnkite and known scripts, five absent
  keys and actions, 19 schema-valid components/322 records, the four one-row
  desktops/current Desktop 1/sole `eDP-1` state, absent former group, and
  baseline tiling/config fingerprints. Ready/start markers and active/running
  MainPID 69049 proved detachment; the no-background `rg -q` gate accepted only
  status 1. The valid journal cursor was retained before load.
- Durable load evidence is raw `{"type":"i","data":[0]}` (24 bytes,
  SHA-256 `a49f90e990b55976334b8e74e79766d6e25592d736c2d8927f127be1ad22b584`,
  command/parser status 0, type `i`, cardinality 1). It derived and introspected
  only `/Scripting/Script0` with `org.kde.kwin.Script.run`; exact loaded state was
  `true` before atomically recording the plugin manifest, and only that object
  ran. The bounded same-PID fixed-prefix and `QT_CATEGORY=kwin_scripting`
  after-cursor reads were both empty. Missing required ordered boundary,
  `shortcut-registered`, and `startup-handlers-ready` stopped the attempt before
  collector readiness snapshots, action manifest creation, invocation, client,
  desktop, tiling, configuration, KPackage, global start, reconfigure, restart,
  or logout action.
- Exact plugin cleanup returned `true` and markers reached cleanup/complete; the
  collected unit is not-found/inactive/dead with MainPID 0 and Result success.
  However, postflight validated collector snapshots t+0/t+1/t+5 each reported
  19 components, 327 records, and five project records. The exact source
  ID/label/component/context records persist under `kwin/default`, and all five
  exact config keys persist; `kglobalshortcutsrc` is now
  `b25020b132f0b2dd059b06823f564cb08ac56479bdd50c3de388a72d9a9e383e`.
  The action manifest remained empty because readiness never validated a
  snapshot. The exact-manifest contract therefore prohibited unregistering those
  unrecorded actions. This is unclean failed state requiring fresh explicit
  recovery authority, not a failed-clean result or runtime acceptance. Bundle,
  `kwinrc`, PID/Pings, Krohnkite, scripts, desktop/output, former group, and
  13-group tiling state remain unchanged.
- Unit-05/attempt-12 recovery reconciliation, no mutation required (2026-08-11):
  a prior cancelled Lead dispatch for this identical recovery is now confirmed
  (read-only) to have already completed it. The fail-closed 19-component
  collector found zero of the five target actions in `kwin/default`, zero
  `plasma-auto-tiler` keys in `kglobalshortcutsrc`, and its SHA-256 already
  restored to the pre-attempt-12 baseline
  `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556`. Zero
  `unregister` calls were issued this package. t+0/t+1/t+5 re-checks confirm
  the absence is stable; Pings, KWin PID 2517, `isScriptLoaded` false for all
  known project/Krohnkite IDs, `kwinrc` hash
  `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb` with 13
  tiling groups, former-group absence, and desktop/output state (count 4, rows
  1, current `392a73ad-0fff-4b48-bb91-1b67eb82bc49`) are all unchanged. No
  attempt-12 nonce (`163b40bb668e45ec9fe920652ec92da7`) systemd unit, runtime
  directory, or process remains. Unit-05 and unit-03 structural behavior remain
  unaccepted; no runtime capability claim is made. A fresh Lead package-2 must
  separately diagnose, read-only, why attempt-12's same-PID after-cursor
  journal reads returned no diagnostics despite a successful load/run.
- Package-2 journal-capture root-cause diagnosis (2026-08-11, read-only, no
  mutation): established that attempt-12's diagnostics existed all along but
  were captured with the wrong journal scope. KWin runs as systemd **user**
  unit `plasma-kwin_wayland.service`; `journalctl --system` returns zero
  `_PID=2517` records while `--user` (and the unscoped default) return 142 in
  the same window. Attempt-12's own full success sequence
  (`boundary-decoded:workspace-window-list`, `shortcut-registered`,
  `startup-handlers-ready`) is directly retrievable at
  `2026-08-11T09:30:45.681539-.682134+10:00`, bracketed by its own recorded
  supervisor start/stop journal lines. `--system` was introduced at
  attempt-10's foreground-gate diagnosis and validated only against an empty
  (no-new-entry) read, never against a true positive, so the scope defect was
  never caught before attempt-11/attempt-12 inherited it.
- Also established: `plasma-auto-tiler:` diagnostics carry `QT_CATEGORY=js`
  (not `kwin_scripting`) and no `_SYSTEMD_USER_UNIT` field; identity filtering
  must use `_PID` only. Cursor-then-after-cursor semantics were proven correct
  in `--user` scope using a benign `logger`-written marker (no KWin mutation).
  No `QT_LOGGING_RULES` is configured anywhere discoverable read-only
  (unit/session environment), yet both debug-level `js` and warning-level
  `kwin_scripting` messages already appear, so no logging-rule change is
  needed.
- Surprise flagged, not resolved here: an undocumented full success sequence
  exists at `2026-08-11T08:29:40`, with no corresponding `systemd-run` launch
  trace, contradicting the recorded attempt-11 narrative that no run occurred.
  Left for Orchestrator attention; out of this package's bounded scope.
- Corrected attempt-13 capture contract (full detail in the matching log
  entry): `--user` scope explicitly (never `--system`); `_PID=<pid>` identity
  filter only; cursor immediately before `loadScript` (unchanged, was never
  the defect); one bounded synchronous `--after-cursor` read after `run()`;
  fixed-prefix success parsing independent of category; unanchored
  `kwin_scripting` error check independent of prefix; existing fail-closed
  conditions unchanged.
- Manifest/ownership correction required alongside the capture fix: record
  action-ownership for cleanup as soon as the read-only KGlobalAccel collector
  confirms the five exact actions newly exist after `run()`, independent of
  the separate journal-diagnostic readiness gate (which remains required,
  unchanged, before invocation/journeys). This decouples cleanup-safety from
  journal-capture success so a future unrelated capture defect cannot
  reproduce attempt-12's residue.
- Package-3 attribution and guide correction (2026-08-11, read-only plus
  documentation edits, no mutation): the `2026-08-11T08:29:40` sequence
  flagged by package 2 is confirmed as `unit-05/attempt-08`'s own run.
  `journalctl --user` matched attempt-08's exact recorded nonce
  `3512d98437434266af5baacc452eccf6` and plugin ID `plasma-auto-tiler-u05a08-
  3512d98437434266af5baacc452eccf6` at `2026-08-11T08:29:21.820182+10:00`
  (`Started [systemd-run] ...`), 19 seconds before the 08:29:40 diagnostics,
  inside attempt-08's 120-second bound, matching attempt-08's own recorded
  ordered-diagnostics and `213 -> 218 -> 213` tuple-count claims exactly. Flag
  closed. Package 2's stated cause for missing this trace ("the same
  defective `--system` scope") is corrected: that specific search already used
  `--user`; it missed the match only because `rg -F` with a `|`-joined pattern
  matched as one literal string, not alternation. This is a search-tool usage
  lesson, not a recurrence of the journal-scope defect, and is now recorded in
  `../../live-kwin-testing.md`.
- `../../live-kwin-testing.md` updated: mandatory `--user` journal scope with
  an explicit `--system`-returns-zero warning, `_PID`-only identity filtering,
  the `QT_CATEGORY=js`-at-debug-priority fact for production diagnostics
  versus `QT_CATEGORY=kwin_scripting`-at-warning for errors, the exact cursor/
  after-cursor contract, the true-positive validation requirement, the
  ownership-independent-of-diagnostics rule, an `rg -F` alternation pitfall
  note, a new attempt-12 Attempt Lessons row, and an updated Current Boundary
  noting both attempt-08 and attempt-12 now have confirmed ordered
  diagnostics. No prior guide text asserted attempt-12 failed or produced no
  diagnostics (the guide predates attempt-12), so there was no false claim to
  retract beyond ensuring the new text is accurate.
- This is capture-evidence reconciliation only. Unit-05 and unit-03
  acceptance status are unchanged and remain unaccepted pending a fresh,
  correctly-scoped `unit-05/attempt-13` under separate authorization.
  Verification performed: ASCII-only, no trailing whitespace, no tabs, and
  `git diff --check` (exit 0) on all three edited files; every relative
  link/path in the guide was existence-checked and found present.
- Lead succession: current role is Lead (`lead-anthropic`, `anthropic/claude-
  sonnet-5`) under the Orchestrator, actual role Lead matching configured role.
- Unit-05/attempt-13 registration/discovery smoke, clean (2026-08-11,
  Lead-direct, no Worker dispatched, non-interactive): preflight matched the
  exact recorded baseline in full: bundle SHA-256
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`; both
  Peer Pings (exit 0); KWin PID 2517; Krohnkite `krohnkiteEnabled=false` and
  unloaded; `krohnkite`, `plasma-auto-tiler-kwin`,
  `plasma-auto-tiler-structural-proof`, and both parked variant IDs unloaded;
  the fail-closed all-19-component `allComponents`/`allShortcutInfos("default")`
  collector returned 19 valid components and 322 records with zero project
  matches; all five `[kwin]` `kglobalshortcutsrc` keys `__ABSENT__`;
  `kglobalshortcutsrc` SHA-256
  `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556`; desktop
  count 4, rows 1, current `392a73ad-0fff-4b48-bb91-1b67eb82bc49`; `kwinrc`
  SHA-256 `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`
  with 13 `[Tiling]` groups; former group
  `22aeeba5-b168-4c32-97aa-79decf70b9be` absent.
- Capture true-positive proof: acquired `journalctl --user --quiet
  --show-cursor -n 1`, wrote a benign `logger --tag opencode-cursor-proof`
  marker (no KWin mutation), and confirmed the marker appeared in a
  `--user`-scope `--after-cursor` read before relying on the mechanism for the
  live capture.
- Nonce `a13-1786407257-82681`; plugin
  `plasma-auto-tiler-u05a13-a13-1786407257-82681`; runtime directory
  `/run/user/1000/plasma-auto-tiler-u05-a13-a13-1786407257-82681`; unit
  `plasma-auto-tiler-supervisor-u05a13-a13-1786407257-82681.service`. One
  `systemd-run --user --unit=<unit> --collect --property=RuntimeMaxSec=180`
  launch of a `/bin/sh` supervisor with a mode-700 nonce runtime directory;
  ready/started markers (10:15:08.745741317 / 10:15:08.747375858) plus
  `active/running` `MainPID=82744` proved detachment; the no-follower/
  no-capture-process source gate used `rg -q` and received exactly status 1.
- Durable load evidence: cursor acquired immediately before load
  (`s=a17d376761aa438cabca8accf9a13d58;i=c8ac1;...`); raw
  `loadScript(ss)` stdout was atomically retained (write-then-`mv`) as
  `{"type":"i","data":[0]}`, 24 bytes, SHA-256
  `a49f90e990b55976334b8e74e79766d6e25592d736c2d8927f127be1ad22b584`; the
  preceding command ran under `set -e` and the script continued, establishing
  command status 0. A fail-closed `jq` parser (object with exactly `type`/
  `data`, type `i`, one-element integral in-range `data`) accepted it as
  cardinality 1, ID 0. `/Scripting/Script0` was introspected
  (`org.kde.kwin.Script` with `run`/`stop`) before any method call; plugin
  ownership was recorded (write-then-`mv`) only after `isScriptLoaded` for
  the exact plugin name independently confirmed `true`. Only that returned
  object received `run()` (no global `Scripting.start`, no guessed
  `Script0`).
- Ordered diagnostics: the single bounded synchronous post-`run()`
  `journalctl --user --quiet --no-pager --after-cursor=<cursor> _PID=2517`
  read (status 0, no `-- No entries --`) contained, in strictly increasing
  timestamp order, `plasma-auto-tiler:boundary-decoded:workspace-window-list`
  (`QT_CATEGORY=js`, `PRIORITY=7`, `1786407379675784`),
  `plasma-auto-tiler:shortcut-registered` (`1786407379676420`), and
  `plasma-auto-tiler:startup-handlers-ready` (`1786407379676435`), matched
  category-agnostically on the fixed message prefix; no `disabled:` event
  appeared. The independent unanchored `QT_CATEGORY=kwin_scripting` check over
  the same read found zero records (no evaluation error). Four pre-existing
  known-benign `qt.qml.usedbeforedeclared` warnings (documented since
  attempt-05) also appeared and are not attributed to any guard failure.
- Ownership-independent-of-diagnostics gate: immediately after the diagnostic
  read, the fail-closed collector confirmed 19 components/327 records with
  exactly five project matches (one each for `plasma-auto-tiler-insert-right`,
  `-focus-left`, `-focus-down`, `-focus-up`, `-focus-right`, all under
  `kwin`/`KWin`/`default` with source-consistent labels); action ownership was
  recorded (write-then-`mv`) from that exact match set, independent of the
  (already-passed) diagnostic gate. The t+1 snapshot (~1s later) again showed
  exactly 19/327 with the same five matches and no duplicate/unknown record.
- Supervisor failsafe preemption (reported surprise, diagnosed, not a KWin or
  registration defect): before the intended t+5 snapshot, that checkpoint
  instead read 19/322 with zero project matches. Diagnosis found the
  supervisor's own 120-second wait-for-trigger loop (started 10:15:08.747)
  had legitimately elapsed by 10:17:09 (~121s of real wall-clock time across
  the intervening tool-call/diagnostic steps; no early trigger file was ever
  written by the foreground process) and ran its exact-manifest cleanup:
  `unload-result: true` for the recorded plugin, and `unregister-result: true`
  for each of the five recorded actions, using only the two ownership
  manifests populated earlier in this same attempt. This is compliant
  exact-manifest cleanup firing earlier in wall-clock terms than intended, not
  an unsafe or broad action; no action was invoked and no client/desktop/
  tiling/config mutation occurred at any point in this attempt.
- Postflight at t+0/t+1/t+5: bundle hash, both Pings, KWin PID 2517,
  Krohnkite, all six relevant script IDs (including this attempt's own
  plugin) unloaded, collector 19/322 with zero project matches at every
  checkpoint, all five config keys `__ABSENT__`, `kglobalshortcutsrc` and
  `kwinrc` SHA-256 both exactly restored to the recorded baseline, 13 tiling
  groups, former-group absence, and unchanged desktop/output vector all
  passed. The collected unit reported `not-found/inactive/dead`, `MainPID=0`;
  no process referenced the nonce runtime directory, which was removed after
  this evidence was retained; local `/tmp/opencode` helper files were also
  removed.
- Status / scope: this is a successful registration/discovery capture-contract
  validation end to end (true-positive proof, load/parse/introspect/run
  contract, ordered diagnostics, exact ownership recording independent of the
  diagnostic gate, and clean exact-manifest cleanup/postflight). It is not
  unit-05 structural acceptance: no action invocation, client launch, desktop
  creation/switch, tiling/config edit, KPackage action, or global
  `Scripting.start` occurred, matching this package's exact scope. Unit-03
  structural behavior and unit-05 remain unaccepted pending a separately
  authorized `unit-05/attempt-14` window journey. No specification, source,
  test, or generated-artifact edit occurred in this package; only `plan.md`,
  `state.md`, and `log.md` were updated; no commit.
- Attempt-14 design note: give the foreground process an explicit early
  cleanup-trigger path (e.g. a marker file the supervisor polls, checked more
  frequently than the failsafe bound) so a longer manual window-journey
  sequence is not at risk of the supervisor's independent timer preempting a
  planned checkpoint or the still-pending cleanup step, exactly as occurred
  here.
- Session-crash reconciliation for `unit-05/attempt-14` (2026-08-11): the
  OpenCode session crashed while a Lead was dispatched to execute
  `unit-05/attempt-14`; no plan/state/log artifact recorded any attempt-14
  execution. Live reconciliation found attempt-14 got only as far as
  creating its own empty nonce runtime directory
  `/run/user/1000/plasma-auto-tiler-u05-a14-a14-1786407945-134079` (birth
  10:25:45, no script or markers inside); `journalctl --user` has zero
  records for that nonce, `systemd-run`, or `plasma-auto-tiler` since
  10:20, so no supervisor ever launched and no KWin, D-Bus, KGlobalAccel,
  desktop, client, or tiling/config mutation occurred. Every read-only
  invariant (both Peer Pings, KWin PID 2517, `isScriptLoaded=false` for all
  known IDs with no `/Scripting/Script*` object, the fail-closed
  19-component collector at 19/322/zero project matches, `kglobalshortcutsrc`
  SHA-256 `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556`,
  `kwinrc` SHA-256
  `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb` with 13
  tiling groups, desktop count 4/rows 1/current
  `392a73ad-0fff-4b48-bb91-1b67eb82bc49`, Krohnkite disabled/unloaded, and
  bundle SHA-256
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`)
  exactly matched the recorded pre-attempt-14 baseline both before and after
  cleanup. No Konsole process or other `plasma-auto-tiler` process/unit
  exists; the sole `plasma-auto-tiler`-path process match is the user's
  unrelated pre-existing devenv `fish` shell. The Lead removed only the
  empty, journal-absent, positively attributed nonce runtime directory
  (`rmdir`) and reverified every invariant afterward; no plugin unload,
  action unregister, desktop restoration/removal, process termination, or
  tiling-key deletion was needed because none of those resources were ever
  created. Unit-03 structural behavior and unit-05 remain unaccepted; a
  fresh `unit-05/attempt-14` may be safely re-run exactly as designed under
  fresh separate user authorization, with no outstanding residue.
- Unit-05/attempt-15 automated journey, failed-clean at window-eligibility
  gate (2026-08-11, Lead-direct, no Worker, non-interactive under standing
  authorization): a fresh attempt ID (attempt-14 recorded crashed/abandoned).
  Preflight matched the exact recorded baseline (bundle
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`, both
  Pings, PID 2517, Krohnkite/scripts unloaded, 19/322/zero collector, zero
  keys, four desktops/current `392a73ad-...`, `kwinrc`
  `4751cce27dc538be16dafac5a3c229ec0de6ab55d0497c264f3a0eaf310268eb`/13
  groups, `kglobalshortcutsrc`
  `e88f8e0d8d54d96ec4c6e6d97e7288fe8ea3a0117c5d11377de6152730856556`, no
  Konsole/test process). A new heartbeat-plus-early-trigger supervisor
  contract (0.75s poll, 120s heartbeat-stale bound, 600s internal terminal
  bound within an up-to-900s ceiling, exact-manifest idempotent cleanup,
  5s-bounded D-Bus calls) was written, syntax/pattern-checked, then launched
  once via `systemd-run --user`; detachment proved via ready/started
  markers and active/running MainPID. It created and switched to one
  temporary desktop (verified exactly-one diff), loaded/ran the bundle with
  the required ordered startup diagnostics and zero scripting errors, and
  the collector immediately confirmed all five project actions (ownership
  recorded independent of the diagnostic gate). Client A (a Wayland-native
  `plasma-auto-tiler-test` Konsole, recorded process group) was launched and
  its `windowAdded` was observed but rejected as `window-added-rejected:
  eligibility-or-scope` rather than the required `window-added-eligible` -
  the first live observation of this gate. Per fail-fast discipline the
  attempt stopped there: no active-window establishment, keyboard
  invocation, client B/C, or split/placement mutation was attempted. Neither
  journey 1 (keyboard insertion) nor journey 4 (automatic placement) is
  proven.
- Attempt-15 read-only source diagnosis (no edit): the combined
  `window-added-rejected:eligibility-or-scope` code covers both a null
  `scopeForWindow` result and a false `windowInScope` result
  (`controller.ts:510-523`). `scope.output` is constructed directly from the
  window's own `output`, so an output mismatch cannot be the cause by
  construction; `scopeForWindow` re-reads the live current desktop via
  `workspace.currentDesktopForScreen` (`controller.ts:752-765`,
  `entry.ts:26`), so stale-cache desktop mismatch is also unlikely.
  `windowInScope` (`controller.ts:101-116`) requires `normalWindow`,
  `managed`, `resizeable`, `!appletPopup`, and a decoded `desktops` entry
  matching the live current desktop; `isWindow` (`boundary.ts:210-224`)
  checks only structural shape, not these values, so the rejection is a
  genuine value-level condition, not a malformed object. This is the first
  live evidence for the long-flagged, previously entirely untested
  "windowAdded readiness ordering" unknown; the leading unconfirmed
  hypothesis is that `managed` and/or `desktops` has not yet settled at the
  exact instant `windowAdded` fires for a freshly mapped window. Current
  diagnostics cannot distinguish which specific sub-condition failed.
- Attempt-15 cleanup/postflight: the `trigger` marker produced
  `cleanup-started`/`complete` within ~2.5s; `cleanup.log` recorded
  exact-manifest results (plugin unload `true`; all five actions
  unregistered `true`; client A's process group terminated; original
  desktop restored; temporary desktop removed). The temporary desktop never
  received a `tiles`/`padding` key (consistent with A never reaching
  automatic placement); confirmed absent directly. Postflight exactly
  matched preflight: collected unit `not-found/inactive/dead`/`MainPID=0`;
  both Pings; KWin PID 2517 unchanged; plugin/`Script*` absent; collector
  19/322/zero; zero keys; original desktop vector/current restored;
  `kwinrc` and `kglobalshortcutsrc` SHA-256 and 13-group count unchanged;
  Krohnkite unchanged; both client-A processes confirmed gone; no
  `plasma-auto-tiler` runtime path/unit/process remained after nonce
  removal; bundle SHA-256 unchanged. Nine unrelated stale tiling groups
  untouched throughout.
- Attempt-15 status / recommendation: `unit-03` structural behavior and
  `unit-05` remain unaccepted. The supervisor/capture/collector/load-parser
  contracts are now further proven (heartbeat variant included) and need no
  further changes. The blocker is purely the window-eligibility gate. The
  recommended next unit is a bounded, source-only observability correction
  adding fine-grained `window-added-rejected:*` sub-codes (mirroring the
  existing `keyboard-rejected:*` design) with normal static/unit
  verification and independent review, followed by a fresh separately
  authorized `unit-05/attempt-16` smoke reusing this package's proven
  supervisor/capture contracts unchanged. Manual-only drag and Esc
  cancellation journeys remain entirely untested and still require a future
  interactive session; they cannot be attempted non-interactively.
- Lead succession: current role is Lead (`lead-anthropic`,
  `anthropic/claude-sonnet-5`) under the Orchestrator, for the bounded
  `unit-06` observability-correction package recommended above.
- `unit-06` accepted (2026-08-11): split the single
  `window-added-rejected:eligibility-or-scope` diagnostic in
  `handleWindowAdded()` into six sub-codes (`scope-unavailable`,
  `not-normal-window`, `not-managed`, `not-resizeable`, `applet-popup`,
  `desktop-scope-mismatch`) via a new private `windowAddedRejection` helper
  called only inside the already-decided rejection branch, so the
  accept/reject decision (`scope === null || !windowInScope(window, scope)`)
  and `windowInScope`/`scopeForWindow` and their other three call sites are
  byte-identical to before. `windowInScope`'s `window.output !== scope.output`
  branch is proven unreachable from this call site (scope is always derived
  from the same window) and has no sub-code. Baseline was directly
  reconciled first (bundle SHA-256
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`,
  140/140 tests/23 suites, no drift). Rebuilt bundle SHA-256 is
  `d0a3ae1d50863806ee05033802213a7680fa38243696c218605c105a6a140adb`
  (esbuild-reproducible), and the suite is now 141/141 tests across 23
  suites. Lead independently read the changed source and independently reran
  typecheck/build/test/hash before accepting; a separate review Worker
  independently reached ACCEPT with its own reasoning and its own matching
  typecheck/build/test/hash run, covering no-behavior-change,
  exhaustiveness/mutual distinguishability, exactly-one-code-per-rejection,
  fixed-literal payload privacy, full test coverage, and generated-artifact
  provenance. Source-only throughout: no live KWin/Plasma action, no
  supervisor, no journal capture, no `spec.md`/`devenv.nix`/
  `kwin/package.json` edit, no deferred eligibility-re-evaluation decision
  touched, no commit. `unit-03` structural behavior and `unit-05` itself
  remain unaccepted pending a fresh, separately authorized
  `unit-05/attempt-16` smoke.
- Rebaselined `kwinrc`/tiling-group postflight target (2026-08-11, Orchestrator-
  ruled, before `unit-05/attempt-16`): a Lead-earlier dispatch of this exact
  package was aborted by a host quota interruption before it could report or
  write any artifact. Bounded read-only `journalctl --user` correlation
  attributed the interruption's residue with high confidence: a detached
  supervisor with nonce `a16-1786412658-13667` (matching this package's own
  naming scheme) ran `systemd-run --user` 11:44:36-11:48:31, reaching load/run
  (ordered startup diagnostics observed), one Wayland-native
  `plasma-auto-tiler-test` client launch, and
  `plasma-auto-tiler:window-added-rejected:desktop-scope-mismatch`, before its
  own automatic cleanup fired (normal systemd service-exit accounting, not an
  external kill) at 11:48:31 - the exact same timestamp as `kwinrc`'s mtime.
  That cleanup correctly removed the plugin, all five actions, the client
  process, and the temporary desktop itself (desktop count/current restored to
  the recorded 4/`392a73ad-...`), but left the temporary desktop's default
  `[Tiling]` group entry behind (KWin does not purge `[Tiling]` entries on
  desktop removal). This is a confirmed real interrupt-path leak in the
  automatic (heartbeat/terminal-bound) cleanup path, not ordinary KDE churn
  and not a defect in `unit-05/attempt-13`/`unit-05/attempt-15`'s own
  demonstrated-clean cleanups. The aborted dispatch's diagnostic capture is
  unreported, non-authorized, host-unknown evidence per governance and is
  **not** used toward `unit-05`/`unit-03` acceptance; a fresh `unit-05/attempt-16`
  must still run and report independently.
- Per Orchestrator ruling, the leaked group is treated exactly like the other
  nine pre-existing unrelated stale groups: not owned, not a cleanup target,
  never modified. The preserved-set framing is now "ten stale groups," not
  nine. The postflight baseline for `unit-05/attempt-16` onward is rebaselined
  to the state found at the start of that package rather than re-litigated
  against the now-stale `4751cce27d...`/13-group checkpoint: `kwinrc` SHA-256
  `cc624ba8763531610c42fe3b62b54c3192ee796314da9997dde2c6056f7141ab`, 14
  `[Tiling]` groups (4 keyed to the live desktop vector, 10 unowned/stale).
  `kglobalshortcutsrc`, the collector, Krohnkite, KWin PID 2517, both Pings,
  and the desktop vector are all unchanged from every prior checkpoint. Any
  future attempt's byte-identical-restoration check compares against this
  14-group/`cc624ba8...` baseline, not the superseded 13-group one.
- `unit-05/attempt-16` (2026-08-11, one Worker dispatch plus one same-scope
  cursor-extraction correction, Lead independently re-verified every claim
  against the live host and retained evidence) achieved this package's exact
  objective cleanly: the first live client's rejection sub-code is
  `window-added-rejected:desktop-scope-mismatch`. Per the fixed evaluation
  order in the accepted `unit-06` helper, this rules out
  `scope-unavailable`/`not-normal-window`/`not-managed`/`not-resizeable`/
  `applet-popup` and narrows the cause to the window's decoded `desktops`
  value not containing (or failing to decode as containing) the live current
  desktop id - the first live evidence narrowing, not yet fully confirming,
  the long-flagged "windowAdded readiness ordering" hypothesis to that
  specific field. Restoration was byte-identical to the rebaselined
  14-group/`cc624ba8...` state (independently reconfirmed by the Lead
  directly against live host state, not only the Worker's files); the
  temporary desktop's own transient tiling-group entry was positively
  detected and deleted by exact UUID, without adding to the ten pre-existing
  unowned stale groups. `unit-03` structural behavior and `unit-05` remain
  unaccepted: this is a diagnostic pinpointing, not an eligible window
  journey; keyboard insertion and automatic placement remain unproven. Full
  detail: log.md, 2026-08-11 attempt-16 entry.
- A consequential design decision now plausibly surfaces from this result -
  whether/how to handle a newly-mapped window's `desktops` value settling at
  `windowAdded` time (e.g. some form of deferred eligibility re-evaluation) -
  and remains explicitly parked for the Orchestrator/user; no design or
  implementation of it was attempted in this package.
- `unit-05/attempt-17` (2026-08-11, one implement-build-live-validate
  package): implemented and shipped bounded deferred `desktop-scope-mismatch`
  re-evaluation exactly per the design above (one 50ms `QTimer`-backed retry
  via new `ControllerEnvironment.scheduleOnce`, cancelled on window removal,
  the other five rejection sub-codes unchanged/immediate). Bundle SHA-256
  `b02a53d9eecafd6dbbf14bf4ef04d74f388a0a2e6428af28cf37a5d610f5fde5`, 144/144
  tests/23 suites. Live-validated: the mechanism itself is correct, bounded,
  and inert (client A's `window-added-deferred:decode-failed` ->
  `window-added-reevaluated:decode-failed` ->
  `window-added-rejected-deferred:desktop-scope-mismatch`, ~50ms apart, no
  `disabled:` event), but this disproves the settling-race reading of
  `unit-05/attempt-16`: `window.desktops` fails to decode at all at both t0
  and t+50ms, not merely omit the current desktop id, pointing to a
  structural marshalling cause rather than a short timing race. Journeys B
  (keyboard) and C (automatic placement) were not attempted; client A never
  became eligible. Cleanup independently re-verified byte-identical to the
  `cc624ba8...`/14-group baseline (including exact-UUID deletion of one
  leaked `[Tiling]` group). `unit-03`/`unit-05` remain unaccepted. Full
  detail: log.md, 2026-08-11 attempt-17 entry.
- `unit-05/attempt-20` (2026-08-11, Lead-direct): the source correction covers
  the remaining plausible strict JavaScript wrapper-identity failure by using
  the exact singleton eligible tile occupant only when it is unambiguous, while
  retaining active-window/tile/scope, target-occupant, output, and desktop
  revalidation immediately before mutation. It adds the fixed diagnostic
  `keyboard-armed:target-occupant-wrapper`. `npm run typecheck` and 147 tests
  across 23 suites passed; rebuilt bundle SHA-256 is
  `513e45d5c13c7eeba5ee4267577be657dc66f59928469e3ab6bb16766741d9da`.
  The live attempt stopped at its fail-closed load-result parser before `run()`
  and before any client journey. Its raw response was structurally valid, so
  the failure was the runner's `jq` precedence defect, not a KWin response; the
  new wrapper diagnostic was therefore not live-observed.
  The dedicated 10-second heartbeat writer advanced 28 times. Exact recovery
  unloaded only the attempt plugin and restored the temporary desktop.
  Removing that desktop left one attempt-owned tiling entry, which was
  immediately deleted by its exact desktop/output UUID. Retained postflight
  `kwinrc` evidence has a different hash from preflight, so byte-identical
  configuration restoration is not established and its capture ordering is
  unresolved. Owned-resource cleanup is evidenced, but the supervisor,
  heartbeat writer, runtime directory, plugin, actions, clients, and desktop
   must not be represented as a byte-identical postflight claim. Unit-03/unit-05
   remain unaccepted; A/B/C were not attempted. Evidence: `/tmp/opencode/pat-u05-attempt-20-*-evidence/`.
- `unit-05/attempt-21` through `attempt-23` (2026-08-11, Lead-direct): the
  corrected strict load parser accepted retained valid
  `{"type":"i","data":[0]}` evidence and rejected eight malformed or
  false-positive vectors. Attempts 21 and 22 stopped before `createDesktop`:
  first on an `rg --` procedure defect, then because the logger true-positive
  marker was incorrectly filtered to KWin's PID. Attempt 23 created exactly one
  named temporary desktop but failed its fresh-ID extraction before recording
  the supervisor desktop manifest; no bundle load/run, actions, or clients
  followed. Exact recovery positively identified only `PAT-U05A23`, restored
  the original desktop, removed it, and deleted only its verified
  desktop/output tiling keys. Both `kwinrc` and `kglobalshortcutsrc` then
  byte-matched attempt preflight. Unit-03/unit-05 remain unaccepted; no
   Client A/B/C or singleton-fallback evidence exists. Evidence:
   `/tmp/opencode/pat-u05-attempt-23-*-evidence/`.
- `unit-05` Package 5 (2026-08-11, Lead-direct): strict temporary-desktop
  extraction accepted retained attempt-23 evidence, recovered the same ID from
  a pre-augmentation manifest, and rejected nine malformed vectors. The one
  live journey reached `run()` and exact five-action ownership, but required
  same-PID startup journal capture was empty; it fail-fast stopped before Client
  A/B/C. The singleton-occupant fallback remains unaccepted. Supervisor and
  10-second heartbeat coverage held through cleanup (57 beats). Switching to the
  temporary desktop created one exact default tiling group before any client; it
  was deleted by recorded desktop/output IDs. Final postflight byte-matched the
  `cc624ba8...`/`e88f8e...` baseline with four desktops, 14 groups, Krohnkite
  unloaded, no project actions, and no supervisor/heartbeat residue. No commit.
- `unit-05/attempt-24` (2026-08-11, Lead-direct) is failed-clean before bundle
  load. The strict fresh-desktop procedure recorded only
  `8578c505-7e26-4c72-8390-a145f6ac9fd0`, but its verified switch produced no
  manifestable exact `[Tiling]` group. The supervisor restored the original
  desktop and removal left no group. The initial command runner timed out and
  terminated the independent writer before foreground execution, so this is a
  safety stop. No script/action/client/A/B/C/fallback/journal evidence exists.
  Final state byte-matches the four-desktop, 14-group hashes `cc624ba8...` and
  `e88f8e...`; Krohnkite and the project plugin are unloaded and project actions
  are absent. `unit-03` and `unit-05` remain unaccepted.
- `unit-05/attempt-25` (2026-08-11, final Lead-direct live attempt) stopped at
  the supervisor readiness gate before any KWin mutation. A detached,
  attempt-owned heartbeat service was independently active and advanced at a
  two-second cadence (11, 168, 195, and 242 observed ticks across prevalidation
  and launch phases). The supervisor transient unit then exited successfully
  without its required ready marker. No temporary desktop, tiling group, plugin,
  action, client, load/run, startup journal, or product diagnostic exists.
  Cleanup stopped only that heartbeat unit and removed only its runtime
  directory. Postflight byte-matched `cc624ba8...`/`e88f8e...`: four desktops,
  14 groups, Krohnkite unloaded, and zero project actions. The singleton
  fallback remains unaccepted. This is the final live attempt; live validation
  is parked while product development continues.
