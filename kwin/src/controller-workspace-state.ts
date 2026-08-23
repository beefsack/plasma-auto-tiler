import {
    decodeSequential,
    desktopNumber,
    isVirtualDesktop,
    MAX_SEQUENTIAL_LENGTH,
    type OutputCapability,
    type VirtualDesktopCapability,
    type WindowCapability,
} from "./boundary";
import { type Scope } from "./logic";

export function outputTuple(output: OutputCapability): string {
    return [output.manufacturer, output.model, output.serialNumber, output.name].join("\u0000");
}

// Session-local deterministic output key registry. Keys are derived from the
// ordered output tuple and assigned in first-seen order; a rebuild matches each
// output against the earliest unconsumed slot with the same tuple.
export class SessionOutputKeys {
    private readonly slots: Array<{ readonly key: string; readonly tuple: string }> = [];
    private readonly byOutput = new Map<OutputCapability, string>();
    private readonly tupleKeys = new Map<string, string[]>();
    private readonly reportedUnknown = new Set<string>();
    private next = 0;

    constructor(
        private readonly reportUnknown?: (tuple: string) => void,
    ) {}

    rebuild(outputs: readonly OutputCapability[]): void {
        this.byOutput.clear();
        this.tupleKeys.clear();
        const consumed = new Set<number>();
        for (const output of outputs) {
            const tuple = outputTuple(output);
            let matchedIndex = -1;
            let entry: { readonly key: string; readonly tuple: string } | undefined;
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
                entry = { key: `output-${this.next}`, tuple };
                this.next += 1;
                this.slots.push(entry);
            }
            consumed.add(matchedIndex);
            this.byOutput.set(output, entry.key);
            const keys = this.tupleKeys.get(tuple);
            if (keys === undefined) {
                this.tupleKeys.set(tuple, [entry.key]);
            } else if (!keys.includes(entry.key)) {
                keys.push(entry.key);
            }
        }
    }

    keyFor(output: OutputCapability): string | undefined {
        const direct = this.byOutput.get(output);
        if (direct !== undefined) {
            return direct;
        }
        const tuple = outputTuple(output);
        const keys = this.tupleKeys.get(tuple);
        if (keys !== undefined && keys.length > 0) {
            return keys[0];
        }
        if (!this.reportedUnknown.has(tuple)) {
            this.reportedUnknown.add(tuple);
            this.reportUnknown?.(tuple);
        }
        return undefined;
    }
}

type DesktopScopeCheck = "decode-failed" | "no-desktops" | "no-match" | "match";

export function desktopScopeCheck(
    window: WindowCapability,
    scope: { readonly scope: Scope },
): DesktopScopeCheck {
    const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
    if (!desktops.ok) {
        return "decode-failed";
    }
    if (desktops.value.length === 0) {
        return "no-desktops";
    }
    return desktops.value.some((desktop) => desktop.id === scope.scope.desktopId) ? "match" : "no-match";
}

export function orderedDesktops(desktops: readonly VirtualDesktopCapability[]): readonly VirtualDesktopCapability[] {
    const indexed = desktops.map((desktop, index) => ({ desktop, number: desktopNumber(desktop), index }));
    const allNumbered = indexed.every((entry) => entry.number !== null);
    const ordered = allNumbered
        ? indexed.slice().sort((a, b) => (a.number as number) - (b.number as number))
        : indexed.slice().sort((a, b) => a.index - b.index);
    return ordered.map((entry) => entry.desktop);
}

const SNAPSHOT_CAPTION_LIMIT = 40;

export function snapshotCaption(value: unknown): string {
    const caption = typeof value === "string" ? value : "";
    return caption.length > SNAPSHOT_CAPTION_LIMIT ? caption.slice(0, SNAPSHOT_CAPTION_LIMIT) : caption;
}

export interface TrailingEmptyDomainRequest {
    readonly orderedIds: readonly string[];
    readonly isEmpty: (id: string) => boolean;
    readonly isVisible: (id: string) => boolean;
    readonly removeDesktop: (id: string) => boolean;
    readonly createDesktop: () => string | null;
}

export interface TrailingEmptyDomainResult {
    readonly removedIds: readonly string[];
    readonly appendedId: string | null;
}

// Enforces the trailing-empty invariant for one domain in a single pass. The
// trailing empty is always the literal last ordered desktop, never a cached ID.
export function ensureTrailingEmptyDesktop(
    request: TrailingEmptyDomainRequest,
): TrailingEmptyDomainResult {
    const { orderedIds, isEmpty, isVisible, removeDesktop, createDesktop } = request;
    const lastId = orderedIds[orderedIds.length - 1];
    const trailingEmptyId = lastId !== undefined && isEmpty(lastId) ? lastId : null;
    const removedIds: string[] = [];
    for (const id of orderedIds) {
        if (id === trailingEmptyId) {
            continue;
        }
        if (!isEmpty(id) || isVisible(id)) {
            continue;
        }
        if (removeDesktop(id)) {
            removedIds.push(id);
        }
    }
    const removed = new Set(removedIds);
    const remainingIds = orderedIds.filter((id) => !removed.has(id));
    const trailingId = remainingIds[remainingIds.length - 1];
    const trailingSatisfied = trailingId !== undefined && isEmpty(trailingId);
    if (trailingSatisfied) {
        return { removedIds, appendedId: null };
    }
    const appendedId = createDesktop();
    return { removedIds, appendedId };
}
