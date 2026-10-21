/**
 * Main-thread side of the layout worker. Coalesces requests (only the
 * newest graph shape matters) and caches finished layouts by shape hash
 * so reopening a web is instant and lands in the same place.
 */
import { forceLayout } from './force.js';

const CACHE_KEY = 'fogweave.layout.v1';

export class LayoutClient {
  constructor() {
    this._worker = null;
    try {
      this._worker = new Worker(new URL('./layout-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      console.warn('[fogweave] layout worker unavailable, laying out on main thread', err);
    }
    this._nextId = 1;
    this._pending = new Map();
    this._busy = false;
    this._queued = null;
    this._cache = loadCache();
    this.lastMs = 0;
    if (this._worker) {
      this._worker.onmessage = (e) => {
        const { requestId, positions, ms } = e.data;
        this.lastMs = ms;
        const resolve = this._pending.get(requestId);
        this._pending.delete(requestId);
        resolve?.(positions);
      };
    }
  }

  /**
   * Resolve to positions for this shape. Requests made while one is in
   * flight collapse into a single follow-up run.
   */
  layout(nodes, edges, previous = {}) {
    const key = shapeKey(nodes, edges);
    if (this._cache[key]) return Promise.resolve(this._cache[key]);
    return new Promise((resolve) => {
      if (this._busy) {
        this._queued?.resolve(null); // superseded
        this._queued = { nodes, edges, previous, key, resolve };
        return;
      }
      this._run(nodes, edges, previous, key).then(resolve);
    });
  }

  async _run(nodes, edges, previous, key) {
    this._busy = true;
    const slimNodes = nodes.map((n) => ({ id: n.id, type: n.type, focus: !!n.focus }));
    const slimEdges = edges.map((e) => ({ from: e.from, to: e.to, type: e.type }));
    let positions;
    if (this._worker) {
      const requestId = this._nextId++;
      positions = await new Promise((resolve) => {
        this._pending.set(requestId, resolve);
        this._worker.postMessage({ requestId, nodes: slimNodes, edges: slimEdges, previous, iterations: 220 });
      });
    } else {
      positions = forceLayout(slimNodes, slimEdges, { previous });
    }
    this._cache[key] = positions;
    saveCache(this._cache);
    this._busy = false;
    if (this._queued) {
      const q = this._queued;
      this._queued = null;
      this._run(q.nodes, q.edges, positions, q.key).then(q.resolve);
    }
    return positions;
  }
}

function shapeKey(nodes, edges) {
  const n = nodes.map((x) => x.id + (x.focus ? '*' : '')).sort().join('|');
  const e = edges.map((x) => `${x.from}>${x.to}`).sort().join('|');
  let h = 0;
  const s = n + '#' + e;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${nodes.length}:${edges.length}:${h >>> 0}`;
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    const keys = Object.keys(cache);
    // keep the cache small: newest 12 shapes
    for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete cache[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable: layouts are recomputed next time
  }
}
