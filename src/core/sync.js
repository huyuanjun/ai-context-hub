import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appendText, ensureDir, exists, listFilesRecursive, readText, writeTextAtomic } from "../utils/fsx.js";
import { createLogger } from "../utils/logger.js";
import { expireObservations, normalizeObservations } from "./lifecycle.js";
import { hubPaths } from "./paths.js";
import { withLock } from "./store.js";

export async function syncInbox(root) {
  const log = createLogger(root, "sync");
  return withLock(root, async () => {
    const paths = hubPaths(root);
    const files = await listFilesRecursive(paths.memory.inbox, { maxDepth: 5 });
    log.info("sync.start", { inboxFiles: files.length });

    const expired = await expireObservations(root);
    if (expired.archived > 0) {
      log.info("sync.expired", expired);
    }

    const records = [];

    for (const file of files) {
      if (!/\.(jsonl|json|md|txt)$/i.test(file)) continue;
      records.push(...(await parseInboxFile(file)));
    }

    const seen = await loadSeenHashes(paths);
    const added = [];
    for (const record of records) {
      const normalized = normalizeObservation(record.text || record.observation || record.content || "");
      if (!normalized) continue;
      const hash = sha256(`${record.entity || "user"}:${normalized}`);
      if (seen.has(hash)) continue;
      seen.add(hash);
      added.push({ ...record, text: normalized, hash });
    }

    if (added.length > 0) {
      await appendCanonical(paths, added);
      await writeGraph(paths, added);
      await writeSeenHashes(paths, seen);
    }
    if (files.length > 0) {
      await archiveInbox(paths, files);
    }

    const result = { scannedFiles: files.length, added: added.length };
    log.info("sync.done", result);
    return result;
  });
}

async function parseInboxFile(filePath) {
  const text = await readText(filePath);
  if (/\.jsonl$/i.test(filePath)) {
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { text: line };
        }
      });
  }
  if (/\.json$/i.test(filePath)) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [{ text }];
    }
  }
  return [{ text, tool: path.basename(path.dirname(filePath)) }];
}

async function appendCanonical(paths, records) {
  const grouped = new Map();
  for (const record of records) {
    const entity = record.entity || "user";
    if (!grouped.has(entity)) grouped.set(entity, []);
    grouped.get(entity).push(record);
  }

  for (const [entity, items] of grouped) {
    const filePath = entity === "user" ? paths.memory.preferences : path.join(paths.memory.canonical, `${safeName(entity)}.md`);
    const lines = items.map((item) => `- ${item.text} _(source: ${item.tool || "unknown"}, ${item.createdAt || new Date().toISOString()})_`);
    await appendText(filePath, `\n${lines.join("\n")}\n`);
  }
}

async function writeGraph(paths, records) {
  await ensureDir(paths.memory.graph);
  const graph = await loadGraph(paths.memory.graphFile);
  for (const record of records) {
    const name = record.entity || "user";
    const existing = graph.entities.get(name) || {
      type: "entity",
      name,
      entityType: record.entityType || (name === "user" ? "person" : "thing"),
      observations: []
    };
    const existingObs = normalizeObservations(existing.observations);
    const newObs = {
      id: record.id || crypto.createHash("sha256").update(record.text).digest("hex").slice(0, 12),
      text: record.text,
      confidence: typeof record.confidence === "number" ? record.confidence : 1.0,
      source: record.source || record.tool || "unknown",
      createdAt: record.createdAt || new Date().toISOString(),
      ttl: record.ttl !== undefined ? record.ttl : null
    };
    const isDuplicate = existingObs.some((o) => o.text === newObs.text);
    if (!isDuplicate) {
      existingObs.push(newObs);
    }
    existing.observations = existingObs;
    graph.entities.set(name, existing);
  }
  const lines = [...graph.entities.values()].map((entity) => JSON.stringify(entity));
  if (graph.relations && graph.relations.length > 0) {
    lines.push(...graph.relations.map((r) => JSON.stringify(r)));
  }
  await writeTextAtomic(paths.memory.graphFile, `${lines.join("\n")}\n`);
}

async function loadGraph(graphFile) {
  const entities = new Map();
  const relations = [];
  if (!(await exists(graphFile))) return { entities, relations };
  const text = await readText(graphFile);
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let item = null;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (item?.type === "relation") {
      relations.push(item);
      continue;
    }
    if (item?.type !== "entity" || !item.name) continue;
    const existing = entities.get(item.name) || {
      type: "entity",
      name: item.name,
      entityType: item.entityType || "thing",
      observations: []
    };
    const existingObs = normalizeObservations(existing.observations);
    const newObs = normalizeObservations(item.observations || []);
    const mergedIds = new Set(existingObs.map((o) => o.id));
    for (const obs of newObs) {
      if (!mergedIds.has(obs.id)) {
        existingObs.push(obs);
      }
    }
    existing.observations = existingObs;
    entities.set(item.name, existing);
  }
  return { entities, relations };
}

async function archiveInbox(paths, files) {
  const archiveDir = path.join(paths.memory.archive, new Date().toISOString().slice(0, 10));
  await ensureDir(archiveDir);
  for (const file of files) {
    if (!(await exists(file))) continue;
    const relative = path.relative(paths.memory.inbox, file).replace(/[\\/]/g, "__");
    await fs.rename(file, path.join(archiveDir, relative));
  }
}

async function loadSeenHashes(paths) {
  const seenPath = path.join(paths.memory.root, ".seen-hashes");
  if (!(await exists(seenPath))) return new Set();
  return new Set((await readText(seenPath)).split(/\r?\n/).filter(Boolean));
}

async function writeSeenHashes(paths, seen) {
  await writeTextAtomic(path.join(paths.memory.root, ".seen-hashes"), `${[...seen].sort().join("\n")}\n`);
}

function normalizeObservation(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
}
