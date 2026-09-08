import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    ADVISORY_SNAPSHOT_OUTPUT_ID,
    ADVISORY_SNAPSHOT_REJECTS,
    ADVISORY_SNAPSHOT_ROOT_ID,
    ADVISORY_SNAPSHOT_WINDOW_COUNT,
    ADVISORY_SNAPSHOT_WORKSPACE_ID,
    captureAdvisorySnapshot,
    isAdvisorySnapshotReject,
} from "../src/advisory-snapshot";
import { normalizeAdvisoryRequest } from "../src/advisory-plan-query";

const ADAPTER_SOURCE = readFileSync("src/advisory-snapshot.ts", "utf8");

interface StubWindow {
    [key: string]: unknown;
}

interface StubWorkspace {
    [key: string]: unknown;
}

const OUTPUT_GEOM = { x: 0, y: 0, width: 1920, height: 1080 };
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function stubOutput(): Record<string, unknown> {
    return { geometry: { ...OUTPUT_GEOM } };
}

function stubDesktop(): Record<string, unknown> {
    return { id: "d1" };
}

function stubTile(): Record<string, unknown> {
    return { kind: "tile" };
}

function stubWindow(
    id: string,
    output: object,
    desktop: object,
    overrides: Record<string, unknown> = {},
    frameIndex = 0,
): StubWindow {
    const frames = [
        { x: 10, y: 10, width: 100, height: 100 },
        { x: 200, y: 10, width: 100, height: 100 },
        { x: 400, y: 10, width: 100, height: 100 },
        { x: 600, y: 10, width: 100, height: 100 },
    ];
    return {
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        move: false,
        resize: false,
        tile: stubTile(),
        output,
        desktops: [desktop],
        frameGeometry: { ...(frames[frameIndex % frames.length] as Record<string, number>) },
        internalId: id,
        caption: `caption-${id}-must-not-serialize`,
        ...overrides,
    };
}

function stubWorkspace(windows: StubWindow[], active: StubWindow | null): StubWorkspace {
    const output = (windows[0]?.["output"] as object) ?? stubOutput();
    const firstDesktops = windows[0]?.["desktops"] as unknown[] | undefined;
    const desktop = (Array.isArray(firstDesktops) ? firstDesktops[0] : stubDesktop()) as object;
    return {
        activeWindow: active,
        windowList: (): unknown[] => [...windows],
        screens: [output],
        currentDesktopForScreen: (out: unknown): unknown => (out === output ? desktop : null),
        clientArea: (): unknown => ({ ...WORK_AREA }),
    };
}

function validTrio(): { workspace: StubWorkspace; windows: StubWindow[]; active: StubWindow } {
    const output = stubOutput();
    const desktop = stubDesktop();
    const wa = stubWindow("id-c", output, desktop, {}, 0);
    const wb = stubWindow("id-a", output, desktop, {}, 1);
    const wc = stubWindow("id-b", output, desktop, {}, 2);
    const windows = [wa, wb, wc];
    const workspace = stubWorkspace(windows, wc);
    return { workspace, windows, active: wc };
}

