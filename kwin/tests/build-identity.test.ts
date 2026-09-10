import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
    LOCAL_DEV_FALLBACK,
    PACKAGE_VERSION,
    isBuildIdentity,
    sourceRev,
    startupLine,
} from "../src/build-identity";
import { isPackageVersion, sanitizeVersion } from "../src/route-diag";

describe("build identity", () => {
    it("is bounded with explicit fallback", () => {
        assert.equal(isBuildIdentity("local-dev"), true);
        assert.equal(isBuildIdentity("0123456789abcdef0123456789abcdef01234567"), true);
        for (const invalid of [
            "",
            "LOCAL-DEV",
            "gen-1",
            "0.1.0",
            "0123456789abcdef0123456789abcdef0123456",
            "0123456789ABCDEF0123456789abcdef01234567",
            "0123456789abcdef0123456789abcdef0123456g",
            "has space",
            42,
            undefined,
        ]) {
            assert.equal(isBuildIdentity(invalid), false);
        }
        assert.equal(LOCAL_DEV_FALLBACK, "local-dev");
        assert.equal(isBuildIdentity(sourceRev()), true);
        assert.equal(PACKAGE_VERSION, "0.1.0");
        assert.equal(
            (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version,
            PACKAGE_VERSION,
        );
        assert.equal(isPackageVersion("0.1.0"), true);
        assert.equal(isPackageVersion("has space"), false);
        assert.equal(sanitizeVersion("0.1.0"), "0.1.0");
        assert.equal(sanitizeVersion("has space"), "invalid");
    });

    it("emits one bridge startup record", () => {
        const line = startupLine();
        assert.equal(
            line,
            `plasma-auto-tiler:route-diag:lifecycle:comp=bridge:event=started:gen=${sourceRev()}:version=${PACKAGE_VERSION}:result=ok`,
        );
        assert.ok(!line.includes(":rev="));
        assert.ok(!line.includes("/"));
        assert.equal(line, startupLine());
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.equal(entry.match(/buildIdentityStartupLine\(\)/g)?.length, 1);
        assert.ok(entry.indexOf("buildIdentityStartupLine()") > entry.indexOf("controller.start()"));
        assert.ok(entry.indexOf("buildIdentityStartupLine()") < entry.indexOf("trayPublisher.start()"));
    });

    it("shares injection and markers across packages", () => {
        const manifest = readFileSync("package.json", "utf8");
        assert.ok(manifest.includes('"build:installed"'));
        assert.ok(manifest.includes("--define:PLASMA_AUTO_TILER_SOURCE_REV="));
        const buildScript = (JSON.parse(manifest) as { scripts: Record<string, string> }).scripts["build"];
        assert.ok(buildScript !== undefined);
        assert.ok(!buildScript.includes("PLASMA_AUTO_TILER_SOURCE_REV"));
        const flake = readFileSync("../flake.nix", "utf8");
        assert.ok(flake.includes('self.rev or "local-dev"'));
        assert.ok(!flake.includes("dirtyRev"));
        assert.ok(flake.includes("env.PLASMA_AUTO_TILER_SOURCE_REV = sourceRev"));
        assert.ok(flake.includes('npmBuildScript = "build:installed"'));
        assert.ok(flake.includes('"source=${sourceRev}"'));
        assert.ok(flake.includes('grep -Fx "source=${sourceRev}"'));
        assert.ok(flake.includes('formatLifecycleDiag("bridge", "started"'));
    });
});
