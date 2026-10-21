/**
 * Evidence Pack: what the reader sealed, as a cited research dataset.
 *
 *  - pack.jsonld : JSON-LD with W3C PROV-O provenance. Every link is a
 *                  reified rdf:Statement carrying its label (reported /
 *                  inferred / speculative); evidence items are prov:Entity
 *                  with prov:value (short quote), prov:hadPrimarySource
 *                  (link) and prov:generatedAtTime (retrieval time).
 *  - claims.jsonl: one line per claim / link, easy to load anywhere.
 *  - README.md   : a human-readable report with the licence/attribution note.
 *
 * Links and short quotes only (25 words or fewer), never full article text.
 * The reader's private context is never included. Works offline; the server
 * (when reachable) validates it with SHACL and runs SPARQL queries.
 */
import { ONTOLOGY, VERDICT_STYLE, LABEL_STYLE } from '../model/schema.js';
import { isPrivate } from '../model/graph.js';

const FW = 'urn:fogweave:ontology:2#';

export const CONTEXT = {
  fw: FW,
  prov: 'http://www.w3.org/ns/prov#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  schema: 'https://schema.org/',
  dct: 'http://purl.org/dc/terms/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  label: 'rdfs:label',
  url: { '@id': 'schema:url', '@type': '@id' },
  sameAs: { '@id': 'schema:sameAs', '@type': '@id' },
  date: 'dct:date',
  outlet: 'fw:outlet',
  quote: 'fw:quote',
  verdict: 'fw:verdict',
  sourceClass: 'fw:sourceClass',
  independentDomains: { '@id': 'fw:independentDomains', '@type': 'xsd:integer' },
  supports: { '@id': 'fw:supportCount', '@type': 'xsd:integer' },
  contradicts: { '@id': 'fw:contradictCount', '@type': 'xsd:integer' },
  linkLabel: 'fw:label',
  reasoning: 'fw:reasoning',
  basis: { '@id': 'fw:basis', '@type': '@id' },
  subject: { '@id': 'rdf:subject', '@type': '@id' },
  predicate: { '@id': 'rdf:predicate', '@type': '@id' },
  object: { '@id': 'rdf:object', '@type': '@id' },
  derivedFrom: { '@id': 'prov:wasDerivedFrom', '@type': '@id' },
  primarySource: { '@id': 'prov:hadPrimarySource', '@type': '@id' },
  value: 'prov:value',
  generatedAtTime: { '@id': 'prov:generatedAtTime', '@type': 'xsd:dateTime' },
  attributedTo: { '@id': 'prov:wasAttributedTo', '@type': '@id' },
  generatedBy: { '@id': 'prov:wasGeneratedBy', '@type': '@id' },
};

export const ATTRIBUTION = [
  'Wikipedia text is CC BY-SA 4.0 (Wikipedia contributors); excerpts are attributed and linked.',
  'News metadata: The GDELT Project, https://www.gdeltproject.org/',
  'Via Hacker News (titles and links).',
  'Paper metadata from arXiv (CC0); not endorsed by arXiv.',
  'Quotes are short (25 words or fewer) and link to their sources; article texts are not included.',
];

const nodeIri = (id) => `urn:fogweave:node:${encodeURIComponent(id)}`;
const stmtIri = (id) => `urn:fogweave:stmt:${encodeURIComponent(id)}`;
const words = (q, n = 25) => String(q || '').split(/\s+/).slice(0, n).join(' ');

function iso(d) {
  const t = Date.parse(d || '');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Sealed, non-private part of the web (plus sealed lights not yet expanded). */
export function sealedView(store, sealedLights = {}) {
  const nodes = [...store.nodes.values()].filter((n) => n.sealed && !isPrivate(n));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...store.edges.values()].filter((e) => e.sealed && ids.has(e.from) && ids.has(e.to));
  for (const it of Object.values(sealedLights)) {
    if (ids.has(it.id)) continue;
    nodes.push({ id: it.id, type: 'NewsItem', label: it.headline, outlet: it.source, url: it.url, date: it.date, summary: it.summary, claimsFromCard: it.claims || [], sealed: true });
    ids.add(it.id);
  }
  return { nodes, edges };
}

