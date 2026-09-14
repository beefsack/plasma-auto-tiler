# Development Loop

Run from inside the devenv shell (`just` is provided by `devenv.nix`).
These recipes never stop or mask units, never resolve the Planner through
`/nix/store`, and never create a `result` symlink. Preconditions fail closed.

```sh
just dev         # foreground: refuse unless DOWN, dev-on, tail labeled logs, Ctrl-C tears down via dev-off
just dev-on      # disable packaged script, start worktree Planner + KWin bundle
just dev-status  # read-only: name owner, isScriptLoaded, receipt, unit state
just reload      # rebuild and swap only the recorded worktree Planner
just dev-off     # unload exact script, stop recorded Planner, re-enable packaged script
```

- `dev` is a small foreground composition of the existing recipes. It
  probes the same two strict facts as `dev-on` (verified worktree Planner
  owning the D-Bus name, strictly parsed `isScriptLoaded`) and refuses
  without mutating unless both are down. UP and either SPLIT direction
  refuse with a clear error: this session never adopts pre-existing state.
  Use `just dev-status` to inspect, `just dev-off` to teardown pre-existing
  state, `just dev-on` for detached bring-up/recovery, and `just reload`
  for a stale `(deleted)` Planner. A stale owner exe refuses the same way.
  Malformed `isScriptLoaded` fails closed before mutation. On DOWN it runs
  `just dev-on`; on bring-up failure it exits non-zero with no logs tailed
  and no extra teardown (rollback stays owned by `dev-on`). On success it
  arms `just dev-off` for `INT`/`TERM`/`EXIT`, then tails the live Planner
  log from `$STATE_DIR/planner-log` prefixed `[planner]` and the KWin
  journal plugin lines (`journalctl --user -f _PID=<kwin-pid>` from the
   receipt `.pid`, filtered to `plasma-auto-tiler:plan`) prefixed `[kwin]`.
   The labeled stream is also captured at `$STATE_DIR/dev-log`'s path; the
   durable file persists after teardown.
   `Ctrl-C` stops the tails and runs the existing fail-closed receipt-bound
   `dev-off`; a `dev-off` failure exits non-zero loudly. Missing log,
   receipt, KWin pid, `tail`, or `journalctl` fails closed through the same
   teardown trap rather than tailing silently. An unverified controller teardown
   never retries unload; a verified Planner is still stopped before recovery is
   directed through logout/login.
- `dev-on` disables the packaged KWin script, verifies `isScriptLoaded`
  `false`, requires `org.plasmaautotiler.Planner` to be unowned (it does not
  stop units for you), builds, launches exactly
  `target/debug/plasma-auto-tiler planner-service` detached with
  `setsid nohup ... </dev/null &`, then proves identity from D-Bus rather
  than `$!`. `$!` is a launch hint only and never authoritative (setsid may
  fork when it is a process-group leader). After a bounded wait the owner
  PID is derived from `GetNameOwner` plus `GetConnectionUnixProcessID` and
  accepted only when `/proc/<pid>/exe` is the worktree `$BIN` or its exact
  kernel-generated `$BIN (deleted)` form, normalizes outside `/nix/store`,
  cmdline contains `planner-service`, and the
  `/proc/<pid>/stat` start identity is captured. That verified PID/exe/start
  is recorded. On failure only an already positively verified worktree
  planner is terminated, never an unverified PID or intermediate bash.
  `dev-on` then runs `scripts/start-test.sh start` with a dynamically
  derived `CONTROLLER_OWNERSHIP_FILE` under `$XDG_RUNTIME_DIR` and prints the
  verified Planner PID plus the script ID read from the controller receipt.
  Every failure after the packaged script was disabled runs fail-closed
  transactional rollback: terminate only the positively verified worktree
  planner (re-verified first), unload the KWin script only if this run
  successfully loaded it, re-enable the packaged script, remove only its own
  created receipt dir, and remove its state pointers/dir. Rollback never
  unloads a script it did not load and never touches a planner it did not
  positively verify; each failed rollback step prints a precise loud error.
  Success disarms rollback. Health requires both a verified worktree Planner
  and `isScriptLoaded=true`: when both are up, `dev-on` makes no changes; when
  both are down, it performs the normal bring-up; when only the verified
  Planner is up, it loads one controller against that Planner without starting,
  stopping, or reconfiguring either half, writes a fresh immutable receipt, and
  updates the state pointer only after re-verifying the same D-Bus owner and
  start identity; when only the controller is up, it refuses rather than
  loading a duplicate. `start-test.sh` keeps its duplicate plugin guard.
