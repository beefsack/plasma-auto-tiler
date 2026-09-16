import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    chooseDisplacedDestination,
    WorkspaceNativeAdapter,
} from "../src/workspace-native";

interface FakeDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface FakeOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    geometry: { x: number; y: number; width: number; height: number };
}

interface FakeWindow {
    normalWindow: boolean;
    internalId: string;
    output: FakeOutput;
    desktops: FakeDesktop[];
    frameGeometry: { x: number; y: number; width: number; height: number };
}

interface FakeWorld {
    workspace: Record<string, unknown>;
    outputs: FakeOutput[];
    desktops: FakeDesktop[];
    wins: FakeWindow[];
    currentByOutput: Map<FakeOutput, FakeDesktop>;
    globalCurrent: FakeDesktop;
    created: number;
}

function makeOutput(name: string, x = 0): FakeOutput {
    return { name, manufacturer: "m", model: "d", serialNumber: "s-" + name, geometry: { x, y: 0, width: 1200, height: 800 } };
}

function makeDesktop(id: string, num?: number): FakeDesktop {
    return num === undefined ? { id } : { id, x11DesktopNumber: num };
}

function fakeWorld(outputNames: string[], desktopIds: string[]): FakeWorld {
    const outputs = outputNames.map((name, i) => makeOutput(name, i * 1300));
    const desktops = desktopIds.map((id, i) => makeDesktop(id, i + 1));
    const currentByOutput = new Map<FakeOutput, FakeDesktop>();
    for (const output of outputs) {
        const first = desktops[0];
        if (first !== undefined) currentByOutput.set(output, first);
    }
    const firstDesktop = desktops[0];
    if (firstDesktop === undefined) throw new Error("need desktops");
    const world: FakeWorld = { workspace: {}, outputs, desktops, wins: [], currentByOutput, globalCurrent: firstDesktop, created: desktopIds.length };
    const ws = world.workspace;
    ws["screens"] = outputs;
    ws["desktops"] = desktops;
    ws["activeWindow"] = null;
    ws["activeScreen"] = outputs[0] ?? null;
    ws["currentDesktopForScreen"] = (output: unknown): unknown => world.currentByOutput.get(output as FakeOutput) ?? null;
    ws["currentDesktop"] = world.globalCurrent;
    ws["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        world.globalCurrent = desktop as FakeDesktop;
        ws["currentDesktop"] = desktop;
    };
    ws["createDesktop"] = (): void => {
        world.created += 1;
        const maxNum = world.desktops.reduce((b, e) => Math.max(b, e.x11DesktopNumber ?? 0), 0);
        const fresh = makeDesktop(`ws-new-${String(world.created)}`, maxNum + 1);
        world.desktops.push(fresh);
        ws["desktops"] = world.desktops;
    };
    ws["removeDesktop"] = (desktop: unknown): void => {
        const ref = desktop as FakeDesktop;
        const at = world.desktops.indexOf(ref);
        if (at >= 0) world.desktops.splice(at, 1);
        ws["desktops"] = world.desktops;
    };
    ws["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    ws["windowList"] = (): unknown[] => [...world.wins];
    return world;
}

function startNative(world: FakeWorld, mode: unknown): { adapter: WorkspaceNativeAdapter; logs: string[] } {
    const logs: string[] = [];
    const adapter = new WorkspaceNativeAdapter({
        getWorkspace: () => world.workspace,
        readWorkspaceMode: () => mode,
        log: (m) => { logs.push(m); },
    });
    assert.equal(adapter.enable(), true);
    return { adapter, logs };
}

function addWindow(world: FakeWorld, id: string, desktop: FakeDesktop, output?: FakeOutput): FakeWindow {
    const out = output ?? world.outputs[0];
    if (out === undefined) throw new Error("no output");
    const win: FakeWindow = {
        normalWindow: true, internalId: id, output: out, desktops: [desktop],
        frameGeometry: { x: out.geometry.x + 10, y: 10, width: 100, height: 100 },
    };
    world.wins.push(win);
    (world.workspace["activeWindow"] as unknown) = win;
    return win;
}

function setVisible(world: FakeWorld, output: FakeOutput, desktop: FakeDesktop): void {
    world.currentByOutput.set(output, desktop);
    world.globalCurrent = desktop;
    world.workspace["currentDesktop"] = desktop;
}

describe("chooseDisplacedDestination fallback chain", () => {
    it("returns null with no survivors and the single survivor directly", () => {
        assert.equal(chooseDisplacedDestination([], null, null), null);
        assert.equal(chooseDisplacedDestination([{ key: "a", rect: null }], null, null), "a");
    });
    it("chooses nearest when removed geometry is supplied", () => {
        const dest = chooseDisplacedDestination(
            [
                { key: "left", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { key: "right", rect: { x: 2000, y: 0, w: 1200, h: 800 } },
            ],
            "left",
            { x: 2100, y: 100, w: 100, h: 100 },
        );
        assert.equal(dest, "right");
    });
    it("falls back to live primary when reference is unavailable", () => {
        const dest = chooseDisplacedDestination(
            [
                { key: "a", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { key: "b", rect: { x: 1300, y: 0, w: 1200, h: 800 } },
            ],
            "b",
            null,
        );
        assert.equal(dest, "b");
    });
    it("falls back to deterministic existing ordering when primary is absent", () => {
        const dest = chooseDisplacedDestination(
            [
                { key: "a", rect: null },
                { key: "b", rect: null },
            ],
            "missing",
            null,
        );
        assert.equal(dest, "a");
    });
});

describe("output disconnect displacement identity and visibility", () => {
    it("keeps displaced workspaces separate on survivor and shows active displaced workspace", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsAway = world.desktops[1] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsAway);
        const { adapter, logs } = startNative(world, "per-output-local");
        // Occupy both so mapping assigns ws-keep to out-keep and ws-away to out-gone.
        addWindow(world, "win-keep", wsKeep, outKeep);
        addWindow(world, "win-away", wsAway, outGone);
        adapter.handleTopologySignal();
        const before = adapter.localSnapshot();
        assert.ok((before["output-0"] ?? []).includes("ws-keep") || Object.values(before).some((l) => (l as string[]).includes("ws-keep")));
        // Active window is on the removed output.
        (world.workspace["activeWindow"] as unknown) = world.wins[1];
        (world.workspace["activeScreen"] as unknown) = outGone;
        // Disconnect out-gone: windows move to survivor in KWin, desktops stay.
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        (world.workspace["activeScreen"] as unknown) = outKeep;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        const displaced = adapter.displacedSnapshot();
        const origins = Object.keys(displaced);
        assert.equal(origins.length, 1, JSON.stringify(displaced));
        const entry = displaced[origins[0] as string] as { workspaceIds: string[]; destKey: string };
        assert.ok(entry.workspaceIds.includes("ws-away"), JSON.stringify(entry));
        // Survivor still has its own workspace separate, never merged.
        const snap = adapter.localSnapshot();
        const allIds = Object.values(snap).flat() as string[];
        assert.ok(allIds.includes("ws-keep") && allIds.includes("ws-away"));
        // Active displaced workspace is shown on survivor with focus retained.
        assert.equal(world.currentByOutput.get(outKeep), wsAway);
        assert.equal((world.workspace["activeWindow"] as unknown), world.wins[1]);
        assert.ok(logs.some((l) => l.includes("workspace-displaced")));
        adapter.disable();
    });

    it("preserves survivor view when active remains on survivor, and with no active window", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsAway = world.desktops[1] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsAway);
        const { adapter } = startNative(world, "per-output-local");
        const keepWin = addWindow(world, "win-keep", wsKeep, outKeep);
        addWindow(world, "win-away", wsAway, outGone);
        adapter.handleTopologySignal();
        (world.workspace["activeWindow"] as unknown) = keepWin;
        (world.workspace["activeScreen"] as unknown) = outKeep;
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        assert.equal(world.currentByOutput.get(outKeep), wsKeep);
        assert.equal((world.workspace["activeWindow"] as unknown), keepWin);
        // No active window preserves survivor view.
        (world.workspace["activeWindow"] as unknown) = null;
        adapter.handleTopologySignal();
        assert.equal(world.currentByOutput.get(outKeep), wsKeep);
        adapter.disable();
    });

    it("returns displaced workspaces with current contents on original reconnect", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsAway = world.desktops[1] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsAway);
        const { adapter } = startNative(world, "per-output-local");
        addWindow(world, "win-keep", wsKeep, outKeep);
        const awayWin = addWindow(world, "win-away", wsAway, outGone);
        void awayWin;
        adapter.handleTopologySignal();
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        (world.workspace["activeScreen"] as unknown) = outKeep;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        assert.equal(Object.keys(adapter.displacedSnapshot()).length, 1);
        // Membership edit while displaced: new window into displaced workspace.
        const movedIn = { normalWindow: true, internalId: "win-new", output: outKeep, desktops: [wsAway], frameGeometry: { x: 10, y: 10, width: 100, height: 100 } } as FakeWindow;
        world.wins.push(movedIn);
        // Moved-out: take win-away out of displaced workspace into survivor workspace.
        (world.wins[1] as FakeWindow).desktops = [wsKeep];
        adapter.handleTopologySignal();
        // Reconnect original output (same tuple identity -> same stable key).
        world.outputs = [outKeep, outGone];
        (world.workspace["screens"] as unknown) = world.outputs;
        adapter.handleTopologySignal();
        assert.equal(Object.keys(adapter.displacedSnapshot()).length, 0, JSON.stringify(adapter.displacedSnapshot()));
        const snap = adapter.localSnapshot();
        const allIds = Object.values(snap).flat() as string[];
        assert.ok(allIds.includes("ws-away"), JSON.stringify(snap));
        // Moved-in window stays with displaced workspace; moved-out stays out.
        assert.ok((movedIn.desktops as FakeDesktop[]).includes(wsAway));
        assert.ok(!(world.wins[1] as FakeWindow).desktops.includes(wsAway));
        adapter.disable();
    });

    it("shows returning workspace when active is in it, else preserves survivor focus", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsAway = world.desktops[1] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsAway);
        const { adapter } = startNative(world, "per-output-local");
        addWindow(world, "win-keep", wsKeep, outKeep);
        const awayWin = addWindow(world, "win-away", wsAway, outGone);
        adapter.handleTopologySignal();
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        // Active is on survivor, so reconnect preserves survivor view.
        world.outputs = [outKeep, outGone];
        (world.workspace["screens"] as unknown) = world.outputs;
        (awayWin as FakeWindow).output = outGone;
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        setVisible(world, outKeep, wsKeep);
        adapter.handleTopologySignal();
        assert.equal(world.currentByOutput.get(outKeep), wsKeep);
        // Active in returning workspace becomes visible/focused on reconnect.
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        (awayWin as FakeWindow).output = outKeep;
        adapter.handleTopologySignal();
        world.outputs = [outKeep, outGone];
        (world.workspace["screens"] as unknown) = world.outputs;
        (awayWin as FakeWindow).output = outGone;
        (world.workspace["activeWindow"] as unknown) = awayWin;
        adapter.handleTopologySignal();
        assert.equal(world.currentByOutput.get(outGone), wsAway);
        assert.equal((world.workspace["activeWindow"] as unknown), awayWin);
        adapter.disable();
    });

    it("fails closed on unreadable topology without mutation or throw", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away"]);
        const { adapter } = startNative(world, "per-output-local");
        const before = JSON.stringify(adapter.localSnapshot());
        delete (world.workspace as Record<string, unknown>)["screens"];
        adapter.handleTopologySignal();
        assert.equal(JSON.stringify(adapter.localSnapshot()), before);
        (world.workspace as Record<string, unknown>)["screens"] = world.outputs;
        delete (world.workspace as Record<string, unknown>)["desktops"];
        adapter.handleTopologySignal();
        adapter.disable();
    });

    it("falls back to live primary in production and stays idempotent on stale signals", () => {
        const world = fakeWorld(["out-a", "out-b", "out-c"], ["ws-a", "ws-b", "ws-c", "ws-empty"]);
        const outA = world.outputs[0] as FakeOutput;
        const outB = world.outputs[1] as FakeOutput;
        const outC = world.outputs[2] as FakeOutput;
        const wsA = world.desktops[0] as FakeDesktop;
        const wsB = world.desktops[1] as FakeDesktop;
        const wsC = world.desktops[2] as FakeDesktop;
        setVisible(world, outA, wsA);
        setVisible(world, outB, wsB);
        setVisible(world, outC, wsC);
        const { adapter } = startNative(world, "per-output-local");
        addWindow(world, "win-a", wsA, outA);
        const winB = addWindow(world, "win-b", wsB, outB);
        addWindow(world, "win-c", wsC, outC);
        adapter.handleTopologySignal();
        // Moved-window frame geometry near the right survivor must not act
        // as a proxy for removed-output geometry: production falls back to
        // the live primary (out-a), not the nearest to x=2650.
        (world.workspace["activeWindow"] as unknown) = winB;
        (winB as FakeWindow).frameGeometry = { x: 2650, y: 10, width: 100, height: 100 };
        (world.workspace["activeScreen"] as unknown) = outA;
        world.outputs = [outA, outC];
        (world.workspace["screens"] as unknown) = world.outputs;
        (world.workspace["activeScreen"] as unknown) = outA;
        (winB as FakeWindow).output = outC;
        adapter.handleTopologySignal();
        const displaced = adapter.displacedSnapshot();
        assert.equal(Object.keys(displaced).length, 1);
        const origin = Object.keys(displaced)[0] as string;
        const dest = (displaced[origin] as { destKey: string }).destKey;
        // Live primary is out-a (stable output-0); moved-window geometry is
        // ignored because removed-output geometry is unavailable.
        assert.equal(dest, "output-0", JSON.stringify(displaced));
        // Stale repeat signal does not duplicate or reset the mapping.
        // Trailing-empty lifecycle may append/retire owned empties across
        // signals, so idempotence is checked on displacement origin/dest plus
        // exactly-once membership, not byte-equal trailing state.
        adapter.handleTopologySignal();
        const after = adapter.displacedSnapshot();
        assert.equal(Object.keys(after).length, 1, JSON.stringify(after));
        assert.equal(Object.keys(after)[0], origin, JSON.stringify(after));
        const afterEntry = after[origin] as { workspaceIds: string[]; destKey: string };
        assert.equal(afterEntry.destKey, dest, JSON.stringify(after));
        assert.ok(afterEntry.workspaceIds.includes("ws-b"), JSON.stringify(after));
        const afterSnap = adapter.localSnapshot();
        const destList = (afterSnap[dest] ?? []) as string[];
        assert.equal(destList.filter((id) => id === "ws-b").length, 1, JSON.stringify(afterSnap));
        adapter.disable();
    });

    it("displaces every occupied workspace of a removed output as a unit", () => {
        // Background/non-visible occupied workspaces move with the visible
        // one, never assigned to the primary as unassigned leftovers.
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-fore", "ws-back", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsFore = world.desktops[1] as FakeDesktop;
        const wsBack = world.desktops[2] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsFore);
        const { adapter } = startNative(world, "per-output-local");
        addWindow(world, "win-keep", wsKeep, outKeep);
        addWindow(world, "win-fore", wsFore, outGone);
        addWindow(world, "win-back", wsBack, outGone);
        adapter.handleTopologySignal();
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        (world.workspace["activeScreen"] as unknown) = outKeep;
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        const displaced = adapter.displacedSnapshot();
        assert.equal(Object.keys(displaced).length, 1, JSON.stringify(displaced));
        const origin = Object.keys(displaced)[0] as string;
        const entry = displaced[origin] as { workspaceIds: string[]; destKey: string };
        assert.ok(entry.workspaceIds.includes("ws-fore"), JSON.stringify(entry));
        assert.ok(entry.workspaceIds.includes("ws-back"), JSON.stringify(entry));
        const snap = adapter.localSnapshot();
        const allIds = Object.values(snap).flat() as string[];
        assert.equal(allIds.filter((id) => id === "ws-fore").length, 1, JSON.stringify(snap));
        assert.equal(allIds.filter((id) => id === "ws-back").length, 1, JSON.stringify(snap));
        assert.ok(allIds.includes("ws-keep"), JSON.stringify(snap));
        adapter.disable();
    });

    it("does not falsely return on tuple replacement with a new identity", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsAway = world.desktops[1] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsAway);
        const { adapter } = startNative(world, "per-output-local");
        addWindow(world, "win-keep", wsKeep, outKeep);
        addWindow(world, "win-away", wsAway, outGone);
        adapter.handleTopologySignal();
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        assert.equal(Object.keys(adapter.displacedSnapshot()).length, 1);
        const replacement = makeOutput("out-gone", 1300);
        replacement.serialNumber = "s-replacement";
        world.outputs = [outKeep, replacement];
        (world.workspace["screens"] as unknown) = world.outputs;
        adapter.handleTopologySignal();
        const still = adapter.displacedSnapshot();
        assert.equal(Object.keys(still).length, 1, JSON.stringify(still));
        const snap = adapter.localSnapshot();
        const allIds = Object.values(snap).flat() as string[];
        assert.equal(allIds.filter((id) => id === "ws-away").length, 1, JSON.stringify(snap));
        adapter.disable();
    });

    it("global-unique displaces and returns without duplicates", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world.outputs[0] as FakeOutput;
        const outGone = world.outputs[1] as FakeOutput;
        const wsKeep = world.desktops[0] as FakeDesktop;
        const wsAway = world.desktops[1] as FakeDesktop;
        setVisible(world, outKeep, wsKeep);
        setVisible(world, outGone, wsAway);
        const { adapter } = startNative(world, "global-unique");
        addWindow(world, "win-keep", wsKeep, outKeep);
        addWindow(world, "win-away", wsAway, outGone);
        adapter.handleTopologySignal();
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        world.outputs = [outKeep];
        (world.workspace["screens"] as unknown) = world.outputs;
        for (const w of world.wins) {
            if ((w as FakeWindow).output === outGone) (w as FakeWindow).output = outKeep;
        }
        adapter.handleTopologySignal();
        assert.equal(Object.keys(adapter.displacedSnapshot()).length, 1, JSON.stringify(adapter.displacedSnapshot()));
        const snap = adapter.globalSnapshot();
        const allIds = Object.values(snap).flat() as string[];
        assert.equal(allIds.filter((id) => id === "ws-away").length, 1, JSON.stringify(snap));
        world.outputs = [outKeep, outGone];
        (world.workspace["screens"] as unknown) = world.outputs;
        (world.wins[1] as FakeWindow).output = outGone;
        adapter.handleTopologySignal();
        assert.equal(Object.keys(adapter.displacedSnapshot()).length, 0, JSON.stringify(adapter.displacedSnapshot()));
        const after = adapter.globalSnapshot();
        const afterIds = Object.values(after).flat() as string[];
        assert.equal(afterIds.filter((id) => id === "ws-away").length, 1, JSON.stringify(after));
        adapter.disable();
    });

    it("shared mode never displaces", () => {
        const world = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away"]);
        const { adapter } = startNative(world, "shared");
        addWindow(world, "win-keep", world.desktops[0] as FakeDesktop, world.outputs[0]);
        adapter.handleTopologySignal();
        world.outputs = [world.outputs[0] as FakeOutput];
        (world.workspace["screens"] as unknown) = world.outputs;
        adapter.handleTopologySignal();
        assert.equal(Object.keys(adapter.displacedSnapshot()).length, 0);
        adapter.disable();
    });
});
