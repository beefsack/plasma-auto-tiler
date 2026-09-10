// Bounded correlated route diagnostics for the KWin -> D-Bus -> Rust Planner path.
//
// One command correlates end-to-end via two opaque tokens:
// - `seq`: dispatcher-local monotonic command ordinal (per dispatcher
//   lifetime, one per physical command). Links the dispatcher `cmd` line to
//   the following `refused`/`retry` lines for the same press.
// - `corr`: adapter-generated per-request correlation (`<generation>-<slice><n>`).
//   Generated once per flight, echoed verbatim by Rust replies. Links adapter
//   `req`/`owner`/`result`/`ack`/`verify`/`outcome` lines to the Rust
//   `route-diag` stderr lines carrying the same `corr`.
//
// Fixed vocabulary only. Values are opaque ids (validated charset), integer
// counts, or fixed categories. Never captions, app ids, native ids, PIDs,
// paths, owners, raw extents, or geometry. Stage/category sets are closed;
// unknown inputs render as `invalid`/`unknown` and never echo input bytes
// beyond a validated opaque token.

export const ROUTE_DIAG_PREFIX = "plasma-auto-tiler:route-diag";

export type RouteDiagStage =
    | "cmd"
    | "attach"
    | "retry"
    | "scope"
    | "req"
    | "owner"
    | "result"
    | "ack"
    | "verify"
    | "outcome"
    | "ptr"
    | "lifecycle";

const STAGES: readonly string[] = Object.freeze([
    "cmd",
    "attach",
    "retry",
    "scope",
    "req",
    "owner",
    "result",
    "ack",
    "verify",
    "outcome",
    "ptr",
    "lifecycle",
]);

const MAX_TOKEN_LEN = 128;

function isOpaqueToken(value: string): boolean {
    if (value.length === 0 || value.length > MAX_TOKEN_LEN) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const alnum =
            (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        if (!(alnum || code === 45 || code === 95 || code === 46)) {
            return false;
        }
    }
    return true;
}

function isGenerationToken(value: string): boolean {
    if (value.length === 0 || value.length > 64) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const ok = (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45;
        if (!ok) {
            return false;
        }
    }
    return true;
}

function isSafeCategory(value: string): boolean {
    if (value.length === 0 || value.length > 32) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const ok =
            (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45 || code === 95;
        if (!ok) {
            return false;
        }
    }
    return true;
}

function isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000000;
}

// Correlation tokens are adapter-generated `<generation>-<slice><n>` opaque
// ids. Echo only when the full token validates; otherwise `invalid`.
export function sanitizeCorr(value: unknown): string {
    if (typeof value !== "string" || !isOpaqueToken(value)) {
        return "invalid";
    }
    return value;
}

export function sanitizeGen(value: unknown): string {
    if (typeof value !== "string" || !isGenerationToken(value)) {
        return "invalid";
    }
    return value;
}

function sanitizeField(key: string, value: unknown): string {
    if (key === "corr") {
        return sanitizeCorr(value);
    }
    if (key === "gen") {
        return sanitizeGen(value);
    }
    if (key === "rev" || key === "seq" || key === "count" || key === "windows" || key === "slices") {
        return isCount(value) ? String(value) : "unknown";
    }
    if (key === "comp") {
        return value === "tray" || value === "bridge" || value === "planner" ? value : "unknown";
    }
    if (key === "event") {
        return typeof value === "string" &&
            (value === "started" ||
                value === "published" ||
                value === "owner-changed" ||
                value === "enabled-changed" ||
                value === "seeded" ||
                value === "stopped" ||
                value === "send-failed")
            ? value
            : "unknown";
    }
    if (
        key === "kind" ||
        key === "detail" ||
        key === "mode" ||
        key === "decision" ||
        key === "result" ||
        key === "reason" ||
        key === "transition" ||
        key === "route" ||
        key === "action"
    ) {
        return typeof value === "string" && isSafeCategory(value) ? value : "unknown";
    }
    return "unknown";
}

// One bounded line: `plasma-auto-tiler:route-diag:<stage>:k=v:...` with a
// closed stage set and sanitized values. At most 6 fields; anything else is
// dropped rather than widened.
export function formatRouteDiag(
    stage: RouteDiagStage,
    fields: ReadonlyArray<readonly [string, unknown]>,
): string {
    const safeStage = STAGES.indexOf(stage) >= 0 ? stage : "unknown";
    const parts: string[] = [`${ROUTE_DIAG_PREFIX}:${safeStage}`];
    const capped = fields.slice(0, 6);
    for (const [key, value] of capped) {
        parts.push(`${key}=${sanitizeField(key, value)}`);
    }
    return parts.join(":");
}

// Bounded tray/bridge/planner lifecycle line:
// `plasma-auto-tiler:route-diag:lifecycle:comp=<tray|bridge|planner>:event=<closed>:gen=<validated-gen>[:rev=N][:result=...]`
// Closed events mirror the actually emitted Rust/KWin branches: tray
// started/enabled-changed/stopped/owner-changed, bridge published/send-failed,
// and planner seeded. Best effort only; never identities, geometry, or
// payload bytes. Unknown or malformed inputs render as fixed tokens and never
// echo input bytes beyond a validated opaque generation.
export function formatLifecycleDiag(
    comp: unknown,
    event: unknown,
    gen: unknown,
    rev?: unknown,
    result?: unknown,
): string {
    const fields: Array<readonly [string, unknown]> = [
        ["comp", comp],
        ["event", event],
        ["gen", gen],
    ];
    if (rev !== undefined) {
        fields.push(["rev", rev]);
    }
    if (result !== undefined) {
        fields.push(["result", result]);
    }
    return formatRouteDiag("lifecycle", fields);
}

// Rate-limited pointer-step coalescing: per-frame stepped signals collapse to
// at most one `coalesced` marker per flight plus one bounded summary when the
// flight settles. Counts only; no geometry, no payload bytes.
export class PointerCoalescer {
    private coalesced = 0;
    private marked = false;

    // Returns true when the caller should emit its one `coalesced` marker
    // (first suppressed step of this flight episode); later steps only bump
    // the count.
    noteCoalesced(): boolean {
        this.coalesced += 1;
        if (!this.marked) {
            this.marked = true;
            return true;
        }
        return false;
    }

    count(): number {
        return this.coalesced;
    }

    // Bounded summary line for flight settle; resets for the next episode.
    // Returns null when nothing was coalesced.
    flushSummary(): string | null {
        if (this.coalesced === 0) {
            return null;
        }
        const line = formatRouteDiag("ptr", [
            ["transition", "coalesced"],
            ["count", this.coalesced],
        ]);
        this.coalesced = 0;
        this.marked = false;
        return line;
    }

    reset(): void {
        this.coalesced = 0;
        this.marked = false;
    }
}
