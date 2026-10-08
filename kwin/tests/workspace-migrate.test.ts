// R-WS-12 whole-workspace output migration offline coverage: the four-row
// follow-only catalog, the session map commit (insert after target current,
// source refill, history invalidation of only the migrated id, displaced
// sibling preservation), the FULL-view observer (adjacency, focused rules,
// protected tripwire), and the shared-flight adapter (wire shape, refusal
// tokens, frozen reply binding, fenced multi-window commit, no replay, no
// fabricated focus, partial-uncertainty recovery). Included in `npm test`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DomainGaps } from "../src/domain-gap";
import {
    observeMigrateWorkspace,
    planWorkspaceMigrateShortcutCatalog,
} from "../src/plan-adapter-entry";
import {
    WORKSPACE_SEND_CONTRACT_VERSION,
    WORKSPACE_SEND_GET_OWNER_METHOD,
    WORKSPACE_SEND_HAS_OWNER_METHOD,
    WORKSPACE_SEND_METHOD,
    WorkspaceSendAdapter,
    type WorkspaceMigrateObserved,
    type WorkspaceMigrateObservedWindow,
    type WorkspaceSendAdapterEnv,
    type WorkspaceSendSettled,
} from "../src/workspace-send-adapter";
import { WorkspaceNativeAdapter } from "../src/workspace-native";

const GAPS: DomainGaps = { innerGap: 8, outerGap: 8 };

describe("migrate catalog", () => {
    it("exposes exactly four bindable unbound directional follow rows", () => {
        const rows = planWorkspaceMigrateShortcutCatalog();
        assert.equal(rows.length, 4);
        assert.deepEqual(
            rows.map((row) => row.action),
            [
                "plasma-auto-tiler-migrate-workspace-left",
                "plasma-auto-tiler-migrate-workspace-right",
                "plasma-auto-tiler-migrate-workspace-up",
                "plasma-auto-tiler-migrate-workspace-down",
            ],
        );
        assert.deepEqual(
            rows.map((row) => row.direction),
            ["left", "right", "up", "down"],
        );
        for (const row of rows) {
            assert.equal(row.sequence, "");
            assert.ok(row.text.length > 0);
        }
        assert.ok(Object.isFrozen(rows));
    });
});

// ---------- workspace-native map commit ----------

interface CommitOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
}

interface CommitDesktop {
    id: string;
    x11DesktopNumber: number;
}

interface CommitWindow {
    output: CommitOutput;
    desktops: CommitDesktop[];
}

function commitWorld(outputNames: string[], desktopIds: string[]): {
    adapter: WorkspaceNativeAdapter;
    workspace: Record<string, unknown>;
    outputs: CommitOutput[];
    desktops: CommitDesktop[];
    currentByOutput: Map<CommitOutput, CommitDesktop>;
    wins: CommitWindow[];
    logs: string[];
} {
    const logs: string[] = [];
    const outputs = outputNames.map((name) => ({
        name,
        manufacturer: "m",
        model: "d",
        serialNumber: `s-${name}`,
    }));
    const desktops = desktopIds.map((id, index) => ({ id, x11DesktopNumber: index + 1 }));
    const currentByOutput = new Map<CommitOutput, CommitDesktop>();
    for (const output of outputs) {
        const first = desktops[0];
        if (first !== undefined) {
            currentByOutput.set(output, first);
        }
    }
    const wins: CommitWindow[] = [];
    const workspace: Record<string, unknown> = {
        screens: outputs,
        desktops,
        activeWindow: null,
        activeScreen: outputs[0] ?? null,
        currentDesktopForScreen: (output: unknown): unknown => currentByOutput.get(output as CommitOutput) ?? null,
        setCurrentDesktopForScreen: (desktop: unknown, output: unknown): void => {
            currentByOutput.set(output as CommitOutput, desktop as CommitDesktop);
        },
        windowList: (): unknown[] => [...wins],
    };
    const adapter = new WorkspaceNativeAdapter({
        getWorkspace: () => workspace,
        readWorkspaceMode: () => "per-output-local",
        log: (message) => {
            logs.push(message);
        },
    });
    assert.equal(adapter.enable(), true);
    return { adapter, workspace, outputs, desktops, currentByOutput, wins, logs };
}

function occupy(wins: CommitWindow[], output: CommitOutput, desktop: CommitDesktop): void {
    wins.push({ output, desktops: [desktop] });
}

describe("migrate map commit", () => {
    it("moves the backing id after the target current and refills the source", () => {
        const world = commitWorld(["out-1", "out-2"], ["ws-1", "ws-2", "ws-9"]);
        const [out1, out2] = world.outputs as [CommitOutput, CommitOutput];
        const [ws1, ws2, ws9] = world.desktops as [CommitDesktop, CommitDesktop, CommitDesktop];
        occupy(world.wins, out1 as CommitOutput, ws1 as CommitDesktop);
        occupy(world.wins, out1 as CommitOutput, ws2 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out2 as CommitOutput, ws9 as CommitDesktop);
        const committed = world.adapter.commitWorkspaceMigration(
            out1 as CommitOutput,
            out2 as CommitOutput,
            "ws-1",
        );
        // The live source view still shows the migrated id, so the refill
        // falls back to the last remaining scoped workspace.
        assert.deepEqual(committed, { refillId: "ws-9" });
        assert.deepEqual(world.adapter.localSnapshot(), {
            "output-0": ["ws-2", "ws-9"],
            "output-1": ["ws-1"],
        });
    });

    it("refills with the still-scoped live current when it survives", () => {
        const world = commitWorld(["out-1", "out-2"], ["ws-1", "ws-2", "ws-9"]);
        const [out1, out2] = world.outputs as [CommitOutput, CommitOutput];
        const [ws1, ws2, ws9] = world.desktops as [CommitDesktop, CommitDesktop, CommitDesktop];
        occupy(world.wins, out1 as CommitOutput, ws1 as CommitDesktop);
        occupy(world.wins, out1 as CommitOutput, ws2 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws2 as CommitDesktop);
        world.currentByOutput.set(out2 as CommitOutput, ws9 as CommitDesktop);
        const committed = world.adapter.commitWorkspaceMigration(
            out1 as CommitOutput,
            out2 as CommitOutput,
            "ws-1",
        );
        assert.deepEqual(committed, { refillId: "ws-2" });
    });

    it("inserts after a listed target current and keeps other target ids", () => {
        const world = commitWorld(["out-1", "out-2"], ["ws-1", "ws-2", "ws-9"]);
        const [out1, out2] = world.outputs as [CommitOutput, CommitOutput];
        const [ws1, ws2, ws9] = world.desktops as [CommitDesktop, CommitDesktop, CommitDesktop];
        occupy(world.wins, out1 as CommitOutput, ws1 as CommitDesktop);
        occupy(world.wins, out1 as CommitOutput, ws2 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out2 as CommitOutput, ws9 as CommitDesktop);
        assert.deepEqual(
            world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-1"),
            { refillId: "ws-9" },
        );
        // Target now lists the migrated id; the native view is switched to it
        // before the next migration, so the second commit splices after it.
        world.currentByOutput.set(out2 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws2 as CommitDesktop);
        assert.deepEqual(
            world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-2"),
            { refillId: "ws-9" },
        );
        assert.deepEqual(world.adapter.localSnapshot(), {
            "output-0": ["ws-9"],
            "output-1": ["ws-1", "ws-2"],
        });
    });

    it("invalidates only the migrated history id and keeps siblings", () => {
        const world = commitWorld(["out-1", "out-2"], ["ws-1", "ws-2", "ws-9"]);
        const [out1, out2] = world.outputs as [CommitOutput, CommitOutput];
        const [ws1, ws2, ws9] = world.desktops as [CommitDesktop, CommitDesktop, CommitDesktop];
        occupy(world.wins, out1 as CommitOutput, ws1 as CommitDesktop);
        occupy(world.wins, out1 as CommitOutput, ws2 as CommitDesktop);
        occupy(world.wins, out2 as CommitOutput, ws9 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out2 as CommitOutput, ws9 as CommitDesktop);
        world.adapter.handleTopologySignal();
        // Populate the target scope first so a sibling history entry there
        // stays in scope through the later commit.
        assert.deepEqual(
            world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-2"),
            { refillId: "ws-1" },
        );
        // Sibling history on the target key naming an in-scope id.
        world.currentByOutput.set(out2 as CommitOutput, ws2 as CommitDesktop);
        world.adapter.handleTopologySignal();
        world.currentByOutput.set(out2 as CommitOutput, ws9 as CommitDesktop);
        world.adapter.handleTopologySignal();
        // Source-scope previous naming the soon-migrated ws-1.
        world.currentByOutput.set(out1 as CommitOutput, ws9 as CommitDesktop);
        world.adapter.handleTopologySignal();
        assert.deepEqual(world.adapter.previousSnapshot(), { "output-0": "ws-1", "output-1": "ws-2" });
        const committed = world.adapter.commitWorkspaceMigration(
            out1 as CommitOutput,
            out2 as CommitOutput,
            "ws-1",
        );
        assert.deepEqual(committed, { refillId: "ws-9" });
        // Only the source-scope entry is invalidated; the in-scope sibling
        // on the target key survives.
        assert.deepEqual(world.adapter.previousSnapshot(), { "output-1": "ws-2" });
        assert.ok(world.logs.some((line) => line.includes("workspace-previous-invalidated:migrated")));
    });

    it("drops only the migrated id from displaced auto-return, never siblings", () => {
        const world = commitWorld(["out-1", "out-2", "out-3"], ["ws-1", "ws-9", "ws-7", "ws-8"]);
        const [out1, out2, out3] = world.outputs as [CommitOutput, CommitOutput, CommitOutput];
        const [ws1, ws9, ws7, ws8] = world.desktops as [CommitDesktop, CommitDesktop, CommitDesktop, CommitDesktop];
        occupy(world.wins, out1 as CommitOutput, ws1 as CommitDesktop);
        occupy(world.wins, out3 as CommitOutput, ws7 as CommitDesktop);
        occupy(world.wins, out3 as CommitOutput, ws8 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out2 as CommitOutput, ws9 as CommitDesktop);
        world.currentByOutput.set(out3 as CommitOutput, ws7 as CommitDesktop);
        world.adapter.handleTopologySignal();
        // Disconnect the third output: its workspaces displace as a unit.
        world.workspace["screens"] = [out1 as CommitOutput, out2 as CommitOutput];
        world.adapter.handleTopologySignal();
        const displaced = world.adapter.displacedSnapshot();
        const origins = Object.keys(displaced);
        assert.equal(origins.length, 1);
        const only = displaced[origins[0] as string];
        assert.deepEqual([...only?.workspaceIds ?? []].sort(), ["ws-7", "ws-8"]);
        // Migrate one displaced workspace from the survivor elsewhere: only
        // that id leaves the auto-return list.
        const committed = world.adapter.commitWorkspaceMigration(
            out1 as CommitOutput,
            out2 as CommitOutput,
            "ws-7",
        );
        assert.notEqual(committed, null);
        const after = world.adapter.displacedSnapshot();
        const remaining = Object.values(after).flatMap((entry) => [...entry.workspaceIds]);
        assert.deepEqual(remaining, ["ws-8"]);
    });

    it("refuses shared mode, out-of-scope ids, and ambiguous targets", () => {
        const world = commitWorld(["out-1", "out-2"], ["ws-1", "ws-2"]);
        const [out1, out2] = world.outputs as [CommitOutput, CommitOutput];
        assert.equal(world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out1 as CommitOutput, "ws-1"), null);
        assert.equal(world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-x"), null);
        // Target already showing the migrating workspace is a stale scope.
        world.currentByOutput.set(out2 as CommitOutput, world.desktops[0] as CommitDesktop);
        assert.equal(world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-1"), null);
    });

    it("migrates in global-unique mode between assigned scopes", () => {
        const logs: string[] = [];
        const outputs = ["out-1", "out-2"].map((name) => ({
            name,
            manufacturer: "m",
            model: "d",
            serialNumber: `s-${name}`,
        }));
        const desktops = ["ws-1", "ws-2"].map((id, index) => ({ id, x11DesktopNumber: index + 1 }));
        const currentByOutput = new Map([
            [outputs[0] as object, desktops[0] as object],
            [outputs[1] as object, desktops[1] as object],
        ]);
        const workspace: Record<string, unknown> = {
            screens: outputs,
            desktops,
            activeWindow: null,
            activeScreen: outputs[0],
            currentDesktopForScreen: (output: unknown): unknown => currentByOutput.get(output as object) ?? null,
            setCurrentDesktopForScreen: (desktop: unknown, output: unknown): void => {
                currentByOutput.set(output as object, desktop as object);
            },
            windowList: (): unknown[] => [],
        };
        const adapter = new WorkspaceNativeAdapter({
            getWorkspace: () => workspace,
            readWorkspaceMode: () => "global-unique",
            log: (message) => {
                logs.push(message);
            },
        });
        assert.equal(adapter.enable(), true);
        void logs;
        const committed = adapter.commitWorkspaceMigration(
            outputs[0] as unknown as object,
            outputs[1] as unknown as object,
            "ws-1",
        );
        assert.deepEqual(committed, { refillId: "ws-2" });
        assert.deepEqual(adapter.globalSnapshot(), { "output-0": ["ws-2"], "output-1": ["ws-1"] });
    });
});

// ---------- migrate observer ----------

interface ObsOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    geometry: { x: number; y: number; width: number; height: number };
}

