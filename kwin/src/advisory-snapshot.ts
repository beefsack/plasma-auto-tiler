// KWin-native read-only advisory trio snapshot observer (standalone only).
//
// Boundary: receives the lexical KWin `workspace` object from the standalone
// entry as an explicit parameter. No ambient lookup beyond that parameter,
// no signal subscription, no writes, no transport. Observes public read-only
// state only: activeWindow, windowList, currentDesktopForScreen, clientArea,
// output identity, desktops membership, tile presence, frameGeometry,
// output geometry, plus the small read-only flags below. Transmits only
// normalized observations for DescribeAdvisoryPlan: one logical
// output/workspace scope, three bare window observations, focused window
// from the active window, direction from injected intent,
// advisory-only capabilities. No tree, leaf, or focused_leaf leaves this
// module; Rust alone builds H[A,V[B,C]].
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

// Bounded redacted capture rejection taxonomy. Each value reports only a
// coarse category (input shape, surface availability, area availability,
// opaque identity format, opaque identity duplicate, geometry class,
// exact-three count, active binding, plus underfull eligibility
// field-classes). Values carry no titles, app ids, PIDs, native ids,
// geometry, or host detail; only the enum string leaves the capture.
// Eligibility families fire only when the eligible set is underfull (<3) and
// at least one same-output/same-desktop window was excluded by that field
// class. Overfull sets (>3) stay count-mismatch so an unrelated excluded
// window never masks an extra eligible count; underfull sets with no
// in-scope excluded window stay count-mismatch (zero underlying eligibility
// signal). When several in-scope classes are present the precedence is
// state, then type, then binding; no window is identified. Identity format
// covers unparseable/malformed native ids; identity duplicate covers a
// repeated normalized id (including bare-vs-braced collisions).
export const ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT = "advisory-snapshot-invalid-input";
export const ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE = "advisory-snapshot-surface-unavailable";
export const ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE = "advisory-snapshot-area-unavailable";
export const ADVISORY_SNAPSHOT_REJECT_IDENTITY_INVALID = "advisory-snapshot-identity-invalid";
export const ADVISORY_SNAPSHOT_REJECT_IDENTITY_DUPLICATE = "advisory-snapshot-identity-duplicate";
export const ADVISORY_SNAPSHOT_REJECT_GEOMETRY_INVALID = "advisory-snapshot-geometry-invalid";
export const ADVISORY_SNAPSHOT_REJECT_COUNT_MISMATCH = "advisory-snapshot-count-mismatch";
export const ADVISORY_SNAPSHOT_REJECT_ACTIVE_UNAVAILABLE = "advisory-snapshot-active-unavailable";
export const ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_STATE = "advisory-snapshot-eligibility-state";
export const ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_TYPE = "advisory-snapshot-eligibility-type";
export const ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_BINDING = "advisory-snapshot-eligibility-binding";

export type AdvisorySnapshotReject =
    | typeof ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT
    | typeof ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE
    | typeof ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE
    | typeof ADVISORY_SNAPSHOT_REJECT_IDENTITY_INVALID
    | typeof ADVISORY_SNAPSHOT_REJECT_IDENTITY_DUPLICATE
    | typeof ADVISORY_SNAPSHOT_REJECT_GEOMETRY_INVALID
    | typeof ADVISORY_SNAPSHOT_REJECT_COUNT_MISMATCH
    | typeof ADVISORY_SNAPSHOT_REJECT_ACTIVE_UNAVAILABLE
    | typeof ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_STATE
    | typeof ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_TYPE
    | typeof ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_BINDING;

export const ADVISORY_SNAPSHOT_REJECTS: readonly AdvisorySnapshotReject[] = Object.freeze([
    ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT,
    ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE,
    ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE,
    ADVISORY_SNAPSHOT_REJECT_IDENTITY_INVALID,
    ADVISORY_SNAPSHOT_REJECT_IDENTITY_DUPLICATE,
    ADVISORY_SNAPSHOT_REJECT_GEOMETRY_INVALID,
    ADVISORY_SNAPSHOT_REJECT_COUNT_MISMATCH,
    ADVISORY_SNAPSHOT_REJECT_ACTIVE_UNAVAILABLE,
    ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_STATE,
    ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_TYPE,
    ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_BINDING,
]);

