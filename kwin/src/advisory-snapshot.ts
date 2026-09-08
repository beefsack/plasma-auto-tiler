// KWin-native read-only advisory trio snapshot observer (standalone only).
//
// Boundary: receives the lexical KWin `workspace` object from the standalone
// entry as an explicit parameter. No ambient lookup beyond that parameter,
// no signal subscription, no writes, no transport. Observes public read-only
// state only: activeWindow, windowList, currentDesktopForScreen, clientArea,
// output identity, desktops membership, tile presence, frameGeometry,
// output geometry, plus the small read-only flags below. Produces only v1
// opaque primitives for DescribeAdvisoryPlan: one logical output/workspace
// scope, one flat horizontal group with three leaves derived from the three
// opaque window ids, three window links, focused leaf/window from the active
// window, direction from injected intent, advisory-only capabilities.
//
// Ordinary production startup never runs this module: src/entry.ts must not
// bring it in. Only advisory-describe-entry.ts brings it in.

export const ADVISORY_SNAPSHOT_WINDOW_COUNT = 3;
export const ADVISORY_SNAPSHOT_MAX_WINDOW_LIST = 1024;
export const ADVISORY_SNAPSHOT_MAX_SCREENS = 32;
export const ADVISORY_SNAPSHOT_MAX_DESKTOPS = 32;
export const ADVISORY_SNAPSHOT_MAX_ID_LEN = 128;
export const ADVISORY_SNAPSHOT_WORK_AREA_OPTION = 5;
export const ADVISORY_SNAPSHOT_OUTPUT_ID = "advisory-output";
export const ADVISORY_SNAPSHOT_WORKSPACE_ID = "advisory-workspace";
export const ADVISORY_SNAPSHOT_ROOT_ID = "advisory-root";

export type AdvisorySnapshotResult =
    | {
          readonly ok: true;
          readonly snapshot: Record<string, unknown>;
          readonly intent: Record<string, unknown>;
          readonly capabilities: Record<string, unknown>;
          readonly fingerprint: string;
          readonly revalidate: () => boolean;
      }
    | { readonly ok: false; readonly reason: string };

interface RectLike {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

function isFiniteNum(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > ADVISORY_SNAPSHOT_MAX_ID_LEN) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const alnum =
            (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        if (!(alnum || code === 45 || code === 95 || code === 46)) {
            return false;
        }
    }
    return true;
}

function isDirection(value: unknown): value is string {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function readProp(value: object, property: string): unknown {
    try {
        return Reflect.get(value, property);
    } catch (error) {
        void error;
        return undefined;
    }
}

function decodeBoundedList(value: unknown, maxLength: number): readonly unknown[] | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.length <= maxLength ? value : null;
    }
    let length: unknown = undefined;
    try {
        length = Reflect.get(value, "length");
    } catch (error) {
        void error;
        return null;
    }
    if (
        typeof length !== "number" ||
        !Number.isInteger(length) ||
        length < 0 ||
        length > maxLength
    ) {
        return null;
    }
    const out: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        let element: unknown = undefined;
        try {
            element = Reflect.get(value, String(index));
        } catch (error) {
            void error;
            return null;
        }
        if (element === undefined) {
            return null;
        }
        out.push(element);
    }
    return out;
}

function asFiniteRect(value: unknown): RectLike | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const x = readProp(value, "x");
    const y = readProp(value, "y");
    const width = readProp(value, "width");
    const height = readProp(value, "height");
    if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(width) || !isFiniteNum(height)) {
        return null;
    }
    return { x, y, width, height };
}

function asPositiveRect(value: unknown): RectLike | null {
    const rect = asFiniteRect(value);
    if (rect === null) {
        return null;
    }
    if (!(rect.width > 0) || !(rect.height > 0)) {
        return null;
    }
    return rect;
}

function rectInside(inner: RectLike, outer: RectLike): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

function normalizeNativeId(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "string") {
        return isOpaqueId(value) ? value : null;
    }
    let text = "";
    try {
        text = String(value);
    } catch (error) {
        void error;
        return null;
    }
    if (typeof text !== "string") {
        return null;
    }
    return isOpaqueId(text) ? text : null;
}

function leafIdFor(windowId: string): string {
    return `leaf-${windowId}`;
}

interface CaptureState {
    readonly sortedIds: readonly string[];
    readonly activeId: string;
    readonly fingerprint: string;
    readonly output: object;
    readonly desktop: object;
    readonly active: object;
    readonly windows: Readonly<Record<string, object>>;
    readonly tiles: Readonly<Record<string, object>>;
}

