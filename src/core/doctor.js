import path from "node:path";
import { exists, listDirs } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";
import { listBackups } from "./backup.js";
import { scanTools } from "./scan.js";

export async function inspect(root, cwd = process.cwd()) {
  const paths = hubPaths(root);
  const skillDirs = await listDirs(paths.skills);
  const backupInfo = await listBackups(root);
  return {
    root,
    exists: await exists(root),
    config: await exists(paths.config),
    lock: await exists(paths.lock),
    memory: {
      canonical: await exists(paths.memory.canonical),
      inbox: await exists(paths.memory.inbox),
      graphFile: await exists(paths.memory.graphFile)
    },
    skills: {
      path: paths.skills,
      count: skillDirs.filter((name) => name !== "metadata").length,
      index: await exists(path.join(paths.skills, "INDEX.md"))
    },
    backups: {
      path: paths.backups,
      exists: await exists(paths.backups),
      count: backupInfo.count,
      latest: backupInfo.backups.length > 0 ? backupInfo.backups[0].id : null
    },
    mcpExports: {
      path: path.join(paths.exports, "mcp"),
      exists: await exists(path.join(paths.exports, "mcp"))
    },
    git: {
      path: path.join(root, ".git"),
      exists: await exists(path.join(root, ".git"))
    },
    tools: await scanTools(cwd)
  };
}
