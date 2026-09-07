// POC3 read-only ID/eligibility probe build helper (dedicated, narrow).
//
// Strictly parses opaque --owner/--generation/--nonce plus exactly three
// numeric --expected-pids plus the fixed --out path with no shell evaluation,
// embeds the validated probe config and the exact manual PID list as JSON
// string literals through esbuild defines, and writes exactly one separately
// bundled IIFE to the fixed dist path. No generic execution, no source-text
// evaluation, no other output path.
//
// Usage:
//   node scripts/poc3-build-id-probe.mjs --owner <opaque>
//     --generation <token> --nonce <token> --expected-pids <p1,p2,p3> --out <bundle>
//
// Rules: --out must be exactly kwin/dist/poc3-id-probe.js.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const KWIN_DIR = resolve(REPO_ROOT, "kwin");
const ENTRY = resolve(KWIN_DIR, "src/poc3-id-probe-entry.ts");
const FIXED_BUNDLE_BASENAME = "poc3-id-probe.js";

function fail(message) {
  process.stderr.write(`poc3-build-id-probe: error: ${message}\n`);
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

function parseArgs(argv) {
  const out = {};
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--owner" || flag === "--generation" || flag === "--nonce" || flag === "--expected-pids" || flag === "--out") {
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
  const { owner, generation, nonce, out } = args;
  const expectedPids = args["expected-pids"];
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
  if (out === undefined || !out.endsWith(`/${FIXED_BUNDLE_BASENAME}`)) {
    fail(`--out must be the fixed dist bundle path ending in /${FIXED_BUNDLE_BASENAME}`);
  }
  const outPath = resolve(out);
  if (!outPath.startsWith(`${KWIN_DIR}/dist/`)) {
    fail("--out must stay inside kwin/dist");
  }
  const config = { owner, generation, nonce };
  const pids = expectedPids.split(",").map((s) => Number(s));

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
      POC3_ID_PROBE_CONFIG_JSON: JSON.stringify(JSON.stringify(config)),
      POC3_ID_PROBE_EXPECTED_PIDS_JSON: JSON.stringify(JSON.stringify(pids)),
    },
  });
  process.stdout.write(`poc3-build-id-probe: wrote ${outPath}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
