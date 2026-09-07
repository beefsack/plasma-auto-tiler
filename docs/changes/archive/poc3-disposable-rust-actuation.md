# POC3 Disposable Rust Actuation

## Goal

Exercise a Rust-authoritative logical tiling engine through stock KWin geometry
and focus writes for exactly three explicitly named disposable windows. This is
an opt-in, manually run, closure-only experiment. It does not replace the
production Custom Tile tiler or claim stock-KWin parity.

## Scope

- Rust owns one in-memory `H[A,V[B,C]]` logical tree, integer shares, focus,
  directional movement, full desired rectangles, revisions, and divergence.
- `EvaluatePoc3` is an additive bounded JSON method on the manually started
  planner service. Dispatch is non-atomic; only a validated adapter completion
  advances Rust state.
- A separately built KWin command bundle observes and revalidates exactly the
  three supplied `String(Window.internalId)` values on one existing output and
  its current workspace. It writes only their `frameGeometry` values and focus.
- `scripts/poc3-command.sh` supplies one manually loaded command at a time:
  `start`, `focus`, `move`, `status`, or `stop`. It refuses while the production
  plugin is loaded, so use a private nested environment or an already-unloaded
  production plugin without this POC modifying it.
- Start requires the literal `close-disposable` cleanup model. Stop can close
  only the three identity-pinned, still-eligible, user-designated disposable
  windows and waits for bounded observed removal. Restore is intentionally not
  exposed by this live route.

## Non-Goals

- No Custom Tile association or topology mutation, shortcut mutation, normal
  startup, persistence, autostart, tray/KCM coupling, workspace/output change,
  package deployment, or unrelated-window management.
- No atomicity, configure acknowledgement, exact KWin parity, recovery system,
  multi-output/workspace model, hostile same-uid service-authentication claim,
  or durable session state.

## Acceptance

- Exactly three initially untiled, normal, managed, resizable, closeable,
  non-special, non-fullscreen, non-maximized, non-popup windows are manually
  identified by their public `String(Window.internalId)` values.
- All three remain on one output and that output's current workspace throughout
  a command. Any replacement, state, output, workspace, reply, revision, or
  transport drift fails closed without another intent.
- Rust returns a complete versioned desired rectangle batch and focus target.
  KWin applies writes sequentially, observes bounded convergence, then reports
  `complete applied`; partial or expired convergence reports divergence.
- The journey visibly establishes the initial layout, directional focus, and
  one directional structural move. Stop closes only the enrolled three and
  reports observed removal, or reports residue without claiming cleanup.

## Static Evidence

- Rust pure/contract/service coverage includes layout, shares, focus,
  structural move, stale revision, divergent completion, pending-stop cleanup,
  and bounded cleanup identity.
- TypeScript coverage includes non-enrollment, eligibility, command routing,
  stale replies, delayed and partial convergence, state/output/workspace drift,
  service loss, delayed close, cleanup, and prohibited production coupling.
- Two independent adversarial reviews rejected the initial inaccessible-control
  and self-asserted-close design. The final command route uses explicit
  arguments and a literal closure model; it has no normal-startup or Custom
  Tile path.

## Outcome

- Static implementation is complete. `cargo fmt --check`, `cargo test`,
  `cargo clippy -- -D warnings`, `npm run typecheck`, `npm run test:poc3`,
  full `npm test`, the POC3 command bundle check, KPackage contract check, and
  `git diff --check` pass. Full `npm test` regenerated the existing tracked
  production bundle as intended by its build step.
- `cargo clippy --all-targets -- -D warnings` remains blocked by two unrelated,
  unmodified `src/tray.rs` test lints (`assertions_on_constants` and
  `type_complexity`).
- No live KWin/Plasma actuation, lifecycle command, package deployment, commit,
  or push occurred. This record remains active until user-owned live acceptance;
  do not archive it before then.
- Nested-only static tooling is now implemented. `scripts/nested-kwin-spike.sh`
  creates a fresh private session manifest pinned to KWin 6.7.4, private XDG
  state, private D-Bus, private Wayland socket, exact process identities, and a
  host `kwinrc` SHA-256 plus nanosecond-mtime baseline. The manifest validator
  fails closed on identity, executable hash/device/inode, socket, bus, path, or
  interrupted-startup drift.
- `scripts/nested-disposable-clients.sh` launches exactly three identity-pinned
  `weston-terminal` clients only against that manifest's private socket;
  `scripts/poc3-id-probe.sh` separately builds and runs a read-only exact-three
  eligibility/ID probe; `scripts/poc3-command.sh nested` uses only the private
  bus and private log; `scripts/nested-planner.sh` records a private-bus planner
  identity; and `planner-service-nested <manifest>` binds caller authorization
  to the recorded nested KWin identity. All live-capable routes are disabled by
  default and require their explicit nested opt-in variable.
- `scripts/nested-kwin-cleanup.sh` is the sole manifest-bound shutdown route. It
  acts only on exact recorded IDs/PIDs, preserves ambiguous residue, and removes
  the work directory only after manifest validation proves checkpoint private
  isolation. Host `kwinrc` hash/mtime is read-only diagnostic, never
  restored/mutated, and no longer gates exact cleanup.
- Static nested shell harnesses, POC3/probe TypeScript tests, full `npm test`,
  Rust tests, package/startup checks, and `git diff --check` pass. Full-target
  Clippy remains blocked only by unrelated existing `src/tray.rs` lints.

## Live Preconditions And Journey

Do not reuse the stale POC2 Custom Tile preflight or its retained artifacts. The
intended journey requires a fresh absolute
project-owned `WORKDIR`, a successful `nested-kwin-spike.sh launch`, exactly
three manifest-recorded disposable clients, and public `String(Window.internalId)`
values from the user-owned read-only nested probe. The probe must report exactly
three eligible windows before those values may be supplied to a POC3 command.
Every live-capable nested command requires both its explicit opt-in variable and
separate live authorization.

Success establishes a bounded stock-KWin observation, Rust planning,
geometry/focus actuation, and observed completion path with observable jank.
Failure establishes the first failing public seam or timing boundary only; it
does not authorize recovery work, production migration, or a parity claim.

## Live Staging Result

- 2026-09-04: `nested-kwin-spike.sh check` passed with host `kwinrc` SHA-256
  `5e6fb76e94a616ef0bfdd0f26229116eb77804442ae8330aeb5634e878914abe` and mtime
  `2026-09-04 11:51:21.670154832 +1000`.
- The one authorized launch at `/tmp/opencode/poc3-live-20260904-a1` stopped at
  `NOT-READY`. Its manifest remains `status=starting` with an empty
  `bus_address`; no nested socket, clients, planner, probe, adapter, POC3 start,
  owner, generation, revision, or window IDs were created.
- An independent read-only validation confirmed no recorded processes are live
  and the host baseline remains exact. Cleanup is correctly blocked because the
  manifest fails validation; the stated work directory is preserved as residue.
- Static diagnosis found that bare `dbus-run-session` selected a `/tmp` bus
  listener, while ready-manifest validation requires a listener under the
  workdir. The launcher now supplies a private session-bus config binding
  `$WORKDIR/runtime/bus`; focused and related nested static harnesses pass.
  The preserved log cannot determine why KWin never reached readiness, so this
  correction does not establish live KWin startup.
- The one authorized corrected readiness-only launch at
  `/tmp/opencode/poc3-live-20260904-a2` also stopped at `NOT-READY`. Its
  `status=starting` manifest has an empty `bus_address`; `bus.txt` records the
  intended workdir-scoped bus address, but neither its bus socket nor nested
  socket exists. No nested KWin, private-bus supervisor, launcher, clients,
  planner, probe, adapter, or POC3 workload is live or recorded. Independent
  validation fails closed, so cleanup is forbidden and the workdir is retained
  as residue. The current host `kwinrc` SHA-256 and nanosecond mtime exactly
  match the manifest baseline.
- Historical committed records contain two 2026-08-21 nested `READY`
  observations using the earlier KWin 6.7.3 bare-`dbus-run-session` launcher,
  but both are explicitly invalidated by host `kwinrc` baseline changes. They
  are not a valid working method or POC3 runtime evidence; their uncontained
  `/tmp` bus and inherited environment must not be reused.
- Read-only coredump metadata and journal backtraces bind the two failed
  readiness attempts' child PIDs (1575994 and 1677456) to SIGSEGV in the dev
  KWin 6.7.4 wrapper before readiness. The stack is
  `QStyleHintsPrivate::update` through `QKdeThemePrivate::refresh`, platform
  integration, and `KWin::Application` construction. The supplied later
  `--version`/`--help` crashes use the same wrapper and stack shape. This
  explains why those launches never reached readiness, but does not establish
  the Qt/KDE theme trigger.
- Static correction: launcher and manifest identity discovery never execute
  KWin for `--version` or `--help`. Production accepts only the exact
  `/nix/store/<hash>-kwin-6.7.4/bin/kwin_wayland` identity shape, captures its
  canonical path/hash/device/inode, and rejects stale 6.7.3 or non-store
  identities. The nested child now uses private `HOME`/XDG/KDE state and
  clears observed inherited Qt/KDE/plugin/session values before KWin exec;
  this is isolation hygiene, not a proven crash repair. Focused sentinel and
  shell static coverage passes without executing KWin, D-Bus, or a compositor.
- 2026-09-04: the one authorized fresh corrected readiness-only launch at
  `/tmp/opencode/poc3-live-20260904-a3` did not reach readiness. The private
  bus and nested socket bound under its mode-0700 runtime directory, and no
  client, planner, probe, adapter, or POC3 workload was recorded or observed.
  KWin remained live while evidence was captured; no crash evidence was
  produced. Readiness failed because live `/proc/<pid>/exe` was the Nix wrapper
  `bin/.kwin_wayland-wrapped`, not the manifest's recorded
  `bin/kwin_wayland` canonical identity. The manifest therefore remained
  `status=starting` with an empty `bus_address`, its stale launcher PID, and no
  valid nested identity. Independent read-only verification corroborated all
  of those facts.
- The host `~/.config/kwinrc` SHA-256 and nanosecond mtime differ from this
  launch manifest's pre-launch baseline. Per the live-testing boundary this is
  a hard stop; causation is unproven. The exact manifest cleanup route rejects
  this invalid starting manifest, so it was not run. The workdir, private bus,
  and live wrapper KWin are preserved as required residue; `a1`, `a2`, and all
  coredumps remain untouched.
- Static correction completed: the manifest retains the exact Nix
  `kwin_wayland` launcher entrypoint, while its canonical executable identity
  is the exact same-output `.kwin_wayland-wrapped` sibling. Both paths must be
  regular, executable, and non-symlinked; the wrapped executable is bound by
  SHA-256 and device/inode and must match the nested PID's start tick and live
  `/proc/<pid>/exe` identity. Focused synthetic shell regressions and nested
  static suites pass without a live KWin/Plasma action.
- 2026-09-04: one authorized recovery/cleanup inspection of preserved `a3`
  stopped without configuration or process mutation. The recorded host
  `kwinrc` baseline is SHA-256
  `5e6fb76e94a616ef0bfdd0f26229116eb77804442ae8330aeb5634e878914abe` at
  `2026-09-04 17:52:25.415788346 +1000`; the current host file is SHA-256
  `c1502b1504300892fe7c3036e9afe7a0545d3b357b56edadc0a905a391d71f7c` at
  `2026-09-04 18:34:12.770512762 +1000`. The a3 workdir retains no baseline
  byte preimage, so the exact changed bytes and launch attribution cannot be
  established, even though the host file was recreated during the launch
  window. Restoration is therefore forbidden.
- The manifest remains `status=starting` with empty `bus_address` and its
  recorded launcher PID `2007634` is gone. Live PIDs `2007662`
  (`dbus-run-session`, tick `3775690`), `2007664` (`dbus-daemon`, tick
  `3775692`), and `2007665` (wrapped KWin, tick `3775692`) are connected only
  by current private bus/socket evidence, not exact recorded manifest
  identities. The corrected wrapper-aware validator and cleanup route reject
  this old manifest fail-closed; no signal was sent and no static-tool change
  is needed. Host KWin PID `2324` remains running and outside this set.
- Independent read-only review confirmed private a3 bus/socket isolation and
  unchanged host-session identities. The a3 workdir, its private bus/socket,
  all three live nested processes, a1/a2, and coredumps remain preserved.
- 2026-09-04: the user explicitly authorized one identity-bound cleanup and
  accepted the then-current host `kwinrc` as the post-incident baseline:
  SHA-256 `c1502b1504300892fe7c3036e9afe7a0545d3b357b56edadc0a905a391d71f7c`,
  mtime `2026-09-04 18:34:12.770512762 +1000`. Revalidation bound PID
  `2007662` (tick `3775690`, `dbus-run-session`) as parent of PIDs `2007664`
  (tick `3775692`, private `dbus-daemon`) and `2007665` (tick `3775692`,
  private wrapped KWin), including their a3 bus/socket/workdir bindings and
  exclusion of host KWin PID `2324` (tick `2590`). `SIGTERM` to `2007665`
  exited it within the bounded wait; its `dbus-daemon` and supervisor then
  exited before they could be signalled. Independent verification found no
  target PID reuse, no a3 bus or nested socket service, and no a3 socket files.
  No evidence was deleted: a3 remains with `runtime/dbus-session.conf`, and
  a1, a2, and coredumps remain retained. Host KWin remained PID `2324` with
  its prior identity and was never signalled. The final host `kwinrc` was
  SHA-256 `5e6fb76e94a616ef0bfdd0f26229116eb77804442ae8330aeb5634e878914abe`,
   mtime `2026-09-04 20:56:46.858188946 +1000`, which mismatches the accepted
   baseline; no configuration restoration or write occurred.
- Static correction: host `kwinrc` hash/mtime is read-only diagnostic, never
  restored/mutated, and no longer blocks exact cleanup once manifest validation
  proves checkpoint private isolation. The validator requires exact nested HOME,
  XDG_CONFIG_HOME/DATA/CACHE/STATE/RUNTIME, KDEHOME, private D-Bus address,
  private runtime/socket, project workdir, canonical wrapper, and PID/start
  tick, and rejects any retained host config path or canonical alias in
  environ/cmdline/known FDs/maps. This is checkpoint-only and cannot prove a
  config was opened then closed or mapped then unmapped before validation.
- Focused independent review fixed NUL env parsing, canonical/hardlink
  alias/mapped path checks, and post-TERM PID-reuse/unreadable fail-closed
  cleanup. Static `nested-kwin-spike.test.sh` 182 passes and
  `nested-kwin-cleanup.test.sh` 103 passes; diff check clean.
