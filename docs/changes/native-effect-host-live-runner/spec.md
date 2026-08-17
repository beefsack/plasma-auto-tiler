# Specification: Native Effect Host Validation

Ownership and approval:
- Owner: Lead
- Status: Reset for review, 2026-08-17.
- Approved outcome: one safe, user-supervised validation of the exact native
  effect on this exact currently pinned host.

## Intent and Scope

Validate the exact `plasma-auto-tiler-active-border` native effect once against
the currently running host KWin. This is a one-off validation protocol, not a
reusable or distributable runner and not a multi-host abstraction. The nested
runner remains separate and unchanged.

The accepted host ABI/development pin evidence is:

- `out=/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`
- `dev=/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev`
- both exact outputs derive from
  `/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv`

The two user-run session boundaries are retained. The trusted single user
runs every command serially and alone, performs all host mutation, and
performs both session boundaries. Agents do not execute host mutation or
session boundaries.

## Five-Phase Protocol

1. **Read-only preflight and snapshot:** confirm the exact host runtime and
   development derivations match the accepted `out -> drv -> dev` pin; record
   the exact plugin identity and a host configuration snapshot; make no host
   changes.
2. **Exact plugin and temporary `environment.d` staging:** stage only the
   exact plugin in a nonce-owned user-local path and create only its temporary
   nonce-owned `environment.d` discovery entry; record the owned paths and
   prior state.
3. **User boundary 1:** the trusted user alone enters the bounded session
   boundary before effect discovery or loading.
4. **Exact `/Effects` validation:** verify support for the exact plugin, load
   it and verify `load` returns true and loaded state becomes true; the user
   alone observes and accepts the border behavior; unload it, verify unload
   succeeds, and verify loaded state becomes false.
5. **Exact restoration, user boundary 2, and postflight verification:** restore
   the nonce-owned plugin and temporary discovery entry exactly, perform the
   second user-run session boundary, and verify that the effect is not loaded,
   the temporary discovery path no longer exposes it, the host configuration
   snapshot matches, and no unrelated state changed.

## Safety Constraints

- The trusted single user runs commands serially and alone. Only that user
  performs host mutation, visual observation, and both session boundaries.
- On an unexpected or ambiguous result, stop. Retain evidence and all
  nonce-owned paths, query the exact plugin state, discuss and manually recover
  before removal, and never broad-clean.
- Automatic crash or power-loss rollback is not claimed. This protocol does
  not defend against hostile same-user races or arbitrary filesystem
  corruption.
- This protocol does not define a generalized persistent state machine or a
  reusable multi-host abstraction.
- No `sudo`, system plugin paths, `/Compositor`, `/Scripting`, automatic
  primary-session mutation, routine in-place KWin termination, broad cleanup,
  unrelated state changes, or agent-executed host mutation.

## Frozen Acceptance Matrix

| # | Acceptance item |
|---|---|
| 1 | Exact host runtime/development derivation match. |
| 2 | Exact plugin support after boundary 1. |
| 3 | Load returns true and loaded state becomes true. |
| 4 | User-observed border behavior passes. |
| 5 | Unload succeeds and loaded state becomes false. |
| 6 | Only the nonce-owned plugin and environment entry change. |
| 7 | Both are restored exactly. |
| 8 | After boundary 2, the effect is not loaded and the temporary discovery path no longer exposes it. |
| 9 | Host configuration snapshot matches pre-test state. |
| 10 | No prohibited interfaces, paths, or actions are used. |

No implementation, live run, host mutation, or acceptance evidence is created
by this reset transaction.
