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
  const license = readFileSync(resolve("LICENSE"), "utf8");
  const assetLicense = readFileSync(resolve("ASSET-LICENSE.md"), "utf8");
  const englishAssetHeading = "# OMEW Asset Use Terms (English reference translation)";
  const assetDivider = `\n---\n\n${englishAssetHeading}`;
  const assetDividerAt = assetLicense.indexOf(assetDivider);
  const nestedAssetTerms = (markdown) => markdown.replace(/^(#{1,6})(?= )/gm, (heading) => "#".repeat(Math.min(6, heading.length + 2)));
  assert.notEqual(assetDividerAt, -1, "asset terms must keep the bilingual source divider");
  const sourceAssetTerms = {
    "zh-CN": assetLicense.slice(0, assetDividerAt).trim(),
    en: assetLicense.slice(assetDividerAt + assetDivider.length - englishAssetHeading.length).trim(),
  };

  assert.deepEqual(readdirSync(output).sort(), ["overture.json", "overture.tar.gz", "overture.tar.gz.sha256"]);
  assert.equal(manifest.version, "9.8.7");
  assert.equal(manifest.tag, "v9.8.7");
  assert.equal(manifest.license.id, "AGPL-3.0-only");
  assert.equal(manifest.license.text, license);
  assert.equal(manifest.terms.required, true);
  assert.deepEqual(Object.keys(manifest.terms.texts).sort(), ["en", "zh-CN"]);
  assert.ok(manifest.terms.texts["zh-CN"].includes(nestedAssetTerms(sourceAssetTerms["zh-CN"])), "Chinese asset restrictions must be derived from ASSET-LICENSE.md without substantive duplication");
  assert.ok(manifest.terms.texts.en.includes(nestedAssetTerms(sourceAssetTerms.en)), "English asset restrictions must be derived from ASSET-LICENSE.md without substantive duplication");
  assert.match(manifest.terms.texts["zh-CN"], /中文文本为控制文本；英文文本仅为参考翻译/);
  assert.match(manifest.terms.texts.en, /The Chinese text is controlling\. This English text is provided only as a reference translation\./);
  assert.match(manifest.terms.texts["zh-CN"], /AGPL-3\.0-only/);
  assert.match(manifest.terms.texts["zh-CN"], /AGPL 第 13 条[\s\S]*相应源代码/);
  assert.match(manifest.terms.texts["zh-CN"], /保留适用的版权声明、许可证声明、免责声明及 NOTICE/);
  assert.match(manifest.terms.texts["zh-CN"], /仅接受纯自愿捐助不会单独使部署构成商业使用/);
  assert.match(manifest.terms.texts["zh-CN"], /非侵入式广告[\s\S]*不得超过部署的实际、合理的必要服务成本/);
  assert.match(manifest.terms.texts["zh-CN"], /从源文件、构建产物、公开页面、应用图标、元数据及宣传材料中移除或替换全部受限资产/);
  assert.match(manifest.terms.texts["zh-CN"], /以 `stamp-` 开头的第三方贴纸[\s\S]*自行取得许可，或在使用及分发 OMEW 前将其删除/);
  assert.match(manifest.terms.texts["zh-CN"], /均按“现状”及“可用”状态提供[\s\S]*不附带任何明示、默示或法定担保/);
  assert.match(manifest.terms.texts["zh-CN"], /Worker、D1 数据库、R2 存储桶、Durable Object 命名空间、自定义域名或路由/);
  assert.match(manifest.terms.texts["zh-CN"], /Worker 设置权限属于账户级权限[\s\S]*可能修改同一账户中的其他 Worker/);
  assert.match(manifest.terms.texts.en, /AGPL Section 13[\s\S]*Corresponding Source/);
  assert.match(manifest.terms.texts.en, /account-scoped and can technically modify other Workers in the same account/);
  assert.deepEqual(manifest.authModes, ["auto"]);
  assert.deepEqual(manifest.worker.vars, [
    { name: "INSTANCE_DOMAIN", value: "${input:domain}" },
    { name: "R2_BUCKET_NAME", value: "${resource:media}" },
    { name: "CF_WORKER_NAME", value: "${worker}" },
  ]);
  assert.deepEqual(manifest.hostSecrets, [
    { name: "CF_ACCOUNT_ID", source: "accountId", requirement: "required", reason: manifest.hostSecrets[0].reason },
    { name: "CF_API_TOKEN", source: "cfApiToken", requirement: "required", placeholder: manifest.hostSecrets[1].placeholder, permissions: [{ key: "workers_scripts", type: "edit" }], reason: manifest.hostSecrets[1].reason },
  ]);
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
