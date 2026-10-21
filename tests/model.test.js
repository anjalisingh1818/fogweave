import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, similarity, topicKey, removeNodes } from '../src/model/graph.js';
import { validateEdge } from '../src/model/schema.js';
import { shortestPath, importanceOf, mostImportant, pagerank, betweenness, evidenceReadout, bestPath } from '../src/model/algorithms.js';
import { forceLayout } from '../src/layout/force.js';

const Q = (quote) => [{ quote, url: 'https://outlet.example/a', source: 'outlet.example' }];

function web() {
  const s = new GraphStore();
  s.loadGraph({
    schema: 'fogweave.graph/2',
    topic: 'Test web',
    nodes: [
      { id: 'n1', type: 'NewsItem', label: 'Port strike halts shipping', outlet: 'outlet.example', date: '2026-10-19' },
      { id: 'ev', type: 'Event', label: 'Port strike' },
      { id: 'port', type: 'Place', label: 'Rotterdam' },
      { id: 'ship', type: 'Organisation', label: 'Shipping lines' },
      { id: 'prices', type: 'Topic', label: 'Import prices' },
      { id: 'c1', type: 'Claim', label: 'The port is closed', quote: 'the port is closed', verdict: 'supported', evidence: { independentDomains: 3, supports: 3, contradicts: 0, unclear: 0, sourceClasses: { news: 3 } } },
      { id: 'c2', type: 'Claim', label: 'Strike lasts a week', quote: 'will last a week', verdict: 'contradicted', evidence: { independentDomains: 1, supports: 1, contradicts: 2, unclear: 0 } },
      { id: 'c3', type: 'Claim', label: 'Unchecked claim', quote: 'some words here' },
      { id: 's1', type: 'Source', label: 'other.example', domain: 'other.example', sourceClass: 'news' },
      { id: 'ctx:city', type: 'ContextNode', label: 'Rotterdam', private: true },
      { id: 'far', type: 'Topic', label: 'Unrelated' },
    ],
    edges: [
      { type: 'about', from: 'n1', to: 'ev', label: 'reported', evidence: Q('port strike') },
      { type: 'happened_in', from: 'ev', to: 'port', label: 'reported', evidence: Q('in Rotterdam') },
      { type: 'reports', from: 'n1', to: 'c1', label: 'reported', evidence: Q('the port is closed') },
      { type: 'reports', from: 'n1', to: 'c2', label: 'reported', evidence: Q('will last a week') },
      { type: 'supports', from: 's1', to: 'c1', label: 'reported', evidence: Q('closed port') },
      { type: 'affects', from: 'ev', to: 'ship', label: 'inferred', reasoning: 'ships cannot dock', basis: ['c1'] },
      { type: 'affects', from: 'ship', to: 'prices', label: 'inferred', reasoning: 'delays raise costs', basis: ['c1'] },
      { type: 'same_as', from: 'ctx:city', to: 'port', label: 'inferred', reasoning: 'same name', basis: ['port'] },
      { type: 'affects', from: 'far', to: 'ctx:city', label: 'speculative', reasoning: 'maybe' },
      { type: 'happened_in', from: 'port', to: 'ev', label: 'reported', evidence: Q('x y z w') }, // invalid: domain
      { type: 'affects', from: 'ev', to: 'far', label: 'inferred' }, // invalid: no reasoning/basis
      { type: 'mentions', from: 'n1', to: 'ship', label: 'reported' }, // invalid: no quote
    ],
  });
  return s;
}

test('ontology rejects invalid statements, keeps valid ones', () => {
  const s = web();
  assert.equal(s.edges.size, 9);
  assert.equal(s.rejected.length, 3);
  assert.match(s.rejected[0].problem, /cannot start at Place/);
  assert.match(s.rejected[1].problem, /without reasoning/);
  assert.match(s.rejected[2].problem, /without a quoted/);
  assert.equal(validateEdge({ type: 'relates_to', from: 'ev', to: 'ship', label: 'reported', evidence: Q('aaa bbb ccc') }, s.nodes), 'relates_to must be speculative');
});

test('claims default to unverified', () => {
  assert.equal(web().nodes.get('c3').verdict, 'unverified');
});

test('sealing a claim brings its reporting news item and its sources', () => {
  const s = web();
  s.seal('c1');
  for (const id of ['c1', 'n1', 's1']) assert.ok(s.nodes.get(id).sealed, id);
  assert.ok(s.edges.get('supports:s1->c1').sealed);
  assert.ok(s.edges.get('reports:n1->c1').sealed);
  assert.ok(!s.nodes.get('c2').sealed);
});

