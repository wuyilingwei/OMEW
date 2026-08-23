import { describe, expect, it } from "vitest";
import typesSource from "../web/src/api/types.ts?raw";
import clientSource from "../web/src/api/client.ts?raw";
import mockSource from "../web/src/api/mock.ts?raw";
import settingsSource from "../web/src/components/PersonalSettingsModal.vue?raw";

describe("personal bio web contract", () => {
  it("keeps auth and profile projections aligned with the edit API", () => {
    expect(typesSource).toContain("bio: string | null");
    expect(clientSource).toContain("setBio: (token: string, bio: string)");
    expect(clientSource).toContain("'/api/me/bio'");
    expect(mockSource).toContain("async setBio(token: string, bio: string)");
  });

  it("edits bio by Unicode code point with saved and error feedback", () => {
    expect(settingsSource).toContain("id=\"profile-bio\"");
    expect(settingsSource).toContain("[...trimmed].length > 512");
    expect(settingsSource).toContain("function limitBio()");
    expect(settingsSource).toContain("auth.updateUser({ bio: result.bio })");
  });
});
