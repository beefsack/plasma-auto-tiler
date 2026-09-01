import { strict as assert } from "node:assert";
import test from "node:test";

import { createCosmicLocalHarness, decodeCosmicSnapshot } from "./cosmic-fixture";

test("each contract vector owns fresh mutable defaults", () => {
  const first = createCosmicLocalHarness();
  const second = createCosmicLocalHarness();

  assert.notStrictEqual(first.root, second.root);
  assert.notStrictEqual(first.root.geometry, second.root.geometry);
  assert.notStrictEqual(first.root.children[0]?.geometry, second.root.children[0]?.geometry);
  assert.notStrictEqual(first.callbacks, second.callbacks);
  assert.notStrictEqual(first.logs, second.logs);
  assert.notStrictEqual(first.failures, second.failures);
  assert.equal(first.split("left"), true);
  assert.equal(second.root.children.length, 2);
  assert.equal(second.logs.length, 0);
});

test("recursive native-like state observes parent, order, and live links", () => {
  const harness = createCosmicLocalHarness();
  const alpha = harness.windows.find((window) => window.id === "alpha");
  assert.ok(alpha);
  assert.strictEqual(harness.root.children[0]?.window, alpha);
  assert.strictEqual(alpha.tile, harness.root.children[0]);

  assert.equal(harness.mutateGeometry("left", { x: 10, y: 20, width: 500, height: 700 }), true);
  assert.deepEqual(alpha.geometry, { x: 10, y: 20, width: 500, height: 700 });
  assert.deepEqual(harness.logs, ["geometry"]);

  const normal = harness.observeTopology();
  assert.equal(normal.ok, true);
  if (normal.ok) {
    assert.deepEqual(normal.nodes[0]?.childrenIds, ["left", "right"]);
  }
  harness.setFailure("reversedLiveOrder");
  const reversed = harness.observeTopology();
  assert.equal(reversed.ok, true);
  if (reversed.ok) {
    assert.deepEqual(reversed.nodes[0]?.childrenIds, ["right", "left"]);
  }
});

test("split moves the window geometry with its first child", () => {
  const harness = createCosmicLocalHarness();
  const alpha = harness.windows.find((window) => window.id === "alpha");
  assert.ok(alpha);

  assert.equal(harness.split("left"), true);
  assert.deepEqual(alpha.geometry, { x: 0, y: 0, width: 300, height: 800 });
  assert.deepEqual(harness.root.children[0]?.children[0]?.geometry, alpha.geometry);
});

test("opaque, cyclic, and stale-root observations fail closed", () => {
  const opaque = createCosmicLocalHarness();
  opaque.setFailure("opaqueReturn");
  assert.deepEqual(opaque.observeTopology(), { ok: false, reason: "malformed-topology" });
  assert.equal(opaque.snapshot(), null);

  const cyclic = createCosmicLocalHarness();
  cyclic.setFailure("cycleChildren");
  assert.deepEqual(cyclic.observeTopology(), { ok: false, reason: "malformed-topology" });

  const staleRoot = createCosmicLocalHarness();
  staleRoot.setFailure("staleRootParent");
  assert.deepEqual(staleRoot.observeTopology(), { ok: false, reason: "stale-root-parent" });
  assert.equal(staleRoot.snapshot(), null);
});

test("snapshot decoding rejects malformed topology and unassigned windows", () => {
  const harness = createCosmicLocalHarness();
  const encoded = harness.snapshot();
  assert.ok(encoded);
  const decoded = decodeCosmicSnapshot(encoded);
  assert.equal(decoded.version, 1);
  assert.throws(() => decodeCosmicSnapshot(encoded.replace('"parentId":null', '"parentId":"left"')));
  const unassigned = encoded.replace('"windows":[', '"windows":[{"id":"orphan","title":"Orphan","geometry":{"x":0,"y":0,"width":1,"height":1}},');
  assert.throws(() => decodeCosmicSnapshot(unassigned));

  const malformed = createCosmicLocalHarness();
  malformed.setFailure("malformedTopology");
  assert.deepEqual(malformed.observeTopology(), { ok: false, reason: "malformed-topology" });
  assert.equal(malformed.snapshot(), null);
});

