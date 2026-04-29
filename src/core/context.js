import path from "node:path";
import { exists } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";
import { getRelations } from "./relations.js";
import { searchMemory } from "./search.js";

export async function buildContext(root, options = {}) {
  const paths = hubPaths(root);
  const projectId = options.projectId || null;
  const limit = options.limit || 8;
  const lines = [
    "# AI Context",
    "",
    `Hub root: ${root}`,
    "",
    "## Start Here",
    "",
    await fileLine(paths.memory.global),
    await fileLine(paths.memory.preferences),
    await fileLine(paths.memory.tools),
    await fileLine(path.join(paths.skills, "INDEX.md")),
    "",
    "Read these entry files first. Open detailed memory or full skills only when relevant."
  ];

  if (projectId) {
    const projectRoot = path.join(paths.memory.projects, safeProjectId(projectId));
    lines.push(
      "",
      "## Project",
      "",
      `Project id: ${safeProjectId(projectId)}`,
      "",
      await fileLine(path.join(projectRoot, "index.md")),
      await fileLine(path.join(projectRoot, "current-state.md")),
      await fileLine(path.join(projectRoot, "decisions.md")),
      await fileLine(path.join(projectRoot, "pitfalls.md"))
    );

    const rels = await getRelations(root, safeProjectId(projectId));
    if (rels.outbound.length > 0 || rels.inbound.length > 0) {
      lines.push("", "## Related Entities", "");
      for (const rel of rels.outbound) {
        lines.push(`- ${rel.kind}: ${rel.to}`);
      }
      for (const rel of rels.inbound) {
        lines.push(`- (incoming) ${rel.kind} from ${rel.from}`);
      }
    }
  }

  if (options.query) {
    const searchResult = await searchMemory(root, options.query, { limit });
    const results = searchResult.results || [];
    lines.push("", "## Search Results", "", `Query: ${options.query}`, "");
    if (results.length === 0) {
      lines.push("No matching memory found.");
    } else {
      for (const result of results) {
        const location = result.line ? `${result.file}:${result.line}` : (result.file || result.source);
        const score = result.score !== undefined ? ` (score: ${result.score})` : "";
        lines.push(`- ${location}${score} - ${result.text}`);
      }
    }
  }

  lines.push(
    "",
    "## Durable Memory Writes",
    "",
    `Write new durable facts to: ${path.join(paths.memory.inbox, options.tool || "manual")}`,
    "",
    "Use short, atomic facts. Do not rewrite canonical memory directly."
  );

  return `${lines.join("\n")}\n`;
}

async function fileLine(filePath) {
  return `- ${filePath}${await exists(filePath) ? "" : " (missing)"}`;
}

function safeProjectId(name) {
  return String(name || "project").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
}
