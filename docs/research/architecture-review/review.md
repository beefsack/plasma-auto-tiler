# Architecture Review: plasma-auto-tiler

Date: 2026-09-23. Status: review only; no decision is selected by this
document.

The split into a Rust planner, a KWin script and a native effect is sound. The
problem is where the logic sits: much of the portable policy is in the KWin
TypeScript layer, and the Rust core has no layout-policy abstraction and
doesn't compile off Linux. There is also a lot of dead code, plus complexity
driven by the protocol and threat model.

Method: static reading of the code, sampling the large files rather than
reading all ~200k lines. No tests or live KWin checks were run. One claim was
checked by building: which TypeScript modules end up in the shipped bundle
(esbuild metafile).

## 1. Verdict per question

| Question | Verdict | Main issue |
|---|---|---|
| Sensible breakdown | Partial | Runtime split is good. The "thin adapter" is ~13k lines of shipped TypeScript. There are 4 D-Bus services and 2 separate Rust builds. |
| As much as possible in core, no KDE in core | Partial | No KDE leakage into core (good). A lot of portable policy still lives in TypeScript. |
| Over-engineering | Yes, significant | ~24k lines of dead code, two transaction models, an 8k-line `Session`, hand-written JSON parsers, a heavy same-UID threat model. |
| KDE APIs appropriate and reliable | Mostly yes | The drag oracle's cancel logic duplicates what the script can compute; only its geometry source may justify it (see 7.1). The initial-maximize handshake could be a direct read. Tiling settings depend on the native effect's settings module (KCM). |
| Core ready for Windows/macOS | No | The crate is Linux-bound. Orchestration is fused with JSON. Logical workspaces and size hints are not in core. |
| Abstraction for Hyprland/bspwm | No | The decision exists (`docs/decisions.md:738-752`) but there is no seam in code. `session.rs` calls `cosmic_v1::` 58 times, and core has zero traits. |

## 2. Current runtime map

| Component | Language | Prod size | Role | IPC |
|---|---|---|---|---|
| Planner (`plasma-auto-tiler planner-service`) | Rust | ~25k prod lines (all `src/`) | Tiling authority | D-Bus `org.plasmaautotiler.Planner` (JSON in a string) |
| KWin script (`kwin/src/entry.ts` bundle) | TS | ~20k (bundled modules) | Observe, actuate, shortcuts, workspaces | `callDBus` to Planner, ActiveBorder, DragOracle, Tray |
| Native effect and KCM | C++ plus bare-`rustc` Rust staticlibs | ~7k C++, ~2.5k Rust | Border, group outline, drag oracle, initial maximize, shortcut override | D-Bus `ActiveBorder`, `DragOracle` |
| Tray | Rust (same crate) | ~5.8k | Status icon, launches Settings | D-Bus `org.plasmaautotiler.Tray` |
| Tooling | sh/just | 14.5k | Dev loop, dogfood install, live tests | - |

## 3. What is good (keep)

- **Pure core modules:** `directional.rs`, `geometry.rs` and `active_group.rs`
  have no platform imports and use deterministic integer geometry. `Rect` is
  i32 with fail-closed projection.
- **Out-of-process planner:** a planner crash cannot take down KWin, and the
  script stays independent of the KWin binary interface (ABI).
- **Direct geometry writes from a KWin script:** the same proven approach as
  Krohnkite and Polonium. Rejecting a KWin fork and not using Custom Tiles as a
  second authority is correct.
- **Border rendering:** parenting `OutlinedBorderItem` under `windowItem()`
  gives correct z-order without a custom scene.
- **Capability-gated plans:** a missing native capability fails closed. That
  is the right shape for multiple hosts.
- **Tests and observability:** coverage is strong and the logging discipline is
  consistent.

## 4. Findings

### 4.1 Breakdown and build structure

- **The single crate mixes core and Linux-only services.** `src/lib.rs`
  exports `planner_service` (zbus), `tray` (StatusNotifierItem),
  `tray_endpoint` and `tray_lifecycle`. The last two use `std::os::unix`,
  `rustix` pidfd and `/proc`. The core cannot build for Windows or macOS as-is.
- **Four dependencies look unused.** `wayland-client`, `wayland-protocols`,
  `memmap2` and `sha2` in `Cargo.toml` have no references in `src/` or
  `tests/`.
- **The effect's Rust is a second, separate Rust build.**
  `kwin/native-effect/CMakeLists.txt:37-77` compiles `group_highlight.rs` and
  `drag_oracle.rs` with bare `rustc`, so they cannot use serde or the core
  crate.
  - As a result, `group_highlight.rs` (2.2k lines) contains a hand-written JSON
    parser.
  - It re-implements the ID alphabets and bounds from `ids.rs` and the script
    bridge.
