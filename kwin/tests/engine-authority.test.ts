import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    DEFAULT_ENGINE_AUTHORITY_MODE,
    ENGINE_AUTHORITY_MODE_CONFIG_KEY,
    parseEngineAuthorityMode,
} from "../src/controller-config";
import {
    ENGINE_AUTHORITY_GENERATION,
    ENGINE_AUTHORITY_OWNER,
    ENGINE_AUTHORITY_REVISION,
    createEngineAuthority,
    type EngineAuthorityStarts,
} from "../src/engine-authority";
import { startFocusAdapterEntry } from "../src/focus-adapter-entry";
import { startMovementAdapterEntry } from "../src/movement-adapter-entry";
import { startPointerResizeAdapterEntry } from "../src/pointer-resize-adapter-entry";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry";
import { Harness, window } from "./controller-fixtures";
import { TileController } from "../src/controller";

function seedAttachedWindow(harness: Harness): void {
    const subject = window();
    harness.windows = [subject];
}

function kwinSrcDir(): string {
    const override = process.env["KWIN_SRC_DIR"];
    if (typeof override === "string" && override.length > 0) {
        try {
            if (existsSync(join(override, "entry.ts"))) {
                return override;
            }
        } catch (error) {
            void error;
        }
    }
    const here: unknown = typeof __dirname === "string" ? __dirname : process.cwd();
    if (typeof here === "string") {
        for (const candidate of [resolve(here, "..", "src"), resolve(here, "src")]) {
            try {
                if (existsSync(join(candidate, "entry.ts"))) {
                    return candidate;
                }
            } catch (error) {
                void error;
            }
        }
    }
    return resolve(process.cwd(), "src");
}

function fakeStarts(options: {
    readonly fail?: "focus" | "movement" | "resize" | "pointer";
    readonly calls?: Array<{ readonly slice: string; readonly owner: unknown; readonly generation: unknown; readonly revision: unknown; readonly authorityType: string }>;
    readonly requests?: Array<{ readonly slice: string; readonly args: readonly unknown[] }>;
}): EngineAuthorityStarts {
    const record = (slice: string, auth: Record<string, unknown>): void => {
        options.calls?.push({
            slice,
            owner: auth["owner"],
            generation: auth["generation"],
            revision: auth["revision"],
            authorityType: typeof auth[Object.keys(auth).find((key) => key.startsWith("hasExclusive")) ?? ""],
        });
    };
    const failing = options.fail;
    return {
        startFocus: (args) => {
            record("focus", args as unknown as Record<string, unknown>);
            if (failing === "focus") {
                return null;
            }
            return {
                stop: () => {},
                request: (direction: unknown) => {
                    options.requests?.push({ slice: "focus", args: [direction] });
                },
            };
        },
        startMovement: (args) => {
            record("movement", args as unknown as Record<string, unknown>);
            if (failing === "movement") {
                return null;
            }
            return {
                stop: () => {},
                request: (direction: unknown) => {
                    options.requests?.push({ slice: "movement", args: [direction] });
                },
            };
        },
        startResize: (args) => {
            record("resize", args as unknown as Record<string, unknown>);
            if (failing === "resize") {
                return null;
            }
            return {
                stop: () => {},
                request: (direction: unknown, mode: unknown) => {
                    options.requests?.push({ slice: "resize", args: [direction, mode] });
                },
            };
        },
        startPointerResize: (args) => {
            record("pointer", args as unknown as Record<string, unknown>);
            if (failing === "pointer") {
                return null;
            }
            return { stop: () => {} };
        },
    };
}

describe("engine authority mode parsing", () => {
    it("defaults empty and missing to legacy with no diagnostic", () => {
        assert.equal(DEFAULT_ENGINE_AUTHORITY_MODE, "legacy");
        assert.equal(ENGINE_AUTHORITY_MODE_CONFIG_KEY, "engineAuthorityMode");
        for (const value of [undefined, null, ""]) {
            const parsed = parseEngineAuthorityMode(value);
            assert.equal(parsed.mode, "legacy");
            assert.deepEqual(parsed.diagnostics, []);
        }
    });

    it("accepts exactly legacy and rust-development", () => {
        assert.equal(parseEngineAuthorityMode("legacy").mode, "legacy");
        assert.deepEqual(parseEngineAuthorityMode("legacy").diagnostics, []);
        assert.equal(parseEngineAuthorityMode("rust-development").mode, "rust-development");
        assert.deepEqual(parseEngineAuthorityMode("rust-development").diagnostics, []);
    });

    it("falls back unknown and malformed to legacy with a fixed diagnostic", () => {
        for (const value of ["RUST-DEVELOPMENT", "rust", "Legacy", " true", 1, true, {}, []]) {
            const parsed = parseEngineAuthorityMode(value);
            assert.equal(parsed.mode, "legacy");
            assert.deepEqual(parsed.diagnostics, ["engine-authority-mode-invalid:fallback-legacy"]);
        }
    });
});

type SharedQv4Signal = ((...args: readonly unknown[]) => void) & {
    readonly count: () => number;
    readonly fire: (payload?: unknown) => void;
};