interface ObsDesktop {
    id: string;
    x11DesktopNumber: number;
}

interface ObsWindow {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    transient: boolean;
    transientFor: ObsWindow | null;
    output: ObsOutput;
    desktops: ObsDesktop[];
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    minSize: { width: number; height: number } | null;
    maxSize: { width: number; height: number } | null;
}

function obsWorld(opts: {
    outputs?: Array<{ name: string; geometry: { x: number; y: number; width: number; height: number } }>;
    desktops?: string[];
    currents?: Record<string, string>;
    wins?: Array<Partial<ObsWindow> & { internalId: string; desktopIds: string[]; outputName: string; transientForId?: string }>;
    activeId?: string | null;
}): {
    workspace: Record<string, unknown>;
    outputs: ObsOutput[];
    desktops: ObsDesktop[];
    wins: ObsWindow[];
} {
    const outputs: ObsOutput[] = (opts.outputs ?? [
        { name: "out-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } },
        { name: "out-2", geometry: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ]).map((entry, index) => ({
        name: entry.name,
        manufacturer: "m",
        model: "d",
        serialNumber: `s-${String(index)}`,
        geometry: entry.geometry,
    }));
    const outputByName = new Map(outputs.map((output) => [output.name, output]));
    const desktops: ObsDesktop[] = (opts.desktops ?? ["ws-1", "ws-9"]).map((id, index) => ({
        id,
        x11DesktopNumber: index + 1,
    }));
    const desktopById = new Map(desktops.map((desktop) => [desktop.id, desktop]));
    const currents = new Map<string, ObsDesktop>();
    for (const output of outputs) {
        const wanted = opts.currents?.[output.name] ?? desktops[0]?.id ?? "";
        const found = desktopById.get(wanted) ?? desktops[0];
        if (found !== undefined) {
            currents.set(output.name, found);
        }
    }
    const wins: ObsWindow[] = (opts.wins ?? []).map((entry) => {
        const output = outputByName.get(entry.outputName);
        if (output === undefined) {
            throw new Error(`unknown output ${entry.outputName}`);
        }
        const members = entry.desktopIds.map((id) => {
            const found = desktopById.get(id);
            if (found === undefined) {
                throw new Error(`unknown desktop ${id}`);
            }
            return found;
        });
        const { desktopIds: _desktopIds, outputName: _outputName, transientForId: _transientForId, ...overrides } = entry;
        return {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            transient: false,
            transientFor: null,
            frameGeometry: { x: 10, y: 10, width: 400, height: 300 },
            minSize: null,
            maxSize: null,
            ...overrides,
            output,
            desktops: members,
        };
    });
    const winByInternalId = new Map(wins.map((win) => [win.internalId, win]));
    for (const [index, entry] of (opts.wins ?? []).entries()) {
        if (entry.transientForId !== undefined) {
            const win = wins[index] as ObsWindow;
            const parent = winByInternalId.get(entry.transientForId) ?? null;
            (win as { transientFor: ObsWindow | null }).transientFor = parent;
        }
    }
    const active = opts.activeId === undefined || opts.activeId === null
        ? null
        : (wins.find((win) => win.internalId === opts.activeId) ?? null);
    const workspace: Record<string, unknown> = {
        screens: outputs,
        desktops,
        activeWindow: active,
        activeScreen: outputs[0] ?? null,
        currentDesktopForScreen: (output: unknown): unknown => {
            const found = currents.get((output as ObsOutput).name);
            return found ?? null;
        },
        clientArea: (_kind: unknown, output: unknown): unknown => {
            const name = (output as ObsOutput).name;
            return name === "out-1" ? { x: 0, y: 0, w: 1920, h: 1040 } : { x: 1920, y: 0, w: 1920, h: 1040 };
        },
        windowList: (): unknown[] => [...wins],
    };
    return { workspace, outputs, desktops, wins };
}

const OBS_POLICY = { mode: "per-output-local", perOutput: true as boolean | null };

describe("migrate observer", () => {
    it("observes the FULL source view including sticky with focused rules", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-f", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-s", desktopIds: ["ws-1"], outputName: "out-1", onAllDesktops: true },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-a",
        });
        const cache = new Map<string, string>();
        const floating = new Set<string>(["win-f"]);
        const seen = observeMigrateWorkspace(world.workspace, cache, floating, GAPS, "right", OBS_POLICY);
        assert.equal(seen.status, "ready");
        assert.notEqual(seen.observed, null);
        const observed = seen.observed as WorkspaceMigrateObserved;
        assert.equal(observed.direction, "right");
        assert.equal(observed.sourceOutput, "out-1");
        assert.equal(observed.sourceWorkspace, "ws-1");
        assert.equal(observed.targetOutput, "out-2");
        assert.equal(observed.targetWorkspace, "ws-1");
        assert.equal(observed.targetCurrentWorkspace, "ws-9");
        assert.equal(observed.sourceCurrentWorkspace, "ws-1");
        assert.deepEqual(
            observed.sourceWindows.map((entry) => entry.id).sort(),
            ["win-a", "win-f", "win-s"],
        );
        const sticky = observed.sourceWindows.find((entry) => entry.id === "win-s") as WorkspaceMigrateObservedWindow;
        assert.equal(sticky.sticky, true);
        assert.equal(sticky.fitExcluded, true);
        const float = observed.sourceWindows.find((entry) => entry.id === "win-f") as WorkspaceMigrateObservedWindow;
        assert.equal(float.floating, true);
        assert.equal(float.fitExcluded, true);
        assert.deepEqual(
            observed.targetViewWindows.map((entry) => entry.id),
            ["win-t"],
        );
        assert.equal(observed.focusedId, "win-a");
        assert.equal(observed.protectedPresent, false);
        assert.equal(observed.mode, "per-output-local");
        assert.equal(observed.perOutput, true);
        assert.equal(observed.sourceTiled, true);
        assert.deepEqual(observed.relatedWindows, []);
        for (const entry of [...observed.sourceWindows, ...observed.targetViewWindows]) {
            assert.equal(entry.minimized, false);
            assert.equal(entry.transient, false);
            assert.equal(entry.fixedAuto, false);
            assert.equal(entry.fixedSuppress, false);
        }
        assert.equal(observed.desktopCount, 2);
        assert.ok(observed.sourceFingerprint.length > 0);
    });

    it("names the sticky active client and blanks unrelated focus", () => {
        const base = {
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-s", desktopIds: ["ws-1"], outputName: "out-1", onAllDesktops: true },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
        };
        const stickyWorld = obsWorld({ ...base, activeId: "win-s" });
        const stickySeen = observeMigrateWorkspace(stickyWorld.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(stickySeen.status, "ready");
        assert.equal((stickySeen.observed as WorkspaceMigrateObserved).focusedId, "win-s");
        const otherWorld = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-x", desktopIds: ["ws-9"], outputName: "out-1" },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-x",
        });
        const otherSeen = observeMigrateWorkspace(otherWorld.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(otherSeen.status, "ready");
        assert.equal((otherSeen.observed as WorkspaceMigrateObserved).focusedId, "");
        const nullWorld = obsWorld({ ...base, activeId: null });
        const nullSeen = observeMigrateWorkspace(nullWorld.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(nullSeen.status, "ready");
        assert.equal((nullSeen.observed as WorkspaceMigrateObserved).focusedId, "");
    });

    it("no-ops on no candidate and refuses ambiguous or unreadable topology", () => {
        const solo = obsWorld({
            outputs: [{ name: "out-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } }],
            currents: { "out-1": "ws-1" },
            wins: [{ internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" }],
            activeId: "win-a",
        });
        assert.equal(
            observeMigrateWorkspace(solo.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY).status,
            "no-target",
        );
        const ambiguous = obsWorld({
            outputs: [
                { name: "out-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } },
                { name: "out-2", geometry: { x: 1920, y: 0, width: 1920, height: 540 } },
                { name: "out-3", geometry: { x: 1920, y: 540, width: 1920, height: 540 } },
            ],
            desktops: ["ws-1", "ws-2", "ws-3"],
            currents: { "out-1": "ws-1", "out-2": "ws-2", "out-3": "ws-3" },
            wins: [{ internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" }],
            activeId: "win-a",
        });
        assert.equal(
            observeMigrateWorkspace(ambiguous.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY).status,
            "invalid",
        );
        assert.equal(
            observeMigrateWorkspace(solo.workspace, new Map(), new Set(), GAPS, "sideways", OBS_POLICY).status,
            "invalid",
        );
    });

    it("trips the protected tripwire on overlays including minimized views", () => {
        const overlaid = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1", fullScreen: true },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-a",
        });
        const seen = observeMigrateWorkspace(overlaid.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(seen.status, "ready");
        assert.equal((seen.observed as WorkspaceMigrateObserved).protectedPresent, true);
        const maxFloat = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-f", desktopIds: ["ws-1"], outputName: "out-1", maximizeMode: 3 },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-a",
        });
        const maxSeen = observeMigrateWorkspace(maxFloat.workspace, new Map(), new Set(["win-f"]), GAPS, "right", OBS_POLICY);
        assert.equal(maxSeen.status, "ready");
        const maxObserved = maxSeen.observed as WorkspaceMigrateObserved;
        assert.equal(maxObserved.protectedPresent, true);
        const maxEntry = maxObserved.sourceWindows.find((entry) => entry.id === "win-f") as WorkspaceMigrateObservedWindow;
        assert.equal(maxEntry.maximized, true);
        assert.equal(maxEntry.floating, true);
        const minimized = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2", minimized: true, fullScreen: true },
            ],
            activeId: "win-a",
        });
        const minSeen = observeMigrateWorkspace(minimized.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(minSeen.status, "ready");
        const minObserved = minSeen.observed as WorkspaceMigrateObserved;
        assert.equal(minObserved.protectedPresent, true);
        // Minimized members ride carried (native-only): present in the
        // target view with the minimized flag, never skipped.
        assert.ok(!minObserved.sourceWindows.some((entry) => entry.id === "win-t"));
        const minEntry = minObserved.targetViewWindows.find((entry) => entry.id === "win-t") as WorkspaceMigrateObservedWindow;
        assert.equal(minEntry.minimized, true);
        assert.equal(minEntry.fullscreen, true);
    });

    it("fails closed on pinned drift and target-visible scopes", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-a",
        });
        const cache = new Map<string, string>();
        assert.equal(
            observeMigrateWorkspace(world.workspace, cache, new Set(), GAPS, "right", OBS_POLICY, undefined, {
                sourceOutput: "out-1",
                sourceWorkspace: "ws-x",
                targetOutput: "out-2",
            }).status,
            "invalid",
        );
        assert.equal(
            observeMigrateWorkspace(world.workspace, cache, new Set(), GAPS, "right", OBS_POLICY, undefined, {
                sourceOutput: "out-1",
                sourceWorkspace: "ws-1",
                targetOutput: "out-9",
            }).status,
            "invalid",
        );
        const visible = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-1" },
            desktops: ["ws-1"],
            wins: [{ internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" }],
            activeId: "win-a",
        });
        assert.equal(
            observeMigrateWorkspace(visible.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY).status,
            "invalid",
        );
    });
});

