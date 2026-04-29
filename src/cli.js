#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_MIN = 20;
const v = process.versions.node.split(".").map(Number);
if (v[0] < NODE_MIN) {
  console.error(`ai-context requires Node.js >= ${NODE_MIN} (current: ${process.versions.node})`);
  process.exit(1);
}

import { initHub, loadRegistry, remember, writeRegistry } from "./core/store.js";
import { hasFlag, positionalArgs, resolveHubRoot, valueAfter } from "./core/paths.js";
import { scanTools } from "./core/scan.js";
import { syncInbox } from "./core/sync.js";
import { linkTools } from "./adapters/index.js";
import { importExisting } from "./core/import.js";
import { initProject } from "./core/project.js";
import { writeMcpConfigs } from "./core/mcp.js";
import { inspect } from "./core/doctor.js";
import { searchMemory } from "./core/search.js";
import { adoptSkills } from "./core/adopt.js";
import { restoreHub, snapshotHistory, snapshotHub } from "./core/snapshot.js";
import { listSkills, validateSkills, writeSkillIndex } from "./core/skills.js";
import { buildContext } from "./core/context.js";
import { runWatch } from "./core/watch.js";
import { writeScheduleFiles } from "./core/schedule.js";
import { enableTools } from "./core/enable.js";
import { createLogger } from "./utils/logger.js";
import { expireObservations } from "./core/lifecycle.js";
import { addRelation, getRelations, listEntities, removeRelation } from "./core/relations.js";
import { createBackup, listBackups } from "./core/backup.js";

const args = process.argv.slice(2);
const command = args[0] || "help";
if (command === "--version" || command === "-v" || command === "version") {
  console.log(version());
  process.exit(0);
}
const root = resolveHubRoot(args);

