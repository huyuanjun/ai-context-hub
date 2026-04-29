import crypto from "node:crypto";
import path from "node:path";
import { exists, listDirs, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

export async function listSkills(root) {
  const skills = [];
  for (const name of await listDirs(hubPaths(root).skills)) {
    if (name === "metadata") continue;
    const skillPath = path.join(hubPaths(root).skills, name);
    const parsed = await readSkill(skillPath);
    skills.push({ directory: name, path: skillPath, ...parsed.summary });
  }
  return skills.sort((a, b) => a.directory.localeCompare(b.directory));
}

export async function validateSkills(root) {
  const skills = [];
  const seenNames = new Map();

  for (const name of await listDirs(hubPaths(root).skills)) {
    if (name === "metadata") continue;
    const skillPath = path.join(hubPaths(root).skills, name);
    const parsed = await readSkill(skillPath);
    const errors = [];
    const warnings = [];

    if (!parsed.exists) {
      errors.push("missing SKILL.md");
    } else {
      if (!parsed.summary.name) errors.push("missing frontmatter name");
      if (!parsed.summary.description) warnings.push("missing frontmatter description");
      if (parsed.summary.name && parsed.summary.name !== name) {
        warnings.push(`frontmatter name differs from directory: ${parsed.summary.name}`);
      }
      if ((parsed.summary.description || "").length > 400) {
        warnings.push("description is long; short descriptions trigger skills more reliably");
      }
      if (!parsed.body.trim()) warnings.push("empty skill body");
    }

    if (parsed.summary.name) {
      const existing = seenNames.get(parsed.summary.name);
      if (existing) {
        errors.push(`duplicate skill name with ${existing}`);
      } else {
        seenNames.set(parsed.summary.name, name);
      }
    }

    skills.push({
      directory: name,
      path: skillPath,
      name: parsed.summary.name,
      description: parsed.summary.description,
      hash: parsed.summary.hash,
      status: errors.length ? "error" : warnings.length ? "warning" : "ok",
      errors,
      warnings
    });
  }

  return {
    status: skills.some((skill) => skill.status === "error") ? "error" : skills.some((skill) => skill.status === "warning") ? "warning" : "ok",
    count: skills.length,
    skills: skills.sort((a, b) => a.directory.localeCompare(b.directory))
  };
}

export async function writeSkillIndex(root) {
  const skills = await listSkills(root);
  const indexPath = path.join(hubPaths(root).skills, "INDEX.md");
  const lines = [
    "# Shared Skills Index",
    "",
    "Load a skill only when its description matches the task. Do not read every skill by default.",
    ""
  ];

  for (const skill of skills) {
    lines.push(`- ${skill.name || skill.directory}: ${skill.description || "No description."} (${path.join(skill.path, "SKILL.md")})`);
  }

  await writeTextAtomic(indexPath, `${lines.join("\n")}\n`);
  return { path: indexPath, count: skills.length };
}

async function readSkill(skillPath) {
  const file = path.join(skillPath, "SKILL.md");
  if (!(await exists(file))) {
    return {
      exists: false,
      body: "",
      summary: { name: "", description: "", hash: "" }
    };
  }

  const text = await readText(file);
  const frontmatter = parseFrontmatter(text);
  return {
    exists: true,
    body: frontmatter.body,
    summary: {
      name: frontmatter.data.name || "",
      description: frontmatter.data.description || "",
      hash: crypto.createHash("sha256").update(text).digest("hex")
    }
  };
}

function parseFrontmatter(text) {
  text = text.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { data: {}, body: text };
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return { data, body: text.slice(match[0].length) };
}