describe("advisory snapshot exact-three and focused normalization", () => {
    it("selects exactly three sorted by opaque id with focused leaf from active", () => {
        const { workspace } = validTrio();
        const result = captureAdvisorySnapshot(workspace as never, "left");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        const snapshot = result.snapshot as Record<string, unknown>;
        const intent = result.intent as Record<string, unknown>;
        const outputs = snapshot["outputs"] as Array<Record<string, unknown>>;
        assert.equal(outputs.length, 1);
        assert.equal(outputs[0]?.["id"], ADVISORY_SNAPSHOT_OUTPUT_ID);
        assert.equal(outputs[0]?.["workspace"], ADVISORY_SNAPSHOT_WORKSPACE_ID);
        const tree = outputs[0]?.["tree"] as Record<string, unknown>;
        assert.equal(tree["kind"], "group");
        assert.equal(tree["axis"], "horizontal");
        assert.equal(tree["id"], ADVISORY_SNAPSHOT_ROOT_ID);
        const children = tree["children"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            children.map((c) => c["id"]),
            ["leaf-id-a", "leaf-id-b", "leaf-id-c"],
        );
        const links = snapshot["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            links.map((l) => l["window"]),
            ["id-a", "id-b", "id-c"],
        );
        assert.deepEqual(
            links.map((l) => l["leaf"]),
            ["leaf-id-a", "leaf-id-b", "leaf-id-c"],
        );
        for (const link of links) {
            assert.equal(link["output"], ADVISORY_SNAPSHOT_OUTPUT_ID);
            assert.equal(link["workspace"], ADVISORY_SNAPSHOT_WORKSPACE_ID);
        }
        assert.equal(intent["focused_window"], "id-b");
        assert.equal(intent["focused_leaf"], "leaf-id-b");
        assert.equal(intent["source_output"], ADVISORY_SNAPSHOT_OUTPUT_ID);
        assert.equal(intent["direction"], "left");
        assert.equal(ADVISORY_SNAPSHOT_WINDOW_COUNT, 3);
    });

    it("round-trips through the existing request normalizer", () => {
        const { workspace } = validTrio();
        const result = captureAdvisorySnapshot(workspace as never, "down");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        const normalized = normalizeAdvisoryRequest({
            correlationId: "corr-1",
            owner: "owner-1",
            generation: "gen-1",
            revision: 0,
            snapshot: result.snapshot,
            intent: result.intent,
            capabilities: result.capabilities,
        });
        assert.equal(normalized.ok, true);
    });

    it("rejects invalid directions", () => {
        const { workspace } = validTrio();
        for (const bad of ["diagonal", "", null, undefined, 42, "LEFT"]) {
            assert.equal(captureAdvisorySnapshot(workspace as never, bad).ok, false);
        }
    });
});

describe("advisory snapshot scope and geometry preconditions", () => {
    it("requires same output and same desktop", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const otherOutput = stubOutput();
        const otherDesktop = { id: "d2" };
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const wc = stubWindow("id-c", otherOutput, otherDesktop, {}, 2);
        const workspace = stubWorkspace([wa, wb, wc], wb);
        // Active output is `output`; wc is on another output/desktop so only 2 remain.
        assert.equal(captureAdvisorySnapshot(workspace as never, "right").ok, false);

        const wd = stubWindow("id-c", output, otherDesktop, {}, 2);
        const workspace2: StubWorkspace = {
            activeWindow: wb,
            windowList: (): unknown[] => [wa, wb, wd],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ ...WORK_AREA }),
        };
        assert.equal(captureAdvisorySnapshot(workspace2 as never, "right").ok, false);
    });

    it("rejects out-of-output and out-of-work-area frames", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const outside = stubWindow(
            "id-c",
            output,
            desktop,
            { frameGeometry: { x: 5000, y: 10, width: 100, height: 100 } },
            2,
        );
        const workspace = stubWorkspace([wa, wb, outside], wb);
        assert.equal(captureAdvisorySnapshot(workspace as never, "up").ok, false);

        const belowPanel = stubWindow(
            "id-c",
            output,
            desktop,
            { frameGeometry: { x: 10, y: 1030, width: 100, height: 100 } },
            2,
        );
        const workspace2 = stubWorkspace([wa, wb, belowPanel], wb);
        assert.equal(captureAdvisorySnapshot(workspace2 as never, "up").ok, false);
    });

    it("fails closed on missing work area or output geometry", () => {
        const { windows, active } = validTrio();
        const output = windows[0]?.["output"] as object;
        const desktop = (windows[0]?.["desktops"] as unknown[])[0] as object;
        const noArea: StubWorkspace = {
            activeWindow: active,
            windowList: (): unknown[] => [...windows],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => null,
        };
        assert.equal(captureAdvisorySnapshot(noArea as never, "left").ok, false);

        const badOutput = { geometry: { x: 0, y: 0, width: 0, height: 0 } };
        const badWindows = (windows as StubWindow[]).map((w) => ({ ...w, output: badOutput }));
        const badWorkspace: StubWorkspace = {
            activeWindow: { ...active, output: badOutput },
            windowList: (): unknown[] => [...badWindows],
            screens: [badOutput],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ ...WORK_AREA }),
        };
        assert.equal(captureAdvisorySnapshot(badWorkspace as never, "left").ok, false);
    });
});

