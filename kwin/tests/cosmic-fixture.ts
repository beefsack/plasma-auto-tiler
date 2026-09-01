export type Layout = "horizontal" | "vertical" | "leaf";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CosmicWindow {
  id: string;
  title: string;
  geometry: Rect;
  tile: CosmicTile | null;
}

export interface CosmicTile {
  id: string;
  parent: CosmicTile | null;
  layout: Layout;
  geometry: Rect;
  children: CosmicTile[];
  window: CosmicWindow | null;
}

export interface WindowSnapshot {
  id: string;
  title: string;
  geometry: Rect;
}

export interface NodeSnapshot {
  id: string;
  parentId: string | null;
  layout: Layout;
  geometry: Rect;
  children: string[];
  windowId: string | null;
}

export interface CosmicSnapshot {
  version: 1;
  rootId: string;
  focusedWindowId: string | null;
  nodes: NodeSnapshot[];
  windows: WindowSnapshot[];
}

export interface ObservedNode {
  id: string;
  parentId: string | null;
  layout: Layout;
  geometry: Rect;
  childrenIds: string[];
  windowId: string | null;
}

export type Observation =
  | { ok: true; nodes: ObservedNode[]; focusedWindowId: string | null }
  | { ok: false; reason: string };

export type FailureName =
  | "opaqueReturn"
  | "reversedLiveOrder"
  | "staleHandle"
  | "cycleChildren"
  | "staleRootParent"
  | "malformedTopology"
  | "assignment"
  | "staleState"
  | "duplicateOccupancy"
  | "focus"
  | "restorationWrite";

export type FailureInjectors = Record<FailureName, boolean>;

export interface TileHandle {
  readonly owner: symbol;
  readonly tile: CosmicTile;
  readonly generation: number;
}

export interface CosmicCallbacks {
  onMutation: (kind: string) => void;
}

export interface CosmicHarness {
  root: CosmicTile;
  windows: CosmicWindow[];
  focusedWindowId: string | null;
  callbacks: CosmicCallbacks;
  logs: string[];
  failures: FailureInjectors;
  setFailure: (name: FailureName, enabled?: boolean) => void;
  readChildren: (tile: CosmicTile) => unknown;
  observeTopology: () => Observation;
  snapshot: () => string | null;
  split: (tileId: string) => boolean;
  assignWindow: (tileId: string, windowId: string) => boolean;
  focus: (windowId: string) => boolean;
  mutateGeometry: (tileId: string, geometry: Rect) => boolean;
  getTileHandle: (tileId: string) => TileHandle | null;
  moveWithHandle: (handle: TileHandle, geometry: Rect) => boolean;
  restore: (encoded: string) => boolean;
}

const failureNames: FailureName[] = [
  "opaqueReturn",
  "reversedLiveOrder",
  "staleHandle",
  "cycleChildren",
  "staleRootParent",
  "malformedTopology",
  "assignment",
  "staleState",
  "duplicateOccupancy",
  "focus",
  "restorationWrite",
];

function freshFailures(): FailureInjectors {
  return Object.fromEntries(failureNames.map((name) => [name, false])) as FailureInjectors;
}

function cloneRect(rect: Rect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRect(value: unknown): Rect {
  if (!isRecord(value) || !Object.values(value).every((part) => typeof part === "number")) {
    throw new Error("invalid geometry");
  }
  const { x, y, width, height } = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    throw new Error("invalid geometry");
  }
  if (![x, y, width, height].every((part) => Number.isFinite(part))) {
    throw new Error("invalid geometry");
  }
  return { x, y, width, height };
}

function parseLayout(value: unknown): Layout {
  if (value !== "horizontal" && value !== "vertical" && value !== "leaf") {
    throw new Error("invalid layout");
  }
  return value;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((part) => typeof part === "string")) {
    throw new Error("invalid children");
  }
  return [...value];
}

