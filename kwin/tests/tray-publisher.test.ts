import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { MAX_SIGNED_REVISION, TrayPublisher } from "../src/tray-publisher";

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
        /trayTimers\.add\(timer\);[\s\S]*timer\.timeout\.connect\(\(\) => \{[\s\S]*callback\(\);[\s\S]*finally \{[\s\S]*trayTimers\.delete\(timer\);/,
    );
});

function setupWithLog(initialEnabled = true, generations = ["first", "second"]): {
    readonly publisher: TrayPublisher;
    readonly snapshots: Snapshot[];
    readonly lines: string[];
    readonly heartbeat: () => void;
    readonly setEnabled: (value: boolean) => void;
} {
    let enabled = initialEnabled;
    let heartbeat: (() => void) | undefined;
    const snapshots: Snapshot[] = [];
    const lines: string[] = [];
    const publisher = new TrayPublisher({
        isEnabled: () => enabled,
        publishSnapshot: (schema, generation, revision, currentEnabled) => {
            snapshots.push({ schema, generation, revision, enabled: currentEnabled });
        },
        scheduleOnce: (_delayMs, callback) => {
            heartbeat = callback;
        },
        createGeneration: () => {
            const generation = generations.shift();
            assert.ok(generation);
            return generation;
        },
        log: (message) => {
            lines.push(message);
        },
    });
    publisher.start();
    assert.ok(heartbeat);
    return {
        publisher,
        snapshots,
        lines,
        heartbeat,
        setEnabled: (value) => {
            enabled = value;
        },
    };
}

test("emits bounded lifecycle and send-initiation lines only for state changes", () => {
    const state = setupWithLog();

    assert.deepEqual(state.lines, [
        "plasma-auto-tiler:route-diag component=tray stage=tray event=started outcome=ok",
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok generation=first revision=0 enabled=true",
    ]);

    state.heartbeat();
    assert.equal(state.lines.length, 2);
    assert.equal(state.snapshots.length, 2);

    state.setEnabled(false);
    state.publisher.notifyEnabledChanged(false);
    assert.deepEqual(state.lines.slice(2), [
        "plasma-auto-tiler:route-diag component=tray stage=tray event=enabled-changed outcome=ok",
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok generation=first revision=1 enabled=false",
    ]);

    state.publisher.notifyEnabledChanged(false);
    assert.equal(state.lines.length, 4);

    state.publisher.dispose();
    assert.deepEqual(state.lines.slice(4), [
        "plasma-auto-tiler:route-diag component=tray stage=tray event=stopped outcome=ok",
    ]);

    state.publisher.dispose();
    assert.equal(state.lines.length, 5);

    for (const line of state.lines) {
        assert.match(
            line,
            /^plasma-auto-tiler:route-diag component=tray stage=(tray|bridge) event=[a-z-]+ outcome=(ok|failed)( generation=[a-z0-9-]{1,32} revision=-?[0-9]+ enabled=(true|false))?$/,
        );
    }
    // Join identity lives only on bridge send lines: the lifecycle records
    // carry no snapshot payload, and the bridge identity matches exactly the
    // snapshot handed to publishSnapshot (join by equality, never ancestry).
    const bridge = state.lines.filter((line) => line.includes("stage=bridge"));
    assert.deepEqual(bridge, [
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok generation=first revision=0 enabled=true",
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok generation=first revision=1 enabled=false",
    ]);
    assert.deepEqual(
        bridge.map((line) => {
            const generation = / generation=([a-z0-9-]+)/.exec(line)?.[1];
            const revision = Number(/ revision=(-?[0-9]+)/.exec(line)?.[1]);
            const enabled = / enabled=(true|false)/.exec(line)?.[1] === "true";
            return { generation, revision, enabled };
        }),
        [
            { generation: "first", revision: 0, enabled: true },
            { generation: "first", revision: 1, enabled: false },
        ],
    );
    assert.deepEqual(
        state.snapshots.slice(0, 3).map((snapshot) => [snapshot.generation, snapshot.revision, snapshot.enabled]),
        [
            ["first", 0, true],
            ["first", 0, true],
            ["first", 1, false],
        ],
    );
});

test("send failure emits a bounded refusal without error text", () => {
    const lines: string[] = [];
    let heartbeat: (() => void) | undefined;
    const publisher = new TrayPublisher({
        isEnabled: () => true,
        publishSnapshot: () => {
            throw new Error("transport unavailable: secret-payload");
        },
        scheduleOnce: (_delayMs, callback) => {
            heartbeat = callback;
        },
        createGeneration: () => "first",
        log: (message) => {
            lines.push(message);
        },
    });

    publisher.start();
    assert.deepEqual(lines, [
        "plasma-auto-tiler:route-diag component=tray stage=tray event=started outcome=ok",
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-failed outcome=failed generation=first revision=0 enabled=true",
    ]);
    for (const line of lines) {
        assert.ok(!line.includes("transport") && !line.includes("secret"));
    }

    assert.ok(heartbeat);
    heartbeat();
    assert.equal(lines.length, 2);
});