describe("advisory snapshot eligibility exclusions", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ["special", { normalWindow: false }],
        ["unmanaged", { managed: false }],
        ["unresizable", { resizeable: false }],
        ["popup", { appletPopup: true }],
        ["minimized", { minimized: true }],
        ["fullscreen", { fullScreen: true }],
        ["maximized-full", { maximizeMode: 3 }],
        ["maximized-vertical", { maximizeMode: 1 }],
        ["floating", { tile: null }],
        ["sticky", { onAllDesktops: true }],
        ["interactive-move", { move: true }],
        ["interactive-resize", { resize: true }],
    ];
    for (const [name, override] of cases) {
        it(`excludes ${name} so count drops below three`, () => {
            const output = stubOutput();
            const desktop = stubDesktop();
            const wa = stubWindow("id-a", output, desktop, {}, 0);
            const wb = stubWindow("id-b", output, desktop, {}, 1);
            const bad = stubWindow("id-c", output, desktop, override, 2);
            const workspace = stubWorkspace([wa, wb, bad], wa);
            assert.equal(captureAdvisorySnapshot(workspace as never, "left").ok, false, name);
        });
    }

    it("fails when the active window itself is ineligible", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, { minimized: true }, 2);
        const workspace = stubWorkspace([wa, wb, wc], wc);
        assert.equal(captureAdvisorySnapshot(workspace as never, "left").ok, false);
    });

    it("fails when the active window is absent", () => {
        const { workspace } = validTrio();
        (workspace as Record<string, unknown>)["activeWindow"] = null;
        assert.equal(captureAdvisorySnapshot(workspace as never, "left").ok, false);
    });

    it("ignores an excluded fourth window rather than treating it as eligible", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const special = stubWindow("id-d", output, desktop, { normalWindow: false }, 3);
        const result = captureAdvisorySnapshot(stubWorkspace([wa, wb, wc, special], wb) as never, "left");
        assert.equal(result.ok, true);
    });

    it("fails closed when exclusion fields are missing or malformed", () => {
        const fields = ["appletPopup", "minimized", "fullScreen", "onAllDesktops", "move", "resize"];
        for (const field of fields) {
            const output = stubOutput();
            const desktop = stubDesktop();
            const wa = stubWindow("id-a", output, desktop, {}, 0);
            const wb = stubWindow("id-b", output, desktop, {}, 1);
            const wc = stubWindow("id-c", output, desktop, { [field]: undefined }, 2);
            assert.equal(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wa) as never, "left").ok, false, field);
        }
        for (const mode of [undefined, null, -1, 1, 2, 3, "0"]) {
            const output = stubOutput();
            const desktop = stubDesktop();
            const wa = stubWindow("id-a", output, desktop, {}, 0);
            const wb = stubWindow("id-b", output, desktop, {}, 1);
            const wc = stubWindow("id-c", output, desktop, { maximizeMode: mode }, 2);
            assert.equal(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wa) as never, "left").ok, false, String(mode));
        }
    });
});

