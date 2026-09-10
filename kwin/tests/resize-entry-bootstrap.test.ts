import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resizeFingerprint } from "../src/resize-adapter";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry";

interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

function makeSignal(): {
    connect: (handler: (payload?: unknown) => void) => void;
    disconnect: (handler: (payload?: unknown) => void) => void;
} {
    const handlers = new Set<(payload?: unknown) => void>();
    return {
        connect: (handler) => {
            handlers.add(handler);
        },
        disconnect: (handler) => {
            handlers.delete(handler);
        },
    };
}

function makeWindow(
    id: string,
    rect: Rect,
    output: object,
    desktop: object,
): Record<string, unknown> {
    return {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output,
        desktops: [desktop],
        internalId: id,
        frameGeometry: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        moveResizedChanged: makeSignal(),
    };
}

function makeTrioWorld(options: {
    readonly rectB?: Rect;
    readonly rectC?: Rect;
    readonly active?: string;
    readonly twoWindows?: boolean;
}): {
    readonly workspace: Record<string, unknown>;
    readonly byId: Record<string, Record<string, unknown>>;
} {
    const output = { name: "out-1" };
    const desktop = { id: "ws-1" };
    const rectB = options.rectB ?? { x: 100, y: 100, w: 640, h: 400 };
    const rectC = options.rectC ?? { x: 200, y: 200, w: 400, h: 640 };
    const winA = makeWindow("win-a", { x: 0, y: 0, w: 800, h: 600 }, output, desktop);
    const winB = makeWindow("win-b", rectB, output, desktop);
    const winC = makeWindow("win-c", rectC, output, desktop);
    const list = options.twoWindows === true ? [winA, winB] : [winA, winB, winC];
    const byId: Record<string, Record<string, unknown>> = {
        "win-a": winA,
        "win-b": winB,
        "win-c": winC,
    };
    const workspace: Record<string, unknown> = {
        activeWindow: byId[options.active ?? "win-a"],
        windowList: (): unknown[] => [...list],
        screens: [output],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        windowActivated: makeSignal(),
        windowAdded: makeSignal(),
        windowRemoved: makeSignal(),
        screensChanged: makeSignal(),
        currentDesktopChanged: makeSignal(),
    };
    return { workspace, byId };
}

interface DbusCall {
    readonly service: string;
    readonly method: string;
    readonly payload: string;
}

function startWithCapture(
    workspace: Record<string, unknown>,
    revision: unknown,
    calls: DbusCall[],
    logs: string[],
): ReturnType<typeof startResizeAdapterEntry> {
    return startResizeAdapterEntry({
        workspace,
        callDbus: (service, _path, _iface, method, payload, callback) => {
            calls.push({ service, method, payload });
            if (method === "GetNameOwner") {
                callback(":1.7");
            }
        },
        scheduleOnce: () => () => {},
        log: (message) => {
            logs.push(message);
        },
        owner: "plasma-auto-tiler",
        generation: "packaged-rust-1",
        revision,
        hasExclusiveResizeAuthority: () => true,
    });
}

function plannerPayload(calls: DbusCall[]): Record<string, unknown> {
    // Planner requests address the pinned unique owner, not the well-known
    // name; match the method.
    const found = calls.find((call) => call.method === "DescribeResize");
    assert.ok(found !== undefined, "bootstrap must send one Planner request");
    return JSON.parse(found.payload) as Record<string, unknown>;
}

describe("resize entry exact-three bootstrap", () => {
    it("adopts eligible windows with focus alignment and a canonical intent", () => {
        const { workspace, byId } = makeTrioWorld({ active: "win-a" });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        // Deterministic focus alignment to the sorted-last window first.
        assert.equal(workspace["activeWindow"], byId["win-c"]);
        const payload = plannerPayload(calls);
        assert.equal(payload["v"], 1);
        assert.equal(payload["action"], "request");
        assert.equal(payload["owner"], "plasma-auto-tiler");
        assert.equal(payload["generation"], "packaged-rust-1");
        assert.equal(payload["revision"], 3);
        assert.equal(payload["focused_window"], "win-c");
        assert.equal(payload["direction"], "up");
        assert.equal(payload["mode"], "inwards");
        assert.equal(payload["press_index"], 0);
        const domain = payload["domain"] as Record<string, unknown>;
        assert.equal(domain["output"], "out-1");
        assert.equal(domain["workspace"], "ws-1");
        assert.deepEqual(domain["bounds"], { x: 0, y: 0, w: 1920, h: 1080 });
        const windows = payload["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 3);
        const rects: Record<string, unknown> = {};
        for (const entry of windows) {
            rects[entry["window"] as string] = entry["rect"];
        }
        assert.deepEqual(rects["win-a"], { x: 0, y: 0, w: 800, h: 600 });
        assert.deepEqual(rects["win-b"], { x: 100, y: 100, w: 640, h: 400 });
        assert.deepEqual(rects["win-c"], { x: 200, y: 200, w: 400, h: 640 });
        assert.deepEqual(payload["capabilities"], {
            keyboard_resize: true,
            pointer_resize: false,
        });
        const expected = resizeFingerprint("out-1", "ws-1", "win-c", ["win-a", "win-b", "win-c"]);
        assert.equal(payload["fingerprint"], expected);
        // The shared holder advances with the seeding request.
        assert.equal(holder.current, 3);
        assert.ok(logs.some((line) => line.includes("resize-entry:bootstrap-trio")));
        handle.stop();
    });

    it("fires when the deterministic window is already active", () => {
        const { workspace } = makeTrioWorld({ active: "win-c" });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        plannerPayload(calls);
        assert.equal(holder.current, 3);
        handle.stop();
    });

    it("skips fail-closed with two windows and no side effects", () => {
        const { workspace, byId } = makeTrioWorld({ twoWindows: true });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(workspace["activeWindow"], byId["win-a"]);
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        assert.ok(logs.every((line) => !line.includes("bootstrap-trio")));
        handle.stop();
    });

    it("skips when the middle window is not wide", () => {
        const { workspace } = makeTrioWorld({ rectB: { x: 100, y: 100, w: 400, h: 640 } });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        const scope = logs.find((line) => line.includes(":scope:"));
        assert.ok(scope?.includes("reason=middle-not-wide"), scope);
        assert.ok(!scope?.includes("reason=last-not-tall"), scope);
        handle.stop();
    });

    it("skips when the last window is not tall", () => {
        const { workspace } = makeTrioWorld({ rectC: { x: 200, y: 200, w: 640, h: 400 } });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        const scope = logs.find((line) => line.includes(":scope:"));
        assert.ok(scope?.includes("reason=last-not-tall"), scope);
        assert.ok(!scope?.includes("reason=middle-not-wide"), scope);
        handle.stop();
    });

    it("skips when a rect escapes the work area", () => {
        const { workspace } = makeTrioWorld({ rectC: { x: 1800, y: 200, w: 400, h: 640 } });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        handle.stop();
    });

    it("skips on an established holder and on a plain number revision", () => {
        for (const revision of [{ current: 4 }, 0, undefined]) {
            const { workspace } = makeTrioWorld({});
            const calls: DbusCall[] = [];
            const logs: string[] = [];
            const handle = startWithCapture(workspace, revision, calls, logs);
            assert.ok(handle !== null);
            handle.tryBootstrapTrio?.();
            assert.equal(calls.length, 0);
            handle.stop();
        }
    });
});
