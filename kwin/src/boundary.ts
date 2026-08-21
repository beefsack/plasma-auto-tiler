export const MAX_SEQUENTIAL_LENGTH = 1024;

export type DecodeFailure =
    | "not-sequential"
    | "invalid-limit"
    | "invalid-length"
    | "missing-element"
    | "invalid-element";

export type DecodeResult<T> =
    | { readonly ok: true; readonly value: readonly T[] }
    | { readonly ok: false; readonly reason: DecodeFailure };

interface ReadResult {
    readonly ok: boolean;
    readonly value: unknown;
}

function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

function read(value: object, property: string): ReadResult {
    try {
        const result: unknown = Reflect.get(value, property);
        return { ok: true, value: result };
    } catch (error) {
        void error;
        return { ok: false, value: undefined };
    }
}

function has(value: object, property: string): boolean {
    try {
        return Reflect.has(value, property);
    } catch (error) {
        void error;
        return false;
    }
}

function failure<T>(reason: DecodeFailure): DecodeResult<T> {
    return { ok: false, reason };
}

function isBoundedLength(value: unknown, maximum: number): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= maximum
    );
}

export function decodeSequential<T>(
    value: unknown,
    guard: (element: unknown) => element is T,
    maxLength: number,
): DecodeResult<T> {
    if (!isObject(value)) {
        return failure("not-sequential");
    }
    if (!isBoundedLength(maxLength, MAX_SEQUENTIAL_LENGTH)) {
        return failure("invalid-limit");
    }
    const length = read(value, "length");
    if (!length.ok || !isBoundedLength(length.value, maxLength)) {
        return failure("invalid-length");
    }
    const elements: T[] = [];
    for (let index = 0; index < length.value; index += 1) {
        const property = String(index);
        const element = read(value, property);
        // KWin Q_PROPERTY `QList<T *>` boundaries marshal to QJSEngine as an
        // array-like whose indexed reads resolve but `Reflect.has` reports
        // absent; undefined reads remain the sparse/missing rejection signal.
        if (!element.ok || (!has(value, property) && element.value === undefined)) {
            return failure("missing-element");
        }
        try {
            if (!guard(element.value)) {
                return failure("invalid-element");
            }
        } catch (error) {
            void error;
            return failure("invalid-element");
        }
        elements.push(element.value);
    }
    return { ok: true, value: Object.freeze(elements) };
}

