#!/usr/bin/env bash
# Advisory DescribeAdvisoryPlan host lifecycle (future authorized host only).
#
# Not invoked now: no live KWin/Plasma, D-Bus, process, or session contact
# happens in this unit. Every transport below runs only on an explicit future
# authorized host pass, and only through the exact recorded receipt of this
# namespace. Static checks and fake-command tests cover the contract instead.
#
# The advisory bundle is read-only coexistence-safe: production must stay
# loaded and is never unloaded or reloaded here. Before any transport the
# loader proves advisory-only shape against the exact current sources (pinned
# to the manifest shas and embedded in the bundle), checks the bundle only
# for IIFE/no-ESM/no-imports/no-source-map structure, requires byte-exact
# build identity plus the exact input binding, and runs the builder verify
# mode (deterministic rebuild to temp, byte-compare) before any bus call.
#
# Subcommands (all narrow, all receipt-scoped unless noted):
#   preflight --bundle B --manifest M --input I
#         [--expected-planner-owner U]
#     strict resource-free read-only checks only: tools, exact sources,
#     advisory-only shape, KWin identity, production loaded, advisory absent,
#     Planner absent by default or exact present-owner proof when the explicit
#     unique owner is supplied. Emits only safe machine-independent manifest
#     identity (bundle/entry/query/snapshot/input shas plus owner/generation/
#     revision/correlation/nonce). Creates no temp files, dirs, or receipts and
#     performs no bus mutation.
#   start --bundle B --manifest M --receipt R --diag-file D --input I
#         [--attempts N] [--delay S] [--expected-planner-owner U]
#         [--expected-refusal-detail D --expected-refusal-after V]
#         [--refusal-service-loss]
#     validate bundle plus manifest exactly, prove advisory-only shape,
#     loadScript the exact bundle under the fixed plugin id, introspect only
#     the returned /Scripting/Script<ID> object, run only that object, then
#     collect the correlation-bound ready/result markers boundedly. Writes
#     the receipt only on full success. Any run failure or identity mismatch
#     unloads only the recorded exact id and leaves no receipt. The explicit
#     strict terminal-refusal mode requires the paired exact expected detail
#     plus exact expected after verdict; after all source/ready/result/after
#     identity/order checks it accepts only that exact pair, then exact-cleans
#     only the recorded object/plugin and returns success with no receipt.
#     Present-owner refusal (with --expected-planner-owner) post-revalidates
#     the exact owner triple before accepting; service-loss refusal (with
#     --refusal-service-loss) skips the present postcheck.
#   status --receipt R
#     strict-parse the receipt, then report only the recorded plugin load
#     state plus the recorded identity. No mutation.
#   diagnostics --receipt R [--diag-file D]
#     strict-parse the receipt and re-validate the recorded correlation-bound
#     markers in the given diag file when supplied. No bus mutation.
#   stop --receipt R
#     strict-parse the receipt, stop only the recorded exact object, unload
#     only the recorded exact plugin id, verify absent, remove the receipt.
#
# Diagnostics contract (emitted by kwin/src/advisory-describe-entry.ts):
#   source: plasma-auto-tiler:advisory-describe-source:<entrySha>:<querySha>:<snapshotSha>
#   ready:  plasma-auto-tiler:advisory-describe-ready:<correlation>
#   result: plasma-auto-tiler:advisory-describe-result:v1:<correlation>:<owner>:
#           <generation>:<revision>:<nonce>:<detail>
#   after:  plasma-auto-tiler:advisory-describe-after:v1:<correlation>:<true|false>
# The loader accepts a result only when the fixed v1 prefix sits at column
# zero with every identity field equal to the manifest record and the detail
# suffix matching [A-Za-z0-9._:-]{1,512}. The bounded opaque correlated after
# verdict is required after the correlated result from a byte boundary
# captured after the result marker (an earlier/replayed after marker cannot
# satisfy start) with the fixed v1 prefix at column zero and verdict exactly
# true or false. Receipt creation requires the successful
# could-execute:<rule>:<capability> detail (strict allowlisted rule plus
# kebab capability, e.g. could-execute:R2a:swap-neighbor) paired with after
# true; after false with the exact stale reject
# reject:advisory-stale-snapshot is an observed terminal refusal that
# exact-cleans with no receipt (diagnostic preserved, nonzero exit); no other
# detail receives a receipt. Mid-line prefixes,
# empty/oversize details, invalid/mismatched after markers, and any
# generation/revision/nonce mismatch fail closed with
# exact-id cleanup. The bound source and after markers are required post-run
# in start and on diagnostics with a diag file. Receipt creation is exclusive
# (real parent dir, symlink refusal, noclobber) and never overwrites.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Canonical shared systemd-backed KWin identity helper (authorized fallback
# only). Sourced for the read-only host immutable preflight below.
# shellcheck source=./poc3-host-kwin-identity.sh
. "$REPO_ROOT/scripts/poc3-host-kwin-identity.sh"
KWIN_DIR="$REPO_ROOT/kwin"
# Strictly internal shadow mode, selected only by the thin shadow-describe
# wrapper (scripts/shadow-describe.sh via SHADOW_DESCRIBE_HOST_MODE=shadow).
# Default (unset/any other value) is the exact advisory behavior with
# byte-identical outputs. No normal production/KPackage/tray/KCM/shortcut/
# autostart/controller route may set this mode.
: "${SHADOW_DESCRIBE_HOST_MODE:=advisory}"
case "$SHADOW_DESCRIBE_HOST_MODE" in
  advisory|shadow) ;;
  *) printf 'error: invalid SHADOW_DESCRIBE_HOST_MODE (expected advisory|shadow)\n' >&2; exit 1 ;;
esac
IS_SHADOW="0"
KIND_LABEL="advisory"
if [[ "$SHADOW_DESCRIBE_HOST_MODE" == "shadow" ]]; then
  IS_SHADOW="1"
  KIND_LABEL="shadow"
fi
# Builder verify must run in the same mode as the host so the deterministic
# rebuild binds the same entry/second/snapshot sources and defines. Advisory
# default (any non-shadow value) stays byte-identical; only the thin
# shadow-describe wrapper selects shadow.
if [[ "$IS_SHADOW" == "1" ]]; then
  export SHADOW_DESCRIBE_BUILD_MODE="shadow"
else
  export SHADOW_DESCRIBE_BUILD_MODE="advisory"
fi
if [[ "$IS_SHADOW" == "1" ]]; then
  SRC_ENTRY="$KWIN_DIR/src/shadow-describe-entry.ts"
  SRC_QUERY="$KWIN_DIR/src/advisory-shadow-projection.ts"
else
  SRC_ENTRY="$KWIN_DIR/src/advisory-describe-entry.ts"
  SRC_QUERY="$KWIN_DIR/src/advisory-plan-query.ts"
fi
SRC_SNAPSHOT="$KWIN_DIR/src/advisory-snapshot.ts"
SRC_SECOND_BASENAME="advisory-plan-query.ts"
SRC_ENTRY_BASENAME="advisory-describe-entry.ts"
if [[ "$IS_SHADOW" == "1" ]]; then
  SRC_SECOND_BASENAME="advisory-shadow-projection.ts"
  SRC_ENTRY_BASENAME="shadow-describe-entry.ts"
fi
BUILDER="$REPO_ROOT/scripts/advisory-describe-build.mjs"
if [[ "$IS_SHADOW" == "1" ]]; then
  PLUGIN="plasma-auto-tiler-shadow-describe"
else
  PLUGIN="plasma-auto-tiler-advisory-describe"
fi
PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"
ADVISORY_PLUGIN="plasma-auto-tiler-advisory-describe"
SHADOW_PLUGIN="plasma-auto-tiler-shadow-describe"
PLANNER_SERVICE="org.plasmaautotiler.Planner"
if [[ "$IS_SHADOW" == "1" ]]; then
  BUNDLE_BASENAME="shadow-describe.js"
  MANIFEST_BASENAME="shadow-describe.manifest.json"
  MANIFEST_SCHEMA="shadow-describe-manifest-v1"
  RECEIPT_SCHEMA="shadow-describe-receipt-v1"
else
  BUNDLE_BASENAME="advisory-describe.js"
  MANIFEST_BASENAME="advisory-describe.manifest.json"
  MANIFEST_SCHEMA="advisory-describe-manifest-v1"
  RECEIPT_SCHEMA="advisory-describe-receipt-v1"
fi
RESULT_SCHEMA="v1"
AFTER_SCHEMA="v1"
ADVISORY_STALE_DETAIL="reject:advisory-stale-snapshot"
SHADOW_STALE_DETAIL="reject:shadow-stale-snapshot"
if [[ "$IS_SHADOW" == "1" ]]; then
  STALE_DETAIL="$SHADOW_STALE_DETAIL"
else
  STALE_DETAIL="$ADVISORY_STALE_DETAIL"
fi
SUCCESS_DETAIL_PREFIX="could-execute:"
SUCCESS_RULES="R1 R2a R2b R2c R3 R4"
SUCCESS_CAPS="swap-neighbor wrap-perpendicular wrap-siblings insert-child split-group-child reparent-leaf cross-output-transfer"
ADVISORY_READY_PREFIX="plasma-auto-tiler:advisory-describe-ready"
SHADOW_READY_PREFIX="plasma-auto-tiler:shadow-describe-ready"
ADVISORY_RESULT_PREFIX="plasma-auto-tiler:advisory-describe-result"
SHADOW_RESULT_PREFIX="plasma-auto-tiler:shadow-describe-result"
ADVISORY_AFTER_PREFIX="plasma-auto-tiler:advisory-describe-after"
SHADOW_AFTER_PREFIX="plasma-auto-tiler:shadow-describe-after"
ADVISORY_SOURCE_PREFIX="plasma-auto-tiler:advisory-describe-source"
SHADOW_SOURCE_PREFIX="plasma-auto-tiler:shadow-describe-source"
if [[ "$IS_SHADOW" == "1" ]]; then
  READY_PREFIX="$SHADOW_READY_PREFIX"
  RESULT_PREFIX_BASE="$SHADOW_RESULT_PREFIX"
  AFTER_PREFIX_BASE="$SHADOW_AFTER_PREFIX"
  SOURCE_PREFIX="$SHADOW_SOURCE_PREFIX"
else
  READY_PREFIX="$ADVISORY_READY_PREFIX"
  RESULT_PREFIX_BASE="$ADVISORY_RESULT_PREFIX"
  AFTER_PREFIX_BASE="$ADVISORY_AFTER_PREFIX"
  SOURCE_PREFIX="$ADVISORY_SOURCE_PREFIX"
fi
DIAG_MAX_BYTES=1024
ADVISORY_RESULT_DETAIL_RE='^[A-Za-z0-9._:-]{1,512}$'
SHADOW_RESULT_DETAIL_RE='^(match|divergence|reject:[A-Za-z0-9._-]{1,128})$'
if [[ "$IS_SHADOW" == "1" ]]; then
  RESULT_DETAIL_RE="$SHADOW_RESULT_DETAIL_RE"
else
  RESULT_DETAIL_RE="$ADVISORY_RESULT_DETAIL_RE"
fi
: "${BUSCTL_BIN:=busctl}"
: "${SHA256SUM_BIN:=sha256sum}"
: "${NODE_BIN:=node}"
: "${SYSTEMCTL_BIN:=systemctl}"
: "${STAT_BIN:=stat}"
: "${READLINK_BIN:=readlink}"
: "${PROC_ROOT:=/proc}"
: "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC:=0}"
: "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE:=0}"

BUS_SCOPE="--user"
DBUS_SERVICE="org.freedesktop.DBus"
DBUS_PATH="/org/freedesktop/DBus"
DBUS_IFACE="org.freedesktop.DBus"

BUS_DEST="org.kde.KWin"
BUS_PATH="/Scripting"
BUS_SCRIPTING_IFACE="org.kde.kwin.Scripting"
BUS_SCRIPT_IFACE="org.kde.kwin.Script"

SCRIPT_ID=""
SCRIPT_OBJ=""
RECEIPT_CREATED="0"
RECEIPT_PATH=""
ACTIVE_CORR="none"

# Fixed static advisory-only shape. Allow tokens must each occur in the
# exact bundle bytes; deny tokens must each be absent. This gate runs before
# any transport and is what permits coexistence with a loaded production
# plugin (whose load state is checked read-only during preflight).
# Shadow mode uses the parallel SHADOW_* sets below (same deny breadth plus
# shadow markers, advisory markers denied) with the shared read-only snapshot
# narrow deny; snapshot reads (activeWindow/windowList/frameGeometry/clientArea
# etc.) are never treated as mutation because only the narrow snapshot deny
# applies transitively to advisory-snapshot.ts.
ADVISORY_ALLOW_TOKENS=(
  "AdvisoryPlanQuery"
  "DescribeAdvisoryPlan"
  "callDBus"
  "QTimer"
  "advisory-describe-ready"
  "advisory-describe-result"
  "advisory-describe-after"
  "advisory-describe-source"
)
SHADOW_ALLOW_TOKENS=(
  "ShadowProjection"
  "DescribeShadowProjection"
  "captureShadowProjectionObservation"
  "callDBus"
  "QTimer"
  "shadow-describe-ready"
  "shadow-describe-result"
  "shadow-describe-after"
  "shadow-describe-source"
)
if [[ "$IS_SHADOW" == "1" ]]; then
  ALLOW_TOKENS=("${SHADOW_ALLOW_TOKENS[@]}")
else
  ALLOW_TOKENS=("${ADVISORY_ALLOW_TOKENS[@]}")
