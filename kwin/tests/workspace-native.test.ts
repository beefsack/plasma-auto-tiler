import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { observeSendTarget, startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { WORKSPACE_SEND_HAS_OWNER_METHOD } from "../src/workspace-send-adapter";
import {
    ensureTrailingEmptyDesktop,
    orderedDesktopEntries,
    parseWorkspaceMode,
    symbolForDigit,
    workspaceShortcutCatalog,
    WorkspaceNativeAdapter,
} from "../src/workspace-native";

function kwinSrcDir(): string {
    return resolve(process.cwd(), "src");
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
    setMaximize?: (vertically: unknown, horizontally: unknown) => void;
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

function fakeWorld(mode: unknown, outputNames: string[], desktopIds: string[]): { world: FakeWorld; logs: string[] } {
    void mode;
    const logs: string[] = [];
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
    };
    const ws = world.workspace;
    ws["screens"] = outputs;
    ws["desktops"] = desktops;
    ws["activeWindow"] = null;
    ws["activeScreen"] = outputs[0] ?? null;
    ws["currentDesktopForScreen"] = (output: unknown): unknown => {
        const found = world.currentByOutput.get(output as FakeOutput);
        return found ?? null;
    };
    ws["currentDesktop"] = world.globalCurrent;
    ws["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        world.globalCurrent = desktop as FakeDesktop;
        ws["currentDesktop"] = desktop;
    };
    ws["createDesktop"] = (_position: unknown, _name: unknown): void => {
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
    ws["windowActivated"] = fakeSignal().signal;
    ws["desktopsChanged"] = fakeSignal().signal;
    ws["currentDesktopChanged"] = fakeSignal().signal;
    ws["screensChanged"] = fakeSignal().signal;
    ws["windowAdded"] = fakeSignal().signal;
    ws["windowRemoved"] = fakeSignal().signal;
    void logs;
    return { world, logs };
}

const moverEchoes = new WeakMap<object, FakeSignal>();
const geometryEchoes = new WeakMap<object, FakeSignal>();

function fireMoverEcho(win: object): void {
    const seam = moverEchoes.get(win);
    if (seam === undefined) {
        return;
    }
    for (const handler of [...seam.handlers]) {
        handler();
    }
}

function fireAllGeometry(world: FakeWorld): void {
    for (const win of world.wins) {
        const seam = geometryEchoes.get(win as object);
        if (seam === undefined) {
            continue;
        }
        for (const handler of [...seam.handlers]) {
            handler();
        }
    }
}

function addWindow(
    world: FakeWorld,
    id: string,
    desktop: FakeDesktop,
    opts: Partial<Pick<FakeWindow, "fullScreen" | "maximizeMode" | "onAllDesktops" | "minimized" | "managed">> = {},
): FakeWindow {
    const output = world.outputs[0];
    if (output === undefined) {
        throw new Error("no output");
    }
    const echo = fakeSignal();
    const geo = fakeSignal();
    const win: FakeWindow = {
        normalWindow: true,
        managed: opts.managed ?? true,
        minimized: opts.minimized ?? false,
        fullScreen: opts.fullScreen ?? false,
        maximizeMode: opts.maximizeMode ?? 0,
        onAllDesktops: opts.onAllDesktops ?? false,
        internalId: id,
        resourceClass: "test-app",
        output,
        desktops: opts.onAllDesktops === true ? [] : [desktop],
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
        frameGeometryChanged: geo.signal,
        fullScreenChanged: fakeSignal().signal,
        maximizedChanged: fakeSignal().signal,
        desktopsChanged: echo.signal,
    };
    moverEchoes.set(win, echo);
    geometryEchoes.set(win, geo);
    world.wins.push(win);
    (world.workspace["activeWindow"] as unknown) = win;
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

describe("workspace mode parsing and chord catalog", () => {
    it("selects workspaceMode from readConfig with invalid defaulting to per-output-local", () => {
        assert.equal(parseWorkspaceMode("per-output-local"), "per-output-local");
        assert.equal(parseWorkspaceMode("global-unique"), "global-unique");
        assert.equal(parseWorkspaceMode("shared"), "shared");
        assert.equal(parseWorkspaceMode("bogus"), "per-output-local");
        assert.equal(parseWorkspaceMode(undefined), "per-output-local");
        assert.equal(parseWorkspaceMode(""), "per-output-local");
        const { world } = fakeWorld("bogus", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "bogus");
        assert.equal(adapter.getMode(), "per-output-local");
        adapter.disable();
    });

    it("publishes exact number chords with shifted-symbol aliases and no foreign records", () => {
        const catalog = workspaceShortcutCatalog();
        assert.equal(catalog.length, 30);
        const byAction = new Map(catalog.map((row) => [row.action, row]));
        for (let index = 1; index <= 9; index += 1) {
            assert.equal(byAction.get(`plasma-auto-tiler-workspace-${String(index)}`)?.sequence, `Meta+${String(index)}`);
            assert.equal(byAction.get(`plasma-auto-tiler-workspace-${String(index)}`)?.kind, "select");
            assert.equal(byAction.get(`plasma-auto-tiler-move-workspace-${String(index)}`)?.sequence, `Meta+Shift+${String(index)}`);
            assert.equal(byAction.get(`plasma-auto-tiler-move-workspace-${String(index)}`)?.kind, "move");
        }
        assert.equal(byAction.get("plasma-auto-tiler-workspace-0")?.sequence, "Meta+0");
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-append")?.sequence, "Meta+Shift+0");
        const expectedSymbols: ReadonlyArray<[number, string]> = [
            [1, "!"], [2, "@"], [3, "#"], [4, "$"], [5, "%"],
            [6, "^"], [7, "&"], [8, "*"], [9, "("], [0, ")"],
        ];
        for (const [digit, symbol] of expectedSymbols) {
            assert.equal(symbolForDigit(digit), symbol);
        }
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-1-symbol")?.sequence, "Meta+!");
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-2-symbol")?.sequence, "Meta+@");
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-9-symbol")?.sequence, "Meta+(");
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-append-symbol")?.sequence, "Meta+)");
        for (const row of catalog) {
            assert.ok(!row.action.includes("focus") && !row.action.includes("resize"), row.action);
        }
    });
});

describe("workspace lifecycle mapping and trailing empty", () => {
    it("orders backing desktops by x11 number with positional default", () => {
        const a = { ref: {}, id: "b", num: 2 };
        const b = { ref: {}, id: "a", num: 1 };
        const ordered = orderedDesktopEntries([a, b]);
        assert.deepEqual(ordered.map((entry) => entry.id), ["a", "b"]);
        const positional = orderedDesktopEntries([
            { ref: {}, id: "x", num: null },
            { ref: {}, id: "y", num: 1 },
        ]);
        assert.deepEqual(positional.map((entry) => entry.id), ["x", "y"]);
    });

    it("keeps the literal last ordered desktop as trailing empty and retires only safe owned empties", () => {
        const removed: string[] = [];
        const result = ensureTrailingEmptyDesktop({
            orderedIds: ["a", "b", "c"],
            isEmpty: (id) => id !== "a",
            isVisible: (id) => id === "a",
            removeDesktop: (id) => {
                removed.push(id);
                return true;
            },
            createDesktop: () => null,
        });
        assert.deepEqual(removed, ["b"]);
        assert.deepEqual(result.removedIds, ["b"]);
        assert.equal(result.appendedId, null);
    });

    it("appends one trailing empty when the last ordered desktop is occupied", () => {
        const result = ensureTrailingEmptyDesktop({
            orderedIds: ["a", "b"],
            isEmpty: () => false,
            isVisible: () => false,
            removeDesktop: () => false,
            createDesktop: () => "c",
        });
        assert.equal(result.appendedId, "c");
    });

    it("reuses the trailing empty for zero and appends only when occupied", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        const createdBefore = world.desktops.length;
        const reused = adapter.resolveOrAppendMoveTarget();
        assert.equal(reused, "ws-2");
        assert.equal(world.desktops.length, createdBefore);
        const trailing = world.desktops.find((entry) => entry.id === "ws-2");
        assert.ok(trailing !== undefined);
        addWindow(world, "win-1", trailing);
        const appended = adapter.resolveOrAppendMoveTarget();
        assert.ok(appended !== null && appended !== "ws-1" && appended !== "ws-2");
        assert.ok(adapter.ownedSnapshot().includes(appended));
        adapter.disable();
    });

    it("retires only empty owned desktops, never current, visible, populated, or unowned", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2", "ws-3"]);
        const { adapter } = startNative(world, "per-output-local");
        // Occupy ws-1 and the trailing ws-3 so zero appends one owned empty.
        const ws1 = world.desktops[0];
        const ws3 = world.desktops[2];
        assert.ok(ws1 !== undefined && ws3 !== undefined);
        addWindow(world, "win-keep", ws1);
        addWindow(world, "win-tail", ws3);
        const appended = adapter.resolveOrAppendMoveTarget();
        assert.ok(appended !== null);
        adapter.handleTopologySignal();
        const owned = adapter.ownedSnapshot();
        assert.ok(owned.length >= 1);
        // ws-1 stays populated, the unowned empty ws-2 is preserved, trailing stays.
        const before = world.desktops.map((entry) => entry.id);
        adapter.handleTopologySignal();
        const after = world.desktops.map((entry) => entry.id);
        assert.ok(after.includes("ws-1"), `populated must survive: ${after.join(",")}`);
        assert.ok(after.includes("ws-2"), `unowned empty must survive: ${after.join(",")}`);
        assert.ok(after.includes(before[before.length - 1] as string), "trailing survives");
        assert.ok(after.length >= 2, "minimum two global desktops");
        adapter.disable();
    });

    it("treats floating, fullscreen, and maximized membership as occupied", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2", "ws-3"]);
        const { adapter } = startNative(world, "per-output-local");
        const ws2 = world.desktops[1];
        assert.ok(ws2 !== undefined);
        addWindow(world, "win-full", ws2, { fullScreen: true });
        addWindow(world, "win-max", ws2, { maximizeMode: 3 });
        adapter.handleTopologySignal();
        assert.ok(world.desktops.some((entry) => entry.id === "ws-2"), "exception-occupied survives");
        // Sticky windows are global rather than backing-desktop occupants.
        const sticky = addWindow(world, "win-sticky", ws2, { onAllDesktops: true });
        adapter.handleTopologySignal();
        assert.equal(sticky.desktops.length, 0);
        adapter.disable();
    });

    it("does not let sticky windows grow desktops across repeated topology signals", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        const ws1 = world.desktops[0];
        assert.ok(ws1 !== undefined);
        const sticky = addWindow(world, "win-sticky", ws1, { onAllDesktops: true });
        const before = world.desktops.length;
        for (let i = 0; i < 3; i += 1) {
            adapter.handleTopologySignal();
        }
        assert.ok(world.desktops.length <= before + 1, `no growth from sticky: ${world.desktops.length} vs ${before}`);
        assert.equal(sticky.desktops.length, 0);
        adapter.disable();
    });

    it("enforces trailing-empty lifecycle at adapter startup", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        const logs: string[] = [];
        const adapter = new WorkspaceNativeAdapter({
            getWorkspace: () => world.workspace,
            readWorkspaceMode: () => "per-output-local",
            log: (message) => {
                logs.push(message);
            },
        });
        assert.equal(adapter.enable(), true);
        assert.ok(world.desktops.length >= 3, "startup appends trailing empty when last is occupied");
        assert.ok(adapter.ownedSnapshot().length >= 1, "startup-owned trailing is tracked");
        adapter.disable();
    });

    it("defers lifecycle mutation when global visibility is unavailable", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        // The missing global current desktop makes the visibility snapshot
        // incomplete, so cleanup must not mutate backing desktops.
        delete (world.workspace as Record<string, unknown>)["currentDesktop"];
        const logs: string[] = [];
        const adapter = new WorkspaceNativeAdapter({
            getWorkspace: () => world.workspace,
            readWorkspaceMode: () => "per-output-local",
            log: (message) => {
                logs.push(message);
            },
        });
        assert.equal(adapter.enable(), true);
        assert.equal(world.desktops.length, 2, "incomplete visibility defers lifecycle mutation");
        assert.ok(logs.some((line) => line.includes("workspace-cleanup-deferred:output-visibility-unknown")));
        adapter.disable();
    });

    it("preserves every observed current desktop as visible", () => {
        const { world } = fakeWorld("per-output-local", ["out-1", "out-2"], ["ws-1", "ws-2", "ws-3"]);
        const out1 = world.outputs[0];
        const out2 = world.outputs[1];
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(out1 !== undefined && out2 !== undefined && ws1 !== undefined && ws2 !== undefined);
        world.currentByOutput.set(out1, ws1);
        world.currentByOutput.set(out2, ws2);
        const { adapter } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        assert.ok(world.desktops.some((entry) => entry.id === "ws-1"), "visible ws-1 survives");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-2"), "visible ws-2 survives");
        adapter.disable();
    });

    it("resets mapping state on enable and disable", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const first = startNative(world, "per-output-local");
        first.adapter.handleTopologySignal();
        assert.ok(Object.keys(first.adapter.localSnapshot()).length >= 1);
        first.adapter.disable();
        assert.deepEqual(first.adapter.localSnapshot(), {});
        assert.deepEqual(first.adapter.globalSnapshot(), {});
        assert.deepEqual(first.adapter.sharedSnapshot(), []);
        const second = startNative(world, "per-output-local");
        assert.deepEqual(Object.keys(second.adapter.localSnapshot()).length >= 1, true);
        second.adapter.disable();
    });

    it("prunes owned desktops that left the live set on enable", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        addWindow(world, "win-1", ws1);
        addWindow(world, "win-2", ws2);
        const { adapter } = startNative(world, "per-output-local");
        const ownedBefore = adapter.ownedSnapshot();
        assert.ok(ownedBefore.length >= 1);
        const stale = ownedBefore[0] as string;
        const at = world.desktops.findIndex((entry) => entry.id === stale);
        assert.ok(at >= 0);
        world.desktops.splice(at, 1);
        (world.workspace as Record<string, unknown>)["desktops"] = world.desktops;
        adapter.disable();
        const next = startNative(world, "per-output-local");
        assert.ok(!next.adapter.ownedSnapshot().includes(stale), "stale owned pruned");
        next.adapter.disable();
    });

    it("falls back to output tuple when output object identity changes", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        assert.equal(adapter.selectLogical(1), true);
        const replacement = makeOutput("out-1");
        (world.workspace as Record<string, unknown>)["screens"] = [replacement];
        (world.workspace as Record<string, unknown>)["activeScreen"] = replacement;
        assert.equal(adapter.selectLogical(1), true, "tuple fallback resolves replaced output");
        adapter.disable();
    });

    it("retains source order for global mapping when numbering is incomplete", () => {
        const { world } = fakeWorld("global-unique", ["out-1"], ["ws-a", "ws-b", "ws-c"]);
        world.desktops[0] = makeDesktop("ws-a", 2);
        world.desktops[1] = { id: "ws-b" };
        world.desktops[2] = makeDesktop("ws-c", 1);
        (world.workspace as Record<string, unknown>)["desktops"] = world.desktops;
        const current = world.currentByOutput.get(world.outputs[0] as never);
        void current;
        const { adapter } = startNative(world, "global-unique");
        adapter.handleTopologySignal();
        assert.equal(adapter.selectLogical(1), true);
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), world.desktops[0]);
        adapter.disable();
    });

    it("never drops below two global desktops", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        assert.ok(world.desktops.length >= 2);
        adapter.disable();
    });

    it("keeps per-output-local, global-unique, and shared mappings independent", () => {
        const local = fakeWorld("per-output-local", ["out-1", "out-2"], ["ws-1", "ws-2"]);
        const localHandle = startNative(local.world, "per-output-local");
        localHandle.adapter.handleTopologySignal();
        assert.ok(Object.keys(localHandle.adapter.localSnapshot()).length >= 1);
        localHandle.adapter.disable();

        const global = fakeWorld("global-unique", ["out-1", "out-2"], ["ws-1", "ws-2"]);
        const globalHandle = startNative(global.world, "global-unique");
        globalHandle.adapter.handleTopologySignal();
        assert.ok(Object.keys(globalHandle.adapter.globalSnapshot()).length >= 1);
        globalHandle.adapter.disable();

        const shared = fakeWorld("shared", ["out-1", "out-2"], ["ws-1", "ws-2"]);
        const sharedHandle = startNative(shared.world, "shared");
        sharedHandle.adapter.handleTopologySignal();
        assert.equal(sharedHandle.adapter.sharedSnapshot().length, shared.world.desktops.length);
        sharedHandle.adapter.disable();
    });
});