- `reload` rebuilds and safely swaps only the recorded worktree Planner. It
  never reloads or unloads the KWin script and requires the recorded
  PID/exe and current process state. The replacement is launched detached
  with `setsid nohup ... &` where `$!` is a hint only; the new PID is
  derived from the D-Bus owner (`GetNameOwner` plus
  `GetConnectionUnixProcessID`) under the same bounded wait and accepted
  only with the worktree exe or its exact kernel-generated ` (deleted)` form,
  no `/nix/store` after normalization, `planner-service` cmdline, and captured
  start identity. On failure only an already positively
  verified replacement is terminated, never an unverified PID.
- `dev-off` independently checks both halves. A loaded controller still
  requires its exact receipt and `start-test.sh stop`; an already-unloaded
  controller is never stopped with its stale ID. It terminates only a recorded
  worktree Planner that passes the existing identity checks even if controller
  teardown fails, skips an absent or unverified Planner without killing it, and
  re-enables the packaged script only after verified controller teardown.
- `dev-status` is read-only: name owner PID plus `/proc/<pid>/exe`,
  `isScriptLoaded`, recorded script ID, and installed unit state. It also
  reports `dev mode: UP`, `DOWN`, `SPLIT`, or `UNKNOWN`; `UP` requires both a
  verified worktree Planner and loaded controller.

Single engine: the worktree KWin bundle (`kwin/src/entry.ts` via
`startPlanAdapterEntry` with owner `kwin-plan-adapter`, generation `plan-1`)
is the only observer/actuator. Rust owns all tiling, order, membership, and
rejection decisions through the stateless `DescribePlan` D-Bus route
(`org.plasmaautotiler.Planner` / `/org/plasmaautotiler/Planner` /
`org.plasmaautotiler.Planner1`). Only normal windows on the active
output/workspace are observed; reply geometries are applied in shared
canonical grow-before-shrink order. There is no journal readiness wait and
no second runtime: bring-up is proven by the strict `isScriptLoaded`
envelope plus receipt-bound exact `Script<ID>` introspection, and teardown
is receipt-bound exact unload.

## Manual Fallback

This avoids a dotfiles-nix rebuild. It uses the existing explicit `/Scripting`
loader. Tray autostart remains unchanged.

### Loop

```sh
devenv shell --impure -- bash scripts/dogfood-install.sh disable
# Verify KWin unloaded the packaged script before continuing.
busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  isScriptLoaded s plasma-auto-tiler-kwin

# The service must be unowned before starting the worktree Planner.
busctl --user call org.freedesktop.DBus /org/freedesktop/DBus \
  org.freedesktop.DBus GetNameOwner s org.plasmaautotiler.Planner
# Only if the owner is verified as plasma-auto-tiler-planner.service:
# systemctl --user stop plasma-auto-tiler-planner.service
# Then repeat GetNameOwner and require it to fail before proceeding.

devenv shell --impure -- cargo build
PLANNER_OUT="$(mktemp /tmp/plasma-auto-tiler-planner-dev.XXXXXX.log)"
setsid nohup "$PWD/target/debug/plasma-auto-tiler" planner-service >"$PLANNER_OUT" 2>&1 </dev/null &
# $! is a launch hint only, never authoritative (setsid may fork). Derive the
# owner PID from D-Bus and verify it before trusting it.
busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s org.plasmaautotiler.Planner
busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "<owner-name-from-above>"
readlink "/proc/<owner-pid>/exe"
tr '\0' ' ' < "/proc/<owner-pid>/cmdline"
busctl --user --no-pager status org.plasmaautotiler.Planner
devenv shell --impure -- bash scripts/start-test.sh start
# Retain the printed CONTROLLER_OWNERSHIP_FILE receipt path and script ID.
# Every later stop must bind both: CONTROLLER_OWNERSHIP_FILE=<receipt> bash
# scripts/start-test.sh stop <script-id>.
```