fi
ADVISORY_DENY_TOKENS=(
  "workspace."
  "registerShortcut"
  "TileController"
  "Tile"
  "manage"
  "unmanage"
  "activeWindow"
  "frameGeometry"
  "showOutline"
  "hideOutline"
  "CustomTile"
  "EvaluateMove"
  "PublishSnapshot"
  "poc3"
  "POC3"
  "planner-shadow"
  "isScriptLoaded"
  "unloadScript"
  "loadScript"
  "Scripting"
  "socket"
  "fetch("
  "XMLHttpRequest"
  "require("
  "sourceMappingURL"
  "createDesktop"
  "removeDesktop"
  "closeWindow"
  "setActiveWindow"
  "rootTile"
  "currentDesktop"
  "windowList"
  "clientArea"
  "shortcut"
  "Shortcut"
  "tray"
  "Tray"
  "controller"
  "Controller"
  "desktops"
  "screens"
  "Output"
  "Execute"
  "apply"
  "geometry"
  "setTimeout"
  "setInterval"
  "process.env"
  "__dirname"
  "child_process"
  "/dev/tcp"
  "socat"
  "plasma-auto-tiler-kwin"
)
# Shadow deny: same native mutation/production-trigger breadth as advisory,
# plus advisory markers denied so the shadow bundle cannot carry advisory
# transport identity. Snapshot reads stay allowed via the narrow snapshot gate.
# Exact source-aware note: both shadow sources mention the word "geometry"
# only in full-line // comments documenting geometry-free logging
# (shadow-describe-entry.ts: "No window ids or geometry are accepted here";
# advisory-shadow-projection.ts: "carrying no ids, geometry, captions");
# native geometry/focus/tile mutation stays denied via workspace./
# frameGeometry/setActiveWindow/createDesktop plus the narrow snapshot gate,
# and the gate below exempts only full-line // comments for the broad
# "geometry" word in shadow mode so comment documentation cannot mask code
# usage. (KWin TypeScript sources are not edited here.)
SHADOW_DENY_TOKENS=(
  "workspace."
  "registerShortcut"
  "TileController"
  "Tile"
  "manage"
  "unmanage"
  "activeWindow"
  "frameGeometry"
  "showOutline"
  "hideOutline"
  "CustomTile"
  "EvaluateMove"
  "PublishSnapshot"
  "poc3"
  "POC3"
  "planner-shadow"
  "AdvisoryPlanQuery"
  "DescribeAdvisoryPlan"
  "advisory-describe-ready"
  "advisory-describe-result"
  "advisory-describe-after"
  "advisory-describe-source"
  "isScriptLoaded"
  "unloadScript"
  "loadScript"
  "Scripting"
  "socket"
  "fetch("
  "XMLHttpRequest"
  "require("
  "sourceMappingURL"
  "createDesktop"
  "removeDesktop"
  "closeWindow"
  "setActiveWindow"
  "rootTile"
  "currentDesktop"
  "windowList"
  "clientArea"
  "shortcut"
  "Shortcut"
  "tray"
  "Tray"
  "controller"
  "Controller"
  "desktops"
  "screens"
  "Output"
  "Execute"
  "geometry"
  "apply"
  "setTimeout"
  "setInterval"
  "process.env"
  "__dirname"
  "child_process"
  "/dev/tcp"
  "socat"
  "plasma-auto-tiler-kwin"
)
if [[ "$IS_SHADOW" == "1" ]]; then
  DENY_TOKENS=("${SHADOW_DENY_TOKENS[@]}")
else
  DENY_TOKENS=("${ADVISORY_DENY_TOKENS[@]}")
fi
SNAPSHOT_DENY_TOKENS=(
  "Reflect.set"
  "registerShortcut"
  "callDBus"
  "showOutline"
  "hideOutline"
  "createDesktop"
  "removeDesktop"
  "setActiveWindow"
  "manage("
  "unmanage("
  ".connect("
  "setTimeout"
  "setInterval"
)

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage: advisory-describe-host.sh <preflight|preflight-source-only|start|status|diagnostics|stop> [flags] [--help]

Future authorized-host lifecycle for the advisory DescribeAdvisoryPlan
bundle. Not invoked now; covered by static checks and fake-command tests.

  preflight --bundle B --manifest M --input I [--expected-planner-owner U]
  preflight-source-only
  start --bundle B --manifest M --receipt R --diag-file D --input I
        [--attempts N] [--delay S] [--expected-planner-owner U]
        [--expected-refusal-detail D --expected-refusal-after V]
        [--refusal-service-loss]
  status --receipt R
  diagnostics --receipt R [--diag-file D]
  stop --receipt R
  --help  show this help and exit

Fixed plugin id plasma-auto-tiler-advisory-describe. Production is checked
read-only and is never unloaded or reloaded. Transport uses loadScript with the exact bundle, introspects
only the returned /Scripting/Script<ID> object, and runs only that object
(never a global start). Receipts carry exact bundle sha, source bindings,
and KWin identity; stop unloads only the recorded exact id. Default start
requires Planner absence; --expected-planner-owner U skips only that absence
check while strictly proving that exact unique owner before and after the
  lifecycle. Preflight is read-only resource-free with no bus mutation and no
  receipt. Preflight-source-only is the smallest resource-free variant with
  no bundle/manifest/input arguments: tools, exact sources plus source-only
  shape, KWin identity with recapture, production loaded, plugin absent, and
  Planner absent. Strict terminal-refusal mode requires paired exact
--expected-refusal-detail plus exact --expected-refusal-after; it accepts
only that exact observed pair after all identity/order checks, exact-cleans
only the recorded object/plugin, and returns success with no receipt.
Present-owner refusal post-revalidates the exact owner triple; service-loss
refusal uses distinct --refusal-service-loss with no present postcheck.
No Planner start/stop; no system log collection.
EOF
}

safe_abs() {
  local path="$1"
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* \
    && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  [[ "$path" != "/" ]] || return 1
}

require_regular_file() {
  local path="$1" label="$2"
  safe_abs "$path" || fail "$label path is unsafe: $path"
  [[ -f "$path" && ! -L "$path" ]] || fail "$label must be a regular non-symlink file: $path"
  [[ -r "$path" ]] || fail "$label is unreadable: $path"
}

valid_hex64() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
valid_nonce() { [[ "$1" =~ ^[0-9a-f]{32,128}$ ]]; }
valid_owner() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; }
valid_generation() { [[ "$1" =~ ^[a-z0-9-]{1,64}$ ]]; }
valid_canonical_uint() { [[ "$1" =~ ^(0|[1-9][0-9]*)$ ]]; }
valid_revision() { valid_canonical_uint "$1" && [[ "$1" -le 1000000 ]]; }
valid_script_id() { valid_canonical_uint "$1" && [[ "$1" -le 2147483647 ]]; }
valid_detail() { [[ "$1" =~ $RESULT_DETAIL_RE ]]; }

# Strict success-detail predicate for the final adapter/service boundary.
# Retains the already emitted bounded advisory detail
# could-execute:<rule>:<capability> (from kwin/src/advisory-plan-query.ts)
# and accepts only allowlisted rule/capability pairs. Bare could-execute,
# extra segments, unknown rules/caps, or prefix-broadened details fail.
# Shadow mode accepts only the exact correlated match/divergence details.
is_success_detail() {
  local detail="${1:-}" rest="" rule="" cap=""
  case "$detail" in
    "$SUCCESS_DETAIL_PREFIX"*:*) ;;
    *) return 1 ;;
  esac
  rest="${detail#"$SUCCESS_DETAIL_PREFIX"}"
  [[ -n "$rest" ]] || return 1
  rule="${rest%%:*}"
  cap="${rest#*:}"
  [[ -n "$rule" && -n "$cap" ]] || return 1
  [[ "$cap" != *:* && "$rule" != *:* ]] || return 1
  case " $SUCCESS_RULES " in
    *" $rule "*) ;;
    *) return 1 ;;
  esac
  case " $SUCCESS_CAPS " in
    *" $cap "*) ;;
    *) return 1 ;;
  esac
  valid_detail "$detail" || return 1
  return 0
}

# Strict shadow success-detail predicate: exactly match or divergence with
# after true. Exact redacted parser shared by the shadow lifecycle command;
# stale/snapshot rejects never satisfy success and fail closed with exact
# cleanup and no receipt.
is_shadow_success_detail() {
  local detail="${1:-}"
  [[ "$detail" == "match" || "$detail" == "divergence" ]] || return 1
  valid_detail "$detail" || return 1
  return 0
}

# Mode-dispatched terminal success predicate shared by start/diagnostics.
is_terminal_success_detail() {
  if [[ "$IS_SHADOW" == "1" ]]; then
    is_shadow_success_detail "$1"
  else
    is_success_detail "$1"
  fi
}

# Mode-dispatched refusal-conflict predicate: a refusal expectation that
# collides with receipt semantics (success detail with after true) fails.
is_refusal_conflict() {
  local detail="${1:-}" after="${2:-}"
  [[ "$after" == "true" ]] || return 1
  is_terminal_success_detail "$detail"
}

# Smallest reusable adapter observability: bound, redact, and emit causal
# invocation-tied stderr/exit classification to stderr before exact cleanup.
# In-memory only (no temp files) so resource-free preflight stays intact.
# Redacts unique bus owners, numeric native PIDs, hex identities, and
# absolute paths, and encodes newlines so every diagnostic stays one bounded
# log record; the caller supplies the correlation so the diagnostic stays
# invocation-tied without leaking native IDs.
redact_diag_text() {
  local _in="${1:-}" _out=""
  _out="$(printf '%s' "$_in" | head -c "$DIAG_MAX_BYTES" | sed -E -e 's/:[0-9]+\.[0-9]+/:REDACTED/g' -e 's/[0-9a-f]{32,128}/REDACTED_HEX/g' -e 's|/[^[:space:]"]+|REDACTED_PATH|g' -e 's/\b(pid|PID)([[:space:]]+)[0-9][0-9]*/\1\2REDACTED_PID/g' -e 's/\b[0-9]{4,}\b/REDACTED_NUM/g')"
  _out="${_out//$'\n'/\\n}"
  _out="${_out//$'\r'/\\r}"
  printf '%s' "$_out" | head -c "$DIAG_MAX_BYTES"
}

emit_invocation_diag() {
  local invocation="${1:-unknown}" exit_code="${2:-1}" correlation="${3:-none}" raw="${4:-}"
  local redacted=""
  redacted="$(redact_diag_text "$raw")"
  printf 'diag: invocation=%s exit=%s correlation=%s stderr=%s\n' "$invocation" "$exit_code" "$correlation" "$redacted" >&2
}

sha256_file() {
  "$SHA256SUM_BIN" -- "$1" 2>/dev/null | sed -n 's/^\([0-9a-f]\{64\}\) .*/\1/p' || true
}

# Strict single-line JSON parsing via Node (no new dependency): rejects
# multiline, CR, duplicate keys, and unexpected keys, validates the narrow
# fixed schema, and prints only shell-safe assignments (values already
# restricted to safe charsets, so the caller's eval cannot meet shell
# metacharacters). Fails closed on any malformation.
node_parse_json_file() {
  local kind="$1" file="$2"
  command -v "$NODE_BIN" >/dev/null 2>&1 || { echo "error: required tool '$NODE_BIN' not found in PATH" >&2; return 1; }
  MANIFEST_SCHEMA_EXPECTED="$MANIFEST_SCHEMA" RECEIPT_SCHEMA_EXPECTED="$RECEIPT_SCHEMA" \
    BUNDLE_BASENAME_EXPECTED="$BUNDLE_BASENAME" PLUGIN_EXPECTED="$PLUGIN" PARSE_KIND="$kind" \
    SHADOW_DESCRIBE_HOST_MODE="$SHADOW_DESCRIBE_HOST_MODE" \
    SRC_ENTRY_BASENAME_EXPECTED="$SRC_ENTRY_BASENAME" SRC_SECOND_BASENAME_EXPECTED="$SRC_SECOND_BASENAME" \
    "$NODE_BIN" -e '
const fs = require("node:fs");
const file = process.argv[1];
const kind = process.env.PARSE_KIND;
const shadowMode = process.env.SHADOW_DESCRIBE_HOST_MODE === "shadow";
let text;
try { text = fs.readFileSync(file, "utf8"); } catch (e) { console.error("error: cannot read " + kind); process.exit(1); }
if (text.includes("\r")) { console.error("error: " + kind + " must be single-line JSON without CR"); process.exit(1); }
if (!text.endsWith("\n")) { console.error("error: " + kind + " must end with a single newline"); process.exit(1); }
const body = text.slice(0, -1);
if (body.includes("\n")) { console.error("error: " + kind + " must be single-line JSON"); process.exit(1); }
let parsed;
try { parsed = JSON.parse(body); } catch (e) { console.error("error: " + kind + " is not valid JSON"); process.exit(1); }
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { console.error("error: " + kind + " must be a JSON object"); process.exit(1); }
const manifestKeys = shadowMode
  ? ["schema","bundle","bundleSha256","entry","entrySha256","shadow","shadowSha256","snapshot","snapshotSha256","nonce","correlationId","owner","generation","revision","inputSha256"]
  : ["schema","bundle","bundleSha256","entry","entrySha256","query","querySha256","snapshot","snapshotSha256","nonce","correlationId","owner","generation","revision","inputSha256"];
const receiptKeys = shadowMode
  ? ["schema","plugin","scriptId","scriptObject","bundleSha256","entrySha256","shadowSha256","snapshotSha256","owner","generation","revision","correlationId","nonce"]
  : ["schema","plugin","scriptId","scriptObject","bundleSha256","entrySha256","querySha256","snapshotSha256","owner","generation","revision","correlationId","nonce"];
const expected = kind === "manifest" ? manifestKeys : receiptKeys;
const keys = Object.keys(parsed);
if (keys.length !== expected.length) { console.error("error: " + kind + " has unexpected keys"); process.exit(1); }
for (const k of expected) {
  if (!Object.prototype.hasOwnProperty.call(parsed, k)) { console.error("error: " + kind + " is missing key " + k); process.exit(1); }
  const matches = body.match(new RegExp("\"" + k + "\"\\s*:", "g")) || [];
  if (matches.length !== 1) { console.error("error: " + kind + " key " + k + " must occur exactly once"); process.exit(1); }
}
const hex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const nonce = (v) => typeof v === "string" && /^[0-9a-f]{32,128}$/.test(v);
const owner = (v) => typeof v === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(v);
const generation = (v) => typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v);
const canonical = (v) => typeof v === "number" && Number.isInteger(v) && /^(0|[1-9][0-9]*)$/.test(String(v));
const fail = (m) => { console.error("error: " + kind + " " + m); process.exit(1); };
if (kind === "manifest") {
  if (parsed.schema !== process.env.MANIFEST_SCHEMA_EXPECTED) fail("schema mismatch");
  if (parsed.bundle !== process.env.BUNDLE_BASENAME_EXPECTED) fail("bundle mismatch");
  if (parsed.entry !== process.env.SRC_ENTRY_BASENAME_EXPECTED) fail("entry mismatch");
  if (shadowMode) {
    if (parsed.shadow !== process.env.SRC_SECOND_BASENAME_EXPECTED) fail("shadow mismatch");
  } else if (parsed.query !== process.env.SRC_SECOND_BASENAME_EXPECTED) fail("query mismatch");
  if (parsed.snapshot !== "advisory-snapshot.ts") fail("snapshot mismatch");
  if (!hex64(parsed.bundleSha256)) fail("bundle sha is malformed");
  if (!hex64(parsed.entrySha256)) fail("entry sha is malformed");
  if (shadowMode) {
    if (!hex64(parsed.shadowSha256)) fail("shadow sha is malformed");
  } else if (!hex64(parsed.querySha256)) fail("query sha is malformed");
  if (!hex64(parsed.snapshotSha256)) fail("snapshot sha is malformed");
  if (!hex64(parsed.inputSha256)) fail("input sha is malformed");
  if (!nonce(parsed.nonce)) fail("nonce is malformed");
  if (parsed.correlationId !== parsed.nonce) fail("correlation must equal the nonce");
  if (!owner(parsed.owner)) fail("owner is malformed");
  if (!generation(parsed.generation)) fail("generation is malformed");
  if (!(canonical(parsed.revision) && parsed.revision >= 0 && parsed.revision <= 1000000)) fail("revision is malformed");
  console.log("MANIFEST_BUNDLE_SHA=" + parsed.bundleSha256);
  console.log("MANIFEST_ENTRY_SHA=" + parsed.entrySha256);
  if (shadowMode) {
    console.log("MANIFEST_QUERY_SHA=" + parsed.shadowSha256);
  } else {
    console.log("MANIFEST_QUERY_SHA=" + parsed.querySha256);
  }
  console.log("MANIFEST_SNAPSHOT_SHA=" + parsed.snapshotSha256);
  console.log("MANIFEST_INPUT_SHA=" + parsed.inputSha256);
  console.log("MANIFEST_NONCE=" + parsed.nonce);
  console.log("MANIFEST_CORRELATION=" + parsed.correlationId);
  console.log("MANIFEST_OWNER=" + parsed.owner);
  console.log("MANIFEST_GENERATION=" + parsed.generation);
  console.log("MANIFEST_REVISION=" + parsed.revision);
} else {
  if (parsed.schema !== process.env.RECEIPT_SCHEMA_EXPECTED) fail("schema mismatch");
  if (parsed.plugin !== process.env.PLUGIN_EXPECTED) fail("plugin mismatch");
  if (!(canonical(parsed.scriptId) && parsed.scriptId >= 0 && parsed.scriptId <= 2147483647)) fail("script id is malformed or out of range");
  if (parsed.scriptObject !== ("/Scripting/Script" + parsed.scriptId)) fail("object must be the exact Script id path");
  if (!hex64(parsed.bundleSha256)) fail("bundle sha is malformed");
  if (!hex64(parsed.entrySha256)) fail("entry sha is malformed");
  if (shadowMode) {
    if (!hex64(parsed.shadowSha256)) fail("shadow sha is malformed");
  } else if (!hex64(parsed.querySha256)) fail("query sha is malformed");
  if (!hex64(parsed.snapshotSha256)) fail("snapshot sha is malformed");
  if (!owner(parsed.owner)) fail("owner is malformed");
  if (!generation(parsed.generation)) fail("generation is malformed");
  if (!(canonical(parsed.revision) && parsed.revision >= 0 && parsed.revision <= 1000000)) fail("revision is malformed");
  if (!nonce(parsed.nonce)) fail("nonce is malformed");
  if (parsed.correlationId !== parsed.nonce) fail("correlation must equal the nonce");
  console.log("RECEIPT_PLUGIN=" + parsed.plugin);
  console.log("RECEIPT_SCRIPT_ID=" + parsed.scriptId);
  console.log("RECEIPT_SCRIPT_OBJ=" + parsed.scriptObject);
  console.log("RECEIPT_BUNDLE_SHA=" + parsed.bundleSha256);
  console.log("RECEIPT_ENTRY_SHA=" + parsed.entrySha256);
  if (shadowMode) {
    console.log("RECEIPT_QUERY_SHA=" + parsed.shadowSha256);
  } else {
    console.log("RECEIPT_QUERY_SHA=" + parsed.querySha256);
  }
  console.log("RECEIPT_SNAPSHOT_SHA=" + parsed.snapshotSha256);
  console.log("RECEIPT_OWNER=" + parsed.owner);
  console.log("RECEIPT_GENERATION=" + parsed.generation);
  console.log("RECEIPT_REVISION=" + parsed.revision);
  console.log("RECEIPT_CORRELATION=" + parsed.correlationId);
  console.log("RECEIPT_NONCE=" + parsed.nonce);
}
' -- "$file" || return 1
}

