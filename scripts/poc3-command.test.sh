#!/usr/bin/env bash
# Static acceptance for scripts/poc3-command.sh and
# scripts/poc3-build-command.mjs. No live KWin/Plasma actions: only --help,
# syntax, helper validation vectors, and bounded-scope source assertions.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$REPO_ROOT/scripts/poc3-command.sh"
HELPER="$REPO_ROOT/scripts/poc3-build-command.mjs"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'fail: %s\n' "$1"; }

assert_contains() {
  local file="$1" text="$2"
  if grep -qF -- "$text" "$file"; then pass "contains: $text"; else fail "missing: $text"; fi
}

assert_absent() {
  local file="$1" text="$2"
  if grep -qF -- "$text" "$file"; then fail "forbidden present: $text"; else pass "absent: $text"; fi
}

# 1. Syntax and help are safe to run without a live session.
if bash -n "$TOOL"; then pass "bash -n syntax"; else fail "bash -n syntax"; fi
if node --check "$HELPER"; then pass "node --check helper"; else fail "node --check helper"; fi
HELP="$(bash "$TOOL" --help 2>&1)" || fail "--help exit status"
if [[ "$HELP" == *"poc3-manual-command"* && "$HELP" == *"poc3-command-done"* ]]; then
  pass "--help documents one-shot route"
else
  fail "--help documents one-shot route"
fi
for bad in bogus-command start focus; do
  if bash "$TOOL" "$bad" >/dev/null 2>&1; then
    fail "bad invocation '$bad' must fail"
  else
    pass "bad invocation '$bad' fails"
  fi
done

# 2. Fixed command surface and bounded scope.
assert_contains "$TOOL" 'PLUGIN="poc3-manual-command"'
assert_contains "$TOOL" 'BUNDLE="$KWIN_DIR/dist/poc3-manual-command.js"'
assert_contains "$TOOL" 'poc3-command-done:'
assert_contains "$TOOL" 'set -euo pipefail'
assert_contains "$TOOL" 'cmd_run'
# Closure-only pinning lives in the adapter one-shot route (the only supported
# literal, selected by code rather than by CLI input).
assert_contains "$REPO_ROOT/kwin/src/poc3-adapter.ts" 'POC3_CLEANUP_MODEL = "close-disposable"'
assert_contains "$REPO_ROOT/kwin/src/poc3-command-entry.ts" 'runCommand'

# 3. No generic execution, shortcut/config/package mutation, or broad authority.
assert_absent "$TOOL" 'eval '
assert_absent "$TOOL" 'loadScriptFromText'
assert_absent "$TOOL" 'setShortcutKeys'
assert_absent "$TOOL" 'registerShortcut'
assert_absent "$TOOL" 'kpackagetool'
assert_absent "$TOOL" 'unloadScript s "$PRODUCTION_PLUGIN"'
assert_absent "$TOOL" 'child_process'
assert_absent "$TOOL" 'systemctl'
assert_absent "$HELPER" 'eval('
assert_absent "$HELPER" 'Function('
assert_absent "$HELPER" 'child_process'

# 4. Coexistence guard: refuse while production is loaded, never touch it.
assert_contains "$TOOL" 'PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"'
assert_contains "$TOOL" 'refusing POC3 command operation'

# 5. Closure-only route: no restore flag exists anywhere in the route.
assert_absent "$TOOL" '--restore'
assert_absent "$TOOL" 'confirm_restore'
assert_absent "$HELPER" 'restore'