- 2026-09-04: one authorized readiness-only attempt at
  `/tmp/opencode/poc3-live-20260904-a4`: check, exactly one launch, and validate
  all passed; manifest ready. Validated launcher PID `2741501` tick `4939622`
  `dbus-run-session`; nested wrapped KWin PID `2741504` tick `4939622`, Nix
  6.7.4 output `4halkmxd4yfrjp2prv1gj2wch7z2d4q0`, wrapper SHA
  `7e3a76321175d787b92741b8d2dadab03ee4331b99e7626fca7bb8e726798c06`,
  dev:ino `36:38756793`. Private runtime 0700 and private bus/socket/config
  verified; no client/planner/probe/adapter/POC3 workload. Host KWin `2324`/`2329`
  distinct and untouched. Host `kwinrc` launch vs checkpoint drift occurred and
  is diagnostic only; no host config write/restoration was performed by this
  procedure and no causation is claimed.
- Independent read-only verification passed, including no retained host config
  in environ/cmdline/known FDs/maps at checkpoint, and
  `NESTED_CLEANUP_ALLOW=1 nested-kwin-cleanup.sh validate` passed warning-only.
  The nested run remains intentionally running for user physical observation;
  the exact cleanup route after observation is `NESTED_CLEANUP_ALLOW=1 bash
  scripts/nested-kwin-cleanup.sh cleanup /tmp/opencode/poc3-live-20260904-a4`
  and must be used only while the manifest validates; preserve residue if it
  does not.
- `a1`, `a2`, `a3`, and coredumps remain preserved. No POC3 lifecycle
  acceptance or production behavior is claimed.
- 2026-09-04: the authorized a4 client/planner staging stopped before any
  disposable client or planner started. Fresh manifest validation bound launcher
  PID `2741501` tick `4939622` and wrapped nested KWin PID `2741504` tick
  `4939622`, with private runtime/bus/socket/config and host KWin exclusion
  intact. The client launcher first refused the caller's host
  `XDG_RUNTIME_DIR`; its alternate environment then failed pre-spawn because it
  invokes unavailable `/bin/bash`. No client PID, planner PID, probe, adapter,
  POC3 owner, generation, revision, or opaque internal ID was created.
- Exact cleanup was authorized after a fresh identity revalidation and invoked
  once. It initially validated the manifest and the same private bindings, but
  failed closed while stopping because `/proc/2741501/stat` was absent and the
  recorded private supervisor was stale or unreadable. The recorded nested PID
  `2741504` was also absent after that invocation. The cleanup preserved the a4
  workdir as residue; no further cleanup, launch, probe, adapter, or POC3
  command is authorized from this checkpoint. Host KWin PIDs `2324` and `2329`
  remained live and distinct. The host `kwinrc` warning was diagnostic-only.
- Static correction: `nested-disposable-clients.sh` now accepts a normal host
  caller environment because its one child launch path uses a validated Nix
  `env -i` and only manifest-bound nested runtime/socket targets. The shell is
  the exact current Nix Bash rather than `/bin/bash`; host runtime/socket/bus
  manifest leakage, non-Nix shell/env overrides, missing tools, and duplicate
  launch records fail before spawn. Pre-record failures terminate only the
  captured identity-bound spawn group. Focused static regressions passed with
  no compositor or Wayland client launched. The former alternate-environment
  retry is not a supported route and must not be repeated.
- 2026-09-04: one authorized fresh-workdir staging run at
  `/tmp/opencode/poc3-live-20260904-b1` passed
  `nested-kwin-spike.sh check`, one launch, and validation. Its pre-client
  manifest bound supervisor/private-bus PID `2984016`, start tick `5266862`,
  executable `/nix/store/x7zw54jlc9yqdq1m4x5lvxscflnczd0s-dbus-1.16.2/bin/dbus-run-session`,
  and wrapped nested KWin PID `2984019`, start tick `5266862`, executable
  `/nix/store/4halkmxd4yfrjp2prv1gj2wch7z2d4q0-kwin-6.7.4/bin/.kwin_wayland-wrapped`.
  The nested KWin executable SHA-256 was
  `7e3a76321175d787b92741b8d2dadab03ee4331b99e7626fca7bb8e726798c06`
  with dev:ino `36:38756793`; private runtime, bus, and socket were bound under
  the workdir and host KWin was process-identity distinct.
- The one corrected client-launch command failed pre-record at client 3:
  its expected `weston-terminal` canonical executable was instead the Nix
  Bash executable. The client manifest group remained absent: no exact-three
  client PID/start-tick/executable identities, planner, probe, adapter, or
  POC3 records were created. There was no retry, alternate environment, probe,
  adapter, planner, or POC3 command.
- Static correction: this was a pre-`exec` identity-sampling race. The former
  `env -i` to Bash `exec -a` wrapper was sampled once before Bash replaced
  itself, so client 3 was rejected as Bash even though the PID was stable.
  Client launch now uses one direct validated `env -i` invocation of the exact
  target. It records an identity only after bounded canonical-executable and
  start-tick convergence, then final exact-three revalidation. Any immediate
  exit, unreadable identity, non-target timeout, PID reuse, or later
  pre-record failure records nothing and terminates every exact captured
  partial identity, including a captured Bash/non-target identity. TERM and
  KILL both revalidate the live PID/start-tick/canonical-executable triple;
  no unverified PID is signalled.
- Focused synthetic regressions cover third-client Bash retention, final-target
  convergence and exact-three atomic recording, immediate exit, timeout,
  PID-reuse-safe partial cleanup, command injection, and cleanup TERM
  revalidation. Independent adversarial review corrected the cleanup TERM
  reuse window and the known-current non-target survivor. `bash -n` checks,
  `nested-disposable-clients.test.sh` (187 pass, 0 fail),
  `nested-kwin-spike.test.sh` (182 pass, 0 fail),
  `nested-kwin-cleanup.test.sh` (103 pass, 0 fail), and `git diff --check`
  pass without KWin, a compositor, D-Bus, or a Wayland client.
- Independent pre-cleanup validation still established the ready manifest,
  private environment/bus/socket bindings, and absent client/POC3 groups.
  The host `kwinrc` fingerprint drifted from the launch baseline and remained
  diagnostic-only. The required sole exact cleanup invocation stopped the
  nested KWin and private supervisor, then failed closed because the recorded
  supervisor `/proc` identity had disappeared before its exact-stop check. The
  workdir is retained as stale residue: its manifest remains `status=ready`
  but fails current validation on stale launcher PID `2984016`; its runtime
  retains only `dbus-session.conf`. No nested KWin, private bus/socket, or
  disposable client remains live. User visual acceptance was not attempted.
- 2026-09-04: the one authorized fresh c1 staging attempt at
  `/tmp/opencode/poc3-live-20260904-c1` passed the nested check, one launch,
  and one manifest validation. It bound private supervisor PID `3262375`,
  tick `5660055`, and wrapped nested KWin PID `3262378`, tick `5660056`.
  The manifest records the private runtime (mode `0700`), bus, and
  `nested-kwin-spike` socket exclusively under c1; nested validation passed
  independently. Observable host KWin PIDs `2324` and `2329` were distinct
  by PID, start tick, start time, and socket arguments.
- The one direct disposable-client command printed `READY` and atomically
  recorded exactly three complete `weston-terminal` identity triples:
  `3264219`/`5660893`, `3264917`/`5660981`, and `3265647`/`5661067`. Immediate
  independent client validation failed closed because `/proc/3264219/stat`
  was absent; independent read-only inspection found all three recorded
  client PIDs absent. Therefore no accepted checkpoint established exactly
  three live disposable clients, despite the recorded complete group.
- Exact cleanup was not invoked because the required live exact-three client
  validation failed. c1 is preserved invalid residue with its manifest,
  nested KWin/supervisor, private bus/socket, and private state still live;
  no process was signalled or removed. The host `wayland-0` socket and
  observable host KWin processes remained present only as machine usability
  proxies. No visual or functional acceptance is claimed. No planner, probe,
  adapter, or POC3 action ran.
- 2026-09-05: one authorized manifest-bound c1 cleanup recovery revalidated
  the recorded supervisor `3262375`/`5660055` and nested KWin
  `3262378`/`5660056`, then invoked the exact cleanup route once. The three
  already-absent recorded client PIDs were reconciled without signalling. The
  route stopped the nested KWin and private supervisor but failed closed when
  the supervisor `/proc` identity disappeared before its exact-stop check.
  Independent read-only verification found no live recorded c1 process, no
  private bus or nested socket, and only `dbus-session.conf` in its private
  runtime. The stale c1 workdir and ready manifest are preserved; no host KWin
   or host D-Bus action occurred, and host KWin `2324`/`2329` retained their
   recorded start ticks.
- 2026-09-05 static readiness only: repaired the planner, nested-command, and
  ID-probe synthetic `/proc/<nested-pid>/environ` fixtures to satisfy the real
  manifest validator while retaining missing, malformed, and host-leaking
  negative cases. The disposable-client launcher now uses an explicit
  validated Nix shell and supported `weston-terminal --shell` option, bounded
  Nix PATH, fixed validated `C.utf8` locale, and private XDG homes. It records
  up to 32 KiB of per-client stderr with bounded early-exit status/snippet
  diagnostics, rejects zombie identities, pins launch/validation/cleanup
  identity tools and `/proc` outside hermetic tests, and atomically removes
  only its exact complete client group on post-record validation failure.
  Focused synthetic coverage includes long-lived noisy clients, early exits,
  host-variable leakage, injection, and exact record cleanup. No KWin,
   Wayland client, D-Bus, planner, probe, POC3 command, or c1 residue was run
   or mutated by this static work.
- 2026-09-05: the one authorized fresh d1 staging attempt at
  `/tmp/opencode/poc3-live-20260905-d1` passed `nested-kwin-spike.sh check`,
  one launch, and manifest validation. It bound private supervisor PID
  `724396` tick `9391173` and wrapped nested KWin PID `724399` tick `9391174`;
  the private runtime (mode `0700`), bus, socket, private XDG/KDE state, and
  host KWin exclusion validated independently.
- The one corrected disposable-client launch failed before recording any client
  identity. The three bounded client stderr captures each report that creating a
  `1582984 B` buffer file failed with `File too large` under the private runtime;
  no client records or live `weston-terminal` process remained. No planner,
  probe, adapter, POC3 command, or production action ran.
- 2026-09-05 static diagnosis: the child-only `RLIMIT_FSIZE=32768` added to
  bound per-client stderr was inherited through the direct `env -i` exec by
  `weston-terminal`. The private runtime had 171 GiB free and the captures were
  301 B, while `File too large` is `EFBIG`; the 1,582,984 B Wayland buffer is
  therefore rejected by that inherited limit, not storage exhaustion. Replace
  the inherited limit with bounded parent-side diagnostic capture only; no live
  retry is part of this correction.
- 2026-09-05 static correction: per-client stderr now drains through a private
  FIFO into a 32 KiB file cap, then discards in 8 KiB chunks. The direct client
  `env -i` exec receives no file-size limit. Each drainer has a recorded exact
  PID/start-tick/validated-shell identity; pre-record and later cleanup stop
  only exact client, drainer, or FIFO-holder identities and remove FIFO paths.
  Synthetic coverage proves a client can create a 51,200 B private-runtime
  file while noisy stderr stays capped, including a no-newline stream; it also
  proves early-exit status/snippet capture, direct client identity, and cleanup
  of a descendant retaining stderr. Review found and corrected manifest-supplied
  drainer-executable authority: cleanup now requires the current validated
  launcher shell canonical identity before any signal. Static suites passed:
  disposable clients `443/0`, nested cleanup `103/0`, shell syntax, and
  `git diff --check`. No live process, preserved residue, or POC3 action ran.
- A fresh independent validator confirmed the exact manifest identities and
  absence of all POC3 groups, then invoked the sole exact cleanup route once.
  Nested KWin and the private supervisor exited, but cleanup failed closed when
  the recorded supervisor PID was stale or unreadable at its post-stop check.
  The d1 workdir is retained as inert residue with its ready manifest,
  diagnostics, and no live nested process, private bus, or nested socket.
- 2026-09-05: the authorized e1 slice stopped at the launch freshness guard
  before any nested process or client could start. `nested-kwin-spike.sh check`
  passed for the pinned 6.7.4 KWin and host `wayland-0`; the sole
  `nested-kwin-spike.sh launch /tmp/opencode/poc3-live-20260905-e1` exited 1
  with `WORKDIR must be fresh and not exist` because the workdir had been
  created before launch. No manifest validation, disposable-client launch,
  client identity/stability observation, stderr/buffer diagnostic, planner,
  probe, adapter, POC3 command, host D-Bus/journal action, or cleanup ran.
   e1 contains only the bounded worker evidence and is preserved. Since no
   exact-three live identity checkpoint exists, exact cleanup is unauthorized
   and was not invoked; no host baseline or isolation claim is accepted.
- 2026-09-05: one authorized fresh-workdir verification at
  `/tmp/opencode/nested-63d1ea5016b28879` passed the nested check, its sole
  launch (1.55 s), and one manifest validation. Its private supervisor
  `3093268`/`10065855` (`dbus-run-session`) and nested KWin
  `3093271`/`10065856` (wrapped KWin) remain bound to the manifest's private
  runtime, bus, and socket. The corrected three-client launcher ran once
  (7.31 s) and recorded `weston-terminal` identities `3095205`/`10066890`,
  `3095938`/`10067011`, and `3096703`/`10067127`, but the sole immediate
  manifest-bound client validation failed because client 1 was already absent.
  Independent read-only review found all three client and drainer PIDs absent;
  no exact-three live non-zombie identity checkpoint, stderr file-size result,
  or stability observation was established. No planner, probe, adapter, or
  POC3 command ran. Per the identity-failure rule, cleanup was not invoked and
  the entire workdir, private bus/socket, and live supervisor/KWin are
  preserved. Host exclusion is path-based only: all private state is under the
   workdir and distinct from `/run/user/1000`; no host D-Bus, journal, or host
   process enumeration was used.
- 2026-09-05 final retained-artifact diagnostic: the manifest records three
  final `weston-terminal` and three drainer identity triples, but retains no
  client exit status, signal, wait result, stability observation, or
  compositor-side diagnostic. `nested.log` is empty and each client stderr
  contains only cursor-load warnings and `Unknown parameter: ?2004`. Weston 16
  source confirms `--shell` is supported, does not daemonize, and that the
  latter message proves the shell produced terminal output; neither line is an
  established exit cause. The prior inherited-`RLIMIT_FSIZE` defect is excluded
  for this run, but its FIFO-drainer correction has no live confirmation.
- No small evidence-based launcher correction is justified. The remaining
  retained-artifact possibilities include a shell exit after startup and a
  compositor-initiated close, which can both be silent; selecting either would
  overfit missing evidence. A minimal project-owned client could later provide
  explicit configure/map/exit diagnostics, but would require new Rust Wayland
  protocol dependencies and manifest/launcher/test changes. It is not justified
  or implemented in this unit.
