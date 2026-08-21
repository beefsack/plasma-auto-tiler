# Native Binding Evidence

## Scope and source availability

- Native source scope: `src/tiles/tile.h`, `src/tiles/tile.cpp`, and `src/tiles/customtile.cpp` from KWin `v6.7.3`.
- Acquisition method: the locally present KWin output derivation resolves to `/nix/store/68d0m8wgjmghcvrwzhl8hrmdbdv0ikmb-kwin-6.7.3.tar.xz`. Its Nix derivation identifies the KDE `kwin-6.7.3.tar.xz` release archive and its recorded SHA-256 is `345b45d400884cc6b00f4b3585cc056aa2780f32afe2df394d20c5a98273c559`.
- Commit verification: `git ls-remote` resolved `refs/tags/v6.7.3^{}` in `https://invent.kde.org/plasma/kwin.git` to `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`. The release archive was extracted locally only for reading the three scoped files.
- This document cites paths relative to the verified archive root, `kwin-6.7.3/`.

## Evidence labels

- **Established fact**: directly shown by the scoped native C++ source.
- **Inference**: conclusion drawn from established facts; it is not a claim about QJSEngine behavior.
- **Assumption**: settled project policy, not a native-source fact.
- **Runtime fact**: an observation from an isolated nested-KWin run that passes
  the isolation acceptance criteria. A run that fails those criteria is retained
  as an invalidated observation, not a runtime fact about the binding.
- **Host runtime fact**: a direct observation from an authorized, bounded,
  read-only host-KWin probe whose `~/.config/kwinrc` SHA-256 and mtime are
  unchanged across the run.

## E1 - Native 3+-child topology

- **Established fact:** `Tile` stores direct children in `QList<Tile *> m_children`; `childTiles()` returns that list, and `childCount()` returns its count. No maximum child count is imposed in these declarations or implementations. `src/tiles/tile.h:109-111`, `src/tiles/tile.h:172-174`, `src/tiles/tile.cpp:516-531`
- **Established fact:** insertion accepts an arbitrary non-negative position, clamps it to the current list length, and inserts the child into `m_children`. `src/tiles/tile.h:142-149`, `src/tiles/tile.cpp:471-492`
- **Established fact:** when a `CustomTile` has a parent whose layout direction matches the requested direction, `split()` takes the add-cell branch even when the parent already has at least two children. That branch inserts a new child into the parent at `row() + 1`. `src/tiles/customtile.cpp:193-224`
- **Established fact:** geometry maintenance iterates every direct child and separately adjusts the first and last child, rather than selecting only two children. `src/tiles/customtile.cpp:141-175`
- **Inference:** the native C++ tile model supports a direct container with three or more children. A horizontal or vertical layout first created with two children can receive another same-direction split through the add-cell branch, producing an additional direct child. `src/tiles/customtile.cpp:200-224`, `src/tiles/customtile.cpp:241-253`
- **Inference:** the prior research claim that same-axis behavior can add a sibling to a parent is confirmed. Same-axis behavior explicitly adds a direct sibling to `parentT`; it does not wrap the target in a new two-child container. `src/tiles/customtile.cpp:200-224`
- **Boundary:** this establishes the native C++ topology and mutation path, not that a script-facing `tiles` value is marshalled as a JavaScript array or that it preserves identity and order across that boundary. The property is declared as C++ `QList<KWin::Tile *>`; no QJSEngine marshalling code is in scope. `src/tiles/tile.h:35-38`

## E2 - Split result cardinality

- **Established fact:** `CustomTile::split()` constructs and returns a C++ `QList<CustomTile *>`. `src/tiles/customtile.cpp:193-197`, `src/tiles/customtile.cpp:256`
- **Established fact:** in the add-cell branch, the result contains the original tile and one newly created direct sibling, so the C++ result has two appended entries. `src/tiles/customtile.cpp:200-224`
- **Established fact:** when creating a new horizontal or vertical layout, the other branch appends two newly created children. `src/tiles/customtile.cpp:241-253`
- **Established fact:** when creating a new floating layout, that other branch appends only one child. `src/tiles/customtile.cpp:229-240`
- **Inference:** a strict two-item result is true for the C++ horizontal and vertical paths shown here, but is false as a direction-independent native C++ contract because the floating new-layout path returns one item. `src/tiles/customtile.cpp:200-256`
- **Boundary:** this source does not prove what `CustomTile.split(direction)` returns to QJSEngine, including whether the C++ list is exposed, how it is marshalled, or whether its cardinality is preserved. It therefore cannot establish the proposed strict two-child JavaScript decoding contract.
- **Assumption:** project semantics remain the owned ordered N-ary model. If the adapter accepts arbitrary native directions, it must not treat native split return cardinality as universally two; a binding-specific adapter contract is required.

## E3 - Direct-child ordering, insertion, and removal

