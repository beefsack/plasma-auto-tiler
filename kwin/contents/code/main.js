"use strict";
(() => {
  // src/boundary.ts
  var MAX_SEQUENTIAL_LENGTH = 1024;
  function isObject(value) {
    return typeof value === "object" && value !== null;
  }
  function read(value, property) {
    try {
      const result = Reflect.get(value, property);
      return { ok: true, value: result };
    } catch (error) {
      void error;
      return { ok: false, value: void 0 };
    }
  }
  function has(value, property) {
    try {
      return Reflect.has(value, property);
    } catch (error) {
      void error;
      return false;
    }
  }
  function failure(reason) {
    return { ok: false, reason };
  }
  function isBoundedLength(value, maximum) {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= maximum;
  }
  function decodeSequential(value, guard, maxLength) {
    if (!isObject(value)) {
      return failure("not-sequential");
    }
    if (!isBoundedLength(maxLength, MAX_SEQUENTIAL_LENGTH)) {
      return failure("invalid-limit");
    }
    const length = read(value, "length");
    if (!length.ok || !isBoundedLength(length.value, maxLength)) {
      return failure("invalid-length");
    }
    const elements = [];
    for (let index = 0; index < length.value; index += 1) {
      const property = String(index);
      const element = read(value, property);
      if (!element.ok || !has(value, property) && element.value === void 0) {
        return failure("missing-element");
      }
      try {
        if (!guard(element.value)) {
          return failure("invalid-element");
        }
      } catch (error) {
        void error;
        return failure("invalid-element");
      }
      elements.push(element.value);
    }
    return { ok: true, value: Object.freeze(elements) };
  }
  function hasValue(value, property, guard) {
    const item = read(value, property);
    return item.ok && guard(item.value);
  }
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function isPoint(value) {
    return isObject(value) && hasValue(value, "x", isFiniteNumber) && hasValue(value, "y", isFiniteNumber);
  }
  function isRect(value) {
    return isPoint(value) && hasValue(value, "width", isFiniteNumber) && hasValue(value, "height", isFiniteNumber);
  }
  function isOutput(value) {
    return isObject(value) && hasValue(value, "geometry", isRect) && hasValue(value, "name", (item) => typeof item === "string") && hasValue(value, "manufacturer", (item) => typeof item === "string") && hasValue(value, "model", (item) => typeof item === "string") && hasValue(value, "serialNumber", (item) => typeof item === "string");
  }
  function isVirtualDesktop(value) {
    return isObject(value) && hasValue(value, "id", (item) => typeof item === "string");
  }
  function desktopNumber(value) {
    const number = value.x11DesktopNumber;
    if (typeof number !== "number" || !Number.isFinite(number) || !Number.isInteger(number) || number < 1) {
      return null;
    }
    return number;
  }
  function isObjectOrNull(value) {
    return value === null || isObject(value);
  }
  function isMethod(value) {
    return typeof value === "function";
  }
  function isWindow(value) {
    return isObject(value) && hasValue(value, "normalWindow", (item) => typeof item === "boolean") && hasValue(value, "managed", (item) => typeof item === "boolean") && hasValue(value, "resizeable", (item) => typeof item === "boolean") && hasValue(value, "appletPopup", (item) => typeof item === "boolean") && hasValue(value, "desktops", () => true) && hasValue(value, "output", (item) => item === null || isOutput(item)) && hasValue(value, "tile", isObjectOrNull) && hasValue(value, "frameGeometry", isRect) && hasValue(value, "move", (item) => typeof item === "boolean") && hasValue(value, "resize", (item) => typeof item === "boolean");
  }
  function isTile(value) {
    return isObject(value) && hasValue(value, "relativeGeometry", isRect) && hasValue(value, "absoluteGeometry", isRect) && hasValue(value, "parent", isObjectOrNull) && hasValue(value, "tiles", () => true) && hasValue(value, "windows", () => true) && hasValue(value, "isLayout", (item) => typeof item === "boolean") && hasValue(value, "canBeRemoved", (item) => typeof item === "boolean") && hasValue(value, "manage", isMethod) && hasValue(value, "unmanage", isMethod);
  }
  function isCustomTile(value) {
    return isTile(value) && hasValue(value, "layoutDirection", (item) => item === 0 || item === 1 || item === 2) && hasValue(value, "split", isMethod);
  }
  function manageTile(tile, window) {
    const method = read(tile, "manage");
    if (!method.ok || !isMethod(method.value)) {
      return false;
    }
    return Reflect.apply(method.value, tile, [window]) === true;
  }
  function detachWindowFromTile(window) {
    try {
      return Reflect.set(window, "tile", null);
    } catch (error) {
      void error;
      return false;
    }
  }
  function assignWindowToTile(window, tile) {
    try {
      return Reflect.set(window, "tile", tile) === true;
    } catch (error) {
      void error;
      return false;
    }
  }
  function unmanageTile(tile, window) {
    const method = read(tile, "unmanage");
    if (!method.ok || !isMethod(method.value)) {
      return false;
    }
    try {
      return Reflect.apply(method.value, tile, [window]) === true;
    } catch (error) {
      void error;
      return false;
    }
  }
  function writeWindowFrameGeometry(window, geometry) {
    if (!isRect(geometry)) {
      return false;
    }
    try {
      return Reflect.set(window, "frameGeometry", geometry) === true;
    } catch (error) {
      void error;
      return false;
    }
  }
  function isNativelyMaximized(window) {
    const mode = window.maximizeMode;
    return typeof mode === "number" && Number.isInteger(mode) && mode >= 1 && mode <= 3;
  }
  function setWindowOnAllDesktops(window, value) {
    try {
      return Reflect.set(window, "onAllDesktops", value) === true;
    } catch (error) {
      void error;
      return false;
    }
  }
  function writeWindowDesktops(window, desktops) {
    try {
      return Reflect.set(window, "desktops", desktops) === true;
    } catch (error) {
      void error;
      return false;
    }
  }
  function setTileRelativeGeometry(tile, geometry) {
    if (!isRect(geometry)) {
      return false;
    }
    try {
      return Reflect.set(tile, "relativeGeometry", geometry);
    } catch (error) {
      void error;
      return false;
    }
  }
  function splitCustomTile(tile, direction) {
    const method = read(tile, "split");
    if (!method.ok || !isMethod(method.value)) {
      throw new Error("CustomTile split capability changed before invocation");
    }
    return Reflect.apply(method.value, tile, [direction]);
  }
  function removeCustomTile(tile) {
    const method = read(tile, "remove");
    if (!method.ok || !isMethod(method.value)) {
      return false;
    }
    try {
      Reflect.apply(method.value, tile, []);
      return true;
    } catch (error) {
      void error;
      return false;
    }
  }
  function sameScope(a, b) {
    return a.output === b.output && a.desktopId === b.desktopId;
  }
  var FeatureGate = class {
    constructor() {
      this.enabled = true;
      this.logged = false;
    }
    get isEnabled() {
      return this.enabled;
    }
    run(operation, log) {
      if (!this.enabled) {
        return { ok: false };
      }
      try {
        return { ok: true, value: operation() };
      } catch (error) {
        void error;
        this.disable("exception", log);
        return { ok: false };
      }
    }
    disable(reason, log) {
      this.enabled = false;
      if (this.logged) {
        return;
      }
      this.logged = true;
      try {
        log(reason);
      } catch (error) {
        void error;
      }
    }
  };
  var TransientState = class {
    get current() {
      return this.value;
    }
    set(next) {
      this.value = next;
    }
    clear() {
      this.value = void 0;
    }
    clearForScopeChange() {
      this.clear();
    }
  };

  // src/custom-tile-split.ts
  var HORIZONTAL_LAYOUT_DIRECTION = 1;
  var VERTICAL_LAYOUT_DIRECTION = 2;
  function splitDirection(orientation) {
    return orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
  }
  var customTileSplitSeam = {
    split: (tile, orientation) => splitCustomTile(tile, splitDirection(orientation)),
    decodeChildren: (value) => {
      const decoded = decodeSequential(value, isCustomTile, 2);
      if (!decoded.ok) {
        return null;
      }
      const left = decoded.value[0];
      const right = decoded.value[1];
      if (left === void 0 || right === void 0) {
        return null;
      }
      return Object.freeze([left, right]);
    }
  };

  // src/layout-blueprint.ts
  function reject(kind, message) {
    return { ok: false, reason: { kind, message } };
  }
  function buildBlueprintByDepth(count, orientationAtDepth) {
    if (!Number.isInteger(count) || count <= 0) {
      return reject(
        "invalid-leaf-count",
        "leaf count must be a positive integer"
      );
    }
    return { ok: true, value: buildNode(count, orientationAtDepth, 0, 0) };
  }
  function buildNode(count, orientationAtDepth, startOrdinal, depth) {
    if (count === 1) {
      return { kind: "leaf", ordinal: startOrdinal };
    }
    const leftCount = Math.floor(count / 2);
    const rightCount = count - leftCount;
    const orientation = orientationAtDepth(depth);
    const left = buildNode(leftCount, orientationAtDepth, startOrdinal, depth + 1);
    const right = buildNode(rightCount, orientationAtDepth, startOrdinal + leftCount, depth + 1);
    return { kind: "branch", orientation, left, right };
  }
  function buildDwindleBlueprint(count) {
    if (!Number.isInteger(count) || count <= 0) {
      return reject(
        "invalid-leaf-count",
        "leaf count must be a positive integer"
      );
    }
    return { ok: true, value: buildDwindleNode(count, 0, 0) };
  }
  function buildDwindleNode(count, startOrdinal, depth) {
    if (count === 1) {
      return { kind: "leaf", ordinal: startOrdinal };
    }
    const orientation = depth % 2 === 0 ? "horizontal" : "vertical";
    const left = { kind: "leaf", ordinal: startOrdinal };
    const right = buildDwindleNode(count - 1, startOrdinal + 1, depth + 1);
    return { kind: "branch", orientation, left, right };
  }

  // src/layout-executor.ts
  function failed(completedSplits, mutationPossible) {
    return {
      ok: false,
      code: "blueprint-execution-failed",
      completedSplits,
      mutationPossible
    };
  }
  function pathKey(path) {
    if (!Array.isArray(path) || path.length === 0 || path[0] !== "root") {
      return null;
    }
    for (const segment of path) {
      if (segment !== "root" && segment !== "left" && segment !== "right") {
        return null;
      }
    }
    for (let index = 1; index < path.length; index += 1) {
      if (path[index] === "root") {
        return null;
      }
    }
    return path.join("/");
  }
  function isChildPath(parent, child, side) {
    if (child.length !== parent.length + 1 || child[child.length - 1] !== side) {
      return false;
    }
    for (let index = 0; index < parent.length; index += 1) {
      if (child[index] !== parent[index]) {
        return false;
      }
    }
    return true;
  }
  function validatePlan(instructions) {
    if (!Array.isArray(instructions.splits) || !Array.isArray(instructions.leafPaths)) {
      return null;
    }
    const available = /* @__PURE__ */ new Set(["root"]);
    const splits = [];
    for (const instruction of instructions.splits) {
      const targetKey = pathKey(instruction.targetPath);
      const leftKey = pathKey(instruction.leftPath);
      const rightKey = pathKey(instruction.rightPath);
      if (targetKey === null || leftKey === null || rightKey === null || instruction.orientation !== "vertical" && instruction.orientation !== "horizontal" || !isChildPath(instruction.targetPath, instruction.leftPath, "left") || !isChildPath(instruction.targetPath, instruction.rightPath, "right") || !available.delete(targetKey) || available.has(leftKey) || available.has(rightKey)) {
        return null;
      }
      available.add(leftKey);
      available.add(rightKey);
      splits.push({ targetKey, leftKey, rightKey, orientation: instruction.orientation });
    }
    if (instructions.leafPaths.length !== available.size) {
      return null;
    }
    const leafKeys = [];
    for (let ordinal = 0; ordinal < instructions.leafPaths.length; ordinal += 1) {
      const leaf = instructions.leafPaths[ordinal];
      if (leaf === void 0 || leaf.ordinal !== ordinal) {
        return null;
      }
      const key = pathKey(leaf.path);
      if (key === null || !available.delete(key)) {
        return null;
      }
      leafKeys.push(key);
    }
    return available.size === 0 ? { splits, leafKeys } : null;
  }
  function executeBlueprintInstructions(instructions, root, seam) {
    let completedSplits = 0;
    let mutationPossible = false;
    try {
      const plan = validatePlan(instructions);
      if (plan === null || typeof root !== "object" || root === null) {
        return failed(completedSplits, mutationPossible);
      }
      const leaves = /* @__PURE__ */ new Map([["root", root]]);
      const tilePaths = /* @__PURE__ */ new Map([[root, "root"]]);
      for (const instruction of plan.splits) {
        const target = leaves.get(instruction.targetKey);
        if (target === void 0 || tilePaths.get(target) !== instruction.targetKey || leaves.has(instruction.leftKey) || leaves.has(instruction.rightKey)) {
          return failed(completedSplits, mutationPossible);
        }
        mutationPossible = true;
        const split = seam.split(target, instruction.orientation);
        const children = seam.decodeChildren(split);
        if (children === null) {
          return failed(completedSplits, mutationPossible);
        }
        const left = children[0];
        const right = children[1];
        if (left === right || left === target || right === target || tilePaths.has(left) || tilePaths.has(right)) {
          return failed(completedSplits, mutationPossible);
        }
        leaves.delete(instruction.targetKey);
        leaves.set(instruction.leftKey, left);
        leaves.set(instruction.rightKey, right);
        tilePaths.set(left, instruction.leftKey);
        tilePaths.set(right, instruction.rightKey);
        completedSplits += 1;
      }
      const realized = [];
      for (const key of plan.leafKeys) {
        const tile = leaves.get(key);
        if (tile === void 0) {
          return failed(completedSplits, mutationPossible);
        }
        realized.push(tile);
      }
      if (realized.length !== leaves.size) {
        return failed(completedSplits, mutationPossible);
      }
      return { ok: true, leaves: Object.freeze(realized), completedSplits };
    } catch (e) {
      return failed(completedSplits, mutationPossible);
    }
  }

  // src/logic.ts
  function isEligibleWindow(window) {
    return window.normal && window.managed;
  }
  function sameScope2(a, b) {
    return a.output === b.output && a.desktopId === b.desktopId;
  }
  function reject2(kind, message) {
    return { ok: false, reason: { kind, message } };
  }
  function isValidRect(rect) {
    return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && rect.width > 0 && Number.isFinite(rect.height) && rect.height > 0;
  }
  function isValidPoint(point) {
    return Number.isFinite(point.x) && Number.isFinite(point.y);
  }
  function containsPoint(rect, point) {
    return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
  }
  function compareLeaves(a, b) {
    if (a.geometry.y !== b.geometry.y) {
      return a.geometry.y < b.geometry.y ? -1 : 1;
    }
    if (a.geometry.x !== b.geometry.x) {
      return a.geometry.x < b.geometry.x ? -1 : 1;
    }
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  }
  function pickDropLeaf(leaves, point) {
    let best = null;
    for (const leaf of leaves) {
      if (leaf.isLayout) {
        continue;
      }
      if (!containsPoint(leaf.geometry, point)) {
        continue;
      }
      if (best === null || compareLeaves(leaf, best) < 0) {
        best = leaf;
      }
    }
    return best;
  }
  function findNeighborLeaf(leaves, current, direction) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const leaf of leaves) {
      if (leaf.id === current.id) {
        continue;
      }
      const distance = neighborDistance(current.geometry, leaf.geometry, direction);
      if (distance === null) {
        continue;
      }
      if (best === null || distance < bestDistance) {
        best = leaf;
        bestDistance = distance;
      } else if (distance === bestDistance && compareLeaves(leaf, best) < 0) {
        best = leaf;
      }
    }
    return best;
  }
  function neighborDistance(current, candidate, direction) {
    switch (direction) {
      case "left":
        if (candidate.x + candidate.width > current.x) {
          return null;
        }
        if (!intervalsOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height)) {
          return null;
        }
        return current.x - (candidate.x + candidate.width);
      case "right":
        if (candidate.x < current.x + current.width) {
          return null;
        }
        if (!intervalsOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height)) {
          return null;
        }
        return candidate.x - (current.x + current.width);
      case "up":
        if (candidate.y + candidate.height > current.y) {
          return null;
        }
        if (!intervalsOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width)) {
          return null;
        }
        return current.y - (candidate.y + candidate.height);
      case "down":
        if (candidate.y < current.y + current.height) {
          return null;
        }
        if (!intervalsOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width)) {
          return null;
        }
        return candidate.y - (current.y + current.height);
    }
    return null;
  }
  function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }
  function rectCenter(rect) {
    if (!isValidRect(rect)) {
      return null;
    }
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  var RELATIVE_GEOMETRY_EPSILON = 1e-6;
  function nearEdge(rect, axis) {
    return axis === "x" ? rect.x : rect.y;
  }
  function farEdge(rect, axis) {
    return axis === "x" ? rect.x + rect.width : rect.y + rect.height;
  }
  function perpStart(rect, axis) {
    return axis === "x" ? rect.y : rect.x;
  }
  function perpEnd(rect, axis) {
    return axis === "x" ? rect.y + rect.height : rect.x + rect.width;
  }
  function nearlyEqual(a, b) {
    return Math.abs(a - b) <= RELATIVE_GEOMETRY_EPSILON;
  }
  function planEqualSplit(parent, a, b, axis) {
    if (!isValidRect(parent) || !isValidRect(a) || !isValidRect(b)) {
      return null;
    }
    const [first, second] = nearEdge(a, axis) <= nearEdge(b, axis) ? [a, b] : [b, a];
    if (nearlyEqual(nearEdge(first, axis), nearEdge(second, axis))) {
      return null;
    }
    if (!nearlyEqual(perpStart(first, axis), perpStart(parent, axis)) || !nearlyEqual(perpEnd(first, axis), perpEnd(parent, axis)) || !nearlyEqual(perpStart(second, axis), perpStart(parent, axis)) || !nearlyEqual(perpEnd(second, axis), perpEnd(parent, axis))) {
      return null;
    }
    if (!nearlyEqual(nearEdge(first, axis), nearEdge(parent, axis))) {
      return null;
    }
    if (!nearlyEqual(farEdge(first, axis), nearEdge(second, axis))) {
      return null;
    }
    if (!nearlyEqual(farEdge(second, axis), farEdge(parent, axis))) {
      return null;
    }
    const start = nearEdge(parent, axis);
    const end = farEdge(parent, axis);
    const midpoint = start + (end - start) / 2;
    const firstTarget = axis === "x" ? { x: start, y: first.y, width: midpoint - start, height: first.height } : { x: first.x, y: start, width: first.width, height: midpoint - start };
    const secondTarget = axis === "x" ? { x: midpoint, y: second.y, width: end - midpoint, height: second.height } : { x: second.x, y: midpoint, width: second.width, height: end - midpoint };
    return { axis, first: firstTarget, second: secondTarget };
  }
  function equalAlongAxis(a, b, axis) {
    const aExtent = axis === "x" ? a.width : a.height;
    const bExtent = axis === "x" ? b.width : b.height;
    return Math.abs(aExtent - bExtent) <= RELATIVE_GEOMETRY_EPSILON;
  }
  function classifyDirection(point, rect) {
    if (!isValidPoint(point)) {
      return reject2("invalid-numbers", "pointer coordinates must be finite");
    }
    if (!isValidRect(rect)) {
      return reject2("invalid-geometry", "rect must have positive finite width and height");
    }
    const fx = (point.x - rect.x) / rect.width;
    const fy = (point.y - rect.y) / rect.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) {
      return reject2("pointer-outside", "pointer is outside the rect (half-open containment)");
    }
    const dx = fx - 0.5;
    const dy = fy - 0.5;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.25) {
      return { ok: true, value: { kind: "center" } };
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { ok: true, value: { kind: "direction", direction: dx < 0 ? "left" : "right" } };
    }
    return { ok: true, value: { kind: "direction", direction: dy < 0 ? "up" : "down" } };
  }
  function oppositeDirection(direction) {
    switch (direction) {
      case "left":
        return "right";
      case "right":
        return "left";
      case "up":
        return "down";
      case "down":
        return "up";
    }
  }
  function planKeyboardInsertion(request) {
    if (!isValidRect(request.focusedLeaf.geometry)) {
      return reject2("invalid-geometry", "focused leaf geometry must be positive and finite");
    }
    if (request.focusedLeaf.isLayout) {
      return reject2("ineligible-target", "focused leaf must not be a layout container");
    }
    if (request.focusedLeaf.windows.length === 0) {
      return reject2("empty-target", "focused leaf is empty");
    }
    if (!request.focusedLeaf.windows.some((window) => window.id === request.focusedWindow.id)) {
      return reject2("mismatched-state", "focused window is not associated with the focused leaf");
    }
    if (request.focusedLeaf.windows.some((window) => !isEligibleWindow(window))) {
      return reject2("ineligible-target", "focused leaf contains an ineligible window");
    }
    if (!isEligibleWindow(request.incoming)) {
      return reject2("ineligible-window", "incoming window is not eligible");
    }
    if (request.incoming.id === request.focusedWindow.id) {
      return reject2("same-window", "incoming window is the focused window");
    }
    if (request.focusedLeaf.windows.some((window) => window.id === request.incoming.id)) {
      return reject2("same-leaf", "incoming window already occupies the focused leaf");
    }
    if (request.record !== null) {
      if (!sameScope2(request.record.scope, request.scope)) {
        return reject2("cross-scope", "recorded scope differs from the current scope");
      }
      if (request.record.leafId !== request.focusedLeaf.id) {
        return reject2("stale-state", "recorded leaf no longer matches the focused leaf");
      }
      if (request.record.windowId !== request.focusedWindow.id) {
        return reject2("stale-state", "recorded window no longer matches the focused window");
      }
    }
    return {
      ok: true,
      value: {
        kind: "keyboard-insertion",
        scope: request.scope,
        direction: request.direction,
        targetLeaf: request.focusedLeaf,
        targetWindow: request.focusedWindow,
        incoming: request.incoming,
        targetSide: oppositeDirection(request.direction),
        incomingSide: request.direction
      }
    };
  }
  function planGeometryDrop(request) {
    if (!isValidPoint(request.pointer)) {
      return reject2("invalid-numbers", "pointer coordinates must be finite");
    }
    if (!isValidRect(request.originLeaf.geometry)) {
      return reject2("invalid-geometry", "origin leaf geometry must be positive and finite");
    }
    if (!isValidRect(request.targetLeaf.geometry)) {
      return reject2("invalid-geometry", "target leaf geometry must be positive and finite");
    }
    if (request.originLeaf.id === request.targetLeaf.id) {
      return reject2("same-leaf", "origin and target leaf are the same");
    }
    if (request.targetLeaf.isLayout) {
      return reject2("ineligible-target", "target leaf must not be a layout container");
    }
    if (request.targetLeaf.windows.length > 2) {
      return reject2("invalid-leaf-count", "geometry drop target must hold the dragged window plus at most one occupant");
    }
    if (request.targetLeaf.windows.length === 2 && !request.targetLeaf.windows.some((window) => window.id === request.draggedWindow.id)) {
      return reject2("invalid-leaf-count", "a two-window target must hold the dragged window plus one occupant");
    }
    if (request.targetLeaf.windows.filter((window) => window.id === request.draggedWindow.id).length > 1) {
      return reject2("mismatched-state", "dragged window must appear at most once in the target leaf");
    }
    if (request.targetLeaf.windows.some((window) => !isEligibleWindow(window))) {
      return reject2("ineligible-target", "target leaf contains an ineligible window");
    }
    if (!isEligibleWindow(request.draggedWindow)) {
      return reject2("ineligible-window", "dragged window is not eligible");
    }
    if (request.originLeaf.windows.filter((window) => window.id === request.draggedWindow.id).length > 1) {
      return reject2("mismatched-state", "dragged window must appear at most once in the origin leaf");
    }
    if (request.record !== null) {
      if (!sameScope2(request.record.scope, request.scope)) {
        return reject2("cross-scope", "recorded scope differs from the current scope");
      }
      if (request.record.originLeafId !== request.originLeaf.id) {
        return reject2("stale-state", "recorded origin leaf no longer matches the origin leaf");
      }
      if (request.record.windowId !== request.draggedWindow.id) {
        return reject2("stale-state", "recorded window no longer matches the dragged window");
      }
    }
    if (request.targetLeaf.windows.length === 0) {
      return {
        ok: true,
        value: {
          kind: "geometry-drop-empty",
          scope: request.scope,
          originLeaf: request.originLeaf,
          targetLeaf: request.targetLeaf,
          selectedWindow: request.draggedWindow
        }
      };
    }
    const oppositeWindow = request.targetLeaf.windows.find((window) => window.id !== request.draggedWindow.id);
    if (oppositeWindow === void 0) {
      return reject2("invalid-leaf-count", "geometry drop target must hold exactly one occupant besides the dragged window");
    }
    const classified = classifyDirection(request.pointer, request.targetLeaf.geometry);
    if (!classified.ok) {
      return classified;
    }
    const direction = classified.value.kind === "center" ? "down" : classified.value.direction;
    return {
      ok: true,
      value: {
        kind: "geometry-drop",
        scope: request.scope,
        direction,
        originLeaf: request.originLeaf,
        targetLeaf: request.targetLeaf,
        selectedWindow: request.draggedWindow,
        oppositeWindow
      }
    };
  }
  function firstByOrder(leaves) {
    let best = null;
    for (const leaf of leaves) {
      if (best === null || compareLeaves(leaf, best) < 0) {
        best = leaf;
      }
    }
    return best;
  }
  function planAutomaticPlacement(request) {
    if (!isEligibleWindow(request.window)) {
      return reject2("ineligible-window", "window is not eligible");
    }
    const emptyLeaves = [];
    for (const leaf of request.leaves) {
      if (!isValidRect(leaf.geometry)) {
        return reject2("invalid-geometry", "leaf geometry must be positive and finite");
      }
      if (leaf.windows.some((window) => window.id === request.window.id)) {
        return reject2("same-window", "window already occupies a leaf");
      }
      if (leaf.isLayout) {
        continue;
      }
      if (leaf.windows.length === 0) {
        emptyLeaves.push(leaf);
      }
    }
    const selected = firstByOrder(emptyLeaves);
    if (selected === null) {
      return reject2("no-target", "no retained empty leaf is available");
    }
    return {
      ok: true,
      value: {
        kind: "auto-fill",
        scope: request.scope,
        leaf: selected,
        window: request.window,
        assignmentOnly: true
      }
    };
  }

  // src/layout-instructions.ts
  function reject3(message) {
    return { ok: false, reason: { kind: "invalid-blueprint", message } };
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function compileBlueprintInstructions(blueprint) {
    var _a;
    const splits = [];
    const leafPaths = [];
    const visited = /* @__PURE__ */ new Set();
    const failure2 = compileNode(blueprint, ["root"], splits, leafPaths, visited);
    if (failure2 !== null) {
      return reject3(failure2);
    }
    leafPaths.sort((a, b) => a.ordinal - b.ordinal);
    for (let ordinal = 0; ordinal < leafPaths.length; ordinal += 1) {
      if (((_a = leafPaths[ordinal]) == null ? void 0 : _a.ordinal) !== ordinal) {
        return reject3("leaf ordinals must be unique and contiguous from zero");
      }
    }
    return { ok: true, value: { splits, leafPaths } };
  }
  function compileNode(node, path, splits, leafPaths, visited) {
    if (!isRecord(node) || visited.has(node)) {
      return "blueprint must be an acyclic binary tree";
    }
    visited.add(node);
    if (node.kind === "leaf") {
      if (!Number.isInteger(node.ordinal) || typeof node.ordinal !== "number" || node.ordinal < 0) {
        return "leaf ordinal must be a non-negative integer";
      }
      leafPaths.push({ ordinal: node.ordinal, path: [...path] });
      return null;
    }
    if (node.kind !== "branch" || node.orientation !== "vertical" && node.orientation !== "horizontal") {
      return "blueprint node must be a leaf or an oriented branch";
    }
    const leftPath = [...path, "left"];
    const rightPath = [...path, "right"];
    splits.push({
      targetPath: [...path],
      orientation: node.orientation,
      leftPath: [...leftPath],
      rightPath: [...rightPath]
    });
    const leftFailure = compileNode(node.left, leftPath, splits, leafPaths, visited);
    if (leftFailure !== null) {
      return leftFailure;
    }
    return compileNode(node.right, rightPath, splits, leafPaths, visited);
  }

  // src/preset-catalog.ts
  var PRESET_KINDS = Object.freeze([
    "columns",
    "rows",
    "balanced-grid",
    "dwindle"
  ]);
  function reject4(kind, message) {
    return { ok: false, reason: { kind, message } };
  }
  function isPresetKind(value) {
    return PRESET_KINDS.some((kind) => kind === value);
  }
  function presetOrientation(kind) {
    switch (kind) {
      case "columns":
        return () => "horizontal";
      case "rows":
        return () => "vertical";
      case "balanced-grid":
        return (depth) => depth % 2 === 0 ? "horizontal" : "vertical";
    }
  }
  function freezeDeep(value) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      if (typeof child === "object" && child !== null) {
        freezeDeep(child);
      }
    }
  }
  function buildPreset(kind, count) {
    if (!isPresetKind(kind)) {
      return reject4(
        "invalid-preset-kind",
        "preset kind must be columns, rows, balanced-grid, or dwindle"
      );
    }
    if (!Number.isSafeInteger(count) || count <= 0) {
      return reject4("invalid-leaf-count", "leaf count must be a positive safe integer");
    }
    const blueprint = kind === "dwindle" ? buildDwindleBlueprint(count) : buildBlueprintByDepth(count, presetOrientation(kind));
    if (!blueprint.ok) {
      return blueprint;
    }
    const instructions = compileBlueprintInstructions(blueprint.value);
    if (!instructions.ok) {
      return instructions;
    }
    freezeDeep(instructions.value);
    return Object.freeze({ ok: true, value: instructions.value });
  }

  // src/topology-reset.ts
  function validSnapshot(snapshot, root) {
    if (snapshot.root !== root || snapshot.tiles.length === 0) {
      return false;
    }
    const known = /* @__PURE__ */ new Set();
    let rootCount = 0;
    for (const entry of snapshot.tiles) {
      if (known.has(entry.tile)) {
        return false;
      }
      known.add(entry.tile);
      if (entry.tile === root) {
        rootCount += 1;
      }
      const children = /* @__PURE__ */ new Set();
      const occupants = /* @__PURE__ */ new Set();
      for (const child of entry.children) {
        if (child === entry.tile || children.has(child)) {
          return false;
        }
        children.add(child);
      }
      for (const occupant of entry.occupants) {
        if (occupants.has(occupant)) {
          return false;
        }
        occupants.add(occupant);
      }
    }
    return rootCount === 1;
  }
  function removableLeaf(snapshot) {
    for (let index = snapshot.tiles.length - 1; index >= 0; index -= 1) {
      const entry = snapshot.tiles[index];
      if (entry !== void 0 && entry.removable && entry.children.length === 0 && entry.occupants.length === 0) {
        return entry;
      }
    }
    return null;
  }
  function collapseToRootLeaf(seam) {
    const first = seam.snapshot();
    if (first === null || !validSnapshot(first, first.root)) {
      return { ok: false, stage: "pre-mutation-rejection", removed: 0 };
    }
    const root = first.root;
    let unmanaged = 0;
    for (const entry of first.tiles) {
      for (const occupant of entry.occupants) {
        let unmanagedCurrent = false;
        try {
          unmanagedCurrent = seam.unmanage(entry.tile, occupant);
        } catch (error) {
          void error;
          return {
            ok: false,
            stage: unmanaged === 0 ? "pre-mutation-rejection" : "reset-may-have-mutated",
            removed: 0
          };
        }
        if (!unmanagedCurrent) {
          return {
            ok: false,
            stage: unmanaged === 0 ? "pre-mutation-rejection" : "reset-may-have-mutated",
            removed: 0
          };
        }
        unmanaged += 1;
      }
    }
    let removed = 0;
    while (true) {
      const snapshot = seam.snapshot();
      if (snapshot === null || !validSnapshot(snapshot, root)) {
        return { ok: false, stage: "reset-may-have-mutated", removed };
      }
      if (snapshot.tiles.length === 1) {
        const only = snapshot.tiles[0];
        if (only !== void 0 && only.tile === root && only.children.length === 0 && only.occupants.length === 0) {
          return { ok: true, removed };
        }
        return { ok: false, stage: "reset-may-have-mutated", removed };
      }
      const leaf = removableLeaf(snapshot);
      if (leaf === null) {
        return { ok: false, stage: "reset-may-have-mutated", removed };
      }
      let removedLeaf = false;
      try {
        removedLeaf = seam.remove(leaf.tile);
      } catch (error) {
        void error;
        return { ok: false, stage: "reset-may-have-mutated", removed };
      }
      if (!removedLeaf) {
        return { ok: false, stage: "reset-may-have-mutated", removed };
      }
      removed += 1;
      const after = seam.snapshot();
      if (after === null || !validSnapshot(after, root) || after.tiles.length >= snapshot.tiles.length) {
        return { ok: false, stage: "reset-may-have-mutated", removed };
      }
    }
  }

  // src/controller.ts
  var MAX_TILES = MAX_SEQUENTIAL_LENGTH;
  var HORIZONTAL_LAYOUT_DIRECTION2 = 1;
  var VERTICAL_LAYOUT_DIRECTION2 = 2;
  var DIAGNOSTIC_PREFIX = "plasma-auto-tiler:";
  var MINIMUM_TILE_FRACTION = 0.15;
  var WORK_AREA_CLIENT_AREA_OPTION = 5;
  var FLOAT_WORK_AREA_FRACTION = 0.6;
  var DESKTOP_SCOPE_REEVALUATION_DELAY_MS = 50;
  var MAX_YIELD_REARM_PER_PHASE = 2;
  function windowInScope(window, scope) {
    if (!isWindow(window)) {
      return false;
    }
    if (!window.normalWindow || !window.managed || !window.resizeable || window.appletPopup || window.output !== scope.output) {
      return false;
    }
    const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
    return desktops.ok && desktops.value.some((desktop) => desktop.id === scope.scope.desktopId);
  }
  function desktopScopeCheck(window, scope) {
    const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
    if (!desktops.ok) {
      return "decode-failed";
    }
    if (desktops.value.length === 0) {
      return "no-desktops";
    }
    return desktops.value.some((desktop) => desktop.id === scope.scope.desktopId) ? "match" : "no-match";
  }
  function orderedDesktops(desktops) {
    const indexed = desktops.map((desktop, index) => ({ desktop, number: desktopNumber(desktop), index }));
    const allNumbered = indexed.every((entry) => entry.number !== null);
    const ordered = allNumbered ? indexed.slice().sort((a, b) => a.number - b.number) : indexed.slice().sort((a, b) => a.index - b.index);
    return ordered.map((entry) => entry.desktop);
  }
  function describeWorkspaceFailure(error) {
    if (error instanceof Error) {
      return error.message === "" ? error.name : error.message;
    }
    return String(error);
  }
  function decodeLeaves(root, decodedBoundary) {
    const pending = [root];
    const visited = /* @__PURE__ */ new Set([root]);
    const leaves = [];
    while (pending.length > 0) {
      const tile = pending.pop();
      if (tile === void 0) {
        return null;
      }
      const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
      if (!children.ok) {
        return null;
      }
      decodedBoundary("tile-children");
      for (const child of children.value) {
        if (visited.has(child)) {
          return null;
        }
        if (visited.size >= MAX_TILES) {
          return null;
        }
        visited.add(child);
        pending.push(child);
      }
      if (!tile.isLayout) {
        const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
          return null;
        }
        decodedBoundary("tile-occupancy");
        leaves.push({ tile, windows: windows.value });
      }
    }
    return leaves;
  }
  function decodeTileTree(root) {
    const pending = [root];
    const visited = /* @__PURE__ */ new Set([root]);
    const tiles = [root];
    while (pending.length > 0) {
      const tile = pending.pop();
      if (tile === void 0) {
        return null;
      }
      const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
      if (!children.ok) {
        return null;
      }
      for (const child of children.value) {
        if (visited.has(child)) {
          return null;
        }
        if (visited.size >= MAX_TILES) {
          return null;
        }
        visited.add(child);
        tiles.push(child);
        pending.push(child);
      }
    }
    return tiles;
  }
  function decodeUsableLeaves(root) {
    const tiles = decodeTileTree(root);
    if (tiles === null) {
      return null;
    }
    const leaves = [];
    for (const tile of tiles) {
      if (!tile.isLayout) {
        const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
          return null;
        }
        leaves.push({ tile, windows: windows.value });
        continue;
      }
      if (tile !== root) {
        continue;
      }
      const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
      if (!children.ok) {
        return null;
      }
      if (children.value.length === 0) {
        const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
          return null;
        }
        leaves.push({ tile, windows: windows.value });
      }
    }
    return leaves;
  }
  function collectPresetLeaves(root) {
    if (!isCustomTile(root)) {
      return null;
    }
    if (!root.isLayout) {
      return [root];
    }
    const children = decodeSequential(root.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
    if (!children.ok || children.value.length !== 2) {
      return null;
    }
    const left = children.value[0];
    const right = children.value[1];
    if (left === void 0 || right === void 0) {
      return null;
    }
    const leftLeaves = collectPresetLeaves(left);
    if (leftLeaves === null) {
      return null;
    }
    const rightLeaves = collectPresetLeaves(right);
    if (rightLeaves === null) {
      return null;
    }
    return [...leftLeaves, ...rightLeaves];
  }
  function makeOperationLeaves(leaves) {
    const result = [];
    let windowIndex2 = 0;
    for (let tileIndex = 0; tileIndex < leaves.length; tileIndex += 1) {
      const decoded = leaves[tileIndex];
      if (decoded === void 0) {
        return [];
      }
      const refs = [];
      for (const window of decoded.windows) {
        refs.push({
          id: `window-${windowIndex2}`,
          normal: window.normalWindow,
          managed: window.managed
        });
        windowIndex2 += 1;
      }
      result.push({
        decoded,
        windows: decoded.windows,
        refs,
        leaf: {
          id: `tile-${tileIndex}`,
          isLayout: decoded.tile.isLayout,
          geometry: decoded.tile.absoluteGeometry,
          windows: refs
        }
      });
    }
    return result;
  }
  function operationLeafForTile(leaves, tile) {
    for (const leaf of leaves) {
      if (leaf.decoded.tile === tile) {
        return leaf;
      }
    }
    return null;
  }
  function windowIndex(windows, target) {
    for (let index = 0; index < windows.length; index += 1) {
      if (windows[index] === target) {
        return index;
      }
    }
    return -1;
  }
  function targetOccupantForActive(target, active) {
    if (windowIndex(target.windows, active) >= 0) {
      return { window: active, usesActiveWrapper: true };
    }
    if (target.windows.length !== 1) {
      return null;
    }
    const occupant = target.windows[0];
    return occupant === void 0 ? null : { window: occupant, usesActiveWrapper: false };
  }
  function ordinalClass(ordinal) {
    return ordinal === 0 ? "first" : "later";
  }
  function orderedChildren(children, axis) {
    const first = children[0];
    const second = children[1];
    if (first === void 0 || second === void 0 || children.length !== 2) {
      return null;
    }
    const firstGeometry = first.absoluteGeometry;
    const secondGeometry = second.absoluteGeometry;
    if (firstGeometry.width <= 0 || firstGeometry.height <= 0 || secondGeometry.width <= 0 || secondGeometry.height <= 0 || firstGeometry[axis] === secondGeometry[axis]) {
      return null;
    }
    return firstGeometry[axis] < secondGeometry[axis] ? [first, second] : [second, first];
  }
  function sameGeometry(a, b) {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }
  function positiveGeometry(geometry) {
    return geometry.width > 0 && geometry.height > 0;
  }
  function formatCoordinate(value) {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "non-finite";
  }
  function formatPoint(point) {
    return `${formatCoordinate(point.x)},${formatCoordinate(point.y)}`;
  }
  function dragGeometryBail(target) {
    switch (target.kind) {
      case "center-unresolved":
        return "drag-bail:center-unresolved";
      case "no-target-leaf":
        return `drag-bail:no-target-leaf:${formatPoint(target.center)}`;
      case "target-is-origin":
        return `drag-bail:target-is-origin:${formatPoint(target.center)}`;
      case "leaf-not-in-topology":
        return `drag-bail:leaf-not-in-topology:${formatPoint(target.center)}`;
    }
  }
  var SNAPSHOT_CAPTION_LIMIT = 40;
  function snapshotCaption(value) {
    const caption = typeof value === "string" ? value : "";
    return caption.length > SNAPSHOT_CAPTION_LIMIT ? caption.slice(0, SNAPSHOT_CAPTION_LIMIT) : caption;
  }
  function splitDirection2(direction) {
    return direction === "left" || direction === "right" ? HORIZONTAL_LAYOUT_DIRECTION2 : VERTICAL_LAYOUT_DIRECTION2;
  }
  function layoutDirectionFor(orientation) {
    return orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION2 : VERTICAL_LAYOUT_DIRECTION2;
  }
  function dwindleNodeMatches(tile, node, depth) {
    if (node.kind === "leaf") {
      return !tile.isLayout;
    }
    if (!tile.isLayout) {
      return false;
    }
    const expected = depth % 2 === 0 ? HORIZONTAL_LAYOUT_DIRECTION2 : VERTICAL_LAYOUT_DIRECTION2;
    if (tile.layoutDirection !== expected) {
      return false;
    }
    const children = decodeSequential(tile.tiles, isCustomTile, 2);
    if (!children.ok || children.value.length !== 2) {
      return false;
    }
    const first = children.value[0];
    const second = children.value[1];
    if (first === void 0 || second === void 0) {
      return false;
    }
    return dwindleNodeMatches(first, node.left, depth + 1) && dwindleNodeMatches(second, node.right, depth + 1) || dwindleNodeMatches(first, node.right, depth + 1) && dwindleNodeMatches(second, node.left, depth + 1);
  }
  function dwindleOccupancyMatches(scope, leaves, population) {
    if (leaves.length !== population.length) {
      return false;
    }
    const occupied = /* @__PURE__ */ new Set();
    for (const leaf of leaves) {
      let occupants = 0;
      for (const value of leaf.windows) {
        if (windowInScope(value, scope) && value.tile === leaf.tile) {
          occupants += 1;
          occupied.add(value);
        }
      }
      if (occupants !== 1) {
        return false;
      }
    }
    for (const window of population) {
      if (!occupied.has(window)) {
        return false;
      }
    }
    return true;
  }
  function dwindleBijectionTreeMatches(scope, root, population) {
    const leaves = decodeUsableLeaves(root);
    if (leaves === null) {
      return false;
    }
    return dwindleOccupancyMatches(scope, leaves, population);
  }
  var TileController = class {
    constructor(environment) {
      this.environment = environment;
      this.gate = new FeatureGate();
      this.pending = new TransientState();
      this.drag = new TransientState();
      this.interactiveWindows = /* @__PURE__ */ new Map();
      // Per-window fullscreen watch disconnects and enter/exit records. Both are
      // bounded like the other identity sets so they cannot grow without limit.
      this.fullscreenWatches = /* @__PURE__ */ new Map();
      this.fullscreenWindows = /* @__PURE__ */ new Map();
      // Per-window tiled-maximize cover records. A maximized window keeps its
      // tile assignment and covers the work area; the record carries the owning
      // desktop scope. Bounded like the other identity sets.
      this.maximizedWindows = /* @__PURE__ */ new Map();
      // Per-window `maximizedChanged` watch disconnects for startup-native
      // maximized records, observed to clear the classification on a real native
      // unmaximize. Bounded like the other identity sets.
      this.maximizeWatches = /* @__PURE__ */ new Map();
      this.deferredEligibility = /* @__PURE__ */ new Map();
      this.decodedBoundaries = /* @__PURE__ */ new Set();
      this.onceDiagnostics = /* @__PURE__ */ new Set();
      this.selectedOverlays = /* @__PURE__ */ new Map();
      // Windows removed since the last reflow read of their scope. Removal can
      // arrive while KWin still lists the window in its tile's window array;
      // this bounded identity guard keeps the reflow from ever reassigning a
      // removed window. Entries for settled (array-absent) windows are never
      // consulted and the set is capped so it cannot grow unboundedly.
      this.removedOccupants = /* @__PURE__ */ new Set();
      // Per-output/per-desktop session-local managed-scope ownership for
      // automatic ratio-free dwindle. A scope is managed only when it holds
      // owned windows; a failed or damaged scope is recorded inert for the
      // session and never retried.
      this.managedScopes = /* @__PURE__ */ new Map();
      // Deferred dwindle reconstructions awaiting their one-shot event-loop
      // yields between the removals-only collapse and the splits-only rebuild.
      this.pendingRebuilds = /* @__PURE__ */ new Map();
      // Explicitly detached windows (the detach action writes `window.tile` to
      // null) are excluded from the owned population and the dwindle rebuild.
      // Bounded like removedOccupants so it cannot grow without limit.
      this.detachedWindows = /* @__PURE__ */ new Set();
      // Session-local floating state. A floating window left its tile through
      // `tile.unmanage(window)` with its vacated leaf retained; it is excluded
      // from automatic placement, bijection, drag, and reconstruction window-set
      // comparisons. `floatScopes` records the exact scope where each floating
      // window's preserved leaf lives so invariant checks can tolerate the
      // vacated leaves. Sticky windows are always also floating. Bounded like the
      // other identity sets.
      this.floatingWindows = /* @__PURE__ */ new Set();
      this.floatScopes = /* @__PURE__ */ new Map();
      // Session-local sticky state: pinned across all workspaces, floating only.
      // A strict subset of `floatingWindows`; sticky implies floating.
      this.stickyWindows = /* @__PURE__ */ new Set();
      // Last floated geometry per window for the session, restored on re-float
      // and across sticky toggles and a fullscreen round trip.
      this.floatGeometries = /* @__PURE__ */ new Map();
      // Scopes whose dwindle invariant check was deferred while a live drag was
      // in progress. Each scope owes exactly one later check, run once the
      // tracked drag window is no longer live-moving/resizing.
      this.owedInvariantScopes = /* @__PURE__ */ new Map();
      // Session-only script-owned virtual desktops (by desktop id). A desktop the
      // controller appended via Meta+0 / Meta+Shift+0 is owned for this session
      // only; no identity survives restart and pre-existing desktops are never
      // owned or removed. Cleanup may only ever remove owned desktops.
      this.ownedDesktopIds = /* @__PURE__ */ new Set();
      // Cross-workspace tile moves awaiting their destination adoption yield.
      // Cleanup is deferred while any move is unsettled so a desktop is never
      // removed under a window that is still being re-placed.
      this.pendingMoves = /* @__PURE__ */ new Set();
      // Re-entrancy guard for desktop reconciliation: createDesktop and
      // removeDesktop both re-fire desktopsChanged synchronously, and a
      // mid-mutation list (desktop created but not yet owned, or partially
      // removed) must never re-drive a second reconcile. Reconciliation is
      // idempotent, so the guard only prevents a nested re-entry, never skips
      // owed work.
      this.reconcilingDesktops = false;
      // Deferred user trailing-empty creation requests (see PendingDesktopIntent).
      // Bounded like the other controller queues.
      this.pendingDesktopIntents = [];
    }
    get isEnabled() {
      return this.gate.isEnabled;
    }
    get hasPendingKeyboard() {
      return this.pending.current !== void 0;
    }
    get hasActiveDrag() {
      return this.drag.current !== void 0;
    }
    // Narrow read/self-validation seam for a future bounded assignment-only
    // reflow. The overlay for the exact scope is returned only when its
    // recorded root and ordinal leaves remain intact beneath the same current
    // Custom Tile root. Structural drift is discarded inertly with one fixed
    // private diagnostic; reading never mutates topology or assignments.
    readSelectedOverlay(scope) {
      const byDesktop = this.selectedOverlays.get(scope.output);
      const overlay = byDesktop == null ? void 0 : byDesktop.get(scope.desktop.id);
      if (overlay === void 0) {
        return null;
      }
      if (!this.selectedOverlayValid(overlay)) {
        byDesktop == null ? void 0 : byDesktop.delete(scope.desktop.id);
        this.diagnostic("selected-overlay-invalidated");
        return null;
      }
      return overlay;
    }
    diagnostic(event) {
      try {
        this.environment.log(`${DIAGNOSTIC_PREFIX}${event}`);
      } catch (error) {
        void error;
      }
    }
    decodedBoundary(kind) {
      if (this.decodedBoundaries.has(kind)) {
        return;
      }
      this.decodedBoundaries.add(kind);
      this.diagnostic(`boundary-decoded:${kind}`);
    }
    onceDiagnostic(event) {
      if (this.onceDiagnostics.has(event)) {
        return;
      }
      this.onceDiagnostics.add(event);
      this.diagnostic(event);
    }
    disabled(reason) {
      this.diagnostic(`disabled:${reason}`);
    }
    start() {
      this.gate.run(() => {
        this.environment.onWindowAdded((window) => this.handleWindowAdded(window));
        this.environment.onWindowRemoved((window) => this.handleWindowRemoved(window));
        this.environment.onScreensChanged(() => this.handleScopeChange());
        this.environment.onCurrentDesktopChanged(() => this.handleScopeChange());
        this.environment.onDesktopsChanged(() => this.handleDesktopsChanged());
        this.adoptStartupFloatingWindows();
        this.attachExistingInteractiveWindows(true);
        const insertionRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-insert-right",
          "Insert next window right of focused leaf",
          "Meta+Alt+Right",
          () => this.armKeyboardInsertion("right")
        );
        const insertionLeftRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-insert-left",
          "Insert next window left of focused leaf",
          "Meta+Alt+Left",
          () => this.armKeyboardInsertion("left")
        );
        const insertionUpRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-insert-up",
          "Insert next window up of focused leaf",
          "Meta+Alt+Up",
          () => this.armKeyboardInsertion("up")
        );
        const insertionDownRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-insert-down",
          "Insert next window down of focused leaf",
          "Meta+Alt+Down",
          () => this.armKeyboardInsertion("down")
        );
        const leftRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-left",
          "Focus window left",
          "Meta+H",
          () => this.focusNeighbor("left")
        );
        const downRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-down",
          "Focus window down",
          "Meta+J",
          () => this.focusNeighbor("down")
        );
        const upRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-up",
          "Focus window up",
          "Meta+K",
          () => this.focusNeighbor("up")
        );
        const rightRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-right",
          "Focus window right",
          "Meta+Alt+Ctrl+L",
          () => this.focusNeighbor("right")
        );
        const focusLeftArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-left-arrow",
          "Focus window left (arrow)",
          "Meta+Left",
          () => this.focusNeighbor("left")
        );
        const focusDownArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-down-arrow",
          "Focus window down (arrow)",
          "Meta+Down",
          () => this.focusNeighbor("down")
        );
        const focusUpArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-up-arrow",
          "Focus window up (arrow)",
          "Meta+Up",
          () => this.focusNeighbor("up")
        );
        const focusRightArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-focus-right-arrow",
          "Focus window right (arrow)",
          "Meta+Right",
          () => this.focusNeighbor("right")
        );
        const moveLeftRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-left",
          "Move window left",
          "Meta+Shift+H",
          () => this.moveActiveWindow("left")
        );
        const moveDownRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-down",
          "Move window down",
          "Meta+Shift+J",
          () => this.moveActiveWindow("down")
        );
        const moveUpRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-up",
          "Move window up",
          "Meta+Shift+K",
          () => this.moveActiveWindow("up")
        );
        const moveRightRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-right",
          "Move window right",
          "Meta+Shift+L",
          () => this.moveActiveWindow("right")
        );
        const moveLeftArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-left-arrow",
          "Move window left (arrow)",
          "Meta+Shift+Left",
          () => this.moveActiveWindow("left")
        );
        const moveDownArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-down-arrow",
          "Move window down (arrow)",
          "Meta+Shift+Down",
          () => this.moveActiveWindow("down")
        );
        const moveUpArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-up-arrow",
          "Move window up (arrow)",
          "Meta+Shift+Up",
          () => this.moveActiveWindow("up")
        );
        const moveRightArrowRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-right-arrow",
          "Move window right (arrow)",
          "Meta+Shift+Right",
          () => this.moveActiveWindow("right")
        );
        const detachRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-detach",
          "Detach window from tile",
          "Meta+Shift+Space",
          () => this.detachActiveWindow()
        );
        const attachRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-attach",
          "Attach window to available tile",
          "Meta+Alt+Shift+Space",
          () => this.attachActiveWindow()
        );
        const floatRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-float-toggle",
          "Float or tile active window",
          "Meta+G",
          () => this.floatActiveWindow()
        );
        const stickyRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-sticky-toggle",
          "Toggle sticky floating on all desktops",
          "Meta+Shift+G",
          () => this.stickyActiveWindow()
        );
        const maximizeRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-maximize",
          "Maximize active window in its workspace",
          "Meta+M",
          () => this.maximizeActiveWindow()
        );
        const fillScopeRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-fill-scope",
          "Fill available tiles with windows",
          "Meta+Alt+Return",
          () => this.fillScope()
        );
        const columnsRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-apply-columns",
          "Apply columns in focused leaf",
          "Meta+Alt+1",
          () => this.applyPreset("columns")
        );
        const rowsRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-apply-rows",
          "Apply rows in focused leaf",
          "Meta+Alt+2",
          () => this.applyPreset("rows")
        );
        const gridRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-apply-balanced-grid",
          "Apply balanced grid in focused leaf",
          "Meta+Alt+3",
          () => this.applyPreset("balanced-grid")
        );
        const dwindleRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-apply-dwindle",
          "Apply dwindle in focused leaf",
          "Meta+Alt+4",
          () => this.applyPreset("dwindle")
        );
        const workspaceRegistrations = [];
        for (let index = 1; index <= 9; index += 1) {
          workspaceRegistrations.push(
            this.environment.registerShortcut(
              `plasma-auto-tiler-workspace-${index}`,
              `Focus workspace ${index}`,
              `Meta+${index}`,
              () => this.navigateWorkspace(index)
            )
          );
        }
        for (let index = 1; index <= 9; index += 1) {
          workspaceRegistrations.push(
            this.environment.registerShortcut(
              `plasma-auto-tiler-move-workspace-${index}`,
              `Move window to workspace ${index}`,
              `Meta+Shift+${index}`,
              () => this.moveActiveToWorkspace(index)
            )
          );
        }
        const appendRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-workspace-append",
          "Append and focus a new workspace",
          "Meta+0",
          () => this.appendWorkspace()
        );
        const moveAppendRegistered = this.environment.registerShortcut(
          "plasma-auto-tiler-move-workspace-append",
          "Move window to a newly appended workspace",
          "Meta+Shift+0",
          () => this.moveActiveToWorkspace(0)
        );
        const workspaceRegistrationsOk = workspaceRegistrations.every((registered) => registered) && appendRegistered && moveAppendRegistered;
        if (!insertionRegistered || !insertionLeftRegistered || !insertionUpRegistered || !insertionDownRegistered || !leftRegistered || !downRegistered || !upRegistered || !rightRegistered || !focusLeftArrowRegistered || !focusDownArrowRegistered || !focusUpArrowRegistered || !focusRightArrowRegistered || !moveLeftRegistered || !moveDownRegistered || !moveUpRegistered || !moveRightRegistered || !moveLeftArrowRegistered || !moveDownArrowRegistered || !moveUpArrowRegistered || !moveRightArrowRegistered || !detachRegistered || !attachRegistered || !floatRegistered || !stickyRegistered || !maximizeRegistered || !fillScopeRegistered || !columnsRegistered || !rowsRegistered || !gridRegistered || !dwindleRegistered || !workspaceRegistrationsOk) {
          this.gate.disable("shortcut-registration-failed", (reason) => this.disabled(reason));
          return;
        }
        this.diagnostic("shortcut-registered");
        this.diagnostic("startup-handlers-ready");
        this.engageCurrentScope();
      }, (reason) => this.disabled(reason));
    }
    // Each directional insertion action arms exactly one pending insertion from
    // the active eligible in-scope occupant of the focused non-layout leaf. A
    // re-arm atomically replaces the source and the recorded direction, so a
    // later arm always supersedes an earlier one.
    armKeyboardInsertion(direction) {
      this.gate.run(() => {
        this.diagnostic("keyboard-invoked");
        const hadPending = this.pending.current !== void 0;
        this.clearPending();
        if (hadPending) {
          this.diagnostic("keyboard-pending-replaced");
        }
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("keyboard-rejected:no-active-window");
          return;
        }
        if (isWindow(active) && active.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("keyboard-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("keyboard-rejected:active-window-eligibility");
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`keyboard-rejected:${reason}`);
        });
        if (topology === null || active.tile === null || !isTile(active.tile)) {
          if (topology !== null) {
            this.diagnostic("keyboard-rejected:active-tile-association");
          }
          return;
        }
        const target = operationLeafForTile(topology, active.tile);
        if (target === null || target.leaf.isLayout) {
          this.diagnostic("keyboard-rejected:target-occupancy-validity");
          return;
        }
        for (const occupant of target.windows) {
          if (!windowInScope(occupant, scope)) {
            this.diagnostic("keyboard-rejected:target-occupancy-validity");
            return;
          }
        }
        const targetOccupant = targetOccupantForActive(target, active);
        if (targetOccupant === null) {
          this.diagnostic("keyboard-rejected:target-occupancy-validity");
          return;
        }
        const disconnect = this.environment.onPendingTargetChanged(targetOccupant.window, () => this.clearPending());
        this.pending.set({
          scope,
          sourceWindow: active,
          targetWindow: targetOccupant.window,
          targetTile: active.tile,
          direction,
          disconnect
        });
        if (!targetOccupant.usesActiveWrapper) {
          this.diagnostic("keyboard-armed:target-occupant-wrapper");
        }
        this.diagnostic("keyboard-armed");
      }, (reason) => this.disabled(reason));
    }
    focusNeighbor(direction) {
      this.gate.run(() => {
        this.diagnostic("focus-invoked");
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("focus-rejected:no-active-window");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("focus-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("focus-rejected:active-window-eligibility");
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`focus-rejected:${reason}`);
        });
        if (topology === null) {
          return;
        }
        if (active.tile === null || !isTile(active.tile)) {
          this.diagnostic("focus-rejected:active-tile-association");
          return;
        }
        const focused = operationLeafForTile(topology, active.tile);
        if (focused === null || focused.leaf.isLayout || focused.windows.length === 0 || windowIndex(focused.windows, active) < 0) {
          this.diagnostic("focus-rejected:focused-occupancy-validity");
          return;
        }
        for (const occupant of focused.windows) {
          if (!windowInScope(occupant, scope)) {
            this.diagnostic("focus-rejected:focused-occupancy-validity");
            return;
          }
        }
        const candidates = topology.filter(
          (entry) => !entry.leaf.isLayout && entry.windows.length > 0 && entry.windows.every((occupant) => windowInScope(occupant, scope))
        ).map((entry) => entry.leaf);
        const neighborLeaf = findNeighborLeaf(candidates, focused.leaf, direction);
        if (neighborLeaf === null) {
          this.diagnostic("focus-rejected:no-neighbor");
          return;
        }
        let target = null;
        for (const entry of topology) {
          if (entry.leaf === neighborLeaf) {
            target = entry;
            break;
          }
        }
        if (target === null || target.leaf.isLayout || target.windows.length === 0) {
          this.diagnostic("focus-rejected:target-occupancy-validity");
          return;
        }
        for (const occupant of target.windows) {
          if (!windowInScope(occupant, scope)) {
            this.diagnostic("focus-rejected:target-occupancy-validity");
            return;
          }
        }
        const targetWindow = target.windows[0];
        if (targetWindow === void 0) {
          this.diagnostic("focus-rejected:target-occupancy-validity");
          return;
        }
        this.environment.setActiveWindow(targetWindow);
      }, (reason) => this.disabled(reason));
    }
    moveActiveWindow(direction) {
      this.gate.run(() => {
        this.diagnostic("move-invoked");
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("move-rejected:no-active-window");
          return;
        }
        if (isWindow(active) && active.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("move-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("move-rejected:active-window-eligibility");
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`move-rejected:${reason}`);
        });
        if (topology === null) {
          return;
        }
        if (active.tile === null || !isTile(active.tile)) {
          this.diagnostic("move-rejected:active-tile-association");
          return;
        }
        const source = operationLeafForTile(topology, active.tile);
        if (source === null || source.leaf.isLayout || source.windows.length !== 1 || windowIndex(source.windows, active) < 0 || topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1) {
          this.diagnostic("move-rejected:source-occupancy-validity");
          return;
        }
        for (const occupant of source.windows) {
          if (!windowInScope(occupant, scope)) {
            this.diagnostic("move-rejected:source-occupancy-validity");
            return;
          }
        }
        const candidates = topology.filter(
          (entry) => !entry.leaf.isLayout && entry.leaf !== source.leaf
        ).map((entry) => entry.leaf);
        const targetLeaf = findNeighborLeaf(candidates, source.leaf, direction);
        if (targetLeaf === null) {
          this.diagnostic("move-rejected:no-target");
          return;
        }
        let target = null;
        for (const entry of topology) {
          if (entry.leaf === targetLeaf) {
            target = entry;
            break;
          }
        }
        if (target === null || target.leaf.isLayout) {
          this.diagnostic("move-rejected:target-occupancy-validity");
          return;
        }
        if (target.windows.length === 0) {
          if (!this.moveAssignmentRevalidates(scope, active, source, target, direction)) {
            this.diagnostic("move-rejected:assignment-stale");
            return;
          }
          let assigned = false;
          try {
            assigned = manageTile(target.decoded.tile, active);
          } catch (error) {
            void error;
            this.diagnostic("move-rejected:assignment-failed");
            return;
          }
          if (!assigned) {
            this.diagnostic("move-rejected:assignment-failed");
            return;
          }
          this.diagnostic("move-completed");
          return;
        }
        this.swapToOccupiedTarget(scope, active, source, target, direction);
      }, (reason) => this.disabled(reason));
    }
    // Directional occupied-target swap: when the nearest ranked non-layout
    // directional leaf is occupied, its exactly-one eligible in-scope occupant
    // swaps with the active source. Two guarded `window.tile` writes each
    // revalidate immediately before the write, decode their postcondition, and
    // stop at the first failure. On a failed second write a single best-effort
    // restoration returns the source to its original leaf; no rollback is
    // claimed in any other path. Assignment-only: no topology method is ever
    // called.
    swapToOccupiedTarget(scope, active, source, target, direction) {
      this.diagnostic("move-swap-invoked");
      if (active.fullScreen === true) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (target.leaf.isLayout || target.windows.length !== 1) {
        this.diagnostic("move-rejected:swap-occupancy-validity");
        return;
      }
      const occupant = target.windows[0];
      if (occupant === void 0 || !windowInScope(occupant, scope)) {
        this.diagnostic("move-rejected:swap-occupant-ineligible");
        return;
      }
      if (occupant.fullScreen === true) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (!this.swapRevalidates(scope, active, occupant, source, target, direction, "before-first")) {
        this.diagnostic("move-swap-rejected:stale");
        return;
      }
      let firstAssigned = false;
      try {
        firstAssigned = assignWindowToTile(active, target.decoded.tile);
      } catch (error) {
        void error;
      }
      if (!firstAssigned) {
        this.diagnostic("move-swap-failed:first-write");
        return;
      }
      if (!this.swapRevalidates(scope, active, occupant, source, target, direction, "before-second")) {
        this.swapSecondWriteFailed(scope, active, source);
        return;
      }
      let secondAssigned = false;
      try {
        secondAssigned = assignWindowToTile(occupant, source.decoded.tile);
      } catch (error) {
        void error;
      }
      if (!secondAssigned) {
        this.swapSecondWriteFailed(scope, active, source);
        return;
      }
      if (!this.swapDecodesFinal(scope, active, occupant, source, target)) {
        this.swapSecondWriteFailed(scope, active, source);
        return;
      }
      this.diagnostic("move-swap-completed");
    }
    // Re-derives active identity, exact scope/root, both occupant associations,
    // and both leaf realizations immediately before a guarded swap write. The
    // expected leaf contents depend on the phase: before the first write the
    // source leaf holds only the active window and the target leaf only the
    // occupant; before the second write the source leaf is empty and the target
    // leaf briefly holds both (the pinned setTileCompatibility contract
    // evacuates-then-adds, so the destination leaf transiently double-occupies).
    swapRevalidates(scope, active, occupant, source, target, direction, phase) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope) || !windowInScope(active, freshScope) || !windowInScope(occupant, freshScope)) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null || active.tile === null || !isTile(active.tile) || occupant.tile === null || !isTile(occupant.tile) || occupant.tile !== target.decoded.tile) {
        return false;
      }
      const expectedActiveTile = phase === "before-first" ? source.decoded.tile : target.decoded.tile;
      if (active.tile !== expectedActiveTile) {
        return false;
      }
      const freshSource = operationLeafForTile(topology, source.decoded.tile);
      const freshTarget = operationLeafForTile(topology, target.decoded.tile);
      if (freshSource === null || freshTarget === null || freshSource.leaf.isLayout || freshTarget.leaf.isLayout) {
        return false;
      }
      if (phase === "before-first") {
        if (freshSource.windows.length !== 1 || windowIndex(freshSource.windows, active) < 0) {
          return false;
        }
        if (freshTarget.windows.length !== 1 || windowIndex(freshTarget.windows, occupant) < 0) {
          return false;
        }
      } else {
        if (freshSource.windows.length !== 0) {
          return false;
        }
        if (freshTarget.windows.length !== 2 || windowIndex(freshTarget.windows, active) < 0 || windowIndex(freshTarget.windows, occupant) < 0) {
          return false;
        }
      }
      if (active === occupant || topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1 || topology.filter((entry) => windowIndex(entry.windows, occupant) >= 0).length !== 1) {
        return false;
      }
      if (phase === "before-first") {
        const freshCandidates = topology.filter(
          (entry) => !entry.leaf.isLayout && entry.leaf !== freshSource.leaf
        ).map((entry) => entry.leaf);
        return findNeighborLeaf(freshCandidates, freshSource.leaf, direction) === freshTarget.leaf;
      }
      return true;
    }
    // Fresh decoded final postcondition: the occupant occupies the original
    // source leaf and the active source the target leaf, each leaf holding
    // exactly one window. No topology method is called.
    swapDecodesFinal(scope, active, occupant, source, target) {
      const topology = this.topologyForScope(scope);
      if (topology === null || active.tile !== target.decoded.tile || occupant.tile !== source.decoded.tile) {
        return false;
      }
      const freshSource = operationLeafForTile(topology, source.decoded.tile);
      const freshTarget = operationLeafForTile(topology, target.decoded.tile);
      if (freshSource === null || freshTarget === null || freshSource.leaf.isLayout || freshTarget.leaf.isLayout) {
        return false;
      }
      return freshSource.windows.length === 1 && windowIndex(freshSource.windows, occupant) >= 0 && freshTarget.windows.length === 1 && windowIndex(freshTarget.windows, active) >= 0;
    }
    // Second-write failure leaves the source in the target leaf (possible
    // stranded window): report the fixed diagnostic, then attempt exactly one
    // best-effort restoration of the source to its original leaf and report the
    // verified outcome. No rollback claim beyond that single guarded write.
    swapSecondWriteFailed(scope, active, source) {
      this.diagnostic("move-swap-failed:second-write");
      const restored = this.restoreSwapFirst(scope, active, source);
      if (restored && active.tile === source.decoded.tile) {
        this.diagnostic("move-swap-restored:verified");
      } else {
        this.diagnostic("move-swap-restored:unverified");
      }
    }
    // One guarded best-effort write returning the active source to its original
    // leaf after a failed second swap write. Active identity, exact scope,
    // fresh root/topology, original source leaf reachability/non-layout status,
    // and the active window's own association with an in-scope non-layout
    // decoded leaf are all re-derived first; any failure skips the write.
    restoreSwapFirst(scope, active, source) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope) || !windowInScope(active, freshScope)) {
        return false;
      }
      if (active.tile === null || !isTile(active.tile)) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null) {
        return false;
      }
      const freshSource = operationLeafForTile(topology, source.decoded.tile);
      if (freshSource === null || freshSource.leaf.isLayout) {
        return false;
      }
      const freshActive = operationLeafForTile(topology, active.tile);
      if (freshActive === null || freshActive.leaf.isLayout || windowIndex(freshActive.windows, active) < 0) {
        return false;
      }
      let restored = false;
      try {
        restored = assignWindowToTile(active, source.decoded.tile);
      } catch (error) {
        void error;
      }
      return restored;
    }
    detachActiveWindow() {
      this.gate.run(() => {
        this.diagnostic("detach-invoked");
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("detach-rejected:no-active-window");
          return;
        }
        if (isWindow(active) && active.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("detach-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("detach-rejected:active-window-eligibility");
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`detach-rejected:${reason}`);
        });
        if (topology === null) {
          return;
        }
        if (active.tile === null) {
          this.diagnostic("detach-rejected:no-tile");
          return;
        }
        if (!isCustomTile(active.tile)) {
          this.diagnostic("detach-rejected:active-tile-association");
          return;
        }
        if (active.tile.isLayout) {
          this.diagnostic("detach-rejected:layout-tile");
          return;
        }
        const origin = operationLeafForTile(topology, active.tile);
        if (origin === null || windowIndex(origin.windows, active) < 0) {
          this.diagnostic("detach-rejected:occupancy-validity");
          return;
        }
        const originTile = active.tile;
        if (!this.detachRevalidates(scope, active, originTile)) {
          this.diagnostic("detach-rejected:assignment-stale");
          return;
        }
        let detached = false;
        try {
          detached = detachWindowFromTile(active);
        } catch (error) {
          void error;
          this.diagnostic("detach-rejected:assignment-failed");
          return;
        }
        if (!detached) {
          this.diagnostic("detach-rejected:assignment-failed");
          return;
        }
        if (active.tile !== null) {
          this.diagnostic("detach-failed:postcondition");
          return;
        }
        this.diagnostic("detach-completed");
        this.recordDetached(active);
        this.reflowAfterDetach(scope, originTile);
      }, (reason) => this.disabled(reason));
    }
    // Active window identity, scope, eligibility, and the exact tile
    // association are all re-derived immediately before the single detach
    // write, so any change between selection and the write rejects without a
    // write.
    detachRevalidates(scope, active, originTile) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope) || !windowInScope(active, freshScope)) {
        return false;
      }
      if (active.tile !== originTile || !isCustomTile(active.tile) || active.tile.isLayout) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null) {
        return false;
      }
      const freshOrigin = operationLeafForTile(topology, originTile);
      return freshOrigin !== null && windowIndex(freshOrigin.windows, active) >= 0;
    }
    // Assignment-only inverse of detach: one guarded `window.tile = target`
    // write for the active eligible floating window into the deterministic
    // first available empty non-layout leaf of the exact scope. Never changes
    // topology or another occupant.
    attachActiveWindow() {
      this.gate.run(() => {
        this.diagnostic("attach-invoked");
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("attach-rejected:no-active-window");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("attach-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("attach-rejected:active-window-eligibility");
          return;
        }
        if (active.tile !== null) {
          this.diagnostic("attach-rejected:already-assigned");
          return;
        }
        if (this.isFloating(active)) {
          this.tileFloatingActive(scope, active);
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`attach-rejected:${reason}`);
        });
        if (topology === null) {
          return;
        }
        const target = this.firstEmptyLeaf(topology);
        if (target === null) {
          this.diagnostic("attach-rejected:no-available-tile");
          return;
        }
        if (!this.attachRevalidates(scope, active, target)) {
          this.diagnostic("attach-rejected:assignment-stale");
          return;
        }
        let assigned = false;
        try {
          assigned = assignWindowToTile(active, target.decoded.tile);
        } catch (error) {
          void error;
          this.diagnostic("attach-rejected:assignment-failed");
          return;
        }
        if (!assigned) {
          this.diagnostic("attach-rejected:assignment-failed");
          return;
        }
        if (active.tile !== target.decoded.tile) {
          this.diagnostic("attach-failed:postcondition");
          return;
        }
        this.diagnostic("attach-completed");
        this.detachedWindows.delete(active);
      }, (reason) => this.disabled(reason));
    }
    // Shared active-window guard for the float/sticky actions: every rejection
    // is an explicit reason log, and fullscreen windows are ignored through the
    // established fullscreen diagnostic. Returns the re-validated active window
    // and its scope, or null after emitting exactly one rejection reason.
    activeActionGuard(action) {
      const active = this.environment.activeWindow();
      if (active === null) {
        this.diagnostic(`${action}-rejected:no-active-window`);
        return null;
      }
      if (isWindow(active) && active.fullScreen === true) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return null;
      }
      if (!isWindow(active)) {
        this.diagnostic(`${action}-rejected:not-a-window`);
        return null;
      }
      if (!active.normalWindow) {
        this.diagnostic(`${action}-rejected:not-normal-window`);
        return null;
      }
      if (!active.managed) {
        this.diagnostic(`${action}-rejected:not-managed`);
        return null;
      }
      if (!active.resizeable) {
        this.diagnostic(`${action}-rejected:not-resizeable`);
        return null;
      }
      if (active.appletPopup) {
        this.diagnostic(`${action}-rejected:applet-popup`);
        return null;
      }
      const scope = this.scopeForWindow(active);
      if (scope === null) {
        this.diagnostic(`${action}-rejected:desktop-output-scope`);
        return null;
      }
      return { active, scope };
    }
    // Meta+G float/tile toggle. Floating leaves the tile tree intact: the
    // vacated leaf is retained (unmanage never collapses), the window leaves
    // the placement population, and its centered 60% work-area geometry (or the
    // session-remembered one, bounded to the work area) is written. Tiling back
    // uses the established `tile.manage()` adoption into the first available
    // empty leaf; capacity (no available leaf) and floor (assignment) failures
    // leave it floating with the exact reason logged. A sticky window being
    // tiled first clears its all-desktop pin because sticky implies floating.
    floatActiveWindow() {
      this.gate.run(() => {
        this.diagnostic("float-invoked");
        const guard = this.activeActionGuard("float");
        if (guard === null) {
          return;
        }
        if (this.maximizedWindows.has(guard.active)) {
          this.diagnostic("float-rejected:maximized");
          return;
        }
        if (guard.active.tile !== null) {
          if (!isCustomTile(guard.active.tile) || guard.active.tile.isLayout) {
            this.diagnostic("float-rejected:active-tile-association");
            return;
          }
          this.floatTiledActive(guard.scope, guard.active);
          return;
        }
        this.tileFloatingActive(guard.scope, guard.active);
      }, (reason) => this.disabled(reason));
    }
    // Float an already-tiled active window. Re-derives active identity, scope,
    // and the exact tile association immediately before the single unmanage
    // write, then writes the float geometry. No structural call is ever made.
    floatTiledActive(scope, active) {
      const originTile = active.tile;
      if (originTile === null || !isCustomTile(originTile) || originTile.isLayout) {
        this.diagnostic("float-rejected:active-tile-association");
        return;
      }
      if (!this.floatRevalidates(scope, active, originTile)) {
        this.diagnostic("float-rejected:assignment-stale");
        return;
      }
      let unmanaged = false;
      try {
        unmanaged = unmanageTile(originTile, active);
      } catch (error) {
        void error;
        this.diagnostic("float-rejected:assignment-failed");
        return;
      }
      if (!unmanaged) {
        this.diagnostic("float-rejected:assignment-failed");
        return;
      }
      if (active.tile !== null) {
        this.diagnostic("float-failed:postcondition");
        return;
      }
      this.floatingWindows.add(active);
      this.floatScopes.set(active, scope.scope);
      if (!this.writeFloatGeometry(active, scope)) {
        this.diagnostic("float-geometry-failed");
      }
      this.diagnostic("float-completed");
    }
    floatRevalidates(scope, active, originTile) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
        return false;
      }
      if (active.tile !== originTile || !isCustomTile(active.tile) || active.tile.isLayout) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null) {
        return false;
      }
      const freshOrigin = operationLeafForTile(topology, originTile);
      return freshOrigin !== null && windowIndex(freshOrigin.windows, active) >= 0;
    }
    // Tile a floating active window through the established safe adoption
    // `tile.manage()` into the deterministic first available empty non-layout
    // leaf. Every failure path - topology, capacity (no available leaf), stale
    // revalidation, and floor (assignment) - leaves the float unchanged with
    // the exact reason. A sticky window's all-desktop pin is cleared before any
    // tile write, so a failed clear leaves it sticky floating (never tiled). If
    // the clear succeeds but the subsequent `tile.manage` fails, the pin and
    // sticky tracking are restored before returning so the failed transition
    // leaves the original sticky floating state intact; a failed restore is
    // logged with its own reason. Only after a successful manage does the
    // infallible floating/sticky state cleanup run.
    tileFloatingActive(scope, active) {
      const topology = this.topologyForScope(scope, (reason) => {
        this.diagnostic(`tile-failed:${reason}`);
      });
      if (topology === null) {
        return;
      }
      const target = this.firstEmptyLeaf(topology);
      if (target === null) {
        this.diagnostic("tile-failed:no-available-leaf");
        return;
      }
      if (!this.tileFloatRevalidates(scope, active, target)) {
        this.diagnostic("tile-failed:assignment-stale");
        return;
      }
      let clearedSticky = false;
      if (this.isSticky(active)) {
        if (!this.clearSticky(active)) {
          this.diagnostic("tile-failed:sticky-clear-failed");
          return;
        }
        clearedSticky = true;
      }
      let managed = false;
      try {
        managed = manageTile(target.decoded.tile, active);
      } catch (error) {
        void error;
      }
      if (!managed) {
        if (clearedSticky) {
          if (!this.pinSticky(active)) {
            this.diagnostic("tile-failed:sticky-restore-failed");
          }
        }
        this.diagnostic("tile-failed:assignment-failed");
        return;
      }
      if (clearedSticky) {
        this.diagnostic("sticky-disabled");
      }
      this.rememberCurrentFloatGeometry(active);
      this.floatingWindows.delete(active);
      this.floatScopes.delete(active);
      this.detachedWindows.delete(active);
      this.diagnostic("tile-completed");
    }
    tileFloatRevalidates(scope, active, target) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
        return false;
      }
      if (active.tile !== null) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null) {
        return false;
      }
      const freshTarget = operationLeafForTile(topology, target.decoded.tile);
      return freshTarget !== null && !freshTarget.leaf.isLayout && isCustomTile(freshTarget.decoded.tile) && freshTarget.windows.length === 0;
    }
    // Remember the live frame geometry at the moment a floating window tiles,
    // so a user resize while floating is the geometry restored on the next
    // float. Also called immediately before a fullscreen-exit restoration so a
    // user-adjusted float geometry survives the fullscreen round trip, not the
    // geometry recorded at the initial float. Read-only observation; a failed
    // or invalid read keeps the prior record.
    rememberCurrentFloatGeometry(window) {
      try {
        const geometry = window.frameGeometry;
        if (isRect(geometry) && positiveGeometry(geometry)) {
          this.floatGeometries.set(window, geometry);
        }
      } catch (error) {
        void error;
      }
    }
    clearSticky(window) {
      let cleared = false;
      try {
        cleared = setWindowOnAllDesktops(window, false);
      } catch (error) {
        void error;
      }
      if (!cleared) {
        return false;
      }
      this.stickyWindows.delete(window);
      return true;
    }
    pinSticky(window) {
      let pinned = false;
      try {
        pinned = setWindowOnAllDesktops(window, true);
      } catch (error) {
        void error;
      }
      if (!pinned) {
        return false;
      }
      this.stickyWindows.add(window);
      return true;
    }
    // Meta+Shift+G sticky toggle. Sticky implies floating: enabling on a tiled
    // window floats it first (unmanage + float geometry) then pins it across
    // all desktops via the documented writable `onAllDesktops`. Disabling
    // clears the pin but the window remains floating. Never touches keepAbove
    // or any equivalent.
    stickyActiveWindow() {
      this.gate.run(() => {
        this.diagnostic("sticky-invoked");
        const guard = this.activeActionGuard("sticky");
        if (guard === null) {
          return;
        }
        const { active, scope } = guard;
        if (this.isSticky(active)) {
          if (!this.clearSticky(active)) {
            this.diagnostic("sticky-failed:on-all-desktops-write");
            return;
          }
          this.diagnostic("sticky-disabled");
          return;
        }
        if (this.maximizedWindows.has(active)) {
          this.diagnostic("sticky-rejected:maximized");
          return;
        }
        if (!this.isFloating(active)) {
          if (active.tile !== null) {
            if (!isCustomTile(active.tile) || active.tile.isLayout) {
              this.diagnostic("sticky-rejected:active-tile-association");
              return;
            }
            this.floatTiledActive(scope, active);
            if (!this.isFloating(active)) {
              return;
            }
          } else {
            if (!this.writeFloatGeometry(active, scope)) {
              this.diagnostic("sticky-rejected:float-geometry-failed");
              return;
            }
            this.floatingWindows.add(active);
            this.floatScopes.set(active, scope.scope);
            this.diagnostic("float-completed");
          }
        }
        if (!this.pinSticky(active)) {
          this.diagnostic("sticky-failed:on-all-desktops-write");
          return;
        }
        this.diagnostic("sticky-enabled");
      }, (reason) => this.disabled(reason));
    }
    // Deterministic first available empty non-layout leaf in the exact decoded
    // traversal order. Layout and occupied leaves are skipped; valid explicitly
    // selected overlay leaves are ordinary authored tree leaves and participate
    // through the same traversal.
    firstEmptyLeaf(topology) {
      for (const entry of topology) {
        if (entry.leaf.isLayout || !isCustomTile(entry.decoded.tile) || entry.windows.length !== 0) {
          continue;
        }
        return entry;
      }
      return null;
    }
    // Active identity, scope, eligibility, unassigned source, exact
    // output/desktop root, target reachability, non-layout status, and
    // emptiness are all re-derived immediately before the single attach write.
    attachRevalidates(scope, active, target) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope) || !windowInScope(active, freshScope)) {
        return false;
      }
      if (active.tile !== null) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null) {
        return false;
      }
      const freshTarget = operationLeafForTile(topology, target.decoded.tile);
      return freshTarget !== null && !freshTarget.leaf.isLayout && isCustomTile(freshTarget.decoded.tile) && freshTarget.windows.length === 0;
    }
    // Explicit assignment-only scope fill: the active normal eligible window
    // anchors the exact desktop/output scope whether it is tiled or floating.
    // Only existing empty authored Custom Tile leaves are filled, in
    // deterministic decoded traversal order, with eligible unassigned windows
    // from the proven windowList collection. No topology mutation, no
    // compaction or reflow, and no selected-overlay record is created.
    fillScope() {
      this.gate.run(() => {
        this.diagnostic("fill-invoked");
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("fill-rejected:no-active-window");
          return;
        }
        if (isWindow(active) && active.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("fill-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("fill-rejected:active-window-eligibility");
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`fill-rejected:${reason}`);
        });
        if (topology === null) {
          return;
        }
        const leaves = this.emptyAuthoredLeaves(topology);
        if (leaves.length === 0) {
          this.diagnostic("fill-inert:no-leaves");
          return;
        }
        const candidates = this.fillCandidates(scope, active);
        if (candidates === null) {
          this.diagnostic("fill-rejected:window-list-decode");
          return;
        }
        if (candidates.length === 0) {
          this.diagnostic("fill-inert:no-candidates");
          return;
        }
        const count = Math.min(leaves.length, candidates.length);
        const plan = [];
        for (let index = 0; index < count; index += 1) {
          const candidate = candidates[index];
          const leaf = leaves[index];
          if (candidate === void 0 || leaf === void 0) {
            this.diagnostic("fill-rejected:preflight");
            return;
          }
          plan.push({ window: candidate, target: leaf.decoded.tile });
        }
        let writes = 0;
        for (const entry of plan) {
          if (!this.fillAssignmentRevalidates(scope, active, entry.window, entry.target)) {
            this.diagnostic(
              writes === 0 ? "fill-rejected:assignment-stale" : "fill-partial:assignment-stale"
            );
            return;
          }
          let assigned = false;
          try {
            assigned = assignWindowToTile(entry.window, entry.target);
          } catch (error) {
            void error;
            this.diagnostic(
              writes === 0 ? "fill-rejected:assignment-failed" : "fill-partial:assignment-failed"
            );
            return;
          }
          if (!assigned) {
            this.diagnostic(
              writes === 0 ? "fill-rejected:assignment-failed" : "fill-partial:assignment-failed"
            );
            return;
          }
          if (!isWindow(entry.window) || entry.window.tile !== entry.target) {
            this.diagnostic(
              writes === 0 ? "fill-failed:postcondition" : "fill-partial:postcondition"
            );
            return;
          }
          writes += 1;
        }
        this.diagnostic("fill-completed");
      }, (reason) => this.disabled(reason));
    }
    // Empty authored non-layout Custom Tile leaves in the exact decoded
    // traversal order. Layout tiles, occupied leaves, and generic (non-Custom)
    // tiles are skipped; valid selected-overlay leaves are ordinary authored
    // leaves and participate through the same traversal.
    emptyAuthoredLeaves(topology) {
      const leaves = [];
      for (const entry of topology) {
        if (entry.leaf.isLayout || !isCustomTile(entry.decoded.tile) || entry.windows.length !== 0) {
          continue;
        }
        leaves.push(entry);
      }
      return leaves;
    }
    // Eligible unassigned exact-scope windows from the proven all-window
    // collection, in collection order. The active window is anchored first only
    // when it is itself present in that collection and eligible and unassigned;
    // a distinct active wrapper that is not in the collection is never injected
    // as a candidate.
    fillCandidates(scope, active) {
      const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        return null;
      }
      this.decodedBoundary("workspace-window-list");
      const candidates = [];
      for (const window of windows.value) {
        if (windowInScope(window, scope) && window.tile === null && !this.isFloating(window)) {
          candidates.push(window);
        }
      }
      const anchorIndex = windowIndex(candidates, active);
      if (anchorIndex >= 0) {
        const anchor = candidates[anchorIndex];
        if (anchor !== void 0) {
          candidates.splice(anchorIndex, 1);
          candidates.unshift(anchor);
        }
      }
      return Object.freeze(candidates);
    }
    // Active identity, exact scope, eligibility, candidate identity/eligibility/
    // scope/still-unassigned state, and target reachability/non-layout/emptiness
    // are all re-derived immediately before every guarded write, so any change
    // between planning and the write stops the fill without claiming rollback.
    fillAssignmentRevalidates(scope, active, candidate, target) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope) || !windowInScope(active, freshScope) || !windowInScope(candidate, freshScope) || candidate.tile !== null) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null) {
        return false;
      }
      const freshTarget = operationLeafForTile(topology, target);
      return freshTarget !== null && !freshTarget.leaf.isLayout && isCustomTile(freshTarget.decoded.tile) && freshTarget.windows.length === 0;
    }
    applyPreset(kind) {
      this.gate.run(() => {
        this.diagnostic(`preset-invoked:${kind}`);
        const active = this.environment.activeWindow();
        if (active === null) {
          this.diagnostic("preset-rejected:no-active-window");
          return;
        }
        if (isWindow(active) && active.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        const scope = this.scopeForWindow(active);
        if (scope === null) {
          this.diagnostic("preset-rejected:desktop-output-scope");
          return;
        }
        if (!windowInScope(active, scope)) {
          this.diagnostic("preset-rejected:active-window-eligibility");
          return;
        }
        const topology = this.topologyForScope(scope, (reason) => {
          this.diagnostic(`preset-rejected:${reason}`);
        });
        if (topology === null || active.tile === null || !isCustomTile(active.tile)) {
          if (topology !== null) {
            this.diagnostic("preset-rejected:active-tile-association");
          }
          return;
        }
        const source = operationLeafForTile(topology, active.tile);
        if (source === null || source.leaf.isLayout || source.windows.length !== 1 || !isCustomTile(source.decoded.tile)) {
          this.diagnostic("preset-rejected:source-occupancy-validity");
          return;
        }
        const occupants = this.presetOccupants(topology, source, active, scope);
        if (occupants === null) {
          this.diagnostic("preset-rejected:occupancy-validity");
          return;
        }
        const compiled = buildPreset(kind, occupants.length);
        if (!compiled.ok) {
          this.diagnostic("preset-rejected:compile-failed");
          return;
        }
        const execution = executeBlueprintInstructions(compiled.value, source.decoded.tile, customTileSplitSeam);
        if (!execution.ok) {
          this.diagnostic(
            execution.mutationPossible ? "preset-failed:split-mutation-possible" : "preset-failed:split-no-mutation"
          );
          return;
        }
        if (execution.leaves.length !== occupants.length) {
          this.diagnostic("preset-failed:split-mutation-possible");
          return;
        }
        for (let ordinal = 0; ordinal < occupants.length; ordinal += 1) {
          const occupant = occupants[ordinal];
          const leaf = execution.leaves[ordinal];
          if (occupant === void 0 || leaf === void 0) {
            this.diagnostic("preset-failed:assignment-stale:later");
            return;
          }
          const stage = ordinalClass(ordinal);
          if (!this.presetAssignmentRevalidates(scope, active, occupant)) {
            this.diagnostic(`preset-failed:assignment-stale:${stage}`);
            return;
          }
          try {
            if (!manageTile(leaf, occupant.window)) {
              this.diagnostic(`preset-failed:assignment-failed:${stage}`);
              return;
            }
          } catch (error) {
            void error;
            this.diagnostic(`preset-failed:assignment-failed:${stage}`);
            return;
          }
        }
        this.recordSelectedOverlay(scope, kind, source.decoded.tile, execution.leaves);
        this.diagnostic(`preset-applied:${kind}`);
      }, (reason) => this.disabled(reason));
    }
    // Record the selected overlay only after the whole preset realization
    // succeeded, keyed by the exact current desktop/output scope. A later
    // successful application on the same scope atomically replaces it.
    recordSelectedOverlay(scope, preset, root, leaves) {
      let byDesktop = this.selectedOverlays.get(scope.output);
      if (byDesktop === void 0) {
        byDesktop = /* @__PURE__ */ new Map();
        this.selectedOverlays.set(scope.output, byDesktop);
      }
      byDesktop.set(scope.desktop.id, { scope, preset, root, leaves });
    }
    selectedOverlayValid(overlay) {
      const root = this.environment.rootTile(overlay.scope.output, overlay.scope.desktop);
      if (!isCustomTile(root)) {
        return false;
      }
      const tiles = decodeTileTree(root);
      if (tiles === null || !tiles.some((tile) => tile === overlay.root)) {
        return false;
      }
      const realized = collectPresetLeaves(overlay.root);
      if (realized === null || realized.length !== overlay.leaves.length) {
        return false;
      }
      for (let index = 0; index < realized.length; index += 1) {
        if (realized[index] !== overlay.leaves[index]) {
          return false;
        }
      }
      return true;
    }
    // Entry point for a bounded assignment-only selected-overlay reflow after
    // a lifecycle change. Emits one fixed private diagnostic per distinct
    // outcome; "no-selection" stays silent so unrelated removals or additions
    // never claim a reflow. `candidate` supplies a newly added eligible window
    // that may fill the first trailing leaf only when the overlay has capacity.
    runReflow(scope, candidate) {
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return { kind: "no-op" };
      }
      const outcome = this.reflowSelectedOverlay(scope, candidate);
      switch (outcome.kind) {
        case "no-op":
          this.diagnostic("reflow-noop");
          break;
        case "no-capacity":
          this.diagnostic("reflow-no-capacity");
          break;
        case "completed":
          this.diagnostic("reflow-completed");
          break;
        case "rejected":
          this.diagnostic(`reflow-rejected:${outcome.reason}`);
          break;
        case "partial":
          this.diagnostic(`reflow-partial:${outcome.reason}`);
          break;
        case "no-selection":
          break;
      }
      return outcome;
    }
    reflowSelectedOverlay(scope, candidate) {
      const overlay = this.readSelectedOverlay(scope);
      if (overlay === null) {
        return { kind: "no-selection" };
      }
      if (this.reflowTouchesMaximized(scope, overlay)) {
        this.diagnostic("maximize:ignored reflow while maximized");
        return { kind: "no-op" };
      }
      if (overlay.leaves.length === 0) {
        return { kind: "rejected", reason: "topology-decode" };
      }
      const occupants = [];
      const seen = /* @__PURE__ */ new Set();
      for (const leaf of overlay.leaves) {
        const windows = decodeSequential(leaf.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
          return { kind: "rejected", reason: "topology-decode" };
        }
        for (const window of windows.value) {
          if (seen.has(window)) {
            return { kind: "rejected", reason: "occupancy-validity" };
          }
          if (window.tile !== leaf || this.removedOccupants.has(window)) {
            continue;
          }
          if (!windowInScope(window, scope)) {
            return { kind: "rejected", reason: "occupancy-validity" };
          }
          seen.add(window);
          occupants.push(window);
        }
      }
      if (candidate !== void 0) {
        if (!windowInScope(candidate, scope) || candidate.tile !== null || seen.has(candidate) || this.removedOccupants.has(candidate)) {
          return { kind: "rejected", reason: "candidate-eligibility" };
        }
        if (occupants.length >= overlay.leaves.length) {
          return { kind: "no-capacity" };
        }
        occupants.push(candidate);
      }
      if (occupants.length > overlay.leaves.length) {
        return { kind: "rejected", reason: "capacity" };
      }
      const plan = [];
      for (let index = 0; index < occupants.length; index += 1) {
        const occupant = occupants[index];
        const target = overlay.leaves[index];
        if (occupant === void 0 || target === void 0) {
          return { kind: "rejected", reason: "capacity" };
        }
        if (occupant.tile === target) {
          continue;
        }
        const source = occupant.tile;
        if (source !== null && !isTile(source)) {
          return { kind: "rejected", reason: "source-validity" };
        }
        plan.push({ window: occupant, source, target });
      }
      if (plan.length === 0) {
        return { kind: "no-op" };
      }
      let writes = 0;
      for (const entry of plan) {
        if (!this.reflowAssignmentRevalidates(scope, entry.window, entry.source, entry.target)) {
          return writes === 0 ? { kind: "rejected", reason: "assignment-stale" } : { kind: "partial", reason: "assignment-stale", writes };
        }
        let assigned = false;
        try {
          assigned = assignWindowToTile(entry.window, entry.target);
        } catch (error) {
          void error;
          return writes === 0 ? { kind: "rejected", reason: "assignment-failed" } : { kind: "partial", reason: "assignment-failed", writes };
        }
        if (!assigned) {
          return writes === 0 ? { kind: "rejected", reason: "assignment-failed" } : { kind: "partial", reason: "assignment-failed", writes };
        }
        writes += 1;
      }
      return { kind: "completed", writes };
    }
    // Re-derives identity, scope, current source, and target availability
    // immediately before each guarded write, so any change between planning
    // and the write stops the reflow without claiming rollback.
    reflowAssignmentRevalidates(scope, window, source, target) {
      if (!windowInScope(window, scope)) {
        return false;
      }
      if (window.tile !== source) {
        return false;
      }
      const overlay = this.readSelectedOverlay(scope);
      if (overlay === null) {
        return false;
      }
      return overlay.leaves.includes(target) && this.reflowTargetIsAvailable(target);
    }
    reflowTargetIsAvailable(target) {
      const windows = decodeSequential(target.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        return false;
      }
      for (const occupant of windows.value) {
        if (!this.removedOccupants.has(occupant) && occupant.tile === target) {
          return false;
        }
      }
      return true;
    }
    reflowAfterRemoval(window) {
      var _a;
      this.noteRemovedOccupant(window);
      const scope = this.scopeForWindow(window);
      if (scope === null) {
        this.reflowSelectedScopesContaining(window);
        return;
      }
      if (((_a = this.selectedOverlays.get(scope.output)) == null ? void 0 : _a.get(scope.desktop.id)) === void 0) {
        return;
      }
      this.runReflow(scope);
    }
    reflowAfterDetach(scope, origin) {
      const overlay = this.readSelectedOverlay(scope);
      if (overlay !== null && overlay.leaves.includes(origin)) {
        this.runReflow(scope);
      }
    }
    reflowSelectedScopesContaining(window) {
      for (const byDesktop of this.selectedOverlays.values()) {
        for (const overlay of byDesktop.values()) {
          const current = this.readSelectedOverlay(overlay.scope);
          if (current === null) {
            continue;
          }
          for (const leaf of current.leaves) {
            const windows = decodeSequential(leaf.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (windows.ok && windows.value.includes(window)) {
              this.runReflow(current.scope);
              break;
            }
          }
        }
      }
    }
    noteRemovedOccupant(window) {
      if (this.removedOccupants.size >= MAX_SEQUENTIAL_LENGTH) {
        const stale = this.removedOccupants.values().next().value;
        if (stale !== void 0) {
          this.removedOccupants.delete(stale);
        }
      }
      this.removedOccupants.add(window);
    }
    refillOrPlaceAutomatically(window, scope) {
      const outcome = this.runReflow(scope, window);
      if (outcome.kind === "no-selection" || outcome.kind === "no-capacity") {
        if (window.tile !== null) {
          return;
        }
        const placement = this.placeAutomatically(window, scope);
        if (placement.kind !== "managed") {
          this.diagnostic(`window-added-noop:${placement.kind}`);
        }
      }
    }
    // This returns the explicit realization input rather than tying executor
    // use to discovery, allowing future strategies to choose occupants first.
    presetOccupants(topology, source, active, scope) {
      const sourceOccupant = targetOccupantForActive(source, active);
      if (sourceOccupant === null) {
        return null;
      }
      const seenLeaves = /* @__PURE__ */ new Set();
      const seenWindows = /* @__PURE__ */ new Set();
      const ordered = [];
      for (const entry of topology) {
        if (entry.leaf.isLayout || seenLeaves.has(entry.decoded.tile)) {
          return null;
        }
        seenLeaves.add(entry.decoded.tile);
        for (const window of entry.windows) {
          if (!windowInScope(window, scope) || window.tile !== entry.decoded.tile || seenWindows.has(window)) {
            return null;
          }
          seenWindows.add(window);
          ordered.push({ window, originTile: entry.decoded.tile });
        }
      }
      if (!seenWindows.has(sourceOccupant.window)) {
        return null;
      }
      const occupants = [{ window: sourceOccupant.window, originTile: source.decoded.tile }];
      for (const occupant of ordered) {
        if (occupant.window !== sourceOccupant.window) {
          occupants.push(occupant);
        }
      }
      return Object.freeze(occupants);
    }
    presetAssignmentRevalidates(scope, active, occupant) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      return freshScope !== null && sameScope(freshScope.scope, scope.scope) && windowInScope(active, freshScope) && windowInScope(occupant.window, freshScope) && occupant.window.tile === occupant.originTile;
    }
    // Active scope, source association, and target emptiness are re-derived
    // immediately before the single tile assignment, so any change between
    // selection and the write rejects without a write.
    moveAssignmentRevalidates(scope, active, source, target, direction) {
      if (this.environment.activeWindow() !== active) {
        return false;
      }
      const freshScope = this.scopeForWindow(active);
      if (freshScope === null || !sameScope(freshScope.scope, scope.scope) || !windowInScope(active, freshScope)) {
        return false;
      }
      const topology = this.topologyForScope(freshScope);
      if (topology === null || active.tile === null || !isTile(active.tile)) {
        return false;
      }
      const freshSource = operationLeafForTile(topology, active.tile);
      if (freshSource === null || freshSource.decoded.tile !== source.decoded.tile || freshSource.leaf.isLayout || freshSource.windows.length !== 1 || windowIndex(freshSource.windows, active) < 0 || topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1) {
        return false;
      }
      const freshTarget = operationLeafForTile(topology, target.decoded.tile);
      if (freshTarget === null || freshTarget.leaf.isLayout || freshTarget.windows.length !== 0) {
        return false;
      }
      const freshCandidates = topology.filter((entry) => !entry.leaf.isLayout && entry.windows.length === 0).map((entry) => entry.leaf);
      const freshTargetLeaf = findNeighborLeaf(freshCandidates, freshSource.leaf, direction);
      return freshTargetLeaf === freshTarget.leaf;
    }
    clearPending() {
      const pending = this.pending.current;
      this.pending.clearForScopeChange();
      if (pending !== void 0) {
        pending.disconnect();
      }
    }
    clearDrag() {
      this.drag.clearForScopeChange();
    }
    // Whether the tracked drag window is currently live-moving or
    // live-resizing, per the documented Window live state (`move` / `resize`).
    // This is the authoritative active-drag signal: the captured-origin latch is
    // never used on its own to decide that a drag is still in progress.
    trackedDragLive() {
      const drag = this.drag.current;
      return drag !== void 0 && (drag.window.move || drag.window.resize);
    }
    // Record exactly one owed invariant check for a scope whose check was
    // deferred by a live drag. A scope that already owes a check is neither
    // re-marked nor re-logged, keeping the diagnostic non-noisy.
    markOwedInvariant(scope) {
      let byDesktop = this.owedInvariantScopes.get(scope.output);
      if (byDesktop === void 0) {
        byDesktop = /* @__PURE__ */ new Map();
        this.owedInvariantScopes.set(scope.output, byDesktop);
      }
      if (!byDesktop.has(scope.desktop.id)) {
        byDesktop.set(scope.desktop.id, scope);
        this.diagnostic("ownership-invariant-deferred:drag-live");
      }
    }
    // Run every owed invariant check exactly once, after the tracked drag is no
    // longer live. Owed scopes are cleared before their check runs so a
    // still-live drag re-marks rather than double-running.
    settleOwedInvariants() {
      if (this.trackedDragLive() || this.owedInvariantScopes.size === 0) {
        return;
      }
      const owed = [];
      for (const byDesktop of this.owedInvariantScopes.values()) {
        for (const scope of byDesktop.values()) {
          owed.push(scope);
        }
      }
      this.owedInvariantScopes.clear();
      for (const scope of owed) {
        this.dwindleEnsureInvariant(scope);
      }
    }
    handleScopeChange() {
      this.gate.run(() => {
        this.clearPending();
        this.clearDrag();
        this.settleOwedInvariants();
        this.attachExistingInteractiveWindows(false);
        this.engageCurrentScope();
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }, (reason) => this.disabled(reason));
    }
    handleWindowRemoved(window) {
      this.gate.run(() => {
        var _a;
        const pending = this.pending.current;
        if (pending !== void 0 && (pending.sourceWindow === window || pending.targetWindow === window)) {
          this.clearPending();
        }
        if (((_a = this.drag.current) == null ? void 0 : _a.window) === window) {
          this.clearDrag();
        }
        if (isWindow(window)) {
          this.detachInteractiveWindow(window);
          this.cancelDeferredEligibility(window);
          this.detachedWindows.delete(window);
          this.floatingWindows.delete(window);
          this.floatScopes.delete(window);
          this.stickyWindows.delete(window);
          this.floatGeometries.delete(window);
          this.maximizedWindows.delete(window);
          this.detachMaximizeWindow(window);
          this.reflowAfterRemoval(window);
          this.dwindleMaybeRemove(window);
          this.detachFullscreenWindow(window);
          this.fullscreenWindows.delete(window);
        }
        this.settleOwedInvariants();
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }, (reason) => this.disabled(reason));
    }
    handleWindowAdded(window) {
      this.gate.run(() => {
        this.onceDiagnostic("window-added-observed");
        this.attachInteractiveWindow(window);
        this.attachFullscreenWindow(window);
        if (isWindow(window) && window.fullScreen === true) {
          this.enterFullscreen(window);
        } else {
          const pending = this.pending.current;
          if (pending === void 0) {
            const scope = this.scopeForWindow(window);
            if (scope === null || !windowInScope(window, scope)) {
              const reason = this.windowAddedRejection(window, scope);
              if (reason === "desktop-scope-mismatch" && scope !== null && isWindow(window)) {
                this.deferDesktopScopeReevaluation(window, scope);
              } else {
                this.onceDiagnostic(`window-added-rejected:${reason}`);
              }
            } else {
              this.onceDiagnostic("window-added-eligible");
              this.placeEligibleAdded(window, scope);
            }
          } else {
            try {
              this.completeKeyboardInsertion(window, pending);
            } finally {
              this.clearPending();
            }
          }
        }
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }, (reason) => this.disabled(reason));
    }
    // `desktop-scope-mismatch` is the one `windowAddedRejection` sub-code
    // that can be a timing artifact rather than genuine ineligibility
    // (unit-05/attempt-16): `window.desktops` may still be settling at the
    // exact `windowAdded` instant. Every other sub-code stays an immediate
    // terminal rejection. Bounded to exactly one short re-evaluation per
    // window; cancelled by `cancelDeferredEligibility` if the window closes
    // first, so nothing leaks or retries unboundedly.
    deferDesktopScopeReevaluation(window, scope) {
      if (this.deferredEligibility.size >= MAX_SEQUENTIAL_LENGTH || this.deferredEligibility.has(window)) {
        return;
      }
      this.onceDiagnostic(`window-added-deferred:${desktopScopeCheck(window, scope)}`);
      const cancel = this.environment.scheduleOnce(DESKTOP_SCOPE_REEVALUATION_DELAY_MS, () => {
        if (this.deferredEligibility.get(window) !== cancel) {
          return;
        }
        this.deferredEligibility.delete(window);
        this.reevaluateDesktopScope(window, scope);
      });
      this.deferredEligibility.set(window, cancel);
    }
    reevaluateDesktopScope(window, scope) {
      this.gate.run(() => {
        const freshScope = this.scopeForWindow(window);
        if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
          this.onceDiagnostic("window-added-rejected-deferred:scope-changed");
          return;
        }
        this.onceDiagnostic(`window-added-reevaluated:${desktopScopeCheck(window, freshScope)}`);
        if (!windowInScope(window, freshScope)) {
          this.onceDiagnostic("window-added-rejected-deferred:desktop-scope-mismatch");
          return;
        }
        this.onceDiagnostic("window-added-eligible-deferred");
        this.placeEligibleAdded(window, freshScope);
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }, (reason) => this.disabled(reason));
    }
    cancelDeferredEligibility(window) {
      const cancel = this.deferredEligibility.get(window);
      if (cancel === void 0) {
        return;
      }
      this.deferredEligibility.delete(window);
      cancel();
    }
    windowAddedRejection(window, scope) {
      if (scope === null || !isWindow(window)) {
        return "scope-unavailable";
      }
      if (!window.normalWindow) {
        return "not-normal-window";
      }
      if (!window.managed) {
        return "not-managed";
      }
      if (!window.resizeable) {
        return "not-resizeable";
      }
      if (window.appletPopup) {
        return "applet-popup";
      }
      return "desktop-scope-mismatch";
    }
    // Startup adoption of already-all-desktops windows as session-local sticky
    // floating windows. The session-only heuristic (a window pinned across all
    // desktops before the controller started, either by KWin's own pinning or a
    // previous session) is recorded as sticky floating so it is never re-tiled
    // by placement or reconstruction. This is narrowly appropriate: no mutation
    // happens here (no geometry write, no pin change), and ordinary startup
    // windows use normal placement. An already tile-managed all-desktops window
    // is never classified both tiled and sticky/floating: it is declined with
    // an explicit diagnostic and left untouched (no pin clear, no adoption) so
    // startup performs no structural mutation on a window KWin already owns.
    adoptStartupFloatingWindows() {
      const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        return;
      }
      this.decodedBoundary("workspace-window-list");
      for (const window of windows.value) {
        if (window.onAllDesktops !== true) {
          continue;
        }
        if (!window.normalWindow || !window.managed || !window.resizeable || window.appletPopup) {
          continue;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null) {
          continue;
        }
        if (window.tile !== null) {
          this.onceDiagnostic("startup-sticky-declined:tile-managed");
          continue;
        }
        this.floatingWindows.add(window);
        this.stickyWindows.add(window);
        this.floatScopes.set(window, scope.scope);
        this.onceDiagnostic("startup-sticky-float");
      }
    }
    attachExistingInteractiveWindows(emitSummary) {
      const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        this.diagnostic("drag-attach-skipped:window-list-decode-failed");
        return;
      }
      this.decodedBoundary("workspace-window-list");
      let attempted = 0;
      let ok = 0;
      let failed2 = 0;
      for (const window of windows.value) {
        this.attachFullscreenWindow(window);
        if (isWindow(window) && window.fullScreen === true) {
          this.enterFullscreen(window);
        }
        if (isWindow(window) && isNativelyMaximized(window)) {
          this.recordStartupMaximize(window);
        }
        const result = this.attachInteractiveWindow(window);
        if (result === null) {
          continue;
        }
        attempted += result.attempted;
        ok += result.ok;
        failed2 += result.failed;
      }
      if (emitSummary) {
        this.diagnostic(`drag-attach-summary:${attempted}:${ok}:${failed2}`);
      }
    }
    attachInteractiveWindow(window) {
      if (this.interactiveWindows.size >= MAX_SEQUENTIAL_LENGTH) {
        this.diagnostic("drag-attach-skipped:max-windows");
        return null;
      }
      if (!isWindow(window)) {
        this.diagnostic("drag-attach-skipped:not-window");
        return null;
      }
      if (this.interactiveWindows.has(window)) {
        this.diagnostic("drag-attach-skipped:duplicate");
        return null;
      }
      const scope = this.scopeForWindow(window);
      if (scope === null) {
        this.diagnostic("drag-attach-skipped:no-scope");
        return null;
      }
      if (!windowInScope(window, scope)) {
        this.diagnostic("drag-attach-skipped:out-of-scope");
        return null;
      }
      const watched = this.environment.watchInteractiveWindow(
        window,
        () => this.handleInteractiveStarted(window),
        () => this.handleInteractiveFinished(window),
        () => this.handleInteractiveStepped(),
        () => this.handleMoveResizedChanged(),
        () => this.handleInteractiveInvalidated(window)
      );
      this.interactiveWindows.set(window, { disconnect: watched.disconnect, kind: "unknown" });
      return { attempted: watched.ok + watched.failed, ok: watched.ok, failed: watched.failed };
    }
    detachInteractiveWindow(window) {
      const watch = this.interactiveWindows.get(window);
      if (watch === void 0) {
        return;
      }
      this.interactiveWindows.delete(window);
      watch.disconnect();
    }
    // ---- Fullscreen cover-and-restore passthrough ----
    // Attach the documented `fullScreenChanged` notify signal for a managed
    // normal window. Attachment is feature-detected through the environment
    // seam exactly like the interactive signals: a missing binding is logged
    // as failed but never fails startup. Bounded and deduplicated per window.
    attachFullscreenWindow(window) {
      if (this.fullscreenWatches.size >= MAX_SEQUENTIAL_LENGTH) {
        return;
      }
      if (!isWindow(window) || this.fullscreenWatches.has(window)) {
        return;
      }
      if (!window.normalWindow || !window.managed || window.appletPopup) {
        return;
      }
      const watched = this.environment.watchFullscreen(window, () => this.handleFullscreenChanged(window));
      this.fullscreenWatches.set(window, watched.disconnect);
    }
    detachFullscreenWindow(window) {
      const disconnect = this.fullscreenWatches.get(window);
      if (disconnect === void 0) {
        return;
      }
      this.fullscreenWatches.delete(window);
      disconnect();
    }
    handleFullscreenChanged(window) {
      this.gate.run(() => {
        if (window.fullScreen === true) {
          this.enterFullscreen(window);
        } else {
          this.exitFullscreen(window);
        }
      }, (reason) => this.disabled(reason));
    }
    // Enter: preserve the exact tile for a managed tiled window without any
    // mutation (cover is KWin-owned); a created/floating fullscreen window is
    // recorded unmanaged. A window already fullscreen is not re-recorded. A
    // live drag on the entering window is dropped so finish cannot complete a
    // half-captured drop.
    enterFullscreen(window) {
      var _a;
      if (this.fullscreenWindows.has(window)) {
        return;
      }
      if (((_a = this.drag.current) == null ? void 0 : _a.window) === window) {
        this.clearDrag();
      }
      const scope = this.scopeForWindow(window);
      const preservedTile = window.tile;
      if (preservedTile !== null && isTile(preservedTile) && scope !== null) {
        this.fullscreenWindows.set(window, { scope, preservedTile, wasTiled: true });
        this.diagnostic("fullscreen:enter preserved");
        return;
      }
      this.fullscreenWindows.set(window, { scope, preservedTile: null, wasTiled: false });
      this.diagnostic("fullscreen:enter unmanaged");
    }
    exitFullscreen(window) {
      const record = this.fullscreenWindows.get(window);
      if (record === void 0) {
        return;
      }
      this.fullscreenWindows.delete(window);
      if (record.wasTiled) {
        this.restoreFullscreenSlot(window, record);
      } else if (!this.maximizedWindows.has(window)) {
        this.newlyManageAfterFullscreen(window);
      }
      if (this.maximizedWindows.has(window)) {
        this.recoverMaximize(window);
      }
    }
    // Restore the preserved slot through the safe `tile.manage(window)` attach
    // API only. Every unsafe precondition is a distinct non-destructive bail:
    // no reconstruction and no mutation when the scope changed, the assignment
    // drifted, or the preserved tile is gone from the live topology. The
    // preserved tile is never touched directly: it is re-resolved as the fresh
    // entry tile of the live topology and that fresh handle is managed.
    restoreFullscreenSlot(window, record) {
      if (record.preservedTile === null || record.scope === null) {
        this.diagnostic("fullscreen:exit restore failed:no-preserved-slot");
        return;
      }
      const scope = this.scopeForWindow(window);
      if (scope === null || !sameScope(scope.scope, record.scope.scope)) {
        this.diagnostic("fullscreen:exit restore failed:scope-changed");
        return;
      }
      if (window.tile === record.preservedTile) {
        this.diagnostic("fullscreen:exit restored");
        return;
      }
      if (window.tile !== null) {
        this.diagnostic("fullscreen:exit restore failed:assignment-changed");
        return;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        this.diagnostic("fullscreen:exit restore failed:topology-unavailable");
        return;
      }
      const preservedLeaf = topology.find((entry) => entry.decoded.tile === record.preservedTile);
      if (preservedLeaf === void 0) {
        this.diagnostic("fullscreen:exit restore failed:tile-missing");
        return;
      }
      if (preservedLeaf.windows.some((occupant) => occupant !== window)) {
        this.diagnostic("fullscreen:exit restore failed:leaf-occupied");
        return;
      }
      if (!manageTile(preservedLeaf.decoded.tile, window)) {
        this.diagnostic("fullscreen:exit restore failed:assignment-failed");
        return;
      }
      this.diagnostic("fullscreen:exit restored");
    }
    // Exit from a created/floating fullscreen window: manage under the normal
    // newly-eligible semantics. A persisted user float state (the explicit
    // detach set) blocks re-management and leaves the window floating; there is
    // no broader float feature implemented.
    newlyManageAfterFullscreen(window) {
      if (this.isFloating(window)) {
        const scope2 = this.scopeForWindow(window);
        if (scope2 !== null) {
          this.rememberCurrentFloatGeometry(window);
          this.writeFloatGeometry(window, scope2);
        }
        this.diagnostic("fullscreen:exit restored float");
        return;
      }
      const scope = this.scopeForWindow(window);
      if (scope === null || !windowInScope(window, scope)) {
        this.diagnostic("fullscreen:exit restore failed:ineligible");
        return;
      }
      if (this.detachedWindows.has(window)) {
        this.diagnostic("fullscreen:exit restore failed:persisted-float");
        return;
      }
      this.placeEligibleAdded(window, scope);
      this.diagnostic("fullscreen:exit newly managed");
    }
    // Whether any fullscreen window belongs to this scope. While such a window
    // is fullscreen the scope must not be reconstructed or structurally
    // mutated: a preserved-tiled window's slot survives untouched until exit,
    // and an untiled fullscreen window must never be tiled by a rebuild.
    scopeHasFullscreen(scope) {
      for (const [window, record] of this.fullscreenWindows) {
        if (window.fullScreen !== true) {
          continue;
        }
        const currentScope = this.scopeForWindow(window);
        if (currentScope !== null && sameScope(currentScope.scope, scope.scope)) {
          return true;
        }
        if (currentScope === null && record.scope !== null && sameScope(record.scope.scope, scope.scope)) {
          return true;
        }
      }
      return false;
    }
    // ---- Maximize cover-and-restore (geometry-cover seam) ----
    // Meta+M toggle. Maximize is the geometry-cover seam: the window's frame
    // geometry is written to its workspace work area while its exact tile
    // assignment and the tree are preserved; un-maximize restores the tile
    // geometry. Maximize is per window plus its owning desktop and never
    // sticky. Fullscreen is distinct and takes precedence: a fullscreen active
    // window is a specific no-op, and a maximized window that entered fullscreen
    // keeps its maximize record and is re-covered on fullscreen exit.
    maximizeActiveWindow() {
      this.gate.run(() => {
        this.diagnostic("maximize-invoked");
        const active = this.environment.activeWindow();
        if (isWindow(active) && active.fullScreen === true) {
          this.diagnostic("maximize-ignored:fullscreen");
          return;
        }
        const guard = this.activeActionGuard("maximize");
        if (guard === null) {
          return;
        }
        if (this.isSticky(guard.active)) {
          this.diagnostic("maximize-rejected:sticky");
          return;
        }
        if (this.maximizedWindows.has(guard.active)) {
          const record = this.maximizedWindows.get(guard.active);
          if (record !== void 0 && record.kind === "startup") {
            this.diagnostic("maximize-rejected:startup-native");
            return;
          }
          this.exitMaximize(guard.active);
          return;
        }
        this.enterMaximize(guard.scope, guard.active);
      }, (reason) => this.disabled(reason));
    }
    // Enter: validate the exact tile association through a fresh topology,
    // then write the workspace work-area geometry. No structural call is ever
    // made; the tree and tile slot stay exactly as they were.
    enterMaximize(scope, window) {
      if (this.maximizedWindows.has(window)) {
        return;
      }
      if (window.tile === null || !isCustomTile(window.tile) || window.tile.isLayout) {
        this.diagnostic("maximize-rejected:not-tiled");
        return;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        this.diagnostic("maximize-failed:topology-unavailable");
        return;
      }
      const leaf = operationLeafForTile(topology, window.tile);
      if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
        this.diagnostic("maximize-rejected:tile-association");
        return;
      }
      if (windowIndex(leaf.windows, window) < 0) {
        this.diagnostic("maximize-rejected:occupancy");
        return;
      }
      const workArea = this.workAreaForScope(scope);
      if (workArea === null) {
        this.diagnostic("maximize-failed:work-area-unavailable");
        return;
      }
      if (!writeWindowFrameGeometry(window, workArea)) {
        this.diagnostic("maximize-failed:geometry-write");
        return;
      }
      this.maximizedWindows.set(window, { scope, preservedTile: window.tile, kind: "cover" });
      this.diagnostic("maximize:enter preserved");
      this.diagnostic("maximize:enter covered");
    }
    // Startup recording of an already-maximized window (the read-only
    // `maximizeMode` binding, guarded through `isNativelyMaximized`, never
    // written by the controller). No mutation happens: the record alone
    // preserves the window's state and tree by excluding the scope from
    // reconstruction and placement. A tiled window keeps its exact tile slot;
    // an untiled window stays unmanaged until a real native unmaximize
    // transition clears the classification. The startup record is distinct
    // from a controller-managed cover (`kind: "startup"`), so the toggle
    // refuses it and only the native maximize transition may clear it.
    recordStartupMaximize(window) {
      const scope = this.scopeForWindow(window);
      if (scope === null) {
        return;
      }
      if (this.maximizedWindows.has(window)) {
        return;
      }
      const tile = window.tile;
      const preservedTile = tile !== null && isTile(tile) ? tile : null;
      this.maximizedWindows.set(window, { scope, preservedTile, kind: "startup" });
      this.attachMaximizeWindow(window);
      this.diagnostic("maximize:startup recorded");
    }
    // Attach the documented `maximizedChanged` notify signal for a startup
    // record so the classification clears on a real native unmaximize
    // transition instead of persisting forever. Attachment is feature-detected
    // through the optional environment seam: a missing binding is skipped
    // (the classification then simply persists) but never fails startup.
    // Bounded and deduplicated per window.
    attachMaximizeWindow(window) {
      if (this.maximizeWatches.size >= MAX_SEQUENTIAL_LENGTH) {
        return;
      }
      if (this.maximizeWatches.has(window)) {
        return;
      }
      const watchMaximize = this.environment.watchMaximize;
      if (watchMaximize === void 0) {
        return;
      }
      const watched = watchMaximize(window, () => this.handleMaximizeChanged(window));
      this.maximizeWatches.set(window, watched.disconnect);
    }
    detachMaximizeWindow(window) {
      const disconnect = this.maximizeWatches.get(window);
      if (disconnect === void 0) {
        return;
      }
      this.maximizeWatches.delete(window);
      disconnect();
    }
    // A real native maximize transition (KWin emitted `maximizedChanged`).
    // Only a startup-kind record is observed: when the window is no longer
    // natively maximized the classification clears through the same
    // exit/restore seam, which unblocks the scope and lets the window become
    // managed normally. A tiled startup window falls through to the shared
    // restore path; an untiled one simply clears. Any other record class and
    // any transition that leaves the window maximized is ignored.
    handleMaximizeChanged(window) {
      this.gate.run(() => {
        const record = this.maximizedWindows.get(window);
        if (record === void 0 || record.kind !== "startup") {
          return;
        }
        if (isNativelyMaximized(window)) {
          return;
        }
        this.exitMaximize(window);
      }, (reason) => this.disabled(reason));
    }
    // Exit: restore the tile geometry through the safe geometry seam and a
    // fresh topology. Every unsafe precondition is a distinct non-destructive
    // bail that leaves the record and cover untouched: no reconstruction and no
    // mutation. A window detached from its preserved tile while maximized is
    // re-attached through the safe `tile.manage(window)` attach seam first.
    // Returns whether the restore completed; a false return means the caller
    // must bail out of the operation that requested it.
    exitMaximize(window) {
      const record = this.maximizedWindows.get(window);
      if (record === void 0) {
        return true;
      }
      if (record.kind === "startup") {
        if (record.preservedTile === null || record.scope === null) {
          this.maximizedWindows.delete(window);
          this.diagnostic("maximize:exit cleared");
          return true;
        }
      } else if (record.scope === null || record.preservedTile === null) {
        return true;
      }
      if (window.fullScreen === true) {
        this.diagnostic("maximize:exit restore failed:fullscreen");
        return false;
      }
      const scope = this.scopeForWindow(window);
      if (scope === null || !sameScope(scope.scope, record.scope.scope)) {
        this.diagnostic("maximize:exit restore failed:scope-changed");
        return false;
      }
      if (window.tile !== null && window.tile !== record.preservedTile) {
        this.diagnostic("maximize:exit restore failed:assignment-changed");
        return false;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        this.diagnostic("maximize:exit restore failed:topology-unavailable");
        return false;
      }
      const leaf = operationLeafForTile(topology, record.preservedTile);
      if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
        this.diagnostic("maximize:exit restore failed:tile-missing");
        return false;
      }
      if (window.tile === null) {
        if (leaf.windows.some((occupant) => occupant !== window)) {
          this.diagnostic("maximize:exit restore failed:leaf-occupied");
          return false;
        }
        if (!manageTile(leaf.decoded.tile, window)) {
          this.diagnostic("maximize:exit restore failed:assignment-failed");
          return false;
        }
      }
      if (!writeWindowFrameGeometry(window, leaf.decoded.tile.absoluteGeometry)) {
        this.diagnostic("maximize:exit restore failed:geometry-write");
        return false;
      }
      this.maximizedWindows.delete(window);
      this.diagnostic("maximize:exit restored");
      return true;
    }
    // Re-assert the work-area cover after a fullscreen exit. The maximize
    // record survived the fullscreen round trip; the re-cover is idempotent
    // because KWin already restored the pre-fullscreen cover geometry. Any
    // validation failure is a silent non-destructive skip: the record stays and
    // the next un-maximize runs the full bail analysis.
    recoverMaximize(window) {
      const record = this.maximizedWindows.get(window);
      if (record === void 0 || record.scope === null || record.preservedTile === null) {
        return;
      }
      if (window.fullScreen === true) {
        return;
      }
      const scope = this.scopeForWindow(window);
      if (scope === null || !sameScope(scope.scope, record.scope.scope)) {
        return;
      }
      if (window.tile !== record.preservedTile) {
        return;
      }
      const workArea = this.workAreaForScope(scope);
      if (workArea === null) {
        return;
      }
      if (writeWindowFrameGeometry(window, workArea)) {
        this.diagnostic("maximize:re-covered");
      } else {
        this.diagnostic("maximize:re-cover-failed:geometry-write");
      }
    }
    // Whether any maximized window belongs to this scope. Used only to refuse
    // the whole-scope dwindle reconstruction while a maximized window's
    // preserved tile lives in the scope: reconstruction collapses and rebuilds
    // every leaf, which would destroy the preserved slot. This is a narrow
    // operation-specific refusal for reconstruction only, never a generic
    // scope-wide lifecycle block: unrelated window addition/removal and
    // leaf-level placement proceed (guarded by the precise per-window checks
    // in `runReflow` and `dwindleInsert`). Fullscreen windows are skipped
    // because the fullscreen cover already excludes the scope.
    scopeHasMaximized(scope) {
      for (const [window, record] of this.maximizedWindows) {
        if (window.fullScreen === true) {
          continue;
        }
        const currentScope = this.scopeForWindow(window);
        if (currentScope !== null && sameScope(currentScope.scope, scope.scope)) {
          return true;
        }
        if (currentScope === null && record.scope !== null && sameScope(record.scope.scope, scope.scope)) {
          return true;
        }
      }
      return false;
    }
    // Whether a selected-overlay reflow would reassign a maximized window:
    // true when a live maximized window's current tile is one of the overlay
    // leaves, so the compacting reflow could move it off its preserved slot.
    // Other overlay reflows that never touch the maximized window proceed.
    reflowTouchesMaximized(scope, overlay) {
      for (const [window, record] of this.maximizedWindows) {
        if (window.fullScreen === true) {
          continue;
        }
        const currentScope = this.scopeForWindow(window);
        const inScope = currentScope !== null && sameScope(currentScope.scope, scope.scope) || currentScope === null && record.scope !== null && sameScope(record.scope.scope, scope.scope);
        if (!inScope || !isTile(window.tile)) {
          continue;
        }
        if (overlay.leaves.includes(window.tile)) {
          return true;
        }
      }
      return false;
    }
    // Whether a dwindle insertion would split the preserved tile of a maximized
    // window in this scope. The split targets the deepest leaf; when that leaf
    // is a maximized window's preserved tile, the split is refused so the
    // preserved slot survives. Splitting any other leaf proceeds normally.
    insertionTouchesMaximized(scope, deepest) {
      for (const [, record] of this.maximizedWindows) {
        if (record.scope === null || record.preservedTile === null) {
          continue;
        }
        if (sameScope(record.scope.scope, scope.scope) && record.preservedTile === deepest.tile) {
          return true;
        }
      }
      return false;
    }
    handleInteractiveInvalidated(window) {
      this.gate.run(() => {
        var _a;
        if (((_a = this.drag.current) == null ? void 0 : _a.window) === window) {
          this.diagnostic("drag-bail:window-invalidated");
          this.clearDrag();
        }
        if (this.maximizedWindows.has(window)) {
          this.diagnostic("maximize:ignored lifecycle while maximized");
          return;
        }
        this.detachInteractiveWindow(window);
        this.settleOwedInvariants();
      }, (reason) => this.disabled(reason));
    }
    handleInteractiveStarted(window) {
      this.diagnostic("drag-started");
      this.gate.run(() => {
        if (window.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        if (this.maximizedWindows.has(window)) {
          this.diagnostic("maximize:ignored lifecycle while maximized");
          return;
        }
        const watch = this.interactiveWindows.get(window);
        if (watch !== void 0) {
          watch.kind = window.resize ? "resize" : window.move ? "move" : "unknown";
        }
        if (this.drag.current !== void 0) {
          if (this.trackedDragLive()) {
            this.diagnostic("drag-origin-capture-failed:already-active");
            return;
          }
          this.clearDrag();
          this.settleOwedInvariants();
        }
        if (window.resize) {
          this.diagnostic("drag-origin-capture-failed:resize");
          return;
        }
        if (!window.move) {
          this.diagnostic("drag-origin-capture-failed:not-move");
          return;
        }
        if (this.isFloating(window)) {
          this.diagnostic("drag-origin-capture-failed:floating");
          return;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null || !windowInScope(window, scope)) {
          this.diagnostic("drag-origin-capture-failed:scope");
          return;
        }
        if (window.tile === null || !isCustomTile(window.tile)) {
          this.diagnostic("drag-origin-capture-failed:tile-association");
          return;
        }
        if (this.isInert(scope)) {
          this.diagnostic("drag-origin-capture-failed:scope-inert");
          return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
          this.diagnostic("drag-origin-capture-failed:topology");
          return;
        }
        if (!positiveGeometry(window.frameGeometry)) {
          this.diagnostic("drag-origin-capture-failed:geometry-invalid");
          return;
        }
        const origin = operationLeafForTile(topology, window.tile);
        if (origin === null || origin.leaf.isLayout || windowIndex(origin.windows, window) < 0) {
          this.diagnostic("drag-origin-capture-failed:origin-occupancy");
          return;
        }
        this.drag.set({
          scope,
          window,
          originTile: window.tile,
          originGeometry: {
            x: window.frameGeometry.x,
            y: window.frameGeometry.y,
            width: window.frameGeometry.width,
            height: window.frameGeometry.height
          },
          armedDeferredRemoval: false
        });
        this.diagnostic("drag-origin-captured");
      }, (reason) => this.disabled(reason));
    }
    handleInteractiveFinished(window) {
      this.gate.run(() => {
        if (window.fullScreen === true) {
          this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
          return;
        }
        if (this.maximizedWindows.has(window)) {
          this.diagnostic("maximize:ignored lifecycle while maximized");
          return;
        }
        const watch = this.interactiveWindows.get(window);
        const wasResize = (watch == null ? void 0 : watch.kind) === "resize";
        if (watch !== void 0) {
          watch.kind = "unknown";
        }
        const drag = this.drag.current;
        if (drag === void 0) {
          if (wasResize) {
            this.diagnostic("drag-bail:no-tracked-drag:resize");
          } else {
            this.diagnostic("drag-bail:no-tracked-drag");
          }
          return;
        }
        if (drag.window !== window) {
          this.diagnostic("drag-bail:window-mismatch");
          return;
        }
        try {
          this.completeDrag(drag);
        } finally {
          this.clearDrag();
        }
        if (!drag.armedDeferredRemoval) {
          this.settleOwedInvariants();
        }
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }, (reason) => this.disabled(reason));
    }
    // Stepped keeps the signal attached for live delivery proof but must not
    // emit per-motion journal lines or mutate tiles; only Finished drives reflow.
    handleInteractiveStepped() {
    }
    handleMoveResizedChanged() {
      this.diagnostic("drag-move-resized-changed");
      this.gate.run(() => {
        this.settleOwedInvariants();
      }, (reason) => this.disabled(reason));
    }
    // Read the documented workspace cursor exactly once, at drag finish, under
    // safe validation. Returns the finite cursor point, or null when the read
    // throws or the value is not a finite point; each failure emits a one-time
    // fallback diagnostic and the caller falls back to the final frame center.
    readCursorPoint() {
      let value;
      try {
        value = this.environment.cursorPos();
      } catch (error) {
        void error;
        this.onceDiagnostic("drag-point-fallback:cursor-read-threw");
        return null;
      }
      if (!isPoint(value)) {
        this.onceDiagnostic("drag-point-fallback:cursor-not-a-point");
        return null;
      }
      return { x: value.x, y: value.y };
    }
    // Compact one-line JSON observability for the drop-only finish. Each stage
    // builds a plain-data payload and serializes it; any observation or
    // serialization error is swallowed into a fixed `drag-snapshot-failed`
    // diagnostic so observability never affects the guarded tiling operation.
    dragSnapshot(stage, produce) {
      let data;
      try {
        data = produce();
      } catch (error) {
        void error;
        this.diagnostic(`drag-snapshot-failed:${stage}:observe`);
        return;
      }
      let payload;
      try {
        payload = JSON.stringify(data);
      } catch (error) {
        void error;
        this.diagnostic(`drag-snapshot-failed:${stage}:serialize`);
        return;
      }
      const prefix = stage === "target" ? "drag-target" : `drag-snapshot-${stage}`;
      this.diagnostic(`${prefix}:${payload}`);
    }
    topologyLeavesData(topology) {
      return topology.map((entry) => ({
        id: entry.leaf.id,
        geometry: {
          x: entry.leaf.geometry.x,
          y: entry.leaf.geometry.y,
          width: entry.leaf.geometry.width,
          height: entry.leaf.geometry.height
        },
        occupants: entry.refs.map((ref, index) => {
          var _a;
          return {
            id: ref.id,
            caption: snapshotCaption((_a = entry.windows[index]) == null ? void 0 : _a.caption)
          };
        })
      }));
    }
    dragSnapshotBefore(drag, topology, topologyStatus, center, pointSource = null) {
      this.dragSnapshot("before", () => {
        const geometry = drag.window.frameGeometry;
        const payload = {
          geometry: {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height
          },
          center: center === null ? null : { x: center.x, y: center.y },
          leaves: topology === null ? null : this.topologyLeavesData(topology)
        };
        if (pointSource !== null) {
          payload.pointSource = pointSource;
        }
        if (topology === null) {
          payload.topology = topologyStatus;
        }
        return payload;
      });
    }
    dragTargetResolution(target) {
      this.dragSnapshot("target", () => {
        if (target.kind === "resolved") {
          return {
            kind: "resolved",
            leaf: target.target.leaf.id,
            center: { x: target.center.x, y: target.center.y },
            pointSource: target.pointSource,
            occupancy: target.empty ? "empty" : "occupied"
          };
        }
        if (target.kind === "center-unresolved") {
          return { kind: "center-unresolved" };
        }
        return {
          kind: target.kind,
          center: { x: target.center.x, y: target.center.y },
          pointSource: target.pointSource
        };
      });
    }
    dragSnapshotAfter(topology) {
      this.dragSnapshot("after", () => ({ leaves: this.topologyLeavesData(topology) }));
    }
    dragSnapshotFinal(topology) {
      this.dragSnapshot("final", () => ({ leaves: this.topologyLeavesData(topology) }));
    }
    restoreOrigin(drag) {
      const scope = this.scopeForWindow(drag.window);
      if (scope === null || !sameScope(scope.scope, drag.scope.scope) || !windowInScope(drag.window, scope) || !isCustomTile(drag.originTile) || drag.window.tile === drag.originTile) {
        return false;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null || operationLeafForTile(topology, drag.originTile) === null) {
        return false;
      }
      if (!manageTile(drag.originTile, drag.window)) {
        return false;
      }
      this.diagnostic("drag-origin-restored");
      return true;
    }
    completeDrag(drag) {
      this.diagnostic("drag-finished");
      if (drag.window.fullScreen === true) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      const scope = this.scopeForWindow(drag.window);
      if (scope === null) {
        this.dragSnapshotBefore(drag, null, "scope-unavailable", null);
        this.bailDrag("drag-bail:scope-unavailable", drag);
        return;
      }
      if (!sameScope(scope.scope, drag.scope.scope)) {
        this.dragSnapshotBefore(drag, null, "scope-changed", null);
        this.bailDrag("drag-bail:scope-changed", drag);
        return;
      }
      if (!windowInScope(drag.window, scope)) {
        this.dragSnapshotBefore(drag, null, "window-out-of-scope", null);
        this.bailDrag("drag-bail:window-out-of-scope", drag);
        return;
      }
      if (!isCustomTile(drag.originTile)) {
        this.dragSnapshotBefore(drag, null, "origin-tile-not-custom", null);
        this.bailDrag("drag-bail:origin-tile-not-custom", drag);
        return;
      }
      if (drag.window.tile === drag.originTile && sameGeometry(drag.window.frameGeometry, drag.originGeometry)) {
        this.dragSnapshotBefore(drag, null, "unchanged", null);
        this.diagnostic("drag-unchanged");
        return;
      }
      let topologyRejection = null;
      const topology = this.topologyForScope(scope, (reason) => {
        topologyRejection = reason;
      });
      if (topology === null) {
        this.dragSnapshotBefore(drag, null, topologyRejection != null ? topologyRejection : "unknown", null);
        this.bailDrag(`drag-bail:topology-unavailable:${topologyRejection != null ? topologyRejection : "unknown"}`, drag);
        return;
      }
      if (!positiveGeometry(drag.window.frameGeometry)) {
        this.dragSnapshotBefore(drag, topology, null, null);
        this.bailDrag("drag-bail:geometry-invalid", drag);
        return;
      }
      const cursorPoint = this.readCursorPoint();
      const frameCenter = rectCenter(drag.window.frameGeometry);
      const center = cursorPoint != null ? cursorPoint : frameCenter;
      const pointSource = cursorPoint !== null ? "cursor" : "frame-center";
      this.dragSnapshotBefore(drag, topology, null, center, pointSource);
      const origin = operationLeafForTile(topology, drag.originTile);
      if (origin === null) {
        this.bailDrag("drag-bail:origin-unresolved", drag);
        return;
      }
      if (origin.leaf.isLayout) {
        this.bailDrag("drag-bail:origin-is-layout", drag);
        return;
      }
      this.recoverGeometryDrop(drag, scope, topology, origin, center, pointSource);
    }
    // The OperationLeaf of a native Shift-drop target, or null unless the
    // dragged window's current tile is a non-layout custom-tile leaf holding
    // exactly the dragged window plus one other eligible in-scope occupant,
    // with the dragged window appearing in no other leaf.
    nativeDropTarget(drag, scope, topology) {
      if (drag.window.tile === drag.originTile || !isCustomTile(drag.window.tile) || drag.window.tile.isLayout) {
        return null;
      }
      const target = operationLeafForTile(topology, drag.window.tile);
      if (target === null || target.leaf.isLayout || !isCustomTile(target.decoded.tile)) {
        return null;
      }
      if (windowIndex(target.windows, drag.window) < 0 || target.windows.length !== 2) {
        return null;
      }
      if (topology.filter((entry) => windowIndex(entry.windows, drag.window) >= 0).length !== 1) {
        return null;
      }
      const occupant = target.windows.find((window) => window !== drag.window);
      if (occupant === void 0 || !windowInScope(occupant, scope)) {
        return null;
      }
      return target;
    }
    // Finish-only reflow of every changed drag. The drop target and split
    // direction are derived authoritatively from the dragged window's final
    // frame geometry against the freshly decoded tile tree, excluding the
    // origin leaf, so a plain floating drop, an origin-still-associated drop
    // (KWin's unmanage lagging the finish hook), and a native Shift drop all
    // converge on the same reflow. Native overlap state, when present, is
    // validated only as a safety precondition and never selects the target or
    // direction. Structural safety: the finish dispatch performs exactly one
    // structural call, the position-directed split; the vacated origin's
    // collapse is then deferred to the established one-shot event-loop yield,
    // so the origin is never removed before the split.
    recoverGeometryDrop(drag, scope, topology, origin, center, pointSource) {
      const native = this.nativeDropTarget(drag, scope, topology);
      const target = this.geometryDropTarget(topology, origin, center, pointSource);
      this.dragTargetResolution(target);
      if (target.kind !== "resolved") {
        this.bailDrag(dragGeometryBail(target), drag);
        return;
      }
      if (native !== null && native.leaf !== target.target.leaf) {
        this.bailDrag("drag-bail:geometry-native-mismatch", drag);
        return;
      }
      if (native !== null) {
        this.diagnostic("drag-native-overlap");
      }
      const draggedIndex = windowIndex(target.target.windows, drag.window);
      let draggedRef;
      if (draggedIndex >= 0) {
        const ref = target.target.refs[draggedIndex];
        if (ref === void 0) {
          this.bailDrag("drag-bail:geometry-plan-rejected:ref-unresolved", drag);
          return;
        }
        draggedRef = ref;
      } else {
        draggedRef = {
          id: "window-dragged",
          normal: drag.window.normalWindow,
          managed: drag.window.managed
        };
      }
      const plan = planGeometryDrop({
        scope: scope.scope,
        originLeaf: origin.leaf,
        targetLeaf: target.target.leaf,
        draggedWindow: draggedRef,
        pointer: target.center,
        record: {
          scope: scope.scope,
          originLeafId: origin.leaf.id,
          windowId: draggedRef.id,
          geometry: drag.originGeometry
        }
      });
      if (!plan.ok) {
        this.bailDrag(`drag-bail:geometry-plan-rejected:${plan.reason.kind}`, drag);
        return;
      }
      if (plan.value.kind === "geometry-drop-empty") {
        this.diagnostic("drag-empty-target");
        this.applyEmptyDrop(drag, scope, target.target);
        return;
      }
      this.diagnostic("drag-geometry-target");
      this.applyDropSplit(drag, scope, target.target, plan.value.direction);
    }
    // The non-layout leaf (occupied or empty) under the chosen resolver point
    // (the documented workspace cursor when finite, else the dragged window's
    // final frame geometry center), excluding the origin leaf, or a distinct
    // bail branch when the point resolves nowhere. The smallest eligible leaf
    // wins by the same ordering rule as the classic cursor target selection.
    // An empty leaf resolves as a direct-placement target, not a bail.
    geometryDropTarget(topology, origin, center, pointSource) {
      if (center === null) {
        return { kind: "center-unresolved" };
      }
      const leaf = pickDropLeaf(topology.map((entry) => entry.leaf), center);
      if (leaf === null) {
        return { kind: "no-target-leaf", center, pointSource };
      }
      if (leaf.id === origin.leaf.id) {
        return { kind: "target-is-origin", center, pointSource };
      }
      for (const entry of topology) {
        if (entry.leaf === leaf) {
          return { kind: "resolved", target: entry, center, pointSource, empty: entry.windows.length === 0 };
        }
      }
      return { kind: "leaf-not-in-topology", center, pointSource };
    }
    bailDrag(reason, drag) {
      this.diagnostic(reason);
      this.restoreOrigin(drag);
    }
    // Direct placement of the dragged window into a resolved empty non-layout
    // target leaf: a single guarded manage with no split and no occupied-leaf
    // reflow, then the vacated origin's collapse is deferred to the established
    // one-shot yield exactly like the split path.
    applyEmptyDrop(drag, scope, target) {
      let managed = false;
      try {
        managed = manageTile(target.decoded.tile, drag.window);
      } catch (error) {
        void error;
      }
      if (!managed) {
        this.bailDrag("drag-bail:empty-placement-failed", drag);
        return;
      }
      this.diagnostic("drag-empty-placement");
      drag.armedDeferredRemoval = true;
      this.deferRemovalCollapse(drag.window, scope, drag.originTile, true);
    }
    // Split a resolved drop target leaf into the direction-derived children and
    // manage the original occupant onto the opposite child and the dragged
    // window onto the selected child, then defer the vacated origin's collapse
    // to the established one-shot yield. Shared by the native Shift-drop and
    // plain geometry-drop paths.
    applyDropSplit(drag, scope, target, direction) {
      const occupant = target.windows.find((window) => window !== drag.window);
      if (occupant === void 0 || !windowInScope(occupant, scope)) {
        this.bailDrag("drag-bail:target-occupant-invalid", drag);
        return;
      }
      if (this.splitWouldViolateMinimum(scope, target, direction)) {
        this.diagnostic("drag-refused:undersized-split");
        return;
      }
      if (!this.splitDropTarget(target, occupant, drag, direction)) {
        return;
      }
      this.diagnostic("drag-overlap-split-completed");
      drag.armedDeferredRemoval = true;
      this.deferRemovalCollapse(drag.window, scope, drag.originTile, true, {
        dragged: drag.window,
        occupant
      });
    }
    // Whether the equal 50/50 drop split of the resolved target leaf along the
    // split direction would put either half below KWin's minimum tile size. The
    // floor is MINIMUM_TILE_FRACTION of the per-output working area extent on
    // the split axis (x for left/right, y for up/down). An unreadable working
    // area never refuses: the preflight must not invent a floor it cannot prove.
    splitWouldViolateMinimum(scope, target, direction) {
      const axis = direction === "left" || direction === "right" ? "x" : "y";
      const leafExtent = axis === "x" ? target.leaf.geometry.width : target.leaf.geometry.height;
      const workArea = this.environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
      if (!isRect(workArea)) {
        return false;
      }
      const workExtent = axis === "x" ? workArea.width : workArea.height;
      if (!(workExtent > 0)) {
        return false;
      }
      return leafExtent / 2 < MINIMUM_TILE_FRACTION * workExtent;
    }
    // Split a drop target leaf into the direction-derived children and manage
    // the original occupant onto the opposite child and the dragged window
    // onto the selected child. Shared by every changed-drag reflow (plain
    // floating, origin-still-associated, and native Shift). A malformed split
    // result or a failed manage disables the gate, matching the established
    // drag contract.
    splitDropTarget(target, occupant, drag, direction) {
      if (!isCustomTile(target.decoded.tile)) {
        this.gate.disable("drag-split-result-invalid", (reason) => this.disabled(reason));
        return false;
      }
      const split = splitCustomTile(target.decoded.tile, splitDirection2(direction));
      const decoded = decodeSequential(split, isCustomTile, 2);
      if (decoded.ok) {
        this.decodedBoundary("split-result");
      }
      const axis = direction === "left" || direction === "right" ? "x" : "y";
      const children = decoded.ok ? orderedChildren(decoded.value, axis) : null;
      if (children === null) {
        this.gate.disable("drag-split-result-invalid", (reason) => this.disabled(reason));
        return false;
      }
      const first = children[0];
      const second = children[1];
      const selected = direction === "left" || direction === "up" ? first : second;
      const opposite = selected === first ? second : first;
      const occupantManaged = manageTile(opposite, occupant);
      const draggedManaged = occupantManaged && manageTile(selected, drag.window);
      if (!occupantManaged || !draggedManaged) {
        this.gate.disable("drag-manage-failed", (reason) => this.disabled(reason));
        return false;
      }
      return true;
    }
    scopeForWindow(window) {
      if (!isWindow(window) || !isOutput(window.output)) {
        return null;
      }
      const desktop = this.environment.currentDesktopForOutput(window.output);
      if (!isVirtualDesktop(desktop)) {
        return null;
      }
      return {
        output: window.output,
        desktop,
        scope: { output: window.output, desktopId: desktop.id }
      };
    }
    topologyForScope(scope, onRejected) {
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isTile(root)) {
        onRejected == null ? void 0 : onRejected("root-lookup");
        return null;
      }
      const leaves = decodeLeaves(root, (kind) => this.decodedBoundary(kind));
      if (leaves === null) {
        onRejected == null ? void 0 : onRejected("topology-decode");
        return null;
      }
      return makeOperationLeaves(leaves);
    }
    // ---- Floating and sticky window state ----
    isFloating(window) {
      return this.floatingWindows.has(window);
    }
    isSticky(window) {
      return this.stickyWindows.has(window);
    }
    // Floating windows whose preserved leaf lives in this exact scope. Sticky
    // windows keep their float-scope record at the scope where they were
    // floated, so this still counts them after they were pinned across
    // desktops. The dwindle bijection and invariant checks use this to tolerate
    // the vacated preserved leaves instead of collapsing them.
    scopeFloatingCount(scope) {
      let count = 0;
      for (const window of this.floatingWindows) {
        const record = this.floatScopes.get(window);
        if (record !== void 0 && sameScope(record, scope.scope)) {
          count += 1;
        }
      }
      return count;
    }
    scopeHasFloating(scope) {
      return this.scopeFloatingCount(scope) > 0;
    }
    // Per-output working area for the exact scope through the documented
    // workspace `clientArea(WorkArea, output, desktop)` seam (source-pinned
    // enum WorkArea = 5). Returns null when the read throws or the area is not
    // a positive finite rect, so no unvalidated geometry is ever derived.
    workAreaForScope(scope) {
      let value;
      try {
        value = this.environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
      } catch (error) {
        void error;
        return null;
      }
      if (!isRect(value) || value.width <= 0 || value.height <= 0) {
        return null;
      }
      return value;
    }
    // Centered 60% x 60% of the working area, floored to integer pixels and
    // strictly inside it (60% of a positive rect always fits).
    centeredFloatGeometry(workArea) {
      const width = Math.floor(workArea.width * FLOAT_WORK_AREA_FRACTION);
      const height = Math.floor(workArea.height * FLOAT_WORK_AREA_FRACTION);
      return {
        x: Math.floor(workArea.x + (workArea.width - width) / 2),
        y: Math.floor(workArea.y + (workArea.height - height) / 2),
        width,
        height
      };
    }
    // Clamp a remembered float geometry so the window stays fully inside the
    // current work area (bounded to it) when the output geometry changed.
    boundFloatGeometry(geometry, workArea) {
      const width = Math.min(geometry.width, workArea.width);
      const height = Math.min(geometry.height, workArea.height);
      const maxX = workArea.x + workArea.width - width;
      const maxY = workArea.y + workArea.height - height;
      const x = Math.min(Math.max(geometry.x, workArea.x), maxX);
      const y = Math.min(Math.max(geometry.y, workArea.y), maxY);
      return { x, y, width, height };
    }
    // Write the float geometry: the session-remembered geometry bounded to the
    // current work area, or the centered 60% default when none is remembered.
    // The written geometry is recorded for the session so re-float, sticky
    // toggles, and the fullscreen round trip restore it. Returns whether the
    // guarded write reported success; the record is kept even on a failed write
    // so the remembered size survives the fullscreen seam.
    writeFloatGeometry(window, scope) {
      const workArea = this.workAreaForScope(scope);
      if (workArea === null) {
        return false;
      }
      const remembered = this.floatGeometries.get(window);
      const geometry = remembered !== void 0 ? this.boundFloatGeometry(remembered, workArea) : this.centeredFloatGeometry(workArea);
      const written = writeWindowFrameGeometry(window, geometry);
      this.floatGeometries.set(window, geometry);
      return written;
    }
    completeKeyboardInsertion(window, pending) {
      const active = this.environment.activeWindow();
      const activeScope = this.scopeForWindow(active);
      const scope = this.scopeForWindow(window);
      if (activeScope === null || scope === null || !sameScope(activeScope.scope, pending.scope.scope) || !sameScope(scope.scope, pending.scope.scope) || !windowInScope(active, activeScope) || !windowInScope(window, scope) || !windowInScope(pending.targetWindow, scope) || active.tile !== pending.targetTile) {
        return;
      }
      if (window.fullScreen === true || active.fullScreen === true || pending.targetWindow.fullScreen === true) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        return;
      }
      const target = operationLeafForTile(topology, pending.targetTile);
      if (target === null || target.leaf.isLayout || !isCustomTile(target.decoded.tile)) {
        return;
      }
      const targetIndex = windowIndex(target.windows, pending.targetWindow);
      if (targetIndex < 0) {
        return;
      }
      for (const occupant of target.windows) {
        if (!windowInScope(occupant, scope)) {
          return;
        }
      }
      const focused = target.refs[targetIndex];
      if (focused === void 0) {
        return;
      }
      const plan = planKeyboardInsertion({
        scope: scope.scope,
        direction: pending.direction,
        focusedLeaf: target.leaf,
        focusedWindow: focused,
        incoming: { id: "incoming", normal: window.normalWindow, managed: window.managed },
        record: { scope: scope.scope, leafId: target.leaf.id, windowId: focused.id }
      });
      if (!plan.ok) {
        return;
      }
      const split = splitCustomTile(target.decoded.tile, splitDirection2(pending.direction));
      const decoded = decodeSequential(split, isCustomTile, 2);
      if (!decoded.ok) {
        this.gate.disable("keyboard-split-result-invalid", (reason) => this.disabled(reason));
        return;
      }
      this.decodedBoundary("split-result");
      const axis = pending.direction === "left" || pending.direction === "right" ? "x" : "y";
      const children = decoded.ok ? orderedChildren(decoded.value, axis) : null;
      if (children === null) {
        this.gate.disable("keyboard-split-child-selection-failed", (reason) => this.disabled(reason));
        return;
      }
      const first = children[0];
      const second = children[1];
      const occupantChild = pending.direction === "left" || pending.direction === "up" ? second : first;
      const incomingChild = occupantChild === first ? second : first;
      if (!manageTile(occupantChild, pending.targetWindow)) {
        this.diagnostic("keyboard-failed:first-assignment");
        return;
      }
      if (!manageTile(incomingChild, window)) {
        this.diagnostic("keyboard-failed:second-assignment");
        return;
      }
      this.diagnostic("keyboard-completed");
    }
    // Returns the placement outcome. Managed-scope dwindle ownership reuses
    // this deterministic empty-leaf placement so a full owned tree keeps the
    // same guarded assignment and diagnostic as generic automatic placement.
    placeAutomatically(window, scope) {
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        return { kind: "topology-unavailable" };
      }
      const plan = planAutomaticPlacement({
        scope: scope.scope,
        window: { id: "incoming", normal: window.normalWindow, managed: window.managed },
        leaves: topology.map((entry) => entry.leaf)
      });
      if (!plan.ok) {
        return { kind: "no-empty-leaf" };
      }
      for (const entry of topology) {
        if (entry.leaf === plan.value.leaf) {
          if (manageTile(entry.decoded.tile, window)) {
            this.diagnostic("automatic-placement-managed");
            return { kind: "managed" };
          }
          return { kind: "assignment-failed" };
        }
      }
      return { kind: "no-empty-leaf" };
    }
    // ---- Automatic session-local managed-scope dwindle ownership ----
    // Re-anchor ownership to the current scope after controller start or a
    // screens/current-desktop change. The anchor is the active eligible
    // in-scope window, else the first eligible in-scope window in the proven
    // window collection. A scope with no owned windows is never managed.
    engageCurrentScope() {
      const anchor = this.ownershipAnchor();
      if (anchor === null) {
        return;
      }
      const scope = this.scopeForWindow(anchor);
      if (scope === null) {
        return;
      }
      this.ensureManaged(scope);
    }
    ownershipAnchor() {
      const active = this.environment.activeWindow();
      if (isWindow(active)) {
        const scope = this.scopeForWindow(active);
        if (scope !== null && windowInScope(active, scope)) {
          return active;
        }
      }
      const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        return null;
      }
      this.decodedBoundary("workspace-window-list");
      for (const window of windows.value) {
        const scope = this.scopeForWindow(window);
        if (scope !== null && windowInScope(window, scope)) {
          return window;
        }
      }
      return null;
    }
    managedRecord(scope) {
      var _a, _b;
      return (_b = (_a = this.managedScopes.get(scope.output)) == null ? void 0 : _a.get(scope.desktop.id)) != null ? _b : null;
    }
    isOwned(scope) {
      const record = this.managedRecord(scope);
      return record !== null && !record.inert;
    }
    isInert(scope) {
      const record = this.managedRecord(scope);
      return record !== null && record.inert;
    }
    setManaged(scope) {
      let byDesktop = this.managedScopes.get(scope.output);
      if (byDesktop === void 0) {
        byDesktop = /* @__PURE__ */ new Map();
        this.managedScopes.set(scope.output, byDesktop);
      }
      byDesktop.set(scope.desktop.id, { scope, inert: false });
    }
    // A failed or damaged scope becomes inert for this session only: the
    // record is retained so it is never retried, while other scopes and the
    // generic placement paths keep working.
    markInert(scope, reason) {
      let byDesktop = this.managedScopes.get(scope.output);
      if (byDesktop === void 0) {
        byDesktop = /* @__PURE__ */ new Map();
        this.managedScopes.set(scope.output, byDesktop);
      }
      byDesktop.set(scope.desktop.id, { scope, inert: true });
      this.diagnostic(`ownership-inert:${reason}`);
    }
    // Adopt session-local ownership of the anchored scope with ratio-free
    // dwindle. A valid selected overlay takes precedence and leaves the scope
    // overlay-managed. The owned population is every eligible in-scope window
    // from the proven window collection excluding explicitly detached windows.
    // When the scope's tree already realizes the dwindle blueprint for that
    // count it is adopted unchanged; otherwise a full reconstruction starts:
    // a synchronous removals-only collapse to a single leaf followed by a
    // non-timer event-loop yield before the deferred split reconstruction.
    ensureManaged(scope) {
      if (this.isOwned(scope) || this.isInert(scope)) {
        return;
      }
      if (this.readSelectedOverlay(scope) !== null) {
        return;
      }
      const population = this.ownedPopulation(scope);
      if (population.length === 0) {
        return;
      }
      this.setManaged(scope);
      if (this.scopeHasFloating(scope)) {
        this.diagnostic("ownership-taken");
        return;
      }
      if (this.dwindleMatches(scope, population)) {
        this.diagnostic("ownership-taken");
        return;
      }
      this.startReconstruction(scope);
    }
    // The owned population of a scope: eligible in-scope windows from the
    // proven window collection, excluding windows explicitly detached by the
    // detach action and floating/sticky windows. Floating windows are never
    // part of the placement population, the tree bijection, or the
    // reconstruction window-set comparisons; their vacated preserved leaves are
    // tolerated by the invariant checks through `scopeFloatingCount`.
    ownedPopulation(scope) {
      const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        return [];
      }
      this.decodedBoundary("workspace-window-list");
      const owned = [];
      for (const window of windows.value) {
        if (windowInScope(window, scope) && !this.detachedWindows.has(window) && !this.isFloating(window)) {
          owned.push(window);
        }
      }
      return owned;
    }
    // Whether the scope's current tree already realizes the ratio-free dwindle
    // blueprint for the owned population. A population of one is realized by
    // exactly one usable leaf (a non-layout tile or a zero-child layout root)
    // occupied by the sole owned window, regardless of the root wrapper; higher
    // counts require the exact dwindle chain with alternating orientation. In
    // every case the occupancy must be a bijection between the usable leaves
    // and the population: each leaf holds exactly one owned window whose
    // recorded `tile` is that leaf, and every owned window occupies exactly one
    // leaf. An empty population is never realized, so an empty owned scope
    // never matches.
    dwindleMatches(scope, population) {
      const count = population.length;
      if (count === 0) {
        return false;
      }
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isCustomTile(root)) {
        return false;
      }
      if (count === 1) {
        const leaves = decodeUsableLeaves(root);
        if (leaves === null || leaves.length !== 1) {
          return false;
        }
        return dwindleBijectionTreeMatches(scope, root, population);
      }
      const blueprint = buildDwindleBlueprint(count);
      if (!blueprint.ok) {
        return false;
      }
      if (!dwindleNodeMatches(root, blueprint.value, 0)) {
        return false;
      }
      return dwindleBijectionTreeMatches(scope, root, population);
    }
    // Full dwindle reconstruction, phase registration: record the owned scope
    // as awaiting its first one-shot event-loop yield and arm it. No structural
    // call happens here; the removals-only collapse runs at the first yield
    // callback and the splits-only rebuild at the second. A valid selected
    // overlay or an inert scope drops the pending reconstruction without
    // acting. A later request while a reconstruction is already pending starts
    // no second one: it re-arms the current phase's yield so a lost callDBus
    // reply (scripting.cpp:361-364 never invokes the callback on an error
    // reply) cannot strand the scope in a collapsed or un-rebuilt state. Each
    // such re-arm counts against the current phase's bounded budget; once the
    // budget is exhausted the scope fails closed and becomes inert instead of
    // retrying forever, while the phase and pending-identity guards keep every
    // stale or duplicate callback inert.
    startReconstruction(scope) {
      var _a;
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (this.scopeHasMaximized(scope)) {
        this.diagnostic("maximize:ignored reconstruction while maximized");
        return;
      }
      if (this.trackedDragLive()) {
        this.markOwedInvariant(scope);
        return;
      }
      const existing = (_a = this.pendingRebuilds.get(scope.output)) == null ? void 0 : _a.get(scope.desktop.id);
      if (existing !== void 0) {
        existing.rearmCount += 1;
        if (existing.rearmCount > MAX_YIELD_REARM_PER_PHASE) {
          this.markInert(scope, "rearm-budget-exhausted");
          this.dropPendingRebuild(scope, existing);
          return;
        }
        if (!this.armRebuildYield(scope, existing)) {
          this.markInert(scope, "rearm-yield-arm-failed");
          this.dropPendingRebuild(scope, existing);
        }
        return;
      }
      const pending = { scope, phase: "awaiting-collapse", rearmCount: 0 };
      let byDesktop = this.pendingRebuilds.get(scope.output);
      if (byDesktop === void 0) {
        byDesktop = /* @__PURE__ */ new Map();
        this.pendingRebuilds.set(scope.output, byDesktop);
      }
      byDesktop.set(scope.desktop.id, pending);
      if (!this.armRebuildYield(scope, pending)) {
        this.markInert(scope, "initial-yield-arm-failed");
        this.dropPendingRebuild(scope, pending);
        return;
      }
      this.diagnostic("ownership-pending");
    }
    // Arm exactly one one-shot event-loop yield for the pending rebuild's
    // current phase. The callback captures the phase it was armed for and is
    // inert unless the same pending record is still current and still in that
    // phase, so a duplicate or stale callback can never collapse, split, or
    // assign twice. A failed arm fails the scope closed rather than stranding
    // it.
    armRebuildYield(scope, pending) {
      const armedFor = pending.phase;
      let armed = false;
      try {
        armed = this.environment.yieldOnce(() => {
          var _a;
          if (((_a = this.pendingRebuilds.get(scope.output)) == null ? void 0 : _a.get(scope.desktop.id)) !== pending) {
            return;
          }
          if (pending.phase !== armedFor) {
            return;
          }
          this.settleScopeRebuild(scope, pending);
        });
      } catch (error) {
        void error;
        return false;
      }
      return armed;
    }
    // Guarded collapse of an owned scope to a single leaf through the guarded
    // reset seam: every occupant is unmanaged before the first removal, each
    // removal is one `CustomTile.remove()`, and the root is freshly decoded
    // after every removal. No removal result is ever an acknowledgement.
    collapseOwnedScope(scope) {
      const seam = {
        snapshot: () => this.resetSnapshot(scope),
        unmanage: (_tile, window) => detachWindowFromTile(window),
        remove: (tile) => isCustomTile(tile) && removeCustomTile(tile)
      };
      const result = collapseToRootLeaf(seam);
      return result.ok;
    }
    // Fresh decoded snapshot of the whole scope tree for the guarded reset
    // seam. The root and every reachable tile are re-resolved from the
    // environment each call; no handle is retained across removals.
    resetSnapshot(scope) {
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isTile(root)) {
        return null;
      }
      const tiles = decodeTileTree(root);
      if (tiles === null) {
        return null;
      }
      const entries = [];
      for (const tile of tiles) {
        const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
        if (!children.ok) {
          return null;
        }
        let occupants = [];
        if (!tile.isLayout) {
          const decoded = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
          if (!decoded.ok) {
            return null;
          }
          occupants = decoded.value;
        }
        entries.push({ tile, children: children.value, occupants, removable: tile.canBeRemoved });
      }
      return { root, tiles: entries };
    }
    // Full dwindle reconstruction phase dispatch: re-validate everything fresh
    // (scope ownership, selected-overlay precedence, owned population, and the
    // live dwindle match), then either drop the pending rebuild or perform the
    // phase's one structural dispatch. The awaiting-collapse dispatch is a
    // synchronous removals-only collapse that arms the second yield; the
    // awaiting-split dispatch is a synchronous splits-only rebuild that drops
    // the pending record. Every callback re-resolves the scope, root, and
    // window membership fresh and never touches a recorded child tile handle.
    settleScopeRebuild(scope, pending) {
      if (this.isInert(scope) || !this.isOwned(scope)) {
        this.dropPendingRebuild(scope, pending);
        return;
      }
      if (this.scopeHasFullscreen(scope)) {
        this.dropPendingRebuild(scope, pending);
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (this.scopeHasMaximized(scope)) {
        this.dropPendingRebuild(scope, pending);
        this.diagnostic("maximize:ignored reconstruction while maximized");
        return;
      }
      if (this.trackedDragLive()) {
        this.markOwedInvariant(scope);
        this.dropPendingRebuild(scope, pending);
        return;
      }
      if (this.readSelectedOverlay(scope) !== null) {
        this.dropPendingRebuild(scope, pending);
        return;
      }
      const population = this.ownedPopulation(scope);
      if (population.length === 0) {
        this.dropPendingRebuild(scope, pending);
        return;
      }
      if (this.dwindleMatches(scope, population)) {
        this.dropPendingRebuild(scope, pending);
        return;
      }
      if (pending.phase === "awaiting-collapse") {
        if (!this.collapseOwnedScope(scope)) {
          this.markInert(scope, "collapse-failed");
          this.dropPendingRebuild(scope, pending);
          return;
        }
        pending.phase = "awaiting-split";
        pending.rearmCount = 0;
        this.diagnostic("ownership-collapsed");
        if (!this.armRebuildYield(scope, pending)) {
          this.markInert(scope, "split-yield-arm-failed");
          this.dropPendingRebuild(scope, pending);
        }
        return;
      }
      if (this.rebuildDwindle(scope, population)) {
        this.diagnostic("ownership-taken");
      } else {
        this.markInert(scope, "rebuild-failed");
      }
      this.dropPendingRebuild(scope, pending);
    }
    // Fresh resolution of a compiled blueprint path to the live custom tile:
    // the scope root is re-resolved from the environment and the tree is
    // re-decoded on every call, so the returned handle is valid only until the
    // next structural call and is never retained across one.
    dwindleTileAtPath(scope, path) {
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isCustomTile(root)) {
        return null;
      }
      let current = root;
      for (const segment of path) {
        if (segment === "root") {
          continue;
        }
        const children = decodeSequential(current.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
        if (!children.ok) {
          return null;
        }
        const child = segment === "left" ? children.value[0] : children.value[1];
        if (child === void 0) {
          return null;
        }
        current = child;
      }
      return current;
    }
    // Full dwindle reconstruction, phase two body: a single synchronous
    // splits-only batch realizing the ratio-free dwindle blueprint for the
    // current owned population on the freshly resolved single-leaf root, then
    // guarded assignments of the population to the ordinal leaves. Every split
    // re-resolves the scope root and fresh-decodes the tree around the call,
    // and the split return value is validated and discarded rather than
    // retained, so no tile handle survives from one structural call to the
    // next. The whole split reconstruction finishes in one dispatch, never one
    // frame per tile.
    rebuildDwindle(scope, population) {
      if (population.length === 0) {
        return false;
      }
      const compiled = buildPreset("dwindle", population.length);
      if (!compiled.ok) {
        return false;
      }
      for (const instruction of compiled.value.splits) {
        const target = this.dwindleTileAtPath(scope, instruction.targetPath);
        if (target === null) {
          return false;
        }
        let split;
        try {
          split = splitCustomTile(target, layoutDirectionFor(instruction.orientation));
        } catch (error) {
          void error;
          return false;
        }
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (!decoded.ok || decoded.value.length !== 2) {
          return false;
        }
      }
      const leaves = [];
      for (const leafPath of compiled.value.leafPaths) {
        const leaf = this.dwindleTileAtPath(scope, leafPath.path);
        if (leaf === null) {
          return false;
        }
        leaves.push(leaf);
      }
      if (leaves.length !== population.length) {
        return false;
      }
      for (let index = 0; index < population.length; index += 1) {
        const window = population[index];
        const leaf = leaves[index];
        if (window === void 0 || leaf === void 0) {
          return false;
        }
        let assigned = false;
        try {
          assigned = assignWindowToTile(window, leaf);
        } catch (error) {
          void error;
          return false;
        }
        if (!assigned) {
          return false;
        }
      }
      return true;
    }
    dropPendingRebuild(scope, pending) {
      const byDesktop = this.pendingRebuilds.get(scope.output);
      if ((byDesktop == null ? void 0 : byDesktop.get(scope.desktop.id)) === pending) {
        byDesktop.delete(scope.desktop.id);
        if (byDesktop.size === 0) {
          this.pendingRebuilds.delete(scope.output);
        }
        if (pending.dragFinalSnapshot) {
          const finalTopology = this.topologyForScope(scope);
          if (finalTopology !== null) {
            this.dragSnapshotFinal(finalTopology);
          }
        }
      }
      if (this.pendingRebuilds.size === 0) {
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }
    }
    recordDetached(window) {
      if (this.detachedWindows.size >= MAX_SEQUENTIAL_LENGTH) {
        const stale = this.detachedWindows.values().next().value;
        if (stale !== void 0) {
          this.detachedWindows.delete(stale);
        }
      }
      this.detachedWindows.add(window);
    }
    // Re-establish the dwindle invariant for an owned scope after a managed
    // count change: when the current tree no longer realizes the dwindle
    // blueprint for the current population, start a full reconstruction. A
    // scope with no owned population or an authoritative valid overlay is
    // untouched. The scope root is decoded exactly once per check and shared by
    // the occupancy-bijection predicate and the canonical-shape predicate.
    dwindleEnsureInvariant(scope) {
      if (!this.isOwned(scope) || this.isInert(scope)) {
        return;
      }
      if (this.readSelectedOverlay(scope) !== null) {
        return;
      }
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (this.scopeHasMaximized(scope)) {
        this.diagnostic("maximize:ignored reconstruction while maximized");
        return;
      }
      if (this.trackedDragLive()) {
        this.markOwedInvariant(scope);
        return;
      }
      const population = this.ownedPopulation(scope);
      if (population.length === 0) {
        return;
      }
      if (this.scopeHasFloating(scope)) {
        this.diagnostic("ownership-invariant:float-preserved");
        return;
      }
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isCustomTile(root) || !dwindleBijectionTreeMatches(scope, root, population)) {
        this.diagnostic("ownership-invariant:bijection-failed");
        this.startReconstruction(scope);
        return;
      }
      if (!this.dwindleShapeMatches(root, population)) {
        this.diagnostic("ownership-accepted:non-canonical:bijection-intact");
      }
    }
    // Canonical dwindle-shape predicate for the already-resolved scope root:
    // whether the tree realizes the ratio-free dwindle blueprint for the
    // population count. A population of one is realized by exactly one usable
    // leaf (a non-layout tile or a zero-child layout root); higher counts
    // require the exact dwindle chain with alternating orientation. Only the
    // shape is checked here; occupancy is the separate bijection predicate. The
    // root is never re-read.
    dwindleShapeMatches(root, population) {
      const count = population.length;
      if (count === 1) {
        const leaves = decodeUsableLeaves(root);
        return leaves !== null && leaves.length === 1;
      }
      const blueprint = buildDwindleBlueprint(count);
      if (!blueprint.ok) {
        return false;
      }
      return dwindleNodeMatches(root, blueprint.value, 0);
    }
    // The deepest right-spine non-layout custom tile under the scope root (the
    // dwindle insertion point) with its depth. The dwindle chain recurses into
    // the last decoded child of every layout, so the insertion point is that
    // spine's terminal leaf. Freshly decoded each call; no handle is retained
    // across structural calls.
    deepestLeaf(scope) {
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isCustomTile(root)) {
        return null;
      }
      const usable = decodeUsableLeaves(root);
      if (usable === null) {
        return null;
      }
      if (usable.length === 1) {
        return { tile: root, depth: 0 };
      }
      const walk = (tile, depth) => {
        if (tile.isLayout) {
          const children = decodeSequential(tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
          if (!children.ok || children.value.length === 0) {
            return null;
          }
          const last = children.value[children.value.length - 1];
          if (last === void 0) {
            return null;
          }
          return walk(last, depth + 1);
        }
        return { tile, depth };
      };
      return walk(root, 0);
    }
    // Dispatch an eligible added window to the owned-scope dwindle path or the
    // generic overlay/automatic-placement path. A not-yet-owned, not-inert
    // scope is adopted first: the window's scope is the current desktop of its
    // output, so this re-establishes ownership when the current desktop had no
    // window at the earlier `currentDesktopChanged` notification and was left
    // unmanaged. Adoption goes through `ensureManaged` (dwindle match or the
    // two-phase reconstruction), never a direct remove or split.
    placeEligibleAdded(window, scope) {
      if (this.isFloating(window)) {
        return;
      }
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (!this.isOwned(scope) && !this.isInert(scope)) {
        this.ensureManaged(scope);
      }
      if (this.isOwned(scope)) {
        this.dwindleAdd(window, scope);
      } else {
        this.refillOrPlaceAutomatically(window, scope);
      }
    }
    // Owned-scope add: a valid selected overlay wins and its reflow (with the
    // established generic fallback) handles the window. Without an overlay the
    // window is placed into a retained empty leaf through the same guarded
    // automatic placement, and only when no empty leaf exists does a single
    // splits-only dwindle insertion split the deepest leaf. No removal is ever
    // part of an add dispatch.
    dwindleAdd(window, scope) {
      const outcome = this.runReflow(scope, window);
      if (outcome.kind !== "no-selection" && outcome.kind !== "no-capacity") {
        return;
      }
      if (outcome.kind === "no-capacity") {
        this.placeAutomatically(window, scope);
        return;
      }
      if (window.tile !== null) {
        return;
      }
      if (this.placeAutomatically(window, scope).kind === "managed") {
        return;
      }
      this.dwindleInsert(window, scope);
      this.dwindleEnsureInvariant(scope);
    }
    // One dwindle insertion: split the deepest leaf with depth-derived
    // orientation, keep its sole eligible occupant on the first child, and
    // assign the incoming window to the second child. The split is the only
    // structural call; its result is freshly decoded before any assignment.
    // A structural or decode failure marks the scope inert; a strict
    // geometry-order rejection is a capacity failure that leaves the scope
    // retryable.
    dwindleInsert(window, scope) {
      var _a;
      if (((_a = this.pendingRebuilds.get(scope.output)) == null ? void 0 : _a.get(scope.desktop.id)) !== void 0) {
        return;
      }
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        this.markInert(scope, "insert-topology-failed");
        return;
      }
      if (window.tile !== null) {
        return;
      }
      const deepest = this.deepestLeaf(scope);
      if (deepest === null) {
        this.markInert(scope, "insert-deepest-leaf-failed");
        return;
      }
      if (this.insertionTouchesMaximized(scope, deepest)) {
        this.diagnostic("maximize:ignored insert while maximized");
        return;
      }
      const insertion = this.insertionLeafWindows(scope, topology, deepest);
      if (insertion === null) {
        this.markInert(scope, "insert-leaf-resolution-failed");
        return;
      }
      const occupants = insertion.windows.filter(
        (value) => windowInScope(value, scope) && value.tile === insertion.tile
      );
      if (insertion.windows.length === 0 && insertion.tile.isLayout) {
        let assigned = false;
        try {
          assigned = assignWindowToTile(window, insertion.tile);
        } catch (error) {
          void error;
        }
        if (!assigned || !this.dwindleMatches(scope, this.ownedPopulation(scope))) {
          this.markInert(scope, "occupied-root-assign-failed");
          return;
        }
        this.diagnostic("ownership-add-occupied-root");
        return;
      }
      if (occupants.length !== 1) {
        this.markInert(scope, "insert-occupant-count-mismatch");
        return;
      }
      const occupant = occupants[0];
      if (occupant === void 0) {
        this.markInert(scope, "insert-occupant-missing");
        return;
      }
      const orientation = deepest.depth % 2 === 0 ? "horizontal" : "vertical";
      let split;
      try {
        split = splitCustomTile(deepest.tile, layoutDirectionFor(orientation));
      } catch (error) {
        void error;
        this.markInert(scope, "insert-split-threw");
        return;
      }
      const decoded = decodeSequential(split, isCustomTile, 2);
      if (!decoded.ok || decoded.value.length !== 2) {
        this.markInert(scope, "insert-split-decode-failed");
        return;
      }
      this.decodedBoundary("split-result");
      const axis = orientation === "horizontal" ? "x" : "y";
      const children = orderedChildren(decoded.value, axis);
      if (children === null) {
        this.diagnostic("ownership-add-failed:no-child-geometry");
        return;
      }
      let occupantAssigned = false;
      let incomingAssigned = false;
      try {
        occupantAssigned = assignWindowToTile(occupant, children[0]);
        incomingAssigned = occupantAssigned && assignWindowToTile(window, children[1]);
      } catch (error) {
        void error;
      }
      if (!occupantAssigned || !incomingAssigned) {
        this.diagnostic("ownership-add-failed:assignment");
        return;
      }
      this.diagnostic("ownership-add-split");
    }
    // The decoded occupant list of the dwindle insertion leaf for a freshly
    // resolved deepest leaf, with the leaf tile the occupants belong to. A
    // non-layout deepest leaf resolves through the operation topology; a
    // layout root with a single non-layout child falls back to that sole
    // leaf; a zero-child layout root is itself the sole usable leaf and its
    // own window list carries the occupant. Null on a damaged tree that
    // cannot resolve an insertion leaf.
    insertionLeafWindows(scope, topology, deepest) {
      const operationLeaf = operationLeafForTile(topology, deepest.tile);
      if (operationLeaf !== null) {
        return { tile: operationLeaf.decoded.tile, windows: operationLeaf.windows };
      }
      const leaves = topology.filter((entry) => !entry.leaf.isLayout);
      const sole = leaves[0];
      if (leaves.length === 1 && sole !== void 0) {
        return { tile: sole.decoded.tile, windows: sole.windows };
      }
      if (!deepest.tile.isLayout) {
        return null;
      }
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (root !== deepest.tile) {
        return null;
      }
      const decoded = decodeSequential(deepest.tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
      return decoded.ok ? { tile: deepest.tile, windows: decoded.value } : null;
    }
    // Owned-scope removal: after the established overlay reflow, a provably
    // freed leaf of an owned scope collapses with exactly one guarded remove
    // and a fresh whole-root decode. Detached windows (`window.tile === null`),
    // a leaf that still holds another eligible window, and the root itself are
    // all excluded, so no dispatch that removes ever also splits.
    //
    // Live KWin 6.7.3 delivers `windowRemoved` while the removed window is
    // still listed in its former leaf's `windows` array (unit-19c), so the
    // leaf is not yet provably freed at the notification. A removal whose
    // leaf still lists the window is deferred to one one-shot event-loop
    // yield; its settle callback re-resolves the scope root and fresh-decodes
    // before any structural call, so the collapse runs only once KWin has
    // evacuated the leaf.
    dwindleRemove(window, scope) {
      if (this.readSelectedOverlay(scope) !== null) {
        return;
      }
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      if (window.tile === null || !isTile(window.tile)) {
        return;
      }
      const root = this.environment.rootTile(scope.output, scope.desktop);
      if (!isTile(root) || window.tile === root) {
        return;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        this.markInert(scope, "remove-topology-failed");
        return;
      }
      const leaf = operationLeafForTile(topology, window.tile);
      if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
        return;
      }
      if (windowIndex(leaf.windows, window) >= 0) {
        this.deferRemovalCollapse(window, scope, leaf.decoded.tile);
        return;
      }
      if (leaf.windows.some((value) => value !== window && windowInScope(value, scope))) {
        return;
      }
      this.collapseFreedLeaf(scope, topology, leaf.decoded.tile);
    }
    // Arm exactly one one-shot event-loop yield that settles the deferred
    // removal on a later event-loop turn. The callback re-validates the scope
    // and leaf fresh, so it is inert when the scope stopped being owned, a
    // valid overlay appeared, or the leaf was already collapsed elsewhere. It
    // never re-arms itself, so a removal that never settles leaves the scope
    // intact instead of retrying forever.
    deferRemovalCollapse(window, scope, leafTile, afterDragSnapshot = false, reflowLeaves) {
      let armed = false;
      try {
        armed = this.environment.yieldOnce(() => {
          this.settleRemovalCollapse(window, scope, leafTile, afterDragSnapshot, reflowLeaves);
          this.settleOwedInvariants();
        });
      } catch (error) {
        void error;
      }
      if (!armed) {
        this.markInert(scope, "removal-yield-arm-failed");
        return;
      }
      this.diagnostic("ownership-remove-deferred");
    }
    // Deferred removal collapse body. Runs on a later event-loop turn, after
    // KWin has evacuated the removed window from its former leaf. Everything
    // is re-validated and re-resolved fresh: the captured leaf handle is used
    // only to identify the leaf by object identity inside a fresh whole-root
    // decode, never to touch stale children. A leaf that still lists the
    // window, a leaf that holds another eligible occupant, or a leaf that is
    // gone from the fresh tree are all left untouched.
    settleRemovalCollapse(window, scope, leafTile, afterDragSnapshot, reflowLeaves) {
      var _a;
      if (this.isInert(scope) || !this.isOwned(scope)) {
        return;
      }
      if (this.trackedDragLive()) {
        this.markOwedInvariant(scope);
        return;
      }
      if (this.readSelectedOverlay(scope) !== null) {
        return;
      }
      if (this.scopeHasFullscreen(scope)) {
        this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
        return;
      }
      const topology = this.topologyForScope(scope);
      if (topology === null) {
        this.markInert(scope, "settle-topology-failed");
        return;
      }
      const leaf = operationLeafForTile(topology, leafTile);
      if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
        if (afterDragSnapshot) {
          this.dragSnapshotAfter(topology);
        }
        return;
      }
      if (windowIndex(leaf.windows, window) >= 0) {
        if (afterDragSnapshot) {
          this.dragSnapshotAfter(topology);
        }
        return;
      }
      if (leaf.windows.some((value) => value !== window && windowInScope(value, scope))) {
        if (afterDragSnapshot) {
          this.dragSnapshotAfter(topology);
        }
        return;
      }
      const after = this.collapseFreedLeaf(scope, topology, leaf.decoded.tile);
      if (afterDragSnapshot && after !== null) {
        const finalTopology = this.normalizeReflowLeaves(scope, reflowLeaves, after);
        this.dragSnapshotAfter(finalTopology);
        const pending = (_a = this.pendingRebuilds.get(scope.output)) == null ? void 0 : _a.get(scope.desktop.id);
        if (pending !== void 0) {
          pending.dragFinalSnapshot = true;
        }
      }
    }
    // The OperationLeaf holding a window in a fresh topology, resolved from the
    // window's current `tile` association. The window is a stable identity
    // carried across a yield; only its live tile read is used, so no stale tile
    // wrapper is ever retained.
    leafForWindow(topology, window) {
      if (window.tile === null || !isTile(window.tile)) {
        return null;
      }
      return operationLeafForTile(topology, window.tile);
    }
    // Equalize the two reflow leaves created by a drop split to 50/50 relative
    // geometry, after the settled origin collapse. Both leaves are re-resolved
    // from the fresh post-collapse topology by their window occupants; when they
    // are current siblings under a common layout parent that they tile along the
    // parent's split axis, one guarded relativeGeometry write moves only the
    // shared edge to the midpoint (the documented source setter adjusts the
    // sibling's shared edge; source-derived, not live-proven here). A fresh
    // decode then proves the two leaves are equal within the documented
    // tolerance before `drag-reflow-normalized` is claimed. Every unsafe shape
    // emits a one-shot `drag-reflow-normalize-skipped:<reason>` and leaves the
    // topology untouched; a write or post-decode failure emits
    // `drag-reflow-normalize-failed:<reason>` and preserves the existing safe
    // behavior. No remove, split, timer, or other structural call runs here.
    normalizeReflowLeaves(scope, reflowLeaves, topology) {
      if (reflowLeaves === void 0) {
        return topology;
      }
      const draggedLeaf = this.leafForWindow(topology, reflowLeaves.dragged);
      const occupantLeaf = this.leafForWindow(topology, reflowLeaves.occupant);
      if (draggedLeaf === null || occupantLeaf === null || draggedLeaf.decoded.tile === occupantLeaf.decoded.tile || draggedLeaf.leaf.isLayout || occupantLeaf.leaf.isLayout) {
        this.diagnostic("drag-reflow-normalize-skipped:leaf-resolution");
        return topology;
      }
      const parent = draggedLeaf.decoded.tile.parent;
      if (parent === null || !isTile(parent) || !isCustomTile(parent) || !parent.isLayout) {
        this.diagnostic("drag-reflow-normalize-skipped:no-layout-parent");
        return topology;
      }
      if (occupantLeaf.decoded.tile.parent !== parent) {
        this.diagnostic("drag-reflow-normalize-skipped:not-siblings");
        return topology;
      }
      const axis = parent.layoutDirection === HORIZONTAL_LAYOUT_DIRECTION2 ? "x" : parent.layoutDirection === VERTICAL_LAYOUT_DIRECTION2 ? "y" : null;
      if (axis === null) {
        this.diagnostic("drag-reflow-normalize-skipped:floating-parent");
        return topology;
      }
      const draggedGeometry = draggedLeaf.decoded.tile.relativeGeometry;
      const occupantGeometry = occupantLeaf.decoded.tile.relativeGeometry;
      const plan = planEqualSplit(parent.relativeGeometry, draggedGeometry, occupantGeometry, axis);
      if (plan === null) {
        this.diagnostic("drag-reflow-normalize-skipped:geometry-incompatible");
        return topology;
      }
      const draggedNear = axis === "x" ? draggedGeometry.x : draggedGeometry.y;
      const occupantNear = axis === "x" ? occupantGeometry.x : occupantGeometry.y;
      const firstTile = draggedNear <= occupantNear ? draggedLeaf.decoded.tile : occupantLeaf.decoded.tile;
      const written = setTileRelativeGeometry(firstTile, plan.first);
      if (!written) {
        this.diagnostic("drag-reflow-normalize-failed:write");
        return topology;
      }
      const fresh = this.topologyForScope(scope);
      if (fresh === null) {
        this.diagnostic("drag-reflow-normalize-failed:post-decode");
        return topology;
      }
      const freshDragged = this.leafForWindow(fresh, reflowLeaves.dragged);
      const freshOccupant = this.leafForWindow(fresh, reflowLeaves.occupant);
      if (freshDragged === null || freshOccupant === null || !equalAlongAxis(freshDragged.decoded.tile.relativeGeometry, freshOccupant.decoded.tile.relativeGeometry, axis)) {
        this.diagnostic("drag-reflow-normalize-failed:mismatch");
        return fresh;
      }
      this.diagnostic("drag-reflow-normalized");
      return fresh;
    }
    // Exactly one guarded `CustomTile.remove()` of a provably-freed decoded
    // leaf, a fresh whole-root decode immediately afterwards, and a strict
    // one-fewer-leaf postcondition. The invariant check that follows may start
    // or re-arm a deferred reconstruction, but never a split in this dispatch.
    collapseFreedLeaf(scope, topology, leafTile) {
      let removed = false;
      try {
        removed = removeCustomTile(leafTile);
      } catch (error) {
        void error;
      }
      if (!removed) {
        this.markInert(scope, "leaf-remove-failed");
        return null;
      }
      const after = this.topologyForScope(scope);
      if (after === null) {
        this.markInert(scope, "leaf-collapse-verify-failed");
        return null;
      }
      if (after.length !== topology.length - 1) {
        this.diagnostic("ownership-remove-failed:leaf-count");
        this.dwindleEnsureInvariant(scope);
        return null;
      }
      this.diagnostic("ownership-remove-collapsed");
      this.dwindleEnsureInvariant(scope);
      return after;
    }
    dwindleMaybeRemove(window) {
      const scope = this.scopeForWindow(window);
      if (scope === null) {
        return;
      }
      if (this.isInert(scope)) {
        this.onceDiagnostic("ownership-inert-ignored:removal");
        return;
      }
      if (!this.isOwned(scope)) {
        return;
      }
      if (this.trackedDragLive()) {
        this.markOwedInvariant(scope);
        return;
      }
      this.dwindleRemove(window, scope);
    }
    // ---- Dynamic virtual desktops ----
    // Ordered live desktop list, or null when the workspace surface is absent
    // or the list cannot be decoded. Ordering is 1-based X11 number ascending
    // with positional-order fallback; identity is always the string id.
    liveDesktops() {
      let value;
      try {
        value = this.environment.desktops();
      } catch (error) {
        this.diagnostic(`workspace-desktops-unavailable:${describeWorkspaceFailure(error)}`);
        return null;
      }
      const decoded = decodeSequential(value, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
      if (!decoded.ok) {
        this.diagnostic("workspace-desktops-unavailable:decode");
        return null;
      }
      return orderedDesktops(decoded.value);
    }
    handleDesktopsChanged() {
      this.gate.run(() => {
        this.cleanupDesktops();
        this.drainPendingDesktopIntents();
      }, (reason) => this.disabled(reason));
    }
    // Meta+1..9: navigate to the existing desktop at the given 1-based index.
    // An absent index is a specific no-op and never creates a desktop.
    navigateWorkspace(index) {
      this.gate.run(() => {
        this.diagnostic(`workspace-navigate-invoked:${index}`);
        const desktops = this.liveDesktops();
        if (desktops === null) {
          return;
        }
        const target = desktops[index - 1];
        if (target === void 0) {
          this.diagnostic(`workspace-navigate-absent:${index}`);
          return;
        }
        this.setCurrentDesktop(target);
        this.diagnostic(`workspace-navigate-completed:${index}`);
      }, (reason) => this.disabled(reason));
    }
    // Meta+0: focus the existing script-owned trailing empty when present,
    // otherwise append a desktop and navigate to it. Repeated Meta+0 on the
    // trailing empty never creates a duplicate, and a focused trailing empty
    // that stays empty stays exactly one: nothing is appended until occupancy
    // moves the highest occupied workspace past it, at which point
    // reconciliation replenishes a replacement. When the trailing empty is
    // missing but the desktop list cannot be mutated yet (live drag, pending
    // reconstruction, unsettled move), the navigate request is deferred and
    // retried through the existing settle seams.
    appendWorkspace() {
      this.gate.run(() => {
        this.diagnostic("workspace-append-invoked");
        this.navigateToOrCreateTrailingEmpty();
      }, (reason) => this.disabled(reason));
    }
    // Focus the existing script-owned trailing empty, or create it and focus
    // it. The create is deferred while the desktop list is unsafe to mutate.
    navigateToOrCreateTrailingEmpty() {
      const existing = this.trailingOwnedEmptyDesktop();
      if (existing !== null) {
        this.setCurrentDesktop(existing);
        this.diagnostic("workspace-append-focused-existing");
        return;
      }
      if (this.workspaceMutationDeferred()) {
        this.deferDesktopIntent({ kind: "navigate" });
        return;
      }
      const created = this.appendDesktop();
      if (created === null) {
        return;
      }
      this.setCurrentDesktop(created);
      this.diagnostic("workspace-append-completed");
      this.cleanupDesktops();
      this.drainPendingDesktopIntents();
    }
    // The script-owned trailing empty that reconciliation would retain: the
    // trailing-most owned empty desktop after every occupied desktop, or null
    // when none exists. The trailing-most candidate is the one cleanup keeps,
    // so focusing or moving into it never blocks cleanup of the excess owned
    // empties before it. Pre-existing and user-owned empty desktops are never
    // candidates.
    trailingOwnedEmptyDesktop() {
      const desktops = this.liveDesktops();
      if (desktops === null) {
        return null;
      }
      const occupied = this.occupiedDesktopIds();
      let highestOccupied = 0;
      for (let position = 0; position < desktops.length; position += 1) {
        const desktop = desktops[position];
        if (desktop !== void 0 && occupied.has(desktop.id)) {
          highestOccupied = position + 1;
        }
      }
      let candidate = null;
      for (let position = 0; position < desktops.length; position += 1) {
        const desktop = desktops[position];
        if (desktop === void 0) {
          continue;
        }
        if (!this.ownedDesktopIds.has(desktop.id)) {
          continue;
        }
        if (occupied.has(desktop.id)) {
          continue;
        }
        if (position + 1 <= highestOccupied) {
          continue;
        }
        candidate = desktop;
      }
      return candidate;
    }
    // Whether the desktop list must not be mutated right now: a live drag, a
    // pending reconstruction, or an unsettled cross-workspace move. Desktop
    // creation and removal are deferred in exactly these conditions and
    // retried through the existing settle/yield seams.
    workspaceMutationDeferred() {
      return this.trackedDragLive() || this.pendingRebuilds.size > 0 || this.pendingMoves.size > 0;
    }
    // Queue a user trailing-empty creation request for later execution. The
    // queue is bounded and each entry is re-validated on execution.
    deferDesktopIntent(intent) {
      if (this.pendingDesktopIntents.length < MAX_SEQUENTIAL_LENGTH) {
        this.pendingDesktopIntents.push(intent);
      }
      this.diagnostic(intent.kind === "navigate" ? "workspace-create-deferred:navigate" : "workspace-create-deferred:move");
    }
    // Run every queued trailing-empty creation request, in order, once the
    // desktop list is safe to mutate. A request that is still unsafe is kept
    // queued; a request whose context became stale is cancelled.
    drainPendingDesktopIntents() {
      if (!this.gate.isEnabled) {
        return;
      }
      if (this.workspaceMutationDeferred()) {
        return;
      }
      const pending = this.pendingDesktopIntents.slice();
      this.pendingDesktopIntents.length = 0;
      for (const intent of pending) {
        if (intent.kind === "navigate") {
          this.navigateToOrCreateTrailingEmpty();
        } else {
          this.finishMoveToTrailing(intent.window);
        }
      }
    }
    // Execute a deferred Meta+Shift+0 request: re-validate the captured window
    // against current context, ensure the trailing empty exists, then move the
    // window into it. A window that is no longer movable cancels the request.
    finishMoveToTrailing(window) {
      if (!this.isWindowMovableToTrailing(window)) {
        this.diagnostic("workspace-move-deferred-cancelled:stale");
        return;
      }
      const scope = this.scopeForWindow(window);
      if (scope === null) {
        this.diagnostic("workspace-move-deferred-cancelled:scope");
        return;
      }
      let target = this.trailingOwnedEmptyDesktop();
      if (target === null) {
        if (this.workspaceMutationDeferred()) {
          this.deferDesktopIntent({ kind: "move", window });
          return;
        }
        target = this.appendDesktop();
      }
      if (target === null) {
        return;
      }
      if (target.id === scope.desktop.id) {
        this.diagnostic("workspace-move-no-op:already-there");
        return;
      }
      this.moveWindowToDesktop(window, scope, target);
    }
    // Re-validate a deferred move's captured window: still a movable normal
    // managed window in a readable scope, and not sticky or fullscreen. The
    // scope is re-resolved from the current context so a desktop change during
    // the deferral is respected rather than acted on stale.
    isWindowMovableToTrailing(window) {
      if (!isWindow(window) || window.fullScreen === true) {
        return false;
      }
      if (!window.normalWindow || !window.managed || !window.resizeable || window.appletPopup) {
        return false;
      }
      if (this.isSticky(window)) {
        return false;
      }
      const scope = this.scopeForWindow(window);
      return scope !== null && windowInScope(window, scope);
    }
    // Append one desktop through the createDesktop surface, re-enumerating the
    // live list to resolve the new desktop (no desktop lookup API exists). The
    // new desktop is recorded script-owned for this session only. The
    // reconciliation guard is held across the create so the synchronous
    // desktopsChanged re-entry cannot reconcile the not-yet-owned desktop.
    appendDesktop() {
      const before = this.liveDesktops();
      if (before === null) {
        return null;
      }
      const beforeIds = new Set(before.map((desktop) => desktop.id));
      const guarding = !this.reconcilingDesktops;
      if (guarding) {
        this.reconcilingDesktops = true;
      }
      try {
        try {
          this.environment.createDesktop(before.length + 1, String(before.length + 1));
        } catch (error) {
          this.diagnostic(`workspace-append-create-failed:${describeWorkspaceFailure(error)}`);
          return null;
        }
        const after = this.liveDesktops();
        if (after === null) {
          this.diagnostic("workspace-append-created-unverified");
          return null;
        }
        const fresh = after.filter((desktop) => !beforeIds.has(desktop.id));
        const candidate = fresh.length === 1 ? fresh[0] : fresh[fresh.length - 1];
        if (candidate === void 0) {
          this.diagnostic("workspace-append-created-unresolved");
          return null;
        }
        this.ownedDesktopIds.add(candidate.id);
        this.diagnostic("workspace-created-owned");
        return candidate;
      } finally {
        if (guarding) {
          this.reconcilingDesktops = false;
        }
      }
    }
    // Meta+Shift+1..9 and Meta+Shift+0: move the focused window to the target
    // desktop then follow it. Index 0 appends first. A sticky window is a
    // specific no-op; fullscreen is refused by the active-action guard.
    moveActiveToWorkspace(index) {
      this.gate.run(() => {
        this.diagnostic(`workspace-move-invoked:${index}`);
        const activeNow = this.environment.activeWindow();
        if (isWindow(activeNow) && activeNow.fullScreen === true) {
          this.diagnostic("workspace-move-refused:fullscreen");
          return;
        }
        if (isWindow(activeNow) && this.maximizedWindows.has(activeNow)) {
          this.diagnostic("workspace-move-refused:maximized");
          return;
        }
        const guard = this.activeActionGuard("workspace-move");
        if (guard === null) {
          return;
        }
        const { active, scope } = guard;
        if (this.isSticky(active)) {
          this.diagnostic("workspace-move-refused:sticky");
          return;
        }
        let target;
        if (index === 0) {
          target = this.trailingOwnedEmptyDesktop();
          if (target === null) {
            if (this.workspaceMutationDeferred()) {
              this.deferDesktopIntent({ kind: "move", window: active });
              return;
            }
            target = this.appendDesktop();
          }
        } else {
          const desktops = this.liveDesktops();
          if (desktops === null) {
            return;
          }
          const entry = desktops[index - 1];
          if (entry === void 0) {
            this.diagnostic(`workspace-move-absent:${index}`);
            return;
          }
          target = entry;
        }
        if (target === null) {
          return;
        }
        if (target.id === scope.desktop.id) {
          this.diagnostic("workspace-move-no-op:already-there");
          return;
        }
        this.moveWindowToDesktop(active, scope, target);
      }, (reason) => this.disabled(reason));
    }
    moveWindowToDesktop(window, sourceScope, target) {
      if (this.isFloating(window)) {
        this.moveFloatingWindow(window, target);
        return;
      }
      this.moveTiledWindow(window, sourceScope, target);
    }
    // Floating move: update desktop membership only, preserve floating state,
    // and never mutate the tile tree.
    moveFloatingWindow(window, target) {
      if (!writeWindowDesktops(window, [target])) {
        this.diagnostic("workspace-move-failed:desktops-write");
        return;
      }
      this.diagnostic("workspace-move-floated");
      this.setCurrentDesktop(target);
      this.cleanupDesktops();
      this.drainPendingDesktopIntents();
    }
    // Tiled move: write the new membership, collapse the freed source leaf
    // through the removals-only pipeline, then defer the destination adoption
    // to a later event-loop turn so no remove and split share one structural
    // operation. The window is never lost: a failed destination placement
    // leaves it floating on the target.
    moveTiledWindow(window, sourceScope, target) {
      const targetScope = {
        output: sourceScope.output,
        desktop: target,
        scope: { output: sourceScope.output, desktopId: target.id }
      };
      if (!writeWindowDesktops(window, [target])) {
        this.diagnostic("workspace-move-failed:desktops-write");
        return;
      }
      this.collapseMovedSourceLeaf(window, sourceScope);
      this.pendingMoves.add(window);
      let armed = false;
      try {
        armed = this.environment.yieldOnce(() => {
          this.pendingMoves.delete(window);
          this.adoptMovedWindow(window, targetScope);
        });
      } catch (error) {
        void error;
      }
      if (!armed) {
        this.pendingMoves.delete(window);
        this.adoptMovedWindow(window, targetScope);
        return;
      }
      this.diagnostic("workspace-move-pending");
      this.setCurrentDesktop(target);
    }
    // Collapse the source leaf a tiled window just vacated: one unmanage then
    // one removals-only leaf collapse. No split is ever performed here.
    collapseMovedSourceLeaf(window, sourceScope) {
      if (window.tile === null || !isCustomTile(window.tile) || window.tile.isLayout) {
        return;
      }
      const topology = this.topologyForScope(sourceScope);
      if (topology === null) {
        return;
      }
      const leaf = operationLeafForTile(topology, window.tile);
      if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
        return;
      }
      let unmanaged = false;
      try {
        unmanaged = unmanageTile(leaf.decoded.tile, window);
      } catch (error) {
        void error;
      }
      if (!unmanaged) {
        return;
      }
      this.collapseFreedLeaf(sourceScope, topology, leaf.decoded.tile);
    }
    // Destination adoption for a moved tiled window, on a later event-loop
    // turn: ordinary placement/adoption into the target scope. A window that is
    // still untiled afterwards is retained safely as floating on the target.
    adoptMovedWindow(window, targetScope) {
      var _a;
      if (!this.gate.isEnabled) {
        return;
      }
      try {
        if (window.tile !== null) {
          this.diagnostic("workspace-move-adopted-existing");
          return;
        }
        this.placeEligibleAdded(window, targetScope);
        if (window.tile !== null) {
          this.diagnostic("workspace-move-adopted");
        } else if (((_a = this.pendingRebuilds.get(targetScope.output)) == null ? void 0 : _a.get(targetScope.desktop.id)) !== void 0) {
          this.diagnostic("workspace-move-adopted-deferred:reconstruction");
        } else {
          this.floatingWindows.add(window);
          this.floatScopes.set(window, targetScope.scope);
          this.diagnostic("workspace-move-adopt-failed:retained-floating");
        }
      } catch (error) {
        this.floatingWindows.add(window);
        this.floatScopes.set(window, targetScope.scope);
        this.diagnostic(`workspace-move-adopt-failed:${describeWorkspaceFailure(error)}`);
      }
      this.cleanupDesktops();
      this.drainPendingDesktopIntents();
    }
    setCurrentDesktop(target) {
      try {
        this.environment.setCurrentDesktop(target);
        this.diagnostic("workspace-navigate-set");
      } catch (error) {
        this.diagnostic(`workspace-navigate-failed:${describeWorkspaceFailure(error)}`);
      }
    }
    // Reconcile the desktop list to exactly one trailing script-owned empty
    // desktop after the highest occupied workspace. Excess owned empty trailing
    // desktops are removed (only owned, non-current, non-visible-on-another-
    // output, non-last); a missing trailing empty is replenished by appending
    // one replacement, which happens only once an owned desktop exists in the
    // live list (the dynamic-desktop feature is engaged). Pre-existing and
    // user-owned desktops are never removed. Deferral keeps the list untouched
    // while a drag, reconstruction, or unsettled move is live, and the
    // reconciliation guard keeps create/remove re-entry inert.
    cleanupDesktops() {
      if (!this.gate.isEnabled || this.reconcilingDesktops) {
        return;
      }
      if (this.trackedDragLive()) {
        this.diagnostic("workspace-cleanup-deferred:drag-live");
        return;
      }
      if (this.pendingRebuilds.size > 0) {
        this.diagnostic("workspace-cleanup-deferred:reconstruction-pending");
        return;
      }
      if (this.pendingMoves.size > 0) {
        this.diagnostic("workspace-cleanup-deferred:move-unsettled");
        return;
      }
      const visible = this.visibleDesktopIds();
      if (visible === null) {
        this.diagnostic("workspace-cleanup-deferred:output-visibility-unknown");
        return;
      }
      const desktops = this.liveDesktops();
      if (desktops === null || desktops.length <= 1) {
        return;
      }
      const occupied = this.occupiedDesktopIds();
      let highestOccupied = 0;
      for (let position = 0; position < desktops.length; position += 1) {
        const desktop = desktops[position];
        if (desktop !== void 0 && occupied.has(desktop.id)) {
          highestOccupied = position + 1;
        }
      }
      const lastIndex = desktops.length - 1;
      const trailing = [];
      for (let position = 0; position < desktops.length; position += 1) {
        const desktop = desktops[position];
        if (desktop === void 0) {
          continue;
        }
        if (!this.ownedDesktopIds.has(desktop.id)) {
          continue;
        }
        if (occupied.has(desktop.id)) {
          continue;
        }
        if (position + 1 <= highestOccupied) {
          continue;
        }
        trailing.push({ desktop, position });
      }
      if (trailing.length === 0) {
        const ownedLive = desktops.some(
          (desktop) => desktop !== void 0 && this.ownedDesktopIds.has(desktop.id)
        );
        if (!ownedLive) {
          return;
        }
        const created = this.appendDesktop();
        if (created !== null) {
          this.diagnostic("workspace-cleanup-replenished");
        }
        return;
      }
      const keep = trailing[trailing.length - 1];
      if (keep === void 0) {
        return;
      }
      this.reconcilingDesktops = true;
      try {
        for (const entry of trailing) {
          if (entry.position === keep.position) {
            continue;
          }
          if (entry.position === lastIndex) {
            continue;
          }
          if (visible.has(entry.desktop.id)) {
            continue;
          }
          try {
            this.environment.removeDesktop(entry.desktop);
            this.ownedDesktopIds.delete(entry.desktop.id);
            this.diagnostic("workspace-cleanup-removed");
          } catch (error) {
            this.diagnostic(`workspace-cleanup-remove-failed:${describeWorkspaceFailure(error)}`);
          }
        }
      } finally {
        this.reconcilingDesktops = false;
      }
    }
    // Desktop ids currently visible on any output (per-output current desktop)
    // plus the global current desktop. Returns null when outputs cannot be
    // enumerated or a per-output read fails, so cleanup can defer safely.
    visibleDesktopIds() {
      let raw;
      try {
        raw = this.environment.screens();
      } catch (error) {
        return null;
      }
      const screens = decodeSequential(raw, isOutput, MAX_SEQUENTIAL_LENGTH);
      if (!screens.ok || screens.value.length === 0) {
        return null;
      }
      const visible = /* @__PURE__ */ new Set();
      for (const output of screens.value) {
        let current;
        try {
          current = this.environment.currentDesktopForOutput(output);
        } catch (error) {
          return null;
        }
        if (isVirtualDesktop(current)) {
          visible.add(current.id);
        }
      }
      try {
        const global = this.environment.currentDesktop();
        if (isVirtualDesktop(global)) {
          visible.add(global.id);
        }
      } catch (error) {
        return null;
      }
      return visible;
    }
    // Desktop ids that hold at least one non-sticky window. A window without a
    // readable `onAllDesktops` is treated as not-sticky.
    occupiedDesktopIds() {
      const occupied = /* @__PURE__ */ new Set();
      const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
      if (!windows.ok) {
        const desktops = this.liveDesktops();
        if (desktops !== null) {
          for (const desktop of desktops) {
            occupied.add(desktop.id);
          }
        }
        return occupied;
      }
      for (const window of windows.value) {
        if (window.onAllDesktops === true) {
          continue;
        }
        const members = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
        if (!members.ok) {
          continue;
        }
        for (const desktop of members.value) {
          occupied.add(desktop.id);
        }
      }
      return occupied;
    }
  };

  // src/entry.ts
  function isKWinWindowSurface(value) {
    return typeof value === "object" && value !== null && "activeChanged" in value && "desktopsChanged" in value && "outputChanged" in value && "tileChanged" in value && "interactiveMoveResizeStarted" in value && "interactiveMoveResizeStepped" in value && "interactiveMoveResizeFinished" in value;
  }
  var controller = new TileController({
    activeWindow: () => workspace.activeWindow,
    setActiveWindow: (window) => {
      if (isKWinWindowSurface(window)) {
        workspace.activeWindow = window;
      }
    },
    currentDesktopForOutput: (output) => workspace.currentDesktopForScreen(output),
    rootTile: (output, desktop) => workspace.rootTile(output, desktop),
    windowList: () => workspace.windowList(),
    cursorPos: () => workspace.cursorPos,
    clientArea: (option, output, desktop) => workspace.clientArea(option, output, desktop),
    desktops: () => {
      const value = workspace.desktops;
      if (value === void 0) {
        throw new Error("kwin-workspace-surface-missing:desktops");
      }
      return value;
    },
    screens: () => {
      const value = workspace.screens;
      if (value === void 0) {
        throw new Error("kwin-workspace-surface-missing:screens");
      }
      return value;
    },
    currentDesktop: () => {
      const value = workspace.currentDesktop;
      return value != null ? value : null;
    },
    createDesktop: (position, name) => {
      if (typeof workspace.createDesktop !== "function") {
        throw new Error("kwin-workspace-surface-missing:createDesktop");
      }
      return workspace.createDesktop(position, name);
    },
    removeDesktop: (desktop) => {
      if (typeof workspace.removeDesktop !== "function") {
        throw new Error("kwin-workspace-surface-missing:removeDesktop");
      }
      workspace.removeDesktop(desktop);
    },
    setCurrentDesktop: (desktop) => {
      try {
        workspace.currentDesktop = desktop;
      } catch (error) {
        throw new Error(`kwin-workspace-surface-missing:setCurrentDesktop:${String(error)}`);
      }
    },
    onDesktopsChanged: (handler) => {
      const signal = workspace.desktopsChanged;
      if (signal === void 0) {
        console.log("plasma-auto-tiler:workspace-surface-missing:desktopsChanged");
        return;
      }
      signal.connect(handler);
    },
    onWindowAdded: (handler) => workspace.windowAdded.connect(handler),
    onWindowRemoved: (handler) => workspace.windowRemoved.connect(handler),
    onScreensChanged: (handler) => workspace.screensChanged.connect(handler),
    onCurrentDesktopChanged: (handler) => workspace.currentDesktopChanged.connect(handler),
    watchInteractiveWindow: (window, started, finished, stepped, moveResizedChanged, invalidated) => {
      const surface = window;
      const connected = [];
      const attach = (name, handler) => {
        let value;
        try {
          value = surface[name];
          value.connect(handler);
          connected.push([name, handler]);
          console.log(`plasma-auto-tiler:drag-attach-ok:${name}`);
          return true;
        } catch (error) {
          console.log(
            `plasma-auto-tiler:drag-attach-failed:${name}:${String(error)} (observed typeof ${typeof value})`
          );
          return false;
        }
      };
      const attempts = [
        ["interactiveMoveResizeStarted", started],
        ["interactiveMoveResizeStepped", stepped],
        ["interactiveMoveResizeFinished", finished],
        ["moveResizedChanged", moveResizedChanged],
        ["outputChanged", invalidated],
        ["desktopsChanged", invalidated]
      ];
      let ok = 0;
      let failed2 = 0;
      for (const [name, handler] of attempts) {
        if (attach(name, handler)) {
          ok += 1;
        } else {
          failed2 += 1;
        }
      }
      return {
        disconnect: () => {
          for (const [name, handler] of connected) {
            try {
              surface[name].disconnect(handler);
            } catch (error) {
              void error;
            }
          }
        },
        ok,
        failed: failed2
      };
    },
    watchFullscreen: (window, changed) => {
      const surface = window;
      let value;
      try {
        value = surface["fullScreenChanged"];
        value.connect(changed);
        console.log("plasma-auto-tiler:fullscreen-attach-ok:fullScreenChanged");
        return {
          disconnect: () => {
            try {
              surface["fullScreenChanged"].disconnect(
                changed
              );
            } catch (error) {
              void error;
            }
          },
          ok: 1,
          failed: 0
        };
      } catch (error) {
        console.log(
          `plasma-auto-tiler:fullscreen-attach-failed:fullScreenChanged:${String(error)} (observed typeof ${typeof value})`
        );
        return { disconnect: () => {
        }, ok: 0, failed: 1 };
      }
    },
    watchMaximize: (window, changed) => {
      const surface = window;
      let value;
      try {
        value = surface["maximizedChanged"];
        value.connect(changed);
        console.log("plasma-auto-tiler:maximize-attach-ok:maximizedChanged");
        return {
          disconnect: () => {
            try {
              surface["maximizedChanged"].disconnect(
                changed
              );
            } catch (error) {
              void error;
            }
          },
          ok: 1,
          failed: 0
        };
      } catch (error) {
        console.log(
          `plasma-auto-tiler:maximize-attach-failed:maximizedChanged:${String(error)} (observed typeof ${typeof value})`
        );
        return { disconnect: () => {
        }, ok: 0, failed: 1 };
      }
    },
    onPendingTargetChanged: (window, handler) => {
      const surface = window;
      const connected = [];
      const attach = (name) => {
        let value;
        try {
          value = surface[name];
          value.connect(handler);
          connected.push([name, handler]);
          console.log(`plasma-auto-tiler:pending-attach-ok:${name}`);
          return true;
        } catch (error) {
          console.log(
            `plasma-auto-tiler:pending-attach-failed:${name}:${String(error)} (observed typeof ${typeof value})`
          );
          return false;
        }
      };
      attach("outputChanged");
      attach("desktopsChanged");
      attach("tileChanged");
      return () => {
        for (const [name, connectedHandler] of connected) {
          try {
            surface[name].disconnect(connectedHandler);
          } catch (error) {
            void error;
          }
        }
      };
    },
    // Named one-shot event-loop yield for dwindle reconstruction deferral,
    // implemented with the proven callDBus async callback seam. ListNames on
    // the session bus dispatches its callback exactly once on a real later
    // event-loop turn, after pending DeferredDelete processing, and never
    // synchronously. It holds no timer and relies on no signal. Returns false
    // only when arming the D-Bus call throws, which must fail the owning scope
    // closed rather than strand it.
    yieldOnce: (callback) => {
      try {
        callDBus(
          "org.freedesktop.DBus",
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus",
          "ListNames",
          callback
        );
        return true;
      } catch (error) {
        void error;
        return false;
      }
    },
    scheduleOnce: (delayMs, callback) => {
      const timer = new QTimer();
      timer.interval = delayMs;
      timer.singleShot = true;
      timer.timeout.connect(callback);
      timer.start();
      return () => {
        timer.stop();
      };
    },
    registerShortcut,
    log: (message) => console.log(message)
  });
  controller.start();
})();
