// POC3 per-command build helper (dedicated, narrowly POC3-specific).
//
// Strictly parses one fixed POC3 command plus opaque args from argv with no
// shell evaluation (pure node option parsing; every value is allowlist
// validated), embeds the validated command config as a JSON string literal
// through an esbuild `--define`-equivalent, and writes exactly one
// separately bundled IIFE to the fixed dist path. No generic command
// execution, no source-text evaluation, no other output path.
//
// Usage:
//   node scripts/poc3-build-command.mjs --command <start|focus|move|status|stop>
//     [--direction <left|right|up|down>] [--id <window-id> ...]
//     --owner <opaque> --generation <token> [--revision <n>]
//     --nonce <token> [--gap <n>] [--usable <x,y,w,h>] --out <bundle>
//
// Rules: start/focus/move/stop take exactly three --id values; status takes
// none. focus/move require --direction; others forbid it. focus/move/stop
// require --revision; start/status forbid it (revision 0 is embedded).
// start accepts --gap/--usable; others forbid them.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const KWIN_DIR = resolve(REPO_ROOT, "kwin");
const ENTRY = resolve(KWIN_DIR, "src/poc3-command-entry.ts");
const FIXED_BUNDLE_BASENAME = "poc3-manual-command.js";

const COMMANDS = new Set(["start", "focus", "move", "status", "stop"]);
const DIRECTIONS = new Set(["left", "right", "up", "down"]);
const POC3_MAX_REVISION = 1000000;
const POC3_MAX_GAP = 64;
const POC3_MIN_SIDE = 1;
const POC3_MAX_SIDE = 16384;
const POC3_MIN_ORIGIN = -16384;
const POC3_MAX_ORIGIN = 16384;

function fail(message) {
  process.stderr.write(`poc3-build-command: error: ${message}\n`);
  process.exit(1);
}

function isOpaqueId(text) {
  return typeof text === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(text);
}

function isUuidText(text) {
  const parts = text.split("-");
  const lens = [8, 4, 4, 4, 12];
  if (parts.length !== lens.length) return false;
  return parts.every(
    (part, index) => part.length === lens[index] && /^[0-9a-fA-F]+$/.test(part),
  );
}

function isWindowId(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 128) return false;
  if (isOpaqueId(text)) return true;
  if (text.length === 38 && text.startsWith("{") && text.endsWith("}")) {
    return isUuidText(text.slice(1, 37));
  }
  return isUuidText(text);
}

function isGeneration(text) {
  return typeof text === "string" && /^[a-z0-9-]{1,64}$/.test(text);
}

function isInt(text, min, max) {
  if (typeof text !== "string" || !/^[0-9]+$/.test(text)) return false;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= min && n <= max;
}

function parseUsable(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(",");
  if (parts.length !== 4 || parts.some((p) => !/^-?[0-9]+$/.test(p))) return null;
  const [x, y, w, h] = parts.map(Number);
  if (
    !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(w) || !Number.isSafeInteger(h)
  ) {
    return null;
  }
  if (x < POC3_MIN_ORIGIN || x > POC3_MAX_ORIGIN) return null;
  if (y < POC3_MIN_ORIGIN || y > POC3_MAX_ORIGIN) return null;
  if (w < POC3_MIN_SIDE || w > POC3_MAX_SIDE) return null;
  if (h < POC3_MIN_SIDE || h > POC3_MAX_SIDE) return null;
  return { x, y, w, h };
}

function parseArgs(argv) {
  const out = { ids: [] };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const take = () => {
      const next = argv[i + 1];
      if (next === undefined) fail(`missing value for ${flag}`);
      i += 1;
      return next;
    };
    if (flag === "--id") {
      out.ids.push(take());
    } else if (
      flag === "--command" || flag === "--direction" || flag === "--owner" ||
      flag === "--generation" || flag === "--revision" || flag === "--nonce" ||
      flag === "--gap" || flag === "--usable" || flag === "--out"
    ) {
      const key = flag.slice(2);
      if (seen.has(key)) fail(`duplicate ${flag}`);
      seen.add(key);
      out[key] = take();
    } else {
      fail(`unknown argument ${JSON.stringify(String(flag))}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { command, direction, owner, generation, revision, nonce, gap, usable, out, ids } = args;
  if (command === undefined || !COMMANDS.has(command)) {
    fail("--command must be one of start, focus, move, status, stop");
  }
  if (owner === undefined || !isOpaqueId(owner)) fail("--owner must be a bounded opaque id");
  if (generation === undefined || !isGeneration(generation)) {
    fail("--generation must match [a-z0-9-]{1,64}");
  }
  if (nonce === undefined || !isGeneration(nonce)) {
    fail("--nonce must match [a-z0-9-]{1,64}");
  }
  if (out === undefined || !out.endsWith(`/${FIXED_BUNDLE_BASENAME}`)) {
    fail(`--out must be the fixed dist bundle path ending in /${FIXED_BUNDLE_BASENAME}`);
  }
  const outPath = resolve(out);
  if (!outPath.startsWith(`${KWIN_DIR}/dist/`)) {
    fail("--out must stay inside kwin/dist");
  }

  let expectedRevision = 0;
  if (command === "focus" || command === "move" || command === "stop") {
    if (revision === undefined || !isInt(revision, 0, POC3_MAX_REVISION)) {
      fail("--revision must be an integer 0..1000000 for focus/move/stop");
    }
    expectedRevision = Number(revision);
  } else if (revision !== undefined) {
    fail("--revision is only accepted for focus/move/stop");
  }

  let configDirection = null;
  if (command === "focus" || command === "move") {
    if (direction === undefined || !DIRECTIONS.has(direction)) fail("--direction is required for focus/move");
    configDirection = direction;
  } else if (direction !== undefined) {
    fail("--direction is only accepted for focus/move");
  }

  let configIds = null;
  if (command === "status") {
    if (ids.length !== 0) fail("status takes no --id values");
  } else {
    if (ids.length !== 3) fail(`${command} requires exactly three --id values`);
    for (const id of ids) {
      if (!isWindowId(id)) fail(`invalid window id ${JSON.stringify(id.slice(0, 32))}`);
    }
    if (new Set(ids).size !== 3) fail("window ids must be unique");
    configIds = [...ids];
  }

  let configGap = null;
  let configUsable = null;
  if (command === "start") {
    if (gap !== undefined) {
      if (!isInt(gap, 0, POC3_MAX_GAP)) fail("--gap must be an integer 0..64");
      configGap = Number(gap);
    } else {
      configGap = 8;
    }
    if (usable !== undefined) {
      const rect = parseUsable(usable);
      if (rect === null) fail("--usable must be x,y,w,h within bounds");
      configUsable = rect;
    }
  } else {
    if (gap !== undefined) fail("--gap is only accepted for start");
    if (usable !== undefined) fail("--usable is only accepted for start");
  }
  const config = {
    command,
    ids: configIds,
    direction: configDirection,
    owner,
    generation,
    expected_revision: expectedRevision,
    gap: command === "start" ? configGap : null,
    usable: configUsable,
    nonce,
  };

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
      POC3_COMMAND_CONFIG_JSON: JSON.stringify(JSON.stringify(config)),
    },
  });
  process.stdout.write(`poc3-build-command: wrote ${outPath}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