describe("migrate observer origins and phases", () => {
    it("carries minimized members natively with origin and hint decoration", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                {
                    internalId: "win-m",
                    desktopIds: ["ws-1"],
                    outputName: "out-1",
                    minimized: true,
                    minSize: { width: 400, height: 300 },
                    maxSize: { width: 400, height: 300 },
                },
                {
                    internalId: "win-n",
                    desktopIds: ["ws-1"],
                    outputName: "out-1",
                    minimized: true,
                },
            ],
            activeId: "win-a",
        });
        const seen = observeMigrateWorkspace(
            world.workspace,
            new Map(),
            new Set(),
            GAPS,
            "right",
            OBS_POLICY,
            undefined,
            undefined,
            {
                originOf: (id) => (id === "win-m" ? { fixedAuto: true, fixedSuppress: false } : null),
            },
        );
        assert.equal(seen.status, "ready");
        const observed = seen.observed as WorkspaceMigrateObserved;
        const min = observed.sourceWindows.find((entry) => entry.id === "win-m") as WorkspaceMigrateObservedWindow;
        assert.equal(min.minimized, true);
        // Automatic floats observe floating (parity); the decoration rides.
        assert.equal(min.floating, true);
        assert.equal(min.fixedAuto, true);
        assert.equal(min.fixedSuppress, false);
        assert.deepEqual(min.minSize, { w: 400, h: 300 });
        assert.deepEqual(min.maxSize, { w: 400, h: 300 });
        // Minimized windows without an origin are never misclassified as
        // intentional floats to fake the wire.
        const plain = observed.sourceWindows.find((entry) => entry.id === "win-n") as WorkspaceMigrateObservedWindow;
        assert.equal(plain.minimized, true);
        assert.equal(plain.floating, false);
        assert.equal(plain.fixedAuto, false);
        // Minimized actives never take focus.
        const activeMin = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [{ internalId: "win-m", desktopIds: ["ws-1"], outputName: "out-1", minimized: true }],
            activeId: "win-m",
        });
        const activeSeen = observeMigrateWorkspace(activeMin.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(activeSeen.status, "ready");
        assert.equal((activeSeen.observed as WorkspaceMigrateObserved).focusedId, "");
    });

    it("tracks transient descendants as related without explicit carriage", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                {
                    internalId: "win-d",
                    desktopIds: ["ws-1"],
                    outputName: "out-1",
                    normalWindow: false,
                    transient: true,
                    transientForId: "win-a",
                },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-a",
        });
        const seen = observeMigrateWorkspace(world.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(seen.status, "ready");
        const observed = seen.observed as WorkspaceMigrateObserved;
        assert.ok(!observed.sourceWindows.some((entry) => entry.id === "win-d"));
        const related = observed.relatedWindows.find((entry) => entry.id === "win-d");
        assert.notEqual(related, undefined);
        assert.equal(related?.parentId, "win-a");
        assert.equal(related?.transient, true);
        assert.equal(observed.protectedPresent, false);
    });

    it("gates protected non-normal clients and stops on transient gaps", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                {
                    internalId: "win-d",
                    desktopIds: ["ws-1"],
                    outputName: "out-1",
                    normalWindow: false,
                    fullScreen: true,
                    transient: true,
                    transientForId: "win-a",
                },
            ],
            activeId: "win-a",
        });
        const seen = observeMigrateWorkspace(world.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(seen.status, "ready");
        assert.equal((seen.observed as WorkspaceMigrateObserved).protectedPresent, true);
        // Transient claims without a readable parent stop with the exact gap.
        const gapped = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [{ internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1", transient: true }],
            activeId: "win-a",
        });
        const gappedWorld = gapped;
        const gappedWin = gappedWorld.wins.find((win) => win.internalId === "win-a") as unknown as Record<string, unknown>;
        gappedWin["transientFor"] = 42;
        const gappedSeen = observeMigrateWorkspace(gappedWorld.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(gappedSeen.status, "invalid");
        assert.equal((gappedSeen as { reason?: string }).reason, "transient-unknown");
    });

    it("resolves empty sources through activeScreen and verifies phases", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: null,
        });
        // No active window: the live activeScreen (out-1 here) sources the
        // observation instead of the first screen.
        (world.workspace as Record<string, unknown>)["activeScreen"] = world.outputs[0];
        const seen = observeMigrateWorkspace(world.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(seen.status, "ready");
        assert.equal((seen.observed as WorkspaceMigrateObserved).sourceOutput, "out-1");
        assert.equal((seen.observed as WorkspaceMigrateObserved).focusedId, "");
        // Unreadable activeScreen fails closed.
        (world.workspace as Record<string, unknown>)["activeScreen"] = null;
        const missing = observeMigrateWorkspace(world.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY);
        assert.equal(missing.status, "invalid");
        // Phase-aware re-observation names the flight's own views.
        (world.workspace as Record<string, unknown>)["activeScreen"] = world.outputs[0];
        const phased = observeMigrateWorkspace(world.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY, undefined, {
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            targetOutput: "out-2",
            expectViews: { source: "ws-9", target: "ws-1" },
        });
        // Live views still show the pre-write state: phase mismatch refuses.
        assert.equal(phased.status, "invalid");
    });
});

// ---------- migrate adapter offline ----------

describe("migrate observer pins", () => {
    it("fails closed on pinned drift and target-visible scopes", () => {
        const world = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-9" },
            wins: [
                { internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" },
                { internalId: "win-t", desktopIds: ["ws-9"], outputName: "out-2" },
            ],
            activeId: "win-a",
        });
        const cache = new Map<string, string>();
        assert.equal(
            observeMigrateWorkspace(world.workspace, cache, new Set(), GAPS, "right", OBS_POLICY, undefined, {
                sourceOutput: "out-1",
                sourceWorkspace: "ws-x",
                targetOutput: "out-2",
            }).status,
            "invalid",
        );
        assert.equal(
            observeMigrateWorkspace(world.workspace, cache, new Set(), GAPS, "right", OBS_POLICY, undefined, {
                sourceOutput: "out-1",
                sourceWorkspace: "ws-1",
                targetOutput: "out-9",
            }).status,
            "invalid",
        );
        const visible = obsWorld({
            currents: { "out-1": "ws-1", "out-2": "ws-1" },
            desktops: ["ws-1"],
            wins: [{ internalId: "win-a", desktopIds: ["ws-1"], outputName: "out-1" }],
            activeId: "win-a",
        });
        assert.equal(
            observeMigrateWorkspace(visible.workspace, new Map(), new Set(), GAPS, "right", OBS_POLICY).status,
            "invalid",
        );
    });
});

interface AMWin {
    readonly id: string;
    readonly ref: object;
    output: string;
    workspace: string;
    rect: { x: number; y: number; w: number; h: number };
    floating: boolean;
    sticky: boolean;
    fullscreen: boolean;
    maximized: boolean;
    minimized: boolean;
    alive: boolean;
    transient: boolean;
    transientFor: string | null;
    fixedAuto: boolean;
    fixedSuppress: boolean;
    minSize: { w: number; h: number } | null;
    maxSize: { w: number; h: number } | null;
}

