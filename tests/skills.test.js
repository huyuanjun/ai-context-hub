import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeTextAtomic, ensureDir } from "../src/utils/fsx.js";
import { validateSkills, listSkills, writeSkillIndex } from "../src/core/skills.js";
import { tempHub } from "./helpers.js";

describe("skills validation", () => {
  it("should report ok with empty skills dir", async () => {
    const hub = await tempHub();
    try {
      const result = await validateSkills(hub.root);
      assert.equal(result.status, "ok");
      assert.equal(result.count, 0);
    } finally { await hub.cleanup(); }
  });

  it("should flag missing SKILL.md", async () => {
    const hub = await tempHub();
    try {
      const skillDir = path.join(hub.paths.skills, "empty-skill");
      await ensureDir(skillDir);
      const result = await validateSkills(hub.root);
      const bad = result.skills.find((s) => s.directory === "empty-skill");
      assert.ok(bad);
      assert.ok(bad.errors.some((e) => e.includes("missing SKILL.md")));
    } finally { await hub.cleanup(); }
  });

  it("should flag missing frontmatter name", async () => {
    const hub = await tempHub();
    try {
      const skillDir = path.join(hub.paths.skills, "bad-skill");
      await ensureDir(skillDir);
      await writeTextAtomic(path.join(skillDir, "SKILL.md"), "# No frontmatter\n\nJust body.\n");
      const result = await validateSkills(hub.root);
      const bad = result.skills.find((s) => s.directory === "bad-skill");
      assert.ok(bad.errors.some((e) => e.includes("missing frontmatter name")));
    } finally { await hub.cleanup(); }
  });

  it("should accept valid skill", async () => {
    const hub = await tempHub();
    try {
      const skillDir = path.join(hub.paths.skills, "good-skill");
      await ensureDir(skillDir);
      await writeTextAtomic(path.join(skillDir, "SKILL.md"),
        "---\nname: good-skill\ndescription: A test skill\n---\n\n# Test\n\nBody.\n");
      const result = await validateSkills(hub.root);
      const good = result.skills.find((s) => s.directory === "good-skill");
      assert.equal(good.status, "ok");
      assert.equal(good.name, "good-skill");
    } finally { await hub.cleanup(); }
  });

  it("should list skills after validation", async () => {
    const hub = await tempHub();
    try {
      const skillDir = path.join(hub.paths.skills, "my-skill");
      await ensureDir(skillDir);
      await writeTextAtomic(path.join(skillDir, "SKILL.md"),
        "---\nname: my-skill\ndescription: Does things\n---\n\n# My Skill\n");
      const skills = await listSkills(hub.root);
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, "my-skill");
    } finally { await hub.cleanup(); }
  });

  it("should write index with skill descriptions", async () => {
    const hub = await tempHub();
    try {
      const skillDir = path.join(hub.paths.skills, "indexed-skill");
      await ensureDir(skillDir);
      await writeTextAtomic(path.join(skillDir, "SKILL.md"),
        "---\nname: indexed-skill\ndescription: Skill for indexing test\n---\n\n# Index Test\n");
      const result = await writeSkillIndex(hub.root);
      assert.equal(result.count, 1);
    } finally { await hub.cleanup(); }
  });
});
