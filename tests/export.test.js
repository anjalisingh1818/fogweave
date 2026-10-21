import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore } from '../src/model/graph.js';
import { sealedView, buildJsonLd, buildJsonl, buildMarkdown, ATTRIBUTION } from '../src/export/pack.js';
import { insights } from '../src/insights.js';

const Q = (quote) => [{ quote, url: 'https://outlet.example/a', source: 'outlet.example', retrievedAt: '2026-10-20T10:00:00Z' }];

function web() {
  const s = new GraphStore();
  s.loadGraph({
    schema: 'fogweave.graph/2',
    topic: 't',
    nodes: [
      { id: 'n1', type: 'NewsItem', label: 'Port strike', outlet: 'outlet.example', date: '2026-10-19', url: 'https://outlet.example/a' },
      { id: 'n2', type: 'NewsItem', label: 'Shipping delays grow', outlet: 'other.example', date: '2026-10-20', url: 'https://other.example/b' },
      { id: 'ev', type: 'Event', label: 'Port strike' },
      { id: 'ship', type: 'Organisation', label: 'Shipping lines' },
      { id: 'c1', type: 'Claim', label: 'The port is closed', quote: 'the port is closed', verdict: 'contradicted', evidence: { independentDomains: 2, supports: 1, contradicts: 2 } },
      { id: 'c2', type: 'Claim', label: 'Ships wait offshore', quote: 'ships wait offshore', verdict: 'unverified', evidence: { independentDomains: 1 } },
      { id: 's1', type: 'Source', label: 'other.example', domain: 'other.example' },
      { id: 'ctx:rotterdam', type: 'ContextNode', label: 'Rotterdam', private: true },
    ],
    edges: [
      { type: 'about', from: 'n1', to: 'ev', label: 'reported', evidence: Q('port strike') },
      { type: 'reports', from: 'n1', to: 'c1', label: 'reported', evidence: Q('the port is closed') },
      { type: 'reports', from: 'n1', to: 'c2', label: 'reported', evidence: Q('ships wait offshore') },
      { type: 'contradicts', from: 's1', to: 'c1', label: 'reported', evidence: Q('the port reopened') },
      { type: 'mentions', from: 'n1', to: 'ship', label: 'reported', evidence: Q('shipping lines said') },
      { type: 'mentions', from: 'n2', to: 'ship', label: 'reported', evidence: Q('shipping lines warned') },
      { type: 'affects', from: 'ev', to: 'ship', label: 'inferred', reasoning: 'ships cannot dock', basis: ['c1'] },
      { type: 'same_as', from: 'ctx:rotterdam', to: 'ship', label: 'inferred', reasoning: 'x', basis: ['ship'] },
    ],
  });
  return s;
}

test('insights: disagreement, weak spots, shared entities; computed by code', () => {
  const list = insights(web());
  const kinds = list.map((i) => i.kind);
  assert.ok(kinds.includes('disagree'));
  assert.ok(kinds.includes('single-source'));
  assert.ok(kinds.includes('shared'));
  assert.ok(!list.some((i) => i.ids.includes('ctx:rotterdam')), 'private context never appears in insights');
});

test('pack: only sealed, never private; PROV-O statements with labels', () => {
  const s = web();
  s.seal('c1');
  s.seal('affects:ev->ship');
  const view = sealedView(s, { x1: { id: 'x1', headline: 'A sealed light', source: 'wire.example', url: 'https://wire.example/1', date: '2026-10-18', claims: [{ text: 'Card claim', quote: 'card claim words' }] } });
  assert.ok(!view.nodes.some((n) => n.type === 'ContextNode'));
  const doc = buildJsonLd(view, { generatedAt: '2026-10-20T12:00:00.000Z', notes: [{ text: 'my note' }], answers: [{ question: 'q?', text: 'a.' }] });
  assert.ok(doc['@context'].prov && !('@id' in doc), 'no top-level @id (would make a named graph)');
  const g = doc['@graph'];
  const stmts = g.filter((x) => x['@type']?.includes('rdf:Statement'));
  assert.ok(stmts.every((st) => st.linkLabel));
  const reported = stmts.filter((st) => st['@type'].includes('fw:ReportedStatement'));
  assert.ok(reported.length && reported.every((st) => st.derivedFrom?.[0]?.value && st.derivedFrom[0].primarySource));
  const inferred = stmts.find((st) => st['@type'].includes('fw:InferredStatement'));
  assert.ok(inferred.reasoning && inferred.basis.length && inferred['@type'].includes('fw:AffectsStatement'));
  assert.ok(!JSON.stringify(doc).includes('Rotterdam'));
  assert.ok(g.some((x) => x['@id'].startsWith('urn:fogweave:node:x1')), 'sealed light included');
});

test('jsonl and markdown carry quotes, labels and the attribution note', () => {
  const s = web();
  s.seal('c1');
  const view = sealedView(s);
  const lines = buildJsonl(view).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.kind === 'claim' && l.verdict === 'contradicted' && l.quote));
  for (const l of lines.filter((x) => x.kind === 'link')) assert.ok(['reported', 'inferred', 'speculative'].includes(l.label));
  const md = buildMarkdown(view, { generatedAt: '2026-10-20T12:00:00.000Z' });
  assert.ok(md.includes('Contradicted') && md.includes('Licence and attribution'));
  for (const a of ATTRIBUTION) assert.ok(md.includes(a.slice(0, 20)));
  for (const q of lines.filter((l) => l.quote).map((l) => l.quote)) assert.ok(q.split(/\s+/).length <= 25);
});