- The disposable-client failure occurred before the probe, adapter, planner, or
  POC3 command and does not disprove the static Rust/KWin design. POC3 remains
  static-only feasible, while its current live disposable-client route is
  blocked by the failed identity checkpoint and current authorization, not
  proven technically impossible.
- 2026-09-05: after exact manifest revalidation, one authorized cleanup route
  invocation for `/tmp/opencode/nested-63d1ea5016b28879` reconciled the already
  absent disposable clients and stopped nested KWin `3093271`/`10065856`. It
  failed closed because supervisor `3093268`/`10065855` was stale or unreadable
  before its exact-stop check; no fallback signal or retry occurred.
- Independent read-only verification found all recorded supervisor, nested KWin,
  client, and drainer PIDs absent, with no private bus or nested socket. The
  preserved stale residue is the ready manifest, `bus.txt`, PID files, empty
  `nested.log`, cursor-only client stderr, private state directories, and
  `runtime/dbus-session.conf`; validation now refuses on stale launcher PID.
  Host KWin `2324`/`2590` and `2329`/`2592` remained distinct by identity and
  `wayland-0` socket and were never signalled.
- 2026-09-05 static manual-client route: `scripts/nested-manual-clients.sh`
  replaces no existing route and launches one explicit slot at a time only
  with `launch WORKDIR SLOT -- /nix/store/.../client argv...`. It records exact
  NUL-delimited argv hashes, client and drainer PID/start-tick/canonical
  executable/hash/device/inode identities, and bounded 32 KiB stderr captures.
  It uses a private manifest-derived `env -i` Wayland/XDG/KDE environment and
  rejects non-store paths, symlinks, host targets, remoting/forking/early-exit
  identity failures, duplicate slots, replacements, and mixed automatic/manual
  groups. There is no default trio and no `weston-terminal` use.
- `poc3-id-probe.sh` now requires the exact three live manual identities before
  and immediately before transport. The read-only bundle accepts only three
  eligible windows whose KWin `pid` values exactly match those manifest PIDs;
  it retains opaque `String(Window.internalId)` discovery and never uses a
  caption, app ID, or guessed ID. Missing or zero PID fails closed.
- The sole nested cleanup route now validates and stops manual clients and
  drainers through their complete identities, rejects tampering/PID reuse and
  mixed modes, and preserves ambiguous residue. Review hardening pins helper
  tools to the active Nix/devenv store, rejects probe-output symlinks, and
  bounds probe-log scanning and diagnostics.
- Static evidence only: shell syntax; manual `127/0`, disposable `443/0`,
  nested cleanup `127/0`, nested spike `182/0`, nested planner `119/0`, and ID
  probe `100/0` harnesses; `npm run typecheck --prefix kwin`,
  `npm run test:poc3 --prefix kwin`, and `git diff --check` passed. An
  independent adversarial review found and the implementation corrected stale
  PID probe enrollment, drainer signal authority, tool authority, bundle
  symlink, manifest-clear, and log-boundary gaps. No KWin, D-Bus, GUI client,
  residue, production behavior, commit, or push was run or changed.
- 2026-09-05 manual Konsole staging: fresh
  `/tmp/opencode/poc3-live-18801fbda1134dce824b931afbf9814b` was absent
  immediately before its sole launch. The nested check, one launch, and one
  manifest validation passed. The ready manifest records live private
  `dbus-run-session` `912958`/`11003334` and wrapped KWin
  `912961`/`11003334`; independent exact-PID read-only observation confirmed
  both executable identities, private runtime mode `0700`, private bus and
  nested sockets, and a private `config/kwinrc`.
- Its sole manual slot-1 invocation used the exact pinned
  `konsole --separate` argv but timed out after 120 seconds without recording a
  manual identity: the launcher observed final executable
  `.konsole-wrapped` rather than the requested `konsole` path and rejected the
  remoting/forking identity change. Slots 2-3 and `ready` did not run. The
  retained `manual-1.stderr` and `nested.log` are empty; no early-exit cause is
  established. There are zero `manual_*` records, so exact-three live
  PID/start-tick/executable and eligible-normal-window evidence is absent.
- The one permitted post-failure cleanup validation failed before cleanup
  because `jq` resolved to `/etc/profiles/per-user/beefsack/bin/jq`, not an
  exact Nix-store executable. No cleanup ran and the fresh workdir, private
  bus/socket, supervisor, and nested KWin remain preserved. No planner, probe,
  adapter, POC3 command, host bus/journal, host process enumeration, or KWin
  actuation ran. Exact-PID inspection found no host `kwinrc` or host bus path
  in the nested process command line, maps, or known FDs, but its environment
  retains generic host GTK/Starship config paths, so strict checkpoint
  isolation is not cleanly established.
- 2026-09-05 static correction only: the manual route accepts only the exact
  Nix `konsole` launcher with its exact same-output `.konsole-wrapped` sibling;
  the wrapped target is identity-bound by SHA-256, device/inode, and live
  start-tick/executable checks. Generic or wrong-sibling wrappers and target
  tampering fail closed. Cleanup, manifest validation, and nested launch now
  resolve their security-relevant helpers to validated Nix-store executables,
  including canonicalizing the profile-linked `jq` to its store target; FHS and
  ambiguous substitutions fail closed. The nested child clears the observed
  GTK/Starship configuration variables, while retaining manifest-required
  private XDG/Wayland/D-Bus/locale/shell values. Validation also rejects those
  GTK/Starship variables if retained, so the already-running preserved
  checkpoint cannot become an exact-cleanup checkpoint through this static
  correction. Focused wrapper, tampering, tool-substitution, leakage, and
  valid-private-launch regressions pass. No live retry, validation, cleanup,
  signal, or POC3 action ran.
- 2026-09-05 authorized stale-checkpoint cleanup: fresh exact-PID revalidation
  bound `dbus-run-session` `912958`/`11003334` as parent of wrapped KWin
  `912961`/`11003334`, with the manifest-pinned 6.7.4 wrapper SHA-256
  `7e3a76321175d787b92741b8d2dadab03ee4331b99e7626fca7bb8e726798c06`
  and dev:ino `36:38756793`, private runtime mode `0700`, private bus/socket,
  private XDG/KDE state, and no retained host `kwinrc` or host-bus path. The
  user waived only the retained GTK/Starship environment gate. `SIGTERM` sent
  only to nested KWin exited it within the bounded wait; the private supervisor
  exited without being signalled, so no escalation or separate dbus-daemon
  signal occurred. Independent read-only verification found both former PIDs
  absent, no private bus or nested socket, and the workdir preserved with its
  manifest and retained evidence. Host KWin `2324`/`2590` and `2329`/`2592`
   remained live and distinct; neither was signalled. No host configuration,
   host bus, prior residue, or coredump was touched.
- 2026-09-05 manual Konsole staging retry: one fresh high-entropy absent
  workdir `/tmp/opencode/poc3-manual-stage-bb8b0e54ee3506ed9d707a88f6a08099`
  passed the nested check, sole launch, and manifest validation. It recorded
  private `dbus-run-session` `1966847`/`11474763` and wrapped KWin
  `1966850`/`11474764`, with the pinned 6.7.4 wrapper identity, private
  HOME/XDG/KDE state, runtime mode `0700`, private bus/socket, and checkpoint
  host-config leakage rejection. The exact store launcher was
  `/nix/store/a2s6f3f4mxbmdcz30c9mqx5qycr23l08-konsole-26.08.0/bin/konsole`;
  slots 1-3 each ran once with `--separate` and recorded final
  `.konsole-wrapped` identities `1969074`/`11476948`,
  `1972345`/`11483363`, and `1975635`/`11492634`.
- The sole `ready` check failed closed because slot 1 was stale. Independent
  exact-PID review found all three recorded Konsole clients and their drainers
  absent, so no exact-three live non-zombie client or eligible-window claim
  exists and no window should have remained visible. The read-only eligibility
  probe did not run. `manual-*.stderr` and `nested.log` were empty; no exit
  cause is established. Checkpoint records contain no planner, POC3,
  adapter, geometry, focus, probe, or lifecycle action.
- The one authorized `NESTED_CLEANUP_ALLOW=1 nested-kwin-cleanup.sh cleanup`
  attempt reconciled the absent manual group and stopped the nested chain, but
  failed closed when recorded supervisor `1966847` was absent at its post-stop
  identity check. Subsequent exact-path observation found both recorded
  supervisor/KWin PIDs and the private bus/socket absent. The workdir and its
  now-base manifest are preserved; no retry, broad cleanup, host signal, or
 configuration restoration occurred. The cleanup's host `kwinrc` drift
 warning was diagnostic-only and has no attributed cause.
- 2026-09-05 static-only diagnostic client route (no live nested attempt
 authorized or performed): additive manually launched diagnostic/test-only
 raw xdg-shell binary `poc3-diagnostic-client` with explicit `--runtime DIR
 --socket NAME --slot 1..3 --diag PATH` or bounded `--manifest PATH` CLI;
 refuses absent, host, default, or ambient targets. Slots 1-3 carry distinct
 markers; requires registry bind, ping/pong, configure ack, and minimal SHM
 ARGB attach/commit, with bounded redacted diagnostics through close, signal,
 and protocol-error paths.
- `scripts/nested-manual-clients.sh launch-diag WORKDIR SLOT --binary BIN
 [--diag PATH]` admits only the exact built binary identity per slot with a
 private `env -i` Wayland/XDG/KDE environment; no Konsole,
 `weston-terminal`, or generic fallback and no default trio. Exact
 identity-bound cleanup is preserved.
- Dependencies: added `memmap2 0.9`, `wayland-client 0.31` with no defaults,
 `wayland-protocols 0.32` client with no defaults, and extended existing
 `rustix` with `mm`. No `devenv.nix` change, no new system dependency, and no
 restart gate is required.
- Verification is static only: `cargo test` passes current (207 library tests
  plus all integration tests), focused diagnostic tests pass 11/0 and 10/0,
  `cargo clippy --bins -- -D warnings`, both manual/cleanup fixture suites
  (250/0 and 144/0), shell syntax, and `git diff --check` pass. Full-target
  Clippy remains blocked only by pre-existing unmodified `src/tray.rs` lints.
  Independent review found and corrected configure ordering, diagnostic
  exclusive file creation, global versions/event loop, terminal/signal
  integrity, and cleanup snapshot validation. Final live proof remains pending
  authorization. This is disposable diagnostic tooling, not production
  architecture.
- 2026-09-05 diagnostic visual result: the user observed one centered green
  square with a white border and two small white squares at its top-left. This
  is accepted only as visible mapping of the surviving identity-bound slot-2
  project-owned raw xdg-shell/SHM client. It establishes no geometry, focus,
  KWin tile association, POC3 command, or behavior claim.
- One exact identity-bound cleanup then revalidated slot 2 client
  `2940483`/`12170888`, drainer `2940456`/`12170885`, nested KWin
  `2935151`/`12162704`, and private supervisor `2935148`/`12162702`, while
  excluding host KWin `2324`/`2590`. Slot-2 cleanup cleared only its manifest
  record; TERM to the revalidated nested KWin exited it within the bounded
  wait and the supervisor then disappeared without a signal. Slot 1
  `2937353`/`12163834` and its drainer `2937326`/`12163829` were already
  absent and were not signalled. The workdir, stale slot-1 record, logs, and
  other residue remain preserved; no host config was restored or changed.
- Retained slot-1 diagnostics reach `first-map 320x240` and then a configure,
  with empty stderr/nested logs and no close, protocol-error, signal, or exit
  record. Slot-specific launcher paths, cleanup scopes, and existing synthetic
  sequential-slot liveness coverage do not show slot-2 launch terminating slot
  1. The cause remains unproven (including abrupt transport/compositor closure,
  external termination, or unrecorded failure), so no launcher correction is
  justified without another separately authorized attempt.
- 2026-09-05 exact-three diagnostic staging at
  `/tmp/opencode/poc3-diag-stage-20260905-9f8c20b1d7e46a3c5b0e17fd94c26a81`
  passed one nested check, one launch, and manifest validation with private
  supervisor `3428239`/`13792299` and wrapped KWin
  `3428242`/`13792300`. One `launch-diag` invocation per slot recorded clients
  `3430405`/`13793029`, `3433475`/`13805761`, and
  `3436648`/`13824372`, all bound to the documented diagnostic binary. Each
  capture reaches `first-map 320x240`; all bounded stderr files and
  `nested.log` were empty, with no recorded close or protocol error.
- The sole manifest `ready` and manual `validate` checks then failed because
  slot 1 was absent. Independent exact-PID review found all three client and
  drainer identities absent through both `/proc` and `kill -0`, so there was no
  live exact-three checkpoint. No ID probe, planner, adapter, POC3 command,
  geometry, or focus action ran. KWin window count was not established.
- One exact cleanup invocation was eligible from the still-live private nested
  identities. It reconciled and cleared the absent manual group, then failed
  closed when supervisor `3428239` was absent at exact-stop verification. The
  former supervisor, nested KWin, all recorded clients/drainers, private bus,
  and nested socket were independently absent afterward. The workdir and its
  logs/manifest are preserved; the cleanup host-`kwinrc` drift warning was
  diagnostic-only and no host configuration was restored or changed.
- 2026-09-06: fresh private workdir
  `/tmp/opencode/poc3-live-618c8578-0ecb-4764-97d0-7989eb5911eb` passed one
  nested check, launch, and manifest validation. Launch recorded private
  supervisor `2287178` and nested KWin `2287181`; the private bus was
  `unix:path=/tmp/opencode/poc3-live-618c8578-0ecb-4764-97d0-7989eb5911eb/runtime/bus,guid=d99edc76e6b382f9065986756a9c40e5`.
- Its one `launch-diag-trio` invocation reached `READY` with supervisor
  `2289393` and direct diagnostic-client PIDs `2289401`, `2289402`, and
  `2289403`; the manifest-bound `ready` check passed. The sole read-only ID
  probe stopped before bundle load because its `jq` resolver rejected
  `/etc/profiles/per-user/beefsack/bin/jq` as not an exact Nix-store
  executable. No planner, probe script, adapter, POC3 command, geometry, or
  focus action ran and no internal IDs were captured.
- One exact cleanup invocation began from a validating manifest and emitted a
  diagnostic-only host-`kwinrc` drift warning. It then failed closed because
  private supervisor `2287178` was stale or unreadable at its exact-stop
  verification. The workdir and all residue are preserved; no further cleanup
  or retry occurred.