export function isAdvisorySnapshotReject(value: unknown): value is AdvisorySnapshotReject {
    return (
        value === ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT ||
        value === ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE ||
        value === ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE ||
        value === ADVISORY_SNAPSHOT_REJECT_IDENTITY_INVALID ||
        value === ADVISORY_SNAPSHOT_REJECT_IDENTITY_DUPLICATE ||
        value === ADVISORY_SNAPSHOT_REJECT_GEOMETRY_INVALID ||
        value === ADVISORY_SNAPSHOT_REJECT_COUNT_MISMATCH ||
        value === ADVISORY_SNAPSHOT_REJECT_ACTIVE_UNAVAILABLE ||
        value === ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_STATE ||
        value === ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_TYPE ||
        value === ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_BINDING
    );
}

export type AdvisorySnapshotResult =
    | {
          readonly ok: true;
          readonly snapshot: Record<string, unknown>;
          readonly intent: Record<string, unknown>;
          readonly capabilities: Record<string, unknown>;
          readonly fingerprint: string;
          readonly revalidate: () => boolean;
      }
    | { readonly ok: false; readonly reason: AdvisorySnapshotReject };

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

function isHexRun(text: string): boolean {
    if (text.length === 0) {
        return false;
    }
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        const digit = code >= 48 && code <= 57;
        const lower = code >= 97 && code <= 102;
        const upper = code >= 65 && code <= 70;
        if (!(digit || lower || upper)) {
            return false;
        }
    }
    return true;
}

function isUuidText(text: string): boolean {
    const parts = text.split("-");
    const lens: readonly number[] = [8, 4, 4, 4, 12];
    if (parts.length !== lens.length) {
        return false;
    }
    for (let index = 0; index < lens.length; index += 1) {
        const part = parts[index] as string;
        if (part.length !== (lens[index] as number) || !isHexRun(part)) {
            return false;
        }
    }
    return true;
}

// Live `String(Window.internalId)` (QUuid) emits the canonical 8-4-4-4-12
// hex form wrapped in exactly one `{...}` pair. Normalize only that exact
// single-braced canonical form to the bare UUID so downstream opaque ids
// stay brace-free. Legacy opaque values (including bare UUIDs, which already
// satisfy the opaque alphabet) pass through unchanged. Every other bracing
// shape refuses.
function unwrapSingleBracedUuid(text: string): string | null {
    if (text.length !== 38 || !text.startsWith("{") || !text.endsWith("}")) {
        return null;
    }
    const inner = text.slice(1, 37);
    if (!isUuidText(inner)) {
        return null;
    }
    return isOpaqueId(inner) ? inner : null;
}

