import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    DOMAIN_GAP,
    OUTER_DOMAIN_GAP,
    normalizeGap,
    readDomainGaps,
    readInnerGapValue,
    readOuterGapValue,
} from "../src/domain-gap";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry";
import { startPointerResizeAdapterEntry } from "../src/pointer-resize-adapter-entry";
import {
    RESIZE_METHOD,
    RESIZE_SERVICE,
} from "../src/resize-adapter";
import {
    POINTER_RESIZE_METHOD,
} from "../src/pointer-resize-adapter";
import {
    WorkspaceSendAdapter,
    type WorkspaceSendAdapterEnv,
    type WorkspaceSendObserved,
} from "../src/workspace-send-adapter";

function entryXml(path: string): string {
    return readFileSync(path, "utf8");
}

describe("bounded gap schema and native KCM persistence", () => {
    it("declares innerGap and outerGap as bounded Int settings defaulting to 8", () => {
        const schema = entryXml("contents/config/main.xml");
        for (const key of ["innerGap", "outerGap"]) {
            const match = schema.match(
                new RegExp(`<entry name="${key}" type="Int">([\\s\\S]*?)</entry>`),
            );
            assert.ok(match !== null, `${key} must be declared`);
            const body = match[1] as string;
            assert.match(body, /<default>8<\/default>/);
            assert.match(body, /<min>0<\/min>/);
            assert.match(body, /<max>64<\/max>/);
        }
        const ui = entryXml("contents/ui/config.ui");
        for (const key of ["innerGap", "outerGap"]) {
            assert.match(ui, new RegExp(`name="kcfg_${key}"`));
        }
    });

    it("persists gaps through the native KCM script group with bounded validation", () => {
        const module = entryXml("native-effect/activeborderconfig_module.cpp");
        const ui = entryXml("native-effect/activeborderconfig.ui");
        for (const key of ["innerGap", "outerGap"]) {
            assert.match(module, new RegExp(`readBoundedGap\\(group, QStringLiteral\\("${key}"\\)\\)`));
            assert.match(module, new RegExp(`writeEntry\\(QStringLiteral\\("${key}"\\)`));
            assert.match(ui, new RegExp(`name="${key}SpinBox"`));
            assert.match(ui, new RegExp(`name="label_${key}"[\\s\\S]*?${key}SpinBox`));
        }
        assert.match(module, /innerGapSpinBox->setValue\(8\)/);
        assert.match(module, /outerGapSpinBox->setValue\(8\)/);
        assert.match(ui, /name="innerGapSpinBox"[\s\S]*?<number>64<\/number>/);
        assert.match(ui, /name="outerGapSpinBox"[\s\S]*?<number>64<\/number>/);
    });
});

describe("validated gap binding", () => {
    it("preserves the default effective pair (8, 8)", () => {
        assert.equal(DOMAIN_GAP, 8);
        assert.equal(OUTER_DOMAIN_GAP, 8);
        assert.deepEqual(readDomainGaps(), { innerGap: 8, outerGap: 8 });
    });

    it("accepts boundaries and representative values while rejecting the rest to 8", () => {
        assert.equal(normalizeGap(0), 0);
        assert.equal(normalizeGap(64), 64);
        assert.equal(normalizeGap(12), 12);
        assert.equal(normalizeGap("20"), 20);
        assert.equal(normalizeGap(-1), 8);
        assert.equal(normalizeGap(65), 8);
        assert.equal(normalizeGap(7.5), 8);
        assert.equal(normalizeGap("bogus"), 8);
        assert.equal(normalizeGap(undefined), 8);
        assert.equal(normalizeGap(null), 8);
        assert.equal(readInnerGapValue(() => 12), 12);
        assert.equal(readOuterGapValue(() => 20), 20);
        assert.equal(readInnerGapValue(() => 65), 8);
        assert.equal(readOuterGapValue(() => -1), 8);
        assert.equal(
            readInnerGapValue(() => {
                throw new Error("boom");
            }),
            8,
        );
        assert.deepEqual(readDomainGaps({ readInnerGapFn: () => 0, readOuterGapFn: () => 64 }), {
            innerGap: 0,
            outerGap: 64,
        });
        assert.deepEqual(readDomainGaps({ readInnerGapFn: () => "bogus", readOuterGapFn: () => 99 }), {
            innerGap: 8,
            outerGap: 8,
        });
    });
});