- 2026-09-06 static correction only (independent review authority gaps; no
  live KWin/Plasma action, launch, cleanup, staging, probe, adapter, POC3
  command, commit, push, or residue touch):
  probe/planner lock, manifest staging, bundle guard, and bus-file paths now
  execute only validated Nix-store mkdir/rmdir/mktemp/cp/mv/rm/cat/dirname
  pinned before any entry step; planner also pins bare grep staging reads,
  drops every `|| sleep` fallback (fail-closed `|| return 1`), and discovers
  the planner binary only via explicit `PLANNER_BIN` or the fixed repo
  target/debug|release outputs (no PATH `command -v`; existing
  canonical/hash/device/inode binding kept with no store-only requirement so
  local POC builds stay usable). Launcher discovery uses the type builtin
  instead of `command -v` (still exact-store validated, never trusted from
  PATH) and writes the private bus config via pinned cat. All five helpers'
  store readlink requires basename `readlink` plus a regular executable
  /nix/store self-final before canonicalizing. The multicall applet rule no
  longer overclaims a canonical regular executable: only the final is
  claimed canonical-regular; a same-directory immutable store applet caller
  is additionally verified readable/executable with an existing final
  target. `${AWK_BIN:-awk}` removed (pinned `$AWK_BIN` only); all tool
  variables pin before execution.
- Static verification only: `bash -n` over all scripts;
  nested-canonical-tool 185/0 (new hostile `READLINK_BIN`, bare-name PATH
  poisoning of mkdir/grep/sleep with never-executed poison markers, applet
  returned-path regularity, no-fallback/no-`command -v` shape, hostile-pin
  entry refusals, PATH-impostor planner discovery keeping the fixed local
  target); probe 124/0; planner 126/0; spike 206/0; cleanup 144/0;
  disposable 443/0; manual 276/0; poc3-command-nested 28/0;
  `git diff --check` clean.
- Disposition, not a boundary (same caller controls invocation/environment,
  stated explicitly rather than disguised as fixed):
  `NESTED_KWIN_TEST_ALLOW_NONSTORE=1` remains an explicit hermetic-test
  interface (production defaults 0 and fails closed without it);
  `NESTED_PLANNER_TEST_PID`, synthetic `PROC_ROOT`, `REPO_ROOT`-derived
  helper paths, and startup bare `dirname`/`cat`-heredoc usage precede any
  pinning and cannot be hardened further without breaking hermetic tests or
  intended explicit test interfaces. They select fixtures and paths for the
   invoking caller only and confer no cross-principal authority. Any PATH
   poisoning of a pinned production tool fails closed with no execution, as
   proven by the poison-marker cases above.

- 2026-09-06 bounded resident diagnostic-trio staging used the one fresh
  workdir `/tmp/opencode/poc3-live-ab188c80042232ce631ef6cbdf960de8`. Current
  diagnostic binaries built, nested check, sole launch, and manifest validation
  passed. The private `dbus-run-session` `3903573`/`15750121` and wrapped KWin
  `3903576`/`15750122` were identity-bound to the manifest. One trio supervisor
  `3905868`/`15750930` launched exactly three direct diagnostic clients: slot 1
  `3905879`/`15750941`, slot 2 `3905880`/`15750941`, and slot 3
  `3905881`/`15750941`. All first-mapped at `320x240`, readiness and manual
  validation passed, and each was live immediately before the probe. Private
  XDG/KDE/runtime/bus/socket bindings, runtime mode `0700`, no retained host
  `kwinrc` path in the nested process environment/cmdline/known FDs/maps, and
  host KWin exclusion were independently verified. Source-defined colors are
  red slot 1 (`0xFFC02020`), green slot 2 (`0xFF20A020`), and blue slot 3
  (`0xFF2040C0`); colors were not part of the live probe result.
- The sole read-only ID probe used pinned
  `/nix/store/xvd6920kffyyshg7mbw5wvfk6lg9wfkl-jq-1.8.2-bin/bin/jq`, passing
  manifest and exact-three manual readiness before failing closed at its
  supervisor identity guard. Raw stderr is retained at
  `/tmp/opencode/poc3-id-probe-raw-20260906-001.err`: `error: supervisor
  identity is unreadable`. The guard's static awk program at
  `scripts/poc3-id-probe.sh:707` is malformed, so bundle loading and transport
  never occurred. No probe script ID, probe record, public `internalId`, KWin
  eligibility, output/current-workspace, distinctness, or bounded probe
  diagnostics result was established; the private bus confirmed both
  `poc3-id-probe` and the production plugin unloaded.
- Independent final validation again passed exact manifest/manual readiness,
  then the one authorized manifest-bound cleanup invocation ran. It cleared the
  trio supervisor/client records and stopped all six recorded processes, but
  failed closed when the private supervisor `3903573` was absent at its exact
  post-stop identity check. All former PIDs, private bus, and nested socket are
  absent; the workdir, 42-line stale manifest, logs, raw probe capture, and all
  prior residue/coredumps are preserved. No retry, planner, adapter, POC3
  command, geometry, focus, production, or host action occurred.
- 2026-09-06 static correction only: the ID probe's trio-supervisor guard no
  longer uses the malformed awk program or awk `--` file invocation that
  rejected the verified supervisor before bundle loading. Its inline Bash
  parser now matches the manifest helper: it reads one proc-stat line, requires
  the recorded leading PID, splits after the last `) `, requires a state and a
  positive field-22 start tick, and rejects unreadable, malformed, reused, or
  deleted/mismatched executable identities fail-closed. The exact recorded
  PID/start-tick/executable comparison is retained. Focused regressions cover
  valid supervisor identities; comm names with spaces/parentheses; malformed,
  missing, truncated, bad-state, bad-tick, PID-mismatched, and newline proc
  stat; tick/executable mismatch; deleted/relative/dangling/missing executable;
  partial/colliding supervisor records; and shell quoting/injection. Independent
  adversarial review found no parser, PID-reuse, injection, or fallback defect;
  its additional fail-closed regression gaps were added. Static verification
  passed: probe `155/0`, canonical tool `185/0`, planner `126/0`, launcher and
  manifest `206/0`, cleanup `144/0`, disposable `443/0`, command-nested `28/0`,
  diagnostic trio `43/0`, shell syntax, and `git diff --check`. No live retry,
  KWin/Wayland action, staging modification, cleanup, residue/coredump touch,
  commit, or push occurred. The manual-client suite was not included in final
   verification because its unrelated noisy-manual fixture exceeded a 60-second
   bound after 128 lines.
- 2026-09-06 bounded resident diagnostic-trio staging used one fresh workdir
  `/tmp/opencode/nested-f7ff3848f820c622a7187de1201ffdf8`. Current diagnostic
  binaries built, nested check, sole launch, manifest validation, and one trio
  launch passed. Private `dbus-run-session` `686892`/`16014572`, wrapped KWin
  `686895`/`16014572`, trio supervisor `689117`/`16015669`, and diagnostic
  slots 1-3 `689128`, `689129`, and `689130`/`16015683` were identity-bound.
  Each slot reached `first-map 320x240`; manual validation and readiness passed.
  Slot colors and app IDs were red `0xFFC02020`
  (`org.plasma-auto-tiler.poc3-diag-1`), green `0xFF20A020`
  (`org.plasma-auto-tiler.poc3-diag-2`), and blue `0xFF2040C0`
  (`org.plasma-auto-tiler.poc3-diag-3`).
- The single corrected canonical-jq read-only probe, with owner
  `lead-f7ff3848`, generation `g20260906f7ff`, and nonce `n20260906f7ff`,
  built its bundle and returned partial script ID `0`, but did not emit its
  bounded private-log completion marker. It recorded no trusted probe identity,
  owner/generation/revision result, public internal IDs, eligibility result, or
  output/current-workspace result. The raw stdout and stderr remain under the
  workdir as `id-probe-n20260906f7ff.{stdout,stderr}`. No probe retry, planner,
  adapter, or POC3 command ran.
- Independent pre-cleanup review revalidated exact-three first-map/liveness and
  private checkpoint isolation, including private HOME/XDG/KDE/runtime/bus/
  socket bindings, runtime mode `0700`, canonical KWin identity, and no retained
  host `kwinrc` path in the checkpoint environment, command line, known FDs, or
  maps. Eligibility is unavailable rather than inferred. The one authorized
  manifest-bound cleanup invocation stopped the exact trio and nested chain but
  failed closed when supervisor `686892` was absent at post-stop identity
  verification. All six recorded private PIDs and private bus/socket were then
  absent. The workdir, manifest, probe output, logs, and all prior residue and
   coredumps are retained. No host configuration was restored or changed.
- 2026-09-06 static script-ID correction only: KWin 6.7.4 `loadScript` uses
  signed `-1` as its only failure sentinel; successful IDs are `0..INT_MAX`,
  so the returned first ID `0` maps exactly to `/Scripting/Script0`. The POC3
  probe, command, lifecycle, and cleanup routes already accepted that range,
  dynamically formed the exact returned object path, recorded it before
  `run`, and unloaded only by their recorded plugin name. Focused regressions
  now cover `Script0` load/run/marker/unload, positive IDs, malformed and
  failure replies, duplicate guards, and partial-start cleanup. Independent
  review also found stale same-nonce log and error-payload completion gaps: the
  probe now snapshots its private-log byte boundary before `run`, scans only
  bounded post-run output, and records completion only for an exact successful
  owner/generation/nonce/revision/three-ID payload. The existing loaded-plugin
  and recorded-ID checks remain the fail-closed ID-reuse authority; KWin exposes
  no Script-ID-to-plugin D-Bus mapping. Static probe `201/0`, command `86/0`,
  canonical `185/0`, cleanup `144/0`, launcher `206/0`, command-nested `28/0`,
   POC3 TypeScript/typecheck, shell syntax, and `git diff --check` pass. No live
   retry, KWin/Wayland action, cleanup, residue/coredump touch, commit, or push
   occurred.
- 2026-09-06 terminal authorized slice at
  `/tmp/opencode/staging1-4edd96cbf22d8443f90ccde719863827`: built current
  diag binaries; nested check, one launch, manifest validation, one resident
  trio launch, manual ready/validation passed.
- Private identities: `dbus-run-session` `1061838`/`16232457`, wrapped KWin
  `1061841`/`16232457`, trio supervisor `1064132`/`16233290`, slots
  `1064140`/`1064141`/`1064142`/`16233300`. Three `first-map 320x240` and
  source red/green/blue mappings with app IDs
  `org.plasma-auto-tiler.poc3-diag-1/2/3` verified.
- The sole canonical store-jq read-only probe (owner `live-unit2-worker`,
  generation `gen-20260906-w2`, nonce `probe-20260906-w2a`) returned partial
  script ID `0` with no bounded post-run private-log success marker/payload.
  No Script0 introspection, ID, eligibility, output, or workspace success is
  asserted. The plugin self-unloaded; no probe record was retained and
  Script0 was absent. The requested exact probe cleanup correctly refused the
  unrecorded caller-supplied ID.
- Independent validation then passed exact checkpoint/private isolation and
  confirmed both plugins unloaded with no IDs. One full exact manifest-bound
  cleanup stopped all six private PIDs and removed private bus/socket, then
  failed closed because post-stop supervisor `1061838` was stale/unreadable.
   The workdir and evidence are preserved; no retry, planner, adapter, POC3
   start/focus/move, production, host, or config action occurred.
- 2026-09-06 terminal slice at `/tmp/opencode/poc3-d6284884-1a30-41f3-8a9e-b9e61701234f` (revision `2b10cca37d89b59d4ca68b7adfb569c4c90e96e9` plus pre-existing uncommitted staging): `cargo build --bins`, nested check, sole launch, manifest validation, sole diagnostic trio launch, `ready`, and manual validate passed. Manifest recorded private `dbus-run-session` `180008`/`17220528`, wrapped KWin `180011`/`17220528`, trio supervisor `182305`, clients `182313`, `182314`, `182315`; each `first-map 320x240`. Sole `NESTED_PLANNER_ALLOW=1 scripts/nested-planner.sh launch` exited 1 with `error: current XDG_RUNTIME_DIR is the host runtime; refusing`; no planner record/identity. No direct-enrollment start, ID probe, focus, move, host/product/config/shortcut/workspace/output/Custom Tile/sudo/system-path action ran. One exact cleanup invocation failed closed on stale/unreadable supervisor `180008`; workdir preserved. Independent read-only inspection found all recorded PIDs absent, no private bus/socket, no planner/adapter/service records, no authoritative post-geometries, and host kwinrc SHA-256 unchanged from manifest. No red/green/blue `H[A,V[B,C]]` arrangement established. Next action for this slice: none; preserve the workdir, no retry/recovery. All prior residue/coredumps preserved.

## Direct Enrollment Pivot (2026-09-06, static complete)

- The external read-only internal-ID probe/log-marker route is stopped as a
  live-start dependency after two valid Script0/self-unload runs
  (`nested-f7ff3848f820c622a7187de1201ffdf8` nonce `n20260906f7ff`,
  `staging1-4edd96cbf22d8443f90ccde719863827` nonce `probe-20260906-w2a`)
  returned Script ID `0` with no bounded post-run completion marker/payload.
  Standalone historical probe tooling is retained only as
  diagnostics/static coverage, not start authority; direct start runs no ID
  probe.
- New test-only persistent adapter direct-start is manifest-bound: exact
  diagnostic client PID/start-tick/app-id/slot/color evidence,
  owner/generation/nonce, private bus plus exact Planner unique D-Bus owner
  (`:N.M`, no well-known fallback). The adapter internally discovers IDs,
  enforces exact-three eligibility, uses no captions/guessed IDs, derives
  `H[A,V[B,C]]` initial geometry/focus from Rust, revalidates and applies
  sequentially, uses typed completion/status plus adapter-side
  post-observation, stays loaded, and records the exact Script ID including
  `0`. Cleanup exact-unloads it and only the manifest-bound trio, retaining
  retry state after unload if close is pending.
- Static-only, initial-start-only: later no-ID focus/move routing is the
  exact next implementation step. No production/startup/host/Custom
  Tile/shortcuts/persistence/tray/KCM changes.
- 2026-09-06 terminal direct-enrollment staging at
  `/tmp/opencode/poc3-d6284884-1a30-41f3-8a9e-b9e61701234f`, revision
  `2b10cca37d89b59d4ca68b7adfb569c4c90e96e9` plus pre-existing uncommitted
  staging: `cargo build --bins`, nested check, sole launch, manifest
  validation, sole diagnostic-trio launch, readiness, and manual validation
  passed. The manifest bound private dbus-run-session `180008`/`17220528` and
  wrapped KWin `180011`/`17220528`; trio supervisor `182305` and slots
  `182313`, `182314`, and `182315` each first-mapped at `320x240`.