function makeSharedQv4Signal(): SharedQv4Signal {
    const handlers = new Set<(payload?: unknown) => void>();
    const fn = function (): void {};
    Object.setPrototypeOf(fn, {
        connect: (handler: (payload?: unknown) => void): void => {
            handlers.add(handler);
        },
        disconnect: (handler: (payload?: unknown) => void): void => {
            handlers.delete(handler);
        },
    });
    const callable = fn as unknown as SharedQv4Signal;
    (callable as unknown as Record<string, unknown>)["fire"] = (payload?: unknown): void => {
        for (const handler of [...handlers]) {
            handler(payload);
        }
    };
    (callable as unknown as Record<string, unknown>)["count"] = (): number => handlers.size;
    return callable;
}

function makeSharedCallableWorld(options: { readonly omitStepped?: boolean } = {}): {
    readonly workspace: Record<string, unknown>;
    readonly workspaceSignals: Record<string, SharedQv4Signal>;
    readonly winASignals: Record<string, SharedQv4Signal>;
    readonly winBSignals: Record<string, SharedQv4Signal>;
} {
    const output = { name: "out-1" };
    const desktop = { id: "ws-1" };
    const workspaceSignals: Record<string, SharedQv4Signal> = {
        windowActivated: makeSharedQv4Signal(),
        windowAdded: makeSharedQv4Signal(),
        windowRemoved: makeSharedQv4Signal(),
        screensChanged: makeSharedQv4Signal(),
        currentDesktopChanged: makeSharedQv4Signal(),
    };
    const winASignals: Record<string, SharedQv4Signal> = {
        moveResizedChanged: makeSharedQv4Signal(),
        interactiveMoveResizeStarted: makeSharedQv4Signal(),
        interactiveMoveResizeStepped: makeSharedQv4Signal(),
        interactiveMoveResizeFinished: makeSharedQv4Signal(),
    };
    const winBSignals: Record<string, SharedQv4Signal> = {
        moveResizedChanged: makeSharedQv4Signal(),
        interactiveMoveResizeStarted: makeSharedQv4Signal(),
        interactiveMoveResizeStepped: makeSharedQv4Signal(),
        interactiveMoveResizeFinished: makeSharedQv4Signal(),
    };
    if (options.omitStepped === true) {
        delete winASignals["interactiveMoveResizeStepped"];
        delete winBSignals["interactiveMoveResizeStepped"];
    }
    const winA: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        move: false,
        resize: false,
        output,
        desktops: [desktop],
        internalId: "win-a",
        frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
        moveResizedChanged: winASignals["moveResizedChanged"],
        interactiveMoveResizeStarted: winASignals["interactiveMoveResizeStarted"],
        interactiveMoveResizeFinished: winASignals["interactiveMoveResizeFinished"],
    };
    if (winASignals["interactiveMoveResizeStepped"] !== undefined) {
        winA["interactiveMoveResizeStepped"] = winASignals["interactiveMoveResizeStepped"];
    }
    const winB: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        move: false,
        resize: false,
        output,
        desktops: [desktop],
        internalId: "win-b",
        frameGeometry: { x: 960, y: 0, width: 960, height: 1080 },
        moveResizedChanged: winBSignals["moveResizedChanged"],
        interactiveMoveResizeStarted: winBSignals["interactiveMoveResizeStarted"],
        interactiveMoveResizeFinished: winBSignals["interactiveMoveResizeFinished"],
    };
    if (winBSignals["interactiveMoveResizeStepped"] !== undefined) {
        winB["interactiveMoveResizeStepped"] = winBSignals["interactiveMoveResizeStepped"];
    }
    const workspace: Record<string, unknown> = {
        activeWindow: winA,
        windowList: (): unknown[] => [winA, winB],
        screens: [output],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        ...workspaceSignals,
    };
    return { workspace, workspaceSignals, winASignals, winBSignals };
}

