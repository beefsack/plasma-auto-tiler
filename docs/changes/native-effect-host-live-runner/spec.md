# Specification: Native Effect Host Live Runner

Ownership and approval:
- Owner: Lead
- Status: Expanded, approved 2026-08-16 by the user for planning.

## Intent and Scope

Deliver a separate, user-run-only host-validation runner/protocol for the exact
native active-border effect. It is never a host mode in the nested runner; the
nested/private validation path remains the default and is unchanged. The host
runner exercises only the exact plugin lifecycle against the user's running
host KWin, bounded to a user-local install/load scope, with an exact state
snapshot and guaranteed rollback.

The host path proceeds only after read-only feasibility establishes: the
running host KWin executable/package identity, matching build/development ABI
provenance, the proven host plugin search path, and dynamic discovery plus
load/unload without restarting or replacing KWin. It fails closed whenever
exact compatibility or rollback cannot be established; a displayed semantic
version alone is insufficient.

In scope:

- Read-only feasibility protocol against the running host KWin and its exact
  package/build identity and ABI provenance.
- A separate user-run host runner/protocol (never a host mode in the nested
  runner) with `--dry-run` and refusal paths.
- Exact user-local plugin lifecycle only: atomic snapshot/install, hash/path
  manifest, preservation of prior file/config/load state, unload before
  removal, restore and verify, and INT/TERM cleanup with no false cleanup
  success after crash or power loss.
- Host `/Effects` operations limited strictly to the exact plugin lifecycle.
- Retained evidence for dry-run, fake contracts, compatibility refusal,
  discovery, lifecycle, rollback, and failure states.
- Visual acceptance performed by the user alone on the host.

## Constraints

- The user alone runs host mutation and visual acceptance. Agents perform only
  source research, implementation, static/fake verification, and read-only
  protocol evidence; agents never execute host KWin mutations.
- Host `/Effects` may be used only for the exact plugin lifecycle. No host
  `/Compositor`, `/Scripting`, unrelated config or effects, service restart,
  process signals, or KWin replacement are permitted.
- sudo/system plugin paths, broad cleanup, host KWin restart/replacement, and
  automatic primary-session mutation are prohibited.
- Pinned devenv build evidence does not establish host ABI. A target-host build
  profile/package provenance is required before any host install/load.
- A disposable VM or secondary session is recommended before the primary host,
  but is not a false prerequisite where source feasibility and the safeguards
  above establish a safe user-run path.
- Displayed semantic version alone is insufficient evidence of compatibility;
  failure to establish exact compatibility or rollback fails closed.

## Non-Goals

- A host mode in the nested runner.
- Universal binary compatibility across arbitrary KWin builds.
- Distribution packaging or automatic publication.
- Host KWin restart or replacement.
- System-level installation or sudo-managed plugin paths.
- Automated visual acceptance.
- Inference or recovery claims after SIGKILL or power loss.

## Dependencies

- Read-only host feasibility: running KWin executable/package identity,
  matching build/development ABI provenance, and proven host plugin search path
  plus dynamic load/unload without restart.
- User approval of this specification and its gated boundaries.
- Active nested-runner acceptance where it informs the host lifecycle contract.
- The host runner depends on the exact plugin source and its build metadata;
  no installed host plugin is assumed.

## Acceptance Criteria

- [ ] `--dry-run` reports the planned snapshot/install/load/unload/restore
      steps and refusals without mutating the host.
- [ ] Fake-tool contract tests cover dry-run, refusal, discovery, lifecycle,
      rollback, and cleanup paths.
- [ ] Compatibility refusal: the runner fails closed when exact host ABI,
      package/build identity, or rollback cannot be established; semantic
      version alone is never accepted.
- [ ] Discovery and lifecycle: host `/Effects` is used only for the exact
      plugin's discovery, load, unload-before-removal, and restore, with no
      host `/Compositor`, `/Scripting`, service restart, process signal, or
      KWin replacement.
- [ ] Exact user-local lifecycle: atomic snapshot/install, hash/path manifest,
      preserved prior file/config/load state, unload before removal, restore
      and verify, and INT/TERM cleanup without false success after crash or
      power loss.
- [ ] The user manually accepts host visual behavior and confirms rollback
      restored the prior state.
- [ ] Retained evidence covers dry-run, fake contracts, compatibility refusal,
      discovery, lifecycle, rollback, and failure states.

## Evidence

| Acceptance area | Required evidence |
|---|---|
| Dry-run | Recorded dry-run output with planned steps and refusals; no host mutation. |
| Fake contracts | Full fake-tool suite output for refusal, discovery, lifecycle, rollback, and cleanup. |
| Compatibility refusal | Read-only feasibility record: host executable/package identity, ABI provenance, plugin search path, and refusal evidence when exact compatibility or rollback cannot be established. |
| Discovery and lifecycle | Host `/Effects` transition log scoped to the exact plugin only. |
| Visual behavior | User-completed host visual acceptance checklist. |
| Rollback | Restore-and-verify record plus prior file/config/load state snapshot. |
| Failure evidence | Retained failure output; no false cleanup success after crash or power loss. |

## Residual Risks

- Exact host ABI/package/build identity may not match any available build; the
  host path then refuses and provides no acceptance.
- Even a proven search path and dynamic load/unload do not guarantee rollback
  under crash or power loss; restore remains best-effort and is never claimed
  as successful without verification.
- Host D-Bus may be unreachable during interrupt cleanup, leaving unload and
  restore unverified.
- A disposable VM/secondary session reduces but does not eliminate primary-host
  risk; it remains recommended, not mandatory.
- Static/fake verification cannot establish user-run host visual acceptance.
- The user alone owns host mutation; agent tooling cannot make a run accepted.

## Pending Decisions

- None.