- The sole `NESTED_PLANNER_ALLOW=1 scripts/nested-planner.sh launch` exited 1
  with `error: current XDG_RUNTIME_DIR is the host runtime; refusing`; no
  planner identity was recorded. No persistent direct-enrollment start,
  external ID probe, focus, move, host/product/config/shortcut/workspace/output/
  Custom Tile/sudo/system-path action ran. The sole exact cleanup invocation
  failed closed because recorded private supervisor `180008` was stale or
  unreadable and preserved the workdir. Independent read-only inspection found
  every recorded PID, private bus, and nested socket absent; no planner,
  adapter, service, authoritative post-geometry, or red/green/blue
  `H[A,V[B,C]]` arrangement exists. The host `kwinrc` SHA-256 matches the
  manifest baseline; this workdir, all prior residues, and coredumps remain
  preserved. No retry or recovery is authorized for this terminal slice.
- 2026-09-06 static-only nested planner caller-environment correction (no
  live retry/action): prior terminal staging `nested-planner.sh launch`
  refused the host caller `XDG_RUNTIME_DIR` before child construction. The
  launcher now accepts normal hostile host caller state and derives the
  planner child/service bus, runtime, XDG/KDE, exact nested KWin
  authorization, and private D-Bus ownership exclusively from the validated
  manifest. Host-valued, tampered, or missing manifest values and
  production-reachable test/validator/proc/env authority fail closed.
  Static evidence: planner 171/0, canonical 185/0, nested spike/manifest
  206/0, clients 443/0, cleanup 144/0, relevant POC3 suites pass, Rust
  planner 28/0, full `cargo test` 308/0 from prior verification,
  `cargo fmt --check` and `git diff --check` clean; `cargo clippy` retains
  only unrelated pre-existing `src/tray.rs` warnings. No live retry, launch,
  validation, cleanup, signal, probe, adapter, POC3 command,
  residue/coredump touch, commit, or push occurred; all residues/coredumps
   remain preserved. This correction does not authorize a live retry or
   establish live planner startup.
- 2026-09-06 terminal exact-one-attempt slice at
  `/tmp/opencode/poc3-live-7182a83fce094f1e8d499f938a4252de`, revision
  `2b10cca37d89b59d4ca68b7adfb569c4c90e96e9` plus pre-existing unstaged work:
  `cargo build --bins`, nested check, one launch, manifest validation, one
  diagnostic trio launch, `ready`, and manual validation passed. The retained
  manifest records private supervisor `2410862`/`17710871` and wrapped KWin
  `2410865`/`17710872`; trio supervisor `2413204`/`17711792` and slots
  `2413212`, `2413213`, `2413214`/`17711801`, each retained `first-map
  320x240`. The sole planner launch exited 1 after only two manifest-valid
  lines; no planner record/PID/service owner/private planner environment was
  recorded. No POC3 start/IDs/script/adapter/geometries/focus/move ran. Exact
  cleanup was attempted once and failed closed on stale/unreadable supervisor;
  all recorded PIDs, private bus, and socket were then absent and the workdir
  was retained. No user observation checkpoint exists; no retry/recovery is
  authorized for this terminal slice. Host `kwinrc` hash baseline/post-cleanup
  match but differing mtime is diagnostic only; no restoration/write causation
  is claimed.

## Remaining Risks

- KWin exposes `internalId` as `QUuid`; the live braced versus bare string form
  is unproven, so both strict forms are accepted and all other forms fail.
- KWin object-reference continuity, focus/geometry convergence timing,
  `closeWindow` timing, and client-area behavior remain live-only risks. The
  persistent route pins the Planner unique owner; legacy probe/one-shot routes
  retain their separate diagnostic/log and well-known-service limitations.
- The probe's Wayland-native classification and exact nested `windowList`
  composition remain live-only observations. A panel or extra window makes the
  exact-three probe fail closed.
- Private nested launch, D-Bus readiness, and exact validation also passed at
  `b1`, but its one corrected client launch failed pre-record when client 3
  retained Bash rather than `weston-terminal`; exact cleanup preserved stale-PID
  residue. At c1 the corrected launcher recorded three final terminal
  identities, but no client survived to the immediate independent validation
  checkpoint. The cause of this client-lifetime failure remains unproven. The
  d1 `File too large` diagnostic-limit defect is statically corrected but has
  no live confirmation; client lifetime still blocks the bounded live route
  before exact cleanup, script-ID lifecycle, planner caller credentials,
  client behavior, and POC3 commands.
- The closure-only route intentionally destroys only user-designated disposable
  windows. It must never be used for windows the user wants to retain.
- Residual live-only limits (static only, no live execution or confirmation):
  non-atomic `/proc`/KWin binding fails closed on observable drift; exact
  `resourceClass` app-id assumption fails closed if unavailable; no Script-ID
  plugin-identity D-Bus API (exact recorded ID plus Script-object proof only);
  adapter geometry/focus convergence and Wayland object behavior require the
  bounded host pilot described below, not another nested attempt.

## Host Manual Test Decision Package

- 2026-09-06: stop further nested live harness work as information-inefficient.
  A host-session manual pilot is the recommended next direction only after a
  separate implementation and fresh live authorization. It is the quickest
  credible way to observe real KWin geometry/focus timing and visible jank;
  it does not validate production behavior or authorize migration.
- The host pilot is limited to exactly three newly opened project diagnostic
  clients on one user-selected existing workspace and output. The adapter may
  write only their direct frame geometries and focus. It must not create or
  delete workspaces, invoke or change shortcuts, touch Custom Tiles, manage
  arbitrary windows, change persistence/configuration, or restore geometry.
  Stop is closure-only for those three clients; the user's controlling terminal
  is excluded from enrollment and remains open.
- Do not adapt a nested manifest to the host. Host mode needs a separate,
  explicitly gated runtime record and lifecycle: capture the production loaded
  state, KWin D-Bus owner/PID/start tick/executable identity, planner unique
  owner, and the three client PID/start-tick/app-id/internal-ID bindings before
  actuation; revalidate production-not-loaded and KWin identity before and
  after every command; preserve ambiguous residue rather than broad cleanup.
- Required implementation before any pilot: a transient production runtime
  unload/reload mechanism that does not write `kwinrc`; an explicit host
  planner lifecycle with host KWin executable authorization and unique-owner
  routing; host direct enrollment and exact cleanup for the diagnostic trio;
  host diagnostic-client launch/identity evidence; and a terminal-only wrapper
  that hides owner/generation/revision/nonce bookkeeping. Existing
  `dogfood-install.sh disable|enable|reload` is not suitable because it writes
  persistent configuration.
- User checkpoints are mandatory: approve the recorded baseline and temporary
  production unload; confirm the three diagnostics appear on the selected
  scope; confirm the initial layout; observe each focus/move; confirm exact
  POC unload and client closure; then approve production runtime reload. Any
  owner, identity, eligibility, output/workspace, convergence, or cleanup
  surprise stops the attempt without retry or recovery automation.
- A successful pilot proves only bounded host KWin planning, direct
  geometry/focus actuation, observed convergence, and user-observed jank for
  the disposable trio. A divergence, partial application, or failure to reload
  production proves the failing host boundary only. If production reload fails,
  leave it unloaded, preserve diagnostics and exact residue, and require a new
  user decision before any further runtime action.

## Exact Next Action

    The first user checkpoint is approval of the successful immutable-wrapper
    baseline and the temporary production unload. Do not run suspend, clients,
    planner, adapter, geometry/focus, cleanup, or resume without that explicit
    approval. Preserve all prior retained workdirs/coredumps; no recovery or
    cleanup is authorized by this baseline.

## Host Pilot Feasibility (2026-09-06)

- The requested host-only lifecycle pilot is not feasible through current public
  KWin 6.7.4 APIs without violating its exact production restoration boundary.
  Read-only current-session inspection found `org.kde.KWin` owner `:1.9`, PID
  `3568836`, start tick `13991576`, and
  `isScriptLoaded("plasma-auto-tiler-kwin") == true`. `/Scripting` exposes only
  `isScriptLoaded`, `loadScript`, `loadDeclarativeScript`, `start`, and
  `unloadScript`; `Script0` exposes only `run` and `stop`. Neither object has
  properties or an enumeration that maps a loaded script to plugin ID, source,
  hash, count, or running state.
- `scripts/poc3-host-baseline.sh` records the bounded read-only host baseline
  under `$XDG_RUNTIME_DIR/plasma-auto-tiler-host-pilot/`; it labels object and
  running identity unavailable rather than guessing. `scripts/poc3-host-suspend.sh`
  records the same validated blocker and never sends lifecycle mutation. Their
  fixture suites cover owner/PID/source/load/shortcut drift and unsafe paths.
- Consequently no host planner, client, adapter, geometry/focus, controller,
  cleanup, or resume route is implemented or authorized. No dotfiles/Nix/config
  mutation or rebuild is needed for this blocked result. A future pilot needs a
  separately designed authoritative production source/object restore mechanism;
  it must not infer one from the checkout, `Script0`, or a boolean loaded reply.

## Pragmatic Host Pilot (2026-09-06)

- The user explicitly authorized a bounded pragmatic exception to the preceding
  exact-restoration conclusion. It accepts `isScriptLoaded("plasma-auto-tiler-kwin")`,
  exact plugin-ID unload/reload, one uniquely resolved active Nix-store
  production source/package, exact KWin owner/PID/start-tick/canonical-executable
  pinning, and user-observable behavior as the operational authority. It does
  not claim Script-object-to-plugin/source mapping, duplicate count,
  handler absence, or exact running-state restoration, which KWin 6.7.4 cannot
  prove.
- Static host tooling is implemented and disabled by default: `poc3-host-pilot.sh`
  stages `baseline`, `suspend`, `clients`, `start`, `focus`, `move`, `status`,
  `stop`, `resume`, and `cleanup`; exact host trio, planner, and persistent
  no-ID adapter routes use only direct geometry/focus plus closure-only exact
  cleanup. Production reload is explicit `resume`, never implicit cleanup.
  The routes have no config, dotfiles, Nix rebuild, shortcut, Custom Tile,
  workspace/output mutation, or session-boundary path.
- Static verification passed: Rust tests, TypeScript typecheck/POC3/full tests,
  host shell suites, package/startup checks, shell syntax, and `git diff --check`.
  `cargo fmt --check` passed after formatting the new host-trio Rust tests.
  Full-target Clippy remains blocked only by existing unrelated `src/tray.rs`
  lints (`assertions_on_constants` and `type_complexity`). Independent
  adversarial review findings on delegate/source pinning, KWin/planner
  freshness, runtime-path integrity, status/run acknowledgement, and planner
  XDG isolation were corrected and covered hermetically.
- The sole allowed host operation was `poc3-host-pilot.sh baseline`. It made no
  KWin lifecycle call and stopped fail-closed: `KWin PID 3568836 executable
  identity is unreadable`, so no valid baseline receipt was produced. No
  suspend, client, planner, adapter, geometry/focus, stop, cleanup, or resume
  stage ran. Suspend is not ready; preserve this checkpoint and request a new
  user decision before any read-only diagnosis or runtime action.
- 2026-09-06 read-only diagnosis captured `org.kde.KWin` owner `:1.9`, PID
  `3568836`, and start tick `13991576` before and after the exact-PID proc
  observations. The PID remained running and its proc status/stat were
  readable, but both canonical-readlink attempts for `/proc/3568836/exe`
  failed with permission denied. This directly rules out stale PID, malformed
  PID parsing, observed owner drift, and process exit for this attempt; wrapper
  identity cannot be established from the denied link. The baseline's existing
  fail-closed executable gate is correct, so no production fallback, retry, or
  identity correction was made.
- Focused synthetic coverage now explicitly exercises a valid identity snapshot,
  canonical wrapper path, permission-denied executable, exit between stat and
  executable reads, malformed PID, stale PID, and owner drift. Baseline,
  suspend, and pilot suites passed `69/0`, `93/0`, and `112/0`; relevant shell
  syntax and `git diff --check` passed. Independent review found no PID-race,
  process-authority, permissive-fallback, or accidental-mutation defect.
- One further authorized `bash scripts/poc3-host-pilot.sh baseline` attempt
  again stopped before receipt creation with `KWin PID 3568836 executable
  identity is unreadable` followed by `KWin identity capture is ambiguous`.
  No suspend, production unload/reload, client, planner, adapter,
   geometry/focus, configuration, lifecycle, cleanup, or journal stage ran.
   Suspend remains blocked; no further host action is authorized by this result.

## Immutable Wrapper Baseline (2026-09-06)

- The KWin identity helper now accepts only the exact immutable pair
  `<store package>/bin/kwin_wayland_wrapper` and its derived sibling
  `<same store package>/bin/.kwin_wayland_wrapper-wrapped`. It independently
  pins and records canonical paths, SHA-256 values, device/inode identities,
  and non-writable executable regular-file modes for both files. Readable
  MainPID and direct-parent owner executable identities must agree with the
  wrapped pin. Pair metadata is revalidated after readable proc checks;
  generic `.wrapped`, arbitrary siblings, symlinks, mutable paths, cross-package
  pairs, PATH/profile, argv, and legacy generic-proc receipts refuse.
- Baseline, suspend, and pilot receipts now require the pair compound
  (`store`, `launcher`, `package_root`, and modes) for both ordinary systemd
  and direct-parent identity sources. The generic `exe_source=proc` path is no
  longer accepted, so all successful captures retain the unit and pair gates.
  Existing direct-parent owner/PID/tick/boot/unit/PPid/cgroup gates remain.
- Focused static verification passed: identity `72/0`, compound `39/0`,
  direct-parent `63/0`, baseline `88/0`, suspend `113/0`, and pilot `120/0`.
  Shell syntax and `git diff --check` passed. The required independent review
  found a generic-proc bypass and replacement/mode gaps; the direct corrections
  above were made and covered by the focused suites.
- Exactly one authorized read-only `bash scripts/poc3-host-pilot.sh baseline`
  succeeded. Receipt
  `/run/user/1000/plasma-auto-tiler-host-pilot/baseline.json` records KWin
  owner `:1.9`, owner PID `3568836`, start tick `13991576`, direct MainPID
  `3568829`, boot ID `2e63db46-c4ae-4552-a899-fb864e3cbbc6`, and the exact
  `dnhnbjfygx79an8s30kif7iniawdnqc5-kwin-6.7.4` wrapper package. Launcher and
  wrapped modes are both `555`; the receipt also records their separate
  SHA-256/device/inode pins. Production is `loaded`; KGlobalAccel is
  `verified`; the planner is `absent`. No suspend or mutating pilot stage ran.

## Host Suspension Checkpoint (2026-09-06)