# Manifest contract: single-line JSON with fixed keys, fixed basenames, and
# safe bounded identity fields. Prints shell-safe assignments on stdout.
parse_manifest() {
  node_parse_json_file "manifest" "$1"
}

# Receipt contract: single-line JSON with fixed keys binding the exact KWin
# identity (plugin, script id, exact object) to the exact bundle sha, source
# bindings, and request identity. Prints shell-safe assignments on stdout.
parse_receipt() {
  node_parse_json_file "receipt" "$1"
}

prove_advisory_only() {
  local bundle="$1" token="" src=""
  # Allow/deny shape is proven against the exact current sources (which the
  # loader also pins to the manifest shas and which the bundle embeds). The
  # bundle's embedded input is opaque data and must never be deny-scanned, so
  # the bundle itself is checked only for IIFE/no-ESM/no-imports/no-source-map
  # structure plus embedded source bindings (checked by the caller).
  for token in "${ALLOW_TOKENS[@]}"; do
    if ! grep -Fq -- "$token" "$SRC_ENTRY" 2>/dev/null && ! grep -Fq -- "$token" "$SRC_QUERY" 2>/dev/null; then
      echo "error: $KIND_LABEL source lacks marker: $token" >&2
      return 1
    fi
  done
  for src in "$SRC_ENTRY" "$SRC_QUERY"; do
    for token in "${DENY_TOKENS[@]}"; do
      if [[ "$IS_SHADOW" == "1" && "$token" == "geometry" ]]; then
        if grep -v -- '^[[:space:]]*//' "$src" 2>/dev/null | grep -Fq -- "$token"; then
          echo "error: $KIND_LABEL source carries a forbidden non-$KIND_LABEL marker: $token ($src)" >&2
          return 1
        fi
      elif grep -Fq -- "$token" "$src"; then
        echo "error: $KIND_LABEL source carries a forbidden non-$KIND_LABEL marker: $token ($src)" >&2
        return 1
      fi
    done
  done
  for token in "${SNAPSHOT_DENY_TOKENS[@]}"; do
    if grep -Fq -- "$token" "$SRC_SNAPSHOT"; then
      echo "error: $KIND_LABEL snapshot source carries a forbidden non-read-only marker: $token" >&2
      return 1
    fi
  done
  if grep -Eq -- '^import |^export ' "$bundle"; then
    echo "error: bundle carries ESM syntax" >&2
    return 1
  fi
  if grep -Fq -- 'from "./' "$bundle"; then
    echo "error: bundle carries a source import" >&2
    return 1
  fi
}

# Shared exact shape gate dispatched by mode. Advisory and shadow share the
# same helper body above via mode-selected ALLOW/DENY sets and sources; the
# snapshot narrow deny applies transitively so read-only snapshot API
# (activeWindow/windowList/frameGeometry/clientArea and Reflect.get/apply
# plumbing) is never treated as mutation, while native
# geometry/focus/tile/shortcut/controller mutation and production triggers
# stay denied in both modes.
prove_shape_only() {
  prove_advisory_only "$1"
}

# Smallest source-only shape gate for the resource-free preflight-source-only
# variant below. Same ALLOW/DENY source checks as prove_advisory_only (with
# the same shadow geometry comment exemption) but no bundle argument and no
# bundle structure check, so it runs before any bundle/manifest/input exists.
prove_sources_shape_only() {
  local token="" src=""
  for token in "${ALLOW_TOKENS[@]}"; do
    if ! grep -Fq -- "$token" "$SRC_ENTRY" 2>/dev/null && ! grep -Fq -- "$token" "$SRC_QUERY" 2>/dev/null; then
      echo "error: $KIND_LABEL source lacks marker: $token" >&2
      return 1
    fi
  done
  for src in "$SRC_ENTRY" "$SRC_QUERY"; do
    for token in "${DENY_TOKENS[@]}"; do
      if [[ "$IS_SHADOW" == "1" && "$token" == "geometry" ]]; then
        if grep -v -- '^[[:space:]]*//' "$src" 2>/dev/null | grep -Fq -- "$token"; then
          echo "error: $KIND_LABEL source carries a forbidden non-$KIND_LABEL marker: $token ($src)" >&2
          return 1
        fi
      elif grep -Fq -- "$token" "$src"; then
        echo "error: $KIND_LABEL source carries a forbidden non-$KIND_LABEL marker: $token ($src)" >&2
        return 1
      fi
    done
  done
  for token in "${SNAPSHOT_DENY_TOKENS[@]}"; do
    if grep -Fq -- "$token" "$SRC_SNAPSHOT"; then
      echo "error: $KIND_LABEL snapshot source carries a forbidden non-read-only marker: $token" >&2
      return 1
    fi
  done
}

parse_script_id() {
  local reply="$1" id=""
  [[ "$reply" =~ ^i[[:space:]]+(0|[1-9][0-9]*)[[:space:]]*$ ]] || return 1
  id="${BASH_REMATCH[1]}"
  valid_script_id "$id" || return 1
  printf '%s' "$id"
}

parse_bool() {
  local reply="$1"
  [[ "$reply" =~ ^b[[:space:]]+(true|false)[[:space:]]*$ ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}"
}

exact_cleanup() {
  local _corr="${1:-${ACTIVE_CORR:-none}}"
  [[ -n "$SCRIPT_ID" ]] || return 1
  valid_script_id "$SCRIPT_ID" || return 1
  local _stop_raw="" _stop_rc=0
  _stop_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$SCRIPT_OBJ" "$BUS_SCRIPT_IFACE" stop 2>&1)" || _stop_rc=$?
  if [[ "$_stop_rc" -ne 0 ]]; then
    emit_invocation_diag "stop" "$_stop_rc" "$_corr" "$_stop_raw"
  fi
  local out="" _uc_rc=0 _uc_raw=""
  _uc_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" unloadScript s "$PLUGIN" 2>&1)" || _uc_rc=$?
  if [[ "$_uc_rc" -ne 0 ]]; then
    emit_invocation_diag "unloadScript" "$_uc_rc" "$_corr" "$_uc_raw"
    return 1
  fi
  out="$_uc_raw"
  [[ "$(parse_bool "$out")" == "true" ]] || {
    emit_invocation_diag "unloadScript" "1" "$_corr" "$out"
    return 1
  }
  [[ "$(loaded_word "$PLUGIN" "$_corr")" == "not-loaded" ]] || {
    emit_invocation_diag "state" "1" "$_corr" "plugin still loaded after exact unload"
    return 1
  }
}

partial_cleanup() {
  local _corr="${1:-${ACTIVE_CORR:-none}}"
  local state="unverified"
  if [[ -n "$SCRIPT_ID" ]] && exact_cleanup "$_corr" >/dev/null; then state="verified"; fi
  if [[ "$RECEIPT_CREATED" == "1" && -n "$RECEIPT_PATH" ]]; then rm -f -- "$RECEIPT_PATH" 2>/dev/null || true; fi
  printf '%s: partial script-id=%s cleanup=%s\n' "$PLUGIN" "${SCRIPT_ID:-unknown}" "$state" >&2
}

loaded_word() {
  local plugin="$1" _corr="${2:-${ACTIVE_CORR:-none}}" out="" _lw_rc=0 _lw_raw=""
  _lw_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" isScriptLoaded s "$plugin" 2>&1)" || _lw_rc=$?
  if [[ "$_lw_rc" -ne 0 ]]; then
    emit_invocation_diag "isScriptLoaded" "$_lw_rc" "$_corr" "$_lw_raw"
    echo "error: isScriptLoaded call failed for '$plugin'" >&2
    return 1
  fi
  out="$_lw_raw"
  local word=""
  word="$(parse_bool "$out")" || { echo "error: unexpected isScriptLoaded reply for '$plugin': $out" >&2; return 1; }
  if [[ "$word" == "true" ]]; then printf 'loaded\n'; else printf 'not-loaded\n'; fi
}

require_receipt_parent() {
  local receipt="$1" parent=""
  parent="$(dirname -- "$receipt")"
  [[ -n "$parent" ]] || return 1
  [[ ! -L "$parent" ]] || { echo "error: receipt parent must not be a symlink: $parent" >&2; return 1; }
  [[ -d "$parent" ]] || { echo "error: receipt parent must be a real directory: $parent" >&2; return 1; }
}

# Host immutable preflight (read-only, resource-free, no temp files).
# Resolves the current org.kde.KWin unique owner plus PID via busctl
# --json=short, strict-parses the JSON with the pinned Node tool, pins the
# /proc start tick paren-safe, then runs the exact authorized helper route:
# ordinary poc3_kwin_systemd_fallback first; direct-parent only when the
# ordinary route returns the fixed status 42
# (valid parsed MainPID differs from the owner PID), never by matching
# stderr; readable exe must agree inside the helpers. Production must be
# loaded, advisory absent, Planner name absent. Owner/PID/tick are rechecked
# after the immutable checks and before any resource-creating
# verify/lifecycle; drift fails closed. All captures stay in memory (command
# substitution, mapfile); no mktemp, no dirs, no receipts, no services, no
# scripts before preflight.
kwin_unique_owner() {
  local out="" owner=""
  out="$("$BUSCTL_BIN" "$BUS_SCOPE" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetNameOwner s "$BUS_DEST" 2>/dev/null)" || {
    echo "error: current host KWin service org.kde.KWin is not available (no unique bus owner)" >&2
    return 1
  }
  owner="$(OWNER_JSON="$out" "$NODE_BIN" -e '
const raw = process.env.OWNER_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { console.error("error: malformed GetNameOwner reply for org.kde.KWin"); process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("error: malformed GetNameOwner reply for org.kde.KWin"); process.exit(1); }
const keys = Object.keys(v).sort();
if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "type") { console.error("error: malformed GetNameOwner reply for org.kde.KWin"); process.exit(1); }
if (v.type !== "s") { console.error("error: malformed GetNameOwner reply for org.kde.KWin"); process.exit(1); }
if (!Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "string") { console.error("error: malformed GetNameOwner reply for org.kde.KWin"); process.exit(1); }
if (!/^:[0-9]+\.[0-9]+$/.test(v.data[0])) { console.error("error: owner for org.kde.KWin is not a unique name"); process.exit(1); }
process.stdout.write(v.data[0]);
' 2>/dev/null)" || {
    echo "error: malformed GetNameOwner reply for org.kde.KWin" >&2
    return 1
  }
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || {
    echo "error: owner for org.kde.KWin is not a unique name: $owner" >&2
    return 1
  }
  printf '%s' "$owner"
}