test("snapshot decoding rejects non-leaf windows and non-finite geometry", () => {
  const harness = createCosmicLocalHarness();
  const encoded = harness.snapshot();
  assert.ok(encoded);

  const nonLeafWindow = JSON.parse(encoded) as {
    nodes: Array<{ id: string; windowId: string | null }>;
  };
  const root = nonLeafWindow.nodes.find((node) => node.id === "root");
  const left = nonLeafWindow.nodes.find((node) => node.id === "left");
  assert.ok(root);
  assert.ok(left);
  root.windowId = "alpha";
  left.windowId = null;
  assert.throws(() => decodeCosmicSnapshot(JSON.stringify(nonLeafWindow)));

  const nonFiniteSnapshot = JSON.parse(encoded) as {
    windows: Array<{ id: string; geometry: { width: number } }>;
  };
  const alphaWindow = nonFiniteSnapshot.windows.find((window) => window.id === "alpha");
  assert.ok(alphaWindow);
  alphaWindow.geometry.width = Number.POSITIVE_INFINITY;
  const nonFiniteGeometry = JSON.stringify(nonFiniteSnapshot).replace('"width":null', '"width":1e999');
  assert.notEqual(nonFiniteGeometry, encoded);
  assert.throws(() => decodeCosmicSnapshot(nonFiniteGeometry));
});

test("malformed live topology observations fail closed without throwing", () => {
  const harness = createCosmicLocalHarness();
  const malformedChild = {} as (typeof harness.root.children)[number];
  Object.defineProperty(malformedChild, "id", { get: () => { throw new Error("malformed id"); } });
  harness.root.children = [malformedChild, harness.root.children[1]!];

  assert.doesNotThrow(() => harness.observeTopology());
  assert.deepEqual(harness.observeTopology(), { ok: false, reason: "malformed-topology" });
  assert.equal(harness.snapshot(), null);
});

test("assignment, duplicate occupancy, stale state, and focus failures reject safely", () => {
  const assignment = createCosmicLocalHarness();
  assert.equal(assignment.assignWindow("left", "beta"), false);
  assignment.setFailure("assignment");
  assert.equal(assignment.assignWindow("left", "beta"), false);

  const duplicate = createCosmicLocalHarness();
  duplicate.setFailure("duplicateOccupancy");
  assert.deepEqual(duplicate.observeTopology(), { ok: false, reason: "duplicate-occupancy" });
  assert.equal(duplicate.snapshot(), null);

  const stale = createCosmicLocalHarness();
  const staleBefore = stale.snapshot();
  stale.setFailure("staleState");
  assert.equal(stale.split("left"), false);
  assert.equal(stale.focus("beta"), false);
  assert.equal(stale.snapshot(), null);
  assert.equal(stale.restore(staleBefore ?? ""), false);

  const focus = createCosmicLocalHarness();
  const beforeFocus = focus.snapshot();
  focus.setFailure("focus");
  assert.equal(focus.focus("beta"), false);
  assert.equal(focus.snapshot(), beforeFocus);
});

test("stale handles are rejected without id-based inference or reuse", () => {
  const harness = createCosmicLocalHarness();
  const before = harness.snapshot();
  assert.ok(before);
  const handle = harness.getTileHandle("left");
  assert.ok(handle);
  assert.equal(harness.restore(before), true);
  assert.equal(harness.moveWithHandle(handle, { x: 1, y: 1, width: 2, height: 2 }), false);

  const injected = createCosmicLocalHarness();
  const injectedHandle = injected.getTileHandle("left");
  assert.ok(injectedHandle);
  injected.setFailure("staleHandle");
  assert.equal(injected.moveWithHandle(injectedHandle, { x: 1, y: 1, width: 2, height: 2 }), false);
});

