import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    evaluateIdProbe,
    parseExpectedPids,
    parseIdProbeConfig,
    POC3_DIAG_SLOT_APP_IDS,
    POC3_ID_PROBE_EXPECTED_REVISION,
} from "../src/poc3-id-probe";

const OUTPUT_A = {
    geometry: { x: 0, y: 0, width: 900, height: 600 },
    name: "output-a",
    manufacturer: "test",
    model: "test",
    serialNumber: "a",
};
const OUTPUT_B = {
    geometry: { x: 900, y: 0, width: 900, height: 600 },
    name: "output-b",
    manufacturer: "test",
    model: "test",
    serialNumber: "b",
};
const DESKTOP_A = { id: "desktop-a" };
const DESKTOP_B = { id: "desktop-b" };

const CONFIG = { owner: "owner-1", generation: "gen-1", nonce: "n-1" };

interface StubWindow extends Record<string, unknown> {
    internalId: string;
    pid: number;
}

let nextStubPid = 1000;
function stubWindow(id: string, overrides: Record<string, unknown> = {}): StubWindow {
    const pid = (overrides["pid"] as number | undefined) ?? (nextStubPid += 1);
    const rest: Record<string, unknown> = { ...overrides };
    delete rest["pid"];
    return {
        internalId: id,
        pid,
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        tile: null,
        fullScreen: false,
        maximizeMode: 0,
        closeable: true,
        closeWindow: () => undefined,
        output: OUTPUT_A,
        desktops: [DESKTOP_A],
        onAllDesktops: false,
        ...rest,
    };
}

function pidsOf(windows: StubWindow[]): readonly number[] {
    return Object.freeze(windows.map((w) => w["pid"] as number));
}

function workspaceWith(windows: StubWindow[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        windowList: () => windows,
        screens: [OUTPUT_A],
        currentDesktopForScreen: () => DESKTOP_A,
        ...overrides,
    };
}

describe("poc3 id probe config", () => {
    it("accepts a bounded owner/generation/nonce triple", () => {
        assert.deepEqual(parseIdProbeConfig(CONFIG), CONFIG);
    });

    it("rejects unknown fields and malformed tokens", () => {
        assert.equal(parseIdProbeConfig(null), null);
        assert.equal(parseIdProbeConfig({ ...CONFIG, extra: 1 }), null);
        assert.equal(parseIdProbeConfig({ owner: "BAD OWNER", generation: "gen-1", nonce: "n-1" }), null);
        assert.equal(parseIdProbeConfig({ owner: "owner-1", generation: "GEN-1", nonce: "n-1" }), null);
        assert.equal(parseIdProbeConfig({ owner: "owner-1", generation: "gen-1", nonce: "" }), null);
    });
});