describe("engine authority dispatcher", () => {
    it("binds revision 0 to the initial Rust seed revision (member count)", () => {
        // Adapters auto-bind revision 0 to the normalized observed membership
        // size N (focus-adapter, movement-adapter, resize-adapter,
        // pointer-resize-adapter: `if (requestRevision === 0)
        // requestRevision = sortedIds.length`). The packaged binding must be
        // exactly 0 so the first request carries the Rust post-seed base.
        assert.equal(ENGINE_AUTHORITY_REVISION, 0);
    });

    it("starts all four slices with one exact owner, generation, and shared revision binding", () => {
        const calls: Array<{ readonly slice: string; readonly owner: unknown; readonly generation: unknown; readonly revision: unknown; readonly authorityType: string }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts({ calls }), (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), true);
        assert.equal(dispatcher.isRustActive(), true);
        assert.deepEqual(
            calls.map((call) => call.slice).sort(),
            ["focus", "movement", "pointer", "resize"],
        );
        for (const call of calls) {
            assert.equal(call.owner, ENGINE_AUTHORITY_OWNER);
            assert.equal(call.generation, ENGINE_AUTHORITY_GENERATION);
            assert.ok(typeof call.revision === "object" && call.revision !== null);
            assert.equal((call.revision as { current: unknown }).current, ENGINE_AUTHORITY_REVISION);
            assert.equal(call.authorityType, "function");
        }
        // One shared holder across all four slices: sequential commands bind
        // the single Rust session revision.
        for (const call of calls) {
            assert.equal(call.revision, calls[0]?.revision);
        }
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-ready")));
    });

    it("supplies one shared function-form authority predicate across slices", () => {
        const seen: Array<() => boolean> = [];
        const starts: EngineAuthorityStarts = {
            startFocus: (args) => {
                seen.push(args.hasExclusiveFocusAuthority);
                return { stop: () => {}, request: () => {} };
            },
            startMovement: (args) => {
                seen.push(args.hasExclusiveMovementAuthority);
                return { stop: () => {}, request: () => {} };
            },
            startResize: (args) => {
                seen.push(args.hasExclusiveResizeAuthority);
                return { stop: () => {}, request: () => {} };
            },
            startPointerResize: (args) => {
                seen.push(args.hasExclusiveResizeAuthority);
                return { stop: () => {} };
            },
        };
        const dispatcher = createEngineAuthority("rust-development", starts, () => {});
        assert.equal(dispatcher.start(), true);
        assert.equal(seen.length, 4);
        for (const predicate of seen) {
            assert.equal(typeof predicate, "function");
            assert.equal(predicate === dispatcher.hasExclusiveRustAuthority, true);
            assert.equal(predicate(), true);
        }
        dispatcher.stop();
        for (const predicate of seen) {
            assert.equal(predicate(), false);
        }
    });

    it("routes one callback per target slice with no cross-talk", () => {
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts({ requests }), () => {});
        assert.equal(dispatcher.start(), true);
        dispatcher.requestFocus("left");
        dispatcher.requestMove("right");
        dispatcher.requestResize("up", "outwards");
        dispatcher.focusOrResize("down");
        dispatcher.enterOrExitRustResizeMode("inwards");
        dispatcher.focusOrResize("up");
        assert.deepEqual(
            requests.map((entry) => [entry.slice, ...entry.args]),
            [
                ["focus", "left"],
                ["movement", "right"],
                ["resize", "up", "outwards"],
                ["focus", "down"],
                ["resize", "up", "inwards"],
            ],
        );
    });

    it("fails closed on any single start loss with no active authority", () => {
        for (const fail of ["focus", "movement", "resize", "pointer"] as const) {
            const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
            const logs: string[] = [];
            const dispatcher = createEngineAuthority("rust-development", fakeStarts({ fail, requests }), (message) => {
                logs.push(message);
            });
            assert.equal(dispatcher.start(), false);
            assert.equal(dispatcher.isRustActive(), false);
            dispatcher.requestFocus("left");
            dispatcher.requestMove("left");
            dispatcher.requestResize("left", "outwards");
            dispatcher.focusOrResize("left");
            assert.equal(requests.length, 0);
            assert.ok(logs.some((line) => line.includes("engine-authority-rust-unavailable")));
            assert.ok(logs.some((line) => line.includes("engine-authority-rust-refused")));
        }
    });

    it("stops started slices when required pointer startup is absent", () => {
        const stops: string[] = [];
        const starts: EngineAuthorityStarts = {
            startFocus: () => ({ stop: () => { stops.push("focus"); }, request: () => {} }),
            startMovement: () => ({ stop: () => { stops.push("movement"); }, request: () => {} }),
            startResize: () => ({ stop: () => { stops.push("resize"); }, request: () => {} }),
            startPointerResize: () => null,
        };
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", starts, (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        assert.equal(dispatcher.isRustActive(), false);
        assert.deepEqual([...stops].sort(), ["focus", "movement", "resize"]);
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-unavailable")));
    });

    it("starts all four real entries on one shared callable workspace with exact counts and detaches twice-clean", () => {
        const { workspace, workspaceSignals, winASignals, winBSignals } = makeSharedCallableWorld();
        for (const signal of [...Object.values(workspaceSignals), ...Object.values(winASignals), ...Object.values(winBSignals)]) {
            assert.equal(typeof signal, "function");
            assert.equal(Object.prototype.hasOwnProperty.call(signal, "connect"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(signal, "disconnect"), false);
            const proto = Object.getPrototypeOf(signal) as Record<string, unknown>;
            assert.equal(typeof proto["connect"], "function");
            assert.equal(typeof proto["disconnect"], "function");
        }
        const entryLogs: string[] = [];
        const starts: EngineAuthorityStarts = {
            startFocus: (args) =>
                startFocusAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: (message) => {
                        entryLogs.push(message);
                    },
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveFocusAuthority: args.hasExclusiveFocusAuthority,
                }),
            startMovement: (args) =>
                startMovementAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: (message) => {
                        entryLogs.push(message);
                    },
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveMovementAuthority: args.hasExclusiveMovementAuthority,
                }),
            startResize: (args) =>
                startResizeAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: (message) => {
                        entryLogs.push(message);
                    },
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveResizeAuthority: args.hasExclusiveResizeAuthority,
                }),
            startPointerResize: (args) =>
                startPointerResizeAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: (message) => {
                        entryLogs.push(message);
                    },
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveResizeAuthority: args.hasExclusiveResizeAuthority,
                }),
        };
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", starts, (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), true);
        assert.equal(dispatcher.isRustActive(), true);
        for (const name of ["windowActivated", "windowAdded", "windowRemoved", "screensChanged", "currentDesktopChanged"]) {
            assert.equal(workspaceSignals[name]?.count(), 3);
        }
        assert.equal(winASignals["moveResizedChanged"]?.count(), 3);
        assert.equal(winBSignals["moveResizedChanged"]?.count(), 3);
        for (const name of ["interactiveMoveResizeStarted", "interactiveMoveResizeStepped", "interactiveMoveResizeFinished"]) {
            assert.equal(winASignals[name]?.count(), 1);
            assert.equal(winBSignals[name]?.count(), 1);
        }
        dispatcher.stop();
        for (const signal of [...Object.values(workspaceSignals), ...Object.values(winASignals), ...Object.values(winBSignals)]) {
            assert.equal(signal.count(), 0);
        }
        dispatcher.stop();
        for (const signal of [...Object.values(workspaceSignals), ...Object.values(winASignals), ...Object.values(winBSignals)]) {
            assert.equal(signal.count(), 0);
        }
        void entryLogs;
    });

    it("fails closed all-or-nothing on the same world when required pointer stepped is missing", () => {
        const { workspace, workspaceSignals, winASignals, winBSignals } = makeSharedCallableWorld({ omitStepped: true });
        const starts: EngineAuthorityStarts = {
            startFocus: (args) =>
                startFocusAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: () => {},
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveFocusAuthority: args.hasExclusiveFocusAuthority,
                }),
            startMovement: (args) =>
                startMovementAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: () => {},
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveMovementAuthority: args.hasExclusiveMovementAuthority,
                }),
            startResize: (args) =>
                startResizeAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: () => {},
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveResizeAuthority: args.hasExclusiveResizeAuthority,
                }),
            startPointerResize: (args) =>
                startPointerResizeAdapterEntry({
                    workspace,
                    callDbus: () => {},
                    scheduleOnce: () => () => {},
                    log: () => {},
                    owner: args.owner,
                    generation: args.generation,
                    revision: args.revision,
                    hasExclusiveResizeAuthority: args.hasExclusiveResizeAuthority,
                }),
        };
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", starts, (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        assert.equal(dispatcher.isRustActive(), false);
        for (const signal of [...Object.values(workspaceSignals), ...Object.values(winASignals), ...Object.values(winBSignals)]) {
            assert.equal(signal.count(), 0);
        }
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-unavailable")));
        dispatcher.requestFocus("left");
        dispatcher.requestMove("left");
        dispatcher.requestResize("left", "outwards");
        dispatcher.focusOrResize("left");
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-refused")));
        assert.ok(logs.every((line) => !line.includes("drag-attach-summary")));
        assert.ok(logs.every((line) => !line.includes("startup-handlers-ready")));
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));
    });

    it("invokes the resize one-shot adoption after activation and never in legacy", () => {
        const adoptions: string[] = [];
        const starts: EngineAuthorityStarts = {
            startFocus: () => ({ stop: () => {}, request: () => {} }),
            startMovement: () => ({ stop: () => {}, request: () => {} }),
            startResize: () => ({
                stop: () => {},
                request: () => {},
                tryBootstrapTrio: () => {
                    adoptions.push("resize");
                },
            }),
            startPointerResize: () => ({ stop: () => {} }),
        };
        const rust = createEngineAuthority("rust-development", starts, () => {});
        assert.equal(rust.start(), true);
        assert.deepEqual(adoptions, ["resize"]);
        const legacy = createEngineAuthority("legacy", starts, () => {});
        assert.equal(legacy.start(), false);
        assert.deepEqual(adoptions, ["resize"]);
    });

    it("refuses requests while legacy with no legacy fallback call", () => {
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("legacy", fakeStarts({ requests }), (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        assert.equal(dispatcher.isRustActive(), false);
        dispatcher.requestFocus("left");
        dispatcher.focusOrResize("left");
        assert.equal(requests.length, 0);
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-refused")));
    });
});

