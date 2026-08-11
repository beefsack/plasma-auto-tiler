# Type Provenance: KWin 6 / Plasma 6 Scripting TypeScript Declarations

Independent gate for `unit-01/attempt-02`, 2026-08-10. This supersedes the
unaccepted `kwin-api@6.7.1` selection recorded at the restart checkpoint.
KWin source fidelity reference: tag `v6.7.3`, commit
`45ec9a6d0ed312a803ff5658a2a3e61f221566c6`.

## Decision

**Reject `kwin-api@6.7.1`.** It is not sufficiently faithful or complete for
this strict KWin 6.7.3 slice. Use a narrow local declaration subset pinned to
the source cited below instead. No package installation is authorized by this
gate.

The package is an independent, hand-authored third-party binding. It is neither
an official KDE package nor generated from KWin source or documentation. Its
version number and recent KWin 6.7 publish are useful provenance signals, but
do not overcome the required-surface defects.

## Exact Package Evidence

- Registry metadata: `https://registry.npmjs.org/kwin-api/6.7.1`.
- Packument and publish time: `https://registry.npmjs.org/kwin-api` records
  `6.7.1` at `2026-07-26T02:51:44.573Z`; `6.7.0` was published the same day
  after the prior `6.0.9` publish on `2024-02-24`.
- Identity: `kwin-api@6.7.1`, author and sole maintainer `zeroxoneafour`
  (Vaughan Milliman), repository
  `https://github.com/zeroxoneafour/kwin-api`, source commit
  `f72ee2cdb7e0b41ab0fda4ecd2cfbba9e30fa7fd`.
- Tarball: `https://registry.npmjs.org/kwin-api/-/kwin-api-6.7.1.tgz`, 29
  files, 24,888 bytes unpacked, SHA-1
  `1ea714bf986e671eaebf31f7cd32df10685aea7a`, integrity
  `sha512-I3CoszQa3N63/MVbL6mVGLpTr+zz/ivli417scAIFeIBLhGuJxv2msyVLbx+OglauCj+Mv7XLjIH8HWrRCQeow==`.
  Registry metadata includes an npm package signature. The matching GitHub
  commit has a verified SSH signature.
- The published `package/package.json` has no dependencies, scripts,
  `install`, or `postinstall` fields; it exports raw `src/*.ts` files. Its
  manifest declares MIT, but the tarball has no LICENSE file and the registry
  response contains no npm provenance attestation.

## Published Declaration Inspection

The inspected tarball sources exactly match `gitHead` above, including
`src/baseWorkspace.ts`, `src/kwin.ts`, `src/window.ts`, `src/tile.ts`,
`src/output.ts`, and `src/enums.ts`.

| Required surface | Published declaration | KWin 6.7.3 comparison | Result |
|---|---|---|---|
| Global `workspace` | Absent; no `declare global` declaration | The scripting workspace wrapper is exposed by KWin | Reject |
| `registerShortcut` | `KWin.registerShortcut(..., callback: Function): void` | `Script::registerShortcut(..., QJSValue)` returns `bool` in `src/scripting/scripting.h` | Reject |
| `Workspace.rootTile` | `rootTile(output: Output, desktop: VirtualDesktop): Tile` | `WorkspaceWrapper::rootTile(LogicalOutput *, VirtualDesktop *)` in `src/scripting/workspace_wrapper.h` | Adequate signature |
| Window focus/desktop/output/tile/move signals | Covers `active`, `desktops`, `output`, nullable `tile`, and interactive move signals | Corresponding properties/signals exist in `src/window.h` | Mostly adequate, but output and signal nullability/arguments are simplified |
| Tile tree/geometry | Covers geometry, parent, children, windows, layout, and signals | `src/tiles/tile.h` exports the corresponding properties/signals | Adequate subset |
| Tile assignment and split | `manage`, `unmanage`, and `split` return `void` | `manage`/`unmanage` return `bool` in `tile.h`; `CustomTile::split` returns `QList<CustomTile *>` in `customtile.h` | Reject |
| Output UUID | Absent | `LogicalOutput::uuid()` exists in `src/core/output.h` but is neither `Q_PROPERTY` nor `Q_INVOKABLE` | Unavailable to the scripting surface; do not locally declare it |
| `LayoutDirection` | `const enum` values `Floating=0`, `Horizontal=1`, `Vertical=2` | Matches `Tile::LayoutDirection` in `tile.h` | Values adequate |

