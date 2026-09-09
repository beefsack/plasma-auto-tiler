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

describe("engine authority dispatcher", () => {
    it("binds revision 0 to the initial Rust seed revision (member count)", () => {
        // Adapters auto-bind revision 0 to the normalized observed membership
        // size N (focus-adapter, movement-adapter, resize-adapter,
        // pointer-resize-adapter: `if (requestRevision === 0)
        // requestRevision = sortedIds.length`). The packaged binding must be
        // exactly 0 so the first request carries the Rust post-seed base.
        assert.equal(ENGINE_AUTHORITY_REVISION, 0);
    });

    it("starts all four slices with one exact owner, generation, and revision binding", () => {
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
            assert.equal(call.revision, ENGINE_AUTHORITY_REVISION);
            assert.equal(call.authorityType, "function");
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
