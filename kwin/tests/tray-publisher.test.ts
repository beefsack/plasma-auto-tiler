import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { MAX_SIGNED_REVISION, TrayPublisher } from "../src/tray-publisher";
import { window } from "./controller-fixtures";
import { dragSetup, movedGeometry, setup as controllerSetup, startDrag } from "./controller-fixture-scenarios";

interface TrayFixture {
    readonly contract: {
        readonly service: string;
        readonly object: string;
        readonly interface: string;
        readonly method: string;
        readonly schema: number;
        readonly generationPattern: string;
    };
}

interface Snapshot {
    readonly schema: number;
    readonly generation: string;
    readonly revision: number;
    readonly enabled: boolean;
}

function fixture(): TrayFixture {
    const path = process.env.TRAY_BRIDGE_FIXTURE;
    assert.ok(path, "TRAY_BRIDGE_FIXTURE is required");
    return JSON.parse(readFileSync(path, "utf8")) as TrayFixture;
}

function entrySource(): string {
    const path = process.env.TRAY_BRIDGE_FIXTURE;
    assert.ok(path, "TRAY_BRIDGE_FIXTURE is required");
    return readFileSync(resolve(dirname(path), "../kwin/src/entry.ts"), "utf8");
}

function setup(initialEnabled = true, generations = ["first", "second"]): {
    readonly publisher: TrayPublisher;
    readonly snapshots: Snapshot[];
    readonly heartbeat: () => void;
    readonly scheduleCount: () => number;
    readonly cancelCount: () => number;
    readonly setEnabled: (value: boolean) => void;
} {
    let enabled = initialEnabled;
    let heartbeat: (() => void) | undefined;
    let schedules = 0;
    let cancellations = 0;
    const snapshots: Snapshot[] = [];
    const publisher = new TrayPublisher({
        isEnabled: () => enabled,
        publishSnapshot: (schema, generation, revision, currentEnabled) => {
            snapshots.push({ schema, generation, revision, enabled: currentEnabled });
        },
        scheduleOnce: (_delayMs, callback) => {
            schedules += 1;
            heartbeat = callback;
            return () => {
                cancellations += 1;
            };
        },
        createGeneration: () => {
            const generation = generations.shift();
            assert.ok(generation);
            return generation;
        },
    });
    publisher.start();
    assert.ok(heartbeat);
    return {
        publisher,
        snapshots,
        heartbeat,
        scheduleCount: () => schedules,
        cancelCount: () => cancellations,
        setEnabled: (value) => {
            enabled = value;
        },
    };
}

test("publishes the startup snapshot and retries it on each heartbeat", () => {
    const contract = fixture().contract;
    const state = setup();

    assert.deepEqual(state.snapshots, [{ schema: contract.schema, generation: "first", revision: 0, enabled: true }]);
    assert.match("first", new RegExp(contract.generationPattern));

    state.heartbeat();
    assert.deepEqual(state.snapshots[state.snapshots.length - 1], {
        schema: 1,
        generation: "first",
        revision: 0,
        enabled: true,
    });
    assert.equal(state.snapshots.length, 2);

    state.setEnabled(false);
    state.heartbeat();
    assert.deepEqual(state.snapshots[state.snapshots.length - 1], {
        schema: 1,
        generation: "first",
        revision: 0,
        enabled: true,
    });
});

test("increments revision only when enabled changes", () => {
    const state = setup();

    state.publisher.notifyEnabledChanged(false);
    assert.deepEqual(state.snapshots[state.snapshots.length - 1], {
        schema: 1,
        generation: "first",
        revision: 1,
        enabled: false,
    });

    state.publisher.notifyEnabledChanged(false);
    assert.deepEqual(state.snapshots[state.snapshots.length - 1], {
        schema: 1,
        generation: "first",
        revision: 1,
        enabled: false,
    });
});

test("publishes both immediate enabled transitions without duplicate same-state revisions", () => {
    const state = setup(false);

    state.publisher.notifyEnabledChanged(true);
    state.publisher.notifyEnabledChanged(true);
    state.publisher.notifyEnabledChanged(false);

    assert.deepEqual(state.snapshots, [
        { schema: 1, generation: "first", revision: 0, enabled: false },
        { schema: 1, generation: "first", revision: 1, enabled: true },
        { schema: 1, generation: "first", revision: 2, enabled: false },
    ]);
});

