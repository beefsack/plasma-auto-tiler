// Shared native Window internalId normalization.
//
// Established canonical form: String(internalId) with a single exact
// braced-UUID case unwrapped to its bare opaque UUID. Anything else that is
// not already an opaque id rejects fail-closed as null. Observation callers
// must invoke this while the Window object is live; never read an id from a
// removal signal payload.

const MAX_NATIVE_ID_LEN = 128;

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_NATIVE_ID_LEN) {
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

function isHexRun(text: string): boolean {
    if (text.length === 0) {
        return false;
    }
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        const digit = code >= 48 && code <= 57;
        const lower = code >= 97 && code <= 102;
        const upper = code >= 65 && code <= 70;
        if (!(digit || lower || upper)) {
            return false;
        }
    }
    return true;
}

function isUuidText(text: string): boolean {
    const parts = text.split("-");
    const lens: readonly number[] = [8, 4, 4, 4, 12];
    if (parts.length !== lens.length) {
        return false;
    }
    for (let index = 0; index < lens.length; index += 1) {
        const part = parts[index] as string;
        if (part.length !== (lens[index] as number) || !isHexRun(part)) {
            return false;
        }
    }
    return true;
}

function unwrapBraced(text: string): string | null {
    if (text.length !== 38 || !text.startsWith("{") || !text.endsWith("}")) {
        return null;
    }
    const inner = text.slice(1, 37);
    if (!isUuidText(inner) || !isOpaqueId(inner)) {
        return null;
    }
    return inner;
}

export function normalizeNativeId(value: unknown): string | null {
    if (typeof value === "string") {
        if (isOpaqueId(value)) {
            return value;
        }
        return unwrapBraced(value);
    }
    let text = "";
    try {
        text = String(value);
    } catch (error) {
        void error;
        return null;
    }
    if (isOpaqueId(text)) {
        return text;
    }
    return unwrapBraced(text);
}
