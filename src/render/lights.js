/**
 * News lights drifting in the fog. Each light is one item (latest news,
 * research paper, or older archive story).
 *  - kind  -> shape + hue (breaking: warm star, paper: cool orb, archive: amber)
 *  - relevance (0..1, computed elsewhere) -> glow strength
 *  - age   -> dimming (old lights stay reachable) + an age mark on hover
 * Drift is cosmetic and uses an ordinary seeded random, never anything
 * that could affect evidence or ranking.
 */
import {
  Group,
  InstancedMesh,
  OctahedronGeometry,
  SphereGeometry,
  PlaneGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
  DynamicDrawUsage,
  Matrix4,
  Quaternion,
  Vector3,
  Color,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  SRGBColorSpace,
  RayInteractable,
} from '@iwsdk/core';
import { glowTexture } from './textures.js';
import { UI } from './card.js';
import { hash01 } from '../layout/force.js';
import { settings } from '../config.js';

export const LIGHT_KINDS = {
  breaking: { label: 'Latest', color: 0xffe2a8, css: '#ffe2a8' },
  paper: { label: 'Research', color: 0x9fe3ff, css: '#9fe3ff' },
  archive: { label: 'Archive', color: 0xd9a066, css: '#d9a066' },
};

const MAX = 48;
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _c = new Color();
const ID_Q = new Quaternion();