kwin_pid_for_owner() {
  local owner="$1" out="" pid=""
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || { echo "error: KWin owner is not a unique name: $owner" >&2; return 1; }
  out="$("$BUSCTL_BIN" "$BUS_SCOPE" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetConnectionUnixProcessID s "$owner" 2>/dev/null)" || {
    echo "error: could not resolve the Unix PID for KWin owner $owner" >&2
    return 1
  }
  pid="$(PID_JSON="$out" "$NODE_BIN" -e '
const raw = process.env.PID_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
const keys = Object.keys(v).sort();
if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "type") { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (v.type !== "u") { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (!Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "number" || !Number.isInteger(v.data[0])) { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (!/^[1-9][0-9]*$/.test(String(v.data[0])) || v.data[0] <= 0 || v.data[0] > 4294967295) { console.error("error: KWin owner PID is malformed"); process.exit(1); }
process.stdout.write(String(v.data[0]));
' 2>/dev/null)" || {
    echo "error: malformed GetConnectionUnixProcessID reply for $owner" >&2
    return 1
  }
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || {
    echo "error: KWin owner PID is malformed: $pid" >&2
    return 1
  }
  printf '%s' "$pid"
}

proc_start_tick() {
  local pid="$1" stat_line="" stat_pid="" rest=""
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  stat_line="$(<"$PROC_ROOT/$pid/stat")" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  stat_pid="${stat_line%% *}"
  [[ "$stat_pid" == "$pid" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  local -a fields=()
  read -r -a fields <<<"$rest" || return 1
  [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[0]}" != "Z" ]] || return 1
  [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${fields[19]}"
}

check_planner_absent() {
  local out="" has=""
  out="$("$BUSCTL_BIN" "$BUS_SCOPE" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" NameHasOwner s "$PLANNER_SERVICE" 2>/dev/null)" || {
    echo "error: planner absence check failed for $PLANNER_SERVICE (transport failure)" >&2
    return 1
  }
  has="$(HAS_JSON="$out" "$NODE_BIN" -e '
const raw = process.env.HAS_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
const keys = Object.keys(v).sort();
if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "type") { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
if (v.type !== "b") { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
if (!Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "boolean") { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
process.stdout.write(v.data[0] ? "true" : "false");
' 2>/dev/null)" || {
    echo "error: malformed NameHasOwner reply for $PLANNER_SERVICE" >&2
    return 1
  }
  [[ "$has" == "true" || "$has" == "false" ]] || {
    echo "error: malformed NameHasOwner reply for $PLANNER_SERVICE" >&2
    return 1
  }
  if [[ "$has" == "true" ]]; then
    echo "error: planner service $PLANNER_SERVICE is present; refusing coexistence collision" >&2
    return 1
  fi
  return 0
}

valid_planner_unique_owner() { [[ "$1" =~ ^:[0-9]+\.[0-9]+$ ]]; }

# Strict Planner present-owner proof for an explicit sequencer-supplied
# expected unique owner. Requires NameHasOwner true, GetNameOwner exact
# equality with the expected unique owner, GetConnectionUnixProcessID for
# that exact owner, and a readable PID/start tick (PID reuse guarded). Prints
# only shell-safe assignments for the exact triple (owner/PID/tick already
# restricted to safe charsets) for caller-side triple comparison. No
# launch/kill, no absence bypass beyond this exact owner; caller holds the
# expected owner in memory and never prints machine detail.
check_planner_present_owner() {
  local expected="$1" out="" has="" actual="" pid="" tick=""
  valid_planner_unique_owner "$expected" || {
    echo "error: expected planner owner is not a unique name: $expected" >&2
    return 1
  }
  out="$("$BUSCTL_BIN" "$BUS_SCOPE" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" NameHasOwner s "$PLANNER_SERVICE" 2>/dev/null)" || {
    echo "error: planner present-owner check failed for $PLANNER_SERVICE (transport failure)" >&2
    return 1
  }
  has="$(HAS_JSON="$out" "$NODE_BIN" -e '
const raw = process.env.HAS_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
const keys = Object.keys(v).sort();
if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "type") { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
if (v.type !== "b") { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
if (!Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "boolean") { console.error("error: malformed NameHasOwner reply"); process.exit(1); }
process.stdout.write(v.data[0] ? "true" : "false");
' 2>/dev/null)" || {
    echo "error: malformed NameHasOwner reply for $PLANNER_SERVICE" >&2
    return 1
  }
  [[ "$has" == "true" ]] || {
    echo "error: planner service $PLANNER_SERVICE is absent; refusing without the expected present owner $expected" >&2
    return 1
  }
  out="$("$BUSCTL_BIN" "$BUS_SCOPE" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetNameOwner s "$PLANNER_SERVICE" 2>/dev/null)" || {
    echo "error: planner GetNameOwner failed for $PLANNER_SERVICE (transport failure)" >&2
    return 1
  }
  actual="$(OWNER_JSON="$out" "$NODE_BIN" -e '
const raw = process.env.OWNER_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { console.error("error: malformed GetNameOwner reply"); process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("error: malformed GetNameOwner reply"); process.exit(1); }
const keys = Object.keys(v).sort();
if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "type") { console.error("error: malformed GetNameOwner reply"); process.exit(1); }
if (v.type !== "s") { console.error("error: malformed GetNameOwner reply"); process.exit(1); }
if (!Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "string") { console.error("error: malformed GetNameOwner reply"); process.exit(1); }
if (!/^:[0-9]+\.[0-9]+$/.test(v.data[0])) { console.error("error: planner owner is not a unique name"); process.exit(1); }
process.stdout.write(v.data[0]);
' 2>/dev/null)" || {
    echo "error: malformed GetNameOwner reply for $PLANNER_SERVICE" >&2
    return 1
  }
  valid_planner_unique_owner "$actual" || {
    echo "error: planner owner for $PLANNER_SERVICE is not a unique name: $actual" >&2
    return 1
  }
  [[ "$actual" == "$expected" ]] || {
    echo "error: planner unique owner mismatch for $PLANNER_SERVICE; refusing (expected $expected, present $actual)" >&2
    return 1
  }
  out="$("$BUSCTL_BIN" "$BUS_SCOPE" --json=short call "$DBUS_SERVICE" "$DBUS_PATH" "$DBUS_IFACE" GetConnectionUnixProcessID s "$actual" 2>/dev/null)" || {
    echo "error: could not resolve the Unix PID for planner owner $actual" >&2
    return 1
  }
  pid="$(PID_JSON="$out" "$NODE_BIN" -e '
const raw = process.env.PID_JSON || "";
let v;
try { v = JSON.parse(raw); } catch (e) { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (typeof v !== "object" || v === null || Array.isArray(v)) { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
const keys = Object.keys(v).sort();
if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "type") { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (v.type !== "u") { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (!Array.isArray(v.data) || v.data.length !== 1 || typeof v.data[0] !== "number" || !Number.isInteger(v.data[0])) { console.error("error: malformed GetConnectionUnixProcessID reply"); process.exit(1); }
if (!/^[1-9][0-9]*$/.test(String(v.data[0])) || v.data[0] <= 0 || v.data[0] > 4294967295) { console.error("error: planner owner PID is malformed"); process.exit(1); }
process.stdout.write(String(v.data[0]));
' 2>/dev/null)" || {
    echo "error: malformed GetConnectionUnixProcessID reply for planner owner $actual" >&2
    return 1
  }
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || {
    echo "error: planner owner PID is malformed: $pid" >&2
    return 1
  }
  tick="$(proc_start_tick "$pid")" || {
    echo "error: planner PID $pid is stale or unreadable (PID reuse suspected)" >&2
    return 1
  }
  [[ "$tick" =~ ^[1-9][0-9]*$ ]] || {
    echo "error: planner PID $pid start tick is unreadable" >&2
    return 1
  }
  printf 'PLANNER_OWNER=%s\nPLANNER_PID=%s\nPLANNER_TICK=%s\n' "$actual" "$pid" "$tick"
  return 0
}

# Single KWin identity capture via the exact authorized helper route.
# Prints owner/pid/tick/exe/source on separate lines (source is systemd or
# systemd-direct-parent). In-memory only: helper output is captured in a
# variable and split with mapfile; no temp files. Direct-parent is entered
# only when poc3_kwin_systemd_fallback returns the fixed
# status 42; helper failure text is
# preserved on stderr alongside the generic fallback refusal.
kwin_identity_once() {
  local owner="" pid="" tick=""
  owner="$(kwin_unique_owner)" || return 1
  pid="$(kwin_pid_for_owner "$owner")" || return 1
  tick="$(proc_start_tick "$pid")" || {
    echo "error: KWin PID $pid is stale or unreadable (PID reuse suspected)" >&2
    return 1
  }
  local combined=""
  local rc=0
  if combined="$(poc3_kwin_systemd_fallback "$owner" "$pid" "$tick" 2>&1)"; then
    local -a lines=()
    mapfile -t lines <<<"$combined" || { echo "error: KWin systemd identity capture is ambiguous" >&2; return 1; }
    # Command substitution strips trailing newlines, so an empty SourcePath
    # (21st line empty) arrives as 20 lines; a non-empty source arrives as 21.
    if [[ "${#lines[@]}" -eq 20 ]]; then
      lines+=( "" )
    fi
    [[ "${#lines[@]}" -eq 21 ]] || { echo "error: KWin systemd identity capture is ambiguous" >&2; return 1; }
    [[ -n "${lines[0]}" ]] || { echo "error: KWin systemd identity capture is ambiguous" >&2; return 1; }
    printf '%s\n%s\n%s\n%s\n%s\n' "$owner" "$pid" "$tick" "${lines[0]}" "systemd"
    return 0
  else
    rc=$?
    if [[ "$rc" -eq 42 ]]; then
      local dp_combined=""
      if dp_combined="$(poc3_kwin_direct_parent_fallback "$owner" "$pid" "$tick" 2>&1)"; then
        local -a dp_lines=()
        mapfile -t dp_lines <<<"$dp_combined" || { echo "error: KWin systemd identity capture is ambiguous" >&2; return 1; }
        [[ "${#dp_lines[@]}" -eq 25 ]] || { echo "error: KWin systemd identity capture is ambiguous" >&2; return 1; }
        [[ -n "${dp_lines[0]}" && "${dp_lines[24]}" == "direct-parent" ]] || { echo "error: KWin systemd identity capture is ambiguous" >&2; return 1; }
        printf '%s\n%s\n%s\n%s\n%s\n' "$owner" "$pid" "$tick" "${dp_lines[0]}" "systemd-direct-parent"
        return 0
      else
        [[ -n "$dp_combined" ]] && printf '%s\n' "$dp_combined" >&2
        echo "error: KWin PID $pid executable identity is unreadable and systemd fallback failed" >&2
        return 1
      fi
    else
      [[ -n "$combined" ]] && printf '%s\n' "$combined" >&2
      echo "error: KWin PID $pid executable identity is unreadable and systemd fallback failed" >&2
      return 1
    fi
  fi
}

# Bounded correlated marker scan: only bytes appended after the pre-run
# boundary (fixed 64KiB tail window of the post-run slice). Exact-line mode
# requires a full-line match; prefix mode requires the fixed prefix at column
# zero (a mid-line occurrence never matches). Prints the last matching line
# truncated to 1KiB.
wait_diag_line() {
  local file="$1" start="$2" pattern="$3" exact="$4" attempts="$5" delay="$6"
  local attempt=0 slice="" found="" line=""
  while [[ "$attempt" -lt "$attempts" ]]; do
    slice="$(tail -c "+$((start + 1))" -- "$file" 2>/dev/null | tail -c 65536 2>/dev/null)" || slice=""
    found=""
    if [[ "$exact" == "line" ]]; then
      found="$(printf '%s' "$slice" | grep -F -x -- "$pattern" | tail -n 1 | head -c 1024)" || found=""
    else
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == "$pattern"* ]]; then
          found="$line"
        fi
      done <<< "$slice"
      found="$(printf '%s' "$found" | head -c 1024)" || found=""
    fi
    if [[ -n "$found" ]]; then
      printf '%s' "$found"
      return 0
    fi
    sleep "$delay" || return 1
    attempt=$((attempt + 1))
  done
  return 1
}

# Versioned result validation: exact column-zero prefix carrying schema plus
# correlation/owner/generation/revision/nonce, with a bounded valid detail
# suffix. Prints the detail on success. Mode-dispatched via READY/RESULT/
# AFTER/SOURCE prefix variables so advisory and shadow share the exact
# lifecycle (signed Script-ID load/introspect/run, correlated current
# source/ready/result/after ordering, exact cleanup) with distinct markers.
check_result_line() {
  local line="$1" correlation="$2" owner="$3" generation="$4" revision="$5" nonce="$6"
  local prefix="$RESULT_PREFIX_BASE:$RESULT_SCHEMA:$correlation:$owner:$generation:$revision:$nonce:"
  [[ "$line" == "$prefix"* ]] || return 1
  local detail="${line#"$prefix"}"
  [[ -n "$detail" ]] || return 1
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "${#detail}" -le 128 ]] || return 1
  else
    [[ "${#detail}" -le 512 ]] || return 1
  fi
  [[ "$detail" != *$'\n'* && "$detail" != *$'\r'* ]] || return 1
  valid_detail "$detail" || return 1
  printf '%s' "$detail"
}

result_prefix_for() {
  printf '%s:%s:%s:%s:%s:%s:%s:' "$RESULT_PREFIX_BASE" "$RESULT_SCHEMA" "$1" "$2" "$3" "$4" "$5"
}

# Bounded opaque correlated after-equality validation: exact column-zero
# prefix carrying schema plus correlation, with verdict exactly true/false.
# Prints the verdict on success.
check_after_line() {
  local line="$1" correlation="$2"
  local prefix="$AFTER_PREFIX_BASE:$AFTER_SCHEMA:$correlation:"
  [[ "$line" == "$prefix"* ]] || return 1
  local verdict="${line#"$prefix"}"
  [[ "$verdict" == "true" || "$verdict" == "false" ]] || return 1
  [[ "$line" == "$prefix$verdict" ]] || return 1
  [[ "$line" != *$'\n'* && "$line" != *$'\r'* ]] || return 1
  printf '%s' "$verdict"
}

