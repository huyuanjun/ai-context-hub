import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, exists, listDirs, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

const BACKUP_EXCLUDES = new Set([".git", "backups", "logs"]);

export async function createBackup(root, options = {}) {
  const paths = hubPaths(root);
  const backupId = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const backupDir = path.join(paths.backups, backupId);
  const dryRun = options.dryRun !== false;

  const sources = await listBackupSources(root);

  if (dryRun) {
    return {
      mode: "dry-run",
      backupId,
      path: backupDir,
      fileCount: sources.length,
      note: "Use --apply to create the backup."
    };
  }

  await ensureDir(backupDir);
  const manifest = await copyWithManifest(root, backupDir, sources);

  const manifestPath = path.join(backupDir, "manifest.json");
  await writeTextAtomic(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    mode: "apply",
    backupId,
    path: backupDir,
    manifest
  };
}

async function listBackupSources(root) {
  const sources = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (BACKUP_EXCLUDES.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".seen-hashes") continue;
      sources.push(entry.name);
    }
  } catch {
    // Root doesn't exist yet
  }
  return sources;
}

async function copyWithManifest(root, backupDir, sources) {
  const entries = [];

  for (const src of sources) {
    const srcPath = path.join(root, src);
    if (!(await exists(srcPath))) continue;

    const destPath = path.join(backupDir, src);
    const stat = await fs.stat(srcPath);

    if (stat.isDirectory()) {
      await fs.cp(srcPath, destPath, { recursive: true });
      await collectDirEntries(destPath, src, entries);
    } else {
      await fs.copyFile(srcPath, destPath);
      const hash = await fileSha256(destPath);
      entries.push({ path: src, bytes: stat.size, sha256: hash });
    }
  }

  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const checksum = crypto.createHash("sha256")
    .update(entries.map((e) => e.sha256).join(""))
    .digest("hex");

  return {
    createdAt: new Date().toISOString(),
    files: entries.length,
    totalBytes,
    checksum,
    entries
  };
}

async function collectDirEntries(dirPath, relativePrefix, entries) {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
    for (const item of items) {
      if (!item.isFile()) continue;
      const fullPath = path.join(item.parentPath || dirPath, item.name);
      const relativePath = path.join(relativePrefix, path.relative(dirPath, fullPath));
      const stat = await fs.stat(fullPath);
      const hash = await fileSha256(fullPath);
      entries.push({ path: relativePath.replace(/\\/g, "/"), bytes: stat.size, sha256: hash });
    }
  } catch {
    // Skip unreadable dirs
  }
}

async function fileSha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function listBackups(root) {
  const paths = hubPaths(root);
  if (!(await exists(paths.backups))) return { backups: [], count: 0 };

  const dirs = await listDirs(paths.backups);
  const backups = [];

  for (const dir of dirs) {
    if (!dir.startsWith("backup-")) continue;
    const backupPath = path.join(paths.backups, dir);
    const manifestPath = path.join(backupPath, "manifest.json");

    let info = { id: dir, path: backupPath, createdAt: null, files: 0, totalBytes: 0 };
    if (await exists(manifestPath)) {
      try {
        const manifest = JSON.parse(await readText(manifestPath));
        info.createdAt = manifest.createdAt;
        info.files = manifest.files;
        info.totalBytes = manifest.totalBytes;
      } catch {
        // Corrupt manifest, use defaults
      }
    }
    backups.push(info);
  }

  backups.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return { backups, count: backups.length };
}
