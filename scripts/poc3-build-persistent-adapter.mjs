// POC3 persistent direct-enrollment adapter build helper (dedicated, narrow).
//
// Strictly parses opaque --owner/--generation/--nonce plus exactly three
// numeric --expected-pids (the manifest-recorded manual PIDs, never guessed
// IDs or captions) plus the exact per-slot manifest evidence
// (--expected-ticks, --expected-app-ids, --expected-slots, --expected-colors;
// color is manifest/config evidence only, KWin cannot observe it) plus the
// private planner expectations (--planner-owner as the session owner token,
// --planner-unique-owner as the exact planner D-Bus unique owner `:N.M`,
// --planner-bus) plus optional --gap for the initial start, embeds the
// validated persistent config, PID list, per-slot client evidence, and
// planner expectations as JSON string literals through esbuild defines, and
// writes exactly one separately bundled IIFE to the fixed dist path. Usable
// area is never accepted here: the adapter derives it from the observed
// native output. No generic execution, no source-text evaluation, no other
// output path. Initial start only: no direction, revision,
// focus/move/status/stop routing exists here.
//
// Usage:
//   node scripts/poc3-build-persistent-adapter.mjs --owner <opaque>
//     --generation <token> --nonce <token> --expected-pids <p1,p2,p3>
//     --expected-ticks <t1,t2,t3>
//     --expected-app-ids <a1,a2,a3> --expected-slots <1,2,3>
//     --expected-colors <c1,c2,c3> --planner-owner <session-owner>
//     --planner-unique-owner <:N.M>
//     --planner-bus <unix:address> [--gap <n>]
//     --out <bundle>
//
// Rules: --out must be exactly kwin/dist/poc3-persistent-adapter.js.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const KWIN_DIR = resolve(REPO_ROOT, "kwin");
const ENTRY = resolve(KWIN_DIR, "src/poc3-persistent-entry.ts");
const FIXED_BUNDLE_BASENAME = "poc3-persistent-adapter.js";

const POC3_DIAG_APP_IDS = [
  "org.plasma-auto-tiler.poc3-diag-1",
  "org.plasma-auto-tiler.poc3-diag-2",
  "org.plasma-auto-tiler.poc3-diag-3",
];
const POC3_DIAG_COLORS = ["ffc02020", "ff20a020", "ff2040c0"];
const POC3_PLANNER_SERVICE = "org.plasmaautotiler.Planner";
const POC3_PLANNER_OBJECT = "/org/plasmaautotiler/Planner";
const POC3_PLANNER_IFACE = "org.plasmaautotiler.Planner1";
const POC3_PLANNER_METHOD = "EvaluatePoc3";
const POC3_MAX_GAP = 64;
const POC3_MIN_SIDE = 1;
const POC3_MAX_SIDE = 16384;
const POC3_MIN_ORIGIN = -16384;
const POC3_MAX_ORIGIN = 16384;

function fail(message) {
  process.stderr.write(`poc3-build-persistent-adapter: error: ${message}\n`);
  process.exit(1);
}

function isOwner(text) {
  return typeof text === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(text);
}

function isToken(text) {
  return typeof text === "string" && /^[a-z0-9-]{1,64}$/.test(text);
}

function isPidList(text) {
  if (typeof text !== "string") return false;
  if (!/^[1-9][0-9]*(,[1-9][0-9]*){2}$/.test(text)) return false;
  const parts = text.split(",");
  if (parts.length !== 3) return false;
  const seen = new Set(parts);
  if (seen.size !== 3) return false;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > 4294967295) return false;
  }
  return true;
}

function isGap(text) {
  if (typeof text !== "string" || !/^[0-9]+$/.test(text)) return false;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 && n <= POC3_MAX_GAP;
}

function parseUsable(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(",");
  if (parts.length !== 4 || parts.some((p) => !/^-?[0-9]+$/.test(p))) return null;
  const [x, y, w, h] = parts.map(Number);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h)) {
    return null;
  }
  if (x < POC3_MIN_ORIGIN || x > POC3_MAX_ORIGIN) return null;
  if (y < POC3_MIN_ORIGIN || y > POC3_MAX_ORIGIN) return null;
  if (w < POC3_MIN_SIDE || w > POC3_MAX_SIDE) return null;
  if (h < POC3_MIN_SIDE || h > POC3_MAX_SIDE) return null;
  return { x, y, w, h };
}

