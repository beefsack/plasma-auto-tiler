import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startPlanAdapterEntry } from "../src/plan-adapter-entry";
import {
    workspaceShortcutCatalog,
    WorkspaceNativeAdapter,
} from "../src/workspace-native";

interface FakeOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
}

interface FakeDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface FakeSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function fakeSignal(): FakeSignal {
    const handlers: Array<(payload?: unknown) => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: (payload?: unknown) => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: (payload?: unknown) => void): void => {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
        },
    };
}

interface FakeWindow {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    internalId: string;
    resourceClass: string;
    output: FakeOutput;
    desktops: FakeDesktop[];
    frameGeometry: { x: number; y: number; width: number; height: number };
    frameGeometryChanged: FakeSignal["signal"];
    fullScreenChanged: FakeSignal["signal"];
    maximizedChanged: FakeSignal["signal"];
    desktopsChanged: FakeSignal["signal"];
}

interface FakeWorld {
    workspace: Record<string, unknown>;
    outputs: FakeOutput[];
    desktops: FakeDesktop[];
    wins: FakeWindow[];
    currentByOutput: Map<FakeOutput, FakeDesktop>;
    globalCurrent: FakeDesktop;
    created: number;
    signals: Record<string, FakeSignal>;
}

function makeOutput(name: string): FakeOutput {
    return { name, manufacturer: "m", model: "d", serialNumber: "s" };
}

function makeDesktop(id: string, num?: number): FakeDesktop {
    return num === undefined ? { id } : { id, x11DesktopNumber: num };
}

function fakeWorld(outputNames: string[], desktopIds: string[]): FakeWorld {
    const outputs = outputNames.map((name) => makeOutput(name));
    const desktops = desktopIds.map((id, index) => makeDesktop(id, index + 1));
    const currentByOutput = new Map<FakeOutput, FakeDesktop>();
    for (const output of outputs) {
        const first = desktops[0];
        if (first !== undefined) {
            currentByOutput.set(output, first);
        }
    }
    const firstDesktop = desktops[0];
    if (firstDesktop === undefined) {
        throw new Error("fake world needs desktops");
    }
    const world: FakeWorld = {
        workspace: {},
        outputs,
        desktops,
        wins: [],
        currentByOutput,
        globalCurrent: firstDesktop,
        created: desktopIds.length,
        signals: {},
    };
    const ws = world.workspace;
    ws["screens"] = outputs;
    ws["desktops"] = desktops;
    ws["activeWindow"] = null;
    ws["activeScreen"] = outputs[0] ?? null;
    ws["currentDesktopForScreen"] = (output: unknown): unknown =>
        world.currentByOutput.get(output as FakeOutput) ?? null;
    ws["currentDesktop"] = world.globalCurrent;
    ws["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        world.globalCurrent = desktop as FakeDesktop;
        ws["currentDesktop"] = desktop;
    };
    ws["createDesktop"] = (): void => {
        world.created += 1;
        const maxNum = world.desktops.reduce((best, entry) => Math.max(best, entry.x11DesktopNumber ?? 0), 0);
        const fresh = makeDesktop(`ws-new-${String(world.created)}`, maxNum + 1);
        world.desktops.push(fresh);
        ws["desktops"] = world.desktops;
    };
    ws["removeDesktop"] = (desktop: unknown): void => {
        const ref = desktop as FakeDesktop;
        const at = world.desktops.indexOf(ref);
        if (at >= 0) {
            world.desktops.splice(at, 1);
        }
        for (const [output, current] of world.currentByOutput) {
            if (current === ref) {
                const first = world.desktops[0];
                if (first !== undefined) {
                    world.currentByOutput.set(output, first);
                }
            }
        }
        if (world.globalCurrent === ref) {
            const first = world.desktops[0];
            if (first !== undefined) {
                world.globalCurrent = first;
                ws["currentDesktop"] = first;
            }
        }
        ws["desktops"] = world.desktops;
    };
    ws["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    ws["windowList"] = (): unknown[] => [...world.wins];
    for (const name of ["windowActivated", "desktopsChanged", "currentDesktopChanged", "screensChanged", "windowAdded", "windowRemoved"] as const) {
        const sig = fakeSignal();
        world.signals[name] = sig;
        ws[name] = sig.signal;
    }
    return world;
}

function addWindow(world: FakeWorld, id: string, desktop: FakeDesktop, output?: FakeOutput): FakeWindow {
    const out = output ?? world.outputs[0];
    if (out === undefined) {
        throw new Error("no output");
    }
    const win: FakeWindow = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        internalId: id,
        resourceClass: "test-app",
        output: out,
        desktops: [desktop],
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
        frameGeometryChanged: fakeSignal().signal,
        fullScreenChanged: fakeSignal().signal,
        maximizedChanged: fakeSignal().signal,
        desktopsChanged: fakeSignal().signal,
    };
    world.wins.push(win);
    return win;
}

