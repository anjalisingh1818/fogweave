/** Runs the force layout off the main thread. */
import { forceLayout } from './force.js';

self.onmessage = (event) => {
  const { requestId, nodes, edges, previous, iterations } = event.data;
  const t0 = performance.now();
  const positions = forceLayout(nodes, edges, { previous, iterations });
  self.postMessage({ requestId, positions, ms: performance.now() - t0 });
};
