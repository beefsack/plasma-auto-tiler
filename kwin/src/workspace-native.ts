// Production KWin dynamic workspace lifecycle plus numbered shortcut routing.
//
// Rust remains the structural authority for same-output tiled sends: this
// module never tiles, orders, geometries, or focuses windows. It owns only the
// restored project-owned KWin backing-desktop mapping for workspaceMode
// per-output-local, global-unique, and shared, plus desktop observation and
// actuation through public KWin state only (enumeration, current selection,
// create, remove, window membership). Numbered selection resolves existing
// logical positions; zero reuses or appends the trailing empty. Numbered moves
// resolve to an existing same-output backing id (or reuse/append for zero)
// and hand the id to the WorkspaceSendAdapter transport; desktop follow and
// mover focus happen there only after the Rust-planned commit.
//
// Signals are attached by the production entry and routed here as one
// synchronous cleanup per event. No timers, no second topology authority.

export type WorkspaceMode = "per-output-local" | "global-unique" | "shared";

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "per-output-local";
export const WORKSPACE_MODE_CONFIG_KEY = "workspaceMode";
export const WORKSPACE_MODES: ReadonlyArray<WorkspaceMode> = Object.freeze([
    "per-output-local",
    "global-unique",
    "shared",
]);

export function parseWorkspaceMode(value: unknown): WorkspaceMode {
    if (value === "per-output-local" || value === "global-unique" || value === "shared") {
        return value;
    }
    return DEFAULT_WORKSPACE_MODE;
}

const SHIFT_DIGIT_SYMBOL_ALIAS: ReadonlyMap<number, string> = new Map([
    [1, "!"],
    [2, "@"],
    [3, "#"],
    [4, "$"],
    [5, "%"],
    [6, "^"],
    [7, "&"],
    [8, "*"],
    [9, "("],
    [0, ")"],
]);

export function symbolForDigit(digit: number): string | null {
    const symbol = SHIFT_DIGIT_SYMBOL_ALIAS.get(digit);
    return symbol === undefined ? null : symbol;
}

export interface WorkspaceShortcutRow {
    readonly action: string;
    readonly text: string;
    readonly sequence: string;
    readonly kind: "select" | "move";
    readonly index: number;
}

export function workspaceShortcutCatalog(): ReadonlyArray<WorkspaceShortcutRow> {
    const rows: WorkspaceShortcutRow[] = [];
    for (let index = 1; index <= 9; index += 1) {
        rows.push({
            action: `plasma-auto-tiler-workspace-${String(index)}`,
            text: `Focus workspace ${String(index)}`,
            sequence: `Meta+${String(index)}`,
            kind: "select",
            index,
        });
    }
    rows.push({
        action: "plasma-auto-tiler-workspace-0",
        text: "Focus or create the trailing empty workspace",
        sequence: "Meta+0",
        kind: "select",
        index: 0,
    });
    for (let index = 1; index <= 9; index += 1) {
        rows.push({
            action: `plasma-auto-tiler-move-workspace-${String(index)}`,
            text: `Move window to workspace ${String(index)}`,
            sequence: `Meta+Shift+${String(index)}`,
            kind: "move",
            index,
        });
        const symbol = symbolForDigit(index);
        if (symbol !== null) {
            rows.push({
                action: `plasma-auto-tiler-move-workspace-${String(index)}-symbol`,
                text: `Move window to workspace ${String(index)} (shifted-symbol alias)`,
                sequence: `Meta+${symbol}`,
                kind: "move",
                index,
            });
        }
    }
    rows.push({
        action: "plasma-auto-tiler-move-workspace-append",
        text: "Move window to a newly appended workspace",
        sequence: "Meta+Shift+0",
        kind: "move",
        index: 0,
    });
    const zeroSymbol = symbolForDigit(0);
    if (zeroSymbol !== null) {
        rows.push({
            action: "plasma-auto-tiler-move-workspace-append-symbol",
            text: "Move window to a newly appended workspace (shifted-symbol alias)",
            sequence: `Meta+${zeroSymbol}`,
            kind: "move",
            index: 0,
        });
    }
    return Object.freeze(rows);
}

const MAX_LIST = 1024;
const MAX_DESKTOPS = 32;
const MAX_ID_LEN = 128;
const MIN_GLOBAL_DESKTOPS = 2;

const LOG_PREFIX = "plasma-auto-tiler:workspace";

function readProp(value: object, property: string): unknown {
    try {
        return Reflect.get(value, property);
    } catch (error) {
        void error;
        return undefined;
    }
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LEN) {
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

function decodeList(value: unknown, maxLength: number): ReadonlyArray<unknown> | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.length <= maxLength ? value : null;
    }
    let length: unknown = undefined;
    try {
        length = Reflect.get(value, "length");
    } catch (error) {
        void error;
        return null;
    }
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > maxLength) {
        return null;
    }
    const out: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        let element: unknown = undefined;
        try {
            element = Reflect.get(value, String(index));
        } catch (error) {
            void error;
            return null;
        }
        if (element === undefined) {
            return null;
        }
        out.push(element);
    }
    return out;
}

interface DesktopEntry {
    readonly ref: object;
    readonly id: string;
    readonly num: number | null;
}

function readDesktopId(desktop: object): string | null {
    const raw = readProp(desktop, "id");
    return isOpaqueId(raw) ? (raw as string) : null;
}

function readDesktopNumber(desktop: object): number | null {
    const raw = readProp(desktop, "x11DesktopNumber");
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
        return null;
    }
    return raw;
}

function outputTuple(output: object): string | null {
    const name = readProp(output, "name");
    if (!isOpaqueId(name)) {
        return null;
    }
    const parts: string[] = [];
    for (const key of ["manufacturer", "model", "serialNumber", "name"] as const) {
        const raw = readProp(output, key);
        if (typeof raw === "string") {
            parts.push(raw);
        }
    }
    if (parts.length === 0) {
        return null;
    }
    return parts.join("\u0000");
}

export function orderedDesktopEntries(entries: ReadonlyArray<DesktopEntry>): ReadonlyArray<DesktopEntry> {
    const indexed = entries.map((entry, index) => ({ entry, index }));
    const allNumbered = indexed.every((item) => item.entry.num !== null);
    if (allNumbered) {
        const sorted = indexed.slice().sort((a, b) => {
            const na = a.entry.num as number;
            const nb = b.entry.num as number;
            if (na !== nb) {
                return na - nb;
            }
            return a.index - b.index;
        });
        return Object.freeze(sorted.map((item) => item.entry));
    }
    return Object.freeze(indexed.map((item) => item.entry));
}

export interface TrailingEmptyDomainRequest {
    readonly orderedIds: ReadonlyArray<string>;
    readonly isEmpty: (id: string) => boolean;
    readonly isVisible: (id: string) => boolean;
    readonly removeDesktop: (id: string) => boolean;
    readonly createDesktop: () => string | null;
}

export interface TrailingEmptyDomainResult {
    readonly removedIds: ReadonlyArray<string>;
    readonly appendedId: string | null;
}

// The trailing empty is always the literal last ordered desktop, never a
// cached id. Non-trailing empty and invisible desktops are retired; a missing
// trailing empty is appended once.
export function ensureTrailingEmptyDesktop(
    request: TrailingEmptyDomainRequest,
): TrailingEmptyDomainResult {
    const orderedIds = request.orderedIds;
    const lastId = orderedIds[orderedIds.length - 1];
    const trailingEmptyId = lastId !== undefined && request.isEmpty(lastId) ? lastId : null;
    const removedIds: string[] = [];
    for (const id of orderedIds) {
        if (id === trailingEmptyId) {
            continue;
        }
        if (!request.isEmpty(id) || request.isVisible(id)) {
            continue;
        }
        if (request.removeDesktop(id)) {
            removedIds.push(id);
        }
    }
    const removed = new Set(removedIds);
    const remaining = orderedIds.filter((id) => !removed.has(id));
    const trailingId = remaining[remaining.length - 1];
    if (trailingId !== undefined && request.isEmpty(trailingId)) {
        return { removedIds: Object.freeze(removedIds), appendedId: null };
    }
    const appendedId = request.createDesktop();
    return { removedIds: Object.freeze(removedIds), appendedId };
}

export interface DisplacedRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface DisplacedDestinationCandidate {
    readonly key: string;
    readonly rect: DisplacedRect | null;
}

