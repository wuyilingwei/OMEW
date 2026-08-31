import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.OMEW_OVERTURE_OUTPUT || join(root, "dist-overture"));
const stage = await mkdtemp(join(tmpdir(), "openmew-overture-"));
const packageRoot = join(stage, "package");
const workerRoot = join(packageRoot, "worker");
const wranglerOut = join(stage, "wrangler-out");
const assetsRoot = join(packageRoot, "assets");
const migrationsRoot = join(packageRoot, "migrations");

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else result.push(path);
  }
  return result;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(workerRoot, { recursive: true });
await mkdir(assetsRoot, { recursive: true });
await mkdir(migrationsRoot, { recursive: true });

run("npm", ["run", "build"]);
run("npx", ["wrangler", "deploy", "--dry-run", "--outdir", wranglerOut, "--config", join(root, "server", "wrangler.jsonc")]);
await cp(join(wranglerOut, "api.js"), join(workerRoot, "index.js"));
await cp(join(root, "web", "dist"), assetsRoot, { recursive: true });

const assetManifest = {};
for (const path of await filesUnder(assetsRoot)) {
  const bytes = await readFile(path);
  const servedPath = `/${relative(assetsRoot, path).replaceAll("\\", "/")}`;
  assetManifest[servedPath] = { hash: createHash("md5").update(bytes).digest("hex"), size: bytes.length };
}
await writeFile(join(packageRoot, "assets-manifest.json"), `${JSON.stringify(assetManifest, null, 2)}\n`);

const migrations = (await filesUnder(join(root, "server", "migrations"))).sort();
await writeFile(join(migrationsRoot, "index.json"), `${JSON.stringify(migrations.map((path) => relative(join(root, "server", "migrations"), path)))}\n`);
for (const path of migrations) await cp(path, join(migrationsRoot, relative(join(root, "server", "migrations"), path)));
await cp(join(root, "overture", "recipe.js"), join(packageRoot, "recipe.js"));

const archive = join(output, "overture.tar.gz");
await mkdir(output, { recursive: true });
run("tar", ["czf", archive, "-C", packageRoot, "."]);
const archiveBytes = await readFile(archive);
const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
const version = process.env.OMEW_VERSION || (process.env.OMEW_TAG || "v1.0.0").replace(/^v/, "");
const tag = process.env.OMEW_TAG || `v${version}`;
const buildTime = process.env.OMEW_BUILD_TIME || new Date().toISOString();
const manifest = {
  schema: 2,
  id: "openmew",
  name: "OMEW",
  summary: { en: "A community and chat server on Cloudflare Workers", "zh-CN": "运行在 Cloudflare Workers 上的社区与聊天服务器" },
  homepage: "https://github.com/wuyilingwei/OMEW",
  issues: { url: "https://github.com/wuyilingwei/OMEW/issues/new" },
  version,
  tag,
  buildTime,
  package: { artifact: "overture.tar.gz", sha256, bytes: archiveBytes.length },
  license: { id: "AGPL-3.0-or-later", text: await readFile(join(root, "LICENSE"), "utf8") },
  terms: { required: true, texts: { en: "Deploying OMEW creates and manages a Worker, D1 database, R2 bucket, and Durable Object namespaces in your Cloudflare account.", "zh-CN": "部署 OMEW 会在你的 Cloudflare 账户中创建并管理 Worker、D1 数据库、R2 存储桶和 Durable Object 命名空间。" } },
  authModes: ["auto"],
  permissions: [
    { key: "scripts", requirement: "required", oauthScopes: ["workers-scripts.write"], label: { en: "Workers Scripts", "zh-CN": "Workers Scripts" }, scenario: { en: "Upload and activate OMEW", "zh-CN": "上传并启用 OMEW" }, scope: "account", level: "write" },
    { key: "d1", requirement: "required", oauthScopes: ["d1.write"], label: { en: "D1", "zh-CN": "D1 数据库" }, scenario: { en: "Create and initialize the database", "zh-CN": "创建并初始化数据库" }, scope: "account", level: "write" },
    { key: "r2", requirement: "required", oauthScopes: ["workers-r2.write"], label: { en: "R2", "zh-CN": "R2 存储" }, scenario: { en: "Create media storage", "zh-CN": "创建媒体存储" }, scope: "account", level: "write" },
    { key: "domains", requirement: "required", oauthScopes: ["workers-routes.write", "zone.read"], label: { en: "Custom domains", "zh-CN": "自定义域名" }, scenario: { en: "Attach the instance domain", "zh-CN": "绑定实例域名" }, scope: "zone", level: "write" },
  ],
  resources: [
    { id: "db", kind: "d1", binding: "DB", defaultName: "${worker}-db", required: true, match: { names: ["openmew"], patterns: ["^openmew-db$"] }, label: { en: "OMEW database", "zh-CN": "OMEW 数据库" } },
    { id: "media", kind: "r2", binding: "MEDIA", defaultName: "${worker}-media", required: true, match: { names: ["omew-media"], patterns: ["^openmew-media$"] }, label: { en: "Media storage", "zh-CN": "媒体存储" } },
  ],
  worker: { defaultName: "openmew", module: "worker/index.js", assetsManifest: "assets-manifest.json", assetsDir: "assets", assetsRouting: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*", "/federation/*", "/stronghold", "/stronghold/*", "/inbox", "/inbox/*", "/media/*"] }, compatibilityDate: "2026-08-21", compatibilityFlags: ["nodejs_compat"], durableObjects: [{ binding: "ROOM_DO", className: "RoomDO", storage: "sqlite" }, { binding: "STRONGHOLD_DO", className: "StrongholdDO", storage: "sqlite" }], vars: [{ name: "INSTANCE_DOMAIN", value: "${input:domain}" }, { name: "R2_BUCKET_NAME", value: "${resource:media}" }, { name: "CF_WORKER_NAME", value: "${worker}" }] },
  inputs: [{ id: "domain", kind: "domain", required: true, label: { en: "Instance domain", "zh-CN": "实例域名" }, help: { en: "The HTTPS hostname where OMEW will be served.", "zh-CN": "OMEW 对外提供服务的 HTTPS 域名。" } }],
  capabilities: ["d1", "r2", "secrets", "worker", "assets", "domains"],
  hostSecrets: [
    { name: "CF_ACCOUNT_ID", source: "accountId", requirement: "required", reason: { en: "Keep the instance connected to its own Cloudflare account for administration.", "zh-CN": "让实例持续连接到所属 Cloudflare 账户，用于实例管理。" } },
    { name: "CF_API_TOKEN", source: "cfApiToken", requirement: "required", placeholder: { en: "cfat_…", "zh-CN": "cfat_…" }, permissions: [{ key: "workers_scripts", type: "edit" }], reason: { en: "Allow the instance to manage its own Worker with the account token you provide.", "zh-CN": "使用你提供的账户令牌管理实例自己的 Worker。" } },
  ],
  steps: ["storage", "schema", "assets", "worker", "secrets"].map((id) => ({ id, label: { en: id, "zh-CN": id } })),
  done: { links: [{ label: { en: "Open OMEW", "zh-CN": "打开 OMEW" }, href: "${url}" }] },
};
await writeFile(join(output, "overture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(output, "overture.tar.gz.sha256"), `${sha256}  overture.tar.gz\n`);
await rm(stage, { recursive: true, force: true });
console.log(JSON.stringify({ artifact: archive, sha256, bytes: archiveBytes.length }, null, 2));
