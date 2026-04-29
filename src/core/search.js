import crypto from "node:crypto";
import path from "node:path";
import { exists, listFilesRecursive, readText, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

// --------------- TF-IDF + Cosine Similarity (zero-dependency) ---------------

function tokenize(text) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]} ${words[i + 1]}`);
  }
  return tokens;
}

function computeTf(terms) {
  const tf = new Map();
  for (const term of terms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }
  const maxFreq = Math.max(...tf.values(), 1);
  for (const [term, count] of tf) {
    tf.set(term, count / maxFreq);
  }
  return tf;
}

function computeIdf(documents) {
  const docFreq = new Map();
  const N = documents.length;
  for (const doc of documents) {
    const seen = new Set();
    for (const { term } of doc.terms) {
      if (!seen.has(term)) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
        seen.add(term);
      }
    }
  }
  const idf = new Map();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }
  return idf;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, weightA] of vecA) {
    normA += weightA * weightA;
    const weightB = vecB.get(term) || 0;
    dot += weightA * weightB;
  }
  for (const [, weightB] of vecB) {
    normB += weightB * weightB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --------------- Index building & caching ---------------

async function buildTfIdfIndex(root) {
  const paths = hubPaths(root);
  const documents = [];

  // Source 1: graph memory.jsonl entity observations
  if (await exists(paths.memory.graphFile)) {
    const graphText = await readText(paths.memory.graphFile);
    for (const line of graphText.split(/\r?\n/).filter(Boolean)) {
      let item;
      try { item = JSON.parse(line); } catch { continue; }
      if (item.type !== "entity" || !item.name) continue;
      const obsTexts = (item.observations || []).map((o) => (typeof o === "string" ? o : o.text || ""));
      for (const text of obsTexts) {
        if (text.trim()) {
          documents.push({
            source: "graph",
            entity: item.name,
            entityType: item.entityType || "thing",
            text
          });
        }
      }
    }
  }

  // Source 2: canonical markdown files
  const canonicalFiles = await listFilesRecursive(paths.memory.canonical, { maxDepth: 8 });
  for (const file of canonicalFiles) {
    if (!/\.md$/i.test(file)) continue;
    const text = await readText(file);
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith("- "));
    for (const line of lines) {
      const clean = line.replace(/^-\s+/, "").replace(/\(_source:.*?_\)/, "").trim();
      if (clean) {
        documents.push({ source: "canonical", file, text: clean });
      }
    }
  }

  // Tokenize and compute TF for each document
  const docs = documents.map((doc) => {
    const terms = tokenize(doc.text);
    const tf = computeTf(terms);
    return { ...doc, terms: [...tf.entries()].map(([term, weight]) => ({ term, weight })), _tf: tf };
  });

  // Compute IDF
  const idf = computeIdf(docs);

  // Build final TF-IDF vectors (sparse: Map<term, tfidf>)
  const docVectors = docs.map((doc) => {
    const vec = new Map();
    for (const [term, tf] of doc._tf) {
      vec.set(term, tf * (idf.get(term) || 0));
    }
    return { ...doc, vector: vec, _tf: undefined };
  });

  // Compute checksums for staleness detection — 2-part: graph + canonical
  const graphCheck = crypto.createHash("sha256")
    .update(JSON.stringify(
      docVectors.filter((d) => d.source === "graph").map((d) => d.text).sort()
    ))
    .digest("hex");
  const canonicalCheck = crypto.createHash("sha256")
    .update(JSON.stringify(
      docVectors.filter((d) => d.source === "canonical").map((d) => d.text).sort()
    ))
    .digest("hex");

  const index = {
    builtAt: new Date().toISOString(),
    docCount: docVectors.length,
    checksum: `${graphCheck}.${canonicalCheck}`,
    documents: docVectors.map(({ vector, ...rest }) => ({
      ...rest,
      _vectorEntries: [...vector.entries()]
    }))
  };

  const cachePath = path.join(root, "memory", "graph", ".search-index.json");
  await writeTextAtomic(cachePath, JSON.stringify(index));

  return index;
}

async function loadOrBuildIndex(root, force = false) {
  const cachePath = path.join(root, "memory", "graph", ".search-index.json");
  if (!force && await exists(cachePath)) {
    try {
      const cached = JSON.parse(await readText(cachePath));
      const paths = hubPaths(root);
      if (await exists(paths.memory.graphFile)) {
        const graphText = await readText(paths.memory.graphFile);
        const graphCheck = crypto.createHash("sha256")
          .update(JSON.stringify(
            graphText.split(/\r?\n/).filter(Boolean)
              .map((l) => { try { return JSON.parse(l); } catch { return null; } })
              .filter((i) => i && i.type === "entity")
              .flatMap((i) => (i.observations || []).map((o) => (typeof o === "string" ? o : o.text || "")))
              .sort()
          ))
          .digest("hex");

        const canonicalFiles = await listFilesRecursive(paths.memory.canonical, { maxDepth: 8 });
        const canonicalCheck = crypto.createHash("sha256")
          .update(JSON.stringify(
            canonicalFiles.filter((f) => /\.md$/i.test(f)).map((f) => f).sort()
          ))
          .digest("hex");

        if (cached.checksum === `${graphCheck}.${canonicalCheck}`) {
          return deserializeIndex(cached);
        }
      }
    } catch {
      // Cache corrupt, rebuild
    }
  }
  return deserializeIndex(await buildTfIdfIndex(root));
}

function deserializeIndex(cached) {
  return {
    ...cached,
    documents: cached.documents.map((d) => ({
      source: d.source,
      entity: d.entity,
      entityType: d.entityType,
      file: d.file,
      text: d.text,
      terms: d.terms,
      vector: new Map(d._vectorEntries)
    }))
  };
}

// --------------- Search ---------------

async function semanticSearch(root, query, limit, rebuild = false) {
  const index = await loadOrBuildIndex(root, rebuild);
  const queryTerms = tokenize(query);
  const queryTf = computeTf(queryTerms);

  // Compute term-level IDF from the indexed documents
  const df = new Map();
  for (const doc of index.documents) {
    const seen = new Set();
    for (const [term] of doc.vector) {
      if (!seen.has(term)) {
        df.set(term, (df.get(term) || 0) + 1);
        seen.add(term);
      }
    }
  }
  const N = index.documents.length;
  const idf = new Map();
  for (const [term, docCount] of df) {
    idf.set(term, Math.log((N + 1) / (docCount + 1)) + 1);
  }

  // Build query TF-IDF vector
  const queryVec = new Map();
  for (const [term, tf] of queryTf) {
    queryVec.set(term, tf * (idf.get(term) || 0));
  }

  const scored = index.documents.map((doc) => ({
    ...doc,
    vector: undefined,
    score: cosineSimilarity(queryVec, doc.vector)
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).filter((r) => r.score > 0);

  return {
    mode: "semantic",
    indexAge: index.builtAt,
    docCount: index.docCount,
    results: top.map((r) => ({
      source: r.source,
      entity: r.entity,
      entityType: r.entityType,
      file: r.file,
      text: r.text,
      score: Math.round(r.score * 10000) / 10000
    }))
  };
}

// --------------- Keyword search (preserved from original) ---------------

async function keywordSearch(root, query, limit) {
  const paths = hubPaths(root);
  const lowerQuery = query.toLowerCase();
  const results = [];

  const files = await listFilesRecursive(paths.memory.canonical, { maxDepth: 8 });
  for (const file of files) {
    if (!/\.(md|txt|jsonl)$/i.test(file)) continue;
    const text = await readText(file);
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.toLowerCase().includes(lowerQuery)) {
        results.push({
          source: "canonical",
          file,
          line: index + 1,
          text: line.trim()
        });
        if (results.length >= limit) return { mode: "keyword", results };
      }
    }
  }

  if (await exists(paths.memory.graphFile)) {
    const graphText = await readText(paths.memory.graphFile);
    for (const line of graphText.split(/\r?\n/).filter(Boolean)) {
      let item = null;
      try { item = JSON.parse(line); } catch { continue; }
      if (JSON.stringify(item).toLowerCase().includes(lowerQuery)) {
        results.push({
          source: "graph",
          file: paths.memory.graphFile,
          entity: item.name,
          text: summarizeGraphItem(item)
        });
        if (results.length >= limit) return { mode: "keyword", results };
      }
    }
  }

  return { mode: "keyword", results };
}

function summarizeGraphItem(item) {
  const observations = (item.observations || []);
  const texts = observations.slice(0, 3).map((obs) => (typeof obs === "string" ? obs : obs.text || ""));
  return `${item.name || "unknown"} (${item.entityType || "thing"}): ${texts.join("; ")}`;
}

// --------------- Public API ---------------

export async function searchMemory(root, query, options = {}) {
  const limit = options.limit || 20;
  const semantic = Boolean(options.semantic);
  const rebuild = Boolean(options.rebuild);

  if (semantic) {
    return semanticSearch(root, query, limit, rebuild);
  }
  return keywordSearch(root, query, limit);
}
