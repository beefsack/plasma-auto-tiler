# Specification: Native Effect Live Runner

Ownership and approval:
- Owner: Lead
- Status: Expanded, approved 2026-08-15 by the user and Orchestrator.
- Command goal: `bash scripts/live-native-effect-test.sh run [--quick]`.

## Intent and Scope

Deliver a user-run-only runner that validates the exact native active-border
effect in a visible nested Wayland KWin backend. It creates a private nested
environment, starts exactly two Wayland-native `weston-terminal` clients, and
records reproducible lifecycle evidence.

In scope:

- Private `HOME`, `KDEHOME`, all XDG directories and runtime directory, private
  D-Bus, private `QT_PLUGIN_PATH`, and a read-only absolute host Wayland socket
  used solely to start the nested backend.
- Private build of the exact native plugin after ABI and version preflight.
- Nested `/Effects` D-Bus discovery, load, `isLoaded`, and unload only.
- OpenGL support as a hard requirement; unsupported or fallback rendering fails
  closed.
- Manifest, exact nested/client/process-group PIDs, stdout/stderr, D-Bus
  transitions, cleanup states, optional exact-PID duration-scoped read-only
  journal capture when available, and a checklist.

Non-goals:

- Launching, mutating, restarting, loading into, or validating host KWin.
- Absolute host KWin, service, configuration, or plugin paths.
- `--virtual`, X11/xterm, QML, or any client fallback.
- Inferring current liveness from historical journal entries.
- Claiming SIGKILL or power-loss cleanup.
- Automated visual acceptance. The user performs visual acceptance.

## Safety and Lifecycle Requirements

- The runner is invoked only by the user. Agents do not perform an actual
  nested launch.
- The nested launcher and each client have recorded, owned process groups.
- On normal completion, `INT`, or `TERM`, unload the exact effect when the
  nested `/Effects` endpoint remains reachable; terminate owned client groups,
  then the nested launcher group; and verify each recorded cleanup state.
- Cleanup must never target a PID or process group not recorded as owned by the
  run. It must report unreachable D-Bus and failed verification as evidence,
  not as success.

## Dependencies

- System dependencies: `kdePackages.kwin` and `weston` only.
- The dependency declaration is a separate first work unit in `devenv.nix` and
  requires a restarted development session before implementation verification.
- The exact plugin source and its build metadata are preflight inputs; no
  installed host plugin is used.

## Process Topology

| Process | Parent/ownership | Required boundary |
|---|---|---|
| Runner | User shell | Creates the private run directory and evidence manifest. |
| Private D-Bus | Runner-owned environment | Address exported only to nested KWin and owned clients. |
| Nested KWin launcher | Runner-owned process group | Visible Wayland backend only; connects to the read-only host socket. |
| `weston-terminal` A and B | Separate runner-owned client groups | Wayland-native clients of the nested compositor only. |
| Optional journal reader | Runner-owned helper | Read-only, exact nested PID, duration-scoped, optional. |

## Refusal Matrix

| Condition | Required result |
|---|---|
| Missing or stale dependency session | Refuse before build or launch and state that a restarted session is required. |
| ABI/version mismatch or plugin build failure | Refuse before nested launch; preserve preflight output. |
| Missing private environment, private D-Bus, or host socket | Refuse before nested launch. |
| `--virtual`, fallback renderer, or unsupported OpenGL | Refuse and do not claim validation. |
| Missing `/Effects`, failed discovery/load/`isLoaded`/unload | Fail closed; record transition and cleanup attempt. |
| Missing `weston-terminal` or fewer than two owned clients | Refuse; no alternate client. |
| Journal unavailable or unreadable | Continue without journal evidence and record it unavailable. |
| Interrupt or termination | Execute owned cleanup only; record unreachable or unverified states as failures. |

## Acceptance Criteria

- [ ] `run [--quick]` rejects unsupported arguments and performs the dependency,
      private-environment, ABI/version, renderer, and client preflights before
      any nested launch.
- [ ] The exact native plugin is privately built and is discovered, loaded,
      checked with `isLoaded`, and unloaded exclusively via nested `/Effects`.
- [ ] The visible nested Wayland backend uses no `--virtual`, runs with OpenGL,
      and starts exactly two owned Wayland-native `weston-terminal` windows.
- [ ] Evidence contains the manifest, exact PIDs/process groups, command output,
      D-Bus transition records, cleanup verification, checklist, and only
      qualifying optional journal output.
- [ ] Normal, `INT`, and `TERM` paths unload when reachable and clean up only
      recorded owned groups in client-then-nested order without false success.
- [ ] Full fake-tool contract tests and an independent isolation/process review
      pass before user-run live acceptance.
- [ ] The user manually accepts visible behavior in the nested compositor.

## Pending Decisions

- None.
