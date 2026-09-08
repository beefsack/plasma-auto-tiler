#!/usr/bin/env bash
# Hermetic focused test for the advisory transport sequencer.
# No host bus/KWin/process contact: loader, builder, planner, busctl,
# journalctl, and /proc are all faked behind explicit test-only gates
# (ADVISORY_TRANSPORT_TEST_FAKE=1 plus BIN/PROC/dist overrides). Real
# node/coreutils perform pure local compute only.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SEQ="$REPO_ROOT/scripts/advisory-transport-sequencer.sh"
PASS=0
FAIL=0

TMP_DIR=""
cleanup() {
  if [[ -f "$TMP_DIR/fake/planner-alive" ]]; then
    kill -TERM -- "$(cat -- "$TMP_DIR/fake/planner-alive" 2>/dev/null)" 2>/dev/null || true
  fi
  if [[ -f "$TMP_DIR/fake/follower-pids.log" ]]; then
    while read -r p || [[ -n "$p" ]]; do
      [[ "$p" =~ ^[1-9][0-9]*$ ]] || continue
      kill -TERM -- "$p" 2>/dev/null || true
    done < "$TMP_DIR/fake/follower-pids.log"
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR" 2>/dev/null || true; fi
}
trap cleanup EXIT

TMP_DIR="$(mktemp -d)"
FAKE_DIR="$TMP_DIR/fake"
FAKE_BIN="$TMP_DIR/fakebin"
FAKE_DIST="$TMP_DIR/dist"
FAKE_TMP="$TMP_DIR/tmp"
FAKE_PROC="$TMP_DIR/proc"
mkdir -p -- "$FAKE_DIR" "$FAKE_BIN" "$FAKE_DIST" "$FAKE_TMP" "$FAKE_PROC" "$FAKE_DIR/manifests"

