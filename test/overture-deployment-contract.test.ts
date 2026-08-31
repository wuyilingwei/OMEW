// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { deploy } from "../overture/recipe.js";

const migrationNames = ["0001_init.sql", "0002_user_system.sql", "0003_new.sql"];

function queryResult(rows: Array<Record<string, unknown>> = []) {
  return [{ results: rows, success: true }];
}

function deploymentContext(options: {
  mode: "fresh" | "overwrite";
  overtureLedger?: string[];
  wranglerLedger?: string[] | null;
  established?: boolean;
  fullRebuild?: boolean;
}) {
  const overtureLedger = new Set(options.overtureLedger ?? []);
  const appliedSql: string[] = [];
  const putSecret = vi.fn();
  const putHostValue = vi.fn();
  const query = vi.fn(async (_resource: string, sql: string, params?: unknown[]) => {
    if (sql.includes("sqlite_master")) {
      const rows: Array<{ name: string }> = [];
      if (options.established) rows.push({ name: "users" });
      if (options.wranglerLedger !== null && options.wranglerLedger !== undefined) rows.push({ name: "d1_migrations" });
      return queryResult(rows);
    }
    if (sql === "SELECT name FROM d1_migrations") {
      return queryResult((options.wranglerLedger ?? []).map((name) => ({ name })));
    }
    if (sql === "SELECT name FROM overture_migrations") {
      return queryResult([...overtureLedger].map((name) => ({ name })));
    }
    if (sql.includes("WHERE name = ?")) {
      return queryResult(overtureLedger.has(String(params?.[0])) ? [{ name: params?.[0] }] : []);
    }
    if (sql.includes("INSERT OR IGNORE INTO overture_migrations") || sql.includes("INSERT INTO overture_migrations")) {
      overtureLedger.add(String(params?.[0]));
      return queryResult();
    }
    if (sql.startsWith("-- migration:")) appliedSql.push(sql);
    return queryResult();
  });
  const ctx = {
    ctx: { workerName: "openmew", domain: "omew.example.test", mode: options.mode, fullRebuild: options.fullRebuild },
    step: vi.fn(),
    d1: { provision: vi.fn(), query },
    r2: { provision: vi.fn() },
    text: vi.fn(async (path: string) => path === "migrations/index.json"
      ? JSON.stringify(migrationNames)
      : `-- migration:${path}`),
    assets: { upload: vi.fn(async () => "asset-handle") },
    worker: {
      uploadVersion: vi.fn(async () => ({ versionId: "version-1" })),
      switchTraffic: vi.fn(),
    },
    domains: { attach: vi.fn() },
    secrets: { put: putSecret, putHostValue },
    crypto: { randomBase64: vi.fn(async () => "random-secret") },
    result: vi.fn(),
  };
  return { ctx, overtureLedger, appliedSql, putSecret, putHostValue };
}

describe("Overture deployment recipe", () => {
  it("applies every migration and creates the secret for a fresh deployment", async () => {
    const state = deploymentContext({ mode: "fresh" });
    await deploy(state.ctx);
    expect(state.appliedSql).toEqual(migrationNames.map((name) => `-- migration:migrations/${name}`));
    expect([...state.overtureLedger]).toEqual(migrationNames);
    expect(state.putSecret).toHaveBeenCalledWith("DEV_TOKEN_SECRET", "random-secret");
    expect(state.putHostValue).toHaveBeenNthCalledWith(1, "CF_ACCOUNT_ID");
    expect(state.putHostValue).toHaveBeenNthCalledWith(2, "CF_API_TOKEN");
  });

  it("imports Wrangler history and applies only newer migrations on overwrite", async () => {
    const state = deploymentContext({
      mode: "overwrite",
      established: true,
      wranglerLedger: migrationNames.slice(0, 2),
    });
    await deploy(state.ctx);
    expect(state.appliedSql).toEqual(["-- migration:migrations/0003_new.sql"]);
    expect([...state.overtureLedger]).toEqual(migrationNames);
    expect(state.putSecret).not.toHaveBeenCalled();
    expect(state.putHostValue).toHaveBeenCalledTimes(2);
  });

  it("uses its own ledger on later overwrites without replaying migrations", async () => {
    const state = deploymentContext({ mode: "overwrite", overtureLedger: migrationNames });
    await deploy(state.ctx);
    expect(state.appliedSql).toEqual([]);
    expect(state.putSecret).not.toHaveBeenCalled();
    expect(state.putHostValue).toHaveBeenCalledTimes(2);
  });

  it("fails safely when an established database has no migration ledger", async () => {
    const state = deploymentContext({ mode: "overwrite", established: true, wranglerLedger: null });
    await expect(deploy(state.ctx)).rejects.toThrow("no verifiable migration history");
    expect(state.appliedSql).toEqual([]);
  });
});