test("split then restore proves exact fresh-decoded topology equality", () => {
  const harness = createCosmicLocalHarness();
  const beforeEncoded = harness.snapshot();
  assert.ok(beforeEncoded);
  const before = decodeCosmicSnapshot(beforeEncoded);

  assert.equal(harness.split("left"), true);
  const split = harness.snapshot();
  assert.ok(split);
  const splitDecoded = decodeCosmicSnapshot(split);
  const splitParent = splitDecoded.nodes.find((node) => node.id === "left");
  const splitChildren = splitDecoded.nodes.filter((node) => node.parentId === "left");
  assert.equal(splitParent?.layout, "horizontal");
  assert.deepEqual(splitParent?.children, ["left:0", "left:1"]);
  assert.deepEqual(splitChildren.map((node) => ({ id: node.id, parentId: node.parentId })), [
    { id: "left:0", parentId: "left" },
    { id: "left:1", parentId: "left" },
  ]);

  assert.equal(harness.restore(beforeEncoded), true);
  const afterEncoded = harness.snapshot();
  assert.ok(afterEncoded);
  const after = decodeCosmicSnapshot(afterEncoded);
  assert.deepEqual(after, before);
  assert.deepEqual(after.nodes.map((node) => ({ id: node.id, parentId: node.parentId, children: node.children })), before.nodes.map((node) => ({ id: node.id, parentId: node.parentId, children: node.children })));
});

test("restore preserves exact decoded equality for non-DFS node ordering", () => {
  const harness = createCosmicLocalHarness();
  const encoded = harness.snapshot();
  assert.ok(encoded);
  const reordered = JSON.parse(encoded) as { nodes: Array<{ id: string }>; } & Record<string, unknown>;
  const nodesById = new Map(reordered.nodes.map((node) => [node.id, node]));
  reordered.nodes = [nodesById.get("root")!, nodesById.get("right")!, nodesById.get("left")!];
  const expected = decodeCosmicSnapshot(JSON.stringify(reordered));

  assert.equal(harness.restore(JSON.stringify(reordered)), true);
  const restored = harness.snapshot();
  assert.ok(restored);
  assert.deepEqual(decodeCosmicSnapshot(restored), expected);
});

test("restore remains exact and idempotent against reversed live child order", () => {
  const harness = createCosmicLocalHarness();
  const encoded = harness.snapshot();
  assert.ok(encoded);
  const reordered = JSON.parse(encoded) as { nodes: Array<{ id: string }>; } & Record<string, unknown>;
  const nodesById = new Map(reordered.nodes.map((node) => [node.id, node]));
  reordered.nodes = [nodesById.get("root")!, nodesById.get("right")!, nodesById.get("left")!];
  const input = JSON.stringify(reordered);
  const expected = decodeCosmicSnapshot(input);
  harness.setFailure("reversedLiveOrder");

  assert.equal(harness.restore(input), true);
  const restored = harness.snapshot();
  assert.ok(restored);
  assert.deepEqual(decodeCosmicSnapshot(restored), expected);

  assert.equal(harness.restore(restored), true);
  const repeated = harness.snapshot();
  assert.ok(repeated);
  assert.deepEqual(decodeCosmicSnapshot(repeated), expected);
});

