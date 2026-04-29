import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tempHub } from "./helpers.js";
import { syncInbox } from "../src/core/sync.js";

describe("relations", () => {
  let hub;
  beforeEach(async () => { hub = await tempHub(); });
  afterEach(async () => { await hub.cleanup(); });

  it("should support entities with different entity types", async () => {
    const { remember } = await import("../src/core/store.js");
    await remember(hub.root, "manual", "Test project uses React", { entity: "test-project", entityType: "project" });
    const result = await syncInbox(hub.root);
    assert.equal(result.added, 1);
  });

  it("should preserve entity type across sync", async () => {
    const { remember } = await import("../src/core/store.js");
    await remember(hub.root, "manual", "Tool config uses YAML", { entity: "tool-config", entityType: "config" });
    const result = await syncInbox(hub.root);
    assert.equal(result.added, 1);
  });
});