function planWorld(): Record<string, unknown> {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const inert = (): unknown => ({ connect: (): void => {}, disconnect: (): void => {} });
    const winA: Record<string, unknown> = {
        normalWindow: true,
        internalId: "win-a",
        resourceClass: "test-app",
        output,
        desktops: [desktop],
        frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
        moveResizedChanged: inert(),
        fullScreenChanged: inert(),
        fullScreen: false,
        maximizedChanged: inert(),
        maximizeMode: 0,
        desktopsChanged: inert(),
        onAllDesktops: false,
    };
    const winB: Record<string, unknown> = {
        normalWindow: true,
        internalId: "win-b",
        resourceClass: "test-app",
        output,
        desktops: [desktop],
        frameGeometry: { x: 600, y: 0, width: 600, height: 800 },
        moveResizedChanged: inert(),
        fullScreenChanged: inert(),
        fullScreen: false,
        maximizedChanged: inert(),
        maximizeMode: 0,
        desktopsChanged: inert(),
        onAllDesktops: false,
    };
    return {
        output,
        desktop,
        winA,
        winB,
        workspace: {
            activeWindow: winA,
            windowList: (): unknown[] => [winA, winB],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
            windowAdded: inert(),
            windowRemoved: inert(),
            windowActivated: inert(),
            screensChanged: inert(),
            currentDesktopChanged: inert(),
        },
    };
}