// Session-local output-displacement destination: nearest survivor only when
// the caller supplies removed-output geometry from the native handling
// source, else the current primary (active) survivor, else deterministic
// existing output ordering. The current adapter does not retain removed
// geometry, so it passes a null reference and falls back to primary/order.
// Post-disconnect window frame geometry is never used as a proxy for
// removed-output geometry. No historical geometry tracking: callers pass
// only live survivor rects and the live primary key. Pure and deterministic
// for offline tests.
export function chooseDisplacedDestination(
    survivors: ReadonlyArray<DisplacedDestinationCandidate>,
    activeKey: string | null,
    reference: DisplacedRect | null,
): string | null {
    if (survivors.length === 0) {
        return null;
    }
    if (survivors.length === 1) {
        const only = survivors[0];
        return only === undefined ? null : only.key;
    }
    if (reference !== null) {
        const rx = reference.x + reference.w / 2;
        const ry = reference.y + reference.h / 2;
        let bestKey: string | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const candidate of survivors) {
            if (candidate.rect === null) {
                continue;
            }
            const cx = candidate.rect.x + candidate.rect.w / 2;
            const cy = candidate.rect.y + candidate.rect.h / 2;
            const dx = cx - rx;
            const dy = cy - ry;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                bestKey = candidate.key;
            }
        }
        if (bestKey !== null) {
            return bestKey;
        }
    }
    if (activeKey !== null) {
        for (const candidate of survivors) {
            if (candidate.key === activeKey) {
                return activeKey;
            }
        }
    }
    const first = survivors[0];
    return first === undefined ? null : first.key;
}

class SessionOutputKeys {
    private readonly slots: Array<{ readonly key: string; readonly tuple: string }> = [];
    private readonly byOutput = new Map<object, string>();
    private next = 0;

    rebuild(outputs: ReadonlyArray<object>): void {
        this.byOutput.clear();
        const consumed = new Set<number>();
        for (const output of outputs) {
            const tuple = outputTuple(output);
            if (tuple === null) {
                continue;
            }
            let matchedIndex = -1;
            let entry: { readonly key: string; readonly tuple: string } | undefined = undefined;
            for (let index = 0; index < this.slots.length; index += 1) {
                if (consumed.has(index)) {
                    continue;
                }
                const candidate = this.slots[index];
                if (candidate !== undefined && candidate.tuple === tuple) {
                    matchedIndex = index;
                    entry = candidate;
                    break;
                }
            }
            if (entry === undefined) {
                matchedIndex = this.slots.length;
                entry = { key: `output-${String(this.next)}`, tuple };
                this.next += 1;
                this.slots.push(entry);
            }
            consumed.add(matchedIndex);
            this.byOutput.set(output, entry.key);
        }
    }

    keyFor(output: object): string | undefined {
        const direct = this.byOutput.get(output);
        if (direct !== undefined) {
            return direct;
        }
        const tuple = outputTuple(output);
        if (tuple === null) {
            return undefined;
        }
        for (const slot of this.slots) {
            if (slot.tuple === tuple) {
                return slot.key;
            }
        }
        return undefined;
    }
}

export interface WorkspaceNativeEnv {
    readonly getWorkspace: () => unknown;
    readonly readWorkspaceMode: () => unknown;
    readonly log: (message: string) => void;
}

export class WorkspaceNativeAdapter {
    private enabled = false;
    private mode: WorkspaceMode = DEFAULT_WORKSPACE_MODE;
    private reconciling = false;
    private readonly outputKeys = new SessionOutputKeys();
    private readonly localWorkspaces = new Map<string, string[]>();
    private localPrimary: string | undefined = undefined;
    private readonly globalAssigned = new Map<string, string[]>();
    private readonly globalInverse = new Map<string, string>();
    private globalPrimary: string | undefined = undefined;
    private readonly sharedIds: string[] = [];
    private readonly owned = new Set<string>();
    // Session-local output-displacement mapping only, no restart persistence.
    // Origin output key -> displaced workspace ids plus chosen survivor key.
    // Workspace relocation is the unit: return moves whole workspaces with
    // CURRENT contents, never individual windows.
    private readonly displacedByOrigin = new Map<string, { workspaceIds: string[]; destKey: string }>();
    // Last known visible desktop per stable output key, updated on each
    // topology signal while the output is live. Session-local mapping state
    // (not geometry history) so a removed output's visible workspace can be
    // displaced even when its mapping list is empty. Primed at enable.
    private readonly lastVisibleByKey = new Map<string, string>();
    // Last known workspace membership per stable output key, grouped from
    // observed window output while the output was live. Session-local mapping
    // state (not geometry history) so background/non-visible occupied
    // workspaces of a removed output are displaced as a unit even when the
    // mapping list missed them. Primed at enable, refreshed after each
    // displacement pass; never records historical geometry.
    private readonly lastKnownByKey = new Map<string, string[]>();
    // Bounded transaction-lifetime retention for an in-flight planned
    // workspace-send: while the send adapter holds a bound plan awaiting
    // ack/verify, its pending source/target ids must not be pruned even when
    // empty and non-visible after follow. Provider-owned (usually the send
    // adapter's pendingWorkspaces); empty means no retention. Never history,
    // never geometry, cleared automatically when the flight settles.
    private retentionProvider: (() => ReadonlyArray<string>) | null = null;

    constructor(private readonly env: WorkspaceNativeEnv) {}

    setRetentionProvider(provider: (() => ReadonlyArray<string>) | null): void {
        this.retentionProvider = provider;
    }

    private isTransactionRetained(id: string): boolean {
        const provider = this.retentionProvider;
        if (provider === null) {
            return false;
        }
        try {
            const ids = provider();
            for (const candidate of ids) {
                if (candidate === id) {
                    return true;
                }
            }
        } catch (error) {
            void error;
        }
        return false;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    getMode(): WorkspaceMode {
        return this.mode;
    }

    enable(): boolean {
        if (this.enabled) {
            return false;
        }
        let raw: unknown = undefined;
        try {
            raw = this.env.readWorkspaceMode();
        } catch (error) {
            void error;
            raw = undefined;
        }
        this.mode = parseWorkspaceMode(raw);
        this.resetMappingState();
        this.pruneOwnedToLive();
        this.enabled = true;
        this.rebuildKeysAndMappings();
        this.cleanupDesktops();
        this.primeDisplacedTracking();
        return true;
    }

    disable(): void {
        this.enabled = false;
        this.resetMappingState();
    }

    private resetMappingState(): void {
        this.localWorkspaces.clear();
        this.localPrimary = undefined;
        this.globalAssigned.clear();
        this.globalInverse.clear();
        this.globalPrimary = undefined;
        this.sharedIds.length = 0;
        this.displacedByOrigin.clear();
        this.lastVisibleByKey.clear();
        this.lastKnownByKey.clear();
    }

    private pruneOwnedToLive(): void {
        const live = this.liveOrdered();
        if (live === null) {
            return;
        }
        const liveIds = new Set(live.map((entry) => entry.id));
        for (const id of [...this.owned]) {
            if (!liveIds.has(id)) {
                this.owned.delete(id);
            }
        }
    }

    ownedSnapshot(): ReadonlyArray<string> {
        return Object.freeze([...this.owned]);
    }

    localSnapshot(): Readonly<Record<string, ReadonlyArray<string>>> {
        const out: Record<string, ReadonlyArray<string>> = {};
        for (const [key, ids] of this.localWorkspaces) {
            out[key] = Object.freeze([...ids]);
        }
        return Object.freeze(out);
    }

    globalSnapshot(): Readonly<Record<string, ReadonlyArray<string>>> {
        const out: Record<string, ReadonlyArray<string>> = {};
        for (const [key, ids] of this.globalAssigned) {
            out[key] = Object.freeze([...ids]);
        }
        return Object.freeze(out);
    }

    sharedSnapshot(): ReadonlyArray<string> {
        return Object.freeze([...this.sharedIds]);
    }

    displacedSnapshot(): Readonly<Record<string, { readonly workspaceIds: ReadonlyArray<string>; readonly destKey: string }>> {
        const out: Record<string, { readonly workspaceIds: ReadonlyArray<string>; readonly destKey: string }> = {};
        for (const [origin, entry] of this.displacedByOrigin) {
            out[origin] = Object.freeze({ workspaceIds: Object.freeze([...entry.workspaceIds]), destKey: entry.destKey });
        }
        return Object.freeze(out);
    }

    // One synchronous cleanup per workspace or window signal. Creates or
    // retires backing desktops so every relevant domain keeps one trailing
    // empty. Never removes populated, current, visible, unowned, or one of
    // the minimum two global desktops. Output disconnect/reconnect
    // displacement runs after the ordinary lifecycle so displaced layouts
    // stay separate workspaces on a survivor and return with CURRENT
    // contents on reconnect.
    handleTopologySignal(): void {
        if (!this.enabled || this.reconciling) {
            return;
        }
        // Refresh stable output keys from handling-time screens only (no
        // historical geometry). New tuples get new stable keys; known tuples
        // keep theirs, so a tuple replacement never aliases the removed key.
        const preScreens = this.liveScreens();
        if (preScreens !== null) {
            this.outputKeys.rebuild(preScreens);
        }
        const prevLocal = new Map<string, string[]>();
        for (const [key, ids] of this.localWorkspaces) {
            prevLocal.set(key, [...ids]);
        }
        const prevGlobal = new Map<string, string[]>();
        for (const [key, ids] of this.globalAssigned) {
            prevGlobal.set(key, [...ids]);
        }
        this.cleanupDesktops();
        this.reconcileOutputDisplacement(prevLocal, prevGlobal);
    }

    // Meta+1..9: select only an existing logical position on the active
    // output (or shared set). Absent positions never create.
    selectLogical(index: number): boolean {
        if (!this.enabled) {
            return false;
        }
        if (!Number.isInteger(index) || index < 1 || index > 9) {
            return false;
        }
        if (this.mode === "shared") {
            return this.selectShared(index);
        }
        if (this.mode === "global-unique") {
            return this.selectGlobal(index);
        }
        return this.selectLocal(index);
    }

    // Meta+0: reuse the trailing empty or create one, then select it.
    // Idempotent while already on the trailing empty.
    selectTrailingOrCreate(): boolean {
        if (!this.enabled) {
            return false;
        }
        if (this.mode === "shared") {
            return this.selectSharedTrailing();
        }
        const output = this.activeOutput();
        if (output === null) {
            this.logToken("workspace-zero-absent:no-active-output");
            return false;
        }
        if (this.mode === "global-unique") {
            return this.selectGlobalTrailing(output);
        }
        return this.selectLocalTrailing(output);
    }

    // Meta+Shift+1..9: resolve an existing same-output logical position to a
    // backing desktop id. Never creates; null means absent or unreadable.
    resolveMoveTarget(index: number): string | null {
        if (!this.enabled) {
            return null;
        }
        if (!Number.isInteger(index) || index < 1 || index > 9) {
            return null;
        }
        if (this.mode === "shared") {
            const live = this.liveOrdered();
            if (live === null) {
                return null;
            }
            const entry = live[index - 1];
            if (entry === undefined) {
                this.logToken(`workspace-move-absent:${String(index)}`);
                return null;
            }
            return entry.id;
        }
        const output = this.activeOutput();
        if (output === null) {
            return null;
        }
        if (this.mode === "global-unique") {
            const target = this.globalTargetForOutput(output, index);
            if (target === null) {
                this.logToken(`workspace-move-absent:${String(index)}`);
                return null;
            }
            return target.id;
        }
        const target = this.localTargetForOutput(output, index);
        if (target === null) {
            this.logToken(`workspace-move-absent:${String(index)}`);
            return null;
        }
        return target.id;
    }

    // Meta+Shift+0: reuse the trailing empty or append one, then return its
    // backing id for the send handoff.
    resolveOrAppendMoveTarget(): string | null {
        if (!this.enabled) {
            return null;
        }
        if (this.mode === "shared") {
            const existing = this.resolveSharedTrailing();
            if (existing !== null) {
                return existing.id;
            }
            const created = this.appendDesktopForShared();
            return created === null ? null : created.id;
        }
        const output = this.activeOutput();
        if (output === null) {
            return null;
        }
        if (this.mode === "global-unique") {
            const live = this.liveOrdered();
            if (live !== null) {
                this.rebuildGlobalMapping(live);
            }
            const existing = this.resolveGlobalTrailing(output);
            if (existing !== null) {
                return existing.id;
            }
            const created = this.appendDesktopForGlobal(output);
            return created === null ? null : created.id;
        }
        this.rebuildLocalMapping();
        const existing = this.resolveLocalTrailing(output);
        if (existing !== null) {
            return existing.id;
        }
        const created = this.appendTrailingForOutput(output);
        return created === null ? null : created.id;
    }

    private logToken(token: string): void {
        try {
            this.env.log(`${LOG_PREFIX}:${token}`);
        } catch (error) {
            void error;
        }
    }

    private liveWorkspace(): Record<string, unknown> | null {
        let raw: unknown = undefined;
        try {
            raw = this.env.getWorkspace();
        } catch (error) {
            void error;
            return null;
        }
        if (typeof raw !== "object" || raw === null) {
            return null;
        }
        return raw as Record<string, unknown>;
    }

    private liveOrdered(): ReadonlyArray<DesktopEntry> | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const raw = readProp(surface, "desktops");
        const list = decodeList(raw, MAX_DESKTOPS);
        if (list === null || list.length === 0) {
            return null;
        }
        const entries: DesktopEntry[] = [];
        for (const item of list) {
            if (typeof item !== "object" || item === null) {
                return null;
            }
            const ref = item as object;
            const id = readDesktopId(ref);
            if (id === null) {
                return null;
            }
            entries.push({ ref, id, num: readDesktopNumber(ref) });
        }
        return orderedDesktopEntries(entries);
    }