interface AWorld {
    wins: AMWin[];
    byRef: Map<object, AMWin>;
    outputRefs: Map<string, object>;
    desktopRef: object;
    activeId: string | null;
    activeOutput: string | null;
    views: Map<string, string>;
    mode: string;
    perOutput: boolean | null;
    sourceTiled: boolean;
    policyTiled: boolean | null;
    modeReadError: boolean;
    desktops: string[];
    holdTransfer: boolean;
    failTransfer: Set<string>;
    failGeometry: Set<string>;
    dieOnTransfer: Set<string>;
    rotateOutputRef: boolean;
    rotateDesktopRef: boolean;
    outputResolves: number;
    taintTargetViewOnTransfer: boolean;
    taintMemberOnTransfer: string | null;
    taintOnViewSwitch: string | null;
    taintOnSourceSwitch: string | null;
    sendBackOnSourceSwitch: string | null;
    killTargetOnSourceSwitch: boolean;
    mapRefill: string | null | "refuse" | "throw";
    failViews: Set<string>;
    focusOk: boolean;
    slotOk: boolean;
    mapCalls: Array<{ source: string; target: string; workspace: string }>;
    transfers: string[];
    geometries: Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }>;
    viewSwitches: Array<{ desktop: string; output: string }>;
    focuses: string[];
    slotCalls: string[];
    arrivalHandlers: Array<() => void>;
    settled: WorkspaceSendSettled[];
    logs: string[];
    dbusCalls: Array<{ service: string; method: string; payload: string }>;
    callbacks: Array<(reply: unknown) => void>;
    timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean; fired: boolean }>;
    writes: number;
}

function makeAWorld(): AWorld {
    const outputRefs = new Map<string, object>([
        ["out-1", {}],
        ["out-2", {}],
    ]);
    const mk = (
        id: string,
        output: string,
        workspace: string,
        flags: Partial<Pick<AMWin, "floating" | "sticky" | "fullscreen" | "maximized" | "minimized" | "transient" | "transientFor" | "fixedAuto" | "fixedSuppress" | "minSize" | "maxSize">> = {},
    ): AMWin => ({
        id,
        ref: {},
        output,
        workspace,
        rect: { x: 10, y: 10, w: 400, h: 300 },
        floating: false,
        sticky: false,
        fullscreen: false,
        maximized: false,
        minimized: false,
        alive: true,
        transient: false,
        transientFor: null,
        fixedAuto: false,
        fixedSuppress: false,
        minSize: null,
        maxSize: null,
        ...flags,
    });
    // Source view: two tiled members, one float, one sticky. Target view:
    // one unrelated window on the target current workspace.
    const wins = [
        mk("win-a", "out-1", "ws-1"),
        mk("win-b", "out-1", "ws-1"),
        mk("win-f", "out-1", "ws-1", { floating: true }),
        mk("win-s", "out-1", "ws-1", { sticky: true }),
        mk("win-t", "out-2", "ws-9"),
    ];
    return {
        wins,
        byRef: new Map(wins.map((win) => [win.ref, win])),
        outputRefs,
        desktopRef: {},
        activeId: "win-a",
        activeOutput: "out-2",
        views: new Map([
            ["out-1", "ws-1"],
            ["out-2", "ws-9"],
        ]),
        mode: "per-output-local",
        perOutput: true,
        sourceTiled: true,
        policyTiled: null,
        modeReadError: false,
        desktops: ["ws-1", "ws-9"],
        holdTransfer: false,
        failTransfer: new Set(),
        failGeometry: new Set(),
        dieOnTransfer: new Set(),
        rotateOutputRef: false,
        rotateDesktopRef: false,
        outputResolves: 0,
        taintTargetViewOnTransfer: false,
        taintMemberOnTransfer: null,
        taintOnViewSwitch: null,
        taintOnSourceSwitch: null,
        sendBackOnSourceSwitch: null,
        killTargetOnSourceSwitch: false,
        mapRefill: "ws-2",
        failViews: new Set(),
        focusOk: true,
        slotOk: true,
        mapCalls: [],
        transfers: [],
        geometries: [],
        viewSwitches: [],
        focuses: [],
        slotCalls: [],
        arrivalHandlers: [],
        settled: [],
        logs: [],
        dbusCalls: [],
        callbacks: [],
        timers: [],
        writes: 0,
    };
}

function fingerprintOf(ids: string[]): string {
    return `fp-${ids.sort().join(",")}`;
}

function mockMigrateEnv(world: AWorld): WorkspaceSendAdapterEnv {
    const winByRef = (ref: object): AMWin | null => {
        const found = world.byRef.get(ref) ?? null;
        return found !== null && found.alive ? found : null;
    };
    return {
        callDbus: (service, _path, _iface, method, payload, callback) => {
            if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                callback(true);
                return;
            }
            world.dbusCalls.push({ service, method, payload });
            world.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback) => {
            const timer = { delayMs, callback, cancelled: false, fired: false };
            world.timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        log: (message) => {
            world.logs.push(message);
        },
        observe: () => null,
        observeMigrate: (direction, pinned) => {
            if (direction !== "right") {
                return null;
            }
            const src = "out-1";
            const tgt = "out-2";
            const ws = "ws-1";
            const tgtCur = "ws-9";
            if (pinned !== undefined) {
                if (pinned.sourceOutput !== src || pinned.sourceWorkspace !== ws || pinned.targetOutput !== tgt) {
                    return null;
                }
            }
            // expectViews phase: the live views must name the frozen pair.
            const expectViews = pinned?.expectViews;
            if (expectViews !== undefined) {
                if (world.views.get(src) !== expectViews.source || world.views.get(tgt) !== expectViews.target) {
                    return null;
                }
            }
            if (world.rotateDesktopRef) {
                world.desktopRef = {};
            }
            const wire = (win: AMWin): WorkspaceMigrateObservedWindow => {
                // Automatic floats observe floating (ordinary observation
                // parity); tile overrides stay tiled.
                const floating = win.floating || win.sticky || win.fixedAuto;
                return Object.freeze({
                    id: win.id,
                    ref: win.ref,
                    rect: Object.freeze({ ...win.rect }),
                    output: win.output,
                    floating,
                    sticky: win.sticky,
                    fullscreen: win.fullscreen,
                    maximized: win.maximized,
                    fitExcluded: floating || win.sticky || win.fullscreen || win.maximized,
                    minimized: win.minimized,
                    transient: win.transient,
                    fixedAuto: win.fixedAuto,
                    fixedSuppress: win.fixedSuppress,
                    ...(win.minSize === null ? {} : { minSize: Object.freeze({ ...win.minSize }) }),
                    ...(win.maxSize === null ? {} : { maxSize: Object.freeze({ ...win.maxSize }) }),
                });
            };
            // Carried members: migrating desktop on either output (pinned
            // post-transfer) plus source sticky. Minimized members ride
            // natively (no wire, no geometry, no focus).
            const carried = world.wins.filter(
                (win) => win.alive && (win.workspace === ws || (win.sticky && win.output === src)),
            );
            const carriedIds = new Set(carried.map((win) => win.id));
            // Transient partition: non-sticky transients linked to a
            // carried member move implicitly (related, never wired).
            const byId = new Map(carried.map((win) => [win.id, win] as const));
            const resolveParent = (win: AMWin): string | null => {
                let current: string | null = win.transientFor;
                const seenChain = new Set<string>([win.id]);
                for (let hop = 0; hop < 8 && current !== null; hop += 1) {
                    if (carriedIds.has(current) && !seenChain.has(current)) {
                        return current;
                    }
                    if (seenChain.has(current)) {
                        return null;
                    }
                    seenChain.add(current);
                    current = byId.get(current)?.transientFor ?? null;
                }
                return null;
            };
            const relatedIds = new Set<string>();
            for (const win of carried) {
                if (win.sticky || !win.transient) {
                    continue;
                }
                const parent = resolveParent(win);
                if (parent !== null && parent !== win.id) {
                    relatedIds.add(win.id);
                }
            }
            const sourceWindows = carried.filter((win) => !relatedIds.has(win.id)).map(wire);
            const targetViewWindows = world.wins
                .filter(
                    (win) =>
                        win.alive &&
                        win.output === tgt &&
                        (win.workspace === tgtCur || win.sticky),
                )
                .map(wire);
            const collectedIds = new Set([
                ...sourceWindows.map((entry) => entry.id),
                ...targetViewWindows.map((entry) => entry.id),
            ]);
            const related = [
                ...carried.filter((win) => relatedIds.has(win.id)),
                ...world.wins.filter(
                    (win) =>
                        win.alive &&
                        !collectedIds.has(win.id) &&
                        !relatedIds.has(win.id) &&
                        win.output === tgt &&
                        (win.workspace === tgtCur || win.sticky || win.transient) &&
                        (win.transient || win.fullscreen || win.maximized),
                ),
            ];
            const relatedWindows = Object.freeze(
                related.map((win) => {
                    const floating = win.floating || win.sticky || win.fixedAuto;
                    const parentId = win.transient ? (resolveParent(win) ?? null) : null;
                    return Object.freeze({
                        id: win.id,
                        ref: win.ref,
                        output: win.output,
                        parentId,
                        transient: win.transient,
                        minimized: win.minimized,
                        floating,
                        sticky: win.sticky,
                        fullscreen: win.fullscreen,
                        maximized: win.maximized,
                        fitExcluded: floating || win.sticky || win.fullscreen || win.maximized,
                    });
                }),
            );
            const overlayOf = (entry: { fullscreen: boolean; maximized: boolean; fitExcluded: boolean; floating: boolean; sticky: boolean }): boolean =>
                entry.fullscreen || entry.maximized || (entry.fitExcluded && !entry.floating && !entry.sticky);
            const protectedPresent =
                sourceWindows.some(overlayOf) || targetViewWindows.some(overlayOf) || relatedWindows.some(overlayOf);
            const focusedEntry = world.activeId !== null ? sourceWindows.find((entry) => entry.id === world.activeId) : undefined;
            const focusedId = focusedEntry !== undefined && !focusedEntry.minimized ? focusedEntry.id : "";
            return {
                direction: "right",
                sourceOutput: src,
                sourceWorkspace: ws,
                sourceBounds: { x: 0, y: 0, w: 1920, h: 1040 },
                targetOutput: tgt,
                targetWorkspace: ws,
                targetBounds: { x: 1920, y: 0, w: 1920, h: 1040 },
                targetCurrentWorkspace: world.views.get(tgt) ?? "",
                sourceCurrentWorkspace: world.views.get(src) ?? "",
                focusedId,
                activeRef: null,
                sourceWindows: Object.freeze(sourceWindows),
                targetViewWindows: Object.freeze(targetViewWindows),
                relatedWindows,
                migratedDesktopRef: world.desktopRef,
                mode: world.mode,
                perOutput: world.perOutput,
                sourceTiled: world.policyTiled ?? world.sourceTiled,
                desktopCount: world.desktops.length,
                protectedPresent,
                sourceFingerprint: fingerprintOf([
                    ...sourceWindows.map((entry) => entry.id),
                    ...relatedWindows.map((entry) => entry.id),
                ]),
                targetViewFingerprint: fingerprintOf(targetViewWindows.map((entry) => entry.id)),
            };
        },
        onSettled: (settled) => {
            world.settled.push(settled);
        },
        setGeometry: (target, rect) => {
            const win = winByRef(target);
            if (win === null) {
                return false;
            }
            if (world.failGeometry.has(win.id)) {
                return false;
            }
            world.writes += 1;
            world.geometries.push({ id: win.id, rect: { ...rect } });
            win.rect = { ...rect };
            return true;
        },
        setDesktops: () => false,
        isDomainTiled: () => {
            if (world.modeReadError) {
                throw new Error("mode boom");
            }
            return world.sourceTiled;
        },
        resolveOutput: (name) => {
            const resolved = world.outputRefs.get(name) ?? null;
            if (resolved !== null && world.rotateOutputRef) {
                world.outputResolves += 1;
                // Dispatch plus the first transfer resolve stable; later
                // resolutions hand back a replaced same-id object.
                if (world.outputResolves > 2) {
                    return {};
                }
            }
            return resolved;
        },
        sendClientToScreen: (mover, output) => {
            const win = winByRef(mover);
            if (win === null) {
                return false;
            }
            if (world.failTransfer.has(win.id)) {
                return false;
            }
            world.writes += 1;
            world.transfers.push(win.id);
            if (world.dieOnTransfer.has(win.id)) {
                win.alive = false;
                return true;
            }
            if (world.holdTransfer) {
                return true;
            }
            for (const [name, ref] of world.outputRefs) {
                if (ref === output) {
                    win.output = name;
                    break;
                }
            }
            // KWin moves transient descendants implicitly with the parent:
            // no explicit setter ever targets them.
            for (const child of world.wins) {
                if (child.alive && child.transientFor === win.id && !child.sticky) {
                    child.output = win.output;
                }
            }
            if (world.taintTargetViewOnTransfer) {
                const target = world.wins.find((entry) => entry.id === "win-t");
                if (target !== undefined) {
                    target.fullscreen = true;
                }
                world.taintTargetViewOnTransfer = false;
            }
            if (world.taintMemberOnTransfer !== null) {
                const victim = world.wins.find((entry) => entry.id === world.taintMemberOnTransfer);
                if (victim !== undefined) {
                    victim.maximized = true;
                }
                world.taintMemberOnTransfer = null;
            }
            return true;
        },
        readOutputName: (ref) => winByRef(ref)?.output ?? null,
        readDesktopIds: (ref) => {
            const win = winByRef(ref);
            return win === null ? null : Object.freeze([win.workspace]);
        },
        readMoverLive: (ref) => {
            const win = winByRef(ref);
            if (win === null) {
                return null;
            }
            return {
                id: win.id,
                floating: win.floating || win.sticky,
                sticky: win.sticky,
                fullscreen: win.fullscreen,
                maximized: win.maximized,
            };
        },
        subscribeMoverDesktops: (mover, handler) => {
            void mover;
            world.arrivalHandlers.push(handler);
            let detached = false;
            return () => {
                detached = true;
                void detached;
            };
        },
        subscribeMoverOutput: (mover, handler) => {
            void mover;
            world.arrivalHandlers.push(() => handler(null));
            let detached = false;
            return () => {
                detached = true;
                void detached;
            };
        },
        commitWorkspaceMap: (sourceOutput, targetOutput, workspaceId) => {
            world.mapCalls.push({ source: sourceOutput, target: targetOutput, workspace: workspaceId });
            if (world.mapRefill === "refuse" || world.mapRefill === "throw") {
                if (world.mapRefill === "throw") {
                    throw new Error("map boom");
                }
                return null;
            }
            return { refillId: world.mapRefill };
        },
        switchMigrateView: (desktopId, outputName) => {
            if (world.failViews.has(`${outputName}:${desktopId}`)) {
                return false;
            }
            world.viewSwitches.push({ desktop: desktopId, output: outputName });
            world.views.set(outputName, desktopId);
            // Taint seams for phase-fence tests: target-switch taints land
            // before the intermediate hold (no second setter), source-switch
            // taints land after the target view stands. Victims: maximize a
            // member, or relocate one to a third output.
            const taintId = outputName === "out-2" ? world.taintOnViewSwitch : world.taintOnSourceSwitch;
            if (taintId !== null) {
                const victim = world.wins.find((entry) => entry.id === taintId);
                if (victim !== undefined) {
                    victim.maximized = true;
                }
                if (outputName === "out-2") {
                    world.taintOnViewSwitch = null;
                } else {
                    world.taintOnSourceSwitch = null;
                }
            }
            if (outputName === "out-1" && world.sendBackOnSourceSwitch !== null) {
                const victim = world.wins.find((entry) => entry.id === world.sendBackOnSourceSwitch);
                if (victim !== undefined) {
                    victim.output = "out-1";
                }
                world.sendBackOnSourceSwitch = null;
            }
            if (outputName === "out-1" && world.killTargetOnSourceSwitch) {
                const target = world.wins.find((entry) => entry.id === "win-t");
                if (target !== undefined) {
                    target.alive = false;
                }
                world.killTargetOnSourceSwitch = false;
            }
            return true;
        },
        readActiveOutput: () => world.activeOutput,
        switchActiveOutput: (direction) => {
            world.slotCalls.push(direction);
            if (!world.slotOk) {
                return false;
            }
            world.activeOutput = "out-2";
            return true;
        },
        focusWindow: (windowRef) => {
            const win = winByRef(windowRef);
            if (win === null) {
                return false;
            }
            world.focuses.push(win.id);
            return world.focusOk;
        },
    };
}

