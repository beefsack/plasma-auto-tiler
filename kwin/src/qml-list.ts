// Decode bounded KWin arrays and QML array-like values without trusting getters.
export function decodeList(value: unknown, maxLength: number): ReadonlyArray<unknown> | null {
    if (typeof value !== "object" || value === null) return null;
    if (Array.isArray(value)) return value.length <= maxLength ? value : null;
    let length: unknown = undefined;
    try {
        length = Reflect.get(value, "length");
    } catch (_e) {
        return null;
    }
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > maxLength) return null;
    const out: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
        let el: unknown = undefined;
        try {
            el = Reflect.get(value, String(i));
        } catch (_e) {
            return null;
        }
        if (el === undefined) return null;
        out.push(el);
    }
    return out;
}