function isTickList(text) {
  if (typeof text !== "string") return false;
  if (!/^[1-9][0-9]*(,[1-9][0-9]*){2}$/.test(text)) return false;
  const parts = text.split(",");
  if (parts.length !== 3) return false;
  const seen = new Set(parts);
  if (seen.size !== 3) return false;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isSafeInteger(n) || n < 1) return false;
  }
  return true;
}

function isAppIdList(text) {
  if (typeof text !== "string") return false;
  const parts = text.split(",");
  if (parts.length !== 3) return false;
  // Exact slot order: slot N carries its fixed app_id. No permutation.
  return parts[0] === POC3_DIAG_APP_IDS[0] && parts[1] === POC3_DIAG_APP_IDS[1] && parts[2] === POC3_DIAG_APP_IDS[2];
}

function isSlotList(text) {
  return text === "1,2,3";
}

function isColorList(text) {
  if (typeof text !== "string") return false;
  const parts = text.split(",").map((s) => s.toLowerCase());
  if (parts.length !== 3) return false;
  const seen = new Set(parts);
  if (seen.size !== 3) return false;
  for (const part of parts) {
    if (!POC3_DIAG_COLORS.includes(part)) return false;
  }
  // Slot order is fixed: slot N carries its fixed color.
  return parts[0] === POC3_DIAG_COLORS[0] && parts[1] === POC3_DIAG_COLORS[1] && parts[2] === POC3_DIAG_COLORS[2];
}

function isPlannerUniqueOwner(text) {
  return typeof text === "string" && /^:[0-9]+\.[0-9]+$/.test(text);
}

function isPlannerBus(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 4096) return false;
  if (text.includes("\n") || text.includes("\0")) return false;
  const entries = text.split(";");
  if (entries.length === 0) return false;
  let foundPath = false;
  for (const entry of entries) {
    if (entry === "" || !entry.startsWith("unix:")) return false;
    const rest = entry.slice("unix:".length);
    if (rest === "") return false;
    for (const kv of rest.split(",")) {
      if (kv.startsWith("path=") || kv.startsWith("abstract=")) {
        const val = kv.slice(kv.indexOf("=") + 1);
        if (val === "" || !val.startsWith("/") || val === "/") return false;
        if (val.includes("//") || val.includes("/../")) return false;
        foundPath = true;
      }
    }
  }
  return foundPath;
}