function migrateBody(direction: string): Record<string, unknown> {
    return { op: "migrate-workspace", direction };
}

interface MigrateReplyOpts {
    readonly active?: string | null;
    readonly focusLeaf?: string | null;
    readonly members?: number;
    readonly floats?: number;
    readonly geometry?: Array<{ window: string; leaf: string }>;
    readonly direction?: string;
    readonly kind?: string;
    readonly preconditions?: string[];
    readonly detailExtra?: Record<string, unknown>;
    readonly operationExtra?: Record<string, unknown>;
}

function migratePlannedReply(correlation: string, opts: MigrateReplyOpts = {}): string {
    const geometry = (opts.geometry ?? [
        { window: "win-a", leaf: "leaf-a" },
        { window: "win-b", leaf: "leaf-b" },
    ]).map((entry) => ({
        window: entry.window,
        leaf: entry.leaf,
        output: "out-2",
        workspace: "ws-1",
        rect: { x: 1920, y: 0, w: 960, h: 1040 },
    }));
    const active = opts.active === undefined ? "win-a" : opts.active;
    const focusLeaf = opts.focusLeaf === undefined ? "leaf-a" : opts.focusLeaf;
    return JSON.stringify({
        v: WORKSPACE_SEND_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        kind: opts.kind ?? "migrate-workspace",
        base_revision: 3,
        detail: {
            kind: "migrate-workspace",
            policy_version: 1,
            capability: "migrate-workspace",
            commit: "retained-rekey-planned",
            direction: opts.direction ?? "right",
            source_output: "out-1",
            source_workspace: "ws-1",
            target_output: "out-2",
            target_workspace: "ws-1",
            active_window: active,
            members: opts.members ?? 3,
            floats: opts.floats ?? 1,
            ...(opts.detailExtra ?? {}),
        },
        desired_geometry: geometry,
        desired_focus:
            focusLeaf === null
                ? null
                : { domain_output: "out-2", domain_workspace: "ws-1", leaf: focusLeaf },
        preconditions: opts.preconditions ?? [
            "window-observed",
            "desired-topology-valid",
            "adapter-must-verify-postconditions",
        ],
        operation: {
            op: "migrate-workspace",
            direction: opts.direction ?? "right",
            source_output: "out-1",
            source_workspace: "ws-1",
            target_output: "out-2",
            target_workspace: "ws-1",
            active_window: active,
            ...(opts.operationExtra ?? {}),
        },
    });
}

function migrateRejectedReply(correlation: string, kind: string): string {
    return JSON.stringify({
        v: WORKSPACE_SEND_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "rejected",
        kind,
    });
}