test('private context is never sealed or exported', () => {
  const s = web();
  assert.deepEqual(s.seal('ctx:city'), []);
  assert.deepEqual(s.seal('same_as:ctx:city->port'), []);
  const doc = s.toDocument();
  assert.ok(!doc.nodes.some((n) => n.type === 'ContextNode'));
  assert.ok(!doc.edges.some((e) => e.from === 'ctx:city' || e.to === 'ctx:city'));
});

test('clearing context removes its nodes and links', () => {
  const s = web();
  removeNodes(s, ['ctx:city']);
  assert.ok(!s.nodes.has('ctx:city'));
  assert.ok(![...s.edges.values()].some((e) => e.from === 'ctx:city' || e.to === 'ctx:city'));
});

test('sealed ids round-trip', () => {
  const s = web();
  s.seal('c1');
  const ids = s.sealedIds();
  const s2 = web();
  s2.restoreSealed(ids);
  assert.deepEqual(s2.sealedIds().sort(), ids.sort());
});

test('views leave speculative links out unless asked', () => {
  const s = web();
  assert.equal(s.view().edges.filter((e) => e.label === 'speculative').length, 0);
  assert.equal(s.view('all', { speculative: true }).edges.filter((e) => e.label === 'speculative').length, 1);
});

test('"how does this touch me": labelled grounded path, or none', () => {
  const s = web();
  const p = bestPath(s.view(), 'n1', ['ctx:city']);
  assert.deepEqual(p.nodes, ['n1', 'ev', 'port', 'ctx:city']);
  assert.deepEqual(p.edges.map((e) => e.label), ['reported', 'reported', 'inferred']);
  assert.equal(bestPath(s.view(), 'far', ['ctx:city']), null, 'speculative-only link is no clear connection');
  // reported beats inferred when both exist
  assert.equal(p.cost, 4);
});

test('BFS shortest path is stable and ignores speculative links', () => {
  const s = web();
  assert.deepEqual(shortestPath(s.view(), 's1', 'ship').nodes, ['s1', 'c1', 'n1', 'ev', 'ship']);
  assert.equal(shortestPath(s.view(), 'far', 'ctx:city'), null);
});

test('personalized PageRank favours the reader context', () => {
  const v = web().view();
  const plain = pagerank(v);
  const pers = pagerank(v, { seeds: ['ctx:city'] });
  const total = [...pers.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
  assert.ok(pers.get('port') / plain.get('port') > pers.get('s1') / plain.get('s1'));
  const imp = importanceOf(v, 'port', { seeds: ['ctx:city'] });
  assert.ok(imp.personal && /from your “Rotterdam”/.test(imp.why[0]));
  const top = mostImportant(v, { seeds: ['ctx:city'], exclude: (n) => n.type === 'ContextNode' });
  assert.notEqual(top.id, 'ctx:city');
});

test('importance gives a rank with a reason; betweenness in 0..1', () => {
  const v = web().view();
  const imp = importanceOf(v, 'ev');
  assert.ok(imp.rank >= 1 && imp.rank <= imp.of && imp.why.length);
  for (const b of betweenness(v).values()) assert.ok(b >= 0 && b <= 1);
});

test('coin readouts use stored evidence, never a bare percentage', () => {
  const s = web();
  const r = evidenceReadout(s, 'c1');
  assert.equal(r.verdict, 'supported');
  assert.ok(r.lines.some((l) => l.includes('3 independent domains')));
  for (const l of r.lines) assert.ok(!/%/.test(l));
  assert.match(evidenceReadout(s, 'c3').risk, /one source|Not checked/);
  const news = evidenceReadout(s, 'n1');
  assert.ok(news.lines.some((l) => l.startsWith('Outlet: outlet.example')));
  assert.ok(news.lines.some((l) => l.includes('2 key claims')));
});

test('fuzzy label matching and topic keys', () => {
  const s = web();
  assert.equal(s.findByLabel('port strike').id, 'ev');
  assert.equal(s.findByLabel('zzzz'), null);
  assert.equal(topicKey('Perovskite  Solar Cells!'), 'perovskite-solar-cells');
  assert.ok(similarity('solar cells', 'perovskite solar cells') > 0.5);
});

test('force layout is deterministic and fits a unit sphere', () => {
  const v = web().view();
  const a = forceLayout(v.nodes, v.edges);
  assert.deepEqual(a, forceLayout(v.nodes, v.edges));
  for (const p of Object.values(a)) assert.ok(Math.hypot(...p) <= 1.0001);
});

test('refusals come from the shared list: restricted sources, private people', async () => {
  const { checkRequest } = await import('../src/safety.js');
  assert.match(checkRequest('find it on the dark web'), /open, legal sources/);
  assert.match(checkRequest("what is my neighbour's home address"), /not private people/);
  assert.equal(checkRequest('the 2008 financial crisis'), null);
  assert.equal(checkRequest('how do paywalls affect news outlets'), null);
});
