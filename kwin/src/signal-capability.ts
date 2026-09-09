// Bounded QObject signal capability for KWin 6.7.4 entries.
//
// KWin exposes QObject signals as callable QV4 functions with connect and
// disconnect installed on the function prototype, not as plain objects. This
// narrow helper accepts either surface shape (callable or object) and
// attaches/detaches the same handler exactly once. No discovery, no globals,
// no timers, no polling.

export type SignalHandler = (payload?: unknown) => void;
export type SignalDetach = () => void;

export interface ConnectableSignal {
    readonly connect: (handler: SignalHandler) => void;
    readonly disconnect: (handler: SignalHandler) => void;
}

function readMethod(value: object, name: "connect" | "disconnect"): ((handler: SignalHandler) => void) | null {
    let method: unknown = undefined;
    try {
        method = Reflect.get(value, name);
    } catch (error) {
        void error;
        return null;
    }
    if (typeof method !== "function") {
        return null;
    }
    return method as (handler: SignalHandler) => void;
}

export function isConnectableSignal(value: unknown): value is ConnectableSignal {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
        return false;
    }
    try {
        const candidate = value as object;
        return readMethod(candidate, "connect") !== null && readMethod(candidate, "disconnect") !== null;
    } catch (error) {
        void error;
        return false;
    }
}

export function readSignal(owner: object, name: string): unknown {
    try {
        return Reflect.get(owner, name);
    } catch (error) {
        void error;
        return undefined;
    }
}

// Attaches handler to a callable-or-object QObject signal surface. Returns an
// idempotent detach on success, null fail-closed when the surface is not
// connectable or connect throws. Detach always releases the same handler.
export function connectSignal(surface: unknown, handler: SignalHandler): SignalDetach | null {
    if (!isConnectableSignal(surface)) {
        return null;
    }
    try {
        Reflect.apply(surface.connect as (handler: SignalHandler) => void, surface, [handler]);
    } catch (error) {
        void error;
        return null;
    }
    let detached = false;
    return (): void => {
        if (detached) {
            return;
        }
        detached = true;
        try {
            Reflect.apply(surface.disconnect as (handler: SignalHandler) => void, surface, [handler]);
        } catch (error) {
            void error;
        }
    };
}