describe("packaged controller authority wiring", () => {
    it("keeps the legacy default with legacy attach as the only authority", () => {
        const harness = new Harness();
        seedAttachedWindow(harness);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "legacy");
        assert.equal(controller.isRustAuthorityActive(), false);
        assert.ok(harness.logs.some((line) => line.includes("drag-attach-summary")));
        assert.ok(harness.interactiveWatches.length > 0);
    });

    it("falls back unknown config to legacy with a fixed diagnostic", () => {
        const harness = new Harness();
        seedAttachedWindow(harness);
        harness.configValues.set("engineAuthorityMode", "rust");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "legacy");
        assert.equal(controller.isRustAuthorityActive(), false);
        assert.ok(harness.logs.some((line) => line.includes("engine-authority-mode-invalid:fallback-legacy")));
        assert.ok(harness.interactiveWatches.length > 0);
    });

    it("rust mode starts with no legacy subscriptions, root reads, or layout lifecycle", () => {
        const harness = new Harness();
        seedAttachedWindow(harness);
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "rust-development");
        // Packaged dispatcher fails closed in the harness (no live workspace/
        // callDBus), so authority is inactive; this asserts fail-closed, not
        // live adapter success.
        assert.equal(controller.isRustAuthorityActive(), false);
        assert.equal(harness.added, undefined);
        assert.equal(harness.removed, undefined);
        assert.equal(harness.screensChanged, undefined);
        assert.equal(harness.desktopChanged, undefined);
        assert.equal(harness.desktopsChanged, undefined);
        assert.equal(harness.interactiveWatches.length, 0);
        assert.equal(harness.rootReads, 0);
        assert.equal(harness.desktopReads, 0);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.removedDesktops.length, 0);
        assert.ok(
            harness.logs.every((line) => !line.includes("drag-attach-summary")),
            "rust mode must not emit the legacy attach summary",
        );
        assert.ok(
            harness.logs.every((line) => !line.includes("startup-handlers-ready")),
            "rust mode must not run legacy startup lifecycle",
        );
        assert.ok(harness.logs.some((line) => line.includes("engine-authority-rust-unavailable")));
    });

    it("rust mode routes target commands only to the dispatcher facade", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        const routed: Array<readonly unknown[]> = [];
        const fake = {
            requestMove: (direction: unknown): void => {
                routed.push(["move", direction]);
            },
            focusOrResize: (direction: unknown): void => {
                routed.push(["focusOrResize", direction]);
            },
            requestResize: (direction: unknown, mode: unknown): void => {
                routed.push(["resize", direction, mode]);
            },
            enterOrExitRustResizeMode: (mode: unknown): void => {
                routed.push(["resizeMode", mode]);
            },
            isRustActive: (): boolean => true,
        };
        (controller as unknown as { engineAuthority: unknown }).engineAuthority = fake;
        const readsBefore = harness.rootReads;
        const desktopReadsBefore = harness.desktopReads;
        const writesBefore = harness.activeWrites.length;
        controller.focusOrResize("left");
        controller.moveActiveWindow("right");
        controller.resizeActiveWindow("up", "outwards");
        controller.enterOrExitResizeMode("outwards");
        assert.deepEqual(routed, [
            ["focusOrResize", "left"],
            ["move", "right"],
            ["resize", "up", "outwards"],
            ["resizeMode", "outwards"],
        ]);
        assert.equal(harness.rootReads, readsBefore);
        assert.equal(harness.desktopReads, desktopReadsBefore);
        assert.equal(harness.activeWrites.length, writesBefore);
    });

    it("rust mode refuses without legacy fallback when the dispatcher is lost", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isRustAuthorityActive(), false);
        (controller as unknown as { engineAuthority: unknown }).engineAuthority = null;
        const readsBefore = harness.rootReads;
        const writesBefore = harness.activeWrites.length;
        controller.focusOrResize("left");
        controller.moveActiveWindow("right");
        controller.resizeActiveWindow("up", "outwards");
        controller.enterOrExitResizeMode("outwards");
        assert.equal(harness.rootReads, readsBefore);
        assert.equal(harness.activeWrites.length, writesBefore);
        assert.equal(harness.interactiveWatches.length, 0);
    });

    it("adds no pointer subscription for later windows in rust mode", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isRustAuthorityActive(), false);
        // No add/remove subscription is deliberately fail-closed for this
        // earliest stable-scope journey (add/remove out of scope); no
        // lifecycle automation is implemented.
        assert.equal(harness.added, undefined);
        const watchesBefore = harness.interactiveWatches.length;
        harness.emitAdded({});
        assert.equal(harness.interactiveWatches.length, watchesBefore);
    });
});

