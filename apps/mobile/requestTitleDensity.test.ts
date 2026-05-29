import { usesCompactRequestTitle, usesDenseRequestTitle } from "./requestsScreen/requestTitleDensity";

describe("request title density", () => {
  it("keeps short request titles large", () => {
    expect(usesCompactRequestTitle("Deploy?")).toBe(false);
    expect(usesDenseRequestTitle("Deploy?")).toBe(false);
  });

  it("compacts very long user-facing questions", () => {
    const longQuestion = "What should the canonical user-facing noun be for the thing `jjw create` makes and `jjw tidy` removes? Recommendation: use Workspace everywhere, and treat worktree as an implementation/storage-path word to avoid in commands and help text unless referring to the configured root directory.";

    expect(usesCompactRequestTitle(longQuestion)).toBe(true);
    expect(usesDenseRequestTitle(longQuestion)).toBe(true);
  });
});
