/**
 * DivinationProp — marks an entity as a hand-held divination tool.
 * kind: 'locket' (swing near a node -> importance/centrality)
 *       'coin'   (flip near a node -> reliability; in open air -> most important node)
 * Holding both at once + speaking "A and B" -> shortest path (query-system.js).
 */
import { createComponent, Types } from '@iwsdk/core';

export const DivinationProp = createComponent('DivinationProp', {
  kind: { type: Types.String, default: 'locket' },
  // true while held in a hand (mirrors Grabbed, cached each frame for convenience)
  active: { type: Types.Boolean, default: false },
});
