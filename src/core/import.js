import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appendText, ensureDir, exists, readText } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";
import { scanTools } from "./scan.js";
import { writeSkillIndex } from "./skills.js";

export async function importExisting(root, cwd = process.cwd()) {
  const paths = hubPaths(root);
  const scan = await scanTools(cwd);
  const results = { skills: [], memoryFiles: [] };

  for (const [tool, info] of Object.entries(scan)) {
    if (tool === "project") continue;
    if (info.skills?.skills?.length) {
      for (const skill of info.skills.skills) {
        results.skills.push(await importSkill(paths.skills, tool, skill));
      }
    }
    if (info.bootstrap?.exists) {
      results.memoryFiles.push(await importMemoryFile(paths.memory.inbox, tool, info.bootstrap.path));
    }
  }

  for (const item of scan.project || []) {
    if (item.kind === "file") {
      results.memoryFiles.push(await importMemoryFile(paths.memory.inbox, "project", item.path));
    }
  }

  if (results.skills.some((skill) => skill.status === "imported")) {
    results.skillIndex = await writeSkillIndex(root);
  }

  return results;
}

async function importSkill(sharedSkillsDir, tool, skill) {
  const source = skill.path;
  let target = path.join(sharedSkillsDir, skill.name);

  if (await exists(target)) {
    const sourceHash = await hashSkill(source);
    const targetHash = await hashSkill(target);
    if (sourceHash === targetHash) {
      return { name: skill.name, tool, status: "duplicate", source, target };
    }
    target = path.join(sharedSkillsDir, `${skill.name}--${tool}`);
  }

  await ensureDir(path.dirname(target));
  await fs.cp(source, target, { recursive: true, force: false });
  return { name: path.basename(target), tool, status: "imported", source, target };
}

async function importMemoryFile(inboxDir, tool, sourcePath) {
  const text = await readText(sourcePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(inboxDir, "imported", `${tool}-${timestamp}.md`);
  await appendText(target, `# Imported from ${tool}\n\nSource: ${sourcePath}\n\n${text}\n`);
  return { tool, status: "imported", source: sourcePath, target };
}

async function hashSkill(skillDir) {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!(await exists(skillFile))) return "";
  return crypto.createHash("sha256").update(await readText(skillFile)).digest("hex");
}