test("split rejects either generated child ID collision without mutation", () => {
  for (const collisionId of ["left:0", "left:1"]) {
    const harness = createCosmicLocalHarness();
    const encoded = harness.snapshot();
    assert.ok(encoded);
    const snapshot = JSON.parse(encoded) as {
      nodes: Array<{ id: string; parentId: string | null; layout: string; geometry: { x: number; y: number; width: number; height: number }; children: string[]; windowId: string | null }>;
      windows: unknown[];
      rootId: string;
      version: 1;
      focusedWindowId: string | null;
    };
    const right = snapshot.nodes.find((node) => node.id === "right");
    assert.ok(right);
    right.layout = "horizontal";
    right.children = [collisionId, "right:empty"];
    right.windowId = null;
    snapshot.nodes.push(
      { id: collisionId, parentId: "right", layout: "leaf", geometry: { ...right.geometry }, children: [], windowId: null },
      { id: "right:empty", parentId: "right", layout: "leaf", geometry: { ...right.geometry }, children: [], windowId: "beta" },
    );
    assert.equal(harness.restore(JSON.stringify(snapshot)), true);
    const before = harness.snapshot();
    assert.ok(before);
    const logsBefore = [...harness.logs];

    assert.equal(harness.split("left"), false);
    assert.equal(harness.snapshot(), before);
    assert.deepEqual(harness.logs, logsBefore);
  }
});

test("restoration-write failure rejects and preserves the split topology", () => {
  const harness = createCosmicLocalHarness();
  const before = harness.snapshot();
  assert.ok(before);
  assert.equal(harness.split("left"), true);
  const split = harness.snapshot();
  assert.ok(split);
  harness.setFailure("restorationWrite");
  assert.equal(harness.restore(before), false);
  assert.equal(harness.snapshot(), split);
});

test("focus rejects stale and non-reciprocal window links without writes", () => {
  const stale = createCosmicLocalHarness();
  const alpha = stale.windows.find((window) => window.id === "alpha");
  assert.ok(alpha);
  const staleTile = { ...stale.root.children[0]!, geometry: { ...stale.root.children[0]!.geometry } };
  alpha.tile = staleTile;
  const staleFocusedWindowId = stale.focusedWindowId;
  const staleLogs = [...stale.logs];
  assert.equal(stale.focus("alpha"), false);
  assert.equal(stale.focusedWindowId, staleFocusedWindowId);
  assert.deepEqual(stale.logs, staleLogs);

  const nonReciprocal = createCosmicLocalHarness();
  const beta = nonReciprocal.windows.find((window) => window.id === "beta");
  assert.ok(beta);
  beta.tile = nonReciprocal.root.children[0]!;
  const nonReciprocalFocusedWindowId = nonReciprocal.focusedWindowId;
  const nonReciprocalLogs = [...nonReciprocal.logs];
  assert.equal(nonReciprocal.focus("beta"), false);
  assert.equal(nonReciprocal.focusedWindowId, nonReciprocalFocusedWindowId);
  assert.deepEqual(nonReciprocal.logs, nonReciprocalLogs);
});

test("focus rejects an indexed but detached tile without writes", () => {
  const harness = createCosmicLocalHarness();
  const detached = harness.root.children[0]!;
  harness.root.children = [harness.root.children[1]!];
  assert.strictEqual(detached.parent, harness.root);
  const beforeFocusedWindowId = harness.focusedWindowId;
  const beforeLogs = [...harness.logs];

  assert.equal(harness.focus("alpha"), false);
  assert.equal(harness.focusedWindowId, beforeFocusedWindowId);
  assert.deepEqual(harness.logs, beforeLogs);
});

test("scalar-malformed live topology observations fail closed without throwing", () => {
  const cases = [
    (harness: ReturnType<typeof createCosmicLocalHarness>) => { (harness.root as unknown as { id: unknown }).id = 42; },
    (harness: ReturnType<typeof createCosmicLocalHarness>) => { (harness.root as unknown as { layout: unknown }).layout = "diagonal"; },
    (harness: ReturnType<typeof createCosmicLocalHarness>) => { harness.root.geometry.width = Number.POSITIVE_INFINITY; },
  ];

  for (const mutate of cases) {
    const harness = createCosmicLocalHarness();
    mutate(harness);
    assert.doesNotThrow(() => harness.observeTopology());
    assert.deepEqual(harness.observeTopology(), { ok: false, reason: "malformed-topology" });
    assert.equal(harness.snapshot(), null);
  }
});
