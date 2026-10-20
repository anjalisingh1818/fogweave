/**
 * GraphView renders a GraphStore inside the seated bubble.
 *
 * Budget-minded: node cores, verdict rings, glows and the hit-target are
 * InstancedMeshes; edges are a few LineSegments (one per style x layer);
 * labels come from a small pool and only the most relevant nodes get one.
 * Layout runs in a worker; nodes ease toward their targets and new nodes
 * drift in from the fog.
 */
import {
  Group,
  InstancedMesh,
  IcosahedronGeometry,
  SphereGeometry,
  OctahedronGeometry,
  BoxGeometry,
  PlaneGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Color,
  Matrix4,
  Quaternion,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  SRGBColorSpace,
  AdditiveBlending,
  DynamicDrawUsage,
  RayInteractable,
} from '@iwsdk/core';
import { VERDICT_STYLE, TYPE_STYLE, EDGE_STYLE } from '../model/schema.js';
import { pagerank } from '../model/algorithms.js';
import { LayoutClient } from '../layout/layout-client.js';
import { ringTexture, glowTexture } from './textures.js';
import { UI } from './card.js';
import { settings } from '../config.js';

const MAX_NODES = 160;
const MAX_EDGES = 400;
const TYPES = ['Topic', 'Claim', 'Source', 'Entity'];
const LAYERS = ['fog', 'sealed'];
const RING_STYLES = ['solid', 'double', 'dashed', 'dotted'];
const EDGE_GROUPS = ['supports', 'contradicts', 'cites', 'relates'];
const SHAPE = [1.25, 0.8, 0.5];

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);

export class GraphView {
  constructor(world, store, { center, radius = 0.5 }) {
    this.world = world;
    this.store = store;
    this.center = center.clone();
    this.baseRadius = radius;
    this.radius = radius; // grows with the web so big webs do not become a ball
    this.layout = new LayoutClient();
    this.time = 0;

    this.root = new Group();
    this.root.name = 'graph-root';
    this.rootEntity = world.createTransformEntity(this.root);
    this.root.position.copy(this.center);
    this.root.scale.setScalar(radius); // children work in unit-sphere space

    // per-node animation state: id -> { cur, target, born, scale, drift }
    this.state = new Map();
    this.visibleIds = [];
    this.hitOrder = [];
    this.selectedId = null;
    this.hoveredId = null;
    this.linkFromId = null;
    this.pathNodes = new Set();
    this.pathEdges = [];
    this.pulse = new Map(); // id -> until time (reveal flash)
    this.labelBudget = settings.quality.labels;
    this._layoutTimer = null;
    this._dirty = true;
    this._ranks = new Map();

    this._buildMeshes();
    this._buildLabels();
    store.on((ev) => this._onStoreChange(ev));
  }

  // ---------- construction ----------