    private liveScreens(): ReadonlyArray<object> | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const raw = readProp(surface, "screens");
        const list = decodeList(raw, MAX_LIST);
        if (list === null || list.length === 0) {
            return null;
        }
        const out: object[] = [];
        for (const item of list) {
            if (typeof item !== "object" || item === null) {
                return null;
            }
            out.push(item as object);
        }
        return Object.freeze(out);
    }

    private rebuildKeysAndMappings(): void {
        const screens = this.liveScreens();
        if (screens !== null) {
            this.outputKeys.rebuild(screens);
        }
        const live = this.liveOrdered();
        if (this.mode === "per-output-local") {
            this.rebuildLocalMapping(live ?? undefined);
        } else if (this.mode === "global-unique") {
            if (live !== null) {
                this.rebuildGlobalMapping(live);
            }
        } else {
            this.rebuildSharedMapping(live ?? undefined);
        }
    }

    private rebuildLocalMapping(provided?: ReadonlyArray<DesktopEntry>): void {
        if (this.mode !== "per-output-local") {
            return;
        }
        const screens = this.liveScreens();
        if (screens === null) {
            return;
        }
        const keys: string[] = [];
        for (const output of screens) {
            const key = this.outputKeys.keyFor(output);
            if (key !== undefined && !keys.includes(key)) {
                keys.push(key);
            }
        }
        if (keys.length === 0) {
            return;
        }
        const live = provided ?? this.liveOrdered();
        if (live === null) {
            return;
        }
        if (this.localPrimary === undefined || !keys.includes(this.localPrimary)) {
            this.localPrimary = keys[0];
        }
        const liveIds = new Set(live.map((entry) => entry.id));
        // Retain removed-output lists (filtered to live) so displacement can
        // move them as a unit or defer without orphaning. Deletion of a
        // removed origin happens only on successful displacement or when the
        // origin is proven empty.
        for (const [key, list] of [...this.localWorkspaces]) {
            this.localWorkspaces.set(key, list.filter((id) => liveIds.has(id)));
        }
        const primary = this.localPrimary;
        if (primary !== undefined && keys.includes(primary)) {
            const list = this.localWorkspaces.get(primary) ?? [];
            const assigned = new Set<string>();
            for (const ids of this.localWorkspaces.values()) {
                for (const id of ids) {
                    assigned.add(id);
                }
            }
            for (const entry of live) {
                if (this.owned.has(entry.id) || assigned.has(entry.id)) {
                    continue;
                }
                list.push(entry.id);
                assigned.add(entry.id);
            }
            this.localWorkspaces.set(primary, list);
        }
    }

    private assignGlobal(id: string, key: string): void {
        const previous = this.globalInverse.get(id);
        if (previous !== undefined && previous !== key) {
            const prior = this.globalAssigned.get(previous);
            if (prior !== undefined) {
                const at = prior.indexOf(id);
                if (at >= 0) {
                    prior.splice(at, 1);
                }
            }
        }
        this.globalInverse.set(id, key);
        const list = this.globalAssigned.get(key) ?? [];
        if (!list.includes(id)) {
            list.push(id);
        }
        this.globalAssigned.set(key, list);
    }

    private unassignGlobal(id: string): void {
        const key = this.globalInverse.get(id);
        if (key === undefined) {
            return;
        }
        this.globalInverse.delete(id);
        const list = this.globalAssigned.get(key);
        if (list !== undefined) {
            const at = list.indexOf(id);
            if (at >= 0) {
                list.splice(at, 1);
            }
        }
    }

    private globalOrdered(live: ReadonlyArray<DesktopEntry>, key: string): DesktopEntry[] {
        const ids = new Set(this.globalAssigned.get(key) ?? []);
        const filtered = live.filter((entry) => ids.has(entry.id));
        if (filtered.some((entry) => entry.num === null)) {
            return filtered;
        }
        return filtered
            .slice()
            .sort((a, b) => (a.num as number) - (b.num as number));
    }

    private rebuildGlobalMapping(live: ReadonlyArray<DesktopEntry>): void {
        const screens = this.liveScreens();
        if (screens === null) {
            return;
        }
        const keys: string[] = [];
        for (const output of screens) {
            const key = this.outputKeys.keyFor(output);
            if (key !== undefined && !keys.includes(key)) {
                keys.push(key);
            }
        }
        if (keys.length === 0) {
            return;
        }
        const connected = new Set(keys);
        if (this.globalPrimary === undefined || !connected.has(this.globalPrimary)) {
            this.globalPrimary = keys[0];
        }
        // Retain removed-output assignments (filtered to live) so
        // displacement can move them as a unit or defer without orphaning or
        // silently rehoming to the primary. Deletion happens only on
        // successful displacement or when proven empty.
        const liveIds = new Set(live.map((entry) => entry.id));
        for (const [key, list] of [...this.globalAssigned]) {
            const filtered = list.filter((id) => liveIds.has(id));
            if (filtered.length === 0) {
                // Keep empty live keys; drop empty removed keys only when not
                // displaced (displacement owns their lifetime).
                if (!connected.has(key) && !this.displacedByOrigin.has(key)) {
                    for (const id of list) {
                        if (this.globalInverse.get(id) === key) {
                            this.globalInverse.delete(id);
                        }
                    }
                    this.globalAssigned.delete(key);
                    continue;
                }
            }
            this.globalAssigned.set(key, filtered);
        }
        // Prune inverse entries for dead desktops.
        for (const [id, key] of [...this.globalInverse]) {
            if (!liveIds.has(id)) {
                this.globalInverse.delete(id);
                void key;
            }
        }
        for (const entry of live) {
            if (this.globalInverse.has(entry.id)) {
                continue;
            }
            if (this.globalPrimary === undefined) {
                continue;
            }
            this.assignGlobal(entry.id, this.globalPrimary);
        }
        for (const key of keys) {
            const list = this.globalAssigned.get(key);
            if (list === undefined) {
                continue;
            }
            const filtered = list.filter((id) => liveIds.has(id));
            if (filtered.length !== list.length) {
                this.globalAssigned.set(key, filtered);
            }
        }
    }

    private rebuildSharedMapping(provided?: ReadonlyArray<DesktopEntry>): void {
        if (this.mode !== "shared") {
            return;
        }
        const live = provided ?? this.liveOrdered();
        if (live === null) {
            return;
        }
        this.sharedIds.length = 0;
        for (const entry of live) {
            this.sharedIds.push(entry.id);
        }
    }

    private activeOutput(): object | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        try {
            const active = Reflect.get(surface, "activeWindow");
            if (typeof active === "object" && active !== null) {
                const output = readProp(active as object, "output");
                if (typeof output === "object" && output !== null) {
                    return output as object;
                }
            }
        } catch (error) {
            void error;
        }
        try {
            const screen = Reflect.get(surface, "activeScreen");
            if (typeof screen === "object" && screen !== null) {
                return screen as object;
            }
        } catch (error) {
            void error;
            return null;
        }
        return null;
    }

    private currentOnOutput(output: object): DesktopEntry | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const fn = readProp(surface, "currentDesktopForScreen");
        if (typeof fn !== "function") {
            return null;
        }
        let current: unknown = undefined;
        try {
            current = Reflect.apply(fn as (...args: ReadonlyArray<never>) => unknown, surface, [output]);
        } catch (error) {
            void error;
            return null;
        }
        if (typeof current !== "object" || current === null) {
            return null;
        }
        const id = readDesktopId(current as object);
        if (id === null) {
            return null;
        }
        return { ref: current as object, id, num: readDesktopNumber(current as object) };
    }

    private currentShared(): DesktopEntry | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const raw = readProp(surface, "currentDesktop");
        let current: unknown = raw;
        if (typeof raw === "function") {
            try {
                current = Reflect.apply(raw as (...args: ReadonlyArray<never>) => unknown, surface, []);
            } catch (error) {
                void error;
                return null;
            }
        }
        if (typeof current !== "object" || current === null) {
            return null;
        }
        const id = readDesktopId(current as object);
        if (id === null) {
            return null;
        }
        return { ref: current as object, id, num: readDesktopNumber(current as object) };
    }

    private visibleIds(): Set<string> | null {
        const screens = this.liveScreens();
        if (screens === null) {
            return null;
        }
        const visible = new Set<string>();
        for (const output of screens) {
            const current = this.currentOnOutput(output);
            if (current === null) {
                return null;
            }
            visible.add(current.id);
        }
        const global = this.currentShared();
        if (global === null) {
            return null;
        }
        visible.add(global.id);
        return visible;
    }

    // Every per-desktop window membership counts, including floating,
    // fullscreen, and maximized windows. Sticky windows are global rather
    // than members of a backing desktop, matching the legacy lifecycle and
    // preventing a trailing-empty append on every signal.
    private occupiedIds(): Set<string> | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return null;
        }
        let raw: unknown = undefined;
        try {
            raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
        } catch (error) {
            void error;
            return null;
        }
        const windows = decodeList(raw, MAX_LIST);
        if (windows === null) {
            return null;
        }
        const occupied = new Set<string>();
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            if (readProp(ref, "onAllDesktops") === true) {
                continue;
            }
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null) {
                return null;
            }
            for (const member of membership) {
                if (typeof member !== "object" || member === null) {
                    return null;
                }
                const id = readDesktopId(member as object);
                if (id === null) {
                    return null;
                }
                occupied.add(id);
            }
        }
        return occupied;
    }

    private cleanupDesktops(): void {
        if (this.reconciling) {
            return;
        }
        const visible = this.visibleIds();
        if (visible === null) {
            this.logToken("workspace-cleanup-deferred:output-visibility-unknown");
            return;
        }
        const occupied = this.occupiedIds();
        if (occupied === null) {
            this.logToken("workspace-cleanup-deferred:window-occupancy-unknown");
            return;
        }
        const live = this.liveOrdered();
        if (live === null) {
            return;
        }
        if (this.mode === "per-output-local") {
            this.rebuildLocalMapping(live);
            this.enforceLocalTrailing(visible, occupied);
            return;
        }
        if (this.mode === "global-unique") {
            this.rebuildGlobalMapping(live);
            this.enforceGlobalTrailing(visible, occupied);
            return;
        }
        this.rebuildSharedMapping(live);
        this.enforceSharedTrailing(visible, occupied);
    }

    // Output disconnect/reconnect displacement, session-local only.
    // Displaced layouts stay separate workspaces on a survivor, never merged
    // into its visible tree. Visibility follows the active window at
    // disconnect; otherwise the surviving view is preserved. On reconnect,
    // each displaced workspace returns with CURRENT contents (unit
    // relocation by workspace id). Destination is the live primary survivor,
    // else existing output ordering; nearest applies only if the native
    // handling source exposes removed-output geometry (the current adapter
    // does not retain removed geometry, so it never claims nearest from
    // moved-window geometry). No historical geometry tracking. Fail-closed on unreadable topology:
    // mapping is never deleted/orphaned or silently rehomed when no survivor
    // destination exists. Stable output keys are tuple-bound, so a tuple
    // replacement (new key) never falsely returns to a different identity;
    // return requires exact origin-key reappearance.
    private reconcileOutputDisplacement(
        prevLocal: ReadonlyMap<string, ReadonlyArray<string>>,
        prevGlobal: ReadonlyMap<string, ReadonlyArray<string>>,
    ): void {
        if (this.mode === "shared") {
            return;
        }
        const screens = this.liveScreens();
        const live = this.liveOrdered();
        if (screens === null || live === null) {
            return;
        }
        const liveIds = new Set(live.map((entry) => entry.id));
        // Prune displaced records to still-live workspaces. Expiry deletes
        // the record (bounded log) without inventing a return or touching
        // native state. Mapping cleanup for the emptied origin happens below.
        for (const [origin, entry] of [...this.displacedByOrigin]) {
            const kept = entry.workspaceIds.filter((id) => liveIds.has(id));
            if (kept.length !== entry.workspaceIds.length) {
                if (kept.length === 0) {
                    this.displacedByOrigin.delete(origin);
                    this.logToken(`workspace-displaced-expired:${origin}`);
                } else {
                    this.displacedByOrigin.set(origin, { workspaceIds: kept, destKey: entry.destKey });
                }
            }
        }
        const currentKeys: string[] = [];
        for (const output of screens) {
            const key = this.outputKeys.keyFor(output);
            if (key !== undefined && !currentKeys.includes(key)) {
                currentKeys.push(key);
            }
        }
        if (currentKeys.length === 0) {
            return;
        }
        const prevKeys = this.mode === "per-output-local" ? [...prevLocal.keys()] : [...prevGlobal.keys()];
        // Union with last-known tracking so newly seen stable keys (tuple
        // replacement) count as added and stale removed keys count as
        // removed even when the mapping was already pruned.
        const knownKeys = new Set<string>(prevKeys);
        for (const key of this.lastVisibleByKey.keys()) {
            knownKeys.add(key);
        }
        for (const key of this.lastKnownByKey.keys()) {
            knownKeys.add(key);
        }
        for (const key of this.displacedByOrigin.keys()) {
            knownKeys.add(key);
        }
        const removed = [...knownKeys].filter((key) => !currentKeys.includes(key));
        this.reconciling = true;
        try {
            for (const origin of removed) {
                const existing = this.displacedByOrigin.get(origin);
                if (existing !== undefined) {
                    // Already displaced: keep the survivor association alive.
                    // If the survivor itself is gone, re-target as a unit;
                    // never merge, orphan, or invent a return.
                    if (currentKeys.includes(existing.destKey)) {
                        this.ensureDisplacedPresent(existing.workspaceIds.filter((id) => liveIds.has(id)), existing.destKey);
                        continue;
                    }
                    const stillLive = existing.workspaceIds.filter((id) => liveIds.has(id));
                    if (stillLive.length === 0) {
                        this.displacedByOrigin.delete(origin);
                        this.logToken(`workspace-displaced-expired:${origin}`);
                        this.dropOriginMapping(origin);
                        continue;
                    }
                    const destKey = this.selectSurvivorKey(screens, currentKeys);
                    if (destKey === null || destKey === origin) {
                        this.logToken(`workspace-displaced-deferred:${origin}`);
                        continue;
                    }
                    this.displacedByOrigin.set(origin, { workspaceIds: [...stillLive], destKey });
                    this.moveLocalIdsTo(stillLive, destKey);
                    this.logToken(`workspace-displaced:${origin}:${destKey}:${String(stillLive.length)}`);
                    continue;
                }
                // Full association for the removed output: previous mapping
                // plus last-known window-output membership plus last-visible,
                // so background/non-visible occupied workspaces move as a unit.
                // Uses only handling-time inputs plus session-local mapping
                // state; never stale output geometry.
                const prevIds = (this.mode === "per-output-local" ? prevLocal.get(origin) : prevGlobal.get(origin)) ?? [];
                const known = this.lastKnownByKey.get(origin) ?? [];
                const combined: string[] = [];
                for (const id of [...prevIds, ...known]) {
                    if (!combined.includes(id)) {
                        combined.push(id);
                    }
                }
                const lastVisible = this.lastVisibleByKey.get(origin);
                if (lastVisible !== undefined && !combined.includes(lastVisible)) {
                    combined.push(lastVisible);
                }
                const workspaceIds = combined.filter((id) => liveIds.has(id));
                if (workspaceIds.length === 0) {
                    this.dropOriginMapping(origin);
                    continue;
                }
                const destKey = this.selectSurvivorKey(screens, currentKeys);
                if (destKey === null || destKey === origin) {
                    // Defer safely: retain the origin mapping, create no
                    // record, rehome/merge nothing.
                    this.logToken(`workspace-displaced-deferred:${origin}`);
                    continue;
                }
                this.displacedByOrigin.set(origin, { workspaceIds: [...workspaceIds], destKey });
                if (this.mode === "per-output-local") {
                    this.moveLocalIdsTo(workspaceIds, destKey);
                    this.localWorkspaces.delete(origin);
                } else {
                    for (const id of workspaceIds) {
                        this.assignGlobal(id, destKey);
                    }
                    const originList = this.globalAssigned.get(origin);
                    if (originList !== undefined && originList.length === 0) {
                        this.globalAssigned.delete(origin);
                    }
                }
                this.logToken(`workspace-displaced:${origin}:${destKey}:${String(workspaceIds.length)}`);
                this.showDisplacedIfActiveThere(workspaceIds, destKey, screens);
            }
            for (const key of currentKeys) {
                // Exact stable-key return only: a tuple replacement carries a
                // new key and never matches the displaced origin, so no false
                // return occurs. The displaced association simply stays on its
                // survivor until the true origin reappears or expires.
                const entry = this.displacedByOrigin.get(key);
                if (entry === undefined) {
                    continue;
                }
                const returning = entry.workspaceIds.filter((id) => liveIds.has(id));
                if (returning.length === 0) {
                    this.displacedByOrigin.delete(key);
                    this.logToken(`workspace-displaced-expired:${key}`);
                    this.dropOriginMapping(key);
                    continue;
                }
                if (this.mode === "per-output-local") {
                    // Remove from wherever each id currently lives (user
                    // membership edits while displaced converge as current
                    // state: the workspace unit returns, never individual
                    // windows), then restore exactly once on the origin.
                    for (const id of returning) {
                        this.removeLocalIdEverywhere(id);
                    }
                    const originList = this.localWorkspaces.get(key) ?? [];
                    for (const id of returning) {
                        if (!originList.includes(id)) {
                            originList.push(id);
                        }
                    }
                    this.localWorkspaces.set(key, originList);
                } else {
                    for (const id of returning) {
                        this.assignGlobal(id, key);
                    }
                }
                const remaining = entry.workspaceIds.filter((id) => !returning.includes(id));
                if (remaining.length === 0) {
                    this.displacedByOrigin.delete(key);
                } else {
                    this.displacedByOrigin.set(key, { workspaceIds: remaining, destKey: entry.destKey });
                }
                this.logToken(`workspace-returned:${key}:${String(returning.length)}`);
                this.showReturningIfActiveThere(returning, key, screens);
            }
            this.refreshLastVisible(screens);
            this.refreshLastKnown(screens);
        } finally {
            this.reconciling = false;
        }
    }

    private dropOriginMapping(origin: string): void {
        if (this.mode === "per-output-local") {
            const list = this.localWorkspaces.get(origin);
            if (list !== undefined && list.length === 0) {
                this.localWorkspaces.delete(origin);
            } else if (list === undefined) {
                // Already absent: nothing to orphan.
            } else if (!this.displacedByOrigin.has(origin)) {
                // Non-empty retained mapping stays for a deferred pass; only
                // empty origins are dropped here.
            }
        } else if (this.mode === "global-unique") {
            const list = this.globalAssigned.get(origin);
            if (list !== undefined && list.length === 0 && !this.displacedByOrigin.has(origin)) {
                this.globalAssigned.delete(origin);
            }
        }
    }

    private removeLocalIdEverywhere(id: string): void {
        for (const list of this.localWorkspaces.values()) {
            const at = list.indexOf(id);
            if (at >= 0) {
                list.splice(at, 1);
            }
        }
    }

    private moveLocalIdsTo(ids: ReadonlyArray<string>, destKey: string): void {
        for (const id of ids) {
            this.removeLocalIdEverywhere(id);
        }
        const destList = this.localWorkspaces.get(destKey) ?? [];
        for (const id of ids) {
            if (!destList.includes(id)) {
                destList.push(id);
            }
        }
        this.localWorkspaces.set(destKey, destList);
    }

    private ensureDisplacedPresent(ids: ReadonlyArray<string>, destKey: string): void {
        if (this.mode !== "per-output-local") {
            for (const id of ids) {
                if (this.globalInverse.get(id) !== destKey) {
                    this.assignGlobal(id, destKey);
                }
            }
            return;
        }
        const destList = this.localWorkspaces.get(destKey) ?? [];
        let changed = false;
        for (const id of ids) {
            // Repair any duplicate or drift without duplicating: exactly once
            // on the recorded survivor.
            let occurrences = 0;
            for (const list of this.localWorkspaces.values()) {
                for (const entry of list) {
                    if (entry === id) {
                        occurrences += 1;
                    }
                }
            }
            if (occurrences !== 1 || !destList.includes(id)) {
                this.removeLocalIdEverywhere(id);
                if (!destList.includes(id)) {
                    destList.push(id);
                }
                changed = true;
            }
        }
        if (changed || !this.localWorkspaces.has(destKey)) {
            this.localWorkspaces.set(destKey, destList);
        }
    }

    private primeDisplacedTracking(): void {
        const screens = this.liveScreens();
        if (screens === null) {
            return;
        }
        this.refreshLastVisible(screens);
        this.refreshLastKnown(screens);
    }

    // Group desktop memberships by observed window output key from
    // handling-time inputs only. Null on any unreadable topology (fail
    // closed). Sticky windows are global, not members of a backing desktop.
    private membershipByKey(screens: ReadonlyArray<object>): Map<string, Set<string>> | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return null;
        }
        let raw: unknown = undefined;
        try {
            raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
        } catch (error) {
            void error;
            return null;
        }
        const windows = decodeList(raw, MAX_LIST);
        if (windows === null) {
            return null;
        }
        const grouped = new Map<string, Set<string>>();
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            if (readProp(ref, "onAllDesktops") === true) {
                continue;
            }
            const outputRaw = readProp(ref, "output");
            if (typeof outputRaw !== "object" || outputRaw === null) {
                return null;
            }
            const key = this.outputKeys.keyFor(outputRaw as object);
            if (key === undefined) {
                continue;
            }
            // Only attribute to currently live outputs; post-disconnect
            // windows already live on survivors and must not rewrite the
            // removed origin's last-known set.
            let live = false;
            for (const output of screens) {
                if (this.outputKeys.keyFor(output) === key) {
                    live = true;
                    break;
                }
            }
            if (!live) {
                continue;
            }
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null) {
                return null;
            }
            const bucket = grouped.get(key) ?? new Set<string>();
            for (const member of membership) {
                if (typeof member !== "object" || member === null) {
                    return null;
                }
                const id = readDesktopId(member as object);
                if (id === null) {
                    return null;
                }
                bucket.add(id);
            }
            grouped.set(key, bucket);
        }
        return grouped;
    }

    private refreshLastKnown(screens: ReadonlyArray<object>): void {
        const grouped = this.membershipByKey(screens);
        if (grouped !== null) {
            for (const [key, ids] of grouped) {
                this.lastKnownByKey.set(key, [...ids]);
            }
        }
        // Drop stale origins that are neither live nor displaced.
        const liveKeys = new Set<string>();
        for (const output of screens) {
            const key = this.outputKeys.keyFor(output);
            if (key !== undefined) {
                liveKeys.add(key);
            }
        }
        for (const key of [...this.lastKnownByKey.keys()]) {
            if (!liveKeys.has(key) && !this.displacedByOrigin.has(key)) {
                this.lastKnownByKey.delete(key);
            }
        }
    }

    private refreshLastVisible(screens: ReadonlyArray<object>): void {
        for (const output of screens) {
            const key = this.outputKeys.keyFor(output);
            if (key === undefined) {
                continue;
            }
            const current = this.currentOnOutput(output);
            if (current !== null) {
                this.lastVisibleByKey.set(key, current.id);
            }
        }
        // Drop stale origins that are neither live nor displaced.
        for (const key of [...this.lastVisibleByKey.keys()]) {
            let live = false;
            for (const output of screens) {
                if (this.outputKeys.keyFor(output) === key) {
                    live = true;
                    break;
                }
            }
            if (!live && !this.displacedByOrigin.has(key)) {
                this.lastVisibleByKey.delete(key);
            }
        }
    }

    // Survivor destination without removed-output geometry: the current
    // adapter does not retain removed geometry, so no reference is supplied
    // and selection falls back to live primary then deterministic ordering.
    // Nearest applies only if a future handling source exposes removed
    // geometry to the pure helper.
    private selectSurvivorKey(
        screens: ReadonlyArray<object>,
        currentKeys: ReadonlyArray<string>,
    ): string | null {
        const candidates: DisplacedDestinationCandidate[] = [];
        for (const output of screens) {
            const key = this.outputKeys.keyFor(output);
            if (key === undefined || !currentKeys.includes(key)) {
                continue;
            }
            candidates.push({ key, rect: this.readOutputRect(output) });
        }
        const activeKey = this.activeScreenKey(screens, currentKeys);
        return chooseDisplacedDestination(candidates, activeKey, null);
    }

    private activeScreenKey(screens: ReadonlyArray<object>, currentKeys: ReadonlyArray<string>): string | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        try {
            const screen = Reflect.get(surface, "activeScreen");
            if (typeof screen === "object" && screen !== null) {
                const key = this.outputKeys.keyFor(screen as object);
                if (key !== undefined && currentKeys.includes(key)) {
                    return key;
                }
            }
        } catch (error) {
            void error;
        }
        void screens;
        return null;
    }

    private activeWindowRef(): object | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        try {
            const active = Reflect.get(surface, "activeWindow");
            return typeof active === "object" && active !== null ? (active as object) : null;
        } catch (error) {
            void error;
            return null;
        }
    }

    private windowDesktopIds(ref: object): ReadonlyArray<string> | null {
        const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
        if (membership === null) {
            return null;
        }
        const ids: string[] = [];
        for (const member of membership) {
            if (typeof member !== "object" || member === null) {
                return null;
            }
            const id = readDesktopId(member as object);
            if (id === null) {
                return null;
            }
            ids.push(id);
        }
        return Object.freeze(ids);
    }

    private readOutputRect(output: object): DisplacedRect | null {
        const geometry = readProp(output, "geometry");
        if (typeof geometry !== "object" || geometry === null) {
            return null;
        }
        const record = geometry as Record<string, unknown>;
        const x = record["x"];
        const y = record["y"];
        const wRaw = record["width"] !== undefined ? record["width"] : record["w"];
        const hRaw = record["height"] !== undefined ? record["height"] : record["h"];
        if (typeof x !== "number" || typeof y !== "number" || typeof wRaw !== "number" || typeof hRaw !== "number") {
            return null;
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(wRaw) || !Number.isFinite(hRaw)) {
            return null;
        }
        if (wRaw <= 0 || hRaw <= 0 || wRaw > 16384 || hRaw > 16384) {
            return null;
        }
        if (x < -16384 || x > 16384 || y < -16384 || y > 16384) {
            return null;
        }
        return { x, y, w: wRaw, h: hRaw };
    }

    private outputForKey(screens: ReadonlyArray<object>, key: string): object | null {
        for (const output of screens) {
            if (this.outputKeys.keyFor(output) === key) {
                return output;
            }
        }
        return null;
    }

    // On disconnect, if the active window lives in a relocated workspace,
    // show that workspace on the survivor and retain focus. Otherwise
    // preserve the surviving view/focus with no writes.
    private showDisplacedIfActiveThere(workspaceIds: ReadonlyArray<string>, destKey: string, screens: ReadonlyArray<object>): void {
        const active = this.activeWindowRef();
        if (active === null) {
            this.logToken("workspace-preserve-view:no-active");
            return;
        }
        const members = this.windowDesktopIds(active);
        if (members === null) {
            this.logToken("workspace-preserve-view:active-unreadable");
            return;
        }
        const activeId = members.find((id) => workspaceIds.includes(id));
        if (activeId === undefined) {
            this.logToken("workspace-preserve-view:survivor-active");
            return;
        }
        const destOutput = this.outputForKey(screens, destKey);
        const target = this.findLive(activeId);
        if (destOutput === null || target === null) {
            this.logToken("workspace-show-displaced-deferred");
            return;
        }
        if (!this.writeCurrent(target.ref, destOutput)) {
            this.logToken("workspace-show-displaced-deferred");
            return;
        }
        try {
            const surface = this.liveWorkspace();
            if (surface !== null) {
                Reflect.set(surface, "activeWindow", active);
            }
        } catch (error) {
            void error;
        }
        this.logToken(`workspace-show-displaced:${activeId}`);
    }

    // On reconnect, if the active window lives in a returning workspace,
    // show it on the reconnected output and retain focus. Otherwise preserve.
    private showReturningIfActiveThere(returning: ReadonlyArray<string>, originKey: string, screens: ReadonlyArray<object>): void {
        const active = this.activeWindowRef();
        if (active === null) {
            this.logToken("workspace-preserve-view:no-active");
            return;
        }
        const members = this.windowDesktopIds(active);
        if (members === null) {
            this.logToken("workspace-preserve-view:active-unreadable");
            return;
        }
        const activeId = members.find((id) => returning.includes(id));
        if (activeId === undefined) {
            this.logToken("workspace-preserve-view:survivor-active");
            return;
        }
        const originOutput = this.outputForKey(screens, originKey);
        const target = this.findLive(activeId);
        if (originOutput === null || target === null) {
            this.logToken("workspace-show-returning-deferred");
            return;
        }
        if (!this.writeCurrent(target.ref, originOutput)) {
            this.logToken("workspace-show-returning-deferred");
            return;
        }
        try {
            const surface = this.liveWorkspace();
            if (surface !== null) {
                Reflect.set(surface, "activeWindow", active);
            }
        } catch (error) {
            void error;
        }
        this.logToken(`workspace-show-returning:${activeId}`);
    }

    private terminalRunStart(orderedIds: ReadonlyArray<string>, occupied: Set<string>): number {
        let start = orderedIds.length;
        for (let index = orderedIds.length - 1; index >= 0; index -= 1) {
            const id = orderedIds[index] as string;
            if (occupied.has(id)) {
                break;
            }
            start = index;
        }
        return start;
    }

    private collapseManagedTerminalRun(
        orderedIds: ReadonlyArray<string>,
        visible: Set<string>,
        occupied: Set<string>,
        remove: (id: string) => boolean,
    ): void {
        if (orderedIds.length === 0) {
            return;
        }
        const start = this.terminalRunStart(orderedIds, occupied);
        const run = orderedIds.slice(start);
        if (run.length <= 1) {
            return;
        }
        for (const id of run) {
            if (visible.has(id)) {
                return;
            }
        }
        const extras = run.slice(1);
        for (const id of extras) {
            const live = this.liveOrdered();
            if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
                return;
            }
            if (visible.has(id) || occupied.has(id)) {
                continue;
            }
            if (!remove(id)) {
                return;
            }
        }
    }

    private removeManagedTerminalLocal(id: string, visible: Set<string>): boolean {
        if (visible.has(id) || this.isTransactionRetained(id)) {
            return false;
        }
        const live = this.liveOrdered();
        if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
            return false;
        }
        const target = live.find((entry) => entry.id === id);
        if (target === undefined) {
            return false;
        }
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        const fn = readProp(surface, "removeDesktop");
        if (typeof fn !== "function") {
            return false;
        }
        try {
            Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref]);
        } catch (error) {
            void error;
            return false;
        }
        this.owned.delete(id);
        for (const list of this.localWorkspaces.values()) {
            const at = list.indexOf(id);
            if (at >= 0) {
                list.splice(at, 1);
            }
        }
        this.logToken(`workspace-cleanup-removed:${id}`);
        return true;
    }

    private removeManagedTerminalGlobal(id: string, visible: Set<string>): boolean {
        if (visible.has(id) || this.isTransactionRetained(id)) {
            return false;
        }
        const live = this.liveOrdered();
        if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
            return false;
        }
        const target = live.find((entry) => entry.id === id);
        if (target === undefined) {
            return false;
        }
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        const fn = readProp(surface, "removeDesktop");
        if (typeof fn !== "function") {
            return false;
        }
        try {
            Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref]);
        } catch (error) {
            void error;
            return false;
        }
        this.owned.delete(id);
        this.unassignGlobal(id);
        this.logToken(`workspace-cleanup-removed:${id}`);
        return true;
    }

    private removeManagedTerminalShared(id: string, visible: Set<string>): boolean {
        if (visible.has(id) || this.isTransactionRetained(id)) {
            return false;
        }
        const live = this.liveOrdered();
        if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
            return false;
        }
        const target = live.find((entry) => entry.id === id);
        if (target === undefined) {
            return false;
        }
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        const fn = readProp(surface, "removeDesktop");
        if (typeof fn !== "function") {
            return false;
        }
        try {
            Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref]);
        } catch (error) {
            void error;
            return false;
        }
        this.owned.delete(id);
        this.rebuildSharedMapping();
        this.logToken(`workspace-cleanup-removed:${id}`);
        return true;
    }

    private enforceLocalTrailing(visible: Set<string>, occupied: Set<string>): void {
        const screens = this.liveScreens();
        const live = this.liveOrdered();
        if (screens === null || live === null) {
            return;
        }
        this.reconciling = true;
        try {
            const keys: string[] = [];
            for (const output of screens) {
                const key = this.outputKeys.keyFor(output);
                if (key !== undefined && !keys.includes(key)) {
                    keys.push(key);
                }
            }
            for (const key of keys) {
                const orderedIds = [...(this.localWorkspaces.get(key) ?? [])];
                ensureTrailingEmptyDesktop({
                    orderedIds,
                    isEmpty: (id) => !occupied.has(id),
                    isVisible: (id) => visible.has(id),
                    removeDesktop: (id) => this.removeOwnedEmpty(id, visible),
                    createDesktop: () => this.appendDesktopForOutputKey(key),
                });
                const membership = new Set(this.localWorkspaces.get(key) ?? []);
                const refreshed = this.liveOrdered();
                const domainIds =
                    refreshed === null
                        ? [...membership]
                        : refreshed.filter((entry) => membership.has(entry.id)).map((entry) => entry.id);
                this.collapseManagedTerminalRun(domainIds, visible, occupied, (id) =>
                    this.removeManagedTerminalLocal(id, visible),
                );
            }
            const assigned = new Set<string>();
            for (const ids of this.localWorkspaces.values()) {
                for (const id of ids) {
                    assigned.add(id);
                }
            }
            const remaining = this.liveOrdered() ?? [];
            for (const entry of remaining) {
                if (assigned.has(entry.id) || occupied.has(entry.id) || visible.has(entry.id)) {
                    continue;
                }
                this.removeOwnedEmpty(entry.id, visible);
            }
        } finally {
            this.reconciling = false;
        }
    }

    private enforceGlobalTrailing(visible: Set<string>, occupied: Set<string>): void {
        const screens = this.liveScreens();
        const live = this.liveOrdered();
        if (screens === null || live === null) {
            return;
        }
        this.reconciling = true;
        try {
            const keys: string[] = [];
            for (const output of screens) {
                const key = this.outputKeys.keyFor(output);
                if (key !== undefined && !keys.includes(key)) {
                    keys.push(key);
                }
            }
            for (const key of keys) {
                const orderedIds = this.globalOrdered(live, key).map((entry) => entry.id);
                ensureTrailingEmptyDesktop({
                    orderedIds,
                    isEmpty: (id) => !occupied.has(id),
                    isVisible: (id) => visible.has(id),
                    removeDesktop: (id) => this.removeOwnedEmptyGlobal(id, visible),
                    createDesktop: () => this.appendDesktopForGlobalKey(key),
                });
                const refreshed = this.liveOrdered();
                const domainIds =
                    refreshed === null ? orderedIds : this.globalOrdered(refreshed, key).map((entry) => entry.id);
                this.collapseManagedTerminalRun(domainIds, visible, occupied, (id) =>
                    this.removeManagedTerminalGlobal(id, visible),
                );
            }
        } finally {
            this.reconciling = false;
        }
    }

    private enforceSharedTrailing(visible: Set<string>, occupied: Set<string>): void {
        const live = this.liveOrdered();
        if (live === null) {
            return;
        }
        this.reconciling = true;
        try {
            ensureTrailingEmptyDesktop({
                orderedIds: live.map((entry) => entry.id),
                isEmpty: (id) => !occupied.has(id),
                isVisible: (id) => visible.has(id),
                removeDesktop: (id) => this.removeOwnedEmptyShared(id, visible),
                createDesktop: () => this.appendDesktopForSharedIdOnly(),
            });
            const refreshed = this.liveOrdered();
            const domainIds = refreshed === null ? live.map((entry) => entry.id) : refreshed.map((entry) => entry.id);
            this.collapseManagedTerminalRun(domainIds, visible, occupied, (id) =>
                this.removeManagedTerminalShared(id, visible),
            );
        } finally {
            this.reconciling = false;
        }
    }

    private findLive(id: string): DesktopEntry | null {
        const live = this.liveOrdered();
        if (live === null) {
            return null;
        }
        for (const entry of live) {
            if (entry.id === id) {
                return entry;
            }
        }
        return null;
    }

    private localListForOutput(output: object): ReadonlyArray<string> | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        return this.localWorkspaces.get(key) ?? null;
    }

    private localTargetForOutput(output: object, index: number): DesktopEntry | null {
        const list = this.localListForOutput(output);
        if (list === null) {
            return null;
        }
        const id = list[index - 1];
        if (id === undefined) {
            return null;
        }
        return this.findLive(id);
    }

    private globalTargetForOutput(output: object, index: number): DesktopEntry | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        const live = this.liveOrdered();
        if (live === null) {
            return null;
        }
        const ordered = this.globalOrdered(live, key);
        const entry = ordered[index - 1];
        return entry === undefined ? null : entry;
    }

    private resolveLocalTrailing(output: object): DesktopEntry | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        const list = this.localWorkspaces.get(key) ?? [];
        const lastId = list[list.length - 1];
        if (lastId === undefined) {
            return null;
        }
        const occupied = this.occupiedIds();
        if (occupied === null || occupied.has(lastId)) {
            return null;
        }
        return this.findLive(lastId);
    }

    private resolveGlobalTrailing(output: object): DesktopEntry | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        const live = this.liveOrdered();
        if (live === null) {
            return null;
        }
        const ordered = this.globalOrdered(live, key);
        const last = ordered[ordered.length - 1];
        if (last === undefined) {
            return null;
        }
        const occupied = this.occupiedIds();
        if (occupied === null || occupied.has(last.id)) {
            return null;
        }
        return last;
    }

    private resolveSharedTrailing(): DesktopEntry | null {
        const live = this.liveOrdered();
        if (live === null) {
            return null;
        }
        const last = live[live.length - 1];
        if (last === undefined) {
            return null;
        }
        const occupied = this.occupiedIds();
        if (occupied === null || occupied.has(last.id)) {
            return null;
        }
        return last;
    }

    private selectLocal(index: number): boolean {
        const live = this.liveOrdered();
        if (live === null) {
            return false;
        }
        this.rebuildLocalMapping(live);
        const output = this.activeOutput();
        if (output === null) {
            const entry = live[index - 1];
            if (entry === undefined) {
                this.logToken(`workspace-navigate-absent:${String(index)}`);
                return false;
            }
            if (!this.writeCurrent(entry.ref, undefined)) {
                return false;
            }
            this.logToken(`workspace-navigate-completed:${String(index)}`);
            return true;
        }
        const target = this.localTargetForOutput(output, index);
        if (target === null) {
            this.logToken(`workspace-navigate-absent:${String(index)}`);
            return false;
        }
        if (!this.writeCurrent(target.ref, output)) {
            return false;
        }
        this.logToken(`workspace-navigate-completed:${String(index)}`);
        return true;
    }

    private selectGlobal(index: number): boolean {
        const live = this.liveOrdered();
        if (live === null) {
            return false;
        }
        const output = this.activeOutput();
        if (output === null) {
            return false;
        }
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return false;
        }
        const target = this.globalOrdered(live, key)[index - 1];
        if (target === undefined) {
            this.logToken(`workspace-navigate-absent:${String(index)}`);
            return false;
        }
        this.swapGlobalIfVisibleElsewhere(target, output);
        if (!this.writeCurrent(target.ref, output)) {
            return false;
        }
        this.logToken(`workspace-navigate-completed:${String(index)}`);
        return true;
    }

    private selectShared(index: number): boolean {
        const live = this.liveOrdered();
        if (live === null) {
            return false;
        }
        this.rebuildSharedMapping(live);
        const entry = live[index - 1];
        if (entry === undefined) {
            this.logToken(`workspace-navigate-absent:${String(index)}`);
            return false;
        }
        this.synchronizeShared(entry.ref);
        this.logToken(`workspace-navigate-completed:${String(index)}`);
        return true;
    }

    private selectLocalTrailing(output: object): boolean {
        const live = this.liveOrdered();
        if (live !== null) {
            this.rebuildLocalMapping(live);
        }
        const existing = this.resolveLocalTrailing(output);
        if (existing !== null) {
            const current = this.currentOnOutput(output);
            if (current !== null && current.id === existing.id) {
                this.logToken("workspace-zero-no-op:already-there");
                return true;
            }
            if (!this.writeCurrent(existing.ref, output)) {
                return false;
            }
            this.logToken("workspace-zero-completed");
            return true;
        }
        const created = this.appendTrailingForOutput(output);
        if (created === null) {
            return false;
        }
        if (!this.writeCurrent(created.ref, output)) {
            return false;
        }
        this.logToken("workspace-zero-completed");
        return true;
    }

    private selectGlobalTrailing(output: object): boolean {
        const live = this.liveOrdered();
        if (live !== null) {
            this.rebuildGlobalMapping(live);
        }
        const existing = this.resolveGlobalTrailing(output);
        if (existing !== null) {
            const current = this.currentOnOutput(output);
            if (current !== null && current.id === existing.id) {
                this.logToken("workspace-zero-no-op:already-there");
                return true;
            }
            if (!this.writeCurrent(existing.ref, output)) {
                return false;
            }
            this.logToken("workspace-zero-completed");
            return true;
        }
        const created = this.appendDesktopForGlobal(output);
        if (created === null) {
            return false;
        }
        if (!this.writeCurrent(created.ref, output)) {
            return false;
        }
        this.logToken("workspace-zero-completed");
        return true;
    }

    private selectSharedTrailing(): boolean {
        const live = this.liveOrdered();
        if (live !== null) {
            this.rebuildSharedMapping(live);
        }
        const existing = this.resolveSharedTrailing();
        if (existing !== null) {
            const current = this.currentShared();
            if (current !== null && current.id === existing.id) {
                this.logToken("workspace-zero-no-op:already-there");
                return true;
            }
            this.synchronizeShared(existing.ref);
            this.logToken("workspace-zero-completed");
            return true;
        }
        const created = this.appendDesktopForShared();
        if (created === null) {
            return false;
        }
        this.synchronizeShared(created.ref);
        this.logToken("workspace-zero-completed");
        return true;
    }

    private swapGlobalIfVisibleElsewhere(target: DesktopEntry, active: object): void {
        const screens = this.liveScreens();
        if (screens === null) {
            return;
        }
        let activeCurrent: DesktopEntry | null = null;
        for (const other of screens) {
            if (other === active) {
                continue;
            }
            const current = this.currentOnOutput(other);
            if (current === null || current.id !== target.id) {
                continue;
            }
            if (activeCurrent === null) {
                activeCurrent = this.currentOnOutput(active);
            }
            if (activeCurrent === null || activeCurrent.id === target.id) {
                return;
            }
            const activeKey = this.outputKeys.keyFor(active);
            const otherKey = this.outputKeys.keyFor(other);
            if (activeKey === undefined || otherKey === undefined) {
                return;
            }
            this.assignGlobal(target.id, activeKey);
            this.assignGlobal(activeCurrent.id, otherKey);
            const surface = this.liveWorkspace();
            if (surface === null) {
                return;
            }
            const fn = readProp(surface, "setCurrentDesktopForScreen");
            if (typeof fn !== "function") {
                return;
            }
            try {
                Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref, active]);
                Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [activeCurrent.ref, other]);
                this.logToken("workspace-navigate-swap");
            } catch (error) {
                void error;
            }
            return;
        }
    }

    private writeCurrent(desktop: object, output: object | undefined): boolean {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        if (output !== undefined) {
            const fn = readProp(surface, "setCurrentDesktopForScreen");
            if (typeof fn !== "function") {
                return false;
            }
            try {
                Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [desktop, output]);
                return true;
            } catch (error) {
                void error;
                return false;
            }
        }
        try {
            Reflect.set(surface, "currentDesktop", desktop);
            return true;
        } catch (error) {
            void error;
            return false;
        }
    }

    private synchronizeShared(desktop: object): void {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return;
        }
        const screens = this.liveScreens();
        const fn = readProp(surface, "setCurrentDesktopForScreen");
        if (screens === null || typeof fn !== "function") {
            try {
                Reflect.set(surface, "currentDesktop", desktop);
                this.logToken("workspace-navigate-set");
            } catch (error) {
                void error;
            }
            return;
        }
        for (const output of screens) {
            try {
                Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [desktop, output]);
                this.logToken("workspace-navigate-set");
            } catch (error) {
                void error;
            }
        }
    }

    private appendDesktop(): DesktopEntry | null {
        const surface = this.liveWorkspace();
        if (surface === null) {
            return null;
        }
        const before = this.liveOrdered();
        if (before === null) {
            return null;
        }
        const beforeIds = new Set(before.map((entry) => entry.id));
        const fn = readProp(surface, "createDesktop");
        if (typeof fn !== "function") {
            return null;
        }
        const guarding = !this.reconciling;
        if (guarding) {
            this.reconciling = true;
        }
        try {
            try {
                Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [before.length + 1, String(before.length + 1)]);
            } catch (error) {
                void error;
                return null;
            }
            const after = this.liveOrdered();
            if (after === null) {
                return null;
            }
            const fresh = after.filter((entry) => !beforeIds.has(entry.id));
            const candidate = fresh.length === 1 ? fresh[0] : fresh[fresh.length - 1];
            if (candidate === undefined) {
                return null;
            }
            this.owned.add(candidate.id);
            this.logToken("workspace-created-owned");
            return candidate;
        } finally {
            if (guarding) {
                this.reconciling = false;
            }
        }
    }

    private appendTrailingForOutput(output: object): DesktopEntry | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        return this.appendDesktopForOutputKeyEntry(key);
    }

    private appendDesktopForOutputKey(key: string): string | null {
        const created = this.appendDesktopForOutputKeyEntry(key);
        return created === null ? null : created.id;
    }

    private appendDesktopForOutputKeyEntry(key: string): DesktopEntry | null {
        const created = this.appendDesktop();
        if (created !== null) {
            const list = this.localWorkspaces.get(key) ?? [];
            list.push(created.id);
            this.localWorkspaces.set(key, list);
        }
        return created;
    }

    private appendDesktopForGlobal(output: object): DesktopEntry | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        return this.appendDesktopForGlobalKeyEntry(key);
    }

    private appendDesktopForGlobalKey(key: string): string | null {
        const created = this.appendDesktopForGlobalKeyEntry(key);
        return created === null ? null : created.id;
    }

    private appendDesktopForGlobalKeyEntry(key: string): DesktopEntry | null {
        const created = this.appendDesktop();
        if (created !== null) {
            this.assignGlobal(created.id, key);
        }
        return created;
    }

    private appendDesktopForShared(): DesktopEntry | null {
        const created = this.appendDesktop();
        if (created !== null) {
            this.rebuildSharedMapping();
        }
        return created;
    }

    private appendDesktopForSharedIdOnly(): string | null {
        const created = this.appendDesktopForShared();
        return created === null ? null : created.id;
    }

    private removeOwnedEmpty(id: string, visible: Set<string>): boolean {
        if (!this.owned.has(id) || visible.has(id) || this.isTransactionRetained(id)) {
            return false;
        }
        const live = this.liveOrdered();
        if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
            return false;
        }
        const target = live.find((entry) => entry.id === id);
        if (target === undefined) {
            return false;
        }
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        const fn = readProp(surface, "removeDesktop");
        if (typeof fn !== "function") {
            return false;
        }
        try {
            Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref]);
        } catch (error) {
            void error;
            return false;
        }
        this.owned.delete(id);
        for (const list of this.localWorkspaces.values()) {
            const at = list.indexOf(id);
            if (at >= 0) {
                list.splice(at, 1);
            }
        }
        this.logToken(`workspace-cleanup-removed:${id}`);
        return true;
    }

    private removeOwnedEmptyGlobal(id: string, visible: Set<string>): boolean {
        if (!this.owned.has(id) || visible.has(id) || this.isTransactionRetained(id)) {
            return false;
        }
        const live = this.liveOrdered();
        if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
            return false;
        }
        const target = live.find((entry) => entry.id === id);
        if (target === undefined) {
            return false;
        }
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        const fn = readProp(surface, "removeDesktop");
        if (typeof fn !== "function") {
            return false;
        }
        try {
            Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref]);
        } catch (error) {
            void error;
            return false;
        }
        this.owned.delete(id);
        this.unassignGlobal(id);
        this.logToken(`workspace-cleanup-removed:${id}`);
        return true;
    }

    private removeOwnedEmptyShared(id: string, visible: Set<string>): boolean {
        if (!this.owned.has(id) || visible.has(id) || this.isTransactionRetained(id)) {
            return false;
        }
        const live = this.liveOrdered();
        if (live === null || live.length <= MIN_GLOBAL_DESKTOPS) {
            return false;
        }
        const target = live.find((entry) => entry.id === id);
        if (target === undefined) {
            return false;
        }
        const surface = this.liveWorkspace();
        if (surface === null) {
            return false;
        }
        const fn = readProp(surface, "removeDesktop");
        if (typeof fn !== "function") {
            return false;
        }
        try {
            Reflect.apply(fn as (...args: ReadonlyArray<unknown>) => unknown, surface, [target.ref]);
        } catch (error) {
            void error;
            return false;
        }
        this.owned.delete(id);
        this.rebuildSharedMapping();
        this.logToken(`workspace-cleanup-removed:${id}`);
        return true;
    }
}