function setupFlakyTransport(): {
    readonly publisher: TrayPublisher;
    readonly lines: string[];
    readonly heartbeat: () => void;
    failNext: (value: boolean) => void;
    readonly attempts: () => number;
} {
    const lines: string[] = [];
    let heartbeat: (() => void) | undefined;
    let failing = false;
    let attempts = 0;
    const publisher = new TrayPublisher({
        isEnabled: () => true,
        publishSnapshot: () => {
            attempts += 1;
            if (failing) {
                throw new Error("transport unavailable");
            }
        },
        scheduleOnce: (_delayMs, callback) => {
            heartbeat = callback;
        },
        createGeneration: () => "first",
        log: (message) => {
            lines.push(message);
        },
    });
    publisher.start();
    assert.ok(heartbeat);
    return {
        publisher,
        lines,
        heartbeat,
        failNext: (value) => {
            failing = value;
        },
        attempts: () => attempts,
    };
}

test("a heartbeat failure after an initial success becomes visible once", () => {
    const state = setupFlakyTransport();
    assert.deepEqual(state.lines, [
        "plasma-auto-tiler:route-diag component=tray stage=tray event=started outcome=ok",
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok generation=first revision=0 enabled=true",
    ]);

    state.failNext(true);
    state.heartbeat();
    assert.deepEqual(state.lines.slice(2), [
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-failed outcome=failed generation=first revision=0 enabled=true",
    ]);
    assert.equal(state.attempts(), 2);
});

test("repeated identical heartbeat failures stay silent", () => {
    const state = setupFlakyTransport();
    state.failNext(true);
    state.heartbeat();
    assert.equal(state.lines.length, 3);

    state.heartbeat();
    state.heartbeat();
    assert.equal(state.lines.length, 3);
    assert.equal(state.attempts(), 4);
});

test("heartbeat recovery to success is visible, then steady state is silent", () => {
    const state = setupFlakyTransport();
    state.failNext(true);
    state.heartbeat();
    assert.equal(state.lines.length, 3);

    state.failNext(false);
    state.heartbeat();
    assert.deepEqual(state.lines.slice(3), [
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok generation=first revision=0 enabled=true",
    ]);

    state.heartbeat();
    assert.equal(state.lines.length, 4);
});

test("a later distinct heartbeat failure is visible again", () => {
    const state = setupFlakyTransport();
    state.failNext(true);
    state.heartbeat();
    assert.equal(state.lines.length, 3);

    // Same snapshot keeps failing silently.
    state.heartbeat();
    assert.equal(state.lines.length, 3);

    // Recovery clears the memory; the next failure for any snapshot emits.
    state.failNext(false);
    state.heartbeat();
    assert.equal(state.lines.length, 4);

    state.failNext(true);
    state.heartbeat();
    assert.deepEqual(state.lines.slice(4), [
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-failed outcome=failed generation=first revision=0 enabled=true",
    ]);
    // Identical repeats after the second report stay silent again.
    state.heartbeat();
    assert.equal(state.lines.length, 5);
});

test("an unvalidated generation token is omitted from diagnostics, never echoed", () => {
    const lines: string[] = [];
    const publisher = new TrayPublisher({
        isEnabled: () => true,
        publishSnapshot: () => {},
        scheduleOnce: () => {},
        createGeneration: () => "BAD\ninjected generation=true",
        log: (message) => {
            lines.push(message);
        },
    });

    publisher.start();
    assert.deepEqual(lines, [
        "plasma-auto-tiler:route-diag component=tray stage=tray event=started outcome=ok",
        "plasma-auto-tiler:route-diag component=tray stage=bridge event=send-initiated outcome=ok revision=0 enabled=true",
    ]);
    assert.ok(!lines.join("\n").includes("BAD"));
    assert.ok(!lines.join("\n").includes("injected"));
});

test("a throwing log sink never interferes with publication", () => {
    const snapshots: Snapshot[] = [];
    const publisher = new TrayPublisher({
        isEnabled: () => true,
        publishSnapshot: (schema, generation, revision, enabled) => {
            snapshots.push({ schema, generation, revision, enabled });
        },
        scheduleOnce: () => {},
        createGeneration: () => "first",
        log: () => {
            throw new Error("sink down");
        },
    });

    publisher.start();
    publisher.notifyEnabledChanged(false);
    publisher.dispose();
    assert.deepEqual(snapshots, [
        { schema: 1, generation: "first", revision: 0, enabled: true },
        { schema: 1, generation: "first", revision: 1, enabled: false },
    ]);
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
