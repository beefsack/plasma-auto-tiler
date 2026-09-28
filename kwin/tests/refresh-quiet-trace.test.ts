import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

function harnessSource(): string {
    const adapterPath = resolve(process.cwd(), "src", "plan-adapter.ts").replace(/\\/g, "/");
    const gapPath = resolve(process.cwd(), "src", "domain-gap.ts").replace(/\\/g, "/");
    return `
import { PLAN_DEBOUNCE_MS, PlanAdapter } from ${JSON.stringify(adapterPath)};
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from ${JSON.stringify(gapPath)};

type Timer = { delayMs: number; callback: () => void; cancelled: boolean };

export function runRefresh(): string[] {
    const refA: object = {};
    const refB: object = {};
    let rectA = { x: 0, y: 0, w: 600, h: 800 };
    const rectB = { x: 600, y: 0, w: 600, h: 800 };
    const calls: Array<{ payload: string }> = [];
    const callbacks: Array<(reply: unknown) => void> = [];
    const timers: Timer[] = [];
    const logs: string[] = [];
    const subs: Array<{ kind: string; handler: (t?: object) => void }> = [];
    const observe = (): unknown => ({
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-a",
        windows: Object.freeze([
            Object.freeze({ id: "win-a", ref: refA, rect: { ...rectA }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown" }),
            Object.freeze({ id: "win-b", ref: refB, rect: { ...rectB }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown" }),
        ]),
        activeRef: refA,
        fingerprint: "fp-1",
        revalidate: () => true,
    });
    const env: any = {
        callDbus: (_s: unknown, _p: unknown, _i: unknown, m: unknown, payload: string, callback: (r: unknown) => void): void => {
            if (m === "NameHasOwner") { callback(true); return; }
            if (m === "GetNameOwner") { callback(":1.7"); return; }
            if (m === "StartServiceByName") { callback(1); return; }
            calls.push({ payload });
            callbacks.push(callback);
        },
        scheduleOnce: (delayMs: number, callback: () => void): (() => void) => {
            const entry: Timer = { delayMs, callback, cancelled: false };
            timers.push(entry);
            return (): void => { entry.cancelled = true; };
        },
        log: (message: string): void => { logs.push(message); },
        observe,
        observeHidden: (): unknown[] => [],
        clearMaximize: (): string => "invoked",
        setGeometry: (): boolean => true,
        setActive: (): boolean => true,
        active: (): object | null => refA,
        subscribe: (kind: string, handler: (t?: object) => void): (() => void) => {
            subs.push({ kind, handler });
            return (): void => {};
        },
    };
    const runDebounce = (): void => {
        for (let round = 0; round < 16; round += 1) {
            const pending = [...timers];
            timers.length = 0;
            let fired = false;
            for (const timer of pending) {
                if (timer.cancelled) continue;
                if (timer.delayMs === PLAN_DEBOUNCE_MS) { timer.callback(); fired = true; }
                else timers.push(timer);
            }
            if (!fired) break;
        }
    };
    const answer = (index: number): void => {
        const payload = JSON.parse(calls[index]?.payload as string) as Record<string, unknown>;
        const domain = payload["domain"] as Record<string, unknown>;
        const windows = payload["windows"] as Array<Record<string, unknown>>;
        callbacks[index]?.(JSON.stringify({
            v: 1,
            correlation_id: payload["correlation_id"],
            outcome: "planned",
            desired_geometry: windows.map((entry) => ({
                window: entry["window"],
                leaf: String(entry["window"]) + "-leaf",
                output: domain["output"],
                workspace: domain["workspace"],
                rect: entry["rect"],
            })),
        }));
    };
    const fire = (kind: string): void => {
        for (const sub of subs) if (sub.kind === kind) sub.handler();
    };
    const adapter = new PlanAdapter(env);
    if (adapter.enable({ owner: "owner-1", generation: "gen-1" }) !== true) throw new Error("enable failed");
    fire("added");
    runDebounce();
    for (let i = 0; i < calls.length; i += 1) answer(i);
    runDebounce();
    // Identical observation: quiet equal classification expected (trace only).
    fire("geometry");
    runDebounce();
    // Drifted observation: ordinary change/dispatch classification expected.
    rectA = { x: 0, y: 0, w: 616, h: 800 };
    fire("geometry");
    runDebounce();
    return [...logs];
}

(globalThis as unknown as { PatRefreshQuiet: { runRefresh: () => string[] } }).PatRefreshQuiet = { runRefresh };
`;
}

function refreshLogs(define: string | null): string[] {
    const dir = mkdtempSync(join(tmpdir(), "pat-refresh-quiet-"));
    const entry = join(dir, "harness.ts");
    writeFileSync(entry, harnessSource());
    const outFile = join(dir, "out.js");
    const args = [
        "esbuild",
        entry,
        "--bundle",
        "--format=iife",
        "--target=es2017",
        "--global-name=PatRefreshQuiet",
        `--outfile=${outFile}`,
    ];
    if (define !== null) {
        args.push(`--define:__PLASMA_AUTO_TILER_TRACE__=${JSON.stringify(define)}`);
    }
    execFileSync("npx", args, { cwd: process.cwd(), stdio: "pipe" });
    const context = createContext({});
    runInContext(readFileSync(outFile, "utf8"), context, { filename: outFile });
    const global = (context as unknown as { PatRefreshQuiet?: { runRefresh: () => string[] } }).PatRefreshQuiet;
    assert.ok(global !== undefined, "refresh harness IIFE must be exposed");
    return global.runRefresh();
}

function refreshLines(logs: string[]): string[] {
    return logs.filter((line) =>
        line.startsWith("plasma-auto-tiler:route-diag component=cosmic-plan route=plan stage=refresh "),
    );
}

describe("refresh quiet classifications are trace-only", () => {
    it("emits terminal=quiet only in trace builds while dispatch stays visible", () => {
        const trace = refreshLines(refreshLogs("1"));
        const quietTrace = trace.filter((line) => line.includes("terminal=quiet"));
        const dispatchTrace = trace.filter((line) => line.includes("terminal=dispatch"));
        assert.ok(quietTrace.length >= 1, `trace build must keep quiet equality, got:\n${trace.join("\n")}`);
        assert.ok(dispatchTrace.length >= 1, `trace build must keep dispatch, got:\n${trace.join("\n")}`);

        const normal = refreshLines(refreshLogs(null));
        const quietNormal = normal.filter((line) => line.includes("terminal=quiet"));
        const dispatchNormal = normal.filter((line) => line.includes("terminal=dispatch"));
        assert.equal(quietNormal.length, 0, `normal build must suppress quiet, got:\n${normal.join("\n")}`);
        assert.ok(dispatchNormal.length >= 1, `normal build must keep dispatch, got:\n${normal.join("\n")}`);
    });
});