function startNative(world: FakeWorld, mode: unknown): { adapter: WorkspaceNativeAdapter; logs: string[] } {
    const logs: string[] = [];
    const adapter = new WorkspaceNativeAdapter({
        getWorkspace: () => world.workspace,
        readWorkspaceMode: () => mode,
        log: (message) => {
            logs.push(message);
        },
    });
    assert.equal(adapter.enable(), true);
    return { adapter, logs };
}

function setCurrent(world: FakeWorld, output: FakeOutput, desktop: FakeDesktop): void {
    world.currentByOutput.set(output, desktop);
    world.globalCurrent = desktop;
    (world.workspace as Record<string, unknown>)["currentDesktop"] = desktop;
}

function currentOf(world: FakeWorld, output: FakeOutput): FakeDesktop {
    const found = world.currentByOutput.get(output);
    assert.ok(found !== undefined);
    return found;
}

function focusOutput(world: FakeWorld, output: FakeOutput): void {
    (world.workspace as Record<string, unknown>)["activeScreen"] = output;
    (world.workspace as Record<string, unknown>)["activeWindow"] = null;
}

describe("R-WS-08 previous toggle catalog", () => {
    it("publishes toggle plus separate letter and arrow alias relative rows", () => {
        const catalog = workspaceShortcutCatalog();
        assert.equal(catalog.length, 75);
        const byAction = new Map(catalog.map((row) => [row.action, row]));
        const toggle = byAction.get("omnitiler-workspace-previous");
        assert.ok(toggle !== undefined);
        assert.equal(toggle.sequence, "Meta+Ctrl+Tab");
        assert.equal(toggle.kind, "previous");
        const expected: ReadonlyArray<[string, string, -1 | 1]> = [
            ["omnitiler-workspace-prev-h", "Meta+Ctrl+H", -1],
            ["omnitiler-workspace-prev-k", "Meta+Ctrl+K", -1],
            ["omnitiler-workspace-prev-left-arrow", "Meta+Ctrl+Left", -1],
            ["omnitiler-workspace-prev-up-arrow", "Meta+Ctrl+Up", -1],
            ["omnitiler-workspace-next-j", "Meta+Ctrl+J", 1],
            ["omnitiler-workspace-next-l", "Meta+Ctrl+L", 1],
            ["omnitiler-workspace-next-down-arrow", "Meta+Ctrl+Down", 1],
            ["omnitiler-workspace-next-right-arrow", "Meta+Ctrl+Right", 1],
        ];
        for (const [action, sequence, delta] of expected) {
            const row = byAction.get(action);
            assert.ok(row !== undefined, action);
            assert.equal(row.sequence, sequence);
            assert.equal(row.kind, "relative");
            assert.equal(row.delta, delta);
        }
    });
});

