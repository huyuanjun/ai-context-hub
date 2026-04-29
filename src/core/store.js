import fs from "node:fs/promises";
import path from "node:path";
import { appendText, ensureDir, exists, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

export async function initHub(root) {
  const paths = hubPaths(root);
  await ensureDir(root);
  await ensureDir(paths.memory.inbox);
  await ensureDir(paths.memory.canonical);
  await ensureDir(paths.memory.projects);
  await ensureDir(paths.memory.graph);
  await ensureDir(paths.memory.conflicts);
  await ensureDir(paths.memory.archive);
  await ensureDir(paths.skills);
  await ensureDir(paths.backups);
  await ensureDir(paths.exports);
  await ensureDir(paths.logs);

  if (!(await exists(paths.config))) {
    await writeTextAtomic(paths.config, `${JSON.stringify(defaultConfig(root), null, 2)}\n`);
  }

  await ensureMarkdown(paths.memory.global, "# Global Memory\n\nDurable facts shared by AI tools.\n");
  await ensureMarkdown(paths.memory.preferences, "# Preferences\n\n");
  await ensureMarkdown(paths.memory.tools, "# Tools\n\n");
  await ensureMarkdown(path.join(paths.memory.projects, "README.md"), "# Projects\n\nProject-specific memory lives in subdirectories here.\n");
  await ensureMarkdown(path.join(paths.skills, "README.md"), "# Shared Skills\n\nEach skill is a directory containing SKILL.md.\n");

  return paths;
}

export async function loadConfig(root) {
  const paths = hubPaths(root);
  if (!(await exists(paths.config))) return defaultConfig(root);
  return JSON.parse(await readText(paths.config));
}

export async function writeRegistry(root, registry) {
  await writeTextAtomic(hubPaths(root).registry, `${JSON.stringify(registry, null, 2)}\n`);
}

export async function loadRegistry(root) {
  const registryPath = hubPaths(root).registry;
  if (!(await exists(registryPath))) return { imports: [], tools: {}, updatedAt: null };
  return JSON.parse(await readText(registryPath));
}

export async function remember(root, tool, text, options = {}) {
  const timestamp = new Date().toISOString();
  const inboxPath = path.join(hubPaths(root).memory.inbox, tool, `${timestamp.replace(/[:.]/g, "-")}.jsonl`);
  const record = {
    id: `${tool}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    type: "observation",
    tool,
    entity: options.entity || "user",
    entityType: options.entityType || "person",
    text,
    confidence: typeof options.confidence === "number" ? options.confidence : 1.0,
    ttl: options.ttl !== undefined ? options.ttl : null,
    source: options.source || tool,
    createdAt: timestamp
  };
  await appendText(inboxPath, `${JSON.stringify(record)}\n`);
  return inboxPath;
}

async function ensureMarkdown(filePath, initialText) {
  if (!(await exists(filePath))) {
    await writeTextAtomic(filePath, initialText);
  }
}

function defaultConfig(root) {
  return {
    version: 1,
    root,
    memory: {
      defaultEntity: "user",
      writeMode: "inbox",
      graphFile: "memory/graph/memory.jsonl"
    },
    tools: {
      claude: { enabled: true },
      codex: { enabled: true },
      gemini: { enabled: true },
      cursor: { enabled: true },
      windsurf: { enabled: true },
      agents: { enabled: true }
    },
    sync: {
      duplicateStrategy: "hash",
      conflictStrategy: "manual"
    }
  };
}

export async function withLock(root, fn) {
  const lockPath = hubPaths(root).lock;
  let handle = null;
  try {
    await removeStaleLock(lockPath);
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await fn();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`sync lock already exists: ${lockPath}`);
    }
    throw error;
  } finally {
    if (handle) await handle.close();
    if (handle) await fs.rm(lockPath, { force: true });
  }
}

async function removeStaleLock(lockPath) {
  if (!(await exists(lockPath))) return;
  let lock = null;
  try {
    lock = JSON.parse(await readText(lockPath));
  } catch {
    lock = null;
  }
  const createdAt = lock?.createdAt ? Date.parse(lock.createdAt) : 0;
  const isStale = !createdAt || Date.now() - createdAt > 10 * 60 * 1000;
  if (isStale) {
    await fs.rm(lockPath, { force: true });
  }
}