describe("advisory snapshot identity and count failures", () => {
    it("refuses duplicate opaque ids", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-a", output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const workspace = stubWorkspace([wa, wb, wc], wa);
        const result = captureAdvisorySnapshot(workspace as never, "left");
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "advisory-snapshot-identity-duplicate");
        }
    });

    it("refuses missing and invalid ids", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        for (const badId of [undefined, null, "", "bad id", "bad;id", "{brace}", "x".repeat(129)]) {
            const wa = stubWindow("id-a", output, desktop, {}, 0);
            const wb = stubWindow("id-b", output, desktop, {}, 1);
            const wc = stubWindow("id-c", output, desktop, {}, 2);
            (wc as Record<string, unknown>)["internalId"] = badId;
            const workspace = stubWorkspace([wa, wb, wc], wa);
            assert.equal(
                captureAdvisorySnapshot(workspace as never, "left").ok,
                false,
                String(badId),
            );
        }
    });

    it("refuses invalid geometry values", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const badGeoms: unknown[] = [
            null,
            { x: 10, y: 10, width: 0, height: 100 },
            { x: 10, y: 10, width: -5, height: 100 },
            { x: Number.NaN, y: 10, width: 100, height: 100 },
            { x: 10, y: Number.POSITIVE_INFINITY, width: 100, height: 100 },
            { x: 10, y: 10, width: 100 },
        ];
        for (const geom of badGeoms) {
            const wa = stubWindow("id-a", output, desktop, {}, 0);
            const wb = stubWindow("id-b", output, desktop, {}, 1);
            const wc = stubWindow("id-c", output, desktop, { frameGeometry: geom }, 2);
            const workspace = stubWorkspace([wa, wb, wc], wa);
            assert.equal(captureAdvisorySnapshot(workspace as never, "left").ok, false);
        }
    });

    it("fails on two candidates and on four candidates", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const two = stubWorkspace([wa, wb], wa);
        assert.equal(captureAdvisorySnapshot(two as never, "left").ok, false);

        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const wd = stubWindow("id-d", output, desktop, {}, 3);
        const four = stubWorkspace([wa, wb, wc, wd], wa);
        assert.equal(captureAdvisorySnapshot(four as never, "left").ok, false);
    });

    it("fails closed on bounded decode overflow", () => {
        const { windows, active } = validTrio();
        const output = windows[0]?.["output"] as object;
        const desktop = (windows[0]?.["desktops"] as unknown[])[0] as object;
        const overflow: StubWorkspace = {
            activeWindow: active,
            windowList: (): unknown => ({ length: 5000 }),
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ ...WORK_AREA }),
        };
        assert.equal(captureAdvisorySnapshot(overflow as never, "left").ok, false);
    });
});

describe("advisory snapshot revalidation drift", () => {
    it("revalidate passes immediately and rejects geometry or membership drift", () => {
        const trio = validTrio();
        const result = captureAdvisorySnapshot(trio.workspace as never, "left");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        assert.equal(result.revalidate(), true);
        ((trio.windows[0] as Record<string, unknown>)["frameGeometry"] as Record<string, number>)["x"] = 1500;
        assert.equal(result.revalidate(), false);
    });

    it("rejects active-window, desktop membership, tile, and output identity drift", () => {
        const trio = validTrio();
        const result = captureAdvisorySnapshot(trio.workspace as never, "right");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        (trio.workspace as Record<string, unknown>)["activeWindow"] = trio.windows[1];
        assert.equal(result.revalidate(), false);

        const trio2 = validTrio();
        const r2 = captureAdvisorySnapshot(trio2.workspace as never, "right");
        assert.equal(r2.ok, true);
        if (!r2.ok) throw new Error("expected ok");
        ((trio2.windows[0] as Record<string, unknown>)["desktops"] as unknown[]).push(stubDesktop());
        assert.equal(r2.revalidate(), false);

        const trio3 = validTrio();
        const r3 = captureAdvisorySnapshot(trio3.workspace as never, "right");
        assert.equal(r3.ok, true);
        if (!r3.ok) throw new Error("expected ok");
        (trio3.windows[0] as Record<string, unknown>)["tile"] = stubTile();
        assert.equal(r3.revalidate(), false);

        const trio4 = validTrio();
        const r4 = captureAdvisorySnapshot(trio4.workspace as never, "right");
        assert.equal(r4.ok, true);
        if (!r4.ok) throw new Error("expected ok");
        const replacementOutput = stubOutput();
        for (const window of trio4.windows) {
            (window as Record<string, unknown>)["output"] = replacementOutput;
        }
        (trio4.workspace as Record<string, unknown>)["screens"] = [replacementOutput];
        assert.equal(r4.revalidate(), false);
    });
});