export class LightField {
  constructor(world, anchor) {
    this.world = world;
    this.anchor = anchor;
    this.items = [];
    this.state = new Map(); // id -> { yaw, elev, dist, phase, speed }
    this.hoveredId = null;
    this.openId = null;
    this.sealed = new Set();
    this.time = 0;
    this.now = Date.now();

    this.group = new Group();
    this.group.name = 'lights';
    world.createTransformEntity(this.group);

    this.cores = {};
    const geo = { breaking: new OctahedronGeometry(1, 0), paper: new SphereGeometry(1, 16, 12), archive: new SphereGeometry(1, 10, 8) };
    for (const kind of Object.keys(LIGHT_KINDS)) {
      const mesh = new InstancedMesh(geo[kind], new MeshBasicMaterial({ color: 0xffffff }), MAX);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.cores[kind] = mesh;
    }
    this.glow = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending }),
      MAX,
    );
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.group.add(this.glow);

    this.hit = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
      MAX,
    );
    this.hit.count = 0;
    this.hit.frustumCulled = false;
    this.hitOrder = [];
    this.hitEntity = world.createTransformEntity(this.hit);
    this.hitEntity.addComponent(RayInteractable);
    this.hit.addEventListener('pointermove', (e) => (this.hoveredId = this.hitOrder[e.instanceId] ?? null));
    this.hit.addEventListener('pointerleave', () => (this.hoveredId = null));
    this.hit.addEventListener('click', (e) => {
      const id = this.hitOrder[e.instanceId];
      if (id) this.onSelect?.(id);
    });

    // one hover tag: short headline + age mark
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 112;
    this.tag = { canvas, ctx: canvas.getContext('2d'), tex: new CanvasTexture(canvas), key: '' };
    this.tag.tex.colorSpace = SRGBColorSpace;
    this.tag.sprite = new Sprite(new SpriteMaterial({ map: this.tag.tex, transparent: true, depthWrite: false }));
    this.tag.sprite.scale.set(0.34, 0.05, 1);
    this.tag.sprite.renderOrder = 12;
    this.tag.sprite.visible = false;
    this.group.add(this.tag.sprite);
  }

  setItems(items, { now = Date.now() } = {}) {
    this.items = items.slice(0, MAX);
    this.now = now;
    this.state.clear();
    // spread lights over a wide arc around the seated user, outside the web
    this.items.forEach((it, i) => {
      const r = (k) => hash01(it.id, k);
      const n = this.items.length;
      const yawDeg = -110 + (220 * (i + 0.5)) / n + (r(1) - 0.5) * 14;
      this.state.set(it.id, {
        yaw: (yawDeg * Math.PI) / 180,
        elev: ((-8 + r(2) * 42) * Math.PI) / 180,
        dist: 1.45 + r(3) * 0.75,
        phase: r(4) * Math.PI * 2,
        speed: 0.015 + r(5) * 0.02,
      });
    });
  }

  get(id) {
    return this.items.find((x) => x.id === id) || null;
  }

  /** Related lights (same story) drift closer for a while. */
  pull(ids, seconds = 20) {
    const until = this.time + seconds;
    for (const id of ids) {
      const st = this.state.get(id);
      if (st) st.pullUntil = until;
    }
  }

  /** Age in days from the item's date (0 for undated). */
  ageDays(item) {
    const t = Date.parse(item.date || '');
    return Number.isFinite(t) ? Math.max(0, (this.now - t) / 86400000) : 0;
  }

  worldPositionOf(id, out = new Vector3()) {
    const st = this.state.get(id);
    if (!st) return null;
    const { head, yaw } = this.anchor;
    const g = settings.comfort.gentle ? 0.4 : 1;
    st.pull = (st.pull || 0) + (((st.pullUntil || 0) > this.time ? 1 : 0) - (st.pull || 0)) * 0.02;
    const a = yaw + st.yaw * (1 - 0.45 * st.pull) + Math.sin(this.time * st.speed * 6 * g + st.phase) * 0.03;
    const e = st.elev * (1 - 0.5 * st.pull) + Math.sin(this.time * st.speed * 4 * g + st.phase * 1.7) * 0.02;
    const dist = st.dist - 0.35 * st.pull;
    out.set(head.x + Math.sin(a) * Math.cos(e) * dist, head.y + Math.sin(e) * dist, head.z - Math.cos(a) * Math.cos(e) * dist);
    return out;
  }

  update(delta, headQuat) {
    this.time += delta;
    for (const mesh of Object.values(this.cores)) mesh.count = 0;
    this.glow.count = 0;
    this.hit.count = 0;
    this.hitOrder.length = 0;
    for (const it of this.items) {
      const kind = LIGHT_KINDS[it.kind] ? it.kind : 'breaking';
      this.worldPositionOf(it.id, _p);
      const age = this.ageDays(it);
      const fresh = Math.max(0.35, 1 - age / 45); // old lights dim, never vanish
      const rel = Math.max(0, Math.min(1, it.relevance ?? 0.3));
      const focus = it.id === this.hoveredId || it.id === this.openId;
      const twinkle = 1 + 0.08 * Math.sin(this.time * 1.3 + hash01(it.id, 6) * 6);
      const core = (kind === 'breaking' ? 0.026 : 0.021) * (focus ? 1.35 : 1);

      const mesh = this.cores[kind];
      _q.setFromAxisAngle(_s.set(0, 1, 0), this.time * 0.4 + hash01(it.id, 7) * 6);
      _m.compose(_p, kind === 'breaking' ? _q : ID_Q, _s.setScalar(core));
      mesh.setMatrixAt(mesh.count, _m);
      _c.setHex(LIGHT_KINDS[kind].color).multiplyScalar(this.sealed.has(it.id) ? 1 : 0.55 + 0.45 * fresh);
      mesh.setColorAt(mesh.count++, _c);

      _m.compose(_p, headQuat, _s.setScalar(core * (6 + 7 * rel) * twinkle * (focus ? 1.3 : 1)));
      this.glow.setMatrixAt(this.glow.count, _m);
      _c.setHex(LIGHT_KINDS[kind].color).multiplyScalar((0.25 + 0.75 * rel) * fresh * (focus ? 1.4 : 1));
      this.glow.setColorAt(this.glow.count++, _c);

      _m.compose(_p, ID_Q, _s.setScalar(0.07)); // generous touch target
      this.hit.setMatrixAt(this.hit.count++, _m);
      this.hitOrder.push(it.id);
    }
    for (const m of [...Object.values(this.cores), this.glow, this.hit]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.hit.computeBoundingSphere();
    this._updateTag();
  }

  _updateTag() {
    const it = this.hoveredId && this.get(this.hoveredId);
    if (!it) {
      this.tag.sprite.visible = false;
      return;
    }
    const key = it.id;
    if (this.tag.key !== key) {
      this.tag.key = key;
      const { ctx, canvas, tex } = this.tag;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(12,14,18,0.78)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, 10, canvas.width - 16, 92, 30);
      else ctx.rect(8, 10, canvas.width - 16, 92);
      ctx.fill();
      ctx.font = `600 30px ${UI.font}`;
      ctx.fillStyle = LIGHT_KINDS[it.kind]?.css || '#fff';
      ctx.textBaseline = 'middle';
      const mark = `${LIGHT_KINDS[it.kind]?.label || ''} · ${ageMark(this.ageDays(it))}`;
      ctx.fillText(mark, 30, 56);
      const w = ctx.measureText(mark).width;
      ctx.font = `500 32px ${UI.font}`;
      ctx.fillStyle = '#eef1f6';
      let text = it.headline;
      const max = canvas.width - 70 - w;
      while (ctx.measureText(text).width > max && text.length > 4) text = text.slice(0, -2);
      if (text !== it.headline) text += '…';
      ctx.fillText(text, 50 + w, 56);
      tex.needsUpdate = true;
    }
    this.worldPositionOf(it.id, _p);
    _p.y += 0.07;
    this.tag.sprite.position.copy(_p);
    this.tag.sprite.visible = true;
  }
}

export function ageMark(days) {
  if (days < 1 / 24) return 'now';
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}
