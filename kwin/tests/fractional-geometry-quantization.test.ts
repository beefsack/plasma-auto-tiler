import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MOVEMENT_METHOD } from "../src/movement-adapter.js";
import { startMovementAdapterEntry } from "../src/movement-adapter-entry.js";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry.js";
import { startPointerResizeAdapterEntry } from "../src/pointer-resize-adapter-entry.js";

function sig(): { connect: (h: () => void) => void; disconnect: (h: () => void) => void } {
    const handlers = new Set<() => void>();
    return {
        connect: (h): void => {
            handlers.add(h);
        },
        disconnect: (h): void => {
            handlers.delete(h);
        },
    };
}

function interactiveSig(): {
    connect: (h: (p?: unknown) => void) => void;
    disconnect: (h: (p?: unknown) => void) => void;
} {
    const handlers = new Set<(p?: unknown) => void>();
    return {
        connect: (h): void => {
            handlers.add(h);
        },
        disconnect: (h): void => {
            handlers.delete(h);
        },
    };
}

// KWin 6.7.4 QRectF surface at Scale 1.25: fractional logical geometry with
// deterministic id order (win-a < win-b).
function fractionalWorld(area: unknown, frameA: unknown, frameB: unknown): Record<string, unknown> {
    const output = { name: "out-1" };
    const desktop = { id: "ws-1" };
    const winA: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output,
        desktops: [desktop],
        internalId: "win-a",
        frameGeometry: frameA,
        move: false,
        resize: false,
        moveResizedChanged: sig(),
        interactiveMoveResizeStarted: interactiveSig(),
        interactiveMoveResizeStepped: interactiveSig(),
        interactiveMoveResizeFinished: interactiveSig(),
    };
    const winB: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output,
        desktops: [desktop],
        internalId: "win-b",
        frameGeometry: frameB,
        move: false,
        resize: false,
        moveResizedChanged: sig(),
        interactiveMoveResizeStarted: interactiveSig(),
        interactiveMoveResizeStepped: interactiveSig(),
        interactiveMoveResizeFinished: interactiveSig(),
    };
    return {
        activeWindow: winA,
        windowList: (): unknown[] => [winA, winB],
        screens: [output],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => area,
        windowActivated: sig(),
        windowAdded: sig(),
        windowRemoved: sig(),
        screensChanged: sig(),
        currentDesktopChanged: sig(),
    };
}

const FRACTIONAL_AREA = { x: 0.4, y: 0.2, width: 1535.6, height: 863.2 };
const FRACTIONAL_A = { x: 0.4, y: 0.2, width: 767.8, height: 863.2 };
const FRACTIONAL_B = { x: 768.2, y: 0.2, width: 767.4, height: 863.2 };

describe("fractional QRectF quantization at observation boundary", () => {
    it("movement attaches on fractional surface with integer wire bounds", () => {
        const surface = fractionalWorld(FRACTIONAL_AREA, FRACTIONAL_A, FRACTIONAL_B);
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const logs: string[] = [];
        const handle = startMovementAdapterEntry({
            workspace: surface,
            callDbus: (_s, _p, _i, method, payload, cb): void => {
                dbusCalls.push({ method, payload });
                callbacks.push(cb);
            },
            scheduleOnce: () => () => {},
            log: (m): void => {
                logs.push(m);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveMovementAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((l) => l.endsWith(":ready")));
        handle.request("right");
        assert.equal(dbusCalls.length, 1);
        callbacks[0]?.(":1.42");
        const planner = dbusCalls.find((c) => c.method === MOVEMENT_METHOD);
        assert.ok(planner !== undefined);
        const payload = JSON.parse(planner.payload) as Record<string, unknown>;
        const domains = payload["domains"] as Array<Record<string, unknown>>;
        assert.equal(domains.length, 1);
        assert.deepEqual(domains[0]?.["bounds"], {
            x: Math.round(0.4),
            y: Math.round(0.2),
            w: Math.round(1535.6),
            h: Math.round(863.2),
        });
        handle.stop();
    });

    it("keyboard resize attaches on the same fractional surface/order", () => {
        const surface = fractionalWorld(FRACTIONAL_AREA, FRACTIONAL_A, FRACTIONAL_B);
        const logs: string[] = [];
        const handle = startResizeAdapterEntry({
            workspace: surface,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (m): void => {
                logs.push(m);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((l) => l.endsWith(":ready")));
        handle.stop();
    });

    it("pointer resize attaches on the same fractional surface/order", () => {
        const surface = fractionalWorld(FRACTIONAL_AREA, FRACTIONAL_A, FRACTIONAL_B);
        const logs: string[] = [];
        const handle = startPointerResizeAdapterEntry({
            workspace: surface,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (m): void => {
                logs.push(m);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((l) => l.endsWith(":ready")));
        handle.stop();
    });

    it("differential: fractional attaches all three while non-finite stays fail-closed", () => {
        const good = fractionalWorld(FRACTIONAL_AREA, FRACTIONAL_A, FRACTIONAL_B);
        const badArea = { x: 0, y: 0, width: Number.NaN, height: 1080 };
        const bad = fractionalWorld(badArea, FRACTIONAL_A, FRACTIONAL_B);
        const startAll = (
            surface: unknown,
        ): { movement: unknown; resize: unknown; pointer: unknown } => ({
            movement: startMovementAdapterEntry({
                workspace: surface,
                callDbus: () => {},
                scheduleOnce: () => () => {},
                log: () => {},
                owner: "owner-1",
                generation: "gen-1",
                hasExclusiveMovementAuthority: () => true,
            }),
            resize: startResizeAdapterEntry({
                workspace: surface,
                callDbus: () => {},
                scheduleOnce: () => () => {},
                log: () => {},
                owner: "owner-1",
                generation: "gen-1",
                hasExclusiveResizeAuthority: () => true,
            }),
            pointer: startPointerResizeAdapterEntry({
                workspace: surface,
                callDbus: () => {},
                scheduleOnce: () => () => {},
                log: () => {},
                owner: "owner-1",
                generation: "gen-1",
                hasExclusiveResizeAuthority: () => true,
            }),
        });
        const attached = startAll(good);
        assert.ok(attached.movement !== null);
        assert.ok(attached.resize !== null);
        assert.ok(attached.pointer !== null);
        (attached.movement as { stop: () => void }).stop();
        (attached.resize as { stop: () => void }).stop();
        (attached.pointer as { stop: () => void }).stop();
        // All-or-nothing counterpart: one non-finite work-area value leaves
        // every quantized slice unavailable, preserving fail-closed.
        const rejected = startAll(bad);
        assert.equal(rejected.movement, null);
        assert.equal(rejected.resize, null);
        assert.equal(rejected.pointer, null);
    });
});
