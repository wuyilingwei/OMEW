// SPDX-License-Identifier: AGPL-3.0-or-later

export async function deploy(ctx) {
  const { workerName, domain } = ctx.ctx;

  await ctx.step("storage", "running");
  await ctx.d1.provision("db");
  await ctx.r2.provision("media");
  await ctx.step("storage", "success");

  await ctx.step("schema", "running");
  await ctx.d1.query("db", "CREATE TABLE IF NOT EXISTS overture_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const migrations = JSON.parse(await ctx.text("migrations/index.json"));
  if (ctx.ctx.mode === "overwrite") {
    const existing = await ctx.d1.query("db", "SELECT name FROM overture_migrations");
    if (!rowsOf(existing).length) {
      const tables = rowsOf(await ctx.d1.query(
        "db",
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'd1_migrations')",
      ));
      const tableNames = new Set(tables.map((row) => row.name));
      if (tableNames.has("d1_migrations")) {
        const legacy = rowsOf(await ctx.d1.query("db", "SELECT name FROM d1_migrations"));
        if (tableNames.has("users") && !legacy.length) {
          throw new Error("Existing OMEW database has no verifiable migration history");
        }
        for (const row of legacy) {
          if (typeof row.name === "string") {
            await ctx.d1.query(
              "db",
              "INSERT OR IGNORE INTO overture_migrations (name, applied_at) VALUES (?, unixepoch())",
              [row.name],
            );
          }
        }
      } else if (tableNames.has("users")) {
        throw new Error("Existing OMEW database has no verifiable migration history");
      }
    }
  }
  for (const name of migrations) {
    const applied = await ctx.d1.query("db", "SELECT name FROM overture_migrations WHERE name = ?", [name]);
    if (!rowsOf(applied).length) {
      await ctx.d1.query("db", await ctx.text(`migrations/${name}`));
      await ctx.d1.query("db", "INSERT INTO overture_migrations (name, applied_at) VALUES (?, unixepoch())", [name]);
    }
  }
  await ctx.step("schema", "success");

  await ctx.step("assets", "running");
  const assets = await ctx.assets.upload();
  await ctx.step("assets", "success");

  await ctx.step("worker", "running");
  const { versionId } = await ctx.worker.uploadVersion({ assets });
  await ctx.worker.switchTraffic(versionId);
  await ctx.step("worker", "success");

  if (domain) await ctx.domains.attach(domain);

  await ctx.step("secrets", "running");
  if (ctx.ctx.mode === "fresh" || ctx.ctx.fullRebuild) await ctx.secrets.put("DEV_TOKEN_SECRET", await ctx.crypto.randomBase64(48));
  await ctx.secrets.putHostValue("CF_ACCOUNT_ID");
  await ctx.secrets.putHostValue("CF_API_TOKEN");
  await ctx.step("secrets", "success");

  const url = domain ? `https://${domain}` : "";
  await ctx.result({
    url,
    notes: [`Worker ${workerName} deployed.`],
  });
}

function rowsOf(queryResult) {
  if (!Array.isArray(queryResult)) throw new Error("D1 returned an invalid query response");
  return queryResult.flatMap((result) => Array.isArray(result?.results) ? result.results : []);
}
