/**
 * Deterministic graph algorithms over a {nodes, edges} view.
 * Edges are treated as undirected for structure (importance, paths).
 * Nothing here is random or model-generated: the Locket, Coin and path
 * features must give the same answer for the same web every time.
 */

export function adjacency({ nodes, edges }) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from).push({ id: e.to, edge: e });
    adj.get(e.to).push({ id: e.from, edge: e });
  }
  return adj;
}

export function pagerank(view, { damping = 0.85, iterations = 60 } = {}) {
  const adj = adjacency(view);
  const ids = [...adj.keys()];
  const n = ids.length;
  const pr = new Map();
  if (!n) return pr;
  for (const id of ids) pr.set(id, 1 / n);
  for (let it = 0; it < iterations; it++) {
    let dangling = 0;
    for (const id of ids) if (adj.get(id).length === 0) dangling += pr.get(id);
    const next = new Map();
    for (const id of ids) next.set(id, (1 - damping) / n + (damping * dangling) / n);
    for (const id of ids) {
      const out = adj.get(id);
      if (!out.length) continue;
      const share = (damping * pr.get(id)) / out.length;
      for (const { id: to } of out) next.set(to, next.get(to) + share);
    }
    for (const id of ids) pr.set(id, next.get(id));
  }
  return pr;
}

