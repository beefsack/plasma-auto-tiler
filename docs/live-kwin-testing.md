# Live KWin/Plasma Testing Guide

Read this guide before planning or running live KWin/Plasma work. It is the
authoritative safety and operational contract for this repository; it does not
grant authorization beyond [Current Decisions](decisions.md#live-kwinplasma-boundary).

## Safety Boundary

- Preserve real windows, desktops, outputs, Krohnkite state, and unrelated
  configuration. Touch only identified project resources. Never use broad
  cleanup.
- Reversible, project-scoped live host tests may run under this guide and
  `docs/decisions.md` when exact restoration is verifiable. The user performs
  physical or manual observations and every session boundary.
- Stop on an ownership, parser, diagnostic, baseline, or restoration surprise.
- Do not use `sudo`, system plugin paths, Home Manager-managed files, external
  dotfiles, unrelated environment entries, unrelated host mutation,
  irreversible cleanup, or ambiguous-residue deletion.

## Nested KWin Isolation

- A nested `kwin_wayland` run must use fresh private `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, and
  `KDEHOME`, all scoped to its run directory. The private runtime directory
  must be user-owned mode `0700`.
- Use a private `dbus-run-session`, the proven `--socket nested-kwin-spike
  --width 640 --height 480 --no-global-shortcuts --no-kactivities
  --no-lockscreen` launcher shape, and never `--windowed`.
- A private runtime directory requires the parent Wayland display as an absolute
  path passed through `--wayland-display`. Never use the host runtime directory
  or remove host sockets.
- Before and after a bounded nested run, record the host `~/.config/kwinrc`
  SHA-256 and nanosecond mtime. The hash must not change. Confirm that the
  nested run created and used its own private `kwinrc`; an unexpected hash
  change is a hard stop.

## KWin Script Lifecycle

- KWin executes the generated non-module ES2017 IIFE only. Do not ship ESM,
  Node imports, source maps, optional catch bindings, or manually edited output.
- `/Scripting` returns a signed `i` script ID from `loadScript(s)` or
  `loadScript(ss)`. Retain and strictly parse the raw result, accept only a
  non-negative 32-bit ID, introspect that exact script object, and run only it.
  Never guess `Script0`, call global `Scripting.start`, or use a KPackage as a
  test path.
- `scripts/start-test.sh` is the manual lifecycle interface. `start` builds,
  loads, runs, and waits for current-PID readiness diagnostics; `status` and
  `diagnostics` are read-only; `stop` unloads only the exact project script.
  `reconcile-shortcuts --apply` is a shortcut mutation and always needs explicit
  authorization.
- `scripts/live-test.sh run` is an interactive convenience path, not proof of a
  product journey. It never writes shortcut records, creates desktops/windows,
  or launches a nested compositor.

## Diagnostics And Ownership

- KWin runs as `plasma-kwin_wayland.service`; use `journalctl --user` and filter
  by the recorded KWin PID. `journalctl --system` is not a valid KWin capture.
- Production diagnostics use the `plasma-auto-tiler:` prefix. Keep the separate
  `QT_CATEGORY=kwin_scripting` error check; neither substitutes for direct
  authoritative state evidence.
- A journal cursor is opaque: strip the `-- cursor: ` display prefix before
  passing it to `--after-cursor`. Prove a new capture contract with a true
  positive marker before relying on it.
- KGlobalAccel collection must enumerate all components and exact action tuples.
  Persisted records after unload do not prove a callback. Never unregister or
  restore anything except exact verified project-owned action records.
- `scripts/custom-tile-acceptance.sh preflight` is an accepted static,
  current-session read-only diagnostic. It strictly diagnoses KWin and
  KGlobalAccel ownership, and fails closed on stale state, collisions, drift,
  or provenance ambiguity. It performs no lifecycle or mutation; its rollback
  and journal contract applies only to a later authorized run.
- After its `devenv.nix` dependency change, restart the development session
  before assuming the preflight is available. Do not run live acceptance before
  that restart; request user physical or manual action only when the restarted
  session's preflight reports `authoritative_ready: true`.

## Custom Tile Safety Findings

- Never run `remove()` then `split()` in one structural run. A removal can
  invalidate the prior tree and crash KWin.
- Never use a fixed timer as a `deleteLater` barrier. Re-resolve every tile
  handle, including the root, after removal; use homogeneous structural batches
  and a freshly decoded root after each structural call.
- Never probe persistent user scope. A scripted collapse can also crash KWin;
  treat it as crash-class, not cleanup-class behavior.
- `createDesktop` can persist a default tiling group after its two-second save
  timer. Cleanup must target only exact verified owned keys, never unrelated
  stale groups.

## Live Evidence

- A transport reply, process exit status, missing error, or visual appearance
  alone is not feature evidence. Record the relevant authoritative state before
  and after a mutation and preserve raw machine responses that gate it.
- Use verified Wayland-native normal resizable test clients. Validate focus,
  active window, desktop/output scope, and tile association before insertion.
- `invokeShortcut` bypasses the xkb layer and cannot prove physical shortcut
  delivery. Manual journeys require physical input and matching state evidence.
- The trailing-empty workspace proof is a separate executable procedure at
  [live oscillation verification](live-oscillation-verification.md).