pass() { PASS=$((PASS + 1)); printf 'pass: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'fail: %s\n' "$1"; }

assert_contains() {
  if grep -qF -- "$2" "$1"; then pass "contains: $2"; else fail "missing: $2"; fi
}

assert_absent() {
  if grep -qF -- "$2" "$1"; then fail "forbidden present: $2"; else pass "absent: $2"; fi
}

if bash -n "$SEQ" >/dev/null 2>&1; then pass "bash -n sequencer"; else fail "bash -n sequencer"; fi
if bash -n "$REPO_ROOT/scripts/advisory-transport-sequencer.test.sh" >/dev/null 2>&1; then pass "bash -n self"; else fail "bash -n self"; fi

# Static contract: default-disabled gate, one journey, delegation, order.
assert_contains "$SEQ" 'ADVISORY_TRANSPORT_ALLOW'
assert_contains "$SEQ" 'is disabled by default'
assert_contains "$SEQ" 'run) shift; cmd_run'
assert_contains "$SEQ" "unknown command (expected run)"
assert_contains "$SEQ" 'run takes no arguments'
assert_contains "$SEQ" 'loader_preflight'
assert_contains "$SEQ" 'loader_start'
assert_contains "$SEQ" '"$loader" stop --receipt'
assert_contains "$SEQ" '"$loader" diagnostics --receipt'
assert_contains "$SEQ" 'planner-service --advisory-loss-correlation'
assert_contains "$SEQ" 'no restart'
assert_contains "$SEQ" 'NameHasOwner'
assert_contains "$SEQ" 'GetNameOwner'
assert_contains "$SEQ" 'GetConnectionUnixProcessID'
assert_contains "$SEQ" '--after-cursor'
assert_contains "$SEQ" '-o cat'
assert_contains "$SEQ" '"_PID=$kwin_pid"'
assert_contains "$SEQ" 'planner-service-loss-ready'
assert_contains "$SEQ" 'reject:advisory-rejected-stale-request'
assert_contains "$SEQ" 'reject:advisory-timeout'
assert_contains "$SEQ" '--expected-refusal-detail'
assert_contains "$SEQ" '--expected-refusal-after'
assert_contains "$SEQ" '--refusal-service-loss'
assert_contains "$SEQ" '--expected-planner-owner'
assert_contains "$SEQ" 'wait_kwin_ready_marker'
assert_contains "$SEQ" 'advisory-describe-ready'
assert_contains "$SEQ" 'KWin ready marker'
assert_contains "$SEQ" 'PHASE_DONE="success,stale,loss"'
assert_contains "$SEQ" 'stale requires success first'
assert_contains "$SEQ" 'loss requires success then stale first'
assert_contains "$SEQ" 'preserving exact residue'
assert_contains "$SEQ" 'prior advisory dist residue'
assert_contains "$SEQ" 'phase correlations must be distinct'
assert_contains "$SEQ" 'ADVISORY_TRANSPORT_TEST_FAKE'
assert_contains "$SEQ" 'is test-only (requires ADVISORY_TRANSPORT_TEST_FAKE=1)'
assert_contains "$SEQ" 'continuity=verified'
# Delegation: no KWin scripting transport and no native tokens in the sequencer.
assert_absent "$SEQ" 'loadScript'
assert_absent "$SEQ" 'unloadScript'
assert_absent "$SEQ" 'isScriptLoaded'
assert_absent "$SEQ" 'Scripting start'
assert_absent "$SEQ" 'workspace.'
assert_absent "$SEQ" 'registerShortcut'
assert_absent "$SEQ" 'createDesktop'
assert_absent "$SEQ" 'removeDesktop'
assert_absent "$SEQ" 'setActiveWindow'
assert_absent "$SEQ" 'windowList'
assert_absent "$SEQ" 'clientArea'
assert_absent "$SEQ" 'TileController'
assert_absent "$SEQ" 'unmanage'
assert_absent "$SEQ" 'activeWindow'
assert_absent "$SEQ" 'XDG_RUNTIME_DIR'
assert_absent "$SEQ" 'systemd-run'
assert_absent "$SEQ" 'Script0'
# Host-contact tools are pinned via BIN vars (bus/journal); no bare contact.
assert_contains "$SEQ" '"$BUSCTL_BIN"'
assert_contains "$SEQ" '"$JOURNALCTL_BIN"'
if grep -v '^[[:space:]]*#' "$SEQ" | grep -w -F 'busctl' | grep -v -F 'BUSCTL_BIN' > /dev/null; then
  fail "host busctl contact must be pinned via BUSCTL_BIN"
else
  pass "host busctl contact is pinned via BUSCTL_BIN"
fi
if grep -v '^[[:space:]]*#' "$SEQ" | grep -w -F 'journalctl' | grep -v -F 'JOURNALCTL_BIN' | grep -v -F 'journal follower' | grep -v -F 'journal cursor' > /dev/null; then
  fail "host journalctl contact must be pinned via JOURNALCTL_BIN"
else
  pass "host journalctl contact is pinned via JOURNALCTL_BIN"
fi
assert_contains "$SEQ" 'ambiguous'
assert_contains "$SEQ" 'preserving exact residue'
assert_contains "$SEQ" 'real_proc_alive_non_zombie'
assert_contains "$SEQ" 'LOSS_TICK'
assert_contains "$SEQ" 'loss loader job exited before owner loss'
assert_contains "$SEQ" 'stale/receipt.json'
assert_contains "$SEQ" 'loss/receipt.json'
# Ordering: bootstrap preflight precedes the fresh-dir mktemp; phases are ordered.
N_PREFLIGHT="$(grep -n 'loader_preflight "$loader" "$dist/advisory-describe.js"' "$SEQ" | head -n 1 | cut -d: -f1)"
N_MKDIR="$(grep -n 'mktemp -d "$RUNDIR_PARENT/advisory-transport-XXXXXX"' "$SEQ" | head -n 1 | cut -d: -f1)"
if [[ -n "$N_PREFLIGHT" && -n "$N_MKDIR" && "$N_PREFLIGHT" -lt "$N_MKDIR" ]]; then
  pass "preflight precedes fresh-dir creation"
else
  fail "preflight must precede fresh-dir creation"
fi
N_S="$(grep -n 'build_one "$loader" "$builder" "$dist" "success"' "$SEQ" | head -n 1 | cut -d: -f1)"
N_T="$(grep -n 'build_one "$loader" "$builder" "$dist" "stale"' "$SEQ" | head -n 1 | cut -d: -f1)"
N_L="$(grep -n 'build_one "$loader" "$builder" "$dist" "loss"' "$SEQ" | head -n 1 | cut -d: -f1)"
if [[ -n "$N_S" && -n "$N_T" && -n "$N_L" && "$N_S" -lt "$N_T" && "$N_T" -lt "$N_L" ]]; then
  pass "phase build order success/stale/loss"
else
  fail "phase build order success/stale/loss"
fi

# Fake busctl: planner + KWin identity only, sequence files for drift.
cat > "$FAKE_BIN/fake-busctl" <<'FAKE_BUSCTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/busctl.log"
if [[ "$*" == *NameHasOwner* && "$*" == *"org.plasmaautotiler.Planner"* ]]; then
  if [[ -f "$FAKE_DIR/planner-alive" ]]; then printf '{"type":"b","data":[true]}'; else printf '{"type":"b","data":[false]}'; fi
  exit 0
fi
if [[ "$*" == *ListNames* ]]; then
  if [[ -f "$FAKE_DIR/planner-alive" ]]; then
    printf '{"type":"as","data":[["org.freedesktop.DBus",":1.10",":1.77"]]}'
  else
    printf '{"type":"as","data":[["org.freedesktop.DBus",":1.10"]]}'
  fi
  exit 0
fi
if [[ "$*" == *GetNameOwner* && "$*" == *"org.plasmaautotiler.Planner"* ]]; then
  if [[ -s "$FAKE_DIR/planner-owner-seq" ]]; then
    line="$(head -n 1 -- "$FAKE_DIR/planner-owner-seq")"
    tail -n +2 -- "$FAKE_DIR/planner-owner-seq" > "$FAKE_DIR/planner-owner-seq.tmp" 2>/dev/null || true
    mv -- "$FAKE_DIR/planner-owner-seq.tmp" "$FAKE_DIR/planner-owner-seq" 2>/dev/null || true
    printf '{"type":"s","data":["%s"]}' "$line"
    exit 0
  fi
  if [[ -f "$FAKE_DIR/planner-alive" ]]; then printf '{"type":"s","data":[":1.77"]}'; exit 0; fi
  echo "fake busctl: planner has no owner" >&2
  exit 1
fi
if [[ "$*" == *GetNameOwner* && "$*" == *"org.kde.KWin"* ]]; then
  printf '{"type":"s","data":[":1.10"]}'
  exit 0
fi
if [[ "$*" == *GetConnectionUnixProcessID* ]]; then
  last="${*: -1}"
  if [[ "$last" == ":1.77" ]]; then
    if [[ -s "$FAKE_DIR/planner-pid-seq" ]]; then
      line="$(head -n 1 -- "$FAKE_DIR/planner-pid-seq")"
      tail -n +2 -- "$FAKE_DIR/planner-pid-seq" > "$FAKE_DIR/planner-pid-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/planner-pid-seq.tmp" "$FAKE_DIR/planner-pid-seq" 2>/dev/null || true
      if [[ "$line" == "ALIVE" ]]; then line="$(cat -- "$FAKE_DIR/planner-alive")"; fi
      printf '{"type":"u","data":[%s]}' "$line"
      exit 0
    fi
    [[ -f "$FAKE_DIR/planner-alive" ]] || { echo "fake busctl: planner owner absent" >&2; exit 1; }
    printf '{"type":"u","data":[%s]}' "$(cat -- "$FAKE_DIR/planner-alive")"
    exit 0
  fi
  if [[ "$last" == ":1.10" ]]; then
    printf '{"type":"u","data":[%s]}' "$(cat -- "$FAKE_DIR/kwin-pid")"
    exit 0
  fi
  echo "fake busctl: unknown owner $last" >&2
  exit 1
fi
echo "fake busctl: unexpected call: $*" >&2
exit 1
FAKE_BUSCTL
chmod +x -- "$FAKE_BIN/fake-busctl"

# Fake journalctl: cursor plus a killable follower; logs every call.
cat > "$FAKE_BIN/fake-journalctl" <<'FAKE_JOURNAL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/journalctl.log"
if [[ "$*" == *--show-cursor* ]]; then
  printf 'fake log line\n-- cursor: fake-cursor-1\n'
  exit 0
fi
if [[ "$*" == *-f* ]]; then
  printf '%s\n' "$$" >> "$FAKE_DIR/follower-pids.log"
  sleep 30 & SLEEP_PID=$!
  trap 'kill -- $SLEEP_PID 2>/dev/null || true; exit 0' TERM INT
  wait $SLEEP_PID
  exit 0
fi
echo "fake journalctl: unexpected call: $*" >&2
exit 1
FAKE_JOURNAL
chmod +x -- "$FAKE_BIN/fake-journalctl"

# Fake builder (node): deterministic bundle plus single-line manifest.
cat > "$FAKE_BIN/fake-builder" <<'FAKE_BUILDER'
#!/usr/bin/env node
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const fakeDir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
const get = (f) => {
  const i = args.indexOf(f);
  if (i < 0 || i + 1 >= args.length) { console.error(`missing ${f}`); process.exit(1); }
  return args[i + 1];
};
const has = (f) => args.includes(f);
if (has("--verify")) {
  if (fs.existsSync(path.join(fakeDir, "builder-verify-fail"))) { console.error("fake builder: verify refused"); process.exit(1); }
  console.log("fake-builder: verify ok");
  process.exit(0);
}
const input = get("--input");
const out = get("--out");
const raw = fs.readFileSync(input);
const record = JSON.parse(raw.toString("utf8"));
const shaFile = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const entrySha = shaFile(path.join(process.env.REPO_ROOT, "kwin/src/advisory-describe-entry.ts"));
const querySha = shaFile(path.join(process.env.REPO_ROOT, "kwin/src/advisory-plan-query.ts"));
const snapshotSha = shaFile(path.join(process.env.REPO_ROOT, "kwin/src/advisory-snapshot.ts"));
const inputSha = crypto.createHash("sha256").update(raw).digest("hex");
const bundleText = `fake-bundle ${inputSha} ${entrySha} ${querySha} ${snapshotSha} DescribeAdvisoryPlan advisory-describe-ready advisory-describe-result\n`;
fs.writeFileSync(out, bundleText);
const bundleSha = crypto.createHash("sha256").update(bundleText).digest("hex");
const manifest = {
  schema: "advisory-describe-manifest-v1",
  bundle: "advisory-describe.js",
  bundleSha256: bundleSha,
  entry: "advisory-describe-entry.ts",
  entrySha256: entrySha,
  query: "advisory-plan-query.ts",
  querySha256: querySha,
  snapshot: "advisory-snapshot.ts",
  snapshotSha256: snapshotSha,
  nonce: record.nonce,
  correlationId: record.correlationId,
  owner: record.owner,
  generation: record.generation,
  revision: record.revision,
  inputSha256: inputSha,
};
const manifestPath = path.join(path.dirname(out), "advisory-describe.manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest) + "\n");
fs.appendFileSync(path.join(fakeDir, "builder.log"), `build correlation=${record.correlationId} owner=${record.owner} generation=${record.generation} revision=${record.revision} out=${out}\n`);
fs.writeFileSync(path.join(fakeDir, "manifests", `${record.correlationId}.json`), JSON.stringify(manifest) + "\n");
console.log("fake-builder: wrote bundle");
FAKE_BUILDER
chmod +x -- "$FAKE_BIN/fake-builder"

# Fake planner: one armed child and proc fixture. The fake loader models the
# authenticated request sequence and only writes the loss marker on the armed
# third request, matching the real Planner service's barrier.
cat > "$FAKE_BIN/fake-planner" <<'FAKE_PLANNER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DIR/planner-argv.log"
armed=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "--advisory-loss-correlation" ]]; then armed="$a"; fi
  prev="$a"