1. Disable packaged KWin script.
2. Verify `isScriptLoaded` is `false`; reconfiguration can settle asynchronously.
3. Require `org.plasmaautotiler.Planner` to be unowned. If it is owned, confirm
   its PID belongs to `plasma-auto-tiler-planner.service`, stop only that unit,
   and recheck. If it is unmanaged or still owns the name, stop and report its
   PID and parent. Do not mask units: the D-Bus descriptor `Exec=` fallback can
   still activate the installed Planner.
4. Build and start only `target/debug/plasma-auto-tiler planner-service` from
   this worktree. Record its output; derive the Planner PID from the D-Bus
   owner (`GetNameOwner` plus `GetConnectionUnixProcessID`), never from `$!`,
   and require `/proc/<pid>/exe` to be that worktree path or its exact
   kernel-generated ` (deleted)` form (never `/nix/store` after normalization),
   cmdline to contain `planner-service`, and the start
   identity to be captured.
5. `start-test.sh start` builds the KWin bundle, loads it once (duplicate
   plugin guard fails closed if already loaded), introspects the exact
   `Script<ID>`, runs it, and proves `isScriptLoaded=true` bound to the
   unchanged KWin PID/start identity. Retain its exact script ID and the
   `CONTROLLER_OWNERSHIP_FILE` receipt; the receipt is immutable and is the
   only teardown handle.

### Verify

- Observe `org.plasmaautotiler.Planner` owned by the verified worktree Planner
  (`GetNameOwner` plus `GetConnectionUnixProcessID`, exe/cmdline/start checks).
- Confirm `isScriptLoaded s plasma-auto-tiler-kwin` decodes to the strict
  `{"type":"b","data":[true]}` envelope.
- Confirm `just dev-status` reports `dev mode: UP`.
- Confirm the single-engine journal shapes below appear under the recorded
   KWin PID (`journalctl --user --no-pager _PID=<kwin-pid>`); loaded state alone never
  proves callbacks.

### Restore

```sh
CONTROLLER_OWNERSHIP_FILE=<receipt-from-start> devenv shell --impure -- bash scripts/start-test.sh stop <returned-script-id>
# Terminate only the recorded worktree Planner PID (re-verify exe/cmdline/start first).
devenv shell --impure -- bash scripts/dogfood-install.sh enable
```

`start-test.sh stop` requires both the nonce-owned receipt and the exact
script ID; a mismatched receipt, a missing receipt, or an already-unloaded
plugin fails closed without touching another script. Stopping/unloading does
not roll back window geometries the single DescribePlan engine already
applied.

## Manual Single-Engine Journey (3-6 Windows)

Preconditions: `just dev-status` reports `dev mode: UP`. Record the KWin PID
from the receipt (`jq -r .pid <receipt>`) and open a journal cursor
(`journalctl --user --show-cursor`). Use 3 Wayland-native normal resizable
clients (for example 3 Konsole windows) on one output/workspace, then grow to
4-6 during the journey. All geometry changes arrive as one complete
`DescribePlan` reply applied in canonical grow-before-shrink order; focus
changes arrive as the reply `desired_focus` applied after the writes.

1. Add (3 -> 4 windows): open a fourth client.
   Expected visible outcome: all four windows retile at once to cover the
   work area with no overlap; the new window is included in the layout.
