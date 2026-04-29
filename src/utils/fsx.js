import fs from "node:fs/promises";
import path from "node:path";

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function writeTextAtomic(filePath, text) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, text, "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function appendText(filePath, text) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, text, "utf8");
}

export async function listDirs(dirPath) {
  if (!(await exists(dirPath))) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export async function listFilesRecursive(root, options = {}) {
  const { maxDepth = 6, includeDirs = false } = options;
  const result = [];

  async function walk(current, depth) {
    if (depth > maxDepth || !(await exists(current))) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (includeDirs) result.push(fullPath);
        await walk(fullPath, depth + 1);
      } else {
        result.push(fullPath);
      }
    }
  }

  await walk(root, 0);
  return result;
}

export async function backupIfUnmanaged(filePath, marker) {
  if (!(await exists(filePath))) return null;
  const text = await readText(filePath);
  if (text.includes(marker)) return null;
  const backupPath = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.rename(filePath, backupPath);
  return backupPath;
}

export async function backupDirectory(target, backupParent = null) {
  if (!(await exists(target))) return null;
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(path.dirname(target));
  if (resolvedTarget === resolvedParent || !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to back up unsafe target: ${target}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = backupParent
    ? path.join(backupParent, `${path.basename(target)}.bak-${stamp}`)
    : `${target}.bak-${stamp}`;
  await ensureDir(path.dirname(backupPath));
  try {
    await fs.rename(target, backupPath);
  } catch (renameError) {
    if (renameError.code === "EXDEV") {
      await fs.cp(target, backupPath, { recursive: true });
      await fs.rm(target, { recursive: true, force: true });
    } else {
      throw renameError;
    }
  }
  return backupPath;
}

export async function safeLinkDirectory(source, target) {
  await ensureDir(path.dirname(target));

  if (await exists(target)) {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      const linkedTo = await fs.readlink(target);
      if (path.resolve(path.dirname(target), linkedTo) === path.resolve(source)) {
        return { status: "exists", target };
      }
    }

    const markerPath = path.join(target, ".ai-context-hub.json");
    if (stat.isDirectory() && (await exists(markerPath))) {
      const marker = JSON.parse(await readText(markerPath));
      if (path.resolve(marker.source || "") === path.resolve(source)) {
        await removeDirectoryInsideParent(target);
      } else {
        return { status: "skipped", target, reason: "managed by a different source" };
      }
    } else {
      return { status: "skipped", target, reason: "target exists" };
    }
  }

  try {
    await fs.symlink(source, target, process.platform === "win32" ? "junction" : "dir");
    return { status: "linked", target };
  } catch (error) {
    try {
      await fs.cp(source, target, { recursive: true, force: false });
      await writeTextAtomic(path.join(target, ".ai-context-hub.json"), `${JSON.stringify({
        source: path.resolve(source),
        copiedAt: new Date().toISOString()
      }, null, 2)}\n`);
      return { status: "copied", target, reason: `link failed: ${error.message}` };
    } catch (copyError) {
      return { status: "failed", target, reason: `${error.message}; copy failed: ${copyError.message}` };
    }
  }
}

async function removeDirectoryInsideParent(target) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(path.dirname(target));
  if (resolvedTarget === resolvedParent || !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to remove unsafe target: ${target}`);
  }
  await fs.rm(resolvedTarget, { recursive: true, force: true });
}
