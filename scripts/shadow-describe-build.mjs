// Thin shadow-describe builder wrapper (internal mode selector only).
//
// Sets the strictly internal SHADOW_DESCRIBE_BUILD_MODE=shadow and delegates
// to the generic scripts/advisory-describe-build.mjs with the caller's argv.
// No other production/KPackage/tray/KCM/shortcut/autostart/controller route
// may set this mode; default builder invocations remain advisory.
//
// Usage:
//   node scripts/shadow-describe-build.mjs --input <request.json> --out <bundle>
//   node scripts/shadow-describe-build.mjs --verify --input <request.json> --bundle <bundle> --manifest <manifest>
process.env.SHADOW_DESCRIBE_BUILD_MODE = "shadow";
await import("./advisory-describe-build.mjs");