describe("workspace number selection", () => {
    it("selects only existing logical positions and never creates on absent", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        const before = world.desktops.length;
        assert.equal(adapter.selectLogical(2), true);
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), world.desktops[1]);
        assert.equal(adapter.selectLogical(5), false);
        assert.equal(world.desktops.length, before);
        adapter.disable();
    });

    it("selects trailing empty idempotently and creates only when occupied", () => {
        const { world } = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const { adapter, logs } = startNative(world, "per-output-local");
        assert.equal(adapter.selectTrailingOrCreate(), true);
        const trailing = world.desktops[world.desktops.length - 1];
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), trailing);
        const count = world.desktops.length;
        assert.equal(adapter.selectTrailingOrCreate(), true);
        assert.equal(world.desktops.length, count);
        assert.ok(logs.some((line) => line.includes("workspace-zero-no-op:already-there")));
        adapter.disable();
    });

    it("uses the focused window output, else the active screen", () => {
        const { world } = fakeWorld("per-output-local", ["out-1", "out-2"], ["ws-1", "ws-2"]);
        const { adapter } = startNative(world, "per-output-local");
        adapter.handleTopologySignal();
        const ws1 = world.desktops[0];
        assert.ok(ws1 !== undefined);
        const win = addWindow(world, "win-1", ws1);
        win.output = world.outputs[1] as never;
        (world.workspace["activeWindow"] as unknown) = win;
        assert.equal(adapter.selectLogical(1), true);
        (world.workspace["activeWindow"] as unknown) = null;
        (world.workspace["activeScreen"] as unknown) = world.outputs[1];
        assert.equal(adapter.selectLogical(1), true);
        adapter.disable();
    });
});

