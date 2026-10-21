/**
 * Talks to the FogWeave backend. Every call has a timeout and returns null
 * on failure, so the app can fall back to the bundled snapshot and say so
 * plainly. The reader's context labels are sent only with the request that
 * needs them.
 */
const API_BASE = (import.meta.env?.VITE_FOGWEAVE_API_BASE ?? 'http://localhost:8787').replace(/\/$/, '');

async function withTimeout(promise, ms, controller) {
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
  }
}

export class ResearchClient {
  constructor(base = API_BASE) {
    this.base = base;
    this.online = false;
    this.lastHealth = null;
  }

  async _json(path, { body = null, timeout = 8000 } = {}) {
    if (!this.base) return null;
    const controller = new AbortController();
    try {
      const res = await withTimeout(
        fetch(this.base + path, {
          method: body ? 'POST' : 'GET',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        }),
        timeout,
        controller,
      );
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async health() {
    const h = await this._json('/health', { timeout: 4000 });
    this.online = !!h?.ok;
    this.lastHealth = h;
    return h;
  }

  lights(context) {
    return this._json('/lights', { body: { context }, timeout: 90000 });
  }

  pool(interests) {
    return this._json('/pool', { body: { interests }, timeout: 120000 });
  }

  read(id) {
    return this._json('/read', { body: { id }, timeout: 60000 });
  }

  /** What each node is, with key facts and sources (fast, cached on the server). */
  dossiers(nodes, places = []) {
    return this._json('/dossiers', { body: { nodes, places }, timeout: 30000 });
  }

  /** Ask the fog: news about any topic, recent and older, to show as stars. */
  search(q) {
    return this._json('/search', { body: { q }, timeout: 90000 });
  }

  /** Connect the dots: patterns across Library items (each kept only with verbatim quotes). */
  patterns(items) {
    return this._json('/patterns', { body: { items }, timeout: 90000 });
  }

  ask(question, graph) {
    return this._json('/ask', { body: { question, graph, fresh: true }, timeout: 90000 });
  }

  pack(pack) {
    return this._json('/pack', { body: { pack }, timeout: 30000 });
  }

  check(text) {
    return this._json('/check', { body: { text }, timeout: 5000 });
  }

  /**
   * Streams graph events for one item. onEvent(ev) is called per event.
   * Resolves to the final stats (or null if the stream broke). Pass an
   * AbortSignal to stop research at any time.
   */
  expand(id, { context = [], deep = false, signal, onEvent }) {
    return this._stream('/expand', { id, context, deep }, { signal, onEvent });
  }

  /** Open the world around any node (definition, parts, news, papers, impact). */
  explore(node, { context = [], paperTypes = [], signal, onEvent }) {
    return this._stream('/explore', { node, context, paperTypes }, { signal, onEvent });
  }

  async _stream(path, body, { signal, onEvent }) {
    if (!this.base) return null;
    let res;
    try {
      res = await fetch(this.base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      return null;
    }
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let stats = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let ev;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === 'done') stats = ev.stats || {};
          onEvent(ev);
        }
      }
    } catch {
      return stats; // aborted or connection lost: what arrived stays
    }
    return stats;
  }
}