describe("poc3 id probe discovery", () => {
    it("reports exactly three eligible windows with session material", () => {
        const windows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const ws = workspaceWith(windows);
        const result = evaluateIdProbe(ws, CONFIG, pidsOf(windows));
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.deepEqual([...result.ids], ["id-a", "id-b", "id-c"]);
            assert.equal(result.owner, "owner-1");
            assert.equal(result.generation, "gen-1");
            assert.equal(result.expectedRevision, POC3_ID_PROBE_EXPECTED_REVISION);
            assert.equal(result.expectedRevision, 0);
            assert.equal(result.nonce, "n-1");
        }
    });

    it("rejects wrong window counts", () => {
        for (const windows of [
            [] as StubWindow[],
            [stubWindow("id-a"), stubWindow("id-b")],
            [stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c"), stubWindow("id-d")],
        ]) {
            const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [101, 102, 103]);
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.reason, "poc3-id-probe-count");
            }
        }
    });

    it("accepts canonical QUuid identity forms", () => {
        const windows = [
            stubWindow("{11111111-1111-1111-1111-111111111111}", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("22222222-2222-2222-2222-222222222222", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const ws = workspaceWith(windows);
        const result = evaluateIdProbe(ws, CONFIG, pidsOf(windows));
        assert.equal(result.ok, true);
    });

    it("rejects invalid and duplicate native identities", () => {
        const badWindows = [stubWindow(""), stubWindow("id-b"), stubWindow("id-c")];
        const bad = evaluateIdProbe(workspaceWith(badWindows), CONFIG, pidsOf(badWindows));
        assert.equal(bad.ok, false);
        if (!bad.ok) {
            assert.equal(bad.reason, "poc3-invalid-id");
        }
        const injectedWindows = [stubWindow("id-a;rm -rf /"), stubWindow("id-b"), stubWindow("id-c")];
        const injected = evaluateIdProbe(
            workspaceWith(injectedWindows),
            CONFIG,
            pidsOf(injectedWindows),
        );
        assert.equal(injected.ok, false);
        const dupOkWindows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const duplicate = evaluateIdProbe(
            workspaceWith(dupOkWindows, {}),
            CONFIG,
            pidsOf(dupOkWindows),
        );
        assert.equal(duplicate.ok, true);
        const windows = [stubWindow("id-a"), stubWindow("id-a"), stubWindow("id-c")];
        const dupNative = evaluateIdProbe(workspaceWith(windows), CONFIG, pidsOf(windows));
        assert.equal(dupNative.ok, false);
        if (!dupNative.ok) {
            assert.equal(dupNative.reason, "poc3-duplicate-native");
        }
    });
});

describe("poc3 id probe eligibility rejections", () => {
    const cases: Array<{ name: string; override: Record<string, unknown>; token: string }> = [
        { name: "special", override: { normalWindow: false }, token: "poc3-special" },
        { name: "unmanaged", override: { managed: false }, token: "poc3-unmanaged" },
        { name: "unresizable", override: { resizeable: false }, token: "poc3-unresizable" },
        { name: "applet popup", override: { appletPopup: true }, token: "poc3-applet-popup" },
        { name: "tiled", override: { tile: {} }, token: "poc3-tiled" },
        { name: "fullscreen", override: { fullScreen: true }, token: "poc3-fullscreen" },
        { name: "maximized", override: { maximizeMode: 3 }, token: "poc3-maximized" },
        { name: "uncloseable", override: { closeable: false }, token: "poc3-uncloseable" },
    ];
    for (const { name, override, token } of cases) {
        it(`rejects ${name} windows`, () => {
            const windows = [stubWindow("id-a", override), stubWindow("id-b"), stubWindow("id-c")];
            const result = evaluateIdProbe(
                workspaceWith(windows),
                CONFIG,
                pidsOf(windows),
            );
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.reason, token);
            }
        });
    }

    it("rejects windows without a public close method", () => {
        const first = stubWindow("id-a");
        delete (first as Record<string, unknown>)["closeWindow"];
        const windows = [first, stubWindow("id-b"), stubWindow("id-c")];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, pidsOf(windows));
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-no-close");
        }
    });
});