  _buildMeshes() {
    const geoms = {
      Topic: new IcosahedronGeometry(1, 2),
      Claim: new SphereGeometry(1, 20, 14),
      Source: new OctahedronGeometry(1, 0),
      Entity: new BoxGeometry(1.4, 1.4, 1.4),
    };
    this.nodeMeshes = {};
    for (const type of TYPES) {
      for (const layer of LAYERS) {
        const mat = new MeshBasicMaterial({
          color: 0xffffff,
          transparent: layer === 'fog',
          opacity: layer === 'fog' ? 0.5 : 1,
          depthWrite: layer !== 'fog',
        });
        const mesh = new InstancedMesh(geoms[type], mat, MAX_NODES);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.ids = [];
        this.root.add(mesh);
        this.nodeMeshes[`${type}:${layer}`] = mesh;
      }
    }

    const plane = new PlaneGeometry(1, 1);
    this.ringMeshes = {};
    for (const style of RING_STYLES) {
      const mesh = new InstancedMesh(
        plane,
        new MeshBasicMaterial({ map: ringTexture(style), transparent: true, depthWrite: false }),
        MAX_NODES,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.ringMeshes[style] = mesh;
    }

    this.glowMesh = new InstancedMesh(
      plane,
      new MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      MAX_NODES,
    );
    this.glowMesh.count = 0;
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 1;
    this.root.add(this.glowMesh);

    // enlarged invisible hit targets: small sources stay easy to pinch
    this.hitMesh = new InstancedMesh(
      new SphereGeometry(1, 10, 8),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
      MAX_NODES,
    );
    this.hitMesh.count = 0;
    this.hitMesh.frustumCulled = false;
    this.hitEntity = this.world.createTransformEntity(this.hitMesh, this.rootEntity);
    this.hitEntity.addComponent(RayInteractable);

    this.edgeLines = {};
    for (const group of EDGE_GROUPS) {
      for (const layer of LAYERS) {
        const style = Object.values(EDGE_STYLE).find((s) => s.group === group);
        const opacity = layer === 'sealed' ? 0.9 : 0.38;
        const mat = style.dash
          ? new LineDashedMaterial({ color: style.color, dashSize: style.dash[0], gapSize: style.dash[1], transparent: true, opacity, depthWrite: false })
          : new LineBasicMaterial({ color: style.color, transparent: true, opacity, depthWrite: false });
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_EDGES * 6), 3).setUsage(DynamicDrawUsage));
        geo.setDrawRange(0, 0);
        const line = new LineSegments(geo, mat);
        line.frustumCulled = false;
        line.edges = [];
        line.dashed = !!style.dash;
        this.root.add(line);
        this.edgeLines[`${group}:${layer}`] = line;
      }
    }

    // highlighted path: thin gold tubes
    this.pathMesh = new InstancedMesh(
      new CylinderGeometry(1, 1, 1, 6, 1, true),
      new MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.95, depthWrite: false }),
      64,
    );
    this.pathMesh.count = 0;
    this.pathMesh.frustumCulled = false;
    this.root.add(this.pathMesh);
  }

  _buildLabels() {
    this.labels = [];
    for (let i = 0; i < 28; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 112;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
      sprite.scale.set(0.2, 0.035, 1);
      sprite.renderOrder = 10;
      sprite.visible = false;
      this.root.add(sprite);
      this.labels.push({ sprite, canvas, ctx: canvas.getContext('2d'), tex, key: '' });
    }
  }

  // ---------- data -> state ----------

  _onStoreChange(ev) {
    if (ev.kind === 'clear') {
      this.state.clear();
      this.selectedId = this.hoveredId = this.linkFromId = null;
      this.clearPath();
    }
    this._dirty = true;
    if (ev.kind !== 'node-updated' && ev.kind !== 'sealed' && ev.kind !== 'unsealed' && ev.kind !== 'meta') {
      this._scheduleLayout();
    }
  }

  _scheduleLayout() {
    clearTimeout(this._layoutTimer);
    this._layoutTimer = setTimeout(() => this._runLayout(), 200);
  }

  async _runLayout() {
    const { nodes, edges } = this.store.view('all');
    const previous = {};
    for (const n of nodes) {
      const st = this.state.get(n.id);
      if (st?.placed) previous[n.id] = [st.target.x / SHAPE[0], st.target.y / SHAPE[1], st.target.z / SHAPE[2]];
    }
    const positions = await this.layout.layout(nodes, edges, previous);
    if (!positions) return; // superseded by a newer request
    for (const [id, p] of Object.entries(positions)) {
      const st = this._ensureState(id);
      // wide, shallow bubble: a seated viewer sees across it, not into it
      st.target.set(p[0] * SHAPE[0], p[1] * SHAPE[1], p[2] * SHAPE[2]);
      st.placed = true;
    }
  }

  _ensureState(id) {
    let st = this.state.get(id);
    if (st) return st;
    // new nodes appear far out in the fog, then drift in
    const node = this.store.nodes.get(id);
    const anchor = node && this._neighborTarget(id);
    const dir = new Vector3(hash(id, 1) - 0.5, hash(id, 2) - 0.5, hash(id, 3) - 0.5).normalize();
    st = {
      cur: dir.clone().multiplyScalar(2.6),
      target: anchor ? anchor.clone().add(dir.clone().multiplyScalar(0.12)) : dir.clone().multiplyScalar(0.7),
      born: this.time,
      scale: 0,
      placed: false,
      phase: hash(id, 4) * Math.PI * 2,
    };
    this.state.set(id, st);
    return st;
  }

  _neighborTarget(id) {
    for (const { id: nb } of this.store.neighbors(id)) {
      const s = this.state.get(nb);
      if (s) return s.target;
    }
    return null;
  }

  // ---------- public API ----------

  /** World position of a node (for cards, props, reveals). */
  worldPositionOf(id, out = new Vector3()) {
    const st = this.state.get(id);
    if (!st) return null;
    this._drawPos(id, out);
    return this.root.localToWorld(out);
  }

  /** Nearest visible node to a world point within maxDist metres. */
  nearestNode(worldPoint, maxDist = 0.15) {
    let best = null;
    let bestD = maxDist;
    for (const id of this.visibleIds) {
      const p = this.worldPositionOf(id, _p);
      const d = p.distanceTo(worldPoint);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  nodeIdFromHit(instanceId) {
    return this.hitOrder[instanceId] ?? null;
  }

  setSelected(id) {
    this.selectedId = id;
    this._dirty = true;
  }

  setHovered(id) {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this._dirty = true;
  }

  flash(id, seconds = 2.5) {
    this.pulse.set(id, this.time + seconds);
    this._dirty = true;
  }

  showPath(path) {
    this.pathNodes = new Set(path.nodes);
    this.pathEdges = path.edges;
    this._dirty = true;
  }

  clearPath() {
    this.pathNodes = new Set();
    this.pathEdges = [];
    this._dirty = true;
  }

  // ---------- per-frame ----------

  update(delta, headWorldPos, headWorldQuat) {
    this.time += delta;
    const ease = 1 - Math.exp(-delta * 2.2);

    if (this._dirty) {
      this._recomputeVisible();
      this._dirty = false;
    }
    if (this.targetRadius && Math.abs(this.targetRadius - this.radius) > 1e-4) {
      this.radius += (this.targetRadius - this.radius) * (1 - Math.exp(-delta * 1.5));
      this.root.scale.setScalar(this.radius);
    }

    for (const id of this.visibleIds) {
      const st = this._ensureState(id);
      st.cur.lerp(st.target, st.placed ? ease : ease * 0.4);
      st.scale = Math.min(1, st.scale + delta * 1.4);
    }

    // billboard orientation in root-local space
    _q.copy(this.root.getWorldQuaternion(new Quaternion())).invert().multiply(headWorldQuat);
    this._writeNodes(_q);
    this._writeEdges();
    this._writePath();
    this._updateLabels(delta, headWorldPos);
  }

  _recomputeVisible() {
    const nodes = [...this.store.nodes.values()];
    // importance for LOD (and the visible cap) over the whole web
    const view = this.store.view('all');
    this._ranks = pagerank(view);
    let visible = nodes;
    if (nodes.length > settings.quality.maxNodes) {
      visible = [...nodes]
        .sort((a, b) => score(b, this) - score(a, this))
        .slice(0, settings.quality.maxNodes);
    }
    this.visibleIds = visible.map((n) => n.id);
    this._visibleSet = new Set(this.visibleIds);
    this.targetRadius = this.baseRadius * Math.min(1.6, Math.max(1, Math.sqrt(this.visibleIds.length / 50)));
  }

  _nodeColor(node) {
    if (node.type === 'Claim') return VERDICT_STYLE[node.verdict || 'unverified'].color;
    return TYPE_STYLE[node.type].color;
  }

  _writeNodes(billboardQ) {
    for (const mesh of Object.values(this.nodeMeshes)) {
      mesh.count = 0;
      mesh.ids.length = 0;
    }
    for (const mesh of Object.values(this.ringMeshes)) mesh.count = 0;
    this.glowMesh.count = 0;
    this.hitMesh.count = 0;
    this.hitOrder.length = 0;

    for (const id of this.visibleIds) {
      const node = this.store.nodes.get(id);
      const st = this.state.get(id);
      if (!node || !st) continue;
      const layer = node.sealed ? 'sealed' : 'fog';
      const base = TYPE_STYLE[node.type].size / this.radius;
      const emphasized = id === this.selectedId || id === this.hoveredId || this.pathNodes.has(id) || id === this.linkFromId;
      const flashing = (this.pulse.get(id) ?? 0) > this.time;
      const bloom = easeOutBack(st.scale);
      let size = base * bloom * (emphasized ? 1.25 : 1);
      if (flashing) size *= 1 + 0.15 * Math.sin(this.time * 8);

      // fog-layer nodes drift gently; sealed nodes hold still
      _p.copy(st.cur);
      if (!node.sealed) {
        const t = this.time * 0.35 + st.phase;
        _p.x += Math.sin(t) * 0.025;
        _p.y += Math.cos(t * 0.8) * 0.025;
      }

      const mesh = this.nodeMeshes[`${node.type}:${layer}`];
      _s.setScalar(size);
      _m.compose(_p, node.type === 'Claim' ? IDENTITY_Q : spinQ(this.time, st.phase), _s);
      mesh.setMatrixAt(mesh.count, _m);
      _c.setHex(this._nodeColor(node));
      if (!node.sealed) _c.multiplyScalar(0.85);
      mesh.setColorAt(mesh.count, _c);
      mesh.ids.push(id);
      mesh.count++;

      // hit target (at least 3.5 cm radius in the world)
      _s.setScalar(Math.max(size * 1.6, 0.035 / this.radius));
      _m.compose(_p, IDENTITY_Q, _s);
      this.hitMesh.setMatrixAt(this.hitMesh.count, _m);
      this.hitOrder.push(id);
      this.hitMesh.count++;

      // verdict ring (claims)
      if (node.type === 'Claim') {
        const style = VERDICT_STYLE[node.verdict || 'unverified'].ring;
        const ring = this.ringMeshes[style];
        _s.setScalar(size * 2.4);
        _m.compose(_p, billboardQ, _s);
        ring.setMatrixAt(ring.count, _m);
        _c.setHex(this._nodeColor(node)).multiplyScalar(node.sealed ? 1 : 0.6);
        ring.setColorAt(ring.count, _c);
        ring.count++;
      }

      // glow halo
      let glow = node.sealed ? 0.55 : 0.3;
      if (node.type === 'Topic') glow = 0.45;
      if (emphasized) glow = 1;
      if (flashing) glow = 1.2;
      _s.setScalar(size * (emphasized || flashing ? 5.5 : 4));
      _m.compose(_p, billboardQ, _s);
      this.glowMesh.setMatrixAt(this.glowMesh.count, _m);
      _c.setHex(this.pathNodes.has(id) ? 0xffd98a : this._nodeColor(node)).multiplyScalar(glow * settings.quality.glow);
      this.glowMesh.setColorAt(this.glowMesh.count, _c);
      this.glowMesh.count++;
    }

    const all = [...Object.values(this.nodeMeshes), ...Object.values(this.ringMeshes), this.glowMesh, this.hitMesh];
    for (const mesh of all) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.hitMesh.computeBoundingSphere();
    this.hitMesh.computeBoundingBox?.();
  }

  _drawPos(id, out) {
    const st = this.state.get(id);
    out.copy(st.cur);
    const node = this.store.nodes.get(id);
    if (node && !node.sealed) {
      const t = this.time * 0.35 + st.phase;
      out.x += Math.sin(t) * 0.025;
      out.y += Math.cos(t * 0.8) * 0.025;
    }
    return out;
  }

  _writeEdges() {
    for (const line of Object.values(this.edgeLines)) line.edges.length = 0;
    for (const e of this.store.edges.values()) {
      if (!this._visibleSet?.has(e.from) || !this._visibleSet.has(e.to)) continue;
      const group = EDGE_STYLE[e.type]?.group || 'relates';
      const layer = e.sealed ? 'sealed' : 'fog';
      const line = this.edgeLines[`${group}:${layer}`];
      if (line.edges.length < MAX_EDGES) line.edges.push(e);
    }
    const a = new Vector3();
    const b = new Vector3();
    for (const line of Object.values(this.edgeLines)) {
      const attr = line.geometry.attributes.position;
      let i = 0;
      for (const e of line.edges) {
        const sa = this.state.get(e.from);
        const sb = this.state.get(e.to);
        if (!sa || !sb) continue;
        this._drawPos(e.from, a);
        this._drawPos(e.to, b);
        // edges grow out as the younger endpoint blooms in
        const grow = Math.min(sa.scale, sb.scale);
        b.lerpVectors(a, b, grow);
        attr.array[i++] = a.x;
        attr.array[i++] = a.y;
        attr.array[i++] = a.z;
        attr.array[i++] = b.x;
        attr.array[i++] = b.y;
        attr.array[i++] = b.z;
      }
      attr.needsUpdate = true;
      line.geometry.setDrawRange(0, i / 3);
      if (line.dashed && i) line.computeLineDistances();
    }
  }

  _writePath() {
    this.pathMesh.count = 0;
    const a = new Vector3();
    const b = new Vector3();
    const mid = new Vector3();
    const dir = new Vector3();
    for (const e of this.pathEdges) {
      if (!this.state.has(e.from) || !this.state.has(e.to)) continue;
      this._drawPos(e.from, a);
      this._drawPos(e.to, b);
      mid.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a);
      const len = dir.length();
      _q.setFromUnitVectors(_up, dir.normalize());
      const pulse = 1 + 0.25 * Math.sin(this.time * 4);
      _s.set((0.0028 * pulse) / this.radius, len, (0.0028 * pulse) / this.radius);
      _m.compose(mid, _q, _s);
      this.pathMesh.setMatrixAt(this.pathMesh.count++, _m);
    }
    this.pathMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- labels (LOD) ----------

  _updateLabels(delta, headWorldPos) {
    this._labelTimer = (this._labelTimer || 0) - delta;
    if (this._labelTimer > 0 && !this._labelsDirty) {
      this._placeLabels();
      return;
    }
    this._labelTimer = 0.4;
    this._labelsDirty = false;
    const budget = Math.min(this.labels.length, settings.quality.labels);
    const ranked = this.visibleIds
      .map((id) => {
        const n = this.store.nodes.get(id);
        let p = (this._ranks.get(id) || 0) * 100;
        if (n.type === 'Topic') p += 700;
        if (n.sealed) p += 200;
        if (this.pathNodes.has(id)) p += 800;
        if (id === this.hoveredId) p += 900;
        if (id === this.selectedId || id === this.linkFromId) p += 1000;
        if (n.type === 'Source' && p < 500) p -= 50; // sources are labelled last
        return { id, p };
      })
      .sort((x, y) => y.p - x.p)
      .slice(0, budget);
    this._labelIds = ranked.map((r) => r.id);
    this._labelsDirty = false;
    this._placeLabels(true);
  }

  markLabelsDirty() {
    this._labelsDirty = true;
  }

  _placeLabels(redraw = false) {
    const ids = this._labelIds || [];
    this.labels.forEach((lab, i) => {
      const id = ids[i];
      const node = id && this.store.nodes.get(id);
      if (!node || !this.state.has(id)) {
        lab.sprite.visible = false;
        return;
      }
      const st = this.state.get(id);
      if (st.scale < 0.6) {
        lab.sprite.visible = false;
        return;
      }
      if (redraw) {
        const key = `${node.label}|${node.sealed}|${id === this.selectedId}`;
        if (lab.key !== key) {
          lab.key = key;
          drawLabel(lab, node, id === this.selectedId);
        }
      }
      this._drawPos(id, _p);
      const size = TYPE_STYLE[node.type].size / this.radius;
      _p.y += size * 1.5 + 0.06;
      lab.sprite.position.copy(_p);
      const k = 1 / this.radius;
      lab.sprite.scale.set(0.2 * k * lab.aspect, 0.035 * k, 1);
      lab.sprite.visible = true;
    });
  }
}

const IDENTITY_Q = new Quaternion();
const _spin = new Quaternion();
function spinQ(t, phase) {
  return _spin.setFromAxisAngle(_up, t * 0.25 + phase);
}

function easeOutBack(x) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function score(node, view) {
  let s = (view._ranks.get(node.id) || 0) * 100;
  if (node.type === 'Topic') s += 1000;
  if (node.sealed) s += 500;
  if (node.type === 'Claim') s += 50;
  return s;
}

function hash(str, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function drawLabel(lab, node, selected) {
  const { ctx, canvas, tex } = lab;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${node.type === 'Topic' ? 600 : 500} 46px ${UI.font}`;
  let text = node.label;
  const maxW = canvas.width - 40;
  while (ctx.measureText(text).width > maxW && text.length > 4) text = text.slice(0, -2);
  if (text !== node.label) text = text.replace(/\s*\S?$/, '') + '…';
  const w = Math.min(canvas.width, ctx.measureText(text).width + 40);
  const x0 = (canvas.width - w) / 2;
  ctx.fillStyle = selected ? 'rgba(60,50,25,0.82)' : 'rgba(12,14,18,0.62)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, 14, w, 84, 30);
  else ctx.rect(x0, 14, w, 84);
  ctx.fill();
  ctx.fillStyle = node.type === 'Topic' ? '#f6efdc' : '#e6eaf0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 58);
  tex.needsUpdate = true;
  lab.aspect = 1; // full canvas width; transparent padding keeps it centred
}
