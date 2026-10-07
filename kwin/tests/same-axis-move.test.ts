import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    SAME_AXIS_MOVE_DEFAULT,
    SAME_AXIS_MOVE_FLAT_SWAP,
    normalizeSameAxisMove,
    readSameAxisMoveValue,
} from "../src/same-axis-move";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

function entryXml(path: string): string {
    return readFileSync(path, "utf8");
}

describe("same-axis move setting validation", () => {
    it("defaults to cosmic-wrap", () => {
        assert.equal(SAME_AXIS_MOVE_DEFAULT, "cosmic-wrap");
        assert.equal(SAME_AXIS_MOVE_FLAT_SWAP, "flat-swap");
        assert.equal(readSameAxisMoveValue(), "cosmic-wrap");
    });

    it("accepts exactly cosmic-wrap and flat-swap while rejecting the rest to cosmic-wrap", () => {
        assert.equal(normalizeSameAxisMove("cosmic-wrap"), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove("flat-swap"), "flat-swap");
        assert.equal(normalizeSameAxisMove(undefined), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove(null), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove(""), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove("cosmic"), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove("COSMIC-WRAP"), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove("flat_swap"), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove("sameAxisMove"), "cosmic-wrap");
        assert.equal(normalizeSameAxisMove(0), "cosmic-wrap");
        assert.equal(readSameAxisMoveValue(() => "flat-swap"), "flat-swap");
        assert.equal(readSameAxisMoveValue(() => "bogus"), "cosmic-wrap");
        assert.equal(
            readSameAxisMoveValue(() => {
                throw new Error("boom");
            }),
            "cosmic-wrap",
        );
    });
});

