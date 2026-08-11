import { test } from "node:test";
import assert from "node:assert/strict";

// unit-01 toolchain smoke: proves the esbuild-bundled node:test route resolves
// after the toolchain restart. Pure-logic vectors arrive in unit-02.
test("toolchain smoke: node:test and assert resolve through the bundle", () => {
    assert.equal(1 + 1, 2);
});
