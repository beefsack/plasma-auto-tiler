// Smallest shared KWin direct-geometry write-ordering utility.
//
// Single canonical grow-before-shrink order reused by the movement and resize
// adapters: changed windows only, descending new-minus-old area delta (growing
// covering rectangles first), lexical window id tie-break. Every changed
// window appears exactly once; unchanged windows are skipped. No topology,
// share, or identity math lives here.

export interface OrderedRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface OrderedEntry {
    readonly window: string;
    readonly rect: OrderedRect;
}

function sameRect(a: OrderedRect, b: OrderedRect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rectArea(rect: OrderedRect): number {
    return rect.w * rect.h;
}

export function orderGeometryWrites<T extends OrderedEntry>(
    oldById: ReadonlyMap<string, OrderedRect>,
    desired: ReadonlyArray<T>,
): ReadonlyArray<T> {
    const changed = desired.filter((entry) => {
        const old = oldById.get(entry.window);
        if (old === undefined) {
            return true;
        }
        return !sameRect(old, entry.rect);
    });
    const scored = changed.map((entry) => {
        const old = oldById.get(entry.window);
        const delta = old === undefined ? rectArea(entry.rect) : rectArea(entry.rect) - rectArea(old);
        return { entry, delta };
    });
    scored.sort((a, b) => {
        if (b.delta !== a.delta) {
            return b.delta - a.delta;
        }
        return a.entry.window < b.entry.window ? -1 : a.entry.window > b.entry.window ? 1 : 0;
    });
    return Object.freeze(scored.map((item) => item.entry));
}