try {
  if (command === "init") {
    const paths = await initHub(root);
    console.log(`Initialized AI context hub: ${paths.root}`);
  } else if (command === "scan") {
    const found = await scanTools(process.cwd());
    const registry = await loadRegistry(root);
    registry.tools = found;
    registry.updatedAt = new Date().toISOString();
    await writeRegistry(root, registry);
    printJson(found);
  } else if (command === "link") {
    await initHub(root);
    const tools = positionalArgs(args.slice(1));
    const selected = tools.length > 0 ? tools : ["all"];
    const apply = hasFlag(args, "--apply");
    const results = await linkTools(root, selected, process.cwd(), { dryRun: !apply });
    printJson(results);
  } else if (command === "adopt") {
    await initHub(root);
    const tools = positionalArgs(args.slice(1), ["--root", "--skill"]);
    const selected = tools.length > 0 ? tools : ["all"];
    const apply = hasFlag(args, "--apply");
    const skill = valueAfter(args, "--skill");
    const results = await adoptSkills(root, selected, process.cwd(), { dryRun: !apply, skill });
    printJson(results);
  } else if (command === "import") {
    await initHub(root);
    const results = await importExisting(root, process.cwd());
    printJson(results);
  } else if (command === "enable") {
    await initHub(root);
    const tools = positionalArgs(args.slice(1), ["--root"]);
    const apply = hasFlag(args, "--apply");
    const noSnapshot = hasFlag(args, "--no-snapshot");
    const result = await enableTools(root, tools, process.cwd(), { dryRun: !apply, noSnapshot });
    printJson(result);
  } else if (command === "project") {
    await initHub(root);
    const subcommand = args[1] || "init";
    if (subcommand !== "init") throw new Error(`unknown project subcommand: ${subcommand}`);
    const projectId = valueAfter(args, "--id");
    const apply = hasFlag(args, "--apply");
    const result = await initProject(root, process.cwd(), { projectId, dryRun: !apply });
    printJson(result);
  } else if (command === "mcp") {
    await initHub(root);
    const result = await writeMcpConfigs(root);
    printJson(result);
  } else if (command === "skills") {
    await initHub(root);
    const subcommand = args[1] || "list";
    if (subcommand === "list") {
      printJson(await listSkills(root));
    } else if (subcommand === "validate") {
      printJson(await validateSkills(root));
    } else if (subcommand === "index") {
      printJson(await writeSkillIndex(root));
    } else {
      throw new Error(`unknown skills subcommand: ${subcommand}`);
    }
  } else if (command === "remember") {
    await initHub(root);
    const text = positionalArgs(args.slice(1), ["--root", "--tool", "--entity", "--entity-type", "--confidence", "--ttl", "--source"]).join(" ").trim();
    if (!text) throw new Error("remember requires text");
    const tool = valueAfter(args, "--tool") || "manual";
    const entity = valueAfter(args, "--entity") || "user";
    const entityType = valueAfter(args, "--entity-type") || (entity === "user" ? "person" : "thing");
    const confidence = valueAfter(args, "--confidence");
    const ttl = valueAfter(args, "--ttl");
    const source = valueAfter(args, "--source");
    const options = { entity, entityType };
    if (confidence !== undefined) {
      const c = Number(confidence);
      if (isNaN(c) || c < 0 || c > 1) throw new Error("--confidence must be a number between 0.0 and 1.0");
      options.confidence = c;
    }
    if (ttl !== undefined) {
      const t = Number(ttl);
      if (isNaN(t) || t < 0 || !Number.isInteger(t)) throw new Error("--ttl must be a non-negative integer (seconds)");
      options.ttl = t;
    }
    if (source !== undefined) options.source = source;
    const file = await remember(root, tool, text, options);
    console.log(`Wrote inbox memory: ${file}`);
  } else if (command === "sync") {
    await initHub(root);
    const result = await syncInbox(root);
    const snapshot = hasFlag(args, "--snapshot") ? await snapshotHub(root, valueAfter(args, "--message")) : null;
    printJson({ ...result, snapshot });
  } else if (command === "search") {
    await initHub(root);
    const query = positionalArgs(args.slice(1), ["--root", "--limit", "--semantic", "--rebuild"]).join(" ").trim();
    if (!query) throw new Error("search requires a query");
    const limit = Number(valueAfter(args, "--limit") || 20);
    const semantic = hasFlag(args, "--semantic");
    const rebuild = hasFlag(args, "--rebuild");
    const result = await searchMemory(root, query, { limit, semantic, rebuild });
    printJson(result);
  } else if (command === "context") {
    await initHub(root);
    const projectId = valueAfter(args, "--project");
    const query = valueAfter(args, "--query");
    const tool = valueAfter(args, "--tool") || "manual";
    const limit = Number(valueAfter(args, "--limit") || 8);
    process.stdout.write(await buildContext(root, { projectId, query, tool, limit }));
  } else if (command === "watch") {
    await initHub(root);
    const once = hasFlag(args, "--once");
    const snapshot = hasFlag(args, "--snapshot");
    const intervalSeconds = Number(valueAfter(args, "--interval") || 30);
    const result = await runWatch(root, {
      once,
      snapshot,
      intervalMs: intervalSeconds * 1000,
      onResult: (cycle) => console.log(JSON.stringify(cycle, null, 2))
    });
    if (once) {
      process.exitCode = result.skillValidation.status === "error" ? 2 : 0;
    }
  } else if (command === "schedule") {
    await initHub(root);
    const intervalMinutes = Number(valueAfter(args, "--minutes") || 5);
    const taskName = valueAfter(args, "--name") || "AI Context Hub Watch";
    const result = await writeScheduleFiles(root, { intervalMinutes, taskName });
    printJson(result);
  } else if (command === "snapshot") {
    await initHub(root);
    const message = positionalArgs(args.slice(1), ["--root"]).join(" ").trim() || valueAfter(args, "--message");
    const result = await snapshotHub(root, message);
    printJson(result);
  } else if (command === "history") {
    await initHub(root);
    const limit = Number(valueAfter(args, "--limit") || 20);
    const result = await snapshotHistory(root, limit);
    printJson(result);
  } else if (command === "restore") {
    const commit = valueAfter(args, "--to");
    const apply = hasFlag(args, "--apply");
    const force = hasFlag(args, "--force");
    const result = await restoreHub(root, commit, { apply, force });
    printJson(result);
  } else if (command === "expire") {
    await initHub(root);
    const result = await expireObservations(root);
    printJson(result);
  } else if (command === "relate") {
    await initHub(root);
    const from = valueAfter(args, "--from");
    const to = valueAfter(args, "--to");
    const kind = valueAfter(args, "--kind");
    if (!from || !to || !kind) throw new Error("relate requires --from, --to, and --kind");
    const apply = hasFlag(args, "--apply");
    if (!apply) {
      printJson({ mode: "dry-run", from, to, kind, note: "Use --apply to write the relation." });
    } else {
      const result = await addRelation(root, from, to, kind);
      printJson(result);
    }
  } else if (command === "relations") {
    await initHub(root);
    const entity = positionalArgs(args.slice(1), ["--root"]).join(" ").trim() || valueAfter(args, "--entity") || "user";
    const result = await getRelations(root, entity);
    printJson(result);
  } else if (command === "list") {
    await initHub(root);
    const result = await listEntities(root);
    printJson(result);
  } else if (command === "remove-relation") {
    await initHub(root);
    const relationId = valueAfter(args, "--id");
    if (!relationId) throw new Error("remove-relation requires --id <relation-id>");
    const apply = hasFlag(args, "--apply");
    if (!apply) {
      printJson({ mode: "dry-run", relationId, note: "Use --apply to remove the relation." });
    } else {
      const result = await removeRelation(root, relationId);
      printJson(result);
    }
  } else if (command === "backup") {
    await initHub(root);
    const subcommand = args[1] || "create";
    if (subcommand === "list") {
      printJson(await listBackups(root));
    } else if (subcommand === "create") {
      const apply = hasFlag(args, "--apply");
      const result = await createBackup(root, { dryRun: !apply });
      printJson(result);
    } else {
      throw new Error(`unknown backup subcommand: ${subcommand}`);
    }
  } else if (command === "doctor") {
    await initHub(root);
    const report = await inspect(root, process.cwd());
    const syncHint = hasFlag(args, "--no-sync") ? null : await syncInbox(root);
    printJson({ ...report, sync: syncHint });
  } else {
    printHelp();
  }
} catch (error) {
  const log = createLogger(root, "cli");
  log.error("command.failed", { command, error: error.message, stack: error.stack });
  console.error(`ai-context: ${error.message}`);
  process.exitCode = 1;
}

