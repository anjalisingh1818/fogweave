/**
 * nodeId (graph-store) -> ECS entity, so systems that only have a
 * logical id (edges, divination targets) can find the live entity.
 */
export const nodeEntities = new Map();
