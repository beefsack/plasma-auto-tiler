import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WorkspaceNativeAdapter } from "../src/workspace-native";

interface FakeDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface FakeOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
}

interface FakeWindow {
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    internalId: string;
    output: FakeOutput;
    desktops: FakeDesktop[];
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
        throw new Error("need desktops");
    }
    const world: FakeWorld = {
        workspace: {},
        outputs,
        desktops,
        wins: [],
        currentByOutput,
        globalCurrent: firstDesktop,
        created: desktopIds.length,
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
        ws["desktops"] = world.desktops;
    };
    ws["windowList"] = (): unknown[] => [...world.wins];
    return world;
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

function addWindow(
    world: FakeWorld,
    id: string,
    desktop: FakeDesktop,
    opts: Partial<Pick<FakeWindow, "fullScreen" | "maximizeMode" | "onAllDesktops">> = {},
    output?: FakeOutput,
): FakeWindow {
    const out = output ?? world.outputs[0];
    if (out === undefined) {
        throw new Error("no output");
    }
    const win: FakeWindow = {
        fullScreen: opts.fullScreen ?? false,
        maximizeMode: opts.maximizeMode ?? 0,
        onAllDesktops: opts.onAllDesktops ?? false,
        internalId: id,
        output: out,
        desktops: opts.onAllDesktops === true ? [] : [desktop],
    };
    world.wins.push(win);
    return win;
}

function setVisible(world: FakeWorld, output: FakeOutput, desktop: FakeDesktop): void {
    world.currentByOutput.set(output, desktop);
    world.globalCurrent = desktop;
    world.workspace["currentDesktop"] = desktop;
}

function ids(world: FakeWorld): string[] {
    return world.desktops.map((entry) => entry.id);
}

function occupy(world: FakeWorld, desktop: FakeDesktop, id: string): void {
    addWindow(world, id, desktop);
}

function emptyDesktop(world: FakeWorld, desktop: FakeDesktop): void {
    world.wins = world.wins.filter((win) => !win.desktops.includes(desktop));
}

