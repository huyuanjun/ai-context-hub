import path from "node:path";
import { ensureDir, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

export async function writeMcpConfigs(root) {
  const paths = hubPaths(root);
  const outDir = path.join(paths.exports, "mcp");
  await ensureDir(outDir);

  const memoryFile = paths.memory.graphFile;
  const claudeDesktop = {
    mcpServers: {
      memory: windowsNpxServer(memoryFile)
    }
  };
  const vscode = {
    servers: {
      memory: windowsNpxServer(memoryFile)
    }
  };
  const generic = {
    memory: windowsNpxServer(memoryFile)
  };

  const files = [
    [path.join(outDir, "claude-desktop-memory.json"), claudeDesktop],
    [path.join(outDir, "vscode-mcp-memory.json"), vscode],
    [path.join(outDir, "generic-memory-server.json"), generic]
  ];

  for (const [filePath, value] of files) {
    await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  return {
    memoryFile,
    files: files.map(([filePath]) => filePath),
    note: "These are export snippets. Review and paste/merge them into each MCP client's config file."
  };
}

function windowsNpxServer(memoryFile) {
  if (process.platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"],
      env: {
        MEMORY_FILE_PATH: memoryFile
      }
    };
  }
  return {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: {
      MEMORY_FILE_PATH: memoryFile
    }
  };
}
