import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, loginAs, registerUser } from "./helpers";

// Instance governance (m0-protocol §7.9): stronghold_creation_policy's
// open/restricted/application matrix, now driven by the STRONGHOLD_CREATION /
// STRONGHOLD_CREATORS / FEDERATION_PEERS env vars (task 035) instead of the
// instance_config D1 table. GET/PATCH /api/admin/instance/config's read-only-ness
// is covered separately below.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

let userCounter = 0;

async function freshUser(): Promise<{ actor: string; token: string; username: string }> {
  userCounter += 1;
  const username = `govuser${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  return { actor: `@${username}:local`, token: json.token as string, username };
}

// Promotes via direct D1 write (server_role is otherwise only settable through
// the owner-only PATCH /api/admin/users/:localpart endpoint - see
// server-role.test.ts) then re-logs-in, since server_role now rides in the
// session token claim (m0-protocol §7.10) and a token minted before the
// promotion wouldn't reflect it.
async function makeAdmin(): Promise<{ actor: string; token: string }> {
  const user = await freshUser();
  await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind(user.username).run();
  const token = await loginAs(user.username);
  return { actor: user.actor, token };
}

function setGovernanceEnv(overrides: {
  federation_peers?: string[];
  stronghold_creation_policy?: string;
  stronghold_creators?: string[];
}): void {
  if (overrides.federation_peers) env.FEDERATION_PEERS = overrides.federation_peers.join(",");
  if (overrides.stronghold_creation_policy) env.STRONGHOLD_CREATION = overrides.stronghold_creation_policy;
  if (overrides.stronghold_creators) env.STRONGHOLD_CREATORS = overrides.stronghold_creators.join(",");
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("POST /api/strongholds: creation policy matrix", () => {
  it("open: any logged-in user can create directly", async () => {
    setGovernanceEnv({ stronghold_creation_policy: "open", stronghold_creators: [] });
    const user = await freshUser();
    const res = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ name: "Open Policy Stronghold" }),
    });
    expect(res.status).toBe(201);
  });

  it("restricted: a listed actor and an admin can create, an unlisted actor gets 403 CREATION_RESTRICTED", async () => {
    const listed = await freshUser();
    const admin = await makeAdmin();
    const outsider = await freshUser();
    setGovernanceEnv({ stronghold_creation_policy: "restricted", stronghold_creators: [listed.actor] });

    const listedRes = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${listed.token}` },
      body: JSON.stringify({ name: "Listed Creator Stronghold" }),
    });
    expect(listedRes.status).toBe(201);

    const adminRes = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ name: "Admin Creator Stronghold" }),
    });
    expect(adminRes.status).toBe(201);

    const outsiderRes = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${outsider.token}` },
      body: JSON.stringify({ name: "Outsider Stronghold" }),
    });
    expect(outsiderRes.status).toBe(403);
    expect(await outsiderRes.json()).toEqual({ error: "CREATION_RESTRICTED" });
  });

  it("application: files a pending application; approval creates the stronghold owned by the applicant with default rooms", async () => {
    setGovernanceEnv({ stronghold_creation_policy: "application", stronghold_creators: [] });
    const applicant = await freshUser();
    const admin = await makeAdmin();

    const applyRes = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${applicant.token}` },
      body: JSON.stringify({ name: "Applied Stronghold", description: "pending review" }),
    });
    expect(applyRes.status).toBe(202);
    const applyBody = (await applyRes.json()) as { application_id: string; state: string };
    expect(applyBody.state).toBe("pending");
    const applicationId = applyBody.application_id;

    const mineRes = await apiRequest("/api/me/stronghold-applications", {
      headers: { Authorization: `Bearer ${applicant.token}` },
    });
    const mine = (await mineRes.json()) as { applications: Array<{ id: string; state: string }> };
    expect(mine.applications.some((a) => a.id === applicationId && a.state === "pending")).toBe(true);

    const pendingListRes = await apiRequest("/api/admin/stronghold-applications?state=pending", {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const pendingList = (await pendingListRes.json()) as { applications: Array<{ id: string }> };
    expect(pendingList.applications.some((a) => a.id === applicationId)).toBe(true);

    const approveRes = await apiRequest(`/api/admin/stronghold-applications/${applicationId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ state: "approved" }),
    });
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as { state: string; stronghold: { id: string; owner_actor: string } };
    expect(approved.state).toBe("approved");
    expect(approved.stronghold.owner_actor).toBe(applicant.actor);

    const stub = env.STRONGHOLD_DO.getByName(approved.stronghold.id);
    const rooms = await stub.listRooms();
    expect(rooms).toHaveLength(2);
    expect(rooms.some((r) => r.res_id === "lobby" && r.type === "channel")).toBe(true);
    expect(rooms.some((r) => r.res_id === "posts" && r.type === "section")).toBe(true);
    const owner = await stub.getMember(applicant.actor);
    expect(owner?.role).toBe("owner");

    const redecideRes = await apiRequest(`/api/admin/stronghold-applications/${applicationId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ state: "rejected" }),
    });
    expect(redecideRes.status).toBe(409);
    expect(await redecideRes.json()).toEqual({ error: "ALREADY_DECIDED" });
  });

  it("application: rejection leaves no stronghold behind, and a repeat decision is rejected with 409", async () => {
    setGovernanceEnv({ stronghold_creation_policy: "application", stronghold_creators: [] });
    const applicant = await freshUser();
    const admin = await makeAdmin();

    const applyRes = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${applicant.token}` },
      body: JSON.stringify({ name: "Rejected Stronghold" }),
    });
    const applicationId = ((await applyRes.json()) as { application_id: string }).application_id;

    const rejectRes = await apiRequest(`/api/admin/stronghold-applications/${applicationId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ state: "rejected" }),
    });
    expect(rejectRes.status).toBe(200);
    expect(await rejectRes.json()).toEqual({ id: applicationId, state: "rejected" });

    const rejectedListRes = await apiRequest("/api/admin/stronghold-applications?state=rejected", {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const rejectedList = (await rejectedListRes.json()) as { applications: Array<{ id: string }> };
    expect(rejectedList.applications.some((a) => a.id === applicationId)).toBe(true);

    const reapproveRes = await apiRequest(`/api/admin/stronghold-applications/${applicationId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ state: "approved" }),
    });
    expect(reapproveRes.status).toBe(409);
    expect(await reapproveRes.json()).toEqual({ error: "ALREADY_DECIDED" });
  });

  it("application: an admin bypasses the application flow and creates directly", async () => {
    setGovernanceEnv({ stronghold_creation_policy: "application", stronghold_creators: [] });
    const admin = await makeAdmin();
    const res = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ name: "Admin Direct Stronghold" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("admin instance config: policy is env, not runtime-writable", () => {
  it("GET reflects the env-derived governance fields with source: env", async () => {
    setGovernanceEnv({
      federation_peers: ["peer.example", "other.peer.example"],
      stronghold_creation_policy: "restricted",
      stronghold_creators: ["@alice:local"],
    });
    const admin = await makeAdmin();
    const res = await apiRequest("/api/admin/instance/config", { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("env");
    expect(body.federation_peers).toEqual(["peer.example", "other.peer.example"]);
    expect(body.stronghold_creation_policy).toBe("restricted");
    expect(body.stronghold_creators).toEqual(["@alice:local"]);
  });

  it("PATCH always 409s with POLICY_IS_ENV, regardless of body content", async () => {
    const admin = await makeAdmin();
    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ stronghold_creation_policy: "open" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "POLICY_IS_ENV" });
  });

  it("PATCH still requires server-admin auth before the 409 (a plain user gets 403 first)", async () => {
    const user = await freshUser();
    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ stronghold_creation_policy: "open" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_REQUIRED" });
  });
});

describe("GET /api/instance/config: public subset", () => {
  it("exposes stronghold_creation without leaking creators or peers", async () => {
    setGovernanceEnv({ stronghold_creation_policy: "application" });
    const res = await apiRequest("/api/instance/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.stronghold_creation).toBe("application");
    expect(body).not.toHaveProperty("stronghold_creators");
    expect(body).not.toHaveProperty("federation_peers");
  });
});
