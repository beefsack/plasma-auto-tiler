# Drag Destination Outline

## Intent

Provide an opt-in outline-only destination cue during a native drag without
changing tile structure or previewing a resulting split.

## Scope

- Add the Boolean `dropOutlinePreview` setting. Its default is `false` until
  live acceptance.
- During drag steps, derive the existing target from the cursor and show a
  rectangle only for a valid, non-origin target leaf that passes the existing
  minimum preflight.
- Hide the outline for unresolved, out-of-scope, origin, or undersized targets,
  and on every drag terminal, invalidation, and disable path.
- Avoid redundant calls when the requested outline is identical to the current
  outline.

## Non-Goals

- No structural mutation during drag steps.
- No QML, rich preview, or resulting-split preview.
- No live KWin/Plasma validation in this change checkpoint.

## Acceptance Criteria

1. `dropOutlinePreview` is represented in the KConfigXT schema and KCM UI and
   parses missing, `false`, and `true` startup values deterministically, defaulting
   to `false`.
2. The boundary derives a candidate from the existing cursor-based target
   selection and minimum preflight, rejecting unresolved, out-of-scope, origin,
   and undersized candidates.
3. The controller only displays a rectangle for an accepted candidate; every
   terminal, invalidation, and disable path hides it.
4. Repeated identical requested rectangles do not issue redundant outline calls.
5. Drag steps perform no structural mutation and never render QML, rich, or
   resulting-split previews.
6. Focused static tests cover each implemented unit. XWayland behavior and drag
   cadence remain live-only acceptance items.

## Constraints

- Reuse existing cursor-derived selection and minimum preflight.
- Do not wire outline APIs or drag behavior in the configuration unit.
- Do not modify generated bundles unless the declared focused build requires it.
