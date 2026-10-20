/**
 * Small deterministic 3D force layout (repulsion + springs + centring).
 * O(n^2) repulsion is fine for the <=150 visible nodes we allow.
 * Output coordinates are normalised so the web fits a unit sphere;
 * the renderer maps that sphere into the seated bubble.
 *
 * Deterministic: initial positions come from a hash of the node id,
 * so the same web always lands in the same shape (spatial memory).
 */

export function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function seedPosition(id) {
  // point on a sphere shell from the id hash
  const u = hash01(id, 1) * 2 - 1;
  const t = hash01(id, 2) * Math.PI * 2;
  const r = 0.6 + 0.4 * hash01(id, 3);
  const s = Math.sqrt(1 - u * u);
  return [r * s * Math.cos(t), r * u, r * s * Math.sin(t)];
}

/**
 * @param {{id:string,type?:string}[]} nodes
 * @param {{from:string,to:string,type?:string}[]} edges
 * @param {{iterations?:number, previous?:Record<string,[number,number,number]>}} opts
 * @returns {Record<string,[number,number,number]>}
 */
export function forceLayout(nodes, edges, { iterations = 220, previous = {} } = {}) {
  const n = nodes.length;
  if (!n) return {};
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  nodes.forEach((nd, i) => {
    const p = previous[nd.id] || seedPosition(nd.id);
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
  });
  const springs = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    // claim<->source links stay short so sources orbit their claims
    const rest = e.type === 'cites' || e.type === 'supports' || e.type === 'contradicts' ? 0.22 : 0.42;
    springs.push([a, b, rest]);
  }
  const isTopic = nodes.map((nd) => nd.type === 'Topic');
  const repulse = 0.012 * Math.min(1, 40 / n + 0.3);
  const warm = Object.keys(previous).length > 0;
  let alpha = warm ? 0.35 : 1;
  const decay = Math.pow(0.002, 1 / iterations);

  for (let it = 0; it < iterations; it++) {
    // repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i * 3] - pos[j * 3];
        let dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        let dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-6) {
          dx = (hash01(nodes[i].id + nodes[j].id) - 0.5) * 1e-3;
          dy = 1e-3;
          dz = 0;
          d2 = dx * dx + dy * dy;
        }
        const f = (repulse * alpha) / d2;
        const inv = 1 / Math.sqrt(d2);
        vel[i * 3] += dx * inv * f;
        vel[i * 3 + 1] += dy * inv * f;
        vel[i * 3 + 2] += dz * inv * f;
        vel[j * 3] -= dx * inv * f;
        vel[j * 3 + 1] -= dy * inv * f;
        vel[j * 3 + 2] -= dz * inv * f;
      }
    }
    // springs
    for (const [a, b, rest] of springs) {
      const dx = pos[b * 3] - pos[a * 3];
      const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = ((d - rest) / d) * 0.08 * alpha;
      vel[a * 3] += dx * f;
      vel[a * 3 + 1] += dy * f;
      vel[a * 3 + 2] += dz * f;
      vel[b * 3] -= dx * f;
      vel[b * 3 + 1] -= dy * f;
      vel[b * 3 + 2] -= dz * f;
    }
    // centring (topics pulled harder so they sit in the middle)
    for (let i = 0; i < n; i++) {
      const k = (isTopic[i] ? 0.05 : 0.012) * alpha;
      vel[i * 3] -= pos[i * 3] * k;
      vel[i * 3 + 1] -= pos[i * 3 + 1] * k;
      vel[i * 3 + 2] -= pos[i * 3 + 2] * k;
    }
    for (let i = 0; i < n * 3; i++) {
      vel[i] *= 0.6;
      pos[i] += vel[i];
    }
    alpha *= decay;
  }

  // normalise to a unit sphere around the centroid
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += pos[i * 3];
    cy += pos[i * 3 + 1];
    cz += pos[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let maxR = 1e-6;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pos[i * 3] - cx, pos[i * 3 + 1] - cy, pos[i * 3 + 2] - cz);
    if (r > maxR) maxR = r;
  }
  const out = {};
  nodes.forEach((nd, i) => {
    out[nd.id] = [
      round((pos[i * 3] - cx) / maxR),
      round((pos[i * 3 + 1] - cy) / maxR),
      round((pos[i * 3 + 2] - cz) / maxR),
    ];
  });
  return out;
}

function round(v) {
  return Math.round(v * 10000) / 10000;
}