describe("engine authority source contract", () => {
    it("routes through exactly one dispatcher module with no legacy topology route", () => {
        const dir = kwinSrcDir();
        const authority = readFileSync(join(dir, "engine-authority.ts"), "utf8");
        for (const entry of [
            "focus-adapter-entry",
            "movement-adapter-entry",
            "resize-adapter-entry",
            "pointer-resize-adapter-entry",
        ]) {
            assert.ok(authority.includes(entry), `dispatcher must start ${entry}`);
        }
        for (const forbidden of [
            "rootTile",
            "topologyForScope",
            "CustomTile",
            "decodeLeaves",
            "manageTile",
            "operationLeafForTile",
            "setTileRelativeGeometry",
            "splitCustomTile",
            "DescribeFocus",
            "DescribeMovement",
            "DescribeResize",
            "DescribePointerResize",
        ]) {
            assert.ok(!authority.includes(forbidden), `rust authority must not contain ${forbidden}`);
        }
        const controller = readFileSync(join(dir, "controller.ts"), "utf8");
        assert.ok(controller.includes("engine-authority"));
        assert.ok(controller.includes("isRustAuthorityActive"));
        for (const forbidden of [
            'from "./focus-adapter',
            'from "./movement-adapter',
            'from "./resize-adapter',
            'from "./pointer-resize-adapter',
            "startFocusAdapterEntry",
            "startMovementAdapterEntry",
            "startResizeAdapterEntry",
            "startPointerResizeAdapterEntry",
        ]) {
            assert.ok(!controller.includes(forbidden), `controller must route via the dispatcher, not ${forbidden}`);
        }
        const entry = readFileSync(join(dir, "entry.ts"), "utf8");
        assert.ok(!entry.includes("adapter-entry"));
        assert.ok(!entry.includes("engine-authority"));
    });

    it("names exact workspace/window signals with payload-forwarding window-owned pointer gestures and no polling/globals/legacy", () => {
        const dir = kwinSrcDir();
        const focus = readFileSync(join(dir, "focus-adapter-entry.ts"), "utf8");
        const movement = readFileSync(join(dir, "movement-adapter-entry.ts"), "utf8");
        const resize = readFileSync(join(dir, "resize-adapter-entry.ts"), "utf8");
        const pointer = readFileSync(join(dir, "pointer-resize-adapter-entry.ts"), "utf8");
        const capability = readFileSync(join(dir, "signal-capability.ts"), "utf8");
        for (const body of [focus, movement, resize]) {
            for (const name of ["windowActivated", "windowAdded", "windowRemoved", "screensChanged", "currentDesktopChanged"]) {
                assert.ok(body.includes(`"${name}"`), `entry must name workspace signal ${name}`);
            }
        }
        for (const body of [movement, resize, pointer]) {
            assert.ok(body.includes('"moveResizedChanged"'), "entry must name per-window moveResizedChanged");
        }
        for (const name of ["interactiveMoveResizeStarted", "interactiveMoveResizeStepped", "interactiveMoveResizeFinished"]) {
            assert.ok(pointer.includes(`"${name}"`), `pointer entry must name ${name}`);
        }
        assert.ok(pointer.includes('readSignal(ref, "interactiveMoveResizeStarted")'), "pointer started signal owner is the window ref");
        assert.ok(pointer.includes('readSignal(ref, "interactiveMoveResizeStepped")'), "pointer stepped signal owner is the window ref");
        assert.ok(pointer.includes('readSignal(ref, "interactiveMoveResizeFinished")'), "pointer finished signal owner is the window ref");
        assert.ok(pointer.includes('readSignal(ref, "moveResizedChanged")'), "pointer geometry signal owner is the window ref");
        assert.ok(pointer.includes("onStepped"), "pointer entry must keep the stepped payload callback");
        assert.ok(pointer.includes("adapter.windowStepped(ref, payload)"), "stepped payload must forward exact native ref plus payload");
        const globals = readFileSync(join(dir, "kwin-globals.d.ts"), "utf8");
        assert.ok(globals.includes("interactiveMoveResizeStepped"));
        assert.ok(globals.includes("Signal1<Rect>"));
        assert.ok(globals.includes("interface Window"));
        for (const body of [focus, movement, resize, pointer, capability]) {
            assert.ok(!body.includes("globalThis"), "no dynamic global discovery");
            assert.ok(!body.includes("Function("), "no dynamic function construction");
            assert.ok(!body.includes("setTimeout"), "no polling timers");
            assert.ok(!body.includes("setInterval"), "no polling timers");
            assert.ok(!body.includes("pollFor"), "no polling");
            assert.ok(!body.includes("fallback"), "no fallback");
            assert.ok(!/legacy/i.test(body), "no Legacy fallback");
        }
        const authority = readFileSync(join(dir, "engine-authority.ts"), "utf8");
        assert.ok(!authority.includes("globalThis"));
        assert.ok(!authority.includes("Function("));
        assert.ok(!authority.includes("setTimeout"));
        assert.ok(!authority.includes("setInterval"));
        assert.ok(!authority.includes("pollFor"));
        assert.ok(!authority.includes("fallback"));
        assert.ok(!authority.includes("drag-attach"));
        assert.ok(!authority.includes("startup-handlers"));
    });

    it("declares the strict packaged setting in schema and UI", () => {
        const schema = readFileSync(join(kwinSrcDir(), "..", "contents", "config", "main.xml"), "utf8");
        assert.match(schema, /<entry name="engineAuthorityMode" type="Enum">/);
        assert.match(schema, /<default>legacy<\/default>/);
        assert.match(schema, /<choice name="legacy" value="legacy"\/>/);
        assert.match(schema, /<choice name="rust-development" value="rust-development"\/>/);
        const ui = readFileSync(join(kwinSrcDir(), "..", "contents", "ui", "config.ui"), "utf8");
        assert.match(ui, /name="kcfg_engineAuthorityMode"/);
    });
});