2. Close (4 -> 3 windows): close one client.
   Expected visible outcome: the three survivors expand at once to cover the
   work area; no stale gap is left behind.
3. Focus change (pointer/activation, no shortcut): click another window or
   Alt-Tab to it.
   Expected visible outcome: focus follows the activated window; geometries
   do not change (membership-driven resync only refreshes the baseline).
4. Directional focus: press `Meta+H` / `Meta+J` / `Meta+K` / `Meta+L` (or
   `Meta+Left/Down/Up/Right`) with 3+ windows tiled.
   Expected visible outcome: focus moves one neighbor in that direction;
   geometries do not change.
5. Directional move: focus one window, press `Meta+Shift+H` / `Meta+Shift+J` /
   `Meta+Shift+K` / `Meta+Shift+L` (or `Meta+Shift+arrows`).
   Expected visible outcome: the focused window swaps order with its neighbor
   in that direction, all geometries are rewritten in canonical order, and
   focus is restored to the moved window.
6. Resize: focus one window, press `Meta+Alt+H/J/K/L` to grow toward that
   direction (outwards mode) or `Meta+Alt+Shift+H/J/K/L` to shrink from that
   direction (inwards mode). The inwards/shrink family also has arrow aliases
   `Meta+Alt+Shift+Left/Down/Up/Right`; the outwards arrow chords
   `Meta+Alt+Left/Down/Up/Right` are the documented project insert-* chords
   and are deliberately not registered. Repeat presses step further
   (`press_index` increments while focus/direction/mode/fingerprint are
   unchanged). Expected visible outcome: the focused edge moves one step,
   neighbors adjust to keep the work area covered, focus stays on the resized
   window. Grow to 5-6 windows and repeat 4-6 to confirm convergence without
   queues or retries.
7. Intentional float, sticky, and maximize are static-only. The controller
   request floats an
   eligible active normal window at a centered 60% work-area rectangle and
   removes it from the planner tree; toggling again is fresh admission. The
   float request carries no rectangle, so the Session selects the durable
   retained placement for a window that has floated before instead of
   recomputing the center; the unfloat request carries the window's live frame
   rect so a user moved/resized float is retained for the next float.
   Fullscreen and maximized targets refuse. `Meta+G` floats, `Meta+Shift+G`
   toggles sticky float, and `Meta+M` toggles maximize. Do not run these as a
   live journey without separate authorization. Grid View owns `Meta+G` and
   Krohnkite Monocle owns `Meta+M` in the observed session, so KGlobalAccel
   serial dispatch shadows the later project registrations until the user
   resolves each conflict in System Settings.

Physical shortcuts are required; `invokeShortcut` bypasses the xkb layer and
cannot prove delivery. KGlobalAccel records persist after unload and do not
prove live callbacks.

## Journal Line Forms

Filter by the recorded KWin PID only: `journalctl --user --no-pager _PID=<kwin-pid>`
(never `journalctl --system`). All emitted production diagnostics carry the
fixed `plasma-auto-tiler:` prefix and are always-on (never verbose-gated).
The complete reference below is bounded per discrete user action or state
change; no line carries a caption or title. Window-bearing lines carry the
stable `resource_class` application identifier as well as the opaque id; it is
not a caption and cannot contain document or page content.

Startup context (exactly one line per successful plan entry start, using the
existing owner/generation provenance plus the compiled-in source revision;
`<source-rev>` is the installed build's bounded git revision, else
`local-dev`):

- `plasma-auto-tiler:plan:ready owner=<owner> generation=<generation> source=<source-rev>`

Per dispatched `DescribePlan` flight (exactly two `cmd=` lines: one route
entry with `outcome=dispatch` and one terminal verdict line):

- `plasma-auto-tiler:plan:cmd=<correlation> kind=<op> windows=<N> outcome=dispatch`
- `plasma-auto-tiler:plan:cmd=<correlation> kind=<op> windows=<N> outcome=<outcome>`