export function buildJsonLd(view, { generatedAt = new Date().toISOString(), notes = [], answers = [] } = {}) {
  const graph = [];
  const tool = { '@id': 'urn:fogweave:agent:fogweave', '@type': ['prov:SoftwareAgent'], label: 'FogWeave' };
  graph.push(tool);
  for (const n of view.nodes) {
    const o = { '@id': nodeIri(n.id), '@type': [`fw:${n.type}`], label: n.label };
    if (n.url) o.url = n.url;
    if (n.date) o.date = String(n.date).slice(0, 10);
    if (n.outlet) o.outlet = n.outlet;
    if (n.qid) o.sameAs = `http://www.wikidata.org/entity/${n.qid}`;
    if (n.type === 'Claim') {
      o.quote = words(n.quote);
      o.verdict = n.verdict || 'unverified';
      const ev = n.evidence || {};
      o.independentDomains = ev.independentDomains ?? 1;
      o.supports = ev.supports ?? 0;
      o.contradicts = ev.contradicts ?? 0;
    }
    if (n.type === 'Source' && n.sourceClass) o.sourceClass = n.sourceClass;
    graph.push(o);
    // claims shown on a reader card for a sealed light that was never expanded
    (n.claimsFromCard || []).forEach((c, i) => {
      const cid = `${n.id}:card${i + 1}`;
      graph.push({ '@id': nodeIri(cid), '@type': ['fw:Claim'], label: c.text, quote: words(c.quote), verdict: 'unverified', independentDomains: 1, supports: 1, contradicts: 0 });
      graph.push(statement({ id: `reports:${n.id}->${cid}`, type: 'reports', from: n.id, to: cid, label: 'reported', evidence: [{ quote: c.quote, url: n.url, source: n.outlet, retrievedAt: generatedAt }] }, tool));
    });
  }
  for (const e of view.edges) graph.push(statement(e, tool));
  // evidence entities are attached inside statements (blank-node-free ids)
  notes.forEach((t, i) => graph.push({ '@id': `urn:fogweave:note:${i + 1}`, '@type': ['fw:Note', 'prov:Entity'], value: t.text || t }));
  answers.forEach((a, i) =>
    graph.push({ '@id': `urn:fogweave:answer:${i + 1}`, '@type': ['fw:Answer', 'prov:Entity'], label: a.question, value: a.text, generatedBy: tool['@id'] }),
  );
  // pack metadata is an ordinary node: a top-level @id next to @graph would
  // turn the whole pack into a named graph
  graph.unshift({
    '@id': `urn:fogweave:pack:${generatedAt}`,
    '@type': ['prov:Bundle', 'fw:EvidencePack'],
    'dct:created': generatedAt,
    'dct:description': `FogWeave Evidence Pack (ontology ${ONTOLOGY.version}). A cited research dataset: links and short quotes only.`,
    'dct:rights': ATTRIBUTION.join(' '),
  });
  return { '@context': CONTEXT, '@graph': graph };
}