test("rolls generation when an enabled transition reaches the signed revision limit", () => {
    const state = setup();
    const internals = state.publisher as unknown as { revision: number };
    internals.revision = MAX_SIGNED_REVISION;
    state.setEnabled(false);

    state.publisher.notifyEnabledChanged(false);

    assert.deepEqual(state.snapshots[state.snapshots.length - 1], {
        schema: 1,
        generation: "second",
        revision: 0,
        enabled: false,
    });
});

test("retries after a one-way transport failure", () => {
    let enabled = true;
    let heartbeat: (() => void) | undefined;
    let attempts = 0;
    const publisher = new TrayPublisher({
        isEnabled: () => enabled,
        publishSnapshot: () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error("transport unavailable");
            }
        },
        scheduleOnce: (_delayMs, callback) => {
            heartbeat = callback;
        },
        createGeneration: () => "first",
    });

    publisher.start();
    assert.ok(heartbeat);
    heartbeat();
    assert.equal(attempts, 2);
    enabled = false;
    publisher.notifyEnabledChanged(false);
    assert.equal(attempts, 3);
});

test("retries a failed immediate transition on heartbeat without another revision", () => {
    let enabled = true;
    let heartbeat: (() => void) | undefined;
    let attempts = 0;
    const publisher = new TrayPublisher({
        isEnabled: () => enabled,
        publishSnapshot: () => {
            attempts += 1;
            if (attempts === 2) {
                throw new Error("transition transport unavailable");
            }
        },
        scheduleOnce: (_delayMs, callback) => {
            heartbeat = callback;
        },
        createGeneration: () => "first",
    });

    publisher.start();
    enabled = false;
    publisher.notifyEnabledChanged(false);
    assert.equal(attempts, 2);
    assert.ok(heartbeat);

    heartbeat();
    assert.equal(attempts, 3);
    const internals = publisher as unknown as { revision: number; enabled: boolean };
    assert.equal(internals.revision, 1);
    assert.equal(internals.enabled, false);
});

test("retains each tray timer through its timeout callback", () => {
    const source = entrySource();
    const scheduleOnce = source.slice(source.lastIndexOf("const trayTimers ="));

    assert.match(scheduleOnce, /const trayTimers = new Set<QTimer>\(\);/);
    assert.match(
        scheduleOnce,
        /trayTimers\.add\(timer\);[\s\S]*timer\.timeout\?\.connect\(\(\) => \{[\s\S]*callback\(\);[\s\S]*finally \{[\s\S]*trayTimers\.delete\(timer\);/,
    );
});

test("does not publish or reschedule after disposal", () => {
    const state = setup();
    const schedules = state.scheduleCount();
    state.publisher.dispose();

    state.heartbeat();

    assert.equal(state.snapshots.length, 1);
    assert.equal(state.scheduleCount(), schedules);
    assert.equal(state.cancelCount(), 1);
});

test("publishes controller disable immediately without affecting pointer drag handling", () => {
    let publisher: TrayPublisher | undefined;
    const state = controllerSetup((enabled) => publisher?.notifyEnabledChanged(enabled));
    const snapshots: Snapshot[] = [];
    publisher = new TrayPublisher({
        isEnabled: () => state.controller.isEnabled,
        publishSnapshot: (schema, generation, revision, enabled) => {
            snapshots.push({ schema, generation, revision, enabled });
        },
        scheduleOnce: (_delayMs, callback) => {
            state.harness.scheduled.push({ delayMs: 1000, callback, cancelled: false });
        },
        createGeneration: () => "first",
    });
    publisher.start();

    state.target.split = () => {
        throw new Error("split failed");
    };
    state.controller.armKeyboardInsertion("right");
    state.harness.emitAdded(window());

    assert.equal(state.controller.isEnabled, false);
    assert.deepEqual(snapshots, [
        { schema: 1, generation: "first", revision: 0, enabled: true },
        { schema: 1, generation: "first", revision: 1, enabled: false },
    ]);
    state.controller.armKeyboardInsertion("right");
    assert.equal(snapshots.length, 2);

    const drag = dragSetup();
    startDrag(drag.dragged);
    drag.harness.cursor = { x: 60, y: 60 };
    drag.dragged.frameGeometry = movedGeometry();
    drag.dragged.tile = null;
    drag.dragged.interactiveMoveResizeFinished.emit();
    assert.equal(drag.controller.isEnabled, true);
});
