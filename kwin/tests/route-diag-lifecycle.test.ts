import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatLifecycleDiag, formatRouteDiag, PointerCoalescer } from "../src/route-diag";
import { TrayPublisher } from "../src/tray-publisher";

function diagLines(logs: readonly string[]): string[] {
    return logs.filter((line) => line.includes("plasma-auto-tiler:route-diag:"));
}

function setupPublisher(opts?: {
    readonly publishThrows?: boolean;
    readonly logThrows?: boolean;
    readonly generation?: string;
}): {
    readonly publisher: TrayPublisher;
    readonly logs: string[];
    readonly snapshots: number;
    readonly heartbeat: () => void;
} {
    const logs: string[] = [];
    let snapshots = 0;
    let heartbeat: (() => void) | undefined;
    const publisher = new TrayPublisher({
        isEnabled: () => true,
        publishSnapshot: () => {
            snapshots += 1;
            if (opts?.publishThrows === true) {
                throw new Error("transport unavailable");
            }
        },
        scheduleOnce: (_delayMs, callback) => {
            heartbeat = callback;
        },
        createGeneration: () => opts?.generation ?? "test-gen-1",
        log: (message) => {
            if (opts?.logThrows === true) {
                throw new Error("log sink failed");
            }
            logs.push(message);
        },
    });
    assert.ok(heartbeat === undefined);
    publisher.start();
    assert.ok(heartbeat !== undefined);
    return {
        publisher,
        logs,
        get snapshots() {
            return snapshots;
        },
        heartbeat: heartbeat as () => void,
    };
}

describe("route-diag lifecycle schema", () => {
    it("formats closed-vocabulary lifecycle lines with validated generation", () => {
        assert.equal(
            formatLifecycleDiag("tray", "started", "packaged-rust-1", 0, "ok"),
            "plasma-auto-tiler:route-diag:lifecycle:comp=tray:event=started:gen=packaged-rust-1:rev=0:result=ok",
        );
        assert.equal(
            formatLifecycleDiag("bridge", "published", "test-gen-1", 2, "ok"),
            "plasma-auto-tiler:route-diag:lifecycle:comp=bridge:event=published:gen=test-gen-1:rev=2:result=ok",
        );
    });

    it("never echoes sensitive bytes beyond a validated generation", () => {
        const line = formatLifecycleDiag(
            "tray;rm -rf",
            "start;ed",
            "secret generation!!",
            -5,
            "ok;injected",
        );
        assert.ok(line.includes("comp=unknown"), line);
        assert.ok(line.includes("event=unknown"), line);
        assert.ok(line.includes("gen=invalid"), line);
        assert.ok(line.includes("rev=unknown"), line);
        assert.ok(line.includes("result=unknown"), line);
        for (const forbidden of ["secret", "rm", ";", " ", "!!"]) {
            assert.ok(!line.includes(forbidden), `${line} must not contain ${forbidden}`);
        }
    });

    it("keeps the shared searchable prefix compatible with route lines", () => {
        const lifecycle = formatLifecycleDiag("tray", "started", "test-gen-1", 0, "ok");
        const route = formatRouteDiag("cmd", [
            ["seq", 1],
            ["kind", "focus"],
            ["detail", "right"],
            ["gen", "packaged-rust-1"],
            ["rev", 0],
        ]);
        assert.ok(lifecycle.startsWith("plasma-auto-tiler:route-diag:"));
        assert.ok(route.startsWith("plasma-auto-tiler:route-diag:"));
        assert.ok(lifecycle.includes(":lifecycle:"));
    });
});

describe("route-diag tray lifecycle sink", () => {
    it("logs start as tray started plus one bridge published line", () => {
        const state = setupPublisher();
        const lines = diagLines(state.logs);
        assert.equal(lines.length, 2);
        assert.ok(lines[0]?.includes("comp=tray:event=started"), lines[0] ?? "");
        assert.ok(lines[0]?.includes("gen=test-gen-1"), lines[0] ?? "");
        assert.ok(lines[1]?.includes("comp=bridge:event=published"), lines[1] ?? "");
        assert.ok(lines[1]?.includes("result=ok"), lines[1] ?? "");
    });

    it("logs enabled changes but keeps heartbeats silent", () => {
        const logs: string[] = [];
        let heartbeat: (() => void) | undefined;
        const publisher = new TrayPublisher({
            isEnabled: () => true,
            publishSnapshot: () => {},
            scheduleOnce: (_delayMs, callback) => {
                heartbeat = callback;
            },
            createGeneration: () => "test-gen-1",
            log: (message) => {
                logs.push(message);
            },
        });
        publisher.start();
        const afterStart = logs.length;
        assert.ok(heartbeat !== undefined);
        (heartbeat as () => void)();
        (heartbeat as () => void)();
        assert.equal(logs.length, afterStart);
        publisher.notifyEnabledChanged(false);
        const changed = diagLines(logs.slice(afterStart));
        assert.ok(changed.some((line) => line.includes("event=enabled-changed")), changed.join("\n"));
        assert.ok(changed.some((line) => line.includes("comp=bridge:event=published")), changed.join("\n"));
    });

    it("logs bridge send failures without changing publish decisions", () => {
        const state = setupPublisher({ publishThrows: true });
        const lines = diagLines(state.logs);
        assert.ok(
            lines.some((line) => line.includes("comp=bridge:event=send-failed:gen=test-gen-1")),
            lines.join("\n"),
        );
        assert.ok(
            lines.some((line) => line.includes("result=failed")),
            lines.join("\n"),
        );
        // The failed start still armed the heartbeat; the failure did not
        // strand the publisher.
        state.heartbeat();
    });

    it("logging failure never breaks publish decisions or heartbeat", () => {
        const state = setupPublisher({ logThrows: true });
        assert.equal(state.snapshots, 1);
        state.heartbeat();
        state.publisher.notifyEnabledChanged(false);
        state.publisher.dispose();
    });

    it("renders unvalidated generations as invalid without echoing them", () => {
        const state = setupPublisher({ generation: "BAD GEN!!" });
        const lines = diagLines(state.logs);
        assert.ok(lines.length > 0);
        for (const line of lines) {
            assert.ok(line.includes("gen=invalid"), line);
            assert.ok(!line.includes("BAD GEN!!"), line);
        }
    });
});

describe("route-diag pointer coalescing bound", () => {
    it("collapses per-step spam to one marker plus a bounded summary", () => {
        const coalescer = new PointerCoalescer();
        assert.equal(coalescer.flushSummary(), null);
        assert.equal(coalescer.noteCoalesced(), true);
        for (let index = 0; index < 99; index += 1) {
            assert.equal(coalescer.noteCoalesced(), false);
        }
        assert.equal(coalescer.count(), 100);
        assert.equal(
            coalescer.flushSummary(),
            "plasma-auto-tiler:route-diag:ptr:transition=coalesced:count=100",
        );
        assert.equal(coalescer.flushSummary(), null);
    });
});

describe("route-diag lifecycle vocabulary alignment", () => {
    it("covers the aligned owner-changed and seeded lifecycle events", () => {
        assert.equal(
            formatLifecycleDiag("tray", "owner-changed", "test-gen-1", 1, "ok"),
            "plasma-auto-tiler:route-diag:lifecycle:comp=tray:event=owner-changed:gen=test-gen-1:rev=1:result=ok",
        );
        assert.equal(
            formatLifecycleDiag("planner", "seeded", "test-gen-1", 3, "ok"),
            "plasma-auto-tiler:route-diag:lifecycle:comp=planner:event=seeded:gen=test-gen-1:rev=3:result=ok",
        );
    });
});