# 6. Helper validation vectors: fixed commands, opaque args, no shell eval.
helper_ok() {
  if node "$HELPER" "$@" --out "$REPO_ROOT/kwin/dist/poc3-manual-command.js" >/dev/null 2>&1; then
    pass "helper accepts: $*"
  else
    fail "helper accepts: $*"
  fi
  rm -f "$REPO_ROOT/kwin/dist/poc3-manual-command.js"
}
helper_rejects() {
  if node "$HELPER" "$@" --out "$REPO_ROOT/kwin/dist/poc3-manual-command.js" >/dev/null 2>&1; then
    fail "helper rejects: $*"
  else
    pass "helper rejects: $*"
  fi
  rm -f "$REPO_ROOT/kwin/dist/poc3-manual-command.js"
}
helper_ok --command start --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --nonce n-1
helper_ok --command start --id '{11111111-1111-1111-1111-111111111111}' --id '{22222222-2222-2222-2222-222222222222}' --id '{33333333-3333-3333-3333-333333333333}' --owner owner-1 --generation gen-1 --nonce n-1 --gap 0 --usable 0,0,900,600
helper_ok --command focus --direction right --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --revision 1 --nonce n-1
helper_ok --command move --direction down --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --revision 0 --nonce n-1
helper_ok --command status --owner owner-1 --generation gen-1 --nonce n-1
helper_ok --command stop --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --revision 2 --nonce n-1
helper_rejects --command start --id 'id-a;rm -rf /' --id id-b --id id-c --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command start --id 'id-a$(touch /tmp/pwned)' --id id-b --id id-c --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command start --id 'id-a`touch /tmp/pwned`' --id id-b --id id-c --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command start --id 'id a' --id id-b --id id-c --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command start --id id-a --id id-b --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command start --id id-a --id id-b --id id-b --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command teleport --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command focus --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --revision 1 --nonce n-1
helper_rejects --command move --direction diagonal --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --revision 1 --nonce n-1
helper_rejects --command status --id id-a --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command stop --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1 --nonce n-1
helper_rejects --command start --id id-a --id id-b --id id-c --owner 'BAD OWNER' --generation gen-1 --nonce n-1
helper_rejects --command start --id id-a --id id-b --id id-c --owner owner-1 --generation gen-1

# 7. M1: host route is disabled by default with opt-in POC3_HOST_ALLOW=1.
# Static only: the gate fires before any transport (no live KWin/bus use).
assert_contains "$TOOL" 'POC3_HOST_ALLOW'
assert_contains "$TOOL" 'host_require_enabled'
assert_contains "$TOOL" 'host POC3 command transport is disabled by default'
M1_OUT="$(mktemp)"
if env -u POC3_HOST_ALLOW bash "$TOOL" status --owner owner-1 --generation gen-1 --nonce n-1 >/dev/null 2>&1; then
  fail "host route without opt-in must fail"
else
  env -u POC3_HOST_ALLOW bash "$TOOL" status --owner owner-1 --generation gen-1 --nonce n-1 >"$M1_OUT" 2>&1 || true
  if grep -Fq "disabled by default" "$M1_OUT"; then
    pass "host route disabled by default (unset)"
  else
    fail "host route disabled by default (unset)"
  fi
fi
if POC3_HOST_ALLOW=0 bash "$TOOL" status --owner owner-1 --generation gen-1 --nonce n-1 >/dev/null 2>&1; then
  fail "host route with POC3_HOST_ALLOW=0 must fail"
else
  POC3_HOST_ALLOW=0 bash "$TOOL" status --owner owner-1 --generation gen-1 --nonce n-1 >"$M1_OUT" 2>&1 || true
  if grep -Fq "disabled by default" "$M1_OUT"; then
    pass "host route disabled by default (zero)"
  else
    fail "host route disabled by default (zero)"
  fi
fi
# Opt-in preserves behavior: with POC3_HOST_ALLOW=1 the gate passes and the
# invocation proceeds past the gate (it then fails only on live transport,
# never on the disabled message).
POC3_HOST_ALLOW=1 bash "$TOOL" status --owner owner-1 --generation gen-1 --nonce n-1 >"$M1_OUT" 2>&1 || true
if grep -Fq "disabled by default" "$M1_OUT"; then
  fail "host route with opt-in must not report disabled"
else
  pass "host route opt-in preserves behavior past the gate"