function captureState(workspace: unknown, direction: unknown): CaptureState | null {
    if (typeof workspace !== "object" || workspace === null) {
        return null;
    }
    if (!isDirection(direction)) {
        return null;
    }
    const surface = workspace as Record<string, unknown>;
    let active: unknown = undefined;
    try {
        active = Reflect.get(surface, "activeWindow");
    } catch (error) {
        void error;
        return null;
    }
    if (typeof active !== "object" || active === null) {
        return null;
    }
    const activeRef = active as object;
    const activeOutput = readProp(activeRef, "output");
    if (typeof activeOutput !== "object" || activeOutput === null) {
        return null;
    }
    const outputRef = activeOutput as object;
    const lister = readProp(surface, "windowList");
    if (typeof lister !== "function") {
        return null;
    }
    let rawList: unknown = undefined;
    try {
        rawList = Reflect.apply(lister as (...args: readonly never[]) => unknown, surface, []);
    } catch (error) {
        void error;
        return null;
    }
    const windows = decodeBoundedList(rawList, ADVISORY_SNAPSHOT_MAX_WINDOW_LIST);
    if (windows === null) {
        return null;
    }
    const screensRaw = readProp(surface, "screens");
    const screens = decodeBoundedList(screensRaw, ADVISORY_SNAPSHOT_MAX_SCREENS);
    if (screens === null) {
        return null;
    }
    let outputKnown = false;
    for (const screen of screens) {
        if (screen === outputRef) {
            outputKnown = true;
            break;
        }
    }
    if (!outputKnown) {
        return null;
    }
    const currentFn = readProp(surface, "currentDesktopForScreen");
    if (typeof currentFn !== "function") {
        return null;
    }
    let desktop: unknown = undefined;
    try {
        desktop = Reflect.apply(
            currentFn as (...args: readonly never[]) => unknown,
            surface,
            [outputRef],
        );
    } catch (error) {
        void error;
        return null;
    }
    if (typeof desktop !== "object" || desktop === null) {
        return null;
    }
    const desktopRef = desktop as object;
    const clientAreaFn = readProp(surface, "clientArea");
    if (typeof clientAreaFn !== "function") {
        return null;
    }
    let areaRaw: unknown = undefined;
    try {
        areaRaw = Reflect.apply(
            clientAreaFn as (...args: readonly never[]) => unknown,
            surface,
            [ADVISORY_SNAPSHOT_WORK_AREA_OPTION, outputRef, desktopRef],
        );
    } catch (error) {
        void error;
        return null;
    }
    const workArea = asPositiveRect(areaRaw);
    if (workArea === null) {
        return null;
    }
    const outputGeomRaw = readProp(outputRef, "geometry");
    const outputGeom = asPositiveRect(outputGeomRaw);
    if (outputGeom === null) {
        return null;
    }
    const candidates: Array<{
        readonly id: string;
        readonly ref: object;
        readonly tile: object;
        readonly frame: RectLike;
    }> = [];
    const seen = new Set<string>();
    for (const entry of windows) {
        if (typeof entry !== "object" || entry === null) {
            continue;
        }
        const ref = entry as object;
        if (readProp(ref, "normalWindow") !== true) {
            continue;
        }
        if (readProp(ref, "managed") !== true) {
            continue;
        }
        if (readProp(ref, "resizeable") !== true) {
            continue;
        }
        if (readProp(ref, "appletPopup") !== false) {
            continue;
        }
        if (readProp(ref, "minimized") !== false) {
            continue;
        }
        if (readProp(ref, "fullScreen") !== false) {
            continue;
        }
        const mode = readProp(ref, "maximizeMode");
        if (mode !== 0) {
            continue;
        }
        if (readProp(ref, "onAllDesktops") !== false) {
            continue;
        }
        if (readProp(ref, "move") !== false || readProp(ref, "resize") !== false) {
            continue;
        }
        const tile = readProp(ref, "tile");
        if (typeof tile !== "object" || tile === null) {
            continue;
        }
        if (readProp(ref, "output") !== outputRef) {
            continue;
        }
        const membership = decodeBoundedList(readProp(ref, "desktops"), ADVISORY_SNAPSHOT_MAX_DESKTOPS);
        if (membership === null || membership.length !== 1 || membership[0] !== desktopRef) {
            continue;
        }
        let idText: string | null = null;
        try {
            idText = normalizeNativeId(Reflect.get(ref, "internalId"));
        } catch (error) {
            void error;
            return null;
        }
        if (idText === null) {
            return null;
        }
        if (seen.has(idText)) {
            return null;
        }
        seen.add(idText);
        const frame = asPositiveRect(readProp(ref, "frameGeometry"));
        if (frame === null) {
            return null;
        }
        if (!rectInside(frame, outputGeom) || !rectInside(frame, workArea)) {
            return null;
        }
        candidates.push({ id: idText, ref, tile, frame });
    }
    if (candidates.length !== ADVISORY_SNAPSHOT_WINDOW_COUNT) {
        return null;
    }
    const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sortedIds = sorted.map((entry) => entry.id);
    const idSet = new Set(sortedIds);
    if (idSet.size !== ADVISORY_SNAPSHOT_WINDOW_COUNT) {
        return null;
    }
    const activeCandidate = sorted.find((candidate) => candidate.ref === activeRef);
    if (activeCandidate === undefined || !idSet.has(activeCandidate.id)) {
        return null;
    }
    const activeId = activeCandidate.id;
    const frames: Record<string, RectLike> = {};
    const windowRefs: Record<string, object> = {};
    const tileRefs: Record<string, object> = {};
    for (const entry of sorted) {
        frames[entry.id] = entry.frame;
        windowRefs[entry.id] = entry.ref;
        tileRefs[entry.id] = entry.tile;
    }
    let fingerprint = "";
    try {
        fingerprint = JSON.stringify({
            ids: sortedIds,
            active: activeId,
            frames: sortedIds.map((id) => [id, frames[id]?.x, frames[id]?.y, frames[id]?.width, frames[id]?.height]),
            area: [workArea.x, workArea.y, workArea.width, workArea.height],
            output: [outputGeom.x, outputGeom.y, outputGeom.width, outputGeom.height],
        });
    } catch (error) {
        void error;
        return null;
    }
    if (typeof fingerprint !== "string" || fingerprint.length === 0) {
        return null;
    }
    return {
        sortedIds: Object.freeze(sortedIds),
        activeId,
        fingerprint,
        output: outputRef,
        desktop: desktopRef,
        active: activeRef,
        windows: Object.freeze(windowRefs),
        tiles: Object.freeze(tileRefs),
    };
}