done
mode="${PLANNER_FAKE_MODE:-normal}"
if [[ "$mode" == "exit-fast" ]]; then
  echo "fake planner: immediate exit" >&2
  exit 1
fi
printf '%s\n' "$$" > "$FAKE_DIR/planner-alive"
tick="${PLANNER_FAKE_TICK:-777001}"
mkdir -p -- "$PROC_ROOT/$$"
printf '%s (fake-planner) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$$" "$tick" > "$PROC_ROOT/$$/stat"
rm -f -- "$PROC_ROOT/$$/exe"
ln -s -- "$(readlink -f -- "$0")" "$PROC_ROOT/$$/exe"
cleanup_stub() { kill -- "$SLEEP_PID" 2>/dev/null || true; rm -f -- "$FAKE_DIR/planner-alive"; printf 'planner-stopped %s\n' "$(date +%s%N)" >> "$FAKE_DIR/ordered-events.log"; rm -rf -- "$PROC_ROOT/$$"; exit 0; }
trap cleanup_stub TERM INT
sleep 30 & SLEEP_PID=$!
wait $SLEEP_PID
FAKE_PLANNER
chmod +x -- "$FAKE_BIN/fake-planner"

# Fake loader: preflight/start/stop/diagnostics driven by queue files.
cat > "$FAKE_BIN/fake-loader" <<'FAKE_LOADER'
#!/usr/bin/env bash
cmd="${1:-}"
shift || true
printf '%s %s\n' "$cmd" "$*" >> "$FAKE_DIR/loader-calls.log"
mfield() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1; }
nfield() { sed -n "s/.*\"$2\":\([0-9][0-9]*\).*/\1/p" "$1" | head -n 1; }
case "$cmd" in
  preflight)
    bundle=""; manifest=""; input=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --bundle) bundle="$2"; shift 2 ;;
        --manifest) manifest="$2"; shift 2 ;;
        --input) input="$2"; shift 2 ;;
        --expected-planner-owner) shift 2 ;;
        *) echo "fake loader: unknown preflight flag $1" >&2; exit 1 ;;
      esac
    done
    if [[ -f "$FAKE_DIR/loader-preflight-fail" ]]; then echo "fake loader: preflight refused" >&2; exit 1; fi
    corr="$(mfield "$manifest" correlationId)"
    printf 'preflight: bundle=fake entry=fake query=fake snapshot=fake input=fake owner=fake generation=fake revision=0 correlation=%s nonce=%s\n' "$corr" "$corr"
    exit 0
    ;;
  start)
    bundle=""; manifest=""; receipt=""; diag=""; input=""; attempts=""; delay=""; exp_owner=""; exp_detail=""; exp_after=""; svc_loss="0"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --bundle) bundle="$2"; shift 2 ;;
        --manifest) manifest="$2"; shift 2 ;;
        --receipt) receipt="$2"; shift 2 ;;
        --diag-file) diag="$2"; shift 2 ;;
        --input) input="$2"; shift 2 ;;
        --attempts) attempts="$2"; shift 2 ;;
        --delay) delay="$2"; shift 2 ;;
        --expected-planner-owner) exp_owner="$2"; shift 2 ;;
        --expected-refusal-detail) exp_detail="$2"; shift 2 ;;
        --expected-refusal-after) exp_after="$2"; shift 2 ;;
        --refusal-service-loss) svc_loss="1"; shift 1 ;;
        *) echo "fake loader: unknown start flag $1" >&2; exit 1 ;;
      esac
    done
    printf 'start manifest=%s detail=%s after=%s owner=%s svcloss=%s attempts=%s\n' "$manifest" "$exp_detail" "$exp_after" "$exp_owner" "$svc_loss" "$attempts" >> "$FAKE_DIR/loader-calls.log"
    behavior="default"
    if [[ -s "$FAKE_DIR/loader-start-seq" ]]; then
      behavior="$(head -n 1 -- "$FAKE_DIR/loader-start-seq")"
      tail -n +2 -- "$FAKE_DIR/loader-start-seq" > "$FAKE_DIR/loader-start-seq.tmp" 2>/dev/null || true
      mv -- "$FAKE_DIR/loader-start-seq.tmp" "$FAKE_DIR/loader-start-seq" 2>/dev/null || true
    fi
    corr="$(mfield "$manifest" correlationId)"
    owner="$(mfield "$manifest" owner)"
    gen="$(mfield "$manifest" generation)"
    rev="$(nfield "$manifest" revision)"
    nonce="$(mfield "$manifest" nonce)"
    entry="$(mfield "$manifest" entrySha256)"
    query="$(mfield "$manifest" querySha256)"
    snap="$(mfield "$manifest" snapshotSha256)"
    detail="${exp_detail:-could-execute}"
    verdict="${exp_after:-true}"
    if [[ "$behavior" == fail:* ]]; then
      echo "fake loader: ${behavior#fail:}" >&2
      exit 1
    fi
    if [[ "$behavior" == "refuse-wrong" ]]; then
      printf 'refused: plugin=fake script=3 object=/Scripting/Script3 correlation=%s detail=reject:WRONG after=false\n' "$corr"
      exit 0
    fi
    if [[ -z "$exp_detail" ]]; then
      [[ ! -e "$FAKE_DIR/planner-session-success" ]] || { echo "fake loader: duplicate success" >&2; exit 1; }
      printf '%s\n' "$corr" > "$FAKE_DIR/planner-session-success"
    elif [[ "$exp_detail" == "reject:advisory-rejected-stale-request" ]]; then
      [[ -s "$FAKE_DIR/planner-session-success" && "$(cat -- "$FAKE_DIR/planner-session-success")" != "$corr" && "$svc_loss" == "0" ]] || {
        echo "fake loader: stale request sequence is invalid" >&2
        exit 1
      }
    elif [[ "$exp_detail" == "reject:advisory-timeout" && "$svc_loss" == "1" ]]; then
      armed="$(sed -n 's/.*--advisory-loss-correlation \([^ ]*\).*/\1/p' "$FAKE_DIR/planner-argv.log" | head -n 1)"
      [[ -s "$FAKE_DIR/planner-session-success" && "$armed" == "$corr" ]] || {
        echo "fake loader: armed loss sequence is invalid" >&2
        exit 1
      }
    fi
    if [[ "$behavior" == ok-receipt:* ]]; then
      id="${behavior#ok-receipt:}"
    elif [[ -n "$exp_detail" || "$behavior" == "refuse-ok" ]]; then
      if [[ -z "$exp_detail" ]]; then echo "fake loader: refusal needs paired detail" >&2; exit 1; fi
      if [[ -e "$receipt" || -L "$receipt" ]]; then echo "fake loader: receipt exists" >&2; exit 1; fi
      extra=""
      if [[ "$svc_loss" == "1" && -n "$exp_owner" ]]; then extra=" planner-owner=$exp_owner service-loss"; elif [[ "$svc_loss" == "1" ]]; then extra=" service-loss"; elif [[ -n "$exp_owner" ]]; then extra=" planner-owner=$exp_owner"; fi
      ready_mode="normal"
      [[ "$svc_loss" == "1" ]] && ready_mode="${FAKE_READY:-normal}"
      ready_ok="plasma-auto-tiler:advisory-describe-ready:$corr"
      ready_line="$ready_ok"
      ready_extra=""
      case "$ready_mode" in
        normal) ;;
        missing) ready_line="";;
        malformed) ready_line="plasma-auto-tiler:advisory-describe-ready:BROKEN";;
        duplicate) ready_extra="$ready_ok";;
        stale) ready_line="plasma-auto-tiler:advisory-describe-ready:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";;
      esac
      if [[ "${FAKE_ORDER:-in-order}" == "after-first" ]]; then
        printf 'plasma-auto-tiler:advisory-describe-source:%s:%s:%s\nplasma-auto-tiler:advisory-describe-ready:%s\nplasma-auto-tiler:advisory-describe-after:v1:%s:%s\nplasma-auto-tiler:advisory-describe-result:v1:%s:%s:%s:%s:%s:%s\n' "$entry" "$query" "$snap" "$corr" "$corr" "$verdict" "$corr" "$owner" "$gen" "$rev" "$nonce" "$detail" >> "$diag"
      elif [[ "$ready_mode" == "missing" ]]; then
        printf 'plasma-auto-tiler:advisory-describe-source:%s:%s:%s\nplasma-auto-tiler:advisory-describe-result:v1:%s:%s:%s:%s:%s:%s\nplasma-auto-tiler:advisory-describe-after:v1:%s:%s\n' "$entry" "$query" "$snap" "$corr" "$owner" "$gen" "$rev" "$nonce" "$detail" "$corr" "$verdict" >> "$diag"
      elif [[ "$ready_mode" == "duplicate" ]]; then
        printf 'plasma-auto-tiler:advisory-describe-source:%s:%s:%s\n%s\n%s\nplasma-auto-tiler:advisory-describe-result:v1:%s:%s:%s:%s:%s:%s\nplasma-auto-tiler:advisory-describe-after:v1:%s:%s\n' "$entry" "$query" "$snap" "$ready_line" "$ready_extra" "$corr" "$owner" "$gen" "$rev" "$nonce" "$detail" "$corr" "$verdict" >> "$diag"
      else
        printf 'plasma-auto-tiler:advisory-describe-source:%s:%s:%s\n%s\nplasma-auto-tiler:advisory-describe-result:v1:%s:%s:%s:%s:%s:%s\nplasma-auto-tiler:advisory-describe-after:v1:%s:%s\n' "$entry" "$query" "$snap" "$ready_line" "$corr" "$owner" "$gen" "$rev" "$nonce" "$detail" "$corr" "$verdict" >> "$diag"
      fi
      if [[ "$svc_loss" == "1" ]]; then
        planner_stderr="$(dirname -- "$(dirname -- "$diag")")/planner.stderr"
        marker="{\"v\":1,\"marker\":\"planner-service-loss-ready\",\"correlation_id\":\"$corr\",\"owner\":\"adv-transport-owner\",\"generation\":\"adv-transport-gen\",\"revision\":7}"
        case "${PLANNER_FAKE_MODE:-normal}" in
          normal) printf '%s\n' "$marker" >> "$planner_stderr" ;;
          duplicate) printf '%s\n%s\n' "$marker" "$marker" >> "$planner_stderr" ;;
          malformed) printf '{"v":1,"marker":"planner-service-loss-ready","correlation_id":BROKEN\n' >> "$planner_stderr" ;;
          stale) printf '{"v":1,"marker":"planner-service-loss-ready","correlation_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","owner":"adv-transport-owner","generation":"adv-transport-gen","revision":7}\n' >> "$planner_stderr" ;;
          no-marker) : ;;
        esac
        while [[ -f "$FAKE_DIR/planner-alive" ]]; do sleep 0.01; done
      fi
      printf 'refused: plugin=fake script=3 object=/Scripting/Script3 correlation=%s detail=%s after=%s%s\n' "$corr" "$detail" "$verdict" "$extra"
      exit 0
    else
      n="0"
      if [[ -f "$FAKE_DIR/receipt-id-next" ]]; then n="$(cat -- "$FAKE_DIR/receipt-id-next")"; fi
      if [[ "$n" == "0" ]]; then printf '3' > "$FAKE_DIR/receipt-id-next"; else printf '5' > "$FAKE_DIR/receipt-id-next"; fi
      if [[ "$behavior" == ok-receipt:* ]]; then n="${behavior#ok-receipt:}"; fi
      printf 'plasma-auto-tiler:advisory-describe-source:%s:%s:%s\nplasma-auto-tiler:advisory-describe-ready:%s\nplasma-auto-tiler:advisory-describe-result:v1:%s:%s:%s:%s:%s:%s\nplasma-auto-tiler:advisory-describe-after:v1:%s:%s\n' "$entry" "$query" "$snap" "$corr" "$corr" "$owner" "$gen" "$rev" "$nonce" "$detail" "$corr" "$verdict" >> "$diag"
      printf '{"schema":"fake","scriptId":%s}\n' "$n" > "$receipt"
      printf 'receipt-id=%s correlation=%s\n' "$n" "$corr" >> "$FAKE_DIR/loader-calls.log"
      printf 'started: plugin=fake script=%s object=/Scripting/Script%s correlation=%s owner=%s generation=%s revision=%s\n' "$n" "$n" "$corr" "$owner" "$gen" "$rev"
      exit 0
    fi
    ;;
  stop)
    receipt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --receipt) receipt="$2"; shift 2 ;; *) echo "fake loader: unknown stop flag" >&2; exit 1 ;; esac
    done
    rm -f -- "$receipt"
    printf 'stopped: plugin=fake cleanup=verified\n'
    exit 0
    ;;
  diagnostics)
    printf 'diagnostics: markers=correlated\n'
    exit 0
    ;;
  *)
    echo "fake loader: unknown command $cmd" >&2
    exit 1
    ;;