describe("R-WS-08 two-view toggle", () => {
    it("toggles A<->B twice with no creation", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        const { adapter } = startNative(world, "per-output-local");
        const out = world.outputs[0] as FakeOutput;
        setCurrent(world, out, ws1);
        adapter.handleTopologySignal();
        assert.equal(adapter.selectLogical(2), true);
        adapter.handleTopologySignal();
        const before = world.desktops.length;
        assert.equal(currentOf(world, out), ws2);
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, out), ws1);
        assert.equal(world.desktops.length, before);
        adapter.handleTopologySignal();
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, out), ws2);
        assert.equal(world.desktops.length, before);
        adapter.disable();
    });

    it("does not record same activation or output focus alone", () => {
        const world = fakeWorld(["out-L", "out-R"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        const { adapter } = startNative(world, "per-output-local");
        const outL = world.outputs[0] as FakeOutput;
        const outR = world.outputs[1] as FakeOutput;
        setCurrent(world, outL, ws1);
        setCurrent(world, outR, ws2);
        focusOutput(world, outL);
        adapter.handleTopologySignal();
        assert.equal(adapter.selectLogical(2), true);
        adapter.handleTopologySignal();
        const snapBefore = adapter.previousSnapshot();
        const keys = Object.keys(snapBefore);
        assert.ok(keys.length >= 1);
        // Same activation: observe again with no change.
        adapter.handleTopologySignal();
        assert.deepEqual(adapter.previousSnapshot(), snapBefore);
        // Same-workspace select on the current view records nothing.
        focusOutput(world, outL);
        assert.equal(adapter.selectLogical(2), true);
        adapter.handleTopologySignal();
        assert.deepEqual(adapter.previousSnapshot(), snapBefore);
        // Output focus alone: move active screen without changing views.
        focusOutput(world, outR);
        adapter.handleTopologySignal();
        assert.deepEqual(adapter.previousSnapshot(), snapBefore);
        adapter.disable();
    });

    it("records native switches and verified send-follow alike", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1);
        addWindow(world, "win-keep-1", ws1);
        addWindow(world, "win-t", ws2);
        const { adapter } = startNative(world, "per-output-local");
        const out = world.outputs[0] as FakeOutput;
        setCurrent(world, out, ws1);
        adapter.handleTopologySignal();
        // Native producer: shell changes the view outside our commands.
        setCurrent(world, out, ws2);
        adapter.handleTopologySignal();
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, out), ws1);
        adapter.handleTopologySignal();
        // Verified send-follow producer: mover arrives plus view follows.
        winA.desktops = [ws2];
        setCurrent(world, out, ws2);
        (world.workspace as Record<string, unknown>)["activeWindow"] = winA;
        adapter.handleTopologySignal();
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, out), ws1);
        adapter.disable();
    });

    it("invalidates removed previous with no recreation or ordinal reuse", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        // ws-1 stays empty but visible at startup so lifecycle keeps it.
        addWindow(world, "win-2", ws2);
        const { adapter } = startNative(world, "per-output-local");
        const out = world.outputs[0] as FakeOutput;
        // Visit the empty ws-1 then the occupied ws-2.
        setCurrent(world, out, ws1);
        adapter.handleTopologySignal();
        assert.equal(adapter.selectLogical(2), true);
        adapter.handleTopologySignal();
        // The select away already lets lifecycle retire the invisible empty
        // nontrailing previous; otherwise remove it explicitly as native would.
        const at = world.desktops.indexOf(ws1);
        if (at >= 0) {
            assert.ok(!world.wins.some((win) => win.desktops.includes(ws1)), "empty fixture");
            world.desktops.splice(at, 1);
            (world.workspace as Record<string, unknown>)["desktops"] = world.desktops;
            adapter.handleTopologySignal();
        }
        assert.deepEqual(adapter.previousSnapshot(), {});
        const currentBefore = currentOf(world, out);
        assert.equal(adapter.selectPrevious(), false);
        assert.equal(currentOf(world, out), currentBefore);
        assert.ok(!world.desktops.some((entry) => entry.id === "ws-1"), "no recreation or ordinal reuse");
        adapter.disable();
    });

    it("keeps surviving empty previous valid", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        addWindow(world, "win-keep", ws1);
        const { adapter } = startNative(world, "per-output-local");
        const out = world.outputs[0] as FakeOutput;
        // Trailing empty ws-2 survives lifecycle; visit it then ws-1.
        const trailing = world.desktops.find((entry) => entry.id === "ws-2") ?? ws2;
        setCurrent(world, out, trailing as FakeDesktop);
        adapter.handleTopologySignal();
        setCurrent(world, out, ws1);
        adapter.handleTopologySignal();
        const ids = world.desktops.map((entry) => entry.id);
        assert.ok(ids.includes((trailing as FakeDesktop).id), "empty survivor present");
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, out).id, (trailing as FakeDesktop).id);
        adapter.disable();
    });

    it("R-WS-15 local/global per-output toggle leaves the other output alone; shared has one history", () => {
        for (const mode of ["per-output-local", "global-unique"] as const) {
            const world = fakeWorld(["out-L", "out-R"], ["ws-a", "ws-b"]);
            const wsa = world.desktops[0] as FakeDesktop;
            const wsb = world.desktops[1] as FakeDesktop;
            addWindow(world, "win-a", wsa, world.outputs[0]);
            addWindow(world, "win-b", wsb, world.outputs[0]);
            const { adapter } = startNative(world, mode);
            const outL = world.outputs[0] as FakeOutput;
            const outR = world.outputs[1] as FakeOutput;
            const snap = (): Readonly<Record<string, ReadonlyArray<string>>> =>
                mode === "per-output-local" ? adapter.localSnapshot() : adapter.globalSnapshot();
            // Build a truly scoped R pair through the trailing append seam.
            focusOutput(world, outR);
            assert.equal(adapter.selectTrailingOrCreate(), true);
            adapter.handleTopologySignal();
            const rKey = Object.keys(snap()).find((key) => !(snap()[key] as ReadonlyArray<string>).includes("ws-a")) as string;
            assert.ok(rKey !== undefined, `${mode} R key exists`);
            const rFirst = snap()[rKey] as ReadonlyArray<string>;
            const wsc = world.desktops.find((entry) => entry.id === rFirst[rFirst.length - 1]) as FakeDesktop;
            assert.ok(wsc !== undefined);
            addWindow(world, "win-c", wsc, outR);
            adapter.handleTopologySignal();
            assert.equal(adapter.selectTrailingOrCreate(), true);
            adapter.handleTopologySignal();
            const rList = snap()[rKey] as ReadonlyArray<string>;
            const wsd = world.desktops.find((entry) => entry.id === rList[rList.length - 1]) as FakeDesktop;
            assert.ok(wsd !== undefined);
            addWindow(world, "win-d", wsd, outR);
            adapter.handleTopologySignal();
            const lKey = Object.keys(snap()).find((key) => key !== rKey) as string;
            const lList = snap()[lKey] as ReadonlyArray<string>;
            assert.ok(lList.includes("ws-a") && lList.includes("ws-b"), `${mode} L owns A/B`);
            const rListNow = snap()[rKey] as ReadonlyArray<string>;
            assert.ok(rListNow.includes(wsc.id) && rListNow.includes(wsd.id), `${mode} R owns C/D`);
            assert.ok(!lList.includes(wsc.id) && !lList.includes(wsd.id), `${mode} R pair not in L`);
            // L A->B, R C->D with focused views.
            setCurrent(world, outL, wsa);
            setCurrent(world, outR, wsc);
            focusOutput(world, outL);
            adapter.handleTopologySignal();
            world.currentByOutput.set(outL, wsb);
            adapter.handleTopologySignal();
            world.currentByOutput.set(outR, wsd);
            adapter.handleTopologySignal();
            // Toggle twice on L: R stays D.
            focusOutput(world, outL);
            (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[1];
            assert.equal(adapter.selectPrevious(), true);
            assert.equal(currentOf(world, outL), wsa);
            assert.equal(currentOf(world, outR), wsd);
            adapter.handleTopologySignal();
            assert.equal(adapter.selectPrevious(), true);
            assert.equal(currentOf(world, outL), wsb);
            assert.equal(currentOf(world, outR), wsd);
            // Toggle twice on R: L stays B.
            focusOutput(world, outR);
            (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[world.wins.length - 1];
            assert.equal(adapter.selectPrevious(), true);
            assert.equal(currentOf(world, outR), wsc);
            assert.equal(currentOf(world, outL), wsb);
            adapter.handleTopologySignal();
            assert.equal(adapter.selectPrevious(), true);
            assert.equal(currentOf(world, outR), wsd);
            assert.equal(currentOf(world, outL), wsb);
            adapter.disable();
        }
        const shared = fakeWorld(["out-L", "out-R"], ["ws-a", "ws-b", "ws-c"]);
        const sa = shared.desktops[0] as FakeDesktop;
        const sb = shared.desktops[1] as FakeDesktop;
        const sc = shared.desktops[2] as FakeDesktop;
        addWindow(shared, "win-a", sa);
        addWindow(shared, "win-b", sb);
        addWindow(shared, "win-c", sc);
        const { adapter } = startNative(shared, "shared");
        const outL = shared.outputs[0] as FakeOutput;
        const outR = shared.outputs[1] as FakeOutput;
        const show = (desktop: FakeDesktop): void => {
            setCurrent(shared, outL, desktop);
            setCurrent(shared, outR, desktop);
            (shared.workspace as Record<string, unknown>)["currentDesktop"] = desktop;
        };
        show(sa);
        adapter.handleTopologySignal();
        show(sb);
        adapter.handleTopologySignal();
        show(sc);
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSharedSnapshot(), "ws-b");
        assert.deepEqual(adapter.previousSnapshot(), {});
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(shared, outL), sb);
        assert.equal(currentOf(shared, outR), sb);
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSharedSnapshot(), "ws-c");
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(shared, outL), sc);
        assert.equal(currentOf(shared, outR), sc);
        adapter.disable();
    });

    it("global-unique swap out of scope clears previous without recreation", () => {
        const world = fakeWorld(["out-L", "out-R"], ["ws-a", "ws-b"]);
        const wsa = world.desktops[0] as FakeDesktop;
        const wsb = world.desktops[1] as FakeDesktop;
        const outL = world.outputs[0] as FakeOutput;
        const outR = world.outputs[1] as FakeOutput;
        addWindow(world, "win-a", wsa, outL);
        addWindow(world, "win-b", wsb, outL);
        const { adapter } = startNative(world, "global-unique");
        setCurrent(world, outL, wsa);
        adapter.handleTopologySignal();
        // R shows a workspace owned by L; selecting it on L swaps the owners.
        world.currentByOutput.set(outR, wsb);
        adapter.handleTopologySignal();
        focusOutput(world, outL);
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[0];
        assert.equal(adapter.selectLogical(2), true);
        adapter.handleTopologySignal();
        assert.equal(currentOf(world, outL), wsb);
        assert.equal(currentOf(world, outR), wsa);
        assert.ok(world.desktops.some((entry) => entry.id === "ws-a"), "swapped target survives");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-b"), "swapped source survives");
        // The swapped-out source left L scope: toggle is a no-op, nothing created.
        focusOutput(world, outL);
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[1];
        const createdBeforeClear = world.created;
        assert.equal(adapter.selectPrevious(), false);
        assert.equal(currentOf(world, outL), wsb);
        assert.equal(world.created, createdBeforeClear, "clear creates nothing");
        adapter.disable();
    });
});