function parseSnapshot(value: unknown): CosmicSnapshot {
  if (!isRecord(value) || value.version !== 1 || typeof value.rootId !== "string") {
    throw new Error("invalid snapshot header");
  }
  if (value.focusedWindowId !== null && typeof value.focusedWindowId !== "string") {
    throw new Error("invalid focus");
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.windows)) {
    throw new Error("invalid snapshot collections");
  }

  const windows = value.windows.map((raw): WindowSnapshot => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string") {
      throw new Error("invalid window");
    }
    return { id: raw.id, title: raw.title, geometry: parseRect(raw.geometry) };
  });
  const windowIds = new Set<string>();
  for (const window of windows) {
    if (windowIds.has(window.id)) {
      throw new Error("duplicate window");
    }
    windowIds.add(window.id);
  }

  const nodes = value.nodes.map((raw): NodeSnapshot => {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      throw new Error("invalid node");
    }
    if (raw.parentId !== null && typeof raw.parentId !== "string") {
      throw new Error("invalid parent");
    }
    if (raw.windowId !== null && typeof raw.windowId !== "string") {
      throw new Error("invalid window link");
    }
    return {
      id: raw.id,
      parentId: raw.parentId,
      layout: parseLayout(raw.layout),
      geometry: parseRect(raw.geometry),
      children: parseStringArray(raw.children),
      windowId: raw.windowId,
    };
  });
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error("duplicate node");
    }
    nodeIds.add(node.id);
    if (node.children.length !== new Set(node.children).size) {
      throw new Error("duplicate child");
    }
    if (node.layout === "leaf" && node.children.length !== 0) {
      throw new Error("leaf has children");
    }
    if (node.layout !== "leaf" && node.children.length < 2) {
      throw new Error("split has too few children");
    }
    if (node.layout !== "leaf" && node.windowId !== null) {
      throw new Error("split has window");
    }
  }
  const root = nodes.find((node) => node.id === value.rootId);
  if (root === undefined || root.parentId !== null) {
    throw new Error("invalid root");
  }

  const assignedWindows = new Set<string>();
  for (const node of nodes) {
    if (node.parentId !== null && !nodeIds.has(node.parentId)) {
      throw new Error("stale parent");
    }
    for (const childId of node.children) {
      const child = nodes.find((candidate) => candidate.id === childId);
      if (child === undefined || child.parentId !== node.id) {
        throw new Error("parent-child mismatch");
      }
    }
    if (node.windowId !== null) {
      if (!windowIds.has(node.windowId) || assignedWindows.has(node.windowId)) {
        throw new Error("duplicate or stale window link");
      }
      assignedWindows.add(node.windowId);
    }
  }
  if (assignedWindows.size !== windowIds.size) {
    throw new Error("unassigned window");
  }

  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) {
      throw new Error("cyclic topology");
    }
    visited.add(id);
    const node = nodes.find((candidate) => candidate.id === id);
    if (node === undefined) {
      throw new Error("stale child");
    }
    for (const childId of node.children) {
      visit(childId);
    }
  };
  visit(root.id);
  if (visited.size !== nodes.length) {
    throw new Error("unreachable node");
  }
  if (value.focusedWindowId !== null && !assignedWindows.has(value.focusedWindowId)) {
    throw new Error("focus points at no window");
  }

  return {
    version: 1,
    rootId: value.rootId,
    focusedWindowId: value.focusedWindowId,
    nodes,
    windows,
  };
}

export function decodeCosmicSnapshot(encoded: string): CosmicSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(encoded) as unknown;
  } catch {
    throw new Error("invalid snapshot encoding");
  }
  return parseSnapshot(value);
}

function buildTopology(snapshot: CosmicSnapshot): { root: CosmicTile; windows: CosmicWindow[]; byId: Map<string, CosmicTile> } {
  const windows = snapshot.windows.map((window) => ({ ...window, geometry: cloneRect(window.geometry), tile: null }));
  const windowsById = new Map(windows.map((window) => [window.id, window]));
  const byId = new Map<string, CosmicTile>();
  for (const node of snapshot.nodes) {
    byId.set(node.id, {
      id: node.id,
      parent: null,
      layout: node.layout,
      geometry: cloneRect(node.geometry),
      children: [],
      window: null,
    });
  }
  for (const node of snapshot.nodes) {
    const tile = byId.get(node.id);
    if (tile === undefined) {
      throw new Error("missing node");
    }
    tile.parent = node.parentId === null ? null : byId.get(node.parentId) ?? null;
    tile.children = node.children.map((childId) => byId.get(childId) ?? (() => { throw new Error("missing child"); })());
    tile.window = node.windowId === null ? null : windowsById.get(node.windowId) ?? (() => { throw new Error("missing window"); })();
    for (const child of tile.children) {
      child.parent = tile;
    }
    if (tile.window !== null) {
      tile.window.tile = tile;
    }
  }
  const root = byId.get(snapshot.rootId);
  if (root === undefined) {
    throw new Error("missing root");
  }
  return { root, windows, byId };
}