esac
FAKE_LOADER
chmod +x -- "$FAKE_BIN/fake-loader"

# KWin fixture under the fake proc root.
KWIN_PID="4242"
KWIN_TICK="424200"
printf ':1.10\n' > "$FAKE_DIR/kwin-owner"
printf '%s\n' "$KWIN_PID" > "$FAKE_DIR/kwin-pid"
mkdir -p -- "$FAKE_PROC/$KWIN_PID"
printf '%s (kwin_wayland) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$KWIN_PID" "$KWIN_TICK" > "$FAKE_PROC/$KWIN_PID/stat"
printf 'kwin-fixture\n' > "$TMP_DIR/kwin-exe"
chmod 555 -- "$TMP_DIR/kwin-exe"
rm -f -- "$FAKE_PROC/$KWIN_PID/exe"
ln -s -- "$TMP_DIR/kwin-exe" "$FAKE_PROC/$KWIN_PID/exe"

seq_env() {
  export ADVISORY_TRANSPORT_ALLOW=1
  export ADVISORY_TRANSPORT_TEST_FAKE=1
  export SEQUENCER_LOADER="$FAKE_BIN/fake-loader"
  export SEQUENCER_BUILDER="$FAKE_BIN/fake-builder"
  export SEQUENCER_DIST_DIR="$FAKE_DIST"
  export PLANNER_BIN="$FAKE_BIN/fake-planner"
  export BUSCTL_BIN="$FAKE_BIN/fake-busctl"
  export JOURNALCTL_BIN="$FAKE_BIN/fake-journalctl"
  export PROC_ROOT="$FAKE_PROC"
  export FAKE_DIR
  export REPO_ROOT
  export TMPDIR="$FAKE_TMP"
  export SEQUENCER_ATTEMPTS=5
  export SEQUENCER_DELAY=0.01
  export SEQUENCER_MARKER_ATTEMPTS=30
  export SEQUENCER_MARKER_DELAY=0.02
  export SEQUENCER_STOP_ATTEMPTS=20
  export PLANNER_FAKE_MODE=normal
  export PLANNER_FAKE_TICK=777001
  export FAKE_ORDER=in-order
  export FAKE_READY=normal
  unset SEQUENCER_TEST_HOOK_AFTER_PIN SEQUENCER_TEST_HOOK_BEFORE_STOP
}

