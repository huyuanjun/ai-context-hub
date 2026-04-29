import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appendText, ensureDir, exists, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

// Normalize legacy string observations to the new object format
export function normalizeObservations(rawObservations) {
  if (!Array.isArray(rawObservations)) return [];
  return rawObservations.map((obs) => {
    if (typeof obs === "string") {
      return {
        id: crypto.createHash("sha256").update(obs).digest("hex").slice(0, 12),
        text: obs,
        confidence: 0.5,
        source: "imported",
        createdAt: null,
        ttl: null
      };
    }
    return {
      id: obs.id || crypto.createHash("sha256").update(obs.text || "").digest("hex").slice(0, 12),
      text: obs.text || "",
      confidence: typeof obs.confidence === "number" ? obs.confidence : 0.5,
      source: obs.source || "unknown",
      createdAt: obs.createdAt || null,
      ttl: obs.ttl !== undefined ? obs.ttl : null
    };
  });
}

// Filter out expired observations, returns { kept, archived }
export function filterExpired(observations, now = new Date()) {
  const kept = [];
  const archived = [];
  for (const obs of observations) {
    if (obs.ttl && obs.createdAt) {
      const created = new Date(obs.createdAt);
      const expiresAt = new Date(created.getTime() + obs.ttl * 1000);
      if (now >= expiresAt) {
        archived.push({ ...obs, expiredAt: now.toISOString() });
        continue;
      }
    }
    kept.push(obs);
  }
  return { kept, archived };
}

// Evaluate and archive expired observations across the entire graph
export async function expireObservations(root, now = new Date()) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  if (!(await exists(graphFile))) return { archived: 0, remaining: 0 };

  const text = await readText(graphFile);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const updatedLines = [];
  let totalArchived = 0;
  let totalRemaining = 0;

  for (const line of lines) {
    let entity;
    try { entity = JSON.parse(line); } catch { updatedLines.push(line); continue; }
    if (entity.type !== "entity") { updatedLines.push(line); continue; }

    const observations = normalizeObservations(entity.observations || []);
    const { kept, archived } = filterExpired(observations, now);
    totalArchived += archived.length;
    totalRemaining += kept.length;

    if (archived.length > 0) {
      await appendExpiredArchive(paths, entity.name, archived);
    }

    entity.observations = kept;
    updatedLines.push(JSON.stringify(entity));
  }

  if (totalArchived > 0) {
    await writeTextAtomic(graphFile, `${updatedLines.join("\n")}\n`);
  }

  return { archived: totalArchived, remaining: totalRemaining };
}

async function appendExpiredArchive(paths, entityName, archived) {
  const archiveDir = path.join(paths.memory.archive, new Date().toISOString().slice(0, 10));
  await ensureDir(archiveDir);
  const filePath = path.join(archiveDir, `expired.jsonl`);
  for (const obs of archived) {
    await appendText(filePath, JSON.stringify({ entity: entityName, ...obs }) + "\n");
  }
}

// Set TTL for a specific observation by id
export async function setTtl(root, observationId, ttlSeconds) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  if (!(await exists(graphFile))) return { updated: false, reason: "no graph file" };

  const text = await readText(graphFile);
  const lines = text.split(/\r?\n/).filter(Boolean);
  let updated = false;

  const updatedLines = lines.map((line) => {
    let entity;
    try { entity = JSON.parse(line); } catch { return line; }
    if (entity.type !== "entity") return line;

    const observations = normalizeObservations(entity.observations || []);
    let modified = false;
    const newObs = observations.map((obs) => {
      if (obs.id === observationId) {
        modified = true;
        return { ...obs, ttl: ttlSeconds };
      }
      return obs;
    });
    if (modified) {
      updated = true;
      entity.observations = newObs;
    }
    return JSON.stringify(entity);
  });

  if (updated) {
    await writeTextAtomic(graphFile, `${updatedLines.join("\n")}\n`);
  }
  return { updated };
}

// Set confidence for a specific observation by id
export async function setConfidence(root, observationId, confidence) {
  const paths = hubPaths(root);
  const graphFile = paths.memory.graphFile;
  if (!(await exists(graphFile))) return { updated: false, reason: "no graph file" };

  const text = await readText(graphFile);
  const lines = text.split(/\r?\n/).filter(Boolean);
  let updated = false;

  const updatedLines = lines.map((line) => {
    let entity;
    try { entity = JSON.parse(line); } catch { return line; }
    if (entity.type !== "entity") return line;

    const observations = normalizeObservations(entity.observations || []);
    let modified = false;
    const newObs = observations.map((obs) => {
      if (obs.id === observationId) {
        modified = true;
        return { ...obs, confidence: Math.max(0, Math.min(1, Number(confidence))) };
      }
      return obs;
    });
    if (modified) {
      updated = true;
      entity.observations = newObs;
    }
    return JSON.stringify(entity);
  });

  if (updated) {
    await writeTextAtomic(graphFile, `${updatedLines.join("\n")}\n`);
  }
  return { updated };
}
