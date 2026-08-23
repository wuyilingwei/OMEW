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
});
