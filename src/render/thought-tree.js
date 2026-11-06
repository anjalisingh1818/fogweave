/**
 * The agent's thinking, drawn in the fog: a small tree that grows while it works.
 * Open thoughts glow pale blue, kept ones warm, the chosen ones gold; dropped ones
 * sink and fade, with the reason they were dropped. It shows what really happened
 * in the run (every state comes from the server's events), nothing decorative.
 */
import {
  Group,
  InstancedMesh,
  PlaneGeometry,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  AdditiveBlending,
  DynamicDrawUsage,
  Matrix4,
  Vector3,
  Color,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  SRGBColorSpace,
} from '@iwsdk/core';
import { glowTexture } from './textures.js';
import { UI, wrap } from './card.js';
import { settings } from '../config.js';

const MAX = 12;
const STATE = {
  root: { color: 0xeef1f6, size: 0.1, glow: 0.8, css: '#eef1f6' },
  open: { color: 0x8fb7e6, size: 0.09, glow: 0.9, css: '#cfe0f5' },
  kept: { color: 0xf2c27a, size: 0.1, glow: 0.9, css: '#f6dcae' },
  chosen: { color: 0xffd98a, size: 0.16, glow: 1.3, css: '#ffe9bb' },
  dropped: { color: 0x6c7480, size: 0.06, glow: 0.35, css: '#98a1ad' },
};
const _m = new Matrix4();
const _s = new Vector3();
const _p = new Vector3();
const _c = new Color();