describe("workspace production entry routing and handoff", () => {
    interface EntryMocks {
        readonly dbusCalls: Array<{ service: string; method: string; payload: string }>;
        readonly callbacks: Array<(reply: unknown) => void>;
        readonly logs: string[];
        readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
    }

    function startRichEntry(mode: unknown): { handle: ReturnType<typeof startPlanAdapterEntry>; world: FakeWorld; mocks: EntryMocks } {
        const built = fakeWorld(mode, ["out-1"], ["ws-1", "ws-2"]);
        const world = built.world;
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        const winA = addWindow(world, "win-a", ws1);
        winA.frameGeometry = { x: 0, y: 0, width: 600, height: 800 };
        const winB = addWindow(world, "win-b", ws1);
        winB.frameGeometry = { x: 600, y: 0, width: 600, height: 800 };
        const winT = addWindow(world, "win-t", ws2);
        winT.frameGeometry = { x: 0, y: 0, width: 1200, height: 800 };
        (world.workspace["activeWindow"] as unknown) = winA;
        const mocks: EntryMocks = { dbusCalls: [], callbacks: [], logs: [], shortcuts: [] };
        const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
        const handle = startPlanAdapterEntry({
            workspace: world.workspace,
            callDbus: (service, _path, _iface, method, payload, callback): void => {
                if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                    callback(true);
                    return;
                }
                mocks.dbusCalls.push({ service, method, payload });
                mocks.callbacks.push(callback);
            },
            scheduleOnce: (_delayMs, callback): (() => void) => {
                const entry = { callback, cancelled: false };
                timers.push(entry);
                return (): void => {
                    entry.cancelled = true;
                };
            },
            log: (message): void => {
                mocks.logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence, callback): boolean => {
                mocks.shortcuts.push({ action, sequence, callback });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): unknown => mode,
        });
        return { handle, world, mocks };
    }

    function plannedReply(correlation: string): string {
        return JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-a",
                leaf: "leaf-win-a",
                source_output: "out-1",
                source_workspace: "ws-1",
                target_output: "out-1",
                target_workspace: "ws-2",
            },
        });
    }

    it("routes exact send chords and shifted-symbol aliases through the Rust send transport", () => {
        const { handle, mocks } = startRichEntry("per-output-local");
        assert.ok(handle !== null);
        const byAction = new Map(mocks.shortcuts.map((row) => [row.action, row]));
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-2")?.sequence, "Meta+Shift+2");
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-2-symbol")?.sequence, "Meta+@");
        const callsBefore = mocks.dbusCalls.length;
        byAction.get("plasma-auto-tiler-move-workspace-2")?.callback();
        assert.ok(mocks.dbusCalls.length > callsBefore);
        // First call pins the owner; feed it so the structural request is issued.
        mocks.callbacks[0]?.(":1.7");
        const sendCall = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace"));
        assert.ok(sendCall !== undefined);
        const payload = JSON.parse(sendCall.payload) as Record<string, unknown>;
        const command = payload["command"] as Record<string, unknown>;
        assert.equal(command["op"], "send-to-workspace");
        assert.equal(command["target_workspace"], "ws-2");
        handle?.stop();
    });

    it("routes the shifted-symbol alias identically to its digit chord", () => {
        const first = startRichEntry("per-output-local");
        assert.ok(first.handle !== null);
        const byFirst = new Map(first.mocks.shortcuts.map((row) => [row.action, row]));
        byFirst.get("plasma-auto-tiler-move-workspace-2-symbol")?.callback();
        first.mocks.callbacks[0]?.(":1.7");
        const aliasCall = first.mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace"));
        assert.ok(aliasCall !== undefined);
        const aliasPayload = JSON.parse(aliasCall.payload) as Record<string, unknown>;
        first.handle?.stop();
        const second = startRichEntry("per-output-local");
        assert.ok(second.handle !== null);
        const bySecond = new Map(second.mocks.shortcuts.map((row) => [row.action, row]));
        bySecond.get("plasma-auto-tiler-move-workspace-2")?.callback();
        second.mocks.callbacks[0]?.(":1.7");
        const digitCall = second.mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace"));
        assert.ok(digitCall !== undefined);
        const digitPayload = JSON.parse(digitCall.payload) as Record<string, unknown>;
        assert.deepEqual(
            (aliasPayload["command"] as Record<string, unknown>)["target_workspace"],
            (digitPayload["command"] as Record<string, unknown>)["target_workspace"],
        );
        second.handle?.stop();
    });

    it("follows an existing target after the validated send commits", () => {
        const { handle, world, mocks } = startRichEntry("per-output-local");
        assert.ok(handle !== null);
        const moverBefore = world.workspace["activeWindow"];
        const targetDesktop = world.desktops[1];
        assert.ok(targetDesktop !== undefined);
        const byAction = new Map(mocks.shortcuts.map((row) => [row.action, row]));
        byAction.get("plasma-auto-tiler-move-workspace-2")?.callback();
        // Activation pins the owner, then the structural request is issued.
        mocks.callbacks[0]?.(":1.7");
        const request = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace"));
        assert.ok(request !== undefined);
        const correlation = (JSON.parse(request.payload) as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[mocks.callbacks.length - 1]?.(plannedReply(correlation));
        // Bounded fence: native writes applied, but the accepted ack waits
        // for the mover desktopsChanged echo plus required geometry echoes.
        assert.equal(
            mocks.dbusCalls.some((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted")),
            false,
        );
        fireMoverEcho(moverBefore as object);
        assert.equal(
            mocks.dbusCalls.some((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted")),
            false,
            "mover echo alone must not ack while geometry echoes are pending",
        );
        fireAllGeometry(world);
        const ackCall = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted"));
        assert.ok(ackCall !== undefined);
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 0 }),
        );
        const verifyCall = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace-verify"));
        assert.ok(verifyCall !== undefined);
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );
        // Legacy follow: current desktop is the existing target and the moved
        // window is focused.
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), targetDesktop);
        assert.equal(world.workspace["activeWindow"], moverBefore);
        const mover = moverBefore as { desktops: unknown };
        assert.ok((mover.desktops as unknown[]).includes(targetDesktop));
        handle?.stop();
    });

    it("follows the reused trailing target on Meta+Shift+0 after commit", () => {
        const { handle, world, mocks } = startRichEntry("per-output-local");
        assert.ok(handle !== null);
        // Empty the ws-2 target so Meta+Shift+0 reuses (not appends) it.
        const kept = world.wins.filter((win) => (win as { internalId: string }).internalId !== "win-t");
        world.wins.length = 0;
        for (const win of kept) {
            world.wins.push(win);
        }
        const moverBefore = world.workspace["activeWindow"];
        const byAction = new Map(mocks.shortcuts.map((row) => [row.action, row]));
        byAction.get("plasma-auto-tiler-move-workspace-append")?.callback();
        mocks.callbacks[0]?.(":1.7");
        const request = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace"));
        assert.ok(request !== undefined);
        const payload = JSON.parse(request.payload) as Record<string, unknown>;
        const command = payload["command"] as Record<string, unknown>;
        // Trailing reuse resolves to the lifecycle trailing empty (appended
        // at startup because ws-2 holds win-t, then reused after win-t is
        // removed from the test world).
        const trailingTarget = command["target_workspace"] as string;
        assert.ok(typeof trailingTarget === "string" && trailingTarget.length > 0);
        assert.notEqual(trailingTarget, "ws-1");
        const correlation = payload["correlation_id"] as string;
        const emptyPlanned = JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: trailingTarget, rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: trailingTarget, leaf: "leaf-win-a" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-a",
                leaf: "leaf-win-a",
                source_output: "out-1",
                source_workspace: "ws-1",
                target_output: "out-1",
                target_workspace: trailingTarget,
            },
        });
        mocks.callbacks[mocks.callbacks.length - 1]?.(emptyPlanned);
        assert.equal(
            mocks.dbusCalls.some((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted")),
            false,
        );
        fireMoverEcho(moverBefore as object);
        fireAllGeometry(world);
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 0 }),
        );
        const verifyCall = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace-verify"));
        assert.ok(verifyCall !== undefined);
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );
        const trailingDesktop = world.desktops.find((entry) => entry.id === trailingTarget);
        assert.ok(trailingDesktop !== undefined);
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), trailingDesktop);
        assert.equal(world.workspace["activeWindow"], moverBefore);
        handle?.stop();
    });

    it("does not follow on a rejected send", () => {
        const { handle, world, mocks } = startRichEntry("per-output-local");
        assert.ok(handle !== null);
        const activeBefore = world.workspace["activeWindow"];
        const currentBefore = world.currentByOutput.get(world.outputs[0] as never);
        const byAction = new Map(mocks.shortcuts.map((row) => [row.action, row]));
        byAction.get("plasma-auto-tiler-move-workspace-2")?.callback();
        mocks.callbacks[0]?.(":1.7");
        const request = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace"));
        assert.ok(request !== undefined);
        const correlation = (JSON.parse(request.payload) as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", kind: "stale-revision", message: "stale" }),
        );
        assert.equal(world.workspace["activeWindow"], activeBefore);
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), currentBefore);
        handle?.stop();
    });

    it("fails closed on stale and missing targets without transport or writes", () => {
        const { handle, world, mocks } = startRichEntry("per-output-local");
        assert.ok(handle !== null);
        const callsBefore = mocks.dbusCalls.length;
        const byAction = new Map(mocks.shortcuts.map((row) => [row.action, row]));
        // Absent logical position never reaches the transport.
        handle?.requestWorkspaceMove(5);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.ok(byAction.get("plasma-auto-tiler-move-workspace-5") !== undefined);
        byAction.get("plasma-auto-tiler-move-workspace-5")?.callback();
        assert.equal(mocks.dbusCalls.length, callsBefore);
        // Missing target after resolve fails closed inside the transport.
        world.desktops.splice(1, 1);
        handle?.requestWorkspaceMove(2);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        handle?.stop();
    });

    it("same-target refusal stays usable without writes or busy-refused", () => {
        const { handle, world, mocks } = startRichEntry("per-output-local");
        assert.ok(handle !== null);
        const activeBefore = world.workspace["activeWindow"];
        const mover = activeBefore as { desktops: unknown[]; frameGeometry: unknown };
        const moverDesktopsBefore = [...(mover.desktops as unknown[])];
        const geometryBefore = JSON.stringify(mover.frameGeometry);
        const currentBefore = world.currentByOutput.get(world.outputs[0] as never);
        const callsBefore = mocks.dbusCalls.length;
        const byAction = new Map(mocks.shortcuts.map((row) => [row.action, row]));
        // Same-target no-op through shortcut routing: logical 1 is ws-1, the
        // current workspace holding the focused mover.
        byAction.get("plasma-auto-tiler-move-workspace-1")?.callback();
        assert.ok(
            mocks.logs.some((line) => line.includes("event=refuse") && line.includes("outcome=same-workspace")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.dbusCalls.length, callsBefore, "same-target no-op must not touch D-Bus");
        assert.ok(
            !mocks.logs.some((line) => line.includes("busy-refused") && line.includes("workspace-move")),
            "same-target refusal must not emit entry busy-refused",
        );
        assert.equal(world.workspace["activeWindow"], activeBefore, "no follow refocus from no-op");
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), currentBefore, "no follow switch from no-op");
        assert.deepEqual(mover.desktops as unknown[], moverDesktopsBefore, "no native membership write from no-op");
        assert.equal(JSON.stringify(mover.frameGeometry), geometryBefore, "no native geometry write from no-op");
        assert.ok(
            !mocks.logs.some((line) => line.includes("event=follow")),
            "no follow from same-target no-op",
        );
        // A valid distinct target through the production entry must begin a
        // normal workspace-send transport rather than entry busy-refused.
        handle?.requestWorkspaceMove(2);
        mocks.callbacks[0]?.(":1.7");
        const request = mocks.dbusCalls.find((call) => call.payload.includes("\"op\":\"send-to-workspace\""));
        assert.ok(request !== undefined, "distinct target begins transport after same-target no-op");
        const command = (JSON.parse(request.payload) as Record<string, unknown>)["command"] as Record<string, unknown>;
        assert.equal(command["target_workspace"], "ws-2");
        assert.ok(
            !mocks.logs.some((line) => line.includes("busy-refused") && line.includes("workspace-move")),
            "distinct target must not busy-refuse after same-target no-op",
        );
        handle?.stop();
    });

    it("excludes intentional floats from send observation", () => {
        const { world } = startRichEntry("per-output-local");
        const cache = new Map<string, string>();
        const floating = new Set<string>(["win-b"]);
        const observed = observeSendTarget(world.workspace, cache, "ws-2", floating);
        assert.ok(observed !== null);
        assert.ok(!observed.sourceWindows.some((entry) => entry.id === "win-b"), "float excluded");
        assert.ok(observed.sourceWindows.some((entry) => entry.id === "win-a"));
    });

    it("observes live current-vs-target diagnostics while source is pinned", () => {
        const built = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const world = built.world;
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        addWindow(world, "win-a", ws1);
        addWindow(world, "win-t", ws2);
        (world.workspace["activeWindow"] as unknown) = world.wins[0];
        // Pinned source still reads live current for the selected output.
        world.currentByOutput.set(world.outputs[0] as never, ws1 as never);
        const before = observeSendTarget(world.workspace, new Map(), "ws-2", new Set(), "ws-1");
        assert.ok(before !== null);
        assert.equal(before.targetOrdinal, 1);
        assert.equal(before.targetNumber, 2);
        assert.equal(before.outputOrdinal, 0);
        assert.equal(before.currentOrdinal, 0);
        assert.equal(before.currentNumber, 1);
        assert.equal(before.currentIdEq, 0);
        assert.equal(before.currentRefEq, 0);
        // Live current divergence after the setter takes effect.
        world.currentByOutput.set(world.outputs[0] as never, ws2 as never);
        const after = observeSendTarget(world.workspace, new Map(), "ws-2", new Set(), "ws-1");
        assert.ok(after !== null);
        assert.equal(after.targetOrdinal, 1);
        assert.equal(after.currentOrdinal, 1);
        assert.equal(after.currentNumber, 2);
        assert.equal(after.currentIdEq, 1);
        assert.equal(after.currentRefEq, 1);
        // Fresh wrapper: stable-id equality holds while wrapper equality does
        // not; the stable-id follow gate stays untouched.
        world.currentByOutput.set(world.outputs[0] as never, { id: "ws-2", x11DesktopNumber: 2 } as never);
        const fresh = observeSendTarget(world.workspace, new Map(), "ws-2", new Set(), "ws-1");
        assert.ok(fresh !== null);
        assert.equal(fresh.currentIdEq, 1);
        assert.equal(fresh.currentRefEq, 0);
        // Best-effort current read failure never fails pinned observation.
        const broken = { ...world.workspace, currentDesktopForScreen: (): unknown => { throw new Error("lost"); } };
        const degraded = observeSendTarget(broken, new Map(), "ws-2", new Set(), "ws-1");
        assert.ok(degraded !== null);
        assert.equal(degraded.currentOrdinal, -1);
        assert.equal(degraded.currentIdEq, -1);
        assert.equal(degraded.targetOrdinal, 1);
    });

    it("treats unavailable or nonzero maximize as ineligible for send", () => {
        const built = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const world = built.world;
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        const a = addWindow(world, "win-a", ws1);
        const b = addWindow(world, "win-b", ws1);
        addWindow(world, "win-t", ws2);
        (world.workspace["activeWindow"] as unknown) = a;
        b.maximizeMode = 1;
        const cache = new Map<string, string>();
        const observedMax = observeSendTarget(world.workspace, cache, "ws-2", new Set());
        assert.ok(observedMax !== null);
        assert.ok(!observedMax.sourceWindows.some((entry) => entry.id === "win-b"), "nonzero maximize excluded");
        delete ((b as unknown) as Record<string, unknown>)["maximizeMode"];
        const observedMissing = observeSendTarget(world.workspace, new Map(), "ws-2", new Set());
        assert.ok(observedMissing !== null);
        assert.ok(!observedMissing.sourceWindows.some((entry) => entry.id === "win-b"), "missing maximize excluded");
    });

    it("matches desktop membership by validated id, not wrapper identity", () => {
        const { world } = startRichEntry("per-output-local");
        const ws1Clone = { id: "ws-1", x11DesktopNumber: 1 };
        for (const win of world.wins) {
            if ((win as { internalId: string }).internalId === "win-a") {
                (win as { desktops: unknown }).desktops = [ws1Clone];
            }
        }
        const observed = observeSendTarget(world.workspace, new Map(), "ws-2", new Set());
        assert.ok(observed !== null);
        assert.ok(observed.sourceWindows.some((entry) => entry.id === "win-a"), "id match counts");
    });

    it("detaches per-window desktopsChanged on removal and all on stop", () => {
        const built = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2"]);
        const world = built.world;
        const ws1 = world.desktops[0];
        const ws2 = world.desktops[1];
        assert.ok(ws1 !== undefined && ws2 !== undefined);
        // Instrumented per-window desktopsChanged with disconnect counting.
        const winSignals = new Map<string, FakeSignal>();
        const tracked = (id: string): FakeSignal => {
            const sig = fakeSignal();
            winSignals.set(id, sig);
            return sig;
        };
        const sigA = tracked("win-a");
        const sigB = tracked("win-b");
        const sigT = tracked("win-t");
        const out = world.outputs[0] as never;
        const mkWin = (id: string, desktop: { id: string }, sig: FakeSignal): FakeWindow => ({
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            internalId: id,
            resourceClass: "test-app",
            output: out as never,
            desktops: [desktop as never],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            frameGeometryChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            maximizedChanged: fakeSignal().signal,
            desktopsChanged: sig.signal as never,
        });
        world.wins.length = 0;
        const winA = mkWin("win-a", ws1, sigA);
        const winB = mkWin("win-b", ws1, sigB);
        const winT = mkWin("win-t", ws2, sigT);
        world.wins.push(winA, winB, winT);
        (world.workspace["activeWindow"] as unknown) = winA;
        // Instrumented workspace windowRemoved that retains handlers.
        const removedSig = fakeSignal();
        (world.workspace as Record<string, unknown>)["windowRemoved"] = removedSig.signal;
        const addedSig = fakeSignal();
        (world.workspace as Record<string, unknown>)["windowAdded"] = addedSig.signal;
        const mocks = { dbusCalls: [] as Array<{ service: string; method: string; payload: string }>, callbacks: [] as Array<(reply: unknown) => void>, logs: [] as string[], shortcuts: [] as Array<{ action: string; sequence: string; callback: () => void }> };
        const handle = startPlanAdapterEntry({
            workspace: world.workspace,
            callDbus: (service, _path, _iface, method, payload, callback): void => {
                if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                    callback(true);
                    return;
                }
                mocks.dbusCalls.push({ service, method, payload });
                mocks.callbacks.push(callback);
            },
            scheduleOnce: (_delayMs, callback): (() => void) => {
                void callback;
                return (): void => {};
            },
            log: (message): void => {
                mocks.logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence, callback): boolean => {
                mocks.shortcuts.push({ action, sequence, callback });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): unknown => "per-output-local",
        });
        assert.ok(handle !== null);
        assert.ok(sigA.handlers.length >= 1, "per-window desktopsChanged attached");
        const attached = sigA.handlers.length;
        for (const handler of [...removedSig.handlers]) {
            handler(winA);
        }
        assert.ok(sigA.handlers.length < attached, "removal detaches per-window subscription");
        handle?.stop();
        assert.equal(sigB.handlers.length, 0, "stop detaches remaining per-window subscriptions");
        assert.equal(sigT.handlers.length, 0, "stop detaches all per-window subscriptions");
    });
});

