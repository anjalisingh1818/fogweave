/**
 * GraphEdge — a relation between two GraphNode entities.
 * Rendered as a line; dotted while 'suggested', solid once 'confirmed'.
 */
import { createComponent, Types } from '@iwsdk/core';

export const GraphEdge = createComponent('GraphEdge', {
  edgeId: { type: Types.String, default: '' }, // matches graph-store edge id
  fromId: { type: Types.String, default: '' },
  toId: { type: Types.String, default: '' },
  status: { type: Types.String, default: 'suggested' }, // suggested | confirmed
  confidence: { type: Types.Float32, default: 0.5 },
  // 0..1 — traveling light pulse when this edge is part of a
  // voice-queried relation path (see query-system.js)
  pathGlow: { type: Types.Float32, default: 0 },
});
