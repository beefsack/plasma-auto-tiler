import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    FeatureGate,
    MAX_SEQUENTIAL_LENGTH,
    TransientState,
    assignWindowToTile,
    decodeSequential,
    detachWindowFromTile,
    isCustomTile,
    isNativelyMaximized,
    isOutput,
    isRect,
    isTile,
    isVirtualDesktop,
    isWindow,
    sameScope,
    type BoundaryScope,
} from "../src/boundary";
import { sameScope as sameLogicScope, type Scope as LogicScope } from "../src/logic";
import type { WindowCapability } from "../src/boundary";

function isNumber(value: unknown): value is number {
    return typeof value === "number";
}

function decoded<T>(result: ReturnType<typeof decodeSequential<T>>): readonly T[] {
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error("expected decoded sequence");
    }
    return result.value;
}

function rejected<T>(result: ReturnType<typeof decodeSequential<T>>, reason: string): void {
    assert.equal(result.ok, false);
    if (result.ok) {
        throw new Error("expected rejected sequence");
    }
    assert.equal(result.reason, reason);
}

const RECT = { x: 0, y: 0, width: 100, height: 100 };
const OUTPUT = {
    geometry: RECT,
    name: "screen-1",
    manufacturer: "KDE",
    model: "test",
    serialNumber: "1",
};

function tile() {
    return {
        relativeGeometry: RECT,
        absoluteGeometry: RECT,
        parent: null,
        tiles: [],
        windows: [],
        isLayout: false,
        canBeRemoved: true,
        manage: () => true,
        unmanage: () => true,
    };
}

describe("decodeSequential", () => {
    it("accepts arrays and array-like objects as copied immutable sequences", () => {
        const source = [1, 2];
        const array = decoded(decodeSequential(source, isNumber, 2));
        const arrayLike = decoded(decodeSequential({ 0: 3, 1: 4, length: 2 }, isNumber, 2));
        assert.deepEqual(array, [1, 2]);
        assert.deepEqual(arrayLike, [3, 4]);
        assert.equal(Object.isFrozen(array), true);
        assert.equal(Reflect.set(array, "0", 99), false);
        assert.equal(source[0], 1);
    });

    it("accepts empty sequences and rejects missing or malformed boundaries", () => {
        assert.deepEqual(decoded(decodeSequential([], isNumber, 0)), []);
        rejected(decodeSequential(null, isNumber, 2), "not-sequential");
        rejected(decodeSequential({ 0: 1 }, isNumber, 2), "invalid-length");
        rejected(decodeSequential({ 0: 1, length: 2 }, isNumber, 2), "missing-element");
        rejected(decodeSequential({ 0: 1, length: 1.5 }, isNumber, 2), "invalid-length");
    });

    it("bounds lengths and rejects invalid elements without unbounded reads", () => {
        const lengths = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_SEQUENTIAL_LENGTH + 1];
        for (const length of lengths) {
            rejected(decodeSequential({ length }, isNumber, MAX_SEQUENTIAL_LENGTH), "invalid-length");
        }
        rejected(decodeSequential([1], isNumber, MAX_SEQUENTIAL_LENGTH + 1), "invalid-limit");
        rejected(decodeSequential([1, "two"], isNumber, 2), "invalid-element");
    });

    it("contains throwing getters and rejecting guards", () => {
        const throwingLength = {};
        Object.defineProperty(throwingLength, "length", {
            get() {
                throw "length";
            },
        });
        const throwingElement = { length: 1 };
        Object.defineProperty(throwingElement, "0", {
            get() {
                throw "element";
            },
        });
        rejected(decodeSequential(throwingLength, isNumber, 2), "invalid-length");
        rejected(decodeSequential(throwingElement, isNumber, 2), "missing-element");
        rejected(
            decodeSequential([1], (value): value is number => {
                void value;
                throw "guard";
            }, 2),
            "invalid-element",
        );
    });

    it("accepts KWin Q_PROPERTY list marshalling where indexed reads work but Reflect.has reports absent", () => {
        // KWin exposes `QList<VirtualDesktop *>` Q_PROPERTYs to QJSEngine as an
        // array-like sequence: `length` and indexed reads resolve, but
        // `Reflect.has(value, index)` reports false for every element. Sparse
        // boundaries still read as undefined and must stay rejected.
        const sequenceLike = new Proxy({} as object, {
            get(_target, property): unknown {
                if (property === "length") {
                    return 2;
                }
                if (property === "0" || property === "1") {
                    return { id: `desktop-${String(property)}` };
                }
                return undefined;
            },
            has(): boolean {
                return false;
            },
        });
        assert.deepEqual(
            decoded(decodeSequential(sequenceLike, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH)),
            [{ id: "desktop-0" }, { id: "desktop-1" }],
        );
        rejected(decodeSequential({ 0: { id: "desktop-0" }, length: 2 }, isVirtualDesktop, 2), "missing-element");
    });
});

