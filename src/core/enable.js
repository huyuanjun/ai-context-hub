import { linkTools } from "../adapters/index.js";
import { adoptSkills } from "./adopt.js";
import { writeMcpConfigs } from "./mcp.js";
import { snapshotHub } from "./snapshot.js";
import { validateSkills, writeSkillIndex } from "./skills.js";

export async function enableTools(root, tools, cwd = process.cwd(), options = {}) {
  const selected = tools.length > 0 ? tools : ["claude", "codex", "gemini", "agents"];
  const dryRun = options.dryRun !== false;
  const result = {
    mode: dryRun ? "dry-run" : "apply",
    tools: selected,
    steps: []
  };

  const skillValidation = await validateSkills(root);
  result.steps.push({
    name: "skills.validate",
    result: skillValidation
  });

  if (!dryRun && skillValidation.status === "error") {
    result.mode = "blocked";
    result.reason = "skills validation failed";
    return result;
  }

  result.steps.push({
    name: "skills.index",
    result: dryRun ? { status: "would-refresh" } : await writeSkillIndex(root)
  });

  result.steps.push({
    name: "mcp.export",
    result: dryRun ? { status: "would-write-mcp-config-snippets" } : await writeMcpConfigs(root)
  });

  result.steps.push({
    name: "snapshot.pre-enable",
    result: dryRun || options.noSnapshot ? { status: dryRun ? "would-snapshot" : "skipped" } : await snapshotHub(root, "pre-enable shared AI context")
  });

  result.steps.push({
    name: "adopt.skills",
    result: await adoptSkills(root, selected, cwd, { dryRun })
  });

  result.steps.push({
    name: "link.tools",
    result: await linkTools(root, selected, cwd, { dryRun })
  });

  result.steps.push({
    name: "snapshot.post-enable",
    result: dryRun || options.noSnapshot ? { status: dryRun ? "would-snapshot" : "skipped" } : await snapshotHub(root, "post-enable shared AI context")
  });

  return result;
}
