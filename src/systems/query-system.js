/**
 * "How are A and B related?" — a THIRD divination gesture: hold BOTH
 * tools at once (locket in one hand, coin in the other) and speak the
 * question. Neither tool alone means "find a path"; using both
 * together does, which keeps the single-prop gestures (locket=
 * importance, coin=reliability) unambiguous.
 *
 * Runs shortestPath() over graph-algorithms.js (confirmed edges only)
 * and highlights the resulting nodes + edges for a few seconds.
 */
import { createSystem, Grabbed } from '@iwsdk/core';
import { DivinationProp } from '../components/divination-prop.js';
import { GraphNode } from '../components/graph-node.js';
import { GraphEdge } from '../components/graph-edge.js';
import { nodeEntities } from '../entity-index.js';
import * as graphStore from '../graph-store.js';
import { shortestPath } from '../graph-algorithms.js';
import { listenOnce } from '../voice-input.js';

const HIGHLIGHT_DURATION_MS = 5000;

export class QuerySystem extends createSystem({
  props: { required: [DivinationProp] },
  edges: { required: [GraphEdge] },
}) {
  init() {
    this._bothHeldLast = false;
    this._busy = false;
  }

  update() {
    if (this._busy) return;
    let heldCount = 0;
    this.queries.props.entities.forEach((e) => {
      if (e.hasComponent(Grabbed)) heldCount++;
    });
    const bothHeld = heldCount >= 2;

    if (bothHeld && !this._bothHeldLast) {
      this._runQuery();
    }
    this._bothHeldLast = bothHeld;
  }

  async _runQuery() {
    this._busy = true;
    try {
      const question = await listenOnce({ timeoutMs: 8000 });
      if (!question) return;

      const parts = question.split(/\s+(?:and|aur)\s+/i);
      if (parts.length < 2) {
        console.info('[fogweave] relation query needs two topics, e.g. "A and B"');
        return;
      }
      const a = graphStore.findNodeByTopic(parts[0]);
      const b = graphStore.findNodeByTopic(parts[1]);
      if (!a || !b) {
        console.info('[fogweave] could not match both topics to existing nodes');
        return;
      }

      const result = shortestPath(a.id, b.id);
      if (!result) {
        console.info('[fogweave] no confirmed path between those nodes yet');
        return;
      }
      this._highlight(result.path, result.edgeIds);
    } finally {
      this._busy = false;
    }
  }

  _highlight(nodeIds, edgeIds) {
    for (const nodeId of nodeIds) {
      const entity = nodeEntities.get(nodeId);
      if (!entity) continue;
      entity.setValue(GraphNode, 'highlighted', true);
      setTimeout(() => {
        if (entity.hasComponent(GraphNode)) entity.setValue(GraphNode, 'highlighted', false);
      }, HIGHLIGHT_DURATION_MS);
    }
    this.queries.edges.entities.forEach((entity) => {
      const edgeId = entity.getValue(GraphEdge, 'edgeId');
      if (!edgeIds.includes(edgeId)) return;
      entity.setValue(GraphEdge, 'pathGlow', 1);
      setTimeout(() => {
        if (entity.hasComponent(GraphEdge)) entity.setValue(GraphEdge, 'pathGlow', 0);
      }, HIGHLIGHT_DURATION_MS);
    });
  }
}