describe("boundary capability guards", () => {
    it("accepts narrow declared capabilities and rejects malformed values", () => {
        const plainTile = tile();
        const window = {
            normalWindow: true,
            managed: true,
            resizeable: true,
            appletPopup: false,
            output: OUTPUT,
            tile: plainTile,
            frameGeometry: RECT,
            move: false,
            resize: false,
        };
        assert.equal(isRect(RECT), true);
        assert.equal(isOutput(OUTPUT), true);
        assert.equal(isVirtualDesktop({ id: "desktop-1" }), true);
        assert.equal(isTile(plainTile), true);
        assert.equal(isWindow(window), true);
        assert.equal(isOutput({ ...OUTPUT, serialNumber: 1 }), false);
        assert.equal(isVirtualDesktop({ id: 1 }), false);
        assert.equal(isTile({ ...plainTile, windows: undefined }), true);
        assert.equal(isWindow({ ...window, resizeable: "yes" }), false);
    });

    it("recognizes split capability without invoking it and contains throwing getters", () => {
        let splits = 0;
        const customTile = {
            ...tile(),
            layoutDirection: 1,
            split: () => {
                splits += 1;
                throw new Error("must not run");
            },
        };
        const throwingOutput = {};
        Object.defineProperty(throwingOutput, "geometry", {
            get() {
                throw "geometry";
            },
        });
        assert.equal(isCustomTile(customTile), true);
        assert.equal(splits, 0);
        assert.equal(isCustomTile({ ...customTile, split: 1 }), false);
        assert.equal(isOutput(throwingOutput), false);
    });

    it("decodes the native maximize enum Restore=0, Vertical=1, Horizontal=2, Full=3", () => {
        const maximizeWindow = {
            normalWindow: true,
            managed: true,
            resizeable: true,
            appletPopup: false,
            desktops: [],
            output: OUTPUT,
            tile: null,
            frameGeometry: RECT,
            move: false,
            resize: false,
            maximizeMode: 0,
        };
        assert.equal(isNativelyMaximized(maximizeWindow), false);
        assert.equal(isNativelyMaximized({ ...maximizeWindow, maximizeMode: 1 }), true);
        assert.equal(isNativelyMaximized({ ...maximizeWindow, maximizeMode: 2 }), true);
        assert.equal(isNativelyMaximized({ ...maximizeWindow, maximizeMode: 3 }), true);
        assert.equal(isNativelyMaximized({ ...maximizeWindow, maximizeMode: 4 }), false);
        assert.equal(isNativelyMaximized({ ...maximizeWindow, maximizeMode: -1 }), false);
        assert.equal(isNativelyMaximized({ ...maximizeWindow, maximizeMode: 1.5 }), false);
        assert.equal(
            isNativelyMaximized({ ...maximizeWindow, maximizeMode: "3" } as unknown as WindowCapability),
            false,
        );
        assert.equal(
            isNativelyMaximized({ ...maximizeWindow, maximizeMode: undefined } as unknown as WindowCapability),
            false,
        );
        assert.equal(isNativelyMaximized({ ...maximizeWindow }), false);
    });
});