describe("engine authority lazy one-shot retry", () => {
    function flakyStarts(options: {
        readonly calls: Array<{ readonly slice: string; readonly revision: unknown }>;
        readonly requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }>;
        readonly stops: string[];
        readonly adoptions: string[];
        readonly failFirstFocus: boolean;
    }): EngineAuthorityStarts {
        let attempts = 0;
        const attemptOf = (): number => Math.floor(options.calls.length / 4);
        void attempts;
        return {
            startFocus: (args) => {
                options.calls.push({ slice: "focus", revision: args.revision });
                if (options.failFirstFocus && attemptOf() === 0) {
                    return null;
                }
                return {
                    stop: () => {
                        options.stops.push("focus");
                    },
                    request: (direction: unknown) => {
                        options.requests.push({ slice: "focus", args: [direction] });
                    },
                };
            },
            startMovement: (args) => {
                options.calls.push({ slice: "movement", revision: args.revision });
                return {
                    stop: () => {
                        options.stops.push("movement");
                    },
                    request: (direction: unknown) => {
                        options.requests.push({ slice: "movement", args: [direction] });
                    },
                };
            },
            startResize: (args) => {
                options.calls.push({ slice: "resize", revision: args.revision });
                return {
                    stop: () => {
                        options.stops.push("resize");
                    },
                    request: (direction: unknown, mode: unknown) => {
                        options.requests.push({ slice: "resize", args: [direction, mode] });
                    },
                    tryBootstrapTrio: () => {
                        options.adoptions.push("resize");
                    },
                };
            },
            startPointerResize: (args) => {
                options.calls.push({ slice: "pointer", revision: args.revision });
                return {
                    stop: () => {
                        options.stops.push("pointer");
                    },
                };
            },
        };
    }

    it("retries exactly once on the first command after boot failure, then stays idempotent", () => {
        const calls: Array<{ readonly slice: string; readonly revision: unknown }> = [];
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const stops: string[] = [];
        const adoptions: string[] = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority(
            "rust-development",
            flakyStarts({ calls, requests, stops, adoptions, failFirstFocus: true }),
            (message) => {
                logs.push(message);
            },
        );
        assert.equal(dispatcher.start(), false);
        assert.equal(dispatcher.isRustActive(), false);
        assert.equal(calls.length, 4);
        assert.deepEqual(adoptions, []);
        dispatcher.requestFocus("left");
        assert.equal(dispatcher.isRustActive(), true);
        assert.equal(calls.length, 8);
        assert.deepEqual(adoptions, ["resize"]);
        assert.deepEqual(
            requests.map((entry) => [entry.slice, ...entry.args]),
            [["focus", "left"]],
        );
        for (const call of calls) {
            assert.equal(call.revision, calls[0]?.revision);
        }
        dispatcher.requestMove("right");
        dispatcher.requestResize("up", "outwards");
        dispatcher.focusOrResize("down");
        assert.equal(calls.length, 8);
        assert.deepEqual(adoptions, ["resize"]);
        assert.deepEqual(
            requests.map((entry) => [entry.slice, ...entry.args]),
            [
                ["focus", "left"],
                ["movement", "right"],
                ["resize", "up", "outwards"],
                ["focus", "down"],
            ],
        );
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-unavailable")));
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-ready")));
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));
    });

    it("cleans partial attachment on failed retry and refuses without further retries", () => {
        const calls: Array<{ readonly slice: string; readonly owner: unknown; readonly generation: unknown; readonly revision: unknown; readonly authorityType: string }> = [];
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts({ fail: "movement", calls, requests }), (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        assert.equal(dispatcher.isRustActive(), false);
        assert.equal(calls.length, 4);
        dispatcher.requestMove("left");
        assert.equal(dispatcher.isRustActive(), false);
        assert.equal(calls.length, 8);
        assert.equal(requests.length, 0);
        dispatcher.requestFocus("left");
        dispatcher.requestMove("left");
        dispatcher.requestResize("left", "outwards");
        dispatcher.focusOrResize("left");
        assert.equal(calls.length, 8);
        assert.equal(requests.length, 0);
        assert.equal(dispatcher.isRustActive(), false);
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-unavailable")));
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-refused")));
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));
    });

    it("attributes the failed attach slice on init loss and consumed retry with no legacy and clean teardown", () => {
        const calls: Array<{ readonly slice: string; readonly owner: unknown; readonly generation: unknown; readonly revision: unknown; readonly authorityType: string }> = [];
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts({ fail: "movement", calls, requests }), (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        assert.equal(dispatcher.isRustActive(), false);
        assert.equal(calls.length, 4);
        // Physical Meta+Right reaches command delivery then fail-closes on the
        // single lazy retry.
        dispatcher.requestFocus("right");
        assert.equal(dispatcher.isRustActive(), false);
        assert.equal(calls.length, 8);
        assert.equal(requests.length, 0);
        // Retry consumed: no further attach attempts.
        dispatcher.requestFocus("right");
        assert.equal(calls.length, 8);
        assert.equal(requests.length, 0);
        assert.equal(dispatcher.isRustActive(), false);
        const attach = logs.filter((line) => line.includes("route-diag:attach:"));
        assert.equal(attach.length, 2);
        for (const line of attach) {
            assert.ok(line.includes("result=unavailable"), line);
            assert.ok(line.includes("slices=4"), line);
            assert.ok(line.includes("failed=movement"), line);
        }
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-command:focus:right")));
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-unavailable")));
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-refused")));
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));
        dispatcher.stop();
        assert.equal(dispatcher.isRustActive(), false);
        assert.equal(requests.length, 0);
    });

    it("bounds multi-slice attach loss to one token and keeps successful attach without attribution", () => {
        const allNull: EngineAuthorityStarts = {
            startFocus: () => null,
            startMovement: () => null,
            startResize: () => null,
            startPointerResize: () => null,
        };
        const logs: string[] = [];
        const failed = createEngineAuthority("rust-development", allNull, (message) => {
            logs.push(message);
        });
        assert.equal(failed.start(), false);
        const attach = logs.filter((line) => line.includes("route-diag:attach:"));
        assert.equal(attach.length, 1);
        assert.ok(attach[0] !== undefined);
        assert.ok(attach[0].includes("failed=multiple"), attach[0]);
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));

        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const readyLogs: string[] = [];
        const ready = createEngineAuthority("rust-development", fakeStarts({ requests }), (message) => {
            readyLogs.push(message);
        });
        assert.equal(ready.start(), true);
        const readyAttach = readyLogs.filter((line) => line.includes("route-diag:attach:"));
        assert.equal(readyAttach.length, 1);
        assert.ok(readyAttach[0] !== undefined);
        assert.ok(readyAttach[0].includes("result=ready"), readyAttach[0]);
        assert.ok(!readyAttach[0].includes("failed="), readyAttach[0]);
    });
});

