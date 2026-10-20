/**
 * FogWeave graph schema (V2 news impact graph). The ontology itself lives
 * in shared/ontology.v2.json, the same file the server validates against,
 * so domain/range rules cannot drift between client and server.
 * Pure data: no three.js, safe in workers and tests.
 */
import ONTOLOGY from '../../shared/ontology.v2.json' with { type: 'json' };

export { ONTOLOGY };
export const SCHEMA_ID = 'fogweave.graph/2';
export const NODE_TYPES = ONTOLOGY.classes;
export const ENTITY_TYPES = ONTOLOGY.groups.Entity;
export const LABELS = Object.keys(ONTOLOGY.labels); // reported | inferred | speculative

const expand = (types) => new Set(types.flatMap((t) => (t.startsWith('@') ? ONTOLOGY.groups[t.slice(1)] : [t])));
export const EDGE_RULES = Object.fromEntries(
  Object.entries(ONTOLOGY.relations).map(([name, r]) => [
    name,
    { domain: expand(r.domain), range: expand(r.range), labels: new Set(r.labels || LABELS) },
  ]),
);
export const EDGE_TYPES = Object.keys(EDGE_RULES);

export const VERDICTS = ['supported', 'contradicted', 'mixed', 'unverified'];

/**
 * Colour + ring language for claims. Ring style carries the verdict
 * without colour (colour-blind safe): solid / double / dashed / dotted.
 */
export const VERDICT_STYLE = {
  supported: { label: 'Well supported', color: 0x4da3ff, css: '#4da3ff', ring: 'solid' },
  contradicted: { label: 'Contradicted', color: 0xff5c5c, css: '#ff5c5c', ring: 'double' },
  mixed: { label: 'Mixed', color: 0xb388ff, css: '#b388ff', ring: 'dashed' },
  unverified: { label: 'Unverified', color: 0x9aa0a8, css: '#9aa0a8', ring: 'dotted' },
};

/** Node look per class: colour, world size (m), shape family. */
export const TYPE_STYLE = {
  NewsItem: { color: 0xffe2a8, size: 0.04, shape: 'star', label: 'News' },
  Event: { color: 0xf2b866, size: 0.034, shape: 'gem', label: 'Event' },
  Organisation: { color: 0x7fc8b8, size: 0.024, shape: 'box', label: 'Organisation' },
  Place: { color: 0x9fd88a, size: 0.024, shape: 'ball', label: 'Place' },
  Topic: { color: 0xc4b5e8, size: 0.022, shape: 'gem', label: 'Topic' },
  Technology: { color: 0x8fd8ff, size: 0.022, shape: 'star', label: 'Technology' },
  PublicFigure: { color: 0xf0a8c0, size: 0.022, shape: 'ball', label: 'Public figure' },
  ContextNode: { color: 0xffd36e, size: 0.03, shape: 'box', label: 'Your context' },
  Claim: { color: null, size: 0.026, shape: 'ball', label: 'Claim' }, // colour comes from the verdict
  Source: { color: 0x8fa3b8, size: 0.016, shape: 'star', label: 'Source' },
};

/** Link label -> line style. Speculative is faint and never ranked. */
export const LABEL_STYLE = {
  reported: { label: 'Reported', dash: null, opacity: [0.42, 0.9], css: '#d6dde6', note: 'a source says it' },
  inferred: { label: 'Inferred', dash: [0.03, 0.02], opacity: [0.38, 0.85], css: '#f2c27a', note: 'reasoned from reported facts' },
  speculative: { label: 'Speculative', dash: [0.006, 0.022], opacity: [0.16, 0.3], css: '#8a9099', note: 'plausible, weakly supported' },
};

/** Relation -> line colour family. */
export const RELATION_COLOR = {
  supports: 0x7fb6ff,
  contradicts: 0xff6b6b,
  affects: 0xf2b866,
  depends_on: 0xf2b866,
  follows: 0xe8e8f0,
  same_as: 0xffd36e,
  relates_to: 0x8a9099,
};
export const DEFAULT_RELATION_COLOR = 0x9aa7b6; // mentions, about, reports, involves, happened_in, part_of, competes_with

export const SOURCE_CLASSES = ['government', 'education', 'organisation', 'news', 'reference', 'blog', 'unknown'];

/** Returns null when the statement is valid, else a short reason. */
export function validateEdge(edge, nodesById) {
  const rule = EDGE_RULES[edge.type];
  if (!rule) return `unknown relation ${edge.type}`;
  const s = nodesById.get(edge.from);
  const o = nodesById.get(edge.to);
  if (!s || !o) return 'dangling endpoint';
  if (edge.from === edge.to) return 'self loop';
  if (!rule.domain.has(s.type)) return `${edge.type} cannot start at ${s.type}`;
  if (!rule.range.has(o.type)) return `${edge.type} cannot end at ${o.type}`;
  const label = edge.label || 'reported';
  if (!LABELS.includes(label)) return `unknown label ${label}`;
  if (!rule.labels.has(label)) return `${edge.type} must be ${[...rule.labels].join('/')}`;
  if (label === 'reported' && !(edge.evidence || []).some((e) => e && e.quote && e.url)) {
    return 'reported link without a quoted, linked source';
  }
  if (label === 'inferred' && (!edge.reasoning || !(edge.basis || []).length)) return 'inferred link without reasoning and basis';
  return null;
}

export function validateNode(node) {
  if (!node || typeof node.id !== 'string' || !node.id) return 'missing id';
  if (!NODE_TYPES.includes(node.type)) return `unknown type ${node.type}`;
  if (typeof node.label !== 'string' || !node.label.trim()) return 'missing label';
  if (node.type === 'Claim' && node.verdict && !VERDICTS.includes(node.verdict)) return `unknown verdict ${node.verdict}`;
  if (node.type === 'NewsItem' && (!node.outlet || !node.date)) return 'NewsItem needs an outlet and a date';
  return null;
}