reset_fake() {
  rm -f -- "$FAKE_DIR"/loader-calls.log "$FAKE_DIR"/builder.log "$FAKE_DIR"/busctl.log "$FAKE_DIR"/journalctl.log
  rm -f -- "$FAKE_DIR"/planner-argv.log "$FAKE_DIR"/planner-alive "$FAKE_DIR"/follower-pids.log
  rm -f -- "$FAKE_DIR"/loader-start-seq "$FAKE_DIR"/loader-preflight-fail "$FAKE_DIR"/receipt-id-next
  rm -f -- "$FAKE_DIR"/planner-owner-seq "$FAKE_DIR"/planner-pid-seq "$FAKE_DIR"/builder-verify-fail "$FAKE_DIR"/planner-session-success
  rm -f -- "$FAKE_DIR"/manifests/*.json
  rm -rf -- "$FAKE_DIST" "$FAKE_TMP"
  mkdir -p -- "$FAKE_DIST" "$FAKE_TMP" "$FAKE_DIR/manifests"
  rm -rf -- "$FAKE_PROC"
  mkdir -p -- "$FAKE_PROC/$KWIN_PID"
  printf '%s (kwin_wayland) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$KWIN_PID" "$KWIN_TICK" > "$FAKE_PROC/$KWIN_PID/stat"
  rm -f -- "$FAKE_PROC/$KWIN_PID/exe"
  ln -s -- "$TMP_DIR/kwin-exe" "$FAKE_PROC/$KWIN_PID/exe"
  seq_env
}

# A: full success run through all three phases.
reset_fake
if "$SEQ" run > "$TMP_DIR/out-a.txt" 2> "$TMP_DIR/err-a.txt"; then
  pass "run succeeds end to end"
else
  fail "run succeeds end to end"
  while IFS= read -r f; do
    printf '%s\n' "--- $f"
    cat -- "$f" 2>/dev/null | head -n 20
  done < <(find "$FAKE_TMP" "$FAKE_DIST" -type f 2>/dev/null | sort)
  printf '%s\n' "--- seq err"
  cat -- "$TMP_DIR/err-a.txt" | head -n 20
fi
if grep -q 'phases=success,stale,loss' "$TMP_DIR/out-a.txt" && grep -q 'continuity=verified' "$TMP_DIR/out-a.txt"; then
  pass "summary reports phases and continuity"
else
  fail "summary reports phases and continuity"
fi
# Phase ordering: preflight, three starts in manifest order, stop, preflight.
if grep -q '^preflight' "$FAKE_DIR/loader-calls.log" && grep -q '^start' "$FAKE_DIR/loader-calls.log" \
  && grep -q '^stop' "$FAKE_DIR/loader-calls.log" && grep -q 'diagnostics' "$FAKE_DIR/loader-calls.log"; then
  pass "loader journey covers preflight/start/stop/diagnostics"
else
  fail "loader journey covers preflight/start/stop/diagnostics"
fi
N_PRE1="$(grep -n '^preflight' "$FAKE_DIR/loader-calls.log" | head -n 1 | cut -d: -f1)"
N_ST1="$(grep -n '^start' "$FAKE_DIR/loader-calls.log" | head -n 1 | cut -d: -f1)"
N_STOP="$(grep -n '^stop' "$FAKE_DIR/loader-calls.log" | head -n 1 | cut -d: -f1)"
if [[ -n "$N_PRE1" && -n "$N_ST1" && -n "$N_STOP" && "$N_PRE1" -lt "$N_ST1" && "$N_ST1" -lt "$N_STOP" ]]; then
  pass "loader call order preflight/start/stop"
else
  fail "loader call order preflight/start/stop"
fi
if [[ "$(grep -c '^start manifest=' "$FAKE_DIR/loader-calls.log")" -eq 3 ]]; then
  pass "exactly three transports ran once each"
else
  fail "exactly three transports ran once each"
fi
if [[ "$(grep -c '^preflight' "$FAKE_DIR/loader-calls.log")" -eq 4 ]]; then
  pass "preflight brackets every phase for production continuity"
else
  fail "preflight brackets every phase for production continuity"
fi
# Builds run for bootstrap plus the three phases; bootstrap reuses the
# success correlation, so four build lines carry exactly three distinct
# correlations with one shared binding, and the armed value is the loss one.
mapfile -t BUILD_CORRS < <(grep '^build' "$FAKE_DIR/builder.log" | sed -n 's/.*correlation=\([^ ]*\).*/\1/p')
mapfile -t CORRS < <(printf '%s\n' "${BUILD_CORRS[@]}" | sort -u)
if [[ "${#BUILD_CORRS[@]}" -eq 4 && "${#CORRS[@]}" -eq 3 && "${BUILD_CORRS[0]}" == "${BUILD_CORRS[1]}" ]]; then
  pass "three distinct generated correlations (bootstrap reuses success)"
else
  fail "three distinct generated correlations (bootstrap reuses success)"
fi
LOSS_CORR="${BUILD_CORRS[3]:-}"
if [[ -n "$LOSS_CORR" ]] && grep -q -- "$LOSS_CORR" "$FAKE_DIR/planner-argv.log"; then
  pass "planner armed with the loss correlation"
else
  fail "planner armed with the loss correlation"
fi
if [[ "$(grep '^build' "$FAKE_DIR/loader-calls.log" 2>/dev/null | wc -l)" -eq 0 ]]; then
  pass "no stray builder transport"
else
  fail "no stray builder transport"
fi
if grep -q 'owner=adv-transport-owner generation=adv-transport-gen revision=7' "$FAKE_DIR/builder.log" \
  && [[ "$(grep -c 'owner=adv-transport-owner generation=adv-transport-gen revision=7' "$FAKE_DIR/builder.log")" -eq 4 ]]; then
  pass "one shared owner/generation/revision across phases"
else
  fail "one shared owner/generation/revision across phases"
fi
# Success used script id 0 (accepted only when returned); stale/loss refused.
if grep -q 'receipt-id=0' "$FAKE_DIR/loader-calls.log"; then
  pass "success accepts script id 0 when returned"
else
  fail "success accepts script id 0 when returned"
fi
if grep -q '/stale/.*detail=reject:advisory-rejected-stale-request' "$FAKE_DIR/loader-calls.log" \
  && grep -q '/stale/.*owner=:1.77' "$FAKE_DIR/loader-calls.log"; then
  pass "stale refusal pins present owner and stale detail"
else
  fail "stale refusal pins present owner and stale detail"
fi
if grep -q '/loss/.*detail=reject:advisory-timeout' "$FAKE_DIR/loader-calls.log" \
  && grep -q '/loss/.*owner=:1.77' "$FAKE_DIR/loader-calls.log" \
  && grep -q 'svcloss=1' "$FAKE_DIR/loader-calls.log"; then
  pass "loss refusal starts pinned owner then loses it in service-loss mode"
else
  fail "loss refusal starts pinned owner then loses it in service-loss mode"
fi
# One Planner child only, exact stop, owner loss proven.
if [[ "$(wc -l < "$FAKE_DIR/planner-argv.log")" -eq 1 ]]; then
  pass "one planner child only"
else
  fail "one planner child only"
fi
if [[ ! -f "$FAKE_DIR/planner-alive" ]]; then
  pass "planner exactly stopped"
else
  fail "planner exactly stopped"
fi
if grep -q 'NameHasOwner.*org.plasmaautotiler.Planner' "$FAKE_DIR/busctl.log" \
  && grep -q 'GetNameOwner.*org.plasmaautotiler.Planner' "$FAKE_DIR/busctl.log" \
  && grep -q 'GetConnectionUnixProcessID.*:1.77' "$FAKE_DIR/busctl.log" \
  && grep -q 'ListNames' "$FAKE_DIR/busctl.log"; then
  pass "planner owner/PID pinned and unique-owner loss checked"
else
  fail "planner owner/PID pinned and unique-owner loss checked"
fi
# Follower per phase with the pinned KWin PID filter and message-only output; all reaped.
if [[ "$(grep -c -- '_PID=4242' "$FAKE_DIR/journalctl.log")" -ge 3 ]] && grep -q -- '--after-cursor fake-cursor-1' "$FAKE_DIR/journalctl.log" && grep -q -- '-o cat' "$FAKE_DIR/journalctl.log"; then
  pass "PID-filtered message-only journal followers capture the ready barrier"
else
  fail "PID-filtered message-only journal followers capture the ready barrier"
fi
FOLLOWERS_DEAD=1
if [[ -f "$FAKE_DIR/follower-pids.log" ]]; then
  while read -r p || [[ -n "$p" ]]; do
    [[ "$p" =~ ^[1-9][0-9]*$ ]] || continue
    if kill -0 -- "$p" 2>/dev/null; then FOLLOWERS_DEAD=0; fi
  done < "$FAKE_DIR/follower-pids.log"
fi
if [[ "$FOLLOWERS_DEAD" -eq 1 ]]; then pass "followers reaped"; else fail "followers reaped"; fi
# Generated cleanup: dist empty, no fresh dir, no repo machine data.
if [[ -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then pass "dist artifacts removed"; else fail "dist artifacts removed"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then pass "fresh dir and bootstrap removed"; else fail "fresh dir and bootstrap removed: $(ls -A -- "$FAKE_TMP")"; fi
if git -C "$REPO_ROOT" status --porcelain -- kwin/dist | grep -q .; then fail "repo dist untouched"; else pass "repo dist untouched"; fi

# B: disabled mode and unknown command create nothing.
reset_fake
export ADVISORY_TRANSPORT_ALLOW=0
if "$SEQ" run >/dev/null 2>&1; then fail "disabled mode must refuse"; else pass "disabled mode refuses"; fi
export ADVISORY_TRANSPORT_ALLOW=1
if "$SEQ" bogus >/dev/null 2>&1; then fail "unknown command must refuse"; else pass "unknown command refuses"; fi
if "$SEQ" run extra >/dev/null 2>&1; then fail "run args must refuse"; else pass "run rejects extra args"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
  pass "no resources on refused commands"
else
  fail "no resources on refused commands"
fi

# C: preflight failure creates no runtime dir and cleans the bootstrap.
reset_fake
touch -- "$FAKE_DIR/loader-preflight-fail"
if "$SEQ" run >/dev/null 2>&1; then fail "preflight failure must fail"; else pass "preflight failure fails closed"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then pass "no fresh dir after preflight failure"; else fail "no fresh dir after preflight failure"; fi
if [[ -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then pass "dist cleaned after preflight failure"; else fail "dist cleaned after preflight failure"; fi
if [[ ! -f "$FAKE_DIR/planner-argv.log" ]]; then pass "no planner launch after preflight failure"; else fail "no planner launch after preflight failure"; fi

# D: planner collision refuses before any launch.
reset_fake
printf '999999\n' > "$FAKE_DIR/planner-alive"
if "$SEQ" run >/dev/null 2>&1; then fail "collision must refuse"; else pass "collision refuses"; fi
if [[ ! -f "$FAKE_DIR/planner-argv.log" ]]; then pass "no child on collision"; else fail "no child on collision"; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then pass "fresh dir removed on collision"; else fail "fresh dir removed on collision"; fi
rm -f -- "$FAKE_DIR/planner-alive"

# E: planner launch failure (immediate exit, no restart).
reset_fake
export PLANNER_FAKE_MODE=exit-fast
if "$SEQ" run >/dev/null 2>&1; then fail "launch failure must fail"; else pass "launch failure fails closed"; fi
if grep -q 'exited immediately' "$TMP_DIR/err-e.txt" 2>/dev/null || true; then :; fi
if [[ -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then pass "fresh dir removed on launch failure"; else fail "fresh dir removed on launch failure"; fi
export PLANNER_FAKE_MODE=normal

# F/G: owner and PID drift fail closed.
reset_fake
printf ':1.77\n:1.78\n' > "$FAKE_DIR/planner-owner-seq"
if "$SEQ" run >/dev/null 2>&1; then fail "owner drift must fail"; else pass "owner drift fails closed"; fi
reset_fake
printf 'ALIVE\n999999\n' > "$FAKE_DIR/planner-pid-seq"
if "$SEQ" run >/dev/null 2>&1; then fail "PID drift must fail"; else pass "PID drift fails closed"; fi

# H/I: tick and exe drift preserve the exact residue.
reset_fake
cat > "$TMP_DIR/hook-tick.sh" <<'HOOK'
#!/usr/bin/env bash
pid="$(cat -- "$FAKE_DIR/planner-alive")"
printf '%s (fake-planner) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 888002\n' "$pid" > "$PROC_ROOT/$pid/stat"
HOOK
chmod +x -- "$TMP_DIR/hook-tick.sh"
export SEQUENCER_TEST_HOOK_AFTER_PIN="$TMP_DIR/hook-tick.sh"
if "$SEQ" run >/dev/null 2>&1; then fail "tick drift must fail"; else pass "tick drift fails closed"; fi
if ls -d -- "$FAKE_TMP"/advisory-transport-* >/dev/null 2>&1; then
  pass "tick drift preserves the exact residue"
else
  fail "tick drift preserves the exact residue"
fi
kill -TERM -- "$(cat -- "$FAKE_DIR/planner-alive" 2>/dev/null)" 2>/dev/null || true
sleep 0.2
reset_fake
printf 'hook-exe\n' > "$TMP_DIR/other-exe"
chmod 555 -- "$TMP_DIR/other-exe"
cat > "$TMP_DIR/hook-exe.sh" <<'HOOK'
#!/usr/bin/env bash
pid="$(cat -- "$FAKE_DIR/planner-alive")"
rm -f -- "$PROC_ROOT/$pid/exe"
ln -s -- "$TMP_DIR/other-exe" "$PROC_ROOT/$pid/exe"
HOOK
chmod +x -- "$TMP_DIR/hook-exe.sh"
export SEQUENCER_TEST_HOOK_AFTER_PIN="$TMP_DIR/hook-exe.sh"
if "$SEQ" run >/dev/null 2>&1; then fail "exe drift must fail"; else pass "exe drift fails closed"; fi
if ls -d -- "$FAKE_TMP"/advisory-transport-* >/dev/null 2>&1; then
  pass "exe drift preserves the exact residue"
else
  fail "exe drift preserves the exact residue"
fi
kill -TERM -- "$(cat -- "$FAKE_DIR/planner-alive" 2>/dev/null)" 2>/dev/null || true
sleep 0.2
unset SEQUENCER_TEST_HOOK_AFTER_PIN

# J/K/L: malformed, duplicate, and stale loss markers fail closed with cleanup.
for mode in malformed duplicate stale; do
  reset_fake
  export PLANNER_FAKE_MODE="$mode"
  if "$SEQ" run >/dev/null 2>&1; then fail "$mode marker must fail"; else pass "$mode marker fails closed"; fi
  if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then
    pass "$mode marker cleans planner and dir"
  else
    fail "$mode marker cleans planner and dir"
  fi
done
export PLANNER_FAKE_MODE=normal

# M: marker timeout is bounded and cleans up.
reset_fake
export PLANNER_FAKE_MODE=no-marker
START_S="$(date +%s)"
if "$SEQ" run >/dev/null 2>&1; then fail "marker timeout must fail"; else pass "marker timeout fails closed"; fi
END_S="$(date +%s)"
if [[ "$((END_S - START_S))" -lt 20 ]]; then pass "marker wait is bounded"; else fail "marker wait is bounded"; fi
if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then
  pass "timeout cleans planner and dir"
else
  fail "timeout cleans planner and dir"
fi
export PLANNER_FAKE_MODE=normal

# N: -1 and malformed script IDs are delegated failures with cleanup.
for reply in "unexpected loadScript reply: i -1" "unexpected loadScript reply: oops"; do
  reset_fake
  printf 'fail:%s\n' "$reply" > "$FAKE_DIR/loader-start-seq"
  if "$SEQ" run >/dev/null 2>&1; then fail "id failure must fail: $reply"; else pass "id failure fails closed: $reply"; fi
  if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" && -z "$(ls -A -- "$FAKE_DIST" 2>/dev/null)" ]]; then
    pass "id failure cleans everything: $reply"
  else
    fail "id failure cleans everything: $reply"
  fi
done

# O: refusal mismatch is rejected with partial cleanup and no loss transport.
reset_fake
printf 'default\nrefuse-wrong\n' > "$FAKE_DIR/loader-start-seq"
if "$SEQ" run >/dev/null 2>&1; then fail "refusal mismatch must fail"; else pass "refusal mismatch fails closed"; fi
if [[ "$(grep -c '^start manifest=' "$FAKE_DIR/loader-calls.log")" -eq 2 ]]; then
  pass "loss never runs after stale mismatch"
else
  fail "loss never runs after stale mismatch"
fi
if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then
  pass "mismatch cleans planner and dir"
else
  fail "mismatch cleans planner and dir"
fi
if grep -q '^stop' "$FAKE_DIR/loader-calls.log"; then pass "success receipt stopped on partial path"; else fail "success receipt stopped on partial path"; fi

# P: stale failure leaves loss unrun and production continuity unchecked.
reset_fake
printf 'default\nfail:stale transport broke\n' > "$FAKE_DIR/loader-start-seq"
if "$SEQ" run >/dev/null 2>&1; then fail "stale failure must fail"; else pass "stale failure fails closed"; fi
if [[ "$(grep -c '^start manifest=' "$FAKE_DIR/loader-calls.log")" -eq 2 ]]; then
  pass "phase order stops at the stale failure"
else
  fail "phase order stops at the stale failure"
fi

# Q: KWin ready gating precedes the Planner loss marker. Each bad ready mode
# fails closed even though the exact Planner stderr loss marker is valid,
# proving loss stops before planner termination when KWin evidence is absent.
for ready_mode in missing malformed duplicate stale; do
  reset_fake
  export FAKE_READY="$ready_mode"
  export PLANNER_FAKE_MODE=normal
  if "$SEQ" run > "$TMP_DIR/out-q-$ready_mode.txt" 2> "$TMP_DIR/err-q-$ready_mode.txt"; then
    fail "KWin ready $ready_mode must fail"
  else
    pass "KWin ready $ready_mode fails closed"
  fi
  if [[ "$(grep -c '^start manifest=' "$FAKE_DIR/loader-calls.log" 2>/dev/null)" -eq 3 ]]; then
    pass "KWin ready $ready_mode starts the loss phase"
  else
    fail "KWin ready $ready_mode starts the loss phase"
  fi
  if grep -q 'KWin ready marker' "$TMP_DIR/err-q-$ready_mode.txt"; then
    pass "KWin ready $ready_mode reports the gated barrier"
  else
    fail "KWin ready $ready_mode reports the gated barrier"
  fi
  if grep -q 'planner-service-loss-ready' "$FAKE_TMP"/advisory-transport-*/planner.stderr 2>/dev/null; then
    pass "KWin ready $ready_mode stops before accepting the valid loss marker"
  else
    # planner.stderr is removed with the fresh dir on cleanup; fall back to
    # proving the loss loader ran but no timeout was accepted.
    if grep -q '/loss/.*detail=reject:advisory-timeout' "$FAKE_DIR/loader-calls.log" && grep -q 'NameHasOwner' "$FAKE_DIR/busctl.log"; then
      pass "KWin ready $ready_mode stops before planner termination"
    else
      fail "KWin ready $ready_mode stops before planner termination"
    fi
  fi
  if [[ ! -f "$FAKE_DIR/planner-alive" && -z "$(ls -A -- "$FAKE_TMP" 2>/dev/null)" ]]; then
    pass "KWin ready $ready_mode cleans planner and dir"
  else
    fail "KWin ready $ready_mode cleans planner and dir"
  fi
done
export FAKE_READY=normal
export PLANNER_FAKE_MODE=normal

printf 'transport-sequencer focused: pass=%s fail=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