function version() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`ai-context-hub

Usage:
  ai-context --version | -v | version
  ai-context init [--root <path>]
  ai-context scan [--root <path>]
  ai-context import [--root <path>]
  ai-context enable [claude|codex|gemini|agents|all...] [--dry-run] [--apply] [--no-snapshot] [--root <path>]
  ai-context project init [--id <project-id>] [--dry-run] [--apply] [--root <path>]
  ai-context mcp [--root <path>]
  ai-context skills [list|validate|index] [--root <path>]
  ai-context link [all|claude|codex|gemini|cursor|windsurf|agents] [--dry-run] [--apply] [--root <path>]
  ai-context adopt [all|claude|codex|agents] [--skill <name>] [--dry-run] [--apply] [--root <path>]
  ai-context remember "fact" [--tool codex] [--entity user] [--entity-type person] [--confidence 1.0] [--ttl 3600] [--source label] [--root <path>]
  ai-context sync [--snapshot] [--message <message>] [--root <path>]
  ai-context search "query" [--limit 20] [--semantic] [--rebuild] [--root <path>]
  ai-context expire [--root <path>]
  ai-context relate --from <entity> --to <entity> --kind <kind> [--dry-run] [--apply] [--root <path>]
  ai-context relations [entity] [--root <path>]
  ai-context list [--root <path>]
  ai-context remove-relation --id <relation-id> [--dry-run] [--apply] [--root <path>]
  ai-context backup [create] [--dry-run] [--apply] [--root <path>]
  ai-context backup list [--root <path>]
  ai-context context [--project <id>] [--query <text>] [--tool <name>] [--limit 8] [--root <path>]
  ai-context watch [--once] [--interval 30] [--snapshot] [--root <path>]
  ai-context schedule [--minutes 5] [--name <task-name>] [--root <path>]
  ai-context snapshot [message] [--root <path>]
  ai-context history [--limit 20] [--root <path>]
  ai-context restore --to <commit> [--dry-run] [--apply] [--force] [--root <path>]
  ai-context doctor [--root <path>] [--no-sync]

Default root:
  ~/.ai-context  (override with --root <path> or AI_CONTEXT_ROOT env var)
`);
}
