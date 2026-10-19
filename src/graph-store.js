/**
 * Plain-JS source of truth for the knowledge graph's logical data
 * (separate from the ECS entities that render it).
 */
let nextId = 1;
// id -> { id, topic, summary, status, reliability, riskNote, importance, worldPos }
export const nodes = new Map();
export const edges = new Map(); // id -> { id, fromId, toId, status, confidence }
const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  save();
  for (const fn of listeners) fn();
}

// --- Persistence ("Reason to Come Back"): the graph survives reloads
// and grows session over session. localStorage is enough for a
// single-headset MVP; storage can be unavailable, so never throw.
const STORAGE_KEY = 'fogweave.graph.v1';

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ nextId, nodes: [...nodes.values()], edges: [...edges.values()] }),
    );
  } catch {
    // storage blocked/full — the session still works, it just won't persist
  }
}

/** Restores the saved graph into the store. Returns true if anything was loaded. */
export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    nodes.clear();
    edges.clear();
    for (const n of data.nodes || []) {
      // a node saved mid-research never got its answer; treat it as done
      if (n.status === 'researching') n.status = n.topic ? 'confirmed' : 'draft';
      nodes.set(n.id, n);
    }
    for (const e of data.edges || []) edges.set(e.id, e);
    nextId = Math.max(nextId, data.nextId || 1);
    return nodes.size > 0;
  } catch {
    return false;
  }
}

/** Wipes the saved graph (handy while testing). */
export function clearAll() {
  nodes.clear();
  edges.clear();
  emit();
}

export function createNode(topic = '', worldPos = null) {
  const id = 'n' + nextId++;
  nodes.set(id, {
    id,
    topic,
    summary: '',
    status: 'draft',
    // Unknown until the AI has judged it — treat as neutral, not trusted,
    // so an unresolved node never silently reads as "safe".
    reliability: 0.5,
    riskNote: '',
    importance: 0,
    worldPos,
  });
  emit();
  return id;
}

export function updateNode(id, patch) {
  const n = nodes.get(id);
  if (!n) return;
  Object.assign(n, patch);
  emit();
}

export function createEdge(fromId, toId, status = 'suggested', confidence = 0.5) {
  if (fromId === toId) return null;
  for (const e of edges.values()) {
    if (
      (e.fromId === fromId && e.toId === toId) ||
      (e.fromId === toId && e.toId === fromId)
    ) {
      return e.id;
    }
  }
  const id = 'e' + nextId++;
  edges.set(id, { id, fromId, toId, status, confidence });
  emit();
  return id;
}

export function confirmEdge(id) {
  const e = edges.get(id);
  if (!e) return;
  e.status = 'confirmed';
  emit();
}

export function rejectEdge(id) {
  edges.delete(id);
  emit();
}

export function neighborsOf(nodeId, { confirmedOnly = true } = {}) {
  const out = [];
  for (const e of edges.values()) {
    if (confirmedOnly && e.status !== 'confirmed') continue;
    if (e.fromId === nodeId) out.push({ nodeId: e.toId, edgeId: e.id });
    if (e.toId === nodeId) out.push({ nodeId: e.fromId, edgeId: e.id });
  }
  return out;
}

export function findNodeByTopic(spokenText) {
  const needle = spokenText.toLowerCase().trim();
  let best = null;
  let bestScore = 0;
  for (const n of nodes.values()) {
    const topic = n.topic.toLowerCase();
    if (!topic) continue;
    let score = 0;
    if (topic === needle) score = 1;
    else if (topic.includes(needle) || needle.includes(topic)) score = 0.7;
    else if (needle.split(' ').some((w) => w.length > 2 && topic.includes(w)))
      score = 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return bestScore > 0 ? best : null;
}

export function nearestNodeToPosition(pos, maxDistance = 0.35) {
  let best = null;
  let bestDist = maxDistance;
  for (const n of nodes.values()) {
    if (!n.worldPos) continue;
    const dx = n.worldPos.x - pos.x;
    const dy = n.worldPos.y - pos.y;
    const dz = n.worldPos.z - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/**
 * Degree centrality, normalized against the busiest node in the graph
 * so "importance" always reads 0..1 regardless of how big the graph
 * has grown. Call after any edge is confirmed/removed.
 */
export function recomputeImportance() {
  let maxDegree = 0;
  const degrees = new Map();
  for (const n of nodes.values()) {
    const d = neighborsOf(n.id).length;
    degrees.set(n.id, d);
    if (d > maxDegree) maxDegree = d;
  }
  for (const n of nodes.values()) {
    n.importance = maxDegree > 0 ? degrees.get(n.id) / maxDegree : 0;
  }
  emit();
}
