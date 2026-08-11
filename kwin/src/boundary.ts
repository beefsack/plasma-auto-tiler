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
}

export function isVirtualDesktop(value: unknown): value is VirtualDesktopCapability {
    return isObject(value) && hasValue(value, "id", (item) => typeof item === "string");
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
    readonly move: boolean;
    readonly resize: boolean;
}

interface SignalCapability {
    connect(callback: () => void): void;
    disconnect(callback: () => void): void;
}

export interface WindowScopeSignals {
    readonly outputChanged: SignalCapability;
    readonly desktopsChanged: SignalCapability;
    readonly tileChanged: SignalCapability;
}

export interface WindowInteractionSignals extends WindowScopeSignals {
    readonly interactiveMoveResizeStarted: SignalCapability;
    readonly interactiveMoveResizeFinished: SignalCapability;
}

export function hasWindowScopeSignals(value: unknown): value is WindowScopeSignals {
    return (
        isObject(value) &&
        hasValue(value, "outputChanged", isSignal) &&
        hasValue(value, "desktopsChanged", isSignal) &&
        hasValue(value, "tileChanged", isSignal)
    );
}

export function hasWindowInteractionSignals(value: unknown): value is WindowInteractionSignals {
    return (
        hasWindowScopeSignals(value) &&
        hasValue(value, "interactiveMoveResizeStarted", isSignal) &&
        hasValue(value, "interactiveMoveResizeFinished", isSignal)
    );
}

function isSignal(value: unknown): value is SignalCapability {
    return isObject(value) && hasValue(value, "connect", isMethod);
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
}

export function isCustomTile(value: unknown): value is CustomTileCapability {
    return (
        isTile(value) &&
        hasValue(value, "layoutDirection", (item) => item === 0 || item === 1 || item === 2) &&
        hasValue(value, "split", isMethod)
    );
}

export function manageTile(tile: TileCapability, window: WindowCapability): boolean {
    const method = read(tile, "manage");
    if (!method.ok || !isMethod(method.value)) {
        return false;
    }
    return Reflect.apply(method.value, tile, [window]) === true;
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
export function assignWindowToTile(window: WindowCapability, tile: TileCapability): boolean {
    try {
        return Reflect.set(window, "tile", tile) === true;
    } catch (error) {
        void error;
        return false;
    }
}

export function splitCustomTile(tile: CustomTileCapability, direction: number): unknown {
    const method = read(tile, "split");
    if (!method.ok || !isMethod(method.value)) {
        throw new Error("CustomTile split capability changed before invocation");
    }
    return Reflect.apply(method.value, tile, [direction]);
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

    get isEnabled(): boolean {
        return this.enabled;
    }

    run<T>(operation: () => T, log: (reason: string) => void): GateResult<T> {
        if (!this.enabled) {
            return { ok: false };
        }
        try {
            return { ok: true, value: operation() };
        } catch (error) {
            void error;
            this.disable("exception", log);
            return { ok: false };
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
