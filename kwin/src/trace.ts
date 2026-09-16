// Trace is a compile-time development-only switch. KWin scripts have no
// supported runtime environment API, so ordinary bundles remain trace-free.
declare const __PLASMA_AUTO_TILER_TRACE__: string | undefined;

export const KWIN_TRACE_ENABLED: boolean =
    typeof __PLASMA_AUTO_TILER_TRACE__ === "string" && __PLASMA_AUTO_TILER_TRACE__ === "1";
