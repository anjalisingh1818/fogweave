import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, similarity, topicKey } from '../src/model/graph.js';
import { validateEdge } from '../src/model/schema.js';
import {
  shortestPath,
  importanceOf,
  mostImportant,
  pagerank,
  betweenness,
  evidenceReadout,
} from '../src/model/algorithms.js';
import { forceLayout } from '../src/layout/force.js';

function smallWeb() {
  const s = new GraphStore();
  s.loadGraph({
    schema: 'fogweave.graph/1',
    topic: 'Test topic',
    nodes: [
      { id: 't', type: 'Topic', label: 'Test topic' },
      { id: 'c1', type: 'Claim', label: 'Claim one', verdict: 'supported', evidence: { independentDomains: 3, supports: 3, contradicts: 0, unclear: 0, sourceClasses: { education: 2, news: 1 } } },
      { id: 'c2', type: 'Claim', label: 'Claim two', verdict: 'contradicted', evidence: { independentDomains: 2, supports: 0, contradicts: 2, unclear: 0 } },
      { id: 'c3', type: 'Claim', label: 'Claim three' },
      { id: 's1', type: 'Source', label: 'Source one', domain: 'a.edu', sourceClass: 'education' },
      { id: 's2', type: 'Source', label: 'Source two', domain: 'b.org', sourceClass: 'organisation' },
      { id: 'x', type: 'Entity', label: 'Isolated thing' },
    ],
    edges: [
      { type: 'part_of', from: 'c1', to: 't' },
      { type: 'part_of', from: 'c2', to: 't' },
      { type: 'part_of', from: 'c3', to: 't' },
      { type: 'supports', from: 's1', to: 'c1' },
      { type: 'cites', from: 'c1', to: 's2' },
      { type: 'contradicts', from: 's2', to: 'c2' },
      { type: 'supports', from: 'c1', to: 'x' }, // invalid: range must be Claim
    ],
  });
  return s;
}

test('ontology rejects invalid triples and keeps valid ones', () => {
  const s = smallWeb();
  assert.equal(s.edges.size, 6);
  assert.equal(s.rejected.length, 1);
  assert.match(s.rejected[0].problem, /cannot end at Entity/);
  assert.equal(validateEdge({ type: 'cites', from: 's1', to: 'c1' }, s.nodes), 'cites cannot start at Source');
});

test('claims default to unverified', () => {
  assert.equal(smallWeb().nodes.get('c3').verdict, 'unverified');
});

test('sealing a claim seals its sources and the edges that back it', () => {
  const s = smallWeb();
  const changed = s.seal('c1');
  assert.ok(s.nodes.get('c1').sealed);
  assert.ok(s.nodes.get('s1').sealed, 'supporting source sealed');
  assert.ok(s.nodes.get('s2').sealed, 'cited source sealed');
  assert.ok(s.edges.get('supports:s1->c1').sealed);
  assert.ok(s.edges.get('cites:c1->s2').sealed);
  assert.ok(!s.nodes.get('t').sealed, 'topic not sealed implicitly');
  assert.ok(changed.length >= 5);
  const sealedView = s.view('sealed');
  assert.equal(sealedView.nodes.length, 3);
});

test('sealed ids round-trip', () => {
  const s = smallWeb();
  s.seal('c1');
  const ids = s.sealedIds();
  const s2 = smallWeb();
  s2.restoreSealed(ids);
  assert.deepEqual(s2.sealedIds().sort(), ids.sort());
});

test('unseal removes the node and its edges from the sealed layer', () => {
  const s = smallWeb();
  s.seal('c1');
  s.unseal('c1');
  assert.ok(!s.nodes.get('c1').sealed);
  assert.ok(!s.edges.get('supports:s1->c1').sealed);
});

test('shortest path is found and stable', () => {
  const s = smallWeb();
  const p = shortestPath(s.view(), 's1', 'c2');
  assert.deepEqual(p.nodes, ['s1', 'c1', 's2', 'c2']);
  assert.equal(p.edges.length, 3);
  assert.equal(shortestPath(s.view(), 's1', 'x'), null);
  assert.deepEqual(shortestPath(s.view(), 's1', 'c2'), p);
});

test('importance gives a rank with a reason', () => {
  const s = smallWeb();
  const imp = importanceOf(s.view(), 'c1');
  assert.equal(imp.of, 7);
  assert.ok(imp.rank >= 1 && imp.rank <= 7);
  assert.ok(imp.why.length >= 1);
  const top = mostImportant(s.view());
  assert.ok(['c1', 't'].includes(top.id));
  assert.equal(importanceOf(s.view(), 'missing'), null);
});

test('pagerank sums to ~1 and betweenness is within 0..1', () => {
  const v = smallWeb().view();
  const total = [...pagerank(v).values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
  for (const b of betweenness(v).values()) assert.ok(b >= 0 && b <= 1);
});

test('coin readout uses stored evidence, never a bare percentage', () => {
  const s = smallWeb();
  const r = evidenceReadout(s, 'c1');
  assert.equal(r.verdict, 'supported');
  assert.ok(r.lines.some((l) => l.includes('3 independent domains')));
  for (const l of r.lines) assert.ok(!/%/.test(l));
  assert.match(evidenceReadout(s, 'c3').risk, /one source|Not checked/);
  assert.ok(evidenceReadout(s, 't').lines[0].includes('3 linked claims'));
});

test('fuzzy label matching and topic keys', () => {
  const s = smallWeb();
  assert.equal(s.findByLabel('claim two').id, 'c2');
  assert.equal(s.findByLabel('zzzz'), null);
  assert.equal(topicKey('Perovskite  Solar Cells!'), 'perovskite-solar-cells');
  assert.ok(similarity('solar cells', 'perovskite solar cells') > 0.5);
});

test('force layout is deterministic and fits a unit sphere', () => {
  const v = smallWeb().view();
  const a = forceLayout(v.nodes, v.edges);
  const b = forceLayout(v.nodes, v.edges);
  assert.deepEqual(a, b);
  for (const p of Object.values(a)) assert.ok(Math.hypot(...p) <= 1.0001);
  // linked nodes end up closer than the isolated entity on average
  const d = (x, y) => Math.hypot(a[x][0] - a[y][0], a[x][1] - a[y][1], a[x][2] - a[y][2]);
  assert.ok(d('c1', 's1') < d('c1', 'x'));
});
