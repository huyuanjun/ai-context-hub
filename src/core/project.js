import path from "node:path";
import { backupIfUnmanaged, ensureDir, exists, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

const MARKER = "AI-CONTEXT-HUB-PROJECT";

export async function initProject(root, cwd = process.cwd(), options = {}) {
  const paths = hubPaths(root);
  const projectId = options.projectId || safeProjectId(path.basename(cwd));
  const projectDir = path.join(paths.memory.projects, projectId);
  const dryRun = options.dryRun !== false;

  const memoryFiles = [
    {
      path: path.join(projectDir, "index.md"),
      text: `# ${projectId}\n\nProject memory index.\n\n## Files\n\n- current-state.md\n- decisions.md\n- pitfalls.md\n`
    },
    { path: path.join(projectDir, "current-state.md"), text: "# Current State\n\n" },
    { path: path.join(projectDir, "decisions.md"), text: "# Decisions\n\n" },
    { path: path.join(projectDir, "pitfalls.md"), text: "# Pitfalls\n\n" }
  ];

  const files = [
    {
      path: path.join(cwd, "AGENTS.md"),
      text: projectBootstrap("codex", root, projectId)
    },
    {
      path: path.join(cwd, "CLAUDE.md"),
      text: projectBootstrap("claude", root, projectId)
    },
    {
      path: path.join(cwd, ".cursor", "rules", "shared-ai-context.mdc"),
      text: projectBootstrap("cursor", root, projectId)
    },
    {
      path: path.join(cwd, ".windsurf", "rules", "shared-ai-context.md"),
      text: projectBootstrap("windsurf", root, projectId)
    }
  ];

  if (dryRun) {
    return {
      mode: "dry-run",
      projectId,
      projectDir,
      memory: await Promise.all(memoryFiles.map((file) => previewFile(file.path, MARKER))),
      bootstraps: await Promise.all(files.map((file) => previewFile(file.path, MARKER)))
    };
  }

  await ensureDir(projectDir);
  for (const file of memoryFiles) {
    await ensureFile(file.path, file.text);
  }

  const written = [];
  for (const file of files) {
    const backup = await backupIfUnmanaged(file.path, MARKER);
    await writeTextAtomic(file.path, file.text);
    written.push({ path: file.path, backup });
  }

  return { mode: "apply", projectId, projectDir, written };
}

async function ensureFile(filePath, text) {
  if (!(await exists(filePath))) {
    await writeTextAtomic(filePath, text);
  }
}

function projectBootstrap(tool, root, projectId) {
  const projectRoot = path.join(root, "memory", "canonical", "projects", projectId);
  return `<!-- ${MARKER}: ${tool}:${projectId} -->\n# Shared Project Context\n\nUse the shared AI context hub at:\n\n${root}\n\nFor this project, start with:\n\n- ${path.join(projectRoot, "index.md")}\n- ${path.join(projectRoot, "current-state.md")}\n\nOpen these only when relevant:\n\n- ${path.join(projectRoot, "decisions.md")}\n- ${path.join(projectRoot, "pitfalls.md")}\n\nGlobal shared context:\n\n- ${path.join(root, "memory", "canonical", "global.md")}\n- ${path.join(root, "memory", "canonical", "preferences.md")}\n- ${path.join(root, "skills", "INDEX.md")}\n\nRead the skills index first. Load a full SKILL.md only when its description matches the task.\n\nDurable new project memory should be written as short facts to:\n\n- ${path.join(root, "memory", "inbox", tool)}\n\nDo not load the whole memory tree by default.\n`;
}

async function previewFile(filePath, marker) {
  if (!(await exists(filePath))) return { status: "would-create", path: filePath };
  const text = await readText(filePath);
  if (text.includes(marker)) return { status: "would-update-managed", path: filePath };
  return { status: "would-backup-and-replace", path: filePath };
}

function safeProjectId(name) {
  return String(name || "project").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
}
