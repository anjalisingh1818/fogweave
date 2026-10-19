/**
 * GraphNode — one piece of knowledge floating in the gray fog.
 */
import { createComponent, Types } from '@iwsdk/core';

export const GraphNode = createComponent('GraphNode', {
  nodeId: { type: Types.String, default: '' },
  topic: { type: Types.String, default: '' },
  status: { type: Types.String, default: 'draft' }, // draft | researching | confirmed
  glow: { type: Types.Float32, default: 0 },
  highlighted: { type: Types.Boolean, default: false },
  // --- Divination readouts ---
  // 0..1, degree-centrality based, recomputed whenever edges change.
  // Revealed by the LOCKET (bring it near the node).
  importance: { type: Types.Float32, default: 0 },
  // 0..1, AI-judged confidence this node's info is trustworthy.
  // Revealed by the COIN (flip it near the node).
  reliability: { type: Types.Float32, default: 0.5 },
  // true for a few seconds right after a prop reveals a readout
  revealing: { type: Types.Boolean, default: false },
  // which readout is currently on display: 'importance' | 'reliability' | ''
  revealKind: { type: Types.String, default: '' },
  // true while the AI summary panel is open (toggled by pinching the node)
  expanded: { type: Types.Boolean, default: false },
});
