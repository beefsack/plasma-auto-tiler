#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPO_ROOT/scripts/floor-ratio-feasibility.sh"
FIXTURE="$REPO_ROOT/test-fixtures/floor-ratio-evidence.json"
SCHEMA="$REPO_ROOT/test-fixtures/floor-ratio-evidence.schema.json"
MKTEMP_BIN="$(command -v mktemp)"
MKDIR_BIN="$(command -v mkdir)"
RM_BIN="$(command -v rm)"
CP_BIN="$(command -v cp)"
SED_BIN="$(command -v sed)"
GREP_BIN="$(command -v grep)"
LN_BIN="$(command -v ln)"
SLEEP_BIN="$(command -v sleep)"
WORK="$($MKTEMP_BIN -d)"
FAKE_BIN="$WORK/fake-bin"
OUTPUT="$WORK/output"
CALLS="$WORK/forbidden-calls.log"
PASS=0
FAILURES=0
EXIT=0

cleanup() {
  "$RM_BIN" -rf -- "$WORK"
}
trap cleanup EXIT

assert_exit() {
  local expected="$1"
  if [[ "$EXIT" -eq "$expected" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: expected exit %s, got %s\n' "$expected" "$EXIT" >&2; FAILURES=$((FAILURES + 1)); fi
}

assert_contains() {
  local needle="$1"
  if [[ -f "$OUTPUT" ]] && "$GREP_BIN" -Fq "$needle" "$OUTPUT"; then PASS=$((PASS + 1)); else printf 'FAIL: output lacks %s\n' "$needle" >&2; FAILURES=$((FAILURES + 1)); fi
}

assert_not_exists() {
  if [[ ! -e "$1" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: unexpected path %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); fi
}

assert_file() {
  if [[ -f "$1" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: missing %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); fi
}

assert_value() {
  if [[ "$1" == "$2" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: %s (expected %s, got %s)\n' "$3" "$1" "$2" >&2; FAILURES=$((FAILURES + 1)); fi
}

make_fake() {
  local name="$1"
  printf '#!/usr/bin/env bash\nprintf "forbidden:%s\\n" "$0" >> "%s"\nexit 99\n' "$name" "$CALLS" > "$FAKE_BIN/$name"
  chmod +x "$FAKE_BIN/$name"
}

run_runner() {
  set +e
  TMPDIR="$WORK/tmp" PATH="$FAKE_BIN:$PATH" HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/xdg-config" XDG_DATA_HOME="$WORK/xdg-data" XDG_RUNTIME_DIR="$WORK/xdg-runtime" \
    bash "$RUNNER" "$@" > "$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

assert_trace() {
  local evidence="$1" vector="$2" decode_count expected_count expected_stop
  local -a trace expected states
  if [[ ! -f "$evidence/operation-trace.log" ]]; then
    printf 'FAIL: missing operation trace for %s\n' "$vector" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi
  mapfile -t trace < "$evidence/operation-trace.log"
  case "$vector" in
    single-ancestor-write)
      expected=("fresh-decode:baseline:current-fallback" "plan:ancestor-1" "write:ancestor-1" "fresh-decode:after-write:ancestor-1:ratio-1-2" "stop-reason:vector-complete" "cleanup:stop-child" "cleanup:restore-persistence" "cleanup:remove-private-roots" "cleanup:retain-evidence")
      states=("decode-1:baseline:current-fallback" "decode-2:after-write:ancestor-1:ratio-1-2")
      expected_stop=vector-complete
      ;;
    multi-ancestor-writes)
      expected=("fresh-decode:baseline:current-fallback" "plan:ancestor-1" "plan:ancestor-2" "write:ancestor-1" "fresh-decode:after-write:ancestor-1:ratio-1-2" "write:ancestor-2" "fresh-decode:after-write:ancestor-2:ratio-1-3" "stop-reason:vector-complete" "cleanup:stop-child" "cleanup:restore-persistence" "cleanup:remove-private-roots" "cleanup:retain-evidence")
      states=("decode-1:baseline:current-fallback" "decode-2:after-write:ancestor-1:ratio-1-2" "decode-3:after-write:ancestor-2:ratio-1-3")
      expected_stop=vector-complete
      ;;
    impossible-allocation-retaining-current-fallback)
      expected=("fresh-decode:baseline:current-fallback" "plan:allocation" "fallback-retained:current-fallback" "stop-reason:impossible-allocation" "cleanup:stop-child" "cleanup:restore-persistence" "cleanup:remove-private-roots" "cleanup:retain-evidence")
      states=("decode-1:baseline:current-fallback")
      expected_stop=impossible-allocation
      ;;
    post-write-mismatch-refusal)
      expected=("fresh-decode:baseline:current-fallback" "plan:ancestor-1" "write:ancestor-1" "fresh-decode:after-write:ancestor-1:mismatch" "refuse:no-split-no-reverse-write" "stop-reason:post-write-mismatch" "cleanup:stop-child" "cleanup:restore-persistence" "cleanup:remove-private-roots" "cleanup:retain-evidence")
      states=("decode-1:baseline:current-fallback" "decode-2:after-write:ancestor-1:mismatch")
      expected_stop=post-write-mismatch
      ;;
  esac
  if [[ "${trace[*]}" == "${expected[*]}" && "${#trace[@]}" -eq "${#expected[@]}" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: operation trace mismatch for %s\n' "$vector" >&2; FAILURES=$((FAILURES + 1)); fi
  assert_value "stop-reason:$expected_stop" "${trace[-5]}" "$vector records its case-specific stop reason"
  decode_count="$(<"$evidence/decode.count")"
  expected_count="${#states[@]}"
  if [[ "$decode_count" -eq "$expected_count" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: decode count mismatch for %s\n' "$vector" >&2; FAILURES=$((FAILURES + 1)); fi
  local index=1
  for state in "${states[@]}"; do
    if [[ -f "$evidence/decode.$index" && "$(<"$evidence/decode.$index")" == "$state" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: decode content mismatch for %s #%s\n' "$vector" "$index" >&2; FAILURES=$((FAILURES + 1)); fi
    index=$((index + 1))
  done
}

run_signal_case() {
  local signal="$1" expected_status="$2" pid status ready
  local signal_tmp="$WORK/signal-$signal" signal_output="$WORK/signal-$signal.output"
  local -a ready_paths evidence_paths
  "$MKDIR_BIN" -p "$signal_tmp"
  set -m
  (
    export TMPDIR="$signal_tmp" PATH="$FAKE_BIN:$PATH" HOME="$WORK/home" FLOOR_RATIO_STATIC_TEST_PAUSE=1
    exec bash -c 'trap - INT; exec bash "$1" static-self-test' _ "$RUNNER"
  ) > "$signal_output" 2>&1 &
  pid=$!
  set +m
  for _ in {1..200}; do
    shopt -s nullglob
    ready_paths=("$signal_tmp"/floor-ratio-static.*/private-static-nonce/static-signal-ready)
    shopt -u nullglob
    if [[ "${#ready_paths[@]}" -eq 1 ]]; then ready="${ready_paths[0]}"; break; fi
     "$SLEEP_BIN" 0.01
  done
  if [[ -n "${ready:-}" ]]; then
    builtin kill -"$signal" "$pid"
    set +e
    wait "$pid"
    status=$?
    set -e
  else
    builtin kill TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    status=124
  fi
  EXIT=$status
  OUTPUT="$signal_output"
  assert_exit "$expected_status"
  assert_contains 'static evidence retained at:'
  shopt -s nullglob
  evidence_paths=("$signal_tmp"/floor-ratio-static.*/private-static-nonce/evidence/interrupted-run)
  shopt -u nullglob
  if [[ "${#evidence_paths[@]}" -eq 1 && -f "${evidence_paths[0]}/retained-evidence" && -f "${evidence_paths[0]}/operation-trace.log" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: %s evidence was not retained\n' "$signal" >&2; FAILURES=$((FAILURES + 1)); fi
  if [[ -n "${evidence_paths[0]:-}" ]]; then
    assert_value "stop-reason=signal-$signal" "$(<"${evidence_paths[0]}/retained-evidence")" "$signal cleanup reason"
    assert_cleanup_order_for_signal "${evidence_paths[0]}" "$signal"
    assert_not_exists "${evidence_paths[0]}/disposable"
  fi
}

run_early_signal_case() {
  local signal="$1" expected_status="$2" status
  local signal_tmp="$WORK/early-signal-$signal" signal_output="$WORK/early-signal-$signal.output"
  local -a evidence_paths
  "$MKDIR_BIN" -p "$signal_tmp"
  set +e
  FLOOR_RATIO_STATIC_TEST_EARLY_SIGNAL="$signal" TMPDIR="$signal_tmp" PATH="$FAKE_BIN:$PATH" HOME="$WORK/home" \
    bash "$RUNNER" static-self-test > "$signal_output" 2>&1
  status=$?
  set -e
  EXIT=$status
  OUTPUT="$signal_output"
  assert_exit "$expected_status"
  shopt -s nullglob
  evidence_paths=("$signal_tmp"/floor-ratio-static.*/private-static-nonce/evidence/interrupted-run)
  shopt -u nullglob
  if [[ "${#evidence_paths[@]}" -eq 1 ]]; then
    local evidence="${evidence_paths[0]}"
    assert_contains "static evidence retained at: $evidence"
    assert_value 'vector=interrupted-run' "$(<"$evidence/vector")" "$signal early evidence identifies the interrupted vector"
    assert_file "$evidence/retained-evidence" "$signal early evidence is retained"
    assert_file "$evidence/operation-trace.log" "$signal early operation trace is retained"
    assert_cleanup_order_for_signal "$evidence" "$signal"
    assert_not_exists "$evidence/disposable"
  else
    printf 'FAIL: %s early evidence was not retained\n' "$signal" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

assert_cleanup_order_for_signal() {
  local evidence="$1" signal="$2" expected="stop-reason:signal-$signal cleanup:stop-child cleanup:restore-persistence cleanup:remove-private-roots cleanup:retain-evidence" trace
  trace="$(tr '\n' ' ' < "$evidence/operation-trace.log" | sed 's/ $//')"
  if [[ "$trace" == "$expected" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: %s cleanup order is not exact\n' "$signal" >&2; FAILURES=$((FAILURES + 1)); fi
}

"$MKDIR_BIN" -p "$FAKE_BIN" "$WORK/tmp" "$WORK/home/.config" "$WORK/xdg-config" "$WORK/xdg-data" "$WORK/xdg-runtime"
printf 'host-config-sentinel\n' > "$WORK/home/.config/kwinrc"
printf 'host-xdg-sentinel\n' > "$WORK/xdg-config/kwinrc"
for fake in kwin_wayland busctl journalctl dbus-send qdbus kwriteconfig6 systemctl loginctl pgrep kill mkdir mktemp rm sleep ln dirname cat; do make_fake "$fake"; done

# The only static command is hermetic and reaches no fake host-facing tool.
run_runner static-self-test
assert_exit 0
assert_contains 'static-self-test: vectors=4'
assert_contains 'static-contract-fixture: no proof executed'
assert_contains 'future authorized live implementation must enforce'
assert_contains 'passes:'
assert_not_exists "$WORK/home/.config/kwinrc.mutated"
if [[ ! -s "$CALLS" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: static self-test invoked a forbidden command\n' >&2; FAILURES=$((FAILURES + 1)); fi
if [[ "$(<"$WORK/home/.config/kwinrc")" == 'host-config-sentinel' ]]; then PASS=$((PASS + 1)); else printf 'FAIL: host config sentinel changed\n' >&2; FAILURES=$((FAILURES + 1)); fi

# Help and missing-argument routes must not resolve cat through PATH or a shell function.
cat() {
  printf 'forbidden:function-cat\n' >> "$CALLS"
  return 99
}
export -f cat
run_runner
assert_exit 1
assert_contains 'usage:'
run_runner --help
assert_exit 0
assert_contains 'usage:'
if [[ ! -s "$CALLS" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: help routes executed PATH/function cat\n' >&2; FAILURES=$((FAILURES + 1)); fi
unset -f cat

# A symlinked TMPDIR is rejected before a nonce root is created.
"$LN_BIN" -s "$WORK/tmp" "$WORK/symlink-tmp"
set +e
TMPDIR="$WORK/symlink-tmp" PATH="$FAKE_BIN:$PATH" HOME="$WORK/home" \
  bash "$RUNNER" static-self-test > "$OUTPUT" 2>&1
EXIT=$?
set -e
assert_exit 1
assert_contains 'TMPDIR must be an existing, non-symlinked absolute directory'
if [[ "$(<"$WORK/home/.config/kwinrc")" == 'host-config-sentinel' ]]; then PASS=$((PASS + 1)); else printf 'FAIL: symlinked TMPDIR changed the sentinel\n' >&2; FAILURES=$((FAILURES + 1)); fi

# A forced static failure retains the nonce-owned evidence while its disposable
# private roots are not silently removed.
set +e
FLOOR_RATIO_FORCE_STATIC_FAILURE=1 TMPDIR="$WORK/tmp" PATH="$FAKE_BIN:$PATH" HOME="$WORK/home" \
  bash "$RUNNER" static-self-test > "$OUTPUT" 2>&1
EXIT=$?
set -e
assert_exit 1
assert_contains 'static evidence retained at:'
shopt -s nullglob
retained=("$WORK"/tmp/floor-ratio-static.*/private-static-nonce/evidence)
if [[ "${#retained[@]}" -eq 1 && -f "${retained[0]}/single-ancestor-write/retained-evidence" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: forced static failure did not retain evidence\n' >&2; FAILURES=$((FAILURES + 1)); fi
if [[ "${#retained[@]}" -eq 1 ]]; then
  for vector in single-ancestor-write multi-ancestor-writes impossible-allocation-retaining-current-fallback post-write-mismatch-refusal; do
    assert_trace "${retained[0]}/$vector" "$vector"
  done
fi

run_signal_case INT 130
run_signal_case TERM 143
run_early_signal_case INT 130
run_early_signal_case TERM 143

# Strict static command and help parsing.
run_runner
assert_exit 1
assert_contains 'usage:'
run_runner static-self-test extra
assert_exit 1
assert_contains 'takes no arguments'
run_runner --help extra
assert_exit 1
assert_contains 'help takes no arguments'
run_runner unknown
assert_exit 1
assert_contains 'unknown command or unsupported static command'

# The exact future gate is still refusal-only; malformed or injected vectors
# fail before the refusal body and never cause command execution.
run_runner live-proof --case not-a-vector --mutation-authorized=FLOOR-RATIO-NESTED-LIVE-PROOF-V1
assert_exit 1
assert_contains 'requires exactly'
run_runner live-proof --case single-ancestor-write --mutation-authorized=wrong
assert_exit 1
assert_contains 'requires exactly'
run_runner live-proof --case 'single-ancestor-write;touch-injected' --mutation-authorized=FLOOR-RATIO-NESTED-LIVE-PROOF-V1
assert_exit 1
assert_contains 'requires exactly'
run_runner live-proof --case 'single-ancestor-write$(touch-injected)' --mutation-authorized=FLOOR-RATIO-NESTED-LIVE-PROOF-V1
assert_exit 1
assert_contains 'requires exactly'
run_runner live-proof --case single-ancestor-write --mutation-authorized=FLOOR-RATIO-NESTED-LIVE-PROOF-V1
assert_exit 1
assert_contains 'refusing execution: live-proof is documentation-only'
assert_contains 'additional authorization'
assert_contains 'no dependencies or capabilities were checked, and no proof passed'
if "$GREP_BIN" -Fq 'requires exactly' "$OUTPUT"; then printf 'FAIL: valid authorization also reported invalid arguments\n' >&2; FAILURES=$((FAILURES + 1)); else PASS=$((PASS + 1)); fi
if [[ ! -s "$CALLS" ]]; then PASS=$((PASS + 1)); else printf 'FAIL: live-proof refusal reached a forbidden command\n' >&2; FAILURES=$((FAILURES + 1)); fi

# The source has no executable invocation of live tools or host mutation tools.
if "$GREP_BIN" -nE '(^|[[:space:]])(kwin_wayland|busctl|journalctl|dbus-send|qdbus|kwriteconfig6|systemctl|loginctl|pgrep)([[:space:]]|$)' "$RUNNER" >/dev/null 2>&1; then
  printf 'FAIL: runner contains a forbidden command invocation\n' >&2
  FAILURES=$((FAILURES + 1))
else
  PASS=$((PASS + 1))
fi

# Validate the fixture with only Python's standard-library JSON parser. The
# embedded validator implements every keyword used by this schema, then checks
# the causal vector, trace, and private-path invariants explicitly.
validate_fixture() {
  python3 - "$SCHEMA" "$1" <<'PY'
import json
import posixpath
import re
import sys


class ValidationError(Exception):
    pass


def load_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValidationError(f"{path}: duplicate key {key}")
            result[key] = value
        return result

    try:
        with open(path, encoding="ascii") as stream:
            return json.load(stream, object_pairs_hook=pairs)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"{path}: invalid JSON: {error}") from error


def resolve(root, reference):
    if not reference.startswith("#/"):
        raise ValidationError(f"unsupported reference {reference}")
    value = root
    for part in reference[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def is_type(value, name):
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    raise ValidationError(f"unsupported schema type {name}")


def json_equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(json_equal(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    return left == right


def validate(value, schema, root, path="$", seen=None):
    if seen is None:
        seen = set()
    if "$ref" in schema:
        reference = schema["$ref"]
        marker = (id(value), reference)
        if marker in seen:
            return
        seen.add(marker)
        validate(value, resolve(root, reference), root, path, seen)
    if "const" in schema and not json_equal(value, schema["const"]):
        raise ValidationError(f"{path}: expected const {schema['const']!r}")
    if "enum" in schema and not any(json_equal(value, option) for option in schema["enum"]):
        raise ValidationError(f"{path}: value is not in enum")
    if "type" in schema and not is_type(value, schema["type"]):
        raise ValidationError(f"{path}: expected {schema['type']}")
    for subschema in schema.get("allOf", []):
        validate(value, subschema, root, path, seen.copy())
    if "contains" in schema:
        matches = 0
        for index, item in enumerate(value):
            try:
                validate(item, schema["contains"], root, f"{path}[{index}]", seen.copy())
            except ValidationError:
                continue
            matches += 1
        if matches < schema.get("minContains", 1) or matches > schema.get("maxContains", matches):
            raise ValidationError(f"{path}: contains count {matches} is outside the required range")
    if isinstance(value, dict):
        required = schema.get("required", [])
        missing = [key for key in required if key not in value]
        if missing:
            raise ValidationError(f"{path}: missing {missing}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(value) - set(properties))
            if unknown:
                raise ValidationError(f"{path}: unknown fields {unknown}")
        for key, subschema in properties.items():
            if key in value:
                validate(value[key], subschema, root, f"{path}.{key}", seen.copy())
    elif isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", len(value)):
            raise ValidationError(f"{path}: invalid item count")
        if "items" in schema:
            for index, item in enumerate(value):
                validate(item, schema["items"], root, f"{path}[{index}]", seen.copy())
    elif isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            raise ValidationError(f"{path}: string is too short")
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            raise ValidationError(f"{path}: string does not match pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            raise ValidationError(f"{path}: number is outside range")


def descendant(base, candidate):
    return candidate.startswith("/") and posixpath.normpath(candidate) == candidate and candidate.startswith(base + "/")


def check_semantics(data):
    expected_cases = [
        "single-ancestor-write",
        "multi-ancestor-writes",
        "impossible-allocation-retaining-current-fallback",
        "post-write-mismatch-refusal",
    ]
    expected = {
        "single-ancestor-write": {
            "fresh": ["decode-before", "decode-after-ancestor-1"],
            "plans": [{"target": "ancestor-1", "operation": "write", "value": "ratio-1-2"}],
            "writes": [{"target": "ancestor-1", "value": "ratio-1-2", "decode_after": "decode-after-ancestor-1"}],
            "result": "planned",
            "stop": "vector-complete",
            "trace": ["fresh-decode:baseline:current-fallback", "plan:ancestor-1", "write:ancestor-1", "fresh-decode:after-write:ancestor-1:ratio-1-2", "stop-reason:vector-complete", "cleanup:stop-child", "cleanup:restore-persistence", "cleanup:remove-private-roots", "cleanup:retain-evidence"],
        },
        "multi-ancestor-writes": {
            "fresh": ["decode-before", "decode-after-ancestor-1", "decode-after-ancestor-2"],
            "plans": [{"target": "ancestor-1", "operation": "write", "value": "ratio-1-2"}, {"target": "ancestor-2", "operation": "write", "value": "ratio-1-3"}],
            "writes": [{"target": "ancestor-1", "value": "ratio-1-2", "decode_after": "decode-after-ancestor-1"}, {"target": "ancestor-2", "value": "ratio-1-3", "decode_after": "decode-after-ancestor-2"}],
            "result": "planned",
            "stop": "vector-complete",
            "trace": ["fresh-decode:baseline:current-fallback", "plan:ancestor-1", "plan:ancestor-2", "write:ancestor-1", "fresh-decode:after-write:ancestor-1:ratio-1-2", "write:ancestor-2", "fresh-decode:after-write:ancestor-2:ratio-1-3", "stop-reason:vector-complete", "cleanup:stop-child", "cleanup:restore-persistence", "cleanup:remove-private-roots", "cleanup:retain-evidence"],
        },
        "impossible-allocation-retaining-current-fallback": {
            "fresh": ["decode-before"],
            "plans": [{"target": "allocation", "operation": "allocate", "value": "impossible"}],
            "writes": [],
            "result": "fallback-retained",
            "stop": "impossible-allocation",
            "trace": ["fresh-decode:baseline:current-fallback", "plan:allocation", "fallback-retained:current-fallback", "stop-reason:impossible-allocation", "cleanup:stop-child", "cleanup:restore-persistence", "cleanup:remove-private-roots", "cleanup:retain-evidence"],
        },
        "post-write-mismatch-refusal": {
            "fresh": ["decode-before", "decode-after-ancestor-1"],
            "plans": [{"target": "ancestor-1", "operation": "write", "value": "ratio-candidate"}],
            "writes": [{"target": "ancestor-1", "value": "ratio-candidate", "decode_after": "decode-after-ancestor-1"}],
            "result": "refused",
            "stop": "post-write-mismatch",
            "trace": ["fresh-decode:baseline:current-fallback", "plan:ancestor-1", "write:ancestor-1", "fresh-decode:after-write:ancestor-1:mismatch", "refuse:no-split-no-reverse-write", "stop-reason:post-write-mismatch", "cleanup:stop-child", "cleanup:restore-persistence", "cleanup:remove-private-roots", "cleanup:retain-evidence"],
        },
    }
    if data["artifact_type"] != "static-contract-fixture" or data["evidence_status"] != "not-live-evidence" or data["proof_executed"] is not False or data["evidence_authenticity"] != "not-asserted":
        raise ValidationError("fixture is not explicitly static and non-authentic")
    if data["schema_version"] != "floor-ratio-static-contract-fixture-v2" or data["nonce"] != "static-floor-ratio-20260901":
        raise ValidationError("fixture identity is not the static contract")
    if [vector["case"] for vector in data["vectors"]] != expected_cases:
        raise ValidationError("vectors are not the exact four cases in order")
    if data["static_execution"] != {"proof_executed": False, "live_execution": False, "attempt_maximum": 1, "attempts_used": 0}:
        raise ValidationError("attempt contract is not static and single-attempt")
    requirements = data["future_live_requirements"]
    if requirements["vector_cases"] != expected_cases or requirements["child_processes"] != 1:
        raise ValidationError("future-live requirement names or one-child gate changed")
    if data["future_live_evidence_shape"]["status"] != "shape-and-requirements-only":
        raise ValidationError("future-live capture was presented as an observation")
    if data["future_live_requirements"]["dependency_capability_check"] != "must-be-checked-by-authorized-live-run":
        raise ValidationError("dependency and capability checks were presented as static observations")
    required_capture = data["future_live_evidence_shape"]["required_capture_fields"]
    if required_capture != ["runtime_capture_hashes", "child_pid_identity", "child_process_count", "journal_cursor", "journal_scope", "persistence_hash_before_after", "persistence_mtime_before_after", "private_roots"]:
        raise ValidationError("future-live capture requirements changed")
    if data["cleanup_order"] != ["stop-child", "restore-persistence", "remove-private-roots", "retain-evidence"]:
        raise ValidationError("cleanup order changed")
    roots = data["private_roots"]
    base = roots["base"]
    if re.fullmatch(r"/tmp/floor-ratio-static\.[A-Za-z0-9X]{6}/private-static-nonce", base) is None:
        raise ValidationError("base does not use the runner's mktemp path convention")
    expected_paths = {
        "evidence": base + "/evidence",
        "xdg_config_home": base + "/xdg/config",
        "xdg_data_home": base + "/xdg/data",
        "xdg_runtime_dir": base + "/xdg/runtime",
        "wayland_socket": base + "/xdg/runtime/wayland-parent.sock",
        "session_bus": base + "/xdg/runtime/bus.sock",
    }
    owned = [roots[key] for key in expected_paths]
    if len(set(owned)) != len(owned) or any(not descendant(base, path) for path in owned):
        raise ValidationError("private evidence/XDG/socket/bus paths are not distinct descendants")
    if any(roots[key] != path for key, path in expected_paths.items()):
        raise ValidationError("private paths do not match the declared convention")
    allowlist = data["operation_allowlist"]
    for vector in data["vectors"]:
        case = vector["case"]
        contract = expected[case]
        if vector["fresh_decode_sequence"] != contract["fresh"] or vector["plans"] != contract["plans"] or vector["writes"] != contract["writes"]:
            raise ValidationError(f"{case}: vector data does not match the causal model")
        if vector["result"] != contract["result"] or vector["stop_reason"] != contract["stop"] or vector["operation_trace"] != contract["trace"]:
            raise ValidationError(f"{case}: result or complete operation trace does not match")
        if any(operation not in allowlist for operation in vector["operation_trace"]):
            raise ValidationError(f"{case}: operation is outside the explicit allowlist")
        if any(operation.startswith(("split:", "reverse:")) for operation in vector["operation_trace"]):
            raise ValidationError(f"{case}: split or reverse operation observed")
        if vector["fresh_decode_sequence"] != ["decode-before"] + [write["decode_after"] for write in vector["writes"]]:
            raise ValidationError(f"{case}: every write lacks its distinct following fresh decode")
        for write in vector["writes"]:
            write_operation = "write:" + write["target"]
            write_index = vector["operation_trace"].index(write_operation)
            decode_operation = vector["operation_trace"][write_index + 1]
            if not decode_operation.startswith("fresh-decode:after-write:" + write["target"] + ":"):
                raise ValidationError(f"{case}: write is not immediately followed by its fresh decode")


try:
    schema = load_json(sys.argv[1])
    fixture = load_json(sys.argv[2])
    validate(fixture, schema, schema)
    check_semantics(fixture)
except (ValidationError, KeyError, TypeError, ValueError) as error:
    print(f"fixture validation failed: {error}", file=sys.stderr)
    sys.exit(1)
PY
}

if validate_fixture "$FIXTURE"; then PASS=$((PASS + 1)); else printf 'FAIL: strict schema/semantic fixture validation failed\n' >&2; FAILURES=$((FAILURES + 1)); fi
UNKNOWN_FIXTURE="$WORK/unknown-fixture.json"
MISSING_FIXTURE="$WORK/missing-fixture.json"
ESCAPED_FIXTURE="$WORK/escaped-fixture.json"
cp "$FIXTURE" "$UNKNOWN_FIXTURE"
cp "$FIXTURE" "$MISSING_FIXTURE"
cp "$FIXTURE" "$ESCAPED_FIXTURE"
sed -i '2i\  "unexpected": true,' "$UNKNOWN_FIXTURE"
sed -i '/^  "nonce":/d' "$MISSING_FIXTURE"
sed -i 's#"session_bus": "/tmp/floor-ratio-static.XXXXXX/private-static-nonce/xdg/runtime/bus.sock"#"session_bus": "/tmp/escaped-bus.sock"#' "$ESCAPED_FIXTURE"
if validate_fixture "$UNKNOWN_FIXTURE"; then printf 'FAIL: unknown fixture field was accepted\n' >&2; FAILURES=$((FAILURES + 1)); else PASS=$((PASS + 1)); fi
if validate_fixture "$MISSING_FIXTURE"; then printf 'FAIL: missing fixture field was accepted\n' >&2; FAILURES=$((FAILURES + 1)); else PASS=$((PASS + 1)); fi
if validate_fixture "$ESCAPED_FIXTURE"; then printf 'FAIL: escaping fixture path was accepted\n' >&2; FAILURES=$((FAILURES + 1)); else PASS=$((PASS + 1)); fi

printf 'passes: %s failures: %s\n' "$PASS" "$FAILURES"
[[ "$FAILURES" -eq 0 ]]