- One authorized `POC3_HOST_PILOT_ALLOW=1 bash
  scripts/poc3-host-pilot.sh suspend` invocation succeeded. Its retained
  `/run/user/1000/plasma-auto-tiler-host-pilot/suspend-receipt.json` records
  `verdict: suspended`, exact plugin `plasma-auto-tiler-kwin`,
  `loaded_before: loaded`, `loaded_after: not-loaded`, `unload_reply: true`,
  and `verified_not_loaded: true`. The exact later-resume binding is its Nix
  package `/nix/store/5z7pcqklpk9x037k9b933snc3a4zq6rw-plasma-auto-tiler-kwin-0.1.0`,
  source `contents/code/main.js`, metadata SHA-256
  `ceb49666a22cd18afa8ab5381eb997df1608dbcfc1bd8049d45823757474903f`, and
  bundle SHA-256 `37688bc5df45ab82f0407fa788322aca364dd13f4c6fc10788f3eda09bbf5f58`.
- Independent read-only verification re-observed `isScriptLoaded` false and
  retained the baseline KWin identity: owner `:1.9`, PID `3568836`, tick
  `13991576`, boot `2e63db46-c4ae-4552-a899-fb864e3cbbc6`, direct parent and
  unit MainPID `3568829`, and the immutable wrapper pair under
  `dnhnbjfygx79an8s30kif7iniawdnqc5-kwin-6.7.4`. Both pair files retained mode
  `555`, device/inode pins, and SHA-256 values
  `a0fad13eff0820be7ba1609d7075e4ee06495c9e75f86ce73fd3bf9e2b755ec7` (wrapped)
  and `0fd0f9c6cb14175700bf6055a30fd9f3d39906ddf8e8743643f5c18f58a24b42`
  (launcher). The owner `/proc/exe` remains unreadable; the accepted
  direct-parent systemd identity is the authority. The baseline checkout bundle
  hash is not comparable to the active package bundle hash because the public
  API provides no checkout-to-loaded-script binding.
- The pilot runtime directory contains only the baseline and suspend receipt;
  no pilot trio, planner, persistent-adapter, or resume record exists. The
  planner name is absent and the relevant checked POC3 KWin plugin names are
  not loaded. Repository status was unchanged from immediately before suspend;
  the tool confines evidence writes to the project runtime directory and has no
  config, dotfile, Nix, shortcut, client, geometry, or focus write path. This
  is evidence of no persistent mutation, not proof about arbitrary external
  filesystem activity.
- The required no-diagnostic-process checkpoint failed: stale nested
  `poc3-diagnostic-client` and `nested-manual-clients.sh launch-diag` processes
  were present under prior `/tmp` workdirs. No attempt was made to clean up,
  launch, or otherwise alter them. The host is deliberately left
  suspended. No client, planner, adapter, geometry/focus, cleanup, or resume
  action is authorized from this checkpoint; stop for user observation.

## Host Trio Staging Attempt (2026-09-07)

- Focused host-trio guard coverage passed `138/0`; host-pilot, baseline, and
  suspend harnesses passed `120/0`, `88/0`, and `113/0`; shell syntax and
  `git diff --check` passed. The guard accepts only exact current diagnostic or
  supervisor executable identities before examining receipt/runtime evidence;
  synthetic coverage includes unrelated historical diagnostics, same-receipt
  claims, PID reuse, runtime overlap, visible host diagnostics, missing
  evidence, non-diagnostic Wayland processes, unreadable unrelated processes,
  and exact owned paths.
- Read-only host observations selected output `eDP-1` and current desktop
  `f18245bc-0b73-4cda-9647-091f85aab333`. The suspend receipt remained
  `suspended`; KWin owner remained `:1.9`/PID `3568836`/tick `13991576` with
  production `isScriptLoaded` false. The pilot base contained only
  `baseline.json` and `suspend-receipt.json`; Planner had no owner.
- `cargo build --bin poc3-diagnostic-client --bin poc3-diag-supervisor`
  completed. The first direct host-trio launch stopped before spawn because
  trio still expected obsolete KWin helper record widths. The causal compound
  identity correction was covered by the focused harnesses.
- The next two direct host-trio launches stopped before receipt creation at
  supervisor identity convergence. Exact read-only inspection after each found
  only the baseline and suspend receipts, no current diagnostic or supervisor
  process using the just-built binaries, no trio/planner/persistent/resume
  record, and no Planner owner. No signal, cleanup, planner, adapter,
  geometry, focus, workspace/output, shortcut, Custom Tile, configuration, or
  production reload action occurred. Production remains suspended under the
  valid receipt.
- Final checkpoint: host trio staging succeeded with receipt
  `/run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt.json`.
  Receipt schema `poc3-host-trio-v1`; scope workspace
  `f18245bc-0b73-4cda-9647-091f85aab333`, output `eDP-1`, alias `scope-1`;
  host `/run/user/1000` / `wayland-0`.
- Supervisor PID/tick `3592922`/`23352227`; client PIDs/ticks
  `3592938`/`23352240`, `3592939`/`23352240`, `3592940`/`23352240`; app IDs
  `org.plasma-auto-tiler.poc3-diag-1/2/3`.
- Read-only `poc3-host-trio.sh validate` reported manifest valid with three
  slots; production `isScriptLoaded` false; Planner owner absent.
- Static evidence: host client/supervisor host-scope argv/path repair tests
  passed Rust diag supervisor `12/0`, host trio `5/0`, host trio script
  `173/0`; syntax/format/diff check passed.
- Prior failure root causes: missing client `--host`/host path mismatch
  repaired, then Nix `env` delimiter after assignments emitted exact
  `env: '--': No such file or directory`; delimiter moved directly after
  `-i` and statically covered.
- No planner, adapter, focus, move, layout, cleanup, resume, config,
  shortcut, workspace/output, or Custom Tile action occurred. Production
  remains suspended under its existing valid receipt.

## Host Planner Initial-Layout Stage (2026-09-07)

- The authorized planner launch attempt through the host-pilot planner delegate
  stopped before context setup or process spawn. Exact command:
  `POC3_HOST_PLANNER_ALLOW=1 bash scripts/poc3-host-planner.sh launch
  /run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt.json`.
  Its terminal result was `error: required tool must be the exact Nix/devenv
  executable: /etc/profiles/per-user/beefsack/bin/jq`. The script resolves the
  unset `JQ_BIN` using `type -P` and checks the literal path before spawn;
  `/etc/profiles/per-user/beefsack/bin/jq` canonicalizes to the Nix-store jq
  binary but does not satisfy that literal-path gate. No override or retry was
  used.
- Before and after the failed attempt, baseline, suspend, and trio records
  agreed with live KWin identity: owner `:1.9`, PID `3568836`, tick
  `13991576`, direct-parent systemd identity for
  `plasma-kwin_wayland.service` MainPID `3568829`/tick `13991575`, and wrapped
  executable
  `/nix/store/dnhnbjfygx79an8s30kif7iniawdnqc5-kwin-6.7.4/bin/.kwin_wayland_wrapper-wrapped`.
  Direct `/proc/3568836/exe` remains permission-denied; the existing
  receipt-bound direct-parent compound identity remains the accepted authority.
- The suspend receipt remains `verdict=suspended`; live
  `isScriptLoaded("plasma-auto-tiler-kwin")` is false. The live trio still
  matches its receipt and scope `f18245bc-0b73-4cda-9647-091f85aab333` /
  `eDP-1`: supervisor `3592922`/`23352227`; diagnostic clients
  `3592938`, `3592939`, and `3592940`, each tick `23352240`, with respective
  app IDs `org.plasma-auto-tiler.poc3-diag-1`,
  `org.plasma-auto-tiler.poc3-diag-2`, and
  `org.plasma-auto-tiler.poc3-diag-3`, slots `1`, `2`, and `3`. Their
  canonical executables match the receipt and none collides with the
  controlling shell.
- Independent post-failure verification found no Planner D-Bus owner,
  planner-service process, planner state/log, persistent-adapter record, or
  loaded `poc3-host-persistent` plugin. The trio receipt contains no geometry,
  focus, completion, or revision fields, and diagnostics contain only initial
  `configure`/`first-map 320x240` records. Thus Rust emitted no tree, no
  revision/focus exists, and no desired or actual initial-layout rectangles
  exist. The source slot colors remain red `0xFFC02020`, green `0xFF20A020`,
  and blue `0xFF2040C0`; they were not re-applied in this stage.
- Terminal exclusion is established only by non-collision with the receipt
  PIDs. The pre-stage host baseline has no authoritative window list, so
  unchanged unrelated windows cannot be machine-proven; no unrelated-window
  enumeration or mutation was performed. Leave the three clients and
  supervisor running for the user's observation, keep production suspended,
  and do not run start, focus, move, status, cleanup, or resume from this
  checkpoint.
- Static correction: `poc3-host-planner.sh` now resolves the current
  per-user-profile `jq` symlink through the validated Nix canonicalizer and
  executes only its pinned regular `/nix/store` final. Non-store finals,
  swapped links, loops, directories, wrong executable names, and unpinned
  profile execution fail closed before planner state/log creation or spawn.
  Focused hermetic checks passed: host planner `111/0`, host pilot `120/0`,
  canonical tooling `185/0`, shell syntax, and `git diff --check`; independent
  tool-substitution/TOCTOU review found no related issue. No planner retry or
  other live action occurred. The visible trio remains clients `3592938`,
  `3592939`, `3592940` under scope
  `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`, and production remains
  suspended.

## Host Planner Retry Revalidation (2026-09-07)

- The one authorized corrected planner-stage preflight,
  `POC3_HOST_PLANNER_ALLOW=1 bash scripts/poc3-host-planner.sh validate
  /run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt.json`, exited
  `1` before launch with `unit MainPID 3568829 does not match KWin PID
  3568836`, then `KWin systemd identity capture is ambiguous` and `KWin
  identity capture is ambiguous`. No launch, post-launch validation, planner
  stop, or retry ran. No planner state or log was created, so planner-only
  cleanup was neither eligible nor performed.
- Independent read-only review confirmed no live identity drift from the trio
  receipt: KWin owner `:1.9`, PID/tick `3568836`/`13991576`, direct parent
  `3568829`/`13991575`, boot ID
  `2e63db46-c4ae-4552-a899-fb864e3cbbc6`, active
  `plasma-kwin_wayland.service`, and immutable wrapper pair all match. The
  owner's `/proc/exe` remains permission-denied, while the readable MainPID
  wrapped executable matches the recorded canonical path, SHA-256,
  device/inode, and mode. Production remains `verdict=suspended` with live
  `isScriptLoaded("plasma-auto-tiler-kwin") == false`.
- The block is a source-level fail-closed contract mismatch, not a host-state
  surprise. `poc3-host-kwin-identity.sh` documents and emits 21-line systemd
  and 25-line direct-parent wrapper-pair identities, but
  `poc3-host-planner.sh` still requires 14 and 18 lines respectively in
  `kwin_identity_once` and its detail re-captures. The valid direct-parent
  identity therefore rejects before planner spawn.
- The visible trio remains exact and untouched: supervisor
  `3592922`/`23352227`; clients `3592938`, `3592939`, and `3592940`, each
  tick `23352240`, with the recorded slot/app-ID bindings on
  `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`. The Planner service has
  no owner, `host-trio-receipt.planner.json`, `host-planner.log`, persistent
  adapter record, and `poc3-persistent-adapter` loaded plugin are absent.
  Trio and diagnostic logs retain only connect/configure/first-map/ready
  evidence; no planner request, revision, geometry, focus, movement, adapter
  load, status, cleanup, or production resume occurred.

## Host Planner Parser Correction And Launch (2026-09-07)

- Static correction: `poc3-host-planner.sh` now consumes the shared identity
  helper's exact 21-field systemd and 25-field direct-parent records, including
  the wrapper-pair launcher and mode fields. It rejects truncated, extra, and
  legacy 14/18-field records and carries the full canonical mapping through
  receipt validation, KWin re-capture, and planner state.
- Focused hermetic verification passed: planner identity `85/0`, planner
  `111/0`, host trio `173/0`, and shared identity `72/0`; relevant shell
  syntax and `git diff --check` passed. Independent review found no shifted
  field, stale width, or malformed-record acceptance defect. It identified
  incomplete mapping assertions, which were expanded to cover every 21/25
  identity field in both systemd and direct-parent planner state records.
- Read-only pre-launch validation passed for
  `/run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt.json`: the
  direct-parent KWin compound pin, suspended production, and exact live trio
  were valid; Planner had no owner or record. The expected direct-parent
  fallback emits the harmless rejected same-PID systemd diagnostic before its
  accepted direct-parent capture.
- The one authorized launch attempt,
  `POC3_HOST_PLANNER_ALLOW=1 bash scripts/poc3-host-planner.sh launch
  /run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt.json`, exited
  `1` after writing only `host-planner.log` with
  `env: '--': No such file or directory`, then failed
  `could not capture planner executable identity`. No planner process identity,
  D-Bus owner, readiness record, or `host-trio-receipt.planner.json` was
  created, so no exact planner-only cleanup was eligible and none ran.
- Post-failure read-only validation again passed with no planner recorded.
  Production remains suspended (`isScriptLoaded` false); the retained suspend
  receipt records `loaded_after: not-loaded` and `verified_not_loaded: true`.
  The untouched trio remains supervisor `3592922`/`23352227` and clients
  `3592938`, `3592939`, `3592940`/`23352240` under
  `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`. No planner request,
  adapter, layout, focus, move, status, cleanup, resume, or production action
  occurred.

## Current Exact Next Action

- Static correction: the host planner child now uses the Nix-compatible
  `env -i ASSIGNMENT... EXECUTABLE ARGV...` form with no delimiter after its
  assignments. The pinned `setsid`, pinned `env`, exact planner executable,
  and all nine explicit child environment assignments remain unchanged.
  Focused host-planner coverage passes `129/0` and host-pilot coverage passes
  `120/0`; shell syntax and `git diff --check` pass. The planner regression
  uses the current `env`, verifies all assignments and no ambient leakage,
  keeps injection-like environment and argv payloads literal, and proves the
  obsolete delimiter form fails.
- One authorized planner launch succeeded. The retained planner state binds
  service `org.plasmaautotiler.Planner`, unique owner `:1.1481`, PID
  `3721096`, start tick `26266852`, and exact executable
  `/home/beefsack/Development/plasma-auto-tiler/target/debug/plasma-auto-tiler`.
  Post-launch planner and trio validation passed against the existing receipt
  scope `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`; KWin remains
  `:1.9`/`3568836`/`13991576` and production remains suspended.
- No planner request, adapter, start, focus, move, layout, status, stop,
  cleanup, resume, or production action occurred. Leave the planner and trio
  running. User checkpoint required before any later lifecycle or planning
  action.

## Host POC Start Prevalidation Failure (2026-09-07)