describe("R-WS-11 wrapping relative selection", () => {
    it("wraps both directions including trailing empty and ordinals beyond 9 without creating", () => {
        for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
            const ids: string[] = [];
            for (let n = 1; n <= 10; n += 1) {
                ids.push(`ws-${String(n)}`);
            }
            const world = fakeWorld(["out-1"], ids);
            for (const desktop of world.desktops) {
                addWindow(world, `win-${desktop.id}`, desktop);
            }
            const { adapter } = startNative(world, mode);
            const out = world.outputs[0] as FakeOutput;
            const trailing = world.desktops[world.desktops.length - 1] as FakeDesktop;
            assert.ok(trailing !== undefined, `${mode} trailing exists`);
            const ws10 = world.desktops.find((entry) => entry.id === "ws-10");
            assert.ok(ws10 !== undefined);
            setCurrent(world, out, ws10 as FakeDesktop);
            if (mode === "shared") {
                (world.workspace as Record<string, unknown>)["currentDesktop"] = ws10;
            }
            adapter.handleTopologySignal();
            // Next lands on the existing trailing empty; selection creates nothing.
            const createdBefore = world.created;
            assert.equal(adapter.selectRelative(1), true);
            assert.equal(world.created, createdBefore, `${mode} next creates nothing`);
            assert.equal(currentOf(world, out).id, trailing.id);
            adapter.handleTopologySignal();
            // Edge next wraps from the trailing last to the first.
            assert.equal(adapter.selectRelative(1), true);
            assert.equal(world.created, createdBefore, `${mode} wrap next creates nothing`);
            assert.equal(currentOf(world, out).id, "ws-1");
            adapter.handleTopologySignal();
            // Edge previous wraps from the first to the trailing last.
            assert.equal(adapter.selectRelative(-1), true);
            assert.equal(world.created, createdBefore, `${mode} wrap previous creates nothing`);
            assert.equal(currentOf(world, out).id, trailing.id);
            adapter.disable();
        }
    });

    it("rejects bad deltas and never creates on absent ring", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        addWindow(world, "win-1", ws1);
        const { adapter } = startNative(world, "per-output-local");
        const before = world.desktops.length;
        assert.equal(adapter.selectRelative(0), false);
        assert.equal(adapter.selectRelative(2), false);
        assert.equal(world.desktops.length, before);
        adapter.disable();
    });
});

