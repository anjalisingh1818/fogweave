import { defineComponents } from '@iwsdk/core';
import { GraphNode } from './components/graph-node.js';
import { GraphEdge } from './components/graph-edge.js';
import { DivinationProp } from './components/divination-prop.js';
import { ConfirmMarker } from './components/confirm-marker.js';

export default defineComponents([GraphNode, GraphEdge, DivinationProp, ConfirmMarker]);
export { GraphNode, GraphEdge, DivinationProp, ConfirmMarker };
