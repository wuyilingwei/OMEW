import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

// Instance governance (m0-protocol §7.9): stronghold_creation_policy's
// open/restricted/application matrix and its application/approval flow, plus
// the three governance fields on GET|PATCH /api/admin/instance/config and their
// public subset on GET /api/instance/config.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

let userCounter = 0;

async function freshUser(): Promise<{ actor: string; token: string }> {
  userCounter += 1;
  const username = `govuser${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  return { actor: `@${username}:local`, token: json.token as string };
}

async function makeAdmin(): Promise<{ actor: string; token: string }> {
  const user = await freshUser();
  await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE localpart = ?")
    .bind(user.actor.slice(1, user.actor.indexOf(":")))
    .run();
  return user;
}

interface GovernanceRow {
  federation_peers: string;
  stronghold_creation_policy: string;
  stronghold_creators: string;
}

async function setGovernance(overrides: {
  federation_peers?: string[];
  stronghold_creation_policy?: string;
  stronghold_creators?: string[];
}): Promise<void> {
  const current = await env.DB.prepare(
    "SELECT federation_peers, stronghold_creation_policy, stronghold_creators FROM instance_config WHERE id = 1"
  ).first<GovernanceRow>();
  const peers = overrides.federation_peers ?? (JSON.parse(current!.federation_peers) as string[]);
  const policy = overrides.stronghold_creation_policy ?? current!.stronghold_creation_policy;
  const creators = overrides.stronghold_creators ?? (JSON.parse(current!.stronghold_creators) as string[]);
  await env.DB.prepare(
    "UPDATE instance_config SET federation_peers = ?, stronghold_creation_policy = ?, stronghold_creators = ? WHERE id = 1"
  )
    .bind(JSON.stringify(peers), policy, JSON.stringify(creators))
    .run();
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("POST /api/strongholds: creation policy matrix", () => {
  it("open: any logged-in user can create directly", async () => {
    await setGovernance({ stronghold_creation_policy: "open", stronghold_creators: [] });
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
    await setGovernance({ stronghold_creation_policy: "restricted", stronghold_creators: [listed.actor] });

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
    await setGovernance({ stronghold_creation_policy: "application", stronghold_creators: [] });
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
    await setGovernance({ stronghold_creation_policy: "application", stronghold_creators: [] });
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
    await setGovernance({ stronghold_creation_policy: "application", stronghold_creators: [] });
    const admin = await makeAdmin();
    const res = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ name: "Admin Direct Stronghold" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("admin instance config: governance fields", () => {
  it("round-trips federation_peers, stronghold_creation_policy, stronghold_creators through GET/PATCH", async () => {
    const admin = await makeAdmin();
    const patchRes = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({
        federation_peers: ["peer.example", "other.peer.example"],
        stronghold_creation_policy: "restricted",
        stronghold_creators: ["@alice:local"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.federation_peers).toEqual(["peer.example", "other.peer.example"]);
    expect(patched.stronghold_creation_policy).toBe("restricted");
    expect(patched.stronghold_creators).toEqual(["@alice:local"]);

    const getRes = await apiRequest("/api/admin/instance/config", { headers: { Authorization: `Bearer ${admin.token}` } });
    const fetched = (await getRes.json()) as Record<string, unknown>;
    expect(fetched.federation_peers).toEqual(["peer.example", "other.peer.example"]);
    expect(fetched.stronghold_creation_policy).toBe("restricted");
    expect(fetched.stronghold_creators).toEqual(["@alice:local"]);
  });

  it("rejects an invalid policy enum with 400 CONFIG_INVALID", async () => {
    const admin = await makeAdmin();
    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ stronghold_creation_policy: "invited-only" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CONFIG_INVALID" });
  });

  it("rejects a malformed actor in stronghold_creators with 400 CONFIG_INVALID", async () => {
    const admin = await makeAdmin();
    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ stronghold_creators: ["not-an-actor"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CONFIG_INVALID" });
  });

  it("rejects a malformed domain in federation_peers with 400 CONFIG_INVALID", async () => {
    const admin = await makeAdmin();
    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ federation_peers: ["*"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CONFIG_INVALID" });
  });
});

describe("GET /api/instance/config: public subset", () => {
  it("exposes stronghold_creation without leaking creators or peers", async () => {
    await setGovernance({ stronghold_creation_policy: "application" });
    const res = await apiRequest("/api/instance/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.stronghold_creation).toBe("application");
    expect(body).not.toHaveProperty("stronghold_creators");
    expect(body).not.toHaveProperty("federation_peers");
  });
});