describe("R-WS-08 hotplug history and reconnect independence", () => {
    it("R-WS-17 disconnect records, discards R history, return never restores, later changes record again", () => {
        const world = fakeWorld(["out-L", "out-R"], ["ws-1", "ws-2", "ws-d"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const wsd = world.desktops[2] as FakeDesktop;
        const outL = world.outputs[0] as FakeOutput;
        const outR = world.outputs[1] as FakeOutput;
        addWindow(world, "win-1", ws1, outL);
        addWindow(world, "win-2", ws2, outL);
        const winD = addWindow(world, "win-d", wsd, outR);
        (world.workspace as Record<string, unknown>)["activeWindow"] = winD;
        (world.workspace as Record<string, unknown>)["activeScreen"] = outL;
        setCurrent(world, outL, ws1);
        setCurrent(world, outR, wsd);
        const { adapter } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        const snap = adapter.localSnapshot();
        const rKey = Object.keys(snap).find((key) => !(snap[key] as ReadonlyArray<string>).includes("ws-1"));
        assert.ok(rKey !== undefined, "R has its own trailing scope");
        const rTrailingId = (snap[rKey] as ReadonlyArray<string>)[0] as string;
        const rTrailing = world.desktops.find((entry) => entry.id === rTrailingId);
        assert.ok(rTrailing !== undefined);
        // Establish history on the soon-disconnected R output: trailing -> D.
        world.currentByOutput.set(outR, rTrailing as FakeDesktop);
        adapter.handleTopologySignal();
        world.currentByOutput.set(outR, wsd);
        adapter.handleTopologySignal();
        const rSnap = adapter.previousSnapshot();
        assert.equal(rSnap[rKey as string], rTrailingId, "R history established");
        // Visit ws-1 -> ws-2 on L.
        world.currentByOutput.set(outL, ws2);
        world.globalCurrent = ws2;
        (world.workspace as Record<string, unknown>)["currentDesktop"] = ws2;
        (world.workspace as Record<string, unknown>)["activeWindow"] = winD;
        adapter.handleTopologySignal();
        // Disconnect R: prove the hotplug-driven view change before/after.
        const beforeDisconnect = currentOf(world, outL);
        assert.equal(beforeDisconnect, ws2);
        (world.workspace as Record<string, unknown>)["screens"] = [outL];
        adapter.handleTopologySignal();
        winD.output = outL;
        (world.workspace as Record<string, unknown>)["activeScreen"] = outL;
        (world.workspace as Record<string, unknown>)["activeWindow"] = winD;
        assert.equal(currentOf(world, outL), wsd, "disconnect displaces D onto L");
        const lSnap = adapter.previousSnapshot();
        const lKey = Object.keys(lSnap).find((key) => key !== rKey) ?? Object.keys(adapter.localSnapshot())[0];
        assert.equal(lSnap[lKey as string], "ws-2", "hotplug change recorded");
        assert.ok(!(rKey as string in adapter.previousSnapshot()), "R history discarded on disconnect");
        // First toggle selects ws-2 with previous D.
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[1];
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, outL), ws2);
        adapter.handleTopologySignal();
        // Reconnect R with a different initial view and no active window in
        // the returning set: return restores mapping without consulting
        // history, and no pre-disconnect baseline resurrects.
        world.currentByOutput.set(outR, ws1);
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[0];
        (world.workspace as Record<string, unknown>)["screens"] = [outL, outR];
        adapter.handleTopologySignal();
        assert.equal(currentOf(world, outL), ws2, "reconnect preserves L, never consults history");
        assert.equal(currentOf(world, outR), ws1, "return begins from the newly observed view");
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[1];
        assert.equal(adapter.selectPrevious(), false, "moved previous cleared");
        assert.equal(currentOf(world, outL), ws2);
        assert.ok(!(rKey as string in adapter.previousSnapshot()), "no restored R previous");
        // Later changes record again from the primed return baselines.
        world.currentByOutput.set(outL, ws1);
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSnapshot()[lKey as string], "ws-2");
        world.currentByOutput.set(outR, wsd);
        adapter.handleTopologySignal();
        assert.ok(!(rKey as string in adapter.previousSnapshot()), "out-of-scope return view clears");
        const rList = adapter.localSnapshot()[rKey as string] as ReadonlyArray<string>;
        const rTrailingNow = (rList as ReadonlyArray<string>)[(rList as ReadonlyArray<string>).length - 1] as string;
        const rTrailingRef = world.desktops.find((entry) => entry.id === rTrailingNow);
        assert.ok(rTrailingRef !== undefined, "return trailing exists");
        world.currentByOutput.set(outR, rTrailingRef as FakeDesktop);
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSnapshot()[rKey as string], "ws-d");
        world.currentByOutput.set(outR, wsd);
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSnapshot()[rKey as string], rTrailingNow, "return baseline records anew");
        adapter.disable();
    });

    it("records the pre-handler native view when one handler also displaces", () => {
        const world = fakeWorld(["out-L", "out-R"], ["ws-a", "ws-b", "ws-d"]);
        const wsa = world.desktops[0] as FakeDesktop;
        const wsb = world.desktops[1] as FakeDesktop;
        const wsd = world.desktops[2] as FakeDesktop;
        const outL = world.outputs[0] as FakeOutput;
        const outR = world.outputs[1] as FakeOutput;
        addWindow(world, "win-a", wsa, outL);
        addWindow(world, "win-b", wsb, outL);
        const winD = addWindow(world, "win-d", wsd, outR);
        setCurrent(world, outL, wsa);
        setCurrent(world, outR, wsd);
        (world.workspace as Record<string, unknown>)["activeWindow"] = winD;
        const { adapter } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        // One handler observes both a native L change (A->B) and the
        // disconnect displacement (B->D): previous must be B, not A.
        world.currentByOutput.set(outL, wsb);
        (world.workspace as Record<string, unknown>)["screens"] = [outL];
        adapter.handleTopologySignal();
        winD.output = outL;
        (world.workspace as Record<string, unknown>)["activeScreen"] = outL;
        (world.workspace as Record<string, unknown>)["activeWindow"] = winD;
        assert.equal(currentOf(world, outL), wsd);
        const snap = adapter.previousSnapshot();
        const lKey = Object.keys(snap)[0] as string;
        assert.equal(snap[lKey as string], "ws-b");
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[1];
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, outL), wsb);
        adapter.disable();
    });

    it("records an in-handler reconnect return from the newly observed baseline", () => {
        const world = fakeWorld(["out-L", "out-R"], ["ws-a", "ws-d"]);
        const outL = world.outputs[0] as FakeOutput;
        const outR = world.outputs[1] as FakeOutput;
        const wsa = world.desktops[0] as FakeDesktop;
        const wsd = world.desktops[1] as FakeDesktop;
        addWindow(world, "win-a", wsa, outL);
        const winD = addWindow(world, "win-d", wsd, outR);
        setCurrent(world, outL, wsa);
        setCurrent(world, outR, wsd);
        world.workspace["activeWindow"] = winD;
        const { adapter } = startNative(world, "per-output-local");
        const mapping = adapter.localSnapshot();
        const rKey = Object.keys(mapping).find((key) => !mapping[key]?.includes(wsa.id));
        assert.ok(rKey !== undefined);
        const spare = world.desktops.find((entry) => mapping[rKey]?.includes(entry.id));
        assert.ok(spare !== undefined);
        world.currentByOutput.set(outR, spare);
        adapter.handleTopologySignal();
        world.currentByOutput.set(outR, wsd);
        adapter.handleTopologySignal();
        world.workspace["screens"] = [outL];
        adapter.handleTopologySignal();
        assert.ok(!(rKey in adapter.previousSnapshot()));
        winD.output = outL;
        // R is first observed on its spare; active D's return selects D
        // inside this same topology handler, independently of old history.
        world.currentByOutput.set(outR, spare);
        world.workspace["screens"] = [outL, outR];
        adapter.handleTopologySignal();
        assert.equal(currentOf(world, outR), wsd);
        assert.equal(adapter.previousSnapshot()[rKey], spare.id);
        focusOutput(world, outR);
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, outR), spare);
        adapter.disable();
    });

    it("shared keeps one history across hotplug and ignores focus-only", () => {
        const world = fakeWorld(["out-L", "out-R"], ["ws-a", "ws-b"]);
        const wsa = world.desktops[0] as FakeDesktop;
        const wsb = world.desktops[1] as FakeDesktop;
        const outL = world.outputs[0] as FakeOutput;
        const outR = world.outputs[1] as FakeOutput;
        addWindow(world, "win-a", wsa, outL);
        addWindow(world, "win-b", wsb, outL);
        const { adapter } = startNative(world, "shared");
        const show = (desktop: FakeDesktop): void => {
            world.currentByOutput.set(outL, desktop);
            world.currentByOutput.set(outR, desktop);
            (world.workspace as Record<string, unknown>)["currentDesktop"] = desktop;
        };
        show(wsa);
        adapter.handleTopologySignal();
        // Disconnect with no view change records nothing.
        (world.workspace as Record<string, unknown>)["screens"] = [outL];
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSharedSnapshot(), null);
        // Focus-only records nothing.
        focusOutput(world, outL);
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSharedSnapshot(), null);
        // An actual shared observed change records.
        world.currentByOutput.set(outL, wsb);
        (world.workspace as Record<string, unknown>)["currentDesktop"] = wsb;
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSharedSnapshot(), "ws-a");
        // Reconnect never consults or clears the shared history.
        (world.workspace as Record<string, unknown>)["screens"] = [outL, outR];
        adapter.handleTopologySignal();
        assert.equal(adapter.previousSharedSnapshot(), "ws-a");
        assert.deepEqual(adapter.previousSnapshot(), {});
        assert.equal(adapter.selectPrevious(), true);
        assert.equal(currentOf(world, outL), wsa);
        adapter.disable();
    });
});