describe("advisory snapshot capabilities and redaction", () => {
    it("declares advisory-only capabilities with only swap_neighbor true", () => {
        const { workspace } = validTrio();
        const result = captureAdvisorySnapshot(workspace as never, "down");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        assert.deepEqual(result.capabilities, {
            swap_neighbor: true,
            wrap_perpendicular: false,
            wrap_siblings: false,
            insert_child: false,
            split_group_child: false,
            reparent_leaf: false,
            cross_output_transfer: false,
        });
    });

    it("serializes only opaque ids with no native metadata", () => {
        const { workspace } = validTrio();
        const result = captureAdvisorySnapshot(workspace as never, "down");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        const text = JSON.stringify({ snapshot: result.snapshot, intent: result.intent });
        assert.ok(!text.includes("caption-"));
        assert.ok(!text.includes("manufacturer"));
        assert.ok(!text.includes("serialNumber"));
        assert.ok(!text.includes("resourceClass"));
        assert.ok(!text.includes("\"pid\""));
        assert.ok(!text.includes("\"x\""));
        assert.ok(!text.includes("\"width\""));
        assert.ok(!text.includes("100"));
        assert.ok(!text.includes("1920"));
        assert.ok(!text.includes("1040"));
        assert.ok(text.includes("leaf-id-a"));
        assert.ok(text.includes(ADVISORY_SNAPSHOT_OUTPUT_ID));
        assert.ok(text.includes(ADVISORY_SNAPSHOT_WORKSPACE_ID));
    });
});

describe("advisory snapshot source boundaries", () => {
    it("takes the lexical workspace and rejects generic global discovery", () => {
        assert.ok(ADAPTER_SOURCE.includes("captureAdvisorySnapshot"));
        assert.ok(ADAPTER_SOURCE.includes("workspace: Workspace"));
        assert.ok(ADAPTER_SOURCE.includes("captureAdvisorySnapshot(workspace") || ADAPTER_SOURCE.includes("(workspace:"));
        for (const forbidden of ["globalThis", "new Function", "eval(", "require(", "process."]) {
            assert.ok(!ADAPTER_SOURCE.includes(forbidden), `adapter coupling: ${forbidden}`);
        }
        assert.ok(!ADAPTER_SOURCE.includes("from \"./controller"));
        assert.ok(!ADAPTER_SOURCE.includes("from \"./entry"));
        assert.ok(!ADAPTER_SOURCE.includes("from \"./tray"));
        assert.ok(!ADAPTER_SOURCE.includes("from \"./poc3"));
        assert.ok(!ADAPTER_SOURCE.includes("from \"./planner-shadow"));
        assert.ok(!ADAPTER_SOURCE.includes("from \"./boundary"));
    });

    it("has no native mutation surface or production authority", () => {
        for (const forbidden of [
            "Reflect.set",
            "registerShortcut",
            "callDBus",
            "readConfig",
            "showOutline",
            "hideOutline",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
            "loadScript",
            "unloadScript",
            "setTimeout",
            "setInterval",
            ".connect(",
            "manageTile",
            "assignWindowToTile",
            "TileController",
            "TrayPublisher",
            "EvaluateMove",
            "PublishSnapshot",
            "caption",
            "resourceClass",
            "serialNumber",
            "manufacturer",
        ]) {
            assert.ok(!ADAPTER_SOURCE.includes(forbidden), `mutation coupling: ${forbidden}`);
        }
    });
});

