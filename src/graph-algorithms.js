/**
 * Small, dependency-free graph algorithms run entirely client-side.
 * The AI is only used to (a) summarize a new node and suggest links,
 * and (b) match spoken node names to existing topics — never to
 * "do the math" of the query itself, so results stay deterministic
 * and free to compute.
 */
import { nodes, edges, neighborsOf } from './graph-store.js';

// BFS shortest path over confirmed edges only.
// Returns { path: [nodeId...], edgeIds: [edgeId...] } or null.
export function shortestPath(fromId, toId) {
  if (fromId === toId) return { path: [fromId], edgeIds: [] };
  const visited = new Set([fromId]);
  const queue = [[fromId, [], []]];
  while (queue.length) {
    const [current, path, edgeIds] = queue.shift();
    for (const { nodeId: next, edgeId } of neighborsOf(current)) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      const nextEdgeIds = [...edgeIds, edgeId];
      if (next === toId) {
        return { path: [fromId, ...nextPath], edgeIds: nextEdgeIds };
      }
      visited.add(next);
      queue.push([next, nextPath, nextEdgeIds]);
    }
  }
  return null;
}

// Degree centrality over confirmed edges — simplest honest proxy for
// "most important" that doesn't need a heavyweight PageRank pass for
// the small graphs a single research session builds.
export function mostCentralNode() {
  let best = null;
  let bestDegree = -1;
  for (const n of nodes.values()) {
    const degree = neighborsOf(n.id).length;
    if (degree > bestDegree) {
      bestDegree = degree;
      best = n;
    }
  }
  return best ? { node: best, degree: bestDegree } : null;
}

export function allConfirmedEdgeIds() {
  const out = [];
  for (const e of edges.values()) if (e.status === 'confirmed') out.push(e.id);
  return out;
}