describe("same-axis move schema and native KCM persistence", () => {
    it("declares sameAxisMove as an Enum setting defaulting to cosmic-wrap", () => {
        const schema = entryXml("contents/config/main.xml");
        const match = schema.match(/<entry name="sameAxisMove" type="Enum">([\s\S]*?)<\/entry>/);
        assert.ok(match !== null, "sameAxisMove must be declared");
        const body = match[1] as string;
        assert.match(body, /<default>cosmic-wrap<\/default>/);
        assert.match(body, /<choice name="cosmic-wrap" value="cosmic-wrap"\/>/);
        assert.match(body, /<choice name="flat-swap" value="flat-swap"\/>/);
        const ui = entryXml("contents/ui/config.ui");
        assert.match(ui, /name="kcfg_sameAxisMove"/);
    });

    it("persists sameAxisMove through the native script KCM with validation", () => {
        const module = entryXml("native-effect/unifiedsettings_module.cpp");
        const ui = entryXml("native-effect/unifiedsettings.ui");
        assert.match(ui, /name="sameAxisMoveCombo"/);
        assert.match(ui, /name="label_sameAxisMove"[\s\S]*?sameAxisMoveCombo/);
        assert.match(module, /m_ui\.sameAxisMoveCombo->addItem\(.*QStringLiteral\("cosmic-wrap"\)\)/);
        assert.match(module, /m_ui\.sameAxisMoveCombo->addItem\(.*QStringLiteral\("flat-swap"\)\)/);
        assert.match(module, /readSameAxisMove\(group\)/);
        assert.match(module, /writeEntry\(QStringLiteral\("sameAxisMove"\)/);
        assert.match(module, /select\(m_ui\.sameAxisMoveCombo, sameAxisMove, QStringLiteral\("cosmic-wrap"\)\)/);
        assert.match(module, /sameAxisMoveCombo->setCurrentIndex\(m_ui\.sameAxisMoveCombo->findData\(QStringLiteral\("cosmic-wrap"\)\)\)/);
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

function moveCommandOf(payload: string): Record<string, unknown> {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return parsed["command"] as Record<string, unknown>;
}

function startMoveEntry(
    world: Record<string, unknown>,
    dbusCalls: Array<{ method: string; payload: string }>,
    overrides?: { readSameAxisMoveFn?: () => unknown; options?: unknown; log?: (message: string) => void },
): ReturnType<typeof startPlanAdapterEntry> {
    const log = overrides?.log ?? (() => {});
    return startPlanAdapterEntry({
        workspace: world["workspace"],
        callDbus: (_s, _p, _i, method, payload, _cb): void => {
            if (method === "NameHasOwner") { _cb(true); return; }
            if (method === "GetNameOwner") { _cb(":1.7"); return; }
            if (method === "StartServiceByName") { _cb(1); return; }
            dbusCalls.push({ method, payload });
            void _cb;
        },
        scheduleOnce: () => () => {},
        log,
        owner: "owner-1",
        generation: "gen-1",
        registerShortcutFn: () => true,
        readProfileFn: () => "cosmic",
        ...(overrides?.readSameAxisMoveFn === undefined
            ? {}
            : { readSameAxisMoveFn: overrides.readSameAxisMoveFn }),
        ...(overrides?.options === undefined ? {} : { options: overrides.options }),
    });
}

describe("production move wire carries the configured same-axis mode", () => {
    it("omits same_axis_move by default so historical requests stay byte-identical", () => {
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const handle = startMoveEntry(world, dbusCalls);
        assert.ok(handle !== null);
        handle?.requestMove("right");
        assert.equal(dbusCalls.length, 1);
        assert.deepEqual(moveCommandOf(dbusCalls[0]?.payload as string), {
            op: "move",
            window: "win-a",
            direction: "right",
        });
        handle?.stop();
    });

    it("omits same_axis_move for invalid configuration", () => {
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const handle = startMoveEntry(world, dbusCalls, { readSameAxisMoveFn: () => "bogus" });
        assert.ok(handle !== null);
        handle?.requestMove("right");
        assert.deepEqual(moveCommandOf(dbusCalls[0]?.payload as string), {
            op: "move",
            window: "win-a",
            direction: "right",
        });
        handle?.stop();
    });

    it("carries flat-swap explicitly when configured", () => {
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const handle = startMoveEntry(world, dbusCalls, { readSameAxisMoveFn: () => "flat-swap" });
        assert.ok(handle !== null);
        handle?.requestMove("right");
        assert.deepEqual(moveCommandOf(dbusCalls[0]?.payload as string), {
            op: "move",
            window: "win-a",
            direction: "right",
            same_axis_move: "flat-swap",
        });
        handle?.stop();
    });
});

describe("same-axis move live reread on Options configChanged", () => {
    it("updates subsequent moves without shortcut or tree work", () => {
        let mode: unknown = "cosmic-wrap";
        const handlers: Array<() => void> = [];
        const options = {
            configChanged: {
                connect: (handler: () => void): void => { handlers.push(handler); },
                disconnect: (handler: () => void): void => {
                    const index = handlers.indexOf(handler);
                    if (index >= 0) { handlers.splice(index, 1); }
                },
            },
        };
        const logs: string[] = [];
        const shortcuts: Array<{ action: string; sequence: string }> = [];
        const timers: Array<{ cancelled: boolean }> = [];
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const handle = startPlanAdapterEntry({
            workspace: world["workspace"],
            options,
            callDbus: (_s, _p, _i, method, payload, callback): void => {
                if (method === "NameHasOwner") { callback(true); return; }
                if (method === "GetNameOwner") { callback(":1.7"); return; }
                if (method === "StartServiceByName") { callback(1); return; }
                dbusCalls.push({ method, payload });
                callbacks.push(callback);
            },
            scheduleOnce: (_delayMs, _callback): (() => void) => {
                const timer = { cancelled: false };
                timers.push(timer);
                return (): void => { timer.cancelled = true; };
            },
            log: (message): void => { logs.push(message); },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence): boolean => {
                shortcuts.push({ action, sequence });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readSameAxisMoveFn: (): unknown => mode,
        });
        assert.ok(handle !== null);
        const shortcutCount = shortcuts.length;
        assert.ok(shortcutCount > 0);

        handle?.requestMove("right");
        assert.equal(dbusCalls.length, 1);
        assert.deepEqual(moveCommandOf(dbusCalls[0]?.payload as string), {
            op: "move",
            window: "win-a",
            direction: "right",
        });
        const firstCorrelation = (JSON.parse(dbusCalls[0]?.payload as string) as { correlation_id: string })
            .correlation_id;
        callbacks[0]?.(
            JSON.stringify({ v: 1, correlation_id: firstCorrelation, outcome: "planned", desired_geometry: [] }),
        );

        const timersBeforeReload = timers.length;
        mode = "flat-swap";
        for (const fire of [...handlers]) {
            fire();
        }
        assert.ok(
            logs.some((line) => line === "plasma-auto-tiler:plan:config-reloaded stage=same-axis-move mode=flat-swap"),
        );
        // No tree rebuild: no shortcut re-registration, no resync timer, no
        // restart or gap reload lines, and no synchronous dispatch.
        assert.equal(shortcuts.length, shortcutCount);
        assert.equal(timers.length, timersBeforeReload);
        assert.equal(dbusCalls.length, 1);
        assert.ok(!logs.some((line) => line.includes("restart-required")));
        assert.ok(!logs.some((line) => line.includes("re-read-queued")));
        assert.ok(!logs.some((line) => line.includes("default-tiled")));

        handle?.requestMove("right");
        assert.equal(dbusCalls.length, 2);
        assert.deepEqual(moveCommandOf(dbusCalls[1]?.payload as string), {
            op: "move",
            window: "win-a",
            direction: "right",
            same_axis_move: "flat-swap",
        });
        assert.equal(shortcuts.length, shortcutCount);
        handle?.stop();
    });

    it("ignores an unchanged configChanged without reload lines", () => {
        let mode: unknown = "cosmic-wrap";
        const handlers: Array<() => void> = [];
        const options = {
            configChanged: {
                connect: (handler: () => void): void => { handlers.push(handler); },
                disconnect: (handler: () => void): void => {
                    const index = handlers.indexOf(handler);
                    if (index >= 0) { handlers.splice(index, 1); }
                },
            },
        };
        const logs: string[] = [];
        const world = planWorld();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const handle = startMoveEntry(world, dbusCalls, {
            readSameAxisMoveFn: (): unknown => mode,
            options,
            log: (message): void => { logs.push(message); },
        });
        assert.ok(handle !== null);
        void mode;
        for (const fire of [...handlers]) {
            fire();
        }
        assert.ok(!logs.some((line) => line.includes("plasma-auto-tiler:plan:config-reloaded")));
        handle?.stop();
    });
});
