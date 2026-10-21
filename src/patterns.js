/**
 * Connect the dots, the part that needs no model: names the Library items
 * share. A person, organisation, place, topic or event that two or more sealed
 * items link to in the web, or that their own text names. Reported: it comes
 * from the sources' own links and words. (Patterns that need reading the items
 * together, such as a recurring event or a sequence, come from the engine.)
 */
const THINGS = new Set(['PublicFigure', 'Organisation', 'Place', 'Topic', 'Technology', 'Event']);

function names(text, label) {
  if (!label || label.length < 3) return false;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

export function sharedPatterns(store, items, { max = 3 } = {}) {
  const ids = new Set(items.map((i) => i.id));
  const textOf = new Map(items.map((i) => [i.id, `${i.label}. ${i.text || ''}`]));
  const found = [];
  for (const n of store.nodes.values()) {
    // proper names only ("Perikatan Nasional", not "component parties")
    if (!THINGS.has(n.type) || ids.has(n.id) || n.derived || !/^\p{Lu}/u.test(n.label || '')) continue;
    const linked = new Set(store.neighbors(n.id).map((x) => x.id).filter((x) => ids.has(x)));
    for (const [id, text] of textOf) if (names(text, n.label)) linked.add(id);
    if (linked.size >= 2) found.push({ node: n, items: [...linked] });
  }
  // the most shared first; a big place (a country) after specific names
  found.sort((a, b) => b.items.length - a.items.length || (a.node.type === 'Place') - (b.node.type === 'Place'));
  return found.slice(0, max).map(({ node, items: its }) => ({
    kind: 'shared',
    label: 'reported',
    text: `${its.length} of your items name ${node.label}.`,
    items: its,
    via: node.id,
    quotes: [],
  }));
}