- **Script-to-effect traffic goes over the session bus as JSON**, even though
  both run in the same KWin process. That is unavoidable for a script, but the
  payload format is the part you choose (see 4.4).

### 4.2 Portable logic currently in TypeScript (should move to core)

Every item below would have to be rewritten for Windows, macOS or GNOME if it
stays in TS.

| Logic | Location | Why it belongs in core |
|---|---|---|
| Membership diffing (admit/remove derived from a per-domain baseline) | `plan-adapter.ts` (~l.3005), `decisions.md:455` | Rust already receives the complete observation on every request. It can diff that itself with a single `sync` op. |
| Logical workspace model: `workspaceMode`, trailing empty desktop, disconnect displacement and destination, reconnect return | `workspace-native.ts:219-680`, `chooseDisplacedDestination` l.301 | The cross-platform research proposes a managed logical-workspace layer for Windows/macOS. It must be shared. |
| Reconcile and park policy (`MAX_RECONCILE_ATTEMPTS=3`), 120ms debounce | `plan-adapter.ts` constants | Policy, not native behavior |
| Shortcut action catalog and profiles (`cosmic`/`hyprland`/`bspwm`) | `plan-adapter-entry.ts:420-435`, `workspace-native.ts:60` | Profiles are meant to pair a behavior with its chords (`decisions.md:744`) |
| Window size hints (`PlanWindowConstraints` min/max/resizeable) | `plan-adapter.ts:99`; absent from `ObservedDto` (`planner_protocol.rs:263`) | The projector ignores client minimum sizes, which feeds the drift -> reassert -> park loop. Windows/macOS apps clamp sizes often. |
| Fingerprint hash | `plan-adapter.ts:667` and `planner_protocol.rs:124` | Duplicated algorithm |
| Wire validation | `plan-adapter.ts:784-1351`, `planner_protocol.rs:803`, `group_highlight.rs`, `drag-oracle-pull.ts` | The same schema is validated in 3 languages with no shared source |
| Settings schema | `kwin/contents/config/main.xml`, edited by the effect KCM | No portable settings model. The research doc (`cross-platform-support/feasibility.md`) already recommends a shared schema. |
| Window eligibility / rules | `normalWindow` checks spread through `plan-adapter-entry.ts` | The vision says "fully configurable". Window rules (float by class, etc.) are core policy with host-provided attributes. |

What is correctly native: signal wiring, native IDs, geometry and desktop
writes, KGlobalAccel registration, effect rendering and the KCM.

### 4.3 Over-engineering and maintenance risk

1. **Dead code (~24k lines including tests).**
   - Rust: `focus_service.rs`, `movement_service.rs` and `resize_service.rs`
     (~6k lines) are only reached from tests. `planner_service.rs:174-199`
     returns "planner trio runtime was removed".
   - Their tests: `tests/{focus,movement,resize,pointer_resize}_service.rs` and
     `tests/resize_capability_split.rs` (~4.4k lines).
   - TypeScript: the focus, movement, resize and pointer-resize adapters plus
     `-entry` files and `provenance-entry.ts` (12.2k lines) are not in the
     shipped bundle, verified with the esbuild metafile. Their tests are also
     dead.
   - `evaluate_plan_json` (`planner_protocol.rs:5820`) is a stateless evaluator
     parallel to `Planner`, used only by that file's own tests.
2. **Two transaction models.**
   - Ordinary ops are proposed and then committed immediately in
     `run_retained` (`planner_protocol.rs:2887-3012`). The Reconciler's
     acknowledge/verify cycle is simulated in-process.
   - Only workspace-send and cross-output (R4) moves use the real
     acknowledge/verify/status/cancel protocol
     (`planner_protocol.rs:2547-2592`).
   - So `reconcile.rs` (1.8k prod lines) and `contract.rs` (1.3k) are mostly
     ceremony.
   - The strict path is where the backlog bugs cluster: stale revision and
     blocked admission after a send (`docs/backlog.md`).
3. **`Session` does too much.** It is 8.1k production lines. It owns the
   lifecycle, move, focus, cross-output focus, keyboard and pointer resize, the
   whole drag lifecycle, floating, exceptions, relocation, and paired canonical
   sessions (`session.rs:951`, `:1151`).
4. **Per-domain sessions plus transient pairs.** `Planner` stores one `Session`
   per domain (`planner_protocol.rs:2480`) and builds temporary two-domain
   sessions for cross-domain ops, then splits them back. `Session` already
   models multiple domains, so one world-level state would remove the
   pair/split machinery.
5. **Stringly-typed protocol.** Ops are dispatched by string match, and each
   handler re-parses `serde_json::Value` (`planner_protocol.rs:2555-2591`,
   `3014-3060`). A `#[serde(tag = "op")] enum Command` would remove most of the
   hand validation.
