/**
 * Generates SYNTHETIC test fixtures (structure only, generic labels).
 * They exist so the client can be built and tested before the research
 * engine produces real webs; Phase 2 replaces public/demo/* with real
 * pipeline runs. Each file is marked provenance.kind = "fixture" and the
 * UI badges it as a test fixture.
 *
 *   node scripts/make-fixtures.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CLASSES = ['government', 'education', 'organisation', 'news', 'blog', 'unknown'];
const VERDICT_CYCLE = ['supported', 'supported', 'mixed', 'unverified', 'contradicted', 'supported', 'unverified'];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function fixture(letter, { claims, seed, subtopics = 3 }) {
  const r = rng(seed);
  const topicLabel = `Fixture ${letter}`;
  const nodes = [{ id: `${letter}:topic`, type: 'Topic', label: topicLabel, summary: 'Synthetic test fixture. Not research output.' }];
  const edges = [];
  for (let i = 1; i <= subtopics; i++) {
    nodes.push({ id: `${letter}:sub${i}`, type: 'Entity', label: `${topicLabel} · area ${i}` });
    edges.push({ type: 'part_of', from: `${letter}:sub${i}`, to: `${letter}:topic` });
  }
  let srcCount = 0;
  for (let c = 1; c <= claims; c++) {
    const id = `${letter}:c${c}`;
    const verdict = VERDICT_CYCLE[(c + seed) % VERDICT_CYCLE.length];
    const nSources = verdict === 'unverified' ? 1 : 2 + Math.floor(r() * 2);
    const classes = {};
    const sourceIds = [];
    for (let k = 0; k < nSources; k++) {
      const sid = `${letter}:s${++srcCount}`;
      const cls = CLASSES[Math.floor(r() * CLASSES.length)];
      classes[cls] = (classes[cls] || 0) + 1;
      nodes.push({
        id: sid,
        type: 'Source',
        label: `Fixture source ${letter}${srcCount}`,
        domain: `fixture-${letter.toLowerCase()}${srcCount}.example`,
        url: `https://fixture-${letter.toLowerCase()}${srcCount}.example/`,
        sourceClass: cls,
        date: `2026-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`,
      });
      sourceIds.push(sid);
    }
    const contradicts = verdict === 'contradicted' ? nSources - 1 : verdict === 'mixed' ? 1 : 0;
    const supports = nSources - contradicts;
    nodes.push({
      id,
      type: 'Claim',
      label: `${topicLabel} claim ${c}`,
      quote: 'Synthetic fixture quote.',
      verdict,
      evidence: {
        independentDomains: nSources,
        sourceClasses: classes,
        supports,
        contradicts,
        unclear: 0,
        newest: '2026-09-30',
      },
    });
    edges.push({ type: 'part_of', from: id, to: `${letter}:sub${1 + (c % subtopics)}` });
    edges.push({ type: 'cites', from: id, to: sourceIds[0] });
    sourceIds.slice(1).forEach((sid, k) => {
      edges.push({ type: k < contradicts ? 'contradicts' : 'supports', from: sid, to: id });
    });
    if (c > 2 && r() < 0.35) edges.push({ type: 'relates_to', from: id, to: `${letter}:c${1 + Math.floor(r() * (c - 1))}` });
  }
  return {
    schema: 'fogweave.graph/1',
    topic: topicLabel,
    topicKey: `fixture-${letter.toLowerCase()}`,
    generatedAt: '2026-10-20T00:00:00Z',
    provenance: { kind: 'fixture', note: 'Synthetic test fixture; replaced by real pipeline runs in Phase 2.' },
    nodes,
    edges,
    insights: [],
  };
}

mkdirSync('public/demo', { recursive: true });
mkdirSync('qa/fixtures', { recursive: true });
const demos = [
  fixture('A', { claims: 12, seed: 3 }),
  fixture('B', { claims: 9, seed: 5 }),
  fixture('C', { claims: 14, seed: 9, subtopics: 4 }),
];
for (const d of demos) writeFileSync(`public/demo/${d.topicKey}.json`, JSON.stringify(d, null, 1));
writeFileSync(
  'public/demo/index.json',
  JSON.stringify(
    demos.map((d) => ({ topicKey: d.topicKey, topic: d.topic, file: `${d.topicKey}.json`, kind: d.provenance.kind, nodes: d.nodes.length })),
    null,
    1,
  ),
);
const stress = fixture('S', { claims: 50, seed: 11, subtopics: 6 });
writeFileSync('qa/fixtures/stress-150.json', JSON.stringify(stress));
console.log(demos.map((d) => `${d.topicKey}: ${d.nodes.length} nodes, ${d.edges.length} edges`).join('\n'));
console.log(`stress: ${stress.nodes.length} nodes, ${stress.edges.length} edges`);