after_prefix_for() {
  printf '%s:%s:%s:' "$AFTER_PREFIX_BASE" "$AFTER_SCHEMA" "$1"
}

source_line_for() {
  printf '%s:%s:%s:%s' "$SOURCE_PREFIX" "$1" "$2" "$3"
}

parse_start_args() {
  START_BUNDLE=""; START_MANIFEST=""; START_RECEIPT=""; START_DIAG=""; START_INPUT=""; START_ATTEMPTS="50"; START_DELAY="0.1"; START_EXPECTED_PLANNER_OWNER=""; START_EXPECTED_REFUSAL_DETAIL=""; START_EXPECTED_REFUSAL_AFTER=""; START_REFUSAL_SERVICE_LOSS="0"
  local seen_bundle=0 seen_manifest=0 seen_receipt=0 seen_diag=0 seen_attempts=0 seen_delay=0 seen_input=0 seen_expected=0 seen_refusal_detail=0 seen_refusal_after=0 seen_service_loss=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bundle) [[ "$seen_bundle" -eq 0 ]] || fail "duplicate --bundle"; seen_bundle=1; [[ -n "${2:-}" ]] || fail "missing value for --bundle"; START_BUNDLE="$2"; shift 2 ;;
      --manifest) [[ "$seen_manifest" -eq 0 ]] || fail "duplicate --manifest"; seen_manifest=1; [[ -n "${2:-}" ]] || fail "missing value for --manifest"; START_MANIFEST="$2"; shift 2 ;;
      --receipt) [[ "$seen_receipt" -eq 0 ]] || fail "duplicate --receipt"; seen_receipt=1; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; START_RECEIPT="$2"; shift 2 ;;
      --diag-file) [[ "$seen_diag" -eq 0 ]] || fail "duplicate --diag-file"; seen_diag=1; [[ -n "${2:-}" ]] || fail "missing value for --diag-file"; START_DIAG="$2"; shift 2 ;;
      --input) [[ "$seen_input" -eq 0 ]] || fail "duplicate --input"; seen_input=1; [[ -n "${2:-}" ]] || fail "missing value for --input"; START_INPUT="$2"; shift 2 ;;
      --attempts) [[ "$seen_attempts" -eq 0 ]] || fail "duplicate --attempts"; seen_attempts=1; [[ -n "${2:-}" ]] || fail "missing value for --attempts"; START_ATTEMPTS="$2"; shift 2 ;;
      --delay) [[ "$seen_delay" -eq 0 ]] || fail "duplicate --delay"; seen_delay=1; [[ -n "${2:-}" ]] || fail "missing value for --delay"; START_DELAY="$2"; shift 2 ;;
      --expected-planner-owner) [[ "$seen_expected" -eq 0 ]] || fail "duplicate --expected-planner-owner"; seen_expected=1; [[ -n "${2:-}" ]] || fail "missing value for --expected-planner-owner"; START_EXPECTED_PLANNER_OWNER="$2"; shift 2 ;;
      --expected-refusal-detail) [[ "$seen_refusal_detail" -eq 0 ]] || fail "duplicate --expected-refusal-detail"; seen_refusal_detail=1; [[ -n "${2:-}" ]] || fail "missing value for --expected-refusal-detail"; START_EXPECTED_REFUSAL_DETAIL="$2"; shift 2 ;;
      --expected-refusal-after) [[ "$seen_refusal_after" -eq 0 ]] || fail "duplicate --expected-refusal-after"; seen_refusal_after=1; [[ -n "${2:-}" ]] || fail "missing value for --expected-refusal-after"; START_EXPECTED_REFUSAL_AFTER="$2"; shift 2 ;;
      --refusal-service-loss) [[ "$seen_service_loss" -eq 0 ]] || fail "duplicate --refusal-service-loss"; seen_service_loss=1; START_REFUSAL_SERVICE_LOSS="1"; shift 1 ;;
      *) fail "unknown start flag '$1'" ;;
    esac
  done
  [[ -n "$START_BUNDLE" ]] || fail "start requires --bundle"
  [[ -n "$START_MANIFEST" ]] || fail "start requires --manifest"
  [[ -n "$START_RECEIPT" ]] || fail "start requires --receipt"
  [[ -n "$START_DIAG" ]] || fail "start requires --diag-file"
  [[ -n "$START_INPUT" ]] || fail "start requires --input"
  [[ "$START_ATTEMPTS" =~ ^(0|[1-9][0-9]*)$ && "$START_ATTEMPTS" -ge 1 && "$START_ATTEMPTS" -le 500 ]] || fail "invalid --attempts (1..500)"
  [[ "$START_DELAY" =~ ^(0(\.[0-9]+)?|[1-9][0-9]*(\.[0-9]+)?)$ ]] || fail "invalid --delay"
  if [[ -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
    valid_planner_unique_owner "$START_EXPECTED_PLANNER_OWNER" || fail "invalid --expected-planner-owner (must be :N.M)"
  fi
  if [[ "$seen_refusal_detail" -eq 1 || "$seen_refusal_after" -eq 1 || "$seen_service_loss" -eq 1 ]]; then
    [[ "$seen_refusal_detail" -eq 1 && "$seen_refusal_after" -eq 1 ]] || fail "start refusal requires paired --expected-refusal-detail and --expected-refusal-after"
    if [[ "$IS_SHADOW" == "1" ]]; then
      valid_detail "$START_EXPECTED_REFUSAL_DETAIL" || fail "invalid --expected-refusal-detail (must match the shadow detail shape)"
    else
      valid_detail "$START_EXPECTED_REFUSAL_DETAIL" || fail "invalid --expected-refusal-detail (must match [A-Za-z0-9._:-]{1,512})"
    fi
    [[ "$START_EXPECTED_REFUSAL_AFTER" == "true" || "$START_EXPECTED_REFUSAL_AFTER" == "false" ]] || fail "invalid --expected-refusal-after (must be true|false)"
    if [[ "$IS_SHADOW" == "1" ]]; then
      if is_refusal_conflict "$START_EXPECTED_REFUSAL_DETAIL" "$START_EXPECTED_REFUSAL_AFTER"; then
        fail "refusal conflicts with receipt semantics; success detail with after true requires a receipt"
      fi
    else
      if [[ "$START_EXPECTED_REFUSAL_AFTER" == "true" && "$START_EXPECTED_REFUSAL_DETAIL" == "${SUCCESS_DETAIL_PREFIX%:}"* ]]; then
        fail "refusal conflicts with receipt semantics; could-execute with after true requires a receipt"
      fi
    fi
  fi
}

cmd_start() {
  parse_start_args "$@"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  command -v "$SHA256SUM_BIN" >/dev/null 2>&1 || fail "required tool '$SHA256SUM_BIN' not found in PATH"
  command -v "$NODE_BIN" >/dev/null 2>&1 || fail "required tool '$NODE_BIN' not found in PATH"
  command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 || fail "required tool '$SYSTEMCTL_BIN' not found in PATH"
  command -v "$STAT_BIN" >/dev/null 2>&1 || fail "required tool '$STAT_BIN' not found in PATH"
  command -v "$READLINK_BIN" >/dev/null 2>&1 || fail "required tool '$READLINK_BIN' not found in PATH"
  require_regular_file "$START_BUNDLE" "bundle"
  require_regular_file "$START_MANIFEST" "manifest"
  require_regular_file "$START_DIAG" "diag file"
  require_regular_file "$START_INPUT" "input"
  if [[ "$IS_SHADOW" == "1" ]]; then
    require_regular_file "$SRC_ENTRY" "shadow entry source"
    require_regular_file "$SRC_QUERY" "shadow second source"
    require_regular_file "$SRC_SNAPSHOT" "shadow snapshot source"
  else
    require_regular_file "$SRC_ENTRY" "advisory entry source"
    require_regular_file "$SRC_QUERY" "advisory query source"
    require_regular_file "$SRC_SNAPSHOT" "advisory snapshot source"
  fi
  [[ "${START_BUNDLE##*/}" == "$BUNDLE_BASENAME" ]] || fail "bundle must be exactly $BUNDLE_BASENAME"
  [[ "${START_MANIFEST##*/}" == "$MANIFEST_BASENAME" ]] || fail "manifest must be exactly $MANIFEST_BASENAME"
  safe_abs "$START_RECEIPT" || fail "receipt path is unsafe: $START_RECEIPT"
  require_receipt_parent "$START_RECEIPT" || exit 1
  if [[ -e "$START_RECEIPT" || -L "$START_RECEIPT" ]]; then
    fail "receipt already exists; stop the recorded script first: $START_RECEIPT"
  fi
  local manifest_eval=""
  manifest_eval="$(parse_manifest "$START_MANIFEST")" || exit 1
  local MANIFEST_BUNDLE_SHA="" MANIFEST_ENTRY_SHA="" MANIFEST_QUERY_SHA="" MANIFEST_SNAPSHOT_SHA="" MANIFEST_INPUT_SHA="" MANIFEST_NONCE="" MANIFEST_CORRELATION="" MANIFEST_OWNER="" MANIFEST_GENERATION="" MANIFEST_REVISION=""
  eval "$manifest_eval"
  ACTIVE_CORR="$MANIFEST_CORRELATION"
  local actual_input_sha
  actual_input_sha="$(sha256_file "$START_INPUT")"
  [[ -n "$actual_input_sha" ]] || fail "could not hash the input"
  [[ "$actual_input_sha" == "$MANIFEST_INPUT_SHA" ]] || fail "input bytes do not match the manifest input binding"
  local actual_bundle_sha actual_entry_sha actual_query_sha actual_snapshot_sha
  actual_bundle_sha="$(sha256_file "$START_BUNDLE")"
  [[ "$actual_bundle_sha" == "$MANIFEST_BUNDLE_SHA" ]] || fail "bundle bytes do not match the manifest build identity"
  actual_entry_sha="$(sha256_file "$SRC_ENTRY")"
  actual_query_sha="$(sha256_file "$SRC_QUERY")"
  actual_snapshot_sha="$(sha256_file "$SRC_SNAPSHOT")"
  [[ "$actual_entry_sha" == "$MANIFEST_ENTRY_SHA" ]] || fail "entry source does not match the manifest build identity"
  [[ "$actual_query_sha" == "$MANIFEST_QUERY_SHA" ]] || fail "query source does not match the manifest build identity"
  [[ "$actual_snapshot_sha" == "$MANIFEST_SNAPSHOT_SHA" ]] || fail "snapshot source does not match the manifest build identity"
  grep -Fq -- "$MANIFEST_ENTRY_SHA" "$START_BUNDLE" || fail "bundle lacks the embedded entry source binding"
  if [[ "$IS_SHADOW" == "1" ]]; then
    grep -Fq -- "$MANIFEST_QUERY_SHA" "$START_BUNDLE" || fail "bundle lacks the embedded second source binding"
  else
    grep -Fq -- "$MANIFEST_QUERY_SHA" "$START_BUNDLE" || fail "bundle lacks the embedded query source binding"
  fi
  grep -Fq -- "$MANIFEST_SNAPSHOT_SHA" "$START_BUNDLE" || fail "bundle lacks the embedded snapshot source binding"
  prove_shape_only "$START_BUNDLE" || exit 1
  # Host immutable preflight (resource-free, read-only, in-memory only).
  # KWin full executable identity via kwin_identity_once, production loaded,
  # advisory absent, Planner absent by default via strict NameHasOwner or exact
  # present-owner proof when --expected-planner-owner is supplied (which skips
  # only the absence check), then a final resource-free immutable recapture
  # with exact (owner,pid,tick,exe,source) comparison plus
  # production/advisory/Planner checks again. The Planner present-owner triple
  # (owner/PID/tick) is captured via safe assignments from both proofs and
  # compared exactly; any drift or collision fails
  # closed before the resource-creating builder verify below
  # (which creates mkdtemp) and before any load/run/receipt. No mktemp, no
  # mkdtemp, no mkdir, no touch, no file-creating redirection here.
  local KWIN_OWNER="" KWIN_PID="" KWIN_TICK="" KWIN_EXE="" KWIN_SOURCE=""
  local PLANNER_OWNER="" PLANNER_PID="" PLANNER_TICK=""
  local PLANNER_OWNER_1="" PLANNER_PID_1="" PLANNER_TICK_1=""
  local _planner_eval_1="" _planner_eval_2=""
  local _pre_out=""
  _pre_out="$(kwin_identity_once)" || exit 1
  local -a _pre=()
  mapfile -t _pre <<<"$_pre_out" || fail "KWin identity capture is ambiguous"
  [[ "${#_pre[@]}" -eq 5 ]] || fail "KWin identity capture is ambiguous"
  KWIN_OWNER="${_pre[0]}"
  KWIN_PID="${_pre[1]}"
  KWIN_TICK="${_pre[2]}"
  KWIN_EXE="${_pre[3]}"
  KWIN_SOURCE="${_pre[4]}"
  [[ -n "$KWIN_OWNER" && -n "$KWIN_PID" && -n "$KWIN_TICK" && -n "$KWIN_EXE" ]] || fail "KWin identity capture is ambiguous"
  [[ "$KWIN_SOURCE" == "systemd" || "$KWIN_SOURCE" == "systemd-direct-parent" ]] || fail "KWin identity source is ambiguous"
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before shadow start"
  else
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before advisory start"
  fi
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  if [[ -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
    _planner_eval_1="$(check_planner_present_owner "$START_EXPECTED_PLANNER_OWNER")" || exit 1
    PLANNER_OWNER=""; PLANNER_PID=""; PLANNER_TICK=""
    eval "$_planner_eval_1"
    [[ -n "$PLANNER_OWNER" && -n "$PLANNER_PID" && -n "$PLANNER_TICK" ]] || fail "planner present-owner proof is ambiguous"
    valid_planner_unique_owner "$PLANNER_OWNER" || fail "planner present-owner proof is ambiguous"
    [[ "$PLANNER_OWNER" == "$START_EXPECTED_PLANNER_OWNER" ]] || fail "planner unique owner mismatch for $PLANNER_SERVICE; refusing (expected $START_EXPECTED_PLANNER_OWNER, present $PLANNER_OWNER)"
    PLANNER_OWNER_1="$PLANNER_OWNER"; PLANNER_PID_1="$PLANNER_PID"; PLANNER_TICK_1="$PLANNER_TICK"
  else
    check_planner_absent || exit 1
  fi
  local RE_OWNER="" RE_PID="" RE_TICK="" RE_EXE="" RE_SOURCE=""
  local _re_out=""
  _re_out="$(kwin_identity_once)" || fail "KWin identity recapture failed"
  local -a _re=()
  mapfile -t _re <<<"$_re_out" || fail "KWin identity recapture is ambiguous"
  [[ "${#_re[@]}" -eq 5 ]] || fail "KWin identity recapture is ambiguous"
  RE_OWNER="${_re[0]}"
  RE_PID="${_re[1]}"
  RE_TICK="${_re[2]}"
  RE_EXE="${_re[3]}"
  RE_SOURCE="${_re[4]}"
  [[ "$RE_OWNER" == "$KWIN_OWNER" ]] || fail "KWin unique owner drift detected; refusing ambiguous identity"
  [[ "$RE_PID" == "$KWIN_PID" && "$RE_TICK" == "$KWIN_TICK" ]] || fail "KWin PID/start-tick drift detected; refusing ambiguous identity (PID reuse suspected)"
  [[ "$RE_EXE" == "$KWIN_EXE" ]] || fail "KWin executable drift detected; refusing ambiguous identity"
  [[ "$RE_SOURCE" == "$KWIN_SOURCE" ]] || fail "KWin identity source drift detected; refusing ambiguous identity"
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before shadow start"
  else
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before advisory start"
  fi
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  if [[ -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
    _planner_eval_2="$(check_planner_present_owner "$START_EXPECTED_PLANNER_OWNER")" || exit 1
    PLANNER_OWNER=""; PLANNER_PID=""; PLANNER_TICK=""
    eval "$_planner_eval_2"
    [[ -n "$PLANNER_OWNER" && -n "$PLANNER_PID" && -n "$PLANNER_TICK" ]] || fail "planner present-owner proof is ambiguous"
    [[ "$PLANNER_OWNER" == "$PLANNER_OWNER_1" ]] || fail "planner unique owner mismatch for $PLANNER_SERVICE; refusing (expected $PLANNER_OWNER_1, present $PLANNER_OWNER)"
    [[ "$PLANNER_PID" == "$PLANNER_PID_1" && "$PLANNER_TICK" == "$PLANNER_TICK_1" ]] || fail "planner PID/start-tick drift detected; refusing ambiguous identity (PID reuse suspected)"
    PLANNER_OWNER_1="$PLANNER_OWNER"; PLANNER_PID_1="$PLANNER_PID"; PLANNER_TICK_1="$PLANNER_TICK"
  else
    check_planner_absent || exit 1
  fi
  # Deterministic rebuild verification before any bus transport: rejects a
  # manually altered bundle even when its manifest bundle sha was recomputed.
  # The verify path rebuilds to a temp directory and never writes dist outputs.
  # Causal stderr/exit is preserved bounded/redacted before any cleanup.
  local _verify_raw="" _verify_rc=0
  _verify_raw="$("$NODE_BIN" -- "$BUILDER" --verify --input "$START_INPUT" --bundle "$START_BUNDLE" --manifest "$START_MANIFEST" 2>&1)" || _verify_rc=$?
  if [[ "$_verify_rc" -ne 0 ]]; then
    emit_invocation_diag "builder-verify" "$_verify_rc" "$MANIFEST_CORRELATION" "$_verify_raw"
    echo "error: deterministic rebuild verification failed" >&2
    return 1
  fi
  # The following node invocation is the builder verify above (node + builder
  # only); bus transport below uses only the pinned BUSCTL_BIN tool.
  local diag_start=""
  diag_start="$(wc -c < "$START_DIAG" 2>/dev/null | tr -d ' ')" || fail "could not snapshot the diag boundary"
  [[ "$diag_start" =~ ^(0|[1-9][0-9]*)$ ]] || fail "diag boundary is not a byte size; refusing stale-prone scan"
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  local load_out="" _load_raw="" _load_rc=0
  _load_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" loadScript ss "$START_BUNDLE" "$PLUGIN" 2>&1)" || _load_rc=$?
  if [[ "$_load_rc" -ne 0 ]]; then
    emit_invocation_diag "loadScript" "$_load_rc" "$MANIFEST_CORRELATION" "$_load_raw"
    fail "loadScript call failed for '$PLUGIN'"
  fi
  load_out="$_load_raw"
  SCRIPT_ID="$(parse_script_id "$load_out")" || {
    SCRIPT_ID=""
    SCRIPT_OBJ=""
    printf 'error: ambiguous loadScript identity (malformed reply: %s); no known object to unload, preserving residue with no cleanup\n' "$load_out" >&2
    exit 1
  }
  SCRIPT_OBJ="/Scripting/Script$SCRIPT_ID"
  local introspect_out="" _introspect_raw="" _introspect_rc=0
  _introspect_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" introspect "$BUS_DEST" "$SCRIPT_OBJ" 2>&1)" || _introspect_rc=$?
  if [[ "$_introspect_rc" -ne 0 ]]; then
    emit_invocation_diag "introspect" "$_introspect_rc" "$MANIFEST_CORRELATION" "$_introspect_raw"
    partial_cleanup
    fail "introspect failed for $SCRIPT_OBJ"
  fi
  introspect_out="$_introspect_raw"
  printf '%s' "$introspect_out" | grep -Fq "org.kde.kwin.Script" || {
    partial_cleanup
    fail "$SCRIPT_OBJ does not expose the Script interface"
  }
  [[ "$(loaded_word "$PLUGIN")" == "loaded" ]] || {
    partial_cleanup
    fail "plugin '$PLUGIN' was not reported loaded after exact object introspection"
  }
  local _run_raw="" _run_rc=0
  _run_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$SCRIPT_OBJ" "$BUS_SCRIPT_IFACE" run 2>&1)" || _run_rc=$?
  if [[ "$_run_rc" -ne 0 ]]; then
    emit_invocation_diag "run" "$_run_rc" "$MANIFEST_CORRELATION" "$_run_raw"
    partial_cleanup
    fail "run() failed on $SCRIPT_OBJ"
  fi
  local ready_line result_prefix result_line detail source_line after_prefix after_line verdict result_offset after_start
  source_line="$(source_line_for "$MANIFEST_ENTRY_SHA" "$MANIFEST_QUERY_SHA" "$MANIFEST_SNAPSHOT_SHA")"
  wait_diag_line "$START_DIAG" "$diag_start" "$source_line" "line" "$START_ATTEMPTS" "$START_DELAY" >/dev/null || {
    partial_cleanup
    fail "bound source marker not observed; refusing without source evidence"
  }
  ready_line="$READY_PREFIX:$MANIFEST_CORRELATION"
  wait_diag_line "$START_DIAG" "$diag_start" "$ready_line" "line" "$START_ATTEMPTS" "$START_DELAY" >/dev/null || {
    partial_cleanup
    fail "correlated ready marker not observed; refusing without readback evidence"
  }
  result_prefix="$(result_prefix_for "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_NONCE")"
  result_line="$(wait_diag_line "$START_DIAG" "$diag_start" "$result_prefix" "prefix" "$START_ATTEMPTS" "$START_DELAY")" || {
    partial_cleanup
    fail "correlated result marker not observed; refusing on identity mismatch"
  }
  detail="$(check_result_line "$result_line" "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_NONCE")" || {
    partial_cleanup
    fail "result detail failed validation; refusing on schema mismatch"
  }
  after_prefix="$(after_prefix_for "$MANIFEST_CORRELATION")"
  # The after marker must follow the correlated result in file order: capture
  # a byte boundary immediately after the correlated result marker so an
  # earlier/replayed after marker cannot satisfy start.
  result_offset="$(grep -b -F -x -- "$result_line" "$START_DIAG" 2>/dev/null | tail -n 1 | cut -d: -f1)"
  [[ "$result_offset" =~ ^(0|[1-9][0-9]*)$ ]] || {
    partial_cleanup
    fail "could not locate the correlated result marker; refusing without ordering evidence"
  }
  [[ "$result_offset" -ge "$diag_start" ]] || {
    partial_cleanup
    fail "correlated result marker precedes the run boundary; refusing stale-prone evidence"
  }
  after_start=$((result_offset + ${#result_line} + 1))
  after_line="$(wait_diag_line "$START_DIAG" "$after_start" "$after_prefix" "prefix" "$START_ATTEMPTS" "$START_DELAY")" || {
    partial_cleanup
    fail "correlated after marker not observed after the result; refusing without after-equality evidence"
  }
  verdict="$(check_after_line "$after_line" "$MANIFEST_CORRELATION")" || {
    partial_cleanup
    fail "after marker failed validation; refusing on schema mismatch"
  }
  # Explicit strict terminal-refusal mode for a sequencer. Runs only after
  # all source/ready/result/after identity/order checks above. Accepts only
  # the exact caller-supplied valid detail plus exact expected after verdict
  # (generic exact equality across valid_detail, no prefix allowlist), then
  # exact-cleans only the recorded Script object/plugin and returns success
  # with no receipt. Present-owner refusal (with --expected-planner-owner)
  # post-revalidates the exact owner triple before accepting; service-loss
  # refusal (distinct --refusal-service-loss) skips the present postcheck
  # because the sequencer independently proves owner loss.
  if [[ -n "$START_EXPECTED_REFUSAL_DETAIL" ]]; then
    if [[ "$detail" != "$START_EXPECTED_REFUSAL_DETAIL" || "$verdict" != "$START_EXPECTED_REFUSAL_AFTER" ]]; then
      partial_cleanup
      fail "refusal expectation mismatch; refusing without receipt"
    fi
    if [[ "$START_REFUSAL_SERVICE_LOSS" == "0" && -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
      local _refusal_eval_post=""
      _refusal_eval_post="$(check_planner_present_owner "$START_EXPECTED_PLANNER_OWNER")" || {
        partial_cleanup
        fail "planner unique owner drift after lifecycle; refusing without stable present owner"
      }
      PLANNER_OWNER=""; PLANNER_PID=""; PLANNER_TICK=""
      eval "$_refusal_eval_post"
      if [[ "$PLANNER_OWNER" != "$PLANNER_OWNER_1" ]]; then
        partial_cleanup
        fail "planner unique owner drift after lifecycle; refusing without stable present owner"
      fi
      if [[ "$PLANNER_PID" != "$PLANNER_PID_1" || "$PLANNER_TICK" != "$PLANNER_TICK_1" ]]; then
        partial_cleanup
        fail "planner unique owner drift after lifecycle; refusing without stable present owner"
      fi
    fi
    if [[ -e "$START_RECEIPT" || -L "$START_RECEIPT" ]]; then
      partial_cleanup
      fail "receipt appeared before refusal cleanup; refusing overwrite: $START_RECEIPT"
    fi
    exact_cleanup || {
      partial_cleanup
      fail "refusal cleanup failed for the exact id"
    }
    if [[ -e "$START_RECEIPT" || -L "$START_RECEIPT" ]]; then
      fail "refusal must leave no receipt: $START_RECEIPT"
    fi
    if [[ "$START_REFUSAL_SERVICE_LOSS" == "1" ]]; then
      printf 'refused: plugin=%s script=%s object=%s correlation=%s detail=%s after=%s service-loss\n' \
        "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_CORRELATION" "$detail" "$verdict"
    elif [[ -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
      printf 'refused: plugin=%s script=%s object=%s correlation=%s detail=%s after=%s planner-owner=%s\n' \
        "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_CORRELATION" "$detail" "$verdict" "$START_EXPECTED_PLANNER_OWNER"
    else
      printf 'refused: plugin=%s script=%s object=%s correlation=%s detail=%s after=%s\n' \
        "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_CORRELATION" "$detail" "$verdict"
    fi
    return 0
  fi
  if [[ "$verdict" == "true" ]] && is_terminal_success_detail "$detail"; then
    :
  elif [[ "$verdict" == "false" && "$detail" == "$STALE_DETAIL" ]]; then
    partial_cleanup
    fail "observed terminal stale refusal; cleaned exact id with no receipt"
  else
    partial_cleanup
    fail "result/after pairing refused; receipt requires could-execute with after true"
  fi
  # Post-lifecycle exact Planner proof when an expected owner is supplied:
  # re-prove the same exact unique owner after the KWin lifecycle and before
  # any receipt, comparing the exact triple (owner/PID/tick) against both
  # pre-lifecycle proofs. Skips only absence; any mismatch/drift/malformation
  # cleans the exact id with no receipt. The expected owner stays caller-held
  # in memory and is not added to the receipt schema (receipt remains advisory
  # identity; not logically necessary to persist the sequencer binding).
  # Machine detail is never printed; only the generic drift refusal.
  if [[ -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
    local _planner_eval_post=""
    _planner_eval_post="$(check_planner_present_owner "$START_EXPECTED_PLANNER_OWNER")" || {
      partial_cleanup
      fail "planner unique owner drift after lifecycle; refusing without stable present owner"
    }
    PLANNER_OWNER=""; PLANNER_PID=""; PLANNER_TICK=""
    eval "$_planner_eval_post"
    if [[ "$PLANNER_OWNER" != "$PLANNER_OWNER_1" ]]; then
      partial_cleanup
      fail "planner unique owner drift after lifecycle; refusing without stable present owner"
    fi
    if [[ "$PLANNER_PID" != "$PLANNER_PID_1" || "$PLANNER_TICK" != "$PLANNER_TICK_1" ]]; then
      partial_cleanup
      fail "planner unique owner drift after lifecycle; refusing without stable present owner"
    fi
  fi
  RECEIPT_PATH="$START_RECEIPT"
  # Exclusive fail-closed receipt creation: real parent dir required above,
  # pre-existing path (including symlinks) refused above, and noclobber
  # guarantees no overwrite of a racing path.
  if [[ -e "$RECEIPT_PATH" || -L "$RECEIPT_PATH" ]]; then
    partial_cleanup
    fail "receipt appeared before exclusive creation; refusing overwrite: $RECEIPT_PATH"
  fi
  if [[ "$IS_SHADOW" == "1" ]]; then
    (set -o noclobber; printf '{"schema":"%s","plugin":"%s","scriptId":%s,"scriptObject":"%s","bundleSha256":"%s","entrySha256":"%s","shadowSha256":"%s","snapshotSha256":"%s","owner":"%s","generation":"%s","revision":%s,"correlationId":"%s","nonce":"%s"}\n' \
      "$RECEIPT_SCHEMA" "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_BUNDLE_SHA" "$MANIFEST_ENTRY_SHA" "$MANIFEST_QUERY_SHA" "$MANIFEST_SNAPSHOT_SHA" \
      "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_CORRELATION" "$MANIFEST_NONCE" > "$RECEIPT_PATH") || {
      partial_cleanup
      fail "could not write the receipt exclusively"
    }
  else
    (set -o noclobber; printf '{"schema":"%s","plugin":"%s","scriptId":%s,"scriptObject":"%s","bundleSha256":"%s","entrySha256":"%s","querySha256":"%s","snapshotSha256":"%s","owner":"%s","generation":"%s","revision":%s,"correlationId":"%s","nonce":"%s"}\n' \
      "$RECEIPT_SCHEMA" "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_BUNDLE_SHA" "$MANIFEST_ENTRY_SHA" "$MANIFEST_QUERY_SHA" "$MANIFEST_SNAPSHOT_SHA" \
      "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_CORRELATION" "$MANIFEST_NONCE" > "$RECEIPT_PATH") || {
      partial_cleanup
      fail "could not write the receipt exclusively"
    }
  fi
  RECEIPT_CREATED="1"
  if [[ -n "$START_EXPECTED_PLANNER_OWNER" ]]; then
    printf 'started: plugin=%s script=%s object=%s correlation=%s owner=%s generation=%s revision=%s planner-owner=%s\n' \
      "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$START_EXPECTED_PLANNER_OWNER"
  else
    printf 'started: plugin=%s script=%s object=%s correlation=%s owner=%s generation=%s revision=%s\n' \
      "$PLUGIN" "$SCRIPT_ID" "$SCRIPT_OBJ" "$MANIFEST_CORRELATION" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION"
  fi
}

parse_preflight_args() {
  PRE_BUNDLE=""; PRE_MANIFEST=""; PRE_INPUT=""; PRE_EXPECTED_PLANNER_OWNER=""
  local seen_bundle=0 seen_manifest=0 seen_input=0 seen_expected=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bundle) [[ "$seen_bundle" -eq 0 ]] || fail "duplicate --bundle"; seen_bundle=1; [[ -n "${2:-}" ]] || fail "missing value for --bundle"; PRE_BUNDLE="$2"; shift 2 ;;
      --manifest) [[ "$seen_manifest" -eq 0 ]] || fail "duplicate --manifest"; seen_manifest=1; [[ -n "${2:-}" ]] || fail "missing value for --manifest"; PRE_MANIFEST="$2"; shift 2 ;;
      --input) [[ "$seen_input" -eq 0 ]] || fail "duplicate --input"; seen_input=1; [[ -n "${2:-}" ]] || fail "missing value for --input"; PRE_INPUT="$2"; shift 2 ;;
      --expected-planner-owner) [[ "$seen_expected" -eq 0 ]] || fail "duplicate --expected-planner-owner"; seen_expected=1; [[ -n "${2:-}" ]] || fail "missing value for --expected-planner-owner"; PRE_EXPECTED_PLANNER_OWNER="$2"; shift 2 ;;
      *) fail "unknown preflight flag '$1'" ;;
    esac
  done
  [[ -n "$PRE_BUNDLE" ]] || fail "preflight requires --bundle"
  [[ -n "$PRE_MANIFEST" ]] || fail "preflight requires --manifest"
  [[ -n "$PRE_INPUT" ]] || fail "preflight requires --input"
  if [[ -n "$PRE_EXPECTED_PLANNER_OWNER" ]]; then
    valid_planner_unique_owner "$PRE_EXPECTED_PLANNER_OWNER" || fail "invalid --expected-planner-owner (must be :N.M)"
  fi
}

# Strict resource-free preflight (read-only, in-memory only, no bus
# mutation, no temp files, no dirs, no receipts, no runtime directory, no
# generic interface). Mirrors the start immutable checks: tools, exact
# sources, advisory-only shape, KWin identity with recapture/drift guard,
# production loaded, advisory absent, Planner absent by default or exact
# present-owner proof when the explicit unique owner is supplied. Emits only
# safe machine-independent manifest identity on stdout.
cmd_preflight() {
  parse_preflight_args "$@"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  command -v "$SHA256SUM_BIN" >/dev/null 2>&1 || fail "required tool '$SHA256SUM_BIN' not found in PATH"
  command -v "$NODE_BIN" >/dev/null 2>&1 || fail "required tool '$NODE_BIN' not found in PATH"
  command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 || fail "required tool '$SYSTEMCTL_BIN' not found in PATH"
  command -v "$STAT_BIN" >/dev/null 2>&1 || fail "required tool '$STAT_BIN' not found in PATH"
  command -v "$READLINK_BIN" >/dev/null 2>&1 || fail "required tool '$READLINK_BIN' not found in PATH"
  require_regular_file "$PRE_BUNDLE" "bundle"
  require_regular_file "$PRE_MANIFEST" "manifest"
  require_regular_file "$PRE_INPUT" "input"
  if [[ "$IS_SHADOW" == "1" ]]; then
    require_regular_file "$SRC_ENTRY" "shadow entry source"
    require_regular_file "$SRC_QUERY" "shadow second source"
    require_regular_file "$SRC_SNAPSHOT" "shadow snapshot source"
  else
    require_regular_file "$SRC_ENTRY" "advisory entry source"
    require_regular_file "$SRC_QUERY" "advisory query source"
    require_regular_file "$SRC_SNAPSHOT" "advisory snapshot source"
  fi
  [[ "${PRE_BUNDLE##*/}" == "$BUNDLE_BASENAME" ]] || fail "bundle must be exactly $BUNDLE_BASENAME"
  [[ "${PRE_MANIFEST##*/}" == "$MANIFEST_BASENAME" ]] || fail "manifest must be exactly $MANIFEST_BASENAME"
  local manifest_eval=""
  manifest_eval="$(parse_manifest "$PRE_MANIFEST")" || exit 1
  local MANIFEST_BUNDLE_SHA="" MANIFEST_ENTRY_SHA="" MANIFEST_QUERY_SHA="" MANIFEST_SNAPSHOT_SHA="" MANIFEST_INPUT_SHA="" MANIFEST_NONCE="" MANIFEST_CORRELATION="" MANIFEST_OWNER="" MANIFEST_GENERATION="" MANIFEST_REVISION=""
  eval "$manifest_eval"
  local actual_input_sha
  actual_input_sha="$(sha256_file "$PRE_INPUT")"
  [[ -n "$actual_input_sha" ]] || fail "could not hash the input"
  [[ "$actual_input_sha" == "$MANIFEST_INPUT_SHA" ]] || fail "input bytes do not match the manifest input binding"
  local actual_bundle_sha actual_entry_sha actual_query_sha actual_snapshot_sha
  actual_bundle_sha="$(sha256_file "$PRE_BUNDLE")"
  [[ "$actual_bundle_sha" == "$MANIFEST_BUNDLE_SHA" ]] || fail "bundle bytes do not match the manifest build identity"
  actual_entry_sha="$(sha256_file "$SRC_ENTRY")"
  actual_query_sha="$(sha256_file "$SRC_QUERY")"
  actual_snapshot_sha="$(sha256_file "$SRC_SNAPSHOT")"
  [[ "$actual_entry_sha" == "$MANIFEST_ENTRY_SHA" ]] || fail "entry source does not match the manifest build identity"
  [[ "$actual_query_sha" == "$MANIFEST_QUERY_SHA" ]] || fail "query source does not match the manifest build identity"
  [[ "$actual_snapshot_sha" == "$MANIFEST_SNAPSHOT_SHA" ]] || fail "snapshot source does not match the manifest build identity"
  grep -Fq -- "$MANIFEST_ENTRY_SHA" "$PRE_BUNDLE" || fail "bundle lacks the embedded entry source binding"
  if [[ "$IS_SHADOW" == "1" ]]; then
    grep -Fq -- "$MANIFEST_QUERY_SHA" "$PRE_BUNDLE" || fail "bundle lacks the embedded second source binding"
  else
    grep -Fq -- "$MANIFEST_QUERY_SHA" "$PRE_BUNDLE" || fail "bundle lacks the embedded query source binding"
  fi
  grep -Fq -- "$MANIFEST_SNAPSHOT_SHA" "$PRE_BUNDLE" || fail "bundle lacks the embedded snapshot source binding"
  prove_advisory_only "$PRE_BUNDLE" || exit 1
  local KWIN_OWNER="" KWIN_PID="" KWIN_TICK="" KWIN_EXE="" KWIN_SOURCE=""
  local PLANNER_OWNER="" PLANNER_PID="" PLANNER_TICK=""
  local PLANNER_OWNER_1="" PLANNER_PID_1="" PLANNER_TICK_1=""
  local _planner_eval_1="" _planner_eval_2=""
  local _pre_out=""
  _pre_out="$(kwin_identity_once)" || exit 1
  local -a _pre=()
  mapfile -t _pre <<<"$_pre_out" || fail "KWin identity capture is ambiguous"
  [[ "${#_pre[@]}" -eq 5 ]] || fail "KWin identity capture is ambiguous"
  KWIN_OWNER="${_pre[0]}"
  KWIN_PID="${_pre[1]}"
  KWIN_TICK="${_pre[2]}"
  KWIN_EXE="${_pre[3]}"
  KWIN_SOURCE="${_pre[4]}"
  [[ -n "$KWIN_OWNER" && -n "$KWIN_PID" && -n "$KWIN_TICK" && -n "$KWIN_EXE" ]] || fail "KWin identity capture is ambiguous"
  [[ "$KWIN_SOURCE" == "systemd" || "$KWIN_SOURCE" == "systemd-direct-parent" ]] || fail "KWin identity source is ambiguous"
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before shadow preflight"
  else
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before advisory preflight"
  fi
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  if [[ -n "$PRE_EXPECTED_PLANNER_OWNER" ]]; then
    _planner_eval_1="$(check_planner_present_owner "$PRE_EXPECTED_PLANNER_OWNER")" || exit 1
    PLANNER_OWNER=""; PLANNER_PID=""; PLANNER_TICK=""
    eval "$_planner_eval_1"
    [[ -n "$PLANNER_OWNER" && -n "$PLANNER_PID" && -n "$PLANNER_TICK" ]] || fail "planner present-owner proof is ambiguous"
    valid_planner_unique_owner "$PLANNER_OWNER" || fail "planner present-owner proof is ambiguous"
    [[ "$PLANNER_OWNER" == "$PRE_EXPECTED_PLANNER_OWNER" ]] || fail "planner unique owner mismatch for $PLANNER_SERVICE; refusing (expected $PRE_EXPECTED_PLANNER_OWNER, present $PLANNER_OWNER)"
    PLANNER_OWNER_1="$PLANNER_OWNER"; PLANNER_PID_1="$PLANNER_PID"; PLANNER_TICK_1="$PLANNER_TICK"
  else
    check_planner_absent || exit 1
  fi
  local RE_OWNER="" RE_PID="" RE_TICK="" RE_EXE="" RE_SOURCE=""
  local _re_out=""
  _re_out="$(kwin_identity_once)" || fail "KWin identity recapture failed"
  local -a _re=()
  mapfile -t _re <<<"$_re_out" || fail "KWin identity recapture is ambiguous"
  [[ "${#_re[@]}" -eq 5 ]] || fail "KWin identity recapture is ambiguous"
  RE_OWNER="${_re[0]}"
  RE_PID="${_re[1]}"
  RE_TICK="${_re[2]}"
  RE_EXE="${_re[3]}"
  RE_SOURCE="${_re[4]}"
  [[ "$RE_OWNER" == "$KWIN_OWNER" ]] || fail "KWin unique owner drift detected; refusing ambiguous identity"
  [[ "$RE_PID" == "$KWIN_PID" && "$RE_TICK" == "$KWIN_TICK" ]] || fail "KWin PID/start-tick drift detected; refusing ambiguous identity (PID reuse suspected)"
  [[ "$RE_EXE" == "$KWIN_EXE" ]] || fail "KWin executable drift detected; refusing ambiguous identity"
  [[ "$RE_SOURCE" == "$KWIN_SOURCE" ]] || fail "KWin identity source drift detected; refusing ambiguous identity"
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before shadow preflight"
  else
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before advisory preflight"
  fi
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  if [[ -n "$PRE_EXPECTED_PLANNER_OWNER" ]]; then
    _planner_eval_2="$(check_planner_present_owner "$PRE_EXPECTED_PLANNER_OWNER")" || exit 1
    PLANNER_OWNER=""; PLANNER_PID=""; PLANNER_TICK=""
    eval "$_planner_eval_2"
    [[ -n "$PLANNER_OWNER" && -n "$PLANNER_PID" && -n "$PLANNER_TICK" ]] || fail "planner present-owner proof is ambiguous"
    [[ "$PLANNER_OWNER" == "$PLANNER_OWNER_1" ]] || fail "planner unique owner mismatch for $PLANNER_SERVICE; refusing (expected $PLANNER_OWNER_1, present $PLANNER_OWNER)"
    [[ "$PLANNER_PID" == "$PLANNER_PID_1" && "$PLANNER_TICK" == "$PLANNER_TICK_1" ]] || fail "planner PID/start-tick drift detected; refusing ambiguous identity (PID reuse suspected)"
  else
    check_planner_absent || exit 1
  fi
  printf 'preflight: bundle=%s entry=%s query=%s snapshot=%s input=%s owner=%s generation=%s revision=%s correlation=%s nonce=%s\n' \
    "$MANIFEST_BUNDLE_SHA" "$MANIFEST_ENTRY_SHA" "$MANIFEST_QUERY_SHA" "$MANIFEST_SNAPSHOT_SHA" \
    "$MANIFEST_INPUT_SHA" "$MANIFEST_OWNER" "$MANIFEST_GENERATION" "$MANIFEST_REVISION" "$MANIFEST_CORRELATION" "$MANIFEST_NONCE"
}

# Smallest resource-free source-only preflight (read-only, in-memory only,
# no bus mutation, no temp files, no dirs, no receipts, no bundle/manifest/
# input). Validates exact tool identities, exact source identities plus the
# source-only shape gate, KWin identity with recapture/drift guard,
# production loaded, plugin absent, and Planner absent. Emits only safe
# machine-independent source shas on stdout. Existing full preflight/start
# behavior above is unchanged; this variant exists so a lifecycle can gate
# before creating any file, dir, build output, input, receipt, or runtime
# namespace. Takes no arguments; any flag fails. No mktemp, no mkdir, no
# touch, no file-creating redirection here.
cmd_preflight_source_only() {
  [[ $# -eq 0 ]] || fail "preflight-source-only takes no arguments"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  command -v "$SHA256SUM_BIN" >/dev/null 2>&1 || fail "required tool '$SHA256SUM_BIN' not found in PATH"
  command -v "$NODE_BIN" >/dev/null 2>&1 || fail "required tool '$NODE_BIN' not found in PATH"
  command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 || fail "required tool '$SYSTEMCTL_BIN' not found in PATH"
  command -v "$STAT_BIN" >/dev/null 2>&1 || fail "required tool '$STAT_BIN' not found in PATH"
  command -v "$READLINK_BIN" >/dev/null 2>&1 || fail "required tool '$READLINK_BIN' not found in PATH"
  if [[ "$IS_SHADOW" == "1" ]]; then
    require_regular_file "$SRC_ENTRY" "shadow entry source"
    require_regular_file "$SRC_QUERY" "shadow second source"
    require_regular_file "$SRC_SNAPSHOT" "shadow snapshot source"
  else
    require_regular_file "$SRC_ENTRY" "advisory entry source"
    require_regular_file "$SRC_QUERY" "advisory query source"
    require_regular_file "$SRC_SNAPSHOT" "advisory snapshot source"
  fi
  prove_sources_shape_only || exit 1
  local actual_entry_sha="" actual_query_sha="" actual_snapshot_sha=""
  actual_entry_sha="$(sha256_file "$SRC_ENTRY")"
  [[ -n "$actual_entry_sha" ]] || fail "could not hash the entry source"
  actual_query_sha="$(sha256_file "$SRC_QUERY")"
  [[ -n "$actual_query_sha" ]] || fail "could not hash the second source"
  actual_snapshot_sha="$(sha256_file "$SRC_SNAPSHOT")"
  [[ -n "$actual_snapshot_sha" ]] || fail "could not hash the snapshot source"
  local KWIN_OWNER="" KWIN_PID="" KWIN_TICK="" KWIN_EXE="" KWIN_SOURCE=""
  local _pre_out=""
  _pre_out="$(kwin_identity_once)" || exit 1
  local -a _pre=()
  mapfile -t _pre <<<"$_pre_out" || fail "KWin identity capture is ambiguous"
  [[ "${#_pre[@]}" -eq 5 ]] || fail "KWin identity capture is ambiguous"
  KWIN_OWNER="${_pre[0]}"
  KWIN_PID="${_pre[1]}"
  KWIN_TICK="${_pre[2]}"
  KWIN_EXE="${_pre[3]}"
  KWIN_SOURCE="${_pre[4]}"
  [[ -n "$KWIN_OWNER" && -n "$KWIN_PID" && -n "$KWIN_TICK" && -n "$KWIN_EXE" ]] || fail "KWin identity capture is ambiguous"
  [[ "$KWIN_SOURCE" == "systemd" || "$KWIN_SOURCE" == "systemd-direct-parent" ]] || fail "KWin identity source is ambiguous"
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before shadow preflight"
  else
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before advisory preflight"
  fi
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  check_planner_absent || exit 1
  local RE_OWNER="" RE_PID="" RE_TICK="" RE_EXE="" RE_SOURCE=""
  local _re_out=""
  _re_out="$(kwin_identity_once)" || fail "KWin identity recapture failed"
  local -a _re=()
  mapfile -t _re <<<"$_re_out" || fail "KWin identity recapture is ambiguous"
  [[ "${#_re[@]}" -eq 5 ]] || fail "KWin identity recapture is ambiguous"
  RE_OWNER="${_re[0]}"
  RE_PID="${_re[1]}"
  RE_TICK="${_re[2]}"
  RE_EXE="${_re[3]}"
  RE_SOURCE="${_re[4]}"
  [[ "$RE_OWNER" == "$KWIN_OWNER" ]] || fail "KWin unique owner drift detected; refusing ambiguous identity"
  [[ "$RE_PID" == "$KWIN_PID" && "$RE_TICK" == "$KWIN_TICK" ]] || fail "KWin PID/start-tick drift detected; refusing ambiguous identity (PID reuse suspected)"
  [[ "$RE_EXE" == "$KWIN_EXE" ]] || fail "KWin executable drift detected; refusing ambiguous identity"
  [[ "$RE_SOURCE" == "$KWIN_SOURCE" ]] || fail "KWin identity source drift detected; refusing ambiguous identity"
  if [[ "$IS_SHADOW" == "1" ]]; then
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before shadow preflight"
  else
    [[ "$(loaded_word "$PRODUCTION_PLUGIN")" == "loaded" ]] || fail "production plugin '$PRODUCTION_PLUGIN' must be loaded before advisory preflight"
  fi
  [[ "$(loaded_word "$PLUGIN")" == "not-loaded" ]] || fail "plugin '$PLUGIN' is already loaded; stop the recorded script first"
  check_planner_absent || exit 1
  printf 'preflight-source-only: entry=%s query=%s snapshot=%s\n' \
    "$actual_entry_sha" "$actual_query_sha" "$actual_snapshot_sha"
}

cmd_status() {
  local receipt=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --receipt) [[ -z "$receipt" ]] || fail "duplicate --receipt"; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; receipt="$2"; shift 2 ;;
      *) fail "unknown status flag '$1'" ;;
    esac
  done
  [[ -n "$receipt" ]] || fail "status requires --receipt"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  require_regular_file "$receipt" "receipt"
  local receipt_eval=""
  receipt_eval="$(parse_receipt "$receipt")" || exit 1
  local RECEIPT_PLUGIN="" RECEIPT_SCRIPT_ID="" RECEIPT_SCRIPT_OBJ="" RECEIPT_BUNDLE_SHA="" RECEIPT_ENTRY_SHA="" RECEIPT_QUERY_SHA="" RECEIPT_SNAPSHOT_SHA=""
  local RECEIPT_OWNER="" RECEIPT_GENERATION="" RECEIPT_REVISION="" RECEIPT_CORRELATION="" RECEIPT_NONCE=""
  eval "$receipt_eval"
  local state=""
  state="$(loaded_word "$RECEIPT_PLUGIN")" || exit 1
  printf 'status: plugin=%s script=%s object=%s state=%s correlation=%s owner=%s generation=%s revision=%s\n' \
    "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID" "$RECEIPT_SCRIPT_OBJ" "$state" "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION"
}

cmd_diagnostics() {
  local receipt="" diag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --receipt) [[ -z "$receipt" ]] || fail "duplicate --receipt"; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; receipt="$2"; shift 2 ;;
      --diag-file) [[ -z "$diag" ]] || fail "duplicate --diag-file"; [[ -n "${2:-}" ]] || fail "missing value for --diag-file"; diag="$2"; shift 2 ;;
      *) fail "unknown diagnostics flag '$1'" ;;
    esac
  done
  [[ -n "$receipt" ]] || fail "diagnostics requires --receipt"
  require_regular_file "$receipt" "receipt"
  local receipt_eval=""
  receipt_eval="$(parse_receipt "$receipt")" || exit 1
  local RECEIPT_PLUGIN="" RECEIPT_SCRIPT_ID="" RECEIPT_SCRIPT_OBJ="" RECEIPT_BUNDLE_SHA="" RECEIPT_ENTRY_SHA="" RECEIPT_QUERY_SHA="" RECEIPT_SNAPSHOT_SHA=""
  local RECEIPT_OWNER="" RECEIPT_GENERATION="" RECEIPT_REVISION="" RECEIPT_CORRELATION="" RECEIPT_NONCE=""
  eval "$receipt_eval"
  printf 'diagnostics: plugin=%s script=%s object=%s correlation=%s owner=%s generation=%s revision=%s bundle=%s\n' \
    "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID" "$RECEIPT_SCRIPT_OBJ" "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION" "$RECEIPT_BUNDLE_SHA"
  if [[ -n "$diag" ]]; then
    require_regular_file "$diag" "diag file"
    local ready_line result_prefix after_prefix source_line line found_ready="" found_result="" found_after="" found_source="" slice="" found_detail="" found_verdict="" result_pos=-1 after_pos=-1 pos=0
    ready_line="$READY_PREFIX:$RECEIPT_CORRELATION"
    source_line="$(source_line_for "$RECEIPT_ENTRY_SHA" "$RECEIPT_QUERY_SHA" "$RECEIPT_SNAPSHOT_SHA")"
    result_prefix="$(result_prefix_for "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION" "$RECEIPT_NONCE")"
    after_prefix="$(after_prefix_for "$RECEIPT_CORRELATION")"
    slice="$(tail -c 65536 -- "$diag" 2>/dev/null)" || slice=""
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "$ready_line" ]]; then found_ready="$line"; fi
      if [[ "$line" == "$source_line" ]]; then found_source="$line"; fi
      if [[ "$line" == "$result_prefix"* ]]; then found_result="$line"; result_pos="$pos"; fi
      if [[ "$line" == "$after_prefix"* ]]; then found_after="$line"; after_pos="$pos"; fi
      pos=$((pos + 1))
    done <<< "$slice"
    found_ready="$(printf '%s' "$found_ready" | head -c 1024)" || found_ready=""
    found_source="$(printf '%s' "$found_source" | head -c 1024)" || found_source=""
    found_result="$(printf '%s' "$found_result" | head -c 1024)" || found_result=""
    found_after="$(printf '%s' "$found_after" | head -c 1024)" || found_after=""
    [[ -n "$found_ready" ]] || fail "ready marker for the recorded correlation is absent"
    [[ -n "$found_source" ]] || fail "bound source marker for the recorded identity is absent"
    [[ -n "$found_result" ]] || fail "result marker for the recorded identity is absent"
    [[ -n "$found_after" ]] || fail "after marker for the recorded correlation is absent"
    found_detail="$(check_result_line "$found_result" "$RECEIPT_CORRELATION" "$RECEIPT_OWNER" "$RECEIPT_GENERATION" "$RECEIPT_REVISION" "$RECEIPT_NONCE")" || fail "result marker detail failed validation"
    found_verdict="$(check_after_line "$found_after" "$RECEIPT_CORRELATION")" || fail "after marker failed validation"
    [[ "$after_pos" -gt "$result_pos" ]] || fail "after marker must follow the correlated result marker"
    if [[ "$found_verdict" == "true" ]] && ! is_terminal_success_detail "$found_detail"; then
      fail "diagnostics refuses non-success detail with after true"
    fi
    if [[ "$found_verdict" == "false" && "$found_detail" != "$STALE_DETAIL" ]]; then
      fail "after drift without explicit stale rejection"
    fi
    printf 'diagnostics: markers=correlated\n'
  fi
}

cmd_stop() {
  local receipt=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --receipt) [[ -z "$receipt" ]] || fail "duplicate --receipt"; [[ -n "${2:-}" ]] || fail "missing value for --receipt"; receipt="$2"; shift 2 ;;
      *) fail "unknown stop flag '$1'" ;;
    esac
  done
  [[ -n "$receipt" ]] || fail "stop requires --receipt"
  command -v "$BUSCTL_BIN" >/dev/null 2>&1 || fail "required tool '$BUSCTL_BIN' not found in PATH"
  require_regular_file "$receipt" "receipt"
  local receipt_eval=""
  receipt_eval="$(parse_receipt "$receipt")" || exit 1
  local RECEIPT_PLUGIN="" RECEIPT_SCRIPT_ID="" RECEIPT_SCRIPT_OBJ="" RECEIPT_BUNDLE_SHA="" RECEIPT_ENTRY_SHA="" RECEIPT_QUERY_SHA="" RECEIPT_SNAPSHOT_SHA=""
  local RECEIPT_OWNER="" RECEIPT_GENERATION="" RECEIPT_REVISION="" RECEIPT_CORRELATION="" RECEIPT_NONCE=""
  eval "$receipt_eval"
  ACTIVE_CORR="$RECEIPT_CORRELATION"
  SCRIPT_ID="$RECEIPT_SCRIPT_ID"
  SCRIPT_OBJ="$RECEIPT_SCRIPT_OBJ"
  if [[ "$(loaded_word "$RECEIPT_PLUGIN")" == "not-loaded" ]]; then
    rm -f -- "$receipt" || fail "could not remove the stale receipt"
    printf 'stopped: plugin=%s script=%s already-absent cleanup=verified\n' "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID"
    return 0
  fi
  local _stop_raw="" _stop_rc=0
  _stop_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$SCRIPT_OBJ" "$BUS_SCRIPT_IFACE" stop 2>&1)" || _stop_rc=$?
  if [[ "$_stop_rc" -ne 0 ]]; then
    emit_invocation_diag "stop" "$_stop_rc" "$ACTIVE_CORR" "$_stop_raw"
  fi
  local unload_out="" _su_rc=0 _su_raw=""
  _su_raw="$("$BUSCTL_BIN" "$BUS_SCOPE" call "$BUS_DEST" "$BUS_PATH" "$BUS_SCRIPTING_IFACE" unloadScript s "$RECEIPT_PLUGIN" 2>&1)" || _su_rc=$?
  if [[ "$_su_rc" -ne 0 ]]; then
    emit_invocation_diag "unloadScript" "$_su_rc" "$ACTIVE_CORR" "$_su_raw"
    fail "unloadScript failed for '$RECEIPT_PLUGIN'"
  fi
  unload_out="$_su_raw"
  [[ "$(parse_bool "$unload_out")" == "true" ]] || {
    emit_invocation_diag "unloadScript" "1" "$ACTIVE_CORR" "$unload_out"
    fail "unloadScript refused '$RECEIPT_PLUGIN'"
  }
  [[ "$(loaded_word "$RECEIPT_PLUGIN")" == "not-loaded" ]] || {
    emit_invocation_diag "state" "1" "$ACTIVE_CORR" "plugin still loaded after exact unload"
    fail "recorded plugin still loaded after exact unload"
  }
  rm -f -- "$receipt" || fail "could not remove the receipt"
  printf 'stopped: plugin=%s script=%s object=%s cleanup=verified\n' "$RECEIPT_PLUGIN" "$RECEIPT_SCRIPT_ID" "$SCRIPT_OBJ"
}

main() {
  [[ $# -ge 1 ]] || { usage >&2; exit 1; }
  case "$1" in
    --help|-h|help) usage; exit 0 ;;
    preflight) shift; cmd_preflight "$@" ;;
    preflight-source-only) shift; cmd_preflight_source_only "$@" ;;
    start) shift; cmd_start "$@" ;;
    status) shift; cmd_status "$@" ;;
    diagnostics) shift; cmd_diagnostics "$@" ;;
    stop) shift; cmd_stop "$@" ;;
    *) fail "unknown command '$1' (expected preflight|preflight-source-only|start|status|diagnostics|stop|--help)" ;;
  esac
}

main "$@"
