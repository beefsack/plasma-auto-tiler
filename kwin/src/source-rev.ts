// Compile-time source identity. The installed KWin bundle build
// (build:installed) bakes the flake's existing PLASMA_AUTO_TILER_SOURCE_REV
// into this constant through an esbuild define; ordinary npm builds (no
// define) resolve deterministically to the local-dev fallback. The value is
// bounded to a git revision (40 or 64 lowercase hex) so the constant can
// never carry arbitrary data; anything else falls back to local-dev. Never
// reads files or environment at runtime.
declare const __PLASMA_AUTO_TILER_SOURCE_REV__: string | undefined;

const SOURCE_REV_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function resolveSourceRev(): string {
    const candidate: unknown =
        typeof __PLASMA_AUTO_TILER_SOURCE_REV__ === "string"
            ? __PLASMA_AUTO_TILER_SOURCE_REV__
            : undefined;
    if (typeof candidate === "string" && SOURCE_REV_PATTERN.test(candidate)) {
        return candidate;
    }
    return "local-dev";
}

export const PLAN_SOURCE_REV: string = resolveSourceRev();