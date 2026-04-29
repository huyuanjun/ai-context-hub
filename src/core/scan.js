import path from "node:path";
import { exists, listDirs, listFilesRecursive, readText } from "../utils/fsx.js";
import { toolTargets } from "./paths.js";

export async function scanTools(cwd = process.cwd()) {
  const targets = toolTargets(cwd);
  const found = {};

  for (const [tool, target] of Object.entries(targets)) {
    found[tool] = {
      bootstrap: target.bootstrap ? await fileInfo(target.bootstrap) : null,
      skills: target.skills ? await skillsInfo(target.skills) : null
    };
  }

  found.project = await projectLocalFiles(cwd);
  return found;
}

async function fileInfo(filePath) {
  if (!(await exists(filePath))) return { exists: false, path: filePath };
  const text = await readText(filePath);
  return {
    exists: true,
    path: filePath,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.split(/\r?\n/).length
  };
}

async function skillsInfo(dirPath) {
  if (!(await exists(dirPath))) return { exists: false, path: dirPath, count: 0, skills: [] };
  const dirs = await listDirs(dirPath);
  const skills = [];
  for (const name of dirs) {
    const skillPath = path.join(dirPath, name, "SKILL.md");
    if (await exists(skillPath)) {
      const text = await readText(skillPath);
      skills.push({ name, path: path.dirname(skillPath), bytes: Buffer.byteLength(text, "utf8") });
    }
  }
  return { exists: true, path: dirPath, count: skills.length, skills };
}

async function projectLocalFiles(cwd) {
  const candidates = [
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    ".cursor/rules",
    ".windsurf/rules",
    ".agents/skills",
    ".claude/skills"
  ];
  const result = [];
  for (const candidate of candidates) {
    const fullPath = path.join(cwd, candidate);
    if (!(await exists(fullPath))) continue;
    if (candidate.endsWith("skills") || candidate.endsWith("rules")) {
      const files = await listFilesRecursive(fullPath, { maxDepth: 3 });
      result.push({ path: fullPath, kind: "directory", files: files.length });
    } else {
      result.push({ path: fullPath, kind: "file" });
    }
  }
  return result;
}