- **Established fact:** `tiles` is declared from `childTiles()`, whose source comment and implementation identify it as the direct-child list. `src/tiles/tile.h:37`, `src/tiles/tile.h:108-111`, `src/tiles/tile.cpp:516-519`
- **Established fact:** source operations use list position as child order: insertion occurs at a clamped requested position, `childTile(row)` selects by index, and `row()` returns the tile's index in its parent list. `src/tiles/tile.cpp:471-477`, `src/tiles/tile.cpp:521-527`, `src/tiles/tile.cpp:561-568`
- **Established fact:** `CustomTile::createChildAt()` delegates to `insertChild(position, tile)` after model insertion begins. `src/tiles/customtile.cpp:40-50`
- **Established fact:** `removeChild()` removes the child from `m_children`, emits updated `rowChanged` signals for later entries, then emits `childTilesChanged`. `src/tiles/tile.cpp:500-514`
- **Established fact:** `CustomTile::remove()` obtains adjacent siblings, removes itself from its parent, clears its parent pointer, and then reallocates neighboring geometry. `src/tiles/customtile.cpp:273-324`
- **Inference:** the C++ direct-child projection has ordered insertion and index-based removal semantics suitable for the adapter to observe as an ordered native projection. `src/tiles/tile.cpp:471-477`, `src/tiles/tile.cpp:500-527`, `src/tiles/tile.cpp:561-587`
- **Boundary:** the source does not prove QJSEngine's representation or iteration order of `tile.tiles`; it proves only the C++ direct-child list and the native operations over it. `src/tiles/tile.h:35-38`, `src/tiles/tile.cpp:516-519`

## E4 - QJSEngine marshalling, ordinal identity, and split shape

- **Established fact:** the scoped source emits `childTilesChanged` after
  insertions and removals. `src/tiles/tile.cpp:471-492`,
  `src/tiles/tile.cpp:500-514`
- **Boundary:** no scoped source file contains QJSEngine list-marshalling code.
  Source therefore does not establish the JavaScript representation, ordinal
  identity, or order of `tile.tiles`, nor the JavaScript return shape/order of
  `CustomTile.split(direction)`.
- **Invalidated runtime observation (not an established fact):**
  `native-evidence-phase-2/attempt-01` launched exactly once through
  `bash scripts/nested-kwin-spike.sh /tmp/opencode/native-evidence-phase-2-attempt-01-20260821T134535038363479/nested`.
  The launcher created the required fresh private XDG homes and private D-Bus
  session; its runtime directory was mode `0700`; and its command uses the
  absolute `/run/user/<uid>/wayland-0` display path. The private config copy
  existed at `nested/config/kwinrc`. The nested compositor was held for more
  than three seconds after the one structural call, and only the nonce-owned
  nested KWin and launcher processes were terminated.
- **Invalidated runtime observation (not an established fact):** host
  `~/.config/kwinrc` isolation acceptance failed. Pre-run SHA-256 was
  `905375112bbf8d9c8b882f687bd71eb1cb8eeb69a31ed657585889b9320e2fe8`
  with nanosecond mtime `2026-08-21 09:38:51.694039474 +1000`; post-run
  SHA-256 was identical but mtime was `2026-08-21 13:47:39.187236714 +1000`.
  Under the then-current isolation acceptance, the changed mtime was a hard
  stop. No retry was made, and this run cannot establish a binding fact or
  accept the candidate contract.
- **Invalidated runtime observation (not an established fact):** the probe
  decoded `workspace.rootTile(workspace.activeScreen,
  workspace.currentDesktopForScreen(workspace.activeScreen)).tiles` twice,
  freshly re-resolved the root, then called exactly one fresh root
  `split(1)`. It did not create a window or desktop, call `remove()`, perform
  a second split, mutate a stale handle, or use a timer/deleteLater barrier.
  The exact `console.log` result was:

  ```json
  {"marker":"native-evidence-phase-2","before":{"first":{"type":"object","isArray":false,"tag":"[object V4Sequence]","length":3,"readable":true,"itemCount":3},"second":{"type":"object","isArray":false,"tag":"[object V4Sequence]","length":3,"readable":true,"itemCount":3},"ordinalIdentity":[true,true,true],"freshBefore":{"type":"object","isArray":false,"tag":"[object V4Sequence]","length":3,"readable":true,"itemCount":3},"firstVsFreshOrdinalIdentity":[true,true,true],"rootLayoutDirection":1,"targetKind":"root","direction":1,"targetIsFreshFirst":false},"returned":{"type":"object","isArray":false,"tag":"[object V4Sequence]","length":2,"readable":true,"itemCount":2},"after":{"rootDirect":{"type":"object","isArray":false,"tag":"[object V4Sequence]","length":5,"readable":true,"itemCount":5},"rootDirectVsReturn":[[false,false],[false,false],[false,false],[true,false],[false,true]],"returnVsRootDirect":[[false,false,false,true,false],[false,false,false,false,true]],"directThree":false,"rootLayoutDirection":1}}
  ```

- **Inference:** if a future run passes isolation, this exact comparison shape
  would demonstrate stable ordinal object identity for a three-item `tiles`
  `V4Sequence`, an ordered two-item horizontal split return, and its entries'
  correspondence to post-split direct root child ordinals 3 and 4. It would
  not demonstrate an exactly three-child result from this call: the fresh root
  already had three direct children and the single split yielded five.