- Worker 1 did not invoke persistent POC3 `start`. Prevalidation typed planner
  readiness failed while Planner owner/PID/tick/exe `:1.1481` / `3721096` /
  `26266852` /
  `/home/beefsack/Development/plasma-auto-tiler/target/debug/plasma-auto-tiler`
  was live: `EvaluatePoc3 status` returned `Call failed: Input/output error`.
  No retry or other lifecycle command ran. No initial layout succeeded.
- KWin direct-parent identity remains owner `:1.9`, PID/tick
  `3568836`/`13991576`, parent `3568829`/`13991575`, boot ID
  `2e63db46-c4ae-4552-a899-fb864e3cbbc6`; live
  `isScriptLoaded("plasma-auto-tiler-kwin")` false and suspend verdict remains
  suspended.
- Trio receipt `/run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt.json`,
  scope `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`: supervisor
  `3592922`/`23352227`; slots 1-3 clients `3592938`, `3592939`, `3592940`,
  each tick `23352240`, with expected app IDs/slots; all live and
  receipt-pinned.
- Absent: no `host-trio-receipt.host-persistent.json`, adapter record/bundle,
  typed v3 completion/status, revision/tree/focus, desired/actual rectangles,
  convergence/latency/divergence record, or post-map geometry/focus
  application. Diagnostic logs retain only initial `first-map 320x240` /
  configure evidence.
- Baseline captured no terminal or unrelated window list/rectangles, so
  unchanged unrelated window geometry cannot be machine-proven. Terminal
  exclusion was only PID noncollision.
- Leave trio/planner running, production suspended; no later lifecycle action
  is identified in this outcome.

## Host Planner Readiness Recovery (2026-09-07)

- One read-only diagnosis bound the stale planner receipt to live owner
  `:1.1481`, PID/tick `3721096`/`26266852`, and the receipt-pinned debug
  executable SHA-256/device/inode. Peer Ping and `Planner1` introspection,
  including `EvaluatePoc3(s)->s`, passed, but one typed
  `EvaluatePoc3 {"v":3,"command":"status"...}` call returned
  `Call failed: Input/output error`. The bounded planner log contained only
  the older `env: '--': No such file or directory` launch residue and no
  current planner stderr. KWin's accepted direct-parent identity and the
  exact live trio remained pinned.
- One exact receipt-validated planner-only stop cleared PID `3721096` and
  its owner/record. One replacement launch then recorded owner `:1.1545`,
  PID/tick `3725709`/`26386645`, with the same receipt-pinned executable
  SHA-256/device/inode. The replacement's Peer Ping and `Planner1`
  introspection passed, but its sole typed readiness call again returned
  `Call failed: Input/output error`.
- A fresh independent read-only check confirmed the replacement owner-to-PID
  mapping, process identity, Peer/introspection, and a third typed readiness
  result of `Call failed: Input/output error`. The stale PID is absent. Trio
  supervisor `3592922`/`23352227` and slots `3592938`, `3592939`, and
  `3592940`/`23352240` remain receipt-pinned with only initial map evidence;
  no geometry/focus, adapter, or POC3 command occurred. Production remains
  suspended and both production and persistent-adapter plugins are unloaded.
  KWin remains `:1.9`/`3568836`/`13991576` with direct parent
  `3568829`/`13991575`.
- The stale-process hypothesis is rejected at medium confidence: the failure
  is an unresolved in-process Planner dispatch path, not owner, process,
  interface, KWin, trio, or executable-identity drift. No further diagnosis,
  retry, planner cleanup, or production action is authorized by this outcome.

## Precomputed Host Intent Bypass (2026-09-07)

- The failed replacement Planner was stopped only after the retained host-trio
  receipt and planner state revalidated PID `3725709`, start tick `26386645`,
  executable, and D-Bus owner `:1.1545`. Its PID, state record, and Planner
  owner are now absent. The exact red/green/blue trio remains receipt-pinned
  and visible on `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`; production
  remains suspended. No layout, focus, move, cleanup, or production action ran.
- The live Rust Planner IPC is intentionally bypassed for this test method.
  `test-fixtures/poc3-host-pilot-v1.json` is a versioned Rust-engine export
  locked at 4690 bytes and SHA-256
  `b7e7b865800e0f085610cf04a637a070d8ec01f7dde5c0bec13f508480a07257`.
  It supplies start `H[A,V[B,C]]` focused `A`; focus-right to `B`; and
  move-down `swap/R2a` to `H[A,V[C,B]]` focused `B`, including shares,
  preconditions, operation identity, and canonical fixture rectangles.
- The test-only `poc3-host-pilot-action.sh` route byte-locks the exact fixture,
  freshly validates KWin/receipt/trio/scope, loads one exact KWin script per
  action, calculates current-work-area rectangles only from the emitted shares,
  writes the three receipt-owned windows sequentially, focuses only the emitted
  slot, observes bounded convergence, and exact-unloads the returned script ID
  including `Script0`. Completion evidence is cursor-bounded and KWin-PID
  scoped, not a broad journal query. `status` is read-only and `stop` remains
  existing trio-only cleanup.
- Static evidence: fixture tests 2/2, `cargo fmt --check`, targeted Clippy,
  KWin typecheck, action harness 114/0, host-pilot harness 120/0, package
  contract, and `git diff --check` pass. Independent review found no arbitrary
  window, scope, lifecycle, partial-apply, focus-leakage, config-mutation, or
  planner-dependency defect. Its builder byte-lock finding was corrected and
  reverified. User observation remains the intended jank measurement; no
  telemetry claim is added.
- Earliest next checkpoint: separately authorize only `start` for the current
  exact receipt-owned trio after a fresh validation passes. Do not run it in
  this unit.
- Final read-only revalidation found the recorded supervisor and all three
  clients still live at their recorded start ticks; production remains unloaded
  and the Planner owner remains absent. `poc3-host-trio.sh validate` currently
  fails closed because the supervisor executable identity is unreadable. No
  signal, layout, focus, or cleanup was performed. This validation failure
  blocks the later separately authorized `start` until it is independently
  resolved or revalidated.

## Receipt-Bound Supervisor Fallback And Host Start Checkpoint (2026-09-07)

- Static correction: the host-pilot action guard now permits an unreadable
  `/proc/<supervisor>/exe` only for receipt role
  `host-pilot-diag-supervisor`. It requires exact recorded supervisor
  PID/start-tick/boot-ID/parent-or-service/cwd/runtime namespace/UID and a
  non-zombie live process. All three clients must remain independently readable
  and exactly bind receipt PID/start-tick/canonical executable/SHA-256/device/
  inode/app-ID/slot/parent/UID. Readable supervisor disagreement, unreadable or
  zombie clients, all identity drift, and KWin/planner/client/production roles
  refuse. Receipt capture records the required supervisor and client bindings;
  supervisor launch capture also live-binds hash/device/inode.
- Focused evidence: host-pilot-action `150/0`, host-trio `202/0`, host-pilot
  `120/0`; Rust host-trio `12/0`, host-pilot fixture `2/0`, trace fixture lock
  `1/0`; focused TypeScript `37/0`; `npm run typecheck`, touched-shell syntax,
  and `git diff --check` passed. Independent review found no broad identity
  relaxation after the supervisor device, launch live-binding, receipt
  re-read, and readability-flap refusals were added. The direct readable path
  retains its existing narrower canonical-executable checks.
- Final read-only host checkpoint did not authorize a start. KWin compound
  identity exactly matched receipt: owner `:1.9`, PID/tick
  `3568836`/`13991576`, direct parent `3568829`/`13991575`, boot
  `2e63db46-c4ae-4552-a899-fb864e3cbbc6`, and the recorded immutable wrapper
  pair. `isScriptLoaded("plasma-auto-tiler-kwin")` returned false; the Planner
  name had no owner. Current desktop/output matched receipt scope
  `f18245bc-0b73-4cda-9647-091f85aab333` / `eDP-1`.
- The retained supervisor `3592922`/`23352227` and clients
  `3592938`/`3592939`/`3592940`, each client tick `23352240`, remain live with
  their recorded app-ID/slot bindings, but all four `/proc/<pid>/exe` links end
  in ` (deleted)`. Current on-disk supervisor SHA-256/inode
  `0d7586a6...`/`7248751` differs from receipt `5e77c190...`/`7242193`; current
  client SHA-256/inode `c8750208...`/`7248764` differs from receipt
  `58383fbc...`/`7242233`. `poc3-host-trio.sh validate` exited 1 with
  `supervisor executable identity is unreadable`.
- No KWin script was loaded, run, or unloaded. No start, geometry, focus, move,
  planner, adapter, cleanup, resume, or production action occurred. Expected
  fixture start rectangles remain red A `(0,0 446x600)`, green B
  `(454,0 446x296)`, and blue C `(454,304 446x296)` with focus A; actual
  rectangles/focus, convergence, and terminal/unrelated-window impact are not
  established. The trio remains live and visible for user observation; visual
  result is pending. Exact next action: none for this checkpoint.

## Host Fresh-Launch Precondition Block (2026-09-07)

- Before any fresh client launch, the old visible trio was revalidated against
  its receipt: supervisor `3592922`/`23352227` and slots
  `3592938`/`3592939`/`3592940`, each client tick `23352240`, with the fixed
  diagnostic app IDs and slots. All four live executable links were the
  receipt paths suffixed ` (deleted)` after rebuild. Exact identity-bound
  cleanup sent TERM then, only after a second matching identity check, KILL to
  each client; TERM alone removed the supervisor. All four PIDs are absent
  afterward. No terminal or other PID was signalled; the old receipt and
  diagnostics remain preserved.
- Current diagnostic-client and supervisor binaries were built and copied to
  `/run/user/1000/plasma-auto-tiler-host-frozen/` as mode-555 content-addressed
  references. The current client hash is `c8750208...ef866b7`; the supervisor
  hash is `0d7586a6...50cb0`. The Rust fixture remains 4690 bytes with SHA-256
  `b7e7b865800e0f085610cf04a637a070d8ec01f7dde5c0bec13f508480a07257`.
- A causal static correction removed the false distinct-start-tick requirement
  from the host action builder and KWin parser. Distinct PID, app ID, and slot
  are retained; each tick remains a positive per-PID reuse binding and may
  match another simultaneously spawned client. Focused KWin action tests,
  TypeScript typecheck, and the host-action shell harness passed. No live
  process or KWin action ran during this correction.
- The requested no-post-launch-build start cannot be executed by the current
  route without changing its identity architecture. The one-shot bundle bakes
  the trio PID/tick/app-ID receipt into esbuild defines, but the fresh PIDs do
  not exist until after launch. KWin receives only an arg-less `run()` and the
  current script has no safe filesystem or runtime receipt ingress. A generic
  prebuilt bundle would lose the exact PID/tick binding and could enroll an
  unrelated same-app-ID window, which is forbidden. No fresh trio was launched
  because the mandated already-generated, receipt-bound start artifact cannot
exist first. Production remains suspended (`isScriptLoaded` false), Planner
   has no owner/state, and no POC script is loaded.

## Host Start Checkpoint frozen3 (2026-09-07)

- 2026-09-07 host start checkpoint, fail-closed before actuation. Frozen3 receipt
  `/run/user/1000/plasma-auto-tiler-host-pilot/host-trio-receipt-frozen3.json`,
  sha256 `46f127eff2b69f7840676e33a3e49745da2a90e27522e432429be39e7db9c279`,
  remained valid. KWin owner `:1.9`, PID/tick `3568836`/`13991576`, direct
  parent `3568829`/`13991575`; allowed systemd direct-parent fallback due
  `/proc/3568836/exe` EACCES. Production query false, Planner has no owner,
  Script0 absent, persistent and pilot plugins false.
- Receipt trio validate passes with exact client IDs `162172`, `162173`,
  `162174`, ticks `27518182`, app IDs slots 1-3; supervisor `162156` tick
  `27518169`; scope `f18245bc-0b73-4cda-9647-091f85aab333`/`eDP-1`/`scope-1`;
  client hash/dev/inode `d288202b...`/`71`/`478`; supervisor
  `97781cea...`/`71`/`479`. Live supervisor PPID `3568616` differs from
  receipt PPID `160446`, but not a receipt validator pin.
- Exactly one start bundle was generated using fixed fixture sha
  `b7e7b865800e0f085610cf04a637a070d8ec01f7dde5c0bec13f508480a07257`
  (4690 bytes) and template sha
  `04e9f74b8def14630122ee3dded06f33a340962b2ec9b89421786549a9a45760`;
  bundle+sidecar sha
  `c0f312087dc1fd507e2690be67879c92638fc87d5896d339558fabebb0449487`, binds
  three IDs/ticks/app IDs/scope and start H[A,V[B,C]].
- Sole start command stopped before loadScript with exact error
  `error: required tool must be the exact Nix/devenv executable: /etc/profiles/per-user/beefsack/bin/jq`;
  no script ID, no Script0, run, unload, geometry/focus, latency/convergence,
  or consume harness. No regeneration/retry/recovery occurred. Reference
  expected projection is A `(0,0 446x600)`, B `(454,0 446x296)`, C
  `(454,304 446x296)`, focus A; actual rectangles/focus unavailable because no
  POC status/complete observation exists.
- Unrelated terminal/shell excluded by exact app-ID/PID receipt allowlist; trio
  was left untouched. Production remains false, planner absent, POC residue
  absent. User visual observation remains pending. Exact next action is none
  under this checkpoint/fail-closed result.
- Final surgical correction: action-route `jq` now canonicalizes profile
  symlinks to the pinned immutable Nix-store final and executes only that pin;
  focused coverage for valid profile/non-store/swap/loop passed
  (`poc3-host-pilot-action.test.sh` 191/0, bash/node syntax checks).
- Pre-start revalidation passed: production suspended, frozen3 trio intact and
  identity/hash/dev/inode-bound, planner absent, no POC script.
- Exactly one bundle generation and exactly one `start` attempt on 2026-09-07.
  Bundle hash `2e6afc8ab5aef194b758fba249e72a180a293cbdc927e4be7c1992189ec82256`.
- It failed closed pre-load (zero load/run/unload/geometry/focus writes)
  because `verify_start_bundle_binding` broadly rejects `__POC3_START_` that
  remains in a generated comment despite all four concrete placeholders being
  substituted. Script0 was never accepted/created.
- Post review confirmed trio/production unchanged, actual
  geometry/focus/convergence unavailable, retained bundle+sidecar are ignored
  residue. No retry, no production resume, no focus/move; layout remains
  user-owned.
- Exact next action: none live. A separately authorized static correction is
  needed before any fresh start authorization.

## Manual One-Shot Precheck (2026-09-07)

