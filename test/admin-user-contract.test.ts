import { describe, expect, it } from "vitest";
import mockSource from "../web/src/api/mock.ts?raw";

describe("管理员用户列表 mock 契约", () => {
  it("允许 admin/owner 列表，但继续只允许 owner 写 server_role", () => {
    const listing = mockSource.slice(mockSource.indexOf("async getAdminUsers"), mockSource.indexOf("async patchAdminUserRole"));
    const rolePatch = mockSource.slice(mockSource.indexOf("async patchAdminUserRole"));

    expect(listing).toContain("requireAdmin(token)");
    expect(listing).not.toContain("requireOwner(token)");
    expect(rolePatch).toContain("const owner = requireOwner(token)");
  });

  it("对齐真实 API 的服务器管理员据点 overlay 与成员列表边界", () => {
    const list = mockSource.slice(mockSource.indexOf("async listMyStrongholds"), mockSource.indexOf("async createStronghold"));
    const manager = mockSource.slice(mockSource.indexOf("function requireManager"), mockSource.indexOf("function toPost"));
    const memberList = mockSource.slice(mockSource.indexOf("async getStrongholdMembers"), mockSource.indexOf("async patchMember"));
    const transfer = mockSource.slice(mockSource.indexOf("async transferOwnership"), mockSource.indexOf("async getUser"));
    const retract = mockSource.slice(mockSource.indexOf("async retractItem"), mockSource.indexOf("// ---- posts"));

    expect(list).toContain("user.is_admin");
    expect(list).toContain("[...strongholds.values()]");
    expect(list).toContain("strongholdMembers.get(s.id)?.some((m) => m.actor === user.actor)");
    expect(manager).toContain("if (user.is_admin)");
    expect(manager).toContain("role: 'owner'");
    expect(manager).not.toContain("member ??");
    expect(memberList).toContain("if (!user.is_admin && !findMember(nodeId, user.actor))");
    expect(transfer).toContain("if (!isRealOwner && user.server_role !== 'owner')");
    expect(retract).toContain("const { user, member: manager } = requireManager(token, nodeId)");
    expect(retract).toContain("manager.role === 'mod' && findMember(nodeId, item.actor)?.role === 'owner'");
  });
});
