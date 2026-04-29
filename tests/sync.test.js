import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { syncInbox } from "../src/core/sync.js";
import { searchMemory } from "../src/core/search.js";
import { tempHub, addInboxEntry } from "./helpers.js";

describe("sync pipeline", () => {
  let hub;
  beforeEach(async () => { hub = await tempHub(); });
  afterEach(async () => { await hub.cleanup(); });

  it("should sync inbox entries to canonical and graph", async () => {
    await addInboxEntry(hub.root, "claude", "User prefers TypeScript", { entity: "user", entityType: "person" });
    const result = await syncInbox(hub.root);
    assert.equal(result.added, 1);
    assert.equal(result.scannedFiles, 1);
  });

  it("should deduplicate identical entries", async () => {
    await addInboxEntry(hub.root, "claude", "User prefers TypeScript");
    await addInboxEntry(hub.root, "claude", "User prefers TypeScript");
    const result = await syncInbox(hub.root);
    assert.equal(result.added, 1);
  });

  it("should find synced entries via search", async () => {
    await addInboxEntry(hub.root, "claude", "Project uses PostgreSQL 16");
    await syncInbox(hub.root);
    const result = await searchMemory(hub.root, "PostgreSQL");
    assert.ok(result.results.length > 0);
    assert.ok(result.results.some((r) => r.text.includes("PostgreSQL")));
  });

  it("should skip empty entries", async () => {
    await addInboxEntry(hub.root, "claude", "");
    await addInboxEntry(hub.root, "claude", "   ");
    const result = await syncInbox(hub.root);
    assert.equal(result.added, 0);
  });

  it("should handle no inbox files gracefully", async () => {
    const result = await syncInbox(hub.root);
    assert.equal(result.scannedFiles, 0);
    assert.equal(result.added, 0);
  });
});