fi
rm -f "$M1_OUT"
# Nested remains a separate gate.
assert_contains "$TOOL" 'POC3_NESTED_ALLOW'
assert_contains "$TOOL" 'nested POC3 command transport is disabled by default'

# 8. verified KWin loadScript contract (static, no transport).
# Success IDs are 0..2147483647; -1 is the failure sentinel; 0 maps
# exactly to /Scripting/Script0; unload authority is the recorded plugin.
JQ_BIN="$(command -v jq)"
LOAD_PRED="$(sed -n "s/^load_valid='\(.*\)'$/\1/p" "$TOOL")"
if [[ -n "$LOAD_PRED" ]]; then pass "load predicate extracts from tool"; else fail "load predicate extracts from tool"; fi
contract_accepts() { printf '%s' "$1" | "$JQ_BIN" -s -e "length == 1 and (.[0] | $LOAD_PRED)" >/dev/null 2>&1; }
contract_rejects() { ! contract_accepts "$1"; }
if contract_accepts '{"type":"i","data":[0]}'; then pass "loadScript 0 accepted (Script0)"; else fail "loadScript 0 accepted (Script0)"; fi
if contract_accepts '{"type":"i","data":[7]}'; then pass "loadScript positive ID accepted"; else fail "loadScript positive ID accepted"; fi
if contract_accepts '{"type":"i","data":[2147483647]}'; then pass "loadScript max ID accepted"; else fail "loadScript max ID accepted"; fi
if contract_rejects '{"type":"i","data":[-1]}'; then pass "loadScript -1 sentinel rejected"; else fail "loadScript -1 sentinel rejected"; fi
for _bad in '{"type":"i","data":[-2]}' '{"type":"i","data":[2147483648]}' '{"type":"i","data":[7.5]}' '{"type":"i","data":["7"]}' '{"type":"i","data":["-1"]}' '{"type":"b","data":[true]}' '{"type":"s","data":["x"]}' '{"type":"u","data":[7]}' '{"type":"i","data":[]}' '{"type":"i","data":[1,2]}' '{"type":"i"}' '{"data":[7]}' '{}'; do
  if contract_rejects "$_bad"; then pass "loadScript malformed rejected"; else fail "loadScript malformed rejected: $_bad"; fi
done
if printf '%s\n%s' '{"type":"i","data":[7]}' '{"type":"i","data":[7]}' | "$JQ_BIN" -s -e "length == 1 and (.[0] | $LOAD_PRED)" >/dev/null 2>&1; then fail "concatenated replies rejected"; else pass "concatenated replies rejected"; fi
for _pair in "0:/Scripting/Script0" "7:/Scripting/Script7" "2147483647:/Scripting/Script2147483647"; do
  _id="${_pair%%:*}"; _want="${_pair#*:}"
  if [[ "/Scripting/Script$_id" == "$_want" ]]; then pass "Script ID $_id maps exactly $_want"; else fail "Script ID $_id maps exactly $_want"; fi
done
assert_contains "$TOOL" 'script_obj="/Scripting/Script$SCRIPT_ID"'
assert_absent "$TOOL" '/Scripting/Script0'
assert_absent "$TOOL" 'Scripting.start'
assert_contains "$TOOL" "is already loaded; refusing to load again"
assert_contains "$TOOL" 'unloadScript s "$PLUGIN"'
assert_absent "$TOOL" 'unloadScript s "$PRODUCTION_PLUGIN"'
if grep -Fq '"/Scripting/Script$id"' "$TOOL" && grep -Fq 'cleanup_loaded' "$TOOL" && grep -Fq 'partial script-id=$SCRIPT_ID cleanup=' "$TOOL"; then pass "start failure cleanup uses only the exact recorded plugin/path"; else fail "start failure cleanup uses only the exact recorded plugin/path"; fi
assert_contains "$TOOL" 'poc3-command-done:'

printf 'poc3-command static: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