describe("workspace previous and relative entry routing", () => {
    it("registers new shortcuts and routes valid callbacks with stop inert", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        (world.workspace as Record<string, unknown>)["activeWindow"] = world.wins[0];
        const shortcuts: Array<{ action: string; sequence: string; callback: () => void }> = [];
        const logs: string[] = [];
        const handle = startPlanAdapterEntry({
            workspace: world.workspace,
            callDbus: (_service, _path, _iface, method, _payload, callback): void => {
                if (method === "NameHasOwner") {
                    (callback as (reply: unknown) => void)(true);
                    return;
                }
                if (method === "GetNameOwner") {
                    (callback as (reply: unknown) => void)(":1.7");
                    return;
                }
                void callback;
            },
            scheduleOnce: (): (() => void) => (): void => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence, callback): boolean => {
                shortcuts.push({ action, sequence, callback });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): unknown => "per-output-local",
        });
        assert.ok(handle !== null);
        const byAction = new Map(shortcuts.map((row) => [row.action, row]));
        assert.equal(byAction.get("omnitiler-workspace-previous")?.sequence, "Meta+Ctrl+Tab");
        assert.equal(byAction.get("omnitiler-workspace-prev-h")?.sequence, "Meta+Ctrl+H");
        assert.equal(byAction.get("omnitiler-workspace-prev-k")?.sequence, "Meta+Ctrl+K");
        assert.equal(byAction.get("omnitiler-workspace-prev-left-arrow")?.sequence, "Meta+Ctrl+Left");
        assert.equal(byAction.get("omnitiler-workspace-prev-up-arrow")?.sequence, "Meta+Ctrl+Up");
        assert.equal(byAction.get("omnitiler-workspace-next-j")?.sequence, "Meta+Ctrl+J");
        assert.equal(byAction.get("omnitiler-workspace-next-l")?.sequence, "Meta+Ctrl+L");
        assert.equal(byAction.get("omnitiler-workspace-next-down-arrow")?.sequence, "Meta+Ctrl+Down");
        assert.equal(byAction.get("omnitiler-workspace-next-right-arrow")?.sequence, "Meta+Ctrl+Right");
        const fireCurrentChanged = (): void => {
            const sig = world.signals["currentDesktopChanged"] as FakeSignal | undefined;
            assert.ok(sig !== undefined);
            for (const handler of [...sig.handlers]) {
                handler();
            }
        };
        const currentId = (): string => {
            const out = world.outputs[0] as FakeOutput;
            return (world.currentByOutput.get(out) as FakeDesktop).id;
        };
        // Build history through routed selects with signal observations.
        byAction.get("omnitiler-workspace-2")?.callback();
        fireCurrentChanged();
        assert.equal(currentId(), "ws-2");
        byAction.get("omnitiler-workspace-1")?.callback();
        fireCurrentChanged();
        assert.equal(currentId(), "ws-1");
        // Valid toggle callback returns to ws-2.
        byAction.get("omnitiler-workspace-previous")?.callback();
        assert.equal(currentId(), "ws-2");
        fireCurrentChanged();
        // Valid relative callbacks step the ring.
        byAction.get("omnitiler-workspace-prev-h")?.callback();
        fireCurrentChanged();
        assert.equal(currentId(), "ws-1");
        byAction.get("omnitiler-workspace-next-l")?.callback();
        assert.equal(currentId(), "ws-2");
        // Invalid relative delta fails closed without throwing.
        handle?.requestWorkspaceRelative(0);
        handle?.requestWorkspaceRelative(2);
        // Stop fence: stale callbacks stay inert.
        handle?.stop();
        const frozen = currentId();
        byAction.get("omnitiler-workspace-previous")?.callback();
        byAction.get("omnitiler-workspace-next-l")?.callback();
        assert.equal(currentId(), frozen);
        void logs;
    });
});
