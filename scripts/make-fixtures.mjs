/**
 * Generates a SYNTHETIC V2 stress web for performance QA only
 * (qa/fixtures/stress-150.json). It is never shipped or shown as research:
 * the app's offline content is the recorded real snapshot in
 * public/demo/snapshot/ (server/scripts/snapshot.py).
 *
 *   node scripts/make-fixtures.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const VERDICTS = ['supported', 'supported', 'mixed', 'unverified', 'contradicted', 'unverified'];
const ENT = ['Organisation', 'Place', 'Topic', 'Technology'];
const Q = (q) => [{ quote: q, url: 'https://fixture.example/x', source: 'fixture.example' }];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const r = rng(11);
const nodes = [];
const edges = [];
for (let i = 1; i <= 12; i++) {
  nodes.push({ id: `n${i}`, type: 'NewsItem', label: `Fixture news ${i}`, outlet: 'fixture.example', date: '2026-10-19' });
  nodes.push({ id: `ev${i}`, type: 'Event', label: `Fixture event ${i}` });
  edges.push({ type: 'about', from: `n${i}`, to: `ev${i}`, label: 'reported', evidence: Q('fixture words here') });
}
for (let i = 1; i <= 40; i++) {
  const t = ENT[i % ENT.length];
  nodes.push({ id: `e${i}`, type: t, label: `Fixture ${t.toLowerCase()} ${i}` });
  const ev = `ev${1 + Math.floor(r() * 12)}`;
  edges.push({ type: 'affects', from: ev, to: `e${i}`, label: r() < 0.7 ? 'inferred' : 'speculative', reasoning: 'synthetic', basis: [ev] });
  edges.push({ type: 'mentions', from: `n${1 + Math.floor(r() * 12)}`, to: `e${i}`, label: 'reported', evidence: Q('fixture words here') });
}
for (let i = 1; i <= 40; i++) {
  const n = `n${1 + (i % 12)}`;
  nodes.push({ id: `c${i}`, type: 'Claim', label: `Fixture claim ${i}`, quote: 'fixture words here', verdict: VERDICTS[i % VERDICTS.length], evidence: { independentDomains: 1 + (i % 3), supports: 1 + (i % 3), contradicts: i % 4 === 0 ? 1 : 0, unclear: 0 } });
  edges.push({ type: 'reports', from: n, to: `c${i}`, label: 'reported', evidence: Q('fixture words here') });
}
for (let i = 1; i <= 56; i++) {
  nodes.push({ id: `s${i}`, type: 'Source', label: `fixture-src-${i}.example`, domain: `fixture-src-${i}.example`, sourceClass: 'news' });
  edges.push({ type: i % 5 ? 'supports' : 'contradicts', from: `s${i}`, to: `c${1 + (i % 40)}`, label: 'reported', evidence: Q('fixture words here') });
}
mkdirSync('qa/fixtures', { recursive: true });
const doc = { schema: 'fogweave.graph/2', topic: 'Stress fixture', topicKey: 'stress', provenance: { kind: 'fixture' }, nodes, edges, insights: [] };
writeFileSync('qa/fixtures/stress-150.json', JSON.stringify(doc));
console.log(`stress: ${nodes.length} nodes, ${edges.length} edges (synthetic, QA only)`);