describe("engine authority keyboard delivery diagnostic", () => {
    function commandLines(logs: readonly string[]): string[] {
        return logs.filter((line) => line.includes("engine-authority-rust-command:"));
    }

    it("emits one fixed action-identifying token per routed command with no duplicates", () => {
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts({ requests }), (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), true);
        logs.length = 0;
        dispatcher.requestFocus("left");
        dispatcher.requestMove("right");
        dispatcher.requestResize("up", "outwards");
        dispatcher.enterOrExitRustResizeMode("inwards");
        assert.deepEqual(commandLines(logs), [
            "plasma-auto-tiler:engine-authority-rust-command:focus:left",
            "plasma-auto-tiler:engine-authority-rust-command:move:right",
            "plasma-auto-tiler:engine-authority-rust-command:resize:up:outwards",
            "plasma-auto-tiler:engine-authority-rust-command:resize-mode:inwards",
        ]);
        assert.deepEqual(
            requests.map((entry) => [entry.slice, ...entry.args]),
            [
                ["focus", "left"],
                ["movement", "right"],
                ["resize", "up", "outwards"],
            ],
        );
        // focusOrResize delegates to exactly one leaf, so one physical press
        // logs exactly one delivery token (fresh dispatcher with no armed
        // resize mode, hence the focus leaf).
        const soloRequests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const soloLogs: string[] = [];
        const solo = createEngineAuthority("rust-development", fakeStarts({ requests: soloRequests }), (message) => {
            soloLogs.push(message);
        });
        assert.equal(solo.start(), true);
        solo.focusOrResize("down");
        assert.deepEqual(commandLines(soloLogs), [
            "plasma-auto-tiler:engine-authority-rust-command:focus:down",
        ]);
        assert.deepEqual(
            soloRequests.map((entry) => [entry.slice, ...entry.args]),
            [["focus", "down"]],
        );
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));
    });

    it("proves delivery before the first-command retry outcome and stays idempotent", () => {
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts({ requests }), (message) => {
            logs.push(message);
        });
        // No explicit start(): the first keyboard command is the retry route.
        dispatcher.requestFocus("left");
        assert.equal(dispatcher.isRustActive(), true);
        assert.deepEqual(
            requests.map((entry) => [entry.slice, ...entry.args]),
            [["focus", "left"]],
        );
        const delivery = logs.findIndex((line) =>
            line.includes("engine-authority-rust-command:focus:left"),
        );
        const ready = logs.findIndex((line) => line.includes("engine-authority-rust-ready"));
        assert.ok(delivery >= 0, "delivery token must be present");
        assert.ok(ready >= 0, "retry outcome must be present");
        assert.ok(delivery < ready, "delivery must precede the retry outcome");
        dispatcher.requestMove("right");
        assert.deepEqual(
            requests.map((entry) => [entry.slice, ...entry.args]),
            [
                ["focus", "left"],
                ["movement", "right"],
            ],
        );
        assert.equal(
            logs.filter((line) => line.includes("engine-authority-rust-ready")).length,
            1,
            "no duplicate retry after activation",
        );
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-command:move:right")));
        assert.ok(logs.every((line) => !line.toLowerCase().includes("legacy")));
    });

    it("stays silent in legacy mode while still refusing", () => {
        const requests: Array<{ readonly slice: string; readonly args: readonly unknown[] }> = [];
        const logs: string[] = [];
        const dispatcher = createEngineAuthority("legacy", fakeStarts({ requests }), (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        dispatcher.requestFocus("left");
        dispatcher.requestMove("left");
        dispatcher.focusOrResize("left");
        assert.equal(requests.length, 0);
        assert.deepEqual(commandLines(logs), []);
        assert.ok(logs.some((line) => line.includes("engine-authority-rust-refused")));
    });
});