- The user-authorized direct POC precheck found PIDs `3592938`, `3592939`, and
  `3592940` absent (`kill -0` returned `No such process` for each; `ps` returned
  no rows). The exact PID/app-ID trio requirement therefore failed before a
  KWin window query.
- No script was generated, loaded, run, or unloaded. No geometry, focus,
  workspace/output, Custom Tile, production, or unrelated-window mutation
  occurred. The user must relaunch the exact diagnostic trio and provide its
  new PID/app-ID bindings before another one-shot layout attempt.

## Host Resize-Aware Isolated Namespace Run (2026-09-07)

- Runtime namespace: `/run/user/1000/plasma-auto-tiler-host-poc-f57ae4eff231bc2fe6685fb44038cb2d`.
  The launch receipt records KWin owner/PID/tick `:1.9`/`3568836`/`13991576`,
  direct-parent source, scope `f18245bc-0b73-4cda-9647-091f85aab333`/`eDP-1`,
  display `wayland-0`, and supervisor `509390`/`28326302`.
- Fresh client receipt IDs were slot 1 `509404` / `org.plasma-auto-tiler.poc3-diag-1`,
  slot 2 `509405` / `org.plasma-auto-tiler.poc3-diag-2`, and slot 3 `509406` /
  `org.plasma-auto-tiler.poc3-diag-3`. `kill -0` succeeded for the three
  clients and supervisor after the one-shot.
- Before the write, `isScriptLoaded("plasma-auto-tiler-kwin")` returned `b false`.
  The one IIFE used the literal PID/app-ID pairs, required exactly one normal,
  managed, resizable matching KWin window for each pair, then required one
  common output/current desktop before its first geometry write.
- KWin completion marker: `plasma-auto-tiler:poc3-host-poc:f57ae4eff231bc2fe6685fb44038cb2d:applied:A=0,44,764,980;B=772,44,764,486;C=772,538,764,486;focus=A`.
  The observed work area was `0,44,1536,980`; expected and reported rectangles
  were red A `(0,44 764x980)`, green B `(772,44 764x486)`, blue C
  `(772,538 764x486)`, focus A.
- `loadScript` returned `i 0`; `/Scripting/Script0` ran; `unloadScript` for
  `poc3-host-poc-f57ae4eff231bc2fe6685fb44038cb2d` returned `b true`; exact
  object introspection failed after unload. Load-through-unload elapsed `3021`
  ms.
- Resize diagnostics recorded slot 1 configure serial `10520` at `764x980`,
  slot 2 serial `10518` at `764x486`, and slot 3 serial `10519` at `764x486`,
  each followed by `first-map` at the same dimensions.

## Host Visual Evidence And Interaction Observations (2026-09-07)

- The user physically observed the completed isolated host POC as red left,
  green upper-right, and blue lower-right. The 8 px gaps looked consistent and
  good. Red was initially focused, and focus later changed through user
  interaction. The user observed no unrelated window move or other effect and
  judged the result very successful.
- Machine evidence for that one-shot agrees: requested and read-back geometry
  matched, every resize-aware diagnostic client rendered its matching configure
  size, `Script0` unloaded, and production remained suspended. This accepts the
  bounded direct-geometry/focus projection and client resize response. It does
  not accept production tiling, Custom Tile association, keyboard/pointer
  interaction, automatic reconciliation, or stock-KWin parity.
- The user observed no apparent pointer resize handles on the POC windows and
  no keyboard resize control exposed by this POC. The user also Super-dragged
  one window; it remained detached where dropped and did not automatically
  retile or reconcile. These are accepted interaction observations, not proof
  of their cause or of an engine limitation.
- The current trio remains available but may no longer satisfy the fixture
  source geometry or focus after those user interactions. Do not assume it is
  eligible for the precomputed focus or move action without a newly authorized
  read-only validation and source-state check.

## Host Read-Only Checkpoint fresh (2026-09-07)

- Read-only validation only: no move/focus/resize/close, no config/shortcut/
  workspace/output mutation. KWin owner `:1.9`, PID/tick `3568836`/`13991576`
  (direct parent `3568829`, matching `plasma-kwin_wayland.service` MainPID;
  systemd-direct-parent topology as in prior receipts), verified identical
  before and after the probe. Production `isScriptLoaded
  ("plasma-auto-tiler-kwin")` false; planner `org.plasmaautotiler.Planner`
  has no owner; `isScriptLoaded` false for `poc3-host-pilot-action`,
  `poc3-host-persistent`, and `poc3-host-poc-f57ae4eff231bc2fe6685fb44038cb2d`;
  `/Scripting/Script0` absent before and after.
- Fresh trio receipt
  `/run/user/1000/plasma-auto-tiler-host-poc-f57ae4eff231bc2fe6685fb44038cb2d/host-trio-receipt.json`:
  supervisor `509390`/`28326302`, clients slot 1 `509404`, slot 2 `509405`,
  slot 3 `509406`, all tick `28326312`, app IDs
  `org.plasma-auto-tiler.poc3-diag-1/2/3`. All four PIDs alive via `kill -0`
  with matching `/proc` ticks and receipt-bound exe readlinks. Frozen3 PIDs
  `162156`/`162172`/`162173`/`162174` absent; frozen3 receipt is historical
  only.
- Window/probe evidence: D-Bus `queryWindowInfo` enters interactive picking
  (timed out, avoided), so one temporary read-only IIFE was unavoidable. It
  performed zero property writes (no `frameGeometry`/`activeWindow` assignment,
  no timer). `loadScript` returned `i 0`; exact `/Scripting/Script0`
  introspected (`org.kde.kwin.Script` with `run`/`stop`); only it was run;
  `stop` exited 0; `unloadScript` under the probe plugin names returned
  `b false` while `/Scripting/Script0` is absent and all probe
  `isScriptLoaded` checks are false (no residue per the public API); temp file
  removed. Journal tag `plasma-auto-tiler:readonly-probe-20260907` under KWin
  PID `3568836`.
- Current KWin state: exactly one normal/managed/resizeable window per
  PID/app-ID pair; all on output `eDP-1`, desktop
  `f18245bc-0b73-4cda-9647-091f85aab333` (equals `workspace.currentDesktop`);
  work area `0,44,1536,980`, unchanged from the one-shot, so no expectation
  adjustment. Internal IDs `{acafc7ad-...}`, `{16b29f04-...}`,
  `{e4e5ea89-...}` bound to slots A/B/C.
- Rectangles match the fixture exactly: red A `(0,44 764x980)`, green B
  `(772,44 764x486)`, blue C `(772,538 764x486)`. No drag drift in geometry.
- Focus drift (reported, not corrected): `workspace.activeWindow` is Ghostty
  PID `3569285`, none of the trio active; fixture focus A is not satisfied.
  Consistent with the user-interaction observation above.
- Verdict: geometry-valid but focus-source-invalid for any precomputed
  A-sourced action. `focus right` cannot safely run next. Exact next action:
  none live; a separately authorized refocus-to-red plus revalidation is
  required before any focus/move attempt.

## Host Focus-Right And Move-Down Accepted Evidence (2026-09-07)

- User-accepted direct exact-trio projection only, for the isolated host trio.
  Initial layout: red left, green upper-right, blue lower-right, with
  consistent gaps and no unrelated movement.
- `focus right` accepted: green focused with no geometry change.
- `move down` accepted: green/blue swap while green remained focused, with no
  observed delay, flicker, or jank; gaps stayed consistent with no unrelated
  movement.
- Reported machine evidence for `move down` only: completion about 81ms post
  request, exact post geometries matched, and Script0 unloaded.
- Interaction latency is unaccepted: the user did not personally execute the
  command.
- Current state: red left, blue upper-right, green lower-right and focused;
  production remains suspended.
- No production, Custom Tile, interaction-latency, reconciliation, or parity
  claim is accepted.

## Host Keyboard POC Recovery Check (2026-09-07)

- After the host KWin restart, the exact production plugin
  `plasma-auto-tiler-kwin` was observed loaded, unloaded through the public
  `/Scripting` API, and rechecked not loaded. Production is suspended; no
  configuration was written.
- The fresh resize-aware trio launch stopped before spawning: its guard found
  the exact prior project supervisor `509390`/`28326302` still live on
  `wayland-0`, while its recorded clients `509404`/`509405`/`509406` are
  absent. No fresh trio, geometry/focus write, bundle build, KWin shortcut
  script, KGlobalAccel action, or shortcut invocation occurred.
- No keyboard POC setup is accepted. The exact prior trio receipt is
  `/run/user/1000/plasma-auto-tiler-host-poc-f57ae4eff231bc2fe6685fb44038cb2d/host-trio-receipt.json`.

## Host Keyboard POC Setup Stop Block (2026-09-07)

- The required exact stale-supervisor stop was attempted once with the recorded
  receipt and pinned canonical jq:
  `POC3_HOST_TRIO_ALLOW=1 JQ_BIN=/nix/store/xvd6920kffyyshg7mbw5wvfk6lg9wfkl-jq-1.8.2-bin/bin/jq bash scripts/poc3-host-trio.sh stop --runtime-dir /run/user/1000/plasma-auto-tiler-host-poc-f57ae4eff231bc2fe6685fb44038cb2d /run/user/1000/plasma-auto-tiler-host-poc-f57ae4eff231bc2fe6685fb44038cb2d/host-trio-receipt.json`.
  It refused before any signal with `error: KWin unique owner drift detected;
  refusing ambiguous trio scope`.
- Independent read-only verification found receipt-bound supervisor
  `509390`/`28326302` still live with its exact recorded executable, while
  clients `509404`, `509405`, and `509406` remain absent. The production plugin
  remains not loaded. No fresh namespace, trio, layout, focus, shortcut script,
  build, cleanup, or production action ran.

## Temporary Keyboard POC Accepted Manual Evidence (2026-09-07)

- The user physically completed a temporary keyboard POC after the prior setup
  stop. The initial `H[A,V[B,C]]` layout and the `H[A,V[C,B]]` move-down swap
  were correct. The moved active window retained focus; gaps were consistent;
  no unrelated windows visibly moved; and keyboard movement felt effectively
  instant, with no perceived delay.
- Screenshot
  `/home/beefsack/Pictures/Screenshots/Screenshot_20260907_172658.png` is
  accepted user visual evidence of A full-height at left, B upper-right, C
  lower-right, bright pink wallpaper at exposed boundaries, and the purple
  native active border. It depicts the initial layout, not the later swap.
- This accepts only user-observed keyboard delivery and direct three-window
  geometry/focus projection feasibility. It supplies no machine proof for the
  temporary script's identity, exact scope, invocation, convergence, latency,
  or unload, and does not change the POC3 no-shortcut contract above.
- The apparent lack of an outer gap is consistent with the current projection:
  the usable work-area rectangle is used at its outer edges and the fixed 8 px
  gap is deducted only between sibling rectangles. It is not classified as a
  defect from this screenshot; the earlier outer-gap observation is outside
  this POC's focus.
- The user then physically completed keyboard split-share resize with A Ghostty
  at left, B Ghostty upper-right, and C Kate lower-right. Resize behavior was
  effectively perfect: neighbours reflowed correctly, gaps stayed consistent,
  and focus or unrelated-window effects were not reported.
- Infrequently while growing A rightward, B shrank for one frame before A grew,
  exposing an instantaneous bright-pink wallpaper flash. The bright wallpaper
  made it highly visible. This is likely sequential, non-atomic geometry
  application, but manual evidence alone does not classify it as a defect.
- An earlier accidental native pointer resize of Kate did not trigger the
  generated POC. A later normal-mode manual top-edge Kate C drag with the
  minimal lexical-workspace Script2 reported loaded reflowed Ghostty B in real
  time, subjectively smooth with a tiny acceptable lag; no A movement, gap, or
  focus anomaly was reported. This accepts one manual/visual continuous-neighbor
  reflow observation only, not machine-verified scope, focus, geometry, timing,
  atomicity, or generated-plugin behavior. Pointer reconciliation, drag-end
  reconciliation/drop placement, window lifecycle, workspace/output behavior,
  Rust transport/runtime integration, production completeness, and reliability
  remain unaccepted. Do not add product hardening to this POC.
- Production remains suspended. The temporary POC shortcut script remains
  loaded; preserve current host state. Any exact unload, production resume, or
  additional live test needs separate explicit user authorization.
- Recommended next action: none live without separate explicit authorization to
   verify and unload the temporary script, then freshly revalidate the trio, KWin,
   and production-not-loaded state. Only after that, separately authorize one
   drag-end snap-back where the engine reasserts the last accepted rectangles; do
   not implement or test drop-based tree reorganization in this POC.

## Final Manual Evidence And Cleanup (2026-09-07)

- The final direct lexical-workspace gesture-mode observation distinguished move
  from resize: while Kate C moved, Ghostty B stayed fixed; C followed the
  pointer and snapped back to its engine-owned lower-right rectangle on release.
  The user reported no jank, unrelated movement, focus/gap failure, or A
  movement. This is manual/visual evidence only, with no retained script
  identity, enrollment, event/write counts, readback, timing, or atomicity
  proof.
- Accepted POC claims are limited to the observed three-window initial layout,
  directional focus, B/C structural swap, split-share keyboard resize,
  continuous pointer neighbor reflow, and move-versus-resize gesture separation.
  The rare one-frame pink-wallpaper flash is accepted as a visually exaggerated
  sequential non-atomic geometry artifact; its cause is not proven.
- The generated pointer-plugin zero-write result, marker absences, QUuid string
  mismatch, lagging-frame guard, and pure move-model assertion failure are test
  harness failures or indeterminate diagnostics, not architecture evidence.
- Cleanup revalidated the live KWin session, unloaded `pat-pointer-reconcile`
  and `pat-reconcile-reset-20260907`, and verified absent
  `pat-pointer-debug-20260907`, `pat-pointer-resize-20260907-r571321`,
  `pat-live-resize-20260907-p554898`, and `pat-live-poc-20260907`; no recorded
  POC swap/action plugin was loaded. All exact recorded POC
  planner/supervisor/client processes were absent. It then resumed
  `plasma-auto-tiler-kwin` from
  `/nix/store/5z7pcqklpk9x037k9b933snc3a4zq6rw-plasma-auto-tiler-kwin-0.1.0/share/kwin/scripts/plasma-auto-tiler-kwin/contents/code/main.js`:
  `loadScript` returned `2`, `run` succeeded, and `isScriptLoaded` returned
  true. This is operational resume evidence, not a new receipt or exact
  in-memory source-attribution proof. User windows were neither closed nor
  manually repositioned.
- This POC is complete and archived as reference. It establishes neither
  production behavior, Custom Tile preservation, Rust service transport,
  lifecycle/recovery, workspace/output behavior, drop reorganization, full
  reconciliation, reliability, parity, configure acknowledgement, nor measured
  latency.