function snapshotFromObservation(
  harness: CosmicHarness,
  observation: { nodes: ObservedNode[]; focusedWindowId: string | null },
  nodeOrder: string[] | null,
  childOrder: Map<string, string[]> | null,
): string {
  let nodes = observation.nodes;
  if (nodeOrder !== null) {
    const observedById = new Map(observation.nodes.map((node) => [node.id, node]));
    const orderedNodes = nodeOrder.map((id) => observedById.get(id));
    if (orderedNodes.some((node) => node === undefined) || orderedNodes.length !== observation.nodes.length) {
      throw new Error("observation order mismatch");
    }
    nodes = orderedNodes as ObservedNode[];
  }
  const snapshot: CosmicSnapshot = {
    version: 1,
    rootId: harness.root.id,
    focusedWindowId: observation.focusedWindowId,
    nodes: nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      layout: node.layout,
      geometry: cloneRect(node.geometry),
      children: (() => {
        const restoredChildren = childOrder?.get(node.id);
        return restoredChildren !== undefined && restoredChildren.length === node.childrenIds.length && restoredChildren.every((id) => node.childrenIds.includes(id))
          ? [...restoredChildren]
          : [...node.childrenIds];
      })(),
      windowId: node.windowId,
    })),
    windows: harness.windows.map((window) => ({ id: window.id, title: window.title, geometry: cloneRect(window.geometry) })),
  };
  return JSON.stringify(snapshot);
}