- **Historical conclusion after attempt-01:** E4 remained unresolved because
  that only runtime observation failed host-isolation acceptance. In particular,
  no strict two-child split conclusion was accepted for the tested horizontal
  adapter binding or its decoded shape; no claim was made for all directions,
  since the source establishes that the floating new-layout path returns one
  C++ item.
- **Durability verdict:** native source supports ordered direct 3+-child
  topology, but this invalidated binding observation cannot establish that
  session-scoped semantic authority plus reconstruction is sufficient for
  script-visible direct-child topology. The project-owned ordered N-ary model
  remains an assumption. Restart and manual native modification were not
  tested and no behavior is claimed for either.
- **Residual risk:** the `plan.md` risk that native result cardinality is
  unestablished remains open, as do its restart/manual-native-edit and
  session-scoped-semantic-authority risks. No `plan.md` risk is retired by this
  invalidated run.

- **Invalidated runtime observation (not a Runtime fact):** the final allowed
  `native-evidence-phase-2/attempt-02` launched exactly once through
  `bash scripts/nested-kwin-spike.sh
  /tmp/opencode/native-evidence-phase-2-attempt-02-20260821T035827482591912/nested`.
  The fresh private XDG homes, private D-Bus session, absolute host display
  path, and runtime mode `0700` (owner UID 1000) were provided by the launcher.
  The nested process was
  retained from `2026-08-21T14:00:42,524518562+10:00` through
  `2026-08-21T14:00:46,616734623+10:00`, and its private config file exists at
  `nested/config/kwinrc` with mode `0600`, size 311, and mtime
  `2026-08-21 14:00:45.688873990 +1000`. Only the recorded nested KWin and
  launcher PIDs were terminated; attempt-owned cleanup completed.
- **Invalidated runtime observation (not a Runtime fact):** host isolation
  failed and is a HARD STOP. Before the run, `~/.config/kwinrc` SHA-256 was
  `905375112bbf8d9c8b882f687bd71eb1cb8eeb69a31ed657585889b9320e2fe8` with
  nanosecond mtime `2026-08-21 13:47:39.187236714 +1000`. After the run, its
  SHA-256 was `99167e972b9131f461e184b7cdabe899faa45767a2323e345ac29b4821885cd4`
  and mtime was `2026-08-21 14:00:45.572732578 +1000`. No retry was made.
- **Invalidated runtime observation (not a Runtime fact):** nested launch and
  `loadScript` transport both returned success, but the attempt-owned strict
  loader parser rejected the returned `i 0` reply because it expected `u`.
  The probe was therefore not run: no root `tiles` decode, split, or 3-child
  structural result exists for this attempt. The exact command outputs,
  isolation measurements, private-config proof, probe input, and cleanup
  result are retained at
  `/tmp/opencode/native-evidence-phase-2-attempt-02-20260821T035827482591912`.
- **Historical conclusion after attempt-02:** the candidate JavaScript binding
  contract was undetermined. The changed host hash independently prevented any
  Runtime fact, and the loader parse failure prevented this attempt from
  producing binding observations. No conclusion was made for floating
  directions.
- **Residual risk:** no `plan.md` risk is retired. Native result cardinality,
  restart/manual-native-edit, and session-scoped-semantic-authority risks remain
  open. A new evidence-generation blocker is that the attempt-owned loader
  parser rejected the documented `i` load reply before running the probe.

## E4 attempt-03 - direct read-only host probe

- **Host runtime fact:** on 2026-08-21, the authorized direct host probe loaded
  through `/Scripting` as signed script ID `1`, ran, emitted its unique journal
  sentinel, and unloaded successfully. `~/.config/kwinrc` was
  `905375112bbf8d9c8b882f687bd71eb1cb8eeb69a31ed657585889b9320e2fe8` before
  and after; its nanosecond mtime was also unchanged.
- **Host runtime fact:** the active root tile had one child. Its `tiles` value
  reported `Array.isArray(...) === false`, `typeof === "object"`, and a
  prototype constructor name of `"Array"`. It had a `length` property with
  value `1`; integer index `0` was readable.
- **Host runtime fact:** two reads of the root's `tiles` value were strictly
  identical. The element at ordinal `0` was strictly identical across those
  reads, had `typeof === "object"`, and a prototype constructor name of
  `"Object"`. Iteration was available and its one observed element strictly
  matched index `0`.
- **Inference:** for this host binding and the observed one-child root, the
  adapter may consume `tiles` as an indexed, iterable array-like object without
  requiring `Array.isArray(...)`. It must continue to accept dynamic
  cardinality; a one-element observation cannot establish multi-ordinal order.
- **Boundary:** `split()` was not called. Its JavaScript return shape, return
  order, and any strict two-item contract remain unproven and parked by scope.
  The probe also does not establish behavior for other tiles, multiple children,
  restart, or manual native edits.
- **Conclusion:** E4's read-only marshalling and same-ordinal identity question
  is established only for the scoped host observation above. It does not accept
  a JavaScript-array contract, a universal ordering contract, or a two-child
  `split()` contract.
