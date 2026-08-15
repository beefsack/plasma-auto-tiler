# Active Window Border Effect

## Intent

Provide an explicitly experimental standalone native C++ KWin effect that
draws a fixed, conservative border around the eligible active window on OpenGL
only. The effect is disabled by default, is a clean no-op on unsupported
renderers, and is never loaded or exercised against a live compositor by agents.

## Scope

- One `KWin::Effect` subclass, one KWin plugin factory, native plugin metadata,
  and a small CMake target linked to `KWin::kwin`.
- Preserve normal scene painting and, only after an OpenGL capability check, use
  exactly one effect-owned direct-value `KWin::OutlinedBorderItem` with
  automatic lifetime and exactly one scene attachment for the eligible active
  window to show a thin fixed-style rectangular frame around its frame.
- Repaint when activation and relevant window geometry or state changes occur.
- Show nothing when there is no active window or it is deleted, minimized, or
  fullscreen.
- Use a fixed conservative prototype style.
- Add no external dependency and do not integrate grouped windows.

## Non-Goals

- Animation, rounded corners, clipping, texture or window-scene manipulation,
  custom shaders, manual GL resources or ownership, QPainter rendering, input
  handling, per-application rules, broader scene manipulation, or a settings
  UI.
- Declarative `SceneEffect`, `kwin/contents/code/main.js` edits, manual or smart
  ownership, raw owning pointers, heap allocation, `new`/`delete`, threads, or
  speculative abstractions.
- Live effect loading, live compositor mutation, or distribution packaging.
- Renderer portability, other renderer or resource exceptions, and all grouped
  window carriers, interaction semantics, controls, bindings, and implementation.

## Constraints And Decisions

- The effect is experimental and OpenGL-only. A capability gate must leave
  unsupported renderers as a clean no-op. KWin/Plasma ABI updates may require a
  rebuild.
- The implementation uses strict practical warnings as errors, deterministic
  clang-format, a relevant clang-tidy profile, focused eligibility tests where
  applicable, and two clean builds where applicable.
- Native effect metadata validation is static/build-time. `kpackagetool6` is
  not a validator for the native `.so` plugin.
- Deterministic core KPackage packaging is a separate subsequent change after
  static-border acceptance.
- The native toolchain dependency restart is complete. Any live mutation and
  live acceptance remain user-run.
- Grouped windows remain parked for compositor-owned KWin core support and the
  user-run Custom Tile multi-window proof, which is necessary but insufficient.
- The sole scene exception is exactly one effect-owned direct-value
  `KWin::OutlinedBorderItem` with automatic lifetime and one attachment for the
  eligible active-window border; attach and detach safely without heap or smart
  ownership, raw owning pointers, `new`/`delete`, broader scene access, or
  private APIs.

## Acceptance Criteria

1. An explicitly experimental, disabled-by-default native KWin plugin builds as
   one `KWin::Effect` subclass with one plugin factory, valid native metadata,
   and no external dependency.
2. An OpenGL capability gate preserves a clean no-op on every unsupported
   renderer. On OpenGL, normal scene painting is preserved and exactly one
   effect-owned direct-value `KWin::OutlinedBorderItem` with automatic lifetime
   has exactly one safe scene attachment and detachment while showing a thin
   fixed-style rectangular frame for an eligible active window.
3. Activation and relevant frame geometry or state changes request repaint;
   no border is selected for no active, deleted, minimized, or fullscreen
   windows.
4. The native target passes warnings-as-errors, clang-format, relevant
   clang-tidy, focused eligibility tests where applicable, metadata validation,
   two clean builds, and `git diff --check`.
5. Later, the user can load the disabled effect and confirm OpenGL border
   behavior and unsupported-renderer no-op behavior in a live KWin session
   without agent compositor mutation. No grouped-window integration is claimed.

## Pending Decisions

None.
