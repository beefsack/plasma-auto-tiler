// Advisory DescribeAdvisoryPlan build helper (dedicated, narrow).
//
// Strictly parses opaque --input (exact request JSON file) plus the fixed
// --out path with no shell evaluation, embeds the validated request record
// and the sha256 binding of the two advisory sources as JSON string literals
// through esbuild defines, and writes exactly one separately bundled IIFE to
// the fixed dist path plus its deterministic sidecar manifest. No generic
// execution, no source-text evaluation, no other output path.
//
// Usage:
//   node scripts/advisory-describe-build.mjs --input <request.json> --out <bundle>
//
// Rules: --out must be exactly kwin/dist/advisory-describe.js. The input
// record needs exact keys nonce/correlationId/owner/generation/revision/
// snapshot/intent/capabilities with correlationId equal to the nonce, where
// the nonce is at least 32 lower hex chars.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const KWIN_DIR = resolve(REPO_ROOT, "kwin");
const ENTRY = resolve(KWIN_DIR, "src/advisory-describe-entry.ts");
const QUERY = resolve(KWIN_DIR, "src/advisory-plan-query.ts");
const DIST_DIR = resolve(KWIN_DIR, "dist");
const FIXED_BUNDLE_BASENAME = "advisory-describe.js";
const FIXED_MANIFEST_BASENAME = "advisory-describe.manifest.json";
const FIXED_OUT = resolve(DIST_DIR, FIXED_BUNDLE_BASENAME);
const FIXED_MANIFEST = resolve(DIST_DIR, FIXED_MANIFEST_BASENAME);
const MANIFEST_SCHEMA = "advisory-describe-manifest-v1";

const EXPECTED_KEYS = [
  "nonce",
  "correlationId",
  "owner",
  "generation",
  "revision",
  "snapshot",
  "intent",
  "capabilities",
];

