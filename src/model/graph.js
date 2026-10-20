/**
 * GraphStore: the logical knowledge web (no rendering).
 *
 * Two layers:
 *  - fog layer: everything the agent found this session (sealed=false)
 *  - sealed layer: what the user pinch-confirmed (sealed=true); persists
 *
 * Every write is validated against the ontology in schema.js. Invalid
 * triples are rejected (and counted) rather than silently drawn.
 */
import { validateEdge, validateNode, SCHEMA_ID } from './schema.js';

export class GraphStore {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.meta = { topic: '', topicKey: '', provenance: null, generatedAt: null };
    this.insights = [];
    this.rejected = [];
    this._listeners = new Set();
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(kind, ids = []) {
    for (const fn of this._listeners) fn({ kind, ids });
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.insights = [];
    this.rejected = [];
    this.meta = { topic: '', topicKey: '', provenance: null, generatedAt: null };
    this._emit('clear');
  }

  setMeta(meta) {
    Object.assign(this.meta, meta);
    if (meta.topic && !meta.topicKey) this.meta.topicKey = topicKey(meta.topic);
    this._emit('meta');
  }

  addNode(raw, { silent = false } = {}) {
    const problem = validateNode(raw);
    if (problem) {
      this.rejected.push({ item: raw, problem });
      return null;
    }
    const existing = this.nodes.get(raw.id);
    if (existing) {
      Object.assign(existing, raw, { sealed: existing.sealed || !!raw.sealed });
      if (!silent) this._emit('node-updated', [raw.id]);
      return existing;
    }
    const node = { sealed: false, ...raw };
    if (node.type === 'Claim' && !node.verdict) node.verdict = 'unverified';
    this.nodes.set(node.id, node);
    if (!silent) this._emit('node-added', [node.id]);
    return node;
  }

  updateNode(id, patch) {
    const n = this.nodes.get(id);
    if (!n) return null;
    Object.assign(n, patch);
    this._emit('node-updated', [id]);
    return n;
  }

  addEdge(raw, { silent = false } = {}) {
    const edge = { evidence: [], sealed: false, ...raw };
    if (!edge.id) edge.id = `${edge.type}:${edge.from}->${edge.to}`;
    const problem = validateEdge(edge, this.nodes);
    if (problem) {
      this.rejected.push({ item: raw, problem });
      return null;
    }
    const existing = this.edges.get(edge.id);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...edge.evidence])];
      return existing;
    }
    this.edges.set(edge.id, edge);
    if (!silent) this._emit('edge-added', [edge.id]);
    return edge;
  }

  /** Bulk load a fogweave.graph/1 document. */
  loadGraph(doc) {
    if (!doc || doc.schema !== SCHEMA_ID) throw new Error('not a fogweave.graph/1 document');
    this.clear();
    this.setMeta({
      topic: doc.topic,
      topicKey: doc.topicKey || topicKey(doc.topic),
      provenance: doc.provenance || null,
      generatedAt: doc.generatedAt || null,
    });
    for (const n of doc.nodes || []) this.addNode(n, { silent: true });
    for (const e of doc.edges || []) this.addEdge(e, { silent: true });
    this.insights = doc.insights || [];
    this._emit('loaded');
  }

  toDocument() {
    return {
      schema: SCHEMA_ID,
      topic: this.meta.topic,
      topicKey: this.meta.topicKey,
      provenance: this.meta.provenance,
      generatedAt: this.meta.generatedAt,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      insights: this.insights,
    };
  }

  // ---------- sealing ----------

  /**
   * Seal a node or edge. Sealing a claim also seals the sources that
   * back it (supports/cites) and the edges that connect them, so the
   * Library never holds a claim without its evidence.
   */
  seal(id) {
    const changed = [];
    const mark = (item) => {
      if (item && !item.sealed) {
        item.sealed = true;
        changed.push(item.id);
      }
    };
    const node = this.nodes.get(id);
    if (node) {
      mark(node);
      if (node.type === 'Claim') {
        for (const e of this.edges.values()) {
          const backs = e.to === id && (e.type === 'supports' || e.type === 'contradicts') && this.nodes.get(e.from)?.type === 'Source';
          const cites = e.from === id && e.type === 'cites';
          if (backs || cites) {
            mark(e);
            mark(this.nodes.get(backs ? e.from : e.to));
          }
        }
      }
      // edges between two sealed nodes become sealed too
      for (const e of this.edges.values()) {
        if (!e.sealed && this.nodes.get(e.from)?.sealed && this.nodes.get(e.to)?.sealed) mark(e);
      }
    } else {
      const edge = this.edges.get(id);
      if (!edge) return [];
      mark(edge);
      mark(this.nodes.get(edge.from));
      mark(this.nodes.get(edge.to));
    }
    if (changed.length) this._emit('sealed', changed);
    return changed;
  }

  /** Unseal one node (and edges touching it). Sources stay if other sealed claims use them. */
  unseal(id) {
    const changed = [];
    const node = this.nodes.get(id);
    if (node?.sealed) {
      node.sealed = false;
      changed.push(id);
      for (const e of this.edges.values()) {
        if (e.sealed && (e.from === id || e.to === id)) {
          e.sealed = false;
          changed.push(e.id);
        }
      }
    }
    const edge = this.edges.get(id);
    if (edge?.sealed) {
      edge.sealed = false;
      changed.push(id);
    }
    if (changed.length) this._emit('unsealed', changed);
    return changed;
  }

  sealedIds() {
    const ids = [];
    for (const n of this.nodes.values()) if (n.sealed) ids.push(n.id);
    for (const e of this.edges.values()) if (e.sealed) ids.push(e.id);
    return ids;
  }

  restoreSealed(ids) {
    const set = new Set(ids);
    for (const n of this.nodes.values()) n.sealed = set.has(n.id);
    for (const e of this.edges.values()) e.sealed = set.has(e.id);
    this._emit('sealed', ids);
  }

  /** Plain arrays for algorithms. layer: 'sealed' | 'all' */
  view(layer = 'all') {
    const nodes = [];
    const ids = new Set();
    for (const n of this.nodes.values()) {
      if (layer === 'sealed' && !n.sealed) continue;
      nodes.push(n);
      ids.add(n.id);
    }
    const edges = [];
    for (const e of this.edges.values()) {
      if (layer === 'sealed' && !e.sealed) continue;
      if (ids.has(e.from) && ids.has(e.to)) edges.push(e);
    }
    return { nodes, edges };
  }

  neighbors(id) {
    const out = [];
    for (const e of this.edges.values()) {
      if (e.from === id) out.push({ id: e.to, edge: e });
      else if (e.to === id) out.push({ id: e.from, edge: e });
    }
    return out;
  }

  findByLabel(text) {
    const needle = text.toLowerCase().trim();
    if (!needle) return null;
    let best = null;
    let bestScore = 0;
    for (const n of this.nodes.values()) {
      const s = similarity(needle, n.label.toLowerCase());
      if (s > bestScore) {
        bestScore = s;
        best = n;
      }
    }
    return bestScore >= 0.4 ? best : null;
  }
}

export function topicKey(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Cheap fuzzy score 0..1 (exact > containment > shared words). */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.75;
  const wa = new Set(a.split(/\W+/).filter((w) => w.length > 2));
  const wb = new Set(b.split(/\W+/).filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return (0.6 * shared) / Math.max(wa.size, wb.size);
}