describe("advisory snapshot redacted rejection taxonomy", () => {
    function reasonOf(result: ReturnType<typeof captureAdvisorySnapshot>): string {
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("expected failure");
        return result.reason;
    }

    it("exposes exactly eleven bounded enum members and a frozen list", () => {
        assert.deepEqual([...ADVISORY_SNAPSHOT_REJECTS], [
            "advisory-snapshot-invalid-input",
            "advisory-snapshot-surface-unavailable",
            "advisory-snapshot-area-unavailable",
            "advisory-snapshot-identity-invalid",
            "advisory-snapshot-identity-duplicate",
            "advisory-snapshot-geometry-invalid",
            "advisory-snapshot-count-mismatch",
            "advisory-snapshot-active-unavailable",
            "advisory-snapshot-eligibility-state",
            "advisory-snapshot-eligibility-type",
            "advisory-snapshot-eligibility-binding",
        ]);
        assert.ok(Object.isFrozen(ADVISORY_SNAPSHOT_REJECTS));
        for (const member of ADVISORY_SNAPSHOT_REJECTS) {
            assert.ok(isAdvisorySnapshotReject(member));
            assert.ok(ADAPTER_SOURCE.includes(`"${member}"`), `missing static enum: ${member}`);
        }
        assert.ok(!ADAPTER_SOURCE.includes('"advisory-invalid-input"'));
    });

    it("maps input shape to invalid-input without sensitive payload", () => {
        const { workspace } = validTrio();
        assert.equal(reasonOf(captureAdvisorySnapshot(workspace as never, "diagonal")), "advisory-snapshot-invalid-input");
        assert.equal(reasonOf(captureAdvisorySnapshot(null as never, "left")), "advisory-snapshot-invalid-input");
    });

    it("maps surface access to surface-unavailable", () => {
        const { workspace } = validTrio();
        (workspace as Record<string, unknown>)["activeWindow"] = null;
        assert.equal(reasonOf(captureAdvisorySnapshot(workspace as never, "left")), "advisory-snapshot-surface-unavailable");
        const { windows, active } = validTrio();
        const output = windows[0]?.["output"] as object;
        const desktop = (windows[0]?.["desktops"] as unknown[])[0] as object;
        const noList: StubWorkspace = {
            activeWindow: active,
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ ...WORK_AREA }),
        };
        assert.equal(reasonOf(captureAdvisorySnapshot(noList as never, "left")), "advisory-snapshot-surface-unavailable");
    });

    it("maps work-area and output geometry to area-unavailable", () => {
        const { windows, active } = validTrio();
        const output = windows[0]?.["output"] as object;
        const desktop = (windows[0]?.["desktops"] as unknown[])[0] as object;
        const noArea: StubWorkspace = {
            activeWindow: active,
            windowList: (): unknown[] => [...windows],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => null,
        };
        assert.equal(reasonOf(captureAdvisorySnapshot(noArea as never, "left")), "advisory-snapshot-area-unavailable");
    });

    it("maps opaque id faults to identity-invalid and duplicates to identity-duplicate", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-a", output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wa) as never, "left")),
            "advisory-snapshot-identity-duplicate",
        );
        const bad = stubWindow("id-c", output, desktop, { frameGeometry: { x: 10, y: 10, width: 100, height: 100 } }, 2);
        (bad as Record<string, unknown>)["internalId"] = "bad id";
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, stubWindow("id-b", output, desktop, {}, 1), bad], wa) as never, "left")),
            "advisory-snapshot-identity-invalid",
        );
    });

    it("maps frame faults to geometry-invalid", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const outside = stubWindow("id-c", output, desktop, { frameGeometry: { x: 5000, y: 10, width: 100, height: 100 } }, 2);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, outside], wb) as never, "up")),
            "advisory-snapshot-geometry-invalid",
        );
    });

    it("maps non-three eligible sets to count-mismatch", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb], wa) as never, "left")),
            "advisory-snapshot-count-mismatch",
        );
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const wd = stubWindow("id-d", output, desktop, {}, 3);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc, wd], wa) as never, "left")),
            "advisory-snapshot-count-mismatch",
        );
    });

    it("maps underfull in-scope exclusions to redacted eligibility field classes", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const cases: Array<[Record<string, unknown>, string]> = [
            [{ minimized: true }, "advisory-snapshot-eligibility-state"],
            [{ fullScreen: true }, "advisory-snapshot-eligibility-state"],
            [{ maximizeMode: 3 }, "advisory-snapshot-eligibility-state"],
            [{ move: true }, "advisory-snapshot-eligibility-state"],
            [{ resize: true }, "advisory-snapshot-eligibility-state"],
            [{ normalWindow: false }, "advisory-snapshot-eligibility-type"],
            [{ managed: false }, "advisory-snapshot-eligibility-type"],
            [{ resizeable: false }, "advisory-snapshot-eligibility-type"],
            [{ appletPopup: true }, "advisory-snapshot-eligibility-type"],
            [{ tile: null }, "advisory-snapshot-eligibility-binding"],
            [{ onAllDesktops: true }, "advisory-snapshot-eligibility-binding"],
        ];
        for (const [override, expected] of cases) {
            const wa = stubWindow("id-a", output, desktop, {}, 0);
            const wb = stubWindow("id-b", output, desktop, {}, 1);
            const bad = stubWindow("id-c", output, desktop, override, 2);
            assert.equal(
                reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, bad], wa) as never, "left")),
                expected,
                JSON.stringify(override),
            );
        }
    });

    it("prefers state over type over binding without identifying a window", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const stateBad = stubWindow("id-b", output, desktop, { minimized: true }, 1);
        const typeBad = stubWindow("id-c", output, desktop, { normalWindow: false }, 2);
        const bindingBad = stubWindow("id-d", output, desktop, { tile: null }, 3);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, stateBad, typeBad], wa) as never, "left")),
            "advisory-snapshot-eligibility-state",
        );
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, stateBad, bindingBad], wa) as never, "left")),
            "advisory-snapshot-eligibility-state",
        );
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, typeBad, bindingBad], wa) as never, "left")),
            "advisory-snapshot-eligibility-type",
        );
    });

    it("keeps count-mismatch when underfull has no in-scope excluded window", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const otherOutput = stubOutput();
        const otherDesktop = { id: "d2" };
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const elsewhere = stubWindow("id-c", otherOutput, otherDesktop, {}, 2);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, elsewhere], wa) as never, "left")),
            "advisory-snapshot-count-mismatch",
        );
    });

    it("keeps extra eligible counts as count-mismatch despite an unrelated excluded window", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const wd = stubWindow("id-d", output, desktop, {}, 3);
        const excluded = stubWindow("id-e", output, desktop, { minimized: true }, 0);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc, wd, excluded], wa) as never, "left")),
            "advisory-snapshot-count-mismatch",
        );
    });

    it("maps missing active binding to active-unavailable", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, {}, 0);
        const wb = stubWindow("id-b", output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const excluded = stubWindow("id-d", output, desktop, { minimized: true }, 3);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc, excluded], excluded) as never, "left")),
            "advisory-snapshot-active-unavailable",
        );
    });

    it("keeps rejection reasons free of sensitive values", () => {
        const samples: Array<ReturnType<typeof captureAdvisorySnapshot>> = [];
        const { workspace } = validTrio();
        (workspace as Record<string, unknown>)["activeWindow"] = null;
        samples.push(captureAdvisorySnapshot(workspace as never, "left"));
        for (const member of ADVISORY_SNAPSHOT_REJECTS) {
            const text = JSON.stringify(member);
            assert.ok(/^[a-z0-9-]+$/.test(member.replace("advisory-snapshot-", "")));
            assert.ok(!text.includes("caption-"));
            assert.ok(!text.includes("id-a"));
            assert.ok(!text.includes("1920"));
            assert.ok(!text.includes("100"));
            void text;
        }
        for (const result of samples) {
            const reason = reasonOf(result);
            assert.ok(isAdvisorySnapshotReject(reason));
            assert.ok(/^advisory-snapshot-[a-z-]+$/.test(reason));
        }
    });

    it("keeps identity format and duplicate enums distinct and redacted", () => {
        assert.ok(isAdvisorySnapshotReject("advisory-snapshot-identity-invalid"));
        assert.ok(isAdvisorySnapshotReject("advisory-snapshot-identity-duplicate"));
        assert.ok(!isAdvisorySnapshotReject("advisory-snapshot-identity-unknown"));
        for (const member of ["advisory-snapshot-identity-invalid", "advisory-snapshot-identity-duplicate"]) {
            assert.ok(ADVISORY_SNAPSHOT_REJECTS.includes(member as never));
            assert.ok(ADAPTER_SOURCE.includes(`"${member}"`));
            assert.ok(/^advisory-snapshot-[a-z-]+$/.test(member));
        }
    });
});

