/**
 * Build an Evidence Pack (JSON-LD) from recorded event logs, with everything
 * sealed, so the server can SHACL-validate exactly what the client produces.
 *   node scripts/pack-from-runs.mjs <dir with *.json runs> <out.jsonld>
 * Each run file has { events: [...] } (eval runs or snapshot expansions).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GraphStore } from '../src/model/graph.js';
import { applyEvent } from '../src/research/events.js';
import { sealedView, buildJsonLd } from '../src/export/pack.js';

const [dir, out] = process.argv.slice(2);
const store = new GraphStore();
store.setMeta({ topic: 'eval', topicKey: 'eval' });
let files = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (!Array.isArray(rec.events)) continue;
  files++;
  for (const ev of rec.events) applyEvent(store, ev);
}
for (const n of [...store.nodes.values()]) store.seal(n.id);
for (const e of [...store.edges.values()]) store.seal(e.id);
const view = sealedView(store);
writeFileSync(out, JSON.stringify(buildJsonLd(view, { generatedAt: new Date().toISOString() })));
console.log(JSON.stringify({ runs: files, nodes: view.nodes.length, links: view.edges.length, rejectedByClient: store.rejected.length, rejected: store.rejected.slice(0, 5).map((r) => r.problem) }));
