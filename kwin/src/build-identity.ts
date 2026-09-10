import { formatLifecycleDiag } from "./route-diag";

export const PACKAGE_VERSION = "0.1.0";
export const LOCAL_DEV_FALLBACK = "local-dev";

declare const PLASMA_AUTO_TILER_SOURCE_REV: string | undefined;

function rawSourceRev(): string {
    return typeof PLASMA_AUTO_TILER_SOURCE_REV === "string"
        ? PLASMA_AUTO_TILER_SOURCE_REV
        : LOCAL_DEV_FALLBACK;
}

// Bounded identity: exactly local-dev or [0-9a-f]{40}.
export function isBuildIdentity(value: unknown): boolean {
    if (value === LOCAL_DEV_FALLBACK) {
        return true;
    }
    if (typeof value !== "string" || value.length !== 40) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const digit = code >= 48 && code <= 57;
        const lowerHex = code >= 97 && code <= 102;
        if (!digit && !lowerHex) {
            return false;
        }
    }
    return true;
}

export function sourceRev(): string {
    const raw = rawSourceRev();
    return isBuildIdentity(raw) ? raw : LOCAL_DEV_FALLBACK;
}

export function startupLine(): string {
    return formatLifecycleDiag("bridge", "started", sourceRev(), undefined, "ok", PACKAGE_VERSION);
}
