/**
 * FogWeave graph schema (client copy of the ontology in docs/ONTOLOGY.md).
 * Node types, edge types with domain/range rules, verdict classes, and
 * the colour/ring language. Pure data: no three.js, safe in workers/tests.
 */

export const SCHEMA_ID = 'fogweave.graph/1';

export const NODE_TYPES = ['Topic', 'Claim', 'Source', 'Entity'];

// relation -> allowed subject types / object types
export const EDGE_RULES = {
  supports: { domain: ['Source', 'Claim'], range: ['Claim'] },
  contradicts: { domain: ['Source', 'Claim'], range: ['Claim'] },
  cites: { domain: ['Claim'], range: ['Source'] },
  relates_to: { domain: NODE_TYPES, range: NODE_TYPES },
  part_of: { domain: NODE_TYPES, range: NODE_TYPES },
  causes: { domain: ['Claim', 'Entity', 'Topic'], range: ['Claim', 'Entity', 'Topic'] },
};
export const EDGE_TYPES = Object.keys(EDGE_RULES);

export const VERDICTS = ['supported', 'contradicted', 'mixed', 'unverified'];

/**
 * Colour + ring language. Ring style carries the verdict without colour
 * (colour-blind safe): solid / double / dashed / dotted.
 */
export const VERDICT_STYLE = {
  supported: { label: 'Well supported', color: 0x4da3ff, css: '#4da3ff', ring: 'solid' },
  contradicted: { label: 'Contradicted', color: 0xff5c5c, css: '#ff5c5c', ring: 'double' },
  mixed: { label: 'Mixed', color: 0xb388ff, css: '#b388ff', ring: 'dashed' },
  unverified: { label: 'Unverified', color: 0x9aa0a8, css: '#9aa0a8', ring: 'dotted' },
};

export const TYPE_STYLE = {
  Topic: { color: 0xf2ead8, size: 0.05 },
  Claim: { color: null, size: 0.028 }, // colour comes from the verdict
  Source: { color: 0x8fa3b8, size: 0.018 },
  Entity: { color: 0x7fb8b0, size: 0.022 },
};

// edge render groups: each gets its own colour + dash pattern
export const EDGE_STYLE = {
  supports: { group: 'supports', color: 0x7fb6ff, dash: null },
  contradicts: { group: 'contradicts', color: 0xff6b6b, dash: [0.03, 0.02] },
  cites: { group: 'cites', color: 0x6f7d8c, dash: null },
  relates_to: { group: 'relates', color: 0xa0a6ad, dash: [0.008, 0.012] },
  part_of: { group: 'relates', color: 0xa0a6ad, dash: [0.008, 0.012] },
  causes: { group: 'relates', color: 0xa0a6ad, dash: [0.008, 0.012] },
};

export const SOURCE_CLASSES = ['government', 'education', 'organisation', 'news', 'blog', 'unknown'];

/** Returns null when the triple is valid, else a short reason. */
export function validateEdge(edge, nodesById) {
  const rule = EDGE_RULES[edge.type];
  if (!rule) return `unknown relation ${edge.type}`;
  const s = nodesById.get(edge.from);
  const o = nodesById.get(edge.to);
  if (!s || !o) return 'dangling endpoint';
  if (edge.from === edge.to) return 'self loop';
  if (!rule.domain.includes(s.type)) return `${edge.type} cannot start at ${s.type}`;
  if (!rule.range.includes(o.type)) return `${edge.type} cannot end at ${o.type}`;
  return null;
}

export function validateNode(node) {
  if (!node || typeof node.id !== 'string' || !node.id) return 'missing id';
  if (!NODE_TYPES.includes(node.type)) return `unknown type ${node.type}`;
  if (typeof node.label !== 'string' || !node.label.trim()) return 'missing label';
  if (node.type === 'Claim' && node.verdict && !VERDICTS.includes(node.verdict)) {
    return `unknown verdict ${node.verdict}`;
  }
  return null;
}
