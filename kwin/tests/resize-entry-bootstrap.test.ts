import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resizeFingerprint } from "../src/resize-adapter";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry";
import { formatRouteDiag } from "../src/route-diag";

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

    it("emits one bounded per-window diagnostic per sorted candidate on middle-not-wide", () => {
        const { workspace, byId } = makeTrioWorld({ rectB: { x: 100, y: 100, w: 400, h: 640 } });
        const captionSentinel = "SecretCaption-SENTINEL-9f3a-middle";
        const titleSentinel = "SecretTitle-SENTINEL-9f3a-middle";
        const classSentinel = "SecretClass-SENTINEL-9f3a-middle";
        for (const id of ["win-a", "win-b", "win-c"]) {
            byId[id]["caption"] = `${captionSentinel}-${id}`;
            byId[id]["title"] = `${titleSentinel}-${id}`;
            byId[id]["resourceClass"] = `${classSentinel}-${id}`;
        }
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        const summary = logs.find((line) => line.includes(":scope:"));
        assert.ok(summary?.includes("reason=middle-not-wide"), summary);
        const perWindow = logs.filter((line) => line.includes("detail=trio-slot-"));
        assert.equal(perWindow.length, 3);
        const bySlot: Record<string, string> = {};
        for (const line of perWindow) {
            assert.match(
                line,
                /^plasma-auto-tiler:route-diag:scope:detail=trio-slot-[012]:kind=(landscape|portrait|square):result=(pass|fail):wid=[0-9a-f]{8}$/,
            );
            assert.ok(line.includes("wid="), line);
            assert.ok(!line.includes("corr="), line);
            for (const slot of ["trio-slot-0", "trio-slot-1", "trio-slot-2"]) {
                if (line.includes(`detail=${slot}`)) {
                    assert.ok(bySlot[slot] === undefined, `duplicate ${slot}`);
                    bySlot[slot] = line;
                }
            }
        }
        assert.ok(bySlot["trio-slot-0"]?.includes("kind=landscape"), bySlot["trio-slot-0"]);
        assert.ok(bySlot["trio-slot-0"]?.includes("result=pass"), bySlot["trio-slot-0"]);
        assert.ok(bySlot["trio-slot-1"]?.includes("kind=portrait"), bySlot["trio-slot-1"]);
        assert.ok(bySlot["trio-slot-1"]?.includes("result=fail"), bySlot["trio-slot-1"]);
        assert.ok(bySlot["trio-slot-2"]?.includes("kind=portrait"), bySlot["trio-slot-2"]);
        assert.ok(bySlot["trio-slot-2"]?.includes("result=pass"), bySlot["trio-slot-2"]);
        const wids = perWindow.map((line) => line.split("wid=")[1] as string);
        assert.ok(new Set(wids).size === 3, `hashes must distinguish windows: ${wids}`);
        for (const wid of wids) {
            assert.match(wid, /^[0-9a-f]{8}$/);
        }
        // Malformed identities fail closed to a fixed token, never echoed.
        assert.ok(
            formatRouteDiag("scope", [["wid", "BAD!!"]]).includes("wid=00000000"),
        );
        assert.ok(
            formatRouteDiag("scope", [["wid", "ABCDEF12"]]).includes("wid=00000000"),
        );
        for (const line of perWindow) {
            assert.ok(!line.includes("win-a") && !line.includes("win-b") && !line.includes("win-c"), line);
            assert.ok(!line.includes(captionSentinel) && !line.includes(titleSentinel) && !line.includes(classSentinel), line);
        }
        const joined = logs.join("\n");
        assert.ok(!joined.includes("win-a") && !joined.includes("win-b") && !joined.includes("win-c"));
        assert.ok(!joined.includes(captionSentinel) && !joined.includes(titleSentinel) && !joined.includes(classSentinel));
        handle.stop();
    });

    it("emits one bounded per-window diagnostic per sorted candidate on last-not-tall", () => {
        const { workspace, byId } = makeTrioWorld({ rectC: { x: 200, y: 200, w: 640, h: 400 } });
        const captionSentinel = "SecretCaption-SENTINEL-51c7-last";
        for (const id of ["win-a", "win-b", "win-c"]) {
            byId[id]["caption"] = `${captionSentinel}-${id}`;
        }
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        const summary = logs.find((line) => line.includes(":scope:"));
        assert.ok(summary?.includes("reason=last-not-tall"), summary);
        const perWindow = logs.filter((line) => line.includes("detail=trio-slot-"));
        assert.equal(perWindow.length, 3);
        const bySlot: Record<string, string> = {};
        for (const line of perWindow) {
            assert.match(
                line,
                /^plasma-auto-tiler:route-diag:scope:detail=trio-slot-[012]:kind=(landscape|portrait|square):result=(pass|fail):wid=[0-9a-f]{8}$/,
            );
            assert.ok(line.includes("wid="), line);
            assert.ok(!line.includes("corr="), line);
            for (const slot of ["trio-slot-0", "trio-slot-1", "trio-slot-2"]) {
                if (line.includes(`detail=${slot}`)) {
                    assert.ok(bySlot[slot] === undefined, `duplicate ${slot}`);
                    bySlot[slot] = line;
                }
            }
        }
        assert.ok(bySlot["trio-slot-0"]?.includes("kind=landscape"), bySlot["trio-slot-0"]);
        assert.ok(bySlot["trio-slot-0"]?.includes("result=pass"), bySlot["trio-slot-0"]);
        assert.ok(bySlot["trio-slot-1"]?.includes("kind=landscape"), bySlot["trio-slot-1"]);
        assert.ok(bySlot["trio-slot-1"]?.includes("result=pass"), bySlot["trio-slot-1"]);
        assert.ok(bySlot["trio-slot-2"]?.includes("kind=landscape"), bySlot["trio-slot-2"]);
        assert.ok(bySlot["trio-slot-2"]?.includes("result=fail"), bySlot["trio-slot-2"]);
        for (const line of perWindow) {
            assert.ok(!line.includes("win-a") && !line.includes("win-b") && !line.includes("win-c"), line);
            assert.ok(!line.includes(captionSentinel), line);
            assert.ok(!line.includes("640") || line.includes("wid="), line);
        }
        const joined = logs.join("\n");
        assert.ok(!joined.includes("win-a") && !joined.includes("win-b") && !joined.includes("win-c"));
        assert.ok(!joined.includes(captionSentinel));
        // Raw geometry pairs must never appear as structured values.
        assert.ok(!joined.includes("width=640") && !joined.includes("height=400"));
        handle.stop();
    });

    it("covers the square orientation token without leaking geometry", () => {
        const { workspace } = makeTrioWorld({ rectB: { x: 100, y: 100, w: 500, h: 500 } });
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        const summary = logs.find((line) => line.includes(":scope:"));
        assert.ok(summary?.includes("reason=middle-not-wide"), summary);
        const perWindow = logs.filter((line) => line.includes("detail=trio-slot-"));
        assert.equal(perWindow.length, 3);
        const slot1 = perWindow.find((line) => line.includes("detail=trio-slot-1"));
        assert.ok(slot1?.includes("kind=square"), slot1);
        assert.ok(slot1?.includes("result=fail"), slot1);
        const slot2 = perWindow.find((line) => line.includes("detail=trio-slot-2"));
        assert.ok(slot2?.includes("kind=portrait"), slot2);
        assert.ok(slot2?.includes("result=pass"), slot2);
        handle.stop();
    });

    it("emits per-window diagnostics without relying on Qt wrapper simplification", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const winA = makeWindow("win-a", { x: 0, y: 0, w: 800, h: 600 }, output, desktop);
        const winB = makeWindow("win-b", { x: 100, y: 100, w: 400, h: 640 }, output, desktop);
        const winC = makeWindow("win-c", { x: 200, y: 200, w: 400, h: 640 }, output, desktop);
        // Qt-style list object (length plus indexed properties), not an Array.
        const qtList = { length: 3, "0": winA, "1": winB, "2": winC };
        // Distinct active wrapper: same normalized internalId as win-a but a
        // different object identity, proving id-sort matching is used.
        const activeClone: Record<string, unknown> = {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            resizeable: true,
            output: { name: "out-1" },
            desktops: [desktop],
            internalId: "win-a",
            frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
            moveResizedChanged: makeSignal(),
        };
        assert.notEqual(activeClone, winA);
        const workspace: Record<string, unknown> = {
            activeWindow: activeClone,
            windowList: (): unknown => qtList,
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            windowActivated: makeSignal(),
            windowAdded: makeSignal(),
            windowRemoved: makeSignal(),
            screensChanged: makeSignal(),
            currentDesktopChanged: makeSignal(),
        };
        const calls: DbusCall[] = [];
        const logs: string[] = [];
        const holder = { current: 0 };
        const handle = startWithCapture(workspace, holder, calls, logs);
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        assert.equal(calls.length, 0);
        assert.equal(holder.current, 0);
        const summary = logs.find(
            (line) => line.includes("route-diag:scope") && line.includes("reason=middle-not-wide"),
        );
        assert.ok(summary !== undefined, logs.join("\n"));
        const perWindow = logs.filter((line) => line.includes("detail=trio-slot-"));
        assert.equal(perWindow.length, 3);
        for (const line of perWindow) {
            assert.match(
                line,
                /^plasma-auto-tiler:route-diag:scope:detail=trio-slot-[012]:kind=(landscape|portrait|square):result=(pass|fail):wid=[0-9a-f]{8}$/,
            );
            assert.ok(line.includes("wid="), line);
            assert.ok(!line.includes("corr="), line);
            assert.ok(!line.includes("win-a") && !line.includes("win-b") && !line.includes("win-c"), line);
        }
        handle.stop();
    });
});
