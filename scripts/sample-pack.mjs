/**
 * Build an Evidence Pack from the recorded snapshot (every expansion sealed)
 * so server tests can validate exactly what the client produces.
 *   node scripts/sample-pack.mjs  ->  qa/fixtures/pack-sample.jsonld (+ .md, .jsonl)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { GraphStore } from '../src/model/graph.js';
import { applyEvent } from '../src/research/events.js';
import { sealedView, buildJsonLd, buildJsonl, buildMarkdown } from '../src/export/pack.js';

const index = JSON.parse(readFileSync('public/demo/snapshot/index.json', 'utf8'));
const store = new GraphStore();
store.setMeta({ topic: 'News web', topicKey: 'news' });
for (const file of Object.values(index.expansions)) {
  const rec = JSON.parse(readFileSync(`public/demo/snapshot/${file}`, 'utf8'));
  for (const ev of rec.events) applyEvent(store, ev);
}
for (const n of [...store.nodes.values()]) store.seal(n.id);
for (const e of [...store.edges.values()]) store.seal(e.id);
const view = sealedView(store);
const generatedAt = '2026-10-20T12:00:00.000Z';
mkdirSync('qa/fixtures', { recursive: true });
writeFileSync('qa/fixtures/pack-sample.jsonld', JSON.stringify(buildJsonLd(view, { generatedAt }), null, 1));
writeFileSync('qa/fixtures/pack-sample.jsonl', buildJsonl(view));
writeFileSync('qa/fixtures/pack-sample.md', buildMarkdown(view, { generatedAt }));
console.log(`pack: ${view.nodes.length} nodes, ${view.edges.length} links, rejected while replaying: ${store.rejected.length}`);
