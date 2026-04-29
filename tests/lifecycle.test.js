import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tempHub, addInboxEntry } from "./helpers.js";
import { syncInbox } from "../src/core/sync.js";
import { searchMemory } from "../src/core/search.js";

describe("memory lifecycle", () => {
  let hub;
  beforeEach(async () => { hub = await tempHub(); });
  afterEach(async () => { await hub.cleanup(); });

  it("should sync and preserve permanent entries", async () => {
    await addInboxEntry(hub.root, "test", "permanent fact");
    const r1 = await syncInbox(hub.root);
    assert.equal(r1.added, 1);
    const searchResult = await searchMemory(hub.root, "permanent fact");
    assert.ok(searchResult.results.length > 0);
  });

  it("should handle entries with different entities", async () => {
    await addInboxEntry(hub.root, "claude", "User likes dark theme", { entity: "user" });
    await addInboxEntry(hub.root, "codex", "Project uses Node 20", { entity: "my-project", entityType: "project" });
    const result = await syncInbox(hub.root);
    assert.equal(result.added, 2);
    const userResults = await searchMemory(hub.root, "dark theme");
    const projectResults = await searchMemory(hub.root, "Node 20");
    assert.ok(userResults.results.length > 0);
    assert.ok(projectResults.results.length > 0);
  });

  it("should not re-add already synchronized entries", async () => {
    await addInboxEntry(hub.root, "test", "already synced fact");
    const r1 = await syncInbox(hub.root);
    assert.equal(r1.added, 1);

    await addInboxEntry(hub.root, "test", "already synced fact");
    const r2 = await syncInbox(hub.root);
    assert.equal(r2.added, 0);
  });
});
