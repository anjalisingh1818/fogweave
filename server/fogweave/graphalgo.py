"""Graph algorithms over the news graph (networkx). Each feeds something the
user sees; see docs/ALGORITHMS.md for what each can and cannot say.

Speculative links are excluded from rankings, paths and insights.
"""

from __future__ import annotations

import networkx as nx

LABEL_COST = {"reported": 1.0, "inferred": 2.0}  # speculative: not walkable


def build(nodes: list[dict], edges: list[dict]) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    for n in nodes:
        g.add_node(n["id"], **n)
    for e in edges:
        if e.get("from") in g and e.get("to") in g:
            g.add_edge(e["from"], e["to"], key=e.get("id"), **e)
    return g


def grounded(g: nx.MultiDiGraph) -> nx.Graph:
    """Undirected simple graph of reported/inferred links; each pair keeps its
    cheapest label (Reported beats Inferred)."""
    u = nx.Graph()
    u.add_nodes_from(g.nodes(data=True))
    for a, b, d in g.edges(data=True):
        cost = LABEL_COST.get(d.get("label"))
        if cost is None:
            continue
        if not u.has_edge(a, b) or cost < u[a][b]["cost"]:
            u.add_edge(a, b, cost=cost, label=d.get("label"), type=d.get("type"), id=d.get("id"))
    return u


def personalized_pagerank(g: nx.MultiDiGraph, seeds: list[str], alpha: float = 0.85) -> dict[str, float]:
    """Relevance to the user's context nodes. Empty seeds -> plain PageRank."""
    u = grounded(g)
    if not u.number_of_nodes():
        return {}
    pers = {s: 1.0 for s in seeds if s in u}
    for a, b, d in u.edges(data=True):
        d["w"] = 1.0 / d["cost"]
    return nx.pagerank(u, alpha=alpha, personalization=pers or None, weight="w")


def best_path(g: nx.MultiDiGraph, source: str, targets: list[str]) -> dict | None:
    """Cheapest grounded path from a news item to any context node, with the
    label of every hop. None means 'no clear connection found'."""
    u = grounded(g)
    if source not in u:
        return None
    best = None
    for t in targets:
        if t not in u or t == source:
            continue
        try:
            nodes = nx.dijkstra_path(u, source, t, weight="cost")
        except nx.NetworkXNoPath:
            continue
        cost = sum(u[a][b]["cost"] for a, b in zip(nodes, nodes[1:]))
        if best is None or cost < best["cost"]:
            hops = [{"from": a, "to": b, "label": u[a][b]["label"], "type": u[a][b]["type"], "edge": u[a][b]["id"]} for a, b in zip(nodes, nodes[1:])]
            best = {"nodes": nodes, "hops": hops, "cost": cost}
    return best


def stories(g: nx.MultiDiGraph, seed: int = 42) -> list[set[str]]:
    """Communities (Louvain) = stories/themes for the colour halo."""
    u = grounded(g)
    if u.number_of_edges() == 0:
        return [{n} for n in u.nodes]
    return [set(c) for c in nx.community.louvain_communities(u, weight=None, seed=seed)]


def bridges(g: nx.MultiDiGraph, top: int = 3) -> list[tuple[str, float]]:
    """Nodes that sit between parts of the web (betweenness), e.g. a story
    linking two topics."""
    u = grounded(g)
    if u.number_of_nodes() < 3:
        return []
    bc = nx.betweenness_centrality(u, normalized=True)
    return [(n, round(v, 3)) for n, v in sorted(bc.items(), key=lambda x: (-x[1], x[0]))[:top] if v > 0]


def timeline(g: nx.MultiDiGraph, start: str) -> list[str]:
    """Story order along `follows` links (newer follows older), oldest first,
    ties by date."""
    f = nx.DiGraph()
    for a, b, d in g.edges(data=True):
        if d.get("type") == "follows" and d.get("label") != "speculative":
            f.add_edge(b, a)  # a follows b  =>  b comes first
    if start not in f:
        return [start]
    comp = nx.node_connected_component(f.to_undirected(), start)
    sub = f.subgraph(comp)
    date = lambda n: g.nodes[n].get("date", "") if n in g else ""  # noqa: E731
    return list(nx.lexicographical_topological_sort(sub, key=date)) if nx.is_directed_acyclic_graph(sub) else sorted(comp, key=date)


def link_suggestions(g: nx.MultiDiGraph, similarity: dict[tuple[str, str], float] | None = None, top: int = 5) -> list[dict]:
    """Unlinked pairs that share neighbours (Jaccard) and/or are textually
    similar. Always returned as SPECULATIVE relates_to suggestions."""
    u = grounded(g)
    similarity = similarity or {}
    cands = []
    for a, b, j in nx.jaccard_coefficient(u):
        s = similarity.get((a, b), similarity.get((b, a), 0.0))
        score = 0.6 * j + 0.4 * s
        if score > 0.25:
            cands.append({"from": a, "to": b, "type": "relates_to", "label": "speculative", "score": round(score, 3)})
    return sorted(cands, key=lambda c: (-c["score"], c["from"], c["to"]))[:top]