describe("production entries carry configured gaps", () => {
    it("normal plan observation sends configured gaps in DescribePlan", () => {
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const handle = startPlanAdapterEntry({
            workspace: world["workspace"],
            callDbus: (_s, _p, _i, method, payload, _cb): void => {
                dbusCalls.push({ method, payload });
                callbacks.push(_cb);
            },
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: () => true,
            readProfileFn: () => "cosmic",
            readInnerGapFn: () => 12,
            readOuterGapFn: () => 20,
        });
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        assert.equal(dbusCalls.length, 1);
        const payload = JSON.parse(dbusCalls[0]?.payload as string) as Record<string, unknown>;
        const domain = payload["domain"] as Record<string, unknown>;
        assert.equal(domain["gap"], 12);
        assert.equal(domain["outer_gap"], 20);
        handle?.stop();
    });

    it("invalid plan gaps fall back to the default pair", () => {
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const handle = startPlanAdapterEntry({
            workspace: world["workspace"],
            callDbus: (_s, _p, _i, method, payload, _cb): void => {
                dbusCalls.push({ method, payload });
                void _cb;
            },
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: () => true,
            readProfileFn: () => "cosmic",
            readInnerGapFn: () => 99,
            readOuterGapFn: () => "bogus",
        });
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        const payload = JSON.parse(dbusCalls[0]?.payload as string) as Record<string, unknown>;
        const domain = payload["domain"] as Record<string, unknown>;
        assert.equal(domain["gap"], 8);
        assert.equal(domain["outer_gap"], 8);
        handle?.stop();
    });

    it("keyboard resize entry sends configured gaps in DescribeResize", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const inert = (): unknown => ({ connect: (): void => {}, disconnect: (): void => {} });
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
            frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
            moveResizedChanged: inert(),
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
            frameGeometry: { x: 960, y: 0, width: 960, height: 1080 },
            moveResizedChanged: inert(),
        };
        const workspace: Record<string, unknown> = {
            activeWindow: winA,
            windowList: (): unknown[] => [winA, winB],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            windowActivated: inert(),
            windowAdded: inert(),
            windowRemoved: inert(),
            screensChanged: inert(),
            currentDesktopChanged: inert(),
        };
        const dbusCalls: Array<{ service: string; method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const handle = startResizeAdapterEntry({
            workspace,
            callDbus: (service, _p, _i, method, payload, cb): void => {
                dbusCalls.push({ service, method, payload });
                callbacks.push(cb);
            },
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
            readInnerGapFn: () => 3,
            readOuterGapFn: () => 5,
        });
        assert.ok(handle !== null);
        handle?.request("right", "outwards");
        assert.ok(dbusCalls.length >= 1);
        callbacks[0]?.(":1.42");
        const planner = dbusCalls.find((call) => call.method === RESIZE_METHOD);
        assert.ok(planner !== undefined);
        const payload = JSON.parse(planner.payload) as Record<string, unknown>;
        const domain = payload["domain"] as Record<string, unknown>;
        assert.equal(domain["gap"], 3);
        assert.equal(domain["outer_gap"], 5);
        assert.equal(planner.service, ":1.42");
        void RESIZE_SERVICE;
        handle?.stop();
    });

    it("pointer resize entry observes configured gaps", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const inert = (): unknown => ({ connect: (): void => {}, disconnect: (): void => {} });
        const triggerable = (): { signal: unknown; fire: (payload?: unknown) => void } => {
            const handlers = new Set<(payload?: unknown) => void>();
            return {
                signal: {
                    connect: (h: (payload?: unknown) => void): void => {
                        handlers.add(h);
                    },
                    disconnect: (h: (payload?: unknown) => void): void => {
                        handlers.delete(h);
                    },
                },
                fire: (payload?: unknown): void => {
                    for (const h of [...handlers]) {
                        h(payload);
                    }
                },
            };
        };
        const startedA = triggerable();
        const steppedA = triggerable();
        const finishedA = triggerable();
        const startedB = triggerable();
        const steppedB = triggerable();
        const finishedB = triggerable();
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
            frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
            move: false,
            resize: true,
            moveResizedChanged: inert(),
            interactiveMoveResizeStarted: startedA.signal,
            interactiveMoveResizeStepped: steppedA.signal,
            interactiveMoveResizeFinished: finishedA.signal,
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
            frameGeometry: { x: 960, y: 0, width: 960, height: 1080 },
            move: false,
            resize: false,
            moveResizedChanged: inert(),
            interactiveMoveResizeStarted: startedB.signal,
            interactiveMoveResizeStepped: steppedB.signal,
            interactiveMoveResizeFinished: finishedB.signal,
        };
        const workspace: Record<string, unknown> = {
            activeWindow: winA,
            windowList: (): unknown[] => [winA, winB],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            windowActivated: inert(),
            windowAdded: inert(),
            windowRemoved: inert(),
            screensChanged: inert(),
            currentDesktopChanged: inert(),
        };
        const dbusCalls: Array<{ service: string; method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const handle = startPointerResizeAdapterEntry({
            workspace,
            callDbus: (service, _p, _i, method, payload, cb): void => {
                dbusCalls.push({ service, method, payload });
                callbacks.push(cb);
            },
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
            readInnerGapFn: () => 7,
            readOuterGapFn: () => 9,
        });
        assert.ok(handle !== null);
        startedA.fire();
        steppedA.fire({ x: 0, y: 0, width: 1000, height: 1080 });
        assert.ok(dbusCalls.length >= 1);
        callbacks[0]?.(":1.42");
        const planner = dbusCalls.find((call) => call.method === POINTER_RESIZE_METHOD);
        assert.ok(planner !== undefined);
        const payload = JSON.parse(planner.payload) as Record<string, unknown>;
        const domain = payload["domain"] as Record<string, unknown>;
        assert.equal(domain["gap"], 7);
        assert.equal(domain["outer_gap"], 9);
        handle?.stop();
    });

    it("every workspace-send request builder carries configured gaps", () => {
        const refs = { a: {}, b: {}, t: {}, desktop: {} };
        const rect = (x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } => ({ x, y, w, h });
        const observed: WorkspaceSendObserved = {
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            sourceBounds: Object.freeze(rect(0, 0, 1200, 800)),
            targetOutput: "out-1",
            targetWorkspace: "ws-2",
            targetBounds: Object.freeze(rect(0, 0, 1200, 800)),
            focusedId: "win-a",
            sourceWindows: Object.freeze([
                Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
                Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
            ]),
            targetWindows: Object.freeze([
                Object.freeze({ id: "win-t", ref: refs.t, rect: Object.freeze(rect(0, 0, 100, 100)) }),
            ]),
            activeRef: refs.a,
            moverRef: refs.a,
            targetDesktopRef: refs.desktop,
            targetExists: true,
            desktopCount: 2,
            sourceFingerprint: "sfp-1",
            targetFingerprint: "tfp-1",
        };
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const env: WorkspaceSendAdapterEnv = {
            callDbus: (_s, _p, _i, method, payload, cb): void => {
                dbusCalls.push({ method, payload });
                callbacks.push(cb);
            },
            scheduleOnce: () => () => {},
            log: () => {},
            observe: () => observed,
            setGeometry: () => true,
            setDesktops: () => true,
        };
        const adapter = new WorkspaceSendAdapter(env, { innerGap: 12, outerGap: 20 });
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        assert.ok(dbusCalls.length >= 1);
        callbacks[0]?.(":1.42");
        const requestCall = dbusCalls.find((call) => {
            try {
                const body = JSON.parse(call.payload) as Record<string, unknown>;
                return (body["command"] as Record<string, unknown>)?.["op"] === "send-to-workspace";
            } catch (error) {
                void error;
                return false;
            }
        });
        assert.ok(requestCall !== undefined);
        const requestBody = JSON.parse(requestCall.payload) as Record<string, unknown>;
        assert.equal((requestBody["domain"] as Record<string, unknown>)["gap"], 12);
        assert.equal((requestBody["domain"] as Record<string, unknown>)["outer_gap"], 20);
        assert.equal((requestBody["target_domain"] as Record<string, unknown>)["gap"], 12);
        assert.equal((requestBody["target_domain"] as Record<string, unknown>)["outer_gap"], 20);
        adapter.disable();
    });

    it("workspace-send defaults to (8, 8) and falls back on invalid gaps", () => {
        const refs = { a: {}, b: {}, t: {}, desktop: {} };
        const rect = (x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } => ({ x, y, w, h });
        const observed: WorkspaceSendObserved = {
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            sourceBounds: Object.freeze(rect(0, 0, 1200, 800)),
            targetOutput: "out-1",
            targetWorkspace: "ws-2",
            targetBounds: Object.freeze(rect(0, 0, 1200, 800)),
            focusedId: "win-a",
            sourceWindows: Object.freeze([
                Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
            ]),
            targetWindows: Object.freeze([]),
            activeRef: refs.a,
            moverRef: refs.a,
            targetDesktopRef: refs.desktop,
            targetExists: true,
            desktopCount: 2,
            sourceFingerprint: "sfp-1",
            targetFingerprint: "tfp-1",
        };
        const runOnce = (gaps: { innerGap?: unknown; outerGap?: unknown } | undefined): Record<string, unknown> => {
            const dbusCalls: Array<{ method: string; payload: string }> = [];
            const callbacks: Array<(reply: unknown) => void> = [];
            const env: WorkspaceSendAdapterEnv = {
                callDbus: (_s, _p, _i, method, payload, cb): void => {
                    dbusCalls.push({ method, payload });
                    callbacks.push(cb);
                },
                scheduleOnce: () => () => {},
                log: () => {},
                observe: () => observed,
                setGeometry: () => true,
                setDesktops: () => true,
            };
            const adapter = gaps === undefined ? new WorkspaceSendAdapter(env) : new WorkspaceSendAdapter(env, gaps);
            assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
            assert.equal(adapter.requestSend("ws-2"), true);
            callbacks[0]?.(":1.42");
            const requestCall = dbusCalls.find((call) => {
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    return (body["command"] as Record<string, unknown>)?.["op"] === "send-to-workspace";
                } catch (error) {
                    void error;
                    return false;
                }
            });
            assert.ok(requestCall !== undefined);
            adapter.disable();
            return JSON.parse((requestCall as { payload: string }).payload) as Record<string, unknown>;
        };
        const fallback = runOnce(undefined);
        assert.equal((fallback["domain"] as Record<string, unknown>)["gap"], 8);
        assert.equal((fallback["domain"] as Record<string, unknown>)["outer_gap"], 8);
        const invalid = runOnce({ innerGap: 99, outerGap: "bogus" });
        assert.equal((invalid["domain"] as Record<string, unknown>)["gap"], 8);
        assert.equal((invalid["domain"] as Record<string, unknown>)["outer_gap"], 8);
    });
});
