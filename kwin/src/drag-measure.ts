import { deriveOracleEdge, DragOracleVerdict } from "./drag-oracle-pull";

export const DRAG_MEASURE_LATER_TIMEOUT_MS = 500;
export const DRAG_MEASURE_VERDICT_TIMEOUT_MS = 2000;
const MEASURE_LINE = "plasma-auto-tiler:route-diag:drag-measure";
const COORD_LIMIT = 16384;

export interface DragMeasureRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface DragMeasurePointer {
    readonly x: number;
    readonly y: number;
}

function toBoundedInt(value: unknown): number | null {
    try {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return null;
        }
        const rounded = Math.round(value);
        if (!Number.isSafeInteger(rounded)) {
            return null;
        }
        return rounded;
    } catch (error) {
        void error;
        return null;
    }
}

// Script-side finish/start rect read: frameGeometry only, never the effect's
// moveResizeGeometry. Quantized and range-checked like the entry observer.
// Fail-closed null, never throws.
export function readMeasureRect(ref: object): DragMeasureRect | null {
    try {
        const geometry: unknown = Reflect.get(ref as Record<string, unknown>, "frameGeometry");
        if (typeof geometry !== "object" || geometry === null) {
            return null;
        }
        const record = geometry as Record<string, unknown>;
        const x = toBoundedInt(record["x"]);
        const y = toBoundedInt(record["y"]);
        const widthRaw = record["width"] !== undefined ? record["width"] : record["w"];
        const heightRaw = record["height"] !== undefined ? record["height"] : record["h"];
        const w = toBoundedInt(widthRaw);
        const h = toBoundedInt(heightRaw);
        if (x === null || y === null || w === null || h === null) {
            return null;
        }
        if (w <= 0 || h <= 0) {
            return null;
        }
        if (x < -COORD_LIMIT || x > COORD_LIMIT || y < -COORD_LIMIT || y > COORD_LIMIT) {
            return null;
        }
        if (w > COORD_LIMIT || h > COORD_LIMIT) {
            return null;
        }
        return { x, y, w, h };
    } catch (error) {
        void error;
        return null;
    }
}

// Script-side pointer read: workspace.cursorPos only. Fail-closed null,
// never throws. No window identity, title, or native id is read here.
export function readMeasurePointer(workspace: unknown): DragMeasurePointer | null {
    try {
        if (typeof workspace !== "object" || workspace === null) {
            return null;
        }
        const pos: unknown = Reflect.get(workspace as Record<string, unknown>, "cursorPos");
        if (typeof pos !== "object" || pos === null) {
            return null;
        }
        const record = pos as Record<string, unknown>;
        const x = toBoundedInt(record["x"]);
        const y = toBoundedInt(record["y"]);
        if (x === null || y === null) {
            return null;
        }
        if (x < -COORD_LIMIT || x > COORD_LIMIT || y < -COORD_LIMIT || y > COORD_LIMIT) {
            return null;
        }
        return { x, y };
    } catch (error) {
        void error;
        return null;
    }
}

export function describeMeasureEdge(
    start: DragMeasureRect | null,
    finish: DragMeasureRect | null,
): { direction: string; boundary: number } | "mixed" | null {
    try {
        if (start === null || finish === null) {
            return null;
        }
        return deriveOracleEdge(start, finish);
    } catch (error) {
        void error;
        return null;
    }
}

function isCorrelationToken(value: unknown): value is string {
    return typeof value === "string" && /^drag-[0-9]+$/.test(value) && value.length <= 128;
}

function isReasonToken(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9-]+$/.test(value);
}

function formatRect(rect: DragMeasureRect | null): string {
    if (rect === null) {
        return "missing";
    }
    return `${String(rect.x)},${String(rect.y)},${String(rect.w)},${String(rect.h)}`;
}

function formatPointer(pointer: DragMeasurePointer | null): string {
    if (pointer === null) {
        return "missing";
    }
    return `${String(pointer.x)},${String(pointer.y)}`;
}

function formatEdge(edge: { direction: string; boundary: number } | "mixed" | null): string {
    if (edge === null) {
        return "none";
    }
    if (edge === "mixed") {
        return "mixed";
    }
    if (edge.direction !== "left" && edge.direction !== "right" && edge.direction !== "up" && edge.direction !== "down") {
        return "none";
    }
    if (!Number.isSafeInteger(edge.boundary)) {
        return "none";
    }
    return `${edge.direction}:${String(edge.boundary)}`;
}

export interface DragMeasureLineArgs {
    readonly seq: number;
    readonly correlation: string;
    readonly start: DragMeasureRect | null;
    readonly finish: DragMeasureRect | null;
    readonly later: DragMeasureRect | null;
    readonly laterTimeout: boolean;
    readonly verdict: DragOracleVerdict | null;
    readonly verdictMissing: boolean;
    readonly edge: { direction: string; boundary: number } | "mixed" | null;
    readonly pointerStart: DragMeasurePointer | null;
    readonly pointerFinish: DragMeasurePointer | null;
}

// One bounded correlated record per interactive move/resize finish. Numeric
// geometry and pointer fields plus the existing drag correlation only: no
// titles, no window identity, no raw native ids. Never throws.
export function formatDragMeasureLine(args: DragMeasureLineArgs): string {
    try {
        const seq = Number.isSafeInteger(args.seq) && args.seq >= 0 ? args.seq : 0;
        const correlation = isCorrelationToken(args.correlation) ? args.correlation : "none";
        const later = args.laterTimeout ? "timeout" : formatRect(args.later);
        const cancelled = args.verdictMissing ? "missing" : args.verdict?.cancelled === true ? "true" : "false";
        const reason =
            !args.verdictMissing && args.verdict !== null && isReasonToken(args.verdict.reason) ? args.verdict.reason : "missing";
        const final = !args.verdictMissing && args.verdict !== null ? formatRect(args.verdict.finalRect) : "none";
        return (
            `${MEASURE_LINE} seq=${String(seq)} correlation=${correlation}` +
            ` start=${formatRect(args.start)} finish=${formatRect(args.finish)} later=${later}` +
            ` verdict=${cancelled} reason=${reason} final=${final}` +
            ` edge=${formatEdge(args.edge)}` +
            ` pointerStart=${formatPointer(args.pointerStart)} pointerFinish=${formatPointer(args.pointerFinish)}`
        );
    } catch (error) {
        void error;
        return `${MEASURE_LINE} seq=0 correlation=none start=missing finish=missing later=missing verdict=missing reason=missing final=none edge=none pointerStart=missing pointerFinish=missing`;
    }
}