/** Brandes betweenness (unweighted, undirected), normalised 0..1. */
export function betweenness(view) {
  const adj = adjacency(view);
  const ids = [...adj.keys()];
  const cb = new Map(ids.map((id) => [id, 0]));
  for (const s of ids) {
    const stack = [];
    const pred = new Map(ids.map((id) => [id, []]));
    const sigma = new Map(ids.map((id) => [id, 0]));
    const dist = new Map(ids.map((id) => [id, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      stack.push(v);
      for (const { id: w } of adj.get(v)) {
        if (dist.get(w) < 0) {
          dist.set(w, dist.get(v) + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          pred.get(w).push(v);
        }
      }
    }
    const delta = new Map(ids.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred.get(w)) {
        delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
      }
      if (w !== s) cb.set(w, cb.get(w) + delta.get(w));
    }
  }
  const n = ids.length;
  const norm = n > 2 ? (n - 1) * (n - 2) : 1; // undirected: each pair counted twice above
  for (const id of ids) cb.set(id, cb.get(id) / norm);
  return cb;
}

export function degree(view) {
  const adj = adjacency(view);
  return new Map([...adj].map(([id, list]) => [id, new Set(list.map((x) => x.id)).size]));
}

/**
 * Importance of one node inside a view, as a rank plus a plain why.
 * Ranking key: PageRank, ties broken by degree then id (stable).
 */
export function importanceOf(view, nodeId) {
  if (!view.nodes.some((n) => n.id === nodeId)) return null;
  const pr = pagerank(view);
  const deg = degree(view);
  const btw = betweenness(view);
  const order = view.nodes
    .map((n) => n.id)
    .sort((a, b) => pr.get(b) - pr.get(a) || deg.get(b) - deg.get(a) || (a < b ? -1 : 1));
  const rank = order.indexOf(nodeId) + 1;
  const btwSorted = [...btw.values()].sort((a, b) => b - a);
  const btwRank = btwSorted.indexOf(btw.get(nodeId)) + 1;
  const why = [];
  why.push(`${deg.get(nodeId)} direct link${deg.get(nodeId) === 1 ? '' : 's'}`);
  if (btw.get(nodeId) > 0 && btwRank <= Math.max(1, Math.ceil(order.length * 0.1))) {
    why.push('a bridge between parts of the web');
  } else if (btw.get(nodeId) === 0) {
    why.push('not on any shortest path between others');
  }
  return {
    rank,
    of: order.length,
    pagerank: pr.get(nodeId),
    degree: deg.get(nodeId),
    betweenness: btw.get(nodeId),
    why,
  };
}

export function mostImportant(view) {
  if (!view.nodes.length) return null;
  const pr = pagerank(view);
  const deg = degree(view);
  const id = view.nodes
    .map((n) => n.id)
    .sort((a, b) => pr.get(b) - pr.get(a) || deg.get(b) - deg.get(a) || (a < b ? -1 : 1))[0];
  return importanceOf(view, id) && { id, ...importanceOf(view, id) };
}

/** BFS shortest path. Returns { nodes: [ids], edges: [edge objects] } or null. */
export function shortestPath(view, fromId, toId) {
  const adj = adjacency(view);
  if (!adj.has(fromId) || !adj.has(toId)) return null;
  if (fromId === toId) return { nodes: [fromId], edges: [] };
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    // stable order so the same web always yields the same path
    const next = [...adj.get(v)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const { id: w, edge } of next) {
      if (prev.has(w)) continue;
      prev.set(w, { v, edge });
      if (w === toId) {
        const nodes = [toId];
        const edges = [];
        let cur = toId;
        while (prev.get(cur)) {
          edges.unshift(prev.get(cur).edge);
          cur = prev.get(cur).v;
          nodes.unshift(cur);
        }
        return { nodes, edges };
      }
      queue.push(w);
    }
  }
  return null;
}

/**
 * Plain-language evidence read for the Coin. Uses only stored evidence
 * signals (computed by code on the server), never a model's percentage.
 */
export function evidenceReadout(store, nodeId) {
  const node = store.nodes.get(nodeId);
  if (!node) return null;
  if (node.type === 'Claim') {
    const ev = node.evidence || {};
    const lines = [];
    lines.push(`${ev.independentDomains ?? 0} independent domain${ev.independentDomains === 1 ? '' : 's'}`);
    const classes = Object.entries(ev.sourceClasses || {})
      .filter(([, c]) => c > 0)
      .map(([k, c]) => `${c} ${k}`);
    if (classes.length) lines.push(`Sources: ${classes.join(', ')}`);
    lines.push(`${ev.supports ?? 0} support · ${ev.contradicts ?? 0} contradict · ${ev.unclear ?? 0} unclear`);
    if (ev.newest) lines.push(`Newest evidence: ${ev.newest}`);
    return { verdict: node.verdict || 'unverified', lines, risk: riskNote(node.verdict, ev) };
  }
  if (node.type === 'Source') {
    const backed = store.neighbors(nodeId).filter((x) => x.edge.type === 'supports' || x.edge.type === 'cites');
    return {
      verdict: null,
      lines: [
        `Class: ${node.sourceClass || 'unknown'}`,
        node.domain ? `Domain: ${node.domain}` : null,
        node.date ? `Dated: ${node.date}` : 'No date found',
        `Linked to ${backed.length} claim${backed.length === 1 ? '' : 's'}`,
      ].filter(Boolean),
      risk: node.sourceClass === 'blog' || node.sourceClass === 'unknown' ? 'Low-authority source: check what it is used for.' : '',
    };
  }
  // Topic / Entity: aggregate over directly linked claims
  const claims = store
    .neighbors(nodeId)
    .map((x) => store.nodes.get(x.id))
    .filter((n) => n?.type === 'Claim');
  const counts = { supported: 0, contradicted: 0, mixed: 0, unverified: 0 };
  for (const c of claims) counts[c.verdict || 'unverified']++;
  return {
    verdict: null,
    lines: [
      `${claims.length} linked claim${claims.length === 1 ? '' : 's'}`,
      `${counts.supported} well supported · ${counts.mixed} mixed`,
      `${counts.contradicted} contradicted · ${counts.unverified} unverified`,
    ],
    risk: counts.contradicted + counts.unverified > counts.supported ? 'Most claims here are not well supported yet.' : '',
  };
}

function riskNote(verdict, ev) {
  if (verdict === 'contradicted') return 'Independent sources disagree with this claim.';
  if (verdict === 'mixed') return 'Sources disagree: read both sides before relying on it.';
  if ((ev.independentDomains ?? 0) <= 1) return 'Only one source: a weak spot.';
  if (verdict === 'unverified') return 'Not checked against independent sources yet.';
  return '';
}
