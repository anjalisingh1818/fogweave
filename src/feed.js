/**
 * "Good news, random but curated": draw the visible lights from a scored
 * candidate pool by SEEDED weighted random sampling (reproducible).
 *
 *  - never from junk: only items above a quality floor (code-computed on the server)
 *  - weight = quality^2 x (0.25 + interest match) x novelty of its story
 *  - diversity: one item per story, at most 3 per news type, papers capped
 *    (a quarter, or half when the reader picked paper types)
 *  - about 1 in 4 picks (more with a higher surprise level) come from
 *    outside the reader's interests, to avoid a bubble
 *  - muted topics never appear
 * Ordinary seeded random only; randomness never touches evidence.
 */
import { similarity } from './model/graph.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** 0..1: how well an item matches the reader's interests. */
export function interestMatch(item, interests) {
  const d = interests?.data || interests || {};
  const tags = new Set(item.tags || []);
  const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
  let m = 0;
  for (const t of d.newsTypes || []) if (tags.has(t)) m = Math.max(m, 0.7);
  for (const c of d.paperTypes || []) if (tags.has(c)) m = Math.max(m, 0.9);
  for (const t of d.topics || []) {
    const hit = text.includes(t.label) ? 1 : similarity(t.label, text) > 0.3 ? 0.6 : tags.has(t.label) ? 0.7 : 0;
    if (hit) m = Math.max(m, Math.min(1, hit * (0.6 + 0.2 * t.weight)));
  }
  if (item.extra?.interest) m = Math.max(m, 0.5); // fetched for an interest query
  return m;
}

export function isMuted(item, interests) {
  const muted = (interests?.data || interests || {}).muted || [];
  if (!muted.length) return false;
  const tags = new Set(item.tags || []);
  const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
  return muted.some((m) => tags.has(m) || text.includes(m));
}

/**
 * @param {object[]} pool items with quality, tags, story, kind
 * @returns {object[]} picks, each with `outside: true|false`
 */
export function sampleFeed(pool, interests, { n = 16, seed = 1, exclude = new Set(), floor = 0.45 } = {}) {
  const d = interests?.data || interests || {};
  const rnd = mulberry32(seed);
  const empty = !(d.topics?.length || d.newsTypes?.length || d.paperTypes?.length);
  const surprise = d.surprise ?? 0.25;
  // datasets are an opt-in source type (Interests → Also show)
  const optIn = (it) => (it.sourceType || it.kind) !== 'dataset' || (d.sourceTypes || []).includes('dataset');
  const candidates = pool.filter((it) => (it.quality ?? 0.5) >= floor && !exclude.has(it.id) && !isMuted(it, d) && optIn(it));
  const scored = candidates.map((it) => ({ it, match: interestMatch(it, d) }));
  const nOutside = empty ? 0 : Math.round(n * (0.15 + 0.3 * surprise)); // about 1 in 4 at the default
  const paperCap = Math.ceil(n * (d.paperTypes?.length ? 0.5 : 0.25));
  const picks = [];
  const stories = new Set();
  const perType = new Map();
  let papers = 0;
  const fits = (it) => {
    if (stories.has(it.story)) return false;
    if (it.kind === 'paper' && papers >= paperCap) return false;
    const main = (it.tags || [])[0];
    return !(main && (perType.get(main) || 0) >= 3);
  };
  const take = (x, outside) => {
    picks.push({ ...x.it, outside, match: Math.round(x.match * 100) / 100 });
    stories.add(x.it.story);
    if (x.it.kind === 'paper') papers++;
    const main = (x.it.tags || [])[0];
    if (main) perType.set(main, (perType.get(main) || 0) + 1);
  };
  const draw = (list, weightOf) => {
    const usable = list.filter((x) => fits(x.it) && !picks.some((p) => p.id === x.it.id));
    const total = usable.reduce((s, x) => s + weightOf(x), 0);
    if (!usable.length || total <= 0) return null;
    let r = rnd() * total;
    for (const x of usable) {
      r -= weightOf(x);
      if (r <= 0) return x;
    }
    return usable[usable.length - 1];
  };
  const q2 = (x) => (x.it.quality ?? 0.5) ** 2;
  // a source type the reader turned on (Also show) gets at least one light when there is one
  for (const t of d.sourceTypes || []) {
    const x = draw(scored.filter((y) => (y.it.sourceType || y.it.kind) === t), q2);
    if (x && picks.length < n) take(x, false);
  }
  // outside the bubble first, so they are guaranteed a share
  const outsideList = scored.filter((x) => x.match < 0.15);
  for (let i = 0; i < nOutside; i++) {
    const x = draw(outsideList, q2);
    if (!x) break;
    take(x, true);
  }
  while (picks.length < n) {
    const x = draw(scored, (y) => q2(y) * (empty ? 1 : 0.25 + y.match));
    if (!x) break;
    take(x, false);
  }
  return picks;
}
