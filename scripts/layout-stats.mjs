// Layout quality check: node spacing in metres inside the seated bubble.
//   node scripts/layout-stats.mjs public/demo/fixture-a.json
import { readFileSync } from 'node:fs';
import { forceLayout } from '../src/layout/force.js';

const RADIUS = 0.5;
for (const file of process.argv.slice(2)) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const t0 = performance.now();
  const pos = forceLayout(doc.nodes, doc.edges);
  const ms = performance.now() - t0;
  const ids = Object.keys(pos);
  const nn = ids.map((a) => {
    let best = Infinity;
    for (const b of ids) if (a !== b) best = Math.min(best, Math.hypot(...pos[a].map((v, i) => v - pos[b][i])));
    return best * RADIUS;
  });
  nn.sort((x, y) => x - y);
  const radii = ids.map((id) => Math.hypot(...pos[id]) * RADIUS).sort((x, y) => x - y);
  const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))].toFixed(3);
  console.log(
    `${file}: ${ids.length} nodes, ${ms.toFixed(0)} ms | nearest-neighbour m: min ${q(nn, 0)} p10 ${q(nn, 0.1)} median ${q(nn, 0.5)} | radius m: median ${q(radii, 0.5)} p90 ${q(radii, 0.9)} max ${q(radii, 1)}`,
  );
}
