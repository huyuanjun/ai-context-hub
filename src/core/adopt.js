import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { backupDirectory, exists, listDirs, readText, safeLinkDirectory } from "../utils/fsx.js";
import { hubPaths, toolTargets } from "./paths.js";

export async function adoptSkills(root, tools, cwd = process.cwd(), options = {}) {
  const targets = toolTargets(cwd);
  const selectedTools = tools.includes("all") ? Object.keys(targets) : tools;
  const dryRun = options.dryRun !== false;
  const skillFilter = options.skill ? new Set([options.skill]) : null;
  const results = [];

  for (const tool of selectedTools) {
    const target = targets[tool];
    if (!target) {
      results.push({ tool, status: "unknown-tool" });
      continue;
    }
    if (!target.skills) {
      results.push({ tool, status: "no-skill-target" });
      continue;
    }

    const skillNames = await sharedSkillNames(root, skillFilter);
    const adopted = [];
    for (const skillName of skillNames) {
      adopted.push(await adoptOneSkill(root, tool, skillName, target.skills, { dryRun }));
    }
    results.push({ tool, status: "checked", path: target.skills, skills: adopted });
  }

  return { mode: dryRun ? "dry-run" : "apply", results };
}

async function sharedSkillNames(root, skillFilter) {
  const names = (await listDirs(hubPaths(root).skills)).filter((name) => name !== "metadata");
  return skillFilter ? names.filter((name) => skillFilter.has(name)) : names;
}

async function adoptOneSkill(root, tool, skillName, toolSkillsDir, options) {
  const source = path.join(hubPaths(root).skills, skillName);
  const target = path.join(toolSkillsDir, skillName);

  if (!(await exists(source))) {
    return { name: skillName, status: "missing-shared-skill", source };
  }
  if (!(await exists(target))) {
    if (options.dryRun) {
      return { name: skillName, status: "would-link-or-copy", source, target };
    }
    return { name: skillName, ...(await safeLinkDirectory(source, target)) };
  }

  const targetState = await classifyTarget(source, target);
  if (targetState.managed) {
    if (options.dryRun) {
      return { name: skillName, status: "would-refresh-managed-target", source, target };
    }
    return { name: skillName, ...(await safeLinkDirectory(source, target)) };
  }

  if (options.dryRun) {
    return {
      name: skillName,
      status: targetState.sameContent ? "would-backup-and-adopt-identical" : "would-backup-and-adopt-different",
      source,
      target,
      targetHash: targetState.targetHash,
      sourceHash: targetState.sourceHash
    };
  }

  const backup = await backupDirectory(target, path.join(hubPaths(root).backups, "skills", tool));
  const linked = await safeLinkDirectory(source, target);
  return { name: skillName, status: "adopted", source, target, backup, linked };
}

async function classifyTarget(source, target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) {
    const linkedTo = await fs.readlink(target);
    return {
      managed: path.resolve(path.dirname(target), linkedTo) === path.resolve(source),
      sameContent: false
    };
  }

  const markerPath = path.join(target, ".ai-context-hub.json");
  if (stat.isDirectory() && (await exists(markerPath))) {
    const marker = JSON.parse(await readText(markerPath));
    return {
      managed: path.resolve(marker.source || "") === path.resolve(source),
      sameContent: false
    };
  }

  const sourceHash = await hashSkill(source);
  const targetHash = await hashSkill(target);
  return {
    managed: false,
    sameContent: sourceHash && targetHash && sourceHash === targetHash,
    sourceHash,
    targetHash
  };
}

async function hashSkill(skillDir) {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!(await exists(skillFile))) return "";
  return crypto.createHash("sha256").update(await readText(skillFile)).digest("hex");
}