describe("four-desktop terminal-run send with bounded fence", () => {
    interface DelayedState {
        visibleRect: { x: number; y: number; width: number; height: number };
        pendingRect: { x: number; y: number; width: number; height: number } | null;
        visibleDesktops: FakeDesktop[];
        pendingDesktops: FakeDesktop[] | null;
        desktopsSig: FakeSignal;
        geoSig: FakeSignal;
    }

    const delayedStates = new WeakMap<object, DelayedState>();

    function makeDelayedWindow(
        world: FakeWorld,
        id: string,
        desktop: FakeDesktop,
        initial: { x: number; y: number; width: number; height: number },
    ): FakeWindow {
        const output = world.outputs[0];
        if (output === undefined) {
            throw new Error("no output");
        }
        const desktopsSig = fakeSignal();
        const geoSig = fakeSignal();
        const state: DelayedState = {
            visibleRect: { ...initial },
            pendingRect: null,
            visibleDesktops: [desktop],
            pendingDesktops: null,
            desktopsSig,
            geoSig,
        };
        const win = {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            internalId: id,
            resourceClass: "test-app",
            output,
            fullScreenChanged: fakeSignal().signal,
            maximizedChanged: fakeSignal().signal,
        } as unknown as FakeWindow;
        Object.defineProperties(win, {
            frameGeometry: {
                get: () => ({ ...state.visibleRect }),
                set: (value: unknown) => {
                    const record = value as Record<string, unknown>;
                    const widthRaw = record["width"] !== undefined ? record["width"] : record["w"];
                    const heightRaw = record["height"] !== undefined ? record["height"] : record["h"];
                    state.pendingRect = {
                        x: record["x"] as number,
                        y: record["y"] as number,
                        width: widthRaw as number,
                        height: heightRaw as number,
                    };
                },
                enumerable: true,
                configurable: true,
            },
            desktops: {
                get: () => [...state.visibleDesktops],
                set: (value: unknown) => {
                    state.pendingDesktops = [...(value as FakeDesktop[])];
                },
                enumerable: true,
                configurable: true,
            },
            desktopsChanged: {
                get: () => state.desktopsSig.signal,
                enumerable: true,
                configurable: true,
            },
            frameGeometryChanged: {
                get: () => state.geoSig.signal,
                enumerable: true,
                configurable: true,
            },
        });
        delayedStates.set(win, state);
        moverEchoes.set(win as object, state.desktopsSig);
        geometryEchoes.set(win as object, state.geoSig);
        world.wins.push(win);
        (world.workspace["activeWindow"] as unknown) = win;
        return win;
    }

    function promoteDesktops(win: object): void {
        const state = delayedStates.get(win);
        if (state !== undefined && state.pendingDesktops !== null) {
            state.visibleDesktops = [...state.pendingDesktops];
            state.pendingDesktops = null;
        }
    }

    function promoteGeometry(win: object): void {
        const state = delayedStates.get(win);
        if (state !== undefined && state.pendingRect !== null) {
            state.visibleRect = { ...state.pendingRect };
            state.pendingRect = null;
        }
    }

    function fireDesktopsWithPromote(win: object): void {
        promoteDesktops(win);
        fireMoverEcho(win);
    }

    function fireGeometryWithPromote(win: object): void {
        promoteGeometry(win);
        const seam = geometryEchoes.get(win);
        if (seam === undefined) {
            return;
        }
        for (const handler of [...seam.handlers]) {
            handler();
        }
    }

    it("moves 3->2 with delayed signals, follows, then collapses only the preexisting terminal empty", () => {
        const built = fakeWorld("per-output-local", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const world = built.world;
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const ws4 = world.desktops[3] as FakeDesktop;
        assert.ok(ws1 !== undefined && ws2 !== undefined && ws3 !== undefined && ws4 !== undefined);
        const win1a = addWindow(world, "win-1a", ws1);
        win1a.frameGeometry = { x: 0, y: 0, width: 600, height: 800 };
        const win1b = addWindow(world, "win-1b", ws1);
        win1b.frameGeometry = { x: 600, y: 0, width: 600, height: 800 };
        addWindow(world, "win-full", ws1, { fullScreen: true });
        addWindow(world, "win-max", ws1, { maximizeMode: 3 });
        addWindow(world, "win-sticky", ws1, { onAllDesktops: true });
        const winT = makeDelayedWindow(world, "win-t", ws2, { x: 0, y: 0, width: 600, height: 800 });
        const winM = makeDelayedWindow(world, "win-m", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        world.currentByOutput.set(world.outputs[0] as never, ws3 as never);
        world.globalCurrent = ws3;
        (world.workspace as Record<string, unknown>)["currentDesktop"] = ws3;
        (world.workspace["activeWindow"] as unknown) = winM;
        const mocks = { dbusCalls: [] as Array<{ service: string; method: string; payload: string }>, callbacks: [] as Array<(reply: unknown) => void>, logs: [] as string[], shortcuts: [] as Array<{ action: string; sequence: string; callback: () => void }> };
        const handle = startPlanAdapterEntry({
            workspace: world.workspace,
            callDbus: (service, _path, _iface, method, payload, callback): void => {
                if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                    callback(true);
                    return;
                }
                mocks.dbusCalls.push({ service, method, payload });
                mocks.callbacks.push(callback);
            },
            scheduleOnce: (): (() => void) => (): void => {},
            log: (message): void => {
                mocks.logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence, callback): boolean => {
                mocks.shortcuts.push({ action, sequence, callback });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): unknown => "per-output-local",
        });
        assert.ok(handle !== null);
        assert.equal(world.desktops.length, 4);
        handle.requestWorkspaceMove(2);
        mocks.callbacks[0]?.(":1.7");
        const request = mocks.dbusCalls.find((call) => call.payload.includes("\"op\":\"send-to-workspace\""));
        assert.ok(request !== undefined);
        const correlation = (JSON.parse(request.payload) as Record<string, unknown>)["correlation_id"] as string;
        const planned = JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            desired_geometry: [
                { window: "win-m", leaf: "leaf-win-m", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-m" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-m",
                leaf: "leaf-win-m",
                source_output: "out-1",
                source_workspace: "ws-3",
                target_output: "out-1",
                target_workspace: "ws-2",
            },
        });
        mocks.callbacks[mocks.callbacks.length - 1]?.(planned);
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-echo") && l.includes("outcome=waiting")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-geometry") && l.includes("outcome=waiting")), mocks.logs.join("\n"));
        assert.equal(
            mocks.dbusCalls.some((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted")),
            false,
        );
        fireDesktopsWithPromote(winM as object);
        assert.equal(
            mocks.dbusCalls.some((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted")),
            false,
            "desktopsChanged before geometry must not ack",
        );
        assert.ok(world.desktops.some((entry) => entry.id === "ws-4"), "no early retirement while ws-3 current");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-3"), "empty source retained while current");
        fireGeometryWithPromote(winM as object);
        const ackCall = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace-ack") && call.payload.includes("accepted"));
        assert.ok(ackCall !== undefined, "ack only after mover plus required geometry echo");
        const ackPayload = JSON.parse(ackCall.payload) as Record<string, unknown>;
        const ackWindows = ackPayload["windows"] as Array<Record<string, unknown>>;
        const ackTargets = ackPayload["target_windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(ackWindows, [], "empty source accepted");
        assert.equal(ackTargets.length, 2);
        const byId = new Map(ackTargets.map((entry) => [entry["window"], entry["rect"]]));
        assert.deepEqual(byId.get("win-m"), { x: 600, y: 0, w: 600, h: 800 });
        assert.deepEqual(byId.get("win-t"), { x: 0, y: 0, w: 600, h: 800 });
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 0 }),
        );
        const verifyCall = mocks.dbusCalls.find((call) => call.payload.includes("send-to-workspace-verify"));
        assert.ok(verifyCall !== undefined);
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), ws2);
        assert.equal(world.workspace["activeWindow"], winM);
        assert.ok((winM.desktops as unknown[]).includes(ws2), "mover membership in target");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-4"), "still no retirement before post-follow cleanup");
        fireMoverEcho(winM as object);
        assert.ok(!world.desktops.some((entry) => entry.id === "ws-4"), "preexisting terminal empty 4 removed only after follow to 2");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-3"), "empty source 3 retained as trailing");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-1"), "occupied ws-1 with fullscreen/maximized survives");
        assert.ok(world.desktops.some((entry) => entry.id === "ws-2"), "current target survives");
        assert.equal(world.desktops.length, 3);
        handle.requestWorkspaceMove(3);
        mocks.callbacks[mocks.callbacks.length - 1]?.(":1.7");
        const request2 = mocks.dbusCalls.filter((call) => call.payload.includes("\"op\":\"send-to-workspace\""))[1];
        assert.ok(request2 !== undefined, "adapter remains usable for a subsequent send");
        const correlation2 = (JSON.parse(request2.payload) as Record<string, unknown>)["correlation_id"] as string;
        const planned2 = JSON.stringify({
            v: 1,
            correlation_id: correlation2,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 1,
            desired_geometry: [
                { window: "win-m", leaf: "leaf-win-m", output: "out-1", workspace: "ws-3", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 1200, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-3", leaf: "leaf-win-m" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-m",
                leaf: "leaf-win-m",
                source_output: "out-1",
                source_workspace: "ws-2",
                target_output: "out-1",
                target_workspace: "ws-3",
            },
        });
        mocks.callbacks[mocks.callbacks.length - 1]?.(planned2);
        fireDesktopsWithPromote(winM as object);
        fireGeometryWithPromote(winM as object);
        fireGeometryWithPromote(winT as object);
        const ack2 = mocks.dbusCalls.find((call) => call.payload.includes(correlation2) && call.payload.includes("accepted"));
        assert.ok(ack2 !== undefined, "second send completes the fence");
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation2, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 1 }),
        );
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            JSON.stringify({ v: 1, correlation_id: correlation2, outcome: "committed", kind: "send-to-workspace", base_revision: 2 }),
        );
        assert.equal(world.currentByOutput.get(world.outputs[0] as never), ws3);
        assert.ok(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length >= 2);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
        handle?.stop();
    });
});