function fail(message) {
  process.stderr.write(`advisory-describe-build: error: ${message}\n`);
  process.exit(1);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(argv) {
  const out = { verify: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--verify") {
      if (seen.has("verify")) fail("duplicate --verify");
      seen.add("verify");
      out.verify = true;
      continue;
    }
    if (flag === "--input" || flag === "--out" || flag === "--bundle" || flag === "--manifest") {
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

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    fail(`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return createHash("sha256").update(bytes).digest("hex");
}

function requireRegularInput(path, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail(`${label} is unreadable: ${path}`);
  }
  if (stat.isSymbolicLink()) fail(`${label} must not be a symlink: ${path}`);
  if (!stat.isFile()) fail(`${label} must be a regular file: ${path}`);
}

function rejectInputAlias(inputPath, otherPath, otherLabel) {
  if (inputPath === otherPath) {
    fail(`--input must not alias ${otherLabel}: ${inputPath}`);
  }
}

function requireSafeOutput(path, label) {
  if (path !== FIXED_OUT) {
    fail(`${label} must be exactly kwin/dist/${FIXED_BUNDLE_BASENAME}`);
  }
  let parent;
  try {
    parent = lstatSync(DIST_DIR);
  } catch (error) {
    fail(`dist directory is missing: ${DIST_DIR}`);
  }
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    fail(`dist directory must be a real directory: ${DIST_DIR}`);
  }
  if (existsSync(path)) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      fail(`${label} is unreadable: ${path}`);
    }
    if (stat.isSymbolicLink()) fail(`${label} must not be a symlink: ${path}`);
    if (!stat.isFile()) fail(`${label} must be a regular file: ${path}`);
  }
  if (existsSync(FIXED_MANIFEST)) {
    let stat;
    try {
      stat = lstatSync(FIXED_MANIFEST);
    } catch (error) {
      fail(`manifest output is unreadable: ${FIXED_MANIFEST}`);
    }
    if (stat.isSymbolicLink()) fail(`manifest output must not be a symlink: ${FIXED_MANIFEST}`);
    if (!stat.isFile()) fail(`manifest output must be a regular file: ${FIXED_MANIFEST}`);
  }
}

function validateRecord(raw) {
  if (!isRecord(raw)) fail("--input must be a JSON object with exact advisory keys");
  const keys = Object.keys(raw);
  if (keys.length !== EXPECTED_KEYS.length) {
    fail("--input must carry exactly the advisory request keys");
  }
  for (const key of EXPECTED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      fail(`--input is missing key ${JSON.stringify(key)}`);
    }
  }
  const { nonce, correlationId, owner, generation, revision, snapshot, intent, capabilities } = raw;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32,128}$/.test(nonce)) {
    fail("--input nonce must be 32..128 lower hex chars");
  }
  if (correlationId !== nonce) fail("--input correlationId must equal the nonce");
  if (typeof owner !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(owner)) {
    fail("--input owner must be a bounded opaque id");
  }
  if (typeof generation !== "string" || !/^[a-z0-9-]{1,64}$/.test(generation)) {
    fail("--input generation must match [a-z0-9-]{1,64}");
  }
  if (!Number.isInteger(revision) || revision < 0 || revision > 1000000) {
    fail("--input revision must be an integer 0..1000000");
  }
  if (!isRecord(snapshot) || !isRecord(intent) || !isRecord(capabilities)) {
    fail("--input snapshot/intent/capabilities must be objects");
  }
  return { nonce, correlationId, owner, generation, revision, snapshot, intent, capabilities };
}

const MANIFEST_KEYS = [
  "schema",
  "bundle",
  "bundleSha256",
  "entry",
  "entrySha256",
  "query",
  "querySha256",
  "nonce",
  "correlationId",
  "owner",
  "generation",
  "revision",
  "inputSha256",
];

async function buildBundleTo(record, entrySha, querySha, outfile) {
  const kwinRequire = createRequire(resolve(KWIN_DIR, "package.json"));
  const esbuild = kwinRequire("esbuild");
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    target: "es2017",
    sourcemap: false,
    outfile,
    logLevel: "warning",
    define: {
      ADVISORY_DESCRIBE_REQUEST_JSON: JSON.stringify(JSON.stringify(record)),
      ADVISORY_DESCRIBE_ENTRY_SHA256: JSON.stringify(entrySha),
      ADVISORY_DESCRIBE_QUERY_SHA256: JSON.stringify(querySha),
    },
  });
}

function checkBundleShape(bundleText, entrySha, querySha) {
  if (bundleText.includes("sourceMappingURL")) fail("built bundle must not carry a source map");
  if (!bundleText.includes("DescribeAdvisoryPlan")) fail("built bundle lost the advisory method");
  if (!bundleText.includes("advisory-describe-ready")) fail("built bundle lost the ready marker");
  if (!bundleText.includes("advisory-describe-result")) fail("built bundle lost the result marker");
  if (!bundleText.includes("ADVISORY_DESCRIBE_RESULT_SCHEMA")) fail("built bundle lost the versioned result schema");
  if (!bundleText.includes(entrySha)) fail("built bundle lost the entry source binding");
  if (!bundleText.includes(querySha)) fail("built bundle lost the query source binding");
  if (/^import |^export /m.test(bundleText)) fail("built bundle must not carry ESM syntax");
  if (bundleText.includes('from "./')) fail("built bundle must not carry a source import");
}

function parseManifestStrict(rawText) {
  if (rawText.includes("\r")) fail("manifest must be single-line JSON without CR");
  if (!rawText.endsWith("\n")) fail("manifest must end with a single newline");
  const body = rawText.slice(0, -1);
  if (body.includes("\n")) fail("manifest must be single-line JSON");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    fail(`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) fail("manifest must be a JSON object");
  const keys = Object.keys(parsed);
  if (keys.length !== MANIFEST_KEYS.length) fail("manifest has unexpected keys");
  for (const key of MANIFEST_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) fail(`manifest is missing key ${JSON.stringify(key)}`);
  }
  for (const key of MANIFEST_KEYS) {
    const matches = body.match(new RegExp(`"${key}"\\s*:`, "g")) || [];
    if (matches.length !== 1) fail(`manifest key ${JSON.stringify(key)} must occur exactly once`);
  }
  return parsed;
}

function validateManifestRecord(manifest) {
  if (manifest.schema !== MANIFEST_SCHEMA) fail("manifest schema mismatch");
  if (manifest.bundle !== FIXED_BUNDLE_BASENAME && manifest.bundle !== basename(String(manifest.bundle || ""))) {
    // Basename only; temp tainted copies keep the fixed basename.
  }
  if (basename(String(manifest.bundle)) !== FIXED_BUNDLE_BASENAME) fail("manifest bundle mismatch");
  if (manifest.entry !== "advisory-describe-entry.ts") fail("manifest entry mismatch");
  if (manifest.query !== "advisory-plan-query.ts") fail("manifest query mismatch");
  for (const key of ["bundleSha256", "entrySha256", "querySha256", "inputSha256"]) {
    if (typeof manifest[key] !== "string" || !/^[0-9a-f]{64}$/.test(manifest[key])) {
      fail(`manifest ${key} is malformed`);
    }
  }
  if (typeof manifest.nonce !== "string" || !/^[0-9a-f]{32,128}$/.test(manifest.nonce)) {
    fail("manifest nonce is malformed");
  }
  if (manifest.correlationId !== manifest.nonce) fail("manifest correlation must equal the nonce");
  if (typeof manifest.owner !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(manifest.owner)) {
    fail("manifest owner is malformed");
  }
  if (typeof manifest.generation !== "string" || !/^[a-z0-9-]{1,64}$/.test(manifest.generation)) {
    fail("manifest generation is malformed");
  }
  if (!Number.isInteger(manifest.revision) || manifest.revision < 0 || manifest.revision > 1000000) {
    fail("manifest revision is malformed");
  }
  return manifest;
}

async function cmdBuild(input, out) {
  if (input === undefined) fail("missing required --input <request.json>");
  if (out === undefined) fail("missing required --out <bundle>");
  const outPath = resolve(out);
  if (outPath !== FIXED_OUT) {
    fail(`--out must be exactly kwin/dist/${FIXED_BUNDLE_BASENAME}`);
  }
  const inputPath = resolve(input);
  // The input is read-only: any absolute safe path to a regular non-symlink
  // file is accepted so shell fixtures can stage request records under a
  // temp directory. Only the output path is pinned to the fixed dist file.
  // The input must never alias the fixed bundle or manifest outputs.
  requireRegularInput(inputPath, "--input");
  rejectInputAlias(inputPath, FIXED_OUT, "fixed bundle output");
  rejectInputAlias(inputPath, FIXED_MANIFEST, "fixed manifest output");
  requireSafeOutput(outPath, "--out");
  let raw;
  let inputBytes;
  try {
    inputBytes = readFileSync(inputPath);
  } catch (error) {
    fail(`--input is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    raw = JSON.parse(inputBytes.toString("utf8"));
  } catch (error) {
    fail(`--input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = validateRecord(raw);
  const entrySha = sha256File(ENTRY);
  const querySha = sha256File(QUERY);
  const inputSha = sha256Bytes(inputBytes);

  await buildBundleTo(record, entrySha, querySha, outPath);

  const bundleBytes = readFileSync(outPath);
  const bundleText = bundleBytes.toString("utf8");
  checkBundleShape(bundleText, entrySha, querySha);
  const bundleSha = sha256Bytes(bundleBytes);

  // Deterministic sidecar manifest: fixed key order, basenames only, no
  // absolute paths, no timestamps, no machine identity. Binds the exact
  // input bytes so start can prove rebuild identity before any transport.
  const manifest = {
    schema: MANIFEST_SCHEMA,
    bundle: FIXED_BUNDLE_BASENAME,
    bundleSha256: bundleSha,
    entry: "advisory-describe-entry.ts",
    entrySha256: entrySha,
    query: "advisory-plan-query.ts",
    querySha256: querySha,
    nonce: record.nonce,
    correlationId: record.correlationId,
    owner: record.owner,
    generation: record.generation,
    revision: record.revision,
    inputSha256: inputSha,
  };
  writeFileSync(FIXED_MANIFEST, `${JSON.stringify(manifest)}\n`);
  process.stdout.write(`advisory-describe-build: wrote ${outPath}\n`);
}

async function cmdVerify(input, bundle, manifestPath) {
  if (input === undefined) fail("verify requires --input <request.json>");
  if (bundle === undefined) fail("verify requires --bundle <bundle>");
  if (manifestPath === undefined) fail("verify requires --manifest <manifest>");
  const inputPath = resolve(input);
  const bundlePath = resolve(bundle);
  const manifestResolved = resolve(manifestPath);
  requireRegularInput(inputPath, "--input");
  requireRegularInput(bundlePath, "--bundle");
  requireRegularInput(manifestResolved, "--manifest");
  rejectInputAlias(inputPath, bundlePath, "verified bundle");
  rejectInputAlias(inputPath, manifestResolved, "verified manifest");
  let inputBytes;
  try {
    inputBytes = readFileSync(inputPath);
  } catch (error) {
    fail(`--input is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let record;
  try {
    record = validateRecord(JSON.parse(inputBytes.toString("utf8")));
  } catch (error) {
    fail(`--input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const inputSha = sha256Bytes(inputBytes);
  let manifestText;
  try {
    manifestText = readFileSync(manifestResolved, "utf8");
  } catch (error) {
    fail(`--manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = validateManifestRecord(parseManifestStrict(manifestText));
  if (manifest.inputSha256 !== inputSha) fail("input bytes do not match the manifest input binding");
  const entrySha = sha256File(ENTRY);
  const querySha = sha256File(QUERY);
  if (manifest.entrySha256 !== entrySha) fail("entry source does not match the manifest build identity");
  if (manifest.querySha256 !== querySha) fail("query source does not match the manifest build identity");
  if (record.nonce !== manifest.nonce) fail("input nonce does not match the manifest");
  if (record.correlationId !== manifest.correlationId) fail("input correlation does not match the manifest");
  if (record.owner !== manifest.owner) fail("input owner does not match the manifest");
  if (record.generation !== manifest.generation) fail("input generation does not match the manifest");
  if (record.revision !== manifest.revision) fail("input revision does not match the manifest");
  const bundleBytes = readFileSync(bundlePath);
  const bundleText = bundleBytes.toString("utf8");
  checkBundleShape(bundleText, entrySha, querySha);
  const actualBundleSha = sha256Bytes(bundleBytes);
  if (manifest.bundleSha256 !== actualBundleSha) fail("bundle bytes do not match the manifest build identity");
  // Deterministic rebuild into a temp directory (never the production dist
  // path) and byte-compare: rejects a source-valid manually altered bundle
  // even when its manifest bundle sha was recomputed.
  const scratch = mkdtempSync(`${tmpdir()}/advisory-verify-`);
  const rebuiltPath = resolve(scratch, FIXED_BUNDLE_BASENAME);
  try {
    await buildBundleTo(record, entrySha, querySha, rebuiltPath);
    const rebuiltBytes = readFileSync(rebuiltPath);
    if (!rebuiltBytes.equals(bundleBytes)) {
      fail("bundle is not the deterministic rebuild of the exact source plus exact input");
    }
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch (error) {
      void error;
    }
  }
  process.stdout.write("advisory-describe-build: verify ok\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.verify) {
    if (args.out !== undefined) fail("--verify takes --bundle/--manifest, not --out");
    await cmdVerify(args.input, args.bundle, args.manifest);
    return;
  }
  if (args.bundle !== undefined || args.manifest !== undefined) {
    fail("build mode takes only --input and --out (use --verify with --bundle/--manifest)");
  }
  await cmdBuild(args.input, args.out);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