The package's `const enum` declarations are not a rejection basis: esbuild
supports non-ambient `const enum` syntax. The local subset should use a normal
enum or numeric literals so its source-pinned runtime representation is
explicit.

## Type-Quality Findings

- The tarball contains 12 `any` occurrences: 10 in `src/qt/console.ts` and 2
  in `src/qml/dbuscall.ts`; none are in the inspected KWin surface files.
- Required KWin declarations still weaken strict boundaries: five callbacks use
  `Function`; `TileModel` is `object`; `QUuid` is `object`; and several values
  that can be absent at the KWin boundary are declared non-null.
- The wrong `void` return types for `registerShortcut`, `manage`, `unmanage`,
  and `split` prevent callers from expressing actual KWin success/failure or
  newly-created-tile behavior.
- The package has one recent 6.7-line release pair after a 26-month release
  gap, no package dependencies or lifecycle scripts, and a verified source
  commit. Its low dependency/scripting risk and MIT metadata are acceptable for
  a type-only dependency, but the single-maintainer, non-official provenance,
  missing packaged license text, and fidelity defects make it unsuitable here.

## Required Local Subset

The next implementation slice must remove the rejected package rather than
mixing it with local corrections. Declare only the following KWin 6.7.3
surfaces, with every declaration linked to the named source:

| Declaration group | Required members | Source evidence |
|---|---|---|
| Globals | `workspace: Workspace`; `registerShortcut(name, text, sequence, callback): boolean` | `src/scripting/scripting.h`; `src/scripting/workspace_wrapper.h` |
| Workspace | `screens`, `currentDesktop`, `activeWindow`, `rootTile(output, desktop)`, `windowAdded`, `windowRemoved` | `src/scripting/workspace_wrapper.h` |
| Window | `normalWindow`, `managed`, `desktops`, nullable `output` and `tile`, `frameGeometry`, and interactive move signals | `src/window.h` |
| Tile and CustomTile | geometry, parent, children, windows, `isLayout`, `canBeRemoved`, signals, `manage`/`unmanage` returning `boolean`, and `split` returning readonly tiles | `src/tiles/tile.h`; `src/tiles/customtile.h` |
| Output and desktop | scripting-exposed `geometry`, `name`, `manufacturer`, `model`, `serialNumber`, and virtual-desktop identity | `src/core/output.h`; `src/virtualdesktops.h` |
| Direction | non-`const` `LayoutDirection` values `0`, `1`, and `2` | `src/tiles/tile.h` |

`Output.uuid` is not part of the KWin scripting API and is therefore excluded.
The slice is current-output-only, so its local adapter must use the output
object and runtime-guarded exposed identity values rather than inventing a UUID
property. If a future requirement needs a stable output UUID, it requires a
separate source/API decision.

## Scope Boundary

No clearly superior official TypeScript package was directly identified during
the package provenance trace. This gate did not reopen a broad ecosystem
search. No runtime KWin query, installation, or generated artifact occurred.

## Static Correction Review

`unit-01/attempt-03` removed the rejected package/import, corrected the
explicit esbuild test entry, and authored the local subset without prohibited
TypeScript escape hatches. Lead review rejected this attempt before installation:
`RootTile` must extend `CustomTile`, and its `model` is a readonly QML property
from `Q_PROPERTY(KWin::TileModel *model READ model CONSTANT)`, not a
`model()` method. `Workspace.currentDesktop` is also a pointer boundary and
must be typed nullable so later adapter code performs the required runtime
guard. These narrow corrections require a fresh Worker because the attempt's
single correction round is exhausted.