function normalizeNativeId(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "string") {
        if (isOpaqueId(value)) {
            return value;
        }
        return unwrapSingleBracedUuid(value);
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
    if (isOpaqueId(text)) {
        return text;
    }
    return unwrapSingleBracedUuid(text);
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

type CaptureOutcome =
    | { readonly ok: true; readonly state: CaptureState }
    | { readonly ok: false; readonly reason: AdvisorySnapshotReject };

function fail(reason: AdvisorySnapshotReject): CaptureOutcome {
    return { ok: false, reason };
}

function captureState(workspace: unknown, direction: unknown): CaptureOutcome {
    if (typeof workspace !== "object" || workspace === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT);
    }
    if (!isDirection(direction)) {
        return fail(ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT);
    }
    const surface = workspace as Record<string, unknown>;
    let active: unknown = undefined;
    try {
        active = Reflect.get(surface, "activeWindow");
    } catch (error) {
        void error;
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    if (typeof active !== "object" || active === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    const activeRef = active as object;
    const activeOutput = readProp(activeRef, "output");
    if (typeof activeOutput !== "object" || activeOutput === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    const outputRef = activeOutput as object;
    const lister = readProp(surface, "windowList");
    if (typeof lister !== "function") {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    let rawList: unknown = undefined;
    try {
        rawList = Reflect.apply(lister as (...args: readonly never[]) => unknown, surface, []);
    } catch (error) {
        void error;
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    const windows = decodeBoundedList(rawList, ADVISORY_SNAPSHOT_MAX_WINDOW_LIST);
    if (windows === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    const screensRaw = readProp(surface, "screens");
    const screens = decodeBoundedList(screensRaw, ADVISORY_SNAPSHOT_MAX_SCREENS);
    if (screens === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    let outputKnown = false;
    for (const screen of screens) {
        if (screen === outputRef) {
            outputKnown = true;
            break;
        }
    }
    if (!outputKnown) {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    const currentFn = readProp(surface, "currentDesktopForScreen");
    if (typeof currentFn !== "function") {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
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
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    if (typeof desktop !== "object" || desktop === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_SURFACE_UNAVAILABLE);
    }
    const desktopRef = desktop as object;
    const clientAreaFn = readProp(surface, "clientArea");
    if (typeof clientAreaFn !== "function") {
        return fail(ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE);
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
        return fail(ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE);
    }
    const workArea = asPositiveRect(areaRaw);
    if (workArea === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE);
    }
    const outputGeomRaw = readProp(outputRef, "geometry");
    const outputGeom = asPositiveRect(outputGeomRaw);
    if (outputGeom === null) {
        return fail(ADVISORY_SNAPSHOT_REJECT_AREA_UNAVAILABLE);
    }
    const candidates: Array<{
        readonly id: string;
        readonly ref: object;
        readonly tile: object;
        readonly frame: RectLike;
    }> = [];
    const seen = new Set<string>();
    // In-scope means the window is on the active output and the active
    // desktop. Only those exclusions can explain an underfull trio; scope
    // mismatches stay silent so they collapse to count-mismatch.
    const isInScope = (ref: object): boolean => {
        if (readProp(ref, "output") !== outputRef) {
            return false;
        }
        const membership = decodeBoundedList(readProp(ref, "desktops"), ADVISORY_SNAPSHOT_MAX_DESKTOPS);
        return membership !== null && membership.length === 1 && membership[0] === desktopRef;
    };
    let excludedType = false;
    let excludedState = false;
    let excludedBinding = false;
    const markType = (ref: object): void => {
        if (isInScope(ref)) {
            excludedType = true;
        }
    };
    const markState = (ref: object): void => {
        if (isInScope(ref)) {
            excludedState = true;
        }
    };
    const markBinding = (ref: object): void => {
        if (isInScope(ref)) {
            excludedBinding = true;
        }
    };
    for (const entry of windows) {
        if (typeof entry !== "object" || entry === null) {
            continue;
        }
        const ref = entry as object;
        if (readProp(ref, "normalWindow") !== true) {
            markType(ref);
            continue;
        }
        if (readProp(ref, "managed") !== true) {
            markType(ref);
            continue;
        }
        if (readProp(ref, "resizeable") !== true) {
            markType(ref);
            continue;
        }
        if (readProp(ref, "appletPopup") !== false) {
            markType(ref);
            continue;
        }
        if (readProp(ref, "minimized") !== false) {
            markState(ref);
            continue;
        }
        if (readProp(ref, "fullScreen") !== false) {
            markState(ref);
            continue;
        }
        const mode = readProp(ref, "maximizeMode");
        if (mode !== 0) {
            markState(ref);
            continue;
        }
        if (readProp(ref, "onAllDesktops") !== false) {
            markBinding(ref);
            continue;
        }
        if (readProp(ref, "move") !== false || readProp(ref, "resize") !== false) {
            markState(ref);
            continue;
        }
        const tile = readProp(ref, "tile");
        if (typeof tile !== "object" || tile === null) {
            markBinding(ref);
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
            return fail(ADVISORY_SNAPSHOT_REJECT_IDENTITY_INVALID);
        }
        if (idText === null) {
            return fail(ADVISORY_SNAPSHOT_REJECT_IDENTITY_INVALID);
        }
        if (seen.has(idText)) {
            return fail(ADVISORY_SNAPSHOT_REJECT_IDENTITY_DUPLICATE);
        }
        seen.add(idText);
        const frame = asPositiveRect(readProp(ref, "frameGeometry"));
        if (frame === null) {
            return fail(ADVISORY_SNAPSHOT_REJECT_GEOMETRY_INVALID);
        }
        if (!rectInside(frame, outputGeom) || !rectInside(frame, workArea)) {
            return fail(ADVISORY_SNAPSHOT_REJECT_GEOMETRY_INVALID);
        }
        candidates.push({ id: idText, ref, tile, frame });
    }
    if (candidates.length > ADVISORY_SNAPSHOT_WINDOW_COUNT) {
        return fail(ADVISORY_SNAPSHOT_REJECT_COUNT_MISMATCH);
    }
    if (candidates.length < ADVISORY_SNAPSHOT_WINDOW_COUNT) {
        if (excludedState) {
            return fail(ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_STATE);
        }
        if (excludedType) {
            return fail(ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_TYPE);
        }
        if (excludedBinding) {
            return fail(ADVISORY_SNAPSHOT_REJECT_ELIGIBILITY_BINDING);
        }
        return fail(ADVISORY_SNAPSHOT_REJECT_COUNT_MISMATCH);
    }
    const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sortedIds = sorted.map((entry) => entry.id);
    const idSet = new Set(sortedIds);
    if (idSet.size !== ADVISORY_SNAPSHOT_WINDOW_COUNT) {
        return fail(ADVISORY_SNAPSHOT_REJECT_IDENTITY_DUPLICATE);
    }
    const activeCandidate = sorted.find((candidate) => candidate.ref === activeRef);
    if (activeCandidate === undefined || !idSet.has(activeCandidate.id)) {
        return fail(ADVISORY_SNAPSHOT_REJECT_ACTIVE_UNAVAILABLE);
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
        return fail(ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT);
    }
    if (typeof fingerprint !== "string" || fingerprint.length === 0) {
        return fail(ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT);
    }
    return {
        ok: true,
        state: {
        sortedIds: Object.freeze(sortedIds),
        activeId,
        fingerprint,
        output: outputRef,
        desktop: desktopRef,
        active: activeRef,
        windows: Object.freeze(windowRefs),
        tiles: Object.freeze(tileRefs),
        },
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
    let outcome: CaptureOutcome;
    try {
        outcome = captureState(workspace as unknown, direction);
    } catch (error) {
        void error;
        return { ok: false, reason: ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT };
    }
    if (!outcome.ok) {
        return { ok: false, reason: outcome.reason };
    }
    const captured = outcome.state;
    const activeIndex = captured.sortedIds.indexOf(captured.activeId);
    if (activeIndex < 0) {
        return { ok: false, reason: ADVISORY_SNAPSHOT_REJECT_ACTIVE_UNAVAILABLE };
    }
    const snapshot: Record<string, unknown> = Object.freeze({
        outputs: Object.freeze([
            Object.freeze({
                id: ADVISORY_SNAPSHOT_OUTPUT_ID,
                workspace: ADVISORY_SNAPSHOT_WORKSPACE_ID,
                adjacent: Object.freeze({}),
            }),
        ]),
        windows: Object.freeze(
            captured.sortedIds.map((id) =>
                Object.freeze({
                    window: id,
                    output: ADVISORY_SNAPSHOT_OUTPUT_ID,
                    workspace: ADVISORY_SNAPSHOT_WORKSPACE_ID,
                }),
            ),
        ),
    });
    const intent: Record<string, unknown> = Object.freeze({
        source_output: ADVISORY_SNAPSHOT_OUTPUT_ID,
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
                if (!fresh.ok) {
                    return false;
                }
                const current = fresh.state;
                if (
                    current.fingerprint !== expected ||
                    current.output !== captured.output ||
                    current.desktop !== captured.desktop ||
                    current.active !== captured.active
                ) {
                    return false;
                }
                for (const id of captured.sortedIds) {
                    if (current.windows[id] !== captured.windows[id] || current.tiles[id] !== captured.tiles[id]) {
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