function statement(e, tool) {
  const types = ['rdf:Statement', 'prov:Entity', `fw:${cap(e.label || 'reported')}Statement`];
  if (e.type === 'affects') types.push('fw:AffectsStatement');
  const s = {
    '@id': stmtIri(e.id),
    '@type': types,
    subject: nodeIri(e.from),
    predicate: `fw:${e.type}`,
    object: nodeIri(e.to),
    linkLabel: e.label || 'reported',
    generatedBy: tool['@id'],
  };
  const ev = (e.evidence || []).filter((x) => x && x.quote && x.url);
  if (ev.length) {
    s.derivedFrom = ev.map((x, i) => ({
      '@id': `${stmtIri(e.id)}:ev${i + 1}`,
      '@type': ['prov:Entity'],
      value: words(x.quote),
      primarySource: x.url,
      ...(iso(x.retrievedAt) ? { generatedAtTime: iso(x.retrievedAt) } : {}),
      ...(x.source ? { 'fw:source': x.source } : {}),
    }));
  }
  if (e.reasoning) s.reasoning = e.reasoning;
  if (e.basis?.length) s.basis = e.basis.map((b) => (b.includes('->') ? stmtIri(b) : nodeIri(b)));
  return s;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildJsonl(view) {
  const nodes = new Map(view.nodes.map((n) => [n.id, n]));
  const lines = [];
  for (const n of view.nodes) {
    if (n.type === 'Claim') {
      lines.push({ kind: 'claim', id: n.id, text: n.label, quote: words(n.quote), verdict: n.verdict || 'unverified', evidence: n.evidence || {}, reportedBy: n.reportedBy || null, url: n.url || null });
    }
    if (n.type === 'NewsItem') lines.push({ kind: 'news', id: n.id, headline: n.label, outlet: n.outlet, date: n.date, url: n.url });
  }
  for (const e of view.edges) {
    lines.push({
      kind: 'link',
      id: e.id,
      from: nodes.get(e.from)?.label,
      relation: e.type,
      to: nodes.get(e.to)?.label,
      label: e.label || 'reported',
      reasoning: e.reasoning || null,
      evidence: (e.evidence || []).map((x) => ({ quote: words(x.quote), url: x.url, source: x.source, retrievedAt: x.retrievedAt })),
    });
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

export function buildMarkdown(view, { generatedAt = new Date().toISOString(), notes = [], answers = [], validation = null } = {}) {
  const nodes = new Map(view.nodes.map((n) => [n.id, n]));
  const md = [];
  md.push(`# FogWeave Evidence Pack`, '', `Created ${generatedAt.slice(0, 16).replace('T', ' ')} UTC · ontology ${ONTOLOGY.version}`, '');
  md.push('A cited research dataset of what you sealed. Links and short quotes only. Impact links are possible effects, not predictions or advice.', '');
  const news = view.nodes.filter((n) => n.type === 'NewsItem');
  if (news.length) {
    md.push('## News', '');
    for (const n of news) md.push(`- **${esc(n.label)}** · ${n.outlet || ''} · ${String(n.date || '').slice(0, 10)} · [link](${n.url})`);
    md.push('');
  }
  const claims = view.nodes.filter((n) => n.type === 'Claim');
  if (claims.length) {
    md.push('## Claims', '');
    for (const c of claims) {
      const v = VERDICT_STYLE[c.verdict || 'unverified'];
      const ev = c.evidence || {};
      md.push(`- **${v.label}** (${v.ring} ring): ${esc(c.label)}`);
      md.push(`  - “${esc(words(c.quote))}”`);
      md.push(`  - ${ev.independentDomains ?? 1} independent domain(s) · ${ev.supports ?? 0} support · ${ev.contradicts ?? 0} contradict · ${ev.unclear ?? 0} unclear`);
    }
    md.push('');
  }
  const links = view.edges.filter((e) => !['mentions', 'reports'].includes(e.type));
  if (links.length) {
    md.push('## Links', '');
    for (const e of links) {
      const s = LABEL_STYLE[e.label || 'reported'];
      const why = e.label === 'inferred' || e.label === 'speculative' ? ` — ${esc(e.reasoning || '')}` : e.evidence?.[0] ? ` — “${esc(words(e.evidence[0].quote))}” ([source](${e.evidence[0].url}))` : '';
      md.push(`- *${s.label}*: ${esc(nodes.get(e.from)?.label)} → ${e.type.replace('_', ' ')} → ${esc(nodes.get(e.to)?.label)}${why}`);
    }
    md.push('');
  }
  if (answers.length) {
    md.push('## Answers', '');
    for (const a of answers) md.push(`- **${esc(a.question)}** ${esc(a.text)}`);
    md.push('');
  }
  if (notes.length) {
    md.push('## Notes', '');
    for (const n of notes) md.push(`- ${esc(n.text || n)}`);
    md.push('');
  }
  if (validation) {
    md.push('## Validation', '', `SHACL: ${validation.shacl?.conforms ? 'conforms' : `${validation.shacl?.violations} violation(s)`} · ${validation.triples} triples`, '');
  }
  md.push('## Licence and attribution', '', ...ATTRIBUTION.map((a) => `- ${a}`), '');
  return md.join('\n');
}

function esc(s) {
  return String(s ?? '').replace(/[[\]*_`]/g, (c) => `\\${c}`);
}