where `<op>` is one of `admit|remove|move|focus|resize|reconcile|pointer-resize|toggle-float`,
`<correlation>` is `<generation>-p<seq>` (production: `plan-1-p<seq>`), `<N>`
is the observed window count, and terminal outcomes are `planned-applied`,
`rejected`, or the local fail-closed values `timer-failed`, `dbus-failed`,
`timeout`, `service-fault`, `correlation-mismatch`, `stale-dropped`,
`precondition-mismatch`, `stale-scope`, `write-failed`. Example pair:

- `plasma-auto-tiler:plan:cmd=plan-1-p3 kind=admit windows=4 outcome=dispatch`
- `plasma-auto-tiler:plan:cmd=plan-1-p3 kind=admit windows=4 outcome=planned-applied`

Per Rust rejection (one `rejected` kind line following the `outcome=rejected`
command line). `snapshot-invalid` includes its bounded Planner detail so the
invalid request cause is directly observable:

- `plasma-auto-tiler:plan:rejected kind=<kind>`
- `plasma-auto-tiler:plan:rejected kind=snapshot-invalid detail=<detail>`
- `plasma-auto-tiler:plan:rejected kind=snapshot-invalid detail=window-out-of-bounds window=<id> resource_class=<class> rect=<rect> bounds=<rect>`

The third form is emitted when the adapter can identify the invalid carried
rectangle. It uses the same stable opaque id, resource class, and integer
geometry already emitted for applied writes.

Per applied geometry command (every member exactly one line, non-focus ops;
`<id>` is the stable opaque normalized window id, `<class>` is KWin's bounded
non-sensitive resource class, and `<rect>` is `x,y,w,h`):

- `plasma-auto-tiler:plan:write window=<id> resource_class=<class> disposition=<written|skip-fullscreen|skip-maximized|skip-floating|skip-already-equal|write-failed|float-written|float-write-failed> rect=<rect>`

Per work-area/scope change (dedicated pair, never the generic reconcile line):

- `plasma-auto-tiler:plan:scope-transition old=<old-rect> new=<new-rect>`
- `plasma-auto-tiler:plan:work-area-reprojection selected=retained`

Per slice-2 pointer echo fence transition (one fixed token each):

- `plasma-auto-tiler:plan:echo-fence-armed`
- `plasma-auto-tiler:plan:echo-fence-consumed`
- `plasma-auto-tiler:plan:echo-fence-cleared-equality`
- `plasma-auto-tiler:plan:echo-fence-mismatched`

Per maximize-at-admission clear (non-fullscreen new members only; one attempt
per live window identity, never a retry):

- `plasma-auto-tiler:plan:maximize-admission-clear window=<id> resource_class=<class> outcome=<issued|invoked|missing|threw|observed-cleared|observed-maximized|observed-absent>`
- `plasma-auto-tiler:plan:maximize-admission-echo-armed`
- `plasma-auto-tiler:plan:maximize-admission-echo-consumed`
- `plasma-auto-tiler:plan:maximize-admission-echo-mismatched`
- `plasma-auto-tiler:plan:maximize-admission-echo-cleared-no-signal`

Explicit native state writes arm before their native call, consume only the
same Window object, and clear immediately when no synchronous echo arrives:

- `plasma-auto-tiler:plan:maximize-toggle window=<id> resource_class=<class> target=<maximized|restored> outcome=<issued|invoked|missing|threw>`
- `plasma-auto-tiler:plan:maximize-toggle-echo-armed|consumed|mismatched|cleared-no-signal`
- `plasma-auto-tiler:plan:sticky-toggle window=<id> resource_class=<class> target=<all-desktops|current-desktop> outcome=<issued|invoked|missing|threw>`
- `plasma-auto-tiler:plan:sticky-echo-armed|consumed|mismatched|cleared-no-signal`

`observed-cleared` confirms that the immediate re-observation saw restore.
`observed-maximized` records that KWin still reported maximize after the one
call, including an application that immediately reasserted it; it is then the
ordinary post-admission maximize-isolation case, with no further clear.
`missing` and `threw` distinguish an unavailable method from a native-call
exception.