function hasValue(value: object, property: string, guard: (item: unknown) => boolean): boolean {
    const item = read(value, property);
    return item.ok && guard(item.value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export interface PointCapability {
    readonly x: number;
    readonly y: number;
}

export interface RectCapability extends PointCapability {
    readonly width: number;
    readonly height: number;
}

export function isPoint(value: unknown): value is PointCapability {
    return isObject(value) && hasValue(value, "x", isFiniteNumber) && hasValue(value, "y", isFiniteNumber);
}

export function isRect(value: unknown): value is RectCapability {
    return (
        isPoint(value) &&
        hasValue(value, "width", isFiniteNumber) &&
        hasValue(value, "height", isFiniteNumber)
    );
}

export interface OutputCapability {
    readonly geometry: RectCapability;
    readonly name: string;
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber: string;
}

export function isOutput(value: unknown): value is OutputCapability {
    return (
        isObject(value) &&
        hasValue(value, "geometry", isRect) &&
        hasValue(value, "name", (item) => typeof item === "string") &&
        hasValue(value, "manufacturer", (item) => typeof item === "string") &&
        hasValue(value, "model", (item) => typeof item === "string") &&
        hasValue(value, "serialNumber", (item) => typeof item === "string")
    );
}

export interface VirtualDesktopCapability {
    readonly id: string;
    // Optional here: the 1-based desktop number used only to order the live
    // `workspace.desktops` list. A desktop binding that lacks it still decodes
    // as a desktop; ordering then falls back to list position.
    readonly x11DesktopNumber?: number;
}

export function isVirtualDesktop(value: unknown): value is VirtualDesktopCapability {
    return isObject(value) && hasValue(value, "id", (item) => typeof item === "string");
}

// The 1-based X11 desktop number, or null when absent or not a positive
// integer. Used only for ordering; never for identity (id is identity).
export function desktopNumber(value: VirtualDesktopCapability): number | null {
    const number = value.x11DesktopNumber;
    if (typeof number !== "number" || !Number.isFinite(number) || !Number.isInteger(number) || number < 1) {
        return null;
    }
    return number;
}

function isObjectOrNull(value: unknown): boolean {
    return value === null || isObject(value);
}

function isMethod(value: unknown): value is (...values: never[]) => unknown {
    return typeof value === "function";
}

export interface WindowCapability {
    readonly normalWindow: boolean;
    readonly managed: boolean;
    readonly resizeable: boolean;
    readonly appletPopup: boolean;
    readonly desktops: unknown;
    readonly output: OutputCapability | null;
    readonly tile: object | null;
    readonly frameGeometry: RectCapability;
    // Documented read-write Window `onAllDesktops` (official KWin scripting API,
    // KWin::Window -> Read-write Properties -> `bool onAllDesktops`). Optional
    // here: a binding that lacks the property must not fail the whole window
    // capability check. Written only through the guarded boundary seam.
    readonly onAllDesktops?: boolean;
    // Documented Window `fullScreen` (read-write Q_PROPERTY in the KWin
    // scripting API). Read-only and optional here: the controller observes but
    // never writes fullscreen state (cover-and-restore is KWin-owned), and a
    // binding that lacks the property is treated as not-fullscreen rather than
    // rejecting the whole window.
    readonly fullScreen?: boolean;
    // Read-only `maximizeMode` (KWin::Window Q_PROPERTY, `KWin::MaximizeMode`
    // enum: 0=restore, 1=vertical, 2=horizontal, 3=full; added in KWin commit
    // 6c345acb, present from Plasma 6.3.0). Read-only and optional here: the
    // controller never writes native maximize (incompatible with tile
    // retention) and only observes it at startup to record an already-maximized
    // window so its state and tree are preserved rather than re-placed. A
    // binding that lacks the property or reports a non-integer value is treated
    // as not-maximized.
    readonly maximizeMode?: number;
    // Documented Window `caption`, read for snapshot observability only. Not
    // validated by `isWindow`: a missing or throwing caption must not affect
    // capability checks, and snapshot reads swallow any read error.
    readonly caption?: string;
    readonly move: boolean;
    readonly resize: boolean;
}

export function isWindow(value: unknown): value is WindowCapability {
    return (
        isObject(value) &&
        hasValue(value, "normalWindow", (item) => typeof item === "boolean") &&
        hasValue(value, "managed", (item) => typeof item === "boolean") &&
        hasValue(value, "resizeable", (item) => typeof item === "boolean") &&
        hasValue(value, "appletPopup", (item) => typeof item === "boolean") &&
        hasValue(value, "desktops", () => true) &&
        hasValue(value, "output", (item) => item === null || isOutput(item)) &&
        hasValue(value, "tile", isObjectOrNull) &&
        hasValue(value, "frameGeometry", isRect) &&
        hasValue(value, "move", (item) => typeof item === "boolean") &&
        hasValue(value, "resize", (item) => typeof item === "boolean")
    );
}

export interface TileCapability {
    readonly relativeGeometry: RectCapability;
    readonly absoluteGeometry: RectCapability;
    readonly parent: object | null;
    readonly tiles: unknown;
    readonly windows: unknown;
    readonly isLayout: boolean;
    readonly canBeRemoved: boolean;
    readonly manage: unknown;
    readonly unmanage: unknown;
}

export function isTile(value: unknown): value is TileCapability {
    return (
        isObject(value) &&
        hasValue(value, "relativeGeometry", isRect) &&
        hasValue(value, "absoluteGeometry", isRect) &&
        hasValue(value, "parent", isObjectOrNull) &&
        hasValue(value, "tiles", () => true) &&
        hasValue(value, "windows", () => true) &&
        hasValue(value, "isLayout", (item) => typeof item === "boolean") &&
        hasValue(value, "canBeRemoved", (item) => typeof item === "boolean") &&
        hasValue(value, "manage", isMethod) &&
        hasValue(value, "unmanage", isMethod)
    );
}

export interface CustomTileCapability extends TileCapability {
    readonly layoutDirection: number;
    readonly split: unknown;
    readonly remove?: unknown;
}

export function isCustomTile(value: unknown): value is CustomTileCapability {
    return (
        isTile(value) &&
        hasValue(value, "layoutDirection", (item) => item === 0 || item === 1 || item === 2) &&
        hasValue(value, "split", isMethod)
    );
}

export type StructuralMutationReporter = () => void;

function reportStructuralMutation(reporter: StructuralMutationReporter | undefined): void {
    reporter?.();
}

export function manageTile(
    tile: TileCapability,
    window: WindowCapability,
    reporter?: StructuralMutationReporter,
): boolean {
    const method = read(tile, "manage");
    if (!method.ok || !isMethod(method.value)) {
        return false;
    }
    const managed = Reflect.apply(method.value, tile, [window]) === true;
    if (managed) {
        reportStructuralMutation(reporter);
    }
    return managed;
}

// Source-pinned window.h:595: `Q_PROPERTY(KWin::Tile *tile READ requestedTile
// WRITE setTileCompatibility NOTIFY tileChanged)`. Writing null dispatches to
// setTileCompatibility(nullptr), which unmanages the window from its requested
// tile and returns it to floating. This is the detach half of the same
// compatibility contract whose attach half is `tile.manage(window)`.
export function detachWindowFromTile(window: WindowCapability): boolean {
    try {
        return Reflect.set(window, "tile", null);
    } catch (error) {
        void error;
        return false;
    }
}

// The attach half of the same pinned writable `Window.tile` contract: writing
// a tile dispatches to `setTileCompatibility(tile)`. Assignment-only overlay
// reflow uses exactly these guarded writes and never structural tile methods.
export function assignWindowToTile(
    window: WindowCapability,
    tile: TileCapability,
    reporter?: StructuralMutationReporter,
): boolean {
    try {
        const assigned = Reflect.set(window, "tile", tile) === true;
        if (assigned) {
            reportStructuralMutation(reporter);
        }
        return assigned;
    } catch (error) {
        void error;
        return false;
    }
}

// Float's unmanage half, mirroring the roadmap implementation note: the tile's
// own `unmanage(window)` removes the window's request and leaves the vacated
// leaf retained (never collapsed). Distinct from the legacy detach seam only
// in which operation owns the window's membership; both never remove a tile.
export function unmanageTile(tile: TileCapability, window: WindowCapability): boolean {
    const method = read(tile, "unmanage");
    if (!method.ok || !isMethod(method.value)) {
        return false;
    }
    try {
        return Reflect.apply(method.value, tile, [window]) === true;
    } catch (error) {
        void error;
        return false;
    }
}

// Documented read-write `Window.frameGeometry` (official KWin scripting API,
// KWin::Window -> Read-write Properties -> `QRectF frameGeometry`). Writes are
// guarded and validated: any throw or false set is a failure, never an
// unvalidated geometry write.
export function writeWindowFrameGeometry(window: WindowCapability, geometry: RectCapability): boolean {
    if (!isRect(geometry)) {
        return false;
    }
    try {
        return Reflect.set(window, "frameGeometry", geometry) === true;
    } catch (error) {
        void error;
        return false;
    }
}

// Read-only `maximizeMode` (KWin::Window Q_PROPERTY, `KWin::MaximizeMode` enum,
// source-pinned to window.h Q_PROPERTY `KWin::MaximizeMode maximizeMode READ
// maximizeMode NOTIFY maximizedChanged`). A window is treated as natively
// maximized only when the binding reports a valid non-restore mode (1 vertical,
// 2 horizontal, 3 full); a missing, non-number, or out-of-range value is
// treated as not-maximized. Guarded feature detection: never assumed when the
// binding cannot identify the state.
export function isNativelyMaximized(window: WindowCapability): boolean {
    const mode = window.maximizeMode;
    return typeof mode === "number" && Number.isInteger(mode) && mode >= 1 && mode <= 3;
}

// Documented read-write `Window.onAllDesktops` (official KWin scripting API,
// KWin::Window -> Read-write Properties -> `bool onAllDesktops`). Sticky
// floating writes it through this guarded seam; true pins the window across
// all desktops, false restores single-desktop membership.
export function setWindowOnAllDesktops(window: WindowCapability, value: boolean): boolean {
    try {
        return Reflect.set(window, "onAllDesktops", value) === true;
    } catch (error) {
        void error;
        return false;
    }
}

// Documented read-write `Window.desktops` (official KWin scripting API,
// KWin::Window -> Read-write Properties -> the window's virtual-desktop
// membership list). A workspace move writes a single-desktop membership
// through this guarded seam; any throw or false set is a failure, never an
// unvalidated write.
export function writeWindowDesktops(
    window: WindowCapability,
    desktops: readonly VirtualDesktopCapability[],
): boolean {
    try {
        return Reflect.set(window, "desktops", desktops) === true;
    } catch (error) {
        void error;
        return false;
    }
}

// Documented writable `Tile.relativeGeometry` (tile.h Q_PROPERTY WRITE
// setRelativeGeometry). Writing dispatches to the source setter; CustomTile's
// override adjusts sibling tiles at the changed shared edges (source-derived
// and not live-proven here). Assignments require a validated finite rect and
// are guarded: any throw or a false set is a failure, never an unvalidated
// write.
export function setTileRelativeGeometry(tile: TileCapability, geometry: RectCapability): boolean {
    if (!isRect(geometry)) {
        return false;
    }
    try {
        return Reflect.set(tile, "relativeGeometry", geometry);
    } catch (error) {
        void error;
        return false;
    }
}

export function splitCustomTile(
    tile: CustomTileCapability,
    direction: number,
    reporter?: StructuralMutationReporter,
): unknown {
    const method = read(tile, "split");
    if (!method.ok || !isMethod(method.value)) {
        throw new Error("CustomTile split capability changed before invocation");
    }
    const split = Reflect.apply(method.value, tile, [direction]);
    reportStructuralMutation(reporter);
    return split;
}

// Pinned KWin 6.7.3 `CustomTile::remove()` is Q_INVOKABLE but returns void.
// Its caller must re-decode the root immediately afterwards; a successful call
// is only mutation-possible, never a successful reset acknowledgement.
export function removeCustomTile(tile: CustomTileCapability, reporter?: StructuralMutationReporter): boolean {
    const method = read(tile, "remove");
    if (!method.ok || !isMethod(method.value)) {
        return false;
    }
    try {
        Reflect.apply(method.value, tile, []);
        reportStructuralMutation(reporter);
        return true;
    } catch (error) {
        void error;
        return false;
    }
}

export interface BoundaryScope {
    readonly output: object;
    readonly desktopId: string;
}

export function sameScope(a: BoundaryScope, b: BoundaryScope): boolean {
    return a.output === b.output && a.desktopId === b.desktopId;
}

export type GateResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false };

export class FeatureGate {
    private enabled = true;
    private logged = false;

    constructor(private readonly afterRun?: () => void) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    run<T>(operation: () => T, log: (reason: string) => void): GateResult<T> {
        if (!this.enabled) {
            this.afterRunSafely();
            return { ok: false };
        }
        try {
            return { ok: true, value: operation() };
        } catch (error) {
            void error;
            this.disable("exception", log);
            return { ok: false };
        } finally {
            this.afterRunSafely();
        }
    }

    private afterRunSafely(): void {
        try {
            this.afterRun?.();
        } catch (error) {
            void error;
        }
    }

    disable(reason: string, log: (reason: string) => void): void {
        this.enabled = false;
        if (this.logged) {
            return;
        }
        this.logged = true;
        try {
            log(reason);
        } catch (error) {
            void error;
            // Logging must not reactivate or escape the disabled feature gate.
        }
    }
}

export class TransientState<T> {
    private value: T | undefined;

    get current(): T | undefined {
        return this.value;
    }

    set(next: T): void {
        this.value = next;
    }

    clear(): void {
        this.value = undefined;
    }

    clearForScopeChange(): void {
        this.clear();
    }
}