function parseArgs(argv) {
  const out = {};
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (
      flag === "--owner" || flag === "--generation" || flag === "--nonce" ||
      flag === "--expected-pids" || flag === "--expected-ticks" ||
      flag === "--expected-app-ids" || flag === "--expected-slots" ||
      flag === "--expected-colors" || flag === "--planner-owner" ||
      flag === "--planner-unique-owner" ||
      flag === "--planner-bus" || flag === "--gap" || flag === "--out"
    ) {
      const key = flag.slice(2);
      if (seen.has(key)) fail(`duplicate ${flag}`);
      seen.add(key);
      const next = argv[i + 1];
      if (next === undefined) fail(`missing value for ${flag}`);
      i += 1;
      out[key] = next;
    } else {
      fail(`unknown argument ${JSON.stringify(String(flag))}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { owner, generation, nonce, gap, out } = args;
  const expectedPids = args["expected-pids"];
  const expectedTicks = args["expected-ticks"];
  const expectedAppIds = args["expected-app-ids"];
  const expectedSlots = args["expected-slots"];
  const expectedColors = args["expected-colors"];
  const plannerOwner = args["planner-owner"];
  const plannerUniqueOwner = args["planner-unique-owner"];
  const plannerBus = args["planner-bus"];
  if (owner === undefined || !isOwner(owner)) fail("--owner must be a bounded opaque id");
  if (generation === undefined || !isToken(generation)) {
    fail("--generation must match [a-z0-9-]{1,64}");
  }
  if (nonce === undefined || !isToken(nonce)) {
    fail("--nonce must match [a-z0-9-]{1,64}");
  }
  if (expectedPids === undefined || !isPidList(expectedPids)) {
    fail("--expected-pids must be exactly three distinct positive integers (p1,p2,p3)");
  }
  if (expectedTicks === undefined || !isTickList(expectedTicks)) {
    fail("--expected-ticks must be exactly three distinct positive integers (t1,t2,t3)");
  }
  if (expectedAppIds === undefined || !isAppIdList(expectedAppIds)) {
    fail("--expected-app-ids must be exactly the three distinct diagnostic app_ids in slot order");
  }
  if (expectedSlots === undefined || !isSlotList(expectedSlots)) {
    fail("--expected-slots must be exactly 1,2,3");
  }
  if (expectedColors === undefined || !isColorList(expectedColors)) {
    fail("--expected-colors must be exactly the three distinct slot colors in slot order (ffc02020,ff20a020,ff2040c0)");
  }
  if (plannerOwner === undefined || !isOwner(plannerOwner)) {
    fail("--planner-owner must be a bounded opaque id (session owner token)");
  }
  if (plannerOwner !== owner) {
    fail("--planner-owner must match --owner (private planner session binding)");
  }
  if (plannerUniqueOwner === undefined || !isPlannerUniqueOwner(plannerUniqueOwner)) {
    fail("--planner-unique-owner must be the exact planner D-Bus unique owner (:N.M)");
  }
  if (plannerBus === undefined || !isPlannerBus(plannerBus)) {
    fail("--planner-bus must be a bounded unix: bus address with at least one path=/abstract= entry");
  }
  if (out === undefined || !out.endsWith(`/${FIXED_BUNDLE_BASENAME}`)) {
    fail(`--out must be the fixed dist bundle path ending in /${FIXED_BUNDLE_BASENAME}`);
  }
  const outPath = resolve(out);
  if (!outPath.startsWith(`${KWIN_DIR}/dist/`)) {
    fail("--out must stay inside kwin/dist");
  }
  let configGap = 8;
  if (gap !== undefined) {
    if (!isGap(gap)) fail("--gap must be an integer 0..64");
    configGap = Number(gap);
  }
  const configUsable = null;
  const config = {
    owner,
    generation,
    nonce,
    gap: configGap,
    usable: configUsable,
    expected_revision: 0,
    planner: {
      owner: plannerOwner,
      unique_owner: plannerUniqueOwner,
      bus: plannerBus,
      service: POC3_PLANNER_SERVICE,
      object: POC3_PLANNER_OBJECT,
      interface: POC3_PLANNER_IFACE,
      method: POC3_PLANNER_METHOD,
    },
  };
  const pids = expectedPids.split(",").map((s) => Number(s));
  const ticks = expectedTicks.split(",").map((s) => Number(s));
  const appIds = expectedAppIds.split(",");
  const slots = expectedSlots.split(",").map((s) => Number(s));
  const colors = expectedColors.split(",").map((s) => s.toLowerCase());
  const clients = [0, 1, 2].map((i) => ({
    pid: pids[i],
    tick: ticks[i],
    app_id: appIds[i],
    slot: slots[i],
    color: colors[i],
  }));

  const kwinRequire = createRequire(resolve(KWIN_DIR, "package.json"));
  const esbuild = kwinRequire("esbuild");
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    target: "es2017",
    outfile: outPath,
    logLevel: "warning",
    define: {
      POC3_PERSISTENT_CONFIG_JSON: JSON.stringify(JSON.stringify(config)),
      POC3_PERSISTENT_EXPECTED_PIDS_JSON: JSON.stringify(JSON.stringify(pids)),
      POC3_PERSISTENT_EXPECTED_CLIENTS_JSON: JSON.stringify(JSON.stringify(clients)),
      POC3_PERSISTENT_PLANNER_JSON: JSON.stringify(JSON.stringify(config.planner)),
    },
  });
  process.stdout.write(`poc3-build-persistent-adapter: wrote ${outPath}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
