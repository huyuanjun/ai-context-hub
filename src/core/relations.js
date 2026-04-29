import crypto from "node:crypto";
import { exists, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";
import { normalizeObservations } from "./lifecycle.js";

const VALID_KINDS = new Set([
  "related_to", "contradicts", "depends_on",
  "supersedes", "has_skill", "works_on"
]);

export function isValidRelationKind(kind) {
  return VALID_KINDS.has(kind);
}

// Load entities and relations from the graph file
export async function loadGraphFull(graphFile) {
  const entities = new Map();
  const relations = [];
  const aliases = new Map(); // alias → canonical name
  if (!(await exists(graphFile))) return { entities, relations, aliases };

  const text = await readText(graphFile);
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let item = null;
    try { item = JSON.parse(line); } catch { continue; }

    if (item.type === "entity" && item.name) {
      const existing = entities.get(item.name) || {
        type: "entity", name: item.name,
        entityType: item.entityType || "thing", observations: [], aliases: item.aliases || []
      };
      const existingObs = normalizeObservations(existing.observations);
      const newObs = normalizeObservations(item.observations || []);
      const mergedIds = new Set(existingObs.map((o) => o.id));
      for (const obs of newObs) {
        if (!mergedIds.has(obs.id)) existingObs.push(obs);
      }
      existing.observations = existingObs;
      if (item.aliases) {
        existing.aliases = [...new Set([...(existing.aliases || []), ...item.aliases])];
        for (const alias of item.aliases) aliases.set(alias, item.name);
      }
      entities.set(item.name, existing);
    } else if (item.type === "relation") {
      relations.push(item);
    }
  }
  return { entities, relations, aliases };
}

function resolveName(entities, aliases, name) {
  if (entities.has(name)) return name;
  return aliases.get(name) || name;
}

// Add a relation between two entities
export async function addRelation(root, fromEntity, toEntity, kind, options = {}) {
  if (!isValidRelationKind(kind)) {
    return { status: "invalid-kind", reason: `Unknown relation kind: ${kind}. Valid: ${[...VALID_KINDS].join(", ")}` };
  }

  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  const { entities, relations, aliases } = await loadGraphFull(graphFile);

  const resolvedFrom = resolveName(entities, aliases, fromEntity);
  const resolvedTo = resolveName(entities, aliases, toEntity);
  if (!entities.has(resolvedFrom)) return { status: "unknown-entity", reason: `Entity not found: ${fromEntity}` };
  if (!entities.has(resolvedTo)) return { status: "unknown-entity", reason: `Entity not found: ${toEntity}` };

  const relationId = crypto.createHash("sha256")
    .update(`${resolvedFrom}:${resolvedTo}:${kind}`).digest("hex").slice(0, 16);

  // Check for existing relation of the same kind
  const exists = relations.some((r) => r.from === resolvedFrom && r.to === resolvedTo && r.kind === kind);
  if (exists) {
    return { status: "exists", relationId };
  }

  const relation = {
    id: relationId,
    type: "relation",
    from: resolvedFrom,
    to: resolvedTo,
    kind,
    confidence: typeof options.confidence === "number" ? options.confidence : 1.0,
    source: options.source || "manual",
    createdAt: new Date().toISOString()
  };

  const text = await readText(graphFile);
  await writeTextAtomic(graphFile, text + JSON.stringify(relation) + "\n");

  return { status: "added", relation };
}

// Get all relations for an entity
export async function getRelations(root, entityName) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  const { relations } = await loadGraphFull(graphFile);

  return {
    entity: entityName,
    outbound: relations.filter((r) => r.from === entityName),
    inbound: relations.filter((r) => r.to === entityName)
  };
}

// Remove a relation by id
export async function removeRelation(root, relationId) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  if (!(await exists(graphFile))) return { removed: false, reason: "no graph file" };

  const text = await readText(graphFile);
  const lines = text.split(/\r?\n/).filter(Boolean);
  let removed = false;

  const kept = lines.filter((line) => {
    let item;
    try { item = JSON.parse(line); } catch { return true; }
    if (item.type === "relation" && item.id === relationId) {
      removed = true;
      return false;
    }
    return true;
  });

  if (removed) {
    await writeTextAtomic(graphFile, `${kept.join("\n")}\n`);
  }
  return { removed };
}

// List all entities with minimal info (no observations)
export async function listEntities(root) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  if (!(await exists(graphFile))) return { entities: [], count: 0 };

  const text = await readText(graphFile);
  const entities = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item.type === "entity" && item.name) {
      entities.push({
        name: item.name,
        entityType: item.entityType || "thing",
        observationCount: (item.observations || []).length
      });
    }
  }
  return { entities, count: entities.length };
}

// Find contradictions between observations
export async function findContradictions(root) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  if (!(await exists(graphFile))) return { contradictions: [], count: 0 };

  const text = await readText(graphFile);
  const contradictions = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item.type === "relation" && item.kind === "contradicts") {
      contradictions.push(item);
    }
  }
  return { contradictions, count: contradictions.length };
}
