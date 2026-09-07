# POC3 Host First Tiling

## Goal

Reach one observable host-only `start` layout for a fresh, receipt-bound,
immutable diagnostic trio without changing production or enrolled clients after
launch.

## Scope

- Prebuild and copy immutable diagnostic binaries before launch.
- After receipt-bound trio launch, generate one `start` KWin JavaScript bundle
  by strict data serialization into a fixed template.
- Revalidate identity, scope, fixture/template/bundle authority, and client
  executable hashes/inodes before one one-shot start and bounded observation.

## Non-Goals

- No runtime receipt ingress, planner, focus/move action, production resume,
  configuration, shortcut, workspace/output, Custom Tile, terminal, or
  unrelated-window mutation.

## Acceptance

- Generation is exclusive and atomic, exact-receipt-bound, safely serialized,
  template/hash-authoritative, tamper-resistant, and preserves enrolled binary
  executable identities.
- One fresh trio is validated before and after generation.
- One `start` either converges to the Rust fixture projection with focus A and
  exact script unload, or stops fail-closed without retry.

## Plan

1. Implement and statically verify the post-launch generator.
2. Prebuild immutable binaries, launch and validate one fresh trio, then
   generate the receipt-bound bundle.
3. Run one start and capture bounded convergence.
4. Independently verify geometry, focus, scope exclusion, and retained state.

## Verification

- Focused static tests before live action.
- Receipt, fixture, template, bundle, and client identity checks around the
  single action.

## Outcome

- Static generator verification passed, including exclusive no-replace bundle
  publication and ownership-checked rollback.
- The first fresh frozen-binary launch attempt failed before receipt creation,
  window creation, or bundle generation because the Rust supervisor accepts only
  the unsuffixed diagnostic-client basename. Its exact launch cleanup removed
  only project-owned transient files; KWin, production, planner, frozen files,
  and host scope were revalidated unchanged.
- One causal pre-geometry repair plus one fresh trio is authorized by the
  standing boundary: accept only the strict content-addressed frozen client
  naming form in the supervisor, rebuild and re-freeze before launch, repeat
  static checks, then perform one launch/generation attempt. No further retry
  is available.
- The causal repair and static checks passed. One fresh receipt-bound trio was
  staged with immutable frozen client identities and one receipt-bound bundle
  was generated. The later consume-only-route static harness removed that
  bundle and sidecar while the trio remained live and valid. Re-generation
  would violate this lifecycle's one-bundle constraint, so no KWin script was
  loaded, run, or unloaded and no geometry or focus write occurred.
- Independent read-only verification confirms the trio, KWin identity,
  production-not-loaded state, absent Planner, and client executable
  hash/device/inode bindings remain exact. The generated bundle and sidecar are
  absent; there is no permitted alternative action bundle. This lifecycle ends
  fail-closed without a visual tiling checkpoint.
