declare const PROVENANCE_NONCE: string;
declare const PROVENANCE_BUILD_ID: string;
declare const PROVENANCE_PLUGIN_ID: string;

// This bundle intentionally has no KWin workspace, shortcut, timer, or D-Bus
// access. Its only purpose is to identify the exact script instance that was
// loaded by the setup probe.
console.log(`plasma-auto-tiler:provenance-ready:plugin=${PROVENANCE_PLUGIN_ID}:nonce=${PROVENANCE_NONCE}:build=${PROVENANCE_BUILD_ID}`);
