import path from "node:path";
import fs from "node:fs/promises";
import { backupIfUnmanaged, ensureDir, exists, listDirs, readText, safeLinkDirectory, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths, toolTargets } from "../core/paths.js";

const MARKER = "AI-CONTEXT-HUB-MANAGED";

export async function linkTools(root, tools, cwd = process.cwd(), options = {}) {
  const targets = toolTargets(cwd);
  const selected = tools.includes("all") ? Object.keys(targets) : tools;
  const dryRun = options.dryRun !== false;
  const results = [];

  for (const tool of selected) {
    const target = targets[tool];
    if (!target) {
      results.push({ tool, status: "unknown-tool" });
      continue;
    }

    if (target.bootstrap) {
      if (dryRun) {
        results.push({ tool, ...(await previewBootstrap(target.bootstrap)) });
      } else {
        const backup = await backupIfUnmanaged(target.bootstrap, MARKER);
        await writeTextAtomic(target.bootstrap, bootstrapFor(tool, root));
        results.push({ tool, status: "bootstrap-written", path: target.bootstrap, backup });
      }
    }

    if (target.skills) {
      if (!dryRun) await ensureDir(target.skills);
      const linked = await linkSkills(root, target.skills, { dryRun });
      results.push({ tool, status: "skills-linked", path: target.skills, linked });
    }
  }

  return { mode: dryRun ? "dry-run" : "apply", results };
}

async function linkSkills(root, targetSkillsDir, options = {}) {
  const skillsDir = hubPaths(root).skills;
  const skillNames = (await listDirs(skillsDir)).filter((name) => name !== "metadata");
  const results = [];
  for (const name of skillNames) {
    const source = path.join(skillsDir, name);
    const target = path.join(targetSkillsDir, name);
    if (options.dryRun) {
      results.push({ name, ...(await previewSkillTarget(source, target)) });
    } else {
      results.push({ name, ...(await safeLinkDirectory(source, target)) });
    }
  }
  return results;
}

async function previewBootstrap(filePath) {
  if (!(await exists(filePath))) {
    return { status: "would-create-bootstrap", path: filePath };
  }
  const text = await readText(filePath);
  if (text.includes(MARKER)) {
    return { status: "would-update-managed-bootstrap", path: filePath };
  }
  return { status: "would-backup-and-replace-bootstrap", path: filePath };
}

async function previewSkillTarget(source, target) {
  if (!(await exists(target))) {
    return { status: "would-link-or-copy", target, source };
  }

  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) {
    const linkedTo = await fs.readlink(target);
    const resolved = path.resolve(path.dirname(target), linkedTo);
    if (resolved === path.resolve(source)) {
      return { status: "exists", target, source };
    }
    return { status: "skipped", target, source, reason: `symlink points to ${resolved}` };
  }

  const markerPath = path.join(target, ".ai-context-hub.json");
  if (stat.isDirectory() && (await exists(markerPath))) {
    const marker = JSON.parse(await readText(markerPath));
    if (path.resolve(marker.source || "") === path.resolve(source)) {
      return { status: "would-refresh-managed-copy", target, source };
    }
    return { status: "skipped", target, source, reason: "managed by a different source" };
  }

  return { status: "skipped", target, source, reason: "target exists and is not managed by ai-context-hub" };
}

function bootstrapFor(tool, root) {
  const canonical = path.join(root, "memory", "canonical");
  const graphFile = path.join(root, "memory", "graph", "memory.jsonl");
  const inboxDir = path.join(root, "memory", "inbox", tool);
  const skillsIndex = path.join(root, "skills", "INDEX.md");
  return `<!-- ${MARKER}: ${tool} -->
# Shared AI Context

## READ FIRST — before any web search

When asked about a person, project, or module:

1. **Read canonical file**: \`Get-Content ${canonical}\\<name>.md -Encoding UTF8\` (replace <name> with entity)
2. **Find relations (do NOT read full graph)**: \`Select-String -Path ${graphFile} -Pattern '<name>' -Encoding UTF8\`
3. **Read preferences once (only when context about user/constraints needed)**: \`Get-Content ${path.join(canonical, "preferences.md")} -Encoding UTF8\`
4. **Skills index (only when skills are relevant)**: \`Get-Content ${skillsIndex} -Encoding UTF8\`

**Never read memory.jsonl in full.** Always use Select-String to grep for the relevant entity name.

## Writing memory

Write one JSONL line to \`${inboxDir}\`:
\`\`\`jsonl
{"text":"fact","entity":"name","entityType":"person|project|module|device|thing","confidence":1.0,"source":"${tool}","ttl":null}
\`\`\`
`;
}
