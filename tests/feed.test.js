import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleFeed, interestMatch, mulberry32 } from '../src/feed.js';
import { InterestStore } from '../src/interests.js';

class Mem {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.get(k) ?? null;
  }
  setItem(k, v) {
    this.m.set(k, v);
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

function pool() {
  const types = ['technology', 'science', 'business', 'climate', 'health', 'space', 'politics', 'world', 'culture', 'sports'];
  const out = [];
  for (let i = 0; i < 60; i++) {
    const t = types[i % types.length];
    out.push({
      id: `n${i}`,
      kind: i % 7 === 0 ? 'paper' : 'breaking',
      headline: `${t} story number ${i}`,
      summary: i === 13 ? 'electric vehicles sales grow' : '',
      tags: i % 7 === 0 ? ['science', 'cs.RO'] : [t],
      quality: i % 9 === 0 ? 0.3 : 0.6 + (i % 5) * 0.05, // some junk below the floor
      story: Math.floor(i / 2), // pairs share a story
    });
  }
  return out;
}

test('seeded: same seed, same lights; different seed, different lights', () => {
  const s = new InterestStore(new Mem());
  const a = sampleFeed(pool(), s, { seed: 7 }).map((x) => x.id);
  assert.deepEqual(a, sampleFeed(pool(), s, { seed: 7 }).map((x) => x.id));
  assert.notDeepEqual(a, sampleFeed(pool(), s, { seed: 8 }).map((x) => x.id));
  assert.equal(mulberry32(1)(), mulberry32(1)());
});

test('never junk, one per story, papers capped, at most 3 per type', () => {
  const picks = sampleFeed(pool(), new InterestStore(new Mem()), { seed: 3, n: 16 });
  assert.equal(picks.length, 16);
  assert.ok(picks.every((p) => p.quality >= 0.45));
  assert.equal(new Set(picks.map((p) => p.story)).size, picks.length);
  assert.ok(picks.filter((p) => p.kind === 'paper').length <= 4);
  const perType = {};
  for (const p of picks) perType[p.tags[0]] = (perType[p.tags[0]] || 0) + 1;
  assert.ok(Object.values(perType).every((c) => c <= 3));
});

test('interests shift the picks, with about 1 in 4 from outside', () => {
  const s = new InterestStore(new Mem());
  s.toggleNewsType('climate');
  s.addTopic('electric vehicles', 2);
  const picks = sampleFeed(pool(), s, { seed: 5, n: 16 });
  const outside = picks.filter((p) => p.outside).length;
  assert.ok(outside >= 3 && outside <= 6, `outside ${outside}`);
  const inside = picks.filter((p) => !p.outside);
  assert.ok(inside.filter((p) => interestMatch(p, s) > 0).length >= 3);
  assert.ok(picks.some((p) => p.id === 'n13' || p.id === 'n12'), 'the EV story (or its story mate) is picked');
});

test('removing an interest changes the lights back', () => {
  const s = new InterestStore(new Mem());
  const before = sampleFeed(pool(), s, { seed: 9 }).map((x) => x.id);
  s.toggleNewsType('sports');
  const withSports = sampleFeed(pool(), s, { seed: 9 }).map((x) => x.id);
  assert.notDeepEqual(before, withSports);
  s.toggleNewsType('sports');
  assert.deepEqual(sampleFeed(pool(), s, { seed: 9 }).map((x) => x.id), before);
});

test('muted topics never appear; clear interests in one action', () => {
  const s = new InterestStore(new Mem());
  s.mute('sports');
  assert.ok(!sampleFeed(pool(), s, { seed: 2, n: 20 }).some((p) => p.tags.includes('sports')));
  s.addTopic('robots');
  s.clear();
  assert.ok(s.empty && !s.data.muted.length);
});

test('more / less like this adjusts interests', () => {
  const s = new InterestStore(new Mem());
  s.likeItem({ tags: ['space', 'science'] }, true);
  assert.ok(s.data.newsTypes.includes('space'));
  s.likeItem({ tags: ['sports'] }, false);
  assert.ok(s.data.muted.includes('sports'));
});
