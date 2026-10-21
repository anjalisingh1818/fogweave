/**
 * Research event stream shared by the live engine and replays of recorded
 * runs. V2 types: status {text}, node {node}, edge {edge},
 * verified {id, verdict, evidence}, note {level, text}, done {stats}.
 * (V1 types plan / source_found / claim / insight are still understood.)
 */

/** Apply one event to a GraphStore. Returns a short status phrase. */
export function applyEvent(store, ev) {
  switch (ev.type) {
    case 'plan':
      store.setMeta({ topic: ev.node.label, topicKey: ev.topicKey, provenance: ev.provenance, generatedAt: ev.generatedAt });
      store.addNode(ev.node);
      return 'Planning what to look for';
    case 'source_found':
      store.addNode(ev.node);
      return 'Reading sources';
    case 'claim':
    case 'entity':
      store.addNode({ ...ev.node, verdict: ev.node.type === 'Claim' ? 'unverified' : ev.node.verdict });
      return 'Pulling out claims';
    case 'verified':
      store.updateNode(ev.id, { verdict: ev.verdict, evidence: ev.evidence });
      return 'Checking claims against other sources';
    case 'edge':
      store.addEdge(ev.edge);
      return 'Linking what it found';
    case 'insight':
      store.insights.push(ev.insight);
      return 'Looking for patterns';
    // V2 stream (live engine and recorded snapshots)
    case 'node':
      store.addNode(ev.node);
      return null;
    case 'edge':
      store.addEdge(ev.edge);
      return null;
    case 'status':
      return ev.text || null;
    case 'note':
      return null;
    case 'done':
      return 'Done';
    default:
      return null;
  }
}

/** Turn a finished fogweave.graph/1 document into a plausible growth order. */
export function graphToEvents(doc) {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const edges = doc.edges || [];
  const topic = doc.nodes.find((n) => n.type === 'Topic' && topicMatches(n, doc)) || doc.nodes.find((n) => n.type === 'Topic');
  const events = [{ type: 'plan', node: topic, topicKey: doc.topicKey, provenance: doc.provenance, generatedAt: doc.generatedAt }];
  const added = new Set([topic.id]);
  const addNode = (n, type) => {
    if (!n || added.has(n.id)) return;
    added.add(n.id);
    events.push({ type, node: n.type === 'Claim' ? { ...n, verdict: 'unverified' } : n });
  };
  const emittedEdges = new Set();
  const addEdgesReady = () => {
    for (const e of edges) {
      const id = e.id || `${e.type}:${e.from}->${e.to}`;
      if (emittedEdges.has(id) || !added.has(e.from) || !added.has(e.to)) continue;
      emittedEdges.add(id);
      events.push({ type: 'edge', edge: e });
    }
  };
  // other topics / entities first (the plan's sub-areas)
  for (const n of doc.nodes) if (n.type === 'Topic' || n.type === 'Entity') addNode(n, 'entity');
  addEdgesReady();
  // each claim arrives after the sources it came from
  const claims = doc.nodes.filter((n) => n.type === 'Claim');
  for (const c of claims) {
    for (const e of edges) {
      const srcId = e.type === 'cites' && e.from === c.id ? e.to : (e.type === 'supports' || e.type === 'contradicts') && e.to === c.id && nodes.get(e.from)?.type === 'Source' ? e.from : null;
      if (srcId) addNode(nodes.get(srcId), 'source_found');
    }
    addNode(c, 'claim');
    addEdgesReady();
  }
  for (const n of doc.nodes) addNode(n, n.type === 'Source' ? 'source_found' : 'entity');
  addEdgesReady();
  // verification pass colours claims in
  for (const c of claims) {
    if (c.verdict && c.verdict !== 'unverified') events.push({ type: 'verified', id: c.id, verdict: c.verdict, evidence: c.evidence });
    else if (c.evidence) events.push({ type: 'verified', id: c.id, verdict: 'unverified', evidence: c.evidence });
  }
  for (const insight of doc.insights || []) events.push({ type: 'insight', insight });
  events.push({ type: 'done' });
  return events;
}

function topicMatches(n, doc) {
  return n.label.toLowerCase() === String(doc.topic || '').toLowerCase();
}

/**
 * Plays events into a store over time. Calls onStatus(phrase) as the
 * phase changes. pause()/resume()/stop() let the user halt growth.
 */
export class EventPlayer {
  constructor(store, events, { durationMs = 10000, onStatus, onDone, onNote, onStats } = {}) {
    this.onNote = onNote;
    this.onStats = onStats;
    this.store = store;
    this.events = events;
    this.i = 0;
    this.interval = Math.max(40, Math.min(400, durationMs / Math.max(1, events.length)));
    this.acc = 0;
    this.paused = false;
    this.stopped = false;
    this.onStatus = onStatus;
    this.onDone = onDone;
    this._last = null;
  }

  update(deltaMs) {
    if (this.paused || this.stopped || this.done) return;
    this.acc += deltaMs;
    while (this.acc >= this.interval && this.i < this.events.length) {
      this.acc -= this.interval;
      const ev = this.events[this.i++];
      if (ev.type === 'note') this.onNote?.(ev);
      if (ev.type === 'done') this.onStats?.(ev.stats);
      const phrase = applyEvent(this.store, ev);
      if (phrase && phrase !== this._last) {
        this._last = phrase;
        this.onStatus?.(phrase);
      }
    }
    if (this.i >= this.events.length) {
      this.done = true;
      this.onDone?.();
    }
  }

  /** Apply everything immediately (used when growth is skipped). */
  finish() {
    while (this.i < this.events.length) applyEvent(this.store, this.events[this.i++]);
    this.done = true;
    this.onDone?.();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    this.stopped = true;
  }
}
