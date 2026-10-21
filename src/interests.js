/**
 * The reader's interests (separate from the private context): news types,
 * paper types (arXiv fields), free topics with weights, muted topics and a
 * "surprise" level. Stored on this device; "clear interests" in one action.
 * Interests shape the pool and the sampling weights; they never touch the
 * evidence labels.
 */
const KEY = 'fogweave.interests.v1';

export const NEWS_TYPES = ['technology', 'science', 'business', 'climate', 'health', 'space', 'politics', 'world', 'culture', 'sports'];
export const PAPER_TYPES = {
  'cs.AI': 'Artificial intelligence',
  'cs.CL': 'Language models and NLP',
  'cs.RO': 'Robotics',
  'cs.HC': 'Human-computer interaction',
  'physics.soc-ph': 'Physics and society',
  'astro-ph.GA': 'Astrophysics',
  'q-bio.PE': 'Biology',
  'econ.GN': 'Economics',
  'eess.SY': 'Systems and control',
  'cond-mat.mtrl-sci': 'Materials science',
};

const EMPTY = () => ({ topics: [], newsTypes: [], paperTypes: [], sourceTypes: [], muted: [], surprise: 0.25 });
/** Extra source types the reader can add to the feed (open deep sources). */
export const SOURCE_TYPES = { dataset: 'Datasets', archive: 'Older news' };

export class InterestStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = this._load();
    this.history = []; // snapshots for Undo (this session)
  }

  /** Remember the current interests so the next change can be undone. */
  checkpoint() {
    this.history.push(JSON.stringify(this.data));
    if (this.history.length > 20) this.history.shift();
  }

  get canUndo() {
    return this.history.length > 0;
  }

  /** Back to the interests before the last change. */
  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.data = { ...EMPTY(), ...JSON.parse(prev) };
    this.save();
    return true;
  }

  _load() {
    try {
      return { ...EMPTY(), ...JSON.parse(this.storage?.getItem(KEY) || '{}') };
    } catch {
      return EMPTY();
    }
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // works for this session
    }
  }

  get empty() {
    const d = this.data;
    return !d.topics.length && !d.newsTypes.length && !d.paperTypes.length;
  }

  toggleSourceType(t) {
    if (!SOURCE_TYPES[t]) return;
    this.checkpoint();
    const s = new Set(this.data.sourceTypes);
    s.has(t) ? s.delete(t) : s.add(t);
    this.data.sourceTypes = [...s];
    this.save();
  }

  toggleNewsType(t) {
    this.checkpoint();
    const s = new Set(this.data.newsTypes);
    s.has(t) ? s.delete(t) : s.add(t);
    this.data.newsTypes = [...s];
    this.save();
  }

  togglePaperType(c) {
    this.checkpoint();
    const s = new Set(this.data.paperTypes);
    s.has(c) ? s.delete(c) : s.add(c);
    this.data.paperTypes = [...s];
    this.save();
  }

  addTopic(label, weight = 1) {
    const l = String(label || '').trim().toLowerCase().slice(0, 40);
    if (l.length < 2) return false;
    const t = this.data.topics.find((x) => x.label === l);
    if (t) t.weight = Math.min(3, t.weight + 0.5);
    else this.data.topics.push({ label: l, weight });
    this.data.muted = this.data.muted.filter((m) => m !== l);
    this.save();
    return true;
  }

  adjustTopic(label, delta) {
    const t = this.data.topics.find((x) => x.label === label);
    if (!t) return;
    t.weight = Math.max(0, Math.min(3, t.weight + delta));
    if (t.weight === 0) this.removeTopic(label);
    this.save();
  }

  removeTopic(label) {
    this.data.topics = this.data.topics.filter((x) => x.label !== label);
    this.save();
  }

  mute(label) {
    const l = String(label || '').trim().toLowerCase();
    if (l && !this.data.muted.includes(l)) this.data.muted.push(l);
    this.data.topics = this.data.topics.filter((x) => x.label !== l);
    this.save();
  }

  unmute(label) {
    this.data.muted = this.data.muted.filter((m) => m !== label);
    this.save();
  }

  setSurprise(v) {
    this.data.surprise = Math.max(0, Math.min(1, v));
    this.save();
  }

  /** "More like this": strengthen the item's news types; "less": weaken or mute them. */
  likeItem(item, more = true) {
    const types = (item.tags || []).filter((t) => NEWS_TYPES.includes(t));
    if (types.length) this.checkpoint();
    for (const t of types.slice(0, 2)) {
      if (more) {
        if (!this.data.newsTypes.includes(t)) this.data.newsTypes.push(t);
        this.addTopic(t, 1);
      } else {
        this.data.newsTypes = this.data.newsTypes.filter((x) => x !== t);
        const topic = this.data.topics.find((x) => x.label === t);
        if (topic) this.adjustTopic(t, -1);
        else this.mute(t);
      }
    }
    this.save();
    return types;
  }

  clear() {
    this.data = EMPTY();
    try {
      this.storage?.removeItem(KEY);
    } catch {
      // nothing stored
    }
  }

  /** What the server needs to shape the pool (labels only). */
  forServer() {
    const { topics, newsTypes, paperTypes, sourceTypes } = this.data;
    return { topics, newsTypes, paperTypes, sourceTypes };
  }
}
