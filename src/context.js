/**
 * The reader's personal context graph (privacy first).
 *
 * A few coarse labels: city, field, tools, interests, commute, topics
 * followed. Nothing sensitive (health, income/debts, precise address,
 * private people) is accepted. Stored only on this device; sent to the
 * server only with a request that needs it, and never kept there.
 * "Clear my context" removes everything in one action.
 */
import { similarity, removeNodes, topicKey } from './model/graph.js';

const KEY = 'fogweave.context.v1';

export const CONTEXT_KINDS = {
  city: 'City or region',
  field: 'Field of work or study',
  tools: 'Tool or technology you use',
  interest: 'Interest',
  commute: 'How you get around',
  follows: 'Topic you follow',
};

/** Fictional sample persona for demos (clearly labelled in the UI). */
export const SAMPLE_PERSONA = [
  { label: 'Rotterdam', kind: 'city' },
  { label: 'logistics', kind: 'field' },
  { label: 'cloud computing', kind: 'tools' },
  { label: 'electric vehicles', kind: 'interest' },
  { label: 'public transport', kind: 'commute' },
  { label: 'energy prices', kind: 'follows' },
];

const SENSITIVE = [
  /\d{3,}/, // street numbers, phone numbers, ids
  /@/,
  /\b(street|st\.|road|rd\.|avenue|ave\.?|lane|apartment|apt|flat no|postcode|zip)\b/i,
  /\b(diabet|cancer|hiv|aids|depress|anxiety|pregnan|disab|illness|disease|diagnos|medication|therapy)/i,
  /\b(salary|income|debt|loan|mortgage|bank account|credit card|savings|wage)/i,
  /\b(religio|sexual|ethnic|political party member|immigration status)/i,
];

export function rejectReason(label) {
  const t = String(label || '').trim();
  if (t.length < 2 || t.length > 40) return 'Keep it short: 2 to 40 characters.';
  if (SENSITIVE.some((r) => r.test(t))) return 'Please keep it coarse: no addresses, numbers, health or money details.';
  return null;
}

export class ContextStore {
  constructor() {
    // V3: "My context" is no longer part of the app (it is off the Menu and out
    // of the fog); anything an older version stored on this device is cleared
    this.items = [];
    this.sample = false;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing stored
    }
  }

  list() {
    return this.items;
  }

  labels() {
    return this.items.map((i) => i.label);
  }

  ids() {
    return this.items.map((i) => i.id);
  }

  add(label, kind = 'interest', { sample = false } = {}) {
    const problem = rejectReason(label);
    if (problem) return { ok: false, problem };
    const clean = label.trim();
    const id = `ctx:${topicKey(clean)}`;
    if (this.items.some((i) => i.id === id)) return { ok: true, id };
    if (this.items.length >= 8) return { ok: false, problem: 'Up to 8 context items: remove one first.' };
    this.items.push({ id, label: clean, kind, sample });
    save(this.items);
    return { ok: true, id };
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    save(this.items);
  }

  useSamplePersona() {
    this.items = SAMPLE_PERSONA.map((p) => ({ id: `ctx:${topicKey(p.label)}`, ...p, sample: true }));
    this.sample = true;
    save(this.items);
  }

  clear() {
    this.items = [];
    this.sample = false;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing stored
    }
  }

  /**
   * Mirror context into the web as private ContextNodes and link each to
   * entities with the same name (an on-device 'same_as', inferred).
   */
  syncToStore(store) {
    const want = new Set(this.ids());
    const stale = [...store.nodes.values()].filter((n) => n.type === 'ContextNode' && !want.has(n.id)).map((n) => n.id);
    if (stale.length) removeNodes(store, stale);
    for (const item of this.items) {
      store.addNode({ id: item.id, type: 'ContextNode', label: item.label, kind: item.kind, private: true }, { silent: true });
      for (const n of store.nodes.values()) {
        if (!['Place', 'Organisation', 'Topic', 'Technology', 'Event'].includes(n.type)) continue;
        if (similarity(item.label.toLowerCase(), n.label.toLowerCase()) < 0.75) continue;
        store.addEdge(
          { type: 'same_as', from: item.id, to: n.id, label: 'inferred', reasoning: `Same name as your context “${item.label}”.`, basis: [n.id] },
          { silent: true },
        );
      }
    }
    store._emit('context');
  }
}

function save(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // not persisted; still works this session
  }
}

export { removeNodes };