export function createCosmicLocalHarness(): CosmicHarness {
  const callbacks: CosmicCallbacks = { onMutation: (kind) => logs.push(kind) };
  const logs: string[] = [];
  const failures = freshFailures();
  const owner = Symbol("cosmic-local-harness");
  let generation = 0;
  const initial: CosmicSnapshot = {
    version: 1,
    rootId: "root",
    focusedWindowId: "alpha",
    nodes: [
      { id: "root", parentId: null, layout: "horizontal", geometry: { x: 0, y: 0, width: 1200, height: 800 }, children: ["left", "right"], windowId: null },
      { id: "left", parentId: "root", layout: "leaf", geometry: { x: 0, y: 0, width: 600, height: 800 }, children: [], windowId: "alpha" },
      { id: "right", parentId: "root", layout: "leaf", geometry: { x: 600, y: 0, width: 600, height: 800 }, children: [], windowId: "beta" },
    ],
    windows: [
      { id: "alpha", title: "Alpha", geometry: { x: 0, y: 0, width: 600, height: 800 } },
      { id: "beta", title: "Beta", geometry: { x: 600, y: 0, width: 600, height: 800 } },
    ],
  };
  let topology = buildTopology(initial);
  let root = topology.root;
  let windows = topology.windows;
  let byId = topology.byId;
  let nodeOrder: string[] | null = null;
  let childOrder: Map<string, string[]> | null = null;
  let focusedWindowId: string | null = initial.focusedWindowId;

  const harness = {} as CosmicHarness;
  const currentWindow = (windowId: string): CosmicWindow | undefined => windows.find((window) => window.id === windowId);
  const currentTile = (tileId: string): CosmicTile | undefined => byId.get(tileId);

  const fail = (reason: string): Observation => ({ ok: false, reason });

  harness.root = root;
  harness.windows = windows;
  harness.focusedWindowId = focusedWindowId;
  harness.callbacks = callbacks;
  harness.logs = logs;
  harness.failures = failures;
  harness.setFailure = (name, enabled = true) => {
    failures[name] = enabled;
  };
  harness.readChildren = (tile) => {
    if (failures.opaqueReturn) {
      return { opaque: true };
    }
    if (failures.cycleChildren && tile === root) {
      return [tile];
    }
    return failures.reversedLiveOrder ? [...tile.children].reverse() : tile.children;
  };
  harness.observeTopology = (): Observation => {
    try {
      if (failures.staleState) {
        return fail("stale-state");
      }
      if (failures.malformedTopology) {
        return fail("malformed-topology");
      }
      if (failures.duplicateOccupancy) {
        return fail("duplicate-occupancy");
      }
      if (failures.staleRootParent || root.parent !== null) {
        return fail("stale-root-parent");
      }
      const windowIds = new Set<string>();
      for (const window of windows) {
        if (typeof window.id !== "string" || typeof window.title !== "string") {
          return fail("malformed-topology");
        }
        parseRect(window.geometry);
        if (windowIds.has(window.id)) {
          return fail("malformed-topology");
        }
        windowIds.add(window.id);
      }
      const nodes: ObservedNode[] = [];
      const visited = new Set<CosmicTile>();
      const ids = new Set<string>();
      const assigned = new Set<CosmicWindow>();
      const visit = (tile: CosmicTile): boolean => {
        if (visited.has(tile)) {
          return false;
        }
        visited.add(tile);
        const id = tile.id;
        if (typeof id !== "string" || ids.has(id)) {
          return false;
        }
        ids.add(id);
        const layout = parseLayout(tile.layout);
        const geometry = parseRect(tile.geometry);
        const parent = tile.parent;
        if (parent !== null && (!isRecord(parent) || typeof parent.id !== "string")) {
          return false;
        }
        const children = harness.readChildren(tile);
        if (!Array.isArray(children) || !children.every((child): child is CosmicTile => isRecord(child))) {
          return false;
        }
        if (layout === "leaf" && children.length !== 0) {
          return false;
        }
        if (layout !== "leaf" && children.length < 2) {
          return false;
        }
        const window = tile.window;
        if (window !== null && children.length !== 0) {
          return false;
        }
        if (window !== null) {
          if (assigned.has(window) || window.tile !== tile || !windows.includes(window) || typeof window.id !== "string") {
            return false;
          }
          assigned.add(window);
        }
        nodes.push({
          id,
          parentId: parent?.id ?? null,
          layout,
          geometry,
          childrenIds: children.map((child) => child.id),
          windowId: window?.id ?? null,
        });
        for (const child of children) {
          if (visited.has(child) || child.parent !== tile || !visit(child)) {
            return false;
          }
        }
        return true;
      };
      if (!visit(root)) {
        return fail("malformed-topology");
      }
      if (assigned.size !== windows.length) {
        return fail("unassigned-window");
      }
      if (focusedWindowId !== null && !assigned.has(currentWindow(focusedWindowId) as CosmicWindow)) {
        return fail("invalid-focus");
      }
      return { ok: true, nodes, focusedWindowId };
    } catch {
      return fail("malformed-topology");
    }
  };
  harness.snapshot = (): string | null => {
    try {
      const observation = harness.observeTopology();
      return observation.ok ? snapshotFromObservation(harness, observation, nodeOrder, childOrder) : null;
    } catch {
      return null;
    }
  };
  harness.split = (tileId) => {
    if (failures.staleState || failures.malformedTopology) {
      return false;
    }
    const tile = currentTile(tileId);
    if (tile === undefined || tile.children.length !== 0 || tile.window === null) {
      return false;
    }
    const firstId = `${tile.id}:0`;
    const secondId = `${tile.id}:1`;
    if (byId.has(firstId) || byId.has(secondId)) {
      return false;
    }
    const orderIndex = nodeOrder === null ? -1 : nodeOrder.indexOf(tile.id);
    if (nodeOrder !== null && orderIndex === -1) {
      return false;
    }
    const originalWindow = tile.window;
    const first: CosmicTile = { id: firstId, parent: tile, layout: "leaf", geometry: cloneRect(tile.geometry), children: [], window: originalWindow };
    const second: CosmicTile = { id: secondId, parent: tile, layout: "leaf", geometry: { x: tile.geometry.x + tile.geometry.width / 2, y: tile.geometry.y, width: tile.geometry.width / 2, height: tile.geometry.height }, children: [], window: null };
    first.geometry.width /= 2;
    originalWindow.geometry = cloneRect(first.geometry);
    originalWindow.tile = first;
    tile.layout = "horizontal";
    tile.window = null;
    tile.children = [first, second];
    byId.set(first.id, first);
    byId.set(second.id, second);
    if (nodeOrder !== null) {
      nodeOrder.splice(orderIndex, 1, first.id, second.id);
    }
    if (childOrder !== null) {
      childOrder.set(tile.id, [first.id, second.id]);
    }
    callbacks.onMutation("split");
    return true;
  };
  harness.assignWindow = (tileId, windowId) => {
    if (failures.assignment || failures.staleState) {
      return false;
    }
    const tile = currentTile(tileId);
    const window = currentWindow(windowId);
    if (tile === undefined || window === undefined || tile.children.length !== 0 || tile.window !== null || window.tile !== null) {
      return false;
    }
    tile.window = window;
    window.tile = tile;
    callbacks.onMutation("assignment");
    return true;
  };
  harness.focus = (windowId) => {
    try {
      if (failures.focus || failures.staleState) {
        return false;
      }
      const window = currentWindow(windowId);
      if (window === undefined || window.tile === null) {
        return false;
      }
      const tile = window.tile;
      if (byId.get(tile.id) !== tile || tile.window !== window) {
        return false;
      }
      const reachable = new Set<CosmicTile>();
      const pending = [root];
      while (pending.length > 0) {
        const candidate = pending.pop()!;
        if (reachable.has(candidate)) {
          continue;
        }
        reachable.add(candidate);
        if (!Array.isArray(candidate.children)) {
          return false;
        }
        for (const child of candidate.children) {
          if (!isRecord(child)) {
            return false;
          }
          pending.push(child);
        }
      }
      if (!reachable.has(tile)) {
        return false;
      }
      focusedWindowId = windowId;
      harness.focusedWindowId = focusedWindowId;
      callbacks.onMutation("focus");
      return true;
    } catch {
      return false;
    }
  };
  harness.mutateGeometry = (tileId, geometry) => {
    if (failures.staleState) {
      return false;
    }
    const tile = currentTile(tileId);
    if (tile === undefined || Object.values(geometry).some((value) => !Number.isFinite(value))) {
      return false;
    }
    tile.geometry = cloneRect(geometry);
    if (tile.window !== null) {
      tile.window.geometry = cloneRect(geometry);
    }
    callbacks.onMutation("geometry");
    return true;
  };
  harness.getTileHandle = (tileId) => {
    const tile = currentTile(tileId);
    return tile === undefined ? null : { owner, tile, generation };
  };
  harness.moveWithHandle = (handle, geometry) => {
    if (failures.staleHandle || failures.staleState || handle.owner !== owner || handle.generation !== generation || handle.tile !== currentTile(handle.tile.id)) {
      return false;
    }
    return harness.mutateGeometry(handle.tile.id, geometry) && handle.tile === currentTile(handle.tile.id);
  };
  harness.restore = (encoded) => {
    if (failures.restorationWrite || failures.staleState) {
      return false;
    }
    let decoded: CosmicSnapshot;
    try {
      decoded = decodeCosmicSnapshot(encoded);
    } catch {
      return false;
    }
    let next: { root: CosmicTile; windows: CosmicWindow[]; byId: Map<string, CosmicTile> };
    try {
      next = buildTopology(decoded);
    } catch {
      return false;
    }
    root = next.root;
    windows = next.windows;
    byId = next.byId;
    nodeOrder = decoded.nodes.map((node) => node.id);
    childOrder = new Map(decoded.nodes.map((node) => [node.id, [...node.children]]));
    focusedWindowId = decoded.focusedWindowId;
    generation += 1;
    harness.root = root;
    harness.windows = windows;
    harness.focusedWindowId = focusedWindowId;
    callbacks.onMutation("restore");
    return true;
  };

  return harness;
}