export class ThoughtTree {
  constructor(world, anchor) {
    this.world = world;
    this.anchor = anchor;
    this.nodes = new Map();
    this.time = 0;
    this.visible = 0;
    this.want = 0;
    this.group = new Group();
    this.group.name = 'thought-tree';
    world.createTransformEntity(this.group);

    this.glow = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }),
      MAX,
    );
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    this.group.add(this.glow);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX * 6), 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(MAX * 6), 3).setUsage(DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.lines = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    this.group.add(this.lines);

    this.labels = [];
    for (let i = 0; i < MAX; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 176;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      sprite.renderOrder = 13;
      sprite.visible = false;
      this.group.add(sprite);
      this.labels.push({ sprite, canvas, ctx: canvas.getContext('2d'), tex, key: '' });
    }
  }

  /** A new tree: the question at the root. */
  start(question) {
    this.nodes.clear();
    this.want = 1;
    this.visible = 0;
    this._add({ id: 'root', parent: null, depth: 0, text: question, state: 'root' });
  }

  hide() {
    this.want = 0;
  }

  _add(t) {
    const siblings = [...this.nodes.values()].filter((x) => x.parent === t.parent).length;
    this.nodes.set(t.id, { ...t, index: siblings, born: this.time, grow: 0, sink: 0, why: t.why || '' });
  }

  /** One thought event from the agent. */
  onThought(ev) {
    const cur = this.nodes.get(ev.id);
    if (!cur) {
      if (this.nodes.size >= MAX) return;
      this._add({ id: ev.id, parent: ev.parent || 'root', depth: ev.depth || 1, text: ev.text || '', state: ev.state || 'open', why: ev.why });
      return;
    }
    if (ev.state) cur.state = ev.state;
    if (ev.why) cur.why = ev.why;
    if (ev.text) cur.text = ev.text;
    if (ev.state === 'chosen') this.onChosen?.(this.positionOf(ev.id, new Vector3()));
  }

  /** Each row of the tree fans out in front of the reader, the root below. */
  _local(n, out) {
    if (n.depth === 0) return out.set(0, -0.3, 0);
    const parent = this.nodes.get(n.parent);
    if (n.depth === 1) {
      const count = [...this.nodes.values()].filter((x) => x.depth === 1).length;
      return out.set((n.index - (count - 1) / 2) * 0.46, -0.08 - n.sink * 0.14, 0);
    }
    this._local(parent, out);
    out.x += (n.index - 0.5) * 0.24;
    out.y = 0.17 - n.sink * 0.14;
    return out;
  }

  positionOf(id, out = new Vector3()) {
    const n = this.nodes.get(id);
    if (!n) return null;
    this._local(n, out);
    return this._toWorld(out);
  }

  _toWorld(v) {
    const { head, yaw } = this.anchor;
    const f = this.flat;
    // flat page: to the left of the one card that is open, smaller; headset: straight ahead, further than the cards
    const dist = 1.2;
    const sx = f ? 0.62 : 1;
    const a = yaw + (f ? -0.2 : 0);
    const cx = head.x + Math.sin(a) * dist;
    const cz = head.z - Math.cos(a) * dist;
    const x = v.x * sx;
    v.set(cx + Math.cos(a) * x, head.y + (f ? 0.02 : 0.12) + v.y * (f ? 0.8 : 1), cz + Math.sin(a) * x);
    return v;
  }

  update(delta, headQuat) {
    this.time += delta;
    this.visible += (this.want - this.visible) * (1 - Math.exp(-delta * 5));
    this.group.visible = this.visible > 0.01;
    this.glow.count = 0;
    let lines = 0;
    const attr = this.lines.geometry.attributes.position;
    const col = this.lines.geometry.attributes.color;
    const gentle = settings.comfort.gentle;
    let li = 0;
    for (const n of this.nodes.values()) {
      n.grow = Math.min(1, n.grow + delta * 2.2);
      n.sink += ((n.state === 'dropped' ? 1 : 0) - n.sink) * (1 - Math.exp(-delta * 3));
      const st = STATE[n.state] || STATE.open;
      this.positionOf(n.id, _p);
      if (n.parent) {
        const from = this.positionOf(n.parent, new Vector3());
        const tip = from.clone().lerp(_p, 1 - (1 - n.grow) * (1 - n.grow));
        const i = lines * 6;
        attr.array.set([from.x, from.y, from.z, tip.x, tip.y, tip.z], i);
        _c.setHex(st.color).multiplyScalar(this.visible * (n.state === 'dropped' ? 0.3 : 0.9));
        col.array.set([_c.r * 0.5, _c.g * 0.5, _c.b * 0.5, _c.r, _c.g, _c.b], i);
        lines++;
      }
      const breathe = n.state === 'open' && !gentle ? 1 + 0.18 * Math.sin(this.time * 2.4 + n.index) : 1;
      _m.compose(_p, headQuat, _s.setScalar(st.size * n.grow * breathe * (0.6 + 0.4 * this.visible)));
      this.glow.setMatrixAt(this.glow.count, _m);
      this.glow.setColorAt(this.glow.count++, _c.setHex(st.color).multiplyScalar(st.glow * this.visible));
      li = this._label(n, li, st);
    }
    for (; li < this.labels.length; li++) this.labels[li].sprite.visible = false;
    this.lines.geometry.setDrawRange(0, lines * 2);
    if (lines) {
      attr.needsUpdate = true;
      col.needsUpdate = true;
    }
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  _label(n, i, st) {
    const lab = this.labels[i];
    if (!lab) return i;
    const key = `${n.text}|${n.state}|${n.why}`;
    if (lab.key !== key) {
      lab.key = key;
      drawThought(lab, n, st);
    }
    this.positionOf(n.id, _p);
    _p.y += n.depth === 0 ? -0.09 : 0.1;
    lab.sprite.position.copy(_p);
    lab.sprite.scale.set(0.42 * (this.flat ? 0.64 : 1), 0.1155 * (this.flat ? 0.64 : 1), 1);
    lab.sprite.material.opacity = this.visible * n.grow * (n.state === 'dropped' ? 0.75 : 1);
    lab.sprite.visible = this.visible > 0.01;
    return i + 1;
  }
}

function drawThought(lab, n, st) {
  const { ctx, canvas, tex } = lab;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${n.state === 'chosen' ? 600 : 500} 34px ${UI.font}`;
  const text = n.state === 'dropped' && n.why ? n.why : n.text;
  const lines = wrap(ctx, text, canvas.width - 48);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] = `${shown[2].replace(/\s*\S*$/, '')}…`;
  const h = shown.length * 42 + 24;
  const y0 = (canvas.height - h) / 2;
  ctx.fillStyle = 'rgba(12,14,18,0.74)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(4, y0, canvas.width - 8, h, 22);
  else ctx.rect(4, y0, canvas.width - 8, h);
  ctx.fill();
  ctx.fillStyle = st.css;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  shown.forEach((line, k) => ctx.fillText(line, canvas.width / 2, y0 + 33 + k * 42));
  tex.needsUpdate = true;
}