describe("poc3 id probe scope rejections", () => {
    it("rejects cross-output enrollment", () => {
        const windows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { output: OUTPUT_B, resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const ws = workspaceWith(windows);
        ws["screens"] = [OUTPUT_A, OUTPUT_B];
        const result = evaluateIdProbe(ws, CONFIG, pidsOf(windows));
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-cross-output");
        }
    });

    it("rejects unknown outputs", () => {
        const windows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const ws = workspaceWith(windows);
        ws["screens"] = [OUTPUT_B];
        const result = evaluateIdProbe(ws, CONFIG, pidsOf(windows));
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-unknown-output");
        }
    });

    it("rejects cross-workspace enrollment", () => {
        const windows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { desktops: [DESKTOP_B], resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const ws = workspaceWith(windows);
        const result = evaluateIdProbe(ws, CONFIG, pidsOf(windows));
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-cross-workspace");
        }
    });

    it("rejects sticky windows", () => {
        const windows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { onAllDesktops: true, resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const ws = workspaceWith(windows);
        const result = evaluateIdProbe(ws, CONFIG, pidsOf(windows));
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-cross-workspace");
        }
    });

    it("rejects invalid workspace surfaces", () => {
        assert.equal(evaluateIdProbe(null, CONFIG, [101, 102, 103]).ok, false);
        assert.equal(evaluateIdProbe({}, CONFIG, [101, 102, 103]).ok, false);
        const noListWindows = [stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")];
        const noList = workspaceWith(noListWindows);
        delete (noList as Record<string, unknown>)["windowList"];
        assert.equal((evaluateIdProbe(noList, CONFIG, pidsOf(noListWindows)) as { ok: boolean }).ok, false);
        const noScreensWindows = [stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")];
        const noScreens = workspaceWith(noScreensWindows);
        delete (noScreens as Record<string, unknown>)["screens"];
        const screened = evaluateIdProbe(noScreens, CONFIG, pidsOf(noScreensWindows));
        assert.equal(screened.ok, false);
    });
});


describe("poc3 id probe manual pid binding", () => {
    it("accepts exactly three distinct matched manual PIDs", () => {
        const windows = [
            stubWindow("id-a", { pid: 4441, resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { pid: 4442, resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { pid: 4443, resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, true);
    });
    it("accepts PIDs in any window order", () => {
        const windows = [
            stubWindow("id-a", { pid: 4443, resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
            stubWindow("id-b", { pid: 4441, resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-c", { pid: 4442, resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, true);
    });
    it("rejects missing expected PIDs", () => {
        const windows = [stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")];
        const ws = workspaceWith(windows);
        assert.equal((evaluateIdProbe(ws, CONFIG) as { ok: boolean }).ok, false);
        const missing = evaluateIdProbe(ws, CONFIG, undefined);
        assert.equal(missing.ok, false);
        if (!missing.ok) assert.equal(missing.reason, "poc3-pid-missing");
        for (const bad of [[4441, 4442], [4441, 4442, 4443, 4444], [4441, 4441, 4442], ["a", "b", "c"], [0, 4442, 4443]]) {
            const r = evaluateIdProbe(ws, CONFIG, bad);
            assert.equal(r.ok, false);
            if (!r.ok) assert.equal(r.reason, "poc3-pid-missing");
        }
    });
    it("rejects windows without a KWin pid (fail closed)", () => {
        const windows = [stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")];
        delete (windows[0] as Record<string, unknown>)["pid"];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "poc3-no-pid");
        const zero = [stubWindow("id-a", { pid: 0 }), stubWindow("id-b", { pid: 4442 }), stubWindow("id-c", { pid: 4443 })];
        const r0 = evaluateIdProbe(workspaceWith(zero), CONFIG, [4441, 4442, 4443]);
        assert.equal(r0.ok, false);
        if (!r0.ok) assert.equal(r0.reason, "poc3-no-pid");
    });
    it("rejects duplicate window PIDs", () => {
        const windows = [stubWindow("id-a", { pid: 4441 }), stubWindow("id-b", { pid: 4441 }), stubWindow("id-c", { pid: 4443 })];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "poc3-pid-duplicate");
    });
    it("rejects disposable automatic-route PIDs via the manual branch", () => {
        const windows = [stubWindow("id-a", { pid: 5551 }), stubWindow("id-b", { pid: 5552 }), stubWindow("id-c", { pid: 5553 })];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "poc3-pid-mismatch");
    });
    it("rejects partial overlap", () => {
        const windows = [stubWindow("id-a", { pid: 4441 }), stubWindow("id-b", { pid: 4442 }), stubWindow("id-c", { pid: 9999 })];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "poc3-pid-mismatch");
    });
    it("parses expected PID lists strictly", () => {
        assert.deepEqual(parseExpectedPids([4441, 4442, 4443]), [4441, 4442, 4443]);
        assert.equal(parseExpectedPids([4441, 4442]), null);
        assert.equal(parseExpectedPids([4441, 4441, 4442]), null);
        assert.equal(parseExpectedPids(["4441", 4442, 4443]), null);
        assert.equal(parseExpectedPids([0, 4442, 4443]), null);
    });
    it("uses pid plus exact resourceClass app_id with absent/mismatch failing closed", () => {
        const logic = readFileSync("src/poc3-id-probe.ts", "utf8");
        assert.ok(logic.includes('readProp(candidate, "pid")'));
        assert.ok(logic.includes("POC3_DIAG_SLOT_APP_IDS"));
        assert.ok(logic.includes("poc3-slot-mismatch"));
        // App_id binds on the single exact property only: no caption/title
        // fallback, no PID-only pass.
        assert.ok(!logic.includes('readProp(candidate, "caption")'));
        assert.ok(!logic.includes('readProp(candidate, "resourceName")'));
        assert.ok(!logic.includes('readProp(candidate, "desktopFileName")'));
    });
    it("rejects absent app_id evidence (no PID-only fallback)", () => {
        const windows = [
            stubWindow("id-a", { pid: 4441 }),
            stubWindow("id-b", { pid: 4442 }),
            stubWindow("id-c", { pid: 4443 }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-slot-mismatch");
        }
    });
});

describe("poc3 id probe resident trio contract", () => {
    it("emits IDs in deterministic slot (expected-PID) order for the command route", () => {
        const windows = [
            stubWindow("id-a", { pid: 4443, resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
            stubWindow("id-b", { pid: 4441, resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-c", { pid: 4442, resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.deepEqual([...result.ids], ["id-b", "id-c", "id-a"]);
        }
    });
    it("rejects a fourth eligible matching window", () => {
        const windows = [
            stubWindow("id-a", { pid: 4441 }),
            stubWindow("id-b", { pid: 4442 }),
            stubWindow("id-c", { pid: 4443 }),
            stubWindow("id-d", { pid: 4441 }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "poc3-id-probe-count");
        }
    });
    it("rejects arbitrary same-PID windows", () => {
        const triple = [stubWindow("id-a", { pid: 9999 }), stubWindow("id-b", { pid: 9999 }), stubWindow("id-c", { pid: 9999 })];
        const dup = evaluateIdProbe(workspaceWith(triple), CONFIG, [4441, 4442, 4443]);
        assert.equal(dup.ok, false);
        if (!dup.ok) {
            assert.equal(dup.reason, "poc3-pid-duplicate");
        }
    });
    it("accepts matching slot app_id evidence and rejects slot mismatch where supported", () => {
        const okWindows = [
            stubWindow("id-a", { pid: 4441, resourceClass: "org.plasma-auto-tiler.poc3-diag-1" }),
            stubWindow("id-b", { pid: 4442, resourceClass: "org.plasma-auto-tiler.poc3-diag-2" }),
            stubWindow("id-c", { pid: 4443, resourceClass: "org.plasma-auto-tiler.poc3-diag-3" }),
        ];
        const ok = evaluateIdProbe(workspaceWith(okWindows), CONFIG, [4441, 4442, 4443]);
        assert.equal(ok.ok, true);
        const badWindows = [
            stubWindow("id-a", { pid: 4441, resourceClass: "org.plasma-auto-tiler.poc3-diag-2" }),
            stubWindow("id-b", { pid: 4442, resourceClass: "org.plasma-auto-tiler.poc3-diag-1" }),
            stubWindow("id-c", { pid: 4443 }),
        ];
        const bad = evaluateIdProbe(workspaceWith(badWindows), CONFIG, [4441, 4442, 4443]);
        assert.equal(bad.ok, false);
        if (!bad.ok) {
            assert.equal(bad.reason, "poc3-slot-mismatch");
        }
    });
    it("keeps distinct same-parent PIDs distinct (no parent conflation)", () => {
        const windows = [
            stubWindow("id-a", { pid: 4441, resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { pid: 4442, resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { pid: 4443, resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, [4441, 4442, 4443]);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(new Set([...result.ids]).size, 3);
        }
    });
});

describe("poc3 id probe completion payload contract", () => {
    it("success carries exact bundle-bound session material and three IDs", () => {
        const windows = [
            stubWindow("id-a", { resourceClass: POC3_DIAG_SLOT_APP_IDS[0] }),
            stubWindow("id-b", { resourceClass: POC3_DIAG_SLOT_APP_IDS[1] }),
            stubWindow("id-c", { resourceClass: POC3_DIAG_SLOT_APP_IDS[2] }),
        ];
        const result = evaluateIdProbe(workspaceWith(windows), CONFIG, pidsOf(windows));
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.deepEqual([...result.ids], ["id-a", "id-b", "id-c"]);
            assert.equal(result.ids.length, 3);
            for (const id of result.ids) {
                assert.equal(typeof id, "string");
                assert.ok(id.length > 0 && id.length <= 128);
            }
            assert.equal(result.owner, "owner-1");
            assert.equal(result.generation, "gen-1");
            assert.equal(result.nonce, "n-1");
            assert.equal(result.expectedRevision, 0);
        }
    });

    it("failures carry only a reason and never masquerade as success payloads", () => {
        const windows = [stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")];
        const errorCases = [
            evaluateIdProbe(workspaceWith(windows), CONFIG, undefined),
            evaluateIdProbe(workspaceWith(windows), { ...CONFIG, owner: "BAD OWNER" }, pidsOf(windows)),
            evaluateIdProbe(workspaceWith([stubWindow("id-a"), stubWindow("id-b")]), CONFIG, [101, 102, 103]),
        ];
        for (const result of errorCases) {
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(typeof result.reason, "string");
                assert.ok(result.reason.length > 0);
                assert.ok(!("ids" in result));
                assert.ok(!("owner" in result));
                assert.ok(!("nonce" in result));
            }
        }
    });

    it("entry separates success and error done lines (static)", () => {
        const entry = readFileSync("src/poc3-id-probe-entry.ts", "utf8");
        assert.ok(entry.includes("poc3-id-probe-done:${result.nonce}:${payload}"));
        assert.ok(entry.includes('"ids"') || entry.includes("ids:"));
        assert.ok(entry.includes("expected_revision"));
        assert.ok(entry.includes('{"error":"poc3-id-probe-encode"}'));
        assert.ok(entry.includes("{ error: result.reason }"));
        assert.ok(entry.includes("poc3-id-probe-invalid"));
    });
});

describe("poc3 id probe read-only separation", () => {
    it("performs zero actuation paths", () => {
        for (const file of ["src/poc3-id-probe.ts", "src/poc3-id-probe-entry.ts"]) {
            const source = readFileSync(file, "utf8");
            for (const forbidden of [
                "frameGeometry =",
                "activeWindow =",
                "closeWindow(",
                "callDBus(",
                "readConfig(",
                "createDesktop(",
                "removeDesktop(",
                "setCurrentDesktop(",
                "showOutline(",
                "registerShortcut",
                ".connect(",
                "tile =",
                "desktops =",
                "onAllDesktops =",
                "manage(window",
                "unmanage(window",
                "split(direction",
                "remove()",
            ]) {
                assert.ok(!source.includes(forbidden), `${file} must not contain ${forbidden}`);
            }
        }
    });

    it("is not wired into production startup and reuses neither POC2 nor command actuation", () => {
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.ok(!entry.includes("poc3-id-probe"));
        const logic = readFileSync("src/poc3-id-probe.ts", "utf8");
        assert.ok(!logic.includes('from "./planner-shadow"'));
        assert.ok(!logic.includes('from "./poc3-adapter"'));
        assert.ok(!logic.includes('from "./controller"'));
        const probeEntry = readFileSync("src/poc3-id-probe-entry.ts", "utf8");
        assert.ok(probeEntry.includes("poc3-id-probe-done:"));
        assert.ok(!probeEntry.includes('from "./planner-shadow"'));
        assert.ok(!probeEntry.includes('from "./poc3-adapter"'));
    });
});