describe("global-unique and shared preexisting terminal collapse", () => {
    function setCurrent(world: FakeWorld, desktop: FakeDesktop): void {
        const output = world.outputs[0];
        assert.ok(output !== undefined);
        world.currentByOutput.set(output, desktop);
        world.globalCurrent = desktop;
        (world.workspace as Record<string, unknown>)["currentDesktop"] = desktop;
    }

    function ids(world: FakeWorld): string[] {
        return world.desktops.map((entry) => entry.id);
    }

    it("global-unique retains first terminal empty and removes later only when nonvisible", () => {
        const built = fakeWorld("global-unique", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const world = built.world;
        const ws1 = world.desktops[0] as FakeDesktop;
        assert.ok(ws1 !== undefined);
        addWindow(world, "win-keep", ws1);
        const { adapter } = startNative(world, "global-unique");
        adapter.handleTopologySignal();
        const after = ids(world);
        assert.ok(after.includes("ws-1"), "occupied head survives");
        assert.ok(after.includes("ws-2"), "first terminal empty retained");
        assert.ok(!after.includes("ws-3") && !after.includes("ws-4"), `later empties removed: ${after.join(",")}`);
        assert.equal(world.desktops.length, 2, "floor of two global desktops");
        adapter.disable();

        const gated = fakeWorld("global-unique", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const gworld = gated.world;
        const gws1 = gworld.desktops[0] as FakeDesktop;
        const gws4 = gworld.desktops[3] as FakeDesktop;
        assert.ok(gws1 !== undefined && gws4 !== undefined);
        addWindow(gworld, "win-keep", gws1);
        setCurrent(gworld, gws4);
        const { adapter: second } = startNative(gworld, "global-unique");
        second.handleTopologySignal();
        assert.deepEqual(ids(gworld), ["ws-1", "ws-2", "ws-3", "ws-4"], "visible terminal blocks collapse");
        setCurrent(gworld, gws1);
        second.handleTopologySignal();
        const collapsed = ids(gworld);
        assert.ok(collapsed.includes("ws-1") && collapsed.includes("ws-2"), `first retained after nonvisible: ${collapsed.join(",")}`);
        assert.ok(!collapsed.includes("ws-3") && !collapsed.includes("ws-4"), `later removed after nonvisible: ${collapsed.join(",")}`);
        second.disable();
    });

    it("global-unique preserves gap, occupied terminal, floor and visible", () => {
        const gap = fakeWorld("global-unique", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4", "ws-5"]);
        const gworld = gap.world;
        const gws1 = gworld.desktops[0] as FakeDesktop;
        const gws3 = gworld.desktops[2] as FakeDesktop;
        assert.ok(gws1 !== undefined && gws3 !== undefined);
        addWindow(gworld, "win-a", gws1);
        addWindow(gworld, "win-b", gws3);
        const { adapter } = startNative(gworld, "global-unique");
        adapter.handleTopologySignal();
        const after = ids(gworld);
        assert.ok(after.includes("ws-2"), `empty gap preserved: ${after.join(",")}`);
        assert.ok(after.includes("ws-4"), `first terminal empty retained: ${after.join(",")}`);
        assert.ok(!after.includes("ws-5"), `only literal-last extra removed: ${after.join(",")}`);
        assert.ok(after.includes("ws-1") && after.includes("ws-3"), "occupied members survive");
        adapter.disable();

        for (const kind of ["fullscreen", "maximized", "tiled"] as const) {
            const built = fakeWorld("global-unique", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
            const world = built.world;
            const ws1 = world.desktops[0] as FakeDesktop;
            const ws4 = world.desktops[3] as FakeDesktop;
            assert.ok(ws1 !== undefined && ws4 !== undefined);
            addWindow(world, "win-keep", ws1);
            if (kind === "fullscreen") {
                addWindow(world, "win-term", ws4, { fullScreen: true });
            } else if (kind === "maximized") {
                addWindow(world, "win-term", ws4, { maximizeMode: 3 });
            } else {
                addWindow(world, "win-term", ws4);
            }
            const { adapter: handle } = startNative(world, "global-unique");
            handle.handleTopologySignal();
            assert.ok(ids(world).includes("ws-4"), `${kind} occupied terminal preserved`);
            handle.disable();
        }

        const sticky = fakeWorld("global-unique", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const sworld = sticky.world;
        const sws1 = sworld.desktops[0] as FakeDesktop;
        const sws4 = sworld.desktops[3] as FakeDesktop;
        assert.ok(sws1 !== undefined && sws4 !== undefined);
        addWindow(sworld, "win-keep", sws1);
        addWindow(sworld, "win-sticky", sws4, { onAllDesktops: true });
        const { adapter: shandle } = startNative(sworld, "global-unique");
        shandle.handleTopologySignal();
        assert.ok(!ids(sworld).includes("ws-4"), "sticky-only terminal still collapses to one trailing");
        assert.ok(ids(sworld).includes("ws-2"), "first terminal retained");
        shandle.disable();

        const floor = fakeWorld("global-unique", ["out-1"], ["ws-1", "ws-2"]);
        const fworld = floor.world;
        const fws1 = fworld.desktops[0] as FakeDesktop;
        assert.ok(fws1 !== undefined);
        addWindow(fworld, "win-keep", fws1);
        const { adapter: fhandle } = startNative(fworld, "global-unique");
        fhandle.handleTopologySignal();
        assert.ok(fworld.desktops.length >= 2, "never below two global desktops");
        fhandle.disable();
    });

    it("shared retains first terminal empty and removes later only when nonvisible", () => {
        const built = fakeWorld("shared", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const world = built.world;
        const ws1 = world.desktops[0] as FakeDesktop;
        assert.ok(ws1 !== undefined);
        addWindow(world, "win-keep", ws1);
        const { adapter } = startNative(world, "shared");
        adapter.handleTopologySignal();
        const after = ids(world);
        assert.ok(after.includes("ws-1") && after.includes("ws-2"), `first retained: ${after.join(",")}`);
        assert.ok(!after.includes("ws-3") && !after.includes("ws-4"), `later removed: ${after.join(",")}`);
        assert.equal(world.desktops.length, 2);
        adapter.disable();

        const gated = fakeWorld("shared", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
        const gworld = gated.world;
        const gws1 = gworld.desktops[0] as FakeDesktop;
        const gws4 = gworld.desktops[3] as FakeDesktop;
        assert.ok(gws1 !== undefined && gws4 !== undefined);
        addWindow(gworld, "win-keep", gws1);
        setCurrent(gworld, gws4);
        const { adapter: second } = startNative(gworld, "shared");
        second.handleTopologySignal();
        assert.deepEqual(ids(gworld), ["ws-1", "ws-2", "ws-3", "ws-4"], "visible terminal blocks collapse");
        setCurrent(gworld, gws1);
        second.handleTopologySignal();
        const collapsed = ids(gworld);
        assert.ok(!collapsed.includes("ws-3") && !collapsed.includes("ws-4"), `later removed after nonvisible: ${collapsed.join(",")}`);
        second.disable();
    });

    it("shared preserves gap, occupied terminal, floor and visible", () => {
        const gap = fakeWorld("shared", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4", "ws-5"]);
        const gworld = gap.world;
        const gws1 = gworld.desktops[0] as FakeDesktop;
        const gws3 = gworld.desktops[2] as FakeDesktop;
        assert.ok(gws1 !== undefined && gws3 !== undefined);
        addWindow(gworld, "win-a", gws1);
        addWindow(gworld, "win-b", gws3);
        const { adapter } = startNative(gworld, "shared");
        adapter.handleTopologySignal();
        const after = ids(gworld);
        assert.ok(after.includes("ws-2"), `empty gap preserved: ${after.join(",")}`);
        assert.ok(after.includes("ws-4"), "first terminal retained");
        assert.ok(!after.includes("ws-5"), "literal-last extra removed");
        adapter.disable();

        for (const kind of ["fullscreen", "maximized", "tiled"] as const) {
            const built = fakeWorld("shared", ["out-1"], ["ws-1", "ws-2", "ws-3", "ws-4"]);
            const world = built.world;
            const ws1 = world.desktops[0] as FakeDesktop;
            const ws4 = world.desktops[3] as FakeDesktop;
            assert.ok(ws1 !== undefined && ws4 !== undefined);
            addWindow(world, "win-keep", ws1);
            if (kind === "fullscreen") {
                addWindow(world, "win-term", ws4, { fullScreen: true });
            } else if (kind === "maximized") {
                addWindow(world, "win-term", ws4, { maximizeMode: 3 });
            } else {
                addWindow(world, "win-term", ws4);
            }
            const { adapter: handle } = startNative(world, "shared");
            handle.handleTopologySignal();
            assert.ok(ids(world).includes("ws-4"), `${kind} occupied terminal preserved`);
            handle.disable();
        }

        const floor = fakeWorld("shared", ["out-1"], ["ws-1", "ws-2"]);
        const fworld = floor.world;
        const fws1 = fworld.desktops[0] as FakeDesktop;
        assert.ok(fws1 !== undefined);
        addWindow(fworld, "win-keep", fws1);
        const { adapter: fhandle } = startNative(fworld, "shared");
        fhandle.handleTopologySignal();
        assert.ok(fworld.desktops.length >= 2, "never below two global desktops");
        fhandle.disable();
    });
});

describe("workspace production entry wiring", () => {
    it("integrates the send transport reference with the smallest production wiring", () => {
        const srcDir = kwinSrcDir();
        const entry = readFileSync(join(srcDir, "plan-adapter-entry.ts"), "utf8");
        assert.ok(entry.includes("workspace-native"), "native lifecycle module");
        assert.ok(entry.includes("WorkspaceSendAdapter"), "send transport reference");
        assert.ok(entry.includes("workspaceShortcutCatalog"), "number chord wiring");
        assert.ok(entry.includes("requestWorkspaceSelect"), "select handoff");
        assert.ok(entry.includes("requestWorkspaceMove"), "move handoff");
        const native = readFileSync(join(srcDir, "workspace-native.ts"), "utf8");
        for (const token of ["currentDesktopForScreen", "windowList", "desktops", "removeDesktop", "createDesktop"]) {
            assert.ok(native.includes(token), token);
        }
        assert.ok(entry.includes("desktopsChanged"), "signal coherence");
        for (const token of ["setTimeout", "setInterval", "requestAnimationFrame", "waitFor", "pollFor"]) {
            assert.ok(!native.includes(token), token);
            assert.ok(!entry.includes(token), `entry:${token}`);
        }
        assert.ok(!native.includes("retry"), "no retries");
        const production = readFileSync(join(srcDir, "entry.ts"), "utf8");
        assert.ok(production.includes("startPlanAdapterEntry"), "single production route");
    });
});
