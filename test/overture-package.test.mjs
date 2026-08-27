import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const output = mkdtempSync(join(tmpdir(), "omew-overture-test-"));

try {
  execFileSync(process.execPath, [resolve("scripts/build-overture-package.mjs")], {
    cwd: resolve("."),
    env: {
      ...process.env,
      OMEW_OVERTURE_OUTPUT: output,
      OMEW_TAG: "v9.8.7",
      OMEW_BUILD_TIME: "2026-08-27T12:00:00Z",
    },
    stdio: "pipe",
  });
  const manifest = JSON.parse(readFileSync(join(output, "overture.json"), "utf8"));
  const archive = readFileSync(join(output, "overture.tar.gz"));
  const digest = createHash("sha256").update(archive).digest("hex");
  const archiveEntries = execFileSync("tar", ["tzf", join(output, "overture.tar.gz")], { encoding: "utf8" });

  assert.deepEqual(readdirSync(output).sort(), ["overture.json", "overture.tar.gz", "overture.tar.gz.sha256"]);
  assert.equal(manifest.version, "9.8.7");
  assert.equal(manifest.tag, "v9.8.7");
  assert.equal(manifest.package.sha256, digest);
  assert.equal(readFileSync(join(output, "overture.tar.gz.sha256"), "utf8").trim(), `${digest}  overture.tar.gz`);
  assert.deepEqual(manifest.worker.durableObjects, [
    { binding: "ROOM_DO", className: "RoomDO", storage: "sqlite" },
    { binding: "STRONGHOLD_DO", className: "StrongholdDO", storage: "sqlite" },
  ]);
  assert.equal(manifest.worker.assetsRouting.notFoundHandling, "single-page-application");
  assert.deepEqual(manifest.permissions.find((entry) => entry.key === "domains")?.oauthScopes, ["workers-routes.write", "zone.read"]);
  assert.match(archiveEntries, /^\.\/recipe\.js$/m);
  assert.match(archiveEntries, /^\.\/worker\/index\.js$/m);
  assert.match(archiveEntries, /^\.\/migrations\/index\.json$/m);
  assert.match(archiveEntries, /^\.\/assets\/index\.html$/m);
  console.log("PASS Overture release package is self-consistent");
} finally {
  rmSync(output, { recursive: true, force: true });
}