describe("bounded owned intermediate cleanup", () => {
    it("removes mapped preexisting 4 after restart once invisible, retaining 5 and trailing 6", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4", "ws-5", "ws-6"]);
        const all = [...world.desktops];
        for (let index = 0; index < 5; index += 1) {
            const desktop = all[index];
            assert.ok(desktop !== undefined);
            occupy(world, desktop, `win-${String(index + 1)}`);
        }
        const fourth = all[3] as FakeDesktop;
        const fifth = all[4] as FakeDesktop;
        const sixth = all[5] as FakeDesktop;
        const first = all[0] as FakeDesktop;
        const { adapter } = startNative(world, "per-output-local");
        assert.ok(!adapter.ownedSnapshot().includes(fourth.id), "preexisting fourth is not lifetime-owned");
        emptyDesktop(world, fourth);
        setVisible(world, world.outputs[0] as FakeOutput, fourth);
        adapter.handleTopologySignal();
        assert.ok(ids(world).includes(fourth.id), `visible mapped empty retained: ${ids(world).join(",")}`);
        adapter.disable();
        assert.deepEqual(ids(world), ["ws-1", "ws-2", "ws-3", "ws-4", "ws-5", "ws-6"], "disable never deletes adopted desktops");
        const restarted = startNative(world, "per-output-local");
        assert.ok(!restarted.adapter.ownedSnapshot().includes(fourth.id), "restart keeps preexisting lifetime-unowned");
        assert.ok(ids(world).includes(fourth.id), "visible fourth survives restart");
        setVisible(world, world.outputs[0] as FakeOutput, first);
        const currentBefore = world.currentByOutput.get(world.outputs[0] as FakeOutput);
        restarted.adapter.handleTopologySignal();
        const after = ids(world);
        assert.ok(!after.includes(fourth.id), `mapped preexisting 4 removed: ${after.join(",")}`);
        assert.ok(after.includes(fifth.id), "occupied 5 retained");
        assert.ok(after.includes(sixth.id), "literal trailing 6 retained");
        assert.ok(restarted.logs.some((line) => line.includes(`workspace-cleanup-removed:${fourth.id}`)));
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), currentBefore, "no visibility switch");
        const snap = restarted.adapter.localSnapshot();
        const flat = Object.values(snap).flat() as string[];
        assert.ok(!flat.includes(fourth.id), "mapping updated");
        assert.ok(world.desktops.some((entry) => entry.id === sixth.id), "order keeps trailing last");
        restarted.adapter.disable();
    });

    it("per-output-local keeps >=2 per output, not just raw count", () => {
        const world = fakeWorld(["out-a", "out-b"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        const outA = world.outputs[0] as FakeOutput;
        const outB = world.outputs[1] as FakeOutput;
        let snap = adapter.localSnapshot();
        const keys = Object.keys(snap);
        assert.ok(keys.length >= 2, JSON.stringify(snap));
        const secondKey = keys.find((key) => (snap[key] as string[]).length <= 1) ?? keys[1];
        assert.ok(secondKey !== undefined);
        const secondList = (adapter.localSnapshot()[secondKey as string] ?? []) as string[];
        const trailingId = secondList[secondList.length - 1] ?? ids(world)[ids(world).length - 1];
        assert.ok(trailingId !== undefined);
        const trailing = world.desktops.find((entry) => entry.id === trailingId);
        assert.ok(trailing !== undefined);
        occupy(world, trailing as FakeDesktop, "win-second");
        adapter.handleTopologySignal();
        snap = adapter.localSnapshot();
        const secondNow = (snap[secondKey as string] ?? []) as string[];
        assert.ok(secondNow.length >= 2, `second output reaches 2: ${JSON.stringify(snap)}`);
        const firstOfSecond = world.desktops.find((entry) => entry.id === secondNow[0]);
        assert.ok(firstOfSecond !== undefined);
        emptyDesktop(world, firstOfSecond as FakeDesktop);
        setVisible(world, outA, world.desktops[0] as FakeDesktop);
        setVisible(world, outB, world.desktops[world.desktops.length - 1] as FakeDesktop);
        adapter.handleTopologySignal();
        const after = adapter.localSnapshot();
        const afterSecond = (after[secondKey as string] ?? []) as string[];
        assert.ok(afterSecond.length >= 2, `floor blocks drop below 2: ${JSON.stringify(after)}`);
        assert.ok(world.desktops.length > 2, "raw count above floor still preserves per-output floor");
        adapter.disable();
    });

    it("global-unique keeps >=2 per domain with multi-output mapping", () => {
        const world = fakeWorld(["out-a", "out-b"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "global-unique");
        adapter.handleTopologySignal();
        let guard = 0;
        while (guard < 6) {
            const snap = adapter.globalSnapshot();
            const smallest = Object.entries(snap).sort((a, b) => (a[1] as string[]).length - (b[1] as string[]).length)[0];
            if (smallest === undefined || (smallest[1] as string[]).length >= 2) {
                break;
            }
            const list = smallest[1] as string[];
            const trailingId = list[list.length - 1] ?? ids(world)[ids(world).length - 1];
            const trailing = world.desktops.find((entry) => entry.id === trailingId);
            if (trailing !== undefined && !world.wins.some((win) => win.desktops.includes(trailing))) {
                occupy(world, trailing, `win-g-${String(guard)}`);
            }
            adapter.handleTopologySignal();
            guard += 1;
        }
        const outA = world.outputs[0] as FakeOutput;
        const outB = world.outputs[1] as FakeOutput;
        const snap = adapter.globalSnapshot();
        const keys = Object.keys(snap);
        assert.ok(keys.length >= 2, JSON.stringify(snap));
        const owned = new Set(adapter.ownedSnapshot());
        const target = keys
            .map((key) => {
                const list = (snap[key] as string[]) ?? [];
                const id = list.find((entry, index) => index < list.length - 1 && owned.has(entry));
                return id === undefined ? null : { key, list, id };
            })
            .find((entry) => entry !== null);
        assert.ok(target !== undefined, `owned non-trailing candidate: ${JSON.stringify(snap)}`);
        const targetKey = target.key;
        const targetList = target.list;
        assert.ok(targetList.length >= 2, `domain reaches 2: ${JSON.stringify(snap)}`);
        const first = world.desktops.find((entry) => entry.id === target.id);
        assert.ok(first !== undefined);
        emptyDesktop(world, first as FakeDesktop);
        const anchor = world.desktops.find((entry) => entry.id !== (first as FakeDesktop).id) as FakeDesktop;
        setVisible(world, outA, anchor);
        setVisible(world, outB, anchor);
        assert.ok(adapter.ownedSnapshot().includes((first as FakeDesktop).id), "floor candidate is project-owned");
        adapter.handleTopologySignal();
        assert.ok(world.desktops.length >= 2);
        const after = adapter.globalSnapshot();
        const afterList = (after[targetKey] as string[]) ?? [];
        assert.ok(afterList.length >= 2 || ids(world).includes((first as FakeDesktop).id), JSON.stringify(after));
        assert.ok(world.desktops.length > 2 || afterList.length >= 2, "per-domain floor, not raw count");
        adapter.disable();
    });

    it("shared keeps >=2 in its single domain", () => {
        const world = fakeWorld(["out-a", "out-b"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        occupy(world, ws1, "win-keep");
        const { adapter } = startNative(world, "shared");
        adapter.handleTopologySignal();
        assert.ok(world.desktops.length >= 2);
        const trailing = world.desktops[world.desktops.length - 1] as FakeDesktop;
        assert.ok(trailing !== undefined);
        const before = ids(world);
        adapter.handleTopologySignal();
        assert.deepEqual(ids(world), before, "idempotent at floor");
        assert.ok(adapter.sharedSnapshot().length >= 2);
        adapter.disable();
    });

    it("any-output visibility blocks; float/fullscreen/max occupy; sticky excluded; unreadable defers", () => {
        const world = fakeWorld(["out-a", "out-b"], ["ws-1", "ws-2"]);
        const { adapter, logs } = startNative(world, "per-output-local");
        occupy(world, world.desktops[0] as FakeDesktop, "win-1");
        occupy(world, world.desktops[1] as FakeDesktop, "win-2");
        adapter.handleTopologySignal();
        const ownedTrailing = world.desktops[world.desktops.length - 1] as FakeDesktop;
        assert.ok(adapter.ownedSnapshot().includes(ownedTrailing.id));
        const outA = world.outputs[0] as FakeOutput;
        const outB = world.outputs[1] as FakeOutput;
        setVisible(world, outA, world.desktops[0] as FakeDesktop);
        setVisible(world, outB, ownedTrailing);
        adapter.handleTopologySignal();
        assert.ok(ids(world).includes(ownedTrailing.id), "visible on any output blocks");
        setVisible(world, outA, world.desktops[0] as FakeDesktop);
        setVisible(world, outB, world.desktops[0] as FakeDesktop);
        emptyDesktop(world, ownedTrailing);
        addWindow(world, "win-float", ownedTrailing, {}, outA);
        adapter.handleTopologySignal();
        assert.ok(ids(world).includes(ownedTrailing.id), "tiled/float membership blocks");
        emptyDesktop(world, ownedTrailing);
        addWindow(world, "win-full", ownedTrailing, { fullScreen: true });
        adapter.handleTopologySignal();
        assert.ok(ids(world).includes(ownedTrailing.id), "fullscreen blocks");
        emptyDesktop(world, ownedTrailing);
        addWindow(world, "win-max", ownedTrailing, { maximizeMode: 3 });
        adapter.handleTopologySignal();
        assert.ok(ids(world).includes(ownedTrailing.id), "maximized blocks");
        const stickyWorld = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const stickyHandle = startNative(stickyWorld, "per-output-local");
        occupy(stickyWorld, stickyWorld.desktops[0] as FakeDesktop, "sw-1");
        occupy(stickyWorld, stickyWorld.desktops[1] as FakeDesktop, "sw-2");
        stickyHandle.adapter.handleTopologySignal();
        const midTrailing = stickyWorld.desktops[stickyWorld.desktops.length - 1] as FakeDesktop;
        occupy(stickyWorld, midTrailing, "sw-3");
        stickyHandle.adapter.handleTopologySignal();
        assert.ok(stickyWorld.desktops.length >= 4);
        const stickyMid = stickyWorld.desktops[stickyWorld.desktops.length - 2] as FakeDesktop;
        assert.ok(stickyHandle.adapter.ownedSnapshot().includes(stickyMid.id), "mid is owned");
        emptyDesktop(stickyWorld, stickyMid);
        addWindow(stickyWorld, "win-sticky-mid", stickyMid, { onAllDesktops: true });
        setVisible(stickyWorld, stickyWorld.outputs[0] as FakeOutput, stickyWorld.desktops[0] as FakeDesktop);
        stickyHandle.adapter.handleTopologySignal();
        assert.ok(!ids(stickyWorld).includes(stickyMid.id), `sticky-only stays empty and prunes: ${ids(stickyWorld).join(",")}`);
        stickyHandle.adapter.disable();
        const world2 = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world2.desktops[0] as FakeDesktop;
        const ws2 = world2.desktops[1] as FakeDesktop;
        addWindow(world2, "win-1", ws1);
        addWindow(world2, "win-2", ws2);
        delete (world2.workspace as Record<string, unknown>)["currentDesktop"];
        const keepLogs: string[] = [];
        const adapter2 = new WorkspaceNativeAdapter({
            getWorkspace: () => world2.workspace,
            readWorkspaceMode: () => "per-output-local",
            log: (message) => {
                keepLogs.push(message);
            },
        });
        assert.equal(adapter2.enable(), true);
        assert.equal(world2.desktops.length, 2, "unreadable visibility defers");
        assert.ok(keepLogs.some((line) => line.includes("workspace-cleanup-deferred")));
        adapter2.disable();
        adapter.disable();
        void logs;
    });

    it("pending retention blocks mapped preexisting cleanup until settle; displaced workspaces remain until exact return", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        addWindow(world, "win-source", ws3);
        const { adapter } = startNative(world, "per-output-local");
        const sourceId = ws3.id;
        assert.ok(!adapter.ownedSnapshot().includes(sourceId), "source is preexisting rather than lifetime-owned");
        for (const win of world.wins) {
            if (win.internalId === "win-source") {
                win.desktops = [ws1];
            }
        }
        setVisible(world, world.outputs[0] as FakeOutput, ws1);
        adapter.setRetentionProvider(() => [sourceId, ws1.id]);
        adapter.handleTopologySignal();
        assert.ok(ids(world).includes(sourceId), "pending source retained");
        adapter.setRetentionProvider(() => []);
        adapter.handleTopologySignal();
        assert.ok(!ids(world).includes(sourceId), "settled source prunes");
        adapter.disable();

        const world3 = fakeWorld(["out-keep", "out-gone"], ["ws-keep", "ws-away", "ws-empty"]);
        const outKeep = world3.outputs[0] as FakeOutput;
        const outGone = world3.outputs[1] as FakeOutput;
        const wsKeep = world3.desktops[0] as FakeDesktop;
        const wsAway = world3.desktops[1] as FakeDesktop;
        setVisible(world3, outKeep, wsKeep);
        setVisible(world3, outGone, wsAway);
        const handle3 = startNative(world3, "per-output-local");
        addWindow(world3, "win-keep", wsKeep, {}, outKeep);
        addWindow(world3, "win-away", wsAway, {}, outGone);
        handle3.adapter.handleTopologySignal();
        (world3.workspace["activeWindow"] as unknown) = world3.wins[0];
        world3.outputs = [outKeep];
        (world3.workspace["screens"] as unknown) = world3.outputs;
        for (const win of world3.wins) {
            if (win.output === outGone) {
                win.output = outKeep;
            }
        }
        handle3.adapter.handleTopologySignal();
        assert.equal(Object.keys(handle3.adapter.displacedSnapshot()).length, 1);
        const displacedIds = Object.values(handle3.adapter.displacedSnapshot())[0] as unknown as { workspaceIds: string[] };
        assert.ok(displacedIds.workspaceIds.includes("ws-away"));
        emptyDesktop(world3, wsAway);
        setVisible(world3, outKeep, wsKeep);
        handle3.adapter.handleTopologySignal();
        assert.ok(ids(world3).includes("ws-away"), "displaced owned remains until return");
        const replacement: FakeOutput = { name: "out-gone", manufacturer: "m", model: "d", serialNumber: "s-replacement" };
        world3.outputs = [outKeep, replacement];
        (world3.workspace["screens"] as unknown) = world3.outputs;
        handle3.adapter.handleTopologySignal();
        assert.equal(Object.keys(handle3.adapter.displacedSnapshot()).length, 1, "tuple replacement is not exact return");
        world3.outputs = [outKeep, outGone];
        (world3.workspace["screens"] as unknown) = world3.outputs;
        handle3.adapter.handleTopologySignal();
        assert.equal(Object.keys(handle3.adapter.displacedSnapshot()).length, 0, "exact origin returns");
        handle3.adapter.disable();
    });

    it("repeat is idempotent after pruning mapped empties and retaining the literal trailing", () => {
        const world = fakeWorld(["out-1"], ["ws-1", "ws-2", "ws-3"]);
        const ws1 = world.desktops[0] as FakeDesktop;
        addWindow(world, "win-keep", ws1);
        const { adapter, logs } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        const afterFirst = ids(world);
        const trailing = afterFirst[afterFirst.length - 1] as string;
        const removalsFirst = logs.filter((line) => line.includes("workspace-cleanup-removed")).length;
        adapter.handleTopologySignal();
        const afterSecond = ids(world);
        assert.deepEqual(afterSecond, afterFirst, "no extra mutation");
        assert.equal(
            logs.filter((line) => line.includes("workspace-cleanup-removed")).length,
            removalsFirst,
            "no extra removals",
        );
        assert.ok(!afterSecond.includes("ws-2"), "mapped non-final empty pruned");
        assert.ok(afterSecond.includes(trailing), "literal trailing preserved");
        assert.ok(afterSecond.length >= 2);
        adapter.disable();
    });
});