6. **Threat model drives complexity.** Defending against a hostile process
   running as the same user adds owner pinning, a KWin executable path
   allowlist (`tray_endpoint.rs:664-671`), and pidfd/inode/content binding in
   `tray_lifecycle.rs` (4.2k prod lines for a status icon). A same-UID attacker
   already controls the session.
   - The allowlist is also brittle: it fails on any KWin path not in the list,
     such as distros with different layouts or Home Manager on a non-NixOS
     host.
7. **Shortcut override tool is heavy.** `shortcutreconciler.cpp` (3.7k lines
   plus 5k lines of tests), with journal migration and force-apply, handles 5
   compiled rows.
8. **Process and documentation weight.**
   - 14.5k lines of shell/just tooling and 117 change docs.
   - `decisions.md` mixes decisions with evidence status and is out of date.
     `:212` says `engineAuthorityMode=legacy` is the only tiling mode, but
     `entry.ts` ships the DescribePlan adapter as the sole route and `main.xml`
     has no such key.
   - Code comments carry process history ("Stage 4", "Slice 2", "Group E
     cleanup", "POC1 R1-R4"), which makes the code harder to read cold.
9. **Hard caps.** `MAX_OBSERVED_WINDOWS=64` and `MAX_DOMAINS=16`
   (`session.rs:99-101`) fail closed. How a heavy user with more than 64
   windows is affected was not verified.

### 4.4 KDE/KWin API choices

| Area | Assessment |
|---|---|
| KWin script + `frameGeometry` writes + `registerShortcut` + public desktop/`sendClientToScreen` APIs | Appropriate. It survives KWin updates and can be distributed via the KDE Store. |
| Session-bus activation of the Planner with a systemd user unit | Appropriate. `Restart=no` plus the bounded fresh-session recovery is reasonable. |
| Planner single-flight rejects with "busy" instead of queueing (`planner_service.rs`, `describe_plan`) | Works only because the adapter serializes calls. That coupling is implicit, so document it or queue with a bound. |
| **Drag oracle** | **Cancel logic is duplicated; geometry source may not be.** `build_verdict` (`drag_oracle.rs:16-20`) sets `cancelled` exactly when start == end, which the script can compute: it already captures the start rect on `interactiveMoveResizeStarted` (`plan-adapter-entry.ts:3724`, `oracleStarts`). The one thing the script cannot do is read `Window::moveResizeGeometry()` (the effect does, `activewindowborder.cpp:126`); scripts only see `frameGeometry`, which on Wayland may lag the final configure. Whether that lag matters is unmeasured. See 7.1. |
| **Initial-maximize handshake** (epochs, `SetInitialMaximizeState`, `active-border-initial.ts` 511 lines) | The effect already calls `EffectWindow::window()` and uses `KWin::Window` (`activewindowborder.cpp:12,126`), and includes internal scene headers. `Window::maximizeMode()` (`window.h:1101`) gives the initial state directly, so the "no public initial getter" constraint in `decisions.md:30-34` does not hold for this effect. See 7.2. |
| Script-to-effect payloads as JSON strings | Keep JSON but parse it with Qt's `QJsonDocument` in C++, which is already linked. That removes the hand-written Rust parser. See 7.3. |
| Tiling settings live in the native effect's KCM (`decisions.md:82`) | A script-only install has no settings UI. `kwin/contents/ui/config.ui` already has the four tiling settings, but `kwin/metadata.json` has no `X-KDE-ConfigModule`, so it is likely unreachable. See 7.4. |

### 4.5 Windows/macOS readiness

The domain model is right: opaque IDs, integer rects, domains keyed by
`(output, workspace)`, and capability gating. The gaps:

1. **The Linux-bound crate** (see 4.1).
2. **Orchestration is fused with the wire format.** Retained sessions,
   seeding, near-layout fitting, hotplug relocation and pending transactions
   all sit in `planner_protocol.rs`, keyed off
   `Validated { raw: serde_json::Value, .. }`. A Windows (`windows-rs`) or macOS
   (AX/`objc2`) adapter would embed the core in-process and needs a typed API,
   not JSON over D-Bus.
3. **Request/response snapshots vs. event streams.** The adapter sends a full
   snapshot per command. WinEvent and AXObserver are event streams. An
   event-driven `Engine` fits both, and KWin can still send snapshots as
   events.
4. **Logical workspaces live in TypeScript.** This is the most important
   host-shared piece for Windows/macOS (see 4.2).
5. **Size hints and refusal.** Apps on both hosts clamp or refuse sizes. The
   core must model min/max size and accept clamped rects rather than
   repeatedly reasserting.
6. **Unit contract undocumented.** KWin uses fractional logical coordinates,
   Windows uses physical pixels with per-monitor DPI and DWM extended frame
   bounds, and macOS uses points. Document that core units are
   adapter-normalized integers, and keep frame insets in adapters.

### 4.6 Support for other tiling systems

- There is no policy seam. COSMIC semantics are called directly from `Session`
  (58 `cosmic_v1::` call sites), and `shortcutProfile` only swaps chords in
  TypeScript.
- The ordered N-ary split tree with shares covers bspwm (binary, ratio ->
  shares) and Hyprland dwindle. Hyprland master can be a fixed-shape tree
  maintained by the policy.
- PaperWM or niri scrolling layouts cannot be expressed. `geometry::project`
  subdivides the bounds, while a scrolling strip is wider than the viewport.
  The abstraction needs to sit at the layout level, not only at insert/remove
  hooks.

## 5. Recommendations (prioritized)

### P0: reduce surface and unblock portability

1. **Delete dead code:**
   - the three Rust services and their tests;
   - the four TypeScript adapter/entry pairs, `provenance-entry.ts` and their
     tests;
   - `evaluate_plan_json` if nothing needs it;
   - the four unused dependencies.
2. **Split into a Cargo workspace:**

   | Crate | Contents |
   |---|---|
   | `tiler-core` | directional, geometry, session/engine, policies, workspaces, settings schema; std + serde only |
   | `tiler-protocol` | serde codec: typed `Command`/`Reply` enums with `#[serde(tag = "op")]` |
   | `tiler-linux` | zbus planner service, SNI tray (bin) |
   | `tiler-kwin-effect-ffi` | staticlib built by Cargo through Corrosion from CMake; reuses core types and serde, replacing the hand-written parser |

3. **Extract a typed `Engine` from `planner_protocol.rs`:**
   `Engine::handle(Event) -> Vec<Action>` with world-level state across all
   domains, so the per-domain map and paired sessions go away. JSON then
   becomes a thin codec.

### P1: move policy into core and simplify

4. **Move portable policy from TypeScript into core:** membership diffing
   (replace admit/remove with one `sync`), the logical workspace model and
   hotplug policy, reconcile/park thresholds, the shortcut action catalog and
   profiles, size hints, window rules and eligibility, and the settings
   schema.
5. **Unify on one transaction model.** Rust holds the desired state, the
   adapter applies it best-effort, and observation plus reconcile converges,
   including for send and R4. Keep the explicit acknowledge/verify/cancel only
   where a user-visible guarantee needs it, and state that guarantee in the
   code.
6. **Measure, then likely remove the drag oracle** (7.1).
7. **Replace the initial-maximize handshake** with an in-effect
   `window()->maximizeMode()` read (7.2).
8. **Parse effect payloads with `QJsonDocument`** and drop the hand-written
   Rust parser (7.3).
9. **Introduce the policy seam and split `Session`:**
   - `trait LayoutPolicy` for insert, remove, move(dir), resize, drop zones and
     focus rules, plus a layout projector per family (split tree now,
     scrolling strip later).
   - The engine keeps domains, windows, focus history (MRU), exceptions
     (floating/sticky/fullscreen/maximized) and workspaces.
   - Move `cosmic_v1` behind the trait first, then implement **bspwm second**.
     It is the cheapest (same tree, binary longest-side) and validates the
     seam before Hyprland.
   - Split `Session` along the same seam.

### P2: right-size

10. **Right-size the threat model to "same-UID is trusted".** Drop the KWin
    executable allowlist and reduce tray lifecycle to an XDG autostart entry
    or systemd user unit.
11. **Simplify the shortcut override journal** to record preimage, apply and
    revert.
12. **Make tiling settings independent of the native effect** by wiring the
    script's existing `config.ui` (7.4).
13. **Clean up documentation:**
    - trim `decisions.md` to current decisions only and move evidence into
      change docs;
    - fix the stale `engineAuthorityMode` entry;
    - remove process history from code comments.
14. **Revisit the 64-window and 16-domain caps.** Size them from real usage, or
    degrade gracefully instead of failing closed.

## 6. Target shape

```
tiler-core            Engine (world state, domains, workspaces, focus MRU, exceptions, rules, settings)
  |- LayoutPolicy     cosmic_v1 | bspwm | hyprland_dwindle | (scrolling later)
  |- Projector        split-tree | strip
tiler-protocol        serde Command/Event/Action enums (JSON codec)
tiler-linux           D-Bus planner service, SNI tray
kwin/ (TS)            event pump + actuator only: observe -> Event, Action -> native write
kwin/native-effect    render border/group outline; Rust via cargo staticlib
future: tiler-windows / tiler-macos adapters link tiler-core in-process
```

## 7. Concrete proposals

These are proposals only. Items marked **decision needed** reverse or change a
recorded entry in `docs/decisions.md`. Code blocks are sketches, not tested
code.

Not fleshed out here:

- **Shortcut override simplification (rec 11):** needs a focused read of
  `shortcutreconciler.cpp` first.
- **Dead code deletion and documentation cleanup (recs 1, 13):** already
  concrete in section 5.

### 7.1 Drag oracle: measure, then remove or shrink

Facts:

- The oracle's `cancelled` flag is `start == end` (`drag_oracle.rs:16-20`).
- The script already captures the start rect on `interactiveMoveResizeStarted`
  (`plan-adapter-entry.ts:3724`, `oracleStarts`).
- The effect reads `Window::moveResizeGeometry()` (`activewindowborder.cpp:126`),
  which is not a script property. Scripts only have `frameGeometry`
  (`window.h:479`), which follows client commits and can lag on Wayland.

Proposal:

1. **Measure.** In trace mode, at `interactiveMoveResizeFinished` the script
   logs:
   - `frameGeometry` at finish;
   - `frameGeometry` at the first later `frameGeometryChanged` for that window;
   - the oracle verdict it already pulls.

   Do ~20 edge drags on Wayland, including a terminal with size increments.
   Increments matter: the committed frame may legitimately differ from the
   requested one.
2. **If script geometry matches (at finish or at the first later change):**
   remove the oracle. Delete:
   - `drag_oracle.rs` and `drag_oracle_ffi.h`;
   - the `DragOracle` D-Bus object and its CMake and test targets;
   - `drag-oracle-pull.ts` and its tests.

   Then route the verdict from the entry's existing start capture through the
   existing `deriveOracleEdge`.
3. **If it lags:** derive the boundary from the pointer instead.
   - At start, record `grab = cursorPos - edgeAt(startRect)` for the edge being
     dragged.
   - At finish, `boundary = cursorPos - grab` on that edge, where the edge comes
     from `deriveOracleEdge` over the frame rects.
   - `workspace.cursorPos` is available to scripts
     (`docs/research/custom-tile/adapter-design.md:40`).
4. **Keep the oracle only if both fail.** Then fold it into the existing
   `ActiveBorder` D-Bus object instead of a separate service, and key the last
   verdict by window, not by a single global `LAST_JSON`.

### 7.2 Initial maximize: read it in the effect (decision needed)

The effect already dereferences `KWin::Window`, so seed state when subscribing:

```cpp
void ActiveWindowBorderEffect::subscribeMaximize(EffectWindow *window)
{
    // ... existing guard and connects ...
    if (Window *inner = window->window()) {
        updateMaximizedState(window, inner->maximizeMode() != MaximizeRestore);
    }
}
```

`subscribeMaximize` already runs for every window in `stackingOrder()` at load
and on `windowAdded` (`activewindowborder.cpp:251-258`).

This deletes:

- `SetInitialMaximizeState`, `ClearInitialMaximizeState` and
  `GetInitialMaximizeEpoch`;
- the `initial_maximize_*` half of `group_highlight.rs`;
- `active-border-initial.ts` and its tests;
- the `initialOk` gate in `activeBorderDiagReason`.

Decision: this replaces the "hide-until-confirmed" handoff recorded in
`decisions.md:30-53`.

### 7.3 Effect payload parsing with Qt, and no Rust in the effect

After 7.1 and 7.2, the effect's remaining Rust is the group-highlight payload
parser, stream ordering, and `should_show`.

- **Parse with `QJsonDocument`:** Qt is already linked.

  ```cpp
  std::optional<GroupPayload> parseGroupPayload(const QString &text)
  {
      if (text.size() > 4096) return std::nullopt;
      QJsonParseError err;
      const QJsonDocument doc = QJsonDocument::fromJson(text.toUtf8(), &err);
      if (err.error != QJsonParseError::NoError || !doc.isObject()) return std::nullopt;
      const QJsonObject o = doc.object();
      static const QStringList keys{u"v"_s, u"correlation_id"_s, u"owner"_s, u"generation"_s,
                                    u"revision"_s, u"group"_s, u"focused_window"_s, u"bounds"_s};
      if (o.size() != keys.size()) return std::nullopt;
      for (const auto &k : keys) if (!o.contains(k)) return std::nullopt;
      // ... typed field reads and range checks ...
  }
  ```

  Difference from today: `QJsonDocument` does not reject duplicate keys (last
  one wins). The sender is the project's own script, so that is acceptable.
- **Move ordering and `should_show` to C++** (~100 lines of logic). This
  removes the bare-`rustc` build path from `CMakeLists.txt` and from the Nix
  native-effect derivation.
- **Alternative, if more policy is expected in the effect later:** a
  Cargo-built `staticlib` crate in the workspace (7.5), built through
  Corrosion.
- **Decision needed:** `decisions.md:844-852` says Rust owns the group
  visibility policy.

### 7.4 Script-only settings

- `kwin/contents/ui/config.ui` already binds `workspaceMode`,
  `shortcutProfile`, `innerGap` and `outerGap`. `kwin/metadata.json` has no
  config module entry. Add:

  ```json
  "X-KDE-ConfigModule": "kwin/effects/configs/kcm_kwin4_genericscripted"
  ```

- Also replace the stale `Description` ("Guarded Custom Tile automation").
- Verify on the host that the KWin Scripts page then shows Configure. Whether
  saving there triggers the existing gap resync path is unknown.
- The effect KCM keeps border and shortcut settings. Both already use
  `kwinrc` group `Script-plasma-auto-tiler-kwin`
  (`activeborderconfig_module.cpp:749`), so there is no duplicate storage.

### 7.5 Cargo workspace layout

```
Cargo.toml                    [workspace] members = ["crates/*"]
crates/tiler-core/            no dependencies (serde behind an optional "serde" feature)
  src/directional.rs, directional/tests.rs, geometry.rs, active_group.rs, ids.rs
  src/policy/cosmic_v1.rs     (from src/cosmic_v1.rs)
  src/engine/...              (from session.rs + Planner internals, see 7.6/7.9)
crates/tiler-protocol/        serde, serde_json, tiler-core
  src/lib.rs                  (DTOs + codec from planner_protocol.rs)
crates/plasma-auto-tiler/     bin; zbus, rustix, async-lock, tiler-protocol
  src/main.rs, planner_service.rs, tray.rs, tray_endpoint.rs, tray_lifecycle.rs
```

- **Tests:** move with the crate they exercise. `session_*`,
  `reconcile_*` and `planner_directional` go to core/protocol; `tray_*` go to
  the bin crate.
- **Dependencies:** drop `wayland-client`, `wayland-protocols`, `memmap2` and
  `sha2`.
- **Portability gate:** add `cargo check -p tiler-core --target
  x86_64-pc-windows-msvc` and `--target aarch64-apple-darwin`. The targets
  must be added to the Rust toolchain in `devenv.nix`, which requires a
  session restart. This makes Linux-only leakage into core a build failure
  instead of a review finding.
- **Nix:** `packages.tray` builds `-p plasma-auto-tiler`. After 7.3 the
  effect derivation needs no Rust.

### 7.6 Typed `Engine` API and protocol

The core API sketch:

```rust
// tiler-core
pub struct Engine { world: World, policy: Box<dyn LayoutPolicy>, settings: Settings }

pub enum Event {
    Observed(Observation),                       // complete host state for the scopes it covers
    Command(Command),                            // user intent
    InteractiveResizeFinished { window: WindowId, start: Rect, end: Rect },
}

pub struct Observation {
    pub now_ms: u64,                             // host clock; core has none
    pub outputs: Vec<ObservedOutput>,            // opaque id, work area, visible workspace, adjacency
    pub workspaces: Vec<ObservedWorkspace>,      // opaque native ids in native order
    pub windows: Vec<ObservedWindow>,            // id, output, workspace(s), rect, flags, size hints, first_seen_seq
    pub focused: Option<WindowId>,
}

pub enum Command {
    Focus(Direction), Move(Direction), Resize { dir: Direction, mode: ResizeMode },
    ToggleFloat, ToggleSticky, ToggleFullscreen, ToggleMaximize,
    SelectWorkspace(u8), SendToWorkspace(u8), SelectEmpty, SendToEmpty,
}

pub enum Action {
    SetGeometry { window: WindowId, rect: Rect },
    SetWorkspace { window: WindowId, workspace: NativeWorkspaceId },
    SetOutput { window: WindowId, output: OutputId },
    SetFloating { window: WindowId, on: bool }, SetSticky { window: WindowId, on: bool },
    SetMaximized { window: WindowId, on: bool }, SetFullscreen { window: WindowId, on: bool },
    Focus { window: WindowId },
    ShowWorkspace { output: OutputId, workspace: NativeWorkspaceId },
    CreateWorkspace { output: Option<OutputId> }, RemoveWorkspace { workspace: NativeWorkspaceId },
    Highlight(Option<GroupHighlight>),
}

pub struct Plan { pub revision: u64, pub actions: Vec<Action>, pub diag: Vec<Diag> }

impl Engine {
    pub fn handle(&mut self, event: Event) -> Plan;
}
```

- **Wire format:** `tiler-protocol` wraps this as `{v, owner, generation,
  correlation_id, event}`, with `#[serde(tag = "op", rename_all =
  "kebab-case")]` on `Command`, `Event` and `Action`. `DescribePlan` stays the
  one D-Bus method.
- **Session identity:** owner and generation stay in the envelope only.
- **Migration path:**
  - `Planner`'s per-domain map, seeding, near-layout fit and relocation become
    `Engine` internals over one `World`.
  - The body of `run_retained` becomes the `Observed`/`Command` path.
  - Windows and macOS adapters call `Engine::handle` in-process with no JSON.

### 7.7 One `sync` instead of adapter-derived admit/remove

Today the adapter diffs a per-domain baseline and dispatches one `admit` or
`remove` per round trip (`plan-adapter.ts:2984-3110`). N new windows means N
sequential full-snapshot requests.

The engine does it on `Event::Observed`, in this order:

1. **Removals first**, so collapse happens before placement.
2. **Admissions** in `first_seen_seq` order. Each new window becomes the
   focused leaf for the next, which matches new windows taking focus.
3. **Domain changes** (a window observed outside its modelled domain):
   remove + admit, unless an expectation covers it (7.8).
4. **Flag transitions** (float, fullscreen, maximize, sticky): exception
   handling, now in core.
5. **Rect drift** on tiled windows: the reconcile policy, including
   clamp-acceptance (7.11), now in core.

Result: one round trip and one `Plan` covering every affected domain.

This removes from TS:

- the baseline maps and the admit/remove derivation;
- `hiddenIntentFor` (`plan-adapter.ts:3423`);
- the reconcile attempt counters and `MAX_RECONCILE_ATTEMPTS`.

### 7.8 One transaction model: expectations (decision needed)

The rule: **the host is authoritative for facts** (which windows exist, where
they are, flags). **The engine is authoritative for layout** within those
facts.

How it works:

- A `Command` updates the model immediately and records:

  ```rust
  struct Expectation { window: WindowId, fact: Fact, issued: u64, expires_ms: u64 }
  enum Fact { InDomain(DomainKey), Rect(Rect), Flag(FlagKind, bool), Focused }
  ```

- On `Observed`, a contradicting fact covered by an unexpired expectation is
  held. It is not treated as a user action.
- A met expectation is cleared.
- An expired expectation lets the observed fact win. The engine re-plans from
  reality (for example, a failed send re-admits the window to its source
  domain) and emits `diag: expectation-expired`.
- Workspace send with follow is one `Plan`: `SetWorkspace`, then
  `ShowWorkspace`, then `Focus`, in adapter write order.

What it replaces:

- echo fences;
- the send and R4 `-ack/-verify/-status/-cancel` ops;
- `WorkspacePending` and `DirectionalMovePending`;
- paired canonical sessions;
- `reconcile.rs`'s pending state machine;
- the reassert-3-then-park loop.

Trade-off: this gives up "never report success until verified" in favour of
"converge to observed truth". That reverses `decisions.md:473-503` and
`:605-613`.

Suggested first step: prototype on workspace send only, where the backlog bugs
cluster, behind the existing route.

### 7.9 `LayoutPolicy` seam and `Session` split

```rust
pub trait LayoutPolicy: Send {
    fn id(&self) -> &'static str;                                   // "cosmic_v1", "bspwm_v1"
    fn insert(&self, tree: Option<Node>, at: &InsertAt, new: NodeId, ids: &mut IdGen) -> Node;
    fn remove(&self, tree: Node, leaf: &NodeId) -> Option<Node>;
    fn move_dir(&self, snap: &Snapshot, intent: &MoveIntent, caps: &Capabilities) -> MoveOutcome;
    fn resize_step(&self, ctx: &ResizeCtx, dir: Direction, mode: ResizeMode, press: u32) -> Result<Node, Refusal>;
    fn resize_to(&self, ctx: &ResizeCtx, dir: Direction, boundary: i32) -> Result<Node, Refusal>;
    fn drop_target(&self, ctx: &DropCtx, x: i32, y: i32) -> Option<DropTarget>;
    fn normalize(&self, tree: Node) -> Node { tree }                // for shape-keeping layouts (master)
}
pub struct InsertAt { pub focused: Option<NodeId>, pub target_rect: Rect }
```

How the existing `cosmic_v1` symbols map onto it (call counts from
`session.rs`):

| Trait method | Existing symbols |
|---|---|
| `insert` | `admission_axis[_for_rect]`, `new_group_shares` (20 call sites), `proportional_insertion_shares` |
| `remove` | `proportional_removal_shares`, recursive collapse |
| `move_dir` | `plan_move_with_capabilities` (R1-R4) |
| `resize_step` / `resize_to` | `keyboard_step_px`, `pair_admits_resize`, `clamp_pair_split`, `clamp_keyboard_shrink_pair`, `child_min_for_axis`, `pair_min_for_axis` |
| `drop_target` | `classify_group_point`, `classify_window_point`, `insertion_index_for_offset`, `PriorGroupEdge` |

**bspwm_v1 as the second policy**, to validate the seam:

- `insert`: split the focused leaf on its longest side (the same rule as
  `admission_axis`) with shares `[1, 1]`.
- `remove`: binary collapse.
- `move_dir`: swap with the directional neighbour (`bspc node -s`), with no
  R2/R3 regrouping.
- `resize_step`: move the nearest fence by a step.
- `drop_target`: `None` (bspwm has no drag reflow).

**Hyprland:**

- Dwindle fits `insert`/`remove`.
- Master fits via `normalize`.

**Scrolling layouts (PaperWM/niri)** need a second seam later, which is not
selected now:

```rust
trait Projector { fn project(&self, state: &LayoutState, viewport: Rect) -> Vec<(NodeId, Rect)>; }
```

**`Session` split along the same seam:**

- `engine/world.rs`: domains, windows, focus history (MRU), exceptions.
- `engine/ops/{lifecycle,move,focus,resize,drag,float,workspace}.rs`: each
  calls `policy`.
- `engine/fit.rs`: near-layout fitting.
- `engine/expect.rs`: 7.8.

### 7.10 Logical workspace model in core

The TS functions are already pure, so they port directly:

- `orderedDesktopEntries`;
- `ensureTrailingEmptyDesktop`: return actions instead of calling
  `removeDesktop`/`createDesktop` callbacks;
- `chooseDisplacedDestination`;
- `resolveMoveTarget` / `resolveOrAppendMoveTarget`;
- the three `workspaceMode` mappings.

Core state:

```rust
pub struct WorkspaceMap {
    mode: WorkspaceMode,                                        // PerOutputLocal | GlobalUnique | Shared
    logical: BTreeMap<OutputKey, Vec<NativeWorkspaceId>>,
    displaced: BTreeMap<OutputKey, Displaced>,                  // workspaces + destination
}
pub enum WorkspaceCapability { Native { create: bool, per_output_current: bool }, Managed }
```

- **Native hosts** (KWin): the map emits
  `CreateWorkspace`/`RemoveWorkspace`/`ShowWorkspace`/`SetWorkspace`.
- **`Managed` hosts** (the Windows/macOS option in
  `research/cross-platform-support/feasibility.md`): the same map emits
  hide/show or park actions instead.
- **What stays in the adapter:** output identity construction (`outputTuple`:
  manufacturer/model/serial/name) and all native desktop reads and writes.

### 7.11 Size hints

1. **Carry the hints.** Add `min: Option<Size>, max: Option<Size>` to the
   observed window. TS already reads them (`PlanWindowConstraints`,
   `plan-adapter.ts:99`).
2. **Projector:** after proportional allocation on an axis:
   - raise each child below its `min` to `min`, taking the deficit from
     siblings in proportion to their slack above their own `min`;
   - if the minimums exceed the extent, keep proportional allocation and mark
     those windows `overconstrained` (never reasserted);
   - apply `max` symmetrically, giving the surplus to siblings.
3. **Reconcile:** if the observed size equals
   `clamp(desired, min, max)`, or differs only below one size increment,
   accept it as `client-clamped`. It does not count toward reassertion.
4. **Hosts without hints** pass `None`; the clamp-acceptance rule still limits
   fighting.

### 7.12 Tray and threat model (decision needed)

- **Single instance:** request `org.plasmaautotiler.Tray` with `DoNotQueue`
  (the same pattern as the Planner). If the name is taken, exit 0. This
  replaces the lock and PID files, pidfd, and inode/content binding.
- **Delivery:** XDG autostart (Home Manager already writes one) or a user
  unit with `PartOf=graphical-session.target`. Dogfood mode becomes
  `cargo run -- tray`, dropping the
  `tray-install/start/status/stop/remove` subcommands.
- **Snapshot authorization:** accept `PublishSnapshot` only from the current
  `org.kde.KWin` owner's unique name. Drop the executable path allowlist
  (`tray_endpoint.rs:664-671`) and the `/proc` checks.
- **Estimated impact:** most of `tray_lifecycle.rs` (~4.2k prod lines) and
  `scripts/tray-*.test.sh`. This estimate is from module headers and the
  command list, not a full read.

### 7.13 Size caps

- Today there are three overlapping guards: `MAX_OBSERVED_WINDOWS=64` and
  `MAX_DOMAINS=16` (`session.rs:99-101`), `PLAN_MAX_WINDOWS=64` and
  `PLAN_MAX_DOMAINS=16` (TS), and a 64 KiB request cap.
- Keep one guard: a request byte cap in the codec (e.g. 1 MiB). Drop the count
  caps from core and TS.

### 7.14 Suggested order

1. **Small and independent:** dead code, unused dependencies, 7.4, 7.2.
2. **Mechanical:** 7.5.
3. **Measure:** 7.1, then remove or shrink the oracle, then 7.3.
4. **Core API:** 7.6 behind the current wire format, then 7.7.
5. **Policy seam:** 7.9, then bspwm_v1.
6. **Workspaces:** 7.10.
7. **Transaction model:** 7.8, prototyped on workspace send.
8. **Remainder:** 7.11, 7.12, 7.13.
