# Binary Coupling Inventory

## Scope and boundaries

- Source inventory scope: `kwin/src/logic.ts`, `kwin/src/controller.ts`.
- Excluded generic arbitrary-child decoding: `decodeLeaves` (`controller.ts:1228-1265`) and `decodeTileTree` (`controller.ts:1269-1295`).
- This is a durable evidence inventory. It records coupling and unresolved boundaries, not design resolutions.

## Structural-binary types

| Type | Evidence | Binary representation | Classification |
| --- | --- | --- | --- |
| `EqualSplit` | `logic.ts:279-283` | Stores `first` and `second` rectangles. | Structural-binary |
| `ReflowLeaves` | `controller.ts:1101-1109` | Stores dragged and original-occupant leaves. | Structural-binary |

- Excluded unrelated pairs, including shortcut conflicts (`controller.ts:757-765`).

## Direct function inventory

There are 24 direct functions below. Each is arity-dependent unless marked incidentally pairwise.

### Decode and order

| Function | Evidence | Classification |
| --- | --- | --- |
| `collectPresetLeaves` | `controller.ts:1376-1401` | Arity-dependent |
| `orderedChildren` | `controller.ts:1480-1501` | Arity-dependent |

- These functions are arity-dependent because decode/order behavior constructs or consumes a two-child ordering contract.

### Construction and assignment

| Function | Evidence | Classification |
| --- | --- | --- |
| `planEqualSplit` | `logic.ts:312-354` | Arity-dependent |
| `equalAlongAxis` | `logic.ts:359-363` | Incidentally pairwise |
| `planKeyboardInsertion` | `logic.ts:441-490` | Arity-dependent |
| `planDragPlacement` | `logic.ts:523-597` | Arity-dependent |
| `planGeometryDrop` | `logic.ts:640-720` | Arity-dependent |
| `nativeDropTarget` | `controller.ts:5604-5627` | Arity-dependent |
| `applyDropSplit` | `controller.ts:5766-5790` | Arity-dependent |
| `splitDropTarget` | `controller.ts:5826-5858` | Arity-dependent |
| `completeKeyboardInsertion` | `controller.ts:5984-6071` | Arity-dependent |
| `dwindleInsert` | `controller.ts:6855-7011` | Arity-dependent |

- These functions are arity-dependent because construction/assignment chooses, creates, or assigns a split as two child positions.
- `equalAlongAxis` is incidentally pairwise: its comparison happens to take a pair, rather than imposing the structural two-child contract.

### Preset reconstruction and validation

| Function | Evidence | Classification |
| --- | --- | --- |
| `presetNodeMatches` | `controller.ts:1559-1582` | Arity-dependent |
| `presetMatches` | `controller.ts:6256-6280` | Arity-dependent |
| `presetTileAtPath` | `controller.ts:6480-6501` | Arity-dependent |
| `rebuildPreset` | `controller.ts:6512-6571` | Arity-dependent |
| `presetShapeMatches` | `controller.ts:6661-6672` | Arity-dependent |

- These functions are arity-dependent because preset reconstruction/validation expects, traverses, or verifies binary child structure.

### Resize and minimum calculations

| Function | Evidence | Classification |
| --- | --- | --- |
| `resizeActiveWindow` | `controller.ts:2609-2734` | Arity-dependent |
| `resolveResizeSplit` | `controller.ts:2745-2788` | Arity-dependent |
| `resizeWouldViolateMinimum` | `controller.ts:2796-2819` | Arity-dependent |
| `splitWouldViolateMinimum` | `controller.ts:5797-5800` | Arity-dependent |
| `splitAxisWouldViolateMinimum` | `controller.ts:5807-5818` | Arity-dependent |

- These functions are arity-dependent because resize/minimum calculations divide, resolve, or constrain a split through its two child sides.

### Drag reflow normalization

| Function | Evidence | Classification |
| --- | --- | --- |
| `selectedOverlayValid` | `controller.ts:3897-3916` | Arity-dependent |
| `normalizeReflowLeaves` | `controller.ts:7276-7347` | Arity-dependent |

- These functions are arity-dependent because drag reflow normalization validates or restores dragged/original-occupant binary roles.

## KWin split call contract

- KWin split call sites: `controller.ts:5836-5852`, `controller.ts:6039-6062`, `controller.ts:6530-6538`, and `controller.ts:6975-7003`.
- Every listed call site invokes `splitCustomTile(tile, direction)` with one directional argument.
- Related path: `custom-tile-split.ts:12-25` and `layout-executor.ts:148-170`.
- `kwin-globals.d.ts:218-225` declares `CustomTile.split(direction: LayoutDirection): unknown`, backed by `QList<CustomTile *>`.
- `boundary.ts:395-401` preserves that shape.
- Direct proof is input arity only. Native return cardinality is unproven by this evidence.
- The project imposes two-child decoding. That project-level decoding requirement is distinct from the unproven native return cardinality.

## Test blast radius

Exactly 13 test files cover the inventory surface:

| Test file | Evidence |
| --- | --- |
| `logic.test.ts` | `929-1000` |
| `controller-drag-diagnostics-and-resize.test.ts` | `512-613,617-699` |
| `controller-interactive-drag.test.ts` | `75-99,248-345` |
| `controller-keyboard-placement.test.ts` | `41-158` |
| `controller-automatic-dwindle-insertion.test.ts` | `13-47,118-124` |
| `controller-automatic-dwindle-ownership.test.ts` | `227-260` |
| `controller-deferred-recovery-and-fullscreen.test.ts` | `455-468` |
| `controller-selected-overlay-state.test.ts` | `21-34,82-87` |
| `controller-selected-overlay-reflow.test.ts` | `348` |
| `controller-keyboard-move-and-swap.test.ts` | `751-775` |
| `controller-production-diagnostics.test.ts` | `270-342` |
| `controller-pure-config-functions.test.ts` | `33-82,419-451` |
| `layout-executor.test.ts` | `39-49,217-231` |

- Shared fixture, listed separately from the 13 test files: `controller-fixture-scenarios.ts:643-766`.

## Unresolved evidence boundaries

- Native return cardinality is unproven by the listed evidence.
- Resize absorption choice remains unresolved: `controller.ts:2673-2686,2745-2776`.
- Post-drop normalization remains unresolved: `controller.ts:7315-7344`.
- Ordered-child source rule conflict remains unresolved: `controller.ts:1573-1581,6490-6498`.