// Read-only observer: lexical `workspace` only. Direction comes from injected
// intent and is strictly validated. Returns opaque v1 primitives plus a
// closure-internal revalidate callback that recaptures and requires exact
// equality. Native refs never leave the closure.
export function captureAdvisorySnapshot(
    workspace: Workspace,
    direction: unknown,
): AdvisorySnapshotResult {
    let state: CaptureState | null = null;
    try {
        state = captureState(workspace as unknown, direction);
    } catch (error) {
        void error;
        return { ok: false, reason: "advisory-invalid-input" };
    }
    if (state === null) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    const captured = state;
    const leaves = captured.sortedIds.map((id) => leafIdFor(id));
    const activeIndex = captured.sortedIds.indexOf(captured.activeId);
    if (activeIndex < 0) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    const focusedLeaf = leaves[activeIndex] as string;
    const children: readonly Record<string, unknown>[] = Object.freeze(
        leaves.map((leaf) => Object.freeze({ kind: "leaf", id: leaf })),
    );
    const tree: Record<string, unknown> = Object.freeze({
        kind: "group",
        id: ADVISORY_SNAPSHOT_ROOT_ID,
        axis: "horizontal",
        children,
    });
    const snapshot: Record<string, unknown> = Object.freeze({
        outputs: Object.freeze([
            Object.freeze({
                id: ADVISORY_SNAPSHOT_OUTPUT_ID,
                workspace: ADVISORY_SNAPSHOT_WORKSPACE_ID,
                tree,
                adjacent: Object.freeze({}),
            }),
        ]),
        windows: Object.freeze(
            captured.sortedIds.map((id, index) =>
                Object.freeze({
                    window: id,
                    leaf: leaves[index] as string,
                    output: ADVISORY_SNAPSHOT_OUTPUT_ID,
                    workspace: ADVISORY_SNAPSHOT_WORKSPACE_ID,
                }),
            ),
        ),
    });
    const intent: Record<string, unknown> = Object.freeze({
        source_output: ADVISORY_SNAPSHOT_OUTPUT_ID,
        focused_leaf: focusedLeaf,
        focused_window: captured.activeId,
        direction: direction as string,
    });
    const capabilities: Record<string, unknown> = Object.freeze({
        swap_neighbor: true,
        wrap_perpendicular: false,
        wrap_siblings: false,
        insert_child: false,
        split_group_child: false,
        reparent_leaf: false,
        cross_output_transfer: false,
    });
    const expected = captured.fingerprint;
    const workspaceRef = workspace as unknown;
    const directionValue = direction as string;
    return {
        ok: true,
        snapshot,
        intent,
        capabilities,
        fingerprint: expected,
        revalidate: () => {
            try {
                const fresh = captureState(workspaceRef, directionValue);
                if (
                    fresh === null ||
                    fresh.fingerprint !== expected ||
                    fresh.output !== captured.output ||
                    fresh.desktop !== captured.desktop ||
                    fresh.active !== captured.active
                ) {
                    return false;
                }
                for (const id of captured.sortedIds) {
                    if (fresh.windows[id] !== captured.windows[id] || fresh.tiles[id] !== captured.tiles[id]) {
                        return false;
                    }
                }
                return true;
            } catch (error) {
                void error;
                return false;
            }
        },
    };
}