Per refusal/rejection path (exact distinct tokens, one per cause; every
shortcut and pointer-route refusal carries its own fixed token):

- `plasma-auto-tiler:plan:focus-refused-disabled` (shortcut focus while the adapter is disabled)
- `plasma-auto-tiler:plan:focus-refused-invalid-direction`
- `plasma-auto-tiler:plan:focus-refused-observe`
- `plasma-auto-tiler:plan:focus-refused-floating` (directional focus on an intentionally floating active window)
- `plasma-auto-tiler:plan:move-refused-disabled`
- `plasma-auto-tiler:plan:move-refused-invalid-direction`
- `plasma-auto-tiler:plan:move-refused-observe`
- `plasma-auto-tiler:plan:move-refused-floating` (directional move on an intentionally floating active window)
- `plasma-auto-tiler:plan:move-refused-fullscreen` (directional move refused on a fullscreen focused window)
- `plasma-auto-tiler:plan:move-refused-maximize` (directional move refused on a maximized focused window; fullscreen wins when both)
- `plasma-auto-tiler:plan:resize-refused-disabled`
- `plasma-auto-tiler:plan:resize-refused-invalid-direction`
- `plasma-auto-tiler:plan:resize-refused-invalid-mode`
- `plasma-auto-tiler:plan:resize-refused-observe`
- `plasma-auto-tiler:plan:resize-refused-floating` (directional resize on an intentionally floating active window)
- `plasma-auto-tiler:plan:resize-refused-fullscreen` (directional resize refused on a fullscreen focused window)
- `plasma-auto-tiler:plan:resize-refused-maximize` (directional resize refused on a maximized focused window; fullscreen wins when both)
- `plasma-auto-tiler:plan:pointer-refused-disabled`
- `plasma-auto-tiler:plan:pointer-refused-identity`
- `plasma-auto-tiler:plan:pointer-refused-direction`
- `plasma-auto-tiler:plan:pointer-refused-boundary`
- `plasma-auto-tiler:plan:pointer-refused-observe`
- `plasma-auto-tiler:plan:pointer-refused-absent`
- `plasma-auto-tiler:plan:pointer-refused-fullscreen` (pointer-resize target refused while fullscreen)
- `plasma-auto-tiler:plan:pointer-refused-maximize` (pointer-resize target refused while maximized; fullscreen wins when both)
- `plasma-auto-tiler:plan:maximize-refused-signal` (`maximizedChanged` cannot attach for any eligible observed normal window, at startup or on a window added later; maximize attachment is a hard requirement and the adapter fails closed)
- `plasma-auto-tiler:plan:float-refused-disabled` (toggle-float while the adapter is disabled)
- `plasma-auto-tiler:plan:float-refused-observe` (toggle-float target not found in the observation)
- `plasma-auto-tiler:plan:float-refused-not-tiled` (toggle-float on an active-excluded or otherwise non-tiled target)
- `plasma-auto-tiler:plan:float-refused-fullscreen` (toggle-float on a fullscreen focused window)
- `plasma-auto-tiler:plan:float-refused-maximize` (toggle-float on a maximized focused window; fullscreen wins when both)
- `plasma-auto-tiler:plan:sticky-refused-disabled|observe`
- `plasma-auto-tiler:plan:sticky-refused-fullscreen|maximize|untracked|attempted window=<id> resource_class=<class>`
- `plasma-auto-tiler:plan:maximize-refused-disabled|observe`
- `plasma-auto-tiler:plan:maximize-refused-fullscreen|attempted window=<id> resource_class=<class>`
- `plasma-auto-tiler:plan:busy-refused kind=<focus|move|resize|toggle-float|toggle-sticky|toggle-maximize>` (shortcut dropped while a flight is in flight)
- `plasma-auto-tiler:plan:reconcile-parked` (reconcile budget exhausted; bounded once per park transition)
- `plasma-auto-tiler:plan:shortcut-failed action=<action> sequence=<sequence>` (per failed shortcut registration)
- `plasma-auto-tiler:plan:shortcut-dispatch-shadowed action=<action> sequence=<sequence> holder_component=<component> holder_action=<action>`