describe("detachWindowFromTile", () => {
    function windowOn(tileValue: object | null): {
        normalWindow: boolean;
        managed: boolean;
        resizeable: boolean;
        appletPopup: boolean;
        desktops: readonly unknown[];
        output: typeof OUTPUT;
        tile: object | null;
        frameGeometry: typeof RECT;
        move: boolean;
        resize: boolean;
    } {
        return {
            normalWindow: true,
            managed: true,
            resizeable: true,
            appletPopup: false,
            desktops: [],
            output: OUTPUT,
            tile: tileValue,
            frameGeometry: RECT,
            move: false,
            resize: false,
        };
    }

    it("detaches a writable tile association with one null write", () => {
        const tileValue = { kind: "custom" };
        const window = windowOn(tileValue);
        let assigned: object | null = tileValue;
        let writes = 0;
        Object.defineProperty(window, "tile", {
            configurable: true,
            get: () => assigned,
            set: (value: object | null) => {
                writes += 1;
                assigned = value;
            },
        });
        assert.equal(detachWindowFromTile(window), true);
        assert.equal(window.tile, null);
        assert.equal(writes, 1);
    });

    it("reports false and leaves a non-writable association unchanged", () => {
        const tileValue = { kind: "custom" };
        const window = windowOn(tileValue);
        Object.defineProperty(window, "tile", {
            configurable: true,
            value: tileValue,
            writable: false,
        });
        assert.equal(detachWindowFromTile(window), false);
        assert.equal(window.tile, tileValue);
    });

    it("contains a throwing tile setter and reports false without leaking the error", () => {
        const tileValue = { kind: "custom" };
        const window = windowOn(tileValue);
        Object.defineProperty(window, "tile", {
            configurable: true,
            get: () => tileValue,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        assert.equal(detachWindowFromTile(window), false);
        assert.equal(window.tile, tileValue);
    });
});

describe("assignWindowToTile", () => {
    function windowOn(tileValue: object | null): {
        normalWindow: boolean;
        managed: boolean;
        resizeable: boolean;
        appletPopup: boolean;
        desktops: readonly unknown[];
        output: typeof OUTPUT;
        tile: object | null;
        frameGeometry: typeof RECT;
        move: boolean;
        resize: boolean;
    } {
        return {
            normalWindow: true,
            managed: true,
            resizeable: true,
            appletPopup: false,
            desktops: [],
            output: OUTPUT,
            tile: tileValue,
            frameGeometry: RECT,
            move: false,
            resize: false,
        };
    }

    it("assigns a writable tile association with one guarded write", () => {
        const source = { kind: "source" };
        const target = tile();
        const window = windowOn(source);
        let assigned: object | null = source;
        let writes = 0;
        Object.defineProperty(window, "tile", {
            configurable: true,
            get: () => assigned,
            set: (value: object | null) => {
                writes += 1;
                assigned = value;
            },
        });
        assert.equal(assignWindowToTile(window, target), true);
        assert.equal(window.tile, target);
        assert.equal(writes, 1);
    });

    it("reports false and leaves a non-writable association unchanged", () => {
        const source = { kind: "source" };
        const target = tile();
        const window = windowOn(source);
        Object.defineProperty(window, "tile", {
            configurable: true,
            value: source,
            writable: false,
        });
        assert.equal(assignWindowToTile(window, target), false);
        assert.equal(window.tile, source);
    });

    it("contains a throwing tile setter and reports false without leaking the error", () => {
        const source = { kind: "source" };
        const target = tile();
        const window = windowOn(source);
        Object.defineProperty(window, "tile", {
            configurable: true,
            get: () => source,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        assert.equal(assignWindowToTile(window, target), false);
        assert.equal(window.tile, source);
    });
});

describe("scope, containment, and transient state", () => {
    it("compares scope by output reference and desktop id like pure logic", () => {
        const output = {};
        const boundaryScope: BoundaryScope = { output, desktopId: "one" };
        const logicScope: LogicScope = boundaryScope;
        assert.equal(sameScope(boundaryScope, { output, desktopId: "one" }), true);
        assert.equal(sameScope(boundaryScope, { output: {}, desktopId: "one" }), false);
        assert.equal(sameScope(boundaryScope, { output, desktopId: "two" }), false);
        assert.equal(sameLogicScope(logicScope, boundaryScope), true);
    });

    it("disables and logs exactly once after unknown thrown values", () => {
        const gate = new FeatureGate();
        const errors: unknown[] = [];
        let runs = 0;
        const first = gate.run(() => {
            runs += 1;
            throw { reason: "failure" };
        }, (error) => errors.push(error));
        const second = gate.run(() => {
            runs += 1;
            return "unreachable";
        }, (error) => errors.push(error));
        assert.equal(first.ok, false);
        assert.equal(second.ok, false);
        assert.equal(gate.isEnabled, false);
        assert.equal(runs, 1);
        assert.equal(errors.length, 1);
        const loggerFailure = new FeatureGate();
        const result = loggerFailure.run(() => {
            throw "failure";
        }, () => {
            throw "logger";
        });
        assert.equal(result.ok, false);
        assert.equal(loggerFailure.isEnabled, false);
    });

    it("clears generic transient state on explicit scope changes", () => {
        const state = new TransientState<{ readonly id: string }>();
        state.set({ id: "pending" });
        assert.deepEqual(state.current, { id: "pending" });
        state.clearForScopeChange();
        assert.equal(state.current, undefined);
        state.set({ id: "next" });
        state.clear();
        assert.equal(state.current, undefined);
    });
});