// Drive dispatch through owner pinning and return the request correlation.
function dispatchMigrate(world: AWorld, adapter: WorkspaceSendAdapter, direction: unknown = "right"): string {
    assert.equal(adapter.requestMigrateWorkspace(direction), true);
    assert.deepEqual(adapter.pendingWorkspaces, ["ws-1"]);
    const ownerCall = world.dbusCalls[0];
    assert.equal(ownerCall?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
    world.callbacks[0]?.(":1.9");
    const requestCall = world.dbusCalls[1];
    assert.equal(requestCall?.service, ":1.9");
    assert.equal(requestCall?.method, WORKSPACE_SEND_METHOD);
    const body = JSON.parse(requestCall?.payload ?? "{}") as Record<string, unknown>;
    const correlation = body["correlation_id"] as string;
    assert.ok(correlation.length > 0);
    return correlation;
}

function answerMigrate(world: AWorld, index: number, reply: string): void {
    world.callbacks[index]?.(reply);
}

function assertMigrateRedacted(world: AWorld): void {
    for (const line of world.logs) {
        assert.ok(line.startsWith("plasma-auto-tiler:route-diag component=workspace-migrate "), line);
        for (const raw of ["win-a", "win-b", "win-f", "win-s", "win-t", "win-m", "win-x", "win-d", "win-new", "win-ghost", "ws-1", "ws-2", "ws-9", "out-1", "out-2", ":1.9"]) {
            assert.ok(!line.includes(raw), `${raw} leaked in:\n${line}`);
        }
    }
}

function startMigrateAdapter(world: AWorld): WorkspaceSendAdapter {
    const adapter = new WorkspaceSendAdapter(mockMigrateEnv(world));
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

describe("migrate adapter dispatch", () => {
    it("builds the stable wire request over the FULL source view", () => {
        const world = makeAWorld();
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        const body = JSON.parse(world.dbusCalls[1]?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(body["v"], 1);
        assert.equal(body["correlation_id"], correlation);
        assert.equal(body["owner"], "owner-1");
        assert.equal(body["generation"], "gen-1");
        assert.equal(body["revision"], 0);
        assert.deepEqual(body["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: { x: 0, y: 0, w: 1920, h: 1040 },
            gap: 8,
            outer_gap: 8,
        });
        assert.deepEqual(body["target_domain"], {
            output: "out-2",
            workspace: "ws-1",
            bounds: { x: 1920, y: 0, w: 1920, h: 1040 },
            gap: 8,
            outer_gap: 8,
        });
        assert.deepEqual(body["target_windows"], []);
        assert.deepEqual(body["command"], migrateBody("right"));
        assert.equal(body["focused_window"], "win-a");
        const windows = body["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            windows.map((entry) => entry["window"]).sort(),
            ["win-a", "win-b", "win-f", "win-s"],
        );
        const sticky = windows.find((entry) => entry["window"] === "win-s") as Record<string, unknown>;
        assert.equal(sticky["sticky"], true);
        assert.equal(sticky["fit_excluded"], true);
        const float = windows.find((entry) => entry["window"] === "win-f") as Record<string, unknown>;
        assert.equal(float["floating"], true);
        assert.equal(float["fit_excluded"], true);
        for (const entry of windows) {
            assert.equal(typeof entry["maximized"], "boolean");
            assert.equal(typeof entry["fullscreen"], "boolean");
        }
        assert.equal(adapter.isInFlight, true);
    });

    it("refuses pre-flight tokens with exact reasons and no flight", () => {
        const cases: Array<{ name: string; mutate: (world: AWorld) => void; token: string; direction?: unknown }> = [
            { name: "direction", mutate: () => {}, token: "direction-invalid", direction: "sideways" },
            { name: "shared", mutate: (world) => { world.mode = "shared"; }, token: "mode-shared" },
            { name: "mode", mutate: (world) => { world.mode = "bogus"; }, token: "mode-invalid" },
            { name: "per-output-false", mutate: (world) => { world.perOutput = false; }, token: "per-output-disabled" },
            { name: "per-output-null", mutate: (world) => { world.perOutput = null; }, token: "per-output-unreadable" },
            {
                name: "overlay-source",
                mutate: (world) => { (world.wins.find((win) => win.id === "win-a") as AMWin).fullscreen = true; },
                token: "overlay-present",
            },
            {
                name: "overlay-target",
                mutate: (world) => { (world.wins.find((win) => win.id === "win-t") as AMWin).maximized = true; },
                token: "overlay-present",
            },
            {
                name: "overlay-maxfloat",
                mutate: (world) => {
                    const win = world.wins.find((entry) => entry.id === "win-f") as AMWin;
                    win.maximized = true;
                },
                token: "overlay-present",
            },
            {
                name: "overlay-minimized",
                mutate: (world) => {
                    const win = world.wins.find((entry) => entry.id === "win-t") as AMWin;
                    win.minimized = true;
                    win.fullscreen = true;
                },
                token: "overlay-present",
            },
        ];
        for (const testCase of cases) {
            const world = makeAWorld();
            testCase.mutate(world);
            const adapter = startMigrateAdapter(world);
            assert.equal(adapter.requestMigrateWorkspace(testCase.direction ?? "right"), false, testCase.name);
            assert.ok(
                world.logs.some((line) => line.includes("event=refuse") && line.includes(`outcome=${testCase.token}`)),
                `${testCase.name}:\n${world.logs.join("\n")}`,
            );
            assert.equal(adapter.isInFlight, false, testCase.name);
            assert.deepEqual(adapter.pendingWorkspaces, [], testCase.name);
            assert.equal(world.settled.length, 0, testCase.name);
            assert.equal(world.writes, 0, testCase.name);
        }
    });

    it("refuses dangling focus, missing hooks, and busy flights", () => {
        const dangling = makeAWorld();
        dangling.activeId = "win-t";
        const danglingAdapter = startMigrateAdapter(dangling);
        // win-t is not in the source view, so the observer blanks focus;
        // force a dangling focus by pointing at a source outsider instead.
        dangling.activeId = "win-a";
        assert.equal(danglingAdapter.requestMigrateWorkspace("right"), true);
        assert.equal(danglingAdapter.isInFlight, true);
        assert.equal(danglingAdapter.requestMigrateWorkspace("right"), false);
        assert.ok(dangling.logs.some((line) => line.includes("outcome=in-flight")));
        const noHooks = makeAWorld();
        const bare = new WorkspaceSendAdapter({
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            observe: () => null,
            setGeometry: () => false,
            setDesktops: () => false,
        });
        assert.equal(bare.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(bare.requestMigrateWorkspace("right"), false);
        void noHooks;
    });

    it("refuses a dangling focused id that is not carried", () => {
        const world = makeAWorld();
        const env = mockMigrateEnv(world);
        const hookedEnv: WorkspaceSendAdapterEnv = {
            ...env,
            observeMigrate: (direction, pinned) => {
                const seen = env.observeMigrate?.(direction, pinned) ?? null;
                if (seen === null) {
                    return null;
                }
                return { ...seen, focusedId: "win-ghost" };
            },
        };
        const adapter = new WorkspaceSendAdapter(hookedEnv);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestMigrateWorkspace("right"), false);
        assert.ok(world.logs.some((line) => line.includes("outcome=focus-mismatch")));
        assert.equal(adapter.isInFlight, false);
    });
});

describe("migrate adapter commit", () => {
    it("transfers members, writes planned geometry, switches views, and retains the active client", () => {
        const world = makeAWorld();
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // Tiled members transfer in planned geometry order, then the float;
        // sticky never transfers.
        assert.deepEqual(world.transfers, ["win-a", "win-b", "win-f"]);
        assert.ok(!world.transfers.includes("win-s"));
        // Planned geometry covers tiled members only.
        assert.deepEqual(
            world.geometries.map((entry) => entry.id).sort(),
            ["win-a", "win-b"],
        );
        // Views: target shows the migrated workspace, source the refill.
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.equal(world.views.get("out-2"), "ws-1");
        assert.equal(world.views.get("out-1"), "ws-2");
        // Active tiled client retained after verified arrival and views.
        assert.deepEqual(world.focuses, ["win-a"]);
        // Session map committed once with the backing id.
        assert.deepEqual(world.mapCalls, [{ source: "out-1", target: "out-2", workspace: "ws-1" }]);
        assert.equal(world.settled.length, 1);
        assert.deepEqual(world.settled[0], {
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            targetOutput: "out-2",
            targetWorkspace: "ws-1",
        });
        assert.equal(adapter.isInFlight, false);
        assert.deepEqual(adapter.pendingWorkspaces, []);
        assert.ok(world.logs.some((line) => line.includes("event=arrival") && line.includes("outcome=arrived")));
        assert.ok(
            world.logs.some((line) => line.includes("stage=follow") && line.includes("outcome=state-confirmed")),
        );
        assertMigrateRedacted(world);
    });

    it("retains a float active client with null focus and runs zero focus writes without one", () => {
        const floatWorld = makeAWorld();
        floatWorld.activeId = "win-f";
        const floatAdapter = startMigrateAdapter(floatWorld);
        const floatCorrelation = dispatchMigrate(floatWorld, floatAdapter);
        answerMigrate(floatWorld, 1, migratePlannedReply(floatCorrelation, { active: "win-f", focusLeaf: null }));
        assert.deepEqual(floatWorld.focuses, ["win-f"]);
        assert.deepEqual(floatWorld.transfers, ["win-a", "win-b", "win-f"]);
        assert.equal(floatAdapter.isInFlight, false);

        const stickyWorld = makeAWorld();
        stickyWorld.activeId = "win-s";
        const stickyAdapter = startMigrateAdapter(stickyWorld);
        const stickyCorrelation = dispatchMigrate(stickyWorld, stickyAdapter);
        answerMigrate(stickyWorld, 1, migratePlannedReply(stickyCorrelation, { active: null, focusLeaf: null }));
        // Sticky-active echoes null: zero focus setters, views still switch.
        assert.deepEqual(stickyWorld.focuses, []);
        assert.deepEqual(stickyWorld.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.equal(stickyAdapter.isInFlight, false);

        const emptyWorld = makeAWorld();
        emptyWorld.wins = emptyWorld.wins.filter((win) => win.id === "win-t" || win.id === "win-s");
        emptyWorld.byRef = new Map(emptyWorld.wins.map((win) => [win.ref, win]));
        emptyWorld.activeId = null;
        const emptyAdapter = startMigrateAdapter(emptyWorld);
        const emptyCorrelation = dispatchMigrate(emptyWorld, emptyAdapter);
        answerMigrate(
            emptyWorld,
            1,
            migratePlannedReply(emptyCorrelation, { active: null, focusLeaf: null, members: 0, floats: 0, geometry: [] }),
        );
        // Empty migration moves no window but still switches views.
        assert.deepEqual(emptyWorld.transfers, []);
        assert.deepEqual(emptyWorld.geometries, []);
        assert.deepEqual(emptyWorld.focuses, []);
        assert.deepEqual(emptyWorld.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.equal(emptyAdapter.isInFlight, false);
        assertMigrateRedacted(emptyWorld);
    });

    it("rejects mismatched plans with zero native writes", () => {
        const cases: Array<{ name: string; reply: (correlation: string) => string; token: string }> = [
            {
                name: "kind",
                reply: (correlation) => migratePlannedReply(correlation, { kind: "send-to-workspace" }),
                token: "precondition-mismatch",
            },
            {
                name: "preconditions",
                reply: (correlation) => migratePlannedReply(correlation, { preconditions: ["window-observed"] }),
                token: "precondition-mismatch",
            },
            {
                name: "direction",
                reply: (correlation) => migratePlannedReply(correlation, { direction: "left" }),
                token: "precondition-mismatch",
            },
            {
                name: "geometry-gap",
                reply: (correlation) =>
                    migratePlannedReply(correlation, { geometry: [{ window: "win-a", leaf: "leaf-a" }] }),
                token: "precondition-mismatch",
            },
            {
                name: "geometry-extra",
                reply: (correlation) =>
                    migratePlannedReply(correlation, {
                        geometry: [
                            { window: "win-a", leaf: "leaf-a" },
                            { window: "win-b", leaf: "leaf-b" },
                            { window: "win-f", leaf: "leaf-f" },
                        ],
                    }),
                token: "precondition-mismatch",
            },
            {
                name: "focus-leaf",
                reply: (correlation) => migratePlannedReply(correlation, { focusLeaf: "leaf-b" }),
                token: "precondition-mismatch",
            },
            {
                name: "focus-without-active",
                reply: (correlation) => migratePlannedReply(correlation, { active: null, focusLeaf: "leaf-a" }),
                token: "precondition-mismatch",
            },
            {
                name: "members",
                reply: (correlation) => migratePlannedReply(correlation, { members: 9 }),
                token: "precondition-mismatch",
            },
            {
                name: "dangling-active",
                reply: (correlation) => migratePlannedReply(correlation, { active: "win-ghost" }),
                token: "precondition-mismatch",
            },
            {
                name: "detail-shape",
                reply: (correlation) => migratePlannedReply(correlation, { detailExtra: { bogus: 1 } }),
                token: "precondition-mismatch",
            },
        ];
        for (const testCase of cases) {
            const world = makeAWorld();
            const adapter = startMigrateAdapter(world);
            const correlation = dispatchMigrate(world, adapter);
            answerMigrate(world, 1, testCase.reply(correlation));
            assert.ok(
                world.logs.some((line) => line.includes(`outcome=${testCase.token}`)),
                `${testCase.name}:\n${world.logs.join("\n")}`,
            );
            assert.equal(world.writes, 0, testCase.name);
            assert.deepEqual(world.mapCalls, [], testCase.name);
            assert.deepEqual(world.viewSwitches, [], testCase.name);
            assert.deepEqual(world.focuses, [], testCase.name);
            assert.equal(world.settled.length, 1, testCase.name);
            assert.equal(adapter.isInFlight, false, testCase.name);
        }
    });

    it("surfaces Engine rejections with zero writes and normal recovery", () => {
        for (const kind of ["overlay-present", "unknown-domain", "unchanged", "focus-mismatch"]) {
            const world = makeAWorld();
            const adapter = startMigrateAdapter(world);
            const correlation = dispatchMigrate(world, adapter);
            answerMigrate(world, 1, migrateRejectedReply(correlation, kind));
            assert.ok(
                world.logs.some((line) => line.includes("stage=release") && line.includes(`outcome=${kind}`)),
                `${kind}:\n${world.logs.join("\n")}`,
            );
            assert.equal(world.writes, 0, kind);
            assert.deepEqual(world.mapCalls, [], kind);
            assert.equal(world.settled.length, 1, kind);
            assert.deepEqual(world.settled[0], {
                sourceOutput: "out-1",
                sourceWorkspace: "ws-1",
                targetOutput: "out-2",
                targetWorkspace: "ws-1",
            });
            assert.equal(adapter.isInFlight, false, kind);
        }
    });

    it("ignores duplicate replies without replaying native writes", () => {
        const world = makeAWorld();
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        const reply = migratePlannedReply(correlation);
        answerMigrate(world, 1, reply);
        const writes = world.writes;
        assert.ok(writes > 0);
        answerMigrate(world, 1, reply);
        assert.equal(world.writes, writes);
        assert.deepEqual(world.focuses, ["win-a"]);
        assert.equal(world.settled.length, 1);
    });

    it("refuses drift between dispatch and reply with zero writes", () => {
        // Extra member arrives after dispatch.
        const extra = makeAWorld();
        const extraAdapter = startMigrateAdapter(extra);
        const extraCorrelation = dispatchMigrate(extra, extraAdapter);
        extra.wins.push({
            id: "win-new",
            ref: {},
            output: "out-1",
            workspace: "ws-1",
            rect: { x: 0, y: 0, w: 10, h: 10 },
            floating: false,
            sticky: false,
            fullscreen: false,
            maximized: false,
            minimized: false,
            alive: true,
            transient: false,
            transientFor: null,
            fixedAuto: false,
            fixedSuppress: false,
            minSize: null,
            maxSize: null,
        });
        extra.byRef.set(extra.wins[extra.wins.length - 1]?.ref as object, extra.wins[extra.wins.length - 1] as AMWin);
        answerMigrate(extra, 1, migratePlannedReply(extraCorrelation));
        assert.ok(extra.logs.some((line) => line.includes("outcome=stale-revision")));
        assert.equal(extra.writes, 0);
        assert.deepEqual(extra.mapCalls, []);

        // Mode drift stales the flight.
        const mode = makeAWorld();
        const modeAdapter = startMigrateAdapter(mode);
        const modeCorrelation = dispatchMigrate(mode, modeAdapter);
        mode.mode = "shared";
        answerMigrate(mode, 1, migratePlannedReply(modeCorrelation));
        assert.ok(mode.logs.some((line) => line.includes("outcome=stale-revision")));
        assert.equal(mode.writes, 0);

        // Target view drift stales the flight.
        const view = makeAWorld();
        const viewAdapter = startMigrateAdapter(view);
        const viewCorrelation = dispatchMigrate(view, viewAdapter);
        view.views.set("out-2", "ws-x");
        answerMigrate(view, 1, migratePlannedReply(viewCorrelation));
        assert.ok(view.logs.some((line) => line.includes("outcome=stale-revision")));
        assert.equal(view.writes, 0);
    });

    it("aborts mid-write removal without further writes or focus", () => {
        const world = makeAWorld();
        world.dieOnTransfer.add("win-b");
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // win-a transferred, win-b died on transfer: no geometry for win-b,
        // no float transfer, no views, no focus.
        assert.deepEqual(world.transfers, ["win-a", "win-b"]);
        assert.ok(!world.transfers.includes("win-f"));
        assert.deepEqual(world.viewSwitches, []);
        assert.deepEqual(world.focuses, []);
        assert.equal(world.settled.length, 1);
        assert.equal(adapter.isInFlight, false);
    });

    it("aborts a failed transfer with recovery and no focus", () => {
        const world = makeAWorld();
        world.failTransfer.add("win-b");
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.transfers, ["win-a"]);
        assert.deepEqual(world.viewSwitches, []);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=write-failed")));
        assert.equal(world.settled.length, 1);
    });

    it("refuses a map-commit failure before any native write", () => {
        const world = makeAWorld();
        world.mapRefill = "refuse";
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.mapCalls.length, 1);
        assert.equal(world.writes, 0);
        assert.deepEqual(world.viewSwitches, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=map-commit-failed")));
        assert.equal(world.settled.length, 1);
    });

    it("skips focus when a view switch is unconfirmed", () => {
        const world = makeAWorld();
        world.failViews.add("out-1:ws-2");
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.viewSwitches, [{ desktop: "ws-1", output: "out-2" }]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=switch-unconfirmed")));
        assert.equal(world.settled.length, 1);
    });

    it("waits for delayed arrival and follows exactly once", () => {
        const world = makeAWorld();
        world.holdTransfer = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // Transfers initiated but nothing placed yet: waiting, no views.
        assert.deepEqual(world.viewSwitches, []);
        assert.deepEqual(world.focuses, []);
        assert.equal(adapter.isInFlight, true);
        assert.ok(world.logs.some((line) => line.includes("outcome=waiting")));
        assert.ok(world.arrivalHandlers.length > 0);
        // Delayed native arrival becomes visible; one signal finishes once.
        world.holdTransfer = false;
        for (const win of world.wins) {
            if (win.id === "win-a" || win.id === "win-b" || win.id === "win-f") {
                win.output = "out-2";
            }
        }
        const handlers = [...world.arrivalHandlers];
        for (const handler of handlers) {
            handler();
        }
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.deepEqual(world.focuses, ["win-a"]);
        assert.equal(world.settled.length, 1);
        assert.equal(adapter.isInFlight, false);
        // A duplicate late signal never replays views or focus.
        for (const handler of handlers) {
            handler();
        }
        assert.equal(world.viewSwitches.length, 2);
        assert.deepEqual(world.focuses, ["win-a"]);
        assert.equal(world.settled.length, 1);
    });

    it("settles the arrival deadline with normal recovery", () => {
        const world = makeAWorld();
        world.holdTransfer = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.equal(adapter.isInFlight, true);
        const timer = world.timers.find((entry) => !entry.cancelled && !entry.fired);
        assert.notEqual(timer, undefined);
        (timer as { callback: () => void }).callback();
        assert.ok(world.logs.some((line) => line.includes("outcome=arrival-timeout")));
        assert.deepEqual(world.focuses, []);
        assert.equal(world.settled.length, 1);
        assert.equal(adapter.isInFlight, false);
    });
});

function addWin(
    world: AWorld,
    id: string,
    output: string,
    workspace: string,
    flags: Partial<Pick<AMWin, "floating" | "sticky" | "fullscreen" | "maximized" | "minimized" | "transient" | "transientFor" | "fixedAuto" | "fixedSuppress" | "minSize" | "maxSize">> = {},
): AMWin {
    const win: AMWin = {
        id,
        ref: {},
        output,
        workspace,
        rect: { x: 10, y: 10, w: 400, h: 300 },
        floating: false,
        sticky: false,
        fullscreen: false,
        maximized: false,
        minimized: false,
        alive: true,
        transient: false,
        transientFor: null,
        fixedAuto: false,
        fixedSuppress: false,
        minSize: null,
        maxSize: null,
        ...flags,
    };
    world.wins.push(win);
    world.byRef.set(win.ref, win);
    return win;
}

describe("migrate minimized and related natives", () => {
    it("transfers minimized members natively with no geometry or focus impact", () => {
        const world = makeAWorld();
        const minFrame = { x: 10, y: 10, w: 400, h: 300 };
        addWin(world, "win-m", "out-1", "ws-1", { minimized: true });
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        // Wire excludes the minimized member; counts stay wire-shaped.
        const body = JSON.parse(world.dbusCalls[1]?.payload ?? "{}") as Record<string, unknown>;
        assert.deepEqual(
            (body["windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"]).sort(),
            ["win-a", "win-b", "win-f", "win-s"],
        );
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.transfers, ["win-a", "win-b", "win-f", "win-m"]);
        assert.deepEqual(
            world.geometries.map((entry) => entry.id).sort(),
            ["win-a", "win-b"],
        );
        const moved = world.wins.find((win) => win.id === "win-m") as AMWin;
        assert.equal(moved.output, "out-2");
        assert.deepEqual(moved.workspace, "ws-1");
        assert.deepEqual(moved.rect, minFrame);
        assert.deepEqual(world.focuses, ["win-a"]);
        assert.equal(world.settled.length, 1);
        assert.ok(world.logs.some((line) => line.includes("outcome=arrived")));
        assertMigrateRedacted(world);
    });

    it("transfers a minimized-only workspace natively on an empty plan", () => {
        const world = makeAWorld();
        world.wins = world.wins.filter((win) => win.id === "win-t");
        world.byRef = new Map(world.wins.map((win) => [win.ref, win]));
        addWin(world, "win-m", "out-1", "ws-1", { minimized: true });
        world.activeId = null;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        const body = JSON.parse(world.dbusCalls[1]?.payload ?? "{}") as Record<string, unknown>;
        assert.deepEqual(body["windows"], []);
        assert.equal(body["focused_window"], "");
        answerMigrate(
            world,
            1,
            migratePlannedReply(correlation, { active: null, focusLeaf: null, members: 0, floats: 0, geometry: [] }),
        );
        // Native membership moves even though the core planned empty.
        assert.deepEqual(world.transfers, ["win-m"]);
        assert.deepEqual(world.geometries, []);
        assert.deepEqual(world.focuses, []);
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("tracks transient descendants implicitly with no explicit setters", () => {
        const world = makeAWorld();
        addWin(world, "win-x", "out-1", "ws-1", { transient: true, transientFor: "win-a" });
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));

        // The transient never takes an explicit transfer or geometry write.
        assert.deepEqual(world.transfers, ["win-a", "win-b", "win-f"]);
        assert.deepEqual(
            world.geometries.map((entry) => entry.id).sort(),
            ["win-a", "win-b"],
        );
        // Implicit arrival follows the live parent output.
        const child = world.wins.find((win) => win.id === "win-x") as AMWin;
        assert.equal(child.output, "out-2");
        assert.deepEqual(world.focuses, ["win-a"]);
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("refuses a fullscreen transient dialog with zero native writes", () => {
        const world = makeAWorld();
        addWin(world, "win-x", "out-1", "ws-1", { transient: true, transientFor: "win-a", fullscreen: true });
        const adapter = startMigrateAdapter(world);
        assert.equal(adapter.requestMigrateWorkspace("right"), false);
        assert.ok(world.logs.some((line) => line.includes("outcome=overlay-present")));
        assert.equal(adapter.isInFlight, false);
        assert.equal(world.writes, 0);
        assert.equal(world.settled.length, 0);
    });
});

describe("migrate tiling mode and origins", () => {
    it("carries floating workspaces membership-only with zero geometry", () => {
        const world = makeAWorld();
        world.sourceTiled = false;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.transfers, ["win-a", "win-b", "win-f"]);
        assert.deepEqual(world.geometries, []);
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.deepEqual(world.focuses, ["win-a"]);
        assert.equal(world.settled.length, 1);
        assert.ok(world.logs.some((line) => line.includes("outcome=arrived")));
        assertMigrateRedacted(world);
    });

    it("stales a mid-flight tiling mode change with zero further writes", () => {
        const world = makeAWorld();
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        world.sourceTiled = false;
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.ok(world.logs.some((line) => line.includes("outcome=stale-revision")));
        assert.equal(world.writes, 0);
        assert.deepEqual(world.mapCalls, []);
        assert.equal(world.settled.length, 1);
    });

    it("refuses mode disagreement and unreadable mode with exact reasons", () => {
        const mismatch = makeAWorld();
        mismatch.policyTiled = false;
        const mismatchAdapter = startMigrateAdapter(mismatch);
        assert.equal(mismatchAdapter.requestMigrateWorkspace("right"), false);
        assert.ok(mismatch.logs.some((line) => line.includes("outcome=mode-mismatch")));
        assert.equal(mismatchAdapter.isInFlight, false);
        const unreadable = makeAWorld();
        unreadable.modeReadError = true;
        const unreadableAdapter = startMigrateAdapter(unreadable);
        assert.equal(unreadableAdapter.requestMigrateWorkspace("right"), false);
        assert.ok(unreadable.logs.some((line) => line.includes("outcome=mode-unreadable")));
        assert.equal(unreadableAdapter.isInFlight, false);
        const noHook = makeAWorld();
        const env = mockMigrateEnv(noHook);
        const { isDomainTiled: _droppedModeHook, ...restEnv } = env;
        void _droppedModeHook;
        const hookless = new WorkspaceSendAdapter(restEnv);
        assert.equal(hookless.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(hookless.requestMigrateWorkspace("right"), false);
        assert.ok(noHook.logs.some((line) => line.includes("outcome=transfer-unavailable")));
    });

    it("carries fixed-size provenance and hints on the wire and fences origin drift", () => {
        const world = makeAWorld();
        const floated = world.wins.find((win) => win.id === "win-f") as AMWin;
        floated.fixedAuto = true;
        floated.minSize = { w: 400, h: 300 };
        floated.maxSize = { w: 400, h: 300 };
        const tiled = world.wins.find((win) => win.id === "win-a") as AMWin;
        tiled.fixedSuppress = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        const body = JSON.parse(world.dbusCalls[1]?.payload ?? "{}") as Record<string, unknown>;
        const windows = body["windows"] as Array<Record<string, unknown>>;
        const floatWire = windows.find((entry) => entry["window"] === "win-f") as Record<string, unknown>;
        assert.equal(floatWire["fixed_auto"], true);
        assert.deepEqual(floatWire["min_size"], { w: 400, h: 300 });
        assert.deepEqual(floatWire["max_size"], { w: 400, h: 300 });
        const tileWire = windows.find((entry) => entry["window"] === "win-a") as Record<string, unknown>;
        assert.equal(tileWire["fixed_suppress"], true);
        assert.equal("fixed_auto" in tileWire, false);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.equal(adapter.isInFlight, false);
        assert.ok(world.logs.some((line) => line.includes("outcome=arrived")));
        // Origin drift between dispatch and reply stales the flight.
        const drifted = makeAWorld();
        const driftAdapter = startMigrateAdapter(drifted);
        const driftCorrelation = dispatchMigrate(drifted, driftAdapter);
        (drifted.wins.find((win) => win.id === "win-f") as AMWin).fixedAuto = true;
        answerMigrate(drifted, 1, migratePlannedReply(driftCorrelation));
        assert.ok(drifted.logs.some((line) => line.includes("outcome=stale-revision")));
        assert.equal(drifted.writes, 0);
    });
});

describe("migrate per-setter fences", () => {
    it("refuses a replaced target output before the second transfer", () => {
        const world = makeAWorld();
        world.rotateOutputRef = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // First member commits; the replaced target object aborts the rest.
        assert.deepEqual(world.transfers, ["win-a"]);
        assert.deepEqual(
            world.geometries.map((entry) => entry.id),
            ["win-a"],
        );
        assert.deepEqual(world.viewSwitches, []);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=write-failed")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("refuses a replaced desktop before any native write", () => {
        const world = makeAWorld();
        world.rotateDesktopRef = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.ok(world.logs.some((line) => line.includes("outcome=stale-revision")));
        assert.equal(world.writes, 0);
        assert.deepEqual(world.viewSwitches, []);
        assert.equal(world.settled.length, 1);
    });

    it("aborts remaining writes on a mid-write target-view overlay", () => {
        const world = makeAWorld();
        world.taintTargetViewOnTransfer = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.transfers, ["win-a"]);
        assert.deepEqual(world.viewSwitches, []);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=write-failed")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("aborts remaining writes on a mid-write member overlay", () => {
        const world = makeAWorld();
        world.taintMemberOnTransfer = "win-b";
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.transfers, ["win-a"]);
        assert.ok(!world.transfers.includes("win-b"));
        assert.deepEqual(world.viewSwitches, []);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=write-failed")));
        assert.equal(world.settled.length, 1);
    });

    it("aborts the second setter on mutation during the target switch", () => {
        const world = makeAWorld();
        world.taintOnViewSwitch = "win-a";
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // The intermediate hold fails: target view stands, source never
        // written, no focus, no completion.
        assert.deepEqual(world.viewSwitches, [{ desktop: "ws-1", output: "out-2" }]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=switch-unconfirmed")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("aborts completion on mutation during the source switch", () => {
        const world = makeAWorld();
        world.taintOnSourceSwitch = "win-a";
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // Both views stand as written, but the post-source proof fails:
        // no focus, no arrived claim.
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=switch-unconfirmed")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("skips focus when a member regresses after the views stand", () => {
        const world = makeAWorld();
        world.sendBackOnSourceSwitch = "win-a";
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=arrival-unconfirmed")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("aborts when the prior target view loses a member mid-write", () => {
        const world = makeAWorld();
        world.killTargetOnSourceSwitch = true;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        assert.deepEqual(world.viewSwitches, [
            { desktop: "ws-1", output: "out-2" },
            { desktop: "ws-2", output: "out-1" },
        ]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=switch-unconfirmed")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });
});

describe("migrate null-active output activation", () => {
    function slotWorldWithActiveOutput(activeOutput: string | null): AWorld {
        const world = makeAWorld();
        world.wins = world.wins.filter((win) => win.id === "win-a" || win.id === "win-t");
        world.byRef = new Map(world.wins.map((win) => [win.ref, win]));
        world.activeId = null;
        world.activeOutput = activeOutput;
        return world;
    }

    function slotReply(correlation: string): string {
        return migratePlannedReply(correlation, {
            active: null,
            focusLeaf: null,
            members: 1,
            floats: 0,
            geometry: [{ window: "win-a", leaf: "leaf-a" }],
        });
    }

    it("skips the slot when the target is already active", () => {
        const world = slotWorldWithActiveOutput("out-2");
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, slotReply(correlation));
        assert.deepEqual(world.slotCalls, []);
        assert.deepEqual(world.focuses, []);
        assert.equal(world.settled.length, 1);
        assert.ok(world.logs.some((line) => line.includes("outcome=arrived")));
        assertMigrateRedacted(world);
    });

    it("invokes the directional slot once from the expected source", () => {
        const world = slotWorldWithActiveOutput("out-1");
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, slotReply(correlation));
        assert.deepEqual(world.slotCalls, ["right"]);
        assert.equal(world.activeOutput, "out-2");
        assert.deepEqual(world.focuses, []);
        assert.equal(world.settled.length, 1);
        assert.ok(world.logs.some((line) => line.includes("outcome=arrived")));
    });

    it("refuses from a wrong source without invoking the slot", () => {
        const world = slotWorldWithActiveOutput("out-3");
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, slotReply(correlation));
        assert.deepEqual(world.slotCalls, []);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=output-unconfirmed")));
        assert.equal(world.settled.length, 1);
    });

    it("reports a slot noop without retry or focus", () => {
        const world = slotWorldWithActiveOutput("out-1");
        world.slotOk = false;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, slotReply(correlation));
        assert.deepEqual(world.slotCalls, ["right"]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=output-unconfirmed")));
        assert.equal(world.settled.length, 1);
    });
});

describe("migrate sole-source refill", () => {
    it("settles source-empty without focus and never claims arrived", () => {
        const world = makeAWorld();
        world.mapRefill = null;
        const adapter = startMigrateAdapter(world);
        const correlation = dispatchMigrate(world, adapter);
        answerMigrate(world, 1, migratePlannedReply(correlation));
        // Target view stands as written; no source write, no focus.
        assert.deepEqual(world.viewSwitches, [{ desktop: "ws-1", output: "out-2" }]);
        assert.deepEqual(world.focuses, []);
        assert.ok(world.logs.some((line) => line.includes("outcome=source-empty")));
        assert.ok(!world.logs.some((line) => line.includes("outcome=arrived")));
        assert.equal(world.settled.length, 1);
        assertMigrateRedacted(world);
    });

    it("refuses repeat migration without mutation", () => {
        const world = commitWorld(["out-1", "out-2"], ["ws-1", "ws-2"]);
        const [out1, out2] = world.outputs as [CommitOutput, CommitOutput];
        const [ws1, ws2] = world.desktops as [CommitDesktop, CommitDesktop];
        occupy(world.wins, out1 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out1 as CommitOutput, ws1 as CommitDesktop);
        world.currentByOutput.set(out2 as CommitOutput, ws2 as CommitDesktop);
        assert.notEqual(
            world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-1"),
            null,
        );
        // The backing id already lives in the target scope: a repeat with
        // the same triple refuses (out of the source scope now) with the
        // mapping byte-identical. The duplicate-target guard additionally
        // refuses without mutation should scopes ever overlap.
        const before = JSON.stringify(world.adapter.localSnapshot());
        world.currentByOutput.set(out2 as CommitOutput, ws1 as CommitDesktop);
        assert.equal(
            world.adapter.commitWorkspaceMigration(out1 as CommitOutput, out2 as CommitOutput, "ws-1"),
            null,
        );
        assert.equal(JSON.stringify(world.adapter.localSnapshot()), before);
    });
});