describe("advisory snapshot single-braced QUuid normalization", () => {
    const UUID_A = "11111111-1111-1111-1111-111111111111";
    const UUID_B = "22222222-2222-2222-2222-222222222222";
    const UUID_C = "33333333-3333-3333-3333-333333333333";

    function reasonOf(result: ReturnType<typeof captureAdvisorySnapshot>): string {
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("expected failure");
        return result.reason;
    }

    it("accepts exact single-braced string form and emits bare ids", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow(`{${UUID_A}}`, output, desktop, {}, 0);
        const wb = stubWindow(`{${UUID_B}}`, output, desktop, {}, 1);
        const wc = stubWindow(`{${UUID_C}}`, output, desktop, {}, 2);
        const result = captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wb) as never, "left");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        const snapshot = result.snapshot as Record<string, unknown>;
        const links = snapshot["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            links.map((l) => l["window"]),
            [UUID_A, UUID_B, UUID_C],
        );
        const text = JSON.stringify(snapshot);
        assert.ok(!text.includes(`{${UUID_A}}`));
        assert.ok(!text.includes(`{${UUID_B}}`));
        assert.ok(!text.includes(`{${UUID_C}}`));
        assert.ok(text.includes(UUID_A));
    });

    it("accepts QUuid object form via String() coercion", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const braced = (uuid: string): unknown => ({ toString: (): string => `{${uuid}}` });
        const wa = stubWindow("placeholder-a", output, desktop, {}, 0);
        const wb = stubWindow("placeholder-b", output, desktop, {}, 1);
        const wc = stubWindow("placeholder-c", output, desktop, {}, 2);
        (wa as Record<string, unknown>)["internalId"] = braced(UUID_A);
        (wb as Record<string, unknown>)["internalId"] = braced(UUID_B);
        (wc as Record<string, unknown>)["internalId"] = braced(UUID_C);
        const result = captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wa) as never, "right");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        const intent = result.intent as Record<string, unknown>;
        assert.equal(intent["focused_window"], UUID_A);
    });

    it("round-trips normalized braced snapshot through the request normalizer", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow(`{${UUID_A}}`, output, desktop, {}, 0);
        const wb = stubWindow(UUID_B, output, desktop, {}, 1);
        const wc = stubWindow("id-c", output, desktop, {}, 2);
        const result = captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wb) as never, "down");
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error("expected ok");
        const normalized = normalizeAdvisoryRequest({
            correlationId: "corr-braced",
            owner: "owner-1",
            generation: "gen-1",
            revision: 0,
            snapshot: result.snapshot,
            intent: result.intent,
            capabilities: result.capabilities,
        });
        assert.equal(normalized.ok, true);
    });

    it("refuses bare-vs-braced duplicates as identity-duplicate", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow(UUID_A, output, desktop, {}, 0);
        const wb = stubWindow(`{${UUID_A}}`, output, desktop, {}, 1);
        const wc = stubWindow(UUID_B, output, desktop, {}, 2);
        assert.equal(
            reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wa) as never, "left")),
            "advisory-snapshot-identity-duplicate",
        );
    });

    it("refuses malformed and double-bracing forms as identity-invalid", () => {
        const badForms = [
            "{{" + UUID_A + "}}",
            `{${UUID_A}}extra`,
            `extra{${UUID_A}}`,
            `{${UUID_A}`,
            `${UUID_A}}`,
            "{not-a-uuid}",
            "{}",
            "{brace}",
            `{${UUID_A.slice(0, 35)}}`,
            `{${UUID_A} }`,
            "{11111111-1111-1111-1111-11111111111Z}",
            "bad id",
            "bad;id",
        ];
        for (const badId of badForms) {
            const output = stubOutput();
            const desktop = stubDesktop();
            const wa = stubWindow(UUID_A, output, desktop, {}, 0);
            const wb = stubWindow(UUID_B, output, desktop, {}, 1);
            const wc = stubWindow(UUID_C, output, desktop, {}, 2);
            (wc as Record<string, unknown>)["internalId"] = badId;
            assert.equal(
                reasonOf(captureAdvisorySnapshot(stubWorkspace([wa, wb, wc], wa) as never, "left")),
                "advisory-snapshot-identity-invalid",
                badId,
            );
        }
    });
});
