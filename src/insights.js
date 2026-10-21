/**
 * Pattern insights, computed by code from the web (no LLM). They are gentle,
 * tappable prompts; they never create nodes. Speculative links are ignored.
 * The server runs the same ideas as SPARQL over the Evidence Pack.
 */
import { betweenness } from './model/algorithms.js';
import { isPrivate } from './model/graph.js';

export function insights(store, { max = 6 } = {}) {
  const out = [];
  const nodes = [...store.nodes.values()].filter((n) => !isPrivate(n));
  const claims = nodes.filter((n) => n.type === 'Claim');

  // sources disagree
  for (const c of claims) {
    const disagree = [...store.edges.values()].some((e) => e.to === c.id && e.type === 'contradicts' && e.label !== 'speculative');
    if (disagree || c.verdict === 'contradicted' || c.verdict === 'mixed') {
      out.push({ kind: 'disagree', weight: 3, text: `Sources disagree: “${short(c.label)}”`, ids: [c.id] });
    }
  }
  // weak spots: only the reporting outlet
  const weak = claims.filter((c) => (c.evidence?.independentDomains ?? 1) <= 1 && c.verdict !== 'contradicted');
  if (weak.length) out.push({ kind: 'single-source', weight: 1, text: `${weak.length} claim${weak.length === 1 ? ' has' : 's have'} only one source`, ids: weak.map((c) => c.id) });

  // stories that share an entity (grounded mentions/involves)
  const news = nodes.filter((n) => n.type === 'NewsItem');
  if (news.length >= 2) {
    const byEntity = new Map();
    for (const e of store.edges.values()) {
      if (e.label === 'speculative' || (e.type !== 'mentions' && e.type !== 'involves')) continue;
      const src = store.nodes.get(e.from);
      const newsId = src?.type === 'NewsItem' ? e.from : null;
      if (!newsId) continue;
      if (!byEntity.has(e.to)) byEntity.set(e.to, new Set());
      byEntity.get(e.to).add(newsId);
    }
    for (const [ent, set] of byEntity) {
      if (set.size >= 2) {
        const n = store.nodes.get(ent);
        out.push({ kind: 'shared', weight: 2, text: `${set.size} stories share “${short(n?.label)}”`, ids: [ent, ...set] });
      }
    }
  }
  // bridge: the node most on paths between others (needs a few nodes)
  const view = store.view('all');
  const pub = { nodes: view.nodes.filter((n) => !isPrivate(n)), edges: view.edges.filter((e) => !isPrivate(store.nodes.get(e.from)) && !isPrivate(store.nodes.get(e.to))) };
  if (pub.nodes.length >= 8) {
    const bc = betweenness(pub);
    const best = [...bc].filter(([id]) => !['Claim', 'Source', 'NewsItem'].includes(store.nodes.get(id)?.type)).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0.15) out.push({ kind: 'bridge', weight: 1.5, text: `“${short(store.nodes.get(best[0])?.label)}” links parts of the web`, ids: [best[0]] });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, max);
}

function short(s, n = 48) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