Intentional-float Planner snapshot-invalid details:

- `toggle-float-op-invalid`
- `toggle-float-window-invalid`
- `float-rect-invalid`

Per window excluded before admission (one line per unchanged exclusion state for
an identified window; `<id>` is the normalized window id, or `unknown` when
KWin cannot provide one. `<class>` is KWin's non-sensitive resource class, or
`unknown` when unavailable):

- `plasma-auto-tiler:plan:observe-excluded reason=<active-normal-window|normal-window|output-missing|output-mismatch|desktop-mismatch|frame-rect-missing|frame-rect-coordinate-invalid|frame-rect-size-invalid|frame-rect-coordinate-out-of-range|frame-rect-size-out-of-range> window=<id> resource_class=<class>`

Drag-oracle route lines (always-on; entry then verdict; the pointer route's
adapter emits the exact `pointer-refused-*` token above per cause, never a
catch-all line):

- `plasma-auto-tiler:route-diag:drag-pull action=dispatch`
- `plasma-auto-tiler:route-diag:drag-verdict cancelled=<true|false> correlation=<drag-N> reason=<reason>`
- `plasma-auto-tiler:route-diag:drag-call-missing` (pull with no call binding)
- `plasma-auto-tiler:route-diag:drag-call-thrown` (pull whose D-Bus call threw)
- `plasma-auto-tiler:route-diag:drag-reply-invalid` (any malformed or unparseable reply)
- `plasma-auto-tiler:route-diag:drag-route-missing` (non-cancelled verdict with no pointer route installed)
- `plasma-auto-tiler:route-diag:drag-context-invalid`
- `plasma-auto-tiler:route-diag:drag-scope-invalid`
- `plasma-auto-tiler:route-diag:drag-unknown-window`
- `plasma-auto-tiler:route-diag:drag-ref-mismatch`
- `plasma-auto-tiler:route-diag:drag-start-missing`
- `plasma-auto-tiler:route-diag:drag-move-ignored`
- `plasma-auto-tiler:route-diag:drag-start-invalid`
- `plasma-auto-tiler:route-diag:drag-edge-invalid`

Drag-oracle entry startup refusal (exactly one token per refused
`startDragOraclePullEntry` start, one per cause; the entry returns null):

- `plasma-auto-tiler:route-diag:drag-entry-workspace-missing`
- `plasma-auto-tiler:route-diag:drag-entry-call-missing`
- `plasma-auto-tiler:route-diag:drag-entry-call-thrown`
- `plasma-auto-tiler:route-diag:drag-entry-list-missing`
- `plasma-auto-tiler:route-diag:drag-entry-list-thrown`
- `plasma-auto-tiler:route-diag:drag-entry-list-invalid`
- `plasma-auto-tiler:route-diag:drag-entry-finished-invalid` (a connectable finished signal that failed to attach)
- `plasma-auto-tiler:route-diag:drag-entry-no-windows` (empty window list)
- `plasma-auto-tiler:route-diag:drag-entry-no-finished` (windows exist but none expose a connectable finished signal)
- `plasma-auto-tiler:route-diag:drag-entry-added-invalid` (missing or non-connectable windowAdded signal)
- `plasma-auto-tiler:route-diag:drag-entry-added-connect-failed` (windowAdded attach returned null or threw)

Map each journey step above to one command pair: add -> `kind=admit`,
close -> `kind=remove`, directional focus -> `kind=focus`, directional move ->
`kind=move`, resize -> `kind=resize`, intentional float toggle -> `kind=toggle-float`.
Pointer focus change alone emits no command line. A rejection still emits the
pair above and recovers on the next fresh observation; the adapter never
disables itself after a reply.
