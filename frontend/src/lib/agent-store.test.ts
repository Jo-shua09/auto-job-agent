import { beforeEach, describe, expect, it, vi } from "vitest";
describe("demo application quota", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it("reserves each approved job immediately, preventing a batch from exceeding the quota", async () => {
    const { agent } = await import("./agent-store");
    agent.setLimit(5); // Four sample applications today; only one remaining.
    expect(agent.canApply()).toBe(true);
    void agent.approve("q1");
    expect(agent.canApply()).toBe(false);
    expect(await agent.approve("q2")).toBe(false);
  });
});
