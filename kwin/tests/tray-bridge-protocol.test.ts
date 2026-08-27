import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Snapshot = {
  generation: string;
  revision: number;
  enabled: boolean;
};

type Route = {
  service: string;
  object: string;
  interface: string;
  method: string;
};

type ExpectedState = {
  owner: boolean;
  snapshot: Snapshot | null;
  refreshedAt: number | null;
  current: boolean;
};

type Event = {
  op: "publish" | "owner-acquired" | "owner-lost" | "restart" | "advance" | "transport-failure";
  args?: unknown[];
  ms?: number;
  expected: ExpectedState;
};

type Fixture = {
  contract: {
    service: string;
    object: string;
    interface: string;
    method: string;
    signature: string;
    schema: number;
    generationPattern: string;
    freshnessMs: number;
  };
  routes: { accepted: Route; rejected: Route[] };
  scenarios: { name: string; events: Event[] }[];
};

type State = {
  owner: boolean;
  snapshot: Snapshot | null;
  refreshedAt: number | null;
};

const fixturePath = process.env.TRAY_BRIDGE_FIXTURE;
assert.ok(fixturePath, "TRAY_BRIDGE_FIXTURE must point to the tray bridge fixture");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

function routeMatches(actual: Route, expected: Route): boolean {
  return actual.service === expected.service &&
    actual.object === expected.object &&
    actual.interface === expected.interface &&
    actual.method === expected.method;
}

function decodeCall(route: Route, args: unknown[], contract: Fixture["contract"]): Snapshot | null {
  if (!routeMatches(route, {
    service: contract.service,
    object: contract.object,
    interface: contract.interface,
    method: contract.method,
  }) || args.length !== 4) {
    return null;
  }

  const [schema, generation, revision, enabled] = args;
  if (schema !== contract.schema ||
      typeof generation !== "string" ||
      !new RegExp(contract.generationPattern).test(generation) ||
      typeof revision !== "number" ||
      !Number.isInteger(revision) ||
      revision < -2147483648 ||
      revision > 2147483647 ||
      typeof enabled !== "boolean") {
    return null;
  }

  return { generation, revision, enabled };
}

function emptyState(): State {
  return { owner: false, snapshot: null, refreshedAt: null };
}

function isCurrent(state: State, now: number, freshnessMs: number): boolean {
  return state.owner && state.snapshot !== null && state.refreshedAt !== null &&
    now - state.refreshedAt < freshnessMs;
}

function applyPublish(state: State, route: Route, args: unknown[], now: number, contract: Fixture["contract"]): void {
  const snapshot = decodeCall(route, args, contract);
  if (!state.owner || snapshot === null) {
    return;
  }

  if (state.snapshot === null || snapshot.generation !== state.snapshot.generation || snapshot.revision > state.snapshot.revision ||
      (snapshot.revision === state.snapshot.revision && snapshot.enabled === state.snapshot.enabled)) {
    state.snapshot = snapshot;
    state.refreshedAt = now;
    return;
  }

  state.snapshot = null;
  state.refreshedAt = null;
}

function assertState(state: State, now: number, expected: ExpectedState, freshnessMs: number): void {
  assert.equal(state.owner, expected.owner);
  assert.deepEqual(state.snapshot, expected.snapshot);
  assert.equal(state.refreshedAt, expected.refreshedAt);
  assert.equal(isCurrent(state, now, freshnessMs), expected.current);
}

test("tray bridge fixture defines one method and rejects other routes", () => {
  assert.deepEqual(fixture.contract, {
    service: "org.plasmaautotiler.Tray",
    object: "/org/plasmaautotiler/Tray",
    interface: "org.plasmaautotiler.Tray1",
    method: "PublishSnapshot",
    signature: "isib",
    schema: 1,
     generationPattern: "^[a-z0-9-]{1,32}$(?![\\s\\S])",
    freshnessMs: 30000,
  });
  assert.equal(fixture.routes.rejected.length, 4);

  for (const route of fixture.routes.rejected) {
    assert.equal(decodeCall(route, [1, "alpha", 1, true], fixture.contract), null);
  }
  assert.deepEqual(decodeCall(fixture.routes.accepted, [1, "alpha", 1, true], fixture.contract), {
    generation: "alpha",
    revision: 1,
    enabled: true,
  });
});

test("tray bridge fixture proves the local codec and state machine", () => {
  for (const scenario of fixture.scenarios) {
    let state = emptyState();
    let now = 0;

    for (const event of scenario.events) {
      switch (event.op) {
        case "publish":
          applyPublish(state, fixture.routes.accepted, event.args ?? [], now, fixture.contract);
          break;
        case "owner-acquired":
          state.owner = true;
          break;
        case "owner-lost":
          state.owner = false;
          state.snapshot = null;
          state.refreshedAt = null;
          break;
        case "restart":
          state = emptyState();
          break;
        case "advance":
          now += event.ms ?? 0;
          break;
        case "transport-failure":
          break;
      }
      assertState(state, now, event.expected, fixture.contract.freshnessMs);
    }
  }
});
